# 11 — Engineering Structure, Persistence, Configuration, CI, and Release

## 1. Repository organization: incremental extraction

Current source under `src/` is small enough to support a controlled refactor. **Suggested target structure** (do not generate empty folders immediately; add per phase):

```text
Little-Forge/
├── src/
│   ├── extension.ts                # remains activation/entrypoint
│   ├── host/
│   │   ├── conversation-controller.ts    # P1
│   │   ├── view-model.ts                # P0 UX normalization
│   │   ├── event-projector.ts           # P0 small / P1 expanded
│   │   ├── webview-bridge.ts            # P1
│   │   └── model-config-service.ts      # P1
│   ├── core/
│   │   ├── context.ts                   # existing
│   │   ├── workspace.ts                 # existing
│   │   ├── proposals.ts                 # existing
│   │   ├── commands.ts                  # existing
│   │   ├── resilience.ts                # existing
│   │   ├── exact-replacements.ts        # existing
│   │   ├── types.ts                     # existing
│   │   ├── evidence.ts                  # P1
│   │   └── retrieval-graph.ts           # P1
│   ├── trueforge.ts                     # existing; adapter facade later
│   ├── mcp-server.ts                    # existing
│   ├── tools.ts                         # existing
│   ├── ui.js / ui.css                   # existing P0 UI
│   └── webview/                         # optional P1 component extraction
├── tests/                               # current + event/UI/evidence cases
├── evaluation/                          # immutable task manifest + runners
├── trueforge/                           # secret-free configuration examples
├── docs/                                # current docs + copy of this pack if adopted
├── submission/                          # short write-up + recording plan
└── .github/workflows/ci.yml
```

Do **not** replace the working extension with a Next.js app. The UI belongs in VS Code's webview, with access to `vscode.postMessage`. A web app may be a marketing showcase later, not the execution surface required by the contest.

## 2. Dependency rules

- Pin TrueForge and MCP versions during the competition; maintain a deliberate compatibility matrix.
- Use `npm ci` and commit lockfile. Do not blindly update every dependency the night before recording.
- Keep production extension bundle small; local TrueForge as a separately started service.
- Build with existing `scripts/build.mjs` / `vsce` packaging before changing bundlers.
- Any UI framework migration must be behind visual/interaction regression tests; base behavior remains unchanged until parity.

## 3. Configuration separation

**TrueForge-owned secrets/config:** provider API keys, custom endpoint credentials, model catalog authentication; TrueForge local SQLite under ignored `.trueforge/` (or chosen state path).  
**Extension-owned nonsecret config:** local harness URL, selected registered model, optional fallback registered model, verified context capacity, reasoning level, UI disclosure/theme preferences.  
**Workspace-owned:** code, project test configuration.  
**Local evidence:** ignored run receipts, potential sensitive code snippets and source path traces.

Suggested settings keys (future, subject to compatibility):

```json
{
  "littleForge.baseUrl": "http://127.0.0.1:8790",
  "littleForge.model": "",
  "littleForge.fallbackModel": "",
  "littleForge.contextTokens": 32768,
  "littleForge.reasoningEffort": "",
  "littleForge.ui.density": "comfortable",
  "littleForge.ui.showAdvancedEvents": false,
  "littleForge.ui.motion": "system",
  "littleForge.proof.exportSourceSnippets": false
}
```

Never build a form where users paste provider keys into the extension; send them to TrueForge's local settings page. Since the harness local mode is unauthenticated by default, bind strictly to loopback and do not expose a forwarded public port.

## 4. Local setup documentation

Prerequisites per repo: VS Code >=1.96, Node >=22.14, npm, configured tool-capable model in TrueForge; Python/uv for Flask evaluation only.

```powershell
# In a fresh Little-Forge clone
npm ci
npm run check
npm run harness
# Open local TrueForge UI at http://127.0.0.1:8790 and configure a provider.
# In separate terminal:
npm run package
```

Install the generated VSIX in VS Code or run the extension development host. Open a **trusted local workspace**. In Little Forge choose Connect, then pick an existing TrueForge model. Never commit populated `.trueforge` state or `.env` files.

## 5. CI/CD plan

### Required baseline job

1. Checkout source.
2. Setup pinned Node version (at least supported engine).
3. `npm ci`.
4. `npm run typecheck`.
5. `npm test`.
6. `npm run build`.
7. Optionally package VSIX and attach artifact.

### Important existing status

Two observed GitHub Actions runs ended in `startup_failure` with no job executions. This may be a workflow/account/permissions/configuration issue; **do not assert the cause without logs**. Investigate exact GitHub Actions run metadata and repository settings. Local passing tests cannot certify CI.

### Additional pipeline once stable

- Validate JSON schemata, Markdown links and Mermaid fenced blocks.
- Run deterministic TrueForge/MCP integration fixture in a suitable environment.
- UI smoke through headless Chrome or Edge; one screenshot artifact per important state.
- Secret/license scan and generated source allowlist verification.
- `npm run package` and validate VSIX contents for key leakage.
- Clean-clone install and test on Windows (primary), Linux optional.

## 6. Release branch, tags, and rollback

- Use `main` only for merged verified work; release candidate branch `release/forgeathon-round1` if useful.
- Before invasive UI changes, tag known-good baseline `v0.1.0-verified-local` only if actual tests verified.
- Every phase should produce a change log: feature, risk, tests, screenshots, provider/trial changes.
- Maintain a rollback path for each module change. Keep one daily stable demo VSIX; don't overwrite it with untested builds.
- Source archive should exclude `.trueforge/`, credentials, caches, `.venv`, `test-results`, `evaluation/workspaces`, `dist` unless needed by distribution, and generated output; use existing allowlist script.

## 7. Performance and reliability work

### UI

- Measure render time and memory with long conversation; incrementally update streamed text instead of full rerender.
- Avoid DOM elements for raw tool events in default chat. Group them in advanced drawer.
- Lazy-render reports/diffs; use native editor diff for large code.

### Context

- Cache lexical index by inventory signature; invalidate on relevant source changes, ignore watcher noise and confirm inventory freshness.
- Keep peak memory bounded; limit path counts, excerpt lengths and read sizes.
- Benchmark cold and warm retrieval on fixed and unseen repositories.

### Harness

- Handle SSE partial frames, reconnect and cancellation with deterministic tests.
- Respect provider Retry-After; longer daily-quota windows stop, not rapid retried.
- Don't treat model catalog presence as actual model readiness.

## 8. Operational diagnostics (advanced only)

A `Diagnostics` pane should display (when requested):

- VS Code and extension versions; TrueForge version and health;
- registered selected model ID (no key);
- current session ID and link to local TrueForge session;
- endpoint connectivity, MCP binding status;
- last sanitized error, retry decision, pending approval summary;
- current workspace fingerprint, tracked file count, truncated index flag;
- actual tests and source-change checkpoint state.

Offer `Export sanitized diagnostic bundle` only with user confirmation. Default does **not** include source code, personal absolute paths or provider credentials.

## 9. Security and legal checks before public release

- Verify `REUSE.md` attribution to Little_Code and exact copied/adapted code rights.
- Preserve third-party package licenses and VSIX notices.
- Remove or redact receipt data containing model API errors, token headers, private paths or prompts from personal projects.
- Avoid exporting links that contain signed URLs or access tokens.
- Confirm UI icon/assets are original or properly licensed; do not bundle font files.

## 10. Documentation maintenance

Track each doc as a living architecture spec. When code diverges, update `status` fields and relevant acceptance evidence rather than silently modifying history. Add source commit, test command, relevant CI run, and date to each major completed milestone. Append actual model comparisons to benchmark results rather than editing estimated pricing tables into “measurements”.
