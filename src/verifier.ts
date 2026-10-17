import { type ChainReader } from './chain.ts';
import { CHAIN_NETWORKS, encode_commitment, is_network, sha256, unhex, type ChainNetwork } from './commitment.ts';
import { join_url, validate_bundle, type RevealBundle } from './disclosure.ts';
import { parse_json, validate_manifest, type Manifest } from './manifest.ts';

export const VERIFICATION_BOUNDARY = 'Commitments do not prove actual execution, execution time, truthful results, fair scoring or registration of every experiment. Original files require separate storage.';
export const SELF_REPORTED_BOUNDARY = "Self-reported times, results and files are the registrant's claims; matching hashes show they are unchanged since disclosure, not that they are true.";
/** Private pre-disclosure draft: manifest and salt only. */
export interface RevealDraft {
  format_version: 1;
  network: ChainNetwork;
  tx_hash: string;
  manifest: Manifest;
  salt_hex: string;
}
export interface FileFetcher { fetch(url: string): Promise<Uint8Array | null>; }
export type VerificationStatus = 'match' | 'mismatch' | 'network-mismatch' | 'signer-mismatch' | 'not-found' | 'files-unavailable' | 'invalid';
export interface Verification {
  status: VerificationStatus;
  network: ChainNetwork | null;
  block_time: string | null;
  files: { path: string; status: 'match' | 'mismatch' | 'unavailable' }[];
  boundary: string;
  self_reported: string;
  detail: string;
}
export interface AnnouncementVerification extends Verification {
  announcement_tx_hash: string;
  announced_at: string | null;
  registrant: string | null;
}

function result(status: VerificationStatus, detail: string, network: ChainNetwork | null = null, block_time: string | null = null, files: Verification['files'] = []): Verification {
  return { status, detail, network, block_time, files, boundary: VERIFICATION_BOUNDARY, self_reported: SELF_REPORTED_BOUNDARY };
}
const message = (error: unknown) => error instanceof Error ? error.message : 'Invalid reveal.';

/** Checks manifest, salt and public deadline against the referenced commitment only. */
export async function verify_commitment(input: unknown, reader: ChainReader): Promise<Verification> {
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Expected a reveal draft.');
    const reveal = input as RevealDraft;
    if (Object.keys(reveal).sort().join(',') !== ['format_version', 'network', 'tx_hash', 'manifest', 'salt_hex'].sort().join(',')) throw new Error('Unexpected or missing reveal fields.');
    if (reveal.format_version !== 1) throw new Error('Unsupported commitment format version.');
    if (!(CHAIN_NETWORKS as readonly unknown[]).includes(reveal.network)) throw new Error('Unsupported network.');
    if (typeof reveal.tx_hash !== 'string' || !/^[0-9a-f]{64}$/.test(reveal.tx_hash)) throw new Error('Invalid transaction hash.');
    const manifest = validate_manifest(reveal.manifest);
    const salt = unhex(reveal.salt_hex, 32);
    const record = await reader.get_commitment(reveal.tx_hash, reveal.network);
    if (!record) return result('not-found', 'Commitment was not found on the claimed network.', reveal.network);
    if (record.network !== reveal.network) return result('network-mismatch', `The commitment is on ${record.network}, not ${reveal.network}.`, record.network, record.block_time);
    if (record.tx_hash !== reveal.tx_hash || record.app !== 'cardano-ai-preregistry' || record.format_version !== 1 || !is_network(record.network)) {
      return result('invalid', 'Reader returned an incompatible commitment record.', reveal.network);
    }
    const hash = await encode_commitment(manifest, salt, record.network);
    const matches = hash === record.commitment_hash && manifest.reveal_deadline === record.reveal_deadline;
    return result(matches ? 'match' : 'mismatch', matches ? 'Manifest and deadline match the commitment.' : 'Manifest, salt or public deadline differs from the commitment.', reveal.network, record.block_time);
  } catch (error) {
    return result('invalid', message(error));
  }
}

async function fetch_bytes(files: FileFetcher, url: string): Promise<Uint8Array | null> {
  try { return await files.fetch(url); } catch { return null; }
}

/** Uses only the bundle, a ChainReader and the bundle's own file URLs (I4). */
export async function verify_reveal(input: unknown, reader: ChainReader, files: FileFetcher): Promise<Verification> {
  let bundle: RevealBundle;
  try { bundle = validate_bundle(input); } catch (error) { return result('invalid', message(error)); }
  const commitment = await verify_commitment({ format_version: 1, network: bundle.network, tx_hash: bundle.commitment_tx_hash, manifest: bundle.manifest, salt_hex: bundle.salt_hex }, reader);
  if (commitment.status !== 'match') return commitment;
  const checked: Verification['files'] = [];
  for (const file of bundle.files) {
    const bytes = await fetch_bytes(files, file.url);
    checked.push({ path: file.path, status: bytes === null ? 'unavailable' : await sha256(bytes) === file.sha256 ? 'match' : 'mismatch' });
  }
  const at = (status: VerificationStatus, detail: string) => result(status, detail, commitment.network, commitment.block_time, checked);
  if (checked.some(f => f.status === 'mismatch')) return at('mismatch', 'The commitment matches, but a disclosed file differs from its recorded hash.');
  if (checked.some(f => f.status === 'unavailable')) return at('files-unavailable', 'The commitment matches, but a disclosed file could not be retrieved now.');
  return at('match', 'Manifest, deadline and every disclosed file match. Inline results are fixed only by a disclosure announcement.');
}

/** Checks the on-chain announcement, its signer and the hosted bundle, then the reveal itself. */
export async function verify_announcement(tx_hash: string, network: ChainNetwork, reader: ChainReader, files: FileFetcher): Promise<AnnouncementVerification> {
  let announced_at: string | null = null, registrant: string | null = null;
  const done = (verification: Verification): AnnouncementVerification => ({ ...verification, announcement_tx_hash: tx_hash, announced_at, registrant });
  try {
    if (!/^[0-9a-f]{64}$/.test(tx_hash)) throw new Error('Invalid announcement transaction hash.');
    const announcement = await reader.get_announcement(tx_hash, network);
    if (!announcement) return done(result('not-found', 'Announcement was not found on the claimed network.', network));
    announced_at = announcement.block_time; registrant = announcement.registrant;
    if (announcement.network !== network) return done(result('network-mismatch', `The announcement is on ${announcement.network}, not ${network}.`, announcement.network));
    const commitment = await reader.get_commitment(announcement.commitment_tx_hash, network);
    if (!commitment) return done(result('not-found', 'The announced commitment was not found.', network));
    if (commitment.registrant !== announcement.registrant) return done(result('signer-mismatch', 'The announcement was not signed by the original registrant.', network, commitment.block_time));
    const bytes = await fetch_bytes(files, join_url(announcement.bundle_url));
    if (bytes === null) return done(result('files-unavailable', 'The announced bundle could not be retrieved now.', network, commitment.block_time));
    if (await sha256(bytes) !== announcement.bundle_sha256) return done(result('mismatch', 'The hosted bundle differs from the announced hash.', network, commitment.block_time));
    const bundle = validate_bundle(parse_json(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
    if (bundle.network !== network) return done(result('network-mismatch', 'The bundle names a different network than its announcement.', network, commitment.block_time));
    if (bundle.commitment_tx_hash !== announcement.commitment_tx_hash) return done(result('mismatch', 'The bundle references a different commitment than its announcement.', network, commitment.block_time));
    const reveal = await verify_reveal(bundle, reader, files);
    return done(reveal.status === 'match' ? { ...reveal, detail: 'Announcement signer, bundle hash, manifest, deadline and every disclosed file match.' } : reveal);
  } catch (error) {
    return done(result('invalid', message(error)));
  }
}
