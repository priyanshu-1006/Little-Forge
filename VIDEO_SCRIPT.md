# Techfest 2026-27 | TrueFoundry Forge-a-thon (Round 1)
# Official Demonstration Video Script & Assembly Guide

- **Team Name**: Optimistic Mutant Coders
- **Team ID**: `TM-648F0A5BF41`
- **Project**: Little Forge (TrueForge-Native VS Code Coding Agent)
- **Target Repository**: `pallets/flask` (Pinned release tag `3.1.3`, commit `22d924701a6ae2e4cd01e9a15bbaf3946094af65`)
- **Video Duration Limit**: **Maximum 4 minutes** (Strict 240 seconds ceiling)
- **Target Video Duration**: **~3 minutes 30 seconds – 3 minutes 45 seconds**
- **Public Upload Formats**: YouTube (Unlisted / Public) or Google Drive ("Anyone with the link can view")

---

## 1. Video Rules & Pacing Guidelines (from Competition Brief)

> [!IMPORTANT]
> **Strict Competition Rules (PDF Pages 5–6)**:
> 1. **Order of Tasks**: Tasks **A**, **B**, and **C** must appear in that exact chronological order, each immediately followed by its on-screen terminal verification.
> 2. **Continuous Interaction**: You may trim or speed up model thinking/waiting time, but **do not cut between submitting an instruction and the diff appearing**.
> 3. **Harness Evidence**: Show the **live TrueForge session briefly during Task B** (turns, tool calls, and model receipts).
> 4. **No Copy-Paste**: Diff must be rendered inside the editor for per-hunk review, never copy-pasted from a chat bubble.

---

## 2. Timing & Scorecard Reference Matrix

Use this table to align your pre-recorded clips in your video editor (e.g. Premiere, DaVinci Resolve, CapCut) and copy the final timestamps into Section 6 of your Round 1 PDF write-up:

| Section | Target Timestamp | Task / Criterion | Judging Scoring Anchor Hit (100/100 Total) |
|---|---|---|---|
| **Scene 0** | `0:00 - 0:25` | Intro & Architecture | **B4 (10/10)**: TrueForge harness owns loop, MCP tools, no direct provider calls |
| **Scene 1** | `0:25 - 1:15` | **Task A**: Inline Edit & Review | **A1 (10/10)**: In-editor diff + per-hunk accept/reject; **B2 (10/10)**: Checkpoint undo |
| **Scene 2** | `1:15 - 2:35` | **Task B**: Unprompted Agent Mode | **A2 (10/10)**: 3+ files discovered; **B1 (15/15)**: Budgeted context; **B4 (10/10)**: Session trace |
| **Scene 3** | `2:35 - 3:25` | **Task C**: Harness Resilience | **B3 (10/10)**: Bounded backoff/clear error, clean workspace; **A3 (10/10)**: Editor responsive |
| **Scene 4** | `3:25 - 3:45` | Summary & Links | **C1 (10/10)**: Complete, legible, verified in order within 4 minutes |

---

## 3. Scene-by-Scene Screenplay & Narration

### Scene 0: Introduction & TrueForge Architecture (`0:00 – 0:25`)
- **Visual on Screen**:
  - Full-screen capture of VS Code open to `pallets/flask` on tag `3.1.3`.
  - Little Forge sidebar panel expanded showing the green `Connected` status badge pointing to `http://127.0.0.1:8790`.
  - Title card or lower-third graphic:
    - *Little Forge | Team: Optimistic Mutant Coders (TM-648F0A5BF41)*
    - *Techfest 2026-27, IIT Bombay*
- **Voiceover / Narration**:
  > *"Hello, we are team Optimistic Mutant Coders, and this is **Little Forge** — an editor-native coding agent engineered for the TrueFoundry Forge-a-thon.*  
  > *Little Forge replaces the traditional agent loop with the open-source **TrueForge harness**. Our extension exposes editor capabilities as Model Context Protocol (MCP) tools, enforces human review before any disk write, and automatically budgets repository context.*  
  > *In this video, we demonstrate the three mandatory evaluation tasks on Flask 3.1.3 in exact order: Task A inline editing, Task B autonomous multi-file discovery, and Task C harness failure resilience."*

---

### Scene 1: Task A — Selected-Function Inline Edit (`0:25 – 1:15`)

- **Visual on Screen**:
  1. Editor active on `src/flask/helpers.py`.
  2. Cursor is positioned inside `def get_debug_flag() -> bool:`.
  3. Keybinding pressed: **`Ctrl+Alt+I`** (or **`Alt+I`**).
  4. The VS Code top input bar (`Little Forge · edit selection`) opens with `get_debug_flag` highlighted.
  5. Enter the exact prompt:
     ```text
     Treat the values 'off' and 'n' as false as well, case-insensitively, and update the docstring to list every value that is treated as false.
     ```
  6. Hit Enter. Keep interaction continuous without cutting until the diff appears.
  7. The proposed diff renders in the editor with green/red hunk highlighting:
     - Docstring lists `0`, `false`, `no`, `off`, `n`.
     - Code contains `val.lower() not in {"0", "false", "no", "off", "n"}`.
  8. Click **Accept** on the proposed hunk.
  9. Click **Undo** to show instant checkpoint restoration (demonstrating Scorecard anchor B2), then re-apply.
- **On-Screen Verification (VS Code Terminal)**:
  - Run the verification command from competition specification:
    ```powershell
    $env:FLASK_DEBUG="off"; python -c "from flask.helpers import get_debug_flag; print(get_debug_flag())"
    ```
  - Highlight the output printed in terminal: **`False`**.
- **Voiceover / Narration**:
  > *"Starting with Task A: We open `src/flask/helpers.py` and invoke Little Forge's inline edit keybinding on `get_debug_flag`.*  
  > *The extension captures an immutable SelectionScope so no edits can ever touch outside bytes. We submit the exact prompt: 'Treat the values off and n as false as well, case-insensitively, and update the docstring to list every value that is treated as false.'*  
  > *The diff streams directly into the editor for per-hunk review. We accept the hunk. To prove diff safety, Little Forge's checkpoint system allows instant one-click rollback and re-application.*  
  > *In the terminal, we set `FLASK_DEBUG=off` and run the verification command. It outputs `False`, verifying Task A is complete."*

---

### Scene 2: Task B — Autonomous Agent Mode (3+ Files Discovered) (`1:15 – 2:35`)

- **Visual on Screen**:
  1. Open the Little Forge sidebar agent panel.
  2. In the prompt area, enter the exact Task B instruction with **no file names mentioned**:
     ```text
     Add a new built-in CLI command flask config that prints the loaded application's configuration as JSON, masking the values of any key containing SECRET, PASSWORD, TOKEN or KEY as "***". It must appear in flask --help, be covered by a test, and be documented alongside the other built-in commands.
     ```
  3. Hit **Build ↗**.
  4. **Highlight Context Assembly**:
     - Expand the **Context references drawer**.
     - Show the token budget: `10,443 / 12,000 units` with ranked files and citation reasons.
     - Note the three unprompted files discovered:
       - `src/flask/cli.py` (Implementation)
       - `tests/test_cli.py` (Tests)
       - `docs/cli.rst` (Documentation)
  5. **Show TrueForge Session Trace (Mandatory PDF Requirement)**:
     - Cut briefly (5 seconds) to the terminal / TrueForge browser session viewer showing the active session turns, tool calls (`read_file`, `find_symbols`, `propose_changes`), and token usage receipts.
  6. **Diff Review & Staging**:
     - Return to editor: show multi-file diff cards for `src/flask/cli.py`, `tests/test_cli.py`, and `docs/cli.rst`.
     - Click **Open diff** on `cli.py` to inspect the Click command and JSON masking logic with `default=repr`.
     - Click **Accept All**.
- **On-Screen Verification (VS Code Terminal)**:
  - **1. Run CLI tests**:
    ```powershell
    pytest tests/test_cli.py -q
    ```
    *Output*: `59 passed in 0.26s` (highlight 0 skipped, 0 failed).
  - **2. Show Git diff stat (verifying 3 files changed)**:
    ```powershell
    git diff --stat
    ```
    *Output*: `docs/cli.rst`, `src/flask/cli.py`, `tests/test_cli.py` (3 files changed, 63 insertions).
  - **3. Verify CLI `--help`**:
    ```powershell
    flask --help
    ```
    *Output*: Under `Commands:`, show `config  Show the config for the app.`
  - **4. Run against synthetic app**:
    ```powershell
    flask --app demo_app.py config
    ```
    *Output*: Clean JSON where `SECRET_KEY`, `PASSWORD`, `API_TOKEN`, `DB_KEY` are masked as `"***"` and `PUBLIC_LABEL: "forge-demo"` is preserved.
- **Voiceover / Narration**:
  > *"Next is Task B: In the agent panel, without naming any files, we instruct Little Forge to add a built-in `flask config` CLI command with secret masking, test coverage, and documentation.*  
  > *Watch the context assembly drawer: Little Forge operates within a conservative 12,000-unit token budget, ranking lexical symbols, test pairs, and documentation hubs. Completely unprompted, it identifies all three necessary files: `src/flask/cli.py`, `tests/test_cli.py`, and `docs/cli.rst`.*  
  > *Here is the live TrueForge session briefly, showing the session turns, tool calls, and model receipts.*  
  > *The agent stages all edits for multi-file review. We inspect each hunk: the Click command registration in `cli.py`, the CLI test cases in `test_cli.py`, and the Sphinx documentation in `cli.rst`. We accept.*  
  > *Now we verify: First, `pytest tests/test_cli.py -q` passes all 59 tests with zero skips.*  
  > *Second, `git diff --stat` confirms exactly three files were modified.*  
  > *Third, `flask --help` displays our new `config` command.*  
  > *Finally, running against a synthetic Flask app produces JSON with all sensitive keys masked as `***`, satisfying Task B."*

---

### Scene 3: Task C — Harness Failure & Resilience (`2:35 – 3:25`)

- **Visual on Screen**:
  1. Open terminal and run baseline check:
     ```powershell
     git status --porcelain
     ```
     *(Clean working tree).*
  2. Configure TrueForge with an unreachable model endpoint (e.g., base URL `http://127.0.0.1:9999`) or invalid key, keeping the TrueForge server running.
  3. In editor, repeat the Task A inline edit instruction on `get_debug_flag`.
  4. While the agent connects/retries, **actively click, type, and scroll in the VS Code editor** to prove the editor thread is never blocked or frozen.
  5. Little Forge attempts bounded exponential backoff retries, then surfaces a clean, informative error notification without unhandled exceptions.
  6. Return to terminal and verify zero side effects:
     ```powershell
     git status --porcelain
     git diff --exit-code
     ```
     *(Outputs completely blank — zero files modified).*
- **Voiceover / Narration**:
  > *"For Task C, we demonstrate resilience under model failure. We point TrueForge to an unreachable model endpoint while keeping the harness active.*  
  > *Baseline git status is completely clean.*  
  > *We repeat the Task A inline edit prompt. Notice that while the agent handles connection failures with bounded backoff, the editor stays completely responsive — we can scroll, type, and navigate without UI blocking.*  
  > *The extension catches the terminal failure cleanly and displays a clear error banner.*  
  > *Running `git status` and `git diff` confirms zero files were touched and no half-applied edits were written. The workspace remains completely clean."*

---

### Scene 4: Conclusion & Submission Summary (`3:25 – 3:45`)

- **Visual on Screen**:
  - Little Forge panel overview with green connection indicator.
  - Final graphic slide:
    - **Team**: Optimistic Mutant Coders (`TM-648F0A5BF41`)
    - **GitHub**: `https://github.com/priyanshu-1006/Little-Forge`
    - **Competition**: Techfest 2026-27, IIT Bombay
- **Voiceover / Narration**:
  > *"All three evaluation tasks are complete and verified on screen:*  
  > *Task A verified with `FLASK_DEBUG=off`; Task B verified with unprompted 3-file discovery, passing pytest, and masked JSON; and Task C verified with an active, responsive editor and pristine workspace.*  
  > *Little Forge is fully open source on GitHub. Thank you!"*

---

## 4. Video Assembly Instructions for Pre-Recorded Clips

Since you already have pre-recorded clips for Tasks A, B, and C:

1. **Timeline Layout**:
   - `Clip 1 (0:00 - 0:25)`: Title slide + VS Code overview showing Little Forge panel connected.
   - `Clip 2 (0:25 - 1:15)`: Pre-recorded Task A footage + terminal verification (`FLASK_DEBUG=off ...`).
   - `Clip 3 (1:15 - 2:35)`: Pre-recorded Task B footage + context drawer + TrueForge session screenshot/clip + 4 terminal verification commands.
   - `Clip 4 (2:35 - 3:25)`: Pre-recorded Task C footage showing typing during backoff + terminal `git status`.
   - `Clip 5 (3:25 - 3:45)`: Outro slide with GitHub repo & Team ID.
2. **Speeding Up Model Waiting Time**:
   - If model generation took 15–20 seconds in your raw footage, speed up that specific segment by 2x or 3x with an on-screen "Thinking..." or "Speed x2" tag.
   - **Do not cut** between pressing Enter on the prompt and the diff appearing.
3. **Audio / Voiceover**:
   - Record the voiceover using the exact lines provided above, or add text captions if submitting without spoken voice.
4. **Final Export Specs**:
   - Resolution: 1920x1080 (1080p) at 30fps or 60fps.
   - Format: MP4 (H.264 / AAC).
   - Verify total duration is under **4 minutes** before uploading!
