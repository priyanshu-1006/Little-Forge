# Starting point and attribution

Little Forge is a new competition-focused VS Code extension inside Little_Code.

Prior project: https://github.com/priyanshu-1006/Little_Code

Inspected baseline: `87de0a55b77c742b1a6ce2c4e2ce39796894f125`.

The new implementation follows and adapts design patterns from Little_Code: protected filesystem reads, lexical repository maps, visible context reasons, privately staged proposals, host-owned acceptance and checkpoint recovery. New, focused modules were written here instead of importing its complete runtime. This ancestry must be disclosed in a competition starting-point statement; do not claim the project has no prior foundation.

| Prior source area | New implementation | Change |
| --- | --- | --- |
| `src/little/tools/workspace-service.ts` | `src/core/workspace.ts` | Narrow text-only protected reads/search and inventory |
| `src/little/context/repository-index.ts`, `retrieve-context.ts` | `src/core/context.ts` | Bounded lexical retrieval, Python relationships, RST/Markdown, explicit mentions |
| `src/little/tools/edit-proposals.ts` | `src/core/proposals.ts` | Independent hunk decisions, scoped inline edits, one-use approvals and journals |
| `src/extension/edit-review.ts` | `src/extension.ts` | Native virtual-document preview connected to TrueForge approval |
| Existing webview/message architecture | `src/extension.ts`, `src/ui.js`, `src/ui.css` | New renderer, state and review workflow |

The existing AgentRuntime, direct Groq/Ollama providers, direct-provider review workers, Code-OSS shell, desktop binaries, website, fonts and document editors are excluded. TrueForge owns all model execution and the agent/tool loop.

The MIT licence here applies to this new subproject. It does not relicense the parent repository or any third-party component. Verify rights and attribution before public submission. Upstream dependencies retain their original licences; the build includes their notices. No third-party extension fork was copied.

Development assistance: Codex, including delegated code/research/review agents. Declare this in the final competition write-up.
