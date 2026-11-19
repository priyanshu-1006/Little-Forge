import { build, context } from 'esbuild';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
await mkdir('dist', { recursive: true });
const options = [
  { entryPoints: ['src/extension.ts'], bundle: true, platform: 'node', target: 'node22', format: 'cjs', outfile: 'dist/extension.cjs', external: ['vscode'], sourcemap: true, logLevel: 'info', legalComments: 'eof', define: { navigator: 'undefined' }, metafile: true },
  { entryPoints: ['src/ui.js', 'src/ui.css'], bundle: true, platform: 'browser', target: 'es2022', format: 'iife', outdir: 'dist', loader: { '.svg': 'dataurl' }, logLevel: 'info', legalComments: 'eof', metafile: true }
];
if (process.argv.includes('--watch')) {
  const contexts = await Promise.all(options.map(config => context(config)));
  await Promise.all(contexts.map(ctx => ctx.watch()));
}
else {
  const results = await Promise.all(options.map(config => build(config)));
  const inputs = results.flatMap(result => Object.keys(result.metafile.inputs));
  const packages = new Set(inputs.filter(p => p.includes('node_modules/')).map(p => {
    const local = p.slice(p.lastIndexOf('node_modules/') + 13).split('/');
    return path.join('node_modules', ...(local[0].startsWith('@') ? local.slice(0, 2) : local.slice(0, 1)));
  }));
  let notices = 'Third-party licences for packages included in the extension bundle.\n';
  for (const directory of [...packages].sort()) {
    const pkg = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
    notices += `\n\n===== ${pkg.name} ${pkg.version} (${pkg.license ?? 'see package notice'}) =====\n`;
    const files = (await readdir(directory)).filter(f => /^(?:licen[cs]e|copying|notice)(?:\.|$)/i.test(f));
    for (const file of files) notices += `\n${await readFile(path.join(directory, file), 'utf8')}\n`;
    if (!files.length) notices += `Package reference: ${typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url ?? pkg.homepage ?? pkg.name}\n`;
  }
  await writeFile('dist/THIRD_PARTY_NOTICES.txt', notices);
}
