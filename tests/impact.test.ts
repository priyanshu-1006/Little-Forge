import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { analyzeImpact } from '../src/core/impact.js';

test('analyzeImpact identifies direct consumers and related test files', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-impact-'));
  try {
    await fs.mkdir(path.join(tmp, 'src'), { recursive: true });
    await fs.mkdir(path.join(tmp, 'tests'), { recursive: true });

    await fs.writeFile(path.join(tmp, 'src', 'auth.ts'), 'export function login() { return true; }\n');
    await fs.writeFile(path.join(tmp, 'src', 'router.ts'), "import { login } from './auth';\nexport function route() { login(); }\n");
    await fs.writeFile(path.join(tmp, 'src', 'service.ts'), "const auth = require('./auth');\n");
    await fs.writeFile(path.join(tmp, 'tests', 'auth.test.ts'), "import { login } from '../src/auth';\n");
    await fs.writeFile(path.join(tmp, 'src', 'unrelated.ts'), 'export const value = 42;\n');
    await fs.writeFile(path.join(tmp, '.littleforgeignore'), 'private.ts\n');
    await fs.writeFile(path.join(tmp, 'private.ts'), "import { login } from './auth';\n");
    await fs.writeFile(path.join(tmp, 'credentials.ts'), "import { login } from './auth';\n");

    const results = await analyzeImpact(['src/auth.ts', 'private.ts', 'credentials.ts'], tmp);
    assert.equal(results.length, 1);
    const authResult = results[0];
    assert.equal(authResult.targetFile, 'src/auth.ts');
    assert.ok(authResult.consumers.some(c => c.includes('router.ts')));
    assert.ok(authResult.consumers.some(c => c.includes('service.ts')));
    assert.ok(!authResult.consumers.some(c => c.includes('unrelated.ts')));
    assert.ok(!authResult.consumers.some(c => c === 'private.ts' || c === 'credentials.ts'));
    assert.ok(authResult.relatedTests.some(t => t.includes('auth.test.ts')));
    assert.equal(authResult.riskLevel, 'medium'); // 2 consumers
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('analyzeImpact calculates high risk for 3+ consumers and respects cancellation', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-impact-'));
  try {
    await fs.mkdir(path.join(tmp, 'src'), { recursive: true });

    await fs.writeFile(path.join(tmp, 'src', 'core.ts'), 'export const v = 1;\n');
    await fs.writeFile(path.join(tmp, 'src', 'a.ts'), "import { v } from './core';\n");
    await fs.writeFile(path.join(tmp, 'src', 'b.ts'), "import { v } from './core';\n");
    await fs.writeFile(path.join(tmp, 'src', 'c.ts'), "import { v } from './core';\n");

    const results = await analyzeImpact(['src/core.ts'], tmp);
    assert.equal(results[0].riskLevel, 'high'); // 3 consumers

    const abortController = new AbortController();
    abortController.abort();
    const cancelledResults = await analyzeImpact(['src/core.ts'], tmp, abortController.signal);
    assert.equal(cancelledResults.length, 0);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
