import { type ChainReader } from './chain.ts';
import { encode_commitment, type Network, unhex } from './commitment.ts';
import { validate_manifest, type Manifest } from './manifest.ts';

export const VERIFICATION_BOUNDARY = 'Commitments do not prove actual execution, execution time, truthful results, fair scoring or registration of every experiment. Original files require separate storage.';
export interface RevealDraft {
  format_version: 1;
  network: Network;
  tx_hash: string;
  manifest: Manifest;
  salt_hex: string;
}
export interface Verification {
  status: 'match' | 'mismatch' | 'not-found' | 'invalid';
  network: Network | null;
  block_time: string | null;
  boundary: string;
  detail: string;
}

export async function verify_reveal(input: unknown, reader: ChainReader): Promise<Verification> {
  const result = (status: Verification['status'], detail: string, network: Network | null = null, block_time: string | null = null): Verification =>
    ({ status, detail, network, block_time, boundary: VERIFICATION_BOUNDARY });
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Expected a reveal draft.');
    const reveal = input as RevealDraft;
    if (Object.keys(reveal).sort().join(',') !== ['format_version', 'network', 'tx_hash', 'manifest', 'salt_hex'].sort().join(',')) throw new Error('Unexpected or missing reveal fields.');
    if (reveal.format_version !== 1) throw new Error('Unsupported commitment format version.');
    if (!['preprod', 'devnet'].includes(reveal.network)) throw new Error('Unsupported network.');
    if (typeof reveal.tx_hash !== 'string' || !/^[0-9a-f]{64}$/.test(reveal.tx_hash)) throw new Error('Invalid transaction hash.');
    const manifest = validate_manifest(reveal.manifest);
    const salt = unhex(reveal.salt_hex, 32);
    const record = await reader.get_commitment(reveal.tx_hash, reveal.network);
    if (!record) return result('not-found', 'Commitment was not found on the selected network.', reveal.network);
    if (record.network !== reveal.network || record.tx_hash !== reveal.tx_hash || record.app !== 'cardano-ai-preregistry' || record.format_version !== 1) {
      return result('invalid', 'Reader returned an incompatible commitment record.', reveal.network);
    }
    const hash = await encode_commitment(manifest, salt, reveal.network);
    const matches = hash === record.commitment_hash && manifest.reveal_deadline === record.reveal_deadline;
    return result(matches ? 'match' : 'mismatch', matches ? 'Manifest and deadline match the commitment.' : 'Manifest, salt or public deadline differs from the commitment.', reveal.network, record.block_time);
  } catch (error) {
    return result('invalid', error instanceof Error ? error.message : 'Invalid reveal.');
  }
}
