import './style.css';
import { canonicalize, parse_json, sample_manifest, validate_manifest } from './manifest.ts';
import { encode_commitment, hex, new_salt, type Network } from './commitment.ts';
import { FakeChain, type CommitmentPayload } from './chain.ts';
import { verify_reveal, VERIFICATION_BOUNDARY, type RevealDraft } from './verifier.ts';

function element<T extends HTMLElement>(id: string): T { return document.getElementById(id) as T; }
const manifest_input = element<HTMLTextAreaElement>('manifest');
const reveal_input = element<HTMLTextAreaElement>('reveal');
const commit_button = element<HTMLButtonElement>('commit');
const verify_button = element<HTMLButtonElement>('verify');
const chain = new FakeChain();
let saved_draft: RevealDraft | null = null;
manifest_input.value = JSON.stringify(sample_manifest, null, 2);
element('boundary').textContent = VERIFICATION_BOUNDARY;

commit_button.addEventListener('click', async () => {
  const message = element('commit-message');
  commit_button.disabled = true;
  message.textContent = '';
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
  finally { commit_button.disabled = false; }
});

verify_button.addEventListener('click', async () => {
  const output = element('verification');
  verify_button.disabled = true;
  try {
    const result = await verify_reveal(parse_json(reveal_input.value), chain);
    const title = document.createElement('h3');
    title.textContent = result.status;
    title.dataset.status = result.status;
    const detail = document.createElement('p'); detail.textContent = result.detail;
    const context = document.createElement('p'); context.className = 'helper';
    context.textContent = `Simulated network: ${result.network ?? 'unknown'} · Local record time: ${result.block_time ?? 'unavailable'}`;
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
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
