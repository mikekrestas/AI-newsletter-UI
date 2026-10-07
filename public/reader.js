// Parse email HTML inertly, then rebuild safe content; sender styles and scripts
// never enter the live document. Layout tables are flattened into reading order.
const inline = new Set(['STRONG', 'B', 'EM', 'I', 'CODE', 'A']);
const structured = new Set(['UL', 'OL', 'LI', 'PRE', 'BLOCKQUOTE', 'BR']);
const blocked = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'OBJECT', 'EMBED', 'IMG', 'SVG', 'MATH', 'FORM', 'INPUT', 'BUTTON', 'SELECT', 'TEXTAREA', 'LINK', 'META', 'HEAD', 'VIDEO', 'AUDIO', 'SOURCE', 'TEMPLATE']);
const sectionNames = /^(?:headlines(?:\s*(?:&|and)\s*launches)?|big tech(?:\s*(?:&|and)\s*startups)?|engineering(?:\s*(?:&|and)\s*research)?|science(?:\s*(?:&|and)\s*futuristic technology)?|programming(?:\s*(?:&|and)\s*(?:design|data science))*|research(?:\s*(?:&|and)\s*(?:papers|insights))?|tools(?:\s*(?:&|and)\s*(?:resources|launches))?|quick links|miscellaneous|news(?:\s*(?:&|and)\s*(?:updates|insights))?|industry news|community|events|jobs|resources|papers(?:\s*(?:&|and)\s*research)?|learning(?:\s*(?:&|and)\s*resources)?|deep dives?)$/i;
export function safeUrl(value) {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : null; } catch { return null; }
}
function isSection(text) { return sectionNames.test(text.replace(/^[^\p{L}\p{N}]+/u, '').trim()); }
function articleUrl(value) {
  const safe = safeUrl(value); if (!safe) return null;
  const url = new URL(safe);
  // Remove the personal tracking envelope while preserving the publisher's
  // redirect destination. All other newsletter URLs stay exactly as provided.
  if (url.hostname === 'tracking.tldrnewsletter.com') {
    const encoded = url.pathname.match(/^\/CL\d\/([^/]+)/)?.[1];
    if (encoded) { try { return safeUrl(decodeURIComponent(encoded)) || safe; } catch {} }
  }
  return safe;
}
export function readableContent(body, html = true) {
  const output = document.createDocumentFragment();
  if (!html) {
    for (const paragraph of body.split(/\n\s*\n/)) {
      const p = document.createElement('p'); p.className = 'plain-paragraph';
      for (const part of paragraph.split(/(https?:\/\/[^\s<>]+)/g)) {
        const url = safeUrl(part);
        if (url && /^https?:\/\//.test(part)) { const a = document.createElement('a'); a.href = url; a.textContent = part; a.target = '_blank'; a.rel = 'noopener noreferrer'; p.append(a); }
        else p.append(document.createTextNode(part));
      }
      output.append(p);
    }
    return output;
  }
  const template = document.createElement('template'); template.innerHTML = body;
  const blocks = document.createDocumentFragment(); const headingInfo = new WeakMap(); let paragraph = document.createElement('p');
  function excluded(node) {
    return blocked.has(node.tagName) || node.hasAttribute('hidden') || /display\s*:\s*none|visibility\s*:\s*hidden/i.test(node.getAttribute('style') || '');
  }
  function title(node) {
    if (/^H[1-6]$/.test(node.tagName)) return true;
    const text = node.textContent.trim(), style = node.getAttribute('style') || '';
    if (text.length < 8 || text.length > 300) return false;
    if (/font-weight\s*:\s*(?:bold|[6-9]00)/i.test(style) && /font-size\s*:\s*(?:1[89]|[2-9]\d)px/i.test(style)) return true;
    if (['A', 'STRONG', 'B'].includes(node.tagName) && /\((?:\d+\s*(?:min(?:ute)?s?)\s*read|github repo|sponsor|paper|video|website)\)\s*$/i.test(text)) return true;
    if (node.tagName === 'A' && node.querySelector('strong,b')) {
      const container = node.closest('p,div,td');
      return Boolean(container && container.textContent.trim().startsWith(text));
    }
    return false;
  }
  function copyInline(node, parent, depth = 0) {
    if (depth > 100) return;
    if (node.nodeType === Node.TEXT_NODE) { parent.append(document.createTextNode(node.textContent)); return; }
    if (node.nodeType !== Node.ELEMENT_NODE || excluded(node)) return;
    const safe = document.createElement(inline.has(node.tagName) || structured.has(node.tagName) ? node.tagName.toLowerCase() : 'span');
    if (node.tagName === 'A') {
      const url = safeUrl(node.getAttribute('href'));
      if (url) { safe.href = url; safe.target = '_blank'; safe.rel = 'noopener noreferrer'; }
    }
    for (const child of node.childNodes) copyInline(child, safe, depth + 1);
    parent.append(safe);
  }
  function flush() {
    const text = paragraph.textContent.trim();
    // Standalone decorative emojis are not paragraphs from an article.
    if (text && !/^(?:\p{Extended_Pictographic}|\uFE0F|\u200D|\s)+$/u.test(text)) blocks.append(paragraph);
    paragraph = document.createElement('p');
  }
  function walk(node, depth = 0) {
    if (depth > 100) return;
    if (node.nodeType === Node.TEXT_NODE) { paragraph.append(document.createTextNode(node.textContent)); return; }
    if (node.nodeType !== Node.ELEMENT_NODE || excluded(node)) return;
    if (title(node)) {
      flush(); const text = node.textContent.trim();
      const category = isSection(text) && !node.querySelector('a[href]') && node.tagName !== 'A';
      const masthead = /^TLDR(?:\s+[\w.]+)*\s+\d{4}-\d{2}-\d{2}$/i.test(text);
      const outro = /^(?:love tldr\?|want to (?:advertise|write for|work at)|share your referral)/i.test(text);
      const heading = document.createElement(category ? 'h2' : 'h3');
      heading.className = masthead ? 'newsletter-masthead' : outro ? 'newsletter-outro-heading' : category ? 'newsletter-section-title' : 'newsletter-heading';
      headingInfo.set(heading, { level: /^H[1-6]$/.test(node.tagName) ? Number(node.tagName[1]) : 0, linked: node.tagName === 'A' || Boolean(node.querySelector('a[href]')) });
      if (node.tagName === 'A') copyInline(node, heading);
      else for (const child of node.childNodes) copyInline(child, heading);
      blocks.append(heading); return;
    }
    if (['UL', 'OL', 'PRE', 'BLOCKQUOTE'].includes(node.tagName)) { flush(); copyInline(node, blocks); return; }
    if (inline.has(node.tagName)) {
      const nestedTitle = node.querySelector('a');
      if (nestedTitle && title(nestedTitle)) { for (const child of node.childNodes) walk(child, depth + 1); }
      else copyInline(node, paragraph);
      return;
    }
    if (node.tagName === 'HR') { flush(); blocks.append(document.createElement('hr')); return; }
    if (node.tagName === 'BR') { flush(); return; }
    const boundary = ['P', 'DIV', 'TD', 'TR', 'SECTION', 'ARTICLE', 'LI'].includes(node.tagName);
    if (boundary) flush();
    for (const child of node.childNodes) walk(child, depth + 1);
    if (boundary) flush();
  }
  for (const node of template.content.childNodes) walk(node);
  flush();
  const ordered = [...blocks.childNodes];
  // A publisher may add a new section name. Infer an unlinked parent heading
  // from the following lower-level/linked article headings, rather than boxing
  // every semantic heading or relying exclusively on a fixed name list.
  for (let i = 0; i < ordered.length; i++) {
    const block = ordered[i], info = headingInfo.get(block);
    if (!block.classList.contains('newsletter-heading') || !info?.level || info.linked) continue;
    for (const next of ordered.slice(i + 1)) {
      const nextInfo = headingInfo.get(next);
      if (next.classList.contains('newsletter-section-title') || next.classList.contains('newsletter-outro-heading')) break;
      if (!nextInfo) continue;
      if (nextInfo.level && nextInfo.level <= info.level) break;
      if (nextInfo.linked || nextInfo.level > info.level) {
        block.className = 'newsletter-section-title'; break;
      }
    }
  }
  let section = null, story = null, outro = null;
  for (const block of ordered) {
    if (block.classList.contains('newsletter-masthead')) { output.append(block); section = null; story = null; outro = null; continue; }
    if (block.classList.contains('newsletter-section-title')) {
      outro = null;
      section = document.createElement('section'); section.className = 'newsletter-section';
      output.append(section); section.append(block); story = null; continue;
    }
    if (block.classList.contains('newsletter-outro-heading')) {
      if (!outro) { outro = document.createElement('footer'); outro.className = 'newsletter-outro'; output.append(outro); }
      outro.append(block); section = null; story = null; continue;
    }
    if (outro) { outro.append(block); continue; }
    if (block.classList.contains('newsletter-heading')) {
      if (!section) { section = document.createElement('section'); section.className = 'newsletter-section'; output.append(section); }
      story = document.createElement('article'); story.className = 'newsletter-story'; section.append(story);
    }
    (outro || story || section || output).append(block);
  }
  for (const section of output.querySelectorAll('.newsletter-section')) {
    if (section.children.length === 1 && section.firstElementChild.classList.contains('newsletter-section-title')) {
      const heading = section.firstElementChild; heading.classList.add('newsletter-unboxed-section'); section.replaceWith(heading);
    }
  }
  for (const story of output.querySelectorAll('.newsletter-story')) {
    const heading = story.querySelector('.newsletter-heading');
    const source = [...story.querySelectorAll('a[href]')].find(link => !/unsubscribe|preferences|share|subscribe|privacy/i.test(link.textContent));
    if (heading && !heading.querySelector('a[href]') && source) {
      const link = document.createElement('a'); link.href = source.href; link.target = '_blank'; link.rel = 'noopener noreferrer';
      link.append(...heading.childNodes); heading.append(link);
    }
  }
  return output;
}
export function extractArticles(body) {
  const fragment = readableContent(body.content, body.html);
  const articles = [], urls = new Set();
  for (const story of fragment.querySelectorAll('.newsletter-story')) {
    const heading = story.querySelector('.newsletter-heading');
    if (!heading || /\(sponsor\)|want to advertise|tell your friends/i.test(heading.textContent)) continue;
    const link = heading.querySelector('a[href]') || [...story.querySelectorAll('a[href]')].find(a => !/unsubscribe|preferences|share|subscribe|privacy/i.test(a.textContent));
    const url = link && articleUrl(link.href), title = heading.textContent.replace(/\s+/g, ' ').trim();
    if (!url || urls.has(url) || !title) continue;
    urls.add(url); articles.push({ title: title.slice(0, 300), url });
    if (articles.length === 60) break;
  }
  return articles;
}
export function decodeEntities(text) {
  const template = document.createElement('template'); template.innerHTML = text;
  return template.content.textContent || '';
}
