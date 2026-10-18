import { is_announcement, validate_announcement, validate_payload, type ChainReader, type Trust } from './chain.ts';
import { CHAIN_NETWORKS, encode_commitment, encode_commitment_v1, FORMAT_VERSIONS, sha256, unhex, type ChainNetwork, type FormatVersion } from './commitment.ts';
import { join_url, validate_bundle, type RevealBundle } from './disclosure.ts';
import { parse_json, validate_manifest, type Json, type Manifest } from './manifest.ts';
import { slot_time } from './mithril.ts';
import { TransactionError, verify_transaction } from './transaction.ts';

export const VERIFICATION_BOUNDARY = 'Commitments do not prove actual execution, execution time, truthful results, fair scoring or registration of every experiment. Original files require separate storage.';
export const SELF_REPORTED_BOUNDARY = "Self-reported times, results and files are the registrant's claims; matching hashes show they are unchanged since disclosure, not that they are true.";
/** What the inclusion and block time rest on; added to, never replacing, the verification boundary (I6). */
export const TRUST_BOUNDARY: Record<Trust, string> = {
  'mithril': 'Inclusion and block time are proven by a Mithril certificate chain checked against the compiled-in genesis key, assuming that key and an honest majority of signing stake. Mithril does not distinguish preprod from preview.',
  'local-node': 'Local devnet: inclusion and time come from your own node and indexer (local trust), not from a public certificate.',
  'local-demo': 'Local demo: simulated transactions signed by a public demo key; not chain evidence.',
};
export const UNBOUND_REGISTRANT = 'Format v1 does not bind the registrant into the commitment, so a copy by another key would also match.';
/** Private pre-disclosure draft: manifest and salt only. */
export interface RevealDraft {
  format_version: FormatVersion;
  network: ChainNetwork;
  tx_hash: string;
  manifest: Manifest;
  salt_hex: string;
}
/** Returns bytes for a disclosed file; `sha256` lets a source serve bytes the caller already has (uploads). */
export interface FileFetcher { fetch(url: string, sha256: string): Promise<Uint8Array | null>; }
/** `unavailable`: a data source failed or returned bytes or proofs that do not verify; another source may succeed (I4). */
export type VerificationStatus = 'match' | 'mismatch' | 'network-mismatch' | 'signer-mismatch' | 'not-found' | 'pending' | 'unavailable' | 'files-unavailable' | 'invalid';
export interface Verification {
  status: VerificationStatus;
  network: ChainNetwork | null;
  block_time: string | null;
  slot: number | null;
  trust: Trust | null;
  /** Payment key hash proven by the commitment transaction's witness. */
  registrant: string | null;
  /** Whether the commitment hash itself includes the registrant (format v2). */
  registrant_bound: boolean | null;
  files: { path: string; status: 'match' | 'mismatch' | 'unavailable' }[];
  boundary: string;
  trust_boundary: string | null;
  self_reported: string;
  detail: string;
}
export interface AnnouncementVerification extends Verification {
  announcement_tx_hash: string;
  announced_at: string | null;
  /** Payment key hash proven by the announcement transaction's witness. */
  announcement_signer: string | null;
}

interface ChainRecord { tx_hash: string; registrant: string; metadata: Json | null; time: string | null; slot: number | null; trust: Trust; }
type Context = Pick<Verification, 'network' | 'block_time' | 'slot' | 'trust' | 'registrant' | 'registrant_bound'>;
const EMPTY: Context = { network: null, block_time: null, slot: null, trust: null, registrant: null, registrant_bound: null };
function result(status: VerificationStatus, detail: string, context: Partial<Context> = {}, files: Verification['files'] = []): Verification {
  const full = { ...EMPTY, ...context };
  return { status, detail, ...full, files, boundary: VERIFICATION_BOUNDARY, trust_boundary: full.trust ? TRUST_BOUNDARY[full.trust] : null, self_reported: SELF_REPORTED_BOUNDARY };
}
const message = (error: unknown) => error instanceof Error ? error.message : 'Invalid reveal.';
/** A transport or trust-root failure, as opposed to a claim that does not hold. */
class SourceError extends Error {}
const UNAVAILABLE = 'The data source failed or returned bytes or proofs that do not verify; retry or use another source.';
function failure(error: unknown): Verification {
  return error instanceof SourceError ? result('unavailable', `${UNAVAILABLE} (${error.message})`) : result('invalid', message(error));
}
const record_context = (network: ChainNetwork, r: ChainRecord): Partial<Context> => ({ network, block_time: r.time, slot: r.slot, trust: r.trust });

/** Reads raw bytes from an untrusted source, verifies them and obtains inclusion from the reader's trust root (I4). */
async function read_record(reader: ChainReader, tx_hash: string, network: ChainNetwork): Promise<ChainRecord | 'not-found' | 'pending'> {
  const raw = await reader.get_transaction(tx_hash, network).catch(error => { throw new SourceError(message(error)); });
  if (!raw) return 'not-found';
  let tx;
  try { tx = verify_transaction(raw.cbor, tx_hash); }
  catch (error) { throw error instanceof TransactionError && error.kind === 'source' ? new SourceError(error.message) : error; }
  const inclusion = await reader.get_inclusion(tx_hash, network).catch(error => { throw new SourceError(message(error)); });
  if (inclusion.status === 'pending' && inclusion.trust === 'mithril') return 'pending';
  if (inclusion.status === 'certified' && inclusion.trust === 'mithril') {
    if (network === 'devnet') throw new Error('devnet has no Mithril certificate.');
    // Time is derived from the certified slot, never from a transport.
    return { ...tx, time: slot_time(network, inclusion.slot), slot: inclusion.slot, trust: 'mithril' };
  }
  if (inclusion.status === 'local' && (inclusion.trust === 'local-demo' || (inclusion.trust === 'local-node' && network === 'devnet'))) {
    return { ...tx, time: inclusion.time, slot: null, trust: inclusion.trust };
  }
  throw new Error(inclusion.status === 'local' && inclusion.trust === 'local-node' ? 'Local node trust applies only to devnet.' : 'Unrecognised inclusion evidence.');
}
const PENDING = 'The transaction was found but is not Mithril-certified yet; check again in a few minutes.';

/** Checks manifest, salt and public deadline against an already verified commitment record. */
async function check_record(record: ChainRecord, network: ChainNetwork, manifest: Manifest, salt: Uint8Array, version?: FormatVersion): Promise<Verification> {
  if (record.metadata === null || is_announcement(record.metadata)) return result('not-found', 'The transaction carries no commitment.', { network });
  const payload = validate_payload(record.metadata as never);
  const context = record_context(network, record);
  if (payload.network !== network) return result('network-mismatch', `The commitment is on ${payload.network}, not ${network}.`, { ...context, network: payload.network });
  if (version !== undefined && version !== payload.format_version) return result('invalid', 'The draft format version differs from the commitment.', context);
  const bound = payload.format_version === 2;
  const hash = bound ? await encode_commitment(manifest, salt, payload.network, record.registrant) : await encode_commitment_v1(manifest, salt, payload.network);
  const matches = hash === payload.commitment_hash && manifest.reveal_deadline === payload.reveal_deadline;
  const detail = matches ? 'Manifest, registrant and deadline match the commitment.' : 'Manifest, salt, registrant or public deadline differs from the commitment.';
  return result(matches ? 'match' : 'mismatch', bound ? detail : `${detail} ${UNBOUND_REGISTRANT}`, { ...context, registrant: record.registrant, registrant_bound: bound });
}
async function read_commitment(reader: ChainReader, tx_hash: string, network: ChainNetwork): Promise<ChainRecord | Verification> {
  const record = await read_record(reader, tx_hash, network);
  if (record === 'not-found') return result('not-found', 'Commitment was not found on the claimed network.', { network });
  if (record === 'pending') return result('pending', PENDING, { network, trust: 'mithril' });
  return record;
}
const is_record = (value: ChainRecord | Verification): value is ChainRecord => 'metadata' in value;

/** Checks manifest, salt and public deadline against the referenced commitment only. */
export async function verify_commitment(input: unknown, reader: ChainReader): Promise<Verification> {
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Expected a reveal draft.');
    const reveal = input as RevealDraft;
    if (Object.keys(reveal).sort().join(',') !== ['format_version', 'network', 'tx_hash', 'manifest', 'salt_hex'].sort().join(',')) throw new Error('Unexpected or missing reveal fields.');
    if (!(FORMAT_VERSIONS as readonly unknown[]).includes(reveal.format_version)) throw new Error('Unsupported commitment format version.');
    if (!(CHAIN_NETWORKS as readonly unknown[]).includes(reveal.network)) throw new Error('Unsupported network.');
    if (typeof reveal.tx_hash !== 'string' || !/^[0-9a-f]{64}$/.test(reveal.tx_hash)) throw new Error('Invalid transaction hash.');
    const manifest = validate_manifest(reveal.manifest);
    const salt = unhex(reveal.salt_hex, 32);
    const record = await read_commitment(reader, reveal.tx_hash, reveal.network);
    return is_record(record) ? await check_record(record, reveal.network, manifest, salt, reveal.format_version) : record;
  } catch (error) {
    return failure(error);
  }
}

async function fetch_bytes(files: FileFetcher, url: string, sha256: string): Promise<Uint8Array | null> {
  try { return await files.fetch(url, sha256); } catch { return null; }
}
async function reveal_against(bundle: RevealBundle, record: ChainRecord, files: FileFetcher): Promise<Verification> {
  const commitment = await check_record(record, bundle.network, bundle.manifest, unhex(bundle.salt_hex, 32));
  if (commitment.status !== 'match') return commitment;
  const checked: Verification['files'] = [];
  for (const file of bundle.files) {
    const bytes = await fetch_bytes(files, file.url, file.sha256);
    checked.push({ path: file.path, status: bytes === null ? 'unavailable' : await sha256(bytes) === file.sha256 ? 'match' : 'mismatch' });
  }
  const at = (status: VerificationStatus, detail: string) => ({ ...commitment, status, detail: commitment.registrant_bound ? detail : `${detail} ${UNBOUND_REGISTRANT}`, files: checked });
  if (checked.some(f => f.status === 'mismatch')) return at('mismatch', 'The commitment matches, but a disclosed file differs from its recorded hash.');
  if (checked.some(f => f.status === 'unavailable')) return at('files-unavailable', 'The commitment matches, but a disclosed file could not be retrieved now.');
  return at('match', 'Manifest, registrant, deadline and every disclosed file match. Inline results are fixed only by a disclosure announcement.');
}

/** Uses only the bundle, a ChainReader and file bytes from any source, checked by hash (I4). */
export async function verify_reveal(input: unknown, reader: ChainReader, files: FileFetcher): Promise<Verification> {
  try {
    const bundle = validate_bundle(input);
    const record = await read_commitment(reader, bundle.commitment_tx_hash, bundle.network);
    return is_record(record) ? await reveal_against(bundle, record, files) : record;
  } catch (error) { return failure(error); }
}

/**
 * Checks the on-chain announcement, that its witnessed signer is the commitment's registrant, and the bundle bytes
 * (supplied by the caller, or fetched from the announced URL), then the reveal itself.
 */
export async function verify_announcement(tx_hash: string, network: ChainNetwork, reader: ChainReader, files: FileFetcher, bundle_bytes?: Uint8Array): Promise<AnnouncementVerification> {
  let announced_at: string | null = null, announcement_signer: string | null = null;
  const done = (verification: Verification): AnnouncementVerification => ({ ...verification, announcement_tx_hash: tx_hash, announced_at, announcement_signer });
  try {
    if (!/^[0-9a-f]{64}$/.test(tx_hash)) throw new Error('Invalid announcement transaction hash.');
    const record = await read_record(reader, tx_hash, network);
    if (record === 'not-found') return done(result('not-found', 'Announcement was not found on the claimed network.', { network }));
    if (record === 'pending') return done(result('pending', PENDING, { network, trust: 'mithril' }));
    if (!record.metadata || !is_announcement(record.metadata)) return done(result('not-found', 'The transaction carries no disclosure announcement.', { network }));
    const announcement = validate_announcement(record.metadata as never);
    announced_at = record.time; announcement_signer = record.registrant;
    if (announcement.network !== network) return done(result('network-mismatch', `The announcement is on ${announcement.network}, not ${network}.`, { network: announcement.network }));
    const commitment = await read_commitment(reader, announcement.commitment_tx_hash, network);
    if (!is_record(commitment)) return done(commitment.status === 'not-found' ? { ...commitment, detail: 'The announced commitment was not found.' } : commitment);
    const context = { ...record_context(network, commitment), registrant: commitment.registrant };
    if (commitment.registrant !== record.registrant) return done(result('signer-mismatch', 'The announcement was not signed by the original registrant.', context));
    const bytes = bundle_bytes ?? await fetch_bytes(files, join_url(announcement.bundle_url, network === 'devnet'), announcement.bundle_sha256);
    if (bytes === null) return done(result('files-unavailable', 'The announced bundle could not be retrieved now; you can supply the bundle file instead.', context));
    if (await sha256(bytes) !== announcement.bundle_sha256) return done(result('mismatch', 'The bundle differs from the announced hash.', context));
    const bundle = validate_bundle(parse_json(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
    if (bundle.network !== network) return done(result('network-mismatch', 'The bundle names a different network than its announcement.', context));
    if (bundle.commitment_tx_hash !== announcement.commitment_tx_hash) return done(result('mismatch', 'The bundle references a different commitment than its announcement.', context));
    const reveal = await reveal_against(bundle, commitment, files);
    if (reveal.status !== 'match') return done(reveal);
    const detail = 'Announcement signer, bundle hash, manifest, registrant, deadline and every disclosed file match.';
    return done({ ...reveal, detail: reveal.registrant_bound ? detail : `${detail} ${UNBOUND_REGISTRANT}` });
  } catch (error) {
    return done(failure(error));
  }
}

/** Serves uploaded bytes by their hash first; anything else comes from `fallback` (normally the file's own URL). */
export function with_uploads(uploads: Uint8Array[], fallback: FileFetcher): FileFetcher {
  const by_hash = Promise.all(uploads.map(async bytes => [await sha256(bytes), bytes] as const)).then(entries => new Map(entries));
  return { async fetch(url, sha256) { return (await by_hash).get(sha256) ?? fallback.fetch(url, sha256); } };
}
