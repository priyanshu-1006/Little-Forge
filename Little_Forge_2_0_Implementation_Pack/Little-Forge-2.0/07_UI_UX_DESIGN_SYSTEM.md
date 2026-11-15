# 07 — UI/UX Design System: Clean, Premium, Codex-like

## 1. The design goal

**The UI is a calm workspace, not a telemetry dashboard.** A user wants to say what to change, see that the agent is working, review when needed, and get a useful finish. The product may contain 100 kinds of technical evidence, but 95% of it belongs behind an intentional click.

### Experience hierarchy

1. **Conversation:** dominant visual element.
2. **Current activity:** a single compact, readable status in the chat.
3. **Review:** appears only when an action is required.
4. **Result:** concise completion card with changed files, test outcomes and Undo.
5. **Advanced:** context reasoning, model usage, exact tool calls and timing in a drawer or details panel—not permanent cards.

### Inspiration, not cloning

Learn minimal chat rhythm from Codex, familiar native review from VS Code, clear task stages from Cline, and read-only Plan mode from Continue. Do not copy trademarked layouts, icons, assets, logos, proprietary exact UI code, or another product's identical style.

## 2. Visual direction

**Theme name:** `Forge Mono`. Premium industrial minimalism with precise rhythm, elegant soft borders and restrained accent—not sci-fi neon or generic AI gradients.

**Colors:** derive from VS Code theme variables whenever available; define fallbacks only. Accent suggestion: restrained cool teal (`#32B8A1`) for active/positive state. Warnings warm amber, errors rose/coral. Avoid purple and strong rainbow gradients. Never use color alone to encode approval or safety.

**Light:** warm white/near-white content canvas, darker graphite text, subtle slate borders; accent reserved for primary action, focus or success.  
**Dark:** charcoal/near-black canvas, elevated graphite surfaces, warm white text, low-glare muted meta text. Do not overuse huge saturated glows.

### Proposed CSS token layer (illustrative)

```css
:root {
  --lf-font: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif;
  --lf-mono: ui-monospace, SFMono-Regular, Consolas, monospace;
  --lf-bg: var(--vscode-sideBar-background, #15181b);
  --lf-panel: var(--vscode-editor-background, #1c2024);
  --lf-text: var(--vscode-foreground, #ecf0ee);
  --lf-muted: var(--vscode-descriptionForeground, #9ba6a4);
  --lf-border: var(--vscode-panel-border, #30363b);
  --lf-accent: #32b8a1;
  --lf-error: var(--vscode-errorForeground, #f28b82);
  --lf-warning: #d7a64b;
  --lf-radius-sm: 8px;
  --lf-radius-md: 12px;
  --lf-radius-lg: 18px;
  --lf-space-1: 4px;
  --lf-space-2: 8px;
  --lf-space-3: 12px;
  --lf-space-4: 16px;
  --lf-space-6: 24px;
  --lf-motion-fast: 140ms;
  --lf-motion-normal: 220ms;
}
```

For a real extension, replace hard-coded fallback combinations as necessary using VS Code `--vscode-*` surfaces so both themes remain legible. Do not ship custom proprietary fonts with the VSIX. Use system UI and monospace fonts.

### Typography

- App name: subtle, 13–15px semibold, not an oversized hero during work.
- Conversation body: 13–14px, line-height 1.5–1.65, responsive to zoom and editor font scale.
- Primary status: 12–13px medium.
- Meta: 11–12px muted, never extremely low contrast.
- Code: monospace; syntax colors from VS Code/native diff if possible.
- Headings inside compact sidebar: 14–16px max; no large marketing splash once chatting.

## 3. Layout specification

### Regular VS Code sidebar width 320–480 px

```text
┌────────────────────────────────────────┐
│ ◇ Little Forge    [Model ▾]      [···] │  48px header
├────────────────────────────────────────┤
│                                        │
│  You                                   │
│  Add a JSON config command with tests  │
│                                        │
│  Little Forge                          │
│  I’ll inspect the CLI, tests and docs. │
│                                        │
│  ◌ Understanding the repository…       │
│    Found relevant CLI and test areas   │
│    [Show activity ▾]                   │
│                                        │
│  [Review 3 files · 5 changes]          │  Only appears when needed
│                                        │
│  ✓ Updated 3 files                     │  Only after real apply
│  Tests: 58 passed · [View report]       │  Verified only
│                                        │
│                                        │
├────────────────────────────────────────┤
│ [ Ask Little Forge…                 ] │
│ [@] [Plan ▾]         [Stop] [Send ↗]  │  Sticky composer
└────────────────────────────────────────┘
```

### Wide panel (480–900+ px)

Keep conversation width ~660–760 px max for readability. Allow an *optional* second inspection pane only when requested (Review / Context / Evidence); otherwise centered conversation with more whitespace. Never force a 3-column dashboard.

### Narrow panel (<310 px)

Collapse verbose model provider label to short alias; toolbar actions move to overflow menu. Sticky composer remains usable, hunk actions wrap, avoid horizontal scrolling. Full code diff opens native VS Code editor.

## 4. Five visible states

### A. Empty / welcome

No huge generic AI robot graphics. Simple personal line: `Make the next change with confidence.` Two compact suggestion chips: `Explain this repository`, `Improve a function`. Show connection status only if setup is required.

### B. Working / streaming

User bubble + assistant answer streaming + **one** task activity capsule. Activity text is human-readable and changes at meaningful milestones. A tiny CSS animated line/dot is enough; do not show a full-screen loader or constantly shifting cards. The user can keep reading history while it runs.

### C. Review required

Sticky, accessible review card: `Ready to review · 3 files · 5 changes` with `Open diff`, `Review now`, and `Stop`. The composer remains visually secondary until user decides. Model is paused; UI says **Waiting for your approval** rather than **Thinking…**.

### D. Completed

Assistant's natural-language reply plus concise `Changes` section: file count and 2–4 names, tests with true status, `View report`, and `Undo`. Do not repeat a huge generated patch in chat.

### E. Failed / cancelled

One inline explanation and one action: `Choose model`, `Retry safely`, `Inspect session`, or `View conflicts`. Never expose auth tokens or raw exceptions. If source was already modified, disclose that state prominently.

## 5. Progressive disclosure details

**Default view shows:**

- task request and responses;
- current stage (one line) and optionally small count: `3 files found`;
- review card only when user input needed;
- final summary with changed files, tests, and undo/report;
- model label in compact header; no technical provider details by default.

**Activity expanded shows:** meaningful milestones: searched repository, read files, prepared proposal, requested approval, ran tests. Each detail is expandable to paths and timestamps.

**Context X-Ray shows:** file relevance, reasons, lines, selected vs omitted evidence and budget details.

**Flight Recorder shows:** exact tool IDs, sessions, model change, retries, event timestamps, quota and token/cost *only when available and accurate*.

**Settings shows:** configured model, fallback toggle, reasoning effort, verified capacity, advanced diagnostics, theme/animation settings. Never a raw key field.

## 6. Motion and loading states

Use motion to communicate state, not decorate every surface. Respect `prefers-reduced-motion` and VS Code accessibility preferences.

| Moment | Motion | Duration target |
|---|---|---|
| New user bubble | Slight fade/translate 4px | 120–160ms |
| Assistant streaming | Natural text increments; small cursor only during writing | No expensive per-token animation |
| Status transition | Cross-fade short label | 140ms |
| Review card enters | Gentle vertical slide + opacity | 180–220ms |
| Drawer opens | Transform/opacity; maintain focus | 180–220ms |
| Success | Small check draw/opacity | <250ms |
| Error | Static border + message; no shaking | Immediate |
| Reduced motion | Transitions disabled; content instantly visible | 0ms |

Do not animate long multi-line diffs, code blocks or chat scroll positions during user reading. Smart-scroll only when user is near the bottom; never steal scroll on errors or model streaming.

## 7. Iconography and visual assets

Use simple outline icons with consistent 1.5–1.75px stroke. Distinctive Little Forge mark: abstract forged `LF` / angled anvil/brace motif, not a generic sparkles/robot icon. Primary visual interest comes from clean typography, structured whitespace, precise controls, and a subtle brand-colored accent line. Do not add generic tech logos in the chat.

## 8. Accessibility and international UX

- Keyboard-first: Enter to send when appropriate; Shift+Enter newline; Escape closes drawer/returns focus; Ctrl/Cmd shortcuts documented and conflict-tested.
- Clear ARIA roles, `aria-live=polite` for status; `role=alert` for critical error; no constant verbose live announcements.
- Visible focus rings, 44px touch targets where feasible, tooltips with labels, not icon-only mystery actions.
- Color contrast target WCAG AA, including muted status text and borders.
- All significant actions have text labels and confirmation semantics.
- Support long paths, long code lines, 200% zoom and narrow panel widths.
- Respect user locale for dates/numbers while preserving exact timestamp and model IDs in exported proof.

## 9. UI anti-pattern checklist

Do **not**: show token meters permanently; auto-open context drawer; show raw tool logs as chat bubbles; run multiple competing spinners; display 12 technical badges on each file; claim a zero-error code patch before verification; ask for provider key in chat; blur code diffs with translucent overlays; use slow animated page transitions; invent file relevance confidence values; bury Cancel during streaming; bury Undo after a successful apply.

## 10. Showcase walkthrough goal

A judge watching for ~20 seconds should understand the workflow: request entered → agent discovers files → review pauses → exact diff/hunk approval → verified test result → concise report. The advanced drawer can be briefly opened to show TrueForge event/session and context provenance, then closed to return to a clean chat. Showcase polish must not obscure proof.
