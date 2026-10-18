import './style.css';
import { canonicalize, parse_json, sample_manifest, validate_manifest, type Manifest } from './manifest.ts';
import { DOMAIN, encode_commitment, FORMAT_VERSION, hex, is_network, new_salt, sha256, type Network } from './commitment.ts';
import { FakeChain, type AnnouncementPayload, type ChainReader, type CommitmentPayload } from './chain.ts';
import { verify_announcement, verify_commitment, verify_reveal, with_uploads, VERIFICATION_BOUNDARY, type FileFetcher, type RevealDraft, type Verification } from './verifier.ts';
import { sign_and_submit, type PreparedRegistration, type RegistrationWallet } from './registration.ts';
import { DEMO_KEY } from './transaction.ts';
import { MithrilInclusion } from './mithril.ts';
import { web_reader } from './readers.ts';
import { bundle_bytes, create_bundle, split_url, type DisclosedFile, type ExperimentResult, type RevealBundle } from './disclosure.ts';

function element<T extends HTMLElement>(id: string): T { return document.getElementById(id) as T; }
const manifest_input = element<HTMLTextAreaElement>('manifest');
const reveal_input = element<HTMLTextAreaElement>('reveal');
const commit_button = element<HTMLButtonElement>('commit');
const verify_button = element<HTMLButtonElement>('verify');
const chain = new FakeChain();
let saved_draft: RevealDraft | null = null;
let prepared: PreparedRegistration | null = null;
let connected: RegistrationWallet | null = null;
let phase: 'none' | 'prepared' | 'signing' | 'submitted' | 'uncertain' = 'none';
let busy = false;
const sign_button = element<HTMLButtonElement>('sign-submit');
const read_button = element<HTMLButtonElement>('readback');
function lock_form(locked: boolean) {
  busy = locked;
  manifest_input.readOnly = locked;
  element<HTMLSelectElement>('network').disabled = locked;
  element<HTMLSelectElement>('wallet').disabled = locked;
  element<HTMLButtonElement>('prepare').disabled = locked;
  commit_button.disabled = locked;
}
for (const id of ['manifest', 'network', 'wallet']) element(id).addEventListener(id === 'manifest' ? 'input' : 'change', () => {
  if (!prepared || !read_button.disabled) return;
  prepared = null; connected = null; sign_button.disabled = true;
  phase = 'none';
  element('prepared-summary').textContent = 'Plan or wallet selection changed. Prepare a new registration before signing.';
});
/** Verified certificates persist in this browser, so only the first Mithril check walks the whole chain. */
const mithril = new MithrilInclusion({ cache: true });
/** devnet bytes: the signed transactions this tab submitted (the local indexer keeps no CBOR). */
const devnet_signed = new Map<string, string>();
/** preprod bytes come through this site's relay (Koios sends no CORS headers, D17); devnet reads the local node. */
const live_reader = (): ChainReader => web_reader(devnet_signed, mithril);
async function chain_data() {
  const { web_chain_data } = await import('./mesh-wallet.ts');
  return web_chain_data();
}
/** Shown while a check runs; a cold Mithril chain walk takes about a minute. */
function checking(text = 'Checking transaction bytes and the Mithril certificate chain; the first check can take about a minute.') {
  element('verification').textContent = text;
}
const MAX_FILE_BYTES = 50 * 1024 * 1024;
/** Disclosed files come straight from their own URLs, never through the operator's read route (I4). */
const web_files: FileFetcher = { async fetch(url: string) {
  const response = await fetch(url, { credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(30000) });
  if (!response.ok) return null;
  const bytes = new Uint8Array(await response.arrayBuffer());
  return bytes.length > MAX_FILE_BYTES ? null : bytes;
} };
function results_template(manifest: Manifest): ExperimentResult[] {
  return manifest.experiments.map(e => ({ experiment_id: e.id, completed_runs: e.planned_runs, metrics: Object.fromEntries(e.metrics.map(m => [m.id, null])) }));
}
manifest_input.value = JSON.stringify(sample_manifest, null, 2);
element<HTMLTextAreaElement>('results').value = JSON.stringify(results_template(sample_manifest), null, 2);
element('boundary').textContent = VERIFICATION_BOUNDARY;

commit_button.addEventListener('click', async () => {
  const message = element('commit-message');
  lock_form(true);
  message.textContent = '';
  prepared = null; connected = null; sign_button.disabled = true; read_button.disabled = true;
  phase = 'none';
  element('prepared-summary').textContent = '';
  element<HTMLSelectElement>('verify-source').value = 'local';
  try {
    const manifest = validate_manifest(parse_json(manifest_input.value));
    const network = element<HTMLSelectElement>('network').value as Network;
    const salt = new_salt();
    const payload: CommitmentPayload = {
      app: 'cardano-ai-preregistry', format_version: FORMAT_VERSION, network,
      commitment_hash: await encode_commitment(manifest, salt, network, DEMO_KEY.key_hash), reveal_deadline: manifest.reveal_deadline,
    };
    const tx_hash = await chain.commit(payload);
    saved_draft = { format_version: FORMAT_VERSION, network, tx_hash, manifest, salt_hex: hex(salt) };
    element('public-record').textContent = JSON.stringify({ ...payload, tx_hash, registrant: DEMO_KEY.key_hash, source: 'local demo key, not chain evidence' }, null, 2);
    element('commit-result').hidden = false;
    reveal_input.value = JSON.stringify(saved_draft, null, 2);
    element<HTMLTextAreaElement>('results').value = JSON.stringify(results_template(manifest), null, 2);
    element('verification').textContent = '';
    message.textContent = 'Local commitment created. No data was submitted to Cardano or a server.';
  } catch (error) { message.textContent = error instanceof Error ? error.message : 'Could not create commitment.'; }
  finally { lock_form(false); }
});

function show_verification(result: Verification, extra: string[] = []) {
  const title = document.createElement('h3');
  title.textContent = result.status;
  title.dataset.status = result.status;
  const detail = document.createElement('p'); detail.textContent = result.detail;
  const context = document.createElement('p'); context.className = 'helper';
  context.textContent = [`Network: ${result.network ?? 'unknown'}`, `Commitment time: ${result.block_time ?? 'unavailable'}`,
    ...(result.slot === null ? [] : [`Slot: ${result.slot}`]), `Registrant: ${result.registrant ?? 'unknown'}${result.registrant_bound === false ? ' (not bound by format v1)' : ''}`, ...extra].join(' · ');
  const files = document.createElement('ul'); files.className = 'file-status';
  files.replaceChildren(...result.files.map(f => { const item = document.createElement('li'); item.textContent = `${f.path}: ${f.status}`; return item; }));
  const self_reported = document.createElement('p'); self_reported.className = 'helper'; self_reported.textContent = result.self_reported;
  const boundary = document.createElement('p'); boundary.className = 'helper'; boundary.textContent = result.boundary;
  const trust = document.createElement('p'); trust.className = 'helper'; trust.dataset.trust = result.trust ?? 'none'; trust.textContent = result.trust_boundary ?? '';
  element('verification').replaceChildren(title, detail, context, files, self_reported, boundary, trust);
}
const selected_reader = (): ChainReader => element<HTMLSelectElement>('verify-source').value === 'chain' ? live_reader() : chain;
const file_bytes = async (input: HTMLInputElement) => Promise.all(Array.from(input.files ?? []).map(async f => new Uint8Array(await f.arrayBuffer())));
/** Uploaded bundle and files are served by hash before any URL is tried (I4: any source, checked by hash). */
async function supplied(): Promise<{ bundle: Uint8Array | undefined; files: FileFetcher }> {
  const [bundle] = await file_bytes(element<HTMLInputElement>('verify-bundle-file'));
  return { bundle, files: with_uploads(await file_bytes(element<HTMLInputElement>('verify-files')), web_files) };
}
verify_button.addEventListener('click', async () => {
  verify_button.disabled = true;
  try {
    const { bundle, files } = await supplied();
    const text = bundle ? new TextDecoder('utf-8', { fatal: true }).decode(bundle) : element<HTMLTextAreaElement>('bundle').value;
    checking();
    show_verification(await verify_reveal(parse_json(text), selected_reader(), files));
  }
  catch (error) { element('verification').textContent = error instanceof Error ? error.message : 'Invalid JSON.'; }
  finally { verify_button.disabled = false; }
});
element('verify-announcement').addEventListener('click', async () => {
  const button = element<HTMLButtonElement>('verify-announcement');
  button.disabled = true;
  try {
    const { bundle, files } = await supplied();
    checking();
    const result = await verify_announcement(element<HTMLInputElement>('announcement-tx').value.trim(), element<HTMLSelectElement>('announcement-network').value as Network, selected_reader(), files, bundle);
    show_verification(result, [`Announced: ${result.announced_at ?? 'unavailable'}`, `Announcement signer: ${result.announcement_signer ?? 'unknown'}`]);
  } catch (error) { element('verification').textContent = error instanceof Error ? error.message : String(error); }
  finally { button.disabled = false; }
});

element('download').addEventListener('click', () => {
  if (!saved_draft) return;
  const url = URL.createObjectURL(new Blob([canonicalize(saved_draft)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url; link.download = `private-draft-${saved_draft.tx_hash.slice(0, 12)}.json`; link.click();
  if (!busy && phase === 'prepared' && prepared && saved_draft.tx_hash === prepared.tx_hash) sign_button.disabled = false;
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

element('refresh-wallets').addEventListener('click', async () => {
  try {
    const { installed_wallets } = await import('./mesh-wallet.ts');
    const select = element<HTMLSelectElement>('wallet');
    select.replaceChildren(...installed_wallets().map(w => { const option = document.createElement('option'); option.value = w.id; option.textContent = w.name; return option; }));
    if (!select.options.length) element('commit-message').textContent = 'No CIP-30 wallet found. Install a compatible browser wallet to register on testnet.';
  } catch (error) { element('commit-message').textContent = String(error); }
});
element('prepare').addEventListener('click', async () => {
  lock_form(true);
  prepared = null; connected = null; sign_button.disabled = true; read_button.disabled = true;
  phase = 'none';
  element('commit-result').hidden = true;
  try {
    const name = element<HTMLSelectElement>('wallet').value;
    if (!name) throw new Error('Refresh wallets and select a testnet wallet first.');
    const manifest = validate_manifest(parse_json(manifest_input.value));
    const network = element<HTMLSelectElement>('network').value as Network, salt = new_salt();
    const { connect_wallet, prepare_registration, wallet_registrant } = await import('./mesh-wallet.ts');
    // The registrant key is chosen before hashing, because format v2 binds it into the commitment.
    const wallet = await connect_wallet(name);
    const registrant = await wallet_registrant(wallet);
    const payload: CommitmentPayload = { app: 'cardano-ai-preregistry', format_version: FORMAT_VERSION, network,
      commitment_hash: await encode_commitment(manifest, salt, network, registrant), reveal_deadline: manifest.reveal_deadline };
    prepared = await prepare_registration(payload, registrant, wallet, await chain_data()); connected = wallet;
    phase = 'prepared';
    saved_draft = { format_version: FORMAT_VERSION, network, tx_hash: prepared.tx_hash, manifest, salt_hex: hex(salt) };
    reveal_input.value = JSON.stringify(saved_draft, null, 2);
    element<HTMLSelectElement>('verify-source').value = 'chain';
    element('public-record').textContent = JSON.stringify({ ...payload, tx_hash: prepared.tx_hash, registrant: prepared.registrant, status: 'prepared, not submitted' }, null, 2);
    element('commit-result').hidden = false;
    element('prepared-summary').textContent = `Fee: ${prepared.fee} lovelace. Save your private draft, then approve signing in your wallet.`;
    element('commit-message').textContent = 'Prepared only. No transaction has been submitted.';
  } catch (error) { element('commit-message').textContent = error instanceof Error ? error.message : String(error); }
  finally { lock_form(false); }
});
element('sign-submit').addEventListener('click', async () => {
  if (!prepared || !connected || busy || phase !== 'prepared') return;
  const registration = prepared, wallet = connected;
  phase = 'signing';
  sign_button.disabled = true; lock_form(true);
  try {
    const { inspect_transaction } = await import('./mesh-wallet.ts');
    const { tx_hash: hash, signed_tx } = await sign_and_submit(registration, wallet, inspect_transaction);
    if (registration.payload.network === 'devnet') devnet_signed.set(hash, signed_tx);
    phase = 'submitted';
    // The signed bytes let anyone check this commitment later with Mithril alone, without an indexer (D17).
    if (saved_draft?.tx_hash === hash) { saved_draft = { ...saved_draft, tx_cbor: signed_tx.toLowerCase() }; reveal_input.value = JSON.stringify(saved_draft, null, 2); }
    element('commit-message').textContent = `Submitted ${hash}. Confirmation is pending. Download the private draft again: it now also holds the signed transaction.`;
    read_button.disabled = false;
  } catch (error) {
    phase = 'uncertain';
    element('commit-message').textContent = `${error instanceof Error ? error.message : String(error)} Keep your saved draft and check its transaction hash before retrying.`;
    read_button.disabled = false;
  }
  finally { lock_form(false); }
});
element('readback').addEventListener('click', async () => {
  if (!saved_draft) return;
  const draft = saved_draft, registration = prepared;
  read_button.disabled = true; lock_form(true);
  try {
    element('commit-message').textContent = 'Checking the transaction and its Mithril certificate; the first check can take about a minute.';
    const result = await verify_commitment(draft, live_reader());
    if (result.status === 'not-found') { element('commit-message').textContent = 'Not found yet. Your transaction may still be pending; keep your saved draft.'; return; }
    if (result.status === 'pending') { element('commit-message').textContent = 'On chain, waiting for Mithril certification. Check again in a few minutes; keep your saved draft.'; return; }
    if (result.status === 'unavailable') { element('commit-message').textContent = `${result.detail} Keep your saved draft.`; return; }
    if (result.status !== 'match' || result.registrant !== registration?.registrant) throw new Error('Chain record differs from the prepared registration.');
    element('public-record').textContent = JSON.stringify({ ...registration.payload, tx_hash: draft.tx_hash, registrant: result.registrant, block_time: result.block_time, slot: result.slot, trust: result.trust }, null, 2);
    element('commit-message').textContent = 'Confirmed on the selected test network; commitment hash, registrant and deadline match your private draft.';
  } catch (error) { element('commit-message').textContent = String(error); }
  finally { read_button.disabled = false; lock_form(false); }
});

let disclosed_files: { path: string; sha256: string; url: HTMLInputElement }[] = [];
let created_bundle: RevealBundle | null = null;
let announcement: PreparedRegistration | null = null;
let announcement_wallet: RegistrationWallet | null = null;
let announcing = false;
const sign_announcement = element<HTMLButtonElement>('sign-announcement');
const announce_controls = ['create-bundle', 'announce-local', 'prepare-announcement'].map(id => element<HTMLButtonElement>(id));
function reset_announcement() { announcement = null; announcement_wallet = null; sign_announcement.disabled = true; }
/** One announcement action at a time, so a pending signature cannot be replaced or duplicated. */
async function exclusive(action: () => Promise<void>) {
  if (announcing) return;
  announcing = true; sign_announcement.disabled = true;
  announce_controls.forEach(b => { b.disabled = true; }); element<HTMLInputElement>('bundle-url').readOnly = true;
  try { await action(); } finally {
    announcing = false; sign_announcement.disabled = !announcement;
    announce_controls.forEach(b => { b.disabled = false; }); element<HTMLInputElement>('bundle-url').readOnly = false;
  }
}
element('disclosure-files').addEventListener('change', async event => {
  const input = event.target as HTMLInputElement;
  for (const file of Array.from(input.files ?? [])) {
    if (file.size > MAX_FILE_BYTES) { element('bundle-message').textContent = `${file.name} exceeds 50 MB.`; continue; }
    const digest = await sha256(new Uint8Array(await file.arrayBuffer()));
    disclosed_files = disclosed_files.filter(f => f.path !== file.name);
    const url = document.createElement('input'); url.type = 'url'; url.placeholder = 'https://example.org/' + file.name;
    url.setAttribute('aria-label', `Public URL for ${file.name}`);
    disclosed_files.push({ path: file.name, sha256: digest, url });
  }
  input.value = '';
  element('file-rows').replaceChildren(...disclosed_files.map(f => {
    const row = document.createElement('div'); row.className = 'file-row';
    const name = document.createElement('strong'); name.textContent = f.path;
    const digest = document.createElement('code'); digest.textContent = ' ' + f.sha256;
    row.replaceChildren(name, digest, f.url); return row;
  }));
});
element('create-bundle').addEventListener('click', () => exclusive(async () => {
  const message = element('bundle-message');
  created_bundle = null; reset_announcement(); element('bundle-result').hidden = true;
  try {
    const draft = parse_json(reveal_input.value) as unknown as RevealDraft;
    const results = parse_json(element<HTMLTextAreaElement>('results').value) as unknown as ExperimentResult[];
    const files: DisclosedFile[] = disclosed_files.map(f => ({ path: f.path, sha256: f.sha256, url: f.url.value.trim() }));
    const bundle = create_bundle(draft, results, files);
    element('bundle-message').textContent = 'Checking the draft against its commitment.';
    const check = await verify_commitment(draft, selected_reader());
    if (check.status !== 'match') throw new Error(`The draft does not match its commitment (${check.status}); no bundle was created.`);
    created_bundle = bundle;
    element('bundle-hash').textContent = await sha256(bundle_bytes(bundle));
    element<HTMLTextAreaElement>('bundle').value = JSON.stringify(bundle, null, 2);
    element('bundle-result').hidden = false;
    message.textContent = 'Bundle created locally. Nothing was uploaded.';
  } catch (error) { message.textContent = error instanceof Error ? error.message : String(error); }
}));
element('download-bundle').addEventListener('click', () => {
  if (!created_bundle) return;
  const url = URL.createObjectURL(new Blob([bundle_bytes(created_bundle) as BlobPart], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url; link.download = `disclosure-bundle-${created_bundle.commitment_tx_hash.slice(0, 12)}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
element('bundle-url').addEventListener('input', () => { if (!announcing) reset_announcement(); });
/** Before anything permanent is announced, the hosted bundle and files must already verify as a match. */
async function announcement_payload(reader: ChainReader): Promise<{ payload: AnnouncementPayload; registrant: string }> {
  if (!created_bundle) throw new Error('Create a disclosure bundle first.');
  if (!is_network(created_bundle.network)) throw new Error('Unsupported network.');
  const network = created_bundle.network, url = element<HTMLInputElement>('bundle-url').value.trim();
  const payload: AnnouncementPayload = { app: DOMAIN, format_version: 1, kind: 'reveal', network, commitment_tx_hash: created_bundle.commitment_tx_hash,
    bundle_sha256: await sha256(bundle_bytes(created_bundle)), bundle_url: split_url(url, network === 'devnet') };
  const hosted = await web_files.fetch(url, payload.bundle_sha256).catch(() => null);
  if (!hosted) throw new Error('The bundle URL could not be read from this browser. Host the bundle (allowing cross-origin reads) before announcing.');
  if (await sha256(hosted) !== payload.bundle_sha256) throw new Error('The hosted bundle differs from the downloaded bundle. Upload the exact downloaded file.');
  const check = await verify_reveal(created_bundle, reader, web_files);
  if (check.status !== 'match' || !check.registrant) throw new Error(`The hosted disclosure does not verify yet (${check.status}): ${check.detail}`);
  return { payload, registrant: check.registrant };
}
function show_announcement(record: object, network: Network, hash: string, text: string) {
  const pre = element('announcement-record'); pre.textContent = JSON.stringify(record, null, 2); pre.hidden = false;
  element<HTMLInputElement>('announcement-tx').value = hash;
  element<HTMLSelectElement>('announcement-network').value = network;
  element('announce-message').textContent = text;
}
element('announce-local').addEventListener('click', () => exclusive(async () => {
  reset_announcement();
  try {
    const { payload } = await announcement_payload(chain);
    const tx_hash = await chain.announce(payload);
    element<HTMLSelectElement>('verify-source').value = 'local';
    show_announcement({ ...payload, tx_hash, registrant: DEMO_KEY.key_hash, source: 'local demo key, not chain evidence' }, payload.network, tx_hash, 'Local demo announcement created. Nothing was submitted to Cardano.');
  } catch (error) { element('announce-message').textContent = error instanceof Error ? error.message : String(error); }
}));
element('prepare-announcement').addEventListener('click', () => exclusive(async () => {
  reset_announcement();
  try {
    const name = element<HTMLSelectElement>('wallet').value;
    if (!name) throw new Error('Refresh wallets and select the registering testnet wallet first.');
    element('announce-message').textContent = 'Checking the hosted disclosure against the certified commitment.';
    const { payload, registrant } = await announcement_payload(live_reader());
    const { connect_wallet, prepare_announcement } = await import('./mesh-wallet.ts');
    const wallet = await connect_wallet(name);
    announcement = await prepare_announcement(payload, registrant, wallet, await chain_data()); announcement_wallet = wallet;
    show_announcement({ ...payload, tx_hash: announcement.tx_hash, registrant: announcement.registrant, status: 'prepared, not submitted' }, payload.network, announcement.tx_hash,
      `Fee: ${announcement.fee} lovelace. Host the bundle at the URL before signing.`);
  } catch (error) { element('announce-message').textContent = error instanceof Error ? error.message : String(error); }
}));
sign_announcement.addEventListener('click', () => exclusive(async () => {
  if (!announcement || !announcement_wallet) return;
  const prepared_announcement = announcement, wallet = announcement_wallet;
  reset_announcement();
  try {
    const { inspect_transaction } = await import('./mesh-wallet.ts');
    const { tx_hash: hash, signed_tx } = await sign_and_submit(prepared_announcement, wallet, inspect_transaction);
    if (prepared_announcement.payload.network === 'devnet') devnet_signed.set(hash, signed_tx);
    element<HTMLSelectElement>('verify-source').value = 'chain';
    element('announce-message').textContent = `Submitted ${hash}. Confirmation is pending; verify the announcement once it is on chain.`;
  } catch (error) {
    element('announce-message').textContent = `${error instanceof Error ? error.message : String(error)} Check the prepared transaction hash before retrying.`;
  }
}));
