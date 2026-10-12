import assert from 'node:assert/strict';
import { buildReferences } from '../summary.mjs';
const { chromium, webkit } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = process.env.BROWSER_ENGINE === 'webkit'
  ? await webkit.launch({ headless: true })
  : await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true, args: ['--no-sandbox'] });
const base = process.env.READER_URL || 'http://localhost:3000';
// A traveller's timezone must not move the London report boundary.
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, timezoneId: 'America/New_York' });
const page = await context.newPage();
const errors = []; page.on('pageerror', error => errors.push(error.message));
const bodies = {
  a: '<div style="display:none">HIDDEN_PREHEADER</div><h1>Headlines &amp; Launches</h1><table><tr><td><div class="text-block"><span><a href="https://example.com/alpha"><span><strong>Model launch (3 minute read)</strong></span></a><br><br><span>ARTICLE_ALPHA: Model A launches an API.</span></span></div></td></tr><tr><td><div class="text-block"><span><a href="https://example.com/beta"><span><strong>Research results (5 minute read)</strong></span></a><br><br><span>ARTICLE_BETA: Inference costs fall. ' + 'Long research details. '.repeat(450) + '</span></span></div></td></tr></table><h2>Engineering &amp; Research</h2><table><tr><td><a href="https://example.com/omega"><strong>Last article (2 minute read)</strong></a></td></tr><tr><td><p>ARTICLE_OMEGA: An open-source evaluation tool.</p></td></tr></table>',
  b: '<h2>Tooling launch</h2><p>ARTICLE_GAMMA: A free coding tool adds local search.</p>',
  outside: '<p>This email arrived yesterday and must not be included.</p>'
};
const dates = { a: new Date('2026-10-07T00:10:00+01:00').getTime(), b: new Date('2026-10-07T23:40:00+01:00').getTime(), outside: new Date('2026-10-06T23:59:00+01:00').getTime() };
const listQueries = [], summaryRequests = [];
let failBody = false, cloudError = '', delayModel = false, saved = null, bodyRequests = 0, onlyTLDR = false;
try {
  await page.addInitScript(() => {
    localStorage.setItem('signal:progress:michaelkrestas1@gmail.com', JSON.stringify({ a: { read: true, dismissed: true } }));
    // No Summarizer or local model exists on this phone. Sign-in stays mocked.
    window.google = { accounts: { oauth2: { hasGrantedAllScopes: () => true, initTokenClient: config => ({ requestAccessToken: () => config.callback({ access_token: 'test-gmail-token', expires_in: 3600 }) }) } } };
  });
  await page.route('**/api/config', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ hosted: true, clientId: 'test.apps.googleusercontent.com', label: 'AI Newsletters' }) }));
  await page.route('**/api/brief**', async route => {
    assert.equal(route.request().headers().authorization, 'Bearer test-gmail-token');
    if (route.request().method() === 'GET') { await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ report: saved }) }); return; }
    const data = route.request().postDataJSON(); summaryRequests.push(data);
    if (delayModel) await new Promise(resolve => setTimeout(resolve, 700));
    if (cloudError) { await route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: cloudError }) }); return; }
    const report = { date: data.date, summary: '* [Model A](A1) launches a developer API.\n* **Research:** [Inference costs](A2) fall in new research.\n* Open-source evaluation and [coding tools](E2) expand.\n<img src=x onerror=alert(1)>', generatedAt: '2026-10-07T09:00:00Z', references: buildReferences(data.sources), sources: data.sources.map(({ text, articles, ...metadata }) => metadata), cached: false };
    if (!delayModel) saved = report;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ report }) }).catch(() => {});
  });
  await page.route('https://gmail.googleapis.com/**', async route => {
    const url = new URL(route.request().url()); let result;
    if (url.pathname.endsWith('/profile')) result = { emailAddress: 'michaelkrestas1@gmail.com' };
    else if (url.pathname.endsWith('/labels')) result = { labels: [{ id: 'label-1', name: 'AI Newsletters' }] };
    else if (url.pathname.endsWith('/messages')) {
      listQueries.push(url.searchParams.get('q'));
      result = url.searchParams.has('q') ? onlyTLDR ? { messages: [{ id: 'a' }] } : (url.searchParams.has('pageToken') ? { messages: [{ id: 'b' }, { id: 'outside' }] } : { messages: [{ id: 'a' }], nextPageToken: 'day-page-2' }) : { messages: [{ id: 'b' }] };
    } else {
      const id = url.pathname.split('/').pop();
      if (url.searchParams.get('format') === 'full') {
        bodyRequests++;
        if (failBody && id === 'b') { await route.fulfill({ status: 503, body: '{}' }); return; }
        result = { payload: { mimeType: 'text/html', body: { data: Buffer.from(bodies[id]).toString('base64url') } } };
      } else result = { id, threadId: 'thread-' + id, internalDate: String(dates[id]), snippet: 'Inbox preview must not be used for summaries', payload: { headers: [{ name: 'From', value: id === 'a' ? 'TLDR AI <ai@example.com>' : 'AlphaSignal <alpha@example.com>' }, { name: 'Subject', value: 'Edition ' + id }] } };
    }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(result) });
  });
  await page.goto(base);
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('signal:settings') || '{}').clientId === 'test.apps.googleusercontent.com');
  await page.getByRole('button', { name: 'Connect Gmail', exact: true }).first().click();
  await page.waitForFunction(() => document.querySelector('#connection').textContent === 'michaelkrestas1@gmail.com' && document.querySelector('#refresh-button').textContent === 'Refresh');
  await page.locator('#mobile-view').selectOption('brief'); await page.locator('#brief-date').fill('2026-10-07');
  await page.locator('#generate-brief').click();
  await page.locator('#brief-result').waitFor({ state: 'visible' });
  await page.screenshot({ path: (process.env.SCREENSHOT_DIR || 'test-results') + '/signal-v14-mobile-brief.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: (process.env.SCREENSHOT_DIR || 'test-results') + '/signal-v14-desktop-brief.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.match(await page.locator('#brief-coverage').innerText(), /2 newsletters processed/);
  assert.equal(await page.locator('.brief-source-button').count(), 2);
  assert.equal(await page.locator('#brief-text img').count(), 0);
  assert.match(await page.locator('#brief-text').innerText(), /<img src=x/);
  assert.equal(await page.locator('#brief-text .brief-item').count(), 3);
  assert.equal(await page.locator('#brief-text .brief-article-link').count(), 2);
  assert.equal(await page.locator('#brief-text .brief-article-link').first().getAttribute('href'), 'https://example.com/alpha');
  assert.equal(await page.locator('#brief-text strong').innerText(), 'Research:');
  assert.doesNotMatch(await page.locator('#brief-text').innerText(), /^\s*\*\s/m);
  assert.equal(await page.locator('#brief-update-note').isVisible(), true);
  assert.equal(await page.locator('#generate-brief').textContent(), 'Regenerate daily brief');
  const input = summaryRequests[0].sources.map(source => source.text).join('\n');
  for (const marker of ['ARTICLE_ALPHA', 'ARTICLE_BETA', 'ARTICLE_OMEGA', 'ARTICLE_GAMMA']) assert.ok(input.includes(marker), `Missing ${marker}`);
  assert.doesNotMatch(input, /arrived yesterday|Inbox preview|HIDDEN_PREHEADER/);
  assert.equal(summaryRequests[0].sources[0].articles.length, 3);
  assert.ok(listQueries.filter(Boolean).length >= 2);
  const progress = await page.evaluate(() => JSON.parse(localStorage.getItem('signal:progress:michaelkrestas1@gmail.com')));
  assert.equal(progress.a.read, true); assert.equal(Object.hasOwn(progress, 'b'), false);
  assert.doesNotMatch(await page.evaluate(() => JSON.stringify(localStorage)), /test-gmail-token|ARTICLE_ALPHA|ARTICLE_OMEGA/);
  await page.locator('#brief-sources summary').click();
  await page.locator('.brief-source-button').filter({ hasText: 'Edition a' }).click();
  await page.locator('#reader-content').getByText('ARTICLE_ALPHA:', { exact: false }).waitFor();
  assert.match(await page.locator('#reader-date').innerText(), /7 Oct/, 'Reader dates must stay in London time while travelling');
  assert.equal(await page.locator('#reader-content .newsletter-story').count(), 3);
  assert.equal(await page.locator('#reader-content .newsletter-section').count(), 2);
  assert.equal(await page.locator('#reader-content .newsletter-section').first().locator('.newsletter-story').count(), 2);
  const associations = await page.locator('#reader-content .newsletter-story').allTextContents();
  assert.match(associations[0], /Model launch.*ARTICLE_ALPHA/s); assert.doesNotMatch(associations[0], /ARTICLE_BETA/);
  assert.match(associations[1], /Research results.*ARTICLE_BETA/s); assert.doesNotMatch(associations[1], /ARTICLE_ALPHA|ARTICLE_OMEGA/);
  assert.match(associations[2], /Last article.*ARTICLE_OMEGA/s);
  const distance = await page.locator('#reader-content .newsletter-story').nth(1).evaluate(node => {
    const heading = node.querySelector('h3'), text = node.querySelector('p');
    return { bodyGap: text.getBoundingClientRect().top - heading.getBoundingClientRect().bottom, storyGap: parseFloat(getComputedStyle(node).marginTop) };
  });
  assert.ok(distance.storyGap > distance.bodyGap * 2, 'Headline must be much closer to its own body');
  await page.screenshot({ path: (process.env.SCREENSHOT_DIR || 'test-results') + '/signal-mobile-reader.png' });
  await page.locator('#reader-scroll').evaluate(node => { node.scrollTop = node.scrollHeight; });
  const close = await page.getByRole('button', { name: 'Close reader' }).boundingBox();
  assert.ok(close.y >= 0 && close.y + close.height <= 844, 'Close control scrolled out of view');
  const shell = await page.locator('.reader-shell').boundingBox();
  await page.touchscreen.tap(shell.x + 5, shell.y + 65); assert.equal(await page.locator('#reader-dialog').evaluate(node => node.open), true);
  await page.touchscreen.tap(5, 400); await page.waitForFunction(() => !document.querySelector('#reader-dialog').open);
  await page.waitForFunction(() => !document.body.classList.contains('reader-open'));
  // The report opens from cloud cache after changing away/back; it needs no AI.
  const calls = summaryRequests.length;
  await page.locator('#mobile-view').selectOption('catchup'); await page.locator('#mobile-view').selectOption('brief');
  await page.locator('#brief-status').getByText(/Saved report/).waitFor(); assert.equal(summaryRequests.length, calls);
  await page.locator('#brief-text .inline-source').click();
  await page.locator('#reader-content').getByText(/ARTICLE_GAMMA/).waitFor();
  assert.equal(await page.locator('#reader-title').innerText(), 'Edition b');
  await page.getByRole('button', { name: 'Close reader' }).click();
  const completeReport = saved;
  const bodiesBeforeCheck = bodyRequests;
  saved = { ...completeReport, sources: completeReport.sources.filter(source => source.id === 'a') };
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.locator('#brief-status').getByText(/1 new edition found/).waitFor();
  assert.equal(await page.locator('.brief-source-button').count(), 1);
  assert.match(await page.locator('#brief-day-heading').innerText(), /2 editions available/);
  assert.equal(await page.locator('#brief-day-provider-list .provider-badge').count(), 2);
  assert.match(await page.locator('#brief-day-note').innerText(), /1 edition is missing/);
  assert.equal(bodyRequests, bodiesBeforeCheck, 'Freshness checks must not fetch or send email bodies');
  assert.equal(summaryRequests.length, calls, 'Freshness checks must not use AI');
  onlyTLDR = true;
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.locator('#brief-day-note').getByText(/Only one labelled edition/).waitFor();
  assert.match(await page.locator('#brief-day-note').innerText(), /Gmail label and arrival date/);
  assert.equal(summaryRequests.length, calls);
  onlyTLDR = false; saved = completeReport;
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.locator('#brief-day-note').getByText(/Every currently available edition/).waitFor();
  // Body failures stop before sending an incomplete report.
  failBody = true; await page.locator('#generate-brief').click();
  await page.locator('#brief-status').getByText(/could not load/).waitFor();
  assert.equal(await page.locator('#brief-result').isVisible(), false); assert.equal(summaryRequests.length, calls);
  failBody = false; delayModel = true;
  await page.locator('#generate-brief').click();
  await page.locator('#brief-status').getByText(/Summarising all/).waitFor();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.locator('#brief-status').getByText(/Report cancelled/).waitFor();
  assert.equal(await page.locator('#brief-result').isVisible(), false);
  delayModel = false; cloudError = 'The free AI quota was reached. Try again tomorrow.';
  await page.locator('#generate-brief').click();
  await page.locator('#brief-status').getByText(/free AI quota/).waitFor();
  for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 844, height: 390 }, { width: 1440, height: 1000 }]) {
    await page.setViewportSize(viewport);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Page overflow at ${viewport.width}`);
  }
  assert.deepEqual(errors, []);
  console.log('PASS: hosted phone brief without local AI, OAuth configuration, full-day pagination/coverage, safe output, London travel dates, cloud cache, article grouping, fixed close, touch dismissal, failure/cancellation/quota messages and responsive layouts.');
} finally { await browser.close(); }
