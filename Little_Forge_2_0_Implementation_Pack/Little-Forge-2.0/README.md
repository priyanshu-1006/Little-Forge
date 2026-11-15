# Little Forge 2.0 — Engineering Blueprint

**Version:** 1.0 planning baseline  
**Prepared:** 14 November 2026  
**Target:** TrueFoundry Forge-a-thon Round 1 + a sustainable post-competition product  
**Current repository:** https://github.com/priyanshu-1006/Little-Forge  
**Core product promise:** *Ask for a change. Watch clean progress. Approve it. Receive proof.*

> **Read this first.** This is a build specification, not a claim that all features exist. Sections and implementation tables label work as **Existing**, **Enhance**, **New**, or **Future**. The baseline is repository `main` at `b252fc4d32139edcc8a2121e358a5742b7daec04` (reviewed 14 November). No repository edits have been made as part of writing these documents.

## Non-negotiable engineering rules

1. **TrueForge owns every model call and the agent/tool execution loop.** The VS Code extension may prepare context, render UI, enforce permission decisions, execute its exposed MCP tools, and verify results. No Cline/Roo/Codex/Ollama/Groq SDK loop inside the extension.
2. **Human-owned source writes.** Every source mutation is a privately staged proposal; per-hunk review precedes a one-use approved apply. Keep existing `ProposalManager` transactions, guards, and checkpoint undo.
3. **A clean interface is a product requirement.** Default view = chat + concise progress + small changed-file summary + final report. Tool events, token counts, raw stack traces and retrieval budgets are available only through expandable details or an optional evidence view.
4. **Truthful evidence.** Model text is not proof. A pass must be derived from real execution, exit codes, clean source hashes, and correctly associated TrueForge session/tool identifiers.
5. **Benchmark before replacing known-good behavior.** Task A and C native rehearsals were documented; Task B remains unverified. Fix B before unnecessary architectural scope growth.
6. **No unsafe automatic retries.** Never replay ambiguous turns, pending approvals, commands, or applied edits. Credentials stay in local TrueForge, not source, VS Code storage or exported reports.
7. **Scope tiers matter.** Competition-critical features are marked **P0**. Production additions are **P1/P2**; they must not block the 20 November 2026 Round 1 submission.

## Document map

| Document | What it answers |
|---|---|
| `01_PRODUCT_PRD.md` | Product vision, users, use cases, scope, requirements, KPIs |
| `02_CURRENT_STATE_AND_GAP_MAP.md` | Exact existing modules, status, limitations, contest evidence |
| `03_TARGET_ARCHITECTURE.md` | End-to-end topology, boundaries, components, data flows and ADRs |
| `04_TRUEFORGE_AND_MODELS.md` | TrueForge API/harness, provider adapters, model tournament, quotas and fallback |
| `05_AGENT_WORKFLOWS_AND_CONTEXT.md` | Chat/Plan/Build/Review/Report lifecycle, progressive retrieval, stopping loops |
| `06_MCP_TOOLS_AND_SAFETY.md` | Tool contracts, approval rules, filesystem and command boundaries, undo and recovery |
| `07_UI_UX_DESIGN_SYSTEM.md` | Codex-inspired minimal design, layouts, states, microinteractions, accessible visuals |
| `08_UI_COMPONENT_AND_EVENT_SPEC.md` | UI tree, state machine, host/webview protocol, streaming aggregation, wireframes |
| `09_FORGEPROOF_AND_EVALUATION.md` | Evidence schema, acceptance, regression, benchmarks, measurements, security |
| `10_DELIVERY_ROADMAP.md` | Phase-by-phase implementation, dependencies, task owners, DoD and release gates |
| `11_ENGINEERING_STRUCTURE_AND_OPERATIONS.md` | Suggested directory layout, storage, CI, configuration, release and compatibility |
| `12_CODEX_TASK_BRIEFS.md` | Ordered copy-ready implementation briefs for Codex, with hard guardrails |
| `13_DECISIONS_RISKS_SOURCES.md` | Decision log, risks, exclusions, authoritative source register |
| `UI_REFERENCE.html` | **Optional interactive static UI reference.** No backend / no live agent connection. |

## Suggested reading path

- **Product/UI team:** 01 → 07 → 08 → 09 → 10
- **TrueForge/inference team:** 02 → 03 → 04 → 05 → 06 → 09
- **Coding agents (Codex):** 02 → 03 → 06 → 08 → 10 → 12
- **Demo/submission:** 02 → 09 → 10 → 13

## North-star interaction

1. Developer types: **“Add a masked JSON config command, its tests, and docs.”**
2. Little Forge shows one calm activity line: **“Understanding the CLI and tests…”**. Advanced telemetry stays hidden.
3. A few short human-readable updates appear: *Found 3 relevant areas* → *Preparing changes*.
4. When needed, a clear review surface appears: **“Review 3 files · 5 changes”**. Each hunk can be inspected and accepted/rejected independently.
5. The app applies only approved hunks, runs only specifically approved checks, and stays responsive.
6. Final message: **“Updated 3 files. CLI tests passed. Review details or undo.”** A full ForgeProof report is one click away.

## Competition time constraint

According to the Techfest event page: registration closes **15 Nov 2026**, Round 1 delivery is **20 Nov 2026 23:59 IST**. Required outputs: public repository, max-four-minute A/B/C demo, and 1–3-page PDF. Verify any organizer updates independently. The long docs here are development references, **not** the official short submission PDF.
