import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = resolve(root, 'node_modules/wrangler/bin/wrangler.js');
function run(args, { input, capture = false } = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd: root, shell: false, env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, stdio: [input === undefined ? 'inherit' : 'pipe', capture ? 'pipe' : 'inherit', 'inherit'] });
    let output = ''; if (capture) child.stdout.on('data', data => { output += data; });
    if (input !== undefined) child.stdin.end(input);
    child.on('error', reject); child.on('close', code => code === 0 ? resolveRun(output) : reject(new Error('Cloudflare setup failed. If login expired, run npx wrangler login, then retry npm run setup:session.')));
  });
}
try {
  const config = JSON.parse(await readFile(resolve(root, 'wrangler.json'), 'utf8'));
  if (!config.vars?.GOOGLE_CLIENT_ID || config.kv_namespaces?.[0]?.id === '00000000000000000000000000000000') throw new Error('Copy your existing active wrangler.json into this folder first. This setup preserves your hosted app and cache.');
  const names = JSON.parse(await run(['secret', 'list'], { capture: true })).map(secret => secret.name);
  if (!names.includes('GOOGLE_CLIENT_SECRET')) {
    console.log('Paste the client secret for your existing Google Web application when Wrangler asks. Do not paste it into chat, app Settings, or a repository file.');
    await run(['secret', 'put', 'GOOGLE_CLIENT_SECRET']);
  }
  if (!names.includes('SESSION_ENCRYPTION_KEY')) {
    await run(['secret', 'put', 'SESSION_ENCRYPTION_KEY'], { input: randomBytes(32).toString('base64url') });
  }
  console.log('Persistent sign-in secrets are ready. Existing encryption keys were preserved.');
  console.log('Add https://signal-ai-newsletters.ai-newsletter-ui.workers.dev/api/auth/callback as an Authorised redirect URI in your Google Web application client.');
  console.log('Run npm run deploy, open the site and connect once. Use Production OAuth status for long-lived refresh tokens; Testing grants normally expire after seven days.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
