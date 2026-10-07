import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true, args: ['--no-sandbox'] });
const base = process.env.READER_URL || 'http://localhost:3000';
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, hasTouch: true });
const page = await context.newPage(); const errors = [];
page.on('pageerror', error => errors.push(error.message));
const filter = name => page.locator('#source-filters .filter-chip').filter({ has: page.locator('span').getByText(name, { exact: true }) });
const choose = async name => {
  if (await page.locator('#mobile-view').isVisible()) await page.locator('#mobile-view').selectOption(name);
  else await page.locator(`[data-view="${name}"]`).click();
};
try {
  await page.goto(base); await page.getByRole('button', { name: 'Try a demo' }).click();
  assert.equal(await page.locator('.newsletter-group').count(), 5);
  await page.screenshot({ path: '/tmp/signal-v14-desktop.png', fullPage: true });
  await filter('TLDR AI').click(); assert.equal(await page.locator('.edition').count(), 1);
  await filter('AlphaSignal').click(); assert.equal(await page.locator('.edition').count(), 2);
  const tldrColour = await filter('TLDR AI').evaluate(node => getComputedStyle(node).backgroundColor);
  const alphaColour = await filter('AlphaSignal').evaluate(node => getComputedStyle(node).backgroundColor);
  assert.notEqual(tldrColour, alphaColour, 'Selected providers must have distinct colours');
  assert.equal(await filter('TLDR AI').getAttribute('data-tone'), 'violet');
  assert.equal(await filter('AlphaSignal').getAttribute('data-tone'), 'amber');
  await filter('DAIR.AI').click();
  const dairColour = await filter('DAIR.AI').evaluate(node => getComputedStyle(node).backgroundColor);
  assert.notEqual(dairColour, tldrColour); assert.notEqual(dairColour, alphaColour);
  await filter('DAIR.AI').click();
  assert.equal(await filter('TLDR AI').getAttribute('aria-pressed'), 'true');
  await filter('TLDR AI').click(); assert.equal(await page.locator('.newsletter-group-heading h2').innerText(), 'AlphaSignal');
  await filter('AlphaSignal').click(); assert.equal(await filter('All').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('.edition').count(), 5);
  await filter('TLDR AI').click(); await page.locator('.save-button').click();
  await choose('saved'); assert.equal(await page.locator('.edition').count(), 1); assert.equal(await page.locator('#source-filter-panel').isVisible(), false);
  await choose('catchup'); assert.equal(await filter('TLDR AI').getAttribute('aria-pressed'), 'true');
  await page.reload(); await page.getByRole('button', { name: 'Try a demo' }).click(); assert.equal(await page.locator('.edition').count(), 1);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.locator('#mobile-view').isVisible(), true); assert.equal(await page.locator('.sidebar nav').isVisible(), false);
  await filter('All').click();
  await page.locator('#source-filters').evaluate(node => { node.scrollLeft = node.scrollWidth; });
  await filter('TLDR Dev').evaluate(node => node.click());
  assert.ok(await page.locator('#source-filters').evaluate(node => node.scrollLeft) > 0, 'Selecting a source must preserve the mobile filter scroll position');
  await filter('TLDR Dev').evaluate(node => node.click());
  await filter('All').click(); await page.screenshot({ path: '/tmp/signal-v14-mobile.png', fullPage: true });
  await choose('saved'); await page.locator('.edition-title').click();
  await page.locator('#reader-content').getByText('Demo edition.', { exact: true }).waitFor();
  assert.equal(await page.locator('#reader-content .newsletter-section').count(), 2);
  assert.equal(await page.locator('#reader-content .newsletter-section').first().locator('.newsletter-story').count(), 2);
  assert.equal(await page.locator('#reader-content .newsletter-heading a').count(), 3);
  const borders = await page.locator('#reader-content .newsletter-story').first().evaluate(node => getComputedStyle(node).borderLeftWidth); assert.equal(borders, '0px');
  await page.screenshot({ path: '/tmp/signal-v14-mobile-sections.png' });
  await page.locator('#reader-scroll').evaluate(node => { node.scrollTop = node.scrollHeight; });
  const close = await page.getByRole('button', { name: 'Close reader' }).boundingBox(); assert.ok(close.y + close.height <= 844);
  await page.touchscreen.tap(5, 400); await page.waitForFunction(() => !document.querySelector('#reader-dialog').open);
  await choose('catchup'); await filter('TLDR AI').click();
  // Opening a selected edition updates its count and offers a clear way out of
  // an empty filter without changing Saved or other source selections.
  assert.equal(await page.locator('.edition').count(), 0); assert.equal(await page.locator('#clear-filters').isVisible(), true);
  await page.locator('#clear-filters').click(); assert.equal(await page.locator('.edition').count(), 4);
  // Existing plain-text reports become styled items. Unknown model URLs and
  // unsafe cached references never turn into clickable links or executable HTML.
  const safety = await page.evaluate(async () => {
    const { renderReport } = await import('/report.js');
    const { extractArticles, readableContent } = await import('/reader.js');
    const report = { summary: '* **Release:** [real article](A1) launches.\n* [Unsafe](A2) and [made-up](https://invented.invalid/) plus <img src=x onerror=alert(1)>.', references: [{ key: 'A1', type: 'article', url: 'https://example.com/real', title: 'Real', source: 'TLDR' }, { key: 'A2', type: 'article', url: 'javascript:alert(1)' }], sources: [] };
    const rendered = renderReport(report, () => {});
    const old = renderReport({ summary: '* One legacy point.\n* A second legacy point.', sources: [] }, () => {});
    const article = extractArticles({ content: '<h1>Headlines &amp; Launches</h1><h3><a href="https://tracking.tldrnewsletter.com/CL0/https:%2F%2Fexample.com%2Fnews/1/private-token">News (3 minute read)</a></h3><p>Details.</p>', html: true });
    const sections = readableContent('<h1>Headlines &amp; Launches</h1><a href="https://example.com/one"><strong>Launch one (2 minute read)</strong></a><p>First story.</p><h1>Deep Dives &amp; Analysis</h1><a href="https://example.com/two"><strong>Inside a new model (4 minute read)</strong></a><p>Second story.</p><h1>Engineering &amp; Research</h1><h3><a href="https://example.com/three">Research three</a></h3><p>Third story.</p><h1>Love TLDR?</h1><h3>Share the newsletter</h3><p>Footer.</p>');
    return { items: rendered.children.length, links: [...rendered.querySelectorAll('a')].map(a => a.href), images: rendered.querySelectorAll('img').length, text: rendered.textContent, legacy: old.children.length, article, sections: [...sections.querySelectorAll('.newsletter-section')].map(section => ({ title: section.firstElementChild.textContent, stories: section.querySelectorAll('.newsletter-story').length })), footerStories: sections.querySelectorAll('.newsletter-outro .newsletter-story').length };
  });
  assert.equal(safety.items, 2); assert.equal(safety.legacy, 2); assert.deepEqual(safety.links, ['https://example.com/real']); assert.equal(safety.images, 0);
  assert.match(safety.text, /<img/); assert.equal(safety.article[0].url, 'https://example.com/news');
  assert.deepEqual(safety.sections, [{ title: 'Headlines & Launches', stories: 1 }, { title: 'Deep Dives & Analysis', stories: 1 }, { title: 'Engineering & Research', stories: 1 }]);
  assert.equal(safety.footerStories, 0);
  // Filters are independent of report generation; fetching later Gmail pages
  // discovers new newsletter names without resetting a current selection.
  const gmailContext = await browser.newContext({ viewport: { width: 390, height: 844 } }); const gmailPage = await gmailContext.newPage();
  gmailPage.on('pageerror', error => errors.push(error.message));
  await gmailPage.addInitScript(() => {
    localStorage.setItem('signal:settings', JSON.stringify({ clientId: 'test.apps.googleusercontent.com', label: 'AI Newsletters' }));
    window.google = { accounts: { oauth2: { hasGrantedAllScopes: () => true, initTokenClient: options => ({ requestAccessToken: () => options.callback({ access_token: 'fake-token', expires_in: 3600 }) }) } } };
  });
  let requests = 0;
  await gmailPage.route('https://gmail.googleapis.com/**', async route => {
    requests++; const url = new URL(route.request().url()); let data;
    if (url.pathname.endsWith('profile')) data = { emailAddress: 'reader@example.com' };
    else if (url.pathname.endsWith('labels')) data = { labels: [{ id: 'newsletters', name: 'AI Newsletters' }] };
    else if (url.pathname.endsWith('messages')) data = url.searchParams.has('pageToken') ? { messages: [{ id: 'new' }] } : { messages: [{ id: 'first' }], nextPageToken: 'next' };
    else {
      const id = url.pathname.split('/').pop();
      data = { id, threadId: id, internalDate: String(Date.now()), snippet: 'Example newsletter', payload: { headers: [{ name: 'From', value: id === 'first' ? 'TLDR AI <ai@example.com>' : 'New Research Weekly <new@example.com>' }, { name: 'Subject', value: 'Edition ' + id }] } };
    }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
  });
  await gmailPage.goto(base); await gmailPage.getByRole('button', { name: 'Connect Gmail', exact: true }).click();
  await gmailPage.locator('.edition').waitFor();
  const chip = name => gmailPage.locator('#source-filters .filter-chip').filter({ hasText: name });
  const beforeFilter = requests; await chip('TLDR AI').click(); assert.equal(requests, beforeFilter);
  await gmailPage.getByRole('button', { name: 'Load more newsletters' }).click(); await chip('New Research Weekly').waitFor();
  assert.equal(await chip('TLDR AI').getAttribute('aria-pressed'), 'true'); assert.equal(await gmailPage.locator('.edition').count(), 1);
  await chip('New Research Weekly').click(); assert.equal(await gmailPage.locator('.edition').count(), 2);
  await gmailContext.close();
  for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 844, height: 390 }, { width: 1440, height: 1000 }]) {
    await page.setViewportSize(viewport); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  }
  assert.deepEqual(errors, []);
  console.log('PASS: newsletter grouping/toggle filters/persistence, dropdown navigation, safe linked report rendering, existing reports, section cards, article URLs, touch dismissal and dynamic source discovery.');
} finally { await browser.close(); }
