import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { cancelled, type ContextChunk, type ContextResult, type FileEntry, type Mention, type SelectionScope } from './types.js';
import { Workspace, WorkspaceError, WORKSPACE_LIMITS } from './workspace.js';

export const CONTEXT_LIMITS = Object.freeze({ indexBytes: 8 * 1024 * 1024, indexChars: 96000, symbolsPerFile: 160, termsPerFile: 600, chunks: 12, chunkChars: 3400, chunkLines: 44, candidates: 30 });
const INDEXABLE = /\.(?:[cm]?[jt]sx?|pyi?|rst|mdx?|txt|jsonc?|ya?ml|toml|ini|cfg|conf|css|scss|html?|go|rs|java|c|h|cpp|hpp|cs|rb|php|vue|svelte|sql|graphql)$/i;
const IGNORE_POLICIES = new Set(['.gitignore', '.littleignore', '.littleforgeignore']);
function indexable(file: string): boolean { return INDEXABLE.test(file) || !path.posix.extname(file); }
function inventorySignature(files: FileEntry[], truncated: boolean): string {
  return `${truncated ? 'truncated' : 'complete'}\n` + files.map(file => `${file.path}\0${file.size}\0${file.mtimeMs}`).join('\n');
}
const STOP = new Set('a an the to in of and or is it its for with by on as at be from this that these those add new make should must can could would please my our your file files code change update implement implementation function return true false none self const let var export import def class async await'.split(' '));
const EXPANSIONS: Record<string, string[]> = {
  cli: ['command', 'commands', 'commandline', 'click', 'group', 'register'], command: ['cli', 'commands', 'click', 'group', 'register'],
  config: ['configuration', 'settings'], configuration: ['config', 'settings'],
  mask: ['masking', 'redact', 'redaction'], masking: ['mask', 'redact', 'redaction'],
  test: ['tests', 'pytest', 'spec'], tests: ['test', 'pytest', 'spec'],
  document: ['documentation', 'docs', 'guide'], documented: ['documentation', 'docs', 'guide'],
};
export interface SourceSymbol { name: string; path: string; line: number }
interface IndexedFile { entry: FileEntry; terms: Set<string>; symbols: SourceSymbol[]; imports: string[]; hash: string }
interface Index { files: FileEntry[]; indexed: IndexedFile[]; signature: string; truncated: boolean }
interface Candidate { file: IndexedFile; score: number; reasons: string[]; explicit?: Mention; role: 'source' | 'test' | 'docs' | 'config' }
function termWords(text: string): string[] {
  const separated = text.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  return [...new Set((separated.toLowerCase().match(/[a-z_][a-z0-9_]{1,70}/g) ?? []).flatMap(term => term.split('_')).filter(term => term.length > 1 && !STOP.has(term)))];
}
function queryWords(query: string): { direct: string[]; expanded: string[] } {
  const direct = termWords(query.slice(0, 6000)).slice(0, 36);
  return { direct, expanded: [...new Set(direct.flatMap(term => EXPANSIONS[term] ?? []))].filter(term => !direct.includes(term)).slice(0, 24) };
}
function role(file: string): Candidate['role'] {
  if (/(?:^|\/)(?:tests?|__tests__)(?:\/|$)|(?:\.test|\.spec)\.|(?:^|\/)test_[^/]+$/i.test(file)) return 'test';
  if (/\.(?:rst|mdx?|txt)$/i.test(file) || /(?:^|\/)docs?(?:\/|$)/i.test(file)) return 'docs';
  if (/\.(?:toml|jsonc?|ya?ml|ini|cfg|conf)$/i.test(file)) return 'config';
  return 'source';
}
function extractSymbols(file: string, source: string): SourceSymbol[] {
  const result: SourceSymbol[] = [];
  const python = /\.pyi?$/i.test(file);
  const sourceFile = /\.(?:[cm]?[jt]sx?|pyi?|go|rs|java|c|h|cpp|hpp|cs|rb|php)$/i.test(file);
  if (!sourceFile) return result;
  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length && result.length < CONTEXT_LIMITS.symbolsPerFile; i++) {
    const line = lines[i]!;
    if (/^\s*(?:#|\/\/|\*|\/\*)/.test(line)) continue;
    const found = python ? /^\s*(?:async\s+)?(?:def|class)\s+([A-Za-z_]\w*)\b/.exec(line)
      : /^\s*(?:(?:export|default|declare|abstract|public|private|protected|static|async|pub)\s+)*(?:function\s*\*?|class|interface|type|enum|const|let|var|fn|struct|trait)\s+([A-Za-z_$][\w$]*)\b/.exec(line);
    if (found?.[1]) result.push({ name: found[1], path: file, line: i + 1 });
  }
  return result;
}
function imports(source: string, file: string): string[] {
  const values: string[] = [];
  if (/\.pyi?$/i.test(file)) {
    for (const line of source.split(/\r?\n/)) {
      const from = /^\s*from\s+([A-Za-z_.][\w.]*)\s+import\b/.exec(line);
      if (from) values.push(from[1]!);
      else {
        const imp = /^\s*import\s+([A-Za-z_][\w.]*)/.exec(line);
        if (imp) values.push(imp[1]!);
      }
      if (values.length >= 60) break;
    }
  } else {
    for (const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*|\brequire\s*\(\s*)['"]([^'"\r\n]+)['"]/g)) {
      if (/^[A-Za-z0-9_@./-]+$/.test(match[1]!)) values.push(match[1]!);
      if (values.length >= 60) break;
    }
  }
  return [...new Set(values)];
}
function importTargets(file: IndexedFile, all: Map<string, IndexedFile>): string[] {
  const targets: string[] = [];
  for (const imported of file.imports) {
    let module = imported;
    const python = /\.pyi?$/i.test(file.entry.path);
    if (python) {
      if (module.startsWith('.')) {
        const dots = /^\.+/.exec(module)![0].length;
        module = path.posix.join(path.posix.dirname(file.entry.path), ...Array(Math.max(0, dots - 1)).fill('..'), module.slice(dots).replaceAll('.', '/'));
      } else module = module.replaceAll('.', '/');
      for (const base of [module, `src/${module}`]) for (const target of [`${base}.py`, `${base}/__init__.py`]) if (all.has(target)) targets.push(target);
    } else if (module.startsWith('.')) {
      const base = path.posix.normalize(path.posix.join(path.posix.dirname(file.entry.path), module));
      for (const target of [base, ...['.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.js'].map(ext => base.replace(/\.[cm]?js$/, '') + ext)]) if (all.has(target)) targets.push(target);
    }
  }
  return [...new Set(targets)];
}
function stablePath(value: string): string { return value.replaceAll('\\', '/'); }
function matchesPath(a: string, b: string): boolean { return process.platform === 'win32' ? stablePath(a).toLowerCase() === stablePath(b).toLowerCase() : stablePath(a) === stablePath(b); }
async function waitFor<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  cancelled(signal);
  if (!signal) return operation;
  return new Promise<T>((resolve, reject) => {
    const abort = (): void => { signal.removeEventListener('abort', abort); reject(new Error('Run cancelled.')); };
    signal.addEventListener('abort', abort, { once: true });
    operation.then(value => { signal.removeEventListener('abort', abort); if (signal.aborted) abort(); else resolve(value); }, error => { signal.removeEventListener('abort', abort); reject(error); });
    if (signal.aborted) abort();
  });
}

/** Explicit mentions resolve to a unique inventory entry; ambiguity is surfaced before a run. */
export function parseMentions(prompt: string, files?: FileEntry[], symbols?: SourceSymbol[]): Mention[] {
  const result: Mention[] = [];
  const seen = new Set<string>();
  const add = (mention: Mention): void => { const key = `${mention.kind}:${mention.path}:${mention.name ?? ''}:${mention.line ?? ''}`; if (!seen.has(key)) { seen.add(key); result.push(mention); } };
  const explicit = /@(file|symbol)(?:\(([^)\r\n]+)\)|:("[^"\r\n]+"|[^\s,;]+))/g;
  for (const match of prompt.matchAll(explicit)) {
    const kind = match[1] as 'file' | 'symbol';
    const value = (match[2] ?? match[3]!).replace(/^"|"$/g, '').replace(/[.!?]+$/, '');
    if (kind === 'file') {
      if (value.includes('#')) {
        const [filePath, symbolName] = value.split('#');
        const selected = files?.filter(file => matchesPath(file.path, filePath));
        if (files && selected?.length !== 1) throw new Error(`File mention could not be resolved: ${filePath}. Choose an existing permitted workspace file.`);
        const resolvedPath = selected?.[0]?.path ?? stablePath(filePath);
        add({ kind: 'file', path: resolvedPath });
        if (symbolName) {
          const sym = symbols?.find(s => s.name === symbolName && matchesPath(s.path, resolvedPath));
          add({ kind: 'symbol', path: resolvedPath, name: symbolName, line: sym?.line });
        }
        continue;
      }
      const selected = files?.filter(file => matchesPath(file.path, value));
      if (files && selected?.length !== 1) throw new Error(`File mention could not be resolved: ${value}. Choose an existing permitted workspace file.`);
      add({ kind, path: selected?.[0]?.path ?? stablePath(value) });
    } else {
      const split = value.lastIndexOf('#');
      const mentionedPath = split >= 0 ? value.slice(0, split) : undefined;
      const name = split >= 0 ? value.slice(split + 1) : value;
      const selected = symbols?.filter(symbol => symbol.name === name && (!mentionedPath || matchesPath(symbol.path, mentionedPath)));
      if (!selected?.length && !symbols && mentionedPath) add({ kind, path: stablePath(mentionedPath), name });
      else if (selected?.length === 1) add({ kind, ...selected[0] });
      else if (selected && selected.length > 1) throw new Error(`Symbol mention is ambiguous: ${name}. Use @symbol(path#${name}); matches: ${selected.slice(0, 5).map(symbol => `${symbol.path}:${symbol.line}`).join(', ')}.`);
      else throw new Error(`Symbol mention could not be resolved: ${value}. Choose a symbol from the workspace picker.`);
    }
  }
  if (files) for (const match of prompt.matchAll(/@([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+)/g)) {
    const value = match[1]!.replace(/[.!?]+$/, '');
    const file = files.find(candidate => matchesPath(candidate.path, value));
    if (file) add({ kind: 'file', path: file.path });
  }
  if (result.length > 24) throw new Error('Use at most 24 explicit context mentions per run.');
  return result;
}

/** Lexical code retrieval is deterministic and inspectable; all emitted source is reread freshly. */
export class ContextEngine {
  private cached?: Index;
  private pending?: Promise<Index>;
  private readonly pendingFileEvents = new Set<Promise<boolean>>();
  private buildingFiles: FileEntry[] = [];
  private revision = 0;
  constructor(private readonly workspace: Workspace) {}
  invalidate(): void { this.revision++; this.cached = undefined; }
  files(signal?: AbortSignal): Promise<FileEntry[]> { return this.workspace.list(signal); }

  /** A captured inline region is the primary evidence; it does not require a repository scan. */
  async forSelection(scope: SelectionScope, budgetTokens: number, signal?: AbortSignal): Promise<ContextResult> {
    cancelled(signal);
    if (!Number.isSafeInteger(budgetTokens) || budgetTokens < 1) throw new Error('Use a positive context budget for the selection.');
    const snapshot = await this.workspace.read(scope.path, signal);
    if (snapshot.hash !== scope.hash) throw new Error('The selected source changed. Select the saved region again.');
    if (!Number.isSafeInteger(scope.start) || !Number.isSafeInteger(scope.end) || scope.start < 0 || scope.end <= scope.start || scope.end > snapshot.content.length) throw new Error('The captured selection is outside the saved source.');
    const content = snapshot.content.slice(scope.start, scope.end);
    if (!content.trim()) throw new Error('Select a nonblank region of saved source.');
    const lineAt = (offset: number): number => snapshot.content.slice(0, offset).split(/\r\n|\r|\n/).length;
    const endOffset = /[\r\n]$/.test(content) ? scope.end - (content.endsWith('\r\n') ? 2 : 1) : scope.end;
    const chunk: ContextChunk = {path:snapshot.path,startLine:lineAt(scope.start),endLine:lineAt(endOffset),content,reason:'Captured editor selection; exact immutable inline scope; fresh source hash; no repository scan.',tokens:0,hash:snapshot.hash};
    chunk.tokens = Buffer.byteLength(JSON.stringify(chunk),'utf8') + 256;
    if (chunk.tokens > budgetTokens) throw new Error('The selected region exceeds the context budget. Select a smaller region.');
    cancelled(signal);
    return {chunks:[chunk],usedTokens:chunk.tokens,budgetTokens,indexedFiles:1,truncated:false,selectionOnly:true};
  }

  /** Ignore editor/Git/cache noise while retaining source and ignore-policy changes, including deletions. */
  handleFileEvent(absolute: string): Promise<boolean> {
    let relative: string;
    try { relative = this.workspace.relative(absolute); } catch { return Promise.resolve(false); }
    const comparable = (value: string): string => process.platform === 'win32' ? value.toLowerCase() : value;
    const key = comparable(relative);
    const known = [...(this.cached?.files ?? []), ...this.buildingFiles].some(file => comparable(file.path) === key || comparable(file.path).startsWith(`${key}/`));
    if (known) { this.invalidate(); return Promise.resolve(true); }
    const checking = (async (): Promise<boolean> => {
      const policy = IGNORE_POLICIES.has(path.posix.basename(relative).toLowerCase());
      try {
        // A policy file may exclude itself or newly exclude every sibling; validate its parent instead.
        const target = await this.workspace.resolve(policy ? path.posix.dirname(relative) : relative, true, policy);
        let relevant = policy || indexable(relative);
        if (!policy) {
          try { const directory = (await fs.lstat(target)).isDirectory(); relevant = relevant || directory; }
          catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
            // An unseen deleted path may have been an ignored directory. Known source deletions were handled above;
            // the final inventory independently detects deletions racing with a first index build.
            await this.workspace.resolve(relative, true, true);
          }
        }
        if (relevant) this.invalidate();
        return relevant;
      } catch (error) {
        if (error instanceof WorkspaceError && error.code === 'WORKSPACE_POLICY') return false;
        // A real I/O/policy-read failure cannot justify retaining potentially stale metadata.
        this.invalidate(); return true;
      }
    })();
    this.pendingFileEvents.add(checking);
    void checking.then(() => this.pendingFileEvents.delete(checking), () => this.pendingFileEvents.delete(checking));
    return checking;
  }

  private async settleFileEvents(signal?: AbortSignal): Promise<void> {
    while (this.pendingFileEvents.size) { await waitFor(Promise.all([...this.pendingFileEvents]), signal); cancelled(signal); }
  }

  private async index(signal?: AbortSignal): Promise<Index> {
    cancelled(signal);
    // A caller's cancellation must not inherit an unrelated caller's cached in-flight operation.
    if (this.pending) { await waitFor(this.pending.catch(() => undefined), signal); cancelled(signal); return this.index(signal); }
    const operation = (async (): Promise<Index> => {
      await this.settleFileEvents(signal);
      const revision = this.revision;
      const files = (await this.files(signal)).filter(file => indexable(file.path));
      const signature = inventorySignature(files, this.workspace.listingTruncated);
      this.buildingFiles = files;
      await this.settleFileEvents(signal);
      if (revision !== this.revision) throw new Error('Repository context changed during indexing. Try the run again.');
      if (this.cached?.signature === signature) return this.cached;
      const indexed: IndexedFile[] = [];
      let bytes = 0, truncated = this.workspace.listingTruncated || files.length >= WORKSPACE_LIMITS.files;
      // Source, tests, and documentation all participate; there is no repository-specific file list.
      for (const entry of files) {
        cancelled(signal);
        if (entry.size > WORKSPACE_LIMITS.fileBytes || bytes + entry.size > CONTEXT_LIMITS.indexBytes) { truncated = true; continue; }
        bytes += entry.size;
        try {
          const snapshot = await this.workspace.read(entry.path, signal);
          const source = snapshot.content.slice(0, CONTEXT_LIMITS.indexChars);
          const words = termWords(source);
          indexed.push({ entry, terms: new Set(words.slice(0, CONTEXT_LIMITS.termsPerFile)), symbols: extractSymbols(entry.path, source), imports: imports(source, entry.path), hash: snapshot.hash });
          truncated ||= source.length < snapshot.content.length || words.length > CONTEXT_LIMITS.termsPerFile;
        } catch (error) { cancelled(signal); if (!(error instanceof WorkspaceError) && (error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error; truncated = true; }
      }
      cancelled(signal);
      // File watcher delivery and permission checks are asynchronous. Verify a fresh inventory as well as revision.
      const freshFiles = (await this.files(signal)).filter(file => indexable(file.path));
      const freshSignature = inventorySignature(freshFiles, this.workspace.listingTruncated);
      await this.settleFileEvents(signal);
      if (revision !== this.revision || freshSignature !== signature) throw new Error('Repository context changed during indexing. Try the run again.');
      const index = { files, indexed, signature, truncated };
      this.cached = index; return index;
    })();
    this.pending = operation;
    try { return await operation; } finally { if (this.pending === operation) { this.pending = undefined; this.buildingFiles = []; } }
  }

  async symbols(query = '', signal?: AbortSignal): Promise<SourceSymbol[]> {
    const value = query.toLowerCase().slice(0, 200);
    return (await this.index(signal)).indexed.flatMap(file => file.symbols).filter(symbol => !value || symbol.name.toLowerCase().includes(value)).slice(0, 2000).map(symbol => ({ ...symbol }));
  }

  async retrieve(query: string, budgetTokens: number, mentions: Mention[] = [], signal?: AbortSignal, excludedPaths: readonly string[] = []): Promise<ContextResult> {
    if (!Number.isSafeInteger(budgetTokens) || budgetTokens < 0 || budgetTokens > 1_000_000) throw new Error('Context budget must be a whole number between 0 and 1,000,000.');
    if (mentions.length > 24) throw new Error('Use at most 24 explicit context mentions per run.');
    cancelled(signal);
    const index = await this.index(signal);
    const { direct, expanded } = queryWords(query);
    const terms = [...direct, ...expanded];
    const lookup = new Map(index.indexed.map(file => [file.entry.path, file]));
    const candidates: Candidate[] = index.indexed.flatMap(file => {
      if (excludedPaths.some(excluded => matchesPath(excluded, file.entry.path))) return [];
      const pathTerms = termWords(file.entry.path), names = file.symbols.flatMap(symbol => termWords(symbol.name));
      const pathMatches = direct.filter(term => pathTerms.includes(term));
      const symbolMatches = direct.filter(term => names.includes(term));
      const bodyMatches = direct.filter(term => file.terms.has(term));
      const extra = expanded.filter(term => pathTerms.includes(term) || names.includes(term) || file.terms.has(term));
      const explicitMentions = mentions.filter(mention => matchesPath(mention.path, file.entry.path));
      const reasons: string[] = [];
      let score = pathMatches.length * 6 + symbolMatches.length * 9 + bodyMatches.length * 2 + extra.length;
      if (pathMatches.length) reasons.push(`Path matches: ${pathMatches.slice(0, 4).join(', ')}`);
      if (symbolMatches.length) reasons.push(`Symbol matches: ${symbolMatches.slice(0, 4).join(', ')}`);
      if (bodyMatches.length) reasons.push(`Source terms: ${bodyMatches.slice(0, 5).join(', ')}`);
      if (extra.length) reasons.push(`Related terms: ${extra.slice(0, 4).join(', ')}`);
      if (query.toLowerCase().includes(file.entry.path.toLowerCase())) { score += 35; reasons.unshift('Path named in request'); }
      const base: Candidate = { file, score, reasons, role: role(file.entry.path) };
      return explicitMentions.length ? explicitMentions.map(explicit => ({ ...base, score: score + (explicit.reason?.startsWith('Language server') ? 100 : 10000), explicit, reasons: [explicit.reason ?? (explicit.kind === 'symbol' ? `Explicit @symbol: ${explicit.name ?? 'selected symbol'}` : 'Explicit @file mention'), ...reasons] })) : [base];
    });
    const order = (a: Candidate, b: Candidate): number => b.score - a.score || (a.file.entry.path < b.file.entry.path ? -1 : 1);
    const seeds = [...candidates].sort(order).filter(candidate => candidate.score > 0).slice(0, 4);
    for (const seed of seeds) {
      const links = new Set(importTargets(seed.file, lookup));
      const moduleName = path.posix.basename(seed.file.entry.path).replace(/\.[^.]+$/, '').replace(/^test_/, '');
      for (const candidate of candidates) {
        if (candidate === seed) continue;
        const linkedBack = importTargets(candidate.file, lookup).includes(seed.file.entry.path);
        if (links.has(candidate.file.entry.path) || linkedBack) { candidate.score += 7; candidate.reasons.push(`Python/module import relationship with ${seed.file.entry.path}`); }
        if (moduleName.length > 2 && candidate.role === 'test' && termWords(candidate.file.entry.path).includes(moduleName)) { candidate.score += 5; candidate.reasons.push(`Tests corresponding to ${seed.file.entry.path}`); }
        if (candidate.role === 'docs' && direct.some(term => candidate.file.terms.has(term))) { candidate.score += 2; candidate.reasons.push('Documentation covering request terms'); }
      }
    }
    // Module-owned tests/docs often mention the requested feature less than broad configuration guides.
    // Retain their structural relationship to the primary implementation rather than letting large hubs crowd them out.
    const primary = candidates.filter(candidate => candidate.role === 'source' && candidate.score > 0).sort(order)[0];
    if (primary) {
      const module = path.posix.basename(primary.file.entry.path).replace(/\.[^.]+$/, '').toLowerCase();
      if (module.length > 2 && !new Set(['index', '__init__', 'main', 'app', 'common', 'utils']).has(module)) {
        for (const candidate of candidates) {
          const owned = path.posix.basename(candidate.file.entry.path).replace(/\.[^.]+$/, '').replace(/^test_/, '').replace(/\.(?:test|spec)$/, '').toLowerCase();
          if ((candidate.role === 'test' || candidate.role === 'docs') && owned === module) {
            candidate.score += 24;
            candidate.reasons.unshift(`${candidate.role === 'test' ? 'Tests' : 'Documentation'} paired with primary module ${primary.file.entry.path}`);
          }
        }
      }
    }
    let ranked = candidates.filter(candidate => candidate.score > 0).sort(order);
    if (!ranked.length) ranked = candidates.filter(candidate => /^(?:readme(?:\.[^/]+)?|pyproject\.toml|package\.json)$/i.test(candidate.file.entry.path)).map(candidate => ({ ...candidate, score: 1, reasons: ['Repository overview fallback; no lexical match'] })).sort(order);
    // Preserve explicit choices first, then include source/test/docs evidence before additional same-role excerpts.
    const selected: Candidate[] = ranked.filter(candidate => candidate.explicit);
    for (const wanted of ['source', 'test', 'docs'] as const) {
      const next = ranked.find(candidate => candidate.role === wanted && !selected.includes(candidate));
      if (next) selected.push(next);
    }
    selected.push(...ranked.filter(candidate => !selected.includes(candidate)));
    const chunks: ContextChunk[] = [];
    let usedTokens = 0, truncated = index.truncated || ranked.length > CONTEXT_LIMITS.chunks;
    for (const candidate of selected.slice(0, CONTEXT_LIMITS.candidates)) {
      cancelled(signal);
      if (chunks.length >= CONTEXT_LIMITS.chunks) { truncated = true; break; }
      let snapshot;
      try { snapshot = await this.workspace.read(candidate.file.entry.path, signal); }
      catch (error) { cancelled(signal); if (candidate.explicit) throw new Error(`Explicit context is unavailable: ${candidate.file.entry.path}. Refresh the mention and try again.`); if (!(error instanceof WorkspaceError) && (error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error; truncated = true; continue; }
      const lines = snapshot.content.split(/\r?\n/);
      const freshSymbols = extractSymbols(snapshot.path, snapshot.content);
      const declarations = freshSymbols.map(symbol => {
        const words = termWords(symbol.name);
        return {symbol,score:direct.filter(term=>words.includes(term)).length*3+expanded.filter(term=>words.includes(term)).length};
      }).filter(item=>item.score>0).sort((a,b)=>b.score-a.score||a.symbol.line-b.symbol.line).slice(0,6).map(({symbol})=>({name:symbol.name,line:symbol.line}));
      const named = freshSymbols.filter(symbol => symbol.name === candidate.explicit?.name);
      const selectedSymbol = named.find(symbol => symbol.line === candidate.explicit?.line) ?? (named.length === 1 ? named[0] : undefined);
      const requestedLine = candidate.explicit?.kind === 'symbol' ? selectedSymbol?.line : candidate.explicit?.line;
      if (candidate.explicit?.kind === 'symbol' && !requestedLine) throw new Error(`Symbol mention is no longer available: ${candidate.explicit.name ?? ''} in ${snapshot.path}.`);
      let anchor = requestedLine ? Math.max(0, Math.min(lines.length - 1, requestedLine - 1)) : 0;
      if (!requestedLine) {
        let best = -1;
        for (let line = 0; line < Math.min(lines.length, 20000); line++) {
          const words = termWords(lines[line]!.slice(0, 1500));
          const score = direct.filter(term => words.includes(term)).length * 3 + expanded.filter(term => words.includes(term)).length;
          if (score > best) { best = score; anchor = line; }
        }
      }
      const start = Math.max(0, anchor - 5);
      let end = Math.min(lines.length, start + CONTEXT_LIMITS.chunkLines);
      const reason = [...new Set(candidate.reasons)].slice(0, 5).join('; ').slice(0, 600);
      let content = lines.slice(start, end).join('\n').slice(0, CONTEXT_LIMITS.chunkChars);
      let chunk: ContextChunk = { path: snapshot.path, startLine: start + 1, endLine: start + content.split('\n').length, content, reason, tokens: 0, hash: snapshot.hash, ...(declarations.length?{declarations}:{}) };
      // UTF-8 bytes are a conservative token upper bound. JSON escaping, paths, hashes and metadata are charged too.
      const charge = (): number => Buffer.byteLength(JSON.stringify({ ...chunk, tokens: 0 }), 'utf8') + 256;
      let cost = charge();
      while (cost > budgetTokens - usedTokens && content.length) {
        const newline = content.lastIndexOf('\n');
        content = newline > 0 ? content.slice(0, newline) : '';
        end = start + content.split('\n').length;
        chunk = { ...chunk, content, endLine: end };
        cost = charge();
      }
      if (!content.trim() || cost > budgetTokens - usedTokens) { truncated = true; continue; }
      chunk.tokens = cost; chunks.push(chunk); usedTokens += cost;
      if (start > 0 || chunk.endLine < lines.length || content.length >= CONTEXT_LIMITS.chunkChars) truncated = true;
    }
    // Mentions never silently disappear because a binary/oversized file was absent from the lexical index.
    for (const mention of mentions) if (!index.indexed.some(file => matchesPath(file.entry.path, mention.path))) throw new Error(`Explicit context is unavailable or exceeds the indexing limit: ${mention.path}.`);
    cancelled(signal);
    return { chunks, usedTokens, budgetTokens, indexedFiles: index.indexed.length, truncated };
  }
}
