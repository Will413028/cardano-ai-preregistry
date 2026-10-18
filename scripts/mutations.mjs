import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const logdir = path.join(root, 'test-results', 'mutations');
mkdirSync(logdir, { recursive: true });
const mutations = [
  { name: 'verifier-always-match', file: 'src/verifier.ts', from: 'const matches = hash === payload.commitment_hash && manifest.reveal_deadline === payload.reveal_deadline;', to: 'const matches = true;', args: ['run', 'test:e2e', '--', '--grep', 'register then match'] },
  { name: 'canonical-key-order', file: 'src/manifest.ts', from: 'return jcs(value);', to: 'return JSON.stringify(value);', args: ['test', '--', 'tests/unit/core.test.ts'] },
  { name: 'salt-omitted', file: 'src/commitment.ts', from: '[frame(registrant)] : []), salt, frame', to: '[frame(registrant)] : []), new Uint8Array(), frame', args: ['test', '--', 'tests/unit/core.test.ts'] },
  { name: 'private-metadata-field', file: 'src/registration.ts', from: '[METADATA_LABEL]: validate_public_payload(payload)', to: "[METADATA_LABEL]: { ...validate_public_payload(payload), title: 'private manifest field' }", args: ['test', '--', 'tests/unit/registration.test.ts'] },
  { name: 'fixed-salt', file: 'src/commitment.ts', from: 'return crypto.getRandomValues(new Uint8Array(32));', to: 'return new Uint8Array(32);', args: ['test', '--', 'tests/unit/registration.test.ts'] },
  { name: 'verifier-skips-file-hash', file: 'src/verifier.ts', from: "await sha256(bytes) === file.sha256 ? 'match' : 'mismatch'", to: "'match'", args: ['test', '--', 'tests/unit/disclosure.test.ts', '-t', 'replaced file'] },
  { name: 'verifier-ignores-network', file: 'src/verifier.ts', from: "if (payload.network !== network) return result('network-mismatch',", to: "if (false) return result('network-mismatch',", args: ['test', '--', 'tests/unit/disclosure.test.ts', '-t', 'claimed as mainnet'] },
  { name: 'boundary-removed', file: 'src/verifier.ts', from: 'boundary: VERIFICATION_BOUNDARY, trust_boundary', to: "boundary: '', trust_boundary", args: ['test', '--', 'tests/unit/disclosure.test.ts', '-t', 'verification boundary'] },
  // Step 7b trust model (D13, D14).
  { name: 'witness-signature-skipped', file: 'src/transaction.ts', from: 'ed25519.verify(signature, body_hash, vkey, { zip215: false }) ? [key_hash(vkey)] : []', to: '[key_hash(vkey)]', args: ['test', '--', 'tests/unit/transaction.test.ts', '-t', 'invalid or missing witness'] },
  { name: 'registrant-not-in-preimage', file: 'src/commitment.ts', from: '...(registrant ? [frame(registrant)] : [])', to: '...([] as Uint8Array[])', args: ['test', '--', 'tests/unit/trust.test.ts', '-t', 'copy of the commitment'] },
  { name: 'certificate-chain-unverified', file: 'src/mithril.ts', from: 'certificate = await client.verify_certificate_chain(proof.certificate_hash);', to: 'certificate = unverified;', args: ['test', '--', 'tests/unit/mithril.test.ts', '-t', 'broken certificate chain'] },
  { name: 'time-not-from-slot', file: 'src/verifier.ts', from: 'time: slot_time(network, inclusion.slot)', to: 'time: new Date().toISOString()', args: ['test', '--', 'tests/unit/trust.test.ts', '-t', 'certified slot'] },
  { name: 'proof-root-unchecked', file: 'src/mithril.ts', from: 'return client.verify_message_match_certificate(message, certificate);', to: 'return message !== undefined || true;', args: ['test', '--', 'tests/unit/mithril.test.ts', '-t', 'root is not in the certificate'] },
  { name: 'scripts-accepted', file: 'src/transaction.ts', from: "if (witnesses.keys().some(k => typeof k !== 'number' || !WITNESS_KEYS.has(k))) throw", to: 'if (false) throw', args: ['test', '--', 'tests/unit/transaction.test.ts', '-t', 'run scripts'] },
  // Step 8a relay and carried bytes (D17).
  { name: 'relay-accepts-any-field', file: 'src/relay.ts', from: "for (const key of params.keys()) if (!FIELDS[kind].includes(key)", to: "for (const key of params.keys()) if (false", args: ['test', '--', 'tests/unit/relay.test.ts', '-t', 'whitelisted public fields'] },
  { name: 'carried-bytes-ignored', file: 'src/verifier.ts', from: 'const from_carried = carried !== undefined && verifies(carried, tx_hash);', to: 'const from_carried = false;', args: ['test', '--', 'tests/unit/trust.test.ts', '-t', 'carrying the signed commitment'] },
  { name: 'carried-bytes-imply-inclusion', file: 'src/verifier.ts', from: "return from_carried ? 'unproven' : 'pending';", to: "return 'pending';", args: ['test', '--', 'tests/unit/trust.test.ts', '-t', 'not evidence the transaction is on chain'] },
  { name: 'relayed-funding-hash-unchecked', file: 'src/mesh-wallet.ts', from: 'if (tx.getId() !== tx_hash) throw', to: 'if (false) throw', args: ['test', '--', 'tests/unit/mesh-wallet.test.ts', '-t', 'funding outputs'] },
  // Step 8b registry (D8, D15, D19, I7).
  { name: 'termination-ignored', file: 'src/registry.ts', from: "if (termination) status = 'terminated';", to: "if (false) status = 'terminated';", args: ['test', '--', 'tests/unit/registry.test.ts', '-t', 'termination wins'] },
  { name: 'termination-signer-unchecked', file: 'src/registry.ts', from: "e.signer !== c.signer ? 'signer-mismatch' : e.inclusion", to: 'e.inclusion', args: ['test', '--', 'tests/unit/registry.test.ts', '-t', 'forger cannot terminate'] },
  { name: 'absence-basis-dropped', file: 'src/registry.ts', from: 'absence: termination ? null : input.scan,', to: 'absence: null,', args: ['test', '--', 'tests/unit/registry.test.ts', '-t', 'rest on absence'] },
  { name: 'deadline-exclusive', file: 'src/registry.ts', from: 'Date.parse(time) <= Date.parse(deadline)', to: 'Date.parse(time) < Date.parse(deadline)', args: ['test', '--', 'tests/unit/registry.test.ts', '-t', 'exactly at the deadline'] },
  { name: 'provisional-dropped', file: 'src/registry.ts', from: 'provisional: rests_on.some(shallow),', to: 'provisional: false,', args: ['test', '--', 'tests/unit/registry.test.ts', '-t', 'provisional until'] },
  { name: 'events-not-deduplicated', file: 'src/registry.ts', from: 'const events = unique(input.events).sort(order);', to: 'const events = [...input.events].sort(order);', args: ['test', '--', 'tests/unit/registry.test.ts', '-t', 'as a set'] },
  { name: 'latest-reveal-decides', file: 'src/registry.ts', from: "?? reveals[0];", to: '?? reveals.at(-1);', args: ['test', '--', 'tests/unit/registry.test.ts', '-t', 'earliest reveal decides'] },
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
