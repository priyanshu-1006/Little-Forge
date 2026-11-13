import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import ignore, { type Ignore } from 'ignore';
import { cancelled, hash, type FileEntry, type FileSnapshot, type SearchHit } from './types.js';

export const WORKSPACE_LIMITS = Object.freeze({
  fileBytes: 512 * 1024, files: 2500, entries: 12000, depth: 32,
  ignoreBytes: 64 * 1024, searchBytes: 8 * 1024 * 1024, searchResults: 100,
});
const PRIVATE = /^(?:\.env.*|\.git|\.ssh|\.aws|\.azure|\.gnupg|\.codex|\.agents|\.openai|\.trueforge|\.npmrc|\.pypirc|\.netrc|credentials?(?:[._-].*)?|service[-_]account(?:[._-].*)?|secrets?(?:[._-].*)?|id_(?:rsa|dsa|ecdsa|ed25519)(?:\..*)?)$/i;
const PRIVATE_EXTENSION = /\.(?:pem|key|p12|pfx|jks|keystore)$/i;
const GENERATED = new Set(['node_modules', 'vendor', 'dist', 'build', 'out', 'coverage', 'generated', '.next', '.nuxt', '.cache', '.turbo', '.venv', 'venv', '__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache', '.tox']);
const IGNORE_FILES = ['.gitignore', '.littleignore', '.littleforgeignore'];
const TEXT_EXTENSION = /\.(?:[cm]?[jt]sx?|pyi?|rst|mdx?|txt|jsonc?|ya?ml|toml|ini|cfg|conf|css|scss|html?|xml|svg|sh|ps1|sql|go|rs|java|c|h|cpp|hpp|cs|rb|php|vue|svelte|graphql|gitignore)$/i;

export class WorkspaceError extends Error {
  constructor(public readonly code: 'WORKSPACE_POLICY' | 'WORKSPACE_LIMIT' | 'WORKSPACE_BINARY' | 'WORKSPACE_CHANGED', message: string) { super(message); this.name = 'WorkspaceError'; }
}
function denied(message = 'The path is outside the permitted workspace or is protected.'): never { throw new WorkspaceError('WORKSPACE_POLICY', message); }
function equalPath(a: string, b: string): boolean { return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b; }
function sameFile(a: { dev: number; ino: number }, b: { dev: number; ino: number }): boolean { return a.dev === b.dev && a.ino === b.ino; }
function missing(error: unknown): boolean { return (error as NodeJS.ErrnoException)?.code === 'ENOENT'; }
function protectedPath(relative: string): boolean {
  return relative.split('/').some(part => PRIVATE.test(part) || PRIVATE_EXTENSION.test(part) || GENERATED.has(part.toLowerCase()));
}
function normalized(input: string): string {
  if (typeof input !== 'string' || !input || input.length > 4096 || /[\u0000-\u001f\u007f:]/.test(input) || path.isAbsolute(input) || /^[\\/]/.test(input)) denied('Use a relative workspace path without parent traversal, drive names, or control characters.');
  if (input === '.') return '.';
  const parts = input.replaceAll('\\', '/').split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part) || /[<>"|?*]/.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) denied('The workspace path is ambiguous or contains an unsafe segment.');
  const value = parts.join('/');
  if (protectedPath(value)) denied('Credentials, private settings, and generated paths are excluded.');
  return value;
}
function globPattern(glob: string): RegExp {
  if (glob.length > 300 || /[\u0000-\u001f]/.test(glob)) throw new WorkspaceError('WORKSPACE_LIMIT', 'Use a glob of at most 300 characters.');
  const value = glob.replaceAll('\\', '/');
  let expression = '^';
  for (let i = 0; i < value.length; i++) {
    const char = value[i]!;
    if (char === '*' && value[i + 1] === '*') { i++; if (value[i + 1] === '/') { expression += '(?:.*/)?'; i++; } else expression += '.*'; }
    else if (char === '*') expression += '[^/]*';
    else if (char === '?') expression += '[^/]';
    else expression += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(expression + '$', process.platform === 'win32' ? 'i' : '');
}

/** Local filesystem capabilities; no model, shell, or network access is available here. */
export class Workspace {
  readonly root: string;
  private lastListingTruncated = false;
  constructor(root: string) { this.root = path.resolve(root); }
  get listingTruncated(): boolean { return this.lastListingTruncated; }

  private async checkedRoot(): Promise<string> {
    const stat = await fs.lstat(this.root);
    const real = await fs.realpath(this.root);
    if (!stat.isDirectory() || stat.isSymbolicLink() || !equalPath(real, this.root)) denied('Open the real workspace directory instead of a symbolic-link or junction alias.');
    return real;
  }

  relative(absolute: string): string {
    if (!path.isAbsolute(absolute)) denied('An absolute path is required for workspace-relative conversion.');
    const relative = path.relative(this.root, absolute);
    if (path.isAbsolute(relative) || relative === '..' || relative.startsWith('..' + path.sep)) denied();
    return relative ? normalized(relative.replaceAll(path.sep, '/')) : '.';
  }

  private async rules(directory: string, cache: Map<string, Promise<Ignore>>): Promise<Ignore> {
    const existing = cache.get(directory); if (existing) return existing;
    const reading = (async () => {
      const matcher = ignore();
      for (const name of IGNORE_FILES) {
        const file = path.join(directory, name);
        let handle: fs.FileHandle | undefined;
        try {
          const before = await fs.lstat(file);
          if (!before.isFile() || before.isSymbolicLink() || before.nlink > 1 || before.size > WORKSPACE_LIMITS.ignoreBytes) continue;
          handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
          const opened = await handle.stat();
          if (!sameFile(before, opened) || opened.nlink > 1 || opened.size > WORKSPACE_LIMITS.ignoreBytes) continue;
          const buffer = Buffer.alloc(WORKSPACE_LIMITS.ignoreBytes + 1);
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
          if (bytesRead <= WORKSPACE_LIMITS.ignoreBytes) matcher.add(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytesRead)));
        } catch (error) { if (!missing(error)) throw error; }
        finally { await handle?.close(); }
      }
      return matcher;
    })();
    cache.set(directory, reading); return reading;
  }

  private async allowed(relative: string, isDirectory: boolean, cache: Map<string, Promise<Ignore>>): Promise<boolean> {
    if (relative === '.') return true;
    if (protectedPath(relative)) return false;
    const parts = relative.split('/');
    // Each parent's exclusion is final, matching Git's rule that an excluded parent cannot be re-included by a child.
    for (let end = 1; end <= parts.length; end++) {
      let excluded = false;
      for (let depth = 0; depth < end; depth++) {
        const directory = path.join(this.root, ...parts.slice(0, depth));
        const suffix = parts.slice(depth, end).join('/') + (end < parts.length || isDirectory ? '/' : '');
        const result = (await this.rules(directory, cache)).test(suffix);
        if (result.ignored) excluded = true;
        else if (result.unignored) excluded = false;
      }
      if (excluded) return false;
    }
    return true;
  }

  async resolve(input: string, forCreate = false, asDirectory = false): Promise<string> {
    const relative = normalized(input);
    await this.checkedRoot();
    if (relative === '.') return this.root;
    const parts = relative.split('/');
    let absent = false;
    let directory = false;
    const cache = new Map<string, Promise<Ignore>>();
    for (let i = 0; i < parts.length; i++) {
      const candidate = path.join(this.root, ...parts.slice(0, i + 1));
      if (!absent) {
        try {
          const stat = await fs.lstat(candidate);
          if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile()) || stat.isFile() && stat.nlink > 1) denied('Linked or special files are excluded from workspace operations.');
          if (i < parts.length - 1 && !stat.isDirectory()) denied('An ancestor is not a regular directory.');
          if (asDirectory && i === parts.length - 1 && !stat.isDirectory()) denied('The path is not a regular directory.');
          directory = stat.isDirectory();
          if (!equalPath(await fs.realpath(candidate), candidate)) denied('A path alias is excluded from workspace operations.');
        } catch (error) { if (!forCreate || !missing(error)) throw error; absent = true; directory = asDirectory || i < parts.length - 1; }
      } else directory = asDirectory || i < parts.length - 1;
      if (!await this.allowed(parts.slice(0, i + 1).join('/'), directory, cache)) denied('The path is excluded by workspace ignore rules.');
    }
    return path.join(this.root, ...parts);
  }

  async list(signal?: AbortSignal): Promise<FileEntry[]> {
    cancelled(signal); await this.checkedRoot();
    const files: FileEntry[] = [];
    const rules = new Map<string, Promise<Ignore>>();
    let visited = 0, truncated = false;
    const walk = async (directory: string, prefix: string, depth: number): Promise<void> => {
      cancelled(signal);
      if (depth > WORKSPACE_LIMITS.depth || files.length >= WORKSPACE_LIMITS.files || visited >= WORKSPACE_LIMITS.entries) { truncated = true; return; }
      const entries = (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
      for (const entry of entries) {
        cancelled(signal);
        if (++visited > WORKSPACE_LIMITS.entries || files.length >= WORKSPACE_LIMITS.files) { truncated = true; return; }
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        try { normalized(relative); } catch { continue; }
        if (entry.isSymbolicLink() || !entry.isFile() && !entry.isDirectory() || !await this.allowed(relative, entry.isDirectory(), rules)) continue;
        try {
          const absolute = path.join(directory, entry.name);
          const stat = await fs.lstat(absolute);
          if (stat.isSymbolicLink() || !equalPath(await fs.realpath(absolute), absolute)) continue;
          if (stat.isDirectory()) await walk(absolute, relative, depth + 1);
          else if (stat.isFile() && stat.nlink === 1) files.push({ path: relative, size: stat.size, mtimeMs: stat.mtimeMs });
        } catch (error) { if (!missing(error)) throw error; }
      }
    };
    await walk(this.root, '', 0);
    cancelled(signal); this.lastListingTruncated = truncated; return files;
  }

  async read(input: string, signal?: AbortSignal): Promise<FileSnapshot> {
    cancelled(signal);
    const absolute = await this.resolve(input);
    cancelled(signal);
    const before = await fs.lstat(absolute);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink > 1) denied('Only regular, unlinked UTF-8 files can be read.');
    if (before.size > WORKSPACE_LIMITS.fileBytes) throw new WorkspaceError('WORKSPACE_LIMIT', `Read a smaller file (maximum ${WORKSPACE_LIMITS.fileBytes} bytes).`);
    const handle = await fs.open(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const opened = await handle.stat();
      if (!sameFile(before, opened) || opened.size !== before.size || opened.mtimeMs !== before.mtimeMs || opened.nlink > 1) throw new WorkspaceError('WORKSPACE_CHANGED', 'The file changed before reading.');
      const buffer = Buffer.alloc(WORKSPACE_LIMITS.fileBytes + 1);
      let count = 0;
      while (count < buffer.length) {
        cancelled(signal);
        const chunk = await handle.read(buffer, count, buffer.length - count, count);
        if (!chunk.bytesRead) break;
        count += chunk.bytesRead;
      }
      if (count > WORKSPACE_LIMITS.fileBytes) throw new WorkspaceError('WORKSPACE_LIMIT', 'The file grew beyond the read budget.');
      const after = await handle.stat();
      const refreshed = await this.resolve(input);
      const current = await fs.lstat(refreshed);
      if (!sameFile(opened, current) || current.nlink > 1 || after.size !== count || current.size !== count || after.mtimeMs !== opened.mtimeMs || current.mtimeMs !== opened.mtimeMs) throw new WorkspaceError('WORKSPACE_CHANGED', 'The file or workspace policy changed while reading.');
      const bytes = buffer.subarray(0, count);
      if (bytes.includes(0)) throw new WorkspaceError('WORKSPACE_BINARY', 'Binary files are unavailable as source context.');
      let content: string;
      try { content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
      catch { throw new WorkspaceError('WORKSPACE_BINARY', 'The file must contain valid UTF-8 text.'); }
      cancelled(signal);
      return { path: this.relative(absolute), content, hash: hash(bytes) };
    } finally { await handle.close(); }
  }

  async search(query: string, glob = '**/*', limit = 50, signal?: AbortSignal): Promise<SearchHit[]> {
    if (!query || query.length > 500 || /[\u0000\r\n]/.test(query)) throw new WorkspaceError('WORKSPACE_LIMIT', 'Use a nonempty, single-line literal search of at most 500 characters.');
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > WORKSPACE_LIMITS.searchResults) throw new WorkspaceError('WORKSPACE_LIMIT', `Search limit must be between 1 and ${WORKSPACE_LIMITS.searchResults}.`);
    const pattern = globPattern(glob), needle = query.toLowerCase(), matches: SearchHit[] = [];
    let scanned = 0;
    for (const file of await this.list(signal)) {
      cancelled(signal);
      if (!pattern.test(file.path) || !TEXT_EXTENSION.test(file.path) && path.extname(file.path) !== '' || file.size > WORKSPACE_LIMITS.fileBytes) continue;
      if (scanned + file.size > WORKSPACE_LIMITS.searchBytes) break;
      scanned += file.size;
      let snapshot: FileSnapshot;
      try { snapshot = await this.read(file.path, signal); }
      catch (error) { cancelled(signal); if (error instanceof WorkspaceError || missing(error)) continue; throw error; }
      const lines = snapshot.content.split(/\r?\n/);
      for (let line = 0; line < lines.length; line++) {
        cancelled(signal);
        if (lines[line]!.toLowerCase().includes(needle)) matches.push({ path: file.path, line: line + 1, text: lines[line]!.slice(0, 800) });
        if (matches.length >= limit) return matches;
      }
    }
    return matches;
  }
}
