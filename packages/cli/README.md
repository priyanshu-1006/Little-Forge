<p align="center">
  <a href="https://little-forge.vercel.app/">
    <img src="https://little-forge.vercel.app/brand/little-forge.webp" width="120" alt="Little Forge logo">
  </a>
</p>

<h1 align="center">Little Forge CLI</h1>

<p align="center"><strong>A coding workspace for your terminal, powered by TrueForge.</strong></p>

<p align="center">
  <a href="https://little-forge.vercel.app/">Website</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#terminal-workspace">Terminal workspace</a>
</p>

<p align="center">Maintained by <a href="https://github.com/priyanshu-1006"><strong>Priyanshu Chaurasia</strong></a></p>

---

Ask questions about a repository, plan an implementation, or propose a patch. Little Forge streams the agent’s work through your local TrueForge harness and lets you approve each hunk before it changes a file.

## Quick start

**Requires Node.js 22.14 or newer and a running TrueForge harness with a tool-capable model.**

### 1. Install Little Forge

```sh
npm install -g little-forge-cli
```

### 2. Start TrueForge

If TrueForge is already running for the VS Code extension, use that instance. Otherwise, start the pinned harness in its own terminal.

```sh
HOST=127.0.0.1 npx @truefoundry/trueforge@0.180.1 --port 8790
```

In PowerShell, use these commands.

```powershell
$env:HOST = "127.0.0.1"
npx.cmd @truefoundry/trueforge@0.180.1 --port 8790
```

Open [the local TrueForge dashboard](http://127.0.0.1:8790) to configure your model and provider credentials.

### 3. Open your repository

```sh
cd my-project
little-forge doctor
little-forge
```

In PowerShell, `npm.cmd` and `little-forge.cmd` also work. Run `little-forge models` to list configured model IDs, or pass `--cwd <directory>` to select another project.

## Terminal workspace

```text
LITTLE FORGE / TERMINAL                                    ASK  PLAN  [BUILD]

    ▟██
    ███        ▄██████████▀      Little Forge
    ███       ▟███▀              Powered by TrueForge
    ███       ██▀    ▟████▀
    ██████████       ▀▀▀▀        Tab       Switch modes
    ▀▀▀▀▀▀▀███                   Ctrl+P    Browse commands
           ▀██                   @         Find files

  › Treat off as a false debug flag.
```

| Mode | What it does |
| --- | --- |
| **Ask** | Reads permitted files and answers questions about the code. |
| **Plan** | Identifies affected files and verification steps in a read-only plan. |
| **Build** | Stages a patch, opens per-hunk review, and requests separate approval for supported project checks. |

- **Tab** switches modes. **Ctrl+P** opens commands. Type **`@`** to find a workspace file and **Tab** to insert it.
- **Enter** sends a prompt or queues one follow-up. **Alt+Enter** or **Ctrl+J** adds a line.
- In a review, choose **Approve** or **Decline** with **Y/N** or the arrow keys, then press **Enter**. Decline is selected by default.
- **Esc** stops an active run or declines a pending review. **Page Up / Page Down** scroll the transcript.

Use `/models` to pick a model, `/context` to see which paths the agent used, and `/session` to open the corresponding TrueForge run. Follow-ups in the same mode and model share the active session. Use `/checkpoints` and `/undo <id>` to review and restore accepted changes.

## Commands and scripts

```sh
little-forge ask "Where are CLI commands registered?"
little-forge plan "Plan a config command and its tests."
little-forge build --preview "Treat off as a false debug flag."
little-forge context --json "Where is the debug flag tested?"
```

`build --preview` shows proposals without applying them. `--json` emits structured results and also limits Build to preview. `context` works offline and reports selected file ranges and retrieval reasons.

Use `--model <id>` or `LITTLE_FORGE_MODEL` to choose a configured model. Use `--url` or `LITTLE_FORGE_URL` for a different loopback TrueForge origin.

## How data and edits are handled

TrueForge owns the agent loop and provider connection. A hosted model receives your prompt and selected repository excerpts. Applied changes create local checkpoints. Undo checks file hashes before restoring a checkpoint so later edits are preserved.

## Maintainer

**Priyanshu Chaurasia** · [GitHub @priyanshu-1006](https://github.com/priyanshu-1006)

Released under the MIT license.
