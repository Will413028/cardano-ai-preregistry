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
  { name: 'salt-omitted', file: 'src/commitment.ts', from: 'frame(utf8(network)), salt, frame', to: 'frame(utf8(network)), new Uint8Array(), frame', args: ['test', '--', 'tests/unit/core.test.ts'] },
  { name: 'private-metadata-field', file: 'src/registration.ts', from: '[METADATA_LABEL]: validate_public_payload(payload)', to: "[METADATA_LABEL]: { ...validate_public_payload(payload), title: 'private manifest field' }", args: ['test', '--', 'tests/unit/registration.test.ts'] },
  { name: 'fixed-salt', file: 'src/commitment.ts', from: 'return crypto.getRandomValues(new Uint8Array(32));', to: 'return new Uint8Array(32);', args: ['test', '--', 'tests/unit/registration.test.ts'] },
  { name: 'verifier-skips-file-hash', file: 'src/verifier.ts', from: "await sha256(bytes) === file.sha256 ? 'match' : 'mismatch'", to: "'match'", args: ['test', '--', 'tests/unit/disclosure.test.ts', '-t', 'replaced file'] },
  { name: 'verifier-ignores-network', file: 'src/verifier.ts', from: "if (record.network !== reveal.network) return result('network-mismatch',", to: "if (false) return result('network-mismatch',", args: ['test', '--', 'tests/unit/disclosure.test.ts', '-t', 'claimed as mainnet'] },
  { name: 'boundary-removed', file: 'src/verifier.ts', from: 'boundary: VERIFICATION_BOUNDARY, self_reported', to: "boundary: '', self_reported", args: ['test', '--', 'tests/unit/disclosure.test.ts', '-t', 'verification boundary'] },
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
    const evidence = mutation.name === 'verifier-always-match' ? /mismatch|toBeVisible/ : /AssertionError|expected.*to be|Snapshot .* mismatched/;
    if (!evidence.test(run.stdout + run.stderr)) throw new Error('Failure was not a behavioral assertion: ' + mutation.name);
    console.log('KILLED: ' + mutation.name);
  } finally { writeFileSync(file, original); }
}
