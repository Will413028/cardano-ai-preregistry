import { describe, expect, it, vi } from 'vitest';
import { public_metadata, sign_and_submit, METADATA_LABEL, type PreparedRegistration, type TransactionInspection } from '../../src/registration.ts';
import { sample_manifest } from '../../src/manifest.ts';
import { type AnnouncementPayload } from '../../src/chain.ts';
import { encode_commitment, hex, new_salt } from '../../src/commitment.ts';

const KEY = 'b'.repeat(56);

const payload = { app: 'cardano-ai-preregistry', format_version: 2, network: 'devnet', commitment_hash: 'a'.repeat(64), reveal_deadline: '2026-12-01T00:00:00Z' } as const;
const prepared: PreparedRegistration = { unsigned_tx: 'unsigned', payload, fee: '200000', registrant: 'b'.repeat(56), tx_hash: 'c'.repeat(64) };
// Witnesses exist only once the wallet has signed.
const view = (tx = 'signed'): TransactionInspection => ({ fee: 200000n, body_hash: prepared.tx_hash, metadata: public_metadata(payload), signer_hashes: [prepared.registrant],
  verified_registrant: tx === 'signed' ? prepared.registrant : null, network_id: 0 });
const wallet = () => ({ getNetworkId: vi.fn(async () => 0), signTx: vi.fn(async () => 'signed'), submitTx: vi.fn(async () => prepared.tx_hash) });

describe('testnet registration', () => {
  it('publishes precisely the public whitelist and no raw salt', async () => {
    const salt = new_salt();
    const p = { ...payload, commitment_hash: await encode_commitment(sample_manifest, salt, 'devnet', KEY) };
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
    expect(await encode_commitment(sample_manifest, a, 'devnet', KEY)).not.toBe(await encode_commitment(sample_manifest, b, 'devnet', KEY));
  });
  it('signs and submits only inspected transaction bytes', async () => {
    const w = wallet();
    expect(await sign_and_submit(prepared, w, view)).toEqual({ tx_hash: prepared.tx_hash, signed_tx: 'signed' });
    expect(w.signTx).toHaveBeenCalledWith('unsigned');
    expect(w.submitTx).toHaveBeenCalledWith('signed');
  });
  it.each([
    ['fee', { fee: 300001n }], ['mainnet', { network_id: 1 }],
    ['metadata', { metadata: { [METADATA_LABEL]: { ...payload, title: 'private' } } }],
    ['identity', { signer_hashes: [] }], ['extra signer', { signer_hashes: [KEY, 'c'.repeat(56)] }],
  ])('stops before signing an invalid %s', async (_name, changed) => {
    const w = wallet();
    await expect(sign_and_submit(prepared, w, tx => ({ ...view(tx), ...changed }))).rejects.toThrow();
    expect(w.signTx).not.toHaveBeenCalled(); expect(w.submitTx).not.toHaveBeenCalled();
  });
  it('rejects changed signed body and fee before submit', async () => {
    for (const changed of [{ body_hash: 'd'.repeat(64) }, { fee: 300001n }]) {
      const w = wallet();
      await expect(sign_and_submit(prepared, w, tx => ({ ...view(tx), ...(tx === 'signed' ? changed : {}) }))).rejects.toThrow();
      expect(w.submitTx).not.toHaveBeenCalled();
    }
  });
  it('refuses to prepare a new registration in the legacy v1 format', async () => {
    const w = wallet();
    await expect(sign_and_submit({ ...prepared, payload: { ...payload, format_version: 1 } }, w, view)).rejects.toThrow('current commitment format');
    expect(w.signTx).not.toHaveBeenCalled();
  });
  it('refuses to submit when the wallet did not sign with the registrant key', async () => {
    const w = wallet();
    await expect(sign_and_submit(prepared, w, tx => ({ ...view(tx), verified_registrant: tx === 'signed' ? 'c'.repeat(56) : null }))).rejects.toThrow('registrant key');
    // Bytes the verifier rejects (e.g. a field outside the app policy) are never submitted either.
    await expect(sign_and_submit(prepared, w, tx => ({ ...view(tx), verified_registrant: null }))).rejects.toThrow('would not verify');
    expect(w.submitTx).not.toHaveBeenCalled();
  });
  it('handles wallet rejection and account network switch without submission', async () => {
    const w = wallet(); w.signTx.mockRejectedValue(new Error('Rejected'));
    await expect(sign_and_submit(prepared, w, view)).rejects.toThrow('Rejected'); expect(w.submitTx).not.toHaveBeenCalled();
    const switched = wallet(); switched.getNetworkId.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
    await expect(sign_and_submit(prepared, switched, view)).rejects.toThrow('network changed');
    expect(switched.submitTx).not.toHaveBeenCalled();
  });
});
describe('testnet disclosure announcement', () => {
  const announcement = { app: 'cardano-ai-preregistry', format_version: 1, kind: 'reveal', network: 'devnet', commitment_tx_hash: 'a'.repeat(64),
    bundle_sha256: 'e'.repeat(64), bundle_url: ['https://files.example.test/bundle.json'] } satisfies AnnouncementPayload;
  const announced: PreparedRegistration = { ...prepared, payload: announcement };
  const announced_view = (tx: string): TransactionInspection => ({ ...view(tx), metadata: public_metadata(announcement) });
  it('signs only the exact announcement metadata', async () => {
    const w = wallet();
    expect((await sign_and_submit(announced, w, announced_view)).tx_hash).toBe(prepared.tx_hash);
    for (const metadata of [public_metadata(payload), { [METADATA_LABEL]: { ...announcement, bundle_sha256: 'f'.repeat(64) } }]) {
      const rejected = wallet();
      await expect(sign_and_submit(announced, rejected, tx => ({ ...announced_view(tx), metadata }))).rejects.toThrow('differs');
      expect(rejected.signTx).not.toHaveBeenCalled();
    }
  });
});
