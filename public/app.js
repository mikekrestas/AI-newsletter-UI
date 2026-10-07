import { Gmail, READ_SCOPE, loadGoogleIdentity } from './gmail.js?v=6';
import { readableContent, decodeEntities, extractArticles } from './reader.js?v=6';
import { newsletterName, newsletterTone } from './sources.js?v=6';
import { renderReport } from './report.js?v=6';
import { demoEditions } from './demo.js?v=6';
import { localDay, dayRange, newsletterText, collectDay, collectDayMetadata } from './brief.js?v=6';
import { showBriefProgress, stopBriefProgress } from './progress.js?v=6';
const $ = id => document.getElementById(id);
const sevenDays = 7 * 86400000;
let view = 'catchup', mode = 'welcome', account = '', editions = [], progress = {}, gmail = null, labelId = '', nextPage = null, busy = false, generation = 0, readerRequest = 0, expiresAt = 0;
let settings = readStorage('signal:settings', { clientId: '', label: 'AI Newsletters' });
let briefController = null, briefBusy = false;
let hosted = false, persistentAuth = false, savedBriefController = null;
let selectedSources = new Set();
function readStorage(key, fallback) { try { const value = JSON.parse(localStorage.getItem(key)); return value && typeof value === 'object' && !Array.isArray(value) ? value : fallback; } catch { return fallback; } }
function notice(message, error = false, undo) {
  const box = $('notice'); box.replaceChildren(); box.classList.toggle('error', error); box.hidden = !message;
  if (message) box.append(document.createTextNode(message));
  if (undo) { const button = makeButton('Undo', 'text-button', () => { undo(); notice('Dismissal undone.'); }); button.style.marginLeft = '12px'; box.append(button); }
}
function store(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { notice('Browser storage is unavailable or full. Progress will last only for this session.', true); return false; } }
function progressKey() { return mode === 'demo' ? 'signal:progress:demo' : 'signal:progress:' + account; }
function state(id) { return progress[id] || {}; }
function patch(id, value) { progress[id] = { ...state(id), ...value }; store(progressKey(), progress); render(); }
function element(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
function makeButton(text, className, action) { const button = element('button', className, text); button.type = 'button'; button.addEventListener('click', action); return button; }
function sourceStyle(source) { return /tldr/i.test(source) ? 'source-tldr' : /alpha/i.test(source) ? 'source-alpha' : /dair/i.test(source) ? 'source-dair' : ''; }
function formatDate(date) { return new Date(date).toLocaleDateString('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short', year: localDay(new Date(date)).slice(0, 4) === localDay().slice(0, 4) ? undefined : 'numeric' }); }
function recent(edition) { return edition.date >= Date.now() - sevenDays; }
function catchupItems() { return editions.filter(edition => recent(edition) && !state(edition.id).read && !state(edition.id).dismissed); }
function savedItems() { return editions.filter(edition => state(edition.id).saved); }
function filterKey() { return 'signal:filters:' + (mode === 'demo' ? 'demo' : account); }
function loadSourceSelection() {
  const saved = readStorage(filterKey(), { sources: [] }).sources;
  selectedSources = new Set(Array.isArray(saved) ? saved.filter(source => typeof source === 'string') : []);
}
function selectSource(source) {
  if (source === null) selectedSources.clear();
  else if (selectedSources.has(source)) selectedSources.delete(source);
  else selectedSources.add(source);
  store(filterKey(), { sources: [...selectedSources] }); render();
}
function sourceFilters(pool) {
  const focused = document.activeElement?.dataset.sourceFilter;
  const scrollLeft = $('source-filters').scrollLeft;
  const names = [...new Set([...editions.map(edition => newsletterName(edition.source)), ...selectedSources])].sort((a, b) => a.localeCompare(b));
  const chip = (label, name, count, active) => {
    const button = makeButton('', 'filter-chip', () => selectSource(name));
    button.dataset.sourceFilter = name ?? '__all__'; button.setAttribute('aria-pressed', String(active));
    if (name !== null) button.dataset.tone = newsletterTone(name);
    button.append(element('span', '', label));
    const badge = element('span', 'filter-count', String(count)); badge.setAttribute('aria-hidden', 'true'); button.append(badge);
    return button;
  };
  $('source-filters').replaceChildren(chip('All', null, pool.length, !selectedSources.size), ...names.map(name => chip(name, name, pool.filter(edition => newsletterName(edition.source) === name).length, selectedSources.has(name))));
  $('filter-summary').textContent = selectedSources.size ? `${selectedSources.size} selected` : 'All newsletters';
  if (focused) [...$('source-filters').children].find(button => button.dataset.sourceFilter === focused)?.focus({ preventScroll: true });
  $('source-filters').scrollLeft = scrollLeft;
}
function newsletterGroups(items) {
  const groups = new Map();
  for (const edition of items) {
    const name = newsletterName(edition.source);
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(edition);
  }
  return [...groups].map(([name, editions], index) => {
    const section = element('section', 'newsletter-group');
    const heading = element('div', 'newsletter-group-heading');
    const title = element('h2', '', name); title.id = 'newsletter-group-' + index; section.setAttribute('aria-labelledby', title.id);
    heading.append(title, element('span', 'group-count', `${editions.length} ${editions.length === 1 ? 'edition' : 'editions'}`));
    const list = element('div', 'newsletter-group-list'); list.append(...editions.map(card));
    section.append(heading, list); return section;
  });
}
function setView(next) { view = next; render(); if (view === 'brief') loadSavedBrief(); }
function render() {
  const current = mode !== 'welcome';
  const isBrief = view === 'brief';
  $('welcome').hidden = current; $('demo-banner').hidden = mode !== 'demo'; $('list-toolbar').hidden = !current || isBrief;
  $('brief-panel').hidden = !isBrief;
  $('source-filter-panel').hidden = !current || view !== 'catchup';
  $('connection').textContent = mode === 'demo' ? 'Demo mode' : account || 'Not connected';
  $('connect-button').textContent = gmail ? 'Disconnect' : settings.clientId && account ? 'Reconnect Gmail' : 'Connect Gmail';
  $('connect-button').classList.toggle('primary', !gmail); $('connect-button').classList.toggle('secondary', Boolean(gmail));
  $('connect-button').disabled = busy;
  $('refresh-button').disabled = busy || briefBusy || (!gmail && mode !== 'demo'); $('refresh-button').textContent = busy ? 'Loading…' : 'Refresh';
  $('catchup-count').textContent = catchupItems().length; $('saved-count').textContent = Object.values(progress).filter(item => item.saved).length;
  const descriptions = { brief: ['THE DAY IN A FEW LINES', 'Daily brief', 'One report from all your newsletters received that day.'], catchup: ['A LITTLE LESS NOISE', 'Catch up', 'Your last seven days. Older editions can wait.'], saved: ['WORTH COMING BACK TO', 'Saved', 'The editions you chose to keep.'], archive: ['THERE WHEN YOU NEED IT', 'Archive', 'All loaded editions, including ones you’ve read or dismissed.'] };
  const [eyebrow, title, description] = descriptions[view]; $('view-eyebrow').textContent = eyebrow; $('view-title').textContent = title; $('view-description').textContent = description;
  for (const button of document.querySelectorAll('[data-view]')) { const active = button.dataset.view === view; button.classList.toggle('active', active); if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current'); }
  $('mobile-view').value = view;
  $('mobile-view').querySelector('[value="catchup"]').textContent = `Catch up (${catchupItems().length})`;
  $('mobile-view').querySelector('[value="saved"]').textContent = `Saved (${savedItems().length})`;
  const pool = view === 'catchup' ? catchupItems() : view === 'saved' ? savedItems() : editions;
  if (view === 'catchup') sourceFilters(pool);
  const visible = pool.filter(edition => view !== 'catchup' || !selectedSources.size || selectedSources.has(newsletterName(edition.source))).slice().sort((a,b) => b.date - a.date);
  $('list-summary').textContent = `${visible.length} ${visible.length === 1 ? 'edition' : 'editions'}${busy ? ' · loading' : view === 'catchup' ? ' to catch up on' : ''}`;
  $('dismiss-older').hidden = view !== 'archive' || !editions.some(edition => !recent(edition) && !state(edition.id).dismissed);
  $('newsletter-list').hidden = isBrief;
  $('newsletter-list').setAttribute('aria-busy', String(busy)); $('newsletter-list').replaceChildren(...(view === 'catchup' ? newsletterGroups(visible) : visible.map(card)));
  $('empty').hidden = isBrief || !current || visible.length > 0 || busy;
  const emptyMessages = view === 'catchup' && nextPage ? ['No matching editions here yet.', 'Load more newsletters or choose another source.'] : view === 'catchup' && selectedSources.size ? ['You’re caught up with these newsletters.', 'Choose another newsletter to see what’s new.'] : view === 'saved' ? ['Nothing saved yet.', 'Save an edition when you want to return to it.'] : view === 'archive' ? ['No editions here yet.', 'Add newsletters to your Gmail label, then refresh.'] : ['You’re caught up.', 'Recent unread editions appear here. Older newsletters are in Archive.'];
  $('empty-title').textContent = emptyMessages[0]; $('empty-description').textContent = emptyMessages[1];
  $('clear-filters').hidden = view !== 'catchup' || !selectedSources.size;
  $('load-more').hidden = isBrief || !gmail || !nextPage || !current; $('load-more').disabled = busy;
  $('load-more').textContent = view === 'catchup' ? 'Load more newsletters' : 'Load older editions';
  $('generate-brief').disabled = briefBusy || busy || !current;
  $('generate-brief').textContent = briefBusy ? 'Generating…' : 'Generate daily brief';
  $('cancel-brief').hidden = !briefBusy;
  $('brief-date').disabled = briefBusy;
  $('brief-panel').setAttribute('aria-busy', String(briefBusy));
}
function card(edition) {
  const item = element('article', 'edition');
  const initial = /tldr/i.test(edition.source) ? 'T' : /alpha/i.test(edition.source) ? 'α' : /dair/i.test(edition.source) ? 'D' : edition.source.slice(0,1).toUpperCase();
  const icon = element('span', 'source-icon ' + sourceStyle(edition.source), initial); icon.setAttribute('aria-hidden', 'true');
  const center = element('div'); const meta = element('div', 'edition-meta');
  meta.append(element('span', 'source-name', edition.source), element('span', '', formatDate(edition.date)));
  if (state(edition.id).read) meta.append(element('span','read-label','Read'));
  if (state(edition.id).dismissed) meta.append(element('span','read-label','Dismissed'));
  const title = makeButton(edition.subject, 'edition-title', () => openEdition(edition));
  const snippet = element('p', 'edition-snippet', decodeEntities(edition.snippet));
  const actions = element('div', 'edition-actions');
  actions.append(makeButton('Read edition', 'text-button', () => openEdition(edition)));
  if (state(edition.id).dismissed) actions.append(makeButton('Restore', 'text-button', () => patch(edition.id, { dismissed: false, read: false })));
  else actions.append(makeButton('Dismiss', 'text-button', () => { const previous = { ...state(edition.id) }; patch(edition.id, { dismissed: true }); notice('Edition dismissed from Catch up.', false, () => { progress[edition.id] = previous; store(progressKey(), progress); render(); }); }));
  if (view === 'archive' && state(edition.id).read && !state(edition.id).dismissed) actions.append(makeButton('Mark unread', 'text-button', () => patch(edition.id, { read: false })));
  center.append(meta, title, snippet, actions);
  const side = element('div', 'edition-side'); const saved = Boolean(state(edition.id).saved);
  const save = makeButton(saved ? 'Saved' : 'Save', 'save-button', () => patch(edition.id, { saved: !saved })); save.setAttribute('aria-pressed', String(saved)); save.setAttribute('aria-label', (saved ? 'Unsave ' : 'Save ') + edition.subject);
  side.append(save, element('span','edition-time', recent(edition) ? 'This week' : 'Older edition'));
  item.append(icon, center, side); return item;
}
async function openEdition(edition) {
  const requestId = ++readerRequest;
  $('reader-title').textContent = edition.subject; $('reader-source').textContent = edition.source; $('reader-date').textContent = formatDate(edition.date);
  $('reader-content').replaceChildren(element('p', '', 'Loading edition…')); $('reader-actions').replaceChildren();
  if (!$('reader-dialog').open) $('reader-dialog').showModal();
  document.body.classList.add('reader-open');
  $('reader-scroll').scrollTop = 0;
  try {
    const body = mode === 'demo' ? { content: edition.demoBody, html: true } : gmail ? await gmail.body(edition.id) : null;
    if (requestId !== readerRequest || !$('reader-dialog').open) return;
    if (!body) throw new Error('Connect Gmail again to read this edition.');
    $('reader-content').replaceChildren(readableContent(body.content, body.html));
    const saved = Boolean(state(edition.id).saved);
    const save = makeButton(saved ? 'Unsave edition' : 'Save edition', 'button secondary', () => { const next = !state(edition.id).saved; patch(edition.id, { saved: next }); save.textContent = next ? 'Unsave edition' : 'Save edition'; });
    const dismiss = makeButton('Dismiss edition', 'button secondary', () => { patch(edition.id, { dismissed: true }); $('reader-dialog').close(); });
    $('reader-actions').append(save, dismiss);
    if (mode !== 'demo') {
      const original = element('a','button primary','Open in Gmail');
      original.href = `https://mail.google.com/mail/?authuser=${encodeURIComponent(account)}#all/${encodeURIComponent(edition.threadId || edition.id)}`; original.target = '_blank'; original.rel = 'noopener noreferrer'; $('reader-actions').append(original);
    }
    patch(edition.id, { read: true });
  } catch (error) { if (requestId !== readerRequest || error.name === 'AbortError') return; $('reader-content').replaceChildren(element('p', '', error.message)); }
}
function openSettings() {
  $('client-id').value = settings.clientId || ''; $('gmail-label').value = settings.label || 'AI Newsletters';
  $('client-id').readOnly = hosted && Boolean(settings.clientId); $('gmail-label').readOnly = hosted;
  $('origin').textContent = location.origin; $('settings-dialog').showModal();
}
function closeSession(clearAccount = true) {
  briefController?.abort(); briefController = null; briefBusy = false;
  savedBriefController?.abort(); savedBriefController = null;
  $('brief-result').hidden = true; $('brief-text').replaceChildren(); $('brief-source-list').replaceChildren();
  $('brief-day-sources').hidden = true;
  $('brief-progress-panel').hidden = true;
  $('brief-status').textContent = 'Choose a date to summarise all newsletters received that day.';
  generation++; readerRequest++; gmail?.close(); gmail = null; expiresAt = 0; labelId = ''; nextPage = null; busy = false; editions = []; progress = {}; mode = 'welcome';
  selectedSources.clear();
  if (clearAccount) account = '';
  if ($('reader-dialog').open) $('reader-dialog').close(); render();
}
async function connect() {
  if (gmail) {
    if (gmail.persistent) {
      try { const result = await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }); if (!result.ok) throw new Error('Sign-out could not finish. Please try again.'); }
      catch (error) { notice(error.message, true); return; }
    }
    closeSession(); notice('Disconnected. Your local progress is kept for your next connection.'); return;
  }
  if (persistentAuth) { location.assign('/api/auth/login'); return; }
  if (!settings.clientId) { openSettings(); return; }
  // Google library is normally preloaded after settings; a second click preserves
  // the user gesture needed for the OAuth popup if it was not ready yet.
  if (!window.google?.accounts?.oauth2) {
    notice('Loading Google sign-in…');
    try { await loadGoogleIdentity(); notice('Google sign-in is ready. Click Connect Gmail to continue.'); } catch (error) { notice(error.message, true); }
    return;
  }
  const attempt = ++generation;
  const client = window.google.accounts.oauth2.initTokenClient({
    client_id: settings.clientId, scope: READ_SCOPE, include_granted_scopes: false,
    error_callback: error => { if (attempt === generation) notice(error.type === 'popup_closed' ? 'Sign-in was closed. You can connect whenever you’re ready.' : 'Google sign-in could not open. Allow popups for this site and try again.', true); },
    callback: async response => {
      if (attempt !== generation) return;
      if (response.error || !response.access_token) { notice('Gmail access was not granted. Try connecting again.', true); return; }
      if (!window.google.accounts.oauth2.hasGrantedAllScopes(response, READ_SCOPE)) { notice('Read-only Gmail access is needed to display newsletters.', true); return; }
      closeSession(); const session = generation; gmail = new Gmail(response.access_token); expiresAt = Date.now() + Number(response.expires_in || 3600) * 1000;
      busy = true; render(); notice('Connecting to your newsletter label…');
      try {
        const profile = await gmail.profile(); if (session !== generation) return;
        account = profile.emailAddress; progress = readStorage(progressKey(), {}); mode = 'gmail'; loadSourceSelection(); view = 'catchup';
        labelId = await gmail.labelId(settings.label); if (session !== generation) return;
        busy = false; await loadPage(true, session);
      } catch (error) { if (session !== generation || error.name === 'AbortError') return; busy = false; notice(error.message, true); render(); }
    }
  });
  client.requestAccessToken({ prompt: '' });
}
async function restoreHostedSession() {
  const attempt = generation;
  let activeGeneration = attempt;
  busy = true; render(); notice('Restoring your saved Gmail sign-in…');
  try {
    const response = await fetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store' });
    const sessionInfo = await response.json();
    if (attempt !== generation) return;
    if (response.status === 401) { busy = false; notice(''); render(); return; }
    if (!response.ok) throw new Error(sessionInfo.error || 'Saved sign-in could not be restored. Try again.');
    closeSession(); const session = generation; activeGeneration = session;
    gmail = new Gmail('', true); expiresAt = Infinity; account = sessionInfo.email;
    mode = 'gmail'; progress = readStorage(progressKey(), {}); loadSourceSelection();
    busy = true; render();
    labelId = await gmail.labelId(settings.label);
    if (session !== generation) return;
    busy = false; await loadPage(true, session);
  } catch (error) { if (activeGeneration !== generation || error.name === 'AbortError') return; busy = false; notice(error.message, true); render(); }
}
async function metadataBatch(ids, api) {
  const result = [];
  for (let i = 0; i < ids.length; i += 4) {
    const chunk = await Promise.all(ids.slice(i, i + 4).map(async id => { try { return await api.metadata(id); } catch (error) { if (error.status === 404) return null; throw error; } }));
    result.push(...chunk.filter(Boolean));
  }
  return result;
}
async function loadPage(reset = false, session = generation) {
  if (!gmail || busy) return;
  if (Date.now() >= expiresAt) { notice('Your Gmail session expired. Disconnect and connect Gmail again to continue.', true); return; }
  const api = gmail; busy = true; render(); notice('Loading newsletters…');
  try {
    if (!labelId) labelId = await api.labelId(settings.label);
    if (session !== generation) return;
    const page = await api.list(labelId, reset ? undefined : nextPage);
    const incoming = await metadataBatch(page.ids, api);
    if (session !== generation) return;
    const keep = reset ? editions.filter(edition => state(edition.id).saved) : editions;
    const combined = new Map(keep.map(edition => [edition.id, edition]));
    for (const edition of incoming) combined.set(edition.id, edition);
    if (reset) {
      // Load saved IDs even when they are not in the first page; do not store bodies.
      const missing = Object.keys(progress).filter(id => state(id).saved && !combined.has(id));
      for (const edition of await metadataBatch(missing, api)) combined.set(edition.id, edition);
      if (session !== generation) return;
    }
    editions = [...combined.values()]; nextPage = page.nextPage;
    notice(editions.length ? '' : 'Your label has no newsletters yet. Add some in Gmail, then refresh.');
  } catch (error) { if (session === generation && error.name !== 'AbortError') notice(error.message, true); }
  finally { if (session === generation) { busy = false; render(); } }
}
$('settings-form').addEventListener('submit', event => {
  event.preventDefault();
  const clientId = $('client-id').value.trim(); const label = $('gmail-label').value.trim();
  if (!label || !/^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/.test(clientId)) return;
  const changed = clientId !== settings.clientId || label !== settings.label;
  if (changed && gmail) closeSession();
  settings = { clientId, label }; store('signal:settings', settings); $('settings-dialog').close(); render(); notice('Settings saved. Connect Gmail when you’re ready.');
  loadGoogleIdentity().catch(error => notice(error.message, true));
});
$('settings-button').addEventListener('click', openSettings); $('welcome-connect').addEventListener('click', () => settings.clientId ? connect() : openSettings()); $('connect-button').addEventListener('click', connect);
$('demo-button').addEventListener('click', () => { closeSession(); mode = 'demo'; editions = demoEditions; progress = readStorage(progressKey(), {}); loadSourceSelection(); view = 'catchup'; notice(''); render(); });
$('exit-demo').addEventListener('click', () => { closeSession(); notice(''); });
$('refresh-button').addEventListener('click', () => mode === 'demo' ? (notice('Demo editions are samples. Connect Gmail for your own newsletters.'), render()) : view === 'brief' ? loadSavedBrief() : loadPage(true));
$('load-more').addEventListener('click', () => loadPage(false));
$('dismiss-older').addEventListener('click', () => {
  const previous = structuredClone(progress); let count = 0;
  for (const edition of editions) if (!recent(edition) && !state(edition.id).dismissed && !state(edition.id).saved) { progress[edition.id] = { ...state(edition.id), dismissed: true }; count++; }
  store(progressKey(), progress); render(); notice(`${count} loaded older ${count === 1 ? 'edition' : 'editions'} dismissed. Saved editions were kept.`, false, () => { progress = previous; store(progressKey(), progress); render(); });
});
for (const button of document.querySelectorAll('[data-view]')) button.addEventListener('click', () => setView(button.dataset.view));
$('mobile-view').addEventListener('change', event => setView(event.target.value));
$('clear-filters').addEventListener('click', () => selectSource(null));
for (const button of document.querySelectorAll('[data-close]')) button.addEventListener('click', () => $(button.dataset.close).close());
$('reader-dialog').addEventListener('close', () => { readerRequest++; document.body.classList.remove('reader-open'); });
// Both press and release must be outside the dialog: selecting text and then
// releasing over the backdrop must not unexpectedly close the reader.
const readerDialog = $('reader-dialog');
let backdropPress = false;
function outsideReader(event) {
  return event.target === readerDialog;
}
readerDialog.addEventListener('pointerdown', event => { backdropPress = event.target === readerDialog && outsideReader(event); });
readerDialog.addEventListener('pointerup', event => {
  if (backdropPress && event.target === readerDialog && outsideReader(event)) readerDialog.close();
  backdropPress = false;
});
readerDialog.addEventListener('pointercancel', () => { backdropPress = false; });
readerDialog.addEventListener('click', event => { if (outsideReader(event) && event.detail === 0) readerDialog.close(); });

$('brief-date').value = localDay();
function clearBrief() {
  savedBriefController?.abort(); savedBriefController = null;
  $('brief-result').hidden = true; $('brief-text').replaceChildren(); $('brief-source-list').replaceChildren();
  $('brief-day-sources').hidden = true;
  $('brief-progress-panel').hidden = true;
  $('brief-status').textContent = 'Choose a date to summarise all newsletters received that day.';
  $('brief-status').classList.remove('is-error');
}
function showDayCoverage(editions, report) {
  const processed = new Set((report?.sources || []).map(source => source.id));
  const groups = new Map();
  for (const edition of editions) {
    const name = newsletterName(edition.source);
    if (!groups.has(name)) groups.set(name, { total: 0, processed: 0 });
    const group = groups.get(name); group.total++; if (processed.has(edition.id)) group.processed++;
  }
  const missing = editions.filter(edition => !processed.has(edition.id)).length;
  $('brief-day-heading').textContent = `${editions.length} ${editions.length === 1 ? 'edition' : 'editions'} available · ${groups.size} ${groups.size === 1 ? 'newsletter' : 'newsletters'}`;
  $('brief-day-provider-list').replaceChildren(...[...groups].map(([name, counts]) => {
    const badge = element('span', 'provider-badge', name + ' · ' + counts.total);
    badge.dataset.tone = newsletterTone(name);
    if (report) badge.title = `${counts.processed} of ${counts.total} editions included in the saved brief`;
    return badge;
  }));
  $('brief-day-note').textContent = report && missing
    ? `${missing} ${missing === 1 ? 'edition is' : 'editions are'} missing from this saved brief. Generate again to include them.`
    : editions.length === 1 ? 'Only one labelled edition was found for this London-calendar date. If you expected more, check their Gmail label and arrival date.'
    : editions.length ? report ? 'Every currently available edition is included in this brief. Highlights select the main news across these sources.' : 'Generation will read all of these editions, including read and dismissed emails. Catch up filters do not affect the brief.'
    : 'No emails with your newsletter label arrived on this London-calendar date.';
  $('brief-day-sources').classList.toggle('needs-update', Boolean(report && missing));
  $('brief-day-sources').hidden = false;
  return missing;
}
function showReport(report, demo = false) {
  $('brief-text').replaceChildren(renderReport(report, openEdition));
  document.querySelector('.brief-link-hint').hidden = !$('brief-text').querySelector('a, .inline-source');
  const dateLabel = new Date(dayRange(report.date).start).toLocaleDateString('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'long', year: 'numeric' });
  const sources = report.sources;
  $('brief-coverage').textContent = `${dateLabel} · ${sources.length} ${sources.length === 1 ? 'newsletter' : 'newsletters'} processed · ${new Set(sources.map(source => source.source)).size} sources${demo ? ' · fictional demo' : ''}`;
  $('brief-source-list').replaceChildren(...sources.map(source => makeButton(`${source.source} — ${source.subject}`, 'brief-source-button', () => openEdition(source))));
  $('brief-sources').querySelector('summary').textContent = `Source editions (${sources.length} processed)`;
  $('brief-result').hidden = false;
}
async function loadSavedBrief() {
  if (!gmail || !hosted || briefBusy) return;
  savedBriefController?.abort();
  const controller = new AbortController(); savedBriefController = controller;
  const session = generation; const date = $('brief-date').value;
  try {
    dayRange(date);
    $('brief-status').classList.remove('is-error');
    $('brief-status').textContent = 'Checking for a saved report…';
    const report = await gmail.hostedBrief(date, null, controller.signal);
    if (session !== generation || controller.signal.aborted || $('brief-date').value !== date) return;
    if (report) {
      showReport(report);
      const time = new Date(report.generatedAt).toLocaleString('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      $('brief-status').textContent = `Saved report · generated ${time} London time. Generate again to include newer emails.`;
    } else $('brief-status').textContent = 'No saved report for this date yet. Generate one from your newsletters.';
    const savedMessage = $('brief-status').textContent;
    $('brief-status').textContent = 'Checking every labelled edition for this date…';
    if (!labelId) labelId = await gmail.labelId(settings.label);
    const available = await collectDayMetadata(gmail, labelId, date, controller.signal);
    if (session !== generation || controller.signal.aborted || $('brief-date').value !== date) return;
    const missing = showDayCoverage(available, report);
    $('brief-status').textContent = report && missing ? `Saved report needs updating: ${missing} new ${missing === 1 ? 'edition' : 'editions'} found. Generate again to include all sources.` : savedMessage;
  } catch (error) { if (!controller.signal.aborted && session === generation) { $('brief-status').textContent = error.message; $('brief-status').classList.add('is-error'); } }
  finally { if (savedBriefController === controller) savedBriefController = null; }
}
$('brief-date').addEventListener('change', () => { clearBrief(); loadSavedBrief(); });
$('cancel-brief').addEventListener('click', () => briefController?.abort());
$('generate-brief').addEventListener('click', async () => {
  if (briefBusy || busy || mode === 'welcome') return;
  const date = $('brief-date').value;
  let range;
  try { range = dayRange(date); } catch (error) { $('brief-status').textContent = error.message; return; }
  if (gmail && Date.now() >= expiresAt) { $('brief-status').textContent = 'Your Gmail session expired. Disconnect and reconnect Gmail, then generate again.'; return; }
  const session = generation; const api = gmail; const demo = mode === 'demo';
  const controller = new AbortController(); briefController = controller; briefBusy = true;
  clearBrief(); render();
  const update = (message, error = false) => { if (briefController === controller) { $('brief-status').textContent = message; $('brief-status').classList.toggle('is-error', error); } };
  const stage = progress => { if (briefController === controller) showBriefProgress(progress); };
  stage({ stage: 'collecting', message: 'Collecting every newsletter for this date…' });
  try {
    let sources;
    if (demo) {
      sources = demoEditions.filter(item => item.date >= range.start && item.date < range.end)
        .map(item => ({ ...item, text: newsletterText({ content: item.demoBody, html: true }), articles: extractArticles({ content: item.demoBody, html: true }) }));
    } else {
      if (!labelId) labelId = await api.labelId(settings.label);
      sources = await collectDay(api, labelId, date, controller.signal, update, stage);
    }
    controller.signal.throwIfAborted();
    if (!sources.length) { $('brief-progress-panel').hidden = true; update('No newsletters were received on this date. Choose another day.'); return; }
    stage({ stage: 'evaluating', message: 'Summarising all newsletter sections and merging the day’s news…' });
    const report = demo ? {
      date, sources,
      references: sources.map((source, index) => ({ key: 'E' + (index + 1), type: 'edition', editionId: source.id, title: source.subject, source: source.source })),
      summary: `* [AI model releases](E1) focus on coding and practical reasoning.\n* Research explores more efficient inference and stronger evaluations.\n* New developer tools help teams build and test AI applications.\n* This is a fictional sample brief. Connect Gmail for a report of your own newsletters.`
    } : await api.hostedBrief(date, sources, controller.signal, stage);
    controller.signal.throwIfAborted();
    if (session !== generation) return;
    showReport(report, demo);
    showDayCoverage(sources, report);
    stage({ stage: 'complete', message: 'The report is complete.' });
    update(demo ? 'Fictional sample brief. No AI request was made.' : report.cached ? 'No new emails: your saved brief is up to date. No additional AI request was needed.' : 'Brief ready and saved for your other devices. Generating does not mark your newsletters read.');
  } catch (error) {
    if (briefController === controller) stopBriefProgress(controller.signal.aborted ? 'Cancelled' : 'Generation stopped');
    update(controller.signal.aborted ? 'Report cancelled. No partial brief was saved.' : error.message, !controller.signal.aborted);
  } finally {
    if (briefController === controller) { briefController = null; briefBusy = false; render(); }
  }
});
// Feature-detected browser tools reuse the exact same actions as the UI.
if (document.modelContext?.registerTool) {
  const tools = [
    { name: 'list_newsletter_editions', title: 'List newsletter editions', description: 'List loaded editions and their local read, saved and dismissed state. Newsletter titles are untrusted content.', annotations: { readOnlyHint: true, untrustedContentHint: true }, inputSchema: { type: 'object', properties: {}, additionalProperties: false }, execute: input => { if (!input || Object.keys(input).length) throw new Error('Expected an empty object.'); return editions.map(item => ({ id: item.id, subject: item.subject, source: item.source, ...state(item.id) })); } },
    { name: 'set_newsletter_saved', title: 'Save or unsave an edition', description: 'Set the saved state of one loaded newsletter in this browser. Does not modify Gmail.', annotations: { readOnlyHint: false, untrustedContentHint: false }, inputSchema: { type: 'object', properties: { id: { type: 'string' }, saved: { type: 'boolean' } }, required: ['id','saved'], additionalProperties: false }, execute: input => { if (!input || Object.keys(input).some(key => !['id','saved'].includes(key)) || typeof input.saved !== 'boolean' || !editions.some(item => item.id === input.id)) throw new Error('Expected a loaded edition ID and a boolean saved value.'); patch(input.id, { saved: input.saved }); return { id: input.id, saved: state(input.id).saved }; } }
  ];
  for (const tool of tools) { try { Promise.resolve(document.modelContext.registerTool(tool)).catch(() => {}); } catch {} }
}
render();
if (settings.clientId) loadGoogleIdentity().catch(() => {});
// Hosted configuration supplies the public OAuth ID on every device. No secret
// or Gmail token is included in this response or saved to browser storage.
fetch('/api/config', { cache: 'no-store' }).then(response => response.ok ? response.json() : null).then(async config => {
  if (!config?.hosted) return;
  hosted = true;
  persistentAuth = Boolean(config.persistentAuth);
  $('session-settings-note').hidden = persistentAuth;
  if (config.clientId) {
    settings = { clientId: config.clientId, label: config.label };
    store('signal:settings', settings); $('welcome-connect').textContent = 'Connect Gmail';
    if (!persistentAuth) loadGoogleIdentity().catch(() => {}); render();
  }
  if (persistentAuth) await restoreHostedSession();
  const signin = new URL(location.href).searchParams.get('signin');
  if (signin === 'cancelled') { notice('Google sign-in was cancelled. You can connect when ready.'); history.replaceState(null, '', location.pathname); }
}).catch(() => {});
