# Round 1 release checklist

This folder prepares the required public deliverables. A local release candidate is not a public submission.

## Source release

Generate an explicit source-only archive with Python 3:

```powershell
python scripts/package_source.py
```

The archive contains the extension's source/tests/scripts, dependency lockfile, local harness launcher, agent/model examples, licences, requirements and submission sources. Saved TrueForge state, API keys, editor profiles, model traces, Flask clones, dependencies and generated output are excluded by an allowlist. A file-by-file hash manifest and archive digest accompany it under `output/release/`.

Extract into a new directory, then validate the README from that directory:

```powershell
npm.cmd ci
npm.cmd run check
npm.cmd run package
```

Run the deterministic harness integration separately with `npm.cmd run spike -- --integration`. Configure a real provider only when performing live acceptance; no account or model key is needed for the source tests or deterministic fixture.

## Short PDF

The PDF source is `submission/writeup-data.json` plus `scripts/render-submission.py`. The public draft intentionally omits member emails. Update institution/GitHub details and the actual final video timestamps before producing the submission version. Python with ReportLab is needed only to regenerate the PDF:

```powershell
python scripts/render-submission.py
```

The result is `output/pdf/Little_Forge_Round1_Writeup_Draft.pdf`, three pages with the eight headings required by the brief. A draft with pending live evidence is not ready for portal submission.

## Final gates

Native A and C have passed the rehearsals documented in `docs/VERIFICATION.md`. A passed 42 strict checks and 35 helper tests after visible per-hunk review/apply; its native undo restored 235 hashes. C showed bounded refused-endpoint retries, visible failure, navigation after failure and unchanged hashes. These are saved captures/receipts, not the required final video. The leader's GitHub handle is confirmed; other identity fields are intentionally left for the team to update.

- Exact live A passes complete behavior/docstring checks and native review/undo is visible.
- Exact live B discovers and meaningfully changes at least three files without file hints, passes CLI tests, prints masked JSON and shows the real TrueForge session.
- Native C shows a responsive editor, clear model-endpoint failure and unchanged source/status.
- A/B/C recording is legible, in order and at most four minutes. Fill every scorecard timestamp from that exported recording.
- Confirm team information and all used model/cost/tool disclosures.
- Review starting-point declaration, MIT scope and bundled dependency notices.
- Publish the reviewed source under the intended team's GitHub account and verify access signed out.
- Publish the final PDF and video with public access, verify all three links, then complete the authorized competition-portal submission.

Registration and legal/account acceptance steps belong to the team. This project does not silently register, accept terms, upload private traces or submit a draft.
