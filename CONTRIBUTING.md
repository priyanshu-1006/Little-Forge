# Contributing to Little Forge

Little Forge is a VS Code coding extension that acts as a **TrueForge client**. TrueForge runs the agent loop and every model call; the extension only exposes editor capabilities, assembles context and enforces human review before any source write. Please read [the architecture notes](docs/REQUIREMENTS.md) before changing the safety boundary.

## Requirements

- VS Code 1.96 or newer
- Node.js 22.14 or newer (Node 24 is used for the current build)
- npm
- Optional: Python 3 and `uv` for the fixed-task Flask evaluation, plus a tool-capable model configured in the local TrueForge harness

## Setup

```powershell
npm.cmd ci
npm.cmd run check
```

`npm run check` runs the TypeScript typecheck, the unit test suite and the production bundle build. On POSIX shells use `npm ci`, `npm run check`.

Run the local TrueForge harness separately when you need live model behaviour:

```powershell
npm.cmd run harness
```

It serves <http://127.0.0.1:8790> and keeps its state in the ignored `.trueforge/` directory. Credentials belong in TrueForge's own settings UI and must never be written into a tracked file.

## Repository layout

| Path | Purpose |
| --- | --- |
| `src/extension.ts` | VS Code host: commands, webview wiring, native diff preview, checkpoints |
| `src/trueforge.ts` | TrueForge HTTP client, session/turn handling, streaming, retries and fallback |
| `src/mcp-server.ts` | Editor MCP server exposing the read/search/retrieve/stage tools |
| `src/tools.ts` | Tool dispatch and the approval/grants boundary |
| `src/core/` | Workspace access, context assembly, proposals, exact replacements, commands, resilience |
| `src/ui.js`, `src/ui.css` | Webview renderer (plain JS, no framework) |
| `tests/` | `node:test` suites run through `tsx` |
| `scripts/` | Build, harness launcher, integration fixtures, UI smoke and evaluation |
| `packages/cli/` | Terminal client and npm package tooling |
| `website/` | Product website, online documentation and public downloads |
| `evaluation/` | Fixed-task acceptance guide and manifest |
| `docs/` | Requirements, verification status, live test status, free-model setup |
| `trueforge/` | Secret-free wire-format examples for the agent definition and model configuration |

## Rules that are not negotiable

1. **The harness owns the agent loop.** Do not add a direct provider client, a provider SDK call or a retained model loop to this repository.
2. **No source write without an explicit human grant.** Proposals are staged privately; every hunk needs its own Accept/Reject; a grant is single-use and is never mintable by model output.
3. **Credentials never enter the repository.** Keep API keys, bearer tokens and saved provider state in TrueForge or in ignored local files.
4. **Undo must be honest.** Undo restores the original bytes only while the current content still matches the accepted result; later manual edits surface as conflicts instead of being overwritten.
5. **Evidence must not overclaim.** `docs/VERIFICATION.md` distinguishes fixture receipts from live model results. Keep that separation in any new documentation.

## Tests

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run spike -- --integration   # deterministic fixture harness, no paid API calls
npm.cmd run test:ui                  # headless renderer checks
npm.cmd run evaluate:retrieval       # retrieval quality against the pinned Flask checkout
```

Add a focused regression test next to the behaviour you change. The suite runs on the Node built-in test runner, so a test file only needs `node:test` and `node:assert`.

## Pull requests

- Keep the change scoped to one concern and explain the behaviour it changes.
- Note any effect on the safety boundary, the context budget or the TrueForge wire schema.
- Update `docs/VERIFICATION.md` only with results you have actually observed.
- Keep local harness state, raw recordings, evaluation clones and test receipts in their ignored directories. The curated demo and downloads live under `website/public/`.

## Licence and attribution

This subproject is MIT licensed ([LICENSE](LICENSE)). It follows and adapts design patterns from Little_Code; see [REUSE.md](REUSE.md) for the exact ancestry and baseline commit. Third-party dependency notices are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
