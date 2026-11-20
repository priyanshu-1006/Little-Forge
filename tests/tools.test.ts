import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { EditorTools, type ActiveRun } from '../src/tools.js';
import { Workspace } from '../src/core/workspace.js';
import { ContextEngine } from '../src/core/context.js';
import { ProposalManager } from '../src/core/proposals.js';
import { hash, type ContextResult, type SelectionScope } from '../src/core/types.js';

async function fixture(t: TestContext, scope?: SelectionScope) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'little-forge-tools-'));
  const root = path.join(base, 'workspace'); await fs.mkdir(root);
  t.after(async () => { assert.equal(path.dirname(path.resolve(base)), path.resolve(os.tmpdir())); assert.ok(path.basename(base).startsWith('little-forge-tools-')); await fs.rm(base, { recursive: true, force: true }); });
  const workspace = new Workspace(root), context = new ContextEngine(workspace), proposals = new ProposalManager(workspace, path.join(base, 'checkpoints'));
  const controller = new AbortController();
  const events = { contexts: [] as ContextResult[], proposals: [] as string[], activity: [] as string[], writable: [] as string[][] };
  const tools = new EditorTools(workspace, context, proposals, {
    context: value => { events.contexts.push(value); }, proposal: id => { events.proposals.push(id); }, activity: value => { events.activity.push(value); },
    assertWritable: paths => { events.writable.push(paths); }, diagnostics: paths => ({ paths, diagnostics: [] }),
  });
  const run: ActiveRun = { id: 'test-run', signal: controller.signal, scope, contextBudget: 12000, performedAction: false };
  tools.start(run);
  const put = async (file: string, content: string) => { await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true }); await fs.writeFile(path.join(root, file), content); context.invalidate(); };
  const read = (file: string) => fs.readFile(path.join(root, file), 'utf8');
  return { base, root, workspace, context, proposals, tools, controller, events, run, put, read };
}
type Staged = { proposalId: string; files: { path: string; hunks: number }[] };

test('read-only mode can read but cannot stage, authorize or execute an editor mutation', async t => {
  const f = await fixture(t);
  await f.put('app.ts', 'export const x = 1;');
  f.tools.start({ ...f.run, readOnly: true });
  assert.equal((await f.tools.call('read_file', { path: 'app.ts' }) as { path: string }).path, 'app.ts');
  for (const tool of ['propose_changes', 'apply_proposal', 'run_command']) {
    await assert.rejects(f.tools.call(tool, {}), /read-only/);
    assert.throws(() => f.tools.authorize(tool, {}, 'unexpected-call'), /read-only/);
  }
});

test('existing-file proposals require fresh read evidence and source hash', async t => {
  const f = await fixture(t); const original = 'export const value = 1;\n'; await f.put('app.ts', original);
  await assert.rejects(f.tools.call('propose_changes', { files: [{ path: 'app.ts', beforeHash: hash(original), content: 'changed' }] }), /Read .* freshly/);
  const evidence = await f.tools.call('read_file', { path: 'app.ts' }) as { hash: string; content: string };
  assert.equal(evidence.hash, hash(original)); assert.equal(evidence.content, original);
  await assert.rejects(f.tools.call('propose_changes', { files: [{ path: 'app.ts', beforeHash: hash('wrong'), content: 'changed' }] }), /Read .* freshly/);
  await f.put('app.ts', 'user change\n');
  await assert.rejects(f.tools.call('propose_changes', { files: [{ path: 'app.ts', beforeHash: evidence.hash, content: 'changed' }] }), /Stale source/);
  assert.equal(await f.read('app.ts'), 'user change\n');
  assert.equal(f.events.proposals.length, 0);
});

test('exact replacements stage a review and only a one-use host grant applies it', async t => {
  const f = await fixture(t); const original = 'one\nkeep\nthree\n'; await f.put('app.ts', original);
  const evidence = await f.tools.call('read_file', { path: 'app.ts' }) as { hash: string };
  const staged = await f.tools.call('propose_changes', { files: [{ path: 'app.ts', beforeHash: evidence.hash, edits: [{ oldText: 'one', newText: 'ONE' }, { oldText: 'three', newText: 'THREE' }] }] }) as Staged;
  assert.equal(await f.read('app.ts'), original); assert.deepEqual(f.events.proposals, [staged.proposalId]);
  assert.equal(staged.files[0]?.hunks, 2);
  await assert.rejects(f.tools.call('apply_proposal', { proposalId: staged.proposalId }), /Missing or expired/);
  const proposal = f.proposals.get(staged.proposalId);
  for (const file of proposal.files) for (const [i, hunk] of file.hunks.entries()) f.proposals.decide(proposal.id, hunk.id, i === 0 ? 'accept' : 'reject');
  f.tools.authorize('apply_proposal', { proposalId: staged.proposalId }, 'harness-call-1');
  await assert.rejects(f.tools.call('apply_proposal', { proposalId: staged.proposalId, extra: true }), /Missing or expired/);
  const result = await f.tools.call('apply_proposal', { proposalId: staged.proposalId }) as { status: string; checkpointId: string };
  assert.equal(result.status, 'applied'); assert.equal(await f.read('app.ts'), 'ONE\nkeep\nthree\n');
  assert.equal(f.run.performedAction, true); assert.deepEqual(f.events.writable, [['app.ts']]);
  await assert.rejects(f.tools.call('apply_proposal', { proposalId: staged.proposalId }), /Missing or expired/);
  assert.deepEqual(await f.proposals.undo(result.checkpointId), { restored: ['app.ts'], conflicts: [] });
  assert.equal(await f.read('app.ts'), original);
});

test('ambiguous, absent, overlapping and stale exact replacements never stage writes', async t => {
  const f = await fixture(t); const original = 'aaa\nrepeat repeat\n'; await f.put('app.py', original);
  const evidence = await f.tools.call('read_file', { path: 'app.py' }) as { hash: string };
  for (const oldText of ['aa', 'repeat', 'missing']) await assert.rejects(f.tools.call('propose_changes', { files: [{ path: 'app.py', beforeHash: evidence.hash, edits: [{ oldText, newText: 'replacement' }] }] }), /match exactly once/);
  await assert.rejects(f.tools.call('propose_changes', { files: [{ path: 'app.py', beforeHash: evidence.hash, content: 'both', edits: [] }] }), /either content or exact replacements/);
  await f.put('app.py', 'changed by user\n');
  await assert.rejects(f.tools.call('propose_changes', { files: [{ path: 'app.py', beforeHash: evidence.hash, edits: [{ oldText: 'aaa', newText: 'AAA' }] }] }), /changed; read it again/);
  assert.equal(f.events.proposals.length, 0); assert.equal(await f.read('app.py'), 'changed by user\n');
});

test('retrieval supplies fresh read evidence and visible context before proposals', async t => {
  const f = await fixture(t); await f.put('src/config.py', 'def configuration():\n    return "old"\n');
  const result = await f.tools.call('retrieve_context', { query: 'configuration', budgetTokens: 5000 }) as ContextResult;
  assert.equal(f.events.contexts.length, 1); assert.ok(result.usedTokens <= 5000);
  const chunk = result.chunks.find(value => value.path === 'src/config.py'); assert.ok(chunk);
  const staged = await f.tools.call('propose_changes', { files: [{ path: chunk.path, beforeHash: chunk.hash, edits: [{ oldText: '"old"', newText: '"new"' }] }] }) as Staged;
  assert.equal(f.proposals.get(staged.proposalId).state, 'pending');
  assert.equal(await f.read('src/config.py'), 'def configuration():\n    return "old"\n');
});

test('unknown grants, mutated command arguments and inactive runs fail before execution', async t => {
  const f = await fixture(t);
  assert.throws(() => f.tools.authorize('read_file', { path: 'app.py' }, 'call'), /Unknown sensitive tool/);
  await assert.rejects(f.tools.call('unknown_tool', {}), /Unknown editor tool/);
  await assert.rejects(f.tools.call('run_command', { task: 'git-diff-check' }), /Missing or expired/);
  f.tools.authorize('run_command', { task: 'git-diff-check' }, 'call');
  await assert.rejects(f.tools.call('run_command', { task: 'git-diff-check', cwd: 'different' }), /Missing or expired/);
  assert.equal(f.run.performedAction, false); assert.deepEqual(f.events.writable, []);
  f.tools.stop();
  await assert.rejects(f.tools.call('get_workspace_map', {}), /No active editor run/);
  assert.throws(() => f.tools.authorize('run_command', { task: 'git-diff-check' }, 'call'), /No active editor run/);
});

test('a reviewed command remains authorized when MCP reorders JSON fields', async t => {
  const f = await fixture(t);
  execFileSync('git', ['init', '--quiet', f.root]);
  f.tools.authorize('run_command', { cwd: '.', args: [], task: 'git-diff-check' }, 'check');
  const reordered = { task: 'git-diff-check', args: [], cwd: '.' };
  const result = await f.tools.call('run_command', reordered) as { exitCode: number };
  assert.equal(result.exitCode, 0);
  await assert.rejects(f.tools.call('run_command', reordered), /Missing or expired/);
});

test('cancellation and stopped runs expire pending proposals without changing source', async t => {
  const f = await fixture(t); await f.put('app.py', 'old\n');
  const evidence = await f.tools.call('read_file', { path: 'app.py' }) as { hash: string };
  const staged = await f.tools.call('propose_changes', { files: [{ path: 'app.py', beforeHash: evidence.hash, content: 'new\n' }] }) as Staged;
  for (const hunk of f.proposals.get(staged.proposalId).files[0].hunks) f.proposals.decide(staged.proposalId, hunk.id, 'accept');
  f.tools.authorize('apply_proposal', { proposalId: staged.proposalId }, 'call');
  f.controller.abort();
  await assert.rejects(f.tools.call('apply_proposal', { proposalId: staged.proposalId }), /cancelled/);
  f.tools.stop(); assert.equal(f.proposals.get(staged.proposalId).state, 'expired');
  assert.equal(await f.read('app.py'), 'old\n'); assert.deepEqual(await f.proposals.checkpoints(), []);
  const next = { ...f.run, id: 'next', signal: new AbortController().signal, performedAction: false }; f.tools.start(next);
  await assert.rejects(f.tools.call('apply_proposal', { proposalId: staged.proposalId }), /Missing or expired/);
});

test('inline runs deny commands even when an approval exists', async t => {
  const f = await fixture(t, { path: 'app.py', hash: hash('old'), start: 0, end: 3 });
  f.tools.authorize('run_command', { task: 'git-diff-check' }, 'call');
  await assert.rejects(f.tools.call('run_command', { task: 'git-diff-check' }), /Inline edits cannot execute/);
  assert.equal(f.run.performedAction, false); assert.deepEqual(f.events.writable, []);
});

test('CRLF source accepts LF multiline edits inside immutable UTF-16 scope and preserves outside bytes', async t => {
  const prefix = '\uFEFF# 😀 untouched prefix\r\n';
  const selected = 'def flag(value):\r\n    """Read a flag."""\r\n    return value == "true"\r\n';
  const suffix = '\r\n# untouched suffix café\r\n';
  const original = prefix + selected + suffix;
  const scope: SelectionScope = { path: 'app.py', hash: hash(original), start: prefix.length, end: prefix.length + selected.length };
  const f = await fixture(t, scope); await f.put('app.py', original);
  const evidence = await f.tools.call('read_file', { path: 'app.py' }) as { hash: string };
  const replacement = 'def flag(value):\n    """Read a flag case-insensitively."""\n    return value.lower() == "true"\n';
  const staged = await f.tools.call('propose_changes', { files: [{ path: 'app.py', beforeHash: evidence.hash, edits: [{ oldText: selected.replace(/\r\n/g, '\n'), newText: replacement }] }] }) as Staged;
  const proposal = f.proposals.get(staged.proposalId), expected = prefix + replacement.replace(/\n/g, '\r\n') + suffix;
  assert.equal(proposal.files[0].proposed, expected);
  assert.ok(proposal.files[0].hunks.every(hunk => hunk.start >= scope.start && hunk.end <= scope.end));
  assert.deepEqual(Buffer.from(proposal.files[0].proposed!.slice(0, scope.start)), Buffer.from(prefix));
  assert.deepEqual(Buffer.from(proposal.files[0].proposed!.slice(-suffix.length)), Buffer.from(suffix));
  assert.equal(await f.read('app.py'), original);
  await assert.rejects(f.tools.call('apply_proposal', { proposalId: staged.proposalId }), /Missing or expired/);
  for (const hunk of proposal.files[0].hunks) f.proposals.decide(proposal.id, hunk.id, 'accept');
  f.tools.authorize('apply_proposal', { proposalId: proposal.id }, 'eol-approved-call');
  const applied = await f.tools.call('apply_proposal', { proposalId: proposal.id }) as { checkpointId: string };
  assert.deepEqual(await fs.readFile(path.join(f.root, 'app.py')), Buffer.from(expected));
  await f.proposals.undo(applied.checkpointId);
  assert.deepEqual(await fs.readFile(path.join(f.root, 'app.py')), Buffer.from(original));
});

test('EOL equivalence cannot hide ambiguous matches or move an edit outside inline scope', async t => {
  const original = 'outside\r\none\r\ntwo\r\n';
  const f = await fixture(t, { path: 'app.py', hash: hash(original), start: 'outside\r\n'.length, end: original.length });
  await f.put('app.py', original);
  const evidence = await f.tools.call('read_file', { path: 'app.py' }) as { hash: string };
  await assert.rejects(f.tools.call('propose_changes', { files: [{ path: 'app.py', beforeHash: evidence.hash, edits: [{ oldText: 'outside\none', newText: 'changed\none' }] }] }), /outside the selected region/);
  assert.equal(await f.read('app.py'), original); assert.equal(f.events.proposals.length, 0);
  const next = { ...f.run, id: 'ambiguous-run', scope: undefined, signal: new AbortController().signal }; f.tools.start(next);
  const ambiguous = 'one\r\ntwo\r\nseparator\none\ntwo\n'; await f.put('app.py', ambiguous);
  const read = await f.tools.call('read_file', { path: 'app.py' }) as { hash: string };
  await assert.rejects(f.tools.call('propose_changes', { files: [{ path: 'app.py', beforeHash: read.hash, edits: [{ oldText: 'one\r\ntwo', newText: 'changed' }] }] }), /match exactly once/);
  assert.equal(await f.read('app.py'), ambiguous); assert.equal(f.events.proposals.length, 0);
});

test('repeated search and read operations return helpful anti-loop guidance', async t => {
  const f = await fixture(t);
  await f.put('app.py', 'print("hello")\n');
  const search1 = await f.tools.call('search_workspace', { query: 'print' }) as { matches: unknown[]; guidance?: string };
  assert.equal(search1.guidance, undefined);
  const search2 = await f.tools.call('search_workspace', { query: 'print' }) as { matches: unknown[]; guidance?: string; repeatedQuery?: boolean };
  assert.equal(search2.repeatedQuery, true);
  assert.match(search2.guidance!, /Repeated search query/);

  const read1 = await f.tools.call('read_file', { path: 'app.py' }) as { guidance?: string };
  assert.equal(read1.guidance, undefined);
  const read2 = await f.tools.call('read_file', { path: 'app.py' }) as { guidance?: string; repeatedRead?: boolean };
  assert.equal(read2.repeatedRead, true);
  assert.match(read2.guidance!, /already been read/);
});
