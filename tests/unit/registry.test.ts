import { describe, expect, it } from 'vitest';
import { DOMAIN, hex } from '../../src/commitment';
import { sample_manifest } from '../../src/manifest';
import { FakeChain, validate_public_payload, validate_termination, type AnnouncementPayload, type CommitmentPayload, type Inclusion, type PublicPayload, type TerminationPayload } from '../../src/chain';
import { build_demo_transaction, demo_key, json_metadatum, verify_transaction, type DemoKey } from '../../src/transaction';
import { encode } from '../../src/cbor';
import { slot_time } from '../../src/mithril';
import { VERIFICATION_BOUNDARY, verify_announcement, verify_commitment } from '../../src/verifier';
import * as registry from '../../src/registry';
import { ABSENCE_BOUNDARY, derive_status, to_event, type RegistryEvent, type RegistryInput, type RevealCheck } from '../../src/registry';

const ALICE = demo_key('alice'), MALLORY = demo_key('mallory');
const DEADLINE = '2026-11-01T00:00:00Z';
const DEADLINE_SLOT = (Date.parse(DEADLINE) / 1000) - 1655769600 + 86400;  // preprod slot whose time equals the deadline
const BASE_BLOCK = 5300000;
const SCAN = { source: 'https://preprod.koios.rest/api/v1 label 86741', through_block: BASE_BLOCK + 5000 };
const as_of = (slot: number, block = BASE_BLOCK + 5000) => ({ time: slot_time('preprod', slot), block_number: block });
let counter = 0;
const certified = (slot: number, block = BASE_BLOCK): Inclusion => ({ status: 'certified', trust: 'mithril', slot, block_number: block });

function event(payload: PublicPayload, signer: DemoKey, inclusion: Inclusion): RegistryEvent {
  const { tx_hash, cbor } = build_demo_transaction(payload as never, signer, Uint8Array.of(counter++, 1, 2, 3));
  const result = to_event(verify_transaction(cbor, tx_hash), inclusion, 'preprod');
  if (!result) throw new Error('fixture has no app metadata');
  return result;
}
const commitment = (signer = ALICE, inclusion = certified(DEADLINE_SLOT - 86400 * 10), hash = hex(Uint8Array.of(counter, ...new Uint8Array(31)))) =>
  event({ app: DOMAIN, format_version: 2, network: 'preprod', commitment_hash: hash, reveal_deadline: DEADLINE } satisfies CommitmentPayload, signer, inclusion);
const reveal = (of: RegistryEvent, signer = ALICE, inclusion = certified(DEADLINE_SLOT - 86400, BASE_BLOCK + 100)) =>
  event({ app: DOMAIN, format_version: 1, kind: 'reveal', network: 'preprod', commitment_tx_hash: of.tx_hash, bundle_sha256: 'ab'.repeat(32), bundle_url: ['https://files.example.test/b.json'] } satisfies AnnouncementPayload, signer, inclusion);
const terminate = (of: RegistryEvent, signer = ALICE, inclusion = certified(DEADLINE_SLOT - 86400 * 2, BASE_BLOCK + 50)) =>
  event({ app: DOMAIN, format_version: 1, kind: 'terminate', network: 'preprod', commitment_tx_hash: of.tx_hash } satisfies TerminationPayload, signer, inclusion);
const input = (events: RegistryEvent[], checks: [RegistryEvent, RevealCheck][] = [], now = as_of(DEADLINE_SLOT - 3600)): RegistryInput =>
  ({ network: 'preprod', events, reveal_checks: new Map(checks.map(([e, c]) => [e.tx_hash, c])), scan: SCAN, as_of: now });
const only = (view: ReturnType<typeof derive_status>) => { expect(view.registrations).toHaveLength(1); return view.registrations[0]!; };

describe('termination payload (D8, frozen once on chain)', () => {
  const payload: TerminationPayload = { app: DOMAIN, format_version: 1, kind: 'terminate', network: 'preprod', commitment_tx_hash: '11'.repeat(32) };
  it('accepts exactly the whitelisted fields and pins the metadata bytes', () => {
    expect(validate_public_payload(payload)).toEqual(payload);
    expect(() => validate_termination({ ...payload, reason: 'x' } as never)).toThrow();
    expect(() => validate_termination({ ...payload, commitment_tx_hash: 'zz' })).toThrow();
    expect(() => validate_termination({ ...payload, network: 'mainnet' } as never)).toThrow();
    // Test vector: the label-86741 metadatum bytes; once a termination is on chain this hex must never change.
    expect(hex(encode(json_metadatum(payload as never)))).toBe(
      'a5636170707663617264616e6f2d61692d70726572656769737472796e666f726d61745f76657273696f6e01646b696e64697465726d696e61746567' +
      '6e6574776f726b6770726570726f6472636f6d6d69746d656e745f74785f68617368784031313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131');
  });
  it('is neither a commitment nor an announcement to the verifier', async () => {
    const chain = new FakeChain();
    const tx = await chain.terminate(payload);
    const offline = { async fetch() { return null; } };
    expect((await verify_announcement(tx, 'preprod', chain, offline)).status).toBe('not-found');
    const draft = { format_version: 2, network: 'preprod', tx_hash: tx, manifest: sample_manifest, salt_hex: '00'.repeat(32) };
    expect((await verify_commitment(draft, chain)).status).toBe('not-found');
  });
  it('an unknown kind is rejected as an invalid announcement, not ignored', async () => {
    const { tx_hash, cbor } = build_demo_transaction({ ...payload, kind: 'bogus' }, ALICE, Uint8Array.of(7));
    const reader = { get_transaction: async () => ({ cbor }), get_inclusion: async () => ({ status: 'local', trust: 'local-demo', time: DEADLINE }) as Inclusion };
    expect((await verify_announcement(tx_hash, 'preprod', reader, { async fetch() { return null; } })).status).toBe('invalid');
  });
});

describe('to_event', () => {
  it('keeps the witnessed signer, derives time from the certified slot and rejects a network mismatch', () => {
    const c = commitment();
    expect(c.signer).toBe(ALICE.key_hash);
    expect(c.inclusion).toEqual({ status: 'certified', slot: DEADLINE_SLOT - 86400 * 10, block_number: BASE_BLOCK, time: slot_time('preprod', DEADLINE_SLOT - 86400 * 10) });
    const { tx_hash, cbor } = build_demo_transaction({ app: DOMAIN, format_version: 2, network: 'devnet', commitment_hash: '00'.repeat(32), reveal_deadline: DEADLINE }, ALICE, Uint8Array.of(9));
    expect(() => to_event(verify_transaction(cbor, tx_hash), certified(1), 'preprod')).toThrow(/network/);
  });
  it('rejects local trust outside devnet and returns null without app metadata', () => {
    expect(() => commitment(ALICE, { status: 'local', trust: 'local-node', time: DEADLINE })).toThrow();
    expect(to_event({ tx_hash: '22'.repeat(32), registrant: ALICE.key_hash, metadata: null }, certified(1), 'preprod')).toBeNull();
  });
  it('rejects a public deadline without a UTC zone, which readers in different zones would read differently', () => {
    const { tx_hash, cbor } = build_demo_transaction({ app: DOMAIN, format_version: 2, network: 'preprod', commitment_hash: '00'.repeat(32), reveal_deadline: '2026-11-01T00:00:00' }, ALICE, Uint8Array.of(8));
    expect(() => to_event(verify_transaction(cbor, tx_hash), certified(DEADLINE_SLOT), 'preprod')).toThrow(/UTC/);
  });
});

describe('derive_status (D8, D15, D19, I5, I7, I8)', () => {
  it('not revealed before the deadline, overdue after it; both rest on absence and name the source and block', () => {
    const c = commitment();
    const before = only(derive_status(input([c])));
    expect(before.status).toBe('not-revealed');
    expect(before.absence).toEqual(SCAN);
    const after = only(derive_status(input([c], [], as_of(DEADLINE_SLOT + 1))));
    expect(after.status).toBe('overdue');
    expect(after.absence).toEqual(SCAN);
    expect(only(derive_status(input([c], [], as_of(DEADLINE_SLOT)))).status).toBe('not-revealed');
  });
  it('an announcement exactly at the deadline is on time; one slot later is a late reveal', () => {
    const c = commitment();
    const on_time = reveal(c, ALICE, certified(DEADLINE_SLOT, BASE_BLOCK + 10));
    const r = only(derive_status(input([c, on_time], [[on_time, 'match']], as_of(DEADLINE_SLOT + 100))));
    expect(r.status).toBe('revealed-match');
    expect(r.late_reveal).toBe(false);
    const late = reveal(c, ALICE, certified(DEADLINE_SLOT + 1, BASE_BLOCK + 10));
    const l = only(derive_status(input([c, late], [[late, 'mismatch']], as_of(DEADLINE_SLOT + 100))));
    expect(l.status).toBe('revealed-mismatch');
    expect(l.late_reveal).toBe(true);
  });
  it('maps the reveal check to match, mismatch and files unavailable', () => {
    for (const [check, status] of [['match', 'revealed-match'], ['mismatch', 'revealed-mismatch'], ['files-unavailable', 'files-unavailable']] as const) {
      const c = commitment(), a = reveal(c);
      expect(only(derive_status(input([c, a], [[a, check]]))).status).toBe(status);
    }
  });
  it('requires a check for every counted announcement', () => {
    const c = commitment(), a = reveal(c);
    expect(() => derive_status(input([c, a]))).toThrow(/check/);
  });
  it('termination wins; a later reveal is still checked and shown separately', () => {
    const c = commitment(), t = terminate(c), a = reveal(c, ALICE, certified(DEADLINE_SLOT + 10, BASE_BLOCK + 200));
    for (const check of ['match', 'mismatch'] as const) {
      const r = only(derive_status(input([c, t, a], [[a, check]], as_of(DEADLINE_SLOT + 100))));
      expect(r.status).toBe('terminated');
      expect(r.absence).toBeNull();
      expect(r.terminated_at).toBe(t.inclusion.status === 'certified' ? t.inclusion.time : null);
      expect(r.reveal).toMatchObject({ announcement_tx_hash: a.tx_hash, check, late: true });
    }
    expect(only(derive_status(input([c, t]))).status).toBe('terminated');
  });
  it('a forger cannot terminate or reveal: the events stay in history and do not change the status', () => {
    const c = commitment(), t = terminate(c, MALLORY), a = reveal(c, MALLORY);
    const r = only(derive_status(input([c, t, a], [[a, 'match']])));
    expect(r.status).toBe('not-revealed');
    expect(r.history.filter(h => h.note === 'signer-mismatch').map(h => h.tx_hash).sort()).toEqual([t.tx_hash, a.tx_hash].sort());
  });
  it('uncertified events are history only; an uncertified commitment is listed as pending', () => {
    const c = commitment(), a = reveal(c, ALICE, { status: 'pending', trust: 'mithril' }), t = terminate(c, ALICE, { status: 'pending', trust: 'mithril' });
    const r = only(derive_status(input([c, a, t])));
    expect(r.status).toBe('not-revealed');
    expect(r.history.filter(h => h.note === 'pending')).toHaveLength(2);
    const p = commitment(ALICE, { status: 'pending', trust: 'mithril' });
    const view = derive_status(input([p]));
    expect(view.registrations).toEqual([]);
    expect(view.pending).toEqual([p.tx_hash]);
  });
  it('marks a status provisional until every event it rests on is k blocks deep (D19)', () => {
    const c = commitment(ALICE, certified(DEADLINE_SLOT - 86400 * 10, BASE_BLOCK));
    expect(only(derive_status(input([c], [], as_of(DEADLINE_SLOT - 3600, BASE_BLOCK + 2160)))).provisional).toBe(false);
    expect(only(derive_status(input([c], [], as_of(DEADLINE_SLOT - 3600, BASE_BLOCK + 2159)))).provisional).toBe(true);
    const a = reveal(c, ALICE, certified(DEADLINE_SLOT - 10, BASE_BLOCK + 1000));
    expect(only(derive_status(input([c, a], [[a, 'match']], as_of(DEADLINE_SLOT, BASE_BLOCK + 2500)))).provisional).toBe(true);
  });
  it('an announcement the source missed changes the status once anyone supplies its proof (D15)', () => {
    const c = commitment(), a = reveal(c);
    expect(only(derive_status(input([c]))).status).toBe('not-revealed');
    expect(only(derive_status(input([c, a], [[a, 'match']]))).status).toBe('revealed-match');
  });
  it('a matching reveal is preferred over an earlier failing one; timing follows the reveal used', () => {
    const c = commitment();
    const bad = reveal(c, ALICE, certified(DEADLINE_SLOT - 100, BASE_BLOCK + 10));
    const good = reveal(c, ALICE, certified(DEADLINE_SLOT + 50, BASE_BLOCK + 20));
    const r = only(derive_status(input([c, bad, good], [[bad, 'files-unavailable'], [good, 'match']], as_of(DEADLINE_SLOT + 100))));
    expect(r.status).toBe('revealed-match');
    expect(r.reveal?.announcement_tx_hash).toBe(good.tx_hash);
    expect(r.late_reveal).toBe(true);
  });
  it('without a match, the earliest reveal decides', () => {
    const c = commitment();
    const first = reveal(c, ALICE, certified(DEADLINE_SLOT - 100, BASE_BLOCK + 10));
    const second = reveal(c, ALICE, certified(DEADLINE_SLOT - 50, BASE_BLOCK + 20));
    const r = only(derive_status(input([c, second, first], [[first, 'files-unavailable'], [second, 'mismatch']])));
    expect(r.status).toBe('files-unavailable');
    expect(r.reveal?.announcement_tx_hash).toBe(first.tx_hash);
  });
  it('only the events a status rests on can make it provisional', () => {
    const c = commitment(ALICE, certified(DEADLINE_SLOT - 86400 * 10, BASE_BLOCK));
    const t = terminate(c, ALICE, certified(DEADLINE_SLOT - 86400 * 5, BASE_BLOCK + 10));
    const shallow_reveal = reveal(c, ALICE, certified(DEADLINE_SLOT - 10, BASE_BLOCK + 4000));
    const now = as_of(DEADLINE_SLOT, BASE_BLOCK + 4100);
    expect(only(derive_status(input([c, t, shallow_reveal], [[shallow_reveal, 'match']], now))).provisional).toBe(false);
    const pending = reveal(c, ALICE, { status: 'pending', trust: 'mithril' });
    expect(only(derive_status(input([c, pending], [], now))).provisional).toBe(false);
  });
  it('treats the events as a set: a repeat or a later proof of the same tx counts once', () => {
    const p = commitment(ALICE, { status: 'pending', trust: 'mithril' });
    const proven = { ...p, inclusion: { status: 'certified' as const, slot: DEADLINE_SLOT - 86400, block_number: BASE_BLOCK, time: slot_time('preprod', DEADLINE_SLOT - 86400) } };
    const a = reveal(proven);
    const view = derive_status(input([p, proven, proven, a, a], [[a, 'match']]));
    expect(view.pending).toEqual([]);
    expect(only(view).history).toHaveLength(2);
  });
  it('refuses to mix networks in one view (I9)', () => {
    const c = commitment();
    expect(() => derive_status(input([{ ...c, network: 'preview' }]))).toThrow(/network/);
  });
  it('flags duplicate commitment hashes (I8) and groups by registrant (I7)', () => {
    const hash = 'cd'.repeat(32);
    const a = commitment(ALICE, undefined, hash), m = commitment(MALLORY, undefined, hash), other = commitment(ALICE);
    const view = derive_status(input([a, m, other]));
    const by_hash = new Map(view.registrations.map(r => [r.tx_hash, r]));
    expect(by_hash.get(a.tx_hash)!.duplicates).toEqual([m.tx_hash]);
    expect(by_hash.get(m.tx_hash)!.duplicates).toEqual([a.tx_hash]);
    expect(by_hash.get(other.tx_hash)!.duplicates).toEqual([]);
    expect(registry.by_registrant(view).get(ALICE.key_hash)!.map(r => r.tx_hash).sort()).toEqual([a.tx_hash, other.tx_hash].sort());
  });
  it('events referring to unknown commitments are kept as orphans', () => {
    const c = commitment(), a = reveal(c);
    const view = derive_status(input([a], [[a, 'match']]));
    expect(view.registrations).toEqual([]);
    expect(view.orphans.map(o => o.tx_hash)).toEqual([a.tx_hash]);
    const pending = reveal(c, ALICE, { status: 'pending', trust: 'mithril' });
    expect(derive_status(input([pending])).orphans[0]!.note).toBe('pending');
  });
  it('carries the verification and absence boundaries (I6, D15)', () => {
    const view = derive_status(input([commitment()]));
    expect(view.boundary).toBe(VERIFICATION_BOUNDARY);
    expect(view.absence_boundary).toBe(ABSENCE_BOUNDARY);
    expect(ABSENCE_BOUNDARY).toMatch(/not being found.*named source.*named block/i);
  });
  it('I5(b): recomputing from the same chain data in any order gives the same list', () => {
    const c1 = commitment(), c2 = commitment(MALLORY), a = reveal(c1), t = terminate(c2, MALLORY), forged = terminate(c1, MALLORY);
    const events = [c1, c2, a, t, forged];
    const checks: [RegistryEvent, RevealCheck][] = [[a, 'match']];
    const expected = derive_status(input(events, checks));
    // Every rotation of both orders: deterministic, and each event appears in every position.
    for (const base of [events, [...events].reverse()]) {
      for (let i = 0; i < base.length; i++) expect(derive_status(input([...base.slice(i), ...base.slice(0, i)], checks))).toEqual(expected);
    }
    expect(expected.registrations.map(r => r.status).sort()).toEqual(['revealed-match', 'terminated']);
  });
  it('I5: the registry exports no way to set a status', () => {
    expect(Object.keys(registry).sort()).toEqual(['ABSENCE_BOUNDARY', 'FINALITY_BLOCKS', 'by_registrant', 'derive_status', 'to_event']);
  });
});
