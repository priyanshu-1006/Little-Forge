# Requirements and evidence status

This matrix maps the [TrueFoundry Forge-a-thon brief](https://techfest.org/media/compiProbStatement/TrueFoundry_Forge-a-thon_compressed_UvvRJ9C.pdf) to Little Forge. The fixed prompts and Flask pin are in the [evaluation manifest](../evaluation/tasks.json). The final narrated demo and write-up are in the [submission directory](../submission/README.md).

The new extension is separate from Little_Code's desktop product. Its runtime boundary is the local TrueForge HTTP API; model credentials and provider selection belong in TrueForge. The existing Little_Code provider loop must not be included in the submission. See [the HTTP client](../src/trueforge.ts), [editor MCP server](../src/mcp-server.ts), [tool dispatch](../src/tools.ts), and [proposal engine](../src/core/proposals.ts).

## Eligibility gates

| Gate from the brief | Required implementation or evidence | Current status |
| --- | --- | --- |
| VS Code extension is a TrueForge client | Real sessions, turns and streamed events rendered in the editor | The narrated demo shows the Task B TrueForge session and editor tool calls. |
| Harness owns the agent loop | No direct model calls or retained Little_Code loop | Architecture separates the loop; inspect final bundle and real session before claiming eligibility |
| Editor capabilities are MCP tools | Read, search, staged proposal/apply and reviewed command execution | Real harness fixture passed, and live Task B applied four approved files through TrueForge. |
| TrueForge runs locally | Reproducible pinned local startup and tested configuration | Local 0.180.1 startup and fixture configuration passed; independent clean machine pending |
| Model is configured in TrueForge | Catalog or compatible endpoint; user can switch models | Gemini Flash-Lite passed A and OpenRouter Particle-1 Free passed B. Automatic second-model fallback remains unverified. |
| Agent definition is shipped | The exact tested definition and secret-free example config | agentSpec() and wire examples included; real harness accepted generated definition |
| Declared reuse and compatible open-source license | Exact source ancestry, preserved notices and dependency licenses | Publication audit pending; package metadata alone does not prove compliance |

## Five mandatory behaviors

| Requirement | Implementation location | Acceptance needed |
| --- | --- | --- |
| Inline selected-region edit | Extension selection capture plus `SelectionScope` in proposals | Keybinding to instruction to editor diff; no change outside captured selection; per-hunk choices |
| Agent mode | TrueForge client, MCP editor tools, structured command runner | Exact Task B without named files; meaningful reviewed source/test/docs changes across at least three files |
| Context assembly | `src/core/context.ts`, workspace inventory and mention parser | `@file`, `@symbol`, automatic relevant-code retrieval; visible paths, reasons and enforced size budget |
| Diff review and undo | Immutable proposal snapshots, hunk decisions, grants, journals and guarded undo | Independently accept/reject hunks before source writes; show restoration of an applied change; preserve later manual changes |
| Streaming and cancellation | Harness events, host run revocation and cancellation-aware tools | Streaming visible and editor responsive; late events inert; no partial application after Stop |

The proposal subsystem covers selective hunks, staging, stale hashes, one-use grants, rollback, undo, file operations and inline bounds. Native A passed 42 strict checks and 35 helper tests, with all 235 hashes restored after undo. Live B passed 37 acceptance checks and 59 CLI tests. Native C showed bounded refused-endpoint retries, a visible error and unchanged source. The physical shortcut, native mid-stream Stop and final video still require evidence. See [verification status](VERIFICATION.md).

## Scoring evidence

| Criterion | Maximum | Evidence to capture |
| --- | ---: | --- |
| A1 Inline edit | 10 | Editor diff with per-hunk accept/reject controls and actual selected-region editing |
| A2 Agent mode | 10 | Three or more meaningful files discovered without file hints in Task B |
| A3 Streaming/cancellation | 10 | Immediate Stop and consistent workspace with legible streamed progress |
| B1 Context assembly | 15 | Automatic retrieval with size budget and visible file-selection reasons in Task B |
| B2 Diff safety | 10 | Per-hunk review before source writes and a working undo shown on screen |
| B3 Resilience | 10 | Task C clear failure; higher anchors require observed bounded retry/backoff or automatic second-model fallback |
| B4 TrueForge integration | 10 | Editor MCP tools, harness approval controlling review, plus a meaningful harness context feature visible in the session |
| C1 Video | 10 | A, B, C in order, visibly verified and legible within four minutes |
| C2 Write-up | 15 | Design decisions, architecture, context, model/cost setup, accurate timestamps and honest limitations |

Maximum scores are targets, not awarded points. In particular, configured deferred tools or compaction are source settings until a real session demonstrates useful operation. Do not award fallback points merely because a fallback model name is configurable.

## Scope and release checklist

Do not spend required-feature time on tab completion, model training/hosting, accounts, a hosted database/backend, Marketplace publication, or the Little_Code desktop shell. The brief excludes those from the scored scope.

The required final artifacts are a public repository, a maximum four-minute video, and a separate 1-3-page PDF with the eight specified headings. The long design dossier is supporting documentation; it is not the short submission write-up. Include every model actually used, where it ran, approximate cost, and AI coding tools used. Preserve real limitations and replace planned scorecard timestamps only after recording.

According to the supplied brief, registration closes **15 November 2026** and Round 1 submission closes **20 November 2026 at 23:59 IST**. These dates have not been independently confirmed against a live organizer notice in this implementation task. Publication, registration and submission require the user's authorized account workflow.

## Current limits that evidence must not hide

- Lexical declarations/imports and role-aware ranking are bounded heuristics, not a full language semantic graph. Mention ambiguity must be resolved visibly.
- Source mutations are bounded UTF-8 proposals. Per-file replacement and write-ahead journals do not provide an OS transaction locking every external editor across multiple files.
- Proposals cannot modify `.gitignore`, `.littleignore` or `.littleforgeignore` at any depth. Change policy separately before starting a run so a proposal cannot make its own rollback inaccessible. Corrupt checkpoint records appear as unavailable without hiding other valid checkpoints; undo still enforces current path policy.
- Hash conflicts preserve later work. Interrupted recovery can require explicit human action; an undo that has started completes its bounded recovery instead of being abandoned midway.
- Approved tests execute project code with user permissions and can have side effects. The command catalog and source fingerprints do not make an OS sandbox. The pytest catalog accepts a small set of flags and `tests/...` paths, not arbitrary shells or every pytest selector syntax.
- Dirty-editor/trust enforcement, cancellation timing, session approval behavior, model portability, fallback and clean-clone packaging need actual host/harness evidence.
- No Flask task result, live inference success, final video, public publication or portal receipt is implied by passing local unit tests.

Use [the evaluation guide](../evaluation/README.md) for the reproducible acceptance procedure.
