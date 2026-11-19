import { project } from './product'

export type DocBlock =
  | { type: 'text'; value: string }
  | { type: 'list'; items: string[] }
  | { type: 'code'; label: string; value: string }
  | { type: 'note'; title: string; value: string }
  | { type: 'links'; items: { label: string; href: string }[] }

export type DocSection = { id: string; title: string; blocks: DocBlock[] }
export type DocPage = {
  slug: string; title: string; description: string; group: 'Get started' | 'Use Little Forge' | 'Reference'; sections: DocSection[]
}

const text = (value: string): DocBlock => ({ type: 'text', value })
const list = (...items: string[]): DocBlock => ({ type: 'list', items })
const code = (label: string, value: string): DocBlock => ({ type: 'code', label, value })
const note = (title: string, value: string): DocBlock => ({ type: 'note', title, value })
const links = (...items: { label: string; href: string }[]): DocBlock => ({ type: 'links', items })

export const docs: DocPage[] = [
  {
    slug: '', title: 'Introduction', group: 'Get started',
    description: 'Install the VS Code extension, start TrueForge, and make your first reviewed change.',
    sections: [
      { id: 'how-it-works', title: 'How it works', blocks: [
        text('Little Forge is a VS Code client for a local TrueForge agent. It streams the run into the editor, retrieves a bounded set of repository excerpts, and stages source edits for you to review.'),
        text('TrueForge runs the agent loop and talks to your configured model provider. A cloud model can receive the prompt and selected repository context you send from the editor.'),
        links({ label: 'Read the architecture', href: '/docs/architecture' }, { label: 'Watch the narrated walkthrough', href: '/#demo' }),
      ] },
      { id: 'first-run', title: 'Your first run', blocks: [
        list('Install the downloadable VSIX in VS Code.','Run the pinned TrueForge harness on your machine.','Configure a tool-capable model and open a trusted repository.','Try an inline edit on a saved function or use Ask mode to learn how a repository works.'),
        links({ label: 'Install Little Forge', href: '/docs/installation' }, { label: 'Configure a model', href: '/docs/models' }),
      ] },
    ],
  },
  {
    slug: 'installation', title: 'Installation', group: 'Get started',
    description: 'Install the extension and connect it to the pinned local TrueForge harness.',
    sections: [
      { id: 'requirements', title: 'Requirements', blocks: [
        list(`VS Code ${project.release.vscode} or newer.`,`Node.js ${project.release.node} or newer and npm to run the harness.`,'Git to clone the source repository and use worktree features.','A model configured in TrueForge with support for tool calls.'),
      ] },
      { id: 'install-the-vsix', title: 'Install the VSIX', blocks: [
        text('Download the VSIX. In VS Code, open Extensions, select the three-dot menu, then select Install from VSIX and choose the downloaded file.'),
        code('VS Code CLI', `code --install-extension ${project.release.filename}`),
        text('Run the CLI command from the directory containing the file, or pass its full path.'),
        links({ label: `Download Little Forge ${project.release.version}`, href: '/download' }),
      ] },
      { id: 'start-trueforge', title: 'Start TrueForge locally', blocks: [
        text('Clone the Little Forge repository and run these commands from its root. Keep that terminal running while you use the extension.'),
        code('Terminal', `git clone ${project.repository}.git\ncd Little-Forge\nnpm ci\nnpm run harness`),
        text(`The launcher pins TrueForge ${project.harness}, binds to localhost, and keeps harness state under \`.trueforge/\`. On Windows PowerShell, use \`npm.cmd\` if your shell blocks the npm PowerShell wrapper.`),
        code('Check the local harness', `curl http://127.0.0.1:${project.port}/healthz`),
      ] },
      { id: 'connect-vs-code', title: 'Connect VS Code', blocks: [
        text('Open a trusted local repository. On the Activity Bar select Little Forge, or run `Little Forge: Open Agent` from the Command Palette. Connect and choose a configured model.'),
        note('Using a different port?', `Set \`littleForge.baseUrl\` to the origin of your local TrueForge server. The normal default is \`http://127.0.0.1:${project.port}\`.`),
        links({ label: 'Set up providers and models', href: '/docs/models' }),
      ] },
    ],
  },
  {
    slug: 'models', title: 'Providers and models', group: 'Get started',
    description: 'Connect a model in TrueForge, switch providers in VS Code, and set a fallback when useful.',
    sections: [
      { id: 'configure-a-provider', title: 'Configure a provider', blocks: [
        text('Open the model button in Little Forge to open Providers & models. Use the provider setup there or select TrueForge settings to manage providers in the local harness UI.'),
        list('OpenRouter, Groq, Cohere and Vercel use credentials from their provider consoles.','Workers AI needs an account ID and an API token with access to Workers AI.','Gemini can be configured from the TrueForge settings.','Custom endpoints let you use a compatible service such as Ollama when the chosen model supports tool calls.'),
        note('Credentials belong in TrueForge', 'Submit credentials through the provider setup UI. Keep them out of prompts, source files, and shared logs.'),
      ] },
      { id: 'choose-a-model', title: 'Choose a model', blocks: [
        text('Choose a model in the picker or run `Little Forge: Choose Provider and Model`. Start with a model that can handle multiple tool calls and has enough context for the repository excerpts you plan to send.'),
        text('Free tiers differ by provider and can rate-limit a multi-step agent run. Check the limits in your provider console and use a smaller context budget when appropriate.'),
        links({ label: 'Provider setup notes', href: `${project.repository}/blob/main/docs/FREE_MODEL_SETUP.md` }),
      ] },
      { id: 'fallback', title: 'Set a fallback model', blocks: [
        text('Configure `littleForge.fallbackModel` with a second distinct model already registered in TrueForge. Little Forge can use it after eligible transient failures when replaying the request is safe.'),
        text('During a pending review, after approved writes or checks, or when delivery is uncertain, inspect the run before deciding how to proceed.'),
      ] },
    ],
  },
  {
    slug: 'workflows', title: 'Workflows', group: 'Use Little Forge',
    description: 'Work with a selected function, ask about a repository, or stage a multi-file change.',
    sections: [
      { id: 'inline-edit', title: 'Inline edit', blocks: [
        list('Save the file and select the code you want changed.','Press Ctrl+Alt+I on Windows or Linux, or Cmd+Alt+I on macOS. The Command Palette also offers Little Forge: Edit Selection.','Describe the edit. Open the native diff and decide which hunks to accept. Apply the selected hunks.'),
        code('Example request', 'Treat `off` and `n` as false values, case-insensitively, and update the docstring to match.'),
        text('The host checks that inline proposals stay inside the captured selection. Reselect the code if the file changed after the run started.'),
      ] },
      { id: 'build-ask-and-plan', title: 'Build, Ask, and Plan', blocks: [
        list('Build discovers related files and can stage a reviewed patch.','Ask answers questions about the workspace using read-only tools.','Plan produces an implementation plan using read-only tools.'),
        text('An agent request can describe the outcome without naming files. Use `@file`, `@folder`, or `@symbol` when you want to point the agent at something specific.'),
      ] },
      { id: 'inspect-context', title: 'Inspect context', blocks: [
        text('Use Edit context before you send a request to preview, pin, remove, or refresh references. Language-server links can add related symbols using the available VS Code language providers.'),
        text('During a run, Context sent shows the excerpts, reasons, and budget. Little Forge excludes ignored files and recognized credential paths from workspace retrieval.'),
      ] },
    ],
  },
  {
    slug: 'review', title: 'Review, checks, and undo', group: 'Use Little Forge',
    description: 'Review proposed hunks, approve a bounded test command, and undo an accepted change.',
    sections: [
      { id: 'review-hunks', title: 'Review hunks', blocks: [
        text('Use Open diff to compare the existing file to the selected result. Accept or reject the hunks individually, then use Apply selected hunks to write the approved edits.'),
        text('During review, use `Alt+N` for the next pending hunk, `Alt+A` to accept, `Alt+R` to reject, and `Alt+Enter` to apply a resolved proposal.'),
        text('When the underlying file changed, refresh the proposal or start a new inline edit with a new selection.'),
      ] },
      { id: 'approve-checks', title: 'Approve project checks', blocks: [
        text('Test commands have a separate approval. Inspect the command and working directory, then use Allow once or Deny. The command catalog supports structured tasks such as pytest, npm test, typecheck, and git diff checks.'),
        code('Supported pytest example', 'pytest tests/test_cli.py -q'),
        text('Use an exact pytest node ID to target a single test. The `-k` filter is outside the allowed command catalog and disables Allow once.'),
        note('Project code runs with your permissions', 'Use checks you trust. Undo restores the approved source edit when possible. Test side effects require separate cleanup.'),
      ] },
      { id: 'undo', title: 'Undo an accepted change', blocks: [
        text('Use Undo on the accepted changes card or run `Little Forge: Undo Accepted Changes`. The extension verifies that the current files still match the accepted result before restoring the original content.'),
        text('If you edited a file after applying the patch, review the reported conflict before trying again.'),
      ] },
      { id: 'tool-drawer', title: 'Tools and receipts', blocks: [
        text('The Tools drawer includes workspace Signals, Memory, Task Contract & Guard, and the matching TrueForge session. Repro to Regression is available from the composer options or the Command Palette.'),
        text('Export a ForgeProof receipt for the session IDs, reviewed patches, and check results. Review the receipt before sharing it because it contains reviewed source.'),
      ] },
    ],
  },
  {
    slug: 'architecture', title: 'Architecture', group: 'Reference',
    description: 'Follow a request from the editor through TrueForge, MCP tools, and the review gate.',
    sections: [
      { id: 'request-flow', title: 'Request flow', blocks: [
        code('Request path', 'VS Code extension\n  └─ Local TrueForge session and turn\n       ├─ Configured model provider\n       └─ Editor MCP tools\n            ├─ Read, search, and retrieve\n            └─ Propose edits and request checks'),
        text('The VS Code extension creates the session and streams turn events over HTTP. TrueForge owns inference and tool orchestration. The extension registers its editor MCP tools on loopback.'),
        text('An apply proposal pauses in TrueForge. The editor submits your hunk decisions, and a matching one-use grant allows the approved write or check.'),
      ] },
      { id: 'storage-and-recovery', title: 'Local state and recovery', blocks: [
        text('The local TrueForge instance stores sessions and provider settings. The extension records source checkpoints for accepted writes and verifies file content before rollback.'),
        text('Quota recovery and fallback use guards for pending approvals, side effects, and uncertain delivery. Stop cancels local work, requests cancellation from the harness, and revokes pending grants.'),
      ] },
      { id: 'source', title: 'Source and examples', blocks: [
        links({ label: 'Little Forge source', href: project.repository }, { label: 'TrueForge source', href: project.trueForge }, { label: 'Agent definition example', href: `${project.repository}/blob/main/trueforge/agent.example.json` }),
      ] },
    ],
  },
  {
    slug: 'troubleshooting', title: 'Troubleshooting', group: 'Reference',
    description: 'Resolve setup issues, blocked test commands, stale context, and failed model requests.',
    sections: [
      { id: 'cannot-connect', title: 'TrueForge is disconnected', blocks: [
        text('Make sure the terminal running `npm run harness` is still open. Check the local `/healthz` endpoint, then confirm that `littleForge.baseUrl` points to the running server. If the model picker is empty, configure a provider in TrueForge.'),
        links({ label: 'Open installation instructions', href: '/docs/installation#start-trueforge' }),
      ] },
      { id: 'rate-limit-or-bad-request', title: 'Provider returned 429 or 400', blocks: [
        text('For 429, inspect the provider quota and retry interval. Wait for the limit to reset or choose another configured model.'),
        text('For 400, verify the model ID and its tool-call support. If Workers AI reports 400 after a tool response, launch TrueForge using Little Forge’s `npm run harness` so its Workers AI request normalization is active.'),
      ] },
      { id: 'stale-context', title: 'Repository context changed', blocks: [
        text('Save the files you are editing and wait for any generators or formatters to settle. Retry the run so Little Forge can index the current repository. If an inline selection became stale, select it again.'),
      ] },
      { id: 'blocked-command', title: 'Allow once is disabled', blocks: [
        text('Read the command preview. If the command uses an unsupported flag such as `pytest -k`, deny that command request. Ask for a supported check or run the intended test in your own terminal after reviewing the file changes.'),
        links({ label: 'Read the supported pytest example', href: '/docs/review#approve-checks' }),
      ] },
      { id: 'resume-a-run', title: 'Resume or inspect a failed run', blocks: [
        text('Use the action shown on the error panel. Depending on the failure, you can reconnect the stream, try again, change models, or inspect the original TrueForge session. Read the error details to see what the run applied before it stopped.'),
      ] },
    ],
  },
]

export const docPath = (slug: string) => slug ? `/docs/${slug}` : '/docs'
