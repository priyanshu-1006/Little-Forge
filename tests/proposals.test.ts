import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test, { type TestContext } from 'node:test';
import { ProposalManager } from '../src/core/proposals.js';
import { hash, type Proposal } from '../src/core/types.js';
import { Workspace } from '../src/core/workspace.js';

async function fixture(t: TestContext, entries: Record<string, string> = { 'a.ts': 'one\nkeep\nthree\n' }) {
  const base = await fs.mkdtemp(path.join(tmpdir(), 'little-forge-proposals-'));
  const root = path.join(base, 'workspace');
  const storage = path.join(base, 'private-checkpoints');
  await fs.mkdir(root);
  for (const [name, content] of Object.entries(entries)) { await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true }); await fs.writeFile(path.join(root, name), content); }
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(base)), path.resolve(tmpdir()));
    assert.ok(path.basename(base).startsWith('little-forge-proposals-'));
    await fs.rm(base, { recursive: true, force: true });
  });
  const workspace = new Workspace(root);
  return { root, storage, workspace, manager: new ProposalManager(workspace, storage), read: (name: string) => fs.readFile(path.join(root, name), 'utf8') };
}
function accept(manager: ProposalManager, proposal: Proposal): void { for (const file of proposal.files) for (const hunk of file.hunks) manager.decide(proposal.id, hunk.id, 'accept'); }

test('staging and independent hunk decisions never write source; originals are defensive snapshots', async t => {
  const f = await fixture(t);
  const original = await f.read('a.ts');
  const proposal = await f.manager.stage([{ path: 'a.ts', beforeHash: hash(original), content: 'ONE\nkeep\nTHREE\n' }], 'run');
  assert.equal(proposal.files[0].hunks.length, 2);
  const [first, second] = proposal.files[0].hunks;
  f.manager.decide(proposal.id, first.id, 'accept');
  f.manager.decide(proposal.id, second.id, 'reject');
  assert.equal(f.manager.preview(proposal.id, 'a.ts'), 'ONE\nkeep\nthree\n');
  proposal.files[0].original = 'tampered';
  assert.equal(f.manager.get(proposal.id).files[0].original, original);
  assert.equal(await f.read('a.ts'), original);
  assert.deepEqual(await f.manager.checkpoints(), []);
  f.manager.authorize(proposal.id, 'run', 'call');
  const result = await f.manager.apply(proposal.id, 'run', 'call');
  assert.equal(result.status, 'applied');
  assert.equal(await f.read('a.ts'), 'ONE\nkeep\nthree\n');
  assert.ok(result.checkpointId);
  assert.deepEqual(await f.manager.undo(result.checkpointId), { restored: ['a.ts'], conflicts: [] });
  assert.equal(await f.read('a.ts'), original);
});

test('undecided hunks and mismatched grants cannot apply; changed choices invalidate approval', async t => {
  const f = await fixture(t);
  const proposal = await f.manager.stage([{ path: 'a.ts', beforeHash: hash(await f.read('a.ts')), content: 'changed\n' }], 'run');
  assert.throws(() => f.manager.authorize(proposal.id, 'run', 'call'), /every hunk/);
  accept(f.manager, proposal);
  await assert.rejects(f.manager.apply(proposal.id, 'run', 'call'), /host approval/);
  f.manager.authorize(proposal.id, 'run', 'call');
  await assert.rejects(f.manager.apply(proposal.id, 'wrong-run', 'call'), /host approval/);
  await assert.rejects(f.manager.apply(proposal.id, 'run', 'wrong-call'), /host approval/);
  f.manager.decide(proposal.id, proposal.files[0].hunks[0].id, 'reject');
  await assert.rejects(f.manager.apply(proposal.id, 'run', 'call'), /host approval/);
  assert.equal(await f.read('a.ts'), 'one\nkeep\nthree\n');
});

test('all rejected hunks produce no writes and no checkpoint', async t => {
  const f = await fixture(t);
  const original = await f.read('a.ts');
  const p = await f.manager.stage([{ path: 'a.ts', beforeHash: hash(original), content: 'new\n' }], 'run');
  for (const file of p.files) for (const hunk of file.hunks) f.manager.decide(p.id, hunk.id, 'reject');
  f.manager.authorize(p.id, 'run', 'call');
  assert.deepEqual(await f.manager.apply(p.id, 'run', 'call'), { status: 'rejected', paths: [] });
  assert.equal(await f.read('a.ts'), original);
  assert.deepEqual(await f.manager.checkpoints(), []);
});

test('fresh before hashes and unique paths are required at staging', async t => {
  const f = await fixture(t);
  await assert.rejects(f.manager.stage([{ path: 'a.ts', beforeHash: hash('old'), content: 'new' }], 'run'), /Stale source/);
  await assert.rejects(f.manager.stage([{ path: 'a.ts', beforeHash: null, content: 'overwrite' }], 'run'), /Stale source/);
  await assert.rejects(f.manager.stage([{ path: 'new.ts', beforeHash: null, content: null }], 'run'), /does not exist/);
  const content = await f.read('a.ts');
  await assert.rejects(f.manager.stage([{ path: 'a.ts', beforeHash: hash(content), content: 'new' }, { path: 'a.ts', beforeHash: hash(content), content: 'other' }], 'run'), /duplicate/);
});

test('a stale file expires an approved proposal without overwriting later user changes', async t => {
  const f = await fixture(t);
  const p = await f.manager.stage([{ path: 'a.ts', beforeHash: hash(await f.read('a.ts')), content: 'model' }], 'run');
  accept(f.manager, p);
  f.manager.authorize(p.id, 'run', 'call');
  await fs.writeFile(path.join(f.root, 'a.ts'), 'user edit');
  await assert.rejects(f.manager.apply(p.id, 'run', 'call'), /Source changed/);
  assert.equal(await f.read('a.ts'), 'user edit');
  assert.equal(f.manager.get(p.id).state, 'expired');
  await assert.rejects(f.manager.apply(p.id, 'run', 'call'), /no longer active/);
});

test('inline scope uses UTF-16 offsets and rejects edits outside the original selection', async t => {
  const text = '😀 prefix selected suffix\n';
  const f = await fixture(t, { 'a.ts': text });
  const scope = { path: 'a.ts', hash: hash(text), start: text.indexOf('selected'), end: text.indexOf('selected') + 'selected'.length };
  const p = await f.manager.stage([{ path: 'a.ts', beforeHash: hash(text), content: text.replace('selected', 'replacement') }], 'run', scope);
  assert.equal(p.files[0].hunks[0].start, scope.start);
  assert.equal(f.manager.preview(p.id, 'a.ts'), '😀 prefix replacement suffix\n');
  await assert.rejects(f.manager.stage([{ path: 'a.ts', beforeHash: hash(text), content: text.replace('prefix', 'changed').replace('selected', 'replacement') }], 'run', scope), /outside the selected/);
  await assert.rejects(f.manager.stage([{ path: 'a.ts', beforeHash: hash(text), content: null }], 'run', scope), /selection scope/);
});

test('a pre-cancelled or discarded run cannot write, authorize, or stage again', async t => {
  const f = await fixture(t);
  const original = await f.read('a.ts');
  const p = await f.manager.stage([{ path: 'a.ts', beforeHash: hash(original), content: 'new' }], 'run');
  accept(f.manager, p);
  f.manager.authorize(p.id, 'run', 'call');
  const controller = new AbortController(); controller.abort();
  await assert.rejects(f.manager.apply(p.id, 'run', 'call', controller.signal), /cancelled/);
  f.manager.discardRun('run');
  assert.throws(() => f.manager.authorize(p.id, 'run', 'call'), /no longer active/);
  await assert.rejects(f.manager.stage([{ path: 'a.ts', beforeHash: hash(original), content: 'new' }], 'run'), /no longer active/);
  assert.equal(await f.read('a.ts'), original);
});

test('cancellation between multi-file writes rolls back completed writes', async t => {
  const f = await fixture(t, { 'a.ts': 'a', 'b.ts': 'b' });
  const controller = new AbortController();
  const manager = new ProposalManager(f.workspace, f.storage, { assertWritable(paths) { if (paths.length === 1 && paths[0] === 'b.ts') controller.abort(); } });
  const p = await manager.stage([{ path: 'a.ts', beforeHash: hash('a'), content: 'A' }, { path: 'b.ts', beforeHash: hash('b'), content: 'B' }], 'run');
  accept(manager, p); manager.authorize(p.id, 'run', 'call');
  await assert.rejects(manager.apply(p.id, 'run', 'call', controller.signal), /cancelled.*rolled back/);
  assert.equal(await f.read('a.ts'), 'a'); assert.equal(await f.read('b.ts'), 'b');
  assert.equal((await manager.checkpoints())[0].state, 'rolled-back');
  assert.deepEqual((await fs.readdir(f.root)).sort(), ['a.ts', 'b.ts']);
});

test('rollback preserves external changes and exposes a recoverable conflict', async t => {
  const f = await fixture(t, { 'a.ts': 'a', 'b.ts': 'b' });
  const manager = new ProposalManager(f.workspace, f.storage, { async assertWritable(paths) {
    if (paths.length === 1 && paths[0] === 'b.ts') { await fs.writeFile(path.join(f.root, 'a.ts'), 'later user edit'); throw new Error('Fixture failure'); }
  } });
  const p = await manager.stage([{ path: 'a.ts', beforeHash: hash('a'), content: 'A' }, { path: 'b.ts', beforeHash: hash('b'), content: 'B' }], 'run');
  accept(manager, p); manager.authorize(p.id, 'run', 'call');
  await assert.rejects(manager.apply(p.id, 'run', 'call'), /Recovery conflicts: a.ts/);
  assert.equal(await f.read('a.ts'), 'later user edit'); assert.equal(await f.read('b.ts'), 'b');
  assert.equal((await manager.checkpoints())[0].state, 'rollback-conflict');
});

test('creation, empty files and deletion are undoable after restarting the manager', async t => {
  const f = await fixture(t, { 'a.ts': 'original' });
  const p = await f.manager.stage([{ path: 'a.ts', beforeHash: hash('original'), content: null }, { path: 'new/nested.ts', beforeHash: null, content: 'created' }, { path: 'empty.ts', beforeHash: null, content: '' }], 'run');
  accept(f.manager, p); f.manager.authorize(p.id, 'run', 'call');
  const result = await f.manager.apply(p.id, 'run', 'call');
  assert.equal(await f.read('new/nested.ts'), 'created'); assert.equal(await f.read('empty.ts'), '');
  await assert.rejects(f.read('a.ts'), { code: 'ENOENT' });
  const restarted = new ProposalManager(f.workspace, f.storage);
  assert.equal((await restarted.checkpoints())[0].state, 'applied');
  assert.deepEqual((await restarted.undo(result.checkpointId!)).conflicts, []);
  assert.equal(await f.read('a.ts'), 'original');
  assert.deepEqual(await fs.readdir(f.root), ['a.ts']);
  assert.deepEqual(await restarted.undo(result.checkpointId!), { restored: [], conflicts: [] });
});

test('undo refuses to overwrite a later manual edit', async t => {
  const f = await fixture(t);
  const p = await f.manager.stage([{ path: 'a.ts', beforeHash: hash(await f.read('a.ts')), content: 'approved' }], 'run');
  accept(f.manager, p); f.manager.authorize(p.id, 'run', 'call');
  const result = await f.manager.apply(p.id, 'run', 'call');
  await fs.writeFile(path.join(f.root, 'a.ts'), 'later edit');
  assert.deepEqual(await f.manager.undo(result.checkpointId!), { restored: [], conflicts: ['a.ts'] });
  assert.equal(await f.read('a.ts'), 'later edit');
  assert.equal((await f.manager.checkpoints())[0].state, 'restore-conflict');
});

test('host trust/dirty-document gate is checked before apply and undo', async t => {
  const f = await fixture(t);
  let writable = false;
  const manager = new ProposalManager(f.workspace, f.storage, { assertWritable() { if (!writable) throw new Error('Dirty or untrusted'); } });
  const p = await manager.stage([{ path: 'a.ts', beforeHash: hash(await f.read('a.ts')), content: 'approved' }], 'run');
  accept(manager, p); manager.authorize(p.id, 'run', 'call');
  await assert.rejects(manager.apply(p.id, 'run', 'call'), /Dirty or untrusted/);
  await assert.rejects(manager.apply(p.id, 'run', 'call'), /host approval/);
  writable = true; manager.authorize(p.id, 'run', 'next-call');
  const result = await manager.apply(p.id, 'run', 'next-call');
  writable = false;
  await assert.rejects(manager.undo(result.checkpointId!), /Dirty or untrusted/);
  assert.equal(await f.read('a.ts'), 'approved');
});

test('an actual child-process crash leaves a journal that restores the completed subset', async t => {
  const f = await fixture(t, { 'a.ts': 'a', 'b.ts': 'b' });
  const proposalsPath = path.resolve(__dirname, '../src/core/proposals.ts');
  const workspacePath = path.resolve(__dirname, '../src/core/workspace.ts');
  const typesPath = path.resolve(__dirname, '../src/core/types.ts');
  const script = `
    (async () => {
    const { ProposalManager } = require(${JSON.stringify(proposalsPath)});
    const { Workspace } = require(${JSON.stringify(workspacePath)});
    const { hash } = require(${JSON.stringify(typesPath)});
    const manager = new ProposalManager(new Workspace(${JSON.stringify(f.root)}), ${JSON.stringify(f.storage)}, { assertWritable(paths) { if (paths.length === 1 && paths[0] === 'b.ts') process.exit(23); } });
    const p = await manager.stage([{path:'a.ts', beforeHash:hash('a'),content:'A'},{path:'b.ts',beforeHash:hash('b'),content:'B'}], 'crash-run');
    for (const file of p.files) for (const hunk of file.hunks) manager.decide(p.id,hunk.id,'accept');
    manager.authorize(p.id,'crash-run','call');
    await manager.apply(p.id,'crash-run','call');
    })().catch(error => { console.error(error); process.exit(1); });
  `;
  const child = spawnSync(process.execPath, ['--import', 'tsx', '-e', script], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8', timeout: 20000, windowsHide: true });
  assert.equal(child.status, 23, child.stderr);
  assert.equal(await f.read('a.ts'), 'A'); assert.equal(await f.read('b.ts'), 'b');
  const restarted = new ProposalManager(f.workspace, f.storage);
  const [checkpoint] = await restarted.checkpoints();
  assert.equal(checkpoint.state, 'applying');
  assert.deepEqual((await restarted.undo(checkpoint.id)).conflicts, []);
  assert.equal(await f.read('a.ts'), 'a'); assert.equal(await f.read('b.ts'), 'b');
});

test('checkpoint storage and identifiers cannot address workspace or unrelated paths', async t => {
  const f = await fixture(t);
  assert.throws(() => new ProposalManager(f.workspace, path.join(f.root, '.checkpoints')), /outside/);
  await assert.rejects(f.manager.undo('../unrelated'), /Invalid checkpoint/);
});

test('ignore-policy mutations are rejected at every depth before staging can change policy', async t => {
  const f = await fixture(t, { 'a.ts': 'a', '.gitignore': 'node_modules/\n', 'docs/.littleignore': '' });
  for (const name of ['.gitignore', 'docs/.littleignore', 'new/.littleforgeignore', 'nested/.GITIGNORE']) {
    const original = name === '.gitignore' ? 'node_modules/\n' : name === 'docs/.littleignore' ? '' : null;
    await assert.rejects(f.manager.stage([{ path: name, beforeHash: original === null ? null : hash(original), content: '*\n' }], 'run'), /Ignore-policy/);
  }
  assert.equal(await f.read('.gitignore'), 'node_modules/\n');
  assert.deepEqual(await f.manager.checkpoints(), []);
});

test('proposed NUL bytes are rejected so accepted text remains readable and undoable', async t => {
  const f = await fixture(t, { 'a.ts': 'a' });
  await assert.rejects(f.manager.stage([{ path: 'a.ts', beforeHash: hash('a'), content: 'a\0b' }], 'run'), /without NUL/);
  await assert.rejects(f.manager.stage([{ path: 'new.ts', beforeHash: null, content: '\0' }], 'run'), /without NUL/);
  assert.equal(await f.read('a.ts'), 'a');
  assert.deepEqual(await f.manager.checkpoints(), []);
});

test('one malformed checkpoint does not hide valid checkpoints or block their undo', async t => {
  const f = await fixture(t, { 'a.ts': 'a' });
  const p = await f.manager.stage([{ path: 'a.ts', beforeHash: hash('a'), content: 'A' }], 'run');
  accept(f.manager, p); f.manager.authorize(p.id, 'run', 'call');
  const result = await f.manager.apply(p.id, 'run', 'call');
  const malformed = '00000000-0000-4000-8000-000000000000';
  await fs.writeFile(path.join(f.storage, `${malformed}.json`), '{broken');
  const listed = await f.manager.checkpoints();
  assert.equal(listed.find(cp => cp.id === result.checkpointId)?.state, 'applied');
  assert.deepEqual(listed.find(cp => cp.id === malformed), { id: malformed, paths: [], state: 'unavailable' });
  assert.deepEqual(await f.manager.undo(result.checkpointId!), { restored: ['a.ts'], conflicts: [] });
  assert.equal(await f.read('a.ts'), 'a');
});

test('checkpoint enumeration survives changed ignore rules while undo still enforces current policy', async t => {
  const f = await fixture(t, { 'a.ts': 'a' });
  const p = await f.manager.stage([{ path: 'a.ts', beforeHash: hash('a'), content: 'A' }], 'run');
  accept(f.manager, p); f.manager.authorize(p.id, 'run', 'call');
  const result = await f.manager.apply(p.id, 'run', 'call');
  await fs.writeFile(path.join(f.root, '.gitignore'), 'a.ts\n');
  const restarted = new ProposalManager(f.workspace, f.storage);
  assert.deepEqual(await restarted.checkpoints(), [{ id: result.checkpointId, paths: ['a.ts'], state: 'applied' }]);
  await assert.rejects(restarted.undo(result.checkpointId!), /excluded/);
  assert.equal(await f.read('a.ts'), 'A');
});

test('private checkpoint storage rejects directory aliases into the workspace', async t => {
  const f = await fixture(t, { 'a.ts': 'a' });
  const visible = path.join(f.root, 'visible-checkpoints');
  await fs.mkdir(visible);
  try { await fs.symlink(visible, f.storage, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) {
    if (['EPERM', 'EACCES', 'ENOSYS'].includes((error as NodeJS.ErrnoException).code ?? '')) { t.skip('Creating a directory-link fixture is unavailable on this host.'); return; }
    throw error;
  }
  const p = await f.manager.stage([{ path: 'a.ts', beforeHash: hash('a'), content: 'A' }], 'run');
  accept(f.manager, p); f.manager.authorize(p.id, 'run', 'call');
  await assert.rejects(f.manager.apply(p.id, 'run', 'call'), /linked or aliased/);
  await assert.rejects(f.manager.checkpoints(), /linked or aliased/);
  assert.equal(await f.read('a.ts'), 'a');
  assert.deepEqual(await fs.readdir(visible), []);
});

test('hardlinked private journals are unavailable and cannot drive undo', async t => {
  const f = await fixture(t, { 'a.ts': 'a' });
  const p = await f.manager.stage([{ path: 'a.ts', beforeHash: hash('a'), content: 'A' }], 'run');
  accept(f.manager, p); f.manager.authorize(p.id, 'run', 'call');
  const result = await f.manager.apply(p.id, 'run', 'call');
  await fs.link(path.join(f.storage, `${result.checkpointId}.json`), path.join(path.dirname(f.storage), 'shared-journal.json'));
  assert.deepEqual(await f.manager.checkpoints(), [{ id: result.checkpointId, paths: [], state: 'unavailable' }]);
  await assert.rejects(f.manager.undo(result.checkpointId!), /Unsafe checkpoint/);
  assert.equal(await f.read('a.ts'), 'A');
});
