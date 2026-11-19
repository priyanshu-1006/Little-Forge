# Fixed-task acceptance guide

This guide describes how to reproduce the fixed tasks. See [live acceptance notes](../docs/LIVE_TEST_STATUS.md) for observed results. Use the exact prompts in [tasks.json](tasks.json) in the recording. The pinned source is [Flask 3.1.3](https://github.com/pallets/flask/releases/tag/3.1.3), commit `22d924701a6ae2e4cd01e9a15bbaf3946094af65`.

## Prepare isolated evaluation workspaces

Use three separate disposable checkouts outside both Little_Code and Little Forge, named for A, B and C. The following is a proposed PowerShell setup for one checkout. Run from your chosen evaluation parent directory; repeat with the other names. Use an installed `uv` version supporting the pinned lockfile and record its version.

```powershell
git clone --branch 3.1.3 --depth 1 https://github.com/pallets/flask.git flask-task-a
Set-Location flask-task-a
$expected = '22d924701a6ae2e4cd01e9a15bbaf3946094af65'
if ((git rev-parse HEAD).Trim() -ne $expected) { throw 'Unexpected Flask revision' }
uv --version
uv sync --locked --group tests
if ($LASTEXITCODE -ne 0) { throw 'Pinned dependency setup failed' }
& .\.venv\Scripts\python.exe -c "import flask,sys; print(sys.executable); print(flask.__file__)"
uv pip freeze --python .\.venv\Scripts\python.exe
git status --porcelain=v1
```

The `uv pip freeze` command records the environment without requiring pip inside the venv. Save the exact Python/uv versions and resolved environment outside tracked Flask source. Use the venv interpreter directly; PowerShell activation is unnecessary. If `uv sync --locked` fails, diagnose the actual lock/Python/platform error rather than silently dropping `--locked`.

Confirm the printed Flask import path is under this checkout's `src/flask`. Record a clean baseline after setup. Do not use a system `flask` or `pytest` executable for verification. Keep virtual environments and caches ignored. No reset or cleanup should erase a previous task's accepted work.

Record each run's extension build hash, harness version, exact agent definition, model identifier, configured context capacity, UTC timestamp plus local timezone, repository SHA and initial Git status. A health probe demonstrates reachability and model configuration only; it does not prove inference or MCP execution.

## Optional headless production-core acceptance

Once the three named isolated checkouts and their environments exist under `evaluation/workspaces/`, run `npm run accept:prepare -- --run-baselines` to verify their identities, editable imports, dependency versions and existing helper/CLI tests. Its receipt is `test-results/live-environment.json`. The checkouts are disposable evaluation material, not application source; no automatic reset is performed.

Use `npm run spike` to list configured model names without reading keys. Then run `npm run accept:live -- --task A --model provider/model` (or B/C). The runner uses the real configured model through TrueForge and the production MCP/context/proposal implementation. Task B receives the original prompt and general retrieval, with no evaluator filename hints. Inline tasks use the pinned selected function scope.

The runner prints an evidence directory and pauses when the harness requests approval. Inspect its `review-N.json` before creating the referenced `decisions-N.json`. Each decision contains the exact tool-call ID, `allow`, and an explicit accept/reject choice for every actual hunk. A command has a separate decision. No patch or command is approved automatically. Cancel the process to revoke its grants and stop the harness turn. Source patches, transcripts and actual session links remain in the ignored evidence directory.

This runner establishes live model/production-core behavior, not native editor selection, keybinding, visible diff, UI responsiveness or final video compliance. Those still require the actual VS Code extension. Never label file-driven operator approval as on-screen human review evidence.

## Task A: selected-function editing

Open `src/flask/helpers.py`, select `get_debug_flag`, invoke Little Forge's inline-edit keybinding, and enter the exact Task A prompt. Show the editor diff before any write. The proposal should change only the selected function: add `off` and `n` to the case-insensitive false values and accurately document unset/empty input plus supported strings. Do not normalize additional inputs or edit `get_load_dotenv` as an unrelated change.

Review the generated hunks and apply the intended result. This PowerShell verification is equivalent to the brief's Unix environment-prefix command:

```powershell
$hadDebug = Test-Path Env:FLASK_DEBUG
$previousDebug = $env:FLASK_DEBUG
try {
    $env:FLASK_DEBUG = 'off'
    & .\.venv\Scripts\python.exe -c "from flask.helpers import get_debug_flag; print(get_debug_flag())"
    if ($LASTEXITCODE -ne 0) { throw 'Task A verification failed' }
} finally {
    if ($hadDebug) { $env:FLASK_DEBUG = $previousDebug }
    else { Remove-Item Env:FLASK_DEBUG -ErrorAction SilentlyContinue }
}
```

The visible result must be `False`. Rehearse `OFF`, `n`, `N`, empty/unset input and existing false/truthy values as separate checks. Show a successful undo of an applied change and its restored content; if needed, reapply through a fresh visible review. If A produces a single hunk, show its review controls and prove independent choices in Task B; a private fixture test is not on-screen scoring evidence.

## Task B: discover three meaningful files

Use the exact Task B prompt with no file mentions, selection or pre-injected expected paths. The manifest is evaluation metadata, not an agent prompt supplement. The agent must discover implementation, tests and documentation through general repository tools.

For the evaluator, likely relevant files are `src/flask/cli.py`, `tests/test_cli.py`, and `docs/cli.rst`. Do not inject that list into the run or special-case Flask in retrieval code. The built-in command should be registered among Flask's defaults, use an application context and leave `app.config` unchanged.

Show actual selected context files, reasons and budget, then the multi-file proposal, independent accept/reject decisions, and the real TrueForge session's turns/tool calls. Every file counted toward the three-file requirement must contain a meaningful task change. A demonstration app created by the evaluator does not count.

After accepting the appropriate patch, show the full required CLI test run:

```powershell
& .\.venv\Scripts\python.exe -m pytest tests/test_cli.py -q
$cliTestExit = $LASTEXITCODE
if ($cliTestExit -ne 0) { throw "CLI tests failed with exit code $cliTestExit" }
git diff --stat
git diff --check
& .\.venv\Scripts\python.exe -m flask --help
```

Use a synthetic app outside the Flask repository, containing fake values only:

```python
# Save as demo_app.py in a separate evaluation fixture directory.
from flask import Flask

app = Flask(__name__)
app.config.update(
    PUBLIC_LABEL="forge-demo",
    API_KEY="fake-key-only",
    DB_PASSWORD="fake-password-only",
    ACCESS_TOKEN="fake-token-only",
    OTHER_SECRET="fake-secret-only",
)
```

From the pinned checkout, replace the example fixture path with its real absolute location and use the same interpreter:

```powershell
& .\.venv\Scripts\python.exe -m flask --app 'C:\evaluation-fixtures\demo_app.py:app' config
if ($LASTEXITCODE -ne 0) { throw 'Task B command failed' }
```

Verify stdout parses as JSON and the sensitive values are `***`, with `PUBLIC_LABEL` preserved. Also check help without an app configured, and invalid application loading as a separate failure case. Record exit codes rather than inferring success from a fragment of terminal output.

The implementation/tests must address these cases:

- Sensitive substrings SECRET, PASSWORD, TOKEN and KEY, including values that are null, lists or objects; mask before converting a value to text.
- A documented case policy and nested-mapping policy. Top-level config keys are the direct requirement; broader recursive masking is an optional behavior to test explicitly.
- Normal JSON scalar/container values preserved and the configuration mapping left unchanged.
- Flask's default `PERMANENT_SESSION_LIFETIME` is a `timedelta`. Plain `json.dumps(app.config)` and Flask's default JSON provider cannot serialize it without a deliberate conversion policy. Test a default app, rather than a stripped-down mapping that hides this problem.
- Pure JSON stdout and useful stderr on error; deterministic ordering is helpful but not a substitute for correct values.

This masking behavior is a formatter for named configuration keys; do not claim it detects every secret hidden inside arbitrary strings or custom objects.

## Task C: model failure with a consistent workspace

Switch visibly to the clean Task C checkout. Configure the **model endpoint or credentials within TrueForge** as unreachable or invalid, keeping the TrueForge server itself running. Merely stopping TrueForge exercises a different connection failure. Capture before/after evidence:

```powershell
git rev-parse HEAD
git status --porcelain=v1
$beforeHelpers = (Get-FileHash -LiteralPath 'src\flask\helpers.py' -Algorithm SHA256).Hash
```

Repeat the exact Task A selected-function instruction. Interact with the editor while the request fails. Show visible bounded backoff and a clear error for the retry path. Invalid credentials should fail clearly rather than wasting repeated authentication attempts. Automatic fallback earns evidence only if a second configured model actually takes over through TrueForge; leave its proposal unapplied.

```powershell
$afterHelpers = (Get-FileHash -LiteralPath 'src\flask\helpers.py' -Algorithm SHA256).Hash
if ($beforeHelpers -ne $afterHelpers) { throw 'Task C changed helpers.py' }
git status --porcelain=v1
git diff --exit-code
if ($LASTEXITCODE -ne 0) { throw 'Task C changed tracked source' }
```

For a clean checkout, status must remain empty. The focused helper hash plus Git status/diff are demo evidence; the complete acceptance manifest should retain a bounded pre/post source hash inventory. Record actual session/turn/attempt IDs and observed model events. Do not invent a second session if fallback stays inside one session.

## Additional safety and generalization checks

Use synthetic local repositories for cancellation during streaming, read/search, review and between writes; stale proposals; dirty editors; overlapping changes; duplicate approvals; source edits after apply; and restart recovery. Show that completed user-approved changes remain explicit when a later operation is cancelled. Arbitrary project-test side effects are not restored by the source-edit journal.

The structured command catalog intentionally excludes arbitrary shells and many pytest options. Unit tests check argument bounds and reject traversal, shell tokens, path aliases and stray colons. These restrictions do not sandbox approved project code. Do not use a private/employer repository for public acceptance evidence.

Use a second configured model and an unseen small task to check portability and generalization. Record actual latency and usage; a source setting for deferred tools/compaction is not proof that the harness feature operated usefully.

## Evidence and final submission

Keep a sanitized record for each live run: workspace SHA/status, exact prompt, model/agent/harness versions, selected context and budgets, session IDs, proposal decisions, checkpoints, source hashes, command results, limitations and actual video timestamps. Review logs before publication; never include API keys, instance bearer tokens or private paths/source.

Record A, then B, then C, with each required verification, within four minutes. Keep request-to-diff continuity visible; do not cut away an instruction and substitute a prepared patch. Include real TrueForge session evidence during B. Fill the scorecard from the final video, not this rehearsal guide.

The final 1-3-page PDF must use the brief's eight headings in order: Team; Starting point; Architecture on TrueForge; How context is selected; Model setup; Scorecard; Tools used; Known limitations and what you would do with another month. It is separate from the longer project documentation. Verify the reviewed repository, video and PDF links signed out before authorized submission through the competition portal.
