import { afterEach, describe, expect, it, vi } from 'vitest';
import { MithrilInclusion, slot_time } from '../../src/mithril.ts';
import { LEAF, OTHER_CERT, OTHER_TX, replay, SAMPLE_TX } from './helpers/mithril-replay.ts';

// Real recorded preprod responses; a full certificate chain walk takes 30–60 s in Node (spike-mithril.md).
const SLOW = 180000;
afterEach(() => vi.unstubAllGlobals());

describe('Mithril v2 inclusion against the compiled-in genesis key', () => {
  it('certifies the recorded preprod transaction with its block and slot', async () => {
    vi.stubGlobal('fetch', replay());
    expect(await new MithrilInclusion().get_inclusion(SAMPLE_TX, 'preprod')).toEqual({ status: 'certified', trust: 'mithril', slot: 136492696, block_number: 5300000 });
  }, SLOW);
  it('reports a transaction the aggregator has not certified as pending', async () => {
    vi.stubGlobal('fetch', replay());
    expect(await new MithrilInclusion().get_inclusion('0'.repeat(64), 'preprod')).toEqual({ status: 'pending', trust: 'mithril' });
  });
  it('rejects a proof whose leaf is relabelled as another transaction', async () => {
    // Any proof request gets the recorded sample proof, with its leaf renamed to the requested transaction.
    vi.stubGlobal('fetch', replay((path, body) => path.startsWith('/proof/') ? JSON.parse(JSON.stringify(body).replaceAll(SAMPLE_TX, OTHER_TX)) : body, undefined, false));
    await expect(new MithrilInclusion().get_inclusion(OTHER_TX, 'preprod')).rejects.toThrow();
  }, SLOW);
  it('rejects a proof whose root is not in the certificate it names, even though that certificate chain is valid', async () => {
    vi.stubGlobal('fetch', replay((path, body) => path.startsWith('/proof/') ? { ...body, certificate_hash: OTHER_CERT } : body));
    await expect(new MithrilInclusion().get_inclusion(SAMPLE_TX, 'preprod')).rejects.toThrow('does not match its certificate');
  }, SLOW);
  it('rejects a broken certificate chain', async () => {
    let certificates = 0;
    vi.stubGlobal('fetch', replay((path, body) => {
      if (!path.startsWith('/certificate/') || path.endsWith(LEAF) || ++certificates !== 3) return body;
      return { ...body, previous_hash: '0'.repeat(64) };
    }));
    await expect(new MithrilInclusion().get_inclusion(SAMPLE_TX, 'preprod')).rejects.toThrow();
  }, SLOW);
  it('has no trust root for networks it is not configured for', async () => {
    await expect(new MithrilInclusion().get_inclusion(SAMPLE_TX, 'preview')).rejects.toThrow('not configured');
  });
});

describe('slot to time uses compiled-in era constants', () => {
  it('matches the time Koios reported for the certified sample, across the Byron to Shelley boundary', () => {
    expect(slot_time('preprod', 136492696)).toBe(new Date(1792175896 * 1000).toISOString());
    expect(slot_time('preprod', 86400)).toBe('2022-06-21T00:00:00.000Z');
    expect(slot_time('preprod', 0)).toBe('2022-06-01T00:00:00.000Z');
    expect(() => slot_time('devnet', 1)).toThrow();
  });
});
