import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import path from 'node:path';

// The separately installed harness owns model execution and local SQLite state.
const cli = fileURLToPath(new URL('../node_modules/@truefoundry/trueforge/dist/cli.js', import.meta.url));
const preload = new URL('./trueforge-preload.mjs', import.meta.url).href;
if (!existsSync(cli)) {
  console.error('Install this project first with npm ci. The pinned TrueForge harness dependency is missing.');
  process.exitCode = 1;
} else {
  let allowed = [];
  try { allowed = JSON.parse(process.env.OUTBOUND_URL_ALLOWED_HOSTS ?? '[]'); if (!Array.isArray(allowed) || allowed.some(host => typeof host !== 'string')) throw new Error(); }
  catch { throw new Error('OUTBOUND_URL_ALLOWED_HOSTS must be a JSON array of host names.'); }
  const child = spawn(process.execPath, ['--import', preload, cli, ...process.argv.slice(2)], { stdio: 'inherit', windowsHide: true, env: { ...process.env, HOST: '127.0.0.1', SQLITE_PATH: process.env.SQLITE_PATH ?? path.resolve('.trueforge', 'db.sqlite'), OUTBOUND_URL_ALLOWED_HOSTS: JSON.stringify([...new Set([...allowed, '127.0.0.1', 'localhost', '::1'])]) } });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
  child.once('error', error => { console.error(`TrueForge could not start: ${error.message}`); process.exitCode = 1; });
  child.once('exit', code => { process.exitCode = code ?? 1; });
}
