import { describe, expect, it } from 'vitest';
import { core, DEFAULT_PROTOCOL_PARAMETERS, type UTxO } from '@meshsdk/core';
import { prepare_announcement, prepare_registration, inspect_transaction, wallet_registrant, PREPROD_PROTOCOL, relay_utxos } from '../../src/mesh-wallet.ts';
import { RelayTransactions } from '../../src/readers.ts';
import { funding_transaction } from './helpers/tx.ts';
import { from_hex } from '../../src/transaction.ts';
import { split_url } from '../../src/disclosure.ts';
import { public_metadata } from '../../src/registration.ts';

const address = core.buildEnterpriseAddress(0, core.Hash28ByteBase16('b'.repeat(56))).toAddress().toBech32();
const input: UTxO = { input: { txHash: 'a'.repeat(64), outputIndex: 0 }, output: { address, amount: [{ unit: 'lovelace', quantity: '10000000' }] } };
const KEY = 'b'.repeat(56);
const payload = { app: 'cardano-ai-preregistry', format_version: 2, network: 'devnet', commitment_hash: 'd'.repeat(64), reveal_deadline: '2026-12-01T00:00:00Z' } as const;
const wallet = { getNetworkId: async () => 0, getChangeAddress: async () => address, getUtxos: async () => [input] };
const data = { protocol: async () => DEFAULT_PROTOCOL_PARAMETERS, utxos: async () => [input] };
it('accepts provider asset annotations while preserving the exact lovelace amount', async () => {
  const indexed = structuredClone(input);
  Object.assign(indexed.output.amount[0]!, { policy_id: '', asset_name: 'lovelace' });
  const prepared = await prepare_registration(payload, KEY, wallet, { ...data, utxos: async () => [indexed] });
  expect(prepared.registrant).toBe('b'.repeat(56));
  expect(inspect_transaction(prepared.unsigned_tx).fee).toBeLessThanOrEqual(300000n);
});
it('rejects a different indexed lovelace amount', async () => {
  const indexed = structuredClone(input); indexed.output.amount[0]!.quantity = '10000001';
  await expect(prepare_registration(payload, KEY, wallet, { ...data, utxos: async () => [indexed] })).rejects.toThrow('selected test network');
});
it('rejects an indexed output from a different transaction', async () => {
  const indexed = structuredClone(input); indexed.input.txHash = 'c'.repeat(64);
  await expect(prepare_registration(payload, KEY, wallet, { ...data, utxos: async () => [indexed] })).rejects.toThrow('selected test network');
});
it('builds real Mesh CBOR with exact metadata, a registrant signer and a capped fee', async () => {
  const prepared = await prepare_registration(payload, KEY, wallet, data);
  const view = inspect_transaction(prepared.unsigned_tx);
  expect(view.metadata).toEqual(public_metadata(payload));
  expect(view.signer_hashes).toEqual(['b'.repeat(56)]);
  expect(view.fee).toBeGreaterThan(0n); expect(view.fee).toBeLessThanOrEqual(300000n);
  expect(view.body_hash).toBe(prepared.tx_hash);
}, 30000);
it('rejects a wallet UTxO from a different testnet before building', async () => {
  await expect(prepare_registration(payload, KEY, wallet, { ...data, utxos: async () => [] })).rejects.toThrow('selected test network');
});
it('takes the registrant from the change address and lets the fee input come from another key', async () => {
  const change = core.buildEnterpriseAddress(0, core.Hash28ByteBase16('c'.repeat(56))).toAddress().toBech32();
  const hd = { ...wallet, getChangeAddress: async () => change };
  const registrant = await wallet_registrant(hd);
  expect(registrant).toBe('c'.repeat(56));
  const prepared = await prepare_registration(payload, registrant, hd, data);
  expect(prepared.registrant).toBe('c'.repeat(56));
  // The input stays on key b; only key c is the required signer.
  expect(inspect_transaction(prepared.unsigned_tx).signer_hashes).toEqual(['c'.repeat(56)]);
}, 30000);
it('rejects excessive estimated fees before asking the wallet to sign', async () => {
  await expect(prepare_registration(payload, KEY, wallet, { ...data, protocol: async () => ({ ...DEFAULT_PROTOCOL_PARAMETERS, minFeeB: 400000 }) })).rejects.toThrow('Fee exceeds');
});
const announcement = { app: 'cardano-ai-preregistry', format_version: 1, kind: 'reveal', network: 'devnet', commitment_tx_hash: 'e'.repeat(64),
  bundle_sha256: 'f'.repeat(64), bundle_url: split_url('https://files.example.test/' + 'bundle-'.repeat(12) + '.json') } as const;
it('builds a real announcement with chunked URL metadata signed by the registrant key', async () => {
  const prepared = await prepare_announcement(announcement, 'b'.repeat(56), wallet, data);
  const view = inspect_transaction(prepared.unsigned_tx);
  expect(announcement.bundle_url.length).toBeGreaterThan(1);
  expect(view.metadata).toEqual(public_metadata(announcement));
  expect(view.signer_hashes).toEqual(['b'.repeat(56)]);
  expect(view.fee).toBeLessThanOrEqual(300000n);
}, 30000);
it('refuses to announce from a wallet whose registrant key is not the original registrant', async () => {
  await expect(prepare_announcement(announcement, 'c'.repeat(56), wallet, data)).rejects.toThrow('registered the commitment');
});
it('rejects a mainnet wallet and a script change address as registrant', async () => {
  await expect(wallet_registrant({ ...wallet, getNetworkId: async () => 1 })).rejects.toThrow('Mainnet');
  const script = core.buildEnterpriseAddress(0, core.Hash28ByteBase16('d'.repeat(56)), core.CredentialType.ScriptHash).toAddress().toBech32();
  await expect(wallet_registrant({ ...wallet, getChangeAddress: async () => script })).rejects.toThrow('payment key');
});
describe('preprod write-side reads without Koios CORS (D17)', () => {
  const owner = core.buildEnterpriseAddress(0, core.Hash28ByteBase16(KEY));
  const funding = funding_transaction(from_hex(String(owner.toAddress().toBytes())), 10000000);
  const relay = (cbor: string | null) => new RelayTransactions(async () => Response.json(cbor ? [{ tx_hash: funding.tx_hash, cbor }] : []));
  it('reads the funding outputs from the relay bytes and checks they hash to the requested transaction', async () => {
    expect(await relay_utxos(funding.tx_hash, relay(funding.cbor))).toEqual([
      { input: { txHash: funding.tx_hash, outputIndex: 0 }, output: { address: owner.toAddress().toBech32(), amount: [{ unit: 'lovelace', quantity: '10000000' }] } }]);
    const other = funding_transaction(from_hex(String(owner.toAddress().toBytes())), 10000000, 2);
    await expect(relay_utxos(funding.tx_hash, relay(other.cbor))).rejects.toThrow('different transaction');
    expect(await relay_utxos(funding.tx_hash, relay(null))).toEqual([]);
  });
  it('a wallet on another testnet is refused: its input is not on the selected network', async () => {
    const wallet_input: UTxO = { input: { txHash: funding.tx_hash, outputIndex: 0 }, output: { address: owner.toAddress().toBech32(), amount: [{ unit: 'lovelace', quantity: '10000000' }] } };
    const on_preprod = { getNetworkId: async () => 0, getChangeAddress: async () => owner.toAddress().toBech32(), getUtxos: async () => [wallet_input] };
    const preprod = { ...payload, network: 'preprod' } as const;
    const found = { protocol: async () => PREPROD_PROTOCOL, utxos: (_: unknown, hash: string) => relay_utxos(hash, relay(funding.cbor)) };
    expect((await prepare_registration(preprod, KEY, on_preprod, found)).registrant).toBe(KEY);
    const missing = { ...found, utxos: (_: unknown, hash: string) => relay_utxos(hash, relay(null)) };
    await expect(prepare_registration(preprod, KEY, on_preprod, missing)).rejects.toThrow('selected test network');
  });
});
