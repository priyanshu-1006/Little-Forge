# 13 — Decision Register, Risk Management, Open Questions, and Sources

## 1. Decisions proposed for approval

| ID | Decision | Rationale | Revisit when |
|---|---|---|---|
| ADR-001 | TrueForge only agent runtime | Competition requirement; durable tool approvals/sessions | Never for competition build |
| ADR-002 | Provider credentials exclusively in TrueForge | Security; easy provider changes | Hosted auth architecture changes |
| ADR-003 | No vector DB in P0 | Current lexical retrieval already finds correct areas; focus Task B completion | Unseen repo benchmarks show failure |
| ADR-004 | Preserve ProposalManager safety model | Existing unit/native evidence; rewrite risk | Proven defect or broader file support required |
| ADR-005 | Clean chat + progressive disclosure | User expectation and showcase clarity | Measured usability problems |
| ADR-006 | P0 stays plain webview JS/CSS | Performance, no framework migration risk | Post-submission component complexity warrants Preact/React |
| ADR-007 | ForgeProof is evidence, not formal correctness proof | No false claims; model content isn't test result | Formal verification tooling available |
| ADR-008 | Safe retry/fallback only before side effects | Prevent duplicate tool writes and uncertain replay | Proven transactional reconciliation protocol |
| ADR-009 | Local TrueForge bound loopback only | Local no-auth default unsuitable for public endpoint | Authenticated hosted deployment |
| ADR-010 | No subagents before Task B pass | Cost/complexity can hide core failures | Measured single-agent reliability established |
| ADR-011 | Task B fixed prompts never receive answer hints | Honest generalization and competition compliance | Never for acceptance |
| ADR-012 | No permanent token dashboard | Clutter and distracting cognitive load | Advanced diagnostics only when requested |

## 2. Risk register

| Risk | Likelihood | Impact | Mitigation / owner action |
|---|---|---|---|
| Task B exploration stalls | High (recorded) | Critical | Sanitize trace, instrument loops, multi-model benchmark, strict pass gate |
| Model quota exhaustion | High with free tiers | High | Check limits before run, bounded context, avoid repeated tests, optional paid model with explicit budget |
| TrueForge latest docs differ from pinned 0.180.1 | Medium | High | Pin version, contract tests, verify any new feature locally |
| Ambiguous stream disconnection | Medium | Critical | Inspect known turn, never blind replay, revoke local grants |
| Hunk review bypass by UI changes | Medium | Critical | Keep authorization in host/ProposalManager, adversarial tests |
| CI startup failure persists | Current issue | High | Inspect actual GitHub runs/settings; clean local and external build reproduction |
| Repository remains private at deadline | Current issue | Critical | Secret/licensing review + explicit publication + signed-out check |
| Overengineering before contest | High | High | P0 gate prioritization; defer P1/P2 until B pass |
| UI hides necessary approval state | Medium | High | Review card prominent; no hiding safety actions in advanced drawer |
| UI performance under streaming | Medium | Medium | Incremental DOM and throttling; benchmark long chat |
| False “verified” report | Medium | High | Deterministic event linkage and test exit codes; explicit unverified status |
| Output leaks source/paths/keys | Medium | Critical | Scrub exports, no raw headers, explicit opt-in, threat tests |
| Approved test executes malicious code | Medium | High | User approval, trusted workspace warning, restricted profiles, future sandbox |
| Model fallback changes semantics | Medium | High | Reset/inspect session; only safe pre-effect, live tests and exact IDs |
| Multi-provider bill unexpectedly grows | Medium | Medium | Budget warnings, manual enrollment and actual cost measurement |
| Source attribution not complete | Medium | High | REUSE/third-party licenses, preserve notices, audit before public release |

## 3. Open design questions

1. Is the final UI targeted primarily at the compact VS Code sidebar or a larger editor panel? **Default decision:** sidebar-first, wider panel graceful.
2. Should Plan/Ask appear in P0? **Decision:** no, because Task B and recording have priority; P1.
3. Should source snippets appear in ForgeProof exports? **Default:** opt-in only, redacted by default.
4. What model becomes default? **Not decided**; choose by task-completion benchmark and usable quota.
5. Is external internet search a product feature? **Default:** no in P0, repository-local task scope.
6. When should fallback run? **Default:** off until a real second-model trial passes no-replay invariants.
7. Are advanced TrueForge capabilities in pinned 0.180.1 fully supported? **Must test individually**.
8. Which UI framework? **Default:** existing vanilla webview; revisit after P0.
9. How to preserve workspace snapshots for multi-root or remote workspaces? **Out of P0**; needs distinct threat model and migration.
10. What counts as proof? **Decision:** only exact on-disk hashes, actual tools, actual commands and real event IDs.

## 4. Official competition source and project sources

- Techfest TrueFoundry Forge-a-thon page: https://techfest.org/competitions/forge-a-thon — competition structure, rules, dates and deliverables (checked 14 Nov 2026).
- Official original PDF supplied by user in prior turn: https://techfest.org/media/compiProbStatement/TrueFoundry_Forge-a-thon_compressed_UvvRJ9C.pdf — PDF fetch could not be independently reopened in this documentation session; compare against the copy already used by `docs/REQUIREMENTS.md` before final submission.
- Little Forge repository: https://github.com/priyanshu-1006/Little-Forge — read at baseline commit; currently private.
- Project-specific `docs/REQUIREMENTS.md`, `docs/VERIFICATION.md`, `docs/LIVE_TEST_STATUS.md`, `evaluation/tasks.json`, `REUSE.md` — current repo evidence and constraints.

## 5. External technical references

- TrueForge repository: https://github.com/truefoundry/trueforge — model/tool/session harness, local/hosted deployment.
- TrueForge introduction: https://github.com/truefoundry/trueforge/blob/main/docs/introduction.mdx — architecture and local mode.
- TrueForge capabilities: https://github.com/truefoundry/trueforge/blob/main/docs/key-features/overview.mdx — compaction, subagents, approvals and sandbox-as-tool.
- TrueForge UI SDK reference: https://ui.trueforge.dev/ — useful design exploration, **not** a commitment to import SDK into VS Code.
- Cline Plan and Act: https://github.com/cline/cline/blob/main/docs/core-workflows/plan-and-act.mdx — separation of planning and mutation.
- Continue Plan mode: https://docs.continue.dev/ide-extensions/agent/plan-mode — enforced read-only exploration.
- Roo Code modes: https://github.com/RooCodeInc/Roo-Code-Docs/blob/main/docs/basic-usage/using-modes.md — mode-specific capabilities.
- Aider repository map: https://aider.chat/docs/repomap.html — ranking symbol/dependency context within budgets.
- Groq tool use: https://console.groq.com/docs/tool-use/overview — hosted model capabilities.
- Groq OpenAI-compatible API: https://console.groq.com/docs/openai — endpoint and compatibility caveats.
- Mistral function calling: https://docs.mistral.ai/inference/conversations/function-calling — function-capable models and schemas.
- OpenRouter docs: https://openrouter.ai/docs — alternative model selection and routing; validate exact current model and account limits before use.
- VS Code extension API: https://code.visualstudio.com/api — webview, commands, text document providers, trust, themes and CSP.
- Model Context Protocol specifications: https://modelcontextprotocol.io/specification — MCP framing and tool design reference.

## 6. Review and sign-off rubric

Mark each feature in one of four states:

- **Planned** — specified but not implemented.
- **Implemented** — code exists, tests pending.
- **Verified locally** — automated or actual native evidence recorded.
- **Competition demonstrated** — in final video with reproducible artifact and public links.

Never label an entire subsystem `done` just because its source compiles. Every release candidate must list: commit, harness/model version, tests and native evidence, known limitations, pending approvals, and whether public submission occurred.
