import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const npm = process.env.npm_execpath;
if (!npm) throw new Error('Run npm --prefix packages/cli run release:prepare from the repository root.');

const root = fileURLToPath(new URL('../../', import.meta.url));
const packageRoot = fileURLToPath(new URL('./', import.meta.url));
const manifest = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'));
const releaseRoot = path.join(root, 'output', 'npm-release', manifest.version);
await mkdir(releaseRoot, { recursive: true });

// Build once so the release and website use the same byte-for-byte tarball.
await import('./build.mjs');
const pack = spawnSync(process.execPath, [npm, 'pack', '--ignore-scripts', '--json', '--pack-destination', releaseRoot], {
  cwd: packageRoot,
  encoding: 'utf8',
  windowsHide: true,
});
if (pack.error) throw pack.error;
if (pack.status !== 0) throw new Error(pack.stderr.trim() || 'npm pack failed.');

const [archive] = JSON.parse(pack.stdout);
const expected = new Set(['package.json', 'README.md', ...manifest.files]);
if (archive?.name !== manifest.name || archive.version !== manifest.version || archive.filename !== path.basename(archive.filename)
    || archive.files.length !== expected.size || !archive.files.every(file => expected.delete(file.path))) {
  throw new Error('The packed CLI does not match the release manifest.');
}

const artifact = path.join(releaseRoot, archive.filename);
const bytes = await readFile(artifact);
const sha256 = createHash('sha256').update(bytes).digest('hex');
await writeFile(path.join(releaseRoot, 'SHA256SUMS.txt'), sha256 + '  ' + archive.filename + '\n');

const site = path.join(root, 'website');
const downloads = path.join(site, 'public', 'downloads');
await mkdir(downloads, { recursive: true });
await copyFile(artifact, path.join(downloads, archive.filename));
const release = { version: manifest.version, filename: archive.filename, file: '/downloads/' + archive.filename, bytes: bytes.length, sha256 };
await writeFile(path.join(site, 'src', 'data', 'cli-release.json'), JSON.stringify(release, null, 2) + '\n');

console.log(path.relative(root, artifact));
console.log('SHA-256 ' + sha256);
