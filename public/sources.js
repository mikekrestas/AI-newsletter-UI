export function newsletterName(source = '', subject = '', snippet = '') {
  // LinkedIn sometimes uses its platform name instead of the newsletter's
  // name in From. Use explicit DAIR identity in metadata, only for LinkedIn
  // senders; an unrelated newsletter mentioning DAIR stays its own provider.
  const linkedin = /<[^>]*@(?:[a-z0-9-]+\.)*linkedin\.com\s*>/i.test(source) || /^\s*"?LinkedIn"?\s*(?:<|$)/i.test(source);
  if (linkedin && (/\bDAIR[.\s-]*AI\b/i.test([source, subject, snippet].join(' ')) || /\bTop (?:AI|ML) Papers of the Week\b/i.test([source, subject].join(' ')))) return 'DAIR.AI';
  const name = source.replace(/\s*<[^>]*>/g, '').replace(/^"|"$/g, '').replace(/\s+via LinkedIn$/i, '').replace(/\s+newsletter$/i, '').replace(/\s+/g, ' ').trim();
  if (/^TLDR(?:\s+Tech)?$/i.test(name)) return 'TLDR';
  if (/^TLDR\s+AI$/i.test(name)) return 'TLDR AI';
  if (/^alpha\s*signal$/i.test(name)) return 'AlphaSignal';
  if (/^DAIR[.\s]*AI$/i.test(name)) return 'DAIR.AI';
  return name || 'Newsletter';
}
export function newsletterTone(source) {
  const name = newsletterName(source);
  const known = { TLDR: 'blue', 'TLDR AI': 'violet', 'TLDR Dev': 'teal', 'TLDR Design': 'pink', 'TLDR Security': 'red', AlphaSignal: 'amber', 'DAIR.AI': 'rose' };
  if (known[name]) return known[name];
  let hash = 0; for (const character of name) hash = (hash * 31 + character.codePointAt(0)) >>> 0;
  return ['blue', 'violet', 'teal', 'pink', 'red', 'amber', 'rose', 'indigo'][hash % 8];
}
