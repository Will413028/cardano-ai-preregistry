import { expect, it } from 'vitest';
import { core, DEFAULT_PROTOCOL_PARAMETERS, type UTxO } from '@meshsdk/core';
import { prepare_registration, inspect_transaction } from '../../src/mesh-wallet.ts';
import { public_metadata } from '../../src/registration.ts';

const address = core.buildEnterpriseAddress(0, core.Hash28ByteBase16('b'.repeat(56))).toAddress().toBech32();
const input: UTxO = { input: { txHash: 'a'.repeat(64), outputIndex: 0 }, output: { address, amount: [{ unit: 'lovelace', quantity: '10000000' }] } };
const payload = { app: 'cardano-ai-preregistry', format_version: 1, network: 'devnet', commitment_hash: 'd'.repeat(64), reveal_deadline: '2026-12-01T00:00:00Z' } as const;
const wallet = { getNetworkId: async () => 0, getChangeAddress: async () => address, getUtxos: async () => [input] };
const data = { protocol: async () => DEFAULT_PROTOCOL_PARAMETERS, utxos: async () => [input] };
it('accepts provider asset annotations while preserving the exact lovelace amount', async () => {
  const indexed = structuredClone(input);
  Object.assign(indexed.output.amount[0]!, { policy_id: '', asset_name: 'lovelace' });
  const prepared = await prepare_registration(payload, wallet, { ...data, utxos: async () => [indexed] });
  expect(prepared.registrant).toBe('b'.repeat(56));
  expect(inspect_transaction(prepared.unsigned_tx).fee).toBeLessThanOrEqual(300000n);
});
it('rejects a different indexed lovelace amount', async () => {
  const indexed = structuredClone(input); indexed.output.amount[0]!.quantity = '10000001';
  await expect(prepare_registration(payload, wallet, { ...data, utxos: async () => [indexed] })).rejects.toThrow('selected test network');
});
it('rejects an indexed output from a different transaction', async () => {
  const indexed = structuredClone(input); indexed.input.txHash = 'c'.repeat(64);
  await expect(prepare_registration(payload, wallet, { ...data, utxos: async () => [indexed] })).rejects.toThrow('selected test network');
});
it('builds real Mesh CBOR with exact metadata, a registrant signer and a capped fee', async () => {
  const prepared = await prepare_registration(payload, wallet, data);
  const view = inspect_transaction(prepared.unsigned_tx);
  expect(view.metadata).toEqual(public_metadata(payload));
  expect(view.signer_hashes).toEqual(['b'.repeat(56)]);
  expect(view.fee).toBeGreaterThan(0n); expect(view.fee).toBeLessThanOrEqual(300000n);
  expect(view.body_hash).toBe(prepared.tx_hash);
}, 30000);
it('rejects a wallet UTxO from a different testnet before building', async () => {
  await expect(prepare_registration(payload, wallet, { ...data, utxos: async () => [] })).rejects.toThrow('selected test network');
});
it('uses the spent input identity when an HD wallet has a different change key', async () => {
  const change = core.buildEnterpriseAddress(0, core.Hash28ByteBase16('c'.repeat(56))).toAddress().toBech32();
  const prepared = await prepare_registration(payload, { ...wallet, getChangeAddress: async () => change }, data);
  expect(prepared.registrant).toBe('b'.repeat(56));
  expect(inspect_transaction(prepared.unsigned_tx).signer_hashes).toEqual(['b'.repeat(56)]);
});
it('rejects excessive estimated fees before asking the wallet to sign', async () => {
  await expect(prepare_registration(payload, wallet, { ...data, protocol: async () => ({ ...DEFAULT_PROTOCOL_PARAMETERS, minFeeB: 400000 }) })).rejects.toThrow('Fee exceeds');
});
