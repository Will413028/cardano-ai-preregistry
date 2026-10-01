import './polyfills.ts';
import { BrowserWallet } from '@meshsdk/wallet';
import { MeshTxBuilder } from '@meshsdk/transaction';
import * as core from '@meshsdk/core-cst';
import { type Protocol, type UTxO } from '@meshsdk/common';
import { type CommitmentPayload } from './chain.ts';
import { check_transaction, METADATA_LABEL, type PreparedRegistration, type TransactionInspection } from './registration.ts';
import { type Network } from './commitment.ts';

export interface BuildWallet {
  getNetworkId(): Promise<number>;
  getChangeAddress(): Promise<string>;
  getUtxos(): Promise<UTxO[]>;
}
export interface PublicChainData {
  protocol(network: Network): Promise<Protocol>;
  utxos(network: Network, hash: string): Promise<UTxO[]>;
}
function json_metadata(value: unknown): unknown {
  if (value instanceof Map) return Object.fromEntries([...value].map(([k, v]) => [String(k), json_metadata(v)]));
  if (typeof value === 'bigint') return Number(value);
  if (Array.isArray(value)) return value.map(json_metadata);
  if (value instanceof Uint8Array) throw new Error('Unexpected metadata byte string.');
  return value;
}
export function inspect_transaction(cbor: string): TransactionInspection {
  const tx = core.deserializeTx(cbor), body = tx.body(), aux = tx.auxiliaryData();
  if (!aux || core.computeAuxiliaryDataHash(aux.toCore()) !== body.auxiliaryDataHash()) throw new Error('Missing or changed auxiliary data.');
  const outputs = body.outputs();
  if (!outputs.length || outputs.some(o => o.address().getNetworkId() !== 0)) throw new Error('Only testnet outputs are allowed.');
  return {
    fee: body.fee(), body_hash: body.hash(), metadata: json_metadata(aux.metadata()?.toCore()),
    signer_hashes: body.requiredSigners()?.values().map(s => s.toCore()) ?? [],
    network_id: body.networkId() ?? 0,
  };
}
export async function prepare_registration(payload: CommitmentPayload, wallet: BuildWallet, data: PublicChainData): Promise<PreparedRegistration> {
  if (await wallet.getNetworkId() !== 0) throw new Error('Mainnet wallets are not supported.');
  const address = await wallet.getChangeAddress();
  const decoded = core.Address.fromBech32(address);
  if (decoded.getNetworkId() !== 0) throw new Error('Only a testnet payment address is supported.');
  const all = await wallet.getUtxos();
  // One ADA-only input avoids spending unrelated tokens and bounds read requests.
  const candidates = all.filter(u => u.output.amount.length === 1 && u.output.amount[0]?.unit === 'lovelace' &&
    BigInt(u.output.amount[0].quantity) >= 3000000n).sort((a, b) => Number(BigInt(b.output.amount[0]!.quantity) - BigInt(a.output.amount[0]!.quantity)));
  const input = candidates[0];
  if (!input) throw new Error('A funded ADA-only UTxO of at least 3 testADA is required.');
  const input_address = core.Address.fromBech32(input.output.address);
  if (input_address.getNetworkId() !== 0 || input_address.getProps().paymentPart?.type !== core.CredentialType.KeyHash) throw new Error('A testnet payment key input is required.');
  const registrant = core.resolvePaymentKeyHash(input.output.address);
  const chain_utxos = await data.utxos(payload.network, input.input.txHash);
  const real = chain_utxos.find(u => u.input.outputIndex === input.input.outputIndex && u.output.address === input.output.address);
  if (!real || JSON.stringify(real.output.amount) !== JSON.stringify(input.output.amount)) throw new Error('Wallet input was not found on the selected test network.');
  const builder = new MeshTxBuilder({ params: await data.protocol(payload.network), verbose: false });
  const unsigned_tx = await builder.txIn(input.input.txHash, input.input.outputIndex, input.output.amount, input.output.address, 0)
    .metadataValue(METADATA_LABEL, payload).requiredSignerHash(registrant)
    .changeAddress(address).complete();
  const view = check_transaction(unsigned_tx, payload, registrant, inspect_transaction);
  return { unsigned_tx, payload, registrant, fee: view.fee.toString(), tx_hash: view.body_hash };
}
export async function connect_wallet(name: string): Promise<BrowserWallet> { return BrowserWallet.enable(name); }
export function installed_wallets(): { id: string; name: string }[] { return BrowserWallet.getInstalledWallets(); }
export const browser_chain_data: PublicChainData = {
  protocol: network => public_read('protocol', network),
  utxos: (network, hash) => public_read('utxos', network, hash),
};
export async function public_read<T>(kind: string, network: Network, hash?: string): Promise<T> {
  const params = new URLSearchParams({ kind, network });
  if (hash) params.set('tx_hash', hash);
  const response = await fetch(`/api/cardano?${params}`, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error('Chain read unavailable; keep your private draft and retry.');
  return response.json() as Promise<T>;
}
