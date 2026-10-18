import { blake2b } from '@noble/hashes/blake2b';
import { ed25519 } from '@noble/curves/ed25519';
import { CborMap, CborTag, decode_array_spans, encode, type Cbor } from '../../../src/cbor.ts';
import { hex } from '../../../src/commitment.ts';
import { from_hex, json_metadatum, METADATA_LABEL, type DemoKey } from '../../../src/transaction.ts';
import { type Json } from '../../../src/manifest.ts';

/** Builds a signed transaction with arbitrary body and witness fields, for adversarial cases. */
export function build_tx(options: { payload: Json; signers: DemoKey[]; required?: string[]; body?: [number, Cbor][]; witnesses?: [number, Cbor][]; valid?: boolean; tagged?: boolean }) {
  const aux = new CborMap([[METADATA_LABEL, json_metadatum(options.payload)]]);
  const required = (options.required ?? options.signers.map(s => s.key_hash)).map(h => from_hex(h, 28));
  const body = new CborMap([[0, [[new Uint8Array(32).fill(7), 0]]], [1, []], [2, 170000], [7, blake2b(encode(aux), { dkLen: 32 })], [14, options.tagged ? new CborTag(258, required) : required], ...(options.body ?? [])]);
  const body_hash = blake2b(encode(body), { dkLen: 32 });
  const witnesses = new CborMap([[0, options.signers.map(s => [s.vkey, ed25519.sign(body_hash, s.secret)])], ...(options.witnesses ?? [])]);
  return { tx_hash: hex(body_hash), cbor: hex(encode([body, witnesses, options.valid ?? true, aux])) };
}
/** Replaces one top-level part of a transaction while keeping the other parts' original bytes. */
export function replace_part(cbor: string, index: number, value: Cbor): string {
  const raw = from_hex(cbor), parts = decode_array_spans(raw);
  return hex(raw.subarray(0, parts[0]!.span.start)) + parts.map((p, i) => i === index ? hex(encode(value)) : hex(raw.subarray(p.span.start, p.span.end))).join('');
}
/** A plain transfer paying `lovelace` to `address_bytes` at output 0: the wallet's funding transaction as an indexer serves it. */
export function funding_transaction(address_bytes: Uint8Array, lovelace: number, seed = 1) {
  const body = new CborMap([[0, [[new Uint8Array(32).fill(seed), 0]]], [1, [[address_bytes, lovelace]]], [2, 170000]]);
  return { tx_hash: hex(blake2b(encode(body), { dkLen: 32 })), cbor: hex(encode([body, new CborMap([]), true, null])) };
}
