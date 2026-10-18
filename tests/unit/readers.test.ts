import { expect, it, vi } from 'vitest';
import evidence from '../../docs/plans/2026-10-01-preregistry-mvp/chain-results.json';
import { DevnetReader, ProxyTransactions, web_reader } from '../../src/readers.ts';
import { KoiosTransactions, MithrilInclusion } from '../../src/mithril.ts';

const HASH = evidence.tx_id;
it('devnet bytes come only from the local signed store, confirmed by the observed Yaci transaction shape', async () => {
  const fetcher = vi.fn(async (url: string | URL | Request) => Response.json(String(url).endsWith('/metadata') ? evidence.metadata_readback : evidence.tx_info));
  const reader = new DevnetReader(new Map([[HASH, 'abcd']]), 'http://127.0.0.1:18080/api/v1', fetcher);
  expect(await reader.get_transaction(HASH, 'devnet')).toEqual({ cbor: 'abcd' });
  expect(await reader.get_transaction('0'.repeat(64), 'devnet')).toBeNull();
  expect(await reader.get_transaction(HASH, 'preprod')).toBeNull();
  expect(await reader.get_inclusion(HASH)).toEqual({ status: 'local', trust: 'local-node', time: new Date(evidence.metadata_readback[0]!.block_time * 1000).toISOString() });
  expect(fetcher).toHaveBeenCalledWith(`http://127.0.0.1:18080/api/v1/txs/${HASH}`, expect.anything());
  const missing = new DevnetReader(new Map([[HASH, 'abcd']]), 'http://x', async () => new Response('', { status: 404 }));
  await expect(missing.get_inclusion(HASH)).rejects.toThrow('does not have this transaction');
});
it.each([{ hash: 'c'.repeat(64) }, { invalid: true }, { slot: 0 }])('devnet rejects an inconsistent indexed transaction: %j', async overrides => {
  const reader = new DevnetReader(new Map([[HASH, 'abcd']]), 'http://x', async url => Response.json(String(url).endsWith('/metadata') ? evidence.metadata_readback : { ...evidence.tx_info, ...overrides }));
  await expect(reader.get_inclusion(HASH)).rejects.toThrow('Invalid local transaction context.');
});
it('Koios and the cache return raw bytes only for the requested hash on preprod', async () => {
  const koios = new KoiosTransactions('https://koios.test/api/v1', async () => Response.json([{ tx_hash: 'b'.repeat(64), cbor: 'ff', tx_timestamp: 1 }]));
  // The transport's timestamp is dropped: time is evidence, not transport data.
  expect(await koios.get_transaction('b'.repeat(64), 'preprod')).toEqual({ cbor: 'ff' });
  expect(await koios.get_transaction('a'.repeat(64), 'preprod')).toBeNull();
  expect(await koios.get_transaction('a'.repeat(64), 'devnet')).toBeNull();
  const proxy = new ProxyTransactions('/api/cardano', async () => Response.json(null));
  expect(await proxy.get_transaction('a'.repeat(64), 'preprod')).toBeNull();
  await expect(new ProxyTransactions('/api/cardano', async () => new Response('', { status: 502 })).get_transaction('a'.repeat(64), 'preprod')).rejects.toThrow('unavailable');
});
it('the web reader dispatches by network and reads nothing for unsupported networks', async () => {
  const reader = web_reader('direct', new Map(), new MithrilInclusion());
  expect(await reader.get_transaction('a'.repeat(64), 'mainnet')).toBeNull();
  expect(await reader.get_transaction('a'.repeat(64), 'devnet')).toBeNull();
});
