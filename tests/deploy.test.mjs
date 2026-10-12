import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, writeFile, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { releaseCredentials, readWorkerSettings, deploymentConfig, deployRelease } from '../scripts/deploy-ci.mjs';

const template = JSON.parse(await readFile(new URL('../wrangler.example.json', import.meta.url), 'utf8'));
const accountId = 'a'.repeat(32), namespaceId = 'b'.repeat(32), token = 'private-cloudflare-token';
const env = { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'mikekrestas/AI-newsletter-UI', GITHUB_REF: 'refs/heads/main', GITHUB_EVENT_NAME: 'push', CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: accountId };
const settings = () => ({ compatibility_flags: ['nodejs_compat'], bindings: [
  { name: 'OWNER_EMAIL', type: 'plain_text', text: template.vars.OWNER_EMAIL },
  { name: 'GOOGLE_CLIENT_ID', type: 'plain_text', text: 'matching-client.apps.googleusercontent.com' },
  { name: 'NEWSLETTER_LABEL', type: 'plain_text', text: 'My existing newsletter label' },
  { name: 'ANOTHER_VARIABLE', type: 'json', json: { preserved: true } },
  { name: 'AI', type: 'ai' }, { name: 'ASSETS', type: 'assets' },
  { name: 'REPORTS', type: 'kv_namespace', namespace_id: namespaceId },
  { name: 'GOOGLE_CLIENT_SECRET', type: 'secret_text', text: 'private-google-secret' },
  { name: 'SESSION_ENCRYPTION_KEY', type: 'secret_text', text: 'private-encryption-key' }
] });
const response = value => Response.json({ success: true, result: value });

await test('only main pushes/manual runs in the canonical repo may deploy; credentials are checked without echoing them', () => {
  assert.deepEqual(releaseCredentials(env), { accountId, token });
  assert.ok(releaseCredentials({ ...env, GITHUB_EVENT_NAME: 'workflow_dispatch' }));
  for (const change of [
    { GITHUB_ACTIONS: '' }, { GITHUB_REF: 'refs/heads/codex/test' }, { GITHUB_EVENT_NAME: 'pull_request' },
    { GITHUB_EVENT_NAME: 'pull_request_target' }, { GITHUB_REPOSITORY: 'fork/AI-newsletter-UI' },
    { CLOUDFLARE_API_TOKEN: '' }, { CLOUDFLARE_ACCOUNT_ID: token }
  ]) {
    assert.throws(() => releaseCredentials({ ...env, ...change }), error => !error.message.includes(token));
  }
});

await test('fetch only the named existing Worker; API/network errors do not expose tokens or response bodies', async () => {
  const result = await readWorkerSettings(accountId, token, template.name, async (url, options) => {
    assert.equal(url, `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/signal-ai-newsletters/settings`);
    assert.equal(options.headers.Authorization, 'Bearer ' + token); assert.equal(options.redirect, 'error');
    return response(settings());
  });
  assert.equal(result.bindings.find(binding => binding.name === 'REPORTS').namespace_id, namespaceId);
  for (const request of [
    async () => new Response(token + ' private-google-secret', { status: 403 }),
    async () => { throw new Error(token); },
    async () => Response.json({ success: false, errors: [{ message: token }] }),
    async () => new Response('Invalid provider JSON: ' + token),
    async () => response({})
  ]) await assert.rejects(readWorkerSettings(accountId, token, template.name, request), error => !/private-cloudflare|private-google|Invalid provider JSON/.test(error.message));
});

await test('configuration reuses the exact live cache, preserves server variables/secrets and uses this checkout', () => {
  const before = JSON.stringify(template), config = deploymentConfig(template, settings(), accountId, '/tmp/checked-out-signal');
  assert.equal(config.name, 'signal-ai-newsletters'); assert.equal(config.account_id, accountId);
  assert.equal(config.keep_vars, true); assert.equal(Object.hasOwn(config, 'vars'), false);
  assert.deepEqual(config.kv_namespaces, [{ binding: 'REPORTS', id: namespaceId }]);
  assert.equal(config.main, '/tmp/checked-out-signal/worker.mjs'); assert.equal(config.assets.directory, '/tmp/checked-out-signal/public');
  assert.deepEqual(config.assets.run_worker_first, ['/api/*']); assert.deepEqual(config.compatibility_flags, ['nodejs_compat']);
  assert.doesNotMatch(JSON.stringify(config), /private-cloudflare|private-google|private-encryption|matching-client|00000000000000000000000000000000/);
  assert.equal(JSON.stringify(template), before);
});

await test('wrong owners, missing auth/resources and unfamiliar bindings stop before anything can be overwritten', () => {
  for (const change of [
    data => { data.bindings.find(binding => binding.name === 'OWNER_EMAIL').text = 'another-owner@example.com'; },
    data => { data.bindings.find(binding => binding.name === 'GOOGLE_CLIENT_ID').text = ''; },
    data => { data.bindings.find(binding => binding.name === 'REPORTS').namespace_id = '0'.repeat(32); },
    data => { data.bindings.find(binding => binding.name === 'REPORTS').namespace_id = 'invalid-id'; },
    ...['AI', 'ASSETS', 'REPORTS', 'GOOGLE_CLIENT_SECRET', 'SESSION_ENCRYPTION_KEY'].map(name => data => { data.bindings = data.bindings.filter(binding => binding.name !== name); }),
    data => { data.bindings.push({ name: 'NEW_DATABASE', type: 'd1', id: 'do-not-drop-this' }); },
    data => { data.bindings.push({ name: 'OWNER_EMAIL', type: 'plain_text', text: template.vars.OWNER_EMAIL }); }
  ]) {
    const data = settings(); change(data);
    assert.throws(() => deploymentConfig(template, data, accountId));
  }
});

await test('temporary configuration is private and cleaned up; the ignored local configuration stays untouched', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'signal-deploy-test-')); let temporaryFile;
  try {
    await writeFile(join(directory, 'wrangler.example.json'), JSON.stringify(template));
    await writeFile(join(directory, 'wrangler.json'), 'existing owner configuration');
    await deployRelease({ env, rootDir: directory, request: async () => response(settings()), run: async (path, options) => {
      temporaryFile = path; assert.equal(options.env.CLOUDFLARE_API_TOKEN, token);
      assert.equal((await stat(path)).mode & 0o777, 0o600);
      const config = JSON.parse(await readFile(path, 'utf8'));
      assert.equal(config.kv_namespaces[0].id, namespaceId); assert.equal(config.keep_vars, true);
    } });
    await assert.rejects(stat(temporaryFile), { code: 'ENOENT' });
    assert.equal(await readFile(join(directory, 'wrangler.json'), 'utf8'), 'existing owner configuration');
    await assert.rejects(deployRelease({ env, rootDir: directory, request: async () => response(settings()), run: async path => { temporaryFile = path; throw new Error('Wrangler failed'); } }), /Wrangler failed/);
    await assert.rejects(stat(temporaryFile), { code: 'ENOENT' });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

await test('invalid live state or missing credentials never invoke the deployment command', async () => {
  let started = false;
  for (const configuration of [
    { env: { ...env, CLOUDFLARE_API_TOKEN: '' } },
    { request: async () => new Response('Not allowed', { status: 403 }) },
    { request: async () => { const data = settings(); data.bindings = []; return response(data); } }
  ]) await assert.rejects(deployRelease({ env, request: async () => response(settings()), run: async () => { started = true; }, ...configuration }));
  assert.equal(started, false);
});
