/** Opt-in integration: uses only the local magic-42 node and ignored devnet keys. */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { YaciProvider, type UTxO } from '@meshsdk/core';
import { sample_manifest } from '../src/manifest.ts';
import { encode_commitment, hex, new_salt } from '../src/commitment.ts';
import { prepare_registration, inspect_transaction } from '../src/mesh-wallet.ts';
import { sign_and_submit } from '../src/registration.ts';
import { read_commitment } from './cardano-api.ts';
import { verify_reveal } from '../src/verifier.ts';

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
const provider = new YaciProvider('http://127.0.0.1:18080/api/v1');
const manifest = structuredClone(sample_manifest), salt = new_salt();
const payload = { app: 'cardano-ai-preregistry', format_version: 1, network: 'devnet',
  commitment_hash: await encode_commitment(manifest, salt, 'devnet'), reveal_deadline: manifest.reveal_deadline } as const;
const prepared = await prepare_registration(payload, { getNetworkId: async () => 0, getChangeAddress: async () => address, getUtxos: async () => query() },
  { protocol: async () => provider.fetchProtocolParameters(), utxos: async (_network, hash) => provider.fetchUTxOs(hash) });
const draft = { format_version: 1 as const, network: 'devnet' as const, tx_hash: prepared.tx_hash, manifest, salt_hex: hex(salt) };
writeFileSync(path.join(local, 'private-draft.json'), JSON.stringify(draft), { mode: 0o600 });
const started = Date.now();
const tx_hash = await sign_and_submit(prepared, {
  getNetworkId: async () => 0,
  signTx: async tx => {
    writeFileSync(path.join(local, 'unsigned.json'), JSON.stringify({ type: 'Tx ConwayEra', description: '', cborHex: tx }));
    cli('conway', 'transaction', 'sign', '--testnet-magic', '42', '--tx-file', '/work/registration/unsigned.json',
      '--signing-key-file', '/work/keys/payment.skey', '--out-file', '/work/registration/signed.json');
    return (JSON.parse(readFileSync(path.join(local, 'signed.json'), 'utf8')) as { cborHex: string }).cborHex;
  },
  submitTx: async () => {
    cli('conway', 'transaction', 'submit', '--testnet-magic', '42', '--tx-file', '/work/registration/signed.json');
    return cli('conway', 'transaction', 'txid', '--tx-file', '/work/registration/signed.json');
  },
}, inspect_transaction);
let record = null;
while (Date.now() - started < 180000) {
  try { record = await read_commitment('devnet', tx_hash); } catch { /* Indexer may lag. */ }
  if (record) break;
  await new Promise(resolve => setTimeout(resolve, 2000));
}
if (!record) throw new Error(`Readback timed out for ${tx_hash}; retain the saved draft.`);
const verified = await verify_reveal(draft, { get_commitment: read_commitment_adapter });
async function read_commitment_adapter(hash: string, network: 'devnet' | 'preprod') { return read_commitment(network, hash); }
if (verified.status !== 'match' || record.registrant !== prepared.registrant || record.reveal_deadline !== manifest.reveal_deadline) throw new Error('Devnet readback mismatch.');
const result = { network: 'devnet', network_magic: 42, tx_hash, fee_lovelace: prepared.fee,
  commitment_hash: payload.commitment_hash, reveal_deadline: payload.reveal_deadline, record,
  verified: verified.status, readback_ms: Date.now() - started, browser_extension_used: false };
writeFileSync(path.join(root, 'docs/plans/2026-10-01-preregistry-mvp/registration-results.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ tx_hash, fee_lovelace: prepared.fee, verified: verified.status, readback_ms: result.readback_ms }));
