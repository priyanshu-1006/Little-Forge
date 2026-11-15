# 02 — Current State, Repository Inventory, and Gaps

## 1. Ground-truth baseline

Reviewed repository: `priyanshu-1006/Little-Forge`, `main` SHA `b252fc4d32139edcc8a2121e358a5742b7daec04`, private at review time. Current package version: `0.1.0`. Runtime: VS Code `^1.96.0`, Node `>=22.14.0`, TrueForge `0.180.1`, MCP SDK `1.26.0`, TypeScript `5.9.3`, `esbuild`, plain JS/CSS webview. The repository's local verification document **reports** 107 passing tests; these were not rerun in this documentation session. Two accessible GitHub Actions runs were `startup_failure` with no jobs returned. Do not mark CI healthy.

### Existing file ownership

| File | Responsibility today | V2 direction |
|---|---|---|
| `src/extension.ts` | VS Code activation, webview host, model setup, run state, approval, stop, diff, undo | Refactor into controllers gradually; maintain behavior |
| `src/trueforge.ts` | Local HTTP/SSE client, `agentSpec`, retries, approvals and session APIs | Add normalized event projection, capabilities/telemetry, contract tests |
| `src/mcp-server.ts` | Authenticated loopback MCP tools; Zod schemas | Preserve, extend only when justified |
| `src/tools.ts` | MCP dispatch, active-run guards, read hashes, one-use grants | Extract read tools and effects services if complexity grows |
| `src/core/workspace.ts` | Workspace inventory, ignored/protected paths, safe reads/search | Keep safety rules and limits |
| `src/core/context.ts` | Deterministic lexical retrieval, symbol/import associations, `@mentions`, provenance | Add better graph/plan-aware retrieval, query deduplication |
| `src/core/proposals.ts` | Immutable staging, hunk decisions, apply transactions, checkpoints, rollback | Preserve; add evidence hooks without weakening invariant |
| `src/core/commands.ts` | Approved structured checks and process handling | Extend only via catalog and test |
| `src/core/resilience.ts` | Bounded retries, failure classification, abortable waits | Expand provider-specific safe classification, metrics |
| `src/ui.js`, `src/ui.css` | Agent webview transcript, context, review, approvals, checkpoints | Redesign as minimal chat-first UI; migrate to components in stages |
| `evaluation/`, `tests/` | Fixed Flask tasks, unit/integration acceptance harness | Make reproducible multi-model experiment matrix |
| `.github/workflows/ci.yml` | Typecheck/test/build job | Resolve startup failure, add trusted local reproduction |

### Confirmed/recorded behavior versus unverified

| Capability | Evidence status | Owner implication |
|---|---|---|
| TrueForge HTTP/SSE via 0.180.1 | Source code + fixture/native reports | Freeze wire contract until verified |
| Authenticated MCP and approvals | Tests + harness fixture reports | Keep explicit review boundary |
| Task A inline, hunk review, undo | Recorded native real-model rehearsal, 42/42 strict checks, 35 helper tests | Capture final continuous video |
| Task B 3-file autonomous patch | **Not passed**: models exhausted exploration steps without staging | Highest-priority P0 failure |
| Task C model failure / unchanged source | Recorded native refused-endpoint rehearsal, 235 hashes unchanged | Show in final demo |
| Real native mid-stream Stop | Not fully proven | Dedicated live test |
| Second configured model fallback | Code path exists, not live proven | Do not claim performance or resiliency points |
| Open-source compliance | REUSE/third-party notices present; full publication audit pending | Review before public release |
| CI | Two startup failures; no verified green jobs | Fix run startup and permissions |
| Marketplace/release | VSIX script exists; no public release shown | Not required for Round 1 |

## 2. Why Task B is not solved

The static retrieval evaluation selected the expected implementation/test/docs areas, but real-model B sessions reportedly spent their 32 allowed iterations on research and repeated searches without a meaningful patch. The proper working hypothesis is *insufficient transition control from discovery to proposal*, **not** proof that a particular model is bad. The detailed local `test-results/live-B-.../receipt.json` traces are ignored by Git; obtain sanitized data before choosing a fix.

### Required diagnosis protocol

1. Parse real TrueForge session/tool events for a failed B run (locally only).
2. Build a timeline: initial context → tool names/args → result sizes → repeated reads → moment of decision/action.
3. Determine whether commands were repeatedly requested before a proposal, whether source hash reads occurred, and where remaining iteration budget was consumed.
4. Benchmark unchanged code on a second model only after a known minimal trace analysis.
5. Introduce one change at a time: progressive context, better instructions, anti-loop tool feedback, model choice, or tool schema simplification.
6. Repeat exact fixed B with no file hints, same Flask commit, clean checkout and recorded model settings.

### What we should NOT do

- Hard-code `src/flask/cli.py` / `tests/test_cli.py` / `docs/cli.rst` into production prompt or retrieval.
- Replace TrueForge's loop with an ad hoc extension-side planner that repeatedly calls providers.
- Raise iteration limits to 100 as a first response.
- Label retrieval-only coverage as Task B completion.
- Add multiple LLM agents, a vector DB, or new cloud infrastructure before baseline B passes.

## 3. Keep and strengthen

**Keep:** per-hunk immutable proposals; single-use grants; journaled apply; conflict-aware undo; selection scope; path protection; local-only harness; tool-side observation caps; SSE disconnect ambiguity handling; strict model-credential placement.

**Strengthen:** semantic test relationships, repeated-tool-call detection, model trial reproducibility, review UX, progress wording, evidence linking, minimal UI, public build verification, and CI.

## 4. Competition acceptance gate

- Public GitHub source reachable signed out.
- Real TrueForge session: no direct provider or shadow loop in extension.
- Fixed Flask `3.1.3` source SHA `22d924701a6ae2e4cd01e9a15bbaf3946094af65`.
- Task A live selection → approved code/docstring → verifier and undo.
- Task B fully autonomous *meaningful* source/test/docs patch → review → `pytest tests/test_cli.py -q` and functional `flask config` JSON masking.
- Task C genuine model endpoint failure while harness remains healthy → responsive editor, unchanged source.
- Final A/B/C max-four-minute demonstration + separate 1–3-page write-up; all timestamps grounded in the exported video.
