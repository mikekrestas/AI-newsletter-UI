import { newsletterName } from './sources.js?v=6';
export const READ_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
export class GmailError extends Error { constructor(message, status) { super(message); this.status = status; } }
export class Gmail {
  constructor(token, persistent = false) { this.token = token; this.persistent = persistent; this.controller = new AbortController(); }
  close() { this.controller.abort(); this.token = ''; }
  async request(path, params = {}) {
    const url = new URL(this.persistent ? '/api/gmail/' + path : 'https://gmail.googleapis.com/gmail/v1/users/me/' + path, location.origin);
    for (const [key, value] of Object.entries(params)) {
      for (const item of Array.isArray(value) ? value : [value]) if (item !== undefined) url.searchParams.append(key, item);
    }
    const response = await fetch(url, { headers: this.persistent ? {} : { Authorization: 'Bearer ' + this.token }, credentials: 'same-origin', signal: this.controller.signal });
    if (!response.ok) {
      const errors = { 401: 'Your Gmail session expired. Connect Gmail again to continue.', 403: 'Google denied Gmail access. Check that the Gmail API is enabled and read-only permission was granted.', 429: 'Gmail is rate-limiting requests. Wait a moment and try again.' };
      throw new GmailError(errors[response.status] || 'Gmail could not load this request. Please try again.', response.status);
    }
    return response.json();
  }
  async profile() { return this.request('profile'); }
  async hostedBrief(date, sources, signal, onProgress) {
    const response = await fetch('/api/brief' + (sources ? '' : '?date=' + encodeURIComponent(date)), {
      method: sources ? 'POST' : 'GET',
      headers: { ...(this.persistent ? {} : { Authorization: 'Bearer ' + this.token }), ...(sources ? { 'Content-Type': 'application/json' } : {}), ...(onProgress ? { Accept: 'text/event-stream' } : {}) },
      credentials: 'same-origin',
      ...(sources ? { body: JSON.stringify({ date, sources }) } : {}),
      signal: signal ? AbortSignal.any([signal, this.controller.signal]) : this.controller.signal
    });
    if (response.ok && response.headers.get('Content-Type')?.includes('text/event-stream')) {
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '', report;
      try {
        while (true) {
          const { done, value } = await reader.read(); if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let end;
          while ((end = buffer.indexOf('\n\n')) !== -1) {
            const event = buffer.slice(0, end); buffer = buffer.slice(end + 2);
            if (!event.startsWith('data: ')) continue;
            const update = JSON.parse(event.slice(6));
            if (update.type === 'error') throw new GmailError(update.error, update.status);
            if (update.type === 'progress') onProgress?.(update);
            if (update.type === 'complete') report = update.report;
          }
        }
      } catch (error) { await reader.cancel().catch(() => {}); throw error; }
      finally { reader.releaseLock(); }
      if (!report) throw new Error('The connection ended before the report completed. Try again.');
      return report;
    }
    let result;
    try { result = await response.json(); } catch { throw new Error('Hosted summaries are not available here. Open your deployed Cloudflare website to generate a report.'); }
    if (!response.ok) throw new GmailError(result.error || 'The hosted report could not be loaded.', response.status);
    return result.report;
  }
  async labelId(name) {
    const result = await this.request('labels');
    const label = result.labels?.find(label => label.name.toLowerCase() === name.trim().toLowerCase());
    if (!label) throw new GmailError(`The Gmail label “${name}” was not found. Create it in Gmail, add some newsletters and refresh.`, 404);
    return label.id;
  }
  async list(labelId, pageToken, query) {
    const result = await this.request('messages', { labelIds: labelId, maxResults: 30, pageToken, q: query });
    return { ids: result.messages?.map(message => message.id) || [], nextPage: result.nextPageToken || null };
  }
  async metadata(id) {
    const message = await this.request('messages/' + encodeURIComponent(id), { format: 'metadata', metadataHeaders: ['From', 'Subject'] });
    const header = name => message.payload?.headers?.find(h => h.name.toLowerCase() === name)?.value || '';
    const from = header('from');
    const source = newsletterName(from);
    return { id: message.id, subject: header('subject') || '(Untitled edition)', source, date: Number(message.internalDate), snippet: message.snippet || '', threadId: message.threadId };
  }
  async body(id) {
    const message = await this.request('messages/' + encodeURIComponent(id), { format: 'full' });
    const parts = [];
    function collect(part) { if (!part) return; if (!part.filename && ['text/html','text/plain'].includes(part.mimeType)) parts.push(part); for (const child of part.parts || []) collect(child); }
    collect(message.payload);
    const chosen = parts.find(part => part.mimeType === 'text/html') || parts.find(part => part.mimeType === 'text/plain');
    if (!chosen) return { content: 'This edition has no readable email body. Open the original in Gmail.', html: false, readable: false };
    let data = chosen.body?.data;
    if (!data && chosen.body?.attachmentId) data = (await this.request(`messages/${encodeURIComponent(id)}/attachments/${encodeURIComponent(chosen.body.attachmentId)}`)).data;
    if (!data) return { content: 'This edition is empty. Open the original in Gmail.', html: false, readable: false };
    const normal = data.replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(normal), char => char.charCodeAt(0));
    const contentType = chosen.headers?.find(h => h.name.toLowerCase() === 'content-type')?.value || '';
    const charset = contentType.match(/charset\s*=\s*"?([^;"\s]+)/i)?.[1] || 'utf-8';
    let content;
    try { content = new TextDecoder(charset).decode(bytes); } catch { content = new TextDecoder().decode(bytes); }
    return { content, html: chosen.mimeType === 'text/html' };
  }
}
let identityScript;
export function loadGoogleIdentity() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (identityScript) return identityScript;
  identityScript = new Promise((resolve, reject) => {
    const script = document.createElement('script'); script.src = 'https://accounts.google.com/gsi/client'; script.async = true;
    script.onload = () => { if (window.google?.accounts?.oauth2) resolve(); else { identityScript = undefined; script.remove(); reject(new Error('Google sign-in did not load. Try again.')); } };
    script.onerror = () => { identityScript = undefined; script.remove(); reject(new Error('Google sign-in could not load. Check your connection and try again.')); };
    document.head.append(script);
  });
  return identityScript;
}
