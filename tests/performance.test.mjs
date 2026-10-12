import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateSummary, buildReferences, SUMMARY_VERSION } from '../summary.mjs';
import { bounded, BriefTimeout, parallelMap } from '../budget.mjs';
import worker from '../worker.mjs';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const edition = index => ({
  id: 'edition-' + index, source: 'Provider ' + index, subject: 'Release ' + index,
  date: Date.parse('2026-10-12T12:00:00Z'),
  text: `START_${index}: Researchers released a new evaluation model.\n` + 'The release includes an open evaluation dataset. '.repeat(50) + `\nEND_${index}: This is still a preliminary research release.`,
  articles: [{ title: 'Researchers release evaluation model ' + index, url: `https://example.com/model-${index}` }]
});
const candidate = { headline: 'Researchers release an evaluation model', detail: 'The release includes an open dataset, but the research remains preliminary.', reference: 'A1', importance: 5 };
function model(delay = 0) {
  let active = 0, peak = 0; const evaluations = [], finalInputs = [];
  return { evaluations, finalInputs, get peak() { return peak; }, run: async (_, input) => {
    const system = input.messages[0].content, content = input.messages[1].content;
    active++; peak = Math.max(peak, active);
    try {
      if (delay) await pause(delay);
      if (system.includes('EVALUATE SECTION')) {
        evaluations.push(content);
        const number = content.match(/START_(\d+)/)?.[1] || '0';
        return { response: JSON.stringify({ candidates: [{ ...candidate, headline: `Researchers release evaluation model ${number}` }] }) };
      }
      if (system.includes('opening paragraph')) return { response: 'Today’s newsletters focus on open evaluation models. The releases remain preliminary research.' };
      finalInputs.push(content);
      const keys = [...content.matchAll(/^(A\d+):/gm)].map(match => match[1]);
      return { response: JSON.stringify({ highlights: keys.slice(0, 6).map((reference, i) => ({ ...candidate, headline: 'Researchers release evaluation model ' + i, reference })) }) };
    } finally { active--; }
  } };
}
function memoryCache() {
  const entries = new Map();
  return { entries, get: async key => entries.get(key), put: async (key, value) => entries.set(key, structuredClone(value)) };
}

await test('5/10/15/20 complete newsletters run in bounded parallel waves without consolidation', async () => {
  for (const count of [5, 10, 15, 20]) {
    const sources = Array.from({ length: count }, (_, i) => edition(i)), ai = model(35), events = [];
    const report = await generateSummary(sources, ai, undefined, undefined, event => events.push(event));
    assert.equal(ai.evaluations.length, count);
    assert.equal(ai.peak, Math.min(count, 8));
    for (let i = 0; i < count; i++) {
      assert.ok(ai.evaluations.some(input => input.includes(`START_${i}:`) && input.includes(`END_${i}:`)), 'Both ends of every newsletter reach evaluation');
      assert.ok(ai.finalInputs[0].includes(`Provider: Provider ${i}\n`));
    }
    assert.equal(report.timings.aiCalls, count + 2, 'One evaluation per edition, one final write, one overview');
    assert.equal(report.timings.sections, count);
    assert.ok(report.timings.totalMs < 35 * count + 150);
    assert.deepEqual(events.filter(event => event.stage === 'evaluating').map(event => event.done), Array.from({ length: count + 1 }, (_, i) => i));
  }
});

await test('cached evaluations survive reordered/new editions with exact URL mapping; body/link edits invalidate them', async () => {
  const original = [edition(1), edition(2)], cache = memoryCache(), ai = model();
  await generateSummary(original, ai, undefined, undefined, undefined, { cache });
  assert.equal(cache.entries.size, 2);
  const expanded = [edition(0), ...original], refs = buildReferences(expanded);
  const next = await generateSummary(expanded, ai, undefined, refs, undefined, { cache });
  assert.equal(next.timings.reusedSections, 2); assert.equal(ai.evaluations.length, 3);
  const providerOne = ai.finalInputs.at(-1).split('Provider: Provider 1\n')[1].split('\n')[0];
  const chosen = JSON.parse(providerOne)[0];
  assert.equal(refs.find(ref => ref.key === chosen.reference).url, original[0].articles[0].url);
  assert.equal(chosen.reference, 'A2', 'Local cached A1 remaps to current day A2');
  const edited = expanded.map(source => ({ ...source })); edited[1].text += '\nA correction.';
  let report = await generateSummary(edited, ai, undefined, undefined, undefined, { cache });
  assert.equal(report.timings.reusedSections, 2); assert.equal(ai.evaluations.length, 4);
  edited[1].articles = [{ ...edited[1].articles[0], url: 'https://example.com/corrected' }];
  report = await generateSummary(edited, ai, undefined, undefined, undefined, { cache });
  assert.equal(report.timings.reusedSections, 2); assert.equal(ai.evaluations.length, 5);
  for (const key of cache.entries.keys()) assert.match(key, new RegExp(SUMMARY_VERSION));
});

await test('long sections retain every character, share the request bound, and reject excess URLs explicitly', async () => {
  const source = edition(0); source.text = 'START_0: ' + 'A complete paragraph with useful evidence.\n'.repeat(700) + 'END_0: Research caveats.';
  const ai = model(); const report = await generateSummary([source], ai);
  assert.equal(report.timings.sections, 3);
  const texts = ai.evaluations.map(input => input.split('Newsletter text:\n')[1]);
  assert.equal(texts.join(''), source.text);
  const large = Array.from({ length: 6 }, (_, index) => ({ ...edition(index), articles: Array.from({ length: 60 }, (_, item) => ({ title: 'Article ' + item, url: `https://example.com/${index}/${item}` })) }));
  assert.throws(() => buildReferences(large), /300 distinct article links/);
});

await test('quiet sections are cacheable; unknown references/fragments are never treated as a quiet day', async () => {
  const sources = [edition(0)], cache = memoryCache(); let calls = 0;
  const quiet = { run: async () => { calls++; return { response: '{"candidates":[]}' }; } };
  const first = await generateSummary(sources, quiet, undefined, undefined, undefined, { cache });
  assert.deepEqual(first.highlights, []); assert.equal(calls, 1);
  await generateSummary(sources, quiet, undefined, undefined, undefined, { cache }); assert.equal(calls, 1);
  for (const broken of [{ ...candidate, reference: 'A999' }, { ...candidate, detail: 'The experiment ran for hours of' }]) {
    const badCache = memoryCache();
    await assert.rejects(generateSummary(sources, { run: async () => ({ response: JSON.stringify({ candidates: [broken] }) }) }, undefined, undefined, undefined, { cache: badCache }), /usable report evaluation/);
    assert.equal(badCache.entries.size, 0);
  }
  const recovered = model(); const normal = recovered.run;
  recovered.run = async (name, input) => input.messages[0].content.includes('EVALUATE SECTION')
    ? { response: '{"candidates":[' + JSON.stringify(candidate) + ',{"headline":"unfinished' } : normal(name, input);
  assert.equal((await generateSummary(sources, recovered)).highlights.length, 1);
});

await test('a stalled evaluation stops promptly, launches no queued calls, and retains only completed evaluations', async () => {
  const sources = Array.from({ length: 20 }, (_, i) => edition(i)), cache = memoryCache(); let calls = 0;
  const ai = { run: async () => { calls++; if (calls === 1) return { response: JSON.stringify({ candidates: [candidate] }) }; return new Promise(() => {}); } };
  const start = Date.now();
  await assert.rejects(generateSummary(sources, ai, undefined, undefined, undefined, { cache, evaluationMs: 30, totalMs: 60 }), BriefTimeout);
  assert.ok(Date.now() - start < 300); assert.equal(calls, 9); assert.equal(cache.entries.size, 1);
  await pause(30); assert.equal(calls, 9, 'No AI work is scheduled after failure');
  const normal = model(); const retry = await generateSummary(sources, normal, undefined, undefined, undefined, { cache });
  assert.equal(retry.timings.reusedSections, 1); assert.equal(normal.evaluations.length, 19);
});

await test('cache outage does not block a full report and cancellation does not wait for a stalled binding', async () => {
  const cache = { get: async () => { throw new Error('unavailable'); }, put: async () => { throw new Error('unavailable'); } };
  assert.ok((await generateSummary([edition(0)], model(), undefined, undefined, undefined, { cache })).highlights.length);
  const controller = new AbortController();
  const work = generateSummary([edition(0)], { run: async () => new Promise(() => {}) }, controller.signal);
  controller.abort(); await assert.rejects(work, { name: 'AbortError' });
  const preAborted = AbortSignal.abort(); let started = false;
  await assert.rejects(bounded(() => { started = true; }, 100, preAborted), { name: 'AbortError' });
  assert.equal(started, false);
  let queued = 0;
  await assert.rejects(parallelMap([1, 2, 3], 1, undefined, async () => { queued++; throw new Error('stop'); }), /stop/);
  assert.equal(queued, 1);
});

await test('slow optional review/overview preserves a valid report within the overall budget', async () => {
  const ai = model(); const normal = ai.run;
  ai.run = async (name, input) => input.messages[0].content.includes('opening paragraph') ? new Promise(() => {}) : normal(name, input);
  const start = Date.now(), report = await generateSummary([edition(0)], ai, undefined, undefined, undefined, { totalMs: 35 });
  assert.ok(Date.now() - start < 300); assert.equal(report.highlights.length, 1); assert.ok(report.overview);
});

await test('only a stalled writer after complete evaluation may use the labelled original-headline digest', async () => {
  const ai = model(), normal = ai.run;
  ai.run = async (name, input) => input.messages[0].content.includes('EVALUATE SECTION') ? normal(name, input) : new Promise(() => {});
  const sources = [edition(0), edition(1)];
  const report = await generateSummary(sources, ai, undefined, undefined, undefined, { totalMs: 35 });
  assert.equal(ai.evaluations.length, 2);
  assert.equal(report.generationMode, 'source-headlines');
  assert.deepEqual(report.highlights.map(item => item.headline), sources.map(source => source.articles[0].title));
  assert.ok(report.highlights.every(item => item.detail === ''));
});

await test('authenticated Worker stores private evaluation notes without raw bodies and reuses them on changed-day generation', async () => {
  const originalFetch = globalThis.fetch, data = new Map(), writes = [], ai = model();
  globalThis.fetch = async () => Response.json({ emailAddress: 'owner@example.com' });
  const env = { OWNER_EMAIL: 'owner@example.com', AI: ai, REPORTS: {
    get: async key => data.has(key) ? JSON.parse(data.get(key)) : null,
    put: async (key, value, options) => { data.set(key, value); writes.push({ key, value, options }); }
  } };
  const request = sources => new Request('https://signal.example/api/brief', { method: 'POST', headers: { Origin: 'https://signal.example', Authorization: 'Bearer fake-gmail-token', 'Content-Type': 'application/json' }, body: JSON.stringify({ date: '2026-10-12', sources }) });
  try {
    assert.equal((await worker.fetch(request([edition(1)]), env)).status, 200);
    const second = await worker.fetch(request([edition(0), edition(1)]), env);
    const report = (await second.json()).report;
    assert.equal(report.timings.reusedSections, 1);
    const notes = writes.filter(write => write.key.startsWith('evaluation:'));
    assert.equal(notes.length, 2);
    for (const write of notes) {
      assert.equal(write.options.expirationTtl, 30 * 86400);
      assert.doesNotMatch(write.key + write.value, /START_|END_|fake-gmail-token|owner@example.com/);
    }
    const calls = ai.evaluations.length;
    const cached = (await (await worker.fetch(request([edition(0), edition(1)]), env)).json()).report;
    assert.equal(cached.cached, true); assert.equal(ai.evaluations.length, calls);
  } finally { globalThis.fetch = originalFetch; }
});
