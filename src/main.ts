import './style.css';
import { canonicalize, parse_json, sample_manifest, validate_manifest } from './manifest.ts';
import { encode_commitment, hex, new_salt, type Network } from './commitment.ts';
import { FakeChain, type CommitmentPayload, type CommitmentRecord } from './chain.ts';
import { verify_reveal, VERIFICATION_BOUNDARY, type RevealDraft } from './verifier.ts';
import { sign_and_submit, type PreparedRegistration, type RegistrationWallet } from './registration.ts';

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
const live_reader = { async get_commitment(hash: string, network: Network) {
  const { public_read } = await import('./mesh-wallet.ts');
  return public_read<CommitmentRecord | null>('commitment', network, hash);
} };
manifest_input.value = JSON.stringify(sample_manifest, null, 2);
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
      app: 'cardano-ai-preregistry', format_version: 1, network,
      commitment_hash: await encode_commitment(manifest, salt, network), reveal_deadline: manifest.reveal_deadline,
    };
    const record = await chain.commit(payload);
    saved_draft = { format_version: 1, network, tx_hash: record.tx_hash, manifest, salt_hex: hex(salt) };
    element('public-record').textContent = JSON.stringify(record, null, 2);
    element('commit-result').hidden = false;
    reveal_input.value = JSON.stringify(saved_draft, null, 2);
    element('verification').textContent = '';
    message.textContent = 'Local commitment created. No data was submitted to Cardano or a server.';
  } catch (error) { message.textContent = error instanceof Error ? error.message : 'Could not create commitment.'; }
  finally { lock_form(false); }
});

verify_button.addEventListener('click', async () => {
  const output = element('verification');
  verify_button.disabled = true;
  try {
    const reader = element<HTMLSelectElement>('verify-source').value === 'chain' ? live_reader : chain;
    const result = await verify_reveal(parse_json(reveal_input.value), reader);
    const title = document.createElement('h3');
    title.textContent = result.status;
    title.dataset.status = result.status;
    const detail = document.createElement('p'); detail.textContent = result.detail;
    const context = document.createElement('p'); context.className = 'helper';
    context.textContent = `Network: ${result.network ?? 'unknown'} · Record time: ${result.block_time ?? 'unavailable'}`;
    const boundary = document.createElement('p'); boundary.className = 'helper'; boundary.textContent = result.boundary;
    output.replaceChildren(title, detail, context, boundary);
  } catch (error) { output.textContent = error instanceof Error ? error.message : 'Invalid JSON.'; }
  finally { verify_button.disabled = false; }
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
    const payload: CommitmentPayload = { app: 'cardano-ai-preregistry', format_version: 1, network,
      commitment_hash: await encode_commitment(manifest, salt, network), reveal_deadline: manifest.reveal_deadline };
    const { connect_wallet, prepare_registration, browser_chain_data } = await import('./mesh-wallet.ts');
    const wallet = await connect_wallet(name);
    prepared = await prepare_registration(payload, wallet, browser_chain_data); connected = wallet;
    phase = 'prepared';
    saved_draft = { format_version: 1, network, tx_hash: prepared.tx_hash, manifest, salt_hex: hex(salt) };
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
    const hash = await sign_and_submit(registration, wallet, inspect_transaction);
    phase = 'submitted';
    element('commit-message').textContent = `Submitted ${hash}. Confirmation is pending; keep your saved draft and check chain confirmation.`;
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
    const record = await live_reader.get_commitment(draft.tx_hash, draft.network);
    if (!record) { element('commit-message').textContent = 'Not found yet. Your transaction may still be pending; keep your saved draft.'; return; }
    const result = await verify_reveal(draft, live_reader);
    if (result.status !== 'match' || record.registrant !== registration?.registrant) throw new Error('Chain record differs from the prepared registration.');
    element('public-record').textContent = JSON.stringify(record, null, 2);
    element('commit-message').textContent = 'Confirmed on the selected test network; commitment hash and deadline match your private draft.';
  } catch (error) { element('commit-message').textContent = String(error); }
  finally { read_button.disabled = false; lock_form(false); }
});
