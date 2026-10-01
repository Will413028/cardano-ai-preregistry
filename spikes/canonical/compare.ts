import fs from 'node:fs';
import { createHash, createHmac } from 'node:crypto';
import { canonicalize } from 'json-canonicalize';
import cbor from 'cbor';
import { blake2b } from '@noble/hashes/blake2.js';
import { hmac } from '@noble/hashes/hmac.js';

type Value = null | boolean | number | string | Value[] | { [key: string]: Value };
type Vector = { input: Value; format: string; construction: string; salt_hex: string; domain_tag: string; format_version: number; network: string };
const frame = (data: Uint8Array): Buffer => {
  const size = Buffer.alloc(4); size.writeUInt32BE(data.length);
  return Buffer.concat([size, data]);
};
function normalize(value: Value): Value {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) throw new Error('unsafe-number: use a decimal string');
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value === 'string' && /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) throw new Error('invalid-unicode');
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [normalize(k), normalize(v)]));
  return value;
}
function encode(v: Vector) {
  const value = normalize(v.input);
  const canonical = (x: Value): Buffer => v.format === 'jcs-sha256' ? Buffer.from(canonicalize(x)) : cbor.encodeCanonical(x);
  const digest = (data: Uint8Array): Buffer => v.format === 'jcs-sha256' ? createHash('sha256').update(data).digest() : Buffer.from(blake2b(data, { dkLen: 32 }));
  const raw = canonical(value);
  const salt = Buffer.from(v.salt_hex, 'hex');
  const version = Buffer.alloc(2); version.writeUInt16BE(v.format_version);
  const prefix = Buffer.concat([frame(Buffer.from(v.domain_tag)), version, frame(Buffer.from(v.network))]);
  let hashed: Buffer;
  if (v.construction === 'concat') hashed = digest(Buffer.concat([prefix, salt, frame(raw)]));
  else if (v.construction === 'hmac') {
    const data = Buffer.concat([prefix, frame(raw)]);
    if (v.format === 'jcs-sha256') hashed = createHmac('sha256', salt).update(data).digest();
    else {
      const hash = blake2b.create({ dkLen: 32 });
      // noble's built-in BLAKE2b defaults to 64 bytes; adapt dkLen to match Python HMAC.
      const fn = Object.assign((d: Uint8Array) => blake2b(d, { dkLen: 32 }), {
        blockLen: hash.blockLen, outputLen: hash.outputLen, create: () => blake2b.create({ dkLen: 32 })
      });
      hashed = Buffer.from(hmac(fn, salt, data));
    }
  } else {
    const fields = Object.keys(value as object).sort();
    let level = fields.map(key => {
      const kb = Buffer.from(key);
      const leafSalt = createHmac('sha256', salt).update(Buffer.concat([Buffer.from('leaf-salt'), frame(kb)])).digest();
      return digest(Buffer.concat([Buffer.from([0]), prefix, leafSalt, frame(kb), frame(canonical((value as Record<string, Value>)[key]))]));
    });
    if (!level.length) level = [digest(Buffer.concat([Buffer.from([2]), prefix, salt]))];
    while (level.length > 1) {
      if (level.length % 2) level.push(level[level.length - 1]);
      const next: Buffer[] = [];
      for (let i = 0; i < level.length; i += 2) next.push(digest(Buffer.concat([Buffer.from([1]), level[i], level[i+1]])));
      level = next;
    }
    const count = Buffer.alloc(4); count.writeUInt32BE(fields.length);
    hashed = digest(Buffer.concat([Buffer.from([3]), prefix, count, level[0]]));
  }
  return { canonical_hex: raw.toString('hex'), expected_hash: hashed.toString('hex') };
}
const vectors: Vector[] = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
process.stdout.write(JSON.stringify(vectors.map(v => {
  try { return encode(v); } catch (err) {
    if ((err as Error).message === 'unsafe-number: use a decimal string') return { expected_error: (err as Error).message };
    throw err;
  }
})));
