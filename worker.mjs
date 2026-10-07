import { dayRange } from './public/dates.js';
import { generateSummary, buildReferences, MODEL, SUMMARY_VERSION } from './summary.mjs';

class ApiError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
function json(value, status = 200) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' } });
}
async function hash(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
async function owner(request, env) {
  if (!env.OWNER_EMAIL || !env.REPORTS || !env.AI) throw new ApiError('Hosted summaries are not configured. Complete the Cloudflare setup first.', 503);
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) throw new ApiError('Use Signal from its own website.', 403);
  const authorization = request.headers.get('Authorization');
  if (!/^Bearer [^\s]{10,4096}$/.test(authorization || '')) throw new ApiError('Connect Gmail to view or generate your private report.', 401);
  // Verify with Gmail itself, never trust an email address supplied by the client.
  const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', { headers: { Authorization: authorization }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new ApiError(response.status === 401 ? 'Your Gmail session expired. Reconnect Gmail and try again.' : 'Gmail could not verify your account. Try again.', response.status === 401 ? 401 : 502);
  const profile = await response.json();
  if (profile.emailAddress?.toLowerCase() !== env.OWNER_EMAIL.trim().toLowerCase()) throw new ApiError('This personal app is restricted to its owner’s Gmail account.', 403);
  return hash(env.OWNER_EMAIL.toLowerCase() + '\n' + (env.NEWSLETTER_LABEL || 'AI Newsletters'));
}
async function readJson(request) {
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) throw new ApiError('Send a JSON report request.', 415);
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError('The report request is empty.');
  const buffers = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 512000) { await reader.cancel(); throw new ApiError('This day is too large for one free report. No partial report was created.', 413); }
      buffers.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const buffer of buffers) { bytes.set(buffer, offset); offset += buffer.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new ApiError('The report request is not valid JSON.'); }
}
function validateSources(body) {
  const range = dayRange(body?.date);
  if (!Array.isArray(body.sources) || !body.sources.length || body.sources.length > 300) throw new ApiError('Provide 1–300 newsletters for this date.');
  const ids = new Set();
  return body.sources.map(source => {
    if (!source || typeof source.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(source.id) || ids.has(source.id) ||
        typeof source.text !== 'string' || !source.text.trim() || source.text.length > 200000 ||
        typeof source.subject !== 'string' || source.subject.length > 1000 || typeof source.source !== 'string' || source.source.length > 300 ||
        !Number.isFinite(source.date) || source.date < range.start || source.date >= range.end ||
        (source.threadId !== undefined && (typeof source.threadId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(source.threadId)))) throw new ApiError('A newsletter is invalid, duplicated or outside the selected date. No partial report was created.');
    ids.add(source.id);
    const articles = source.articles ?? [];
    if (!Array.isArray(articles) || articles.length > 60) throw new ApiError('Invalid article references.');
    for (const article of articles) {
      if (!article || typeof article.title !== 'string' || !article.title.trim() || article.title.length > 300 || typeof article.url !== 'string' || article.url.length > 2048) throw new ApiError('Invalid article reference.');
      let url; try { url = new URL(article.url); } catch { throw new ApiError('Invalid article URL.'); }
      if (!['https:', 'http:'].includes(url.protocol)) throw new ApiError('Article links must use HTTP or HTTPS.');
    }
    return { id: source.id, threadId: source.threadId, subject: source.subject, source: source.source, date: source.date, text: source.text, articles: articles.map(({ title, url }) => ({ title, url })) };
  }).sort((a, b) => a.id.localeCompare(b.id));
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      if (url.pathname === '/api/config' && request.method === 'GET') return json({
        hosted: true, clientId: env.GOOGLE_CLIENT_ID || '', label: env.NEWSLETTER_LABEL || 'AI Newsletters', version: '1.5'
      });
      if (url.pathname !== '/api/brief') return json({ error: 'Unknown endpoint.' }, 404);
      if (!['GET', 'POST'].includes(request.method)) return json({ error: 'Use GET or POST.' }, 405);
      const identity = await owner(request, env);
      const body = request.method === 'POST' ? await readJson(request) : null;
      const date = body?.date || url.searchParams.get('date'); dayRange(date);
      // Keep existing saved reports readable while their next regeneration uses
      // the new fingerprint and citation format.
      const key = `signal-3:${identity}:${date}`;
      const stored = await env.REPORTS.get(key, 'json');
      if (request.method === 'GET') return json({ report: stored ? { ...stored, cached: true } : null });
      const sources = validateSources(body);
      const fingerprint = await hash(JSON.stringify({ model: MODEL, version: SUMMARY_VERSION, sources }));
      if (stored?.fingerprint === fingerprint) return json({ report: { ...stored, cached: true } });
      const references = buildReferences(sources);
      const summary = await generateSummary(sources, env.AI, request.signal, references);
      request.signal.throwIfAborted();
      const report = { date, summary, references, fingerprint, generatedAt: new Date().toISOString(), sources: sources.map(({ text, articles, ...metadata }) => metadata) };
      // Persist only completed reports, not Gmail tokens or raw newsletter text.
      await env.REPORTS.put(key, JSON.stringify(report), { expirationTtl: 30 * 86400 });
      return json({ report: { ...report, cached: false } });
    } catch (error) {
      if (error instanceof ApiError) return json({ error: error.message }, error.status);
      if (error.name === 'AbortError') return json({ error: 'Report cancelled. No partial report was saved.' }, 499);
      if (/quota|neuron|limit|429|10000|daily allocation/i.test(error.message)) return json({ error: 'The free AI quota or processing limit was reached. Try again later; no paid fallback is used.' }, 429);
      if (error.message?.startsWith('Choose a valid')) return json({ error: error.message }, 400);
      if (/No partial report|could not condense|usable report/i.test(error.message)) return json({ error: error.message }, 422);
      return json({ error: 'The hosted service could not finish this request. Try again. No partial report was saved.' }, 503);
    }
  }
};
