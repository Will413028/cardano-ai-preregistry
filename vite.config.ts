import { defineConfig, type Plugin } from 'vite';
import { ReadProxy, MemoryReadCache, fixture_source, parse_public_query } from './src/read-proxy.ts';
import { cardano_api_plugin } from './scripts/cardano-api.ts';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

function read_proxy_plugin(): Plugin {
  const proxy = new ReadProxy(fixture_source, new MemoryReadCache());
  const attach: NonNullable<Plugin['configureServer']> = server => {
    server.middlewares.use(async (req, res, next) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname !== '/api/read') { next(); return; }
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store');
      if (req.method !== 'GET' || req.headers['content-length'] || req.headers['transfer-encoding']) {
        res.statusCode = 405; res.end(JSON.stringify({ error: 'Only body-free GET reads are accepted.' })); return;
      }
      try { res.end(JSON.stringify(await proxy.read(parse_public_query(url)))); }
      catch { res.statusCode = 400; res.end(JSON.stringify({ error: 'Invalid public query.' })); }
    });
  };
  return { name: 'fixture-read-proxy', configureServer: attach };
}

export default defineConfig({
  plugins: [nodePolyfills({ globals: { Buffer: false, global: false, process: false } }), read_proxy_plugin(), cardano_api_plugin()],
  server: { fs: { deny: ['.env', '.env.*', '**/.git/**', '**/*.{skey,vkey,key,pem,crt}', '**/spikes/**/local/**', '**/spikes/**/.venv/**'] } },
});
