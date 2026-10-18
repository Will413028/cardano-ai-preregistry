/**
 * Live, read-only check of the built site (D17, step 8a): `vite build`, then `vite preview`, then a real Chromium page
 * reads preprod through the same-origin relay. Also records that the browser still cannot read Koios directly.
 */
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { blake2b } from '@noble/hashes/blake2b';
import { decode_array_spans } from '../src/cbor.ts';
import { hex } from '../src/commitment.ts';
import { from_hex, METADATA_LABEL } from '../src/transaction.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const SAMPLE = process.argv[2] ?? '';
const PORT = 4391, BASE = `http://127.0.0.1:${PORT}`;
const build = spawnSync('npm', ['run', 'build'], { cwd: root, encoding: 'utf8', timeout: 300000 });
if (build.status !== 0) throw new Error('Build failed:\n' + build.stdout + build.stderr);
const server = spawn(path.join(root, 'node_modules', '.bin', 'vite'), ['preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' });
try {
  for (let i = 0; ; i++) {
    try { if ((await fetch(BASE)).ok) break; } catch { /* not listening yet */ }
    if (i > 100) throw new Error('vite preview did not start.');
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(BASE);
    const reads = await page.evaluate(async ({ sample, label }) => {
      const read = async (url: string, init?: RequestInit) => {
        try { const r = await fetch(url, init); return { status: r.status, body: await r.text() }; } catch (e) { return { status: 0, body: String(e) }; }
      };
      return {
        tip: await read('/api/cardano?kind=tip&network=preprod'),
        label: await read(`/api/cardano?kind=label&network=preprod&label=${label}&limit=10`),
        tx: await read(`/api/cardano?kind=tx&network=preprod&tx_hashes=${sample}`),
        direct: await read('https://preprod.koios.rest/api/v1/tip'),
      };
    }, { sample: SAMPLE, label: METADATA_LABEL });
    const tip = JSON.parse(reads.tip.body) as { block_no: number; abs_slot: number }[];
    if (reads.tip.status !== 200 || !Number.isSafeInteger(tip[0]?.block_no)) throw new Error('Relay tip failed: ' + reads.tip.body.slice(0, 200));
    const listed = JSON.parse(reads.label.body) as { tx_hash: string }[];
    if (reads.label.status !== 200 || !Array.isArray(listed)) throw new Error('Relay label listing failed: ' + reads.label.body.slice(0, 200));
    const [row] = JSON.parse(reads.tx.body) as { tx_hash: string; cbor: string }[];
    if (reads.tx.status !== 200 || row?.tx_hash !== SAMPLE) throw new Error('Relay tx_cbor failed: ' + reads.tx.body.slice(0, 200));
    const raw = from_hex(row.cbor), [body] = decode_array_spans(raw);
    if (hex(blake2b(raw.subarray(body!.span.start, body!.span.end), { dkLen: 32 })) !== SAMPLE) throw new Error('Relayed bytes do not hash to the sample.');
    console.log(JSON.stringify({ built_site: BASE, relay: { tip_block: tip[0]!.block_no, tip_slot: tip[0]!.abs_slot, label: METADATA_LABEL, label_rows: listed.length,
      sample_body_hash_matches: true }, browser_direct_koios: reads.direct.status === 0 ? 'blocked (CORS)' : `status ${reads.direct.status}` }));
  } finally { await browser.close(); }
} finally { server.kill(); }
