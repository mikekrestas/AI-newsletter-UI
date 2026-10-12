import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repository = 'mikekrestas/AI-newsletter-UI';

export function releaseCredentials(env) {
  if (env.GITHUB_ACTIONS !== 'true' || env.GITHUB_REPOSITORY !== repository || env.GITHUB_REF !== 'refs/heads/main' ||
      !['push', 'workflow_dispatch'].includes(env.GITHUB_EVENT_NAME)) {
    throw new Error('Automatic production deployment only runs for main in the Signal GitHub repository. Use npm run deploy for a local release.');
  }
  const token = env.CLOUDFLARE_API_TOKEN?.trim(), accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim();
  if (!token || !accountId) throw new Error('Add CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID as GitHub Actions repository secrets. See DEPLOYMENT.md.');
  if (!/^[a-f0-9]{32}$/i.test(accountId)) throw new Error('CLOUDFLARE_ACCOUNT_ID must be the 32-character Cloudflare account ID, not a zone ID or email address.');
  return { token, accountId };
}

export async function readWorkerSettings(accountId, token, name, request = fetch) {
  let response;
  try {
    response = await request(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${encodeURIComponent(name)}/settings`, {
      headers: { Authorization: 'Bearer ' + token }, redirect: 'error', signal: AbortSignal.timeout(20000)
    });
  } catch { throw new Error('Could not contact Cloudflare to read the existing Worker. Nothing was deployed.'); }
  // Do not echo provider bodies: errors must never disclose credentials/settings.
  if (!response.ok) throw new Error(`Could not read the existing Worker (HTTP ${response.status}). Check the token permissions and account ID. Nothing was deployed.`);
  let data;
  try { data = await response.json(); } catch { throw new Error('Cloudflare returned invalid Worker settings. Nothing was deployed.'); }
  if (data.success !== true || !Array.isArray(data.result?.bindings)) throw new Error('Cloudflare did not return the existing Worker bindings. Nothing was deployed.');
  return data.result;
}

export function deploymentConfig(template, settings, accountId, rootDir = root) {
  const bindings = new Map();
  for (const binding of settings.bindings) {
    if (!binding || typeof binding.name !== 'string' || bindings.has(binding.name)) throw new Error('The live Worker has invalid or duplicate bindings. Nothing was deployed.');
    const preserved = ['plain_text', 'json', 'secret_text', 'secret_key'].includes(binding.type);
    const supported = { AI: 'ai', REPORTS: 'kv_namespace', ASSETS: 'assets' }[binding.name] === binding.type;
    if (!preserved && !supported) throw new Error('The live Worker has an unsupported binding. Update the deployment helper before releasing so it is not removed.');
    bindings.set(binding.name, binding);
  }
  const value = name => { const binding = bindings.get(name); return binding?.type === 'plain_text' ? binding.text : binding?.type === 'json' ? binding.json : undefined; };
  if (typeof value('OWNER_EMAIL') !== 'string' || value('OWNER_EMAIL').trim().toLowerCase() !== template.vars.OWNER_EMAIL.toLowerCase() ||
      typeof value('GOOGLE_CLIENT_ID') !== 'string' || !/^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/.test(value('GOOGLE_CLIENT_ID'))) {
    throw new Error('The existing Worker owner or Google client configuration is missing or does not match Signal. Nothing was deployed.');
  }
  const cache = bindings.get('REPORTS');
  if (cache?.type !== 'kv_namespace' || !/^[a-f0-9]{32}$/i.test(cache.namespace_id) || /^0+$/.test(cache.namespace_id) ||
      bindings.get('AI')?.type !== 'ai' || bindings.get('ASSETS')?.type !== 'assets') {
    throw new Error('The existing REPORTS cache, AI or ASSETS binding is missing. Nothing was deployed; no new resources were created.');
  }
  for (const name of ['GOOGLE_CLIENT_SECRET', 'SESSION_ENCRYPTION_KEY']) {
    if (bindings.get(name)?.type !== 'secret_text') throw new Error('The existing persistent Gmail secrets are missing. Fix the live Worker before releasing; secrets were not changed.');
  }
  const config = structuredClone(template);
  delete config.$schema; delete config.vars;
  config.account_id = accountId;
  config.main = resolve(rootDir, template.main);
  config.assets.directory = resolve(rootDir, template.assets.directory);
  config.kv_namespaces = [{ binding: 'REPORTS', id: cache.namespace_id }];
  config.keep_vars = true;
  if (settings.compatibility_flags) config.compatibility_flags = settings.compatibility_flags;
  return config;
}

function runWrangler(configPath, { env, rootDir }) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [resolve(rootDir, 'node_modules/wrangler/bin/wrangler.js'), 'deploy', '--config', configPath, '--keep-vars'], {
      cwd: rootDir, shell: false, stdio: 'inherit', env: { ...env, WRANGLER_SEND_METRICS: 'false', CI: 'true' }
    });
    child.on('error', () => reject(new Error('Could not start Wrangler. Install dependencies with npm ci.')));
    child.on('close', code => code === 0 ? resolveRun() : reject(new Error(`Cloudflare deployment failed (exit code ${code}). Check the Deploy Signal workflow log.`)));
  });
}

export async function deployRelease({ env = process.env, request = fetch, run = runWrangler, rootDir = root } = {}) {
  const { accountId, token } = releaseCredentials(env);
  const template = JSON.parse(await readFile(resolve(rootDir, 'wrangler.example.json'), 'utf8'));
  const settings = await readWorkerSettings(accountId, token, template.name, request);
  const config = deploymentConfig(template, settings, accountId, rootDir);
  // Keep the owner's ignored wrangler.json intact; this temporary config uses
  // the live cache ID. --keep-vars preserves all server variables, and Wrangler
  // 4.148.0 inherits unchanged secret bindings by default during upload.
  await mkdir(resolve(rootDir, '.wrangler'), { recursive: true });
  const temporary = await mkdtemp(join(rootDir, '.wrangler', 'release-'));
  try {
    const path = join(temporary, 'wrangler.json');
    await writeFile(path, JSON.stringify(config, null, 2), { mode: 0o600 });
    await run(path, { env, rootDir });
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  deployRelease().catch(error => { console.error(error.message); process.exitCode = 1; });
}
