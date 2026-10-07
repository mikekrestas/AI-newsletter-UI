import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true, args: ['--no-sandbox'] });
const base = process.env.READER_URL || 'http://localhost:3000';
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, hasTouch: true });
const page = await context.newPage(), errors = [];
page.on('pageerror', error => errors.push(error.message));
await context.route('https://example.com/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>Original article</h1>' }));
try {
  await page.goto(base); await page.getByRole('button', { name: 'Try a demo' }).click();
  assert.equal(await page.locator('.sidebar-note').count(), 0);
  await page.locator('[data-view="brief"]').click();
  await page.locator('#generate-brief').click(); await page.locator('#brief-result').waitFor();
  assert.equal(await page.locator('.structured-highlight').count(), 3);
  assert.equal(await page.locator('.structured-highlight a[href]').count(), 3);
  assert.doesNotMatch(await page.locator('#brief-text').innerText(), /\b[AE]\d+\b|evaluator/i);
  const report = {
    editorialVersion: 'signal-7',
    highlights: [
      { headline: 'OpenAI shares 722 maths manuscripts', detail: 'The manuscripts report work by an unreleased internal model. Its 4,000 test problems are context for the same research story.', reference: 'A1' },
      { headline: 'An open dataset expands model evaluation', detail: 'The new dataset gives researchers a reproducible way to test model behaviour.', reference: 'A2' }
    ],
    references: [
      { key: 'A1', type: 'article', title: 'OpenAI maths manuscripts', url: 'https://example.com/maths', source: 'TLDR AI', editionId: 'tldr' },
      { key: 'A2', type: 'article', title: 'Open dataset evaluation', url: 'https://example.com/dataset', source: 'DAIR.AI', editionId: 'dair' },
      { key: 'E2', type: 'edition', editionId: 'tldr', title: 'Newsletter', source: 'TLDR AI' }
    ], sources: [{ id: 'tldr', subject: 'Newsletter', source: 'TLDR AI' }]
  };
  await page.evaluate(async report => {
    const { renderReport } = await import('/report.js?v=7');
    document.querySelector('#brief-text').replaceChildren(renderReport(report, () => { window.openedEdition = true; }));
  }, report);
  assert.equal(await page.locator('.brief-headline').count(), 2);
  assert.equal(await page.locator('.brief-origin').first().innerText(), 'TLDR AI · example.com ↗');
  assert.match(await page.locator('.brief-item').first().innerText(), /unreleased internal model.*4,000/s);
  // Tap the card margin, not the headline: it must open the exact article URL.
  await page.locator('.brief-item').first().scrollIntoViewIfNeeded();
  const card = await page.locator('.brief-item').first().boundingBox();
  const opened = page.waitForEvent('popup'); await page.mouse.click(card.x + card.width - 10, card.y + card.height - 10);
  const article = await opened; await article.waitForLoadState(); assert.equal(article.url(), 'https://example.com/maths'); await article.close();
  await page.locator('.brief-story-link').first().focus();
  const keyboard = page.waitForEvent('popup'); await page.keyboard.press('Enter'); const keyboardArticle = await keyboard;
  await keyboardArticle.waitForLoadState(); assert.equal(keyboardArticle.url(), 'https://example.com/maths'); await keyboardArticle.close();
  await page.screenshot({ path: '/tmp/signal-v17-desktop-brief.png', fullPage: true });
  for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 844, height: 390 }, { width: 1440, height: 1000 }]) {
    await page.setViewportSize(viewport);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.equal(await page.locator('.brief-headline').first().isVisible(), true);
    if (viewport.width === 390) {
      await page.locator('.brief-item').nth(1).scrollIntoViewIfNeeded();
      const navigation = await page.locator('.mobile-navigation').boundingBox();
      assert.ok(navigation.y >= 72 && navigation.y + navigation.height < viewport.height, 'Phone view selector must stay visible while reading a brief');
      const tapBox = await page.locator('.brief-item').nth(1).boundingBox();
      const phoneOpen = page.waitForEvent('popup'); await page.touchscreen.tap(tapBox.x + tapBox.width - 10, tapBox.y + tapBox.height - 10);
      const phoneArticle = await phoneOpen; await phoneArticle.waitForLoadState(); assert.equal(phoneArticle.url(), 'https://example.com/dataset'); await phoneArticle.close();
      await page.evaluate(() => { document.activeElement?.blur(); document.querySelector('#brief-result').scrollIntoView({ block: 'start', behavior: 'instant' }); });
      await page.screenshot({ path: '/tmp/signal-v17-phone-brief.png' });
    }
  }
  const legacy = await page.evaluate(async report => {
    const { renderReport } = await import('/report.js?v=7');
    const old = renderReport({ ...report, highlights: undefined, summary: '* OpenAI released 722 maths manuscripts from an unreleased internal model onto GitHub (E2).\n* The model was given 4,000 problems to attempt, with each result using about 3 hours of\n* [Open dataset](A2) improves evaluation (A2, E2).' }, () => {});
    const unsafe = renderReport({ highlights: [{ headline: '<img onerror=alert(1)>', detail: 'A2', reference: 'A9' }], references: [{ key: 'A9', type: 'article', url: 'javascript:alert(1)' }] }, () => {});
    const empty = renderReport({ highlights: [], unlinkedEditionCount: 0 }, () => {});
    const { extractArticles } = await import('/reader.js?v=7');
    return { text: old.textContent, items: old.querySelectorAll('.brief-item').length, links: [...old.querySelectorAll('a')].map(a => a.href), numbers: [...old.querySelectorAll('.brief-number')].map(n => n.textContent), unsafeLinks: unsafe.querySelectorAll('a').length, unsafeHTML: unsafe.querySelectorAll('img').length, empty: empty.textContent,
      prose: extractArticles({ html: true, content: '<p><a href="https://example.com/privacy">New AI privacy rules take effect</a> with material policy changes.</p><p><a href="https://example.com/unsubscribe">Unsubscribe</a></p>' }),
      plain: extractArticles({ html: false, content: 'OpenAI publishes maths manuscripts\nhttps://example.com/maths\n\nUnsubscribe https://example.com/unsubscribe' }) };
  }, report);
  assert.equal(legacy.items, 2); assert.doesNotMatch(legacy.text, /\b[AE]\d+\b|3 hours of/);
  assert.deepEqual(legacy.links, ['https://example.com/maths', 'https://example.com/dataset']); assert.deepEqual(legacy.numbers, ['01', '02']);
  assert.equal(legacy.unsafeLinks, 0); assert.equal(legacy.unsafeHTML, 0); assert.match(legacy.empty, /No major AI developments/);
  assert.deepEqual(legacy.prose.map(a => a.url), ['https://example.com/privacy']); assert.deepEqual(legacy.plain.map(a => a.url), ['https://example.com/maths']);
  assert.deepEqual(errors, []);
  console.log('PASS: complete linked stories, whole-card desktop/touch/keyboard article navigation, citation-free legacy maths example, quiet-day state, safe URLs, prose/plain-text extraction, sidebar removal and responsive layouts.');
} finally { await browser.close(); }
