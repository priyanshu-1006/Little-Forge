import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { Workspace } from '../src/core/workspace.js';
import { ContextEngine, retryContextOnChange } from '../src/core/context.js';

async function fixture(t: TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'little-forge-context-events-'));
  t.after(async () => { assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith('little-forge-context-events-')); await fs.rm(root, { recursive: true, force: true }); });
  const workspace = new Workspace(root), context = new ContextEngine(workspace);
  const absolute = (file: string) => path.join(root, file);
  const write = async (file: string, text: string) => { await fs.mkdir(path.dirname(absolute(file)), { recursive: true }); await fs.writeFile(absolute(file), text); };
  return { root, workspace, context, absolute, write };
}

test('Git, generated cache, ignored editor files and non-source assets do not interrupt indexing', async t => {
  const f = await fixture(t);
  await f.write('.gitignore', 'ignored/\n.vscode/\n');
  await f.write('src/app.py', 'def visible_function():\n    return 1\n');
  await f.write('assets/preview.png', 'not indexed');
  const read = f.workspace.read.bind(f.workspace);
  const handled: boolean[] = []; let fired = false;
  f.workspace.read = async (file, signal) => {
    const snapshot = await read(file, signal);
    if (file === 'src/app.py' && !fired) {
      fired = true;
      for (const noisy of ['.git/index', '.git/index.lock', '.cache/project/state.json', '__pycache__/app.pyc', 'ignored', 'ignored/ghost.py', 'ignored/.gitignore', '.vscode', '.vscode/settings.json', 'assets/preview.png']) handled.push(await f.context.handleFileEvent(f.absolute(noisy)));
    }
    return snapshot;
  };
  assert.deepEqual((await f.context.symbols()).map(symbol => symbol.name), ['visible_function']);
  assert.deepEqual(handled, Array(10).fill(false));
});

test('a permitted source change during indexing fails closed and the next scan uses fresh symbols', async t => {
  const f = await fixture(t); await f.write('src/app.py', 'def old_name():\n    return 1\n');
  const read = f.workspace.read.bind(f.workspace); let fired = false;
  f.workspace.read = async (file, signal) => {
    const snapshot = await read(file, signal);
    if (file === 'src/app.py' && !fired) {
      fired = true;
      await f.write(file, 'def new_name():\n    return 2\n');
      // Do not await this notification: commit must still wait for in-flight policy classification.
      void f.context.handleFileEvent(f.absolute(file));
    }
    return snapshot;
  };
  await assert.rejects(f.context.symbols(), /context changed during indexing/);
  assert.deepEqual((await f.context.symbols()).map(symbol => symbol.name), ['new_name']);
});

test('permitted source creation and deletion invalidate cached symbol inventory', async t => {
  const f = await fixture(t); await f.write('src/app.py', 'def existing():\n    pass\n');
  assert.deepEqual((await f.context.symbols()).map(symbol => symbol.name), ['existing']);
  await f.write('src/created.py', 'def created():\n    pass\n');
  assert.equal(await f.context.handleFileEvent(f.absolute('src/created.py')), true);
  assert.deepEqual((await f.context.symbols()).map(symbol => symbol.name).sort(), ['created', 'existing']);
  await fs.unlink(f.absolute('src/created.py'));
  assert.equal(await f.context.handleFileEvent(f.absolute('src/created.py')), true);
  assert.deepEqual((await f.context.symbols()).map(symbol => symbol.name), ['existing']);
});

test('run context retries a transient invalidation and returns the new source', async t => {
  const f = await fixture(t);
  await f.write('src/app.py', 'def old_name():\n    return 1\n');
  const read = f.workspace.read.bind(f.workspace);
  let changed = false;
  f.workspace.read = async (file, signal) => {
    const snapshot = await read(file, signal);
    if (file === 'src/app.py' && !changed) {
      changed = true;
      await f.write(file, 'def new_function_name():\n    return 2\n');
      await f.context.handleFileEvent(f.absolute(file));
    }
    return snapshot;
  };
  const context = await retryContextOnChange(() => f.context.retrieve('new function name', 6000));
  assert.match(context.chunks[0].content, /def new_function_name/);
  assert.doesNotMatch(context.chunks[0].content, /def old_name/);
});

test('new nested ignore policies invalidate a running scan and remove now-excluded symbols', async t => {
  for (const policy of ['.gitignore', '.littleignore', '.littleforgeignore']) {
    const f = await fixture(t); await f.write('src/app.py', 'def now_private():\n    pass\n');
    const read = f.workspace.read.bind(f.workspace); let fired = false;
    f.workspace.read = async (file, signal) => {
      const snapshot = await read(file, signal);
      if (file === 'src/app.py' && !fired) {
        fired = true; await f.write(`src/${policy}`, '*.py\n');
        assert.equal(await f.context.handleFileEvent(f.absolute(`src/${policy}`)), true);
      }
      return snapshot;
    };
    await assert.rejects(f.context.symbols(), /context changed during indexing/);
    assert.ok(!(await f.context.symbols()).some(symbol => symbol.name === 'now_private'));
  }
});

test('policy files ignored by their own parent rules still invalidate through their permitted parent', async t => {
  const f = await fixture(t); await f.write('.gitignore', '.littleforgeignore\n');
  await f.write('src/app.py', 'def public_before_policy():\n    pass\n');
  assert.ok((await f.context.symbols()).some(symbol => symbol.name === 'public_before_policy'));
  await f.write('.littleforgeignore', 'src/*.py\n');
  assert.equal(await f.context.handleFileEvent(f.absolute('.littleforgeignore')), true);
  assert.ok(!(await f.context.symbols()).some(symbol => symbol.name === 'public_before_policy'));
  await fs.unlink(f.absolute('.littleforgeignore'));
  assert.equal(await f.context.handleFileEvent(f.absolute('.littleforgeignore')), true);
  assert.ok((await f.context.symbols()).some(symbol => symbol.name === 'public_before_policy'));
});

test('fresh inventory catches a real source edit even without a watcher notification', async t => {
  const f = await fixture(t); await f.write('src/app.py', 'def before_change():\n    pass\n');
  const read = f.workspace.read.bind(f.workspace); let fired = false;
  f.workspace.read = async (file, signal) => {
    const snapshot = await read(file, signal);
    if (file === 'src/app.py' && !fired) { fired = true; await f.write(file, 'def a_new_function_after_change():\n    pass\n'); }
    return snapshot;
  };
  await assert.rejects(f.context.symbols(), /context changed during indexing/);
  assert.deepEqual((await f.context.symbols()).map(symbol => symbol.name), ['a_new_function_after_change']);
});

test('cancellation interrupts pending watcher checks without returning partial context', async t => {
  const f = await fixture(t); await f.write('.gitignore', 'ignored/\n'); await f.write('app.py', 'def visible():\n    pass\n');
  const resolve = f.workspace.resolve.bind(f.workspace);
  let release!: () => void;
  const barrier = new Promise<void>(done => { release = done; });
  f.workspace.resolve = async (file, create) => { if (file === 'ignored/ghost.py') await barrier; return resolve(file, create); };
  const event = f.context.handleFileEvent(f.absolute('ignored/ghost.py'));
  const controller = new AbortController(), pending = f.context.symbols('', controller.signal);
  controller.abort(); await assert.rejects(pending, /cancelled/);
  release(); assert.equal(await event, false);
  assert.deepEqual((await f.context.symbols()).map(symbol => symbol.name), ['visible']);
});

test('concurrent context callers share an index build rather than publishing competing scans', async t => {
  const f = await fixture(t); await f.write('app.py', 'def visible():\n    pass\n');
  const read = f.workspace.read.bind(f.workspace); let reads = 0;
  f.workspace.read = async (file, signal) => { if (file === 'app.py') reads++; return read(file, signal); };
  const results = await Promise.all([f.context.symbols(), f.context.symbols(), f.context.symbols()]);
  assert.ok(results.every(symbols => symbols[0]?.name === 'visible')); assert.equal(reads, 1);
});
