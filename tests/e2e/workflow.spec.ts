import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

test('register then match, change a setting then mismatch without disclosing over the network', async ({ page }) => {
  const requests: { url: string; body: string }[] = [];
  const websockets: string[] = [];
  page.on('request', req => requests.push({ url: req.url(), body: req.postData() ?? '' }));
  page.on('websocket', socket => { socket.on('framesent', event => websockets.push(String(event.payload))); });
  await page.goto('/');
  await expect(page.getByText('Local demo records disappear on reload.')).toBeVisible();
  const manifest = JSON.parse(await page.locator('#manifest').inputValue());
  manifest.title = 'PRIVATE-TITLE-DO-NOT-TRANSMIT';
  manifest.experiments[0].settings.private_marker = 'PRIVATE-SETTING-DO-NOT-TRANSMIT';
  await page.locator('#manifest').fill(JSON.stringify(manifest));
  await page.getByRole('button', { name: 'Create local commitment' }).click();
  await expect(page.locator('#commit-message')).toContainText('Local commitment created');
  const draft = JSON.parse(await page.locator('#reveal').inputValue());
  const public_record = JSON.parse(await page.locator('#public-record').innerText());
  expect(public_record).not.toHaveProperty('manifest'); expect(public_record).not.toHaveProperty('salt_hex');
  expect(public_record.network).toBe('preprod');
  for (const request of requests) {
    expect(new URL(request.url).hostname).toBe('127.0.0.1');
    for (const secret of [manifest.title, manifest.experiments[0].settings.private_marker, draft.salt_hex]) {
      expect(request.url + request.body).not.toContain(secret);
    }
    expect(request.body).toBe('');
  }
  for (const frame of websockets) expect(frame).not.toContain(draft.salt_hex);
  await page.getByRole('button', { name: 'Create disclosure bundle' }).click();
  await expect(page.locator('#bundle-message')).toContainText('Nothing was uploaded');
  await page.getByRole('button', { name: 'Verify bundle' }).click();
  await expect(page.locator('[data-status="match"]')).toBeVisible();
  await expect(page.locator('#verification')).toContainText('Commitments do not prove actual execution');
  const bundle = JSON.parse(await page.locator('#bundle').inputValue());
  bundle.manifest.experiments[0].settings.temperature = 0.9;
  await page.locator('#bundle').fill(JSON.stringify(bundle));
  await page.getByRole('button', { name: 'Verify bundle' }).click();
  await expect(page.locator('[data-status="mismatch"]')).toBeVisible();
});

test('private draft download stays local and a second commitment uses a different salt', async ({ page }) => {
  await page.goto('/');
  await page.locator('#commit').click();
  await expect(page.locator('#commit-message')).toContainText('Local commitment created');
  const first = JSON.parse(await page.locator('#reveal').inputValue());
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save private draft' }).click();
  expect((await download).suggestedFilename()).toMatch(/^private-draft-/);
  await page.locator('#commit').click();
  await expect.poll(async () => JSON.parse(await page.locator('#reveal').inputValue()).salt_hex).not.toBe(first.salt_hex);
  await page.locator('#create-bundle').click();
  const second_bundle = await page.locator('#bundle').inputValue();
  await page.reload();
  await page.locator('#bundle').fill(second_bundle);
  await page.locator('#verify').click();
  await expect(page.locator('[data-status="not-found"]')).toBeVisible();
  await page.locator('#reveal').fill(JSON.stringify(first));
  await page.locator('#create-bundle').click();
  await expect(page.locator('#bundle-message')).toContainText('does not match its commitment (not-found)');
  await expect(page.locator('#bundle-result')).toBeHidden();
});

test('invalid JSON or schema never creates a commitment, and the layout fits mobile', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  await page.locator('#manifest').fill('{"title":1,"title":2}');
  await page.locator('#commit').click();
  await expect(page.locator('#commit-message')).toContainText('Duplicate');
  await expect(page.locator('#commit-result')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('read proxy accepts fixture reads, rejects private fields and has no write route', async ({ request }) => {
  const base = '/api/read?kind=label&network=preprod&label=65536';
  const good = await request.get(base);
  expect(good.status()).toBe(200); expect(await good.json()).toEqual({ source: 'fixture', network: 'preprod', data: [] });
  expect((await request.get(base + '&salt=secret')).status()).toBe(400);
  expect((await request.post(base, { data: { manifest: 'private' } })).status()).toBe(405);
});

test('disclose a hosted file, announce locally, then detect replaced and missing files', async ({ page }) => {
  const hosted = new Map<string, string>();
  const fetched: string[] = [];
  await page.route('https://files.example.test/**', async route => {
    fetched.push(route.request().url());
    const body = hosted.get(route.request().url());
    await route.fulfill(body === undefined ? { status: 404, headers: { 'access-control-allow-origin': '*' }, body: '' }
      : { status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/octet-stream' }, body });
  });
  await page.goto('/');
  await page.locator('#commit').click();
  await expect(page.locator('#commit-message')).toContainText('Local commitment created');
  const csv = 'run,accuracy\n1,0.81\n2,0.79\n3,0.80\n';
  await page.locator('#disclosure-files').setInputFiles({ name: 'results.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await page.getByLabel('Public URL for results.csv').fill('https://files.example.test/results.csv');
  await page.locator('#results').fill(JSON.stringify([{ experiment_id: 'baseline', completed_runs: 3, metrics: { accuracy: 0.8 } }]));
  await page.locator('#create-bundle').click();
  await expect(page.locator('#bundle-result')).toBeVisible();
  expect(fetched).toEqual([]);
  const download = page.waitForEvent('download');
  await page.locator('#download-bundle').click();
  const bundle_text = await readFile((await (await download).path())!, 'utf8');
  expect(JSON.parse(bundle_text).files[0].url).toBe('https://files.example.test/results.csv');
  hosted.set('https://files.example.test/results.csv', csv);
  hosted.set('https://files.example.test/bundle.json', bundle_text);
  await page.locator('#bundle-url').fill('https://files.example.test/bundle.json');
  await page.locator('#announce-local').click();
  await expect(page.locator('#announce-message')).toContainText('Local demo announcement created');
  await page.locator('#verify-announcement').click();
  await expect(page.locator('[data-status="match"]')).toBeVisible();
  await expect(page.locator('#verification')).toContainText('Signer: local-demo-wallet');
  await expect(page.locator('#verification')).toContainText('results.csv: match');
  await expect(page.locator('#verification')).toContainText("registrant's claims");
  hosted.set('https://files.example.test/results.csv', 'run,accuracy\n1,0.99\n');
  await page.locator('#verify-announcement').click();
  await expect(page.locator('[data-status="mismatch"]')).toBeVisible();
  await expect(page.locator('#verification')).toContainText('results.csv: mismatch');
  hosted.delete('https://files.example.test/results.csv');
  await page.locator('#verify').click();
  await expect(page.locator('[data-status="files-unavailable"]')).toBeVisible();
  hosted.set('https://files.example.test/bundle.json', bundle_text.replace('0.8', '0.95'));
  await page.locator('#verify-announcement').click();
  await expect(page.locator('[data-status="mismatch"]')).toBeVisible();
  await expect(page.locator('#verification')).toContainText('differs from the announced hash');
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
