import { readFile } from 'node:fs/promises';
import { test, expect, type Page } from '@playwright/test';
import { DEFAULT_PROTOCOL_PARAMETERS } from '@meshsdk/core';
import { test_wallet, tx_id, yaci } from './helpers/wallet.ts';

const registrant = test_wallet('e2e registrant'), other = test_wallet('e2e other key');
/** Installs `window.cardano.mock`; signing and submission run in Node with a real key. */
async function install_wallet(page: Page, submitted: Map<string, string>, options: { hold_signing?: boolean } = {}) {
  let use_other = false, reject_next = false, sign_calls = 0;
  await page.exposeFunction('e2e_sign', async (tx: string) => {
    sign_calls++;
    if (reject_next) { reject_next = false; throw new Error('User rejected signing'); }
    return (use_other ? other : registrant).witness_set(tx);
  });
  await page.exposeFunction('e2e_submit', async (tx: string) => { const hash = tx_id(tx); submitted.set(hash, tx); return hash; });
  await page.exposeFunction('e2e_address', async () => (use_other ? other : registrant).raw_address);
  await page.addInitScript(({ utxo, hold }) => {
    const w = window as unknown as Record<string, (...args: unknown[]) => Promise<string>>;
    Object.assign(window, { cardano: { mock: { name: 'mock', icon: '', apiVersion: '1.0.0', enable: async () => ({
      getNetworkId: async () => 0, getChangeAddress: () => w.e2e_address!(), getUtxos: async () => [utxo],
      signTx: (tx: string) => hold ? new Promise((_resolve, reject) => { Object.assign(window, { reject_signing: () => reject({ info: 'User rejected signing' }) }); }) : w.e2e_sign!(tx),
      submitTx: (tx: string) => w.e2e_submit!(tx),
    }) } } });
  }, { utxo: registrant.utxo_cbor, hold: options.hold_signing === true });
  return { other_key: (value: boolean) => { use_other = value; }, reject_next: () => { reject_next = true; }, sign_calls: () => sign_calls };
}
/** Write-side reads through the optional development cache; the page verifies everything it reads itself. */
async function cache(page: Page, on_tx?: () => Promise<void>) {
  await page.route('**/api/cardano?**', async route => {
    const kind = new URL(route.request().url()).searchParams.get('kind');
    if (kind === 'tx') await on_tx?.();
    await route.fulfill({ json: kind === 'protocol' ? DEFAULT_PROTOCOL_PARAMETERS : kind === 'utxos' ? [registrant.input] : null });
  });
}

test('wallet preparation keeps private data local, requires draft download and preserves it on rejection', async ({ page }) => {
  page.on('pageerror', error => console.error('Wallet browser runtime:', error.message));
  await install_wallet(page, new Map(), { hold_signing: true });
  const requests: string[] = [];
  let read_started = false;
  let release_read: (() => void) | undefined;
  page.on('request', r => requests.push(r.url() + (r.postData() ?? '')));
  await cache(page, async () => { read_started = true; await new Promise<void>(resolve => { release_read = resolve; }); });
  await page.goto('/');
  const manifest = JSON.parse(await page.locator('#manifest').inputValue());
  manifest.title = 'PRIVATE-WALLET-PLAN-NEVER-SENT';
  await page.locator('#manifest').fill(JSON.stringify(manifest));
  await page.locator('#read-transport').selectOption('proxy');
  await page.locator('#refresh-wallets').click();
  await expect(page.locator('#wallet option')).toHaveText(['mock'], { timeout: 30000 });
  await page.locator('#prepare').click();
  await expect(page.locator('#prepared-summary')).toContainText('Save your private draft', { timeout: 30000 });
  await expect(page.locator('#sign-submit')).toBeDisabled();
  const draft_before = await page.locator('#reveal').inputValue();
  const draft = JSON.parse(draft_before);
  expect(draft.format_version).toBe(2);
  expect(JSON.parse(await page.locator('#public-record').innerText()).registrant).toBe(registrant.key.key_hash);
  expect(requests.join('\n')).not.toContain(manifest.title);
  expect(requests.join('\n')).not.toContain(draft.salt_hex);
  const download = page.waitForEvent('download'); await page.locator('#download').click(); await download;
  await expect(page.locator('#sign-submit')).toBeEnabled();
  await page.locator('#sign-submit').click();
  await expect(page.locator('#prepare')).toBeDisabled(); await expect(page.locator('#commit')).toBeDisabled();
  const during_sign = page.waitForEvent('download'); await page.locator('#download').click(); await during_sign;
  await expect(page.locator('#sign-submit')).toBeDisabled();
  await page.evaluate(() => (window as unknown as { reject_signing: () => void }).reject_signing());
  await expect(page.locator('#commit-message')).toContainText('Keep your saved draft');
  await expect(page.locator('#reveal')).toHaveValue(draft_before);
  const after_rejection = page.waitForEvent('download'); await page.locator('#download').click(); await after_rejection;
  await expect(page.locator('#sign-submit')).toBeDisabled();
  await page.locator('#readback').click();
  await expect.poll(() => read_started).toBe(true);
  await expect(page.locator('#prepare')).toBeDisabled(); await expect(page.locator('#commit')).toBeDisabled();
  release_read!();
  await expect(page.locator('#commit-message')).toContainText('Not found yet');
  await expect(page.locator('#prepare')).toBeEnabled();
  await expect(page.locator('#reveal')).toHaveValue(draft_before);
  expect(requests.every(r => !r.includes('PRIVATE-WALLET-PLAN-NEVER-SENT'))).toBe(true);
});

test('the public Cardano read route rejects private fields, decoded-record queries and write requests', async ({ page }) => {
  await page.goto('/');
  for (const url of ['/api/cardano?kind=protocol&network=mainnet', '/api/cardano?kind=protocol&network=devnet&salt=private',
    '/api/cardano?kind=protocol&network=devnet&network=preprod', `/api/cardano?kind=commitment&network=preprod&tx_hash=${'a'.repeat(64)}`]) {
    expect((await page.request.get(url)).status()).toBe(400);
  }
  expect((await page.request.post('/api/cardano?kind=protocol&network=devnet', { data: { manifest: 'private' } })).status()).toBe(405);
});

test('devnet: register, self-verify, announce as the registrant and verify, all by direct reads, or with an uploaded bundle', async ({ page }) => {
  test.setTimeout(120000);
  page.on('pageerror', error => console.error('Wallet browser runtime:', error.message));
  const submitted = new Map<string, string>();
  const wallet = await install_wallet(page, submitted);
  const requests: string[] = [];
  page.on('request', r => requests.push(r.url() + (r.postData() ?? '')));
  let hosted_bundle: string | null = null;
  const bundle_url = 'https://files.example.test/' + 'bundle-'.repeat(12) + '.json';
  await page.route('https://files.example.test/**', route => route.fulfill(hosted_bundle === null ? { status: 404, body: '' }
    : { status: 200, headers: { 'access-control-allow-origin': '*' }, body: hosted_bundle }));
  await yaci(page, submitted, registrant.input);
  await page.goto('/');
  await page.locator('#network').selectOption('devnet');
  await page.locator('#refresh-wallets').click();
  await expect(page.locator('#wallet option')).toHaveText(['mock'], { timeout: 30000 });
  await page.locator('#prepare').click();
  await expect(page.locator('#prepared-summary')).toContainText('Save your private draft', { timeout: 30000 });
  const draft = JSON.parse(await page.locator('#reveal').inputValue());
  const download_draft = page.waitForEvent('download'); await page.locator('#download').click(); await download_draft;
  await page.locator('#sign-submit').click();
  await expect(page.locator('#commit-message')).toContainText('Submitted');
  // Readback goes straight to the local indexer and verifies the signed bytes.
  await page.locator('#readback').click();
  await expect(page.locator('#commit-message')).toContainText('registrant and deadline match', { timeout: 30000 });
  expect(requests.some(r => r.startsWith('http://127.0.0.1:18080/api/v1/txs/' + draft.tx_hash))).toBe(true);
  expect(JSON.parse(await page.locator('#public-record').innerText())).toMatchObject({ registrant: registrant.key.key_hash, trust: 'local-node' });

  await page.locator('#create-bundle').click();
  await expect(page.locator('#bundle-result')).toBeVisible({ timeout: 30000 });
  await page.locator('#bundle-url').fill(bundle_url);
  await page.locator('#prepare-announcement').click();
  await expect(page.locator('#announce-message')).toContainText('could not be read', { timeout: 30000 });
  hosted_bundle = 'not the downloaded bundle';
  await page.locator('#prepare-announcement').click();
  await expect(page.locator('#announce-message')).toContainText('differs from the downloaded bundle');
  const download = page.waitForEvent('download'); await page.locator('#download-bundle').click();
  const bundle_text = await readFile((await (await download).path())!, 'utf8');
  hosted_bundle = bundle_text;
  wallet.other_key(true);
  await page.locator('#prepare-announcement').click();
  await expect(page.locator('#announce-message')).toContainText('registered the commitment', { timeout: 30000 });
  await expect(page.locator('#sign-announcement')).toBeDisabled();
  wallet.other_key(false);
  await page.locator('#prepare-announcement').click();
  await expect(page.locator('#announce-message')).toContainText('Host the bundle at the URL before signing', { timeout: 30000 });
  const prepared = JSON.parse(await page.locator('#announcement-record').innerText());
  expect(prepared.bundle_url.length).toBe(2);
  expect(prepared.registrant).toBe(registrant.key.key_hash);
  wallet.reject_next();
  const calls = wallet.sign_calls();
  await page.locator('#sign-announcement').click();
  await expect(page.locator('#announce-message')).toContainText('Check the prepared transaction hash before retrying');
  await expect(page.locator('#sign-announcement')).toBeDisabled();
  expect(wallet.sign_calls()).toBe(calls + 1);

  await page.locator('#prepare-announcement').click();
  await expect(page.locator('#announce-message')).toContainText('Host the bundle at the URL before signing', { timeout: 30000 });
  await page.locator('#sign-announcement').click();
  await expect(page.locator('#announce-message')).toContainText('Submitted');
  await page.locator('#verify-source').selectOption('chain');
  await page.locator('#verify-announcement').click();
  await expect(page.locator('[data-status="match"]')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('#verification')).toContainText(`Registrant: ${registrant.key.key_hash}`);
  await expect(page.locator('[data-trust="local-node"]')).toContainText('local trust');
  // The bundle URL is gone; the same bytes uploaded by the reader still verify.
  hosted_bundle = null;
  await page.locator('#verify-announcement').click();
  await expect(page.locator('[data-status="files-unavailable"]')).toBeVisible({ timeout: 30000 });
  await page.locator('#verify-bundle-file').setInputFiles({ name: 'bundle.json', mimeType: 'application/json', buffer: Buffer.from(bundle_text) });
  await page.locator('#verify-announcement').click();
  await expect(page.locator('[data-status="match"]')).toBeVisible({ timeout: 30000 });
  // The default build path: protocol parameters, UTxOs and every chain read went to the provider, none to the dev cache.
  expect(requests.some(r => r.startsWith('http://127.0.0.1:18080/api/v1/epochs/latest/parameters'))).toBe(true);
  expect(requests.some(r => r.includes('/api/cardano'))).toBe(false);
  for (const secret of [draft.salt_hex, draft.manifest.title]) {
    expect(requests.filter(r => !r.startsWith('https://files.example.test/')).join('\n')).not.toContain(secret);
  }
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('preprod reads go directly to Koios, and the development cache gives the same result', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', r => requests.push(r.url()));
  await page.route('https://preprod.koios.rest/api/v1/tx_cbor', route => route.fulfill({ headers: { 'access-control-allow-origin': '*' }, json: [] }));
  await cache(page);
  await page.goto('/');
  await page.locator('#commit').click();
  await page.locator('#create-bundle').click();
  await expect(page.locator('#bundle-result')).toBeVisible();
  await page.locator('#verify-source').selectOption('chain');
  await page.locator('#verify').click();
  await expect(page.locator('[data-status="not-found"]')).toBeVisible();
  expect(requests.some(r => r === 'https://preprod.koios.rest/api/v1/tx_cbor')).toBe(true);
  expect(requests.some(r => r.includes('/api/cardano'))).toBe(false);
  await page.locator('#read-transport').selectOption('proxy');
  await page.locator('#verify').click();
  await expect(page.locator('[data-status="not-found"]')).toBeVisible();
  expect(requests.some(r => r.includes('/api/cardano?kind=tx'))).toBe(true);
});
