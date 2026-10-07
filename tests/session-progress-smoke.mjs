import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { buildReferences } from '../summary.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = resolve('public'); let saved = null, streams = 0, cancelledStreams = 0, allowReporting = false, allowComplete = false;
const json = (res, data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    const signedIn = req.headers.cookie?.includes('signal_test=1');
    if (url.pathname === '/api/config') return json(res, { hosted: true, persistentAuth: true, version: '1.7', clientId: 'test.apps.googleusercontent.com', label: 'AI Newsletters' });
    if (url.pathname === '/api/auth/session') return json(res, signedIn ? { connected: true, email: 'owner@example.com' } : { connected: false }, signedIn ? 200 : 401);
    if (url.pathname === '/api/auth/login') { res.writeHead(303, { Location: '/', 'Set-Cookie': 'signal_test=1; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000' }); return res.end(); }
    if (url.pathname === '/api/auth/logout') { res.setHeader('Set-Cookie', 'signal_test=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'); return json(res, { connected: false }); }
    if (url.pathname.startsWith('/api/gmail/')) {
      assert.ok(signedIn); assert.equal(req.headers.authorization, undefined);
      if (url.pathname.endsWith('/labels')) return json(res, { labels: [{ id: 'newsletters', name: 'AI Newsletters' }] });
      if (url.pathname.endsWith('/messages')) return json(res, { messages: ['a', 'b', 'c'].map(id => ({ id })) });
      const id = url.pathname.split('/').pop();
      if (url.searchParams.get('format') === 'full') return json(res, { payload: { mimeType: 'text/html', body: { data: Buffer.from(`<h2><a href="https://example.com/${id}">Article ${id}</a></h2><p>News details for edition ${id}.</p>`).toString('base64url') } } });
      return json(res, { id, threadId: id, internalDate: String(Date.now()), snippet: 'A short newsletter preview', payload: { headers: [{ name: 'Subject', value: 'Edition ' + id }, { name: 'From', value: id === 'a' ? 'TLDR AI <ai@example.com>' : id === 'b' ? 'AlphaSignal <news@example.com>' : '"DAIR.AI via LinkedIn" <newsletters-noreply@linkedin.com>' }] } });
    }
    if (url.pathname === '/api/brief' && req.method === 'GET') return json(res, { report: saved });
    if (url.pathname === '/api/brief' && req.method === 'POST') {
      assert.ok(signedIn); assert.equal(req.headers.authorization, undefined); assert.equal(req.headers.accept, 'text/event-stream');
      let input = ''; for await (const chunk of req) input += chunk;
      const data = JSON.parse(input); assert.equal(data.sources.length, 3); streams++;
      let cancelled = false; res.on('close', () => { if (!res.writableEnded) { cancelled = true; cancelledStreams++; } });
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
      const emit = async value => {
        if (cancelled) return;
        const frame = 'data: ' + JSON.stringify(value) + '\n\n'; res.write(frame.slice(0, 5)); await pause(5); if (!cancelled) res.write(frame.slice(5));
      };
      await emit({ type: 'progress', stage: 'evaluating', done: 0, total: 3, message: 'Evaluating all three newsletters…' });
      while (!allowReporting && !cancelled) await pause(10); if (cancelled) return;
      await emit({ type: 'progress', stage: 'evaluating', done: 3, total: 3, message: 'Compared every newsletter.' });
      await emit({ type: 'progress', stage: 'reporting', message: 'Writing the report and linking articles…' });
      while (!allowComplete && !cancelled) await pause(10); if (cancelled) return;
      saved = { date: data.date, editorialVersion: 'signal-7', highlights: [
        { headline: 'New model API becomes available', detail: 'Developers can now test the model through a new API.', reference: 'A1' },
        { headline: 'Research improves model evaluation', detail: 'The researchers report new evidence for more useful model evaluations.', reference: 'A2' },
        { headline: 'AI tools gain a new capability', detail: 'The tools now support a practical new workflow for developers.', reference: 'A3' }
      ], references: buildReferences(data.sources), sources: data.sources.map(({ text, articles, ...metadata }) => metadata), generatedAt: new Date().toISOString() };
      await emit({ type: 'complete', report: saved }); res.end(); return;
    }
    const path = resolve(root, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
    if (!path.startsWith(root + '/')) { res.writeHead(404); return res.end(); }
    const data = await readFile(path); const types = { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.html': 'text/html' };
    res.writeHead(200, { 'Content-Type': types[extname(path)] || 'text/plain', 'Cache-Control': 'no-store' }); res.end(data);
  } catch (error) { if (!res.headersSent) json(res, { error: error.message }, 500); else res.destroy(error); }
});
await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
const base = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true, args: ['--no-sandbox'] });
const errors = [];
try {
  let context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }); let page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base); await page.getByRole('button', { name: 'Connect Gmail', exact: true }).first().click();
  await page.waitForFunction(() => document.querySelector('#connection').textContent === 'owner@example.com');
  await page.locator('.edition').first().waitFor(); assert.equal(await page.locator('.edition').count(), 3);
  const modules = await page.evaluate(() => performance.getEntriesByType('resource').filter(item => /\.js(?:\?|$)/.test(item.name)).map(item => item.name));
  assert.ok(modules.filter(url => url.startsWith(base)).every(url => url.endsWith('?v=7')));
  assert.match(await page.locator('#footer-note + span').innerText(), /Signal 1\.7/);
  const filter = name => page.locator('#source-filters .filter-chip').filter({ has: page.locator('span').getByText(name, { exact: true }) });
  await filter('TLDR AI').click(); await filter('AlphaSignal').click(); await filter('DAIR.AI').click();
  const colours = await page.locator('#source-filters .filter-chip[aria-pressed="true"]').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).backgroundColor)); assert.equal(new Set(colours).size, 3);
  await page.locator('.save-button').first().click(); assert.equal(await page.locator('#reader-dialog').evaluate(node => node.open), false);
  const card = await page.locator('.edition').first().boundingBox(); await page.mouse.click(card.x + 10, card.y + card.height / 2);
  await page.locator('#reader-content').getByText(/News details/).waitFor(); await page.getByRole('button', { name: 'Close reader' }).click();
  await page.locator('[data-view="saved"]').click();
  const savedCard = await page.locator('.edition').first().boundingBox(); await page.mouse.click(savedCard.x + 10, savedCard.y + 12);
  await page.locator('#reader-content').getByText(/News details/).waitFor(); await page.getByRole('button', { name: 'Close reader' }).click();
  await page.locator('[data-view="archive"]').click();
  const actions = await page.locator('.edition-actions').first().boundingBox(); await page.mouse.click(actions.x + actions.width - 4, actions.y + 12);
  await page.locator('#reader-content').getByText(/News details/).waitFor(); await page.getByRole('button', { name: 'Close reader' }).click();
  await page.locator('.edition-actions').first().getByRole('button', { name: 'Dismiss', exact: true }).click();
  assert.equal(await page.locator('#reader-dialog').evaluate(node => node.open), false);
  await page.locator('.edition-title').first().focus(); await page.keyboard.press('Enter');
  await page.locator('#reader-content').getByText(/News details/).waitFor(); await page.getByRole('button', { name: 'Close reader' }).click();
  await page.reload(); await page.waitForFunction(() => document.querySelector('#connection').textContent === 'owner@example.com');
  const storage = await context.storageState(); assert.ok(storage.cookies.some(cookie => cookie.httpOnly));
  assert.doesNotMatch(await page.evaluate(() => JSON.stringify(localStorage)), /access_token|refresh_token|private-refresh|signal_test/);
  await context.close(); context = await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: storage, hasTouch: true }); page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base); await page.waitForFunction(() => document.querySelector('#connection').textContent === 'owner@example.com');
  assert.equal(await page.locator('#footer-note + span').isVisible(), true);
  await page.locator('.edition').first().waitFor();
  const mobileCard = await page.locator('.edition').first().boundingBox(); await page.touchscreen.tap(mobileCard.x + 8, mobileCard.y + mobileCard.height / 2);
  await page.locator('#reader-content').getByText(/News details/).waitFor(); await page.getByRole('button', { name: 'Close reader' }).click();
  await page.locator('#mobile-view').selectOption('brief');
  await page.getByRole('button', { name: 'Generate daily brief', exact: true }).click();
  await page.locator('.brief-stages [data-stage="evaluating"][aria-current="step"]').waitFor();
  assert.ok(await page.locator('#brief-progress').evaluate(node => node.value) < 100);
  allowReporting = true;
  await page.locator('.brief-stages [data-stage="reporting"][aria-current="step"]').waitFor();
  assert.ok(await page.locator('#brief-progress').evaluate(node => node.value) < 100);
  allowComplete = true;
  await page.locator('.brief-stages [data-stage="complete"][aria-current="step"]').waitFor();
  assert.equal(await page.locator('#brief-progress').evaluate(node => node.value), 100); assert.equal(await page.locator('.brief-item').count(), 3);
  await pause(250); // Let the short progress-bar transition finish before capturing.
  await page.screenshot({ path: '/tmp/signal-v16-phone-progress.png', fullPage: true });
  allowReporting = false; allowComplete = false;
  await page.getByRole('button', { name: 'Generate daily brief', exact: true }).click();
  await page.locator('.brief-stages [data-stage="evaluating"][aria-current="step"]').waitFor();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.locator('#brief-status').getByText(/cancelled/i).waitFor();
  assert.ok(await page.locator('#brief-progress').evaluate(node => node.value) < 100);
  await pause(400); assert.ok(cancelledStreams >= 1); assert.equal(streams, 2);
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#connection').textContent === 'Not connected');
  await page.reload(); await page.getByRole('button', { name: 'Connect Gmail', exact: true }).first().waitFor();
  assert.equal(await page.locator('#connection').innerText(), 'Not connected');
  assert.deepEqual(errors, []);
  console.log('PASS: whole cards on desktop/phone, independent Save, distinct colours, versioned assets, persistent account across reload/browser restart, cookie logout, no browser credentials, real streamed stages and cancellation.');
} finally { await browser.close(); server.closeAllConnections(); await new Promise(resolveClose => server.close(resolveClose)); }
