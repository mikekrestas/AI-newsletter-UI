import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateSummary, buildReferences, buildBatches, fullTextParts, SUMMARY_VERSION } from '../summary.mjs';
import { bounded, BriefTimeout, parallelMap } from '../budget.mjs';
import { evaluationCache } from '../evaluation-cache.mjs';
import worker from '../worker.mjs';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const edition = (index, repeats = 50) => ({
  id: 'edition-' + String(index).padStart(2, '0'), source: 'Provider ' + index, subject: 'Release ' + index,
  date: Date.parse('2026-10-12T12:00:00Z') + index * 1000,
  text: `START_${index}: Researchers released a new evaluation model.\n` + 'The release includes an open evaluation dataset. '.repeat(repeats) + `\nEND_${index}: This is still a preliminary research release.`,
  articles: [{ title: 'Researchers release evaluation model ' + index, url: `https://example.com/model-${index}` }]
});
const candidate = { headline: 'Researchers release an evaluation model', detail: 'The release includes an open dataset, but the research remains preliminary.', reference: 'A1', importance: 5 };
const overview = 'Today’s newsletters focus on open evaluation models. The releases remain preliminary research.';
function model(delay = 0) {
  let active = 0, peak = 0; const evaluations = [], finalInputs = [];
  return { evaluations, finalInputs, get peak() { return peak; }, run: async (_, input) => {
    const system = input.messages[0].content, content = input.messages[1].content;
    active++; peak = Math.max(peak, active);
    try {
      if (delay) await pause(delay);
      const stories = [...content.matchAll(/^(A\d+): (.+) \(Provider \d+\)$/gm)].slice(0, 6)
        .map(([, reference, headline]) => ({ ...candidate, headline, reference }));
      if (system.includes('EVALUATE SECTION')) { evaluations.push(content); return { response: JSON.stringify({ candidates: stories }) }; }
      if (system.includes('opening paragraph')) return { response: overview };
      finalInputs.push(content);
      return { response: JSON.stringify({ highlights: stories, overview }) };
    } finally { active--; }
  } };
}
function memoryCache() {
  const entries = new Map();
  return { entries, get: async key => entries.get(key), put: async (key, value) => entries.set(key, structuredClone(value)) };
}

await test('5/10/15/20 full editions need one or a few calls, never more than four concurrent', async () => {
  for (const count of [5, 10, 15, 20]) {
    const sources = Array.from({ length: count }, (_, i) => edition(i)), ai = model(15), events = [];
    const report = await generateSummary(sources, ai, undefined, undefined, event => events.push(event));
    const batches = buildBatches(sources), direct = batches.length === 1;
    assert.equal(report.timings.aiCalls, direct ? 1 : batches.length + 1, 'Overview accompanies the final highlights');
    assert.ok(report.timings.aiCalls <= 4, 'These 20 complete small editions need at most four calls, not 22');
    assert.ok(ai.peak <= 4);
    for (let i = 0; i < count; i++) {
      const inputs = direct ? ai.finalInputs : ai.evaluations;
      assert.ok(inputs.some(input => input.includes(`START_${i}:`) && input.includes(`END_${i}:`)), 'Both ends of every edition reach the editor');
    }
    assert.equal(events.filter(event => event.stage === 'evaluating').at(-1).done, batches.length);
    assert.ok(report.highlights.every(item => item.detail.includes('preliminary')));
    assert.equal(report.overview, overview);
  }
});

await test('batched cache survives reordering and appended editions; full body/URL changes invalidate only affected batches', async () => {
  const original = [edition(1, 360), edition(2, 360)], cache = memoryCache(), ai = model();
  await generateSummary(original, ai, undefined, undefined, undefined, { cache });
  assert.equal(cache.entries.size, 2);
  const expanded = [edition(3, 360), ...original.reverse()], refs = buildReferences(expanded);
  const next = await generateSummary(expanded, ai, undefined, refs, undefined, { cache });
  assert.equal(next.timings.reusedSections, 2); assert.equal(ai.evaluations.length, 3);
  const providerOne = ai.finalInputs.at(-1).split('Provider: Provider 1\n')[1].split('\n')[0];
  const chosen = JSON.parse(providerOne)[0];
  assert.equal(refs.find(ref => ref.key === chosen.reference).url, edition(1).articles[0].url);
  assert.equal(chosen.reference, 'A3', 'Cached batch-local A1 remaps to current day A3');
  const edited = expanded.map(source => ({ ...source })); edited[1].text += '\nA correction.';
  let report = await generateSummary(edited, ai, undefined, undefined, undefined, { cache });
  assert.equal(report.timings.reusedSections, 2); assert.equal(ai.evaluations.length, 4);
  edited[1].articles = [{ ...edited[1].articles[0], url: 'https://example.com/corrected' }];
  report = await generateSummary(edited, ai, undefined, undefined, undefined, { cache });
  assert.equal(report.timings.reusedSections, 2); assert.equal(ai.evaluations.length, 5);
  for (const key of cache.entries.keys()) assert.match(key, new RegExp(SUMMARY_VERSION));
});

await test('UTF-8 batches retain every character and catalogue entry within conservative model input bounds', () => {
  for (const text of ['Evidence.\n'.repeat(9000), '研究と評価 🧪 العربية\n'.repeat(2300)]) {
    const source = { ...edition(0), text }, jobs = buildBatches([source]);
    assert.equal(jobs.flatMap(job => job.parts.map(part => part.text)).join(''), text);
    assert.equal(fullTextParts(text).join(''), text);
    for (const job of jobs) {
      assert.ok(Buffer.byteLength(job.content) <= 22000);
      assert.match(job.content, /A1: Researchers/);
      assert.ok(!job.parts.some(part => /[\uD800-\uDBFF]$/.test(part.text)));
    }
  }
  const large = Array.from({ length: 6 }, (_, index) => ({ ...edition(index), articles: Array.from({ length: 60 }, (_, item) => ({ title: 'Article ' + item, url: `https://example.com/${index}/${item}` })) }));
  assert.throws(() => buildReferences(large), /300 distinct article links/);
});

await test('quiet batches cache; malformed batch gets one local repair, never becomes a false quiet day', async () => {
  const sources = [edition(0)], cache = memoryCache(); let calls = 0;
  const options = { cache, direct: false };
  const quiet = { run: async () => { calls++; return { response: '{"candidates":[]}' }; } };
  assert.deepEqual((await generateSummary(sources, quiet, undefined, undefined, undefined, options)).highlights, []);
  await generateSummary(sources, quiet, undefined, undefined, undefined, options); assert.equal(calls, 1);
  for (const broken of [{ ...candidate, reference: 'A999' }, { ...candidate, detail: 'The experiment ran for hours of' }]) {
    const badCache = memoryCache(); let attempts = 0;
    await assert.rejects(generateSummary(sources, { run: async () => { attempts++; return { response: JSON.stringify({ candidates: [broken] }) }; } }, undefined, undefined, undefined, { cache: badCache, direct: false }), /usable report evaluation/);
    assert.equal(badCache.entries.size, 0); assert.equal(attempts, 2);
  }
  const repaired = model(), normal = repaired.run; let attempts = 0;
  repaired.run = async (name, input) => input.messages[0].content.includes('EVALUATE SECTION') && !attempts++ ? { response: 'unusable' } : normal(name, input);
  assert.equal((await generateSummary(sources, repaired, undefined, undefined, undefined, { direct: false })).highlights.length, 1);
});

await test('ten variable-latency runs recover explicit transient failures without repeating successful batches', async () => {
  for (let run = 0; run < 10; run++) {
    const ai = model(), normal = ai.run, attempts = new Map();
    ai.run = async (name, input) => {
      const content = input.messages[1].content, count = attempts.get(content) || 0;
      attempts.set(content, count + 1); await pause(3 + (run * 7 + content.length) % 17);
      if (run % 2 && content.includes('START_1:') && !count) throw new Error('503 service unavailable');
      return normal(name, input);
    };
    const result = await generateSummary([edition(1, 360), edition(2, 360)], ai, undefined, undefined, undefined, { retryDelayMs: 1 });
    assert.equal(result.highlights.length, 2); assert.equal(result.timings.retries, run % 2);
    assert.equal(ai.evaluations.length, 2, 'Successful sibling is not evaluated twice');
    assert.equal(result.timings.aiCalls, 3 + run % 2);
  }
});

await test('no retry for quota/auth errors; hung call is bounded without launching duplicate inference', async () => {
  for (const error of ['daily neurons quota exceeded', '429 too many requests', '401 unauthorized', '403 forbidden']) {
    let calls = 0;
    await assert.rejects(generateSummary([edition(0)], { run: async () => { calls++; throw new Error(error); } }));
    assert.equal(calls, 1);
    let started = 0;
    await assert.rejects(parallelMap([1, 2, 3], 1, undefined, async () => { started++; throw new Error(error); }, { settle: true }));
    assert.equal(started, 1, 'Fatal quota/auth rejection stops queued batch work');
  }
  let calls = 0;
  await assert.rejects(generateSummary([edition(0)], { run: async () => { calls++; return new Promise(() => {}); } }, undefined, undefined, undefined, { callMs: 30, totalMs: 100 }), BriefTimeout);
  await pause(35); assert.equal(calls, 1);
});

await test('one failed batch does not cancel slower siblings; completed work is reused on retry', async () => {
  const sources = [edition(1, 360), edition(2, 360), edition(3, 360)], cache = memoryCache(), ai = model(), normal = ai.run;
  ai.run = async (name, input) => {
    if (input.messages[1].content.includes('START_1:')) throw new Error('invalid service response');
    await pause(25); return normal(name, input);
  };
  await assert.rejects(generateSummary(sources, ai, undefined, undefined, undefined, { cache }), /invalid service response/);
  assert.equal(cache.entries.size, 2, 'Slower successful siblings completed after the first failure');
  const retry = await generateSummary(sources, model(), undefined, undefined, undefined, { cache });
  assert.equal(retry.timings.reusedSections, 2); assert.equal(retry.timings.aiCalls, 2);
});

await test('slow calls share the overall budget rather than a shorter independent evaluation cutoff', async () => {
  const result = await generateSummary([edition(1, 360), edition(2, 360)], model(45), undefined, undefined, undefined, { callMs: 80, totalMs: 200 });
  assert.equal(result.highlights.length, 2); assert.ok(result.timings.totalMs >= 90);
});

await test('write-through cache survives stale KV misses, isolates owners and bounds memory lifetime/size', async () => {
  let now = Date.now(); const originalNow = Date.now; Date.now = () => now;
  const writes = [], store = { get: async () => null, put: async (...args) => { writes.push(args); } }, hash = async value => value;
  try {
    const cache = evaluationCache(store, 'owner-hash', hash), other = evaluationCache(store, 'other-owner', hash);
    await cache.put('input', [candidate]);
    const same = evaluationCache(store, 'owner-hash', hash);
    assert.deepEqual(await same.get('input'), [candidate]); assert.equal(await other.get('input'), null);
    const copy = await same.get('input'); copy[0].headline = 'changed'; assert.equal((await same.get('input'))[0].headline, candidate.headline);
    now += 15 * 60000 + 1; assert.equal(await same.get('input'), null);
    for (let i = 0; i < 129; i++) await cache.put('key-' + i, []);
    assert.equal(await same.get('key-0'), null); assert.deepEqual(await same.get('key-128'), []);
    assert.equal(writes[0][2].expirationTtl, 30 * 86400);
  } finally { Date.now = originalNow; }
});

await test('cache outages/corrupt values are harmless; cancellation launches no queued AI', async () => {
  for (const cache of [
    { get: async () => { throw new Error('unavailable'); }, put: async () => { throw new Error('unavailable'); } },
    { get: async () => [{ ...candidate, reference: 'A999' }], put: async () => {} }
  ]) assert.ok((await generateSummary([edition(0)], model(), undefined, undefined, undefined, { cache, direct: false })).highlights.length);
  const controller = new AbortController();
  const work = generateSummary([edition(0)], { run: async () => new Promise(() => {}) }, controller.signal);
  controller.abort(); await assert.rejects(work, { name: 'AbortError' });
  let started = false;
  await assert.rejects(bounded(() => { started = true; }, 100, AbortSignal.abort()), { name: 'AbortError' }); assert.equal(started, false);
  let queued = 0;
  await assert.rejects(parallelMap([1, 2, 3], 1, undefined, async () => { queued++; throw new Error('stop'); }), /stop/); assert.equal(queued, 1);
});

await test('invalid inline overview is replaced; rejected stories cannot leak into an accepted opening', async () => {
  const ai = model(), normal = ai.run; let proseInput;
  ai.run = async (name, input) => {
    if (input.messages[0].content.includes('opening paragraph')) { proseInput = input.messages[1].content; return { response: overview }; }
    const output = await normal(name, input), parsed = JSON.parse(output.response);
    parsed.highlights.push({ ...candidate, headline: 'REJECTED_STORY', reference: 'A999' }); parsed.overview = 'REJECTED_STORY drives today’s news.';
    return { response: JSON.stringify(parsed) };
  };
  const report = await generateSummary([edition(0)], ai);
  assert.equal(report.highlights.length, 1); assert.equal(report.overview, overview); assert.doesNotMatch(proseInput, /REJECTED/);
});

await test('optional overview timeout preserves valid report; writer timeout only falls back after full evaluation', async () => {
  const ai = model(), normal = ai.run;
  ai.run = async (name, input) => {
    if (input.messages[0].content.includes('opening paragraph')) return new Promise(() => {});
    const output = await normal(name, input), parsed = JSON.parse(output.response); delete parsed.overview;
    return { response: JSON.stringify(parsed) };
  };
  const report = await generateSummary([edition(0)], ai, undefined, undefined, undefined, { totalMs: 40 });
  assert.equal(report.highlights.length, 1); assert.ok(report.overview);
  const slow = model(), evaluate = slow.run;
  slow.run = async (name, input) => input.messages[0].content.includes('EVALUATE SECTION') ? evaluate(name, input) : new Promise(() => {});
  const sources = [edition(1, 360), edition(2, 360)];
  const fallback = await generateSummary(sources, slow, undefined, undefined, undefined, { totalMs: 40 });
  assert.equal(fallback.generationMode, 'source-headlines');
  assert.deepEqual(fallback.highlights.map(item => item.headline), sources.map(source => source.articles[0].title));
  assert.ok(fallback.highlights.every(item => item.detail === ''));
});

await test('Worker privately caches notes without bodies and reuses full reports without any AI spending', async () => {
  const originalFetch = globalThis.fetch, data = new Map(), writes = [], ai = model();
  globalThis.fetch = async () => Response.json({ emailAddress: 'owner@example.com' });
  const env = { OWNER_EMAIL: 'owner@example.com', AI: ai, REPORTS: {
    get: async key => data.has(key) ? JSON.parse(data.get(key)) : null,
    put: async (key, value, options) => { data.set(key, value); writes.push({ key, value, options }); }
  } };
  const sources = [edition(1, 360), edition(2, 360)];
  const request = items => new Request('https://signal.example/api/brief', { method: 'POST', headers: { Origin: 'https://signal.example', Authorization: 'Bearer fake-gmail-token', 'Content-Type': 'application/json' }, body: JSON.stringify({ date: '2026-10-12', sources: items }) });
  try {
    assert.equal((await worker.fetch(request(sources), env)).status, 200);
    const expanded = [...sources, edition(3, 360)];
    const response = await worker.fetch(request(expanded), env); assert.equal(response.status, 200);
    assert.equal((await response.json()).report.timings.reusedSections, 2);
    const notes = writes.filter(write => write.key.startsWith('evaluation:')); assert.equal(notes.length, 3);
    for (const write of notes) {
      assert.equal(write.options.expirationTtl, 30 * 86400);
      assert.doesNotMatch(write.key + write.value, /START_|END_|fake-gmail-token|owner@example.com/);
    }
    const calls = ai.evaluations.length;
    assert.equal((await (await worker.fetch(request(expanded), env)).json()).report.cached, true);
    assert.equal(ai.evaluations.length, calls);
  } finally { globalThis.fetch = originalFetch; }
});
