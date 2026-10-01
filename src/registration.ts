import { validate_payload, type CommitmentPayload } from './chain.ts';
import { canonicalize, type Json } from './manifest.ts';

export const METADATA_LABEL = 86741;
export const MAX_FEE = 300000n;
export interface TransactionInspection {
  fee: bigint;
  body_hash: string;
  metadata: unknown;
  signer_hashes: string[];
  network_id: number;
}
export interface RegistrationWallet {
  getNetworkId(): Promise<number>;
  signTx(tx: string): Promise<string>;
  submitTx(tx: string): Promise<string>;
}
export interface PreparedRegistration {
  unsigned_tx: string;
  payload: CommitmentPayload;
  registrant: string;
  fee: string;
  tx_hash: string;
}
export type InspectTransaction = (tx: string) => TransactionInspection;

export function public_metadata(payload: CommitmentPayload): Record<string, CommitmentPayload> {
  return { [METADATA_LABEL]: validate_payload(payload) };
}
export function check_transaction(tx: string, payload: CommitmentPayload, registrant: string, inspect: InspectTransaction): TransactionInspection {
  const view = inspect(tx);
  if (view.network_id !== 0) throw new Error('Only testnet transactions are allowed.');
  if (view.fee < 0n || view.fee > MAX_FEE) throw new Error('Fee exceeds the 300000 lovelace limit.');
  if (canonicalize(view.metadata as Json) !== canonicalize(public_metadata(payload) as unknown as Json)) throw new Error('Transaction metadata differs from the public commitment.');
  if (!view.signer_hashes.includes(registrant)) throw new Error('Transaction must require the registrant payment key.');
  return view;
}

/** The extension receives only the unsigned public transaction, never manifest or salt. */
export async function sign_and_submit(prepared: PreparedRegistration, wallet: RegistrationWallet, inspect: InspectTransaction): Promise<string> {
  if (await wallet.getNetworkId() !== 0) throw new Error('Switch your wallet to the selected test network.');
  const original = check_transaction(prepared.unsigned_tx, prepared.payload, prepared.registrant, inspect);
  if (original.body_hash !== prepared.tx_hash || original.fee.toString() !== prepared.fee) throw new Error('Prepared transaction changed.');
  const signed = await wallet.signTx(prepared.unsigned_tx);
  const after = check_transaction(signed, prepared.payload, prepared.registrant, inspect);
  if (after.body_hash !== original.body_hash) throw new Error('Wallet changed the transaction body.');
  if (await wallet.getNetworkId() !== 0) throw new Error('Wallet network changed before submission.');
  const submitted = await wallet.submitTx(signed);
  if (submitted !== original.body_hash) throw new Error('Wallet returned an unexpected transaction hash; keep your saved draft and check the prepared hash.');
  return submitted;
}
