import { type Plugin } from 'vite';
import { type Network } from '../src/commitment.ts';
import { KoiosTransactions } from '../src/mithril.ts';
import { DEVNET_API, KOIOS_PREPROD } from '../src/readers.ts';
import { ReadProxy, MemoryReadCache, parse_public_query, type PublicQuery } from '../src/read-proxy.ts';

/**
 * Optional development cache. It forwards public reads and returns raw transaction bytes only; it is untrusted like
 * any transport, so the browser verifies everything it returns (I4) and works the same without it.
 */
export function cardano_api_plugin(): Plugin {
  const providers = new Map<Network, import('@meshsdk/core').YaciProvider | import('@meshsdk/core').KoiosProvider>();
  const transactions = new KoiosTransactions(KOIOS_PREPROD);
  const proxy = new ReadProxy({ async read(query) {
    const network = query.network;
    if (query.kind === 'tx') return transactions.get_transaction(query.tx_hash, network);
    let provider = providers.get(network);
    if (!provider) {
      const { YaciProvider, KoiosProvider } = await import('@meshsdk/core');
      provider = network === 'devnet' ? new YaciProvider(DEVNET_API) : new KoiosProvider('preprod');
      providers.set(network, provider);
    }
    if (query.kind === 'protocol') return provider.fetchProtocolParameters();
    if (query.kind === 'utxos') return provider.fetchUTxOs(query.tx_hash);
    throw new Error('Index queries are implemented in step 8.');
  } }, new MemoryReadCache());
  return { name: 'public-cardano-reads', configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname !== '/api/cardano') { next(); return; }
      res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
      if (req.method !== 'GET' || req.headers['content-length'] || req.headers['transfer-encoding']) { res.statusCode = 405; res.end('{}'); return; }
      let query: PublicQuery;
      try {
        query = parse_public_query(url);
        if (query.kind === 'label' || query.kind === 'address') throw new Error('Unsupported query.');
      } catch { res.statusCode = 400; res.end('{}'); return; }
      try { res.end(JSON.stringify(await proxy.read(query))); }
      catch { res.statusCode = 502; res.end(JSON.stringify({ error: 'Public chain read unavailable.' })); }
    });
  } };
}
