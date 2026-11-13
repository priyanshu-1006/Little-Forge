# Round 1 recording plan

Team: **Optimistic Mutant Coders**. Team ID: **TM-648F0A5BF41**.

This is a rehearsal plan, not a completed video or a score claim. Record the actual extension and actual TrueForge session after the live tasks pass.

## Before recording

- Use the release VSIX and record its SHA-256 from the package receipt.
- Keep TrueForge 0.180.1 running locally, with credentials saved only in its settings. Choose a model whose account has enough remaining quota for the complete run.
- Prepare separate clean Flask checkouts at `22d924701a6ae2e4cd01e9a15bbaf3946094af65`; verify editable imports and the helper/CLI test baselines using the evaluation guide.
- Close unrelated panels and account pages. Keep the editor, review controls, command output and TrueForge session legible. Do not display API keys or editor MCP bearer tokens.
- Use the exact A and B prompts in `evaluation/tasks.json`. Never add expected implementation, test or documentation paths to B's prompt or mention chips.

## Planned four-minute sequence

| Planned interval | Show | Required proof |
| --- | --- | --- |
| 00:00-00:10 | Team, extension, pinned Flask identity | Correct project and release |
| 00:10-01:00 | A: select `get_debug_flag`, invoke inline edit, exact prompt, streamed proposal | Native diff and per-hunk controls before writing |
| 01:00-01:15 | Accept, verify `FLASK_DEBUG=off` returns `False`, show checkpoint undo | Actual result and restoration |
| 01:15-02:35 | B: exact prompt without file hints, context paths/reasons/budget, meaningful three-file proposal | Autonomous discovery, independent hunk review |
| 02:35-03:10 | Accept B, run CLI tests, help and synthetic app's masked JSON; briefly show actual TrueForge turns/tools | Passing checks and harness eligibility |
| 03:10-03:52 | C: clean workspace, unreachable model, exact A prompt, interact with editor, clear retry/error, unchanged status | Native responsiveness and no source mutations |
| 03:52-04:00 | Repository and PDF references, one honest limitation | Public deliverables and scope |

These are planned intervals only. Replace the scorecard's pending timestamps with positions from the final exported video. Preserve the instruction-to-diff continuity required by the brief; do not substitute a prepared patch. Keep any shortened waiting period visibly attributable to the same run and check the brief's exact editing rule before export.

## Capture checklist

- A, B, C appear in that order; each has visible verification.
- A is limited to the selected function. Its docstring lists every false case, including empty input.
- B changes at least three meaningful files, with no path hints supplied by the user.
- The required `pytest tests/test_cli.py -q` succeeds using the pinned checkout's venv. Full stdout from `flask config` parses as JSON and masks the required keys.
- Task B's actual TrueForge session is shown. A fabricated trace or deterministic test-model receipt does not qualify.
- Per-hunk accept/reject, undo, streaming and Stop are visible rather than merely described.
- Task C fails at the model endpoint while TrueForge stays running. Editor interaction and clean Git status are visible.
- Export is at most four minutes and all text remains legible.
- Final PDF contains the eight required headings and the real video timestamps. Public links open without requesting access.

## Current release gate

Native A has passed 42 strict checks and 35 helper tests after actual hunk review/apply, with checkpoint undo restoring all 235 hashes. Native C has passed its refused-endpoint rehearsal. B still needs a successful real-model three-file change and native review. Physical shortcut, native Stop, the complete A/B/C recording and useful harness compaction in B remain to be captured. Do not label the existing still captures as the required video. The final public upload and portal submission follow review of the actual repository, PDF and video.
