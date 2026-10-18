/** Minimal CBOR (RFC 8949) for Cardano transactions: decoding keeps original byte spans, encoding is definite-length and shortest-form. */
export type Cbor = number | bigint | string | Uint8Array | boolean | null | undefined | Cbor[] | CborMap | CborTag;
export class CborMap {
  constructor(readonly entries: [Cbor, Cbor][]) {}
  get(key: number | string): Cbor { return this.entries.find(([k]) => k === key)?.[1]; }
  keys(): Cbor[] { return this.entries.map(([k]) => k); }
}
export class CborTag { constructor(readonly tag: number, readonly value: Cbor) {} }
export interface Span { start: number; end: number; }

const MAX_DEPTH = 64;
const BREAK = Symbol('break');

class Reader {
  offset = 0;
  constructor(private readonly bytes: Uint8Array) {}
  private byte(): number {
    if (this.offset >= this.bytes.length) throw new Error('Truncated CBOR.');
    return this.bytes[this.offset++]!;
  }
  private take(length: number): Uint8Array {
    if (length > this.bytes.length - this.offset) throw new Error('Truncated CBOR.');
    return this.bytes.slice(this.offset, this.offset += length);
  }
  private argument(info: number): number | bigint | null {
    if (info < 24) return info;
    if (info === 31) return null;
    if (info > 27) throw new Error('Reserved CBOR additional information.');
    let value = 0n;
    for (const b of this.take(2 ** (info - 24))) value = (value << 8n) | BigInt(b);
    return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value;
  }
  private length(info: number): number | null {
    const n = this.argument(info);
    if (typeof n === 'bigint') throw new Error('CBOR length too large.');
    return n;
  }
  item(depth = 0): Cbor | typeof BREAK {
    if (depth > MAX_DEPTH) throw new Error('CBOR nesting too deep.');
    const initial = this.byte(), major = initial >> 5, info = initial & 31;
    if (initial === 0xff) return BREAK;
    switch (major) {
      case 0: { const n = this.argument(info); if (n === null) throw new Error('Invalid CBOR integer.'); return n; }
      case 1: {
        const n = this.argument(info); if (n === null) throw new Error('Invalid CBOR integer.');
        const value = -1n - BigInt(n);
        return value >= BigInt(Number.MIN_SAFE_INTEGER) ? Number(value) : value;
      }
      case 2: case 3: {
        const length = this.length(info);
        let bytes: Uint8Array;
        if (length !== null) bytes = this.take(length);
        else {
          const chunks: Uint8Array[] = [];
          for (;;) {
            const chunk = this.item(depth + 1);
            if (chunk === BREAK) break;
            if (major === 2 ? !(chunk instanceof Uint8Array) : typeof chunk !== 'string') throw new Error('Invalid indefinite CBOR string.');
            chunks.push(typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk as Uint8Array);
          }
          bytes = concat(chunks);
        }
        return major === 2 ? bytes : new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      }
      case 4: {
        const length = this.length(info), items: Cbor[] = [];
        for (let i = 0; length === null || i < length; i++) {
          const value = this.item(depth + 1);
          if (value === BREAK) { if (length === null) break; throw new Error('Unexpected CBOR break.'); }
          items.push(value);
        }
        return items;
      }
      case 5: {
        const length = this.length(info), entries: [Cbor, Cbor][] = [], seen = new Set<string>();
        for (let i = 0; length === null || i < length; i++) {
          const key = this.item(depth + 1);
          if (key === BREAK) { if (length === null) break; throw new Error('Unexpected CBOR break.'); }
          const value = this.item(depth + 1);
          if (value === BREAK) throw new Error('Unexpected CBOR break.');
          const id = hex(encode(key));
          if (seen.has(id)) throw new Error('Duplicate CBOR map key.');
          seen.add(id); entries.push([key, value]);
        }
        return new CborMap(entries);
      }
      case 6: {
        const tag = this.argument(info);
        if (typeof tag !== 'number') throw new Error('Invalid CBOR tag.');
        const value = this.item(depth + 1);
        if (value === BREAK) throw new Error('Unexpected CBOR break.');
        return new CborTag(tag, value);
      }
      default:
        if (info === 20) return false;
        if (info === 21) return true;
        if (info === 22) return null;
        if (info === 23) return undefined;
        throw new Error('Unsupported CBOR simple or float value.');
    }
  }
}

function concat(parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}
const hex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');

export function decode(bytes: Uint8Array): Cbor {
  const reader = new Reader(bytes), value = reader.item();
  if (value === BREAK || reader.offset !== bytes.length) throw new Error('Invalid CBOR: expected exactly one item.');
  return value;
}
/** Decodes a top-level array and returns each element with the exact bytes it occupied. */
export function decode_array_spans(bytes: Uint8Array): { value: Cbor; span: Span }[] {
  const reader = new Reader(bytes), initial = bytes[0];
  if (initial === undefined || initial >> 5 !== 4 || (initial & 31) === 31) throw new Error('Expected a definite CBOR array.');
  reader.offset = 1;
  const info = initial & 31;
  let length = info;
  if (info >= 24) {
    if (info > 27) throw new Error('Invalid CBOR array length.');
    length = 0;
    for (let i = 0; i < 2 ** (info - 24); i++) length = length * 256 + (bytes[reader.offset++] ?? NaN);
  }
  const items: { value: Cbor; span: Span }[] = [];
  for (let i = 0; i < length; i++) {
    const start = reader.offset, value = reader.item(1);
    if (value === BREAK) throw new Error('Unexpected CBOR break.');
    items.push({ value, span: { start, end: reader.offset } });
  }
  if (reader.offset !== bytes.length) throw new Error('Trailing bytes after CBOR array.');
  return items;
}

function head(major: number, value: number | bigint): Uint8Array {
  const n = BigInt(value);
  if (n < 0n) throw new Error('Negative CBOR argument.');
  if (n < 24n) return Uint8Array.of((major << 5) | Number(n));
  const size = n < 0x100n ? 1 : n < 0x10000n ? 2 : n < 0x100000000n ? 4 : 8;
  const out = new Uint8Array(1 + size);
  out[0] = (major << 5) | (24 + Math.log2(size));
  for (let i = 0; i < size; i++) out[size - i] = Number((n >> BigInt(8 * i)) & 0xffn);
  return out;
}
export function encode(value: Cbor): Uint8Array {
  if (typeof value === 'number' || typeof value === 'bigint') {
    if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new Error('Only integers are encodable.');
    const n = BigInt(value);
    return n >= 0n ? head(0, n) : head(1, -1n - n);
  }
  if (typeof value === 'string') { const bytes = new TextEncoder().encode(value); return concat([head(3, bytes.length), bytes]); }
  if (value instanceof Uint8Array) return concat([head(2, value.length), value]);
  if (Array.isArray(value)) return concat([head(4, value.length), ...value.map(encode)]);
  if (value instanceof CborMap) return concat([head(5, value.entries.length), ...value.entries.flatMap(([k, v]) => [encode(k), encode(v)])]);
  if (value instanceof CborTag) return concat([head(6, value.tag), encode(value.value)]);
  if (value === false) return Uint8Array.of(0xf4);
  if (value === true) return Uint8Array.of(0xf5);
  if (value === null) return Uint8Array.of(0xf6);
  return Uint8Array.of(0xf7);
}
