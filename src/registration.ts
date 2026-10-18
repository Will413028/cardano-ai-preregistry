import { payload_kind, validate_public_payload, type PublicPayload } from './chain.ts';
import { FORMAT_VERSION } from './commitment.ts';
import { canonicalize, type Json } from './manifest.ts';
import { METADATA_LABEL } from './transaction.ts';

export { METADATA_LABEL };
export const MAX_FEE = 300000n;
export interface TransactionInspection {
  fee: bigint;
  body_hash: string;
  metadata: unknown;
  signer_hashes: string[];
  /** The registrant `verify_transaction` proves for these exact bytes, or null (always null before signing). */
  verified_registrant: string | null;
  network_id: number;
}
export interface RegistrationWallet {
  getNetworkId(): Promise<number>;
  signTx(tx: string): Promise<string>;
  submitTx(tx: string): Promise<string>;
}
export interface PreparedRegistration {
  unsigned_tx: string;
  payload: PublicPayload;
  registrant: string;
  fee: string;
  tx_hash: string;
}
export type InspectTransaction = (tx: string) => TransactionInspection;

export function public_metadata(payload: PublicPayload): Record<string, PublicPayload> {
  return { [METADATA_LABEL]: validate_public_payload(payload) };
}
export function check_transaction(tx: string, payload: PublicPayload, registrant: string, inspect: InspectTransaction): TransactionInspection {
  if (payload_kind(payload) === null && payload.format_version !== FORMAT_VERSION) throw new Error('New registrations use the current commitment format.');
  const view = inspect(tx);
  if (view.network_id !== 0) throw new Error('Only testnet transactions are allowed.');
  if (view.fee < 0n || view.fee > MAX_FEE) throw new Error('Fee exceeds the 300000 lovelace limit.');
  if (canonicalize(view.metadata as Json) !== canonicalize(public_metadata(payload) as unknown as Json)) throw new Error('Transaction metadata differs from the public payload.');
  if (view.signer_hashes.length !== 1 || view.signer_hashes[0] !== registrant) throw new Error('Transaction must require exactly the registrant payment key.');
  return view;
}

/** The extension receives only the unsigned public transaction, never manifest or salt. */
export async function sign_and_submit(prepared: PreparedRegistration, wallet: RegistrationWallet, inspect: InspectTransaction): Promise<{ tx_hash: string; signed_tx: string }> {
  if (await wallet.getNetworkId() !== 0) throw new Error('Switch your wallet to the selected test network.');
  const original = check_transaction(prepared.unsigned_tx, prepared.payload, prepared.registrant, inspect);
  if (original.body_hash !== prepared.tx_hash || original.fee.toString() !== prepared.fee) throw new Error('Prepared transaction changed.');
  const signed = await wallet.signTx(prepared.unsigned_tx);
  const after = check_transaction(signed, prepared.payload, prepared.registrant, inspect);
  if (after.body_hash !== original.body_hash) throw new Error('Wallet changed the transaction body.');
  // The same verifier readers use: a transaction it would reject is never made permanent.
  if (after.verified_registrant !== prepared.registrant) throw new Error('The signed transaction would not verify as signed by the registrant; use the wallet that holds the registrant key.');
  if (await wallet.getNetworkId() !== 0) throw new Error('Wallet network changed before submission.');
  const submitted = await wallet.submitTx(signed);
  if (submitted !== original.body_hash) throw new Error('Wallet returned an unexpected transaction hash; keep your saved draft and check the prepared hash.');
  return { tx_hash: submitted, signed_tx: signed };
}
