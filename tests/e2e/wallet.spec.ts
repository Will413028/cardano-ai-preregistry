import { test, expect } from '@playwright/test';
import { core, DEFAULT_PROTOCOL_PARAMETERS, type UTxO } from '@meshsdk/core';

const address = core.buildEnterpriseAddress(0, core.Hash28ByteBase16('b'.repeat(56))).toAddress().toBech32();
const input: UTxO = { input: { txHash: 'a'.repeat(64), outputIndex: 0 }, output: { address, amount: [{ unit: 'lovelace', quantity: '10000000' }] } };
const cbor = core.toTxUnspentOutput(input).toCbor();
const raw_address = core.Address.fromBech32(address).toBytes();
test('wallet preparation keeps private data local, requires draft download and preserves it on rejection', async ({ page }) => {
  page.on('pageerror', error => console.error('Wallet browser runtime:', error.message));
  await page.addInitScript(({ cbor, raw_address }) => {
    Object.assign(window, { cardano: { mock: { name: 'mock', icon: '', apiVersion: '1.0.0', enable: async () => ({
      getNetworkId: async () => 0, getChangeAddress: async () => raw_address, getUtxos: async () => [cbor],
      signTx: async () => new Promise((_resolve, reject) => { Object.assign(window, { reject_signing: () => reject({ info: 'User rejected signing' }) }); }),
      submitTx: async () => { throw new Error('Must not submit'); },
    }) } } });
  }, { cbor, raw_address });
  const requests: string[] = [];
  let read_started = false;
  let release_read: (() => void) | undefined;
  page.on('request', r => requests.push(r.url() + (r.postData() ?? '')));
  await page.route('**/api/cardano?**', async route => {
    const kind = new URL(route.request().url()).searchParams.get('kind');
    if (kind === 'commitment') { read_started = true; await new Promise<void>(resolve => { release_read = resolve; }); }
    await route.fulfill({ json: kind === 'protocol' ? DEFAULT_PROTOCOL_PARAMETERS : kind === 'utxos' ? [input] : null });
  });
  await page.goto('/');
  const manifest = JSON.parse(await page.locator('#manifest').inputValue());
  manifest.title = 'PRIVATE-WALLET-PLAN-NEVER-SENT';
  await page.locator('#manifest').fill(JSON.stringify(manifest));
  await page.locator('#network').selectOption('devnet');
  await page.locator('#refresh-wallets').click();
  await expect(page.locator('#wallet option')).toHaveText(['mock'], { timeout: 30000 });
  await page.locator('#prepare').click();
  await expect(page.locator('#prepared-summary')).toContainText('Save your private draft', { timeout: 30000 });
  await expect(page.locator('#sign-submit')).toBeDisabled();
  const draft_before = await page.locator('#reveal').inputValue();
  const draft = JSON.parse(draft_before);
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
test('the public Cardano read route rejects private fields and write requests before any upstream query', async ({ page }) => {
  await page.goto('/');
  for (const url of ['/api/cardano?kind=protocol&network=mainnet', '/api/cardano?kind=protocol&network=devnet&salt=private', '/api/cardano?kind=protocol&network=devnet&network=preprod']) {
    expect((await page.request.get(url)).status()).toBe(400);
  }
  expect((await page.request.post('/api/cardano?kind=protocol&network=devnet', { data: { manifest: 'private' } })).status()).toBe(405);
});
