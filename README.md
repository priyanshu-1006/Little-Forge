# Little Forge

A VS Code coding extension built specifically for the TrueFoundry Forge-a-thon. **TrueForge runs the agent. You review every source change.**

Little Forge provides selected-region inline editing, a repository-aware agent panel, explicit `@file` / `@symbol` mentions, budgeted automatic retrieval, independent hunk review, checkpoint undo, streaming and cancellation. Models are configured exclusively in local TrueForge; the extension never calls a model provider directly.

Source: <https://github.com/priyanshu-1006/Little-Forge> (MIT). This build has **not** been published to the Visual Studio Marketplace and has not been submitted to the competition portal.

## Repository layout

| Path | Purpose |
| --- | --- |
| `src/extension.ts` | VS Code host: commands, webview wiring, native diff preview, checkpoints |
| `src/trueforge.ts` | TrueForge HTTP/SSE client, agent spec, retry hints, fallback |
| `src/mcp-server.ts` | Ephemeral loopback MCP endpoint exposing the editor tools |
| `src/tools.ts` | Tool dispatch, one-use grants, observation budget |
| `src/core/` | Workspace access, context assembly, proposals, exact replacements, commands, resilience |
| `src/ui.js`, `src/ui.css` | Webview renderer (plain JavaScript, no framework) |
| `tests/` | `node:test` suites run through `tsx` |
| `scripts/` | Build, harness launcher, spike, UI smoke, evaluation and submission tooling |
| `evaluation/` | Fixed-task acceptance guide and manifest |
| `docs/` | Requirements, verification status, live test status, free-model setup |
| `trueforge/` | Secret-free wire-format examples for the agent definition and model configuration |

## Start locally

Requirements: VS Code 1.96 or newer, Node.js 22.14 or newer (Node 24 used for this build), npm and a tool-capable model configured in TrueForge. Python/uv are needed only for Flask evaluation.

```powershell
cd little-forge
npm.cmd ci
npm.cmd run check
npm.cmd run harness
```

Open **http://127.0.0.1:8790**. In **Settings → Models**, add your chosen catalog provider or OpenAI-compatible endpoint and its credentials. API keys stay in TrueForge. For a zero-spend starting point, follow the [Gemini free-tier setup](docs/FREE_MODEL_SETUP.md); provider accounts and usable free quota are required. The launcher pins harness **0.180.1**, keeps its SQLite state in ignored `.trueforge/`, binds localhost, and narrowly allows loopback MCP/model connections through its outbound guard. The local harness needs no Docker, deployed service, external database or login.

In another terminal, build/package the extension:

```powershell
npm.cmd run package
```

In VS Code choose **Extensions → … → Install from VSIX…** and select `little-forge-0.1.0.vsix`. Alternatively open this folder and press **F5** with **Little Forge Extension**, or run `Start Little Forge.cmd` on Windows. This loads a separate extension development window and does not rebuild the Little_Code desktop.

Open a trusted local repository in that window. Open **Little Forge** in the activity bar, select **Connect**, and choose a model from the configured TrueForge list. A disconnected/empty model list is shown honestly; no provider or credentials are invented.

## Use it

**Agent:** describe the change in the panel. Retrieved context cards show paths, line spans, reasons and a conservative budget. The agent can search/read more files through MCP. A source change is staged privately, then the harness pauses before `apply_proposal`.

**Inline:** select saved code (or place your cursor within a function) and press **Ctrl+I** or **Alt+I** (macOS: Cmd+I / Cmd+Alt+I), or use **Little Forge: Edit Selection**. Give the instruction. The host refuses proposals that change source outside the captured range.

**Mentions:** use the `@file` and `@symbol` buttons to choose precise references, or type `@file(path/to/file.py)` / `@symbol(path/to/file.py#name)`. Duplicate or unresolved symbols are reported. Credentials and ignored/generated files remain excluded.

**Review:** each hunk has Accept and Reject. Open **Open diff** to inspect native before/selected-result documents; changing decisions refreshes the selected preview. Finish every hunk decision, then **Apply selected hunks**. Rejecting all hunks sends a harness denial and writes nothing. Model output cannot mint an acceptance grant.

**Checks:** the agent can request structured pytest, npm test, typecheck or git diff checks. Each has a separate visible one-use approval. Tests execute project code with your user permissions and can have side effects; edit checkpoints do not roll those back.

**Undo:** use the Accepted changes cards or **Little Forge: Undo Accepted Changes**. Original content is restored only if current hashes still match the accepted result. Later manual edits become visible conflicts. Interrupted transactions can be recovered after restart. Native Ctrl+Z is not the advertised undo mechanism.

**Stop:** locally revokes grants immediately, aborts the stream, requests harness cancellation and terminates owned checks with bounded cleanup. Source writes in progress use journaled rollback. A previously completed, user-approved change remains explicit until undone.

## Workflows and evidence

- Choose **Ask** for a repository answer or **Plan** for a proposed implementation. Both use read-only tools. **Build** and inline edits stage source changes for hunk review.
- Open **Edit context** before sending to preview, pin, remove, or replace automatically selected references. Explicit mentions take precedence over automatic exclusions. Enable **Language-server links** to supplement lexical retrieval with callers, definitions, implementations, and references from installed VS Code language providers.
- During review, use **Alt+N** for the next pending hunk, **Alt+A** to accept, **Alt+R** to reject, and **Alt+Enter** to apply a resolved proposal. **Refresh proposal** reissues a stale request against current source and opens a new review. An inline selection that changed needs to be reselected.
- **Select checks** proposes commands based on affected paths. Run them once as a baseline, then use **Run same checks** after applying. Check comparisons use command outcomes. **Second opinion** submits bounded staged excerpts to a different configured TrueForge model in a session with no workspace tools.
- Set optional time, reported-token, and estimated-cost limits before sending. The cost estimate uses the blended USD rate you enter. Usage limits are checked when TrueForge reports usage, including completed requests. They can stop further work but cannot retroactively block charges already incurred.
- Export a **ForgeProof** receipt with the session IDs, reviewed patches, check results, and checkpoint IDs. The receipt includes reviewed source. **More → Open isolated worktree** opens a new worktree of committed HEAD on its own local branch. **Prepare draft PR** creates or reuses a local Little Forge branch and opens a description for review. Publishing is a separate action. **More → Demo mode** enlarges the evidence for screen recording.

## TrueForge boundary

```text
Panel / inline command -> extension session client -> local TrueForge -> configured model
                                                  -> editor MCP server
                                                     read / search / retrieve / stage
Harness approval -> hunk decisions -> one-use grant -> apply / checkpoint / approved check
```

The official HTTP API is used with its real snake_case wire schema. New requests get isolated connector credentials/endpoints and sessions; old model calls cannot enter a later run. Recent transcript text is included within a bounded input allowance. Approval responses stay in the same session and target the actual thread/tool-call IDs.

All nine editor tool schemas are loaded up front (eight in inline mode). The small tool set avoids extra discovery requests against free-provider quotas; apply and command approvals still pause in TrueForge. Sandbox, dynamic subagents, agent questions, generative UI, web search and large-output offloading are explicitly disabled because this client does not need those surfaces. Compaction and iteration limits remain configured.

The tested agent definition is produced by `agentSpec()` in `src/trueforge.ts`. `trueforge/agent.example.json` documents the wire format; connector names are filled from the current authenticated editor instance. `trueforge/model.example.json` is a placeholder example only. Do not commit credentials or use literal placeholder model names.

Optional settings: `littleForge.baseUrl`, `littleForge.model`, verified `littleForge.contextTokens`, `littleForge.reasoningEffort` and a separately configured `littleForge.fallbackModel`. Empty reasoning effort preserves the provider default; choose low/medium/high only when supported by every model you configure for that run. The selected level is frozen for retries and passed only to TrueForge. Safe terminal transient failures get at most two client retries, then an optional fallback through another TrueForge session. Unknown-outcome delivery, pending review, approved writes and commands are never replayed. The harness may also retry its own provider transport; client attempts are not a count of individual provider requests.

For rate-limit failures, valid provider retry hints are honored before retry or fallback. Safe quota recovery continues the existing session with its successful reads, instead of sending the original request again; the same review/effect guards and two-retry cap apply. Other retries and model fallback use a new session. Hints exceeding the two-minute automatic wait limit stop recovery with a clear message. Stop cancels the wait immediately. Inline mode initially reads only the exact saved selection, without a repository scan; explicit mentions can add context. Oversized or stale selections fail visibly without clipping. Exact replacements tolerate LF/CRLF differences while preserving the source's line endings and rejecting ambiguous matches.

## Verification and evidence

```powershell
npm.cmd run check
npm.cmd run spike -- --integration
npm.cmd run test:ui
npm.cmd run evaluate:retrieval
```

The real-harness spike uses its own isolated local harness and a deterministic OpenAI-compatible **test fixture**, not real model reasoning. It verifies eager MCP tool exposure, reads, staging, harness approval, apply/undo, denial, late-grant rejection, streaming cancellation and model HTTP failures. It makes no paid API calls. `test:ui` uses installed Chrome (or `FORGE_BROWSER_CHANNEL=msedge`) to exercise the exact webview renderer with message fixtures. Native host smoke is separate.

See [verification status](docs/VERIFICATION.md), [live acceptance notes](docs/LIVE_TEST_STATUS.md), [requirements and limitations](docs/REQUIREMENTS.md), and [fixed Flask evaluation](evaluation/README.md). The local Google provider is configured. Complete live A/B/C acceptance and final competition recording still require usable model quota and passing task results. Do not present fixture receipts as a solved live task.

## Starting point, licence and submission

See [REUSE.md](REUSE.md) for Little_Code ancestry and exact baseline commit, [LICENSE](LICENSE) for this subproject, and [third-party notices](THIRD_PARTY_NOTICES.md). The existing Little_Code product was not converted. No upstream agent loop or direct provider code is included. Contributions are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md).

Before submission: run the exact fixed tasks, record A/B/C in order within four minutes, show the real TrueForge session, write the required separate 1-3 page PDF, fill observed timestamps/models/costs, and verify all public links. This local build has not been submitted or uploaded to the Marketplace.
