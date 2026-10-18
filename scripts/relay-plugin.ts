import { type Plugin } from 'vite';
import { type IncomingMessage, type ServerResponse } from 'node:http';
import { create_relay, RELAY_PATH } from '../src/relay.ts';

/** Serves the same relay handler as the deployed function under `vite` and `vite preview` (D17). */
export function relay_plugin(upstream: typeof fetch = (...args) => fetch(...args)): Plugin {
  const relay = create_relay(upstream);
  const middleware = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== RELAY_PATH) { next(); return; }
    const headers = new Headers();
    for (const name of ['content-length', 'transfer-encoding']) { const value = req.headers[name]; if (typeof value === 'string') headers.set(name, value); }
    // Methods Node's Request refuses (e.g. TRACE) must not reach its constructor; the handler answers 405 for the rest.
    const method = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(req.method ?? '') ? req.method! : 'POST';
    const response = await relay(new Request(url, { method, headers }));
    res.statusCode = response.status;
    response.headers.forEach((value, name) => res.setHeader(name, value));
    res.end(await response.text());
  };
  return {
    name: 'cardano-relay',
    configureServer(server) { server.middlewares.use(middleware); },
    configurePreviewServer(server) { server.middlewares.use(middleware); },
  };
}
