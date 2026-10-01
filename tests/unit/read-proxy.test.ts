import { expect, it } from 'vitest';
import { MemoryReadCache, parse_public_query, ReadProxy, type PublicQuery } from '../../src/read-proxy';

const query: PublicQuery = { kind: 'commitment', network: 'preprod', tx_hash: 'a'.repeat(64) };
it('allows only public fields, fixed networks and bounded pagination', () => {
  const url = (search: string) => new URL('http://localhost/api/read?' + search);
  expect(parse_public_query(url('kind=commitment&network=preprod&tx_hash=' + 'a'.repeat(64)))).toEqual(query);
  for (const extra of ['&salt=secret', '&manifest=secret', '&url=https://attacker.test', '&network=devnet']) {
    expect(() => parse_public_query(url('kind=commitment&network=preprod&tx_hash=' + 'a'.repeat(64) + extra))).toThrow();
  }
  expect(() => parse_public_query(url('kind=label&network=preprod&label=674'))).toThrow();
  expect(() => parse_public_query(url('kind=label&network=preprod&label=65536&limit=101'))).toThrow();
});
it('shares a cached response and deduplicates concurrent reads, then expires it', async () => {
  let calls = 0, now = 0;
  const proxy = new ReadProxy({ async read() { calls++; return { data: ['public'] }; } }, new MemoryReadCache(100, 2, () => now));
  const values = await Promise.all([proxy.read(query), proxy.read(query)]);
  expect(calls).toBe(1);
  (values[0] as { data: string[] }).data.push('mutation');
  expect(await proxy.read(query)).toEqual({ data: ['public'] }); expect(calls).toBe(1);
  now = 100; await proxy.read(query); expect(calls).toBe(2);
});
it('does not cache failures or mix networks and evicts bounded cache entries', async () => {
  let calls = 0;
  const proxy = new ReadProxy({ async read() { calls++; if (calls === 1) throw new Error('unavailable'); return calls; } }, new MemoryReadCache(1000, 1));
  await expect(proxy.read(query)).rejects.toThrow();
  expect(await proxy.read(query)).toBe(2);
  expect(await proxy.read({ ...query, network: 'devnet' })).toBe(3);
  expect(await proxy.read(query)).toBe(4);
});
