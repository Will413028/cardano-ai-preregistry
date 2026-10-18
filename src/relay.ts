import { type ChainNetwork } from './commitment.ts';

/**
 * Same-origin relay to Koios (D17): Koios Public sends no Access-Control-Allow-Origin on its responses, so a browser
 * cannot read it directly. The relay is an untrusted transport like Koios itself (I4): it forwards whitelisted public
 * queries and returns the raw upstream body; the browser verifies every byte. It never derives or stores a status (I5).
 * One handler serves the Vite dev and preview servers and the deployed function (`functions/api/cardano.ts`).
 */
export const RELAY_PATH = '/api/cardano';
/** The whole route table: body-free GETs on one path. No write or status route may be added (I5(a), D18). */
export const RELAY_ROUTES = [{ method: 'GET', path: RELAY_PATH }] as const;
export const KOIOS: Partial<Record<ChainNetwork, string>> = { preprod: 'https://preprod.koios.rest/api/v1' };
export const MAX_TX_BATCH = 10;
export const MAX_PAGE = 100;
export type RelayQuery =
  | { kind: 'tip'; network: ChainNetwork }
  | { kind: 'tx'; network: ChainNetwork; tx_hashes: string[] }
  | { kind: 'label'; network: ChainNetwork; label: number; offset: number; limit: number };

const HASH = /^[0-9a-f]{64}$/;
const FIELDS: Record<RelayQuery['kind'], string[]> = { tip: ['kind', 'network'], tx: ['kind', 'network', 'tx_hashes'], label: ['kind', 'network', 'label', 'offset', 'limit'] };
export function parse_relay_query(url: URL): RelayQuery {
  const params = url.searchParams;
  const kind = params.get('kind') as RelayQuery['kind'] | null, network = params.get('network') as ChainNetwork | null;
  if (!kind || !Object.hasOwn(FIELDS, kind)) throw new Error('Unsupported query kind.');
  if (!network || !Object.hasOwn(KOIOS, network)) throw new Error('Unsupported query network.');
  for (const key of params.keys()) if (!FIELDS[kind].includes(key) || params.getAll(key).length !== 1) throw new Error('Only whitelisted public query fields are accepted.');
  if (kind === 'tip') return { kind, network };
  if (kind === 'tx') {
    const tx_hashes = (params.get('tx_hashes') ?? '').split(',');
    if (tx_hashes.length > MAX_TX_BATCH || tx_hashes.some(h => !HASH.test(h)) || new Set(tx_hashes).size !== tx_hashes.length) throw new Error('Invalid transaction hashes.');
    return { kind, network, tx_hashes };
  }
  const integer = (key: string, fallback: string, min: number, max: number) => {
    const text = params.get(key) ?? fallback;
    if (!/^\d+$/.test(text) || Number(text) < min || Number(text) > max) throw new Error('Invalid ' + key);
    return Number(text);
  };
  // CIP-10 private-use labels only in the MVP (D12).
  return { kind, network, label: integer('label', '', 65536, 131071), offset: integer('offset', '0', 0, 1000000), limit: integer('limit', String(MAX_PAGE), 1, MAX_PAGE) };
}
export function relay_url(query: RelayQuery): string {
  const params = new URLSearchParams({ kind: query.kind, network: query.network });
  if (query.kind === 'tx') params.set('tx_hashes', query.tx_hashes.join(','));
  if (query.kind === 'label') { params.set('label', String(query.label)); params.set('offset', String(query.offset)); params.set('limit', String(query.limit)); }
  return `${RELAY_PATH}?${params}`;
}
/** The upstream request for a query; also used directly by Node readers, which have no CORS restriction. */
export function koios_request(query: RelayQuery): { url: string; init: RequestInit } {
  const base = KOIOS[query.network];
  if (!base) throw new Error(`No Koios endpoint for ${query.network}.`);
  if (query.kind === 'tip') return { url: `${base}/tip`, init: {} };
  if (query.kind === 'tx') {
    return { url: `${base}/tx_cbor`, init: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ _tx_hashes: query.tx_hashes }) } };
  }
  // Explicit order so pages are stable across requests; the indexer pages by offset.
  const params = new URLSearchParams({ _label: String(query.label), offset: String(query.offset), limit: String(query.limit), order: 'block_height.asc,tx_hash.asc' });
  return { url: `${base}/tx_by_metalabel?${params}`, init: {} };
}

export interface RelayCache {
  get(key: string): string | undefined;
  set(key: string, value: string, ttl_ms: number): void;
}
export class MemoryRelayCache implements RelayCache {
  private readonly entries = new Map<string, { value: string; expires: number }>();
  constructor(private readonly max_entries = 512, private readonly now = Date.now) {}
  get(key: string): string | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expires <= this.now()) { this.entries.delete(key); return undefined; }
    return entry.value;
  }
  set(key: string, value: string, ttl_ms: number): void {
    this.entries.delete(key);
    if (this.entries.size >= this.max_entries) this.entries.delete(this.entries.keys().next().value!);
    this.entries.set(key, { value, expires: this.now() + ttl_ms });
  }
}
/** Transaction bytes never change once found; tips, label pages and any batch with a hash not found yet do. */
function ttl(query: RelayQuery, body: string): number {
  if (query.kind !== 'tx') return 15000;
  try {
    const found = new Set((JSON.parse(body) as { tx_hash?: unknown }[]).map(row => row?.tx_hash));
    return query.tx_hashes.every(h => found.has(h)) ? 600000 : 15000;
  } catch { return 15000; }
}

const json = (status: number, body: string) => new Response(body, { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const MAX_PENDING = 64;
/** Shared by every caller of this instance: identical concurrent queries cost one upstream request. */
export function create_relay(upstream: typeof fetch, cache: RelayCache = new MemoryRelayCache()): (request: Request) => Promise<Response> {
  const pending = new Map<string, Promise<string>>();
  return async request => {
    const url = new URL(request.url);
    const route = RELAY_ROUTES.find(r => r.path === url.pathname);
    if (!route) return json(404, '{"error":"Not found."}');
    if (request.method !== route.method || request.headers.get('content-length') || request.headers.get('transfer-encoding')) {
      return json(405, '{"error":"Only body-free GET reads are accepted."}');
    }
    let query: RelayQuery;
    try { query = parse_relay_query(url); } catch { return json(400, '{"error":"Invalid public query."}'); }
    const key = relay_url(query);
    const cached = cache.get(key);
    if (cached !== undefined) return json(200, cached);
    let read = pending.get(key);
    if (!read) {
      if (pending.size >= MAX_PENDING) return json(503, '{"error":"Too many concurrent public reads."}');
      const { url: target, init } = koios_request(query);
      read = upstream(target, { ...init, signal: AbortSignal.timeout(30000) }).then(async response => {
        if (!response.ok) throw new Error('Upstream unavailable.');
        const body = await response.text();
        cache.set(key, body, ttl(query, body));
        return body;
      }).finally(() => pending.delete(key));
      pending.set(key, read);
    }
    try { return json(200, await read); } catch { return json(502, '{"error":"Public chain read unavailable."}'); }
  };
}
