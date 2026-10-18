import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// Explicit opt-in sends one transaction only to the authorized local devnet.
if (process.env.PREREGISTRY_DEVNET === '1') {
  const result = spawnSync(process.execPath, ['--experimental-transform-types', fileURLToPath(new URL('./register-devnet.ts', import.meta.url))], { stdio: 'inherit', timeout: 300000 });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}
// Default remains a public read-only check of an existing, Mithril-certified preprod transaction.
const SAMPLE = '694698814e8a01df5f635d19548d6177800389e3af480a9976f226ee3b12ec93';
const reader = spawnSync(process.execPath, ['--experimental-transform-types', fileURLToPath(new URL('./koios-reader.ts', import.meta.url)), SAMPLE], { stdio: 'inherit', timeout: 300000 });
if (reader.error) throw reader.error;
process.exit(reader.status ?? 1);
