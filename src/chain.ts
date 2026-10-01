import { type Network } from './commitment.ts';

export interface CommitmentPayload {
  app: 'cardano-ai-preregistry';
  format_version: 1;
  network: Network;
  commitment_hash: string;
  reveal_deadline: string;
}
export interface CommitmentRecord extends CommitmentPayload {
  tx_hash: string;
  block_time: string;
  registrant: string;
  source: 'fake' | 'devnet' | 'preprod';
}
export interface ChainWriter { commit(payload: CommitmentPayload): Promise<CommitmentRecord>; }
export interface ChainReader { get_commitment(tx_hash: string, network: Network): Promise<CommitmentRecord | null>; }

export function validate_payload(input: CommitmentPayload): CommitmentPayload {
  const keys = ['app', 'format_version', 'network', 'commitment_hash', 'reveal_deadline'];
  if (Object.keys(input).sort().join(',') !== keys.sort().join(',') || input.app !== 'cardano-ai-preregistry' ||
    input.format_version !== 1 || !['preprod', 'devnet'].includes(input.network) ||
    !/^[0-9a-f]{64}$/.test(input.commitment_hash) || !Number.isFinite(Date.parse(input.reveal_deadline))) {
    throw new Error('Invalid public commitment payload.');
  }
  return structuredClone(input);
}

export class FakeChain implements ChainWriter, ChainReader {
  private readonly records = new Map<string, CommitmentRecord>();
  async commit(payload: CommitmentPayload): Promise<CommitmentRecord> {
    const public_payload = validate_payload(payload);
    const tx_hash = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
    const record: CommitmentRecord = { ...public_payload, tx_hash, block_time: new Date().toISOString(), registrant: 'local-demo-wallet', source: 'fake' };
    this.records.set(tx_hash, record); return structuredClone(record);
  }
  async get_commitment(tx_hash: string, network: Network): Promise<CommitmentRecord | null> {
    const record = this.records.get(tx_hash);
    return record?.network === network ? structuredClone(record) : null;
  }
}
