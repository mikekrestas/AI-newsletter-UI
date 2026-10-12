import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import worker from '../worker.mjs';
import { dayRange } from '../public/dates.js';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = resolve('public'), date = '2026-10-11', records = new Map(), requests = [];
let mode = 'recover', calls = 0;
const good = { headline: 'Video generation becomes more accessible', detail: 'The new video tools add more controls for creators.', reference: 'A1' };
const env = {
  OWNER_EMAIL: 'michaelkrestas1@gmail.com', GOOGLE_CLIENT_ID: 'test.apps.googleusercontent.com',
  REPORTS: { get: async key => records.has(key) ? JSON.parse(records.get(key)) : null, put: async (key, value) => records.set(key, value) },
  ASSETS: { fetch: async request => {
    const path = resolve(root, '.' + (new URL(request.url).pathname === '/' ? '/index.html' : new URL(request.url).pathname));
    if (!path.startsWith(root + '/')) return new Response('Not found', { status: 404 });
    try { return new Response(await readFile(path), { headers: { 'Content-Type': { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.html': 'text/html' }[extname(path)] || 'text/plain' } }); }
    catch { return new Response('Not found', { status: 404 }); }
  } },
  AI: { run: async (model, input) => {
    calls++; const system = input.messages[0].content;
    if (mode === 'quota') throw new Error('daily neuron quota exceeded');
    if (system.includes('opening paragraph')) return { response: 'Today’s newsletters focus on more accessible video generation. The new controls give creators more ways to shape their output.' };
    if (mode === 'headlines') return { response: '* [Video tools](A1) The new controls are available for' };
    if (!system.includes('JSON object')) return { response: 'New video tools give creators more control (A1).' };
    if (mode === 'recover' && system.includes('EDITORIAL REVIEW')) return { response: 'Incomplete rewrite: {"highlights":[' };
    return { response: 'Your brief:\n```json\n' + JSON.stringify({ highlights: mode === 'recover' ? [good, { headline: 'A fragment must never be displayed', detail: 'The model ran for 3 hours of', reference: 'A1' }] : [good] }) + '\n```' };
  } }
};
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => String(url) === 'https://gmail.googleapis.com/gmail/v1/users/me/profile'
  ? Response.json({ emailAddress: env.OWNER_EMAIL }) : originalFetch(url, options);
const server = http.createServer(async (req, res) => {
  try {
    let body = ''; for await (const chunk of req) body += chunk;
    if (req.method === 'POST') requests.push(JSON.parse(body));
    const response = await worker.fetch(new Request('http://' + req.headers.host + req.url, { method: req.method, headers: req.headers, ...(body ? { body } : {}) }), env);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    const reader = response.body?.getReader(); if (reader) { while (true) { const { done, value } = await reader.read(); if (done) break; res.write(value); } }
    res.end();
  } catch (error) { res.writeHead(500).end(error.message); }
});
await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
const base = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true, args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true }), page = await context.newPage(), errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(() => { window.google = { accounts: { oauth2: { hasGrantedAllScopes: () => true, initTokenClient: config => ({ requestAccessToken: () => config.callback({ access_token: 'test-gmail-token', expires_in: 3600 }) }) } } }; });
await context.route('https://example.com/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>Original video article</h1>' }));
await page.route('https://gmail.googleapis.com/**', route => {
  const url = new URL(route.request().url()); let result;
  if (url.pathname.endsWith('/profile')) result = { emailAddress: env.OWNER_EMAIL };
  else if (url.pathname.endsWith('/labels')) result = { labels: [{ id: 'label-1', name: 'AI Newsletters' }] };
  else if (url.pathname.endsWith('/messages')) result = { messages: [{ id: 'video' }] };
  else if (url.searchParams.get('format') === 'full') result = { payload: { mimeType: 'text/html', body: { data: Buffer.from('<h2><a href="https://example.com/video">Video tools launch new creator controls</a></h2><p>The release adds new controls for creators using AI video generation.</p>').toString('base64url') } } };
  else result = { id: 'video', threadId: 'video', internalDate: String(dayRange(date).start + 3600000), payload: { headers: [{ name: 'From', value: 'TLDR AI <ai@example.com>' }, { name: 'Subject', value: 'Video generation news' }] } };
  return route.fulfill({ contentType: 'application/json', body: JSON.stringify(result) });
});
try {
  await page.goto(base); await page.waitForFunction(() => JSON.parse(localStorage.getItem('signal:settings') || '{}').clientId === 'test.apps.googleusercontent.com');
  await page.getByRole('button', { name: 'Connect Gmail', exact: true }).first().click();
  await page.waitForFunction(() => document.querySelector('#connection').textContent === 'michaelkrestas1@gmail.com' && document.querySelector('#refresh-button').textContent === 'Refresh');
  await page.locator('#mobile-view').selectOption('brief'); await page.locator('#brief-date').fill(date);
  await page.locator('#generate-brief').click(); await page.locator('#brief-result').waitFor();
  await page.waitForFunction(() => document.querySelector('#brief-progress').value === 100);
  assert.equal(await page.locator('.structured-highlight').count(), 1);
  assert.match(await page.locator('.brief-overview').innerText(), /Today’s newsletters focus on more accessible video generation/);
  assert.doesNotMatch(await page.locator('#brief-text').innerText(), /fragment|3 hours of|\b[AE]\d+\b/);
  assert.equal(await page.locator('#brief-status.is-error').count(), 0);
  for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 1440, height: 1000 }]) {
    await page.setViewportSize(viewport);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const order = await page.evaluate(() => document.querySelector('.brief-overview').getBoundingClientRect().top < document.querySelector('.brief-highlights').getBoundingClientRect().top); assert.equal(order, true);
    const inputFits = await page.locator('#brief-date').evaluate(node => node.getBoundingClientRect().right <= node.parentElement.getBoundingClientRect().right + 1); assert.equal(inputFits, true);
    await page.locator('#brief-result').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `/tmp/signal-v18-${viewport.width}-brief.png`, fullPage: true });
    if (viewport.width === 390) {
      await page.evaluate(() => { document.activeElement?.blur(); document.querySelector('#brief-result').scrollIntoView({ block: 'start', behavior: 'instant' }); });
      await page.screenshot({ path: '/tmp/signal-v18-phone-viewport.png' });
    }
  }
  const generatedCalls = calls;
  await page.reload(); await page.getByRole('button', { name: 'Connect Gmail', exact: true }).first().click();
  await page.waitForFunction(() => document.querySelector('#connection').textContent === 'michaelkrestas1@gmail.com' && document.querySelector('#refresh-button').textContent === 'Refresh');
  await page.locator('[data-view="brief"]').click(); await page.locator('#brief-date').fill(date); await page.locator('.brief-overview').waitFor();
  assert.equal(calls, generatedCalls); // Reading the hosted cache spends no AI.
  mode = 'headlines'; records.clear();
  await page.locator('#generate-brief').click(); await page.getByRole('button', { name: 'Retry AI writing', exact: true }).waitFor();
  assert.equal(await page.locator('.brief-fallback-note').isVisible(), true);
  assert.equal(await page.locator('.brief-headline').innerText(), 'Video tools launch new creator controls');
  assert.equal(await page.locator('.brief-story-link').getAttribute('href'), 'https://example.com/video');
  const popup = page.waitForEvent('popup'); await page.locator('.brief-story-link').click(); const article = await popup; await article.waitForLoadState(); assert.equal(article.url(), 'https://example.com/video'); await article.close();
  // PR #7's metadata-only Refresh must clear stale fallback controls when a
  // saved report disappears, without spending AI or remembering a retry flag.
  const beforeRefresh = calls; records.clear();
  await page.locator('#refresh-button').click(); await page.locator('#brief-status').getByText(/No saved report/).waitFor();
  assert.equal(calls, beforeRefresh);
  assert.equal(await page.getByRole('button', { name: 'Retry AI writing', exact: true }).count(), 0);
  assert.equal(await page.locator('#brief-result').isVisible(), false);
  await page.getByRole('button', { name: 'Generate daily brief', exact: true }).click();
  await page.getByRole('button', { name: 'Retry AI writing', exact: true }).waitFor();
  assert.equal(requests.at(-1).retryWriting, undefined);
  mode = 'normal'; await page.getByRole('button', { name: 'Retry AI writing', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('#brief-panel').matches('[aria-busy="true"]'));
  assert.equal(requests.at(-1).retryWriting, true);
  assert.equal(await page.locator('.brief-fallback-note').count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Generate daily brief', exact: true }).count(), 1);
  // Untrusted overview text stays literal, even when rendering a legacy record.
  const safe = await page.evaluate(async () => {
    const { renderOverview } = await import('/report.js?v=8');
    const node = renderOverview({ overview: '<img src=x onerror=alert(1)> literal text.' });
    return { images: node.querySelectorAll('img').length, text: node.textContent, missing: renderOverview({}) };
  });
  assert.equal(safe.images, 0); assert.match(safe.text, /<img/); assert.equal(safe.missing, null);
  mode = 'quota'; records.clear(); await page.locator('#generate-brief').click();
  await page.locator('#brief-status.is-error').getByText(/free AI quota/).waitFor(); assert.equal(records.size, 0);
  assert.deepEqual(errors, []);
  console.log('PASS: real Worker streaming -> browser recovery, grounded overview above highlights, 320/390/1440 layouts, private cached overview, labelled original-headline fallback, exact article navigation, explicit retry, safe text and quota error. Google/AI mocked.');
} finally {
  globalThis.fetch = originalFetch; await browser.close(); server.closeAllConnections(); await new Promise(resolveClose => server.close(resolveClose));
}
