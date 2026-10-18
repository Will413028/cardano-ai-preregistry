import { blake2b } from '@noble/hashes/blake2b';
import { ed25519 } from '@noble/curves/ed25519';
import { CborMap, CborTag, decode, decode_array_spans, encode, type Cbor } from './cbor.ts';
import { hex } from './commitment.ts';
import { type Json } from './manifest.ts';

export const METADATA_LABEL = 86741;
export const MAX_TX_BYTES = 16384;
/** Only plain key-signed transfers with metadata: anything that could run a script is rejected. */
const BODY_KEYS = new Set([0, 1, 2, 3, 7, 8, 14, 15]);
const WITNESS_KEYS = new Set([0, 2]);

export interface VerifiedTransaction {
  tx_hash: string;
  /** The single `required_signers` key hash, proven by a valid vkey witness over the body hash. */
  registrant: string;
  /** Label METADATA_LABEL as JSON, or null when the transaction does not carry it. */
  metadata: Json | null;
}

/**
 * `source`: the bytes cannot be the requested transaction as it is on chain (hash, metadata or witnesses do not
 * verify, or they do not parse), so the transport is at fault. `policy`: the transaction itself is not an app transaction.
 */
export class TransactionError extends Error {
  constructor(readonly kind: 'source' | 'policy', message: string) { super(message); }
}
const source = (message: string) => new TransactionError('source', message);
const policy = (message: string) => new TransactionError('policy', message);
const blake256 = (bytes: Uint8Array) => blake2b(bytes, { dkLen: 32 });
const blake224 = (bytes: Uint8Array) => blake2b(bytes, { dkLen: 28 });
export function key_hash(vkey: Uint8Array): string { return hex(blake224(vkey)); }
export function from_hex(value: string, max = MAX_TX_BYTES): Uint8Array {
  if (typeof value !== 'string' || value.length % 2 || value.length > max * 2 || !/^[0-9a-f]*$/i.test(value)) throw new Error('Expected hex transaction bytes.');
  return Uint8Array.from(value.match(/../g) ?? [], s => parseInt(s, 16));
}
const set_items = (value: Cbor): Cbor[] => {
  const inner = value instanceof CborTag && value.tag === 258 ? value.value : value;
  if (!Array.isArray(inner)) throw new Error('Expected a CBOR set.');
  return inner;
};
const bytes_of = (value: Cbor, length: number): Uint8Array => {
  if (!(value instanceof Uint8Array) || value.length !== length) throw new Error(`Expected ${length} bytes.`);
  return value;
};

/** Cardano metadata to JSON: text keys, text, safe integers and lists only; byte strings are not part of the app format. */
export function metadatum_json(value: Cbor): Json {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return value;
  if (Array.isArray(value)) return value.map(metadatum_json);
  if (value instanceof CborMap) {
    const result: { [key: string]: Json } = {};
    for (const [k, v] of value.entries) {
      if (typeof k !== 'string') throw new Error('Unsupported metadata map key.');
      result[k] = metadatum_json(v);
    }
    return result;
  }
  throw new Error('Unsupported metadata value.');
}
export function json_metadatum(value: Json): Cbor {
  if (typeof value === 'string') {
    if (new TextEncoder().encode(value).length > 64) throw new Error('Metadata text exceeds 64 bytes.');
    return value;
  }
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  if (Array.isArray(value)) return value.map(json_metadatum);
  if (value && typeof value === 'object') return new CborMap(Object.entries(value).map(([k, v]) => [json_metadatum(k), json_metadatum(v)]));
  throw new Error('Unsupported metadata value.');
}
function app_metadata(aux: Cbor): Json | null {
  let metadata: Cbor;
  if (aux instanceof CborMap) metadata = aux;
  else if (aux instanceof CborTag && aux.tag === 259 && aux.value instanceof CborMap) {
    if (aux.value.keys().some(k => k !== 0)) throw new Error('Auxiliary scripts are not supported.');
    metadata = aux.value.get(0) ?? new CborMap([]);
  } else if (Array.isArray(aux) && aux.length === 2) {
    if (!Array.isArray(aux[1]) || aux[1].length) throw new Error('Auxiliary scripts are not supported.');
    metadata = aux[0]!;
  } else throw new Error('Unsupported auxiliary data.');
  if (!(metadata instanceof CborMap)) throw new Error('Invalid transaction metadata.');
  const entry = metadata.entries.find(([label]) => label === METADATA_LABEL);
  return entry ? metadatum_json(entry[1]) : null;
}

/**
 * Verifies raw transaction bytes from any source: the body hashes to `tx_hash`, metadata hashes to the body's
 * auxiliary data hash, the transaction runs no script and its single required signer has a valid witness.
 */
export function verify_transaction(cbor_hex: string, tx_hash: string): VerifiedTransaction {
  if (!/^[0-9a-f]{64}$/.test(tx_hash)) throw new Error('Invalid transaction hash.');
  let raw: Uint8Array, parts: ReturnType<typeof decode_array_spans>;
  try { raw = from_hex(cbor_hex); parts = decode_array_spans(raw); } catch (error) { throw source(`Unreadable transaction bytes: ${(error as Error).message}`); }
  if (parts.length !== 4) throw source('Expected a four-part transaction.');
  const [body_part, witness_part, valid_part, aux_part] = parts as [typeof parts[0], typeof parts[0], typeof parts[0], typeof parts[0]];
  const body_hash = blake256(raw.subarray(body_part.span.start, body_part.span.end));
  if (hex(body_hash) !== tx_hash) throw source('Transaction body does not hash to the requested transaction.');
  const body = body_part.value, witnesses = witness_part.value;
  if (!(body instanceof CborMap) || !(witnesses instanceof CborMap)) throw source('Malformed transaction.');
  if (body.keys().some(k => typeof k !== 'number' || !BODY_KEYS.has(k))) throw policy('Transactions with scripts, collateral, certificates or other actions are not supported.');
  // The witness set and validity flag are outside the body hash, so a mismatch there is the transport's doing.
  if (witnesses.keys().some(k => typeof k !== 'number' || !WITNESS_KEYS.has(k))) throw source('Transactions with scripts, redeemers or datums are not supported.');
  if (valid_part.value !== true) throw source('Transaction is not phase-2 valid.');

  let metadata: Json | null = null;
  const aux_hash = body.get(7);
  if (aux_part.value !== null || aux_hash !== undefined) {
    if (aux_part.value === null || aux_hash === undefined) throw source('Auxiliary data and its hash must both be present.');
    if (hex(blake256(raw.subarray(aux_part.span.start, aux_part.span.end))) !== hex(bytes_of(aux_hash, 32))) throw source('Metadata does not match the auxiliary data hash.');
    try { metadata = app_metadata(aux_part.value); } catch (error) { throw policy((error as Error).message); }
  }

  const signers = set_items(body.get(14) ?? []);
  if (signers.length !== 1 || !(signers[0] instanceof Uint8Array) || signers[0].length !== 28) throw policy('Exactly one required signer is expected.');
  const registrant = hex(signers[0]);
  let signed: string[];
  try { signed = valid_signers(witnesses, body_hash); } catch (error) { throw source((error as Error).message); }
  if (!signed.includes(registrant)) throw source('The required signer has no valid witness.');
  return { tx_hash, registrant, metadata };
}
function valid_signers(witnesses: CborMap, body_hash: Uint8Array): string[] {
  return set_items(witnesses.get(0) ?? []).flatMap(witness => {
    if (!Array.isArray(witness) || witness.length !== 2) throw new Error('Malformed vkey witness.');
    const vkey = bytes_of(witness[0]!, 32), signature = bytes_of(witness[1]!, 64);
    return ed25519.verify(signature, body_hash, vkey, { zip215: false }) ? [key_hash(vkey)] : [];
  });
}
/** Key hashes with a valid vkey witness over the body hash, and how many vkey witnesses there are. */
export function vkey_witnesses(cbor_hex: string): { total: number; valid: string[] } {
  const raw = from_hex(cbor_hex), parts = decode_array_spans(raw);
  const [body, witnesses] = parts;
  if (!body || !(witnesses?.value instanceof CborMap)) throw new Error('Malformed transaction.');
  return { total: set_items(witnesses.value.get(0) ?? []).length, valid: valid_signers(witnesses.value, blake256(raw.subarray(body.span.start, body.span.end))) };
}


/** A deterministic, publicly known key for the local demo; its signatures are not chain evidence. */
export interface DemoKey { secret: Uint8Array; vkey: Uint8Array; key_hash: string; }
export function demo_key(name: string): DemoKey {
  const secret = blake256(new TextEncoder().encode('cardano-ai-preregistry local demo key: ' + name));
  const vkey = ed25519.getPublicKey(secret);
  return { secret, vkey, key_hash: key_hash(vkey) };
}
export const DEMO_KEY = demo_key('registrant');
/** Builds and signs a real-format transaction for the local demo so it goes through `verify_transaction`. */
export function build_demo_transaction(payload: Json, signer: DemoKey, input: Uint8Array): { tx_hash: string; cbor: string } {
  const aux = new CborMap([[METADATA_LABEL, json_metadatum(payload)]]);
  const body = new CborMap([[0, [[input, 0]]], [1, []], [2, 0], [7, blake256(encode(aux))], [14, [Uint8Array.from(from_hex(signer.key_hash, 28))]]]);
  const body_hash = blake256(encode(body));
  const witnesses = new CborMap([[0, [[signer.vkey, ed25519.sign(body_hash, signer.secret)]]]]);
  return { tx_hash: hex(body_hash), cbor: hex(encode([body, witnesses, true, aux])) };
}
/** Decodes without verification; only for tests and fixture tooling that must change one field. */
export function decode_transaction(cbor_hex: string): Cbor { return decode(from_hex(cbor_hex)); }
