import { safeUrl } from './reader.js?v=7';
export const EDITORIAL_VERSION = 'signal-7';

function visibleText(text) {
  return String(text || '').replace(/\((?:[AE]\d+[\s,;]*)+\)|\[(?:[AE]\d+[\s,;]*)+\]/g, '').replace(/\b[AE]\d+\b/g, '').replace(/\s+([.,!?])/g, '$1').replace(/\s+/g, ' ').trim();
}
function matchingArticle(text, references, editionId) {
  const words = value => new Set(String(value || '').toLowerCase().match(/[\p{L}\p{N}]{3,}/gu)?.filter(word => !['the', 'and', 'for', 'with', 'from', 'this', 'that', 'new', 'model', 'released', 'release', 'using', 'news'].includes(word)) || []);
  const tokens = words(text); let best, score = 0;
  for (const ref of references.values()) {
    if (ref.type !== 'article' || !safeUrl(ref.url) || (editionId && ref.editionId !== editionId)) continue;
    const title = words(ref.title); const overlap = [...title].filter(word => tokens.has(word)).length;
    const next = overlap / Math.max(1, title.size);
    if (overlap >= 2 && next >= .5 && next > score) { best = ref; score = next; }
  }
  return best;
}

function reportItems(summary) {
  const lines = String(summary || '').replace(/\r\n?/g, '\n').split('\n');
  const items = []; let item = '';
  const hasBullets = lines.some(line => /^\s*(?:[-*•]|\d+[.)])\s+/.test(line));
  for (const line of lines) {
    const bullet = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.+)$/);
    if (bullet || (!hasBullets && !line.trim())) { if (item.trim()) items.push(item.trim()); item = bullet?.[1] || ''; }
    else if (line.trim()) item += (item ? ' ' : '') + line.trim();
  }
  if (item.trim()) items.push(item.trim());
  return items;
}
function appendText(parent, text) {
  // A deliberately small Markdown subset; model HTML is always literal text.
  const pattern = /\*\*([^*]+)\*\*/g; let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    parent.append(document.createTextNode(text.slice(cursor, match.index)));
    const strong = document.createElement('strong'); strong.textContent = match[1]; parent.append(strong);
    cursor = match.index + match[0].length;
  }
  parent.append(document.createTextNode(text.slice(cursor)));
}
export function renderReport(report, openEdition) {
  const list = document.createElement('ol'); list.className = 'brief-highlights';
  const references = new Map((Array.isArray(report.references) ? report.references : []).map(reference => [reference.key, reference]));
  const editions = new Map((report.sources || []).map(source => [source.id, source]));
  if (Array.isArray(report.highlights)) {
    for (const highlight of report.highlights) {
      if (!highlight || typeof highlight !== 'object') continue;
      const reference = references.get(highlight.reference), url = reference?.type === 'article' && safeUrl(reference.url);
      if (!url) continue; // An unknown/model-invented URL can never become a link.
      const item = document.createElement('li'); item.className = 'brief-item structured-highlight';
      const link = document.createElement('a'); link.className = 'brief-article-link brief-story-link';
      link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer';
      const number = document.createElement('span'); number.className = 'brief-number'; number.textContent = String(list.children.length + 1).padStart(2, '0'); number.setAttribute('aria-hidden', 'true');
      const content = document.createElement('div');
      const title = document.createElement('h3'); title.className = 'brief-headline'; title.textContent = visibleText(highlight.headline);
      const detail = document.createElement('p'); detail.textContent = visibleText(highlight.detail);
      const source = document.createElement('span'); source.className = 'brief-origin'; source.textContent = reference.source + ' · ' + new URL(url).hostname.replace(/^www\./, '') + ' ↗';
      content.append(title, detail, source); link.append(number, content); item.append(link); list.append(item);
    }
    if (!list.children.length) {
      const empty = document.createElement('li'); empty.className = 'brief-quiet-day';
      empty.textContent = report.unlinkedEditionCount ? 'No linked highlights to show. Some editions did not provide an article URL; you can read them below.' : 'No major AI developments met the brief’s selection criteria for this day. You can still read every edition below.';
      list.append(empty);
    }
    return list;
  }
  for (const text of reportItems(report.summary)) {
    // Old reports can contain clipped continuation sentences. Do not present
    // a visibly unfinished sentence as a separate headline.
    if (/\b(?:of|and|for|with|to|from|the|a|an|by|on|in|because|about|using)[.!?]?\s*$/i.test(visibleText(text))) continue;
    const item = document.createElement('li'); item.className = 'brief-item';
    const number = document.createElement('span'); number.className = 'brief-number'; number.textContent = String(list.children.length + 1).padStart(2, '0'); number.setAttribute('aria-hidden', 'true');
    const paragraph = document.createElement('p'); let cursor = 0;
    const pattern = /\[([^\]\n]{1,300})\]\(([^)\s]{1,2048})\)/g;
    for (const match of text.matchAll(pattern)) {
      appendText(paragraph, visibleText(text.slice(cursor, match.index)) + (match.index > cursor ? ' ' : ''));
      // Resolve only known references. Never follow a URL invented by the AI.
      let reference = references.get(match[2]) || [...references.values()].find(ref => ref.url === match[2]);
      if (reference?.type === 'edition') reference = matchingArticle(text, references, reference.editionId) || reference;
      const url = reference?.type === 'article' && safeUrl(reference.url);
      if (url) {
        const link = document.createElement('a'); link.className = 'brief-article-link';
        link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer';
        link.title = reference.source + ' — ' + reference.title; appendText(link, visibleText(match[1])); paragraph.append(link);
      } else if (reference?.type === 'edition' && editions.has(reference.editionId)) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'inline-source';
        button.title = 'Read ' + reference.title; appendText(button, visibleText(match[1]));
        button.addEventListener('click', () => openEdition(editions.get(reference.editionId))); paragraph.append(button);
      } else appendText(paragraph, visibleText(match[1]));
      cursor = match.index + match[0].length;
    }
    // Preserve spacing around inline links while removing raw evaluator codes.
    appendText(paragraph, text.slice(cursor).replace(/\((?:[AE]\d+[\s,;]*)+\)|\[(?:[AE]\d+[\s,;]*)+\]/g, '').replace(/\b[AE]\d+\b/g, '').replace(/\s+([.,!?])/g, '$1'));
    if (!paragraph.querySelector('a, button')) {
      const cited = [...text.matchAll(/\b([AE]\d+)\b/g)].map(match => references.get(match[1])).find(Boolean);
      const reference = cited?.type === 'article' ? cited : matchingArticle(text, references, cited?.editionId);
      const url = reference?.type === 'article' && safeUrl(reference.url);
      if (url) {
        const link = document.createElement('a'); link.className = 'brief-article-link'; link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer';
        link.append(...paragraph.childNodes); paragraph.append(link);
      }
    }
    paragraph.querySelector('a.brief-article-link, button.inline-source')?.classList.add('primary-source');
    item.append(number, paragraph); list.append(item);
  }
  return list;
}
