import { spawn, type ChildProcess } from 'node:child_process';
import * as path from 'node:path';
import { cancelled } from './types.js';
import type { Workspace } from './workspace.js';

export interface CommandInput { task: 'pytest' | 'npm-test' | 'typecheck' | 'git-diff-check'; args?: string[]; cwd?: string }
export interface CommandResult { exitCode: number | null; stdout: string; stderr: string; truncated: boolean; timedOut: boolean; cancelled: boolean; cleanupConfirmed: boolean; cleanupWarning?: string }

/** Terminates only the supplied owned child (and its explicitly owned POSIX group). */
export async function terminateOwnedProcess(child: ChildProcess, ownsGroup = false, graceMs = 500): Promise<boolean> {
  if (!child.pid) return false;
  const pid = child.pid;
  let closed = child.exitCode !== null || child.signalCode !== null;
  const onClose = () => { closed = true; };
  child.once('close', onClose);
  const groupExists = () => { try { process.kill(-pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code !== 'ESRCH'; } };
  const waitUntil = async (predicate: () => boolean, milliseconds: number) => {
    const deadline = Date.now() + milliseconds;
    while (!predicate() && Date.now() < deadline) await new Promise<void>(resolve => setTimeout(resolve, 20));
    return predicate();
  };
  try {
    if (process.platform === 'win32') {
      if (closed) return false; // A dead leader cannot prove that its former descendants exited.
      const treeKilled = await new Promise<boolean>(resolve => {
        let done = false;
        const killer = spawn('taskkill.exe', ['/pid', String(pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
        const finish = (value: boolean) => { if (!done) { done = true; clearTimeout(timer); resolve(value); } };
        const timer = setTimeout(() => { killer.kill(); finish(false); }, Math.max(100, graceMs));
        killer.once('error', () => finish(false));
        killer.once('close', code => finish(code === 0));
      });
      if (!treeKilled || !closed) { try { child.kill('SIGKILL'); } catch { /* Confirmation below stays honest. */ } }
      await waitUntil(() => closed, 1500);
      return treeKilled && closed;
    }
    const gone = () => closed && (!ownsGroup || !groupExists());
    if (gone()) return true;
    try { if (ownsGroup) process.kill(-pid, 'SIGTERM'); else child.kill('SIGTERM'); } catch { /* Escalate only this owned process/group below. */ }
    if (await waitUntil(gone, Math.max(100, graceMs))) return true;
    try { if (ownsGroup && groupExists()) process.kill(-pid, 'SIGKILL'); else if (!closed) child.kill('SIGKILL'); } catch { /* Failed cleanup is returned explicitly. */ }
    return await waitUntil(gone, 1500);
  } finally { child.off('close', onClose); }
}

export function commandSpec(input: CommandInput): { program: string; args: string[] } {
  const extra = input.args ?? [];
  if (extra.length > 24 || extra.some(a => a.length > 250 || /[\r\n\x00;&|<>`$]/.test(a))) throw new Error('Unsupported command arguments.');
  if (input.task === 'pytest') {
    if (extra.some(a => {
      if (/^(?:-q|-v|-x|--disable-warnings|--maxfail=[1-9])$/.test(a)) return false;
      const [file, ...nodes] = a.split('::');
      return !/^tests(?:\/[\w.-]+)*$/.test(file) || file.split('/').some(s => !s || s === '.' || s === '..') || nodes.some(n => !/^\w+$/.test(n));
    })) throw new Error('Only safe workspace test paths and the displayed pytest flags are supported.');
    return { program: process.platform === 'win32' ? 'python.exe' : 'python3', args: ['-m', 'pytest', ...extra] };
  }
  if (extra.length) throw new Error('This check does not accept additional arguments.');
  if (input.task === 'npm-test') return { program: process.platform === 'win32' ? 'npm.cmd' : 'npm', args: ['test'] };
  if (input.task === 'typecheck') return { program: process.platform === 'win32' ? 'npm.cmd' : 'npm', args: ['run', 'typecheck'] };
  if (input.task === 'git-diff-check') return { program: 'git', args: ['diff', '--check'] };
  throw new Error('Unsupported project check.');
}

export class CommandRunner {
  private child?: ChildProcess;
  private active = false;
  constructor(private readonly workspace: Workspace, private readonly timeoutMs = 120_000) {}
  async run(input: CommandInput, signal?: AbortSignal): Promise<CommandResult> {
    cancelled(signal);
    if (this.active) throw new Error('A project check is already running.');
    this.active = true;
    try {
    const cwd = await this.workspace.resolve(input.cwd || '.');
    cancelled(signal);
    const spec = commandSpec(input);
    // Prefer the pinned checkout's environment; never take executable paths from model input.
    if (input.task === 'pytest') {
      const fs = await import('node:fs/promises');
      for (const venv of [path.join(this.workspace.root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')]) {
        try { const s = await fs.lstat(venv); if (s.isFile() && !s.isSymbolicLink()) { spec.program = venv; break; } } catch { /* Use installed Python. */ }
      }
    }
    cancelled(signal);
    return await new Promise<CommandResult>((resolve, reject) => {
      let stdout = '', stderr = '', truncated = false, timedOut = false, stopped = false;
      let settled = false;
      let stopping: Promise<boolean> | undefined;
      let closeCode: number | null = null;
      const append = (chunk: Buffer, error: boolean) => {
        const used = Buffer.byteLength(stdout) + Buffer.byteLength(stderr);
        const available = Math.max(0, 65_536 - used);
        if (chunk.byteLength > available) truncated = true;
        const text = chunk.subarray(0, available).toString('utf8');
        if (error) stderr += text; else stdout += text;
      };
      // Windows .cmd requires cmd.exe; tokens are fixed above and never user shell code.
      const windowsScript = process.platform === 'win32' && spec.program.endsWith('.cmd');
      const child = spawn(windowsScript ? process.env.ComSpec ?? 'cmd.exe' : spec.program,
        windowsScript ? ['/d', '/s', '/c', `${spec.program} ${spec.args.join(' ')}`] : spec.args,
        { cwd, shell: false, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
      this.child = child;
      const stop = () => {
        if (settled || stopping) return;
        stopped = true;
        stopping = terminateOwnedProcess(child, process.platform !== 'win32');
        void stopping.then(confirmed => finish(closeCode ?? child.exitCode, confirmed), () => finish(closeCode ?? child.exitCode, false));
      };
      signal?.addEventListener('abort', stop, { once: true });
      const timer = setTimeout(() => { timedOut = true; stop(); }, this.timeoutMs);
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', stop); if (this.child === child) this.child = undefined; };
      const finish = (exitCode: number | null, cleanupConfirmed: boolean) => {
        if (settled) return;
        settled = true; cleanup();
        resolve({ exitCode, stdout, stderr, truncated, timedOut, cancelled: stopped && !timedOut, cleanupConfirmed,
          ...(cleanupConfirmed ? {} : { cleanupWarning: 'Owned-process cleanup could not be fully confirmed. Inspect the project process before running another check.' }) });
      };
      child.stdout?.on('data', data => append(data, false));
      child.stderr?.on('data', data => append(data, true));
      child.once('error', error => { if (!settled) { settled = true; cleanup(); reject(new Error(`Cannot start ${input.task}: ${error.message}`)); } });
      child.once('close', exitCode => { closeCode = exitCode; if (!stopping) finish(exitCode, true); });
      if (signal?.aborted) stop();
    });
    } finally { this.active = false; }
  }
}
