import { payload_kind, validate_announcement, validate_payload, validate_termination, type AnnouncementPayload, type CommitmentPayload, type Inclusion, type TerminationPayload } from './chain.ts';
import { type ChainNetwork } from './commitment.ts';
import { slot_time } from './mithril.ts';
import { type VerifiedTransaction } from './transaction.ts';
import { VERIFICATION_BOUNDARY } from './verifier.ts';

/**
 * Blocks after which a Mithril-certified event is treated as final (D19): the security parameter k. Certification
 * trails the tip by about 5 blocks, which is not irreversibility, so statuses resting on shallower events are provisional.
 */
export const FINALITY_BLOCKS: Partial<Record<ChainNetwork, number>> = { preprod: 2160 };
export const ABSENCE_BOUNDARY = 'A status that rests on a transaction not being found (not revealed, overdue, not terminated) only covers what the named source listed up to the named block; anyone can overturn it by supplying the missing transaction with its proof.';

export type RegistrationStatus = 'not-revealed' | 'overdue' | 'revealed-match' | 'revealed-mismatch' | 'files-unavailable' | 'terminated';
/** Result of checking an announced bundle and its files; chain facts are already verified in the events. */
export type RevealCheck = 'match' | 'mismatch' | 'files-unavailable';
export type EventInclusion =
  | { status: 'certified'; slot: number; block_number: number; time: string }
  | { status: 'local'; trust: 'local-node' | 'local-demo'; time: string }
  | { status: 'pending' };
type Payload = CommitmentPayload | AnnouncementPayload | TerminationPayload;
/** A self-verified app transaction: bytes checked by `verify_transaction`, inclusion by the reader's trust root. */
export interface RegistryEvent {
  tx_hash: string;
  network: ChainNetwork;
  /** The witnessed required signer. */
  signer: string;
  payload: Payload;
  inclusion: EventInclusion;
}
export interface ScanBasis { source: string; through_block: number | null; }
/** The trusted "now": the latest certified tip (or the local node's tip on devnet). */
export interface AsOf { time: string; block_number: number | null; }
export interface RegistryInput {
  network: ChainNetwork;
  events: RegistryEvent[];
  /** Keyed by announcement tx hash; required for every counted announcement by the registrant. */
  reveal_checks: ReadonlyMap<string, RevealCheck>;
  scan: ScanBasis;
  as_of: AsOf;
}
export interface HistoryEntry {
  tx_hash: string;
  kind: 'commitment' | 'reveal' | 'terminate';
  time: string | null;
  signer: string;
  /** Why the event does not count: not certified yet, or not signed by the registrant. */
  note: 'pending' | 'signer-mismatch' | null;
}
export interface RevealResult { announcement_tx_hash: string; announced_at: string; check: RevealCheck; late: boolean; }
export interface Registration {
  tx_hash: string;
  network: ChainNetwork;
  registrant: string;
  registrant_bound: boolean;
  commitment_hash: string;
  reveal_deadline: string;
  registered_at: string;
  status: RegistrationStatus;
  /** The reveal used for the status (or shown beside `terminated`). */
  reveal: RevealResult | null;
  late_reveal: boolean;
  terminated_at: string | null;
  /** Some event the status rests on is not yet k blocks deep (D19). */
  provisional: boolean;
  /** Set when the status rests on something not being found (D15). */
  absence: ScanBasis | null;
  /** Other commitments with the same commitment hash (I8). */
  duplicates: string[];
  history: HistoryEntry[];
}
export interface RegistryView {
  network: ChainNetwork;
  as_of: AsOf;
  scan: ScanBasis;
  registrations: Registration[];
  /** Commitments found but not certified yet. */
  pending: string[];
  /** Announcements or terminations whose commitment is not in the events. */
  orphans: HistoryEntry[];
  boundary: string;
  absence_boundary: string;
}

const KINDS = { reveal: 'reveal', terminate: 'terminate' } as const;
const UTC_SECOND = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
/** Turns a verified transaction into an event; null when it carries no app metadata. Throws for an invalid payload. */
export function to_event(tx: VerifiedTransaction, inclusion: Inclusion, network: ChainNetwork): RegistryEvent | null {
  if (tx.metadata === null) return null;
  const kind = payload_kind(tx.metadata);
  const payload: Payload = kind === null ? validate_payload(tx.metadata as never) : kind === 'terminate' ? validate_termination(tx.metadata as never) : validate_announcement(tx.metadata as never);
  if (payload.network !== network) throw new Error(`The payload names ${payload.network}, not the source network ${network}.`);
  // A zone-less deadline would be read in the reader's local time; such a commitment can never match a manifest anyway.
  if (kind === null && !UTC_SECOND.test((payload as CommitmentPayload).reveal_deadline)) throw new Error('The public deadline is not a UTC timestamp.');
  return { tx_hash: tx.tx_hash, network, signer: tx.registrant, payload, inclusion: event_inclusion(inclusion, network) };
}
function event_inclusion(inclusion: Inclusion, network: ChainNetwork): EventInclusion {
  if (inclusion.status === 'pending' && inclusion.trust === 'mithril') return { status: 'pending' };
  if (inclusion.status === 'certified' && inclusion.trust === 'mithril' && network !== 'devnet') {
    return { status: 'certified', slot: inclusion.slot, block_number: inclusion.block_number, time: slot_time(network, inclusion.slot) };
  }
  if (inclusion.status === 'local' && (inclusion.trust === 'local-demo' || (inclusion.trust === 'local-node' && network === 'devnet'))) {
    return { status: 'local', trust: inclusion.trust, time: inclusion.time };
  }
  throw new Error('Unrecognised inclusion evidence for this network.');
}

const kind_of = (e: RegistryEvent): HistoryEntry['kind'] => {
  const kind = payload_kind(e.payload);
  return kind === KINDS.reveal ? 'reveal' : kind === KINDS.terminate ? 'terminate' : 'commitment';
};
const time_of = (e: RegistryEvent) => e.inclusion.status === 'pending' ? null : e.inclusion.time;
/** Chain order: certified slot (or local time), then tx hash, so the result never depends on input order. */
const order = (a: RegistryEvent, b: RegistryEvent) => {
  const ta = time_of(a), tb = time_of(b);
  const pa = ta === null ? Infinity : Date.parse(ta), pb = tb === null ? Infinity : Date.parse(tb);
  return pa !== pb ? (pa < pb ? -1 : 1) : a.tx_hash < b.tx_hash ? -1 : a.tx_hash > b.tx_hash ? 1 : 0;
};
/** The input is a set: the same tx from overlapping scans or a later proof counts once, preferring included evidence. */
function unique(events: RegistryEvent[]): RegistryEvent[] {
  const by_tx = new Map<string, RegistryEvent>();
  for (const e of events) {
    const seen = by_tx.get(e.tx_hash);
    if (!seen || (seen.inclusion.status === 'pending' && e.inclusion.status !== 'pending')) by_tx.set(e.tx_hash, e);
  }
  return [...by_tx.values()];
}
const entry = (e: RegistryEvent, note: HistoryEntry['note']): HistoryEntry => ({ tx_hash: e.tx_hash, kind: kind_of(e), time: time_of(e), signer: e.signer, note });
const not_after = (time: string, deadline: string) => Date.parse(time) <= Date.parse(deadline);

/**
 * Derives every registration's status from verified chain events, reveal checks and the trusted tip (I5). It is the
 * only producer of a status; nothing stores or sets one.
 */
export function derive_status(input: RegistryInput): RegistryView {
  if (input.events.some(e => e.network !== input.network)) throw new Error('Events from another network cannot share a registry view (I9).');
  const events = unique(input.events).sort(order);
  const commitments = events.filter(e => kind_of(e) === 'commitment');
  const counted = commitments.filter(e => e.inclusion.status !== 'pending');
  const followers = new Map<string, RegistryEvent[]>();
  for (const e of events) {
    if (kind_of(e) === 'commitment') continue;
    const target = (e.payload as AnnouncementPayload | TerminationPayload).commitment_tx_hash;
    followers.set(target, [...followers.get(target) ?? [], e]);
  }
  const known = new Set(counted.map(c => c.tx_hash));
  const orphans = events.filter(e => kind_of(e) !== 'commitment' && !known.has((e.payload as AnnouncementPayload).commitment_tx_hash))
    .map(e => entry(e, e.inclusion.status === 'pending' ? 'pending' : null));
  const by_hash = new Map<string, string[]>();
  for (const c of counted) {
    const hash = (c.payload as CommitmentPayload).commitment_hash;
    by_hash.set(hash, [...by_hash.get(hash) ?? [], c.tx_hash]);
  }
  const k = FINALITY_BLOCKS[input.network];
  const shallow = (e: RegistryEvent) => e.inclusion.status === 'certified' &&
    (input.as_of.block_number === null || k === undefined || input.as_of.block_number - e.inclusion.block_number < k);

  const registrations = counted.map((c): Registration => {
    const payload = c.payload as CommitmentPayload;
    const history: HistoryEntry[] = [entry(c, null)];
    const valid: RegistryEvent[] = [];
    for (const e of followers.get(c.tx_hash) ?? []) {
      const note = e.signer !== c.signer ? 'signer-mismatch' : e.inclusion.status === 'pending' ? 'pending' : null;
      history.push(entry(e, note));
      if (note === null) valid.push(e);
    }
    const termination = valid.find(e => kind_of(e) === 'terminate');
    const reveals = valid.filter(e => kind_of(e) === 'reveal').map(e => {
      const check = input.reveal_checks.get(e.tx_hash);
      if (check === undefined) throw new Error(`Missing reveal check for announcement ${e.tx_hash}.`);
      const announced_at = time_of(e)!;
      return { event: e, result: { announcement_tx_hash: e.tx_hash, announced_at, check, late: !not_after(announced_at, payload.reveal_deadline) } };
    });
    // A matching reveal settles the commitment; otherwise the earliest reveal decides (timing follows the reveal used).
    const used = reveals.find(r => r.result.check === 'match') ?? reveals[0];
    let status: RegistrationStatus;
    if (termination) status = 'terminated';
    else if (used) status = used.result.check === 'match' ? 'revealed-match' : used.result.check === 'mismatch' ? 'revealed-mismatch' : 'files-unavailable';
    else status = not_after(input.as_of.time, payload.reveal_deadline) ? 'not-revealed' : 'overdue';
    const rests_on = [c, ...(termination ? [termination] : used ? [used.event] : [])];
    return {
      tx_hash: c.tx_hash, network: c.network, registrant: c.signer, registrant_bound: payload.format_version === 2,
      commitment_hash: payload.commitment_hash, reveal_deadline: payload.reveal_deadline, registered_at: time_of(c)!,
      status, reveal: used?.result ?? null, late_reveal: used?.result.late ?? false,
      terminated_at: termination ? time_of(termination) : null,
      provisional: rests_on.some(shallow),
      // Every status but `terminated` assumes no termination (and possibly no reveal) was missed by the source.
      absence: termination ? null : input.scan,
      duplicates: (by_hash.get(payload.commitment_hash) ?? []).filter(h => h !== c.tx_hash),
      history,
    };
  });
  return {
    network: input.network, as_of: input.as_of, scan: input.scan, registrations,
    pending: commitments.filter(e => e.inclusion.status === 'pending').map(e => e.tx_hash),
    orphans, boundary: VERIFICATION_BOUNDARY, absence_boundary: ABSENCE_BOUNDARY,
  };
}

export function by_registrant(view: RegistryView): Map<string, Registration[]> {
  const groups = new Map<string, Registration[]>();
  for (const r of view.registrations) groups.set(r.registrant, [...groups.get(r.registrant) ?? [], r]);
  return groups;
}
