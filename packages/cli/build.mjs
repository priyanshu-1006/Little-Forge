import { build } from 'esbuild';
import { chmod, copyFile, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const packageRoot = fileURLToPath(new URL('./', import.meta.url));
const outfile = path.join(packageRoot, 'dist', 'little-forge.cjs');
const manifest = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'));
const result = await build({
  absWorkingDir: root,
  entryPoints: ['packages/cli/src/index.ts'],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  banner: { js: '#!/usr/bin/env node' },
  define: { __LITTLE_FORGE_CLI_VERSION__: JSON.stringify(manifest.version) },
  legalComments: 'eof',
  metafile: true,
});
await chmod(outfile, 0o755);
await copyFile(path.join(root, 'LICENSE'), path.join(packageRoot, 'dist', 'LICENSE'));

const dependencyDirectories = new Set();
for (const input of Object.keys(result.metafile.inputs)) {
  const segments = input.split('/');
  const index = segments.lastIndexOf('node_modules');
  if (index < 0) continue;
  const end = index + (segments[index + 1].startsWith('@') ? 3 : 2);
  dependencyDirectories.add(segments.slice(0, end).join('/'));
}

const notices = ['Third-party licenses for packages bundled with Little Forge CLI.'];
for (const directory of [...dependencyDirectories].sort()) {
  const dependencyRoot = path.join(root, directory);
  const dependency = JSON.parse(await readFile(path.join(dependencyRoot, 'package.json'), 'utf8'));
  const licenses = (await readdir(dependencyRoot)).filter(name => /^(licen[cs]e|copying|notice)(\.|$)/i.test(name));
  notices.push(`===== ${dependency.name} ${dependency.version} (${dependency.license ?? 'see package notice'}) =====`);
  for (const name of licenses) notices.push(await readFile(path.join(dependencyRoot, name), 'utf8'));
  if (!licenses.length) notices.push(`Package reference: https://www.npmjs.com/package/${dependency.name}/v/${dependency.version}`);
}
await writeFile(path.join(packageRoot, 'dist', 'THIRD_PARTY_NOTICES.txt'), notices.join('\n\n') + '\n');
