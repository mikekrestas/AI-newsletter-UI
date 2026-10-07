import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true, args: ['--no-sandbox'] });
const base = process.env.READER_URL || 'http://localhost:3000';
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors = []; page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto(base);
  await page.getByRole('button', { name: 'Try a demo' }).click();
  assert.equal(await page.locator('.edition').count(), 5);
  await page.screenshot({ path: '/tmp/newsletter-reader-preview.png', fullPage: true });
  await page.locator('.save-button').first().click();
  await page.locator('[data-view="saved"]').click();
  assert.equal(await page.locator('.edition').count(), 1);
  await page.locator('.edition-title').click();
  await page.locator('#reader-content').getByText('Demo edition.', { exact: true }).waitFor();
  assert.equal(await page.locator('#reader-dialog').getByRole('img').count(), 0);
  await page.getByRole('button', { name: 'Close reader' }).click();
  await page.locator('[data-view="catchup"]').click();
  assert.equal(await page.locator('.edition').count(), 4);
  await page.locator('.edition-actions').first().getByRole('button', { name: 'Dismiss', exact: true }).click();
  assert.equal(await page.locator('.edition').count(), 3);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.equal(await page.locator('.edition').count(), 4);
  await page.reload(); await page.getByRole('button', { name: 'Try a demo' }).click();
  assert.equal(await page.locator('.edition').count(), 4);
  await page.locator('[data-view="saved"]').click(); assert.equal(await page.locator('.edition').count(), 1);
  await page.locator('[data-view="archive"]').click(); await page.getByRole('button', { name: 'Dismiss older editions', exact: true }).click();
  assert.match(await page.locator('#notice').innerText(), /1 loaded older edition/);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Mobile page overflow');
  await page.screenshot({ path: '/tmp/newsletter-reader-mobile.png', fullPage: true });
  // Validate safe reader reconstruction with hostile HTML, Unicode and blocked URLs.
  const security = await page.evaluate(async () => {
    const { readableContent } = await import('./reader.js');
    const test = document.createElement('div');
    test.append(readableContent('<p onclick="window.attack=1">Café 🧠</p><img src="https://track.invalid/pixel" onerror="window.attack=2"><script>window.attack=3</script><a href="javascript:alert(1)">bad</a><a href="https://example.com">good</a><svg onload="window.attack=4"></svg><div style="display: none">preheader</div>'));
    document.body.append(test);
    return { text: test.textContent, forbidden: test.querySelectorAll('img,script,svg,[onclick],[onerror]').length, badLink: test.querySelector('a').getAttribute('href'), goodLink: test.querySelectorAll('a')[1].href, attack: window.attack };
  });
  assert.equal(security.forbidden, 0); assert.equal(security.badLink, null); assert.equal(security.goodLink, 'https://example.com/'); assert.equal(security.attack, undefined); assert.match(security.text, /Café 🧠/); assert.doesNotMatch(security.text, /preheader/);
  // Optional browser tools register and mutate/read back the same UI state.
  const toolPage = await context.newPage();
  await toolPage.addInitScript(() => { window.registeredTools = {}; Object.defineProperty(document, 'modelContext', { value: { registerTool: tool => { window.registeredTools[tool.name] = tool; } } }); });
  await toolPage.goto(base); await toolPage.getByRole('button', { name: 'Try a demo' }).click();
  const toolResult = await toolPage.evaluate(async () => {
    const list = window.registeredTools.list_newsletter_editions;
    const save = window.registeredTools.set_newsletter_saved;
    const items = await list.execute({}); const id = items[1].id;
    await save.execute({ id, saved: true }); const saved = (await list.execute({})).find(item => item.id === id).saved;
    let rejected = false; try { await save.execute({ id: 'missing', saved: true }); } catch { rejected = true; }
    return { names: Object.keys(window.registeredTools), saved, rejected };
  });
  assert.equal(toolResult.saved, true); assert.equal(toolResult.rejected, true); assert.equal(toolResult.names.length, 2); await toolPage.close();
  console.log('PASS: demo reading, save/read/dismiss/undo, persistence, archive, mobile, HTML safety and browser tools.');
  // Exercise the actual Gmail module and auth callback with simulated Google responses.
  const gmailContext = await browser.newContext(); const gmailPage = await gmailContext.newPage(); gmailPage.on('pageerror', error => errors.push(error.message));
  await gmailPage.addInitScript(() => {
    localStorage.setItem('signal:settings', JSON.stringify({ clientId: 'test.apps.googleusercontent.com', label: 'AI Newsletters' }));
    window.mockAccount = 'first@example.com';
    window.google = { accounts: { oauth2: { hasGrantedAllScopes: () => true, initTokenClient: options => ({ requestAccessToken: () => options.callback({ access_token: 'fake-test-token', expires_in: 3600, scope: 'https://www.googleapis.com/auth/gmail.readonly' }) }) } } };
  });
  const requests = [];
  await gmailPage.route('https://gmail.googleapis.com/**', async route => {
    const req = route.request(); const url = new URL(req.url()); requests.push({ url: url.href, method: req.method(), authorization: req.headers().authorization });
    assert.equal(req.method(), 'GET');
    const account = await gmailPage.evaluate(() => window.mockAccount);
    let body;
    if (url.pathname.endsWith('/profile')) body = { emailAddress: account };
    else if (url.pathname.endsWith('/labels')) body = { labels: [{ id: 'Label_1', name: 'AI Newsletters' }] };
    else if (url.pathname.endsWith('/messages')) { assert.equal(url.searchParams.get('labelIds'), 'Label_1'); body = url.searchParams.has('pageToken') ? { messages: [{ id: 'older' }] } : { messages: [{ id: 'live' }, { id: 'plain' }], nextPageToken: 'page-2' }; }
    else if (url.pathname.includes('/attachments/')) body = { data: Buffer.from('Plain attachment content with café.').toString('base64url') };
    else if (url.searchParams.get('format') === 'full') body = url.pathname.endsWith('/plain') ? { payload: { mimeType: 'text/plain', body: { attachmentId: 'att-1' } } } : { payload: { mimeType: 'multipart/alternative', parts: [{ mimeType: 'text/plain', body: { data: Buffer.from('Plain fallback').toString('base64url') } }, { mimeType: 'text/html', body: { data: Buffer.from('<h2>Research 🧠</h2><p>Useful café reading.</p><img src="https://track.invalid/x"><a href="https://example.com/research">Paper</a>').toString('base64url') } }] } };
    else body = { id: url.pathname.split('/').pop(), threadId: 'thread-1', internalDate: String(Date.now() - (url.pathname.endsWith('older') ? 12 : 1) * 86400000), snippet: 'Research &amp; practical tools', payload: { headers: [{ name: 'From', value: 'AlphaSignal <updates@example.com>' }, { name: 'Subject', value: url.pathname.endsWith('plain') ? 'Plain edition' : '<img src=x onerror=alert(1)> AI research' }] } };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await gmailPage.goto(base); await gmailPage.getByRole('button', { name: 'Connect Gmail', exact: true }).click();
  await gmailPage.locator('.edition').first().waitFor(); await gmailPage.waitForFunction(() => document.querySelector('#refresh-button').textContent === 'Refresh');
  assert.equal(await gmailPage.locator('.edition').count(), 2);
  await gmailPage.locator('.edition-title').filter({ hasText: 'AI research' }).click(); await gmailPage.locator('#reader-content').getByText('Research 🧠').waitFor();
  assert.equal(await gmailPage.locator('#reader-content img').count(), 0);
  assert.equal(await gmailPage.locator('#reader-actions a').getAttribute('href'), 'https://mail.google.com/mail/?authuser=first%40example.com#all/thread-1');
  await gmailPage.getByRole('button', { name: 'Close reader' }).click();
  await gmailPage.locator('.save-button').first().click();
  await gmailPage.getByRole('button', { name: 'Load more newsletters' }).click(); await gmailPage.waitForFunction(() => document.querySelector('#refresh-button').textContent === 'Refresh');
  await gmailPage.locator('[data-view="archive"]').click(); assert.equal(await gmailPage.locator('.edition').count(), 3);
  await gmailPage.locator('.edition-title').filter({ hasText: 'Plain edition' }).click(); await gmailPage.locator('#reader-content').getByText('Plain attachment content with café.').waitFor();
  await gmailPage.getByRole('button', { name: 'Close reader' }).click();
  const persisted = await gmailPage.evaluate(() => JSON.stringify(localStorage)); assert.doesNotMatch(persisted, /fake-test-token|Useful café|Plain attachment content/);
  await gmailPage.getByRole('button', { name: 'Disconnect', exact: true }).click();
  assert.equal(await gmailPage.locator('.edition').count(), 0);
  await gmailPage.evaluate(() => { window.mockAccount = 'second@example.com'; });
  await gmailPage.getByRole('button', { name: 'Connect Gmail', exact: true }).click(); await gmailPage.locator('.edition').first().waitFor();
  await gmailPage.waitForFunction(() => document.querySelector('#refresh-button').textContent === 'Refresh');
  assert.equal(await gmailPage.locator('#saved-count').textContent(), '0', 'State leaked across accounts');
  // A real API error must preserve the current list and surface a useful message.
  await gmailPage.unroute('https://gmail.googleapis.com/**');
  await gmailPage.route('https://gmail.googleapis.com/**', route => route.fulfill({ status: 401, contentType: 'application/json', body: '{}' }));
  await gmailPage.getByRole('button', { name: 'Refresh', exact: true }).click(); await gmailPage.locator('#notice').getByText(/session expired/).waitFor();
  assert.equal(await gmailPage.locator('.edition').count(), 2);
  assert.equal(requests.every(req => req.authorization === 'Bearer fake-test-token' && req.method === 'GET'), true);
  await gmailContext.close(); assert.deepEqual(errors, []);
  console.log('PASS: simulated OAuth/Gmail label fetching, pagination, Unicode/multipart/attachment bodies, account isolation, token/content non-persistence and expired-session errors.');
} finally { await browser.close(); }
