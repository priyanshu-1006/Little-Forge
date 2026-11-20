# Little Forge

Little Forge is a VS Code extension and terminal coding agent built on [TrueForge](https://github.com/truefoundry/trueforge). TrueForge owns the model calls and agent loop. Little Forge selects repository context, streams activity, and puts proposed edits behind per-hunk review.

[Product site](https://little-forge.vercel.app/) · [Download the VS Code extension](https://little-forge.vercel.app/download) · [npm package](https://www.npmjs.com/package/little-forge-cli) · [Round 1 demo and write-up](submission/README.md)

## Quick start

Use **Node.js 22.14+** and **VS Code 1.96+** for the extension. Run these commands in a clean clone:

```sh
npm ci
npm run harness
```

The pinned TrueForge 0.180.1 dashboard runs on [localhost:8790](http://127.0.0.1:8790). Configure a tool-capable model there or connect a supported provider from Little Forge’s model picker. Credentials stay in TrueForge’s ignored local state. See the [provider setup guide](docs/FREE_MODEL_SETUP.md) and [example model config](trueforge/model.example.json).

| Client | How to start |
| --- | --- |
| VS Code extension | Install the [VSIX](https://little-forge.vercel.app/download), open a trusted workspace, and select a configured model in Little Forge. To run from source, open this clone in VS Code and press **F5** with **Little Forge Extension**. |
| Terminal CLI | Run `npm install -g little-forge-cli`, then run `little-forge` in your project. Use `little-forge doctor` to check the harness and `little-forge models` to list configured model IDs. |

The extension loads the agent definition automatically from [`agentSpec()`](src/trueforge.ts) when it starts a TrueForge session. The [agent example](trueforge/agent.example.json) shows the wire format. The live client supplies the per-run editor connector and selected model.

## Workflows

- **Inline edit** opens with **Ctrl+Alt+I** (**Cmd+Alt+I** on macOS). Explicit selections bound the edit. With the cursor alone, Little Forge attempts to select the enclosing scope or current line.
- **Ask and Plan** use read-only repository tools. **Build** discovers relevant code, tests, and docs, then stages a proposal. Use `@file` or `@symbol` to guide context selection.
- **Review** accepts or rejects individual hunks, previews the selected result in a native diff, and applies the resolved proposal after approval. Requested project checks have their own approval controls.
- **Stop and undo** cancel active work through TrueForge and revoke outstanding grants. Accepted edits have a conflict-aware checkpoint for undo.

## Repository map

| Directory | Purpose |
| --- | --- |
| [`src/`](src/) | VS Code host, TrueForge client, editor MCP server, shared context and review, and webview |
| [`packages/cli/`](packages/cli/) | Published terminal client and packaging scripts |
| [`website/`](website/) | Product site, documentation, public demo media, and downloads |
| [`trueforge/`](trueforge/) | Agent and provider configuration examples |
| [`tests/`](tests/) and [`scripts/`](scripts/) | Unit tests, local harness launcher, builds, and integration checks |
| [`docs/`](docs/) and [`evaluation/`](evaluation/) | Architecture, verification notes, and the pinned Flask benchmark |
| [`submission/`](submission/) | Round 1 write-up and narrated demo links |

## Architecture and development

The extension and CLI open TrueForge sessions, submit turns, and render server-sent events. Authenticated MCP tools expose permitted workspace operations. TrueForge pauses for approval before applying a proposal. The client requires a one-use grant for the reviewed hunks and validates the original file hashes before writing. Local state and verification outputs are ignored by Git.

```sh
npm run check
npm run package
npm --prefix packages/cli run build
npm run spike -- --integration
```

`check` type-checks, tests, and builds the extension. `package` produces the versioned VSIX. The harness integration check uses a deterministic local fixture and needs no model API key. See [verification](docs/VERIFICATION.md), [fixed Flask evaluation](evaluation/README.md), and [contributing](CONTRIBUTING.md).

Little Forge is [MIT-licensed](LICENSE). [Upstream reuse](REUSE.md) records the Little_Code starting commit. See [third-party notices](THIRD_PARTY_NOTICES.md) for dependencies.
