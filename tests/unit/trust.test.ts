import { afterEach, describe, expect, it, vi } from 'vitest';
import { sample_manifest } from '../../src/manifest';
import { DOMAIN, encode_commitment, hex, new_salt, sha256 } from '../../src/commitment';
import { FakeChain, type AnnouncementPayload, type ChainReader, type CommitmentPayload, type Inclusion } from '../../src/chain';
import { bundle_bytes, create_bundle, split_url } from '../../src/disclosure';
import { TRUST_BOUNDARY, UNBOUND_REGISTRANT, verify_announcement, verify_commitment, verify_reveal, with_uploads, type FileFetcher, type RevealDraft } from '../../src/verifier';
import { DEMO_KEY, demo_key } from '../../src/transaction';
import { KoiosTransactions } from '../../src/mithril';
import { DevnetReader, ProxyTransactions } from '../../src/readers';
import { CborMap } from '../../src/cbor';
import devnet from '../fixtures/chain/devnet-v1.json';
import { build_tx, replace_part } from './helpers/tx';

const RESULTS_URL = 'https://files.example.test/results.csv';
const BUNDLE_URL = 'https://files.example.test/bundle.json';
const FILE = new TextEncoder().encode('run,accuracy\n1,0.81\n2,0.79\n3,0.80\n');
const offline: FileFetcher = { async fetch() { return null; } };
afterEach(() => vi.unstubAllGlobals());

async function disclose(chain: FakeChain, signer = DEMO_KEY) {
  const manifest = structuredClone(sample_manifest), salt = new_salt();
  const payload: CommitmentPayload = { app: DOMAIN, format_version: 2, network: 'preprod',
    commitment_hash: await encode_commitment(manifest, salt, 'preprod', signer.key_hash), reveal_deadline: manifest.reveal_deadline };
  const tx_hash = await chain.commit(payload, signer);
  const draft: RevealDraft = { format_version: 2, network: 'preprod', tx_hash, manifest, salt_hex: hex(salt) };
  const bundle = create_bundle(draft, [{ experiment_id: 'baseline', completed_runs: 3, metrics: { accuracy: 0.8 } }], [{ path: 'results.csv', sha256: await sha256(FILE), url: RESULTS_URL }]);
  const announcement: AnnouncementPayload = { app: DOMAIN, format_version: 1, kind: 'reveal', network: 'preprod', commitment_tx_hash: tx_hash,
    bundle_sha256: await sha256(bundle_bytes(bundle)), bundle_url: split_url(BUNDLE_URL) };
  return { payload, draft, bundle, announcement, announcement_tx: await chain.announce(announcement, signer) };
}
const hosting = (bundle: Uint8Array): FileFetcher => ({ async fetch(url) { return url === RESULTS_URL ? FILE : url === BUNDLE_URL ? bundle : null; } });
/** A FakeChain transaction treated as Mithril-certified at `slot`. */
const certified = (chain: FakeChain, slot = 136492696, inclusion?: Inclusion): ChainReader => ({
  get_transaction: (hash, network) => chain.get_transaction(hash, network),
  get_inclusion: async () => inclusion ?? { status: 'certified', trust: 'mithril', slot, block_number: 5300000 },
});
const DEMO_TIME = '2026-10-18T00:00:00.000Z';
const serving = (cbor: string): ChainReader => ({ get_transaction: async () => ({ cbor }), get_inclusion: async () => ({ status: 'local', trust: 'local-demo', time: DEMO_TIME }) });

describe('registrant binding (D14, I7)', () => {
  it('a copy of the commitment by another key never matches, while the original registrant does', async () => {
    const chain = new FakeChain();
    const original = await disclose(chain);
    const thief = demo_key('thief');
    // The thief copies the public commitment hash, then reuses the revealed manifest and salt in its own announcement.
    const copy_tx = await chain.commit(original.payload, thief);
    const copied_bundle = { ...original.bundle, commitment_tx_hash: copy_tx };
    const copied_announcement = await chain.announce({ ...original.announcement, commitment_tx_hash: copy_tx, bundle_sha256: await sha256(bundle_bytes(copied_bundle)) }, thief);
    const copy = await verify_announcement(copied_announcement, 'preprod', chain, hosting(bundle_bytes(copied_bundle)));
    expect(copy.status).toBe('mismatch'); expect(copy.registrant).toBe(thief.key_hash);
    expect((await verify_reveal(copied_bundle, chain, hosting(bundle_bytes(copied_bundle)))).status).toBe('mismatch');
    const real = await verify_announcement(original.announcement_tx, 'preprod', chain, hosting(bundle_bytes(original.bundle)));
    expect(real.status).toBe('match'); expect(real.registrant).toBe(DEMO_KEY.key_hash); expect(real.registrant_bound).toBe(true);
  });
  it('an announcement fee paid by a different key is fine; the signer is still the required registrant', async () => {
    const chain = new FakeChain();
    const { announcement, bundle } = await disclose(chain);
    const fee_payer = demo_key('fee payer');
    // Two witnesses: the registrant (required signer) and the key that owns the fee input.
    const tx = build_tx({ payload: announcement as never, signers: [DEMO_KEY, fee_payer], required: [DEMO_KEY.key_hash] });
    const reader: ChainReader = { get_transaction: async (h, n) => h === tx.tx_hash ? { cbor: tx.cbor } : chain.get_transaction(h, n),
      get_inclusion: async h => h === tx.tx_hash ? { status: 'local', trust: 'local-demo', time: DEMO_TIME } : chain.get_inclusion(h) };
    const result = await verify_announcement(tx.tx_hash, 'preprod', reader, hosting(bundle_bytes(bundle)));
    expect(result.status).toBe('match'); expect(result.registrant).toBe(DEMO_KEY.key_hash);
  });
});

describe('raw bytes from an untrusted reader', () => {
  it('bytes that cannot be the requested transaction are a source failure; a non-app transaction is invalid; never a match', async () => {
    const chain = new FakeChain();
    const { draft } = await disclose(chain);
    const own = (await chain.get_transaction(draft.tx_hash, 'preprod'))!.cbor;
    const other = build_tx({ payload: { app: DOMAIN }, signers: [DEMO_KEY] });
    const edited_metadata = replace_part(own, 3, new CborMap([[86741, new CborMap([['app', DOMAIN]])]]));
    const no_witness = replace_part(own, 1, new CborMap([]));
    // Another transaction's bytes, metadata or witnesses changed outside the body hash: the transport is at fault.
    const script_witness = build_tx({ payload: { app: DOMAIN }, signers: [DEMO_KEY], witnesses: [[1, []]] });
    for (const [tx_hash, cbor] of [[draft.tx_hash, other.cbor], [draft.tx_hash, edited_metadata], [draft.tx_hash, no_witness], [script_witness.tx_hash, script_witness.cbor]]) {
      const result = await verify_commitment({ ...draft, tx_hash }, serving(cbor!));
      expect(result.status).toBe('unavailable');
    }
    // The body itself, fixed by the hash, is not an app transaction.
    const two_signers = build_tx({ payload: { app: DOMAIN }, signers: [DEMO_KEY, demo_key('b')] });
    const many = await verify_commitment({ ...draft, tx_hash: two_signers.tx_hash }, serving(two_signers.cbor));
    expect(many.status).toBe('invalid'); expect(many.detail).toContain('Exactly one required signer');
    const collateral = build_tx({ payload: { app: DOMAIN }, signers: [DEMO_KEY], body: [[13, [[new Uint8Array(32), 1]]]] });
    expect((await verify_commitment({ ...draft, tx_hash: collateral.tx_hash }, serving(collateral.cbor))).status).toBe('invalid');
  });
  it('block time comes from the certified slot (a transport cannot supply one)', async () => {
    const chain = new FakeChain();
    const { draft } = await disclose(chain);
    const result = await verify_commitment(draft, certified(chain));
    expect(result.status).toBe('match'); expect(result.trust).toBe('mithril'); expect(result.slot).toBe(136492696);
    expect(result.block_time).toBe(new Date(1792175896 * 1000).toISOString());
    expect(result.trust_boundary).toBe(TRUST_BOUNDARY.mithril);
  });
  it('an uncertified transaction is pending, and a failing proof is invalid', async () => {
    const chain = new FakeChain();
    const { draft, announcement_tx, bundle } = await disclose(chain);
    expect((await verify_commitment(draft, certified(chain, 0, { status: 'pending', trust: 'mithril' }))).status).toBe('pending');
    expect((await verify_announcement(announcement_tx, 'preprod', certified(chain, 0, { status: 'pending', trust: 'mithril' }), hosting(bundle_bytes(bundle)))).status).toBe('pending');
    const failing: ChainReader = { ...certified(chain), get_inclusion: async () => { throw new Error('Mithril proof does not match its certificate.'); } };
    expect((await verify_commitment(draft, failing)).status).toBe('unavailable');
    const down: ChainReader = { ...certified(chain), get_transaction: async () => { throw new Error('Chain provider unavailable.'); } };
    expect((await verify_commitment(draft, down)).status).toBe('unavailable');
    const unknown: ChainReader = { ...certified(chain), get_inclusion: async () => ({ status: 'local', trust: 'mithril' }) as unknown as Inclusion };
    expect((await verify_commitment(draft, unknown)).detail).toContain('Unrecognised inclusion');
  });
  it('local trust is accepted only for devnet', async () => {
    const chain = new FakeChain();
    const { draft } = await disclose(chain);
    const local_node: ChainReader = { get_transaction: (h, n) => chain.get_transaction(h, n), get_inclusion: async () => ({ status: 'local', trust: 'local-node', time: DEMO_TIME }) };
    expect((await verify_commitment(draft, local_node)).detail).toContain('only to devnet');
  });
});

describe('any source for the bundle and files (I4)', () => {
  it('uploaded bundle and files match when every URL is gone', async () => {
    const chain = new FakeChain();
    const { announcement_tx, bundle } = await disclose(chain);
    expect((await verify_announcement(announcement_tx, 'preprod', chain, offline)).status).toBe('files-unavailable');
    const uploads = with_uploads([FILE], offline);
    expect((await verify_announcement(announcement_tx, 'preprod', chain, uploads, bundle_bytes(bundle))).status).toBe('match');
    expect((await verify_reveal(bundle, chain, uploads)).status).toBe('match');
    // An upload with other bytes is not used for the file and the URL is still tried.
    expect((await verify_reveal(bundle, chain, with_uploads([new TextEncoder().encode('other')], offline))).status).toBe('files-unavailable');
  });
  it('raw bytes through the development cache and directly from Koios give the same result', async () => {
    const chain = new FakeChain();
    const { draft } = await disclose(chain);
    const raw = (await chain.get_transaction(draft.tx_hash, 'preprod'))!;
    const fetcher = vi.fn(async (url: string | URL | Request) => String(url).includes('/api/cardano') ? Response.json({ cbor: raw.cbor })
      : Response.json([{ tx_hash: draft.tx_hash, cbor: raw.cbor, tx_timestamp: 1 }]));
    const inclusion = async (): Promise<Inclusion> => ({ status: 'certified', trust: 'mithril', slot: 136492696, block_number: 5300000 });
    const direct = await verify_commitment(draft, { get_transaction: (h, n) => new KoiosTransactions('https://koios.test/api/v1', fetcher).get_transaction(h, n), get_inclusion: inclusion });
    const cached = await verify_commitment(draft, { get_transaction: (h, n) => new ProxyTransactions('/api/cardano', fetcher).get_transaction(h, n), get_inclusion: inclusion });
    expect(direct.status).toBe('match');
    expect(cached).toEqual(direct);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe('format v1 transactions already on devnet', () => {
  it('still verify through the devnet reader, marked as not binding the registrant and locally trusted', async () => {
    // Shapes as Yaci Store returns them (chain-results.json): the block time only comes with the metadata.
    const yaci = vi.fn(async (url: string | URL | Request) => {
      const [hash, metadata] = String(url).split('/txs/')[1]!.split('/');
      return Response.json(metadata ? [{ block_time: 1792179208, slot: 900 }] : { hash, invalid: false, slot: 900 });
    });
    const signed = new Map([[devnet.commitment.tx_hash, devnet.commitment.cbor], [devnet.announcement.tx_hash, devnet.announcement.cbor]]);
    const reader = new DevnetReader(signed, 'http://127.0.0.1:18080/api/v1', yaci);
    const bundle = Uint8Array.from(devnet.bundle_hex.match(/../g)!, b => parseInt(b, 16));
    const result = await verify_announcement(devnet.announcement.tx_hash, 'devnet', reader, with_uploads([FILE], offline), bundle);
    expect(result.status).toBe('match');
    expect(result.registrant_bound).toBe(false); expect(result.detail).toContain(UNBOUND_REGISTRANT);
    expect(result.trust).toBe('local-node'); expect(result.trust_boundary).toBe(TRUST_BOUNDARY['local-node']);
    expect((await verify_commitment(devnet.draft, reader)).status).toBe('match');
    expect((await verify_commitment({ ...devnet.draft, format_version: 2 }, reader)).status).toBe('invalid');
  });
});
