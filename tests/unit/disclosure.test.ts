import { describe, expect, it } from 'vitest';
import { sample_manifest } from '../../src/manifest';
import { DOMAIN, encode_commitment, hex, new_salt, sha256 } from '../../src/commitment';
import { DEMO_KEY, demo_key } from '../../src/transaction';
import { FakeChain, validate_announcement, type AnnouncementPayload, type ChainReader, type CommitmentPayload } from '../../src/chain';
import { bundle_bytes, create_bundle, join_url, split_url, validate_bundle, type RevealBundle } from '../../src/disclosure';
import { verify_announcement, verify_reveal, VERIFICATION_BOUNDARY, type FileFetcher, type RevealDraft } from '../../src/verifier';
import { public_metadata } from '../../src/registration';

const utf8 = (text: string) => new TextEncoder().encode(text);
const RESULTS_URL = 'https://files.example.test/results.csv';
const BUNDLE_URL = 'https://files.example.test/bundle.json';

async function registered(chain = new FakeChain()) {
  const manifest = structuredClone(sample_manifest);
  const salt = new_salt();
  const payload: CommitmentPayload = { app: DOMAIN, format_version: 2, network: 'preprod', commitment_hash: await encode_commitment(manifest, salt, 'preprod', DEMO_KEY.key_hash), reveal_deadline: manifest.reveal_deadline };
  const tx_hash = await chain.commit(payload);
  const draft: RevealDraft = { format_version: 2, network: 'preprod', tx_hash, manifest, salt_hex: hex(salt) };
  return { chain, tx_hash, draft };
}
async function disclosed() {
  const { chain, tx_hash, draft } = await registered();
  const file = utf8('run,accuracy\n1,0.81\n2,0.79\n3,0.80\n');
  const bundle = create_bundle(draft, [{ experiment_id: 'baseline', completed_runs: 3, metrics: { accuracy: 0.8 } }],
    [{ path: 'results.csv', sha256: await sha256(file), url: RESULTS_URL }]);
  const hosted = new Map<string, Uint8Array>([[RESULTS_URL, file], [BUNDLE_URL, bundle_bytes(bundle)]]);
  const files: FileFetcher = { async fetch(url) { return hosted.get(url) ?? null; } };
  return { chain, tx_hash, draft, bundle, hosted, files };
}
async function announced() {
  const state = await disclosed();
  const payload: AnnouncementPayload = { app: DOMAIN, format_version: 1, kind: 'reveal', network: 'preprod',
    commitment_tx_hash: state.tx_hash, bundle_sha256: await sha256(bundle_bytes(state.bundle)), bundle_url: split_url(BUNDLE_URL) };
  const announcement = await state.chain.announce(payload);
  return { ...state, payload, announcement };
}

describe('reveal bundle format', () => {
  it('round-trips long URLs through 64-byte metadata chunks', () => {
    for (const url of [BUNDLE_URL, 'https://example.test/' + 'a'.repeat(43), 'https://example.test/' + 'b'.repeat(200)]) {
      const chunks = split_url(url);
      expect(chunks.every(c => utf8(c).length <= 64)).toBe(true);
      expect(join_url(chunks)).toBe(url);
    }
    expect(() => join_url(['short', 'x'])).toThrow();
    expect(() => join_url(['https://example.test/' + 'd'.repeat(60)])).toThrow();
    for (const bad of ['http://files.example.test/x', 'https://user:pw@example.test/x', 'https://example.test/ä', 'https://example.test/' + 'c'.repeat(600), 'ftp://example.test/x']) {
      expect(() => split_url(bad)).toThrow();
    }
    expect(split_url('http://127.0.0.1:8080/bundle.json', true)).toEqual(['http://127.0.0.1:8080/bundle.json']);
    expect(() => split_url('http://127.0.0.1:8080/bundle.json')).toThrow();
  });
  it('requires exact fields, unique result and file entries and lowercase file hashes', async () => {
    const { bundle } = await disclosed();
    expect(validate_bundle(structuredClone(bundle))).toEqual(bundle);
    expect(() => validate_bundle({ ...bundle, extra: true })).toThrow();
    expect(() => validate_bundle({ ...bundle, files: [...bundle.files, bundle.files[0]] })).toThrow();
    expect(() => validate_bundle({ ...bundle, results: [...bundle.results, bundle.results[0]] })).toThrow();
    expect(() => validate_bundle({ ...bundle, files: [{ ...bundle.files[0]!, sha256: 'A'.repeat(64) }] })).toThrow();
    expect(() => validate_bundle({ ...bundle, results: [{ ...bundle.results[0]!, completed_runs: -1 }] })).toThrow();
    const loopback = { ...bundle, files: [{ ...bundle.files[0]!, url: 'http://localhost:6379/x' }] };
    expect(() => validate_bundle(loopback)).toThrow('https');
    expect(validate_bundle({ ...loopback, network: 'devnet' }).network).toBe('devnet');
    const period = validate_bundle({ ...bundle, self_reported_period: { started_at: '2026-10-02T00:00:00Z' } });
    expect(period.self_reported_period).toEqual({ started_at: '2026-10-02T00:00:00Z' });
  });
  it('announcement metadata is an exact public whitelist without manifest or salt', async () => {
    const { payload, draft } = await announced();
    expect(Object.keys(validate_announcement(payload)).sort()).toEqual(['app', 'bundle_sha256', 'bundle_url', 'commitment_tx_hash', 'format_version', 'kind', 'network']);
    const metadata = JSON.stringify(public_metadata(payload));
    expect(metadata).not.toContain(draft.salt_hex); expect(metadata).not.toContain(draft.manifest.title);
    expect(() => validate_announcement({ ...payload, salt_hex: draft.salt_hex } as AnnouncementPayload)).toThrow();
    expect(() => validate_announcement({ ...payload, bundle_url: ['x'.repeat(65)] })).toThrow();
    expect(() => validate_announcement({ ...payload, bundle_url: ['http://127.0.0.1:8080/bundle.json'] })).toThrow();
    expect(validate_announcement({ ...payload, network: 'devnet', bundle_url: ['http://127.0.0.1:8080/bundle.json'] }).network).toBe('devnet');
  });
});

describe('verify_reveal adversarial checks', () => {
  it('matches the original commitment and every disclosed file', async () => {
    const { bundle, chain, files, tx_hash } = await disclosed();
    const result = await verify_reveal(bundle, chain, files);
    expect(result.status).toBe('match');
    expect(result.network).toBe('preprod'); expect(result.block_time).toBe(((await chain.get_inclusion(tx_hash)) as { time: string }).time);
    expect(result.registrant).toBe(DEMO_KEY.key_hash); expect(result.registrant_bound).toBe(true); expect(result.trust).toBe('local-demo');
    expect(result.files).toEqual([{ path: 'results.csv', status: 'match' }]);
  });
  it('a changed manifest field or salt is a mismatch', async () => {
    const { bundle, chain, files } = await disclosed();
    const changed = structuredClone(bundle); changed.manifest.experiments[0]!.settings.temperature = 0.9;
    expect((await verify_reveal(changed, chain, files)).status).toBe('mismatch');
    expect((await verify_reveal({ ...bundle, salt_hex: hex(new_salt()) }, chain, files)).status).toBe('mismatch');
  });
  it('a replaced file is a mismatch', async () => {
    const { bundle, chain, files, hosted } = await disclosed();
    hosted.set(RESULTS_URL, utf8('run,accuracy\n1,0.99\n'));
    const result = await verify_reveal(bundle, chain, files);
    expect(result.status).toBe('mismatch');
    expect(result.files).toEqual([{ path: 'results.csv', status: 'mismatch' }]);
  });
  it('a missing file is reported as unavailable, never as a match', async () => {
    const { bundle, chain, files, hosted } = await disclosed();
    hosted.delete(RESULTS_URL);
    expect((await verify_reveal(bundle, chain, files)).status).toBe('files-unavailable');
    expect((await verify_reveal(bundle, chain, { async fetch() { throw new Error('CORS'); } })).status).toBe('files-unavailable');
  });
  it('pointing at another commitment is a mismatch', async () => {
    const { bundle, chain, files } = await disclosed();
    const other = await registered(chain);
    expect((await verify_reveal({ ...bundle, commitment_tx_hash: other.tx_hash }, chain, files)).status).toBe('mismatch');
  });
  it('a testnet commitment claimed as mainnet reports a network mismatch', async () => {
    const { bundle, chain, files } = await disclosed();
    // A reader keyed only by transaction hash returns the preprod record for any network.
    const naive: ChainReader = { get_transaction: async hash => chain.get_transaction(hash, 'preprod'), get_inclusion: async hash => chain.get_inclusion(hash) };
    const result = await verify_reveal({ ...bundle, network: 'mainnet' }, naive, files);
    expect(result.status).toBe('network-mismatch');
    expect((await verify_reveal({ ...bundle, network: 'mainnet' }, chain, files)).status).toBe('not-found');
  });
  it('keeps the verification boundary on every outcome', async () => {
    const { bundle, chain, files, hosted } = await disclosed();
    const match = await verify_reveal(bundle, chain, files);
    expect(match.boundary).toMatchInlineSnapshot(`"Commitments do not prove actual execution, execution time, truthful results, fair scoring or registration of every experiment. Original files require separate storage."`);
    expect(match.self_reported).toMatchInlineSnapshot(`"Self-reported times, results and files are the registrant's claims; matching hashes show they are unchanged since disclosure, not that they are true."`);
    hosted.clear();
    for (const input of [null, { ...bundle, salt_hex: 'bad' }, bundle]) {
      const result = await verify_reveal(input, chain, files);
      expect(result.status).not.toBe('match'); expect(result.boundary).toBe(VERIFICATION_BOUNDARY);
    }
  });
});

describe('verify_announcement', () => {
  it('verifies the announcement signer, bundle hash and reveal', async () => {
    const { announcement, chain, files } = await announced();
    const result = await verify_announcement(announcement, 'preprod', chain, files);
    expect(result.status).toBe('match');
    expect(result.announced_at).toBe(((await chain.get_inclusion(announcement)) as { time: string }).time);
    expect(result.announcement_signer).toBe(DEMO_KEY.key_hash);
    expect(result.registrant).toBe(DEMO_KEY.key_hash);
  });
  it('rejects an announcement signed by someone other than the registrant', async () => {
    const { payload, chain, files } = await announced();
    const forger = demo_key('forger');
    const forged = await verify_announcement(await chain.announce(payload, forger), 'preprod', chain, files);
    expect(forged.status).toBe('signer-mismatch'); expect(forged.announcement_signer).toBe(forger.key_hash); expect(forged.registrant).toBe(DEMO_KEY.key_hash);
  });
  it('rejects a bundle edited after announcement or missing at its URL', async () => {
    const { announcement, bundle, chain, files, hosted } = await announced();
    const edited = structuredClone(bundle) as RevealBundle; edited.results[0]!.metrics.accuracy = 0.95;
    hosted.set(BUNDLE_URL, bundle_bytes(edited));
    expect((await verify_announcement(announcement, 'preprod', chain, files)).status).toBe('mismatch');
    hosted.delete(BUNDLE_URL);
    expect((await verify_announcement(announcement, 'preprod', chain, files)).status).toBe('files-unavailable');
  });
  it('rejects a bundle that belongs to a different commitment than the announcement', async () => {
    const state = await disclosed();
    const other = await registered(state.chain);
    const announcement = await state.chain.announce({ app: DOMAIN, format_version: 1, kind: 'reveal', network: 'preprod',
      commitment_tx_hash: other.tx_hash, bundle_sha256: await sha256(bundle_bytes(state.bundle)), bundle_url: split_url(BUNDLE_URL) });
    expect((await verify_announcement(announcement, 'preprod', state.chain, state.files)).status).toBe('mismatch');
  });
  it('rejects a reader that returns a different transaction than requested', async () => {
    const { announcement, chain, files } = await announced();
    const swapped: ChainReader = { get_transaction: () => chain.get_transaction(announcement, 'preprod'), get_inclusion: async () => chain.get_inclusion(announcement) };
    const result = await verify_announcement('0'.repeat(64), 'preprod', swapped, files);
    expect(result.status).toBe('unavailable'); expect(result.announcement_tx_hash).toBe('0'.repeat(64));
  });
  it('reports a missing announcement or another network as not found', async () => {
    const { announcement, chain, files } = await announced();
    expect((await verify_announcement('0'.repeat(64), 'preprod', chain, files)).status).toBe('not-found');
    expect((await verify_announcement(announcement, 'devnet', chain, files)).status).toBe('not-found');
  });
});
