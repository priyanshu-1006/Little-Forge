import type { Workspace } from './core/workspace.js';
import type { ContextEngine } from './core/context.js';
import type { ProposalManager } from './core/proposals.js';
import { CommandRunner, type CommandInput } from './core/commands.js';
import { applyExactReplacements } from './core/exact-replacements.js';
import { cancelled, hash, type ContextResult, type FileSnapshot, type SelectionScope, type StageFile } from './core/types.js';

export interface ActiveRun { id: string; signal: AbortSignal; scope?: SelectionScope; contextBudget: number; performedAction: boolean }
export class EditorTools {
  active?: ActiveRun;
  private readonly reads = new Map<string, FileSnapshot>();
  private readonly grants = new Map<string, { toolCallId: string; digest: string }>();
  private readonly searchHistory = new Map<string, number>();
  private readonly readHistory = new Map<string, number>();
  private readonly runner: CommandRunner;
  constructor(readonly workspace: Workspace, readonly context: ContextEngine, readonly proposals: ProposalManager,
    private readonly hooks: { context: (value: ContextResult) => void; proposal: (id: string) => void; activity: (text: string) => void; assertWritable: (paths: string[]) => void; diagnostics: (paths?: string[]) => unknown }) {
    this.runner = new CommandRunner(workspace);
  }
  start(run: ActiveRun) { this.reads.clear(); this.grants.clear(); this.searchHistory.clear(); this.readHistory.clear(); this.active = run; }
  stop() { if (this.active) this.proposals.discardRun(this.active.id); this.grants.clear(); this.searchHistory.clear(); this.readHistory.clear(); this.active = undefined; }
  authorize(name: string, args: Record<string, unknown>, toolCallId: string) {
    const run = this.requireRun();
    if (name === 'apply_proposal') this.proposals.authorize(String(args.proposalId), run.id, toolCallId);
    else if (name !== 'run_command') throw new Error('Unknown sensitive tool.');
    this.grants.set(this.key(name, args), { toolCallId, digest: hash(JSON.stringify(args)) });
  }
  private key(name: string, args: Record<string, unknown>) { return name === 'apply_proposal' ? `${name}:${args.proposalId}` : `${name}:${hash(JSON.stringify(args))}`; }
  private requireRun(): ActiveRun { const run = this.active; if (!run) throw new Error('No active editor run. Start a request from Little Forge.'); cancelled(run.signal); return run; }
  async call(name: string, args: Record<string, unknown>): Promise<unknown> {
    const run = this.requireRun();
    const result = await this.dispatch(name, args);
    cancelled(run.signal);
    if (this.active !== run) throw new Error('This editor run has expired.');
    const bytes = Buffer.byteLength(JSON.stringify(result));
    if (bytes <= run.contextBudget) return result;
    // Bound every observation, including filenames, diagnostics and JSON escaping.
    // A truncated read does not pretend to be a complete JSON/source result.
    let preview = JSON.stringify(result).slice(0, Math.floor(run.contextBudget / 3));
    let bounded = { truncated: true, originalBytes: bytes, budgetTokens: run.contextBudget, preview, guidance: 'Result exceeded the conservative observation budget. Request fewer matches, fewer lines, or a narrower query.' };
    while (Buffer.byteLength(JSON.stringify(bounded)) > run.contextBudget && preview.length) { preview = preview.slice(0, Math.floor(preview.length * .7)); bounded = { ...bounded, preview }; }
    return bounded;
  }
  private async dispatch(name: string, args: Record<string, unknown>): Promise<unknown> {
    const run = this.requireRun();
    let activityText = name.replaceAll('_', ' ');
    if (name === 'search_workspace' && args.query) activityText = `search workspace: "${args.query}"`;
    else if (name === 'read_file' && args.path) activityText = `read file: ${args.path}`;
    else if (name === 'run_command') activityText = `run command: ${(args.args as string[])?.join(' ') || args.task}`;
    this.hooks.activity(activityText);
    if (name === 'get_workspace_map') {
      const files = await this.workspace.list(run.signal);
      return { files: files.slice(0, 200).map(f => f.path), total: files.length, truncated: files.length > 200, guidance: 'Use retrieve_context, search_workspace and find_symbols to discover implementation, tests and documentation.' };
    }
    if (name === 'search_workspace') {
      const query = String(args.query ?? '');
      const key = `${query}:${args.glob ?? ''}`;
      const count = (this.searchHistory.get(key) ?? 0) + 1;
      this.searchHistory.set(key, count);
      const matches = await this.workspace.search(query, args.glob as string | undefined, args.limit as number | undefined, run.signal);
      let guidance: string | undefined;
      if (matches.length === 0) {
        guidance = 'No matches found in repository. If you are searching for the requested command or feature (e.g. config or a new function), remember it does NOT exist yet — you are tasked with CREATING it! Inspect existing commands in src/flask/cli.py to see how commands are registered, then proceed directly to propose_changes.';
      } else if (count > 1) {
        guidance = 'Repeated search query. If target files are found, read them freshly to obtain their hashes and proceed directly to propose_changes.';
      }
      return guidance ? { matches, ...(count > 1 ? { repeatedQuery: true } : {}), guidance } : { matches };
    }
    if (name === 'read_file') {
      const filePath = String(args.path);
      const file = await this.workspace.read(filePath, run.signal);
      const lines = file.content.split('\n');
      const start = Math.max(1, Number(args.startLine ?? 1));
      const end = Math.min(lines.length, Number(args.endLine ?? start + 159));
      if (end < start || start > lines.length) throw new Error('Requested source range is outside the file.');
      const content = lines.slice(start - 1, end).join('\n');
      if (Buffer.byteLength(content) > run.contextBudget) throw new Error('Read exceeds the active context budget; request fewer lines.');
      this.reads.set(file.path, file);
      const readKey = `${filePath}:${start}-${end}`;
      const count = (this.readHistory.get(readKey) ?? 0) + 1;
      this.readHistory.set(readKey, count);
      const guidance = count > 1
        ? 'This file range has already been read. Use the returned hash and line content to call propose_changes.'
        : undefined;
      return { path: file.path, hash: file.hash, startLine: start, endLine: end, totalLines: lines.length, content, truncated: start > 1 || end < lines.length, ...(guidance ? { repeatedRead: true, guidance } : {}) };
    }
    if (name === 'find_symbols') return { symbols: (await this.context.symbols(args.query as string | undefined, run.signal)).slice(0, 100) };
    if (name === 'retrieve_context') {
      const result = await this.context.retrieve(String(args.query), Math.min(run.contextBudget, Number(args.budgetTokens ?? run.contextBudget)), [], run.signal);
      for (const chunk of result.chunks) this.reads.set(chunk.path, await this.workspace.read(chunk.path, run.signal));
      this.hooks.context(result); return result;
    }
    if (name === 'get_diagnostics') return this.hooks.diagnostics(args.paths as string[] | undefined);
    if (name === 'propose_changes') {
      const files = args.files as Array<{path:string;beforeHash:string|null;content?:string|null;edits?:Array<{oldText:string;newText:string}>}>;
      const prepared: StageFile[] = [];
      for (const file of files) {
        await this.workspace.resolve(file.path, file.beforeHash === null);
        if (file.beforeHash !== null) {
          const evidence = this.reads.get(file.path);
          if (!evidence || evidence.hash !== file.beforeHash) throw new Error(`Read ${file.path} freshly before proposing a change with its hash.`);
        }
        if (file.content !== undefined && file.edits !== undefined) throw new Error('Use either content or exact replacements, not both.');
        let content = file.content;
        if (file.edits) {
          const current = await this.workspace.read(file.path, run.signal);
          if (current.hash !== file.beforeHash) throw new Error(`${file.path} changed; read it again.`);
          content = applyExactReplacements(current.content, file.edits);
        }
        if (content === undefined) throw new Error('A file requires content or exact replacements.');
        prepared.push({ path: file.path, beforeHash: file.beforeHash, content });
      }
      const proposal = await this.proposals.stage(prepared, run.id, run.scope, run.signal);
      this.hooks.proposal(proposal.id);
      for (const p of prepared) this.hooks.activity(`staged file: ${p.path}`);
      return { proposalId: proposal.id, files: proposal.files.map(f => ({ path: f.path, hunks: f.hunks.length })), next: 'Request apply_proposal with this proposalId to open the human review checkpoint. No source files have been written.' };
    }
    if (name === 'apply_proposal' || name === 'run_command') {
      if (name === 'run_command' && run.scope) throw new Error('Inline edits cannot execute project commands.');
      const key = this.key(name, args), grant = this.grants.get(key);
      if (!grant || grant.digest !== hash(JSON.stringify(args))) throw new Error('Missing or expired one-use editor approval.');
      this.grants.delete(key);
      if (name === 'apply_proposal') {
        const proposal = this.proposals.get(String(args.proposalId));
        this.hooks.assertWritable(proposal.files.map(f => f.path));
        const result = await this.proposals.apply(proposal.id, run.id, grant.toolCallId, run.signal);
        if (result.status === 'applied') {
          run.performedAction = true;
          this.context.invalidate();
          for (const f of proposal.files) this.hooks.activity(`edited file: ${f.path}`);
        }
        return result;
      }
      this.hooks.assertWritable([]);
      run.performedAction = true; // A project check can have side effects; never retry its parent turn.
      const before = await this.fingerprints(run.signal);
      const result = await this.runner.run(args as unknown as CommandInput, run.signal);
      cancelled(run.signal);
      const cmdStr = (args.args as string[])?.join(' ') || args.task;
      this.hooks.activity(`ran command: ${cmdStr}${result.exitCode !== null ? ` · Exit code ${result.exitCode}` : ''}`);
      const after = await this.fingerprints(run.signal);
      const changedSource = [...new Set([...before.hashes.keys(), ...after.hashes.keys()])].filter(p => before.hashes.has(p) && after.hashes.has(p) && before.hashes.get(p) !== after.hashes.get(p));
      return { ...result, changedSource, detectionPartial: before.partial || after.partial, warning: changedSource.length ? 'The project check changed source files. These are command side effects; inspect them before proceeding.' : undefined };
    }
    throw new Error('Unknown editor tool.');
  }
  private async fingerprints(signal?: AbortSignal) {
    const hashes = new Map<string, string>(); let bytes = 0, partial = false;
    for (const file of await this.workspace.list(signal)) {
      if (bytes + file.size > 8 * 1024 * 1024 || hashes.size >= 500) { partial = true; continue; }
      try { const snapshot = await this.workspace.read(file.path, signal); bytes += Buffer.byteLength(snapshot.content); hashes.set(file.path, snapshot.hash); } catch { cancelled(signal); partial = true; }
    }
    return { hashes, partial };
  }
}
