import assert from 'node:assert/strict';
import { test } from 'node:test';
import worker from '../worker.mjs';
const base = 'https://signal.example';
const scope = 'https://www.googleapis.com/auth/gmail.readonly';
function fixture() {
  const data = new Map(), writes = [], calls = [];
  const env = { OWNER_EMAIL: 'owner@example.com', GOOGLE_CLIENT_ID: 'client.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'test-client-secret', SESSION_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64url'), REPORTS: {
    get: async key => data.has(key) ? JSON.parse(data.get(key)) : null,
    put: async (key, value, options) => { data.set(key, value); writes.push({ key, value, options }); }, delete: async key => { data.delete(key); }
  }, AI: { run: async () => ({ response: '* A finished report.' }) }, ASSETS: { fetch: async () => new Response('app') } };
  let email = 'owner@example.com', expires = 3600, revoked = false, grantedScope = scope, refreshed = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (url === 'https://oauth2.googleapis.com/token') {
      const params = new URLSearchParams(options.body);
      assert.equal(params.get('client_secret'), env.GOOGLE_CLIENT_SECRET);
      if (params.get('grant_type') === 'refresh_token') {
        await new Promise(resolve => setTimeout(resolve, 20));
        if (revoked) return Response.json({ error: 'invalid_grant' }, { status: 400 });
        refreshed++; return Response.json({ access_token: 'renewed-access-token', expires_in: 3600 });
      }
      assert.ok(params.get('code_verifier')); assert.equal(params.get('redirect_uri'), base + '/api/auth/callback');
      return Response.json({ access_token: 'initial-access-token', refresh_token: 'private-refresh-token', expires_in: expires, scope: grantedScope });
    }
    if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/profile') return Response.json({ emailAddress: email });
    assert.ok(String(url).startsWith('https://gmail.googleapis.com/gmail/v1/users/me/'));
    assert.match(options.headers.Authorization, /^Bearer (initial|renewed)-access-token$/);
    return Response.json({ labels: [{ id: 'newsletter-label', name: 'AI Newsletters' }] });
  };
  const request = (path, options = {}) => new Request(base + path, options);
  async function start() {
    const result = await worker.fetch(request('/api/auth/login'), env);
    assert.equal(result.status, 303);
    const destination = new URL(result.headers.get('Location'));
    assert.equal(destination.origin, 'https://accounts.google.com');
    assert.equal(destination.searchParams.get('access_type'), 'offline'); assert.equal(destination.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(destination.searchParams.get('scope'), scope);
    return { state: destination.searchParams.get('state'), cookie: result.headers.getSetCookie()[0].split(';')[0] };
  }
  async function login() {
    const pending = await start();
    const result = await worker.fetch(request('/api/auth/callback?code=one-time-code&state=' + pending.state, { headers: { Cookie: pending.cookie } }), env);
    const cookie = result.headers.getSetCookie().find(value => value.startsWith('__Host-signal_session='))?.split(';')[0];
    return { result, cookie, pending };
  }
  return { env, data, writes, calls, request, login, start, get refreshed() { return refreshed; }, expire: () => { expires = -1; }, revoke: () => { revoked = true; }, wrongOwner: () => { email = 'other@example.com'; }, removeScope: () => { grantedScope = 'openid'; }, restore: () => { globalThis.fetch = original; } };
}
await test('OAuth session survives repeated visits without exposing Google credentials', async () => {
  const f = fixture(); try {
    const { result, cookie, pending } = await f.login(); assert.equal(result.status, 303); assert.equal(result.headers.get('Location'), '/');
    const sessionHeader = result.headers.getSetCookie().find(value => value.startsWith('__Host-signal_session='));
    for (const flag of ['Secure', 'HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=31536000']) assert.ok(sessionHeader.includes(flag));
    assert.doesNotMatch(sessionHeader, /access-token|refresh-token/);
    const stored = f.writes.find(write => write.key.startsWith('session:'));
    assert.doesNotMatch(stored.value, /initial-access-token|private-refresh-token|owner@example/);
    assert.equal(stored.options.expirationTtl, 31536000);
    for (let visit = 0; visit < 3; visit++) {
      const response = await worker.fetch(f.request('/api/auth/session', { headers: { Cookie: cookie } }), f.env);
      assert.deepEqual(await response.json(), { connected: true, email: 'owner@example.com' });
    }
    assert.equal(f.refreshed, 0);
    const replay = await worker.fetch(f.request('/api/auth/callback?code=one-time-code&state=' + pending.state, { headers: { Cookie: pending.cookie } }), f.env); assert.equal(replay.status, 401);
    const config = await (await worker.fetch(f.request('/api/config'), f.env)).text(); assert.match(config, /"persistentAuth":true/); assert.doesNotMatch(config, /test-client-secret|private-refresh|owner@example/);
    const gmail = await worker.fetch(f.request('/api/gmail/labels', { headers: { Cookie: cookie } }), f.env); assert.equal(gmail.status, 200); assert.match(await gmail.text(), /newsletter-label/);
    const brief = await worker.fetch(f.request('/api/brief?date=2026-10-07', { headers: { Cookie: cookie } }), f.env); assert.equal(brief.status, 200);
    const forged = await worker.fetch(f.request('/api/gmail/labels', { headers: { Cookie: cookie, Origin: 'https://other.example' } }), f.env); assert.equal(forged.status, 403);
    const post = await worker.fetch(f.request('/api/brief', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: '{}' }), f.env); assert.equal(post.status, 403);
    assert.equal((await worker.fetch(f.request('/api/gmail/labels', { method: 'POST', headers: { Cookie: cookie } }), f.env)).status, 405);
  } finally { f.restore(); }
  const racing = fixture(); try {
    racing.expire(); const { cookie } = await racing.login();
    const pending = worker.fetch(racing.request('/api/auth/session', { headers: { Cookie: cookie } }), racing.env);
    while (!racing.calls.some(call => call.url === 'https://oauth2.googleapis.com/token' && new URLSearchParams(call.options.body).get('grant_type') === 'refresh_token')) await new Promise(resolve => setTimeout(resolve, 1));
    await worker.fetch(racing.request('/api/auth/logout', { method: 'POST', headers: { Cookie: cookie, Origin: base } }), racing.env);
    assert.equal((await pending).status, 401);
    assert.equal([...racing.data.keys()].filter(key => key.startsWith('session:')).length, 0, 'An in-flight refresh must not resurrect a signed-out session');
  } finally { racing.restore(); }
});
await test('expired access refreshes on the server; revoked grants require reconnection', async () => {
  const f = fixture(); try {
    f.expire(); const { cookie } = await f.login();
    const results = await Promise.all(Array.from({ length: 3 }, () => worker.fetch(f.request('/api/gmail/labels', { headers: { Cookie: cookie } }), f.env)));
    assert.ok(results.every(result => result.status === 200)); assert.equal(f.refreshed, 1, 'Parallel Gmail reads must share token renewal');
    assert.equal(f.calls.at(-1).options.headers.Authorization, 'Bearer renewed-access-token');
    assert.doesNotMatch([...f.data.values()].join(''), /renewed-access-token|private-refresh-token/);
  } finally { f.restore(); }
  const revoked = fixture(); try {
    revoked.expire(); const { cookie } = await revoked.login(); revoked.revoke();
    const result = await worker.fetch(revoked.request('/api/auth/session', { headers: { Cookie: cookie } }), revoked.env);
    assert.equal(result.status, 401); assert.ok(result.headers.get('Set-Cookie').includes('Max-Age=0'));
    assert.equal([...revoked.data.keys()].filter(key => key.startsWith('session:')).length, 0);
  } finally { revoked.restore(); }
});
await test('logout deletes the saved session and rejects cross-site mutations', async () => {
  const f = fixture(); try {
    const { cookie } = await f.login();
    const forged = await worker.fetch(f.request('/api/auth/logout', { method: 'POST', headers: { Cookie: cookie, Origin: 'https://other.example' } }), f.env); assert.equal(forged.status, 403);
    const missingOrigin = await worker.fetch(f.request('/api/auth/logout', { method: 'POST', headers: { Cookie: cookie } }), f.env); assert.equal(missingOrigin.status, 403);
    const logout = await worker.fetch(f.request('/api/auth/logout', { method: 'POST', headers: { Cookie: cookie, Origin: base } }), f.env);
    assert.equal(logout.status, 200); assert.ok(logout.headers.get('Set-Cookie').includes('Max-Age=0'));
    assert.equal((await worker.fetch(f.request('/api/auth/session', { headers: { Cookie: cookie } }), f.env)).status, 401);
    assert.equal((await worker.fetch(f.request('/api/gmail/labels', { headers: { Cookie: cookie } }), f.env)).status, 401);
    assert.equal(f.calls.some(call => String(call.url).includes('/revoke')), false);
  } finally { f.restore(); }
});
await test('wrong accounts, missing Gmail scope, forged state and tampered sessions cannot sign in', async () => {
  const f = fixture(); try {
    const state = await f.start();
    assert.equal((await worker.fetch(f.request('/api/auth/callback?code=x&state=' + state.state), f.env)).status, 403);
    f.wrongOwner(); assert.equal((await f.login()).result.status, 403);
    assert.equal([...f.data.keys()].filter(key => key.startsWith('session:')).length, 0);
  } finally { f.restore(); }
  const missing = fixture(); try { missing.removeScope(); assert.equal((await missing.login()).result.status, 403); } finally { missing.restore(); }
  const tampered = fixture(); try {
    const { cookie } = await tampered.login(); const sessionKey = [...tampered.data.keys()].find(key => key.startsWith('session:'));
    const value = JSON.parse(tampered.data.get(sessionKey)); value.ciphertext = 'invalid'; tampered.data.set(sessionKey, JSON.stringify(value));
    assert.equal((await worker.fetch(tampered.request('/api/auth/session', { headers: { Cookie: cookie } }), tampered.env)).status, 401);
    assert.equal((await worker.fetch(tampered.request('/api/gmail/https://evil.example/token', { headers: { Cookie: cookie } }), tampered.env)).status, 404);
  } finally { tampered.restore(); }
});
