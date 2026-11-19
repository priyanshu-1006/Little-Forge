import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

async function git(root: string, args: string[]): Promise<string> {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' } as NodeJS.ProcessEnv;
  for (const key of Object.keys(env)) if (/^GIT_(?:DIR$|WORK_TREE$|COMMON_DIR$|INDEX_FILE$|CONFIG)/i.test(key)) delete (env as NodeJS.ProcessEnv)[key];
  env.GIT_CONFIG_NOSYSTEM = '1';
  const { stdout } = await exec('git', ['-c', 'core.hooksPath=' + (process.platform === 'win32' ? 'NUL' : '/dev/null'), '-c', 'submodule.recurse=false', '-C', root, ...args], {
    timeout: 30_000, maxBuffer: 256 * 1024, windowsHide: true, env,
  });
  return stdout.trim();
}

async function requireRoot(root: string): Promise<void> {
  const gitRoot = await realpath(await git(root, ['rev-parse', '--show-toplevel']));
  if (path.relative(await realpath(root), gitRoot)) throw new Error('Open the root of the Git repository first.');
}

function branchName() {
  return `little-forge/${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`;
}

export async function createWorktree(root: string, storage: string): Promise<{ directory: string; branch: string }> {
  await requireRoot(root);
  await mkdir(storage, { recursive: true });
  const branch = branchName();
  const directory = path.join(await realpath(storage), branch.split('/').at(-1)!);
  await git(root, ['worktree', 'add', '-b', branch, '--', directory, 'HEAD']);
  return { directory, branch };
}

export async function prepareDraftBranch(root: string): Promise<string> {
  await requireRoot(root);
  const current = await git(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (current.startsWith('little-forge/')) return current;
  const branch = branchName();
  await git(root, ['switch', '-c', branch]);
  return branch;
}
