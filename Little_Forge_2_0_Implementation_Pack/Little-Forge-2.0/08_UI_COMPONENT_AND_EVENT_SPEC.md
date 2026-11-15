# 08 — UI Components, Host Protocol, and Event Projection

## 1. Recommended component tree

The extension currently uses `src/ui.js` and `src/ui.css`, plain JavaScript inside a VS Code webview. For P0 **retain this implementation and make incremental improvements**. Later, optional lightweight Preact/React may help componentization; it is not necessary for quality and adds build/migration risk. The conceptual tree below does not dictate a framework.

```text
LittleForgeWebview
├── AppHeader
│   ├── ForgeBrand (small, non-distracting)
│   ├── ModelSwitcher (friendly model label)
│   └── OverflowMenu (settings, sessions, diagnostics)
├── ChatViewport
│   ├── EmptyWelcome (when no messages)
│   ├── MessageList
│   │   ├── UserMessage
│   │   ├── AssistantMessage (streaming + code blocks)
│   │   ├── TaskActivityCard (ONE active stage)
│   │   ├── ReviewRequestCard (conditional)
│   │   ├── CommandApprovalCard (conditional)
│   │   ├── ErrorRecoveryCard (conditional)
│   │   └── ResultSummaryCard (when completed)
│   └── SmartScrollAnchor
├── ComposerDock
│   ├── ContextMentionButton
│   ├── ModeSelector (Build default, Plan/Ask P1)
│   ├── PromptTextarea
│   ├── PrimaryAction (Send / Stop depending on state)
│   └── KeyboardHint
├── OptionalDrawer (closed by default)
│   ├── ActivityTimeline
│   ├── ContextXRay
│   ├── ForgeProofReport
│   └── ConnectionSettings
└── NativeVSCodeDiff (opened outside webview)
```

## 2. Host-owned UI state model

`src/extension.ts` currently owns `UiState`, and webview receives `postMessage({type:'state',state})`. Preserve that ownership. As features grow, expose a **normalized, serializable view model** rather than raw TrueForge SSE event objects. Example proposal:

```ts
type TaskStage =
  | 'idle' | 'connecting' | 'exploring' | 'planning' | 'proposing'
  | 'awaiting-review' | 'applying' | 'verifying'
  | 'completed' | 'cancelled' | 'failed';

type UiActivity = {
  stage: TaskStage;
  headline: string;            // "Preparing changes…"
  detail?: string;             // "3 relevant areas found"
  active: boolean;
  expandable: boolean;
};

type ReviewSummary = {
  proposalId: string;
  fileCount: number;
  hunkCount: number;
  pendingCount: number;
  acceptedCount: number;
  rejectedCount: number;
  canApply: boolean;          // derived host-side from real approval state
};

type VerificationSummary = {
  status: 'not-run' | 'running' | 'passed' | 'failed' | 'partial';
  checks: Array<{name:string; exitCode?:number; status:string; verified:boolean}>;
};

type UiViewModel = {
  schemaVersion: 2;
  workspaceLabel: string;
  modelLabel?: string;
  connection: 'offline' | 'connecting' | 'online';
  messages: Array<{id:string; role:'user'|'assistant'; text:string; status?:string}>;
  activity?: UiActivity;
  review?: ReviewSummary;
  commandApproval?: {toolCallId:string; task:string; args:string[]};
  result?: {summary:string; changedFiles:string[]; verification:VerificationSummary; canUndo:boolean};
  error?: {message:string; action?:'setup'|'inspect'|'retry-safe'|'view-conflicts'};
  hasAdvancedDetails: boolean;
};
```

This is a **proposed internal contract**. Do not break the current host/webview message path without adding a versioned mapping and regression tests.

## 3. Event projection — raw telemetry to calm UI

| Incoming evidence | Default UI | Advanced timeline |
|---|---|---|
| Initial session established | `Connected` in compact header | exact session/model ID |
| `get_workspace_map` / first search | `Understanding the repository…` | tool name, arguments summary, duration |
| Files retrieved | `Found relevant source and tests` | exact paths, reasons, byte sizes |
| `read_file` repeated | No new card; continue progress | read list + dedupe reason |
| `propose_changes` returned | `Preparing changes…` then review card | file/hunk IDs and staged bytes |
| TrueForge approval required | `Waiting for your review` | exact tool-call/thread ID |
| Approval granted + apply succeeded | `Applying approved changes…` | checkpoint ID + exact paths |
| Command requested | Command approval card | command args, cwd, risk classification |
| Command executed | `Verifying changes…` | exit code, parsed test summary, output excerpt |
| Turn done + evidence finalized | Result summary | full ForgeProof receipt |
| Rate limit / stop / error | Small error/recovery card | sanitized provider error, retry hints, session IDs |

**Important:** stage is derived only from observed events. For example, `awaiting-review` requires a real pending harness approval, not merely a staged proposal. `Verifying` requires an approved command actually running. A model writing “tests pass” does not make `VerificationSummary.status='passed'`.

## 4. Interaction contracts

**Send:** validate nonempty prompt, current workspace, connection status, and active-run gating. Generate host run ID, freeze selected model, start TrueForge session.  
**Stop:** immediate local abort/revocation; host reports cancellation confirmation separately.  
**Model switch:** only when idle; switching during run must first ask user to stop or keep current.  
**Mode switch:** disabled while effectful run active.  
**Review:** open native diff, select hunks in webview or review panel, update preview, apply only when approval pending.  
**Undo:** only for recorded applied checkpoint; show conflicts distinctly.  
**Advanced drawer:** does not change run semantics; only displays already-owned evidence.

### Webview request examples (conceptual; input must be validated)

```ts
{type:'run', prompt:'...', mode:'build'}
{type:'stop'}
{type:'decide', proposalId:'...', hunkId:'...', decision:'accept'}
{type:'preview', proposalId:'...', path:'src/module.py'}
{type:'apply', proposalId:'...'}
{type:'commandDecision', toolCallId:'...', allow:true}
{type:'undo', id:'...'}
{type:'openReport', reportId:'...'} // NEW only when implemented
```

All IDs are opaque references. The host must validate them against the active run and actual pending records. The webview is **not** a trusted authorization service.

## 5. Streaming and rendering performance

- Preserve streamed message identity rather than recreating every DOM node on every 45 ms state update.
- Batch text rendering and short activity changes. Avoid code highlighting on each token.
- Use `textContent` and strict Markdown sanitation for model content. Never interpolate raw model strings as `innerHTML`.
- Focus management: preserve prompt caret during noninteractive updates; when review opens, announce politely but don't steal focus without an explicit review action.
- Smart scrolling: only scroll to new tokens when user is within a threshold of bottom; never force scroll if user is viewing earlier messages.
- Browser tests: rapid SSE events, long transcript, 24 context cards, 100+ file names, 200% zoom, width 260px, reduced motion, malicious HTML in model output.
- Timer cleanup: webview detach/recreate and session changes must not leak intervals, event listeners or stale state.

## 6. UI state examples

### Example: active request

```text
You: Add the config CLI command, tests and docs.

Little Forge: I’m checking the command structure and related tests.
  ◌ Understanding the repository…
  Found the CLI entry point and its tests.   [Details]

[ Stop ]
```

### Example: required review

```text
Little Forge: The change is ready for your review.
┌───────────────────────────────────┐
│ Review changes                   │
│ 3 files • 5 hunks                │
│ src/flask/cli.py       2 changes │
│ tests/test_cli.py      2 changes │
│ docs/cli.rst           1 change  │
│ [Open diff]  [Review now]        │
└───────────────────────────────────┘
```

### Example: final response

```text
Little Forge: Implemented the config command and added coverage.

✓ 3 files changed
✓ pytest tests/test_cli.py -q — 58 passed  (only if actually observed)
ℹ CLI masking verified on a synthetic app (only if actually observed)

[View report]     [Undo]
```

### Example: failed request

```text
Little Forge: The model endpoint is unavailable.
No unapproved edits were applied. You can choose a configured model
or inspect the TrueForge session.

[Choose model]   [Details]
```

## 7. Animation implementation guidance

CSS-only opacity/transform transitions; use `prefers-reduced-motion`. Small dynamic dot for active status, no broad neon skeletons. Animate the container at state transitions, not every token. Keep animation below ~220ms and always fast enough for a live demo.

## 8. Testing and demo requirements

UI smoke tests must assert: stable composer, correct stage text, review gating, per-hunk decisions, Stop reachable, clean summary, model text HTML inert, no token/cost by default, drawer contains advanced data when opened, keyboard access, narrow panel, focus recovery, and reduced-motion behavior. Native VS Code tests must validate actual editor commands and diff windows—not just a browser fixture.
