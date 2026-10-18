/** Read-only: verifies an existing public preprod transaction (not an app record) with Koios bytes and a Mithril v2 proof. */
import { KoiosTransactions, MithrilInclusion, slot_time } from '../src/mithril.ts';
import { KOIOS } from '../src/relay.ts';
import { verify_transaction, vkey_witnesses } from '../src/transaction.ts';

const KOIOS_PREPROD = KOIOS.preprod!;
const hash = process.argv[2] ?? '';
if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error('Expected a public preprod transaction hash.');
const raw = await new KoiosTransactions(KOIOS_PREPROD).get_transaction(hash, 'preprod');
if (!raw) throw new Error('Koios returned no bytes for the sample.');
// The body hash is checked first; the sample is a public non-app transaction, so the app policy may reject it after that.
let policy = 'accepted';
try { verify_transaction(raw.cbor, hash); } catch (error) {
  policy = (error as Error).message;
  if (policy.startsWith('Transaction body does not hash')) throw error;
}
const { total, valid: keys } = vkey_witnesses(raw.cbor), valid = keys.length;
if (!total || valid !== total) throw new Error(`Only ${valid} of ${total} vkey witnesses verify.`);
const started = Date.now();
const inclusion = await new MithrilInclusion().get_inclusion(hash, 'preprod');
if (inclusion.status !== 'certified') throw new Error('Sample is not Mithril-certified yet.');
// Cross-check of the compiled-in era constants only: the app never takes time from Koios.
const derived = slot_time('preprod', inclusion.slot);
const [row] = await (await fetch(`${KOIOS_PREPROD}/tx_cbor`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ _tx_hashes: [hash] }) })).json() as { tx_timestamp: number }[];
const reported = new Date(row!.tx_timestamp * 1000).toISOString();
if (reported !== derived) throw new Error(`Slot-derived time ${derived} differs from Koios ${reported}.`);
console.log(JSON.stringify({ tx_hash: hash, body_hash_matches: true, vkey_witnesses_valid: `${valid}/${total}`, app_policy: policy,
  mithril: { slot: inclusion.slot, block_number: inclusion.block_number, block_time: derived, verify_ms: Date.now() - started } }));
console.log('Koios + Mithril preprod reader passed on a public sample; not an application commitment.');
