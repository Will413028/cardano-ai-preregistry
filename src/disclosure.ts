import { CHAIN_NETWORKS, DOMAIN, unhex, type ChainNetwork } from './commitment.ts';
import { canonicalize, validate_manifest, type Json, type Manifest } from './manifest.ts';
import { type RevealDraft } from './verifier.ts';
import { verify_transaction } from './transaction.ts';

export interface ExperimentResult {
  experiment_id: string;
  completed_runs: number;
  metrics: Record<string, Json>;
}
export interface DisclosedFile { path: string; sha256: string; url: string; }
/** Registrant-hosted disclosure (D7=A); the announcement commits to its exact canonical bytes. */
export interface RevealBundle {
  bundle_version: 1;
  app: typeof DOMAIN;
  network: ChainNetwork;
  commitment_tx_hash: string;
  manifest: Manifest;
  salt_hex: string;
  results: ExperimentResult[];
  files: DisclosedFile[];
  self_reported_period?: { started_at?: string; finished_at?: string };
  /** The signed commitment transaction, so a reader needs only Mithril, not an indexer, to check it (D17). */
  commitment_tx_cbor?: string;
}

export const MAX_URL_BYTES = 512;
const CHUNK_BYTES = 64;
const HASH = /^[0-9a-f]{64}$/;
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

/** Only https URLs, or http on loopback for local devnet runs; ASCII keeps byte chunks reversible. */
export function validate_public_url(url: unknown, allow_loopback = false): string {
  if (typeof url !== 'string' || !/^[\x21-\x7e]+$/.test(url) || url.length > MAX_URL_BYTES) throw new Error('URL must be printable ASCII, at most 512 bytes.');
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error('Invalid URL.'); }
  const loopback = allow_loopback && parsed.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !loopback) throw new Error('Disclosure URLs must use https.');
  if (parsed.username || parsed.password) throw new Error('Disclosure URLs must not contain credentials.');
  return url;
}
export function split_url(url: string, allow_loopback = false): string[] {
  validate_public_url(url, allow_loopback);
  const chunks: string[] = [];
  for (let i = 0; i < url.length; i += CHUNK_BYTES) chunks.push(url.slice(i, i + CHUNK_BYTES));
  return chunks;
}
/** Every chunk except the last is full, so each URL has exactly one encoding. */
export function join_url(chunks: string[], allow_loopback = false): string {
  const last = chunks.at(-1);
  if (!last || last.length > CHUNK_BYTES || chunks.slice(0, -1).some(c => c.length !== CHUNK_BYTES)) throw new Error('Non-canonical URL chunks.');
  return validate_public_url(chunks.join(''), allow_loopback);
}

function object(value: unknown, keys: string[], optional: string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object.');
  const actual = Object.keys(value);
  if (keys.some(k => !actual.includes(k)) || actual.some(k => !keys.includes(k) && !optional.includes(k))) throw new Error('Unexpected or missing bundle fields.');
  return value as Record<string, unknown>;
}
function nonempty(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Expected a nonempty string.');
  return value;
}
function unique(values: string[]) { if (new Set(values).size !== values.length) throw new Error('Bundle entries must be unique.'); }

export function validate_bundle(input: unknown): RevealBundle {
  const b = object(input, ['bundle_version', 'app', 'network', 'commitment_tx_hash', 'manifest', 'salt_hex', 'results', 'files'], ['self_reported_period', 'commitment_tx_cbor']);
  if (b.bundle_version !== 1 || b.app !== DOMAIN) throw new Error('Unsupported reveal bundle version.');
  if (!(CHAIN_NETWORKS as readonly unknown[]).includes(b.network)) throw new Error('Unknown network.');
  if (typeof b.commitment_tx_hash !== 'string' || !HASH.test(b.commitment_tx_hash)) throw new Error('Invalid commitment transaction hash.');
  validate_manifest(b.manifest);
  if (typeof b.salt_hex !== 'string') throw new Error('Invalid salt.');
  unhex(b.salt_hex, 32);
  if (!Array.isArray(b.results) || !Array.isArray(b.files)) throw new Error('Expected results and files lists.');
  const results = b.results.map(item => {
    const r = object(item, ['experiment_id', 'completed_runs', 'metrics']);
    nonempty(r.experiment_id);
    if (!Number.isSafeInteger(r.completed_runs) || Number(r.completed_runs) < 0) throw new Error('completed_runs must be a non-negative safe integer.');
    object(r.metrics, Object.keys(r.metrics ?? {}));
    return String(r.experiment_id);
  });
  const files = b.files.map(item => {
    const f = object(item, ['path', 'sha256', 'url']);
    nonempty(f.path); validate_public_url(f.url, b.network === 'devnet');
    if (typeof f.sha256 !== 'string' || !HASH.test(f.sha256)) throw new Error('File sha256 must be 64 lowercase hex characters.');
    return String(f.path);
  });
  unique(results); unique(files);
  if (b.self_reported_period !== undefined) {
    const p = object(b.self_reported_period, [], ['started_at', 'finished_at']);
    for (const value of Object.values(p)) if (typeof value !== 'string' || !TIME.test(value) || !Number.isFinite(Date.parse(value))) throw new Error('Self-reported times must be UTC YYYY-MM-DDTHH:mm:ssZ.');
  }
  if (b.commitment_tx_cbor !== undefined && (typeof b.commitment_tx_cbor !== 'string' || !/^([0-9a-f]{2}){1,16384}$/.test(b.commitment_tx_cbor))) {
    throw new Error('commitment_tx_cbor must be lowercase hex transaction bytes.');
  }
  canonicalize(b);
  return structuredClone(b) as unknown as RevealBundle;
}

export function create_bundle(draft: RevealDraft, results: ExperimentResult[], files: DisclosedFile[], period?: RevealBundle['self_reported_period']): RevealBundle {
  if (draft.tx_cbor !== undefined) verify_transaction(draft.tx_cbor, draft.tx_hash);  // carried bytes must be this commitment
  return validate_bundle({
    bundle_version: 1, app: DOMAIN, network: draft.network, commitment_tx_hash: draft.tx_hash,
    manifest: draft.manifest, salt_hex: draft.salt_hex, results, files, ...(period ? { self_reported_period: period } : {}),
    ...(draft.tx_cbor ? { commitment_tx_cbor: draft.tx_cbor } : {}),
  });
}
/** The hosted file must be exactly these bytes for the announced hash to match. */
export function bundle_bytes(bundle: RevealBundle): Uint8Array { return new TextEncoder().encode(canonicalize(bundle)); }
