// Exercise the rendered provider-sharing controls with a real browser.
// Next serves the existing firm fixture; only share API responses are replaced.
// Synthetic sessions keep database, Clio and model services outside this test.
/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS resolves the external driver through NODE_PATH. */
const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { chromium } = require('playwright');

const origin = process.env.BASE_URL || 'http://127.0.0.1:3317';
const categories = ['stage', 'requests', 'own_bills', 'coverage', 'other_treaters'];
let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

async function fixture(run, { loadFails = false, publishFails = false, empty = false } = {}) {
  const context = await browser.newContext();
  try {
    const body = Buffer.from(JSON.stringify({ userId: 1, role: 'firm' })).toString('base64url');
    const mac = createHmac('sha256', process.env.SESSION_SECRET).update(body).digest('base64url');
    await context.addCookies([{ name: 'cb_session', value: `${body}.${mac}`, url: origin }]);
    const provider = {
      provider: { nodeId: 7, name: 'Fixture Clinic', email: 'clinic@example.test', role: 'Treating provider' },
      consent: Object.fromEntries(categories.map(c => [c, { granted: c === 'stage', at: null }])),
      revisions: Object.fromEntries(categories.map(c => [c, `fixture-${c}-v1`])),
      preview: { matterId: 1, patient: 'Fixture Patient', items: [], replies: [], lien: null },
      heldBack: [{ category: 'coverage', label: 'Insurance coverage', reason: 'No consent', items: 1 }],
      published: {}, code: null, views: { count: 0, last: null }, replies: [], lien: null,
    };
    const requests = [];
    let failLoad = loadFails;
    await context.route('**/api/share**', async route => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (request.method() === 'GET') {
        await route.fulfill({ status: failLoad ? 503 : 200, json: failLoad
          ? { error: 'Fixture share service unavailable' }
          : { matterId: 1, patient: 'Fixture Patient', providers: empty ? [] : [provider], outbox: [] } });
        return;
      }
      const input = request.postDataJSON();
      requests.push({ path, input });
      if (path === '/api/share/consent') provider.consent[input.category].granted = input.granted;
      if (path === '/api/share/publish' && publishFails) {
        await route.fulfill({ status: 409, json: { error: 'Case changed. Review before publishing.' } });
      } else {
        await route.fulfill({ json: path === '/api/share/publish'
          ? { published: ['stage'], unchanged: [] } : {} });
      }
    });
    const page = await context.newPage();
    await page.goto(`${origin}/firm`, { waitUntil: 'networkidle' });
    await run({ page, requests, recover: () => { failLoad = false; } });
  } finally {
    await context.close();
  }
}

test('keyboard changes consent and publishes only the displayed revisions', { timeout: 60000 }, async () => {
  await fixture(async ({ page, requests }) => {
    const checkbox = page.getByRole('checkbox', { name: 'What the firm needs for Fixture Clinic' });
    await checkbox.focus();
    await page.keyboard.press('Space');
    await page.waitForFunction(() => document.querySelectorAll('#sec-share input:checked').length === 2);
    const publish = page.getByRole('button', { name: 'Publish', exact: true });
    await publish.focus();
    await page.keyboard.press('Enter');
    await page.getByRole('status').filter({ hasText: 'Published 1 category' }).waitFor({ timeout: 5000 });
    const sent = requests.find(r => r.path === '/api/share/publish').input;
    assert.deepEqual(sent.expected, { stage: 'fixture-stage-v1', requests: 'fixture-requests-v1' });
    assert.equal(sent.providerNodeId, 7);
    assert.equal(sent.matterId, 1);
  });
});

test('stale publish feedback is announced without showing success', { timeout: 60000 }, async () => {
  await fixture(async ({ page }) => {
    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    const status = page.getByRole('status').filter({ hasText: 'Case changed. Review before publishing.' });
    await status.waitFor({ timeout: 5000 });
    assert.equal(await page.getByText('Published 1 category', { exact: false }).count(), 0);
  }, { publishFails: true });
});

test('failed initial loading exposes an accessible retry that recovers', { timeout: 60000 }, async () => {
  await fixture(async ({ page, recover }) => {
    await page.getByRole('alert').filter({ hasText: 'Could not load providers.' }).waitFor({ timeout: 5000 });
    recover();
    const retry = page.getByRole('button', { name: 'Retry loading providers' });
    await retry.focus();
    await page.keyboard.press('Enter');
    await page.getByRole('checkbox', { name: 'Case stage for Fixture Clinic' }).waitFor();
    await page.getByRole('alert').filter({ hasText: 'Could not load providers.' }).waitFor({ state: 'hidden' });
  }, { loadFails: true });
});

test('empty provider state has no publish action', { timeout: 60000 }, async () => {
  await fixture(async ({ page }) => {
    await page.getByText('No treating providers found among this case’s contacts.').waitFor();
    assert.equal(await page.getByRole('button', { name: 'Publish', exact: true }).count(), 0);
  }, { empty: true });
});
