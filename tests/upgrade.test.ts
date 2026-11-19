import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createWorktree, prepareDraftBranch } from '../src/core/git-handoff.js';
import { observeUsage, publicReceipt, usageLimit, type RunEvidence } from '../src/core/run-evidence.js';
import { verificationPlan } from '../src/core/verification.js';
import { Workspace } from '../src/core/workspace.js';
import { ContextEngine } from '../src/core/context.js';
import { ProposalManager } from '../src/core/proposals.js';
import { hash } from '../src/core/types.js';

async function fixture(t: TestContext) {
  const temp = path.resolve(os.tmpdir());
  const base = await mkdtemp(path.join(temp, 'little-forge-upgrade-'));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(base)), temp);
    assert.ok(path.basename(base).startsWith('little-forge-upgrade-'));
    await rm(base, { recursive: true, force: true });
  });
  const root = path.join(base, 'workspace');
  await mkdir(root);
  const put = async (file: string, content: string) => {
    const dest = path.join(root, file);
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, content);
  };
  return { base, root, put, workspace: new Workspace(root) };
}

test('explicit context pins and exclusions affect real retrieval and verification selects corresponding tests', async t => {
  const f = await fixture(t);
  await f.put('src/orders.py', 'def orders():\n    return "orders"\n');
  await f.put('tests/test_orders.py', 'def test_orders():\n    pass\n');
  await f.put('tests/test_billing.py', 'def test_billing():\n    pass\n');
  await f.put('README.md', '# Billing\n');
  const result = await new ContextEngine(f.workspace).retrieve('orders', 10000, [
    { kind: 'file', path: 'README.md', reason: 'Pinned in context editor' },
  ], undefined, ['src/orders.py']);
  assert.equal(result.chunks[0]?.path, 'README.md');
  assert.match(result.chunks[0]?.reason ?? '', /Pinned/);
  assert.equal(result.chunks.some(chunk => chunk.path === 'src/orders.py'), false);
  assert.deepEqual(await verificationPlan(f.workspace, ['src/orders.py']), [
    { task: 'git-diff-check' }, { task: 'pytest', args: ['-q', 'tests/test_orders.py'] },
  ]);
});

test('detecting stale sources preserves pending hunk decisions and user work', async t => {
  const f = await fixture(t);
  await f.put('app.ts', 'export const choice = 1;\n');
  const manager = new ProposalManager(f.workspace, path.join(f.base, 'checkpoints'));
  const proposal = await manager.stage([{ path: 'app.ts', beforeHash: hash('export const choice = 1;\n'), content: 'export const choice = 2;\n' }], 'run');
  manager.decide(proposal.id, proposal.files[0].hunks[0].id, 'accept');
  await f.put('app.ts', 'export const choice = 3;\n');
  assert.deepEqual(await manager.changedPaths(proposal.id), ['app.ts']);
  assert.equal(manager.get(proposal.id).state, 'pending');
  assert.equal(await readFile(path.join(f.root, 'app.ts'), 'utf8'), 'export const choice = 3;\n');
});

test('usage totals avoid double-counting turn updates and receipts retain executed check evidence', () => {
  const evidence: RunEvidence = {
    id: 'run', workflow: 'build', startedAt: 1, sessions: [{ id: 'real-session', model: 'test/model', purpose: 'run' }],
    limits: { tokens: 100, rate: 2 }, usage: { tokens: 0, measured: false }, edits: [],
    checks: [{
      input: { task: 'git-diff-check' }, phase: 'after', durationMs: 27, changedSource: [], detectionPartial: false,
      result: { exitCode: 0, stdout: 'captured output', stderr: '', timedOut: false, cancelled: false, cleanupConfirmed: true, truncated: false },
    }],
  };
  const first = { tokens: 0 };
  observeUsage(evidence, { type: 'turn.update', state: { metrics: { total_tokens: 40 } } }, first);
  observeUsage(evidence, { type: 'turn.done', state: { metrics: { total_tokens: 60 } } }, first);
  observeUsage(evidence, { type: 'turn.done', state: { metrics: { total_tokens: 60 } } }, first);
  observeUsage(evidence, { type: 'turn.done', state: { metrics: { total_tokens: 45 } } }, { tokens: 0 });
  assert.equal(evidence.usage.tokens, 105);
  assert.equal(evidence.usage.estimatedCost, 0.00021);
  assert.match(usageLimit(evidence) ?? '', /token limit/);
  const receipt = publicReceipt(evidence, [], id => `http://localhost/sessions/${id}`);
  assert.equal(receipt.checks[0].exitCode, 0);
  assert.match(receipt.checks[0].resultHash, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(receipt).includes('captured output'), false);
  assert.equal(receipt.sessions[0].url, 'http://localhost/sessions/real-session');
});

test('isolated and draft Git operations stay local and preserve dirty source', async t => {
  const f = await fixture(t);
  const git = (root: string, ...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true }).trim();
  git(f.root, 'init');
  await f.put('demo.txt', 'committed\n');
  git(f.root, 'add', '--', 'demo.txt');
  git(f.root, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'Seed fixture');
  const original = git(f.root, 'branch', '--show-current');
  await f.put('demo.txt', 'local edits\n');
  const worktree = await createWorktree(f.root, path.join(f.base, 'isolated'));
  assert.equal(await readFile(path.join(worktree.directory, 'demo.txt'), 'utf8').then(s => s.trim()), 'committed');
  assert.equal(git(f.root, 'branch', '--show-current'), original);
  const draft = await prepareDraftBranch(f.root);
  assert.match(draft, /^little-forge\//);
  assert.equal(git(f.root, 'branch', '--show-current'), draft);
  assert.equal(await readFile(path.join(f.root, 'demo.txt'), 'utf8'), 'local edits\n');
});
