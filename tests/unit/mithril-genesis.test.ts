import { afterEach, expect, it, vi } from 'vitest';
import { MITHRIL_NETWORKS, MithrilInclusion } from '../../src/mithril.ts';
import { replay, SAMPLE_TX } from './helpers/mithril-replay.ts';

// Separate file so this full chain walk runs in parallel with the one in mithril.test.ts.
afterEach(() => vi.unstubAllGlobals());
it('rejects preprod data served as mainnet, which has a different genesis key', async () => {
  vi.stubGlobal('fetch', replay(undefined, MITHRIL_NETWORKS.mainnet!.aggregator));
  await expect(new MithrilInclusion().get_inclusion(SAMPLE_TX, 'mainnet')).rejects.toThrow();
}, 180000);
