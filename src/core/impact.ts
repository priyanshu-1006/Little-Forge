import * as path from 'node:path';
import { Workspace, WORKSPACE_LIMITS } from './workspace.js';

export interface ImpactResult {
  targetFile: string;
  consumers: string[];     // files that import the target
  relatedTests: string[];  // test files that mention the target's basename
  riskLevel: 'low' | 'medium' | 'high';
  partial?: boolean;
}

const SCANNABLE_EXT = /\.(ts|js|tsx|jsx|py)$/i;

/** Returns true if filePath is a test file */
function isTestFile(filePath: string): boolean {
  const base = path.basename(filePath);
  const parts = filePath.replace(/\\/g, '/').split('/');
  return /test|spec|_test/i.test(base) || parts.includes('tests') || parts.includes('test') || parts.includes('__tests__');
}

/**
 * Check if `content` imports/requires/mentions the given basename (without extension).
 * Handles: ES import, CommonJS require, Python from-import.
 */
function mentionsBasename(content: string, basename: string): boolean {
  // Escape special regex chars in basename
  const escaped = basename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // import ... from '...basename...'
  // require('...basename...')
  // from X import / from 'X' import
  const patterns = [
    // ES import: import ... from './foo/impact' or './impact.js'
    new RegExp(`from\\s+['"\`][^'"\`]*(?:^|/)${escaped}(?:\\.[a-z]+)?['"\`]`, 'i'),
    // CommonJS: require('./impact') or require('./impact.js')
    new RegExp(`require\\s*\\(\\s*['"\`][^'"\`]*(?:^|/)${escaped}(?:\\.[a-z]+)?['"\`]`, 'i'),
    // Python: from impact import ... or import impact
    new RegExp(`(?:from\\s+[\\w.]*${escaped}[\\w.]*\\s+import|import\\s+[\\w., ]*\\b${escaped}\\b)`, 'i'),
    // Bare string mention (for test files only — catch all)
    new RegExp(`\\b${escaped}\\b`, 'i'),
  ];
  // For the import patterns, check the first three; the fourth is for test file catch-all
  return patterns[0].test(content) || patterns[1].test(content) || patterns[2].test(content);
}

/**
 * Check if `content` mentions the basename (for test relatedness — broader check).
 */
function mentionsBasenameLoose(content: string, basename: string): boolean {
  const escaped = basename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, 'i').test(content);
}

export async function analyzeImpact(
  modifiedFiles: string[],
  workspaceRoot: string,
  signal?: AbortSignal
): Promise<ImpactResult[]> {
  if (!modifiedFiles.length || signal?.aborted) return [];

  const workspace = new Workspace(workspaceRoot);
  const targets = new Set<string>();
  for (const file of modifiedFiles) {
    if (signal?.aborted) return [];
    try {
      targets.add(workspace.relative(await workspace.resolve(file, true)));
    } catch {
      continue;
    }
  }
  if (!targets.size) return [];

  const candidates = await workspace.list(signal).catch(error => {
    if (signal?.aborted) return [];
    throw error;
  });
  let partial = workspace.listingTruncated;
  let bytes = 0;
  const files: { path: string; content: string; test: boolean }[] = [];
  for (const entry of candidates) {
    if (signal?.aborted) return [];
    if (!SCANNABLE_EXT.test(entry.path)) continue;
    if (entry.size > WORKSPACE_LIMITS.fileBytes || files.length >= 500 || bytes + entry.size > WORKSPACE_LIMITS.searchBytes) {
      partial = true;
      continue;
    }
    bytes += entry.size;
    try {
      const snapshot = await workspace.read(entry.path, signal);
      files.push({ path: snapshot.path, content: snapshot.content, test: isTestFile(snapshot.path) });
    } catch {
      partial = true;
    }
  }

  const results: ImpactResult[] = [];
  for (const targetFile of targets) {
    if (signal?.aborted) return [];
    const basename = path.basename(targetFile, path.extname(targetFile));
    const consumers: string[] = [];
    const relatedTests: string[] = [];
    for (const file of files) {
      if (file.path === targetFile) continue;
      const importsTarget = mentionsBasename(file.content, basename);
      if (file.test) {
        if (importsTarget || mentionsBasenameLoose(file.content, basename)) relatedTests.push(file.path);
      } else if (importsTarget) {
        consumers.push(file.path);
      }
    }
    const riskLevel = consumers.length >= 3 ? 'high' : consumers.length >= 1 ? 'medium' : 'low';
    results.push({ targetFile, consumers, relatedTests, riskLevel, ...(partial && { partial }) });
  }
  return results;
}
