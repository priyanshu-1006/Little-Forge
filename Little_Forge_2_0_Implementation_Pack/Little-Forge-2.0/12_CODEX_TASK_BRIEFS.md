# 12 — Codex Implementation Briefs (Safe, Atomic, Ready to Use)

## 0. Rules for EVERY Codex task

Paste the **Universal Contract** before any individual task. Run tasks serially until Phase 1 acceptance; avoid overlapping edits to `src/extension.ts`.

### Universal Contract

> You are improving the existing Little Forge repository, not building a new IDE or clone. Read `README.md`, `docs/REQUIREMENTS.md`, `docs/VERIFICATION.md`, `evaluation/tasks.json`, `REUSE.md`, and this documentation pack first. Current source SHA for planning reference is `b252fc4d32139edcc8a2121e358a5742b7daec04`, but verify HEAD before changing. TrueForge is the **sole** agent/tool loop. Never use a direct LLM provider SDK inside the VS Code extension. Preserve approved source-write safety: immutable proposals, per-hunk decisions, TrueForge tool approval, one-use grants, fresh SHA-256, cancellation, journals and undo. Keep all credentials in TrueForge, and no model-specific solution hints for Flask Task B. Do not replace or reset existing user changes. For every task: inspect current code, write a small plan, implement minimally, add/modify tests, run `npm run check`, explain what changed and what remains unverified. Do not claim a live model task passed without actual run evidence. Keep UI minimal and accessible; advanced token/tool telemetry hidden by default.

## Task 01 — Diagnose the Task B loop (P0)

**Prompt:**

> Inspect the actual Task B failure code paths in `src/core/context.ts`, `src/trueforge.ts`, `src/tools.ts`, `src/extension.ts`, `evaluation/README.md`, and live acceptance scripts. Do not change behavior yet. Implement a privacy-aware local trace analyzer that accepts an operator-selected sanitized TrueForge Task B receipt or trace file, and outputs a timeline: unique file reads, repeated searches, tool calls by name, result truncations, time/iterations to first proposal, pending approvals, model quota errors, and last meaningful progress. Handle missing fields gracefully and do not upload traces. Add deterministic fixture tests. Create an actionable `docs/TASK_B_ROOT_CAUSE.md` that distinguishes observed evidence from hypotheses. If receipt is unavailable, do not invent a root cause.

**Acceptance:** anonymized test traces produce counts/timeline; no behavioral changes to existing editor tools; `npm run check` green.

## Task 02 — Model setup and provider contract checks (P0)

**Prompt:**

> Enhance the nonsecret model-picker UX and compatibility tests around `ForgeClient` for providers configured **inside local TrueForge**. Do not add Groq/Mistral/OpenRouter SDK clients or key entry to Little Forge. Expose friendly model labels, true configured IDs in details, and a one-click connection test that exercises the selected model via TrueForge and a safe read-only MCP tool. Detect unsupported effort levels and clear failures. Keep current `agentSpec` and SSE semantics. Add tests for absence of model, 401/403, 429, unreachable provider and server. Document manual TrueForge setup for Groq GPT-OSS 120B and Mistral Small without committing secrets.

**Acceptance:** model switch works on configured list, direct provider code absent, error states tested. *Do not claim provider live success unless actually tested.*

## Task 03 — Progressive retrieval + non-generative anti-loop feedback (P0)

**Prompt:**

> Improve Task B agent progress while preserving generality and TrueForge ownership. Add a compact initial context strategy favoring relevant source/test/docs and structural relationships. Track repeated identical `search_workspace` and `read_file` operations per active run, with safe hash-aware detection. Surface short tool-level hints when repeated calls return no new evidence; do not force an edit, inject Flask-specific paths, or implement a model-call loop in the extension. Preserve protected paths, explicit mentions, selection-only inline behavior, index freshness, conservative budget, and clear truncation. Add synthetic tests for multiple repositories, duplicate requests, stale hashes and no information loss.

**Acceptance:** retrieval stays relevant and within budget; Task A unaffected; tool traces show repeated search reduction on controlled fixture; Task B tested unchanged and results reported honestly.

## Task 04 — Agent instruction and proposal flow audit (P0)

**Prompt:**

> Audit `agentSpec()` for 0.180.1 compatibility and Task B progress. Tighten agent-mode guidance: discover relevant implementation/test/docs; read fresh hash; stage focused exact replacements; request `apply_proposal` for human review; run only approved checks after apply. Avoid verbose repeated summaries or unbounded exploration. Do not raise iteration limit without evidence, and do not hardcode Task B target paths. Verify current snake_case API, approval and SSE behavior against pinned harness. Extend harness fixtures to assert actual proposal and approval sequencing.

**Acceptance:** deterministic fixture supports full read/stage/review/apply flow; changed instruction alone not misreported as live Task B success.

## Task 05 — Clean chat-first UI (P0)

**Prompt:**

> Refresh `src/ui.js` and `src/ui.css` to a premium, minimal, Codex-like *interaction quality* (do not copy proprietary artwork or exact design). Keep existing webview and host-owned state. Default layout: tiny Little Forge header with configured model; clean conversation; ONE aggregated activity card while running; clear review card when TrueForge approval pending; concise final files/tests/undo summary; sticky composer with Send/Stop. Hide token counts, raw tool calls, context budgets and internal IDs by default behind a Details panel. Support light/dark VS Code themes, 260px and 420px widths, keyboard, contrast and reduced motion. Preserve every existing action and native diff, avoid extra dependency/framework for this stage. Add browser UI smoke tests for all states and malicious model HTML.

**Acceptance:** screenshots of idle/running/review/done/fail; no telemetry by default; existing 7 UI smoke scenarios still pass plus new assertions.

## Task 06 — Native Stop and safe failure acceptance (P0)

**Prompt:**

> Implement a reproducible, *real native VS Code* Stop test: run a streaming turn through local TrueForge with a deterministic slow fixture; click Stop while events/tool reads are in-flight; verify immediate revocation of local grants, remote cancel request, editor responsiveness, discarded late events and unchanged or explicitly accounted source hashes. Independently test a model-endpoint refusal while harness remains online. Do not claim success from simulated `AbortController` alone; save sanitized receipt and test steps.

**Acceptance:** actual native Stop observed, no unauthorized writes, cleanup and limitations documented.

## Task 07 — Final result projection (P0)

**Prompt:**

> Create a small host-side deterministic `ResultSummary` projection from actual proposal state, command exit codes and checkpoint metadata. Show one clean final chat card with files changed, tests passed/failed/not run, report link placeholder only if implemented, and Undo. Do not claim model prose verifies tests. Handle rejected-all, partial apply, failure, cancellation, conflict and read-only answers distinctly. Keep existing safety code untouched. Test error and completion states.

**Acceptance:** summary never reports tests passed without actual success response; no false “no file changes” if earlier approved writes exist.

## Task 08 — Round 1 reproducible release (P0)

**Prompt:**

> Audit the existing `evaluation`, `submission`, `.github/workflows/ci.yml`, source archive and VSIX packaging. Diagnose GitHub Actions `startup_failure` using actual available logs/settings; do not guess. Confirm clean clone install, typecheck, unit tests and package. Run exact Flask A/B/C with true configured provider through TrueForge; do not alter evaluation prompts or add file hints. Prepare the official max-four-minute storyboard, the eight-section 1–3-page write-up and file/link checklists with placeholders for *real* evidence only. Verify license/reuse notices and secret exclusions. Do not publish or submit on my behalf without authorization.

**Acceptance:** reproducible package and cited native receipts; required links and exact video timestamps filled after recording; CI green only if actual jobs ran.

## Task 09 — ForgeProof evidence model (P1)

**Prompt:**

> Implement `src/core/evidence.ts` as an additive read-only projection of existing TrueForge events, local MCP results, proposal checkpoints and command outcomes. It must not control or approve side effects. Generate versioned schema with claimed/observed/verified distinction, `null` for unavailable usage, privacy-redacted export, and partial/cancelled/conflict states. Add tests against false model test claims, missing turn IDs and error redaction. Expose concise report in UI with an optional advanced JSON export.

**Acceptance:** report corresponds to actual events; no credentials/source body in default export; report failure cannot modify source.

## Task 10 — Context X-Ray / Flight Recorder (P1)

**Prompt:**

> Add opt-in advanced drawers: Context X-Ray (retrieved file paths, reasons, line ranges, source/test/docs roles, hidden budget) and Flight Recorder (grouped TrueForge session/MCP timeline, retry/approval/change/check events). These should be closed by default and must not push the main conversation out of view. Provide keyboard, scroll containment, reduced-motion and sanitized errors. No invented confidence values or token estimates shown as actual usage.

**Acceptance:** default clean transcript unchanged; drawer evidence real; no secret leakage; accessible test coverage.

## Task 11 — Read-only Plan mode (P1)

**Prompt:**

> Add Ask/Plan modes via distinct `agentSpec()` tool allowlists within TrueForge. Plan must expose no editing/command tools and produce a concise structured action plan. `Build this plan` starts a new authorized Build run with bounded plan artifact and **fresh** file reads; do not pass stale hashes or transfer permissions. Keep mode changes disabled while an active run is executing. Add tests that Plan cannot call `propose_changes`, `apply_proposal`, or `run_command` even with adversarial prompts.

**Acceptance:** read-only by enforcement, not merely prompt instruction; Build still requires per-hunk review.

## Task 12 — Structural retrieval research (P1)

**Prompt:**

> Benchmark current lexical context engine on Python/TypeScript/Go/Rust open-source fixtures. Build a modular import/symbol/test/docs relationship graph with current protected workspace semantics. Compare precision@K, source/test/docs coverage, cold latency, memory and Task B progression. Make Tree-sitter optional only if it yields measured benefit and has license/build support. Preserve lexical fallback for unsupported languages. Do not add embeddings/vector database without evidence.

**Acceptance:** benchmark report with measured wins/losses; no regression to selected-region semantics or protected paths.

## Task 13 — Optional TrueForge-native subagent experiment (P2)

**Prompt:**

> Evaluate the pinned TrueForge version for dynamic subagent support and tool-approval behavior. Prototype read-only research subagents for independent repository components only if supported; the *TrueForge harness* must orchestrate them. The extension must never create a second provider SDK agent loop or grant write tools to research subagents. Compare multi-file task pass rate, token cost, latency and safety to single-agent baseline. Keep feature behind default-off flag and document rollback.

**Acceptance:** measured improvement, strict permissions, no new shadow runtime. Otherwise defer.

## Task 14 — Release hardening and versioned UI contract (P1)

**Prompt:**

> After P0 acceptance is stable, extract `UiViewModel` and a versioned webview message protocol from `src/extension.ts`. Validate all incoming messages with typed schemas, preserve current behavior, and add event projection. Avoid sweeping refactor and test every state transition. Maintain existing extension activation/commands, TS build, CSP and native diff.

**Acceptance:** same native workflows; no regression in Stop/Undo/review; events remain inert after run expiration.

## Codex review protocol after every task

Require a brief response containing: summary of code paths changed, tests run with actual exit codes, UX screenshots/observations if applicable, risk and rollback note, evidence of TrueForge compliance, and explicit `not tested` items. Commit only after human review. Never accept “all set” without reproducible verification.
