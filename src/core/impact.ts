import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export interface ImpactResult {
  targetFile: string;
  consumers: string[];     // files that import the target
  relatedTests: string[];  // test files that mention the target's basename
  riskLevel: 'low' | 'medium' | 'high';
}

const SCANNABLE_EXT = /\.(ts|js|tsx|jsx|py)$/i;
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'build', 'out', '.venv', 'venv', '__pycache__']);

/** Returns true if the file/dir should be skipped */
function shouldSkip(name: string): boolean {
  return SKIP_DIRS.has(name);
}

/** Collect all scannable files recursively under root, respecting abort signal */
async function collectFiles(root: string, signal?: AbortSignal): Promise<string[]> {
  const results: string[] = [];
  const queue: string[] = [root];
  while (queue.length > 0) {
    if (signal?.aborted) return results;
    const dir = queue.pop()!;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (signal?.aborted) return results;
      if (shouldSkip(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        queue.push(full);
      } else if (entry.isFile() && SCANNABLE_EXT.test(entry.name)) {
        results.push(full);
      }
    }
  }
  return results;
}

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
  if (!modifiedFiles.length) return [];

  // Collect all scannable files once
  const allFiles = await collectFiles(workspaceRoot, signal);

  const results: ImpactResult[] = [];

  for (const targetFile of modifiedFiles) {
    if (signal?.aborted) break;

    const basename = path.basename(targetFile, path.extname(targetFile));
    const targetAbsolute = path.resolve(workspaceRoot, targetFile);

    const consumers: string[] = [];
    const relatedTests: string[] = [];

    for (const filePath of allFiles) {
      if (signal?.aborted) break;
      // Don't scan the file itself
      if (path.resolve(filePath) === targetAbsolute) continue;

      let content: string;
      try {
        content = await fs.readFile(filePath, 'utf-8');
      } catch {
        continue;
      }

      const relative = path.relative(workspaceRoot, filePath).replace(/\\/g, '/');
      const isTest = isTestFile(filePath);

      if (isTest) {
        // For test files: check if they import/require OR broadly mention the basename
        if (mentionsBasename(content, basename) || mentionsBasenameLoose(content, basename)) {
          relatedTests.push(relative);
        }
      } else {
        // For non-test source files: check import/require patterns only
        if (mentionsBasename(content, basename)) {
          consumers.push(relative);
        }
      }
    }

    const riskLevel: 'low' | 'medium' | 'high' =
      consumers.length >= 3 ? 'high' : consumers.length >= 1 ? 'medium' : 'low';

    results.push({
      targetFile,
      consumers,
      relatedTests,
      riskLevel,
    });
  }

  return results;
}
