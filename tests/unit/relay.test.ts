import { describe, expect, it } from 'vitest';
import { create_relay, MemoryRelayCache, parse_relay_query, RELAY_ROUTES } from '../../src/relay';

const HASH = 'a'.repeat(64);
const url = (search: string) => new URL('http://localhost/api/cardano?' + search);
function upstream(body = `[{"tx_hash":"${HASH}","cbor":"ff"}]`, status = 200) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetcher = (async (target: string, init?: RequestInit) => { calls.push({ url: target, init }); return new Response(body, { status }); }) as typeof fetch;
  return { calls, fetcher };
}
const get = (search: string, init: RequestInit = {}) => new Request('http://localhost/api/cardano?' + search, init);

describe('relay queries (D17)', () => {
  it('accepts only whitelisted public fields on preprod', () => {
    expect(parse_relay_query(url(`kind=tx&network=preprod&tx_hashes=${HASH},${'b'.repeat(64)}`))).toEqual({ kind: 'tx', network: 'preprod', tx_hashes: [HASH, 'b'.repeat(64)] });
    expect(parse_relay_query(url('kind=label&network=preprod&label=86741'))).toEqual({ kind: 'label', network: 'preprod', label: 86741, offset: 0, limit: 100 });
    expect(parse_relay_query(url('kind=tip&network=preprod'))).toEqual({ kind: 'tip', network: 'preprod' });
    for (const bad of [`kind=tx&network=preprod&tx_hashes=${HASH}&salt=secret`, `kind=tx&network=devnet&tx_hashes=${HASH}`, `kind=tx&network=mainnet&tx_hashes=${HASH}`,
      `kind=tx&network=preprod&tx_hashes=${HASH},${HASH}`, `kind=tx&network=preprod&tx_hashes=${Array.from({ length: 11 }, (_, i) => i.toString(16).padStart(64, '0')).join(',')}`,
      'kind=label&network=preprod&label=674', 'kind=label&network=preprod&label=86741&limit=101', 'kind=utxos&network=preprod', 'kind=protocol&network=preprod',
      `kind=commitment&network=preprod&tx_hash=${HASH}`, 'kind=tip&network=preprod&network=preprod', 'kind=tip&network=__proto__',
      'kind=tip&network=constructor', 'kind=tip&network=toString', 'kind=__proto__&network=preprod']) {
      expect(() => parse_relay_query(url(bad)), bad).toThrow();
    }
  });
  it('has exactly one route, a GET: no write or status route (I5(a), D18)', () => {
    expect(RELAY_ROUTES).toEqual([{ method: 'GET', path: '/api/cardano' }]);
  });
});

describe('relay handler', () => {
  it('forwards to Koios with a fixed order and returns the raw upstream body', async () => {
    const { calls, fetcher } = upstream('[]');
    const relay = create_relay(fetcher);
    const response = await relay(get('kind=label&network=preprod&label=86741&offset=100&limit=50'));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('[]');
    expect(calls[0]!.url).toBe('https://preprod.koios.rest/api/v1/tx_by_metalabel?_label=86741&offset=100&limit=50&order=block_height.asc%2Ctx_hash.asc');
    await relay(get(`kind=tx&network=preprod&tx_hashes=${HASH}`));
    expect(calls[1]).toMatchObject({ url: 'https://preprod.koios.rest/api/v1/tx_cbor', init: { method: 'POST', body: JSON.stringify({ _tx_hashes: [HASH] }) } });
  });
  it('rejects writes, bodies, other paths and private fields', async () => {
    const { calls, fetcher } = upstream();
    const relay = create_relay(fetcher);
    expect((await relay(get('kind=tip&network=preprod', { method: 'POST', body: '{"manifest":"private"}' }))).status).toBe(405);
    expect((await relay(get('kind=tip&network=preprod', { method: 'PATCH' }))).status).toBe(405);
    expect((await relay(get('kind=tip&network=preprod', { headers: { 'content-length': '5' } }))).status).toBe(405);
    expect((await relay(new Request('http://localhost/api/cardano/status?kind=tip&network=preprod'))).status).toBe(404);
    expect((await relay(get('kind=tip&network=preprod&salt=secret'))).status).toBe(400);
    expect(calls).toEqual([]);
  });
  it('serves a repeated or concurrent query from one upstream request; found transactions stay cached longer', async () => {
    let now = 0;
    const { calls, fetcher } = upstream();
    const relay = create_relay(fetcher, new MemoryRelayCache(16, () => now));
    const query = `kind=tx&network=preprod&tx_hashes=${HASH}`;
    const [a, b] = await Promise.all([relay(get(query)), relay(get(query))]);
    expect([await a.text(), await b.text()]).toEqual([`[{"tx_hash":"${HASH}","cbor":"ff"}]`, `[{"tx_hash":"${HASH}","cbor":"ff"}]`]);
    await relay(get(query));
    expect(calls).toHaveLength(1);
    now = 60000; await relay(get(query)); expect(calls).toHaveLength(1);
    now = 600001; await relay(get(query)); expect(calls).toHaveLength(2);
  });
  it('keeps a batch with a missing hash only briefly', async () => {
    let now = 0;
    const { calls, fetcher } = upstream();
    const relay = create_relay(fetcher, new MemoryRelayCache(16, () => now));
    const query = `kind=tx&network=preprod&tx_hashes=${HASH},${'b'.repeat(64)}`;
    await relay(get(query));
    now = 15001; await relay(get(query));
    expect(calls).toHaveLength(2);
  });
  it('does not keep "not found yet" or failures for long', async () => {
    let now = 0, status = 502;
    const calls: string[] = [];
    const fetcher = (async (target: string) => { calls.push(target); return new Response('[]', { status }); }) as typeof fetch;
    const relay = create_relay(fetcher, new MemoryRelayCache(16, () => now));
    const query = `kind=tx&network=preprod&tx_hashes=${HASH}`;
    expect((await relay(get(query))).status).toBe(502);
    status = 200;
    expect((await relay(get(query))).status).toBe(200);
    expect(calls).toHaveLength(2);
    now = 15001; await relay(get(query)); expect(calls).toHaveLength(3);
  });
});
