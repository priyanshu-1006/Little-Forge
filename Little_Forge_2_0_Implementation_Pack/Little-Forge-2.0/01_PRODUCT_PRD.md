# 01 — Product Requirements Document (PRD)

## 1. Product definition

**Name:** Little Forge 2.0.  
**Category:** Editor-native AI coding agent powered by a local TrueForge harness.  
**Personality:** Quietly competent, fast, comprehensible, professional.  
**Positioning:** **A trustworthy coding agent with reviewable changes and verifiable outcomes.**

Little Forge should feel like a clean Codex task conversation: a developer states an outcome, sees a focused progress narrative rather than a raw event log, reviews sensitive edits in context, and receives a concise summary plus evidence. Complex work stays behind details surfaces; the screen should not look like a developer console.

### Mission

Enable developers to understand and modify unfamiliar repositories safely, with model-agnostic intelligence via TrueForge, strong contextual grounding, explicit review, and reproducible verification.

### Product principles

| Principle | Product implication | Avoid |
|---|---|---|
| One primary action at a time | Composer → progress → review → summary | Five competing action bars |
| Progressive disclosure | Ordinary users see intent/outcome; power users expand evidence | Permanent token/cost/tool call dashboards |
| Human retains control | Explainable proposal before change; independently accept/reject | “AI applied 12 files automatically” without review |
| Truthful assistant | “Tests not run” when no test executed | “All good” based on a model guess |
| Graceful failure | Clear error and one useful recovery action | Raw SDK stack trace covering the chat |
| Inspectability | From a report, open precise source and session evidence | Hiding everything for sake of minimalism |
| Performance-conscious | Smooth streaming; non-blocking editor; cached views | Rebuilding an entire workspace every turn |
| Competition compliance | All model turns go through TrueForge | Shadow agent loop or direct provider calls |

## 2. Users and jobs-to-be-done

**Primary:** Student developer working on a 10–1,000-file project. Needs natural-language changes, confidence in file selections and simple reviews.  
**Secondary:** Experienced engineer reviewing a multi-file refactor. Needs exact diffs, proof, undo, reproducible tests, and provenance.  
**Tertiary:** Hackathon judge watching a short demonstration. Needs to see real TrueForge integration, correct multi-file autonomy, human-controlled review, retry/cancel consistency, and a compelling but not crowded UI.

### Core jobs

- “Explain where the authentication flow lives.” → **Ask**: explore, cite filenames, do not modify.
- “Plan a refactor without touching files.” → **Plan**: read-only investigation and a compact plan.
- “Change this selected function.” → **Inline**: immutable selection scope, staged patch, hunk review.
- “Build an additional CLI command with tests and docs.” → **Build**: autonomous discovery, multi-file proposal, review, approved verification.
- “I changed my mind.” → **Stop / Undo**: cancel in-flight work and undo previous accepted changes without destroying later manual edits.
- “What exactly changed?” → **Report**: concise human summary and detailed machine-verifiable evidence.

## 3. Scope by tier

### P0 — Competition release

- Functional VS Code extension; local TrueForge connection and model picker.
- Inline editing with exact selected-scope enforcement.
- Autonomous task with no file hints, true multi-file source/test/docs proposal.
- Explainable, bounded context retrieval; `@file`, `@symbol` when explicitly used.
- Real TrueForge MCP tools, SSE streaming, approval pauses and safe cancellation.
- Independent hunk review, native diff, accepted changes, safe undo.
- Approved checks (`pytest`, `npm test`, typecheck, git diff check).
- Basic resilient retry/error behavior; no unsafe model replay.
- Minimal UI pass: clean chat, concise activity, review card, final summary.
- Real acceptance against fixed Flask A/B/C tasks; public code, video, short PDF.

### P1 — Distinctive polished product

- **Context X-Ray**: provenance, relevance rationale, selected/omitted evidence, accessible on demand.
- **ForgeProof**: verified result report linked to session, hunks and checks.
- **Flight Recorder**: timeline of model/tools/approvals/errors, collapsed by default.
- Structured read-only Plan mode (different TrueForge agent configuration, not separate runtime).
- Generalized repository relationship index, language-aware symbol extraction when proven useful.
- Multi-provider benchmark/fallback policy and cost audit.
- Beautiful theme-aware interface with robust keyboard, motion, empty and error states.

### P2 — Future exploration

- TrueForge-managed subagents for parallel independent analysis; measure benefit before shipping.
- Optional TrueForge sandbox-as-tool for isolated approved checks; explicit trust boundary and session linkage.
- Skills when tested with the chosen sandbox/runtime; dynamic tool loading only if tool count warrants it.
- Multi-repo workspaces, deeper AST/dependency graph, indexed historical knowledge.
- Reproducible shareable reports and optional team workflows (never needed for P0).

### Explicit non-goals

Standalone Code-OSS desktop shell, inline autocomplete, Git hosting replacement, model training, autonomous deployment, hosted accounts/database, tab-completion competitor, background unapproved edits, a custom orchestration runtime, arbitrary shell execution, hidden model charges, public publication of source or traces without developer approval.

## 4. Functional requirement catalog

| ID | Requirement | Priority | Acceptance |
|---|---|---|---|
| FR-01 | Connect to local TrueForge | P0 | Version/health/models shown; API keys not stored in extension |
| FR-02 | Select configured model | P0 | Selected model frozen per run; unsupported provider errors clear |
| FR-03 | Chat and ask | P1 | Read-only response grounded in permitted workspace, no writes |
| FR-04 | Selection-scoped inline edit | P0 | Outside-selection modifications rejected independent of model |
| FR-05 | Autonomous multi-file task | P0 | No hints; touches meaningful source, tests, docs; passes verifier |
| FR-06 | Context provenance | P0 basic / P1 rich | Files, reason, and capped budget inspectable |
| FR-07 | Streaming | P0 | Visible incremental updates without blocking editor |
| FR-08 | Cancel | P0 | Immediate local grant revocation, remote cancellation attempt, no late writes |
| FR-09 | Stage changes privately | P0 | No working tree mutation until user approval |
| FR-10 | Per-hunk decisions | P0 | Each hunk independent; preview matches chosen subset |
| FR-11 | Undo accepted change | P0 | Restore only expected hashes; flag conflicts |
| FR-12 | Approved test execution | P0 | Ask first; surface actual exit code and stdout summary |
| FR-13 | Clean final summary | P0 UI | Changed files / tests / limitations and undo action |
| FR-14 | ForgeProof report | P1 | Complete source and session evidence, privacy redaction |
| FR-15 | Read-only Plan workflow | P1 | No write/command MCP tools available in Plan |
| FR-16 | Provider fallback | P1 | Only safe pre-effect fallback, verified live with second model |
| FR-17 | Themes/accessibility | P0 baseline / P1 polish | Dark/light, keyboard, reduced motion, narrow views |
| FR-18 | Model benchmark runner | P0 internal / P1 UI | Exact task/commit/prompt, runs tagged, no false success |

## 5. Nonfunctional requirements and targets

**Targets, not current measurements.**

- Main webview cold-open visual response: target <600 ms on a typical student laptop; measure VS Code extension-host performance.
- Streaming text appears progressively without per-token full DOM replacement; target responsive interaction during model stalls.
- Button feedback within one frame; progress updates coalesced at ~60–150 ms, not raw every token.
- Context budget bounded by configured verified model capacity, including output reserve and serialization overhead.
- No outbound model traffic initiated by extension; only localhost TrueForge API traffic from client.
- No accidental file changes when a run is cancelled, rejected, expired, or the model endpoint fails.
- Every exported report includes explicit `verified` / `unverified` status for each claim.
- Any P0 workflow must have automated tests and one actual native VS Code rehearsal.

## 6. UX acceptance and success metrics

- **Clarity:** In 5 seconds a user can identify current task and whether action is required.
- **Minimalism:** Default task transcript shows at most one active progress card, plus concise milestone lines; no exposed token counts.
- **Control:** Review/Cancel/Undo always reachable within two user actions when relevant.
- **Accessibility:** All controls keyboard operable; focus visible; screen-reader live regions for status; no essential animation-only communication.
- **Task quality:** Completion rate on fixed Tasks A/B/C, with a separate score for correctness and verified evidence.
- **Agent efficiency:** Steps to first meaningful proposal, repeated tool calls, input/output tokens, elapsed time, rate-limit failures, cost per successful task.
- **Reliability:** Zero unauthorized source writes in cancellation/approval attack tests; restore conflicts surfaced, never silently overwritten.

## 7. Product voice and microcopy rules

- Prefer **“Reading the CLI files…”** over “Invoking MCP server function 04”.
- Prefer **“Ready for your review: 3 files”** over “Tool approval required thread x87”.
- Prefer **“Tests passed: 58”** only when validated command output reports exactly that; otherwise **“Checks completed”**.
- Prefer **“Couldn’t reach the model. No files were changed.”** over an exception dump.
- Don’t claim **“Secure/verified/no-risk”** unless the claim is scoped to observed checks.
- Don’t show cryptic provider IDs in the default transcript. In a menu/header show a friendly model name, while the exact ID stays inspectable.

## 8. Definition of success

A new developer can install the VSIX, connect the local TrueForge harness, choose a model, request a multi-file change, see intelligible progress, review proposed edits, run approved verification, and receive a report of what was actually done. The whole flow functions even when streaming fails, the user stops, or the model quota is exhausted—without losing control over source.
