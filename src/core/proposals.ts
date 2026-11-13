import { randomUUID } from 'node:crypto';
import { constants, promises as fs } from 'node:fs';
import path from 'node:path';
import { diffLines } from 'diff';
import { cancelled, hash, type ApplyResult, type Hunk, type Proposal, type ProposalFile, type SelectionScope, type StageFile } from './types.js';
import type { Workspace } from './workspace.js';

const MAX_FILES = 12;
const MAX_BYTES = 512 * 1024;
const MAX_TOTAL = 2 * 1024 * 1024;
type Hooks = { assertWritable?: (paths: string[]) => void | Promise<void> };
type Grant = { runId: string; toolCallId: string; digest: string };
type JournalFile = { path: string; original: string | null; after: string | null; originalHash: string | null; afterHash: string | null; mode?: number };
type Journal = { version: 1; id: string; root: string; state: string; files: JournalFile[]; directories: string[]; temps: string[] };

function clone<T>(value: T): T { return structuredClone(value); }
function contentHash(value: string | null): string | null { return value === null ? null : hash(value); }
function key(value: string): string { return process.platform === 'win32' ? value.toLowerCase() : value; }
function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

/** Immutable source snapshots, host-owned decisions, and recoverable reviewed writes. */
export class ProposalManager {
  private readonly proposals = new Map<string, Proposal>();
  private readonly grants = new Map<string, Grant>();
  private readonly busy = new Set<string>();
  private readonly revokedRuns = new Set<string>();
  private operation: Promise<unknown> = Promise.resolve();
  private readonly storage: string;

  constructor(private readonly workspace: Workspace, storage: string, private readonly hooks: Hooks = {}) {
    this.storage = path.resolve(storage);
    if (inside(workspace.root, this.storage)) throw new Error('Checkpoint storage must be outside the workspace.');
  }

  async stage(files: StageFile[], runId: string, scope?: SelectionScope, signal?: AbortSignal): Promise<Proposal> {
    cancelled(signal);
    if (!runId || this.revokedRuns.has(runId)) throw new Error('This run is no longer active.');
    if (!Array.isArray(files) || files.length === 0 || files.length > MAX_FILES) throw new Error(`A proposal requires 1-${MAX_FILES} files.`);
    const id = randomUUID();
    const seen = new Set<string>();
    const staged: ProposalFile[] = [];
    let total = 0;
    for (const file of files) {
      cancelled(signal);
      if (typeof file.path !== 'string' || (file.content !== null && typeof file.content !== 'string')) throw new Error('Invalid proposed file.');
      if (file.content?.includes('\0')) throw new Error('Proposals must contain UTF-8 text without NUL bytes.');
      if (file.beforeHash !== null && !/^[a-f0-9]{64}$/.test(file.beforeHash)) throw new Error('A fresh SHA-256 beforeHash is required.');
      const absolute = await this.workspace.resolve(file.path, true);
      const relative = path.relative(this.workspace.root, absolute).split(path.sep).join('/');
      if (['.gitignore', '.littleignore', '.littleforgeignore'].includes(path.posix.basename(relative).toLowerCase())) throw new Error('Ignore-policy files cannot be changed by proposals; edit policy separately before starting a run.');
      if (seen.has(key(absolute))) throw new Error('A proposal cannot contain duplicate files.');
      seen.add(key(absolute));
      let original: string | null = null;
      let originalHash: string | null = null;
      try {
        const snapshot = await this.workspace.read(relative);
        original = snapshot.content;
        originalHash = snapshot.hash;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      if (originalHash !== file.beforeHash) throw new Error(`Stale source for ${relative}; read the file again.`);
      if (original === null && file.content === null) throw new Error('Cannot delete a file that does not exist.');
      const size = Buffer.byteLength(original ?? '') + Buffer.byteLength(file.content ?? '');
      if (Buffer.byteLength(original ?? '') > MAX_BYTES || Buffer.byteLength(file.content ?? '') > MAX_BYTES || (total += size) > MAX_TOTAL) throw new Error('Proposal exceeds the bounded text size.');
      if (original === file.content) continue;
      const hunks = this.hunks(id, relative, original, file.content);
      if (scope) {
        const scopedPath = await this.workspace.resolve(scope.path);
        if (key(scopedPath) !== key(absolute) || original === null || file.content === null || scope.hash !== originalHash || !Number.isInteger(scope.start) || !Number.isInteger(scope.end) || scope.start < 0 || scope.end < scope.start || scope.end > original.length) throw new Error('Invalid or stale inline selection scope.');
        if (hunks.some(hunk => hunk.start < scope.start || hunk.end > scope.end)) throw new Error('Inline proposal changes text outside the selected region.');
      }
      staged.push({ path: relative, baseHash: originalHash, original, proposed: file.content, hunks });
    }
    cancelled(signal);
    if (this.revokedRuns.has(runId)) throw new Error('This run is no longer active.');
    if (staged.length === 0) throw new Error('The proposal contains no changes.');
    const proposal: Proposal = { id, runId, createdAt: Date.now(), state: 'pending', files: staged };
    this.proposals.set(id, proposal);
    return clone(proposal);
  }

  get(id: string): Proposal { return clone(this.require(id)); }

  decide(id: string, hunkId: string, decision: 'accept' | 'reject'): void {
    const proposal = this.requirePending(id);
    if (this.busy.has(id)) throw new Error('This proposal is being applied.');
    if (decision !== 'accept' && decision !== 'reject') throw new Error('Invalid hunk decision.');
    const hunk = proposal.files.flatMap(file => file.hunks).find(item => item.id === hunkId);
    if (!hunk) throw new Error('Unknown hunk.');
    if (hunk.decision !== decision) this.grants.delete(id);
    hunk.decision = decision;
  }

  preview(id: string, filePath: string): string | null {
    const file = this.require(id).files.find(item => item.path === filePath);
    if (!file) throw new Error('File is not in this proposal.');
    return this.render(file);
  }

  authorize(id: string, runId: string, toolCallId: string): void {
    const proposal = this.requirePending(id);
    if (this.busy.has(id) || proposal.runId !== runId || !toolCallId) throw new Error('Approval does not match the active proposal.');
    this.assertDecided(proposal);
    this.grants.set(id, { runId, toolCallId, digest: this.digest(proposal) });
  }

  async apply(id: string, runId: string, toolCallId: string, signal?: AbortSignal): Promise<ApplyResult> {
    cancelled(signal);
    const proposal = this.requirePending(id);
    const grant = this.grants.get(id);
    this.assertDecided(proposal);
    if (this.busy.has(id) || !grant || proposal.runId !== runId || grant.runId !== runId || grant.toolCallId !== toolCallId || grant.digest !== this.digest(proposal)) throw new Error('A matching, fresh host approval is required.');
    this.grants.delete(id); // A matching host grant is consumed even if validation later fails.
    this.busy.add(id);
    try {
      return await this.serial(async () => {
        this.assertActive(proposal, signal);
        const changed = proposal.files.map(file => ({ file, after: this.render(file) })).filter(({ file, after }) => after !== file.original);
        if (!changed.length) { proposal.state = 'rejected'; return { status: 'rejected', paths: [] }; }
        const paths = changed.map(({ file }) => file.path);
        await this.hooks.assertWritable?.(paths);
        const journal: Journal = { version: 1, id: randomUUID(), root: this.workspace.root, state: 'prepared', files: [], directories: [], temps: [] };
        for (const { file, after } of changed) {
          this.assertActive(proposal, signal);
          const current = await this.current(file.path);
          if (current.hash !== file.baseHash) { proposal.state = 'expired'; throw new Error(`Source changed before apply: ${file.path}`); }
          journal.files.push({ path: file.path, original: file.original, after, originalHash: file.baseHash, afterHash: contentHash(after), mode: current.mode });
        }
        this.assertActive(proposal, signal);
        await this.saveJournal(journal);
        try {
          journal.state = 'applying';
          await this.saveJournal(journal);
          for (const file of journal.files) {
            this.assertActive(proposal, signal);
            await this.hooks.assertWritable?.([file.path]);
            this.assertActive(proposal, signal);
            await this.write(file.path, file.after, file.originalHash, journal, file.mode);
          }
          this.assertActive(proposal, signal);
          journal.state = 'applied';
          await this.saveJournal(journal);
          proposal.state = 'applied';
          return { status: 'applied', checkpointId: journal.id, paths };
        } catch (error) {
          const recovery = await this.restore(journal);
          journal.state = recovery.conflicts.length ? 'rollback-conflict' : 'rolled-back';
          await this.saveJournal(journal);
          proposal.state = 'expired';
          const detail = recovery.conflicts.length ? ` Recovery conflicts: ${recovery.conflicts.join(', ')}.` : ' Reviewed writes were rolled back.';
          throw new Error(`${error instanceof Error ? error.message : 'Apply failed.'}${detail}`);
        }
      });
    } finally { this.busy.delete(id); }
  }

  discardRun(runId: string): void {
    this.revokedRuns.add(runId);
    for (const proposal of this.proposals.values()) if (proposal.runId === runId && proposal.state === 'pending') {
      proposal.state = 'expired';
      this.grants.delete(proposal.id);
    }
  }

  async checkpoints(): Promise<Array<{ id: string; paths: string[]; state: string }>> {
    if (!await this.checkedStorage(false)) return [];
    let entries: string[];
    try { entries = await fs.readdir(this.storage); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    const result: Array<{ id: string; paths: string[]; state: string }> = [];
    for (const name of entries.sort()) if (/^[a-f0-9-]{36}\.json$/.test(name)) {
      const id = name.slice(0, -5);
      try {
        // Listing private metadata must not depend on today's workspace ignore rules.
        const journal = await this.loadJournal(id, false);
        result.push({ id: journal.id, paths: journal.files.map(file => file.path), state: journal.state });
      } catch {
        // Isolate damaged records, but make their unavailability visible to the host.
        result.push({ id, paths: [], state: 'unavailable' });
      }
    }
    return result;
  }

  async undo(id: string, signal?: AbortSignal): Promise<{ restored: string[]; conflicts: string[] }> {
    return this.serial(async () => {
      cancelled(signal);
      const journal = await this.loadJournal(id);
      if (journal.state === 'restored' || journal.state === 'rolled-back') return { restored: [], conflicts: [] };
      await this.hooks.assertWritable?.(journal.files.map(file => file.path));
      cancelled(signal);
      journal.state = 'restoring';
      await this.saveJournal(journal);
      // Once recovery begins, finish the bounded journal; stopping midway could strand a partial undo.
      const result = await this.restore(journal);
      journal.state = result.conflicts.length ? 'restore-conflict' : 'restored';
      await this.saveJournal(journal);
      return result;
    });
  }

  private require(id: string): Proposal {
    const proposal = this.proposals.get(id);
    if (!proposal) throw new Error('Unknown proposal.');
    return proposal;
  }
  private requirePending(id: string): Proposal {
    const proposal = this.require(id);
    if (proposal.state !== 'pending' || this.revokedRuns.has(proposal.runId)) throw new Error('This proposal is no longer active.');
    return proposal;
  }
  private assertDecided(proposal: Proposal): void { if (proposal.files.some(file => file.hunks.some(hunk => hunk.decision === 'pending'))) throw new Error('Review every hunk before applying.'); }
  private assertActive(proposal: Proposal, signal?: AbortSignal): void { cancelled(signal); this.requirePending(proposal.id); }
  private digest(proposal: Proposal): string { return hash(JSON.stringify(proposal.files.map(file => [file.path, file.baseHash, file.hunks.map(hunk => [hunk.id, hunk.decision])]))); }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.operation.then(work, work);
    this.operation = result.then(() => undefined, () => undefined);
    return result;
  }

  private hunks(id: string, filePath: string, original: string | null, proposed: string | null): Hunk[] {
    const result: Hunk[] = [];
    const add = (start: number, before: string, after: string) => {
      let prefix = 0;
      while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++;
      let suffix = 0;
      while (suffix < before.length - prefix && suffix < after.length - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++;
      start += prefix;
      before = before.slice(prefix, before.length - suffix);
      after = after.slice(prefix, after.length - suffix);
      if (before === after) return;
      result.push({ id: hash(JSON.stringify([id, filePath, start, before, after])).slice(0, 24), start, end: start + before.length, before, after, decision: 'pending' });
    };
    if (original === null || proposed === null) {
      // Creation/deletion is a single indivisible reviewed operation, including an empty file.
      result.push({ id: hash(`${id}:${filePath}`).slice(0, 24), start: 0, end: original?.length ?? 0, before: original ?? '', after: proposed ?? '', decision: 'pending' });
      return result;
    }
    let position = 0;
    let start = 0;
    let before = '';
    let after = '';
    const flush = () => { if (before || after) add(start, before, after); before = ''; after = ''; };
    const changes = diffLines(original, proposed, { timeout: 100, maxEditLength: 10000 });
    if (!changes) throw new Error('Diff exceeds the review computation budget; request a smaller change.');
    for (const part of changes) {
      if (!part.added && !part.removed) { flush(); position += part.value.length; start = position; }
      else { if (!before && !after) start = position; if (part.removed) { before += part.value; position += part.value.length; } else after += part.value; }
    }
    flush();
    return result;
  }

  private render(file: ProposalFile): string | null {
    if (file.original === null || file.proposed === null) return file.hunks[0].decision === 'reject' ? file.original : file.proposed;
    let output = file.original;
    for (const hunk of [...file.hunks].reverse()) if (hunk.decision !== 'reject') output = output.slice(0, hunk.start) + hunk.after + output.slice(hunk.end);
    return output;
  }

  private async current(filePath: string): Promise<{ hash: string | null; mode?: number }> {
    const absolute = await this.workspace.resolve(filePath, true);
    try {
      const stat = await fs.lstat(absolute);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > MAX_BYTES) throw new Error(`Unsafe or oversized source: ${filePath}`);
      return { hash: (await this.workspace.read(filePath)).hash, mode: stat.mode };
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { hash: null }; throw error; }
  }

  private journalPath(id: string): string {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid checkpoint identifier.');
    return path.join(this.storage, `${id}.json`);
  }
  private async checkedStorage(create: boolean): Promise<boolean> {
    const parsed = path.parse(this.storage);
    let current = parsed.root;
    for (const part of path.relative(parsed.root, this.storage).split(path.sep).filter(Boolean)) {
      current = path.join(current, part);
      let stat;
      try { stat = await fs.lstat(current); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        if (!create) return false;
        try { await fs.mkdir(current, { mode: 0o700 }); } catch (mkdirError) { if ((mkdirError as NodeJS.ErrnoException).code !== 'EEXIST') throw mkdirError; }
        stat = await fs.lstat(current);
      }
      if (!stat.isDirectory() || stat.isSymbolicLink() || key(await fs.realpath(current)) !== key(current)) throw new Error('Checkpoint storage cannot use linked or aliased directories.');
    }
    if (inside(this.workspace.root, await fs.realpath(this.storage))) throw new Error('Checkpoint storage must remain outside the workspace.');
    return true;
  }
  private async saveJournal(journal: Journal): Promise<void> {
    await this.checkedStorage(true);
    const target = this.journalPath(journal.id);
    const temporary = `${target}.${randomUUID()}.tmp`;
    const handle = await fs.open(temporary, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify(journal), 'utf8'); await handle.sync(); } finally { await handle.close(); }
    try { await fs.rename(temporary, target); } finally { await fs.rm(temporary, { force: true }); }
  }
  private async loadJournal(id: string, validatePaths = true): Promise<Journal> {
    const target = this.journalPath(id);
    if (!await this.checkedStorage(false)) throw new Error('Checkpoint storage does not exist.');
    const stat = await fs.lstat(target);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > MAX_TOTAL * 3) throw new Error('Unsafe checkpoint.');
    const handle = await fs.open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    let raw: string;
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || opened.nlink !== 1 || opened.size > MAX_TOTAL * 3 || opened.dev !== stat.dev || opened.ino !== stat.ino) throw new Error('Checkpoint changed before reading.');
      raw = await handle.readFile('utf8');
      const after = await handle.stat();
      const current = await fs.lstat(target);
      if (after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || current.dev !== opened.dev || current.ino !== opened.ino || current.nlink !== 1 || current.isSymbolicLink()) throw new Error('Checkpoint changed while reading.');
    } finally { await handle.close(); }
    const journal = JSON.parse(raw) as Journal;
    if (journal.version !== 1 || journal.id !== id || key(journal.root) !== key(this.workspace.root) || !Array.isArray(journal.files) || journal.files.length > MAX_FILES || !Array.isArray(journal.directories) || !Array.isArray(journal.temps)) throw new Error('Checkpoint does not belong to this workspace.');
    const metadataPath = (relative: string): string => {
      const absolute = path.resolve(this.workspace.root, relative);
      if (this.workspace.relative(absolute) !== relative) throw new Error('Invalid checkpoint path.');
      return absolute;
    };
    for (const file of journal.files) {
      if (typeof file.path !== 'string' || (file.original !== null && typeof file.original !== 'string') || (file.after !== null && typeof file.after !== 'string') || file.originalHash !== contentHash(file.original) || file.afterHash !== contentHash(file.after)) throw new Error('Invalid checkpoint content.');
      metadataPath(file.path);
      if (validatePaths) await this.workspace.resolve(file.path, true);
    }
    if (journal.directories.some(value => typeof value !== 'string') || journal.temps.some(value => typeof value !== 'string')) throw new Error('Invalid checkpoint metadata.');
    for (const relative of journal.directories) {
      const absolute = metadataPath(relative);
      if (validatePaths) await this.workspace.resolve(relative, true);
      if (key(absolute) === key(this.workspace.root) || !journal.files.some(file => inside(absolute, path.join(this.workspace.root, file.path)))) throw new Error('Invalid checkpoint directory.');
    }
    for (const relative of journal.temps) {
      const absolute = metadataPath(relative);
      if (validatePaths) await this.workspace.resolve(relative, true);
      if (!/^\.little-forge-[a-f0-9-]{36}\.tmp$/.test(path.basename(absolute)) || !journal.files.some(file => key(path.dirname(path.join(this.workspace.root, file.path))) === key(path.dirname(absolute)))) throw new Error('Invalid checkpoint temporary path.');
    }
    return journal;
  }

  private async write(filePath: string, content: string | null, expected: string | null, journal: Journal, mode?: number): Promise<void> {
    const absolute = await this.workspace.resolve(filePath, true);
    if ((await this.current(filePath)).hash !== expected) throw new Error(`Source changed during apply: ${filePath}`);
    if (content === null) { await fs.unlink(absolute); return; }
    const missing: string[] = [];
    let directory = path.dirname(absolute);
    while (directory !== this.workspace.root) {
      try { await fs.lstat(directory); break; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; missing.push(directory); directory = path.dirname(directory); }
    }
    for (const target of missing.reverse()) {
      const relative = path.relative(this.workspace.root, target).split(path.sep).join('/');
      await this.workspace.resolve(relative, true);
      journal.directories.push(relative);
      await this.saveJournal(journal);
      try { await fs.mkdir(target); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    }
    const temp = path.join(path.dirname(absolute), `.little-forge-${randomUUID()}.tmp`);
    const relativeTemp = path.relative(this.workspace.root, temp).split(path.sep).join('/');
    journal.temps.push(relativeTemp);
    await this.saveJournal(journal);
    const handle = await fs.open(temp, 'wx', mode === undefined ? 0o600 : mode & 0o777);
    try { await handle.writeFile(content, 'utf8'); await handle.sync(); } finally { await handle.close(); }
    try {
      await this.workspace.resolve(filePath, true);
      if ((await this.current(filePath)).hash !== expected) throw new Error(`Source changed during apply: ${filePath}`);
      if (expected === null) { await fs.link(temp, absolute); await fs.unlink(temp); }
      else await fs.rename(temp, absolute);
    } finally { await fs.rm(temp, { force: true }); }
  }

  private async restore(journal: Journal): Promise<{ restored: string[]; conflicts: string[] }> {
    const restored: string[] = [];
    const conflicts: string[] = [];
    for (const file of [...journal.files].reverse()) {
      try {
        const current = await this.current(file.path);
        if (current.hash === file.originalHash) { restored.push(file.path); continue; }
        if (current.hash !== file.afterHash) { conflicts.push(file.path); continue; }
        await this.hooks.assertWritable?.([file.path]);
        await this.write(file.path, file.original, file.afterHash, journal, file.mode);
        restored.push(file.path);
      } catch { conflicts.push(file.path); }
    }
    for (const relative of journal.temps) {
      if (!/^\.little-forge-[a-f0-9-]{36}\.tmp$/.test(path.basename(relative))) continue;
      try { const absolute = await this.workspace.resolve(relative, true); await fs.rm(absolute, { force: true }); } catch { /* A newly protected path is left intact. */ }
    }
    for (const relative of [...new Set(journal.directories)].reverse()) {
      try { const absolute = await this.workspace.resolve(relative, true); await fs.rmdir(absolute); } catch { /* Never remove non-empty or newly protected directories. */ }
    }
    return { restored, conflicts };
  }
}
