import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { buildReferences } from '../summary.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = resolve('public');
const now = new Date('2026-10-07T18:00:00Z').getTime();
const fixtures = {
  a: { from: 'TLDR AI <ai@example.com>', subject: 'Model release', date: now - 10000 },
  b: { from: 'AlphaSignal <news@example.com>', subject: 'Research release', date: now - 20000 },
  c: { from: 'LinkedIn <newsletters-noreply@linkedin.com>', subject: 'Top AI Papers of the Week: research roundup', date: now - 30000 },
  d: { from: 'TLDR Dev <dev@example.com>', subject: 'Developer tooling', date: now - 40000 },
  older: { from: 'AlphaSignal <news@example.com>', subject: 'Older edition', date: new Date('2026-09-28T12:00:00Z').getTime() },
  outside: { from: 'Other <other@example.com>', subject: 'Tomorrow in London', date: new Date('2026-10-07T23:00:00Z').getTime() }
};
let arrivals = false, failPage = false, repeatPage = false, report = null;
const posts = [], queries = []; let bodies = 0;
const json = (res, value, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/api/config') return json(res, { hosted: true, persistentAuth: true, clientId: 'test.apps.googleusercontent.com', label: 'AI Newsletters' });
    if (url.pathname === '/api/auth/session') return json(res, { connected: true, email: 'owner@example.com' });
    if (url.pathname === '/api/gmail/labels') return json(res, { labels: [{ id: 'label-1', name: 'AI Newsletters' }] });
    if (url.pathname === '/api/gmail/messages') {
      assert.equal(req.method, 'GET'); assert.equal(url.searchParams.get('labelIds'), 'label-1');
      const query = url.searchParams.get('q'), token = url.searchParams.get('pageToken'); queries.push({ query, token });
      if (query && token && failPage) return json(res, {}, 503);
      const ids = query ? token ? arrivals ? ['c', 'd', 'a', 'outside'] : [] : ['a', 'b'] : token ? ['older'] : ['a', 'b'];
      return json(res, { messages: ids.map(id => ({ id })), nextPageToken: query ? (!token || repeatPage) ? 'recent-2' : undefined : token ? undefined : 'older-2' });
    }
    if (url.pathname.startsWith('/api/gmail/messages/')) {
      const id = url.pathname.split('/').pop(), item = fixtures[id]; assert.ok(item);
      if (url.searchParams.get('format') === 'full') {
        bodies++;
        return json(res, { payload: { mimeType: 'text/html', body: { data: Buffer.from(`<h2><a href="https://example.com/${id}">${item.subject}</a></h2><p>FULL_${id}: A substantive AI development with supporting details.</p>`).toString('base64url') } } });
      }
      return json(res, { id, threadId: 'thread-' + id, internalDate: String(item.date), snippet: 'An edition preview', payload: { headers: [{ name: 'From', value: item.from }, { name: 'Subject', value: item.subject }] } });
    }
    if (url.pathname === '/api/brief') {
      if (req.method === 'GET') return json(res, { report });
      let text = ''; for await (const chunk of req) text += chunk;
      const input = JSON.parse(text); posts.push(input);
      report = { date: input.date, editorialVersion: 'signal-7', highlights: [], references: buildReferences(input.sources), sources: input.sources.map(({ text, articles, ...metadata }) => metadata), generatedAt: new Date(now).toISOString() };
      return json(res, { report });
    }
    const path = resolve(root, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
    if (!path.startsWith(root + sep)) { res.writeHead(404); return res.end(); }
    const data = await readFile(path);
    res.writeHead(200, { 'Content-Type': { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml' }[extname(path)] || 'text/plain', 'Cache-Control': 'no-store' }); res.end(data);
  } catch (error) { json(res, { error: error.message }, 500); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true, args: ['--no-sandbox'] });
const base = 'http://127.0.0.1:' + server.address().port;
const errors = [];
try {
  for (const width of [1440, 390]) {
    arrivals = false; failPage = false; repeatPage = false; report = null; bodies = 0;
    const context = await browser.newContext({ viewport: { width, height: 1000 }, hasTouch: width === 390, timezoneId: 'Asia/Tokyo' });
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.clock.setFixedTime(new Date(now));
    await page.addInitScript(() => localStorage.setItem('signal:progress:owner@example.com', JSON.stringify({ a: { read: true }, b: { dismissed: true } })));
    await page.goto(base);
    await page.waitForFunction(() => document.querySelector('#refresh-button').textContent === 'Refresh' && document.querySelector('#connection').textContent === 'owner@example.com');
    assert.match(await page.locator('#inbox-coverage-count').innerText(), /2 editions received today/);
    assert.equal(await page.locator('.edition').count(), 0);
    arrivals = true;
    await page.locator('#refresh-button').click();
    await page.waitForFunction(() => document.querySelector('#refresh-button').textContent === 'Refresh');
    assert.match(await page.locator('#inbox-coverage-count').innerText(), /4 editions received today.*7 Oct/);
    assert.match(await page.locator('#inbox-coverage-note').innerText(), /2 read or dismissed/);
    assert.equal(await page.locator('.edition').count(), 2);
    assert.ok(queries.some(item => item.query && item.token === 'recent-2'));
    assert.match(await page.locator('#notice').innerText(), /Refresh complete/);
    assert.equal(await page.locator('#source-filters [data-source-filter="DAIR.AI"]').count(), 1);
    assert.equal(bodies, 0, 'Refresh must not retrieve bodies'); assert.equal(posts.length, width === 1440 ? 0 : 1, 'Refresh must not invoke AI');
    if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: resolve(process.env.SCREENSHOT_DIR, `refresh-coverage-${width}.png`), fullPage: true });
    await page.locator('#source-filters [data-source-filter="TLDR Dev"]').click();
    assert.equal(await page.locator('.edition').count(), 1);
    assert.match(await page.locator('#inbox-coverage-note').innerText(), /1 hidden by your source filters/);
    await page.locator('#show-all-editions').click();
    assert.equal(await page.locator('.edition').count(), 4);
    assert.equal(await page.locator('.edition').filter({ hasText: 'DAIR.AI' }).count(), 1);
    await page.locator('#load-more').click();
    await page.waitForFunction(() => document.querySelector('#refresh-button').textContent === 'Refresh');
    assert.equal(await page.locator('.edition').count(), 5);
    await page.locator('#refresh-button').click();
    await page.waitForFunction(() => document.querySelector('#refresh-button').textContent === 'Refresh');
    assert.equal(await page.locator('.edition').count(), 5, 'Refresh must retain already-loaded older editions');
    // A second-page failure must not replace a complete visible collection.
    failPage = true;
    await page.locator('#refresh-button').click();
    await page.locator('#notice.error').getByText(/could not load/).waitFor();
    assert.equal(await page.locator('.edition').count(), 5); failPage = false;
    await page.locator('#mobile-view').selectOption('brief', { force: true }).catch(async () => { await page.locator('[data-view="brief"]').click(); });
    await page.waitForFunction(() => !document.querySelector('#generate-brief').disabled);
    assert.match(await page.locator('#brief-day-heading').innerText(), /4 editions available/);
    await page.locator('#generate-brief').click(); await page.locator('#brief-result').waitFor({ state: 'visible' });
    const input = posts.at(-1); assert.equal(input.date, '2026-10-07');
    assert.deepEqual(input.sources.map(item => item.id), ['d', 'c', 'b', 'a']);
    assert.equal(input.sources.find(item => item.id === 'c').source, 'DAIR.AI');
    for (const source of input.sources) { assert.ok(source.text.includes('FULL_' + source.id)); assert.equal(source.articles.length, 1); }
    assert.match(await page.locator('#brief-coverage').innerText(), /4 newsletters processed/);
    // Refresh rechecks both lists and saved coverage, but never calls the model.
    report = { ...report, sources: report.sources.filter(item => item.id !== 'c') };
    const calls = posts.length, reads = bodies;
    await page.locator('#refresh-button').click();
    await page.locator('#brief-day-note').getByText(/1 edition is missing/).waitFor();
    assert.equal(posts.length, calls); assert.equal(bodies, reads);
    assert.equal(await page.locator('#brief-day-provider-list [data-tone="rose"]').count(), 1);
    report = null;
    await page.locator('#refresh-button').click();
    await page.locator('#brief-status').getByText(/No saved report/).waitFor();
    assert.equal(await page.locator('#brief-result').isVisible(), false, 'An absent saved report must clear stale content');
    repeatPage = true;
    await page.locator('#refresh-button').click();
    await page.locator('#notice.error').getByText(/repeated a results page/).waitFor();
    repeatPage = false;
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log('PASS: desktop/phone refresh pagination, DAIR LinkedIn identity, received versus hidden counts, preserved older editions, failure/repeated-page recovery and identical four-edition daily inputs without AI on refresh.');
} finally { await browser.close(); server.closeAllConnections(); await new Promise(done => server.close(done)); }
