import { readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const configFile = resolve(root, 'wrangler.json');
const cli = resolve(root, 'node_modules/wrangler/bin/wrangler.js');
const prompt = createInterface({ input: process.stdin, output: process.stdout });
function wrangler(args, capture = false) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd: root, shell: false, stdio: capture ? ['inherit', 'pipe', 'inherit'] : 'inherit', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
    let output = '';
    if (capture) child.stdout.on('data', data => { output += data; process.stdout.write(data); });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolveRun(output) : reject(new Error(`Cloudflare command failed (${code}). Fix the error above and run npm run setup:hosted again.`)));
  });
}
try {
  let configText;
  try { configText = await readFile(configFile, 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; configText = await readFile(resolve(root, 'wrangler.example.json'), 'utf8'); }
  const config = JSON.parse(configText);
  console.log('\nSignal 1.7 — hosted setup\n');
  console.log('This publishes the app, AI backend and private report cache to your Cloudflare account.');
  console.log('Keep the Workers account on the Free plan. No paid API key or PC model is needed.');
  console.log(`Only ${config.vars.OWNER_EMAIL} will be allowed to generate or read reports.\n`);
  let clientId = config.vars.GOOGLE_CLIENT_ID;
  while (!/^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/.test(clientId)) {
    clientId = (await prompt.question('Paste your public Google OAuth client ID (from app Settings, not the client secret): ')).trim();
    if (!/^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/.test(clientId)) console.log('Use the client ID ending in .apps.googleusercontent.com.');
  }
  config.vars.GOOGLE_CLIENT_ID = clientId;
  await writeFile(configFile, JSON.stringify(config, null, 2) + '\n');
  prompt.close();
  console.log('\nSign in to Cloudflare in the browser that opens.');
  await wrangler(['login']);
  if (config.kv_namespaces[0].id === '00000000000000000000000000000000') {
    console.log('\nCreating your private report cache…');
    const output = await wrangler(['kv', 'namespace', 'create', config.name + '-reports', '--binding', 'REPORTS', '--update-config', 'false'], true);
    const id = output.match(/\bid["']?\s*[:=]\s*["']([a-f0-9]{32})["']/i)?.[1];
    if (!id) throw new Error('Cloudflare created the cache but its ID could not be read. Copy the printed namespace ID into wrangler.json, then run npm run deploy.');
    config.kv_namespaces[0].id = id;
    await writeFile(configFile, JSON.stringify(config, null, 2) + '\n');
  }
  console.log('\nPublishing Signal…');
  await wrangler(['deploy']);
  console.log('\nONE FINAL GOOGLE STEP: Copy the https://…workers.dev origin printed above.');
  console.log('Google Auth Platform → Clients → your Web application client → Authorised JavaScript origins → Add URI → paste that origin → Save.');
  console.log('Do not include a path or trailing slash. No redirect URI is needed. Allow a few minutes for Google to update.');
  console.log('\nOpen that HTTPS website on your phone, connect Gmail, then open Daily brief. Your PC can be off.');
} catch (error) {
  console.error('\n' + error.message);
  process.exitCode = 1;
} finally { prompt.close(); }
