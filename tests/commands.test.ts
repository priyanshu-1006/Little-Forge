import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { commandSpec, terminateOwnedProcess, type CommandInput } from '../src/core/commands.js';

test('pytest catalog produces literal Python argv for supported paths, node IDs and flags', () => {
  const args = ['tests/test_cli.py::TestRoutes::test_simple', 'tests/unit/test_helpers.py', '-q', '--maxfail=2', '--disable-warnings'];
  assert.deepEqual(commandSpec({ task: 'pytest', args }), {
    program: process.platform === 'win32' ? 'python.exe' : 'python3', args: ['-m', 'pytest', ...args],
  });
  assert.deepEqual(commandSpec({ task: 'pytest' }).args, ['-m', 'pytest']);
  assert.deepEqual(commandSpec({ task: 'pytest', args: ['tests', '-v', '-x'] }).args, ['-m', 'pytest', 'tests', '-v', '-x']);
  assert.equal(args[0], 'tests/test_cli.py::TestRoutes::test_simple');
});

test('pytest rejects traversal, empty path segments, aliases and alternate data streams', () => {
  for (const argument of [
    'tests/../../outside.py', 'tests/../outside.py', 'tests/a/../test_b.py', 'tests/..',
    'tests/./test_a.py', 'tests//test_a.py', 'tests/', 'tests\\..\\outside.py',
    '/tmp/test_a.py', 'C:/tmp/test_a.py', 'src/test_a.py', '../tests/test_a.py',
    'tests/foo:bar.py', 'tests/test_a.py:stream', 'tests/test_a.py::::case',
  ]) assert.throws(() => commandSpec({ task: 'pytest', args: [argument] }), argument);
});

test('shell tokens, injected environment values and unsupported pytest options are rejected', () => {
  for (const argument of [
    'tests/test_a.py;whoami', 'tests/test_a.py&&whoami', 'tests/test_a.py|whoami',
    'tests/test_a.py>output', 'tests/test_a.py<input', '`whoami`', '$env:SECRET',
    'tests/test_a.py\nwhoami', 'tests/test_a.py\rwhoami', 'tests/test_a.py\0',
    '--rootdir=..', '--override-ini=pythonpath=..', '--collect-only', '-k',
    '--maxfail=0', '--maxfail=10', 'PYTHONPATH=..',
  ]) assert.throws(() => commandSpec({ task: 'pytest', args: [argument] }), argument);
});

test('command catalog bounds argument count and length', () => {
  assert.throws(() => commandSpec({ task: 'pytest', args: Array(25).fill('-q') }), /arguments/);
  assert.throws(() => commandSpec({ task: 'pytest', args: [`tests/${'a'.repeat(251)}.py`] }), /arguments/);
});

test('fixed project checks accept no model-supplied extra argv or framework-specific flags', () => {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  assert.deepEqual(commandSpec({ task: 'npm-test' }), { program: npm, args: ['test'] });
  assert.deepEqual(commandSpec({ task: 'typecheck' }), { program: npm, args: ['run', 'typecheck'] });
  assert.deepEqual(commandSpec({ task: 'git-diff-check' }), { program: 'git', args: ['diff', '--check'] });
  for (const task of ['npm-test', 'typecheck', 'git-diff-check'] as const) {
    assert.throws(() => commandSpec({ task, args: ['--fix'] }), /additional arguments/);
  }
  assert.throws(() => commandSpec({ task: 'shell' } as unknown as CommandInput), /Unsupported project check/);
});

test('an owned Node fixture ignoring graceful termination is stopped within a bounded interval', async t => {
  const ownsGroup = process.platform !== 'win32';
  const child = spawn(process.execPath, ['-e', 'process.on("SIGTERM",()=>{}); console.log("READY"); setInterval(()=>{},1000);'], {
    windowsHide: true, detached: ownsGroup, stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) await terminateOwnedProcess(child, ownsGroup, 100); });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Owned process did not become ready.')), 10000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.stdout!.once('data', () => { clearTimeout(timer); resolve(); });
  });
  const started = Date.now();
  const confirmed = await terminateOwnedProcess(child, ownsGroup, 250);
  assert.ok(Date.now() - started < 5000, 'Cleanup must return even if tree termination cannot be confirmed.');
  assert.equal(typeof confirmed, 'boolean');
  assert.ok(child.exitCode !== null || child.signalCode !== null, 'The owned fixture itself must be observed exiting.');
  if (process.platform !== 'win32') assert.equal(confirmed, true, 'The owned POSIX group must be gone after escalation.');
  // Windows can fall back to the child handle if taskkill fails: that is deliberately unconfirmed tree cleanup.
});
