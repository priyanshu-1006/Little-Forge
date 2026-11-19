import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { EditorTools, type ActiveRun } from '../src/tools.js';
import { Workspace } from '../src/core/workspace.js';
import { ContextEngine } from '../src/core/context.js';
import { ProposalManager } from '../src/core/proposals.js';
import { hash, type ContextResult } from '../src/core/types.js';

async function fixture(t: TestContext, maxFiles = 2, permissionMode = 'auto', allowDeps = false) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'little-forge-guard-'));
  const root = path.join(base, 'workspace');
  await fs.mkdir(root);
  t.after(async () => {
    await fs.rm(base, { recursive: true, force: true });
  });

  const workspace = new Workspace(root);
  const context = new ContextEngine(workspace);
  const proposals = new ProposalManager(workspace, path.join(base, 'checkpoints'));
  const controller = new AbortController();
  const events = { contexts: [] as ContextResult[], proposals: [] as string[], activity: [] as string[] };
  const tools = new EditorTools(workspace, context, proposals, {
    context: v => events.contexts.push(v),
    proposal: id => events.proposals.push(id),
    activity: v => events.activity.push(v),
    assertWritable: () => {},
    diagnostics: () => ({ paths: [], diagnostics: [] })
  }, { maxFiles, allowDeps, safeMode: true }, permissionMode);

  const run: ActiveRun = { id: 'guard-run', signal: controller.signal, contextBudget: 12000, performedAction: false };
  tools.start(run);

  const put = async (file: string, content: string) => {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.writeFile(path.join(root, file), content);
    context.invalidate();
  };

  return { root, tools, put };
}

test('Change Guard rejects proposals exceeding the configured maxFiles limit', async t => {
  const f = await fixture(t, 2); // limit to 2 files
  await f.put('a.ts', 'const a = 1;\n');
  await f.put('b.ts', 'const b = 2;\n');
  await f.put('c.ts', 'const c = 3;\n');

  const files = [
    { path: 'a.ts', beforeHash: null, content: 'const a = 10;\n' },
    { path: 'b.ts', beforeHash: null, content: 'const b = 20;\n' },
    { path: 'c.ts', beforeHash: null, content: 'const c = 30;\n' }
  ];

  await assert.rejects(
    f.tools.call('propose_changes', { files }),
    /Change Guard: This proposal touches 3 files but your task contract limits edits to 2 files/
  );
});

test('Change Guard protects sensitive files like package.json unless elevated', async t => {
  const f = await fixture(t, 5, 'auto', false);
  const pkgContent = '{\n  "name": "app"\n}\n';
  await f.put('package.json', pkgContent);
  const read = await f.tools.call('read_file', { path: 'package.json' }) as { hash: string };

  await assert.rejects(
    f.tools.call('propose_changes', { files: [{ path: 'package.json', beforeHash: read.hash, content: '{\n  "name": "hacked"\n}\n' }] }),
    /Change Guard: Modifying package\.json requires Turbo permission mode/
  );

  // Turbo mode allows staging package.json
  const fTurbo = await fixture(t, 5, 'turbo', false);
  await fTurbo.put('package.json', pkgContent);
  const readTurbo = await fTurbo.tools.call('read_file', { path: 'package.json' }) as { hash: string };
  const staged = await fTurbo.tools.call('propose_changes', { files: [{ path: 'package.json', beforeHash: readTurbo.hash, content: '{\n  "name": "updated"\n}\n' }] });
  assert.ok(staged);
});
