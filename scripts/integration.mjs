import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// Explicit opt-in sends one transaction only to the authorized local devnet.
if (process.env.PREREGISTRY_DEVNET === '1') {
  const result = spawnSync(process.execPath, ['--experimental-transform-types', fileURLToPath(new URL('./register-devnet.ts', import.meta.url))], { stdio: 'inherit', timeout: 300000 });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}
// Default remains a public read-only smoke test.
const url = 'https://preprod.koios.rest/api/v1/tx_by_metalabel?_label=123456789&limit=1';
const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
if (!response.ok) throw new Error('Koios HTTP ' + response.status);
const rows = await response.json();
if (!Array.isArray(rows) || rows.some(row => !/^[0-9a-f]{64}$/.test(row.tx_hash))) throw new Error('Unexpected Koios response.');
console.log('Koios preprod read-only smoke passed. Existing public sample; not an application commitment.');
