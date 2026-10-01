import { describe, expect, it, vi } from 'vitest';
import { public_metadata, sign_and_submit, METADATA_LABEL, type PreparedRegistration, type TransactionInspection } from '../../src/registration.ts';
import { sample_manifest } from '../../src/manifest.ts';
import { encode_commitment, hex, new_salt } from '../../src/commitment.ts';

const payload = { app: 'cardano-ai-preregistry', format_version: 1, network: 'devnet', commitment_hash: 'a'.repeat(64), reveal_deadline: '2026-12-01T00:00:00Z' } as const;
const prepared: PreparedRegistration = { unsigned_tx: 'unsigned', payload, fee: '200000', registrant: 'b'.repeat(56), tx_hash: 'c'.repeat(64) };
const view = (): TransactionInspection => ({ fee: 200000n, body_hash: prepared.tx_hash, metadata: public_metadata(payload), signer_hashes: [prepared.registrant], network_id: 0 });
const wallet = () => ({ getNetworkId: vi.fn(async () => 0), signTx: vi.fn(async () => 'signed'), submitTx: vi.fn(async () => prepared.tx_hash) });

describe('testnet registration', () => {
  it('publishes precisely the public whitelist and no raw salt', async () => {
    const salt = new_salt();
    const p = { ...payload, commitment_hash: await encode_commitment(sample_manifest, salt, 'devnet') };
    const metadata = public_metadata(p);
    expect(Object.keys(metadata)).toEqual([String(METADATA_LABEL)]);
    expect(Object.keys(metadata[METADATA_LABEL]!)).toEqual(['app', 'format_version', 'network', 'commitment_hash', 'reveal_deadline']);
    expect(JSON.stringify(metadata)).not.toContain(hex(salt));
    expect(JSON.stringify(metadata)).not.toContain(sample_manifest.title);
    expect(() => public_metadata({ ...p, title: sample_manifest.title } as typeof p)).toThrow();
  });
  it('creates fresh salt and hash for every identical plan', async () => {
    const a = new_salt(), b = new_salt();
    expect(hex(a)).not.toBe(hex(b));
    expect(await encode_commitment(sample_manifest, a, 'devnet')).not.toBe(await encode_commitment(sample_manifest, b, 'devnet'));
  });
  it('signs and submits only inspected transaction bytes', async () => {
    const w = wallet();
    expect(await sign_and_submit(prepared, w, view)).toBe(prepared.tx_hash);
    expect(w.signTx).toHaveBeenCalledWith('unsigned');
    expect(w.submitTx).toHaveBeenCalledWith('signed');
  });
  it.each([
    ['fee', { fee: 300001n }], ['mainnet', { network_id: 1 }],
    ['metadata', { metadata: { [METADATA_LABEL]: { ...payload, title: 'private' } } }],
    ['identity', { signer_hashes: [] }],
  ])('stops before signing an invalid %s', async (_name, changed) => {
    const w = wallet();
    await expect(sign_and_submit(prepared, w, () => ({ ...view(), ...changed }))).rejects.toThrow();
    expect(w.signTx).not.toHaveBeenCalled(); expect(w.submitTx).not.toHaveBeenCalled();
  });
  it('rejects changed signed body and fee before submit', async () => {
    for (const changed of [{ body_hash: 'd'.repeat(64) }, { fee: 300001n }]) {
      const w = wallet();
      await expect(sign_and_submit(prepared, w, tx => ({ ...view(), ...(tx === 'signed' ? changed : {}) }))).rejects.toThrow();
      expect(w.submitTx).not.toHaveBeenCalled();
    }
  });
  it('handles wallet rejection and account network switch without submission', async () => {
    const w = wallet(); w.signTx.mockRejectedValue(new Error('Rejected'));
    await expect(sign_and_submit(prepared, w, view)).rejects.toThrow('Rejected'); expect(w.submitTx).not.toHaveBeenCalled();
    const switched = wallet(); switched.getNetworkId.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
    await expect(sign_and_submit(prepared, switched, view)).rejects.toThrow('network changed');
    expect(switched.submitTx).not.toHaveBeenCalled();
  });
});
