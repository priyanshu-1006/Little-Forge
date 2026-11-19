/* Host-owned state; model text is always rendered safely through textContent/DOM nodes. */
const vscode = acquireVsCodeApi();
let state = { status: 'idle', messages: [], context: null, proposals: [], approvals: [], checkpoints: [], activity: [], connected: false, model: '', permissionMode: 'auto', conversations: [], activeConversationId: '' };
let renderedError = null;
let errorTimer = null;
let dismissedError = null;
const $ = id => document.getElementById(id);
const send = (type, data = {}) => vscode.postMessage({ type, ...data });
const element = (tag, cls, text) => { const el = document.createElement(tag); if (cls) el.className = cls; if (text !== undefined) el.textContent = text; return el; };
function button(text, cls, action, disabled = false) { const el = element('button', cls, text); el.disabled = disabled; el.addEventListener('click', action); return el; }

const SVG_ICONS = {
  zap: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
  brain: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 4.44-2.04z"/><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-4.44-2.04z"/></svg>',
  shield: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
  flask: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2v7.31L4.17 19.34A2 2 0 0 0 5.86 22h12.28a2 2 0 0 0 1.69-2.66L14 9.31V2"/><line x1="8.5" x2="15.5" y1="2" y2="2"/><line x1="14" x2="10" y1="9.31" y2="9.31"/></svg>',
  search: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" x2="16.65" y1="21" y2="16.65"/></svg>',
  file: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>',
  folder: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>',
  edit: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>',
  terminal: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/></svg>',
  check: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
  close: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" x2="6" y1="6" y2="18"/><line x1="6" x2="18" y1="6" y2="18"/></svg>',
  plus: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" x2="12" y1="5" y2="19"/><line x1="5" x2="19" y1="12" y2="12"/></svg>',
  refresh: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/></svg>',
  stop: '<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>',
  undo: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>',
  alertTriangle: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  copy: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>',
  map: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/><line x1="9" x2="9" y1="3" y2="18"/><line x1="15" x2="15" y1="6" y2="21"/></svg>',
  book: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z"/><path d="M6 6h10"/><path d="M6 10h10"/></svg>'
};

const PERM_ICONS = {
  review: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>',
  default: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
  auto: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
  turbo: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>'
};

const PERM_CONFIG = {
  review: { iconSvg: PERM_ICONS.review, label: 'Review' },
  default: { iconSvg: PERM_ICONS.default, label: 'Default' },
  auto: { iconSvg: PERM_ICONS.auto, label: 'Auto' },
  turbo: { iconSvg: PERM_ICONS.turbo, label: 'Turbo' }
};

function getLangBadge(filePath) {
  const ext = String(filePath).split('.').pop()?.toLowerCase();
  if (ext === 'py') return { label: 'py', cls: 'py' };
  if (ext === 'js' || ext === 'cjs' || ext === 'mjs') return { label: 'js', cls: 'js' };
  if (ext === 'ts') return { label: 'ts', cls: 'ts' };
  if (ext === 'rst') return { label: 'rst', cls: 'rst' };
  if (ext === 'json') return { label: 'json', cls: 'json' };
  return null;
}

let turnStartTime = null;
let lastCompletedDuration = null;
let prevBusy = false;

function formatDuration(sec) {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function formatRelativeTime(ts) {
  if (!ts) return '';
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function getCurrentProcess(state, busy) {
  if (!busy) {
    if (state.status === 'failed') return { text: 'Execution failed', state: 'failed' };
    if (state.status === 'cancelled') return { text: 'Run stopped', state: 'cancelled' };
    return { text: 'Task completed', state: 'done' };
  }
  if (state.status === 'awaiting-review') {
    return { text: 'Awaiting your approval...', state: 'approval' };
  }
  const recentActivities = state.activity || [];
  for (let i = recentActivities.length - 1; i >= 0; i--) {
    const act = recentActivities[i].trim();
    if (act.startsWith('ran command:') || act.startsWith('run command:')) {
      const cmd = act.replace(/^(?:ran command|run command):/, '').split(' · ')[0].trim();
      if (/test|pytest|jest|vitest/.test(cmd)) return { text: 'Running tests...', detail: cmd, state: 'testing' };
      if (/tsc|typecheck|lint|build/.test(cmd)) return { text: 'Verifying build & types...', detail: cmd, state: 'verifying' };
      return { text: `Executing ${cmd.slice(0, 28)}...`, detail: cmd, state: 'executing' };
    }
    if (act.startsWith('read file:')) {
      const file = act.replace('read file:', '').trim();
      const fn = file.split(/[/\\]/).pop();
      return { text: `Reading ${fn}...`, detail: file, state: 'reading' };
    }
    if (act.startsWith('staged file:') || act.startsWith('edited file:')) {
      const file = act.replace(/^(?:staged file|edited file):/, '').trim();
      const fn = file.split(/[/\\]/).pop();
      return { text: `Editing ${fn}...`, detail: file, state: 'editing' };
    }
    if (act.startsWith('search workspace:')) {
      const q = act.replace('search workspace:', '').replace(/"/g, '').trim();
      return { text: `Searching workspace for "${q.slice(0, 22)}"...`, detail: q, state: 'searching' };
    }
    if (act.startsWith('get workspace map') || act.startsWith('get_workspace_map')) {
      return { text: 'Analyzing workspace structure...', state: 'analyzing' };
    }
    if (act.startsWith('retrieve context') || act.startsWith('retrieve_context')) {
      return { text: 'Analyzing repository context...', state: 'analyzing' };
    }
    if (act.startsWith('Context:')) {
      return { text: 'Planning implementation...', state: 'planning' };
    }
  }
  return { text: 'Thinking & analyzing...', state: 'thinking' };
}

function createDynamicLoadingElement(text) {
  const wrap = element('span', 'dynamic-loading-wrap');
  const txt = element('span', 'process-text', text);
  const dots = element('span', 'dynamic-dots');
  dots.append(element('span', '', '.'), element('span', '', '.'), element('span', '', '.'));
  wrap.append(txt, dots);
  return wrap;
}

function parseAntigravityStep(raw) {
  const text = String(raw || '').trim();
  if (text.startsWith('search workspace:')) {
    const q = text.replace('search workspace:', '').trim();
    return { type: 'search', prefix: 'Searched', text: `workspace for "${q}"`, arrow: true, detail: q };
  }
  if (text.startsWith('read file:')) {
    const p = text.replace('read file:', '').trim();
    return { type: 'read', prefix: 'Read', badge: getLangBadge(p), text: p, arrow: true, detail: p, path: p };
  }
  if (text.startsWith('edited file:')) {
    const p = text.replace('edited file:', '').trim();
    return { type: 'edit', prefix: 'Edited', badge: getLangBadge(p), text: p, arrow: false, detail: p, path: p };
  }
  if (text.startsWith('staged file:')) {
    const p = text.replace('staged file:', '').trim();
    return { type: 'stage', prefix: 'Created', badge: getLangBadge(p), text: p, arrow: false, detail: p, path: p };
  }
  if (text.startsWith('ran command:') || text.startsWith('run command:')) {
    const cmdFull = text.replace(/^(?:ran command|run command):/, '').trim();
    const parts = cmdFull.split(' · Exit code ');
    const cmd = parts[0];
    const code = parts[1];
    const suffix = code && code !== '0' ? `· Exited with code ${code}` : '';
    return { type: 'command', prefix: 'Ran', text: cmd, suffix, arrow: true, detail: cmdFull };
  }
  if (text.startsWith('Auto-allowed verification check:')) {
    const cmd = text.replace('Auto-allowed verification check:', '').trim();
    return { type: 'command', prefix: 'Ran', text: cmd, arrow: true, detail: cmd };
  }
  if (text.startsWith('get workspace map') || text.startsWith('get_workspace_map')) {
    return { type: 'map', prefix: 'Explored', text: 'workspace tree', arrow: true };
  }
  if (text.startsWith('retrieve context') || text.startsWith('retrieve_context')) {
    return { type: 'context', prefix: 'Retrieved', text: 'context evidence', arrow: true };
  }
  if (text === 'Tool result received' || text.startsWith('Context:') || text.startsWith('Reasoning effort:') || text.startsWith('Local Permissions:') || text.startsWith('Permissions set to:')) {
    return null;
  }
  return { type: 'generic', prefix: 'Ran', text: text, arrow: true };
}

function formatToolStep(raw) {
  const text = String(raw || '').trim();
  if (text.startsWith('search workspace') || text.startsWith('search_workspace')) return { iconSvg: SVG_ICONS.search, label: 'Searching workspace' };
  if (text.startsWith('read file') || text.startsWith('read_file')) return { iconSvg: SVG_ICONS.file, label: 'Reading source file' };
  if (text.startsWith('propose changes') || text.startsWith('propose_changes')) return { iconSvg: SVG_ICONS.edit, label: 'Staging multi-file changes' };
  if (text.startsWith('apply proposal') || text.startsWith('apply_proposal')) return { iconSvg: SVG_ICONS.zap, label: 'Applying approved changes' };
  if (text.startsWith('run command') || text.startsWith('run_command')) return { iconSvg: SVG_ICONS.terminal, label: 'Running project command' };
  if (text.startsWith('get workspace map') || text.startsWith('get_workspace_map')) return { iconSvg: SVG_ICONS.map, label: 'Mapping repository tree' };
  if (text.startsWith('retrieve context') || text.startsWith('retrieve_context')) return { iconSvg: SVG_ICONS.book, label: 'Retrieving context evidence' };
  if (text === 'Tool result received') return { iconSvg: SVG_ICONS.check, label: 'Tool response processed' };
  if (text.startsWith('Context:')) return { iconSvg: SVG_ICONS.file, label: text };
  return { iconSvg: SVG_ICONS.terminal, label: text };
}

function renderInlineToNodes(text) {
  const tokenRegex = /(\*\*[^*]+?\*\*|`[^`]+?`|\[[^\]]+?\]\([^)]+?\)|(?<!\*)\*[^*]+?\*(?!\*))/g;
  const parts = text.split(tokenRegex).filter(Boolean);
  const frag = document.createDocumentFragment();
  for (const part of parts) {
    if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
      const strong = element('strong', 'markdown-strong');
      strong.append(renderInlineToNodes(part.slice(2, -2)));
      frag.append(strong);
    } else if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
      const code = element('code', 'inline-code', part.slice(1, -1));
      frag.append(code);
    } else if (part.startsWith('[') && part.includes('](') && part.endsWith(')')) {
      const idx = part.indexOf('](');
      const a = element('a', 'markdown-link', part.slice(1, idx));
      a.href = part.slice(idx + 2, -1);
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      frag.append(a);
    } else if (part.startsWith('*') && part.endsWith('*') && part.length >= 2 && !part.startsWith('**')) {
      const em = element('em', '', part.slice(1, -1));
      frag.append(em);
    } else {
      frag.append(document.createTextNode(part));
    }
  }
  return frag;
}

function renderMessageContent(container, rawText) {
  const parts = rawText.split('```');
  parts.forEach((part, index) => {
    if (index % 2 === 1) {
      const firstLineBreak = part.indexOf('\n');
      const lang = firstLineBreak !== -1 ? part.slice(0, firstLineBreak).trim() : '';
      const code = firstLineBreak !== -1 ? part.slice(firstLineBreak + 1) : part;

      const wrapper = element('div', 'code-block-wrapper');
      const header = element('div', 'code-block-header');
      header.append(element('span', 'code-lang-label', lang || 'CODE'));

      const copyBtn = button('Copy', 'copy-btn', () => {
        if (navigator.clipboard) {
          navigator.clipboard.writeText(code).then(() => {
            copyBtn.textContent = 'Copied';
            setTimeout(() => { copyBtn.textContent = 'Copy'; }, 2000);
          }).catch(() => undefined);
        }
      });
      header.append(copyBtn);
      wrapper.append(header);

      const pre = element('pre', 'code-block-content');
      const codeEl = element('code', '', code);
      pre.append(codeEl);
      wrapper.append(pre);
      container.append(wrapper);
    } else {
      if (!part) return;
      const lines = part.split('\n');
      let currentList = null;
      let currentParagraph = null;

      function flushParagraph() {
        if (currentParagraph) {
          container.append(currentParagraph);
          currentParagraph = null;
        }
      }

      function flushList() {
        if (currentList) {
          container.append(currentList);
          currentList = null;
        }
      }

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        if (!trimmed) {
          flushParagraph();
          flushList();
          continue;
        }

        if (/^(\-{3,}|\*{3,})$/.test(trimmed)) {
          flushParagraph();
          flushList();
          container.append(element('hr', 'markdown-hr'));
          continue;
        }

        const headerMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
        if (headerMatch) {
          flushParagraph();
          flushList();
          const level = headerMatch[1].length;
          const h = element(`h${level}`, `markdown-h${level}`);
          h.append(renderInlineToNodes(headerMatch[2]));
          container.append(h);
          continue;
        }

        const olMatch = trimmed.match(/^(\d+)\.\s+(.+)$/);
        if (olMatch) {
          flushParagraph();
          if (!currentList || currentList.tagName.toLowerCase() !== 'ol') {
            flushList();
            currentList = element('ol', 'markdown-ol');
          }
          const li = element('li', 'markdown-li');
          li.value = Number(olMatch[1]);
          li.append(renderInlineToNodes(olMatch[2]));
          currentList.append(li);
          continue;
        }

        const ulMatch = trimmed.match(/^[\*\-]\s+(.+)$/);
        if (ulMatch) {
          flushParagraph();
          if (!currentList || currentList.tagName.toLowerCase() !== 'ul') {
            flushList();
            currentList = element('ul', 'markdown-ul');
          }
          const li = element('li', 'markdown-li');
          li.append(renderInlineToNodes(ulMatch[1]));
          currentList.append(li);
          continue;
        }

        flushList();
        if (!currentParagraph) {
          currentParagraph = element('p', 'markdown-p');
        } else {
          currentParagraph.append(element('br'));
        }
        currentParagraph.append(renderInlineToNodes(line));
      }

      flushParagraph();
      flushList();
    }
  });
}

function renderStepList(list, steps) {
  const existingRows = Array.from(list.children);
  if (existingRows.length === steps.length) {
    const lastRow = existingRows[existingRows.length - 1];
    const lastStep = steps[steps.length - 1];
    const key = `${lastStep.prefix || ''}-${lastStep.text}-${lastStep.suffix || ''}`;
    if (lastRow && lastRow.dataset.stepKey === key) {
      return;
    }
  }

  list.replaceChildren(...steps.map((step, sIdx) => {
    const key = `${step.prefix || ''}-${step.text}-${step.suffix || ''}`;
    const existing = existingRows[sIdx];
    if (existing && existing.dataset.stepKey === key) {
      return existing;
    }

    const sRow = element('div', 'work-step-row');
    sRow.dataset.stepKey = key;
    if (step.prefix) {
      sRow.append(element('span', 'work-step-prefix', step.prefix));
    }
    if (step.badge) {
      sRow.append(element('span', `lang-tag ${step.badge.cls}`, step.badge.label));
    }
    sRow.append(element('span', 'work-step-text', step.text));
    if (step.suffix) {
      sRow.append(element('span', 'work-step-suffix', ` ${step.suffix}`));
    }
    if (step.arrow) {
      sRow.append(element('span', 'work-step-arrow', '›'));
    }

    if (step.path) {
      sRow.title = `Click to inspect diff for ${step.path}`;
      sRow.addEventListener('click', e => {
        e.stopPropagation();
        send('openDiff', { path: step.path });
      });
    } else if (step.detail) {
      const detailEl = element('div', 'work-step-detail', step.detail);
      detailEl.hidden = true;
      sRow.addEventListener('click', e => {
        e.stopPropagation();
        detailEl.hidden = !detailEl.hidden;
        sRow.classList.toggle('expanded', !detailEl.hidden);
      });
      const container = element('div', 'work-step-item');
      container.dataset.stepKey = key;
      container.append(sRow, detailEl);
      return container;
    }

    return sRow;
  }));
}

function createWorkTraceElement(busy, steps) {
  const trace = element('details', 'work-trace');
  trace.open = true;

  const summary = element('summary', 'work-trace-summary');
  const timerSpan = element('span', 'work-trace-timer');
  if (busy) {
    const cur = getCurrentProcess(state, busy);
    timerSpan.replaceChildren(createDynamicLoadingElement(cur.text));
  } else {
    timerSpan.textContent = `Worked for ${formatDuration(lastCompletedDuration || 14)}`;
  }
  const twisty = element('span', 'work-trace-twisty', '▾');
  summary.append(timerSpan, twisty);
  trace.append(summary);

  if (steps.length > 0) {
    const hasEdits = steps.some(s => s.type === 'edit' || s.type === 'stage');
    const hasCmds = steps.some(s => s.type === 'command');
    const subTitle = hasEdits && hasCmds ? 'Explored files, ran commands, edited files' : hasEdits ? 'Explored files, edited files' : hasCmds ? 'Explored files, ran commands' : 'Explored files';

    const subgroup = element('details', 'work-subgroup');
    subgroup.open = true;
    const subSummary = element('summary', 'work-subgroup-summary');
    const subTitleSpan = element('span', 'subgroup-title', subTitle);
    const subTwisty = element('span', 'work-subgroup-twisty', '▾');
    subSummary.append(subTitleSpan, subTwisty);
    subgroup.append(subSummary);

    const list = element('div', 'work-steps-list');
    renderStepList(list, steps);
    subgroup.append(list);
    trace.append(subgroup);
  }

  return trace;
}

function createForgeProofCard(files, checks, checkpointId, sessionId) {
  const card = element('div', 'forgeproof-card');
  
  const header = element('div', 'forgeproof-header');
  const titleGroup = element('div', 'forgeproof-title-group');
  const badge = element('span', 'forgeproof-badge');
  badge.innerHTML = `<span class="icon-inline">${SVG_ICONS.check}</span> Verified`;
  titleGroup.append(badge, element('strong', 'forgeproof-title', 'ForgeProof Outcome'));
  header.append(titleGroup);
  card.append(header);

  if (files.length > 0) {
    const filesSection = element('div', 'forgeproof-section');
    const secLabel = element('div', 'forgeproof-section-label');
    secLabel.innerHTML = `<span class="icon-inline">${SVG_ICONS.folder}</span> ${files.length} Modified ${files.length === 1 ? 'File' : 'Files'}`;
    filesSection.append(secLabel);

    const pillList = element('div', 'forgeproof-file-list');
    for (const f of files) {
      const b = getLangBadge(f);
      const pill = element('button', 'forgeproof-file-pill');
      pill.title = `Click to inspect diff for ${f}`;
      if (b) pill.append(element('span', `lang-tag ${b.cls}`, b.label));
      pill.append(element('span', 'forgeproof-filename', f));
      pill.append(element('span', 'forgeproof-diff-action', 'Diff ↗'));
      pill.addEventListener('click', e => {
        e.stopPropagation();
        send('openDiff', { path: f });
      });
      pillList.append(pill);
    }
    filesSection.append(pillList);
    card.append(filesSection);
  }

  if (checks.length > 0) {
    const checkSection = element('div', 'forgeproof-section');
    const chkLabel = element('div', 'forgeproof-section-label');
    chkLabel.innerHTML = `<span class="icon-inline">${SVG_ICONS.check}</span> Verification Checks`;
    checkSection.append(chkLabel);
    const checkList = element('div', 'forgeproof-check-list');
    for (const c of checks) {
      const cRow = element('div', 'forgeproof-check-row');
      const chkIcon = element('span', 'check-icon');
      chkIcon.innerHTML = SVG_ICONS.check;
      cRow.append(chkIcon, element('span', 'check-text', c.text));
      checkList.append(cRow);
    }
    checkSection.append(checkList);
    card.append(checkSection);
  }

  const footer = element('div', 'forgeproof-footer');
  
  if (checkpointId) {
    const undoBtn = button('Undo Changes', 'forgeproof-action-btn undo', () => send('undo', { id: checkpointId }));
    undoBtn.innerHTML = `<span class="icon-inline">${SVG_ICONS.undo}</span> Undo Changes`;
    undoBtn.title = 'Restore workspace to checkpoint snapshot';
    footer.append(undoBtn);
  }

  if (sessionId) {
    const sessBtn = button('Session ↗', 'forgeproof-action-btn session', () => send('session'));
    sessBtn.title = 'Open TrueForge session in browser';
    footer.append(sessBtn);
  }

  const copyBtn = button('Copy Proof', 'forgeproof-action-btn copy', () => {
    const text = [
      `### Little Forge 2.0 — ForgeProof Outcome`,
      `- **Session**: \`${sessionId || 'local'}\``,
      `- **Files Changed** (${files.length}):`,
      ...files.map(f => `  - \`${f}\``),
      `- **Checks**:`,
      ...checks.map(c => `  - ${c.text}`),
      `- **Checkpoint**: \`${checkpointId || 'active'}\` (undo available)`,
      `- **Permissions**: Protected sensitive perimeter`
    ].join('\n');
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => {
        copyBtn.innerHTML = `<span class="icon-inline">${SVG_ICONS.check}</span> Copied!`;
        setTimeout(() => { copyBtn.innerHTML = `<span class="icon-inline">${SVG_ICONS.copy}</span> Copy Proof`; }, 2000);
      });
    }
  });
  copyBtn.innerHTML = `<span class="icon-inline">${SVG_ICONS.copy}</span> Copy Proof`;
  footer.append(copyBtn);

  card.append(footer);
  return card;
}

function updateActiveAssistantRow(row, message, busy, state, steps) {
  const modelTag = row.querySelector('.model-tag');
  if (modelTag && state.model) {
    modelTag.textContent = state.model.split('/').pop();
  }

  let trace = row.querySelector('.work-trace');
  if (steps.length > 0 || busy) {
    if (!trace) {
      trace = createWorkTraceElement(busy, steps);
      const body = row.querySelector('.message-body');
      row.insertBefore(trace, body);
    } else {
      // IN-PLACE UPDATE: Never touch trace.open or subgroup.open! User's toggle state is 100% preserved.
      const timerSpan = trace.querySelector('.work-trace-timer');
      if (timerSpan) {
        if (busy) {
          const cur = getCurrentProcess(state, busy);
          timerSpan.replaceChildren(createDynamicLoadingElement(cur.text));
        } else {
          timerSpan.textContent = `Worked for ${formatDuration(lastCompletedDuration || 14)}`;
        }
      }

      let subgroup = trace.querySelector('.work-subgroup');
      if (steps.length > 0) {
        const hasEdits = steps.some(s => s.type === 'edit' || s.type === 'stage');
        const hasCmds = steps.some(s => s.type === 'command');
        const subTitle = hasEdits && hasCmds ? 'Explored files, ran commands, edited files' : hasEdits ? 'Explored files, edited files' : hasCmds ? 'Explored files, ran commands' : 'Explored files';

        if (!subgroup) {
          subgroup = element('details', 'work-subgroup');
          subgroup.open = true;
          const subSummary = element('summary', 'work-subgroup-summary');
          const subTitleSpan = element('span', 'subgroup-title', subTitle);
          const subTwisty = element('span', 'work-subgroup-twisty', '▾');
          subSummary.append(subTitleSpan, subTwisty);
          subgroup.append(subSummary);

          const list = element('div', 'work-steps-list');
          renderStepList(list, steps);
          subgroup.append(list);
          trace.append(subgroup);
        } else {
          const subTitleSpan = subgroup.querySelector('.subgroup-title');
          if (subTitleSpan) {
            subTitleSpan.textContent = subTitle;
          }
          const list = subgroup.querySelector('.work-steps-list');
          if (list) {
            renderStepList(list, steps);
          }
        }
      }
    }
  } else if (trace && !busy && steps.length === 0) {
    trace.remove();
  }

  const body = row.querySelector('.message-body');
  if (body) {
    const currentText = body.dataset.text || '';
    if ((message.text || '') !== currentText) {
      body.dataset.text = message.text || '';
      body.replaceChildren();
      if (message.text && message.text.trim()) {
        renderMessageContent(body, message.text);
      }
    }
  }

  // ForgeProof Outcome Card
  const existingProof = row.querySelector('.forgeproof-card');
  const allFiles = [...new Set([
    ...state.checkpoints.flatMap(cp => cp.paths),
    ...state.proposals.flatMap(p => p.files.map(f => f.path)),
    ...state.activity.filter(a => a.startsWith('edited file:') || a.startsWith('staged file:')).map(a => a.replace(/^(?:edited file|staged file):/, '').trim())
  ])];
  const allChecks = steps.filter(s => s.type === 'command');
  const latestCpId = state.checkpoints.length > 0 ? state.checkpoints[state.checkpoints.length - 1].id : undefined;

  if (!busy && (allFiles.length > 0 || allChecks.length > 0) && (state.status === 'completed' || state.checkpoints.length > 0)) {
    if (!existingProof) {
      row.append(createForgeProofCard(allFiles, allChecks, latestCpId, state.sessionId));
    }
  } else if (existingProof && busy) {
    existingProof.remove();
  }
}

function buildMessageRow(message, idx, isLast, busy, state, steps) {
  const isUser = message.role === 'user';
  const row = element('div', `message ${message.role}`);

  if (!isUser) {
    const header = element('div', 'message-header');
    const avatar = element('span', 'message-avatar');
    const agentIcon = element('span', 'agent-icon');
    agentIcon.innerHTML = SVG_ICONS.zap;
    avatar.append(agentIcon, element('span', '', 'Little Forge'));
    header.append(avatar);
    if (state.model) {
      header.append(element('span', 'model-tag', state.model.split('/').pop()));
    }
    row.append(header);

    if ((steps.length > 0 || busy) && isLast) {
      row.append(createWorkTraceElement(busy, steps));
    }
  }

  const body = element('div', 'message-body');
  body.dataset.text = message.text || '';
  if (message.text && message.text.trim()) {
    renderMessageContent(body, message.text);
  }
  row.append(body);

  if (!isUser) {
    const allFiles = [...new Set([
      ...state.checkpoints.flatMap(cp => cp.paths),
      ...state.proposals.flatMap(p => p.files.map(f => f.path)),
      ...state.activity.filter(a => a.startsWith('edited file:') || a.startsWith('staged file:')).map(a => a.replace(/^(?:edited file|staged file):/, '').trim())
    ])];
    const allChecks = steps.filter(s => s.type === 'command');
    const latestCpId = state.checkpoints.length > 0 ? state.checkpoints[state.checkpoints.length - 1].id : undefined;

    if (!busy && (allFiles.length > 0 || allChecks.length > 0) && (state.status === 'completed' || state.checkpoints.length > 0)) {
      row.append(createForgeProofCard(allFiles, allChecks, latestCpId, state.sessionId));
    }
  }

  return row;
}

function render() {
  const busy = !['idle', 'completed', 'failed', 'cancelled'].includes(state.status);
  
  if (busy && !prevBusy) {
    turnStartTime = Date.now();
  } else if (!busy && prevBusy) {
    if (turnStartTime) {
      lastCompletedDuration = Math.max(1, Math.round((Date.now() - turnStartTime) / 1000));
      turnStartTime = null;
    }
  }
  prevBusy = busy;

  $('connection').textContent = state.connected ? 'Connected' : 'Local harness';
  $('dot').classList.toggle('online', state.connected);
  const modelLabel = $('model-label');
  const modelName = state.model ? state.model.split('/').pop() : 'Choose model';
  if (modelLabel) {
    modelLabel.textContent = modelName;
  } else {
    $('model').textContent = modelName;
  }
  $('model').title = state.model || 'Configure a model in TrueForge';

  // Update permissions pill
  const pMode = state.permissionMode || 'auto';
  const pCfg = PERM_CONFIG[pMode] || PERM_CONFIG.auto;
  const pIcon = $('perm-icon');
  const pLabel = $('perm-label');
  if (pIcon && pCfg.iconSvg) pIcon.innerHTML = pCfg.iconSvg;
  if (pLabel) pLabel.textContent = pCfg.label;

  document.querySelectorAll('.perm-option').forEach(opt => {
    opt.classList.toggle('active', opt.dataset.mode === pMode);
  });

  $('hero').hidden = state.messages.length > 0;
  $('run-status').hidden = state.status === 'idle';
  $('run-status').classList.toggle('busy', busy);
  if (busy) {
    const cur = getCurrentProcess(state, busy);
    $('status-text').replaceChildren(createDynamicLoadingElement(cur.text));
  } else {
    $('status-text').textContent = ({
      connecting: 'Connecting to TrueForge…',
      'awaiting-review': 'Review required — waiting for your decision',
      cancelling: 'Stopping and cleaning up…',
      cancelled: 'Run stopped',
      completed: 'Task complete',
      failed: 'Needs attention'
    })[state.status] || state.status;
  }
  $('stop').hidden = !busy; $('send').disabled = busy; $('prompt').disabled = busy;
  $('session').hidden = !state.sessionId;
  const connectBtn = $('connect');
  if (connectBtn) {
    connectBtn.hidden = state.connected;
  }
  const sessionBtn = $('session-btn');
  if (sessionBtn) {
    sessionBtn.title = state.sessionId ? `Open TrueForge session (${state.sessionId.slice(-6)})` : 'Open TrueForge sessions dashboard';
  }

  // Render recent activity trace
  const recentSteps = state.activity.slice(-5);
  $('activity').replaceChildren(...recentSteps.map(raw => {
    const { iconSvg, label } = formatToolStep(raw);
    const item = element('div', 'activity-item');
    const iconSpan = element('span', 'step-icon');
    if (iconSvg) iconSpan.innerHTML = iconSvg;
    item.append(iconSpan, element('span', 'step-text', label));
    return item;
  }));

  // Render messages transcript
  const transcript = $('transcript');
  const oldHeight = transcript.scrollHeight;

  const visibleMessages = state.messages.filter((m, idx, arr) => {
    if (m.text && m.text.trim()) {
      if (m.role === 'user' && idx > 0 && arr[idx - 1].role === 'user' && arr[idx - 1].text === m.text) {
        return false;
      }
      return true;
    }
    if (m.role === 'assistant' && busy && idx === arr.length - 1) return true;
    return false;
  });

  const steps = state.activity.map(parseAntigravityStep).filter(Boolean);

  // Find index of the active user message on which work is in progress
  let activeUserIdx = -1;
  for (let i = visibleMessages.length - 1; i >= 0; i--) {
    if (visibleMessages[i].role === 'user') {
      activeUserIdx = i;
      break;
    }
  }

  const existingRows = Array.from(transcript.querySelectorAll('.message'));
  const newNodes = [];
  visibleMessages.forEach((message, idx) => {
    const isLast = idx === visibleMessages.length - 1;
    const existing = existingRows[idx];

    let row;
    // Reuse existing DOM element for completed messages if role and text are identical
    if (!isLast && existing && existing.dataset.role === message.role && existing.dataset.text === message.text) {
      row = existing;
    } else if (isLast && existing && existing.dataset.role === 'assistant' && message.role === 'assistant') {
      // Reuse and update active assistant row in-place!
      updateActiveAssistantRow(existing, message, busy, state, steps);
      existing.dataset.text = message.text || '';
      row = existing;
    } else {
      row = buildMessageRow(message, idx, isLast, busy, state, steps);
      row.dataset.role = message.role;
      row.dataset.text = message.text || '';
    }

    newNodes.push(row);

    // Place the "Working through your repository…" component after the active input
    if (idx === activeUserIdx && busy) {
      newNodes.push($('run-status'));
    }
  });

  if (activeUserIdx === -1 || !busy) {
    const slot = $('status-slot');
    if (slot && $('run-status').parentElement !== slot) {
      slot.append($('run-status'));
    }
  }

  transcript.replaceChildren(...newNodes);

  const feed = document.querySelector('main');
  if (transcript.scrollHeight > oldHeight && state.status === 'running' && feed.scrollHeight - feed.scrollTop - feed.clientHeight < 160) {
    requestAnimationFrame(() => feed.scrollTo({ top: feed.scrollHeight, behavior: 'smooth' }));
  }

  // Handle Needs Attention warning auto-dismissal after 5 seconds
  if (state.error) {
    if (state.error !== renderedError) {
      renderedError = state.error;
      dismissedError = null;
      if (errorTimer) {
        clearTimeout(errorTimer);
        errorTimer = null;
      }
      $('error').hidden = false;
      $('error-text').textContent = state.error;
      requestAnimationFrame(() => $('error').scrollIntoView({ block: 'nearest', behavior: 'auto' }));
      errorTimer = setTimeout(() => {
        $('error').hidden = true;
        dismissedError = state.error;
        errorTimer = null;
      }, 5000);
    } else if (dismissedError === state.error) {
      $('error').hidden = true;
    } else {
      $('error').hidden = false;
      $('error-text').textContent = state.error;
    }
  } else {
    if (errorTimer) {
      clearTimeout(errorTimer);
      errorTimer = null;
    }
    renderedError = null;
    dismissedError = null;
    $('error').hidden = true;
    $('error-text').textContent = '';
  }

  $('contexts').hidden = !state.context;
  if (state.context) {
    const c = state.context;
    $('budget-label').textContent = `${c.usedTokens.toLocaleString()} / ${c.budgetTokens.toLocaleString()} tokens`;
    $('budget-index').textContent = c.selectionOnly ? '1 file' : `${c.indexedFiles} files`;
    $('meter-bar').style.width = `${Math.min(100, c.usedTokens / Math.max(1, c.budgetTokens) * 100)}%`;
    $('source-list').replaceChildren(...c.chunks.map(chunk => {
      const card = element('div', 'context-chip');
      const btn = button('', 'context-file-link', () => send('openSource', { path: chunk.path, line: chunk.startLine }));
      btn.innerHTML = `<span class="icon-inline">${SVG_ICONS.file}</span> ${chunk.path} (L${chunk.startLine}–${chunk.endLine})`;
      card.append(btn);
      return card;
    }));
  }

  $('review-list').replaceChildren(...state.proposals.map(proposal => {
    const section = element('section', 'review');
    const head = element('div', 'review-header');
    head.append(element('strong', '', 'Review changes'), element('small', '', `${proposal.files.length} files · ${proposal.state}`));

    if (proposal.state === 'pending') {
      head.append(button('Accept all', 'small-button accepted', () => send('acceptAllHunks', { proposalId: proposal.id })));
    }
    section.append(head);

    const impactResults = Array.isArray(state.impactResults) ? state.impactResults : [];
    for (const file of proposal.files) {
      const impact = impactResults.find(r => r.targetFile === file.path);
      if (impact) {
        section.append(createImpactRadarCard(impact));
      }

      const fh = element('div', 'file-head', file.path);
      fh.append(button('Open diff ↗', '', () => send('preview', { proposalId: proposal.id, path: file.path })));
      section.append(fh);

      file.hunks.forEach((hunk, i) => {
        const line = (file.original || '').slice(0, hunk.start).split('\n').length;
        const row = element('div', 'hunk');
        const label = element('div', 'hunk-label');
        label.append(element('span', '', `HUNK ${i + 1} · LINE ${line}`), element('span', '', hunk.decision));
        row.append(label);
        if (hunk.before) row.append(element('pre', 'before', hunk.before));
        if (hunk.after) row.append(element('pre', 'after', hunk.after));
        const actions = element('div', 'hunk-actions');
        actions.append(
          button('Reject', `small-button ${hunk.decision === 'reject' ? 'rejected' : ''}`, () => send('decide', { proposalId: proposal.id, hunkId: hunk.id, decision: 'reject' }), proposal.state !== 'pending'),
          button('Accept', `small-button ${hunk.decision === 'accept' ? 'accepted' : ''}`, () => send('decide', { proposalId: proposal.id, hunkId: hunk.id, decision: 'accept' }), proposal.state !== 'pending')
        );
        row.append(actions);
        section.append(row);
      });
    }

    const awaiting = state.approvals.some(a => a.name === 'apply_proposal' && a.args.proposalId === proposal.id);
    const pending = proposal.files.some(f => f.hunks.some(h => h.decision === 'pending'));
    const accepted = proposal.files.some(f => f.hunks.some(h => h.decision === 'accept'));
    const footer = element('div', 'review-footer');
    footer.append(button(accepted ? 'Apply selected hunks' : 'Finish review', 'primary wide', () => send('apply', { proposalId: proposal.id }), !awaiting || pending || proposal.state !== 'pending'));
    if (proposal.state === 'pending') footer.append(button('Reject all remaining', 'mention-button', () => send('rejectRemaining', { proposalId: proposal.id })));
    footer.append(element('div', 'review-note', awaiting ? 'Your choices are applied through TrueForge approval.' : proposal.state === 'pending' ? 'Waiting for the agent to request the apply checkpoint.' : 'Review decisions are preserved.'));
    section.append(footer);
    return section;
  }));

  // Render command checks with modern card styling
  $('command-list').replaceChildren(...state.approvals.filter(a => a.name === 'run_command').map(a => {
    const card = element('div', 'command-card');
    const header = element('div', 'command-card-header');
    const termIcon = element('span', 'icon-inline');
    termIcon.innerHTML = SVG_ICONS.terminal;
    header.append(termIcon, element('strong', '', 'Run project check?'));
    card.append(header);

    const cmdStr = Array.isArray(a.args?.args) ? a.args.args.join(' ') : String(a.args?.task || 'command');
    card.append(element('div', 'command-pill', `${a.args?.task || 'task'}: ${cmdStr}`));
    card.append(element('p', 'command-hint', 'Project code runs with your user permissions and may have side effects.'));

    const actions = element('div', 'command-actions');
    actions.append(
      button('Deny', 'small-button', () => send('commandDecision', { toolCallId: a.toolCallId, allow: false })),
      button('Allow once', 'small-button accepted', () => send('commandDecision', { toolCallId: a.toolCallId, allow: true }))
    );
    card.append(actions);
    return card;
  }));

  $('checkpoints').hidden = !state.checkpoints.length;
  $('checkpoint-list').replaceChildren(...state.checkpoints.slice(-4).reverse().map(cp => {
    const row = element('div', 'checkpoint');
    row.append(element('span', '', `${cp.paths.length} files · ${cp.state}`), button('Undo change', 'small-button', () => send('undo', { id: cp.id }), busy));
    return row;
  }));

  // Render drawers & panels
  renderHistoryItems();
  renderSignals(state);
  renderMemory(state);
  renderContract(state);
  renderRepro(state);
  renderImpactRadarCards(transcript, state);
}

let historySearchQuery = '';
let historyFilter = 'all';

function renderHistoryItems() {
  const historyItems = $('history-items');
  if (!historyItems) return;
  const conversations = Array.isArray(state.conversations) ? state.conversations : [];

  const now = Date.now();
  const filtered = conversations.filter(c => {
    if (historySearchQuery) {
      const match = (c.title || '').toLowerCase().includes(historySearchQuery);
      if (!match) return false;
    }
    if (historyFilter === 'today') {
      return (now - (c.updatedAt || 0)) <= 86400000;
    }
    if (historyFilter === 'recent') {
      return (now - (c.updatedAt || 0)) <= 3 * 86400000;
    }
    return true;
  });

  if (filtered.length === 0) {
    const empty = element('div', 'history-empty', historySearchQuery ? 'No matching conversations.' : 'No past conversations yet.');
    historyItems.replaceChildren(empty);
    return;
  }

  historyItems.replaceChildren(...filtered.map(conv => {
    const item = element('div', `history-item${conv.id === state.activeConversationId ? ' active' : ''}`);
    item.tabIndex = 0;

    const icon = element('span', 'history-item-icon');
    icon.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';

    const info = element('div', 'history-item-info');
    const title = element('div', 'history-item-title', conv.title || 'Conversation');
    const meta = element('div', 'history-item-meta', `${formatRelativeTime(conv.updatedAt)} · ${conv.messageCount} msg${conv.messageCount === 1 ? '' : 's'}`);
    info.append(title, meta);

    const actions = element('div', 'history-item-actions');
    if (conv.id === state.activeConversationId) {
      actions.append(element('span', 'history-active-badge', 'Active'));
    }

    const delBtn = element('button', 'history-delete-btn');
    delBtn.type = 'button';
    delBtn.title = 'Delete conversation';
    delBtn.innerHTML = SVG_ICONS.close;
    delBtn.addEventListener('click', e => {
      e.stopPropagation();
      send('deleteConversation', { id: conv.id });
    });
    actions.append(delBtn);

    item.append(icon, info, actions);
    item.addEventListener('click', () => {
      closeAllDrawers();
      send('switchConversation', { id: conv.id });
    });
    return item;
  }));
}

function updateToolsNotificationBadge() {
  const toolsBadge = $('tools-badge');
  if (!toolsBadge) return;
  const signalsBadge = $('signals-badge');
  const memoryBadge = $('memory-badge');
  const sigCount = (signalsBadge && !signalsBadge.hidden) ? parseInt(signalsBadge.textContent, 10) || 0 : 0;
  const memCount = (memoryBadge && !memoryBadge.hidden) ? parseInt(memoryBadge.textContent, 10) || 0 : 0;
  const total = sigCount + memCount;
  toolsBadge.hidden = total === 0;
  toolsBadge.textContent = String(total);
}

function renderSignals(state) {
  const list = $('signals-drawer-items');
  const badge = $('signals-badge');
  const signals = Array.isArray(state.signals) ? state.signals : [];
  if (badge) {
    const high = signals.filter(s => s.severity === 'high').length;
    badge.hidden = high === 0;
    badge.textContent = String(high);
  }
  updateToolsNotificationBadge();
  if (!list) return;
  if (signals.length === 0) {
    list.replaceChildren(element('div', 'history-empty', 'No diagnostics or errors in workspace. Clean health.'));
    return;
  }
  list.replaceChildren(...signals.map(sig => {
    const item = element('div', `history-item signal-card ${sig.severity}`);
    const info = element('div', 'history-item-info');
    const hdr = element('div', 'signal-header');
    hdr.append(
      element('span', `signal-badge ${sig.severity}`, sig.severity.toUpperCase()),
      element('span', 'signal-file', `${sig.file}${sig.line ? `:${sig.line}` : ''}`)
    );
    const desc = element('div', 'signal-desc', sig.message);
    const actions = element('div', 'signal-actions');
    const fixBtn = button('Fix with Forge', 'signal-fix-btn', e => {
      e.stopPropagation();
      closeAllDrawers();
      send('fixWithForge', { id: sig.id });
    });
    fixBtn.innerHTML = `<span class="icon-inline">${SVG_ICONS.zap}</span> Fix with Forge`;
    actions.append(fixBtn);
    info.append(hdr, desc, actions);
    item.append(info);
    return item;
  }));
}

function renderMemory(state) {
  const list = $('memory-items');
  const badge = $('memory-badge');
  const pill = $('memory-count-pill');
  const memory = Array.isArray(state.forgeMemory) ? state.forgeMemory : [];
  if (badge) {
    badge.hidden = memory.length === 0;
    badge.textContent = String(memory.length);
  }
  updateToolsNotificationBadge();
  if (pill) {
    pill.textContent = `${memory.length} rule${memory.length !== 1 ? 's' : ''}`;
  }
  if (!list) return;
  if (memory.length === 0) {
    list.replaceChildren(element('div', 'history-empty', 'No architectural rules stored yet. Add rules above to guide the agent across all chats.'));
    return;
  }
  list.replaceChildren(...memory.map(m => {
    const row = element('div', 'memory-rule-row');
    const catBadge = element('span', `memory-cat-badge memory-cat-${m.category}`, m.category.slice(0, 4));
    const text = element('span', 'memory-rule-text', m.rule);
    const delBtn = element('button', 'memory-delete-btn');
    delBtn.type = 'button';
    delBtn.title = 'Delete rule';
    delBtn.innerHTML = SVG_ICONS.close;
    delBtn.addEventListener('click', e => {
      e.stopPropagation();
      send('deleteMemoryRule', { id: m.id });
    });
    row.append(catBadge, text, delBtn);
    return row;
  }));
}

function updatePermSelectStyle(select) {
  if (!select) return;
  const val = select.value;
  select.classList.remove('val-allowed', 'val-ask', 'val-disallowed', 'val-required', 'val-auto');
  select.classList.add(`val-${val}`);
}

function renderContract(state) {
  const cg = state.changeGuard || { maxFiles: 8, modifyFiles: 'allowed', createFiles: 'allowed', modifyDeps: 'ask', modifyDatabase: 'ask', executeCommands: 'required' };
  const maxFilesInput = $('cg-max-files');
  if (maxFilesInput && document.activeElement !== maxFilesInput) maxFilesInput.value = cg.maxFiles || 8;
  const mf = $('cg-modify-files');
  if (mf && document.activeElement !== mf) { mf.value = cg.modifyFiles || 'allowed'; updatePermSelectStyle(mf); }
  const cf = $('cg-create-files');
  if (cf && document.activeElement !== cf) { cf.value = cg.createFiles || 'allowed'; updatePermSelectStyle(cf); }
  const md = $('cg-modify-deps');
  if (md && document.activeElement !== md) { md.value = cg.modifyDeps || 'ask'; updatePermSelectStyle(md); }
  const mdb = $('cg-modify-db');
  if (mdb && document.activeElement !== mdb) { mdb.value = cg.modifyDatabase || 'ask'; updatePermSelectStyle(mdb); }
  const ec = $('cg-execute-cmds');
  if (ec && document.activeElement !== ec) { ec.value = cg.executeCommands || 'required'; updatePermSelectStyle(ec); }
}

function saveChangeGuard() {
  const maxFiles = Number($('cg-max-files')?.value) || 8;
  const modifyFiles = $('cg-modify-files')?.value || 'allowed';
  const createFiles = $('cg-create-files')?.value || 'allowed';
  const modifyDeps = $('cg-modify-deps')?.value || 'ask';
  const modifyDatabase = $('cg-modify-db')?.value || 'ask';
  const executeCommands = $('cg-execute-cmds')?.value || 'required';
  send('setChangeGuard', {
    maxFiles,
    modifyFiles,
    createFiles,
    modifyDeps,
    modifyDatabase,
    executeCommands,
    allowDeps: modifyDeps === 'allowed',
    safeMode: true
  });
}

function renderRepro(state) {
  const panel = $('repro-panel');
  if (!panel) return;
  const session = state.reproSession;
  if (!session) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  const errInput = $('repro-error-input');
  const stackInput = $('repro-stack-input');
  const fileInput = $('repro-file-input');
  const headerText = $('repro-header-text');
  if (errInput && document.activeElement !== errInput) errInput.value = session.errorText || '';
  if (stackInput && document.activeElement !== stackInput) stackInput.value = session.stackTrace || '';
  if (fileInput && document.activeElement !== fileInput) fileInput.value = session.affectedFile || '';

  if (headerText) {
    if (session.phase === 'red_running') {
      headerText.textContent = 'Repro-to-Regression (Running Red-Green Protocol…)';
    } else if (session.phase === 'done') {
      headerText.textContent = 'Repro-to-Regression (Permanent Test Verified)';
    } else {
      headerText.textContent = 'Repro-to-Regression';
    }
  }
}

function createImpactRadarCard(res) {
  const card = element('div', `impact-radar-card ${res.riskLevel}`);
  const hdr = element('div', 'impact-header');
  const title = element('div', 'impact-title');
  title.innerHTML = `<span class="icon-inline">${SVG_ICONS.zap}</span> Impact Radar · <code>${res.targetFile}</code>`;
  const badge = element('span', `impact-badge ${res.riskLevel}`, `${res.riskLevel.toUpperCase()} RISK`);
  hdr.append(title, badge);
  card.append(hdr);

  const body = element('div', 'impact-body');
  if (res.consumers.length > 0) {
    const cHead = element('div', 'impact-subhead');
    cHead.innerHTML = `<span class="icon-inline">${SVG_ICONS.alertTriangle}</span> ${res.consumers.length} module${res.consumers.length === 1 ? '' : 's'} depend on this change:`;
    body.append(cHead);
    const list = element('div', 'impact-list');
    for (const c of res.consumers.slice(0, 5)) {
      const item = element('div', 'impact-item');
      item.textContent = `↳ ${c}`;
      list.append(item);
    }
    body.append(list);
  } else {
    const iso = element('div', 'impact-subhead');
    iso.innerHTML = `<span class="icon-inline">${SVG_ICONS.check}</span> Isolated module: no downstream consumers identified in workspace.`;
    body.append(iso);
  }

  if (res.relatedTests.length > 0) {
    const tHead = element('div', 'impact-subhead');
    tHead.innerHTML = `<span class="icon-inline">${SVG_ICONS.flask}</span> ${res.relatedTests.length} related test file${res.relatedTests.length === 1 ? '' : 's'} identified:`;
    body.append(tHead);
    const tList = element('div', 'impact-list');
    for (const t of res.relatedTests.slice(0, 4)) {
      const item = element('div', 'impact-item');
      item.textContent = `• ${t}`;
      tList.append(item);
    }
    body.append(tList);
  }
  card.append(body);
  return card;
}

function renderImpactRadarCards(transcript, state) {
  const results = Array.isArray(state.impactResults) ? state.impactResults : [];
  if (results.length === 0) return;
  // If there are no pending proposals in review-list, display the cards in transcript
  if (!state.proposals.some(p => p.state === 'pending')) {
    for (const res of results) {
      transcript.append(createImpactRadarCard(res));
    }
  }
}

const promptInput = $('prompt');
function adjustPromptHeight() {
  promptInput.style.height = 'auto';
  promptInput.style.height = `${Math.min(140, Math.max(38, promptInput.scrollHeight))}px`;
}

function updatePlanBtnState() {
  const prompt = $('prompt');
  const planBtn = $('plan-btn');
  if (prompt && planBtn) {
    const isPlan = prompt.value.trim().startsWith('/plan');
    planBtn.classList.toggle('active', isPlan);
  }
}

promptInput.addEventListener('input', () => {
  adjustPromptHeight();
  updatePlanBtnState();

  const val = promptInput.value;
  const cursor = promptInput.selectionStart ?? val.length;
  const textBefore = val.slice(0, cursor);

  // Check for slash command at beginning of input
  const slashMatch = textBefore.match(/^\/([a-zA-Z0-9_-]*)$/);
  if (slashMatch) {
    renderSlashMenu(slashMatch[1]);
    return;
  } else {
    hideSlashMenu();
  }

  // Check for mention token right before cursor
  const mentionMatch = textBefore.match(/(?:^|\s)@([a-zA-Z0-9_-]*)$/);
  if (mentionMatch) {
    renderMentionMenu(mentionMatch[1]);
    return;
  } else {
    hideMentionMenu();
  }
});

$('form').addEventListener('submit', event => {
  event.preventDefault();
  const prompt = $('prompt').value.trim();
  if (prompt) {
    hideSlashMenu();
    hideMentionMenu();
    turnStartTime = Date.now();
    lastCompletedDuration = null;
    send('run', { prompt });
    $('prompt').value = '';
    adjustPromptHeight();
    updatePlanBtnState();
  }
});

$('prompt').addEventListener('keydown', e => {
  if (slashMenu && !slashMenu.hidden && filteredSlashCommands.length > 0) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeSlashIndex = (activeSlashIndex + 1) % filteredSlashCommands.length;
      renderSlashItems();
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeSlashIndex = (activeSlashIndex - 1 + filteredSlashCommands.length) % filteredSlashCommands.length;
      renderSlashItems();
      return;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
        e.preventDefault();
        selectSlashCommand(filteredSlashCommands[activeSlashIndex]);
        return;
      }
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      hideSlashMenu();
      return;
    }
  }

  if (mentionMenu && !mentionMenu.hidden && filteredMentionOptions.length > 0) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeMentionIndex = (activeMentionIndex + 1) % filteredMentionOptions.length;
      renderMentionItems();
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeMentionIndex = (activeMentionIndex - 1 + filteredMentionOptions.length) % filteredMentionOptions.length;
      renderMentionItems();
      return;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
        e.preventDefault();
        selectMentionOption(filteredMentionOptions[activeMentionIndex].kind);
        return;
      }
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      hideMentionMenu();
      return;
    }
  }

  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    $('form').requestSubmit();
  }
});

// Dropdown menus, Sliding Drawers & Tools Sidebar
const permBtn = $('permissions-btn');
const permMenu = $('permissions-menu');
const historyBtn = $('history-btn');
const historyDrawer = $('history-drawer');
const signalsBtn = $('signals-btn');
const signalsDrawer = $('signals-drawer');
const memoryBtn = $('memory-btn');
const memoryDrawer = $('memory-drawer');
const contractBtn = $('contract-btn');
const contractDrawer = $('contract-drawer');
const toolsToggleBtn = $('tools-toggle-btn');
const toolsSidebar = $('tools-sidebar');
const toolsClose = $('tools-close');
const historyBackdrop = $('history-backdrop');

// Attached Quick Commands & Mention Context Popup Menu Elements
const slashMenu = $('slash-menu');
const slashItems = $('slash-items');
const mentionMenu = $('mention-menu');
const mentionItems = $('mention-items');

const QUICK_COMMANDS = [
  {
    cmd: '/plan',
    name: '/plan',
    desc: 'Formulate step-by-step implementation plan before coding',
    icon: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/><path d="M9 14l2 2 4-4"/></svg>',
    action: 'prompt'
  },
  {
    cmd: '/impact',
    name: '/impact',
    desc: 'Scan consumers, test coverage and blast radius risk',
    icon: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/><line x1="12" y1="3" x2="12" y2="7"/><line x1="12" y1="17" x2="12" y2="21"/><line x1="3" y1="12" x2="7" y2="12"/><line x1="17" y1="12" x2="21" y2="12"/></svg>',
    action: 'prompt'
  },
  {
    cmd: '/review',
    name: '/review',
    desc: 'Review pending code diffs and safety boundaries',
    icon: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>',
    action: 'execute'
  },
  {
    cmd: '/explain',
    name: '/explain',
    desc: 'Explain repository architecture, entry points and tests',
    icon: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    action: 'prompt'
  },
  {
    cmd: '/debug',
    name: '/debug',
    desc: 'Investigate failures, trace root cause and recommend fix',
    icon: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m8 2 1.88 1.88"/><path d="M14.12 3.88 16 2"/><path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6"/><path d="M12 20v-9"/><path d="M6.53 9C4.6 8.8 3 7.1 3 5"/><path d="M6 13H2"/><path d="M3 21c0-2.1 1.7-3.9 3.8-4"/><path d="M20.97 5c0 2.1-1.6 3.8-3.5 4"/><path d="M22 13h-4"/><path d="M17.2 17c2.1.1 3.8 1.9 3.8 4"/></svg>',
    action: 'prompt'
  },
  {
    cmd: '/test',
    name: '/test',
    desc: 'Run verification tests and check pass/fail status',
    icon: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
    action: 'execute'
  },
  {
    cmd: '/repro',
    name: '/repro',
    desc: 'Start Repro-to-Regression red-green test protocol',
    icon: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2v7.31L4.17 19.34A2 2 0 0 0 5.86 22h12.28a2 2 0 0 0 1.69-2.66L14 9.31V2"/><line x1="8.5" x2="15.5" y1="2" y2="2"/><line x1="14" x2="10" y1="9.31" y2="9.31"/></svg>',
    action: 'repro'
  },
  {
    cmd: '/undo',
    name: '/undo',
    desc: 'Revert last accepted changes and restore checkpoint',
    icon: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>',
    action: 'execute'
  }
];

const MENTION_OPTIONS = [
  {
    kind: 'file',
    name: '@file',
    desc: 'Select a workspace source file',
    icon: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>'
  },
  {
    kind: 'folder',
    name: '@folder',
    desc: 'Select a project folder or directory',
    icon: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>'
  },
  {
    kind: 'symbol',
    name: '@symbol',
    desc: 'Search workspace class, function or type symbol',
    icon: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><circle cx="19" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><line x1="12" y1="19" x2="12" y2="5"/><line x1="12" x2="5" y1="12" y2="19"/></svg>'
  }
];

let activeSlashIndex = 0;
let filteredSlashCommands = [];
let activeMentionIndex = 0;
let filteredMentionOptions = [];

function hideSlashMenu() {
  if (slashMenu) slashMenu.hidden = true;
  filteredSlashCommands = [];
}

function hideMentionMenu() {
  if (mentionMenu) mentionMenu.hidden = true;
  filteredMentionOptions = [];
}

function renderSlashItems() {
  if (!slashItems) return;
  slashItems.innerHTML = '';
  filteredSlashCommands.forEach((c, idx) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.cmd = c.cmd;
    btn.className = `input-popup-item ${idx === activeSlashIndex ? 'active' : ''}`;
    btn.innerHTML = `<span class="input-popup-icon">${c.icon}</span><div class="input-popup-item-info"><div class="input-popup-item-name">${c.name}</div><div class="input-popup-item-desc">${c.desc}</div></div>`;
    btn.addEventListener('click', e => {
      e.stopPropagation();
      selectSlashCommand(c);
    });
    slashItems.appendChild(btn);
  });
  const activeEl = slashItems.children[activeSlashIndex];
  if (activeEl) activeEl.scrollIntoView({ block: 'nearest' });
}

function renderSlashMenu(query) {
  const q = (query || '').toLowerCase().trim();
  filteredSlashCommands = QUICK_COMMANDS.filter(c => c.cmd.slice(1).startsWith(q) || c.desc.toLowerCase().includes(q));
  if (filteredSlashCommands.length === 0) {
    hideSlashMenu();
    return;
  }
  activeSlashIndex = 0;
  hideMentionMenu();
  if (slashMenu) slashMenu.hidden = false;
  renderSlashItems();
}

function renderMentionItems() {
  if (!mentionItems) return;
  mentionItems.innerHTML = '';
  filteredMentionOptions.forEach((m, idx) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.kind = m.kind;
    btn.className = `input-popup-item ${idx === activeMentionIndex ? 'active' : ''}`;
    btn.innerHTML = `<span class="input-popup-icon">${m.icon}</span><div class="input-popup-item-info"><div class="input-popup-item-name">${m.name}</div><div class="input-popup-item-desc">${m.desc}</div></div>`;
    btn.addEventListener('click', e => {
      e.stopPropagation();
      selectMentionOption(m.kind);
    });
    mentionItems.appendChild(btn);
  });
  const activeEl = mentionItems.children[activeMentionIndex];
  if (activeEl) activeEl.scrollIntoView({ block: 'nearest' });
}

function renderMentionMenu(query) {
  const q = (query || '').toLowerCase().trim();
  filteredMentionOptions = MENTION_OPTIONS.filter(m => m.kind.startsWith(q) || m.name.includes(q) || m.desc.toLowerCase().includes(q));
  if (filteredMentionOptions.length === 0) {
    hideMentionMenu();
    return;
  }
  activeMentionIndex = 0;
  hideSlashMenu();
  if (mentionMenu) mentionMenu.hidden = false;
  renderMentionItems();
}

function selectSlashCommand(cmdObj) {
  hideSlashMenu();
  if (!cmdObj) return;
  if (cmdObj.action === 'execute') {
    promptInput.value = '';
    adjustPromptHeight();
    turnStartTime = Date.now();
    lastCompletedDuration = null;
    send('run', { prompt: cmdObj.cmd });
  } else if (cmdObj.action === 'repro') {
    promptInput.value = '';
    adjustPromptHeight();
    send('startRepro');
  } else {
    promptInput.value = `${cmdObj.cmd} `;
    adjustPromptHeight();
    promptInput.focus();
    promptInput.selectionStart = promptInput.selectionEnd = promptInput.value.length;
  }
}

function selectMentionOption(kind) {
  hideMentionMenu();
  const val = promptInput.value;
  const cursor = promptInput.selectionStart || val.length;
  const textBefore = val.slice(0, cursor);
  const textAfter = val.slice(cursor);
  const match = textBefore.match(/(?:^|\s)@([a-zA-Z0-9_-]*)$/);
  if (match) {
    const atIndex = textBefore.lastIndexOf('@');
    promptInput.value = textBefore.slice(0, atIndex) + textAfter;
    promptInput.selectionStart = promptInput.selectionEnd = atIndex;
  }
  adjustPromptHeight();
  send('mention', { kind });
}

function closeAllDrawers() {
  if (permMenu) permMenu.hidden = true;
  if (historyDrawer) historyDrawer.hidden = true;
  if (signalsDrawer) signalsDrawer.hidden = true;
  if (memoryDrawer) memoryDrawer.hidden = true;
  if (contractDrawer) contractDrawer.hidden = true;
  if (toolsSidebar) toolsSidebar.hidden = true;
  if (historyBackdrop) historyBackdrop.hidden = true;

  signalsBtn?.classList.remove('active');
  signalsBtn?.setAttribute('aria-selected', 'false');
  memoryBtn?.classList.remove('active');
  memoryBtn?.setAttribute('aria-selected', 'false');
  contractBtn?.classList.remove('active');
  contractBtn?.setAttribute('aria-selected', 'false');
  historyBtn?.classList.remove('active');
  toolsToggleBtn?.classList.remove('active');
}

function openDrawer(drawer) {
  closeAllDrawers();
  if (drawer) drawer.hidden = false;
  if (historyBackdrop) historyBackdrop.hidden = false;

  if (drawer === signalsDrawer) {
    signalsBtn?.classList.add('active');
    signalsBtn?.setAttribute('aria-selected', 'true');
  } else if (drawer === memoryDrawer) {
    memoryBtn?.classList.add('active');
    memoryBtn?.setAttribute('aria-selected', 'true');
  } else if (drawer === contractDrawer) {
    contractBtn?.classList.add('active');
    contractBtn?.setAttribute('aria-selected', 'true');
  } else if (drawer === historyDrawer) {
    historyBtn?.classList.add('active');
  } else if (drawer === toolsSidebar) {
    toolsToggleBtn?.classList.add('active');
  }
}

if (toolsToggleBtn) {
  toolsToggleBtn.addEventListener('click', e => {
    e.stopPropagation();
    if (toolsSidebar && !toolsSidebar.hidden) closeAllDrawers();
    else openDrawer(toolsSidebar);
  });
}
if (toolsClose) toolsClose.addEventListener('click', closeAllDrawers);

if (permBtn && permMenu) {
  permBtn.addEventListener('click', e => {
    e.stopPropagation();
    const isHidden = permMenu.hidden;
    closeAllDrawers();
    permMenu.hidden = !isHidden;
  });
  document.querySelectorAll('.perm-option').forEach(opt => {
    opt.addEventListener('click', () => {
      const mode = opt.dataset.mode;
      if (mode) {
        send('setPermissionMode', { mode });
        permMenu.hidden = true;
      }
    });
  });
}

// Conversation History Drawer
if (historyBtn) {
  historyBtn.addEventListener('click', e => {
    e.stopPropagation();
    if (historyDrawer && !historyDrawer.hidden) closeAllDrawers();
    else {
      openDrawer(historyDrawer);
      const search = $('history-search');
      if (search) {
        search.value = '';
        historySearchQuery = '';
        renderHistoryItems();
        setTimeout(() => search.focus(), 50);
      }
    }
  });
}
const drawerClose = $('drawer-close');
if (drawerClose) drawerClose.addEventListener('click', closeAllDrawers);
const drawerNewChat = $('drawer-new-chat');
if (drawerNewChat) drawerNewChat.addEventListener('click', () => { closeAllDrawers(); send('newChat'); });
const historySearch = $('history-search');
if (historySearch) {
  historySearch.addEventListener('input', e => {
    historySearchQuery = (e.target.value || '').trim().toLowerCase();
    renderHistoryItems();
  });
}

// Signals Drawer
if (signalsBtn) {
  signalsBtn.addEventListener('click', e => {
    e.stopPropagation();
    if (signalsDrawer && !signalsDrawer.hidden) closeAllDrawers();
    else {
      openDrawer(signalsDrawer);
      send('refreshSignals');
    }
  });
}
const signalsClose = $('signals-close');
if (signalsClose) signalsClose.addEventListener('click', closeAllDrawers);
const signalsRefresh = $('signals-refresh-btn');
if (signalsRefresh) signalsRefresh.addEventListener('click', () => send('refreshSignals'));

// Memory Drawer
if (memoryBtn) {
  memoryBtn.addEventListener('click', e => {
    e.stopPropagation();
    if (memoryDrawer && !memoryDrawer.hidden) closeAllDrawers();
    else openDrawer(memoryDrawer);
  });
}
const memoryClose = $('memory-close');
if (memoryClose) memoryClose.addEventListener('click', closeAllDrawers);
const memoryAddBtn = $('memory-add-btn');
if (memoryAddBtn) {
  memoryAddBtn.addEventListener('click', () => {
    const input = $('memory-input');
    const select = $('memory-category');
    if (input && input.value.trim()) {
      send('addMemoryRule', { rule: input.value.trim(), category: select?.value || 'constraint' });
      input.value = '';
    }
  });
}

// Task Contract Drawer
if (contractBtn) {
  contractBtn.addEventListener('click', e => {
    e.stopPropagation();
    if (contractDrawer && !contractDrawer.hidden) closeAllDrawers();
    else openDrawer(contractDrawer);
  });
}
const contractClose = $('contract-close');
if (contractClose) contractClose.addEventListener('click', closeAllDrawers);

['cg-modify-files', 'cg-create-files', 'cg-modify-deps', 'cg-modify-db', 'cg-execute-cmds'].forEach(id => {
  const el = $(id);
  if (el) {
    el.addEventListener('change', () => {
      updatePermSelectStyle(el);
      saveChangeGuard();
    });
  }
});
const maxFilesEl = $('cg-max-files');
if (maxFilesEl) {
  maxFilesEl.addEventListener('change', saveChangeGuard);
  maxFilesEl.addEventListener('input', saveChangeGuard);
}

// Conversation History Filter Chips
document.querySelectorAll('.history-filter-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.history-filter-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    historyFilter = chip.dataset.filter || 'all';
    renderHistoryItems();
  });
});

if (historyBackdrop) historyBackdrop.addEventListener('click', closeAllDrawers);

// Repro-to-Regression Controls
const reproTrigger = $('repro-trigger-btn');
if (reproTrigger) reproTrigger.addEventListener('click', () => send('startRepro'));
const reproCancel = $('repro-cancel');
if (reproCancel) reproCancel.addEventListener('click', () => send('cancelRepro'));
const reproQuickPick = $('repro-quick-pick');
if (reproQuickPick) reproQuickPick.addEventListener('click', () => send('startRepro'));
const reproSubmit = $('repro-submit-btn');
if (reproSubmit) {
  reproSubmit.addEventListener('click', () => {
    const errorText = $('repro-error-input')?.value.trim();
    if (!errorText) {
      alert('Please describe or paste the bug error first.');
      return;
    }
    const stackTrace = $('repro-stack-input')?.value.trim() || undefined;
    const affectedFile = $('repro-file-input')?.value.trim() || undefined;
    send('submitRepro', { errorText, stackTrace, affectedFile });
  });
}

document.addEventListener('click', e => {
  if (permMenu && !permMenu.contains(e.target) && e.target !== permBtn) {
    permMenu.hidden = true;
  }
  if (slashMenu && !slashMenu.contains(e.target) && e.target !== promptInput) {
    hideSlashMenu();
  }
  if (mentionMenu && !mentionMenu.contains(e.target) && e.target !== promptInput) {
    hideMentionMenu();
  }
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeAllDrawers();
    hideSlashMenu();
    hideMentionMenu();
  }
});

$('stop').addEventListener('click', () => send('stop'));
$('model').addEventListener('click', () => send('setup'));
$('connect').addEventListener('click', () => send('setup'));
$('session').addEventListener('click', () => send('session'));
const sessionBtnEl = $('session-btn');
if (sessionBtnEl) {
  sessionBtnEl.addEventListener('click', () => {
    closeAllDrawers();
    send('session');
  });
}
const planBtn = $('plan-btn');
if (planBtn) {
  planBtn.addEventListener('click', () => {
    const prompt = $('prompt');
    if (!prompt) return;
    if (prompt.value.startsWith('/plan')) {
      prompt.value = prompt.value.replace(/^\/plan\s*/, '');
    } else {
      prompt.value = `/plan ${prompt.value.trim()}`.trim() + ' ';
    }
    adjustPromptHeight();
    updatePlanBtnState();
    prompt.focus();
  });
}
$('file-mention').addEventListener('click', () => send('mention', { kind: 'file' }));
const folderMention = $('folder-mention');
if (folderMention) folderMention.addEventListener('click', () => send('mention', { kind: 'folder' }));
$('symbol-mention').addEventListener('click', () => send('mention', { kind: 'symbol' }));
$('new-chat').addEventListener('click', () => send('newChat'));
for (const card of document.querySelectorAll('[data-prompt]')) {
  card.addEventListener('click', () => {
    $('prompt').value = card.dataset.prompt;
    adjustPromptHeight();
    $('prompt').focus();
  });
}

window.addEventListener('message', event => {
  if (event.data.type === 'state') {
    state = event.data.state;
    render();
  } else if (event.data.type === 'insertMention') {
    $('prompt').value += `${$('prompt').value ? ' ' : ''}${event.data.text} `;
    adjustPromptHeight();
    $('prompt').focus();
  }
});

send('ready');
