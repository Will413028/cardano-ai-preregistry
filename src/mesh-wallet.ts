import './polyfills.ts';
import { BrowserWallet } from '@meshsdk/wallet';
import { MeshTxBuilder } from '@meshsdk/transaction';
import * as core from '@meshsdk/core-cst';
import { type Protocol, type UTxO } from '@meshsdk/common';
import { type AnnouncementPayload, type PublicPayload } from './chain.ts';
import { check_transaction, METADATA_LABEL, type PreparedRegistration, type TransactionInspection } from './registration.ts';
import { verify_transaction } from './transaction.ts';

function verified_registrant(cbor: string, tx_hash: string): string | null {
  try { return verify_transaction(cbor, tx_hash).registrant; } catch { return null; }
}
import { type Network } from './commitment.ts';
import { DEVNET_API } from './readers.ts';
import type { KoiosProvider, YaciProvider } from '@meshsdk/core';

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
function key_hash(address: string): string | null {
  try {
    const decoded = core.Address.fromBech32(address);
    return decoded.getProps().paymentPart?.type === core.CredentialType.KeyHash ? core.resolvePaymentKeyHash(address) : null;
  } catch { return null; }
}
export function inspect_transaction(cbor: string): TransactionInspection {
  const tx = core.deserializeTx(cbor), body = tx.body(), aux = tx.auxiliaryData();
  if (!aux || core.computeAuxiliaryDataHash(aux.toCore()) !== body.auxiliaryDataHash()) throw new Error('Missing or changed auxiliary data.');
  const outputs = body.outputs();
  if (!outputs.length || outputs.some(o => o.address().getNetworkId() !== 0)) throw new Error('Only testnet outputs are allowed.');
  return {
    fee: body.fee(), body_hash: body.hash(), metadata: json_metadata(aux.metadata()?.toCore()),
    signer_hashes: body.requiredSigners()?.values().map(s => s.toCore()) ?? [],
    verified_registrant: verified_registrant(cbor, body.hash()),
    network_id: body.networkId() ?? 0,
  };
}
/** The registrant is the wallet's change-address payment key; it is fixed before the commitment hash is computed (D14). */
export async function wallet_registrant(wallet: BuildWallet): Promise<string> {
  if (await wallet.getNetworkId() !== 0) throw new Error('Mainnet wallets are not supported.');
  const registrant = key_hash(await wallet.getChangeAddress());
  if (!registrant || core.Address.fromBech32(await wallet.getChangeAddress()).getNetworkId() !== 0) throw new Error('Only a testnet payment key address is supported.');
  return registrant;
}
/** An announcement must be signed by the commitment's registrant; fee inputs may come from any wallet key. */
export async function prepare_announcement(payload: AnnouncementPayload, registrant: string, wallet: BuildWallet, data: PublicChainData): Promise<PreparedRegistration> {
  if (await wallet_registrant(wallet) !== registrant) throw new Error('Use the wallet that registered the commitment; its change address must be the registrant key.');
  return prepare_registration(payload, registrant, wallet, data);
}
export async function prepare_registration(payload: PublicPayload, registrant: string, wallet: BuildWallet, data: PublicChainData): Promise<PreparedRegistration> {
  if (await wallet.getNetworkId() !== 0) throw new Error('Mainnet wallets are not supported.');
  const address = await wallet.getChangeAddress();
  const decoded = core.Address.fromBech32(address);
  if (decoded.getNetworkId() !== 0) throw new Error('Only a testnet payment address is supported.');
  const all = await wallet.getUtxos();
  // One ADA-only input avoids spending unrelated tokens and bounds read requests.
  const candidates = all.filter(u => u.output.amount.length === 1 && u.output.amount[0]?.unit === 'lovelace' &&
    BigInt(u.output.amount[0].quantity) >= 3000000n && key_hash(u.output.address) !== null).sort((a, b) => Number(BigInt(b.output.amount[0]!.quantity) - BigInt(a.output.amount[0]!.quantity)));
  const input = candidates[0];
  if (!input) throw new Error('A funded ADA-only UTxO of at least 3 testADA on a payment key is required.');
  if (core.Address.fromBech32(input.output.address).getNetworkId() !== 0) throw new Error('A testnet payment key input is required.');
  const chain_utxos = await data.utxos(payload.network, input.input.txHash);
  const real = chain_utxos.find(u => u.input.txHash === input.input.txHash && u.input.outputIndex === input.input.outputIndex && u.output.address === input.output.address);
  if (!real || real.output.amount.length !== 1 || real.output.amount[0]?.unit !== 'lovelace' ||
    BigInt(real.output.amount[0].quantity) !== BigInt(input.output.amount[0]!.quantity)) throw new Error('Wallet input was not found on the selected test network.');
  const builder = new MeshTxBuilder({ params: await data.protocol(payload.network), verbose: false });
  const unsigned_tx = await builder.txIn(input.input.txHash, input.input.outputIndex, input.output.amount, input.output.address, 0)
    .metadataValue(METADATA_LABEL, payload).requiredSignerHash(registrant)
    .changeAddress(address).complete();
  const view = check_transaction(unsigned_tx, payload, registrant, inspect_transaction);
  return { unsigned_tx, payload, registrant, fee: view.fee.toString(), tx_hash: view.body_hash };
}
export async function connect_wallet(name: string): Promise<BrowserWallet> { return BrowserWallet.enable(name); }
export function installed_wallets(): { id: string; name: string }[] { return BrowserWallet.getInstalledWallets(); }
/** Write-side reads go straight to the public provider, so a built site needs no development server. */
export function direct_chain_data(): PublicChainData {
  const providers = new Map<Network, Promise<YaciProvider | KoiosProvider>>();
  const provider = (network: Network) => {
    let p = providers.get(network);
    if (!p) {
      p = import('@meshsdk/core').then(({ YaciProvider, KoiosProvider }) => network === 'devnet' ? new YaciProvider(DEVNET_API) : new KoiosProvider('preprod'));
      providers.set(network, p);
    }
    return p;
  };
  return {
    protocol: async network => (await provider(network)).fetchProtocolParameters(),
    utxos: async (network, hash) => (await provider(network)).fetchUTxOs(hash),
  };
}
/** Same reads through the optional development cache; it is a transport, so results are checked the same way. */
export const proxy_chain_data: PublicChainData = {
  protocol: network => proxy_read('protocol', network),
  utxos: (network, hash) => proxy_read('utxos', network, hash),
};
async function proxy_read<T>(kind: string, network: Network, hash?: string): Promise<T> {
  const params = new URLSearchParams({ kind, network });
  if (hash) params.set('tx_hash', hash);
  const response = await fetch(`/api/cardano?${params}`, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error('Chain read unavailable; keep your private draft and retry.');
  return response.json() as Promise<T>;
}
