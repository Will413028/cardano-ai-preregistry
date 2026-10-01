import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const logdir = path.join(root, 'test-results', 'mutations');
mkdirSync(logdir, { recursive: true });
const mutations = [
  { name: 'verifier-always-match', file: 'src/verifier.ts', from: 'const matches = hash === record.commitment_hash && manifest.reveal_deadline === record.reveal_deadline;', to: 'const matches = true;', args: ['run', 'test:e2e', '--', '--grep', 'register then match'] },
  { name: 'canonical-key-order', file: 'src/manifest.ts', from: 'return jcs(value);', to: 'return JSON.stringify(value);', args: ['test', '--', 'tests/unit/core.test.ts'] },
];
for (const mutation of mutations) {
  const file = path.join(root, mutation.file);
  const original = readFileSync(file, 'utf8');
  if (!original.includes(mutation.from)) throw new Error('Mutation target not found: ' + mutation.name);
  try {
    writeFileSync(file, original.replace(mutation.from, mutation.to));
    const run = spawnSync('npm', mutation.args, { cwd: root, encoding: 'utf8', timeout: 120000 });
    mkdirSync(logdir, { recursive: true });
    writeFileSync(path.join(logdir, mutation.name + '.log'), (run.stdout ?? '') + (run.stderr ?? ''));
    if (run.error || run.status === null || run.status === 0) throw new Error('Mutation not killed by tests: ' + mutation.name);
    const evidence = mutation.name === 'verifier-always-match' ? /mismatch|toBeVisible/ : /AssertionError|expected.*to be/;
    if (!evidence.test(run.stdout + run.stderr)) throw new Error('Failure was not a behavioral assertion: ' + mutation.name);
    console.log('KILLED: ' + mutation.name);
  } finally { writeFileSync(file, original); }
}
