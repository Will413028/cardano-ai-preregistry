import { describe, expect, it } from 'vitest';
import { CborMap, CborTag, decode, encode } from '../../src/cbor.ts';
import { demo_key, verify_transaction, vkey_witnesses, decode_transaction } from '../../src/transaction.ts';
import { hex } from '../../src/commitment.ts';
import devnet from '../fixtures/chain/devnet-v1.json';
import preprod from '../fixtures/chain/preprod-koios-tx-cbor.json';
import { build_tx, replace_part } from './helpers/tx.ts';

const alice = demo_key('alice'), bob = demo_key('bob');
const payload = { app: 'cardano-ai-preregistry', format_version: 2, network: 'preprod', commitment_hash: 'a'.repeat(64), reveal_deadline: '2030-01-01T00:00:00Z' };

describe('self-verification of raw transaction bytes', () => {
  it('verifies real devnet transactions: body hash, metadata hash and the registrant witness', () => {
    const commitment = verify_transaction(devnet.commitment.cbor, devnet.commitment.tx_hash);
    const announcement = verify_transaction(devnet.announcement.cbor, devnet.announcement.tx_hash);
    expect(commitment.registrant).toBe(announcement.registrant);
    expect(commitment.metadata).toMatchObject({ format_version: 1, network: 'devnet' });
    expect(announcement.metadata).toMatchObject({ kind: 'reveal', commitment_tx_hash: devnet.commitment.tx_hash });
  });
  it('rejects bytes whose body does not hash to the requested transaction', () => {
    expect(() => verify_transaction(devnet.commitment.cbor, devnet.announcement.tx_hash)).toThrow('does not hash');
  });
  it('rejects changed metadata when the body is unchanged', () => {
    const changed = replace_part(devnet.commitment.cbor, 3, new CborMap([[86741, new CborMap([['app', 'cardano-ai-preregistry'], ['format_version', 1]])]]));
    expect(() => verify_transaction(changed, devnet.commitment.tx_hash)).toThrow('auxiliary data hash');
  });
  it('rejects an invalid or missing witness for the required signer', () => {
    const tx = build_tx({ payload, signers: [alice] });
    const [, witnesses] = decode_transaction(tx.cbor) as [unknown, CborMap];
    const [[vkey, signature]] = witnesses.get(0) as [Uint8Array, Uint8Array][];
    const flipped = Uint8Array.from(signature!); flipped[0]! ^= 1;
    expect(() => verify_transaction(replace_part(tx.cbor, 1, new CborMap([[0, [[vkey!, flipped]]]])), tx.tx_hash)).toThrow('no valid witness');
    expect(() => verify_transaction(replace_part(tx.cbor, 1, new CborMap([])), tx.tx_hash)).toThrow('no valid witness');
    // A valid signature by a key other than the required signer does not count.
    const other = build_tx({ payload, signers: [bob], required: [alice.key_hash] });
    expect(() => verify_transaction(other.cbor, other.tx_hash)).toThrow('no valid witness');
  });
  it('requires exactly one required signer', () => {
    for (const signers of [[], [alice, bob]]) {
      const tx = build_tx({ payload, signers });
      expect(() => verify_transaction(tx.cbor, tx.tx_hash)).toThrow('Exactly one required signer');
    }
    // Conway wallets may encode the signer set with tag 258.
    const tagged = build_tx({ payload, signers: [alice], tagged: true });
    expect(verify_transaction(tagged.cbor, tagged.tx_hash).registrant).toBe(alice.key_hash);
  });
  it('rejects transactions that run scripts or post collateral', () => {
    const native_script = build_tx({ payload, signers: [alice], witnesses: [[1, [[0, alice.key_hash]]]] });
    expect(() => verify_transaction(native_script.cbor, native_script.tx_hash)).toThrow('scripts');
    const collateral = build_tx({ payload, signers: [alice], body: [[13, [[new Uint8Array(32), 1]]]] });
    expect(() => verify_transaction(collateral.cbor, collateral.tx_hash)).toThrow('collateral');
    for (const row of preprod) expect(() => verify_transaction(row.cbor, row.tx_hash)).toThrow('scripts');
    const invalid = build_tx({ payload, signers: [alice], valid: false });
    expect(() => verify_transaction(invalid.cbor, invalid.tx_hash)).toThrow('phase-2');
  });
  it('counts and verifies every witness of real preprod transactions', () => {
    for (const row of preprod) {
      const { total, valid } = vkey_witnesses(row.cbor);
      expect(total).toBeGreaterThan(0); expect(valid).toHaveLength(total);
    }
  });
});

describe('CBOR reader', () => {
  it('round-trips definite items and decodes indefinite ones, tags and duplicate-key maps', () => {
    const value = [1, -2, 2n ** 64n - 1n, 'text', Uint8Array.of(1, 2), new CborTag(258, [Uint8Array.of(3)]), true, null];
    expect(encode(decode(encode(value)))).toEqual(encode(value));
    expect(decode(Uint8Array.of(0x9f, 0x01, 0x02, 0xff))).toEqual([1, 2]);
    expect(decode(Uint8Array.of(0x5f, 0x41, 0x01, 0x41, 0x02, 0xff))).toEqual(Uint8Array.of(1, 2));
    expect(() => decode(Uint8Array.of(0xa2, 0x01, 0x01, 0x01, 0x02))).toThrow('Duplicate');
    expect(() => decode(Uint8Array.of(0x82, 0x01))).toThrow('Truncated');
    expect(() => decode(Uint8Array.of(0x01, 0x01))).toThrow('exactly one');
    expect(() => decode(Uint8Array.of(0xf9, 0x00, 0x00))).toThrow();
    expect(hex(encode(new CborMap([[0, 1]])))).toBe('a10001');
  });
});
