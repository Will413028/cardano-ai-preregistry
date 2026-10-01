import { expect, test } from '@playwright/test';

test('register then match, change a setting then mismatch without disclosing over the network', async ({ page }) => {
  const requests: { url: string; body: string }[] = [];
  const websockets: string[] = [];
  page.on('request', req => requests.push({ url: req.url(), body: req.postData() ?? '' }));
  page.on('websocket', socket => { socket.on('framesent', event => websockets.push(String(event.payload))); });
  await page.goto('/');
  await expect(page.getByText('Local demo · No Cardano transaction')).toBeVisible();
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
  await page.getByRole('button', { name: 'Verify disclosure' }).click();
  await expect(page.locator('[data-status="match"]')).toBeVisible();
  await expect(page.locator('#verification')).toContainText('Commitments do not prove actual execution');
  draft.manifest.experiments[0].settings.temperature = 0.9;
  await page.locator('#reveal').fill(JSON.stringify(draft));
  await page.getByRole('button', { name: 'Verify disclosure' }).click();
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
  await page.reload();
  await page.locator('#reveal').fill(JSON.stringify(first));
  await page.locator('#verify').click();
  await expect(page.locator('[data-status="not-found"]')).toBeVisible();
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
