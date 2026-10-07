import { safeUrl } from './reader.js?v=6';

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
  for (const [index, text] of reportItems(report.summary).entries()) {
    const item = document.createElement('li'); item.className = 'brief-item';
    const number = document.createElement('span'); number.className = 'brief-number'; number.textContent = String(index + 1).padStart(2, '0'); number.setAttribute('aria-hidden', 'true');
    const paragraph = document.createElement('p'); let cursor = 0;
    const pattern = /\[([^\]\n]{1,300})\]\(([^)\s]{1,2048})\)/g;
    for (const match of text.matchAll(pattern)) {
      appendText(paragraph, text.slice(cursor, match.index));
      // Resolve only known references. Never follow a URL invented by the AI.
      const reference = references.get(match[2]) || [...references.values()].find(ref => ref.url === match[2]);
      const url = reference?.type === 'article' && safeUrl(reference.url);
      if (url) {
        const link = document.createElement('a'); link.className = 'brief-article-link';
        link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer';
        link.title = reference.source + ' — ' + reference.title; appendText(link, match[1]); paragraph.append(link);
      } else if (reference?.type === 'edition' && editions.has(reference.editionId)) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'inline-source';
        button.title = 'Read ' + reference.title; appendText(button, match[1]);
        button.addEventListener('click', () => openEdition(editions.get(reference.editionId))); paragraph.append(button);
      } else appendText(paragraph, match[1]);
      cursor = match.index + match[0].length;
    }
    appendText(paragraph, text.slice(cursor)); item.append(number, paragraph); list.append(item);
  }
  return list;
}
