import { describe, expect, it } from 'vitest';
import { canonicalize, parse_json, sample_manifest, validate_manifest } from '../../src/manifest';
import { DOMAIN, encode_bytes, encode_commitment, hex, new_salt, sha256, unhex } from '../../src/commitment';
import { FakeChain, type CommitmentPayload } from '../../src/chain';
import { verify_reveal, VERIFICATION_BOUNDARY, type RevealDraft } from '../../src/verifier';
import spike_vectors from '../fixtures/spike-vectors.json';
import v1_vectors from '../fixtures/commitment-v1.json';

describe('cross-language canonical and commitment vectors', () => {
  for (const vector of spike_vectors) {
    it(vector.id, async () => {
      if ('expected_error' in vector) { expect(() => canonicalize(vector.input)).toThrow(); return; }
      const canonical = canonicalize(vector.input);
      expect(hex(new TextEncoder().encode(canonical))).toBe(vector.canonical_hex);
      const encoded = encode_bytes(canonical, unhex(vector.salt_hex, 32), vector.network, vector.domain_tag, vector.format_version);
      expect(await sha256(encoded)).toBe(vector.expected_hash);
    });
  }
  for (const vector of v1_vectors) {
    it('v1 ' + vector.id, async () => {
      const manifest = validate_manifest(vector.manifest);
      const encoded = encode_bytes(canonicalize(manifest), unhex(vector.salt_hex, 32), vector.network_id);
      expect(hex(encoded)).toBe(vector.encoded_hex);
      expect(await sha256(encoded)).toBe(vector.expected_hash);
    });
  }
  it('canonicalizes integer-looking keys lexically and rejects invalid Unicode/numbers', () => {
    expect(canonicalize({ '2': 2, '10': 10 })).toBe('{"10":10,"2":2}');
    expect(() => canonicalize({ x: '\ud800' })).toThrow();
    expect(() => canonicalize({ x: Infinity })).toThrow();
    expect(() => canonicalize({ x: undefined })).toThrow();
  });
  it('rejects duplicate keys including escaped and nested spellings', () => {
    expect(() => parse_json('{"a":1,"\\u0061":2}')).toThrow('Duplicate');
    expect(() => parse_json('{"x":{"a":1,"a":2}}')).toThrow('Duplicate');
    expect(parse_json('{"__proto__":{"safe":true},"x":[null,false,1e-7]}')).toEqual(JSON.parse('{"__proto__":{"safe":true},"x":[null,false,1e-7]}'));
  });
  it('fixes runs, dataset roles, real deadline and schema fields', () => {
    const m = structuredClone(sample_manifest);
    m.experiments[0].planned_runs = 0;
    expect(() => validate_manifest(m)).toThrow();
    m.experiments[0].planned_runs = 1;
    m.reveal_deadline = '2030-02-30T00:00:00Z';
    expect(() => validate_manifest(m)).toThrow();
    expect(() => validate_manifest({ ...sample_manifest, network: 'preprod' })).toThrow();
    expect(() => validate_manifest({ ...sample_manifest, datasets: [{ ...sample_manifest.datasets[0], role: 'other' }] })).toThrow();
  });
});

async function registered() {
  const chain = new FakeChain();
  const manifest = structuredClone(sample_manifest);
  const salt = new_salt();
  const payload: CommitmentPayload = { app: DOMAIN, format_version: 1, network: 'preprod', commitment_hash: await encode_commitment(manifest, salt, 'preprod'), reveal_deadline: manifest.reveal_deadline };
  const record = await chain.commit(payload);
  const reveal: RevealDraft = { format_version: 1, network: 'preprod', tx_hash: record.tx_hash, manifest, salt_hex: hex(salt) };
  return { chain, payload, record, reveal };
}

describe('fake-chain registration and independent verifier', () => {
  it('matches the original and rejects changed settings, salt, deadline and network', async () => {
    const { chain, reveal } = await registered();
    const match = await verify_reveal(reveal, chain);
    expect(match.status).toBe('match'); expect(match.boundary).toBe(VERIFICATION_BOUNDARY); expect(match.network).toBe('preprod');
    const changed = structuredClone(reveal); changed.manifest.experiments[0].settings.temperature = 0.8;
    expect((await verify_reveal(changed, chain)).status).toBe('mismatch');
    changed.manifest = structuredClone(reveal.manifest); changed.salt_hex = 'b'.repeat(64);
    expect((await verify_reveal(changed, chain)).status).toBe('mismatch');
    expect((await verify_reveal({ ...reveal, network: 'devnet' }, chain)).status).toBe('not-found');
    expect((await verify_reveal({ ...reveal, format_version: 2 }, chain)).status).toBe('invalid');
  });
  it('compares the public deadline even when the manifest hash matches', async () => {
    const { record, reveal } = await registered();
    const reader = { async get_commitment() { return { ...record, reveal_deadline: '2031-01-01T00:00:00Z' }; } };
    expect((await verify_reveal(reveal, reader)).status).toBe('mismatch');
  });
  it('new commitments use fresh salt and domain/network-separated hashes', async () => {
    const a = new_salt(), b = new_salt();
    expect(hex(a)).not.toBe(hex(b));
    expect(await encode_commitment(sample_manifest, a, 'preprod')).not.toBe(await encode_commitment(sample_manifest, b, 'preprod'));
    expect(await encode_commitment(sample_manifest, a, 'preprod')).not.toBe(await encode_commitment(sample_manifest, a, 'devnet'));
  });
  it('public payload contains neither manifest nor salt and records cannot be mutated by readers', async () => {
    const { chain, payload, record, reveal } = await registered();
    expect(Object.keys(payload).sort()).toEqual(['app', 'commitment_hash', 'format_version', 'network', 'reveal_deadline']);
    expect(JSON.stringify(record)).not.toContain(reveal.salt_hex);
    expect(JSON.stringify(record)).not.toContain(reveal.manifest.title);
    await expect(chain.commit({ ...payload, manifest: reveal.manifest } as CommitmentPayload)).rejects.toThrow();
    record.commitment_hash = '0'.repeat(64);
    expect((await verify_reveal(reveal, chain)).status).toBe('match');
  });
  it('always includes the boundary on malformed or missing commitments', async () => {
    const { chain, reveal } = await registered();
    for (const input of [null, { ...reveal, salt_hex: 'broken' }, { ...reveal, tx_hash: '0'.repeat(64) }]) {
      const result = await verify_reveal(input, chain);
      expect(result.status).not.toBe('match'); expect(result.boundary).toBe(VERIFICATION_BOUNDARY);
    }
  });
});
