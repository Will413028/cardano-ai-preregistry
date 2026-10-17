import { is_network, type ChainNetwork, type Network } from './commitment.ts';
import { join_url } from './disclosure.ts';

export interface CommitmentPayload {
  app: 'cardano-ai-preregistry';
  format_version: 1;
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
interface ChainContext {
  tx_hash: string;
  block_time: string;
  registrant: string;
  source: 'fake' | 'devnet' | 'preprod';
}
export interface CommitmentRecord extends CommitmentPayload, ChainContext {}
export interface AnnouncementRecord extends AnnouncementPayload, ChainContext {}
export interface ChainWriter { commit(payload: CommitmentPayload): Promise<CommitmentRecord>; }
export interface ChainReader {
  get_commitment(tx_hash: string, network: ChainNetwork): Promise<CommitmentRecord | null>;
  get_announcement(tx_hash: string, network: ChainNetwork): Promise<AnnouncementRecord | null>;
}

const HASH = /^[0-9a-f]{64}$/;
const exact_keys = (input: object, keys: string[]) => Object.keys(input).sort().join(',') === [...keys].sort().join(',');
const text_bytes = (value: string) => new TextEncoder().encode(value).length;

export function validate_payload(input: CommitmentPayload): CommitmentPayload {
  if (!input || typeof input !== 'object' || !exact_keys(input, ['app', 'format_version', 'network', 'commitment_hash', 'reveal_deadline']) || input.app !== 'cardano-ai-preregistry' ||
    input.format_version !== 1 || !is_network(input.network) ||
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
  try { join_url(input.bundle_url); } catch { throw new Error('Invalid public announcement payload.'); }
  return structuredClone(input);
}
export function is_announcement(input: unknown): boolean {
  return Boolean(input) && typeof input === 'object' && Object.hasOwn(input as object, 'kind');
}
export function validate_public_payload(input: PublicPayload): PublicPayload {
  return is_announcement(input) ? validate_announcement(input as AnnouncementPayload) : validate_payload(input as CommitmentPayload);
}

export class FakeChain implements ChainWriter, ChainReader {
  private readonly records = new Map<string, CommitmentRecord>();
  private readonly announcements = new Map<string, AnnouncementRecord>();
  private context(): ChainContext {
    const tx_hash = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
    return { tx_hash, block_time: new Date().toISOString(), registrant: 'local-demo-wallet', source: 'fake' };
  }
  async commit(payload: CommitmentPayload): Promise<CommitmentRecord> {
    const record: CommitmentRecord = { ...validate_payload(payload), ...this.context() };
    this.records.set(record.tx_hash, record); return structuredClone(record);
  }
  async announce(payload: AnnouncementPayload): Promise<AnnouncementRecord> {
    const record: AnnouncementRecord = { ...validate_announcement(payload), ...this.context() };
    this.announcements.set(record.tx_hash, record); return structuredClone(record);
  }
  async get_commitment(tx_hash: string, network: ChainNetwork): Promise<CommitmentRecord | null> {
    const record = this.records.get(tx_hash);
    return record?.network === network ? structuredClone(record) : null;
  }
  async get_announcement(tx_hash: string, network: ChainNetwork): Promise<AnnouncementRecord | null> {
    const record = this.announcements.get(tx_hash);
    return record?.network === network ? structuredClone(record) : null;
  }
}
