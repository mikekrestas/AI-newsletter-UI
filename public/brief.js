import { readableContent, extractArticles } from './reader.js?v=8';
import { dayRange, localDay } from './dates.js?v=8';
export { localDay, dayRange } from './dates.js?v=8';

export function newsletterText(body) {
  const fragment = readableContent(body.content, body.html);
  let text = '';
  const block = new Set(['P', 'DIV', 'SECTION', 'H1', 'H2', 'H3', 'H4', 'LI', 'BR', 'HR', 'BLOCKQUOTE', 'PRE']);
  function visit(node) {
    if (node.nodeType === Node.TEXT_NODE) { text += node.textContent; return; }
    if (block.has(node.tagName)) text += '\n';
    for (const child of node.childNodes) visit(child);
    if (block.has(node.tagName)) text += '\n';
  }
  visit(fragment);
  return text.split('\n').map(line => line.replace(/\s+/g, ' ').trim())
    .filter(line => line && !/^(unsubscribe|manage (?:your )?(?:preferences|subscription)|view (?:this )?(?:email )?in (?:your )?browser|privacy policy|all rights reserved|share (?:this|on)|follow us on)/i.test(line))
    .join('\n');
}

// Keep every character; split on paragraph/word boundaries to avoid exceeding
// local model context windows. No silent truncation of later newsletter stories.
export function chunks(text, limit = 5500) {
  const result = [];
  while (text.length > limit) {
    let end = text.lastIndexOf('\n', limit);
    if (end < limit / 2) end = text.lastIndexOf(' ', limit);
    if (end < limit / 2) end = limit;
    result.push(text.slice(0, end)); text = text.slice(end);
  }
  if (text.trim()) result.push(text);
  return result;
}

export async function collectMetadata(api, label, range, signal, onProgress = () => {}, limit = 300) {
  const ids = new Set(), pages = new Set(); let pageToken;
  do {
    signal.throwIfAborted();
    const page = await api.list(label, pageToken, range.query);
    for (const id of page.ids) ids.add(id);
    if (ids.size > limit) throw new Error(`This period has more than ${limit} emails. Narrow your Gmail newsletter label and try again. No partial collection was used.`);
    pageToken = page.nextPage;
    if (pageToken && pages.has(pageToken)) throw new Error('Gmail repeated a results page. Refresh and try again. No partial collection was used.');
    if (pageToken) pages.add(pageToken);
    onProgress(`Finding all newsletters… ${ids.size} found`);
  } while (pageToken);
  const result = []; const all = [...ids];
  for (let i = 0; i < all.length; i += 3) {
    signal.throwIfAborted();
    const group = await Promise.all(all.slice(i, i + 3).map(async id => {
      const edition = await api.metadata(id);
      if (edition.date < range.start || edition.date >= range.end) return null;
      return edition;
    }));
    result.push(...group.filter(Boolean));
  }
  signal.throwIfAborted();
  return result.sort((a, b) => a.date - b.date);
}

export async function collectDayMetadata(api, label, date, signal, onProgress = () => {}) {
  return collectMetadata(api, label, dayRange(date), signal, onProgress);
}

export function recentRange(now = new Date()) {
  const today = localDay(now);
  const calendar = new Date(today + 'T12:00:00Z');
  calendar.setUTCDate(calendar.getUTCDate() - 6);
  const start = dayRange(calendar.toISOString().slice(0, 10)).start;
  const end = dayRange(today).end;
  return { start, end, query: `after:${Math.floor(start / 1000) - 1} before:${Math.floor(end / 1000)}` };
}

export async function collectDay(api, label, date, signal, onProgress = () => {}, onStage = () => {}) {
  onStage({ stage: 'collecting', done: 0, total: 1, message: 'Finding every newsletter for this date…' });
  const editions = await collectDayMetadata(api, label, date, signal, onProgress);
  const result = [];
  for (let i = 0; i < editions.length; i += 3) {
    signal.throwIfAborted();
    const group = await Promise.all(editions.slice(i, i + 3).map(async edition => {
      const body = await api.body(edition.id);
      if (body.readable === false) throw new Error(`“${edition.subject}” has no readable email body. No partial report was created.`);
      const text = newsletterText(body);
      if (!text.trim()) throw new Error(`“${edition.subject}” has no readable text. The report was stopped so it would not silently omit an edition.`);
      return { ...edition, text, articles: extractArticles(body) };
    }));
    result.push(...group.filter(Boolean));
    onProgress(`Reading full newsletters… ${Math.min(i + 3, editions.length)} of ${editions.length}`);
    onStage({ stage: 'collecting', done: Math.min(i + 3, editions.length), total: editions.length, message: `Collecting full emails… ${Math.min(i + 3, editions.length)} of ${editions.length}` });
  }
  signal.throwIfAborted();
  return result.sort((a, b) => a.date - b.date);
}
