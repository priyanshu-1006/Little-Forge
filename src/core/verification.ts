import path from 'node:path';
import type { CommandInput } from './commands.js';
import type { Workspace } from './workspace.js';

export async function verificationPlan(workspace: Workspace, changed: string[], signal?: AbortSignal): Promise<CommandInput[]> {
  const paths = (await workspace.list(signal)).map(file => file.path);
  const python = changed.filter(file => file.endsWith('.py'));
  const modules = new Set(python.map(file => path.posix.basename(file, '.py').replace(/^test_/, '')));
  const tests = paths.filter(file => /^tests\/(?:[\w.-]+\/)*test_[\w.-]+\.py$/.test(file));
  const related = tests.filter(file => python.includes(file) || modules.has(path.posix.basename(file, '.py').slice(5)));
  const checks: CommandInput[] = [{ task: 'git-diff-check' }];
  if (python.length && tests.length) checks.push({ task: 'pytest', args: ['-q', ...(related.length ? related.slice(0, 12) : ['tests'])] });
  if (changed.some(file => /\.[cm]?[jt]sx?$|^package(?:-lock)?\.json$/.test(file)) && paths.includes('package.json')) {
    try {
      const { scripts = {} } = JSON.parse((await workspace.read('package.json', signal)).content);
      if (typeof scripts.test === 'string') checks.push({ task: 'npm-test' });
      if (typeof scripts.typecheck === 'string') checks.push({ task: 'typecheck' });
    } catch (error) {
      if (signal?.aborted) throw error;
    }
  }
  return checks;
}
