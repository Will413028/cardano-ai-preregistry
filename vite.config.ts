import { defineConfig } from 'vite';
import { relay_plugin } from './scripts/relay-plugin.ts';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig({
  plugins: [nodePolyfills({ globals: { Buffer: false, global: false, process: false } }), relay_plugin()],
  // Known up front so the dev server does not re-optimize and reload a page mid-test; the wasm-pack package must stay
  // unbundled because it loads its .wasm file relative to import.meta.url.
  optimizeDeps: { include: ['@noble/curves/ed25519', '@noble/hashes/blake2b'], exclude: ['@mithril-dev/mithril-client-wasm'] },
  server: { fs: { deny: ['.env', '.env.*', '**/.git/**', '**/*.{skey,vkey,key,pem,crt}', '**/spikes/**/local/**', '**/spikes/**/.venv/**'] } },
});
