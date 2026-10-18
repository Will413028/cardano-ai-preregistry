import { FORMAT_VERSION, FORMAT_VERSIONS, is_network, type ChainNetwork, type FormatVersion, type Network } from './commitment.ts';
import { build_demo_transaction, DEMO_KEY, type DemoKey } from './transaction.ts';
import { type Json } from './manifest.ts';
import { join_url } from './disclosure.ts';

export interface CommitmentPayload {
  app: 'cardano-ai-preregistry';
  format_version: FormatVersion;
  network: Network;
  commitment_hash: string;
  reveal_deadline: string;
}
/** Public disclosure announcement; `bundle_url` is the URL split into metadata-sized text chunks. */
export interface AnnouncementPayload {
  app: 'cardano-ai-preregistry';
  format_version: 1;
  kind: 'reveal';
  network: Network;
  commitment_tx_hash: string;
  bundle_sha256: string;
  bundle_url: string[];
}
export type PublicPayload = CommitmentPayload | AnnouncementPayload;
/** Raw bytes from an untrusted transport (indexer, proxy, cache, local file). It carries no time: time is evidence. */
export interface RawTransaction { cbor: string; }
/**
 * Inclusion evidence checked against the reader's trust root: a Mithril-certified slot on public networks (time is
 * derived from the slot), or the local devnet node / local demo, whose answer and time are only locally trusted.
 */
export type Inclusion =
  | { status: 'certified'; trust: 'mithril'; slot: number; block_number: number }
  | { status: 'pending'; trust: 'mithril' }
  | { status: 'local'; trust: 'local-node' | 'local-demo'; time: string };
export type Trust = Inclusion['trust'];
export interface ChainReader {
  get_transaction(tx_hash: string, network: ChainNetwork): Promise<RawTransaction | null>;
  get_inclusion(tx_hash: string, network: ChainNetwork): Promise<Inclusion>;
}

const HASH = /^[0-9a-f]{64}$/;
const exact_keys = (input: object, keys: string[]) => Object.keys(input).sort().join(',') === [...keys].sort().join(',');
const text_bytes = (value: string) => new TextEncoder().encode(value).length;

export function validate_payload(input: CommitmentPayload): CommitmentPayload {
  if (!input || typeof input !== 'object' || !exact_keys(input, ['app', 'format_version', 'network', 'commitment_hash', 'reveal_deadline']) || input.app !== 'cardano-ai-preregistry' ||
    !(FORMAT_VERSIONS as readonly unknown[]).includes(input.format_version) || !is_network(input.network) ||
    !HASH.test(input.commitment_hash) || !Number.isFinite(Date.parse(input.reveal_deadline))) {
    throw new Error('Invalid public commitment payload.');
  }
  return structuredClone(input);
}
export function validate_announcement(input: AnnouncementPayload): AnnouncementPayload {
  if (!input || typeof input !== 'object' || !exact_keys(input, ['app', 'format_version', 'kind', 'network', 'commitment_tx_hash', 'bundle_sha256', 'bundle_url']) ||
    input.app !== 'cardano-ai-preregistry' || input.format_version !== 1 || input.kind !== 'reveal' || !is_network(input.network) ||
    typeof input.commitment_tx_hash !== 'string' || !HASH.test(input.commitment_tx_hash) || typeof input.bundle_sha256 !== 'string' || !HASH.test(input.bundle_sha256) ||
    !Array.isArray(input.bundle_url) || !input.bundle_url.length || input.bundle_url.length > 8 ||
    input.bundle_url.some(chunk => typeof chunk !== 'string' || !chunk || text_bytes(chunk) > 64)) {
    throw new Error('Invalid public announcement payload.');
  }
  // Loopback hosting is only meaningful for a local devnet; public networks require https.
  try { join_url(input.bundle_url, input.network === 'devnet'); } catch { throw new Error('Invalid public announcement payload.'); }
  return structuredClone(input);
}
export function is_announcement(input: unknown): boolean {
  return Boolean(input) && typeof input === 'object' && Object.hasOwn(input as object, 'kind');
}
export function validate_public_payload(input: PublicPayload): PublicPayload {
  return is_announcement(input) ? validate_announcement(input as AnnouncementPayload) : validate_payload(input as CommitmentPayload);
}

/** Local demo chain: real-format transactions signed by public demo keys, verified like any other source. */
export class FakeChain implements ChainReader {
  private readonly txs = new Map<string, { cbor: string; time: string; network: Network }>();
  private submit(payload: PublicPayload, signer: DemoKey): string {
    const { tx_hash, cbor } = build_demo_transaction(payload as unknown as Json, signer, crypto.getRandomValues(new Uint8Array(32)));
    this.txs.set(tx_hash, { cbor, time: new Date().toISOString(), network: payload.network });
    return tx_hash;
  }
  async commit(payload: CommitmentPayload, signer = DEMO_KEY): Promise<string> {
    if (payload.format_version !== FORMAT_VERSION) throw new Error('New registrations use the current commitment format.');
    return this.submit(validate_payload(payload), signer);
  }
  async announce(payload: AnnouncementPayload, signer = DEMO_KEY): Promise<string> { return this.submit(validate_announcement(payload), signer); }
  async get_transaction(tx_hash: string, network: ChainNetwork): Promise<RawTransaction | null> {
    const tx = this.txs.get(tx_hash);
    return tx?.network === network ? { cbor: tx.cbor } : null;
  }
  async get_inclusion(tx_hash: string): Promise<Inclusion> {
    const tx = this.txs.get(tx_hash);
    if (!tx) throw new Error('Unknown local demo transaction.');
    return { status: 'local', trust: 'local-demo', time: tx.time };
  }
}
