import { blake2b } from '@noble/hashes/blake2b';
import { ed25519 } from '@noble/curves/ed25519';
import { core, type UTxO } from '@meshsdk/core';
import { type Page, type Route } from '@playwright/test';
import { readFileSync } from 'node:fs';

const json = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const protocol = json('../../fixtures/chain/yaci-protocol-parameters.json');
const evidence = json('../../../docs/plans/2026-10-01-preregistry-mvp/chain-results.json') as { tx_info: { outputs: Record<string, unknown>[] } };
import { CborMap, decode_array_spans, encode } from '../../../src/cbor.ts';
import { hex } from '../../../src/commitment.ts';
import { demo_key, from_hex } from '../../../src/transaction.ts';
import { funding_transaction } from '../../unit/helpers/tx.ts';

const body_hash = (tx: string) => { const raw = from_hex(tx), [body] = decode_array_spans(raw); return blake2b(raw.subarray(body!.span.start, body!.span.end), { dkLen: 32 }); };
/** A CIP-30 wallet whose key really signs, so the page's self-verification runs on genuine witnesses. */
export function test_wallet(name: string) {
  const key = demo_key(name);
  const address = core.buildEnterpriseAddress(0, core.Hash28ByteBase16(key.key_hash)).toAddress();
  // A real funding transaction, so the preprod write side can find the wallet's input in relayed bytes.
  const funding = funding_transaction(from_hex(String(address.toBytes())), 10000000);
  const input: UTxO = { input: { txHash: funding.tx_hash, outputIndex: 0 }, output: { address: address.toBech32(), amount: [{ unit: 'lovelace', quantity: '10000000' }] } };
  return {
    key, input, funding, bech32: address.toBech32(), raw_address: String(address.toBytes()), utxo_cbor: core.toTxUnspentOutput(input).toCbor(),
    /** CIP-30 `signTx` returns only the witness set. */
    witness_set: (tx: string) => hex(encode(new CborMap([[0, [[key.vkey, ed25519.sign(body_hash(tx), key.secret)]]]]))),
  };
}
export const tx_id = (tx: string) => hex(body_hash(tx));

/**
 * Local devnet indexer double at the address the page reads directly (no relay), in the shapes Yaci Store returns
 * (recorded in chain-results.json and yaci-protocol-parameters.json). Submitted transactions become visible; the
 * wallet's funding output is served for the write-side UTxO check.
 */
export async function yaci(page: Page, submitted: Map<string, string>, funding: UTxO) {
  await page.route('http://127.0.0.1:18080/api/v1/**', async (route: Route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1/', '');
    const headers = { 'access-control-allow-origin': '*' };
    if (path === 'epochs/latest/parameters') { await route.fulfill({ headers, json: protocol }); return; }
    const [, hash, part] = path.split('/');
    if (path.startsWith('txs/') && hash === funding.input.txHash && part === 'utxos') {
      const output = { ...evidence.tx_info.outputs[0], tx_hash: hash, output_index: funding.input.outputIndex, address: funding.output.address,
        amount: [{ unit: 'lovelace', policy_id: null, asset_name: 'lovelace', quantity: Number(funding.output.amount[0]!.quantity) }] };
      await route.fulfill({ headers, json: { hash, inputs: [], outputs: [output] } }); return;
    }
    if (!path.startsWith('txs/') || !submitted.has(hash!)) { await route.fulfill({ status: 404, headers, body: '' }); return; }
    await route.fulfill({ headers, json: part === 'metadata' ? [{ block_time: 1792179208, slot: 900, label: '86741' }] : { hash, invalid: false, slot: 900 } });
  });
}
/**
 * The same-origin relay as the page sees it (D17): raw Koios `tx_cbor` rows. Serves the given transactions; anything
 * else is "not found". `on_tx` runs before each answer, so a test can hold a read open.
 */
export async function relay(page: Page, transactions: { tx_hash: string; cbor: string }[], on_tx?: (wanted: string[]) => Promise<void>) {
  await page.route('**/api/cardano?**', async route => {
    const params = new URL(route.request().url()).searchParams;
    if (params.get('kind') !== 'tx' || params.get('network') !== 'preprod') { await route.fulfill({ status: 400, json: { error: 'unexpected query' } }); return; }
    const wanted = (params.get('tx_hashes') ?? '').split(',');
    await on_tx?.(wanted);
    await route.fulfill({ json: transactions.filter(t => wanted.includes(t.tx_hash)) });
  });
}
