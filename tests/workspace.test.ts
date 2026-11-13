import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { Workspace, WORKSPACE_LIMITS } from '../src/core/workspace.js';
import { hash } from '../src/core/types.js';

async function fixture(t: { after(fn: () => Promise<void>): void }): Promise<{ root: string; workspace: Workspace; put(file: string, data: string | Buffer): Promise<void> }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'little-forge-workspace-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return { root, workspace: new Workspace(root), async put(file, data) { const absolute = path.join(root, file); await fs.mkdir(path.dirname(absolute), { recursive: true }); await fs.writeFile(absolute, data); } };
}

test('workspace reads exact UTF-8 bytes including BOM and exposes canonical hashes', async t => {
  const { workspace, put } = await fixture(t);
  const source = '\uFEFF# नमस्ते\nvalue = "café 😀"\n';
  await put('src/example.py', source);
  const snapshot = await workspace.read('src/example.py');
  assert.equal(snapshot.content, source);
  assert.equal(snapshot.hash, hash(Buffer.from(source)));
  assert.equal(snapshot.path, 'src/example.py');
  assert.equal(workspace.relative(await workspace.resolve('src/example.py')), 'src/example.py');
});

test('workspace denies credentials, generated paths, traversal, absolute paths and Windows aliases', async t => {
  const { workspace, put, root } = await fixture(t);
  for (const file of ['.env', '.env.local', '.envrc', 'credentials.json', 'src/private.key', 'node_modules/library/a.ts', 'dist/app.js', '.git/config']) await put(file, 'do not read');
  await put('src/safe.ts', 'export const value = 1;');
  for (const file of ['../outside', 'src/../safe.ts', path.join(root, 'src/safe.ts'), 'src/safe.ts:stream', 'src/CON.txt', ...['.env', '.env.local', '.envrc', 'credentials.json', 'src/private.key', 'node_modules/library/a.ts', 'dist/app.js', '.git/config']]) {
    await assert.rejects(workspace.resolve(file), error => (error as { code?: string }).code === 'WORKSPACE_POLICY');
  }
  assert.deepEqual((await workspace.list()).map(file => file.path), ['src/safe.ts']);
  assert.throws(() => workspace.relative(path.dirname(root)), /protected|permitted/);
});

test('root and nested ignore rules are honored freshly for reads, search and new files', async t => {
  const { workspace, put } = await fixture(t);
  await put('.gitignore', '*.tmp\nignored/\n');
  await put('src/.gitignore', 'hidden.py\n*.local\n!visible.local\n');
  await put('a.tmp', 'needle'); await put('ignored/file.py', 'needle');
  await put('src/hidden.py', 'needle'); await put('src/private.local', 'needle');
  await put('src/visible.local', 'needle'); await put('src/visible.py', 'needle');
  await assert.rejects(workspace.read('src/hidden.py'), /ignore rules/);
  await assert.rejects(workspace.resolve('ignored/new/file.py', true), /ignore rules/);
  const listed = (await workspace.list()).map(file => file.path);
  assert.ok(listed.includes('src/visible.local')); assert.ok(!listed.includes('src/private.local'));
  assert.deepEqual((await workspace.search('needle', '**/*.py')).map(hit => hit.path), ['src/visible.py']);
  await put('src/.gitignore', 'visible.py\n');
  await assert.rejects(workspace.read('src/visible.py'), /ignore rules/);
  assert.equal((await workspace.read('src/hidden.py')).content, 'needle');
});

test('creation resolves missing descendants without bypassing protected ancestors', async t => {
  const { workspace, root, put } = await fixture(t);
  assert.equal(await workspace.resolve('new/nested/file.py', true), path.join(root, 'new/nested/file.py'));
  await assert.rejects(workspace.resolve('new/nested/file.py'), error => (error as NodeJS.ErrnoException).code === 'ENOENT');
  await put('src/file.py', 'pass');
  await assert.rejects(workspace.resolve('src/file.py/child.py', true), /ancestor/);
  await assert.rejects(workspace.resolve('new/.env', true), /excluded/);
});

test('binary, invalid UTF-8 and oversized files never become source context', async t => {
  const { workspace, put } = await fixture(t);
  await put('binary.bin', Buffer.from([65, 0, 66]));
  await put('invalid.py', Buffer.from([0xc3, 0x28]));
  await put('big.py', Buffer.alloc(WORKSPACE_LIMITS.fileBytes + 1, 65));
  await assert.rejects(workspace.read('binary.bin'), /Binary/);
  await assert.rejects(workspace.read('invalid.py'), /UTF-8/);
  await assert.rejects(workspace.read('big.py'), /maximum/);
});

test('literal search includes RST/Markdown, honors globs and bounds lines/results', async t => {
  const { workspace, put } = await fixture(t);
  await put('docs/cli.rst', 'CLI command reference\nUse [a+b] literally.\n');
  await put('README.md', 'CLI overview\n'); await put('src/cli.py', 'CLI = 1\nCLI = 2\n');
  assert.equal((await workspace.search('[a+b]'))[0]?.path, 'docs/cli.rst');
  assert.deepEqual((await workspace.search('cli', 'docs/**/*.rst')).map(hit => hit.line), [1]);
  assert.equal((await workspace.search('cli', '**/*', 2)).length, 2);
  await assert.rejects(workspace.search('cli', '**/*', 101), /limit/);
});

test('already cancelled operations do no filesystem work', async t => {
  const { workspace } = await fixture(t);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(workspace.list(controller.signal), /cancelled/);
  await assert.rejects(workspace.read('missing.py', controller.signal), /cancelled/);
  await assert.rejects(workspace.search('value', '**/*', 5, controller.signal), /cancelled/);
});

test('inventory exposes truncation when its directory-depth bound omits descendants', async t => {
  const { workspace, put } = await fixture(t);
  await put('visible.py', 'safe');
  await put(Array(WORKSPACE_LIMITS.depth + 2).fill('d').join('/') + '/deep.py', 'not indexed');
  const files = await workspace.list();
  assert.ok(files.some(file => file.path === 'visible.py'));
  assert.ok(!files.some(file => file.path.endsWith('/deep.py')));
  assert.equal(workspace.listingTruncated, true);
});

test('hardlinked files cannot alias credentials or enter inventory', async t => {
  const { workspace, root, put } = await fixture(t);
  await put('.env', 'private value');
  try { await fs.link(path.join(root, '.env'), path.join(root, 'public.py')); }
  catch (error) { if (['EPERM', 'EACCES', 'ENOTSUP'].includes((error as NodeJS.ErrnoException).code ?? '')) return t.skip('Host does not support hard links.'); throw error; }
  await assert.rejects(workspace.read('public.py'), /Linked/);
  assert.deepEqual(await workspace.list(), []);
});

test('symlink/junction directories and root aliases cannot escape the workspace', async t => {
  const { workspace, root, put } = await fixture(t);
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'little-forge-outside-'));
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  await fs.writeFile(path.join(outside, 'outside.py'), 'private'); await put('src/a.py', 'safe');
  try { await fs.symlink(outside, path.join(root, 'alias'), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (['EPERM', 'EACCES', 'ENOTSUP'].includes((error as NodeJS.ErrnoException).code ?? '')) return t.skip('Host does not allow directory links.'); throw error; }
  await assert.rejects(workspace.read('alias/outside.py'), /Linked/);
  assert.ok(!(await workspace.list()).some(file => file.path.startsWith('alias/')));
  const aliasedRoot = new Workspace(path.join(root, 'alias'));
  await assert.rejects(aliasedRoot.list(), /real workspace directory/);
});
