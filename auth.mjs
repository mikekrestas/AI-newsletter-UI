const SESSION_COOKIE = '__Host-signal_session';
const STATE_COOKIE = '__Host-signal_oauth';
const YEAR = 365 * 86400;
const encoder = new TextEncoder();
const refreshes = new Map();
export class AuthError extends Error { constructor(message, status = 401) { super(message); this.status = status; } }
export function sessionConfigured(env) { return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.SESSION_ENCRYPTION_KEY && env.REPORTS && env.OWNER_EMAIL); }
function base64(bytes) { return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function decode(value) { return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0)); }
function random() { return base64(crypto.getRandomValues(new Uint8Array(32))); }
async function hash(value) { return base64(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))); }
function cookie(request, name) { return request.headers.get('Cookie')?.split(';').map(part => part.trim()).find(part => part.startsWith(name + '='))?.slice(name.length + 1) || ''; }
function setCookie(name, value, age) { return `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${age}`; }
export function checkOrigin(request, mutation = false) {
  const origin = request.headers.get('Origin');
  if ((mutation && origin !== new URL(request.url).origin) || (origin && origin !== new URL(request.url).origin) || request.headers.get('Sec-Fetch-Site') === 'cross-site') throw new AuthError('Use Signal from its own website.', 403);
}
async function key(env) {
  const bytes = decode(env.SESSION_ENCRYPTION_KEY); if (bytes.length !== 32) throw new AuthError('Persistent sign-in is not configured correctly.', 503);
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
async function seal(value, env, recordKey) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(recordKey) }, await key(env), encoder.encode(JSON.stringify(value)));
  return { iv: base64(iv), ciphertext: base64(new Uint8Array(data)) };
}
async function unseal(value, env, recordKey) {
  try { return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(value.iv), additionalData: encoder.encode(recordKey) }, await key(env), decode(value.ciphertext)))); }
  catch { throw new AuthError('Your saved sign-in is no longer valid. Connect Gmail again.'); }
}
function response(value, status = 200, cookies = []) {
  const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' });
  for (const item of cookies) headers.append('Set-Cookie', item);
  return new Response(JSON.stringify(value), { status, headers });
}
function redirect(location, cookies = []) {
  const headers = new Headers({ Location: location, 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' });
  for (const item of cookies) headers.append('Set-Cookie', item);
  return new Response(null, { status: 303, headers });
}
async function tokenRequest(env, params) {
  const result = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, ...params }), signal: AbortSignal.timeout(15000)
  });
  let data; try { data = await result.json(); } catch { throw new AuthError('Google could not refresh sign-in. Try again.', 502); }
  if (!result.ok) throw new AuthError(data.error === 'invalid_grant' ? 'Google access was revoked or expired. Connect Gmail again.' : 'Google could not refresh sign-in. Try again.', data.error === 'invalid_grant' ? 401 : 502);
  if (!data.access_token || !Number.isFinite(Number(data.expires_in))) throw new AuthError('Google returned an incomplete sign-in response.', 502);
  return data;
}
export async function sessionAccess(request, env, forceRefresh = false) {
  if (!sessionConfigured(env)) throw new AuthError('Persistent sign-in is not configured. Complete setup:session first.', 503);
  checkOrigin(request);
  const id = cookie(request, SESSION_COOKIE);
  if (!/^[A-Za-z0-9_-]{43}$/.test(id)) throw new AuthError('Connect Gmail to use your saved sign-in.');
  const recordKey = 'session:' + await hash(id);
  const encrypted = await env.REPORTS.get(recordKey, 'json');
  if (!encrypted) throw new AuthError('Your saved sign-in expired. Connect Gmail again.');
  let record = await unseal(encrypted, env, recordKey);
  if (record.email?.toLowerCase() !== env.OWNER_EMAIL.trim().toLowerCase()) throw new AuthError('This app is restricted to its owner.', 403);
  if (forceRefresh || record.expiresAt <= Date.now() + 60000) {
    if (!refreshes.has(recordKey)) {
      const task = (async () => {
        let data;
        try { data = await tokenRequest(env, { grant_type: 'refresh_token', refresh_token: record.refreshToken }); }
        catch (error) { if (error.status === 401) await env.REPORTS.delete(recordKey); throw error; }
        record.accessToken = data.access_token; record.refreshToken = data.refresh_token || record.refreshToken;
        record.expiresAt = Date.now() + Number(data.expires_in) * 1000;
        const encrypted = JSON.stringify(await seal(record, env, recordKey));
        if (!refreshes.has(recordKey)) throw new AuthError('This session was signed out. Connect Gmail again.');
        await env.REPORTS.put(recordKey, encrypted, { expirationTtl: YEAR });
        if (!refreshes.has(recordKey)) { await env.REPORTS.delete(recordKey); throw new AuthError('This session was signed out. Connect Gmail again.'); }
        return record;
      })();
      refreshes.set(recordKey, task);
      task.finally(() => refreshes.delete(recordKey)).catch(() => {});
    }
    record = await refreshes.get(recordKey);
  }
  return { ...record, recordKey, id };
}
export async function authRoute(request, env) {
  const url = new URL(request.url);
  try {
    if (url.pathname === '/api/auth/session' && request.method === 'GET') {
      const session = await sessionAccess(request, env);
      return response({ connected: true, email: session.email }, 200, [setCookie(SESSION_COOKIE, session.id, YEAR)]);
    }
    if (!sessionConfigured(env)) throw new AuthError('Persistent sign-in needs the one-time Cloudflare setup:session configuration.', 503);
    if (url.pathname === '/api/auth/login' && request.method === 'GET') {
      checkOrigin(request);
      const state = random(), verifier = random();
      await env.REPORTS.put('oauth:' + await hash(state), JSON.stringify({ verifier, origin: url.origin }), { expirationTtl: 600 });
      const destination = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      destination.search = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: url.origin + '/api/auth/callback', response_type: 'code', scope: 'https://www.googleapis.com/auth/gmail.readonly', access_type: 'offline', prompt: 'consent', state, code_challenge: await hash(verifier), code_challenge_method: 'S256', login_hint: env.OWNER_EMAIL }).toString();
      return redirect(destination.href, [setCookie(STATE_COOKIE, state, 600)]);
    }
    if (url.pathname === '/api/auth/callback' && request.method === 'GET') {
      const state = url.searchParams.get('state');
      if (!state || state !== cookie(request, STATE_COOKIE) || !/^[A-Za-z0-9_-]{43}$/.test(state)) throw new AuthError('Google sign-in could not be verified. Try connecting again.', 403);
      const stateKey = 'oauth:' + await hash(state);
      const pending = await env.REPORTS.get(stateKey, 'json'); await env.REPORTS.delete(stateKey);
      if (!pending || pending.origin !== url.origin) throw new AuthError('Google sign-in expired. Try connecting again.');
      if (url.searchParams.has('error') || !url.searchParams.get('code')) return redirect('/?signin=cancelled', [setCookie(STATE_COOKIE, '', 0)]);
      const data = await tokenRequest(env, { grant_type: 'authorization_code', code: url.searchParams.get('code'), code_verifier: pending.verifier, redirect_uri: url.origin + '/api/auth/callback' });
      if (!data.scope?.split(' ').includes('https://www.googleapis.com/auth/gmail.readonly')) throw new AuthError('Read-only Gmail access was not granted.', 403);
      const profileResponse = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', { headers: { Authorization: 'Bearer ' + data.access_token }, signal: AbortSignal.timeout(15000) });
      if (!profileResponse.ok) throw new AuthError('Google could not verify this Gmail account.', 502);
      const profile = await profileResponse.json();
      if (profile.emailAddress?.toLowerCase() !== env.OWNER_EMAIL.trim().toLowerCase()) throw new AuthError('This app is restricted to its owner’s Gmail account.', 403);
      if (!data.refresh_token) throw new AuthError('Google did not grant persistent access. Connect again and approve offline access.', 400);
      const oldId = cookie(request, SESSION_COOKIE);
      if (/^[A-Za-z0-9_-]{43}$/.test(oldId)) await env.REPORTS.delete('session:' + await hash(oldId));
      const id = random(), recordKey = 'session:' + await hash(id);
      const record = { email: profile.emailAddress, accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt: Date.now() + Number(data.expires_in) * 1000 };
      await env.REPORTS.put(recordKey, JSON.stringify(await seal(record, env, recordKey)), { expirationTtl: YEAR });
      return redirect('/', [setCookie(STATE_COOKIE, '', 0), setCookie(SESSION_COOKIE, id, YEAR)]);
    }
    if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
      checkOrigin(request, true);
      const id = cookie(request, SESSION_COOKIE);
      if (/^[A-Za-z0-9_-]{43}$/.test(id)) { const recordKey = 'session:' + await hash(id); refreshes.delete(recordKey); await env.REPORTS.delete(recordKey); }
      // Invalidate Signal's session. Do not revoke Google's entire grant, which
      // would also sign the owner's other Signal devices out.
      return response({ connected: false }, 200, [setCookie(SESSION_COOKIE, '', 0)]);
    }
    return response({ error: 'Unknown sign-in endpoint.' }, 404);
  } catch (error) {
    const status = error instanceof AuthError ? error.status : 503;
    const cookies = status === 401 ? [setCookie(SESSION_COOKIE, '', 0)] : [];
    return response({ connected: false, error: error instanceof AuthError ? error.message : 'Sign-in could not finish. Try again.' }, status, cookies);
  }
}

export async function gmailRoute(request, env) {
  try {
    if (request.method !== 'GET') throw new AuthError('Gmail access is read-only.', 405);
    const url = new URL(request.url), path = url.pathname.slice('/api/gmail/'.length);
    if (!/^(?:profile|labels|messages(?:\/[A-Za-z0-9_-]{1,200}(?:\/attachments\/[A-Za-z0-9_-]{1,1000})?)?)$/.test(path)) throw new AuthError('Unknown Gmail resource.', 404);
    const allowed = new Set(['labelIds', 'maxResults', 'pageToken', 'q', 'format', 'metadataHeaders']);
    if ([...url.searchParams.keys()].some(name => !allowed.has(name))) throw new AuthError('Unsupported Gmail request.', 400);
    const session = await sessionAccess(request, env);
    const destination = 'https://gmail.googleapis.com/gmail/v1/users/me/' + path + url.search;
    let result = await fetch(destination, { headers: { Authorization: 'Bearer ' + session.accessToken }, signal: AbortSignal.timeout(20000) });
    if (result.status === 401) {
      const refreshed = await sessionAccess(request, env, true);
      result = await fetch(destination, { headers: { Authorization: 'Bearer ' + refreshed.accessToken }, signal: AbortSignal.timeout(20000) });
    }
    return new Response(result.body, { status: result.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' } });
  } catch (error) { return response({ error: error instanceof AuthError ? error.message : 'Gmail could not be reached. Try again.' }, error instanceof AuthError ? error.status : 502); }
}
