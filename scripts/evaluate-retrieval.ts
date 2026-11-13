import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { performance } from 'node:perf_hooks';
import { ContextEngine } from '../src/core/context.js';
import { Workspace } from '../src/core/workspace.js';

/** Retrieval benchmark only: no model calls, proposals, terminal tools, or fixture modifications. */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const option = (name: string, fallback: string): string => { const at = args.indexOf(name); return at >= 0 ? args[at + 1] ?? fallback : fallback; };
  const project = process.cwd();
  const workspacePath = path.resolve(option('--workspace', path.join(project, 'evaluation/workspaces/flask')));
  const outputPath = path.resolve(option('--out', path.join(project, 'test-results/flask-retrieval.json')));
  const budget = Number(option('--budget', '12000'));
  const manifest = JSON.parse(await fs.readFile(path.join(project, 'evaluation/tasks.json'), 'utf8')) as { repository: { url: string; tag: string; commit: string }; tasks: Array<{ id: string; prompt: string }> };
  const task = manifest.tasks.find(task => task.id === 'B');
  if (!task) throw new Error('Task B is missing from evaluation/tasks.json.');
  const git = (...gitArgs: string[]): string => execFileSync('git', ['-C', workspacePath, ...gitArgs], { encoding: 'utf8', windowsHide: true }).trim();
  const commit = git('rev-parse', 'HEAD');
  if (commit !== manifest.repository.commit) throw new Error(`Wrong benchmark revision: expected ${manifest.repository.commit}, got ${commit}.`);
  const statusBefore = git('status', '--porcelain');
  if (statusBefore) throw new Error('The benchmark checkout must be clean before retrieval evaluation.');
  const workspace = new Workspace(workspacePath), context = new ContextEngine(workspace);
  const started = performance.now();
  // Only the exact user instruction enters retrieval. Expectations below never enter the query, mentions, or index.
  const result = await context.retrieve(task.prompt, budget, []);
  const elapsedMs = Math.round(performance.now() - started);
  const statusAfter = git('status', '--porcelain');
  const paths = new Set(result.chunks.map(chunk => chunk.path));
  const expected = { implementation: 'src/flask/cli.py', tests: 'tests/test_cli.py', documentation: 'docs/cli.rst' };
  const coverage = Object.fromEntries(Object.entries(expected).map(([role, file]) => [role, { path: file, selected: paths.has(file) }]));
  const budgetPassed = result.usedTokens <= budget && result.chunks.reduce((sum, chunk) => sum + chunk.tokens, 0) === result.usedTokens;
  const unchanged = statusAfter === statusBefore;
  const rolesPassed = Object.values(coverage).every(role => role.selected);
  const evidence = {
    schemaVersion: 1, evaluatedAt: new Date().toISOString(), kind: 'retrieval-only', modelInference: false, agentTaskSolved: false,
    repository: { ...manifest.repository, actualCommit: commit, cleanBefore: !statusBefore, cleanAfter: !statusAfter },
    input: { taskId: 'B', exactPrompt: task.prompt, fileHints: [], mentions: [], budgetTokens: budget, budgetMetric: 'Serialized UTF-8 bytes plus metadata allowance, used conservatively as token upper-bound units' },
    evaluation: { passed: rolesPassed && budgetPassed && unchanged, coverage, budgetPassed, sourceUnchanged: unchanged, elapsedMs },
    result,
    limitations: ['This checks initial repository retrieval, not live model inference, file discovery through harness tools, Task B implementation, VS Code review, or pytest acceptance.', 'Coverage expectations are used only after retrieval and are never injected into the retrieval request.'],
  };
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify({ output: outputPath, ...evidence.evaluation, usedTokens: result.usedTokens, budgetTokens: result.budgetTokens, indexedFiles: result.indexedFiles, selectedPaths: result.chunks.map(chunk => chunk.path) }, null, 2));
  if (!evidence.evaluation.passed) process.exitCode = 1;
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Retrieval evaluation failed.'); process.exitCode = 1; });
