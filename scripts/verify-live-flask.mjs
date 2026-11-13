#!/usr/bin/env node
// Evaluator-only: never include this script, its expected paths, or its results in model context.
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('..', import.meta.url));
const expectedCommit = '22d924701a6ae2e4cd01e9a15bbaf3946094af65';
const options = parseArgs(process.argv.slice(2));
const tasks = options.task === 'all' ? ['A', 'B'] : [options.task];
if (options.workspace && tasks.length !== 1) throw new Error('--workspace requires --task A or --task B.');

function parseArgs(args) {
  const result = { task: 'all' };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--task' && args[i + 1]) result.task = args[++i].toUpperCase();
    else if (args[i] === '--workspace' && args[i + 1]) result.workspace = path.resolve(args[++i]);
    else if (args[i] === '--help') {
      console.log('node scripts/verify-live-flask.mjs [--task A|B|all] [--workspace ABSOLUTE_CHECKOUT]');
      process.exit(0);
    } else throw new Error(`Unknown or incomplete option: ${args[i]}`);
  }
  if (result.task === 'ALL') result.task = 'all';
  if (!['A', 'B', 'all'].includes(result.task)) throw new Error('--task must be A, B or all.');
  return result;
}

function clean(text = '') {
  return String(text).replace(/Bearer\s+[^\s"',;]+/gi, 'Bearer [redacted]')
    .replace(/\b(?:sk|gsk|hf)[-_][A-Za-z0-9_-]{10,}\b/g, '[redacted]');
}

function execute(program, args, cwd, input, timeout = 120000) {
  const env = { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTEST_ADDOPTS: '', PYTHONPATH: '' };
  delete env.PYTHONHOME;
  delete env.PYTEST_CURRENT_TEST;
  const result = spawnSync(program, args, { cwd, input, env, encoding: 'utf8', timeout, maxBuffer: 4 * 1024 * 1024, windowsHide: true, shell: false });
  return {
    program, args, exitCode: result.status, signal: result.signal,
    stdout: clean(result.stdout), stderr: clean(result.stderr),
    ...(result.error ? { error: clean(result.error.message) } : {}),
  };
}

function git(workspace, args) { return execute('git', ['-C', workspace, ...args], project, undefined, 30000); }
function check(receipt, name, passed, detail) { receipt.checks.push({ name, passed: Boolean(passed), ...(detail === undefined ? {} : { detail }) }); }
function nullPaths(command) { return command.exitCode === 0 ? command.stdout.split('\0').filter(Boolean) : []; }

async function sourceInventory(workspace) {
  const tracked = git(workspace, ['ls-files', '-z']);
  const untracked = git(workspace, ['ls-files', '--others', '--exclude-standard', '-z']);
  if (tracked.exitCode !== 0 || untracked.exitCode !== 0) throw new Error('Cannot enumerate the source hash inventory.');
  const inventory = [];
  for (const relative of [...new Set([...nullPaths(tracked), ...nullPaths(untracked)])].sort()) {
    const absolute = path.resolve(workspace, relative);
    const within = path.relative(workspace, absolute);
    if (within === '..' || within.startsWith(`..${path.sep}`) || path.isAbsolute(within)) throw new Error('Unsafe path in Git inventory.');
    try {
      const stat = await fs.lstat(absolute);
      if (stat.isSymbolicLink()) inventory.push({ path: relative, link: await fs.readlink(absolute) });
      else if (stat.isFile()) inventory.push({ path: relative, sha256: createHash('sha256').update(await fs.readFile(absolute)).digest('hex') });
      else inventory.push({ path: relative, special: true });
    } catch (error) {
      if (error.code === 'ENOENT') inventory.push({ path: relative, missing: true });
      else throw error;
    }
  }
  return inventory;
}

const pythonCommon = String.raw`
import ast, copy, json, os, pathlib, re, sys
payload = json.load(sys.stdin)
checks = []
observations = {}
commands = []
def check(name, passed, detail=None):
    result = {"name": name, "passed": bool(passed)}
    if detail is not None:
        result["detail"] = detail
    checks.append(result)
def invocation(name, result):
    commands.append({"name": name, "exitCode": result.exit_code, "stdout": result.stdout, "stderr": result.stderr})
def imported_checkout():
    import flask
    actual = pathlib.Path(flask.__file__).resolve()
    expected = pathlib.Path(payload["workspace"], "src", "flask", "__init__.py").resolve()
    check("editable Flask import uses the pinned checkout", os.path.normcase(str(actual)) == os.path.normcase(str(expected)), str(actual))
    return flask
`;

const pythonA = pythonCommon + String.raw`
try:
    flask = imported_checkout()
    from flask.helpers import get_debug_flag
    marker = object()
    prior = os.environ.get("FLASK_DEBUG", marker)
    false_values = [None, "", "0", "false", "False", "FALSE", "no", "No", "NO", "off", "Off", "OFF", "oFf", "n", "N"]
    truthy_values = ["1", "true", "TRUE", "yes", "on", "random", "officer", " off "]
    try:
        for value, expected in [(value, False) for value in false_values] + [(value, True) for value in truthy_values]:
            if value is None:
                os.environ.pop("FLASK_DEBUG", None)
            else:
                os.environ["FLASK_DEBUG"] = value
            actual = get_debug_flag()
            check("FLASK_DEBUG=" + ("<unset>" if value is None else repr(value)), actual is expected, {"expected": expected, "actual": actual})
    finally:
        if prior is marker:
            os.environ.pop("FLASK_DEBUG", None)
        else:
            os.environ["FLASK_DEBUG"] = prior
    filename = pathlib.Path(payload["workspace"], "src", "flask", "helpers.py")
    source = filename.read_text(encoding="utf-8")
    old_source = payload["baselineHelper"].replace("\r\n", "\n")
    current_node = next(node for node in ast.parse(source).body if isinstance(node, ast.FunctionDef) and node.name == "get_debug_flag")
    old_node = next(node for node in ast.parse(old_source).body if isinstance(node, ast.FunctionDef) and node.name == "get_debug_flag")
    current_lines, old_lines = source.splitlines(keepends=True), old_source.splitlines(keepends=True)
    outside_equal = (current_lines[:current_node.lineno - 1] == old_lines[:old_node.lineno - 1] and current_lines[current_node.end_lineno:] == old_lines[old_node.end_lineno:])
    check("only get_debug_flag changed inside helpers.py", outside_equal)
    docstring = ast.get_docstring(current_node) or ""
    observations["get_debug_flag_docstring"] = docstring
    for value in ["0", "false", "no", "off", "n"]:
        check("docstring lists false value " + value, re.search(r"(?<!\w)" + re.escape(value) + r"(?!\w)", docstring, re.I) is not None)
    check("docstring explains empty input", bool(re.search(r"\bempty\b|''|\"\"", docstring, re.I)))
    check("docstring explains unset/default input", bool(re.search(r"\bunset\b|not set|not defined|\bmissing\b|\babsent\b|\bdefault\b", docstring, re.I)))
except Exception as error:
    check("Task A verifier completed", False, type(error).__name__ + ": " + str(error))
print(json.dumps({"checks": checks, "observations": observations, "commands": commands}, default=str))
sys.exit(0 if checks and all(item["passed"] for item in checks) else 1)
`;

const pythonB = pythonCommon + String.raw`
try:
    flask = imported_checkout()
    from flask import Flask
    from flask.cli import FlaskGroup, NoAppException
    from click.testing import CliRunner
    from datetime import timedelta
    app = Flask("little_forge_evaluator")
    public = {"PUBLIC_LABEL": "forge-demo", "PUBLIC_INT": 42, "PUBLIC_FLOAT": 1.25, "PUBLIC_BOOL": True, "PUBLIC_LIST": [1, True, None, "text"], "PUBLIC_DICT": {"safe": 2}, "PUBLIC_NULL": None}
    sensitive = {"SECRET_KEY": "fixture-secret", "DB_PASSWORD": 0, "ACCESS_TOKEN": False, "API_KEY": None, "PREFIX_SECRET_SUFFIX": ["fixture"], "OTHER_PASSWORD": {"fake": "value"}, "TOKEN_EMPTY": "", "KEY_EMPTY_LIST": [], "MONKEY": "banana", "SECRET_KEY_FALLBACKS": None}
    app.config.update(public)
    app.config.update(sensitive)
    before = copy.deepcopy(dict(app.config))
    check("fixture includes Flask's default timedelta", isinstance(before["PERMANENT_SESSION_LIFETIME"], timedelta))
    runner = CliRunner()
    group = FlaskGroup(create_app=lambda: app, set_debug_flag=False, load_dotenv=False)
    result = runner.invoke(group, ["config"])
    invocation("config with loaded default application", result)
    check("config command succeeds for a default app", result.exit_code == 0)
    try:
        data = json.loads(result.stdout)
        check("stdout is a JSON object", isinstance(data, dict))
    except Exception as error:
        data = None
        check("stdout is a JSON object", False, type(error).__name__ + ": " + str(error))
    if isinstance(data, dict):
        for name, value in sensitive.items():
            check("masks entire value for " + name, name in data and data[name] == "***", {"present": name in data, "actual": data.get(name)})
        for name, value in public.items():
            check("preserves public JSON type/value for " + name, name in data and data[name] == value and type(data[name]) is type(value), {"present": name in data, "actual": data.get(name)})
        check("serializes PERMANENT_SESSION_LIFETIME without dropping it", "PERMANENT_SESSION_LIFETIME" in data and data["PERMANENT_SESSION_LIFETIME"] is not None, data.get("PERMANENT_SESSION_LIFETIME"))
        check("retains loaded configuration keys", set(data) == set(before))
    check("config command leaves app.config unchanged", dict(app.config) == before)
    help_result = runner.invoke(group, ["--help"])
    invocation("help with application", help_result)
    check("config appears in built-in help with application", help_result.exit_code == 0 and bool(re.search(r"(?m)^\s+config(?:\s|$)", help_result.stdout)))
    def no_app():
        raise NoAppException("Evaluator fixture intentionally has no application")
    no_app_group = FlaskGroup(create_app=no_app, set_debug_flag=False, load_dotenv=False)
    no_app_help = runner.invoke(no_app_group, ["--help"])
    invocation("help without application", no_app_help)
    check("config appears in built-in help without application", no_app_help.exit_code == 0 and bool(re.search(r"(?m)^\s+config(?:\s|$)", no_app_help.stdout)))
    missing = runner.invoke(no_app_group, ["config"])
    invocation("config without application", missing)
    check("missing application fails clearly", missing.exit_code != 0 and bool(missing.stderr.strip()) and "Error" in missing.stderr)
    check("help and config do not mutate app.config", dict(app.config) == before)
    observations["serialization_policy_result"] = None if not isinstance(data, dict) else data.get("PERMANENT_SESSION_LIFETIME")
    observations["nested_and_case_policy"] = "Inspect the generated docs manually; recursive masking and case-insensitive matching are not silently assumed by this evaluator."
except Exception as error:
    check("Task B verifier completed", False, type(error).__name__ + ": " + str(error))
print(json.dumps({"checks": checks, "observations": observations, "commands": commands}, default=str))
sys.exit(0 if checks and all(item["passed"] for item in checks) else 1)
`;

async function evaluate(task) {
  const workspace = options.workspace ?? path.join(project, 'evaluation', 'workspaces', `flask-task-${task.toLowerCase()}`);
  const python = path.join(workspace, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const receipt = { schemaVersion: 1, task, evaluatorOnly: true, startedAt: new Date().toISOString(), workspace, expectedCommit, checks: [], commands: [], manualReview: task === 'B' ? 'A human must inspect whether at least three changes are meaningful and the command is documented alongside built-ins. File counts and passing tests do not establish that claim.' : 'Review the actual inline editor preview/approval/undo evidence separately. This script does not prove UI behavior.' };
  const revision = git(workspace, ['rev-parse', 'HEAD']);
  receipt.commands.push({ name: 'pinned revision', ...revision });
  receipt.actualCommit = revision.stdout.trim();
  check(receipt, 'checkout matches pinned Flask commit', revision.exitCode === 0 && receipt.actualCommit === expectedCommit);
  if (receipt.actualCommit === expectedCommit && revision.exitCode === 0) {
    const status = git(workspace, ['status', '--porcelain=v1']);
    const changed = git(workspace, ['diff', '--name-only', '-z', 'HEAD', '--']);
    const untracked = git(workspace, ['ls-files', '--others', '--exclude-standard', '-z']);
    const diffCheck = git(workspace, ['diff', '--check', 'HEAD', '--']);
    const stat = git(workspace, ['diff', '--stat', 'HEAD', '--']);
    receipt.commands.push({ name: 'working-tree status', ...status }, { name: 'tracked changed paths', ...changed }, { name: 'untracked paths', ...untracked }, { name: 'diff whitespace check', ...diffCheck }, { name: 'diff summary', ...stat });
    const paths = [...new Set([...nullPaths(changed), ...nullPaths(untracked)])].sort();
    receipt.changedPaths = paths;
    receipt.pathCount = paths.length;
    receipt.roles = { implementation: paths.filter(value => value.startsWith('src/')), tests: paths.filter(value => value.startsWith('tests/')), documentation: paths.filter(value => value.startsWith('docs/')) };
    try { receipt.beforeSourceHashes = await sourceInventory(workspace); }
    catch (error) { check(receipt, 'initial source hash inventory available', false, clean(error.message)); }
    check(receipt, 'Git evidence commands completed', [status, changed, untracked, stat].every(command => command.exitCode === 0));
    check(receipt, 'diff has no whitespace errors', diffCheck.exitCode === 0);
    check(receipt, task === 'A' ? 'only helpers.py changed' : 'at least three changed files', task === 'A' ? paths.length === 1 && paths[0] === 'src/flask/helpers.py' : paths.length >= 3, paths);
    if (task === 'B') {
      check(receipt, 'source, test and documentation changes are present', Object.values(receipt.roles).every(values => values.length > 0), receipt.roles);
    }
    const payload = { workspace };
    if (task === 'A') {
      const original = git(workspace, ['show', 'HEAD:src/flask/helpers.py']);
      receipt.commands.push({ name: 'read original helpers.py', exitCode: original.exitCode, stderr: original.stderr });
      check(receipt, 'original helpers.py is available', original.exitCode === 0);
      payload.baselineHelper = original.stdout;
      const helperDiff = git(workspace, ['diff', '--no-ext-diff', '--no-textconv', 'HEAD', '--', 'src/flask/helpers.py']);
      receipt.helperDiff = helperDiff.stdout;
      receipt.commands.push({ name: 'intended helper diff', exitCode: helperDiff.exitCode, stderr: helperDiff.stderr });
      check(receipt, 'helper diff command completed', helperDiff.exitCode === 0);
    }
    const behavior = execute(python, ['-c', task === 'A' ? pythonA : pythonB], workspace, JSON.stringify(payload));
    receipt.commands.push({ name: 'behavior verification', ...behavior });
    try {
      const result = JSON.parse(behavior.stdout);
      if (!Array.isArray(result.checks)) throw new Error('Missing verifier checks.');
      receipt.checks.push(...result.checks);
      receipt.observations = result.observations;
      receipt.commands.push(...(result.commands ?? []).map(command => ({ ...command, program: 'CliRunner/FlaskGroup' })));
    } catch (error) { check(receipt, 'behavior verifier returned a structured report', false, String(error.message)); }
    check(receipt, 'behavior verifier exited successfully', behavior.exitCode === 0 && !behavior.error);
    const testFile = task === 'A' ? 'tests/test_helpers.py' : 'tests/test_cli.py';
    const tests = execute(python, ['-m', 'pytest', testFile, '-q'], workspace);
    receipt.commands.push({ name: 'full requested test file', ...tests });
    receipt.pytest = { testFile, exitCode: tests.exitCode, passed: Number(/(\d+) passed/.exec(tests.stdout)?.[1] ?? 0), failed: Number(/(\d+) failed/.exec(tests.stdout)?.[1] ?? 0) };
    check(receipt, 'full test file exited successfully with passing tests', tests.exitCode === 0 && !tests.error && receipt.pytest.passed > 0);
    const finalStatus = git(workspace, ['status', '--porcelain=v1']);
    receipt.commands.push({ name: 'final working-tree status', ...finalStatus });
    check(receipt, 'verification did not alter tracked/untracked source status', finalStatus.exitCode === 0 && finalStatus.stdout === status.stdout);
    try {
      receipt.afterSourceHashes = await sourceInventory(workspace);
      check(receipt, 'verification did not change source bytes or links', Array.isArray(receipt.beforeSourceHashes) && JSON.stringify(receipt.afterSourceHashes) === JSON.stringify(receipt.beforeSourceHashes));
    } catch (error) { check(receipt, 'final source hash inventory available', false, clean(error.message)); }
  } else receipt.skippedReason = 'Behavior/tests were not executed because the pinned checkout prerequisite failed.';
  receipt.finishedAt = new Date().toISOString();
  receipt.passed = receipt.checks.length > 0 && receipt.checks.every(item => item.passed);
  const directory = path.join(project, 'test-results');
  await fs.mkdir(directory, { recursive: true });
  const filename = path.join(directory, `verify-live-flask-${task}-${receipt.finishedAt.replaceAll(':', '-').replaceAll('.', '-')}.json`);
  await fs.writeFile(filename, JSON.stringify(receipt, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
  const failed = receipt.checks.filter(item => !item.passed);
  console.log(`Task ${task}: ${receipt.passed ? 'PASS' : 'FAIL'}; ${receipt.checks.length - failed.length}/${receipt.checks.length} checks; pytest ${receipt.pytest?.passed ?? 'not run'} passed; ${receipt.pathCount ?? 0} changed paths.`);
  for (const item of failed) console.log(`  FAIL: ${item.name}`);
  console.log(`Receipt: ${filename}`);
  return receipt.passed;
}

let passed = true;
for (const task of tasks) {
  try { if (!await evaluate(task)) passed = false; }
  catch (error) { passed = false; console.error(`Task ${task}: evaluator error: ${clean(error.message)}`); }
}
process.exitCode = passed ? 0 : 1;
