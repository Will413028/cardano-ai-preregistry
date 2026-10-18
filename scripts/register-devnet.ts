/** Opt-in integration: uses only the local magic-42 node and ignored devnet keys. */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { type AddressInfo } from 'node:net';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { YaciProvider, type UTxO } from '@meshsdk/core';
import { sample_manifest } from '../src/manifest.ts';
import { encode_commitment, FORMAT_VERSION, hex, new_salt, sha256 } from '../src/commitment.ts';
import { prepare_announcement, prepare_registration, inspect_transaction, wallet_registrant } from '../src/mesh-wallet.ts';
import { sign_and_submit, type PreparedRegistration } from '../src/registration.ts';
import { verify_announcement, verify_commitment, type FileFetcher, type Verification } from '../src/verifier.ts';
import { bundle_bytes, create_bundle, split_url } from '../src/disclosure.ts';
import { DEVNET_API, DevnetReader } from '../src/readers.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const local = path.join(root, 'spikes/chain/local/work/registration');
const key = path.join(root, 'spikes/chain/local/work/keys/payment.skey');
const container = 'codex-cardano-preregistry-stable';
const socket = process.env.PREREGISTRY_DEVNET_SOCKET ?? '/clusters/nodes/default/node/node.sock';
const cli = (...args: string[]) => execFileSync('docker', ['exec', '-e', 'GHCRTS=-N2', '-e', `CARDANO_NODE_SOCKET_PATH=${socket}`, container, 'cardano-cli', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 }).trim();
if (process.env.PREREGISTRY_DEVNET !== '1') throw new Error('Set PREREGISTRY_DEVNET=1 to opt into a local test transaction.');
execFileSync('git', ['-C', root, 'check-ignore', '-q', key]);
if (!existsSync(key)) throw new Error('Prepare the ignored devnet test key first.');
mkdirSync(local, { recursive: true });
const address = cli('conway', 'address', 'build', '--payment-verification-key-file', '/work/keys/payment.vkey', '--testnet-magic', '42');
const query = (): UTxO[] => {
  const result = JSON.parse(cli('conway', 'query', 'utxo', '--testnet-magic', '42', '--address', address, '--out-file', '/dev/stdout')) as Record<string, { value: { lovelace: number } }>;
  return Object.entries(result).filter(([, value]) => Object.keys(value.value).length === 1).map(([ref, value]) => ({ input: { txHash: ref.split('#')[0]!, outputIndex: Number(ref.split('#')[1]) },
    output: { address, amount: [{ unit: 'lovelace', quantity: String(value.value.lovelace) }] } }));
};
const provider = new YaciProvider(DEVNET_API);
const wallet = { getNetworkId: async () => 0, getChangeAddress: async () => address, getUtxos: async () => query() };
const data = { protocol: async () => provider.fetchProtocolParameters(), utxos: async (_network: string, hash: string) => provider.fetchUTxOs(hash) };
const registrant = await wallet_registrant(wallet);
const manifest = structuredClone(sample_manifest), salt = new_salt();
const payload = { app: 'cardano-ai-preregistry', format_version: FORMAT_VERSION, network: 'devnet',
  commitment_hash: await encode_commitment(manifest, salt, 'devnet', registrant), reveal_deadline: manifest.reveal_deadline } as const;
const prepared = await prepare_registration(payload, registrant, wallet, data);
const draft = { format_version: FORMAT_VERSION, network: 'devnet' as const, tx_hash: prepared.tx_hash, manifest, salt_hex: hex(salt) };
writeFileSync(path.join(local, 'private-draft.json'), JSON.stringify(draft), { mode: 0o600 });
const cli_wallet = (name: string) => ({
  getNetworkId: async () => 0,
  signTx: async (tx: string) => {
    writeFileSync(path.join(local, `${name}-unsigned.json`), JSON.stringify({ type: 'Tx ConwayEra', description: '', cborHex: tx }));
    cli('conway', 'transaction', 'sign', '--testnet-magic', '42', '--tx-file', `/work/registration/${name}-unsigned.json`,
      '--signing-key-file', '/work/keys/payment.skey', '--out-file', `/work/registration/${name}-signed.json`);
    return (JSON.parse(readFileSync(path.join(local, `${name}-signed.json`), 'utf8')) as { cborHex: string }).cborHex;
  },
  submitTx: async () => {
    cli('conway', 'transaction', 'submit', '--testnet-magic', '42', '--tx-file', `/work/registration/${name}-signed.json`);
    return cli('conway', 'transaction', 'txid', '--tx-file', `/work/registration/${name}-signed.json`);
  },
});
async function poll<T>(read: () => Promise<T | null>, label: string): Promise<T> {
  const started = Date.now();
  while (Date.now() - started < 180000) {
    try { const value = await read(); if (value) return value; } catch { /* Indexer may lag. */ }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  throw new Error(`Readback timed out for ${label}; retain the saved draft.`);
}
// Yaci Store keeps no CBOR, so the bytes are the signed transactions; the reader verifies them like any source.
const signed = new Map<string, string>();
const reader = new DevnetReader(signed);
const found = <T extends Verification>(read: () => Promise<T>) => async () => { const r = await read(); return r.status === 'not-found' ? null : r; };
const started = Date.now();
const { tx_hash, signed_tx } = await sign_and_submit(prepared, cli_wallet('registration'), inspect_transaction);
signed.set(tx_hash, signed_tx);
const verified = await poll(found(() => verify_commitment(draft, reader)), tx_hash);
if (verified.status !== 'match' || verified.registrant !== registrant || verified.registrant_bound !== true || verified.trust !== 'local-node') throw new Error(`Devnet readback mismatch: ${verified.status}`);
const readback_ms = Date.now() - started;

// Step 7: host the bundle and one file on loopback, announce, then verify only from chain reads and those URLs.
const hosted = new Map<string, Uint8Array>();
const server = createServer((req, res) => {
  const body = hosted.get(req.url ?? '');
  res.writeHead(body ? 200 : 404, { 'Content-Type': 'application/octet-stream' }); res.end(body ?? '');
});
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
try {
  const file = new TextEncoder().encode('run,accuracy\n1,0.81\n2,0.79\n3,0.80\n');
  const bundle = create_bundle(draft, [{ experiment_id: 'baseline', completed_runs: 3, metrics: { accuracy: 0.8 } }],
    [{ path: 'results.csv', sha256: await sha256(file), url: `${base}/results.csv` }]);
  // A long path forces the multi-chunk URL metadata encoding through the real node and indexer.
  const bundle_path = `/disclosures/${tx_hash}/${'bundle-'.repeat(6)}v1.json`;
  hosted.set('/results.csv', file); hosted.set(bundle_path, bundle_bytes(bundle));
  writeFileSync(path.join(local, 'bundle.json'), bundle_bytes(bundle), { mode: 0o600 });
  const announcement_payload = { app: 'cardano-ai-preregistry', format_version: 1, kind: 'reveal', network: 'devnet', commitment_tx_hash: tx_hash,
    bundle_sha256: await sha256(bundle_bytes(bundle)), bundle_url: split_url(`${base}${bundle_path}`, true) } as const;
  const announcement: PreparedRegistration = await poll(async () => {
    try { return await prepare_announcement(announcement_payload, registrant, wallet, data); }
    catch { return null; } // Change output from the registration may not be indexed yet.
  }, 'announcement inputs');
  const announced_started = Date.now();
  const sent = await sign_and_submit(announcement, cli_wallet('announcement'), inspect_transaction);
  const announcement_hash = sent.tx_hash;
  signed.set(announcement_hash, sent.signed_tx);
  const files: FileFetcher = { async fetch(url) { const r = await fetch(url); return r.ok ? new Uint8Array(await r.arrayBuffer()) : null; } };
  const disclosure = await poll(found(() => verify_announcement(announcement_hash, 'devnet', reader, files)), announcement_hash);
  hosted.set('/results.csv', new TextEncoder().encode('run,accuracy\n1,0.99\n'));
  const replaced = await verify_announcement(announcement_hash, 'devnet', reader, files);
  hosted.set('/results.csv', file);
  hosted.delete(bundle_path);
  const missing = await verify_announcement(announcement_hash, 'devnet', reader, files);
  // Any source: the same bundle supplied by the caller still verifies after its URL is gone.
  const supplied = await verify_announcement(announcement_hash, 'devnet', reader, files, bundle_bytes(bundle));
  if (announcement_payload.bundle_url.length < 2 || disclosure.status !== 'match' || disclosure.registrant !== registrant || replaced.status !== 'mismatch' ||
    missing.status !== 'files-unavailable' || supplied.status !== 'match') {
    throw new Error(`Devnet disclosure mismatch: ${disclosure.status}/${replaced.status}/${missing.status}/${supplied.status}`);
  }
  // Step 6 and 7 evidence files stay as recorded; the trust-model run records its own results.
  const registration = { tx_hash, format_version: payload.format_version, fee_lovelace: prepared.fee, commitment_hash: payload.commitment_hash, reveal_deadline: payload.reveal_deadline,
    registrant, registrant_bound: verified.registrant_bound, trust: verified.trust, verified: verified.status, readback_ms };
  const result = { network: 'devnet', network_magic: 42, registration, commitment_tx_hash: tx_hash, announcement_tx_hash: announcement_hash,
    announcement_fee_lovelace: announcement.fee, bundle_sha256: announcement_payload.bundle_sha256, bundle_url_chunks: announcement_payload.bundle_url.length,
    announced_at: disclosure.announced_at, signer_is_registrant: disclosure.registrant === registrant, trust: disclosure.trust,
    verified: disclosure.status, replaced_file: replaced.status, missing_bundle: missing.status, supplied_bundle: supplied.status,
    announcement_readback_ms: Date.now() - announced_started, files_hosted_on: 'loopback http, removed after the run', browser_extension_used: false };
  writeFileSync(path.join(root, 'docs/plans/2026-10-01-preregistry-mvp/trust-results.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ tx_hash, announcement_hash, fee_lovelace: prepared.fee, announcement_fee_lovelace: announcement.fee, verified: disclosure.status }));
} finally { server.close(); }
