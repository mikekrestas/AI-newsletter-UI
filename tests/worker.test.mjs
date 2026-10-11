import assert from 'node:assert/strict';
import { test } from 'node:test';
import worker from '../worker.mjs';
import { dayRange, localDay } from '../public/dates.js';
import { chunks, MODEL, generateSummary, buildReferences, validateHighlights, validateOverview, SUMMARY_VERSION } from '../summary.mjs';
import { newsletterName, newsletterTone } from '../public/sources.js';

const base = 'https://signal.example';
const date = '2026-10-07';
const source = { id: 'abc123', threadId: 'thread1', source: 'TLDR AI', subject: 'Today’s news', date: dayRange(date).start + 3600000, text: 'ARTICLE_ALPHA: A model release.\n' + 'Research findings and new developer tools. '.repeat(300) + '\nARTICLE_OMEGA: The last distinct story.', articles: [{ title: 'Model release', url: 'https://example.com/model' }] };
function fixture() {
  const data = new Map(), inputs = [], writes = [];
  const env = {
    OWNER_EMAIL: 'michaelkrestas1@gmail.com', GOOGLE_CLIENT_ID: 'test.apps.googleusercontent.com', NEWSLETTER_LABEL: 'AI Newsletters',
    ASSETS: { fetch: async () => new Response('static app') },
    REPORTS: { get: async key => data.has(key) ? JSON.parse(data.get(key)) : null, put: async (key, value, options) => { data.set(key, value); writes.push({ value, options }); } },
    AI: { run: async (model, input) => { assert.equal(model, MODEL); inputs.push(input); return { response: input.messages[0].content.includes('JSON object') ? JSON.stringify({ highlights: [{ headline: 'Model launches a developer API', detail: 'Developers can now test the new model through an API.', reference: 'A1' }] }) : 'Notes on models (A1), research and developer tools (E1).' }; } }
  };
  return { env, data, inputs, writes };
}
function request(method = 'POST', body = { date, sources: [source] }, extra = {}) {
  return new Request(base + '/api/brief' + (method === 'GET' ? '?date=' + date : ''), { method, headers: { Authorization: 'Bearer test-gmail-token', ...(method === 'POST' ? { 'Content-Type': 'application/json', Origin: base } : {}), ...extra.headers }, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}), ...(extra.signal ? { signal: extra.signal } : {}) });
}
const originalFetch = globalThis.fetch;
let profile = 'michaelkrestas1@gmail.com', profileStatus = 200;
globalThis.fetch = async (url, options) => {
  assert.equal(url, 'https://gmail.googleapis.com/gmail/v1/users/me/profile');
  assert.equal(options.headers.Authorization, 'Bearer test-gmail-token');
  return Response.json({ emailAddress: profile }, { status: profileStatus });
};
try {
  await test('owner verification, complete input processing, private cache and changed-day regeneration', async () => {
    const f = fixture();
    const response = await worker.fetch(request(), f.env);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
    assert.equal(response.headers.has('Access-Control-Allow-Origin'), false);
    const first = (await response.json()).report;
    assert.equal(first.cached, false); assert.equal(first.sources.length, 1);
    assert.equal(first.references.find(ref => ref.key === 'A1').url, 'https://example.com/model');
    assert.equal(first.editorialVersion, SUMMARY_VERSION); assert.equal(first.highlights[0].reference, 'A1');
    assert.match(first.summary, /\[Model launches a developer API\]\(A1\)/);
    const input = f.inputs.map(input => input.messages[1].content).join('\n');
    assert.match(input, /ARTICLE_ALPHA/); assert.match(input, /ARTICLE_OMEGA/);
    assert.match(input, /A1: Model release/); assert.doesNotMatch(input, /https:\/\/example.com\/model/);
    assert.ok(f.inputs.length > 2, 'Long body was not processed in full sections');
    assert.equal(f.writes[0].options.expirationTtl, 30 * 86400);
    assert.doesNotMatch(f.writes[0].value, /test-gmail-token|ARTICLE_ALPHA|ARTICLE_OMEGA/);
    assert.equal(Object.hasOwn(first.sources[0], 'text'), false);
    assert.equal(Object.hasOwn(first.sources[0], 'articles'), false);
    const calls = f.inputs.length;
    const cached = (await (await worker.fetch(request(), f.env)).json()).report;
    assert.equal(cached.cached, true); assert.equal(f.inputs.length, calls);
    const onPhone = (await (await worker.fetch(request('GET'), f.env)).json()).report;
    assert.equal(onPhone.summary, first.summary); assert.equal(f.inputs.length, calls);
    await worker.fetch(request('POST', { date, sources: [{ ...source, text: source.text + '\nNEW_ARRIVAL' }] }), f.env);
    assert.ok(f.inputs.length > calls); assert.equal(f.writes.length, 2);
  });
  await test('missing auth, wrong owner, expired token and other website origin cannot use AI/cache', async () => {
    const f = fixture();
    assert.equal((await worker.fetch(request('GET', null, { headers: { Authorization: '' } }), f.env)).status, 401);
    profile = 'attacker@example.com'; assert.equal((await worker.fetch(request(), f.env)).status, 403);
    profile = 'michaelkrestas1@gmail.com'; profileStatus = 401; assert.equal((await worker.fetch(request(), f.env)).status, 401);
    profileStatus = 200;
    assert.equal((await worker.fetch(request('POST', undefined, { headers: { Origin: 'https://other.example' } }), f.env)).status, 403);
    assert.equal(f.inputs.length, 0); assert.equal(f.writes.length, 0);
  });
  await test('invalid dates, duplicate or out-of-day sources, large requests and unsupported routes stop safely', async () => {
    const f = fixture();
    for (const body of [{ date: '2026-02-30', sources: [source] }, { date, sources: [source, source] }, { date, sources: [{ ...source, date: dayRange(date).end }] }]) assert.equal((await worker.fetch(request('POST', body), f.env)).status, 400);
    for (const url of ['javascript:alert(1)', 'data:text/html,attack', 'not a URL']) assert.equal((await worker.fetch(request('POST', { date, sources: [{ ...source, articles: [{ title: 'Unsafe', url }] }] }), f.env)).status, 400);
    const oversized = request('POST', { date, sources: [{ ...source, text: 'a'.repeat(520000) }] });
    assert.equal((await worker.fetch(oversized, f.env)).status, 413);
    assert.equal((await worker.fetch(request('POST', { date, sources: [{ ...source, text: 'a'.repeat(150000) }] }), f.env)).status, 422);
    assert.equal((await worker.fetch(new Request(base + '/api/unknown'), f.env)).status, 404);
    assert.equal((await worker.fetch(new Request(base + '/api/brief', { method: 'OPTIONS' }), f.env)).status, 405);
    assert.equal(f.inputs.length, 0); assert.equal(f.writes.length, 0);
  });
  await test('AI errors, free quota exhaustion and cancellation never save partial reports', async () => {
    const f = fixture();
    f.env.AI.run = async () => { throw new Error('daily neurons quota exceeded'); };
    assert.equal((await worker.fetch(request(), f.env)).status, 429);
    f.env.AI.run = async () => ({ response: '' });
    assert.equal((await worker.fetch(request(), f.env)).status, 422);
    const controller = new AbortController();
    f.env.AI.run = async () => { controller.abort(); return { response: 'Incomplete notes' }; };
    assert.equal((await worker.fetch(request('POST', undefined, { signal: controller.signal }), f.env)).status, 499);
    assert.equal(f.writes.length, 0);
  });
  await test('public configuration contains no owner identity or token; assets and empty cache work', async () => {
    const f = fixture();
    const config = await (await worker.fetch(new Request(base + '/api/config'), f.env)).json();
    assert.equal(config.clientId, f.env.GOOGLE_CLIENT_ID); assert.equal(config.hosted, true);
    assert.doesNotMatch(JSON.stringify(config), /michaelkrestas1|token/);
    assert.equal(await (await worker.fetch(new Request(base + '/'), f.env)).text(), 'static app');
    assert.equal((await (await worker.fetch(request('GET'), f.env)).json()).report, null);
  });
  await test('London day boundaries stay stable across travel and daylight saving; chunks retain tail', () => {
    assert.equal(localDay(new Date('2026-10-06T23:10:00Z')), date);
    assert.equal((dayRange('2026-03-29').end - dayRange('2026-03-29').start) / 3600000, 23);
    assert.equal((dayRange('2026-10-25').end - dayRange('2026-10-25').start) / 3600000, 25);
    const text = 'A '.repeat(8000) + 'END_MARKER'; assert.equal(chunks(text).join(''), text);
  });
  await test('saved reports from Signal 1.3 stay readable but regenerate with citations on demand', async () => {
    const f = fixture();
    await worker.fetch(request(), f.env);
    const key = [...f.data.keys()][0]; assert.match(key, /^signal-3:/);
    f.data.set(key, JSON.stringify({ date, summary: '* A legacy saved report.', sources: [{ id: source.id, subject: source.subject, source: source.source, date: source.date }], fingerprint: 'legacy', generatedAt: '2026-10-07T08:00:00Z' }));
    const calls = f.inputs.length;
    const old = (await (await worker.fetch(request('GET'), f.env)).json()).report;
    assert.match(old.summary, /legacy/); assert.equal(f.inputs.length, calls);
    const updated = (await (await worker.fetch(request(), f.env)).json()).report;
    assert.equal(updated.references[1].key, 'A1'); assert.ok(f.inputs.length > calls);
  });
  await test('many article references stay available without overflowing summary prompts', async () => {
    const f = fixture();
    const sources = Array.from({ length: 5 }, (_, i) => ({ ...source, id: 'edition-' + i, text: 'A release with several research stories.', articles: Array.from({ length: 60 }, (_, j) => ({ title: 'Research article ' + j + ': ' + 'detailed title '.repeat(16), url: `https://example.com/news/${i}/${j}` })) }));
    const response = await worker.fetch(request('POST', { date, sources }), f.env);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).report.references.filter(ref => ref.type === 'article').length, 300);
    for (const input of f.inputs) assert.ok(input.messages[1].content.length < 16000);
    const final = f.inputs.findLast(input => input.messages[0].content.includes('JSON object')).messages[1].content;
    assert.match(final, /A1:/); assert.match(final, /A300:/);
  });
  await test('long editions get a balanced provider budget and a one-provider draft gets reviewed', async () => {
    const sources = [
      { ...source, text: 'LONG_TLDR: ' + 'model news '.repeat(1500) },
      { ...source, id: 'alpha', source: 'AlphaSignal', text: 'ALPHA_UNIQUE: A reproducible research result.', articles: [{ title: 'Research', url: 'https://example.com/research' }] },
      { ...source, id: 'dair', source: 'DAIR.AI', text: 'DAIR_UNIQUE: A useful open evaluation dataset.', articles: [{ title: 'Dataset', url: 'https://example.com/dataset' }] }
    ];
    const inputs = []; let finalCount = 0;
    const ai = { run: async (model, input) => {
      inputs.push(input); const system = input.messages[0].content, content = input.messages[1].content;
      if (system.includes('JSON object')) {
        finalCount++;
        assert.match(content, /Provider: TLDR AI/); assert.match(content, /Provider: AlphaSignal/); assert.match(content, /Provider: DAIR.AI/);
        assert.match(content, /ALPHA_UNIQUE/); assert.match(content, /DAIR_UNIQUE/);
        return { response: JSON.stringify({ highlights: finalCount === 1 ? [{ headline: 'Model launches a developer API', detail: 'Developers can now test the new model through an API.', reference: 'A1' }] : [
          { headline: 'Model launches a developer API', detail: 'Developers can now test the new model through an API.', reference: 'A1' },
          { headline: 'Research improves inference efficiency', detail: 'The new research reports reproducible gains in inference efficiency.', reference: 'A2' },
          { headline: 'Open dataset improves AI evaluation', detail: 'Researchers can now use the new dataset to evaluate model behaviour.', reference: 'A3' }
        ] }) };
      }
      if (system.includes('ONE provider')) return { response: 'A model launches (A1). This is the consolidated TLDR candidate.' };
      if (content.includes('ALPHA_UNIQUE')) return { response: 'ALPHA_UNIQUE: Independently useful research evidence (A2, E2).' };
      if (content.includes('DAIR_UNIQUE')) return { response: 'DAIR_UNIQUE: A concrete new evaluation capability (A3, E3).' };
      return { response: 'Model news (A1). '.repeat(60) };
    } };
    const report = await generateSummary(sources, ai, undefined, buildReferences(sources));
    assert.equal(finalCount, 2); assert.match(report.summary, /\(A2\)/); assert.match(report.summary, /\(A3\)/);
    const final = inputs.filter(input => input.messages[0].content.includes('JSON object'))[0];
    assert.ok(final.messages[1].content.length < 6000);
    assert.match(final.messages[0].content, /credible research evidence/);
    assert.ok(inputs.some(input => /EDITORIAL REVIEW/.test(input.messages[0].content)));
    assert.ok(inputs.some(input => input.messages[0].content.includes('ONE provider')));
  });
  await test('editorial validation rejects fragments, duplicate story details and missing article links', () => {
    const references = buildReferences([source]);
    const story = { headline: 'OpenAI publishes maths manuscripts', detail: 'The manuscripts describe results from an unreleased internal model, rather than a publicly available product.', reference: 'A1' };
    assert.equal(validateHighlights(JSON.stringify({ highlights: [story] }), references).length, 1);
    for (const highlights of [
      [{ ...story, detail: 'The model was given 4,000 problems to attempt, with each result using about 3 hours of' }],
      [story, { ...story, headline: 'The model attempts 4,000 maths problems' }],
      [{ ...story, reference: 'E1' }], [{ ...story, reference: 'A999' }], [{ ...story, reference: 'https://invented.invalid/article' }],
      [{ ...story, detail: 'Evaluator answer: A2 supports this interesting result.' }]
    ]) assert.throws(() => validateHighlights(JSON.stringify({ highlights }), references));
    assert.equal(validateHighlights(JSON.stringify({ highlights: [{ ...story, detail: story.detail + ' (E1)' }] }), references)[0].detail, story.detail);
    assert.deepEqual(validateHighlights('{"highlights":[]}', references), []);
  });
  await test('fragmented AI draft gets one repair; invalid repair is never cached; quiet days do not get filler', async () => {
    const mathsSource = { ...source, text: 'OpenAI released 722 maths manuscripts from an unreleased internal model onto GitHub. The model attempted 4,000 problems; its test workload is supporting context for the same release.', articles: [{ title: 'OpenAI maths manuscripts', url: 'https://example.com/maths' }] };
    const f = fixture(); const regular = f.env.AI.run; let finalCalls = 0;
    f.env.AI.run = async (model, input) => {
      if (!input.messages[0].content.includes('JSON object')) return regular(model, input);
      finalCalls++;
      if (finalCalls === 1) return { response: JSON.stringify({ highlights: [{ headline: 'OpenAI publishes maths manuscripts', detail: 'The model was given 4,000 problems to attempt, with each result using about 3 hours of', reference: 'A1' }] }) };
      assert.match(input.messages[0].content, /complete sentence/); assert.match(input.messages[0].content, /supporting context, NOT a separate news item/);
      return { response: JSON.stringify({ highlights: [{ headline: 'OpenAI publishes maths manuscripts', detail: 'The release contains results from an unreleased internal model, alongside details of its test workload.', reference: 'A1' }] }) };
    };
    const result = await worker.fetch(request('POST', { date, sources: [mathsSource] }), f.env); assert.equal(result.status, 200);
    const report = (await result.json()).report; assert.equal(finalCalls, 2); assert.equal(report.highlights.length, 1); assert.equal(f.writes.length, 1);
    assert.doesNotMatch(report.highlights[0].detail, /\b[AE]\d+\b/);
    const invalid = fixture(); invalid.env.AI.run = async () => ({ response: '* An uncited free-form evaluator answer.' });
    assert.equal((await worker.fetch(request(), invalid.env)).status, 422); assert.equal(invalid.writes.length, 0);
    const quiet = fixture(); const extraction = quiet.env.AI.run;
    quiet.env.AI.run = async (model, input) => input.messages[0].content.includes('JSON object') ? { response: '{"highlights":[]}' } : extraction(model, input);
    const none = (await (await worker.fetch(request('POST', { date, sources: [{ ...source, text: 'Only routine tutorials today.', articles: [] }] }), quiet.env)).json()).report;
    assert.deepEqual(none.highlights, []); assert.equal(none.summary, ''); assert.equal(none.unlinkedEditionCount, 1);
  });
  await test('JSON wrappers, cosmetic punctuation and one bad highlight do not discard valid news', async () => {
    const f = fixture();
    const second = { ...source, id: 'second', text: 'A complete second newsletter.', articles: [{ title: 'A second model is released', url: 'https://example.com/second' }] };
    let reviews = 0;
    f.env.AI.run = async (model, input) => {
      const system = input.messages[0].content;
      if (system.includes('opening paragraph')) return { response: 'Today’s newsletters focus on new model access. Developers have another API to try.' };
      if (!system.includes('JSON object')) return { response: 'A model API becomes available (A1).' };
      if (system.includes('EDITORIAL REVIEW')) { reviews++; return { response: 'The second draft was incomplete: {"highlights":[' }; }
      return { response: 'Here is your report:\n```json\n' + JSON.stringify({ highlights: [
        { headline: '**Model launches a developer API**', detail: 'Developers can now test the new model through an API', reference: '(A1)' },
        { headline: 'A second model is released', detail: 'The second model is available for', reference: 'A2' },
        { headline: 'A fake source must never be followed', detail: 'This story links to a made-up article.', reference: 'https://invented.invalid/story' }
      ] }) + '\n```\nThanks.' };
    };
    const response = await worker.fetch(request('POST', { date, sources: [{ ...source, text: 'Short body.' }, second] }), f.env);
    assert.equal(response.status, 200);
    const report = (await response.json()).report;
    assert.equal(reviews, 1); assert.equal(report.highlights.length, 1);
    assert.equal(report.highlights[0].reference, 'A1'); assert.match(report.highlights[0].detail, /API\.$/);
    assert.doesNotMatch(report.highlights[0].headline, /\*/);
    assert.equal(report.overview, 'Today’s newsletters focus on new model access. Developers have another API to try.');
    assert.equal(report.generationMode, 'ai'); assert.equal(f.writes.length, 1);
    const cached = (await (await worker.fetch(request('GET'), f.env)).json()).report;
    assert.equal(cached.overview, report.overview);
  });
  await test('token-truncated JSON retains complete stories, excludes the unfinished object and limits whole stories', async () => {
    const sources = [{ ...source, text: 'Short edition.', articles: Array.from({ length: 8 }, (_, i) => ({ title: 'Model number ' + i + ' launches', url: `https://example.com/model-${i}` })) }];
    const items = sources[0].articles.map((article, i) => ({ headline: article.title, detail: 'Developers can now use this model through a newly available API, with clear documentation and reproducible examples for testing applications.', reference: 'A' + (i + 1) }));
    const complete = JSON.stringify(items).slice(1, -1);
    const report = await generateSummary(sources, { run: async (model, input) => ({ response: input.messages[0].content.includes('JSON object') ? '{"highlights":[' + complete + ',{"headline":"Unfinished story","detail":"Not completed' : 'Known models launch (A1).' }) });
    assert.ok(report.highlights.length > 0 && report.highlights.length < 8);
    assert.ok(report.highlights.map(item => item.headline + ' ' + item.detail).join(' ').split(/\s+/).length <= 180);
    assert.doesNotMatch(JSON.stringify(report.highlights), /Unfinished|Not completed/);
    for (const story of report.highlights) assert.match(story.detail, /applications\.$/);
  });
  await test('repeated final-format failure becomes an explicit original-headline digest with real links', async () => {
    const f = fixture(); const events = [];
    f.env.AI.run = async (model, input) => ({ response: input.messages[0].content.includes('JSON object')
      ? '* [Model release](A1) The model is available for' : 'A major model release (A1).' });
    const response = await worker.fetch(request('POST', { date, sources: [{ ...source, text: 'A short release edition.' }] }, { headers: { Accept: 'text/event-stream' } }), f.env);
    for (const part of (await response.text()).trim().split('\n\n')) events.push(JSON.parse(part.slice(6)));
    const report = events.at(-1).report;
    assert.equal(events.at(-1).type, 'complete'); assert.equal(report.generationMode, 'source-headlines');
    assert.deepEqual(report.highlights, [{ headline: source.articles[0].title, detail: '', reference: 'A1' }]);
    assert.equal(report.references.find(ref => ref.key === 'A1').url, source.articles[0].url);
    assert.doesNotMatch(JSON.stringify(report), /available for|invented.invalid/);
    assert.equal(f.writes.length, 1); assert.ok(report.overview);
  });
  await test('reference-only fallback preserves selection order and never follows invented IDs', async () => {
    const sources = [{ ...source, text: 'Short body.', articles: [source.articles[0], { title: 'Research improves inference efficiency', url: 'https://example.com/research' }] }];
    let calls = 0;
    const report = await generateSummary(sources, { run: async (model, input) => {
      calls++;
      return { response: input.messages[0].content.includes('"references"') ? '{"references":["A2","A999","A1"]}' : 'An uncited model answer.' };
    } });
    assert.deepEqual(report.highlights.map(item => item.reference), ['A2', 'A1']);
    assert.equal(report.generationMode, 'source-headlines'); assert.equal(calls, 4);
  });
  await test('headline digests are cached without automatic AI spending, and an explicit retry can replace them', async () => {
    const f = fixture(); const body = { date, sources: [{ ...source, text: 'A short release.' }] };
    let calls = 0;
    f.env.AI.run = async () => { calls++; return { response: 'Model release (A1) with incomplete wording for' }; };
    const first = (await (await worker.fetch(request('POST', body), f.env)).json()).report;
    assert.equal(first.generationMode, 'source-headlines'); const initialCalls = calls;
    await worker.fetch(request('GET'), f.env);
    const cached = (await (await worker.fetch(request('POST', body), f.env)).json()).report;
    assert.equal(cached.cached, true); assert.equal(calls, initialCalls);
    const normal = fixture().env.AI.run; f.env.AI.run = async (...args) => { calls++; return normal(...args); };
    const retried = (await (await worker.fetch(request('POST', { ...body, retryWriting: true }), f.env)).json()).report;
    assert.equal(retried.cached, false); assert.equal(retried.generationMode, 'ai'); assert.ok(calls > initialCalls);
    const afterRetry = calls;
    assert.equal((await (await worker.fetch(request('POST', { ...body, retryWriting: true }), f.env)).json()).report.cached, true);
    assert.equal(calls, afterRetry);
    assert.equal((await worker.fetch(request('POST', { ...body, retryWriting: 'true' }), f.env)).status, 400);
  });
  await test('overview uses only retained highlights; an invalid overview cannot break a usable report', async () => {
    const f = fixture(); let overviewInput;
    const normal = f.env.AI.run;
    f.env.AI.run = async (model, input) => {
      if (input.messages[0].content.includes('opening paragraph')) {
        overviewInput = input.messages[1].content;
        return { response: 'One sentence. Two sentences. Three sentences. A fourth sentence.' };
      }
      return normal(model, input);
    };
    const response = await worker.fetch(request(), f.env); assert.equal(response.status, 200);
    const report = (await response.json()).report;
    assert.deepEqual(JSON.parse(overviewInput), report.highlights.map(({ headline, detail }) => ({ headline, detail })));
    assert.match(report.overview, /Model launches a developer API/); assert.equal(f.writes.length, 1);
    assert.equal(validateOverview('Today’s coverage focuses on video generation. The linked highlights describe the new capabilities.'), 'Today’s coverage focuses on video generation. The linked highlights describe the new capabilities.');
    for (const text of ['One. Two. Three. Four.', 'This week focuses on video generation.', 'Unfinished sentence with', '<script>alert(1)</script>.', 'An evaluator cites A1.', 'Read https://invented.invalid.']) assert.throws(() => validateOverview(text));
  });
  await test('optional overview outages preserve good highlights; cancellation/quota still prevent saving', async () => {
    for (const failure of ['malformed', 'quota', 'cancel']) {
      const f = fixture(), controller = new AbortController(); const normal = f.env.AI.run;
      f.env.AI.run = async (model, input) => {
        if (!input.messages[0].content.includes('opening paragraph')) return normal(model, input);
        if (failure === 'quota') throw new Error('daily neurons quota exceeded');
        if (failure === 'cancel') { controller.abort(); return { response: 'An unfinished paragraph' }; }
        return { unexpected: 'Missing the response field' };
      };
      const response = await worker.fetch(request('POST', undefined, { signal: controller.signal }), f.env);
      assert.equal(response.status, failure === 'malformed' ? 200 : failure === 'quota' ? 429 : 499);
      assert.equal(f.writes.length, failure === 'malformed' ? 1 : 0);
      if (failure === 'malformed') assert.match((await response.json()).report.overview, /Model launches a developer API/);
    }
  });
  await test('a large complete day reserves writing/review/overview within the existing 36-call ceiling', async () => {
    const sources = Array.from({ length: 28 }, (_, i) => ({ ...source, id: 'section-' + i, text: 'EDITION_' + i + ': A complete release edition.' }));
    let calls = 0, editions = 0, drafts = 0;
    const report = await generateSummary(sources, { run: async (model, input) => {
      calls++; const system = input.messages[0].content;
      if (system.includes('opening paragraph')) return { response: 'Today’s newsletters focus on access to a new model. Developers can try its API.' };
      if (system.includes('JSON object')) {
        drafts++;
        return { response: JSON.stringify({ highlights: [{ headline: 'Model launches a developer API', detail: drafts === 1 ? 'Developers can now test the model through an API for' : 'Developers can now test the model through a new API.', reference: 'A1' }] }) };
      }
      if (system.includes('ONE provider')) return { response: 'A consolidated model release (A1).' };
      editions++; return { response: 'Model release (A1). '.repeat(34) };
    } });
    assert.equal(editions, 28); assert.equal(calls, 36); assert.equal(drafts, 2);
    assert.equal(report.highlights.length, 1); assert.match(report.overview, /Today’s newsletters/);
  });
  await test('LinkedIn newsletter sender variants keep their canonical provider and colour', () => {
    const name = newsletterName('"DAIR.AI via LinkedIn" <newsletters-noreply@linkedin.com>');
    assert.equal(name, 'DAIR.AI'); assert.equal(newsletterTone(name), 'rose');
    assert.equal(newsletterTone('TLDR Tech'), 'blue');
    assert.equal(newsletterTone('Research Weekly'), newsletterTone('Research Weekly'));
  });
  await test('streamed progress follows actual evaluation, reporting and saved completion', async () => {
    const f = fixture(); const events = [];
    const response = await worker.fetch(request('POST', undefined, { headers: { Accept: 'text/event-stream' } }), f.env);
    assert.match(response.headers.get('Content-Type'), /text\/event-stream/);
    const text = await response.text();
    for (const part of text.trim().split('\n\n')) events.push(JSON.parse(part.slice(6)));
    assert.equal(events[0].stage, 'evaluating');
    assert.ok(events.some(event => event.stage === 'evaluating' && event.done === event.total));
    assert.ok(events.some(event => event.stage === 'reporting'));
    assert.equal(events.at(-1).type, 'complete'); assert.equal(f.writes.length, 1);
    const calls = f.inputs.length;
    const cached = await worker.fetch(request('POST', undefined, { headers: { Accept: 'text/event-stream' } }), f.env);
    assert.match(await cached.text(), /"cached":true/); assert.equal(f.inputs.length, calls);
    const failed = fixture(); failed.env.AI.run = async () => { throw new Error('daily neurons quota exceeded'); };
    const failure = await worker.fetch(request('POST', undefined, { headers: { Accept: 'text/event-stream' } }), failed.env);
    assert.match(await failure.text(), /"type":"error"/); assert.equal(failed.writes.length, 0);
  });
  await test('cancelling a progress stream prevents partial report persistence', async () => {
    const f = fixture(); let release;
    f.env.AI.run = async () => { await new Promise(resolve => { release = resolve; }); return { response: 'Notes on model news (A1).' }; };
    const response = await worker.fetch(request('POST', undefined, { headers: { Accept: 'text/event-stream' } }), f.env);
    const reader = response.body.getReader(); await reader.read();
    await reader.cancel(); release();
    await new Promise(resolve => setTimeout(resolve, 10)); assert.equal(f.writes.length, 0);
  });
} finally { globalThis.fetch = originalFetch; }
