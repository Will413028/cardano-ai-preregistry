import { type Network } from './commitment.ts';

export type PublicQuery =
  | { kind: 'commitment'; network: Network; tx_hash: string }
  | { kind: 'label'; network: Network; label: number; offset: number; limit: number }
  | { kind: 'address'; network: Network; address: string; offset: number; limit: number };
export interface PublicSource { read(query: PublicQuery): Promise<unknown>; }
export interface ReadCache {
  get(key: string): unknown | undefined;
  set(key: string, value: unknown): void;
}

export class MemoryReadCache implements ReadCache {
  private readonly entries = new Map<string, { value: unknown; expires: number }>();
  constructor(private readonly ttl_ms = 15000, private readonly max_entries = 128, private readonly now = Date.now) {}
  get(key: string): unknown | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expires <= this.now()) { this.entries.delete(key); return undefined; }
    return structuredClone(entry.value);
  }
  set(key: string, value: unknown): void {
    if (this.entries.size >= this.max_entries) this.entries.delete(this.entries.keys().next().value!);
    this.entries.set(key, { value: structuredClone(value), expires: this.now() + this.ttl_ms });
  }
}

export function parse_public_query(url: URL): PublicQuery {
  const params = url.searchParams;
  const kind = params.get('kind');
  const network = params.get('network');
  if (network !== 'preprod' && network !== 'devnet') throw new Error('Unsupported query network.');
  const allowed = kind === 'commitment' ? ['kind', 'network', 'tx_hash']
    : kind === 'label' ? ['kind', 'network', 'label', 'offset', 'limit']
    : kind === 'address' ? ['kind', 'network', 'address', 'offset', 'limit'] : [];
  for (const key of params.keys()) if (!allowed.includes(key) || params.getAll(key).length !== 1) throw new Error('Only whitelisted public query fields are accepted.');
  if (kind === 'commitment') {
    const tx_hash = params.get('tx_hash') ?? '';
    if (!/^[0-9a-f]{64}$/.test(tx_hash)) throw new Error('Invalid transaction hash.');
    return { kind, network, tx_hash };
  }
  const integer = (key: string, fallback: string, max: number) => {
    const text = params.get(key) ?? fallback;
    if (!/^\d+$/.test(text) || !Number.isSafeInteger(Number(text)) || Number(text) > max) throw new Error('Invalid ' + key);
    return Number(text);
  };
  const offset = integer('offset', '0', 1000000);
  const limit = integer('limit', '100', 100);
  if (limit < 1) throw new Error('limit must be positive.');
  if (kind === 'label') {
    const label = integer('label', '', 131071);
    if (label < 65536) throw new Error('Only private-use labels are accepted in the MVP.');
    return { kind, network, label, offset, limit };
  }
  if (kind === 'address') {
    const address = params.get('address') ?? '';
    if (!/^addr_test1[023456789acdefghjklmnpqrstuvwxyz]{20,110}$/.test(address)) throw new Error('Invalid testnet address.');
    return { kind, network, address, offset, limit };
  }
  throw new Error('Unsupported query kind.');
}

export class ReadProxy {
  private readonly pending = new Map<string, Promise<unknown>>();
  constructor(private readonly source: PublicSource, private readonly cache: ReadCache) {}
  async read(query: PublicQuery): Promise<unknown> {
    const key = JSON.stringify(query);
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;
    const in_flight = this.pending.get(key);
    if (in_flight) return structuredClone(await in_flight);
    const request = this.source.read(query);
    this.pending.set(key, request);
    try { const value = await request; this.cache.set(key, value); return structuredClone(value); }
    finally { this.pending.delete(key); }
  }
}

export const fixture_source: PublicSource = {
  async read(query) { return { source: 'fixture', network: query.network, data: query.kind === 'commitment' ? null : [] }; },
};
