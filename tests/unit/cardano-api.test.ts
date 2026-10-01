import { afterEach, expect, test, vi } from 'vitest';
import { core } from '@meshsdk/core';
import evidence from '../../docs/plans/2026-10-01-preregistry-mvp/chain-results.json';
import { read_commitment } from '../../scripts/cardano-api.ts';
import { METADATA_LABEL } from '../../src/registration.ts';
const expected_registrant = core.resolvePaymentKeyHash(evidence.tx_info.inputs[0]!.address);

afterEach(() => vi.unstubAllGlobals());
test.each([{ hash: 'c'.repeat(64) }, { invalid: true }, { slot: 0 }])('devnet rejects an inconsistent or invalid indexed transaction: %j', async overrides => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url.endsWith('/metadata')
    ? [{ ...evidence.metadata_readback[0], label: String(METADATA_LABEL), json_metadata: { app: 'cardano-ai-preregistry', format_version: 1, network: 'devnet', commitment_hash: 'a'.repeat(64), reveal_deadline: '2030-01-01T00:00:00Z' } }]
    : { ...evidence.tx_info, ...overrides })));
  await expect(read_commitment('devnet', evidence.tx_id)).rejects.toThrow('Invalid transaction context.');
});
test('devnet reads the observed Yaci transaction and metadata response shapes', async () => {
  const payload = { app: 'cardano-ai-preregistry', format_version: 1, network: 'devnet',
    commitment_hash: 'a'.repeat(64), reveal_deadline: '2030-01-01T00:00:00Z' };
  const fetcher = vi.fn(async (url: string) => {
    if (url.endsWith('/metadata')) return Response.json([{ ...evidence.metadata_readback[0], label: String(METADATA_LABEL), json_metadata: payload }]);
    if (url.endsWith('/' + evidence.tx_id)) return Response.json(evidence.tx_info);
    return new Response('', { status: 404 });
  });
  vi.stubGlobal('fetch', fetcher);
  const record = await read_commitment('devnet', evidence.tx_id);
  expect(record).toMatchObject({ ...payload, tx_hash: evidence.tx_id, registrant: expected_registrant,
    block_time: new Date(evidence.metadata_readback[0]!.block_time * 1000).toISOString() });
  expect(fetcher).toHaveBeenCalledTimes(2);
});
