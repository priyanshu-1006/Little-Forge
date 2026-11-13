# Live acceptance notes

Updated 31 October 2026, IST. **The extension is built; complete competition acceptance is still pending.**

## Current state

| Requirement | Observed result |
| --- | --- |
| Saved real provider | Google provider verified through TrueForge; seven model aliases listed. |
| Real model/editor tools | Streaming, searches and fresh file reads observed. |
| Task A | Both live core and native review/apply passed 42 strict checks and 35 helper tests with Flash-Lite / medium reasoning. Native per-hunk accept/reject preview and checkpoint undo observed; 235 hashes restored. Separate core patch preserved. Physical shortcut and video remain pending. |
| Task B | Relevant files were discovered, but no verified meaningful three-file patch was completed. |
| Task C failure consistency | Native exact inline request, two bounded refused-endpoint retries, visible error and editor navigation after failure; all 235 hashes unchanged, clean Git and healthy harness. Eight assertions passed. Physical shortcut/backoff interaction and final video remain pending. |
| Native extension | Activation/commands/panel verified; full current workflow and final recording pending. |
| Submission | Repository publication, four-minute video and final scorecard/write-up are not complete. |

## Fixes prompted by real trials

1. **Windows edits:** exact replacement matching treats LF/CRLF separators as equivalent, preserves untouched bytes and local line endings, and still rejects ambiguous replacements or edits outside the immutable selection.
2. **Tool discovery:** all allowed editor schemas load up front. The pinned harness's partial-preload instruction caused unnecessary discovery calls even for already loaded tools. Sensitive tools still require approval.
3. **Quota handling:** validated retry delays are preserved before display truncation. Safe quota recovery continues the same session with successful reads, rather than replaying the original task. Two-minute wait and two-retry bounds apply; pending reviews, unknown outcomes, commands and writes block automatic replay.
4. **Daily limits:** explicit compound waits such as hours/minutes/seconds stop recovery rather than becoming short retries. Both Gemini 3.6 and 3.8 reported exhausted 20-request daily free allowances in this project. The latest 3.8 run stopped directly on that long hint; all three task checkouts stayed clean. No billing was enabled to bypass the limits.
5. **Remote cancellation:** a turn cancelled in TrueForge now surfaces cancellation instead of being reported as a completed model turn.
6. **Editor indexing:** protected Git/cache/editor noise no longer invalidates source indexing. Relevant source and ignore-policy events still invalidate, and a fresh inventory detects missed changes.
7. **Inline scope:** initial inline context now reads the exact captured selection directly, without indexing unrelated files. Fresh hash/range checks and conservative UTF-8 accounting reject stale or oversized selections without clipping. Explicit mentions remain available.
8. **Failure visibility:** a new failure appears directly below run status, above context/transcript, and scrolls into view once. A regression check covers 24 context cards and prior scrolling. Native C verified the message stayed visible while navigating the source after failure.
9. **Undo completion:** passive success/conflict notifications no longer hold the operation gate until dismissed. Native regression showed a new real model session starting while the confirmation was still present; all source stayed unchanged. The separate attempted native Stop click was interrupted by user input and is not claimed as a pass.

On 31 October, two focused Flash-Lite A proposals were rejected before apply because the exhaustive docstring still omitted empty input. The faster read/propose flow is verified, but neither attempt counts as a solved Task A. The original exact prompt was retained.

A controlled comparison with **medium reasoning** then produced complete A documentation, including unset/empty input and all false strings. Both actual hunks were explicitly reviewed and applied. The strict verifier passed **42/42 checks and 35 helper tests**. Receipt: `live-A-284fd42e-9e5c-425c-b318-0dfbeb917f9e/`; verifier: `verify-live-flask-A-2026-10-31T06-32-03-472Z.json`. The original exact prompt remained unchanged. This is headless production-core evidence, not native selection/review footage. The accepted checkout remains modified intentionally.

The subsequent **native A rehearsal** repeated the exact instruction in VS Code, showed independent hunk decisions and their native diff preview, applied through TrueForge, and passed the same 42 checks / 35 tests. Native checkpoint undo restored all 235 baseline hashes and clean Git status. Receipt: `native-task-a-20261031/summary.json`, with actual captures and UI observations. This is a rehearsal, not the final four-minute recording, and the physical shortcut was not exercised.

The subsequent medium-effort B trial still reached the 32-iteration bound while researching, without staging a patch. Receipt: `live-B-6592e47d-3413-4021-bd24-1e7ee5779efa/`. Further repetition with the same settings is not justified; the larger configured Flash models remain the next comparison when quota is usable.

## Reproduce the next acceptance attempt

Keep the existing provider key in TrueForge. Use a model with available free quota; do not repeatedly call a model whose daily limit has been exhausted. The actual account limits can be checked in AI Studio.

```powershell
npm.cmd run spike
npm.cmd run accept:live -- --task A --model google-gemini/gemini-3-8-flash --context 32768
node scripts/verify-live-flask.mjs --task A
```

Run the verifier only after a reviewed patch was actually applied. For B, use `--task B` with the exact manifest prompt and no file hints, then run the B verifier. Each runner invocation requires a clean pinned checkout; preserve an earlier accepted change or use production checkpoint undo after recording its evidence. Never reset accepted work automatically.

The verifier checks actual behavior, default Flask JSON serialization, masking of falsey/container values, configuration immutability, help, meaningful changed-path roles and existing tests. Meaningful three-file review and native selection/diff/cancellation footage require separate inspection.

Receipts under ignored `test-results/` record exact sessions, prompts, approvals, patches, checks and limits. `operator-stop.json` distinguishes deliberately stopped attempts from passes. Review and sanitize those records before publication. No provider keys belong in receipts or submission material.
