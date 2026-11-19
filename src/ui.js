import MarkdownIt from 'markdown-it';
import highlighter from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import diff from 'highlight.js/lib/languages/diff';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import powershell from 'highlight.js/lib/languages/powershell';
import python from 'highlight.js/lib/languages/python';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import geminiLogo from '../resources/providers/gemini.svg';
import groqLogo from '../resources/providers/groq.svg';
import openRouterLogo from '../resources/providers/openrouter.svg';
import workersAiLogo from '../resources/providers/workers-ai.svg';
import cohereLogo from '../resources/providers/cohere.svg';
import vercelLogo from '../resources/providers/vercel.svg';

for (const [name, language] of Object.entries({ bash, diff, javascript, json, powershell, python, typescript, xml })) highlighter.registerLanguage(name, language);

/* Host-owned state; model text is always rendered safely through textContent/DOM nodes. */
const vscode = acquireVsCodeApi();
let state = { status: 'idle', messages: [], context: null, proposals: [], approvals: [], checkpoints: [], activity: [], connected: false, model: '', permissionMode: 'review', conversations: [], activeConversationId: '' };
let renderedError = null;
const isRunning = () => !['idle', 'completed', 'failed', 'cancelled'].includes(state.status);
let errorTimer = null;
let dismissedError = null;
const dismissedProposals = new Set();
const dismissedApprovals = new Set();
const approvalDecisions = new Map();

function formatCommandString(args) {
  if (!args) return 'command';
  const task = args.task || 'command';
  const extra = Array.isArray(args.args) ? args.args.join(' ') : '';
  if (task === 'pytest') return extra ? `pytest ${extra}` : 'pytest';
  if (task === 'npm-test') return extra ? `npm test -- ${extra}` : 'npm test';
  if (task === 'typecheck') return 'npx tsc --noEmit';
  if (task === 'git-diff-check') return 'git diff --check';
  return extra ? `${task} ${extra}` : String(task);
}
const $ = id => document.getElementById(id);
const send = (type, data = {}) => vscode.postMessage({ type, ...data });
const saved = vscode.getState?.() ?? {};
const draft = { pins: [], excluded: [], semantic: false };
let demoMode = saved.demo === true;
let replacement;
const element = (tag, cls, text) => { const el = document.createElement(tag); if (cls) el.className = cls; if (text !== undefined) el.textContent = text; return el; };
function button(text, cls, action, disabled = false) { const el = element('button', cls, text); el.disabled = disabled; el.addEventListener('click', action); return el; }

const markdown = new MarkdownIt({ html: false, linkify: true });
const markdownTags = new Set([
  'a', 'blockquote', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'ol', 'p', 's', 'strong',
  'table', 'tbody', 'td', 'th', 'thead', 'tr', 'ul',
]);

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

function renderCodeBlock(code, info) {
  const language = info.trim().split(/\s+/, 1)[0];
  const wrapper = element('div', 'code-block-wrapper');
  const header = element('div', 'code-block-header');
  const controls = element('div', 'block-controls');
  const copyBtn = button('Copy', 'copy-btn', async () => {
    let feedback = 'Copied';
    try { await navigator.clipboard.writeText(code); }
    catch { feedback = 'Copy failed'; }
    copyBtn.textContent = feedback;
    setTimeout(() => { copyBtn.textContent = 'Copy'; }, 2000);
  });
  copyBtn.type = 'button';
  copyBtn.setAttribute('aria-label', 'Copy code');
  const pre = element('pre', 'code-block-content');
  const content = element('code', '', code);
  const grammar = language?.toLowerCase();
  if (grammar && code.length <= 16000 && highlighter.getLanguage(grammar)) {
    content.className = `language-${grammar}`;
    highlighter.highlightElement(content);
  }
  pre.append(content);
  const toggle = (name, key, action, activeLabel = name) => {
    const control = button(name, 'copy-btn', () => {
      const value = control.getAttribute('aria-pressed') !== 'true';
      control.setAttribute('aria-pressed', String(value));
      control.textContent = value ? activeLabel : name;
      action(value);
    });
    control.type = 'button';
    control.dataset.codeControl = key;
    control.setAttribute('aria-pressed', 'false');
    return control;
  };
  controls.append(
    toggle('Wrap', 'wrap', active => pre.classList.toggle('wrap-code', active), 'Unwrap'),
    toggle('Collapse', 'collapse', active => { body.hidden = active; }, 'Expand'),
    copyBtn,
  );
  const body = element('div', 'code-block-body');
  body.append(pre);
  if (/^(md|markdown)$/i.test(language)) {
    const preview = element('div', 'markdown-preview-body');
    preview.hidden = true;
    controls.prepend(toggle('Preview', 'preview', active => {
      if (active && !preview.hasChildNodes()) renderMessageContent(preview, code);
      pre.hidden = active;
      preview.hidden = !active;
    }, 'Source'));
    body.append(preview);
  }
  header.append(element('span', 'code-block-language', language || 'Code'), controls);
  wrapper.append(header, body);
  return wrapper;
}

function appendMarkdownTokens(target, tokens) {
  const stack = [target];
  for (const token of tokens) {
    if (token.hidden) continue;
    const parent = stack.at(-1);
    if (token.nesting && markdownTags.has(token.tag)) {
      if (token.nesting < 0) {
        stack.pop();
        continue;
      }

      const href = token.tag === 'a' ? token.attrGet('href') : null;
      const safeLink = href && /^https?:\/\//i.test(href);
      const citation = href?.match(/^(?:\.\/)?([^:#?]+\.[\w+-]+)#L([1-9]\d*)(?:-L\d+)?$/);
      const node = element(token.tag === 'a' && !safeLink && !citation ? 'span' : token.tag);
      if (safeLink) {
        node.href = href;
        node.target = '_blank';
        node.rel = 'noopener noreferrer';
        const title = token.attrGet('title');
        if (title) node.title = title;
      }
      if (citation) {
        let file;
        try { file = decodeURIComponent(citation[1]); } catch { file = citation[1]; }
        node.href = '#';
        node.title = `Open ${file} at line ${citation[2]}`;
        node.addEventListener('click', event => {
          event.preventDefault();
          send('openSource', { path: file, line: Number(citation[2]) });
        });
      }
      if (token.tag === 'ol') {
        const start = token.attrGet('start');
        if (start !== null) node.start = Number(start);
      }
      if (token.tag === 'th' || token.tag === 'td') {
        const alignment = /^text-align:(center|right)$/.exec(token.attrGet('style') || '');
        if (alignment) node.className = `markdown-align-${alignment[1]}`;
      }
      if (token.tag === 'table') {
        const scroll = element('div', 'markdown-table');
        scroll.tabIndex = 0;
        scroll.setAttribute('role', 'region');
        scroll.setAttribute('aria-label', 'Scrollable table');
        scroll.append(node);
        parent.append(scroll);
      } else {
        parent.append(node);
      }
      stack.push(node);
      continue;
    }

    switch (token.type) {
      case 'inline': appendMarkdownTokens(parent, token.children); break;
      case 'text': parent.append(token.content); break;
      case 'softbreak': parent.append('\n'); break;
      case 'hardbreak': parent.append(element('br')); break;
      case 'hr': parent.append(element('hr')); break;
      case 'code_inline': parent.append(element('code', 'inline-code', token.content)); break;
      case 'fence':
      case 'code_block': parent.append(renderCodeBlock(token.content, token.info)); break;
      // Model replies can reference images, but rendering a reply must never fetch them.
      case 'image': parent.append(token.content || '[Image]'); break;
    }
  }
}

function renderMessageContent(container, rawText) {
  const blockControls = root => [...root.querySelectorAll('.code-block-wrapper')].filter(block => !block.parentElement?.closest('.markdown-preview-body'));
  const savedControls = blockControls(container).map(block => Array.from(block.querySelectorAll(':scope > .code-block-header [aria-pressed="true"]'), control => control.dataset.codeControl));
  const content = document.createDocumentFragment();
  appendMarkdownTokens(content, markdown.parse(rawText, {}));
  container.replaceChildren(content);
  blockControls(container).forEach((block, i) => {
    for (const key of savedControls[i] ?? []) block.querySelector(`:scope > .code-block-header [data-code-control="${key}"]`)?.click();
  });
}

function plainResponse(text) {
  const blocks = new Set(['paragraph_close', 'heading_close', 'list_item_close', 'blockquote_close', 'tr_close']);
  const extract = tokens => tokens.map(token => {
    if (token.children) return extract(token.children);
    if (blocks.has(token.type) || token.type.endsWith('break')) return '\n';
    if (token.type === 'td_close' || token.type === 'th_close') return '\t';
    return token.content || '';
  }).join('');
  return extract(markdown.parse(text, {})).trim();
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
    timerSpan.textContent = `Worked for ${formatDuration(lastCompletedDuration ?? 0)}`;
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
          timerSpan.textContent = `Worked for ${formatDuration(lastCompletedDuration ?? 0)}`;
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
    const copy = element('details', 'reply-copy');
    const copyStatus = element('summary', '', 'Copy reply');
    const actions = element('div', 'reply-copy-actions');
    for (const [label, transform] of [['Markdown', text => text], ['Plain text', plainResponse]]) {
      actions.append(button(label, 'small-button', async () => {
        try {
          const text = row.querySelector('.message-body').dataset.text || '';
          await navigator.clipboard.writeText(transform(text));
          copyStatus.textContent = 'Copied';
        } catch { copyStatus.textContent = 'Copy failed'; }
        copy.open = false;
        setTimeout(() => { copyStatus.textContent = 'Copy reply'; }, 2000);
      }));
    }
    copy.append(copyStatus, actions);
    header.append(copy);
    row.append(header);

    if ((steps.length > 0 || busy) && isLast) {
      row.append(createWorkTraceElement(busy, steps));
    }
  }

  const body = element('div', 'message-body');
  body.dataset.text = message.text || '';
  if (isUser) body.textContent = message.text || '';
  else if (message.text && message.text.trim()) renderMessageContent(body, message.text);
  row.append(body);


  return row;
}

const fileReviewOpen = new Map();
let reviewSignature;
let activeApproval;
function activeReview() {
  return state.proposals.find(proposal => proposal.state === 'pending' && state.approvals.some(a => a.name === 'apply_proposal' && a.args?.proposalId === proposal.id));
}

function reviewSummary(proposal) {
  const counts = { accept: 0, reject: 0, pending: 0 };
  for (const file of proposal.files) for (const hunk of file.hunks) counts[hunk.decision]++;
  return counts;
}

function nextHunk() {
  const id = activeReview()?.id;
  const group = [...document.querySelectorAll('#review-list .hunk[data-decision="pending"]')].find(hunk => hunk.dataset.proposalId === id);
  if (!group) return;
  group.closest('details').open = true;
  group.scrollIntoView({ block: 'center' });
  group.focus({ preventScroll: true });
}

function renderReview() {
  const current = activeReview();
  const bar = $('review-bar');
  bar.hidden = !current;
  if (current) {
    const counts = reviewSummary(current);
    $('review-count').textContent = `${counts.accept} accepted · ${counts.reject} rejected · ${counts.pending} pending`;
    $('next-hunk').disabled = !counts.pending;
    $('sticky-apply').textContent = counts.accept ? 'Apply' : 'Finish';
    $('sticky-apply').disabled = !!(counts.pending || state.auxiliary || (counts.accept && state.stale?.proposalId === current.id));
  }
  const signature = JSON.stringify([state.proposals, current?.id, state.auxiliary, state.stale, state.verification?.proposalId, state.impactResults]);
  if (signature === reviewSignature) return;
  reviewSignature = signature;
  const list = $('review-list');
  const currentKeys = new Set(state.proposals.flatMap(proposal => proposal.files.map(file => `${proposal.id}:${file.path}`)));
  for (const key of fileReviewOpen.keys()) if (!currentKeys.has(key)) fileReviewOpen.delete(key);
  const focus = list.contains(document.activeElement) ? document.activeElement.dataset.reviewFocus : undefined;
  const activeProposals = state.proposals.filter(proposal => !dismissedProposals.has(proposal.id));
  list.replaceChildren(...activeProposals.map(proposal => {
    const section = element('section', 'review');
    const editable = proposal.state === 'pending' && !state.auxiliary;
    const counts = reviewSummary(proposal);
    const head = element('div', 'review-header');
    const status = { pending: 'Staged', applied: 'Applied', rejected: 'Rejected', expired: 'Expired' }[proposal.state];
    head.append(element('strong', '', 'Review changes'), element('small', `outcome-${proposal.state}`, `${proposal.files.length} ${proposal.files.length === 1 ? 'file' : 'files'} · ${status}`));
    const dismissReview = () => {
      dismissedProposals.add(proposal.id);
      section.remove();
    };
    if (proposal.state !== 'pending') {
      const dismissBtn = button('', 'card-dismiss-btn', dismissReview);
      dismissBtn.title = 'Dismiss review';
      dismissBtn.innerHTML = SVG_ICONS.close;
      head.append(dismissBtn);
    }
    section.append(head, element('p', 'review-progress', `${counts.accept} accepted · ${counts.reject} rejected · ${counts.pending} pending`));
    const layout = element('div', 'review-actions');
    if (proposal.state === 'pending') {
      layout.append(
        button('Accept all', 'small-button', () => send('acceptAllHunks', { proposalId: proposal.id }), !editable),
        button('Second opinion', 'small-button', () => send('reviewPatch', { proposalId: proposal.id }), !editable || current?.id !== proposal.id),
      );
    }
    if ((proposal.state === 'pending' || proposal.state === 'applied') && state.verification?.proposalId !== proposal.id) {
      layout.append(button('Select checks', 'small-button', () => send('planChecks', { proposalId: proposal.id }), !!state.auxiliary || (proposal.state === 'pending' && current?.id !== proposal.id)));
    }
    const stale = state.stale?.proposalId === proposal.id;
    if (stale || proposal.state === 'expired') {
      if (stale) section.append(element('p', 'review-note', `Changed since staging: ${state.stale.paths.join(', ')}`));
      layout.append(button('Refresh proposal', 'small-button', () => send('refreshStale', { proposalId: proposal.id }), !!state.auxiliary));
    }
    section.append(layout);
    for (const file of proposal.files) {
      const pending = file.hunks.filter(hunk => hunk.decision === 'pending').length;
      const key = `${proposal.id}:${file.path}`;
      const group = element('details', `review-file${pending ? ' has-pending' : ''}`);
      group.open = fileReviewOpen.get(key) ?? pending > 0;
      group.addEventListener('toggle', () => fileReviewOpen.set(key, group.open));
      group.append(element('summary', 'review-file-label', `${file.path} · ${pending} pending`));
      group.append(button('Open diff ↗', 'small-button review-diff', () => send('preview', { proposalId: proposal.id, path: file.path })));
      for (const [i, hunk] of file.hunks.entries()) {
        const line = (file.original || '').slice(0, hunk.start).split('\n').length;
        const row = element('div', 'hunk');
        row.tabIndex = -1;
        row.dataset.decision = hunk.decision;
        row.dataset.hunkId = hunk.id;
        row.dataset.proposalId = proposal.id;
        row.dataset.reviewFocus = hunk.id;
        const label = element('div', 'hunk-label');
        label.append(element('span', '', `Hunk ${i + 1} · Line ${line}`), element('span', '', hunk.decision));
        row.append(label);
        if (hunk.before) row.append(element('pre', 'before', hunk.before));
        if (hunk.after) row.append(element('pre', 'after', hunk.after));
        const actions = element('div', 'hunk-actions');
        for (const decision of ['reject', 'accept']) {
          const choice = button(decision === 'accept' ? 'Accept' : 'Reject', `small-button ${hunk.decision === decision ? decision + 'ed' : ''}`, () => send('decide', { proposalId: proposal.id, hunkId: hunk.id, decision }), !editable);
          choice.dataset.reviewFocus = `${hunk.id}:${decision}`;
          choice.setAttribute('aria-pressed', String(hunk.decision === decision));
          actions.append(choice);
        }
        row.append(actions);
        group.append(row);
      }
      const impact = state.impactResults?.find(result => result.targetFile === file.path);
      if (impact) group.append(createImpactRadarCard(impact));
      section.append(group);
    }
    const footer = element('div', 'review-footer');
    if (proposal.state === 'pending') {
      footer.append(button(counts.accept ? 'Apply selected hunks' : 'Finish review', 'primary wide', () => send('apply', { proposalId: proposal.id }), current?.id !== proposal.id || !!counts.pending || !editable || (!!counts.accept && stale)));
      footer.append(button('Reject all remaining', 'mention-button', () => send('rejectRemaining', { proposalId: proposal.id }), !editable));
    } else {
      const resolvedRow = element('div', 'review-resolved-row');
      const resolvedMsg = element('div', `review-resolved-msg ${proposal.state}`);
      resolvedMsg.innerHTML = proposal.state === 'applied'
        ? `<span class="icon-inline">${SVG_ICONS.check}</span> Changes applied to workspace`
        : `<span class="icon-inline">${SVG_ICONS.close}</span> ${proposal.state === 'expired' ? 'Review expired' : 'Proposed changes rejected'}`;

      const dismissActionBtn = button('Dismiss', 'review-dismiss-action', dismissReview);
      dismissActionBtn.title = 'Dismiss review';
      resolvedRow.append(resolvedMsg, dismissActionBtn);
      footer.append(resolvedRow);
    }
    section.append(footer);
    return section;
  }));
  if (focus) Array.from(list.querySelectorAll('[data-review-focus]')).find(node => node.dataset.reviewFocus === focus)?.focus({ preventScroll: true });
  if (current?.id !== activeApproval) {
    activeApproval = current?.id;
    if (current && document.hasFocus() && !focus) requestAnimationFrame(nextHunk);
  }
}

const checkName = input => [input.task, ...(input.args ?? [])].join(' ');
const checkPassed = check => check.result.exitCode === 0 && !check.result.timedOut && !check.result.cancelled && check.result.cleanupConfirmed;
function checkStatus(check, checks) {
  if (check.result.cancelled) return 'Cancelled';
  if (check.result.timedOut) return 'Timed out';
  if (check.result.exitCode === null) return 'Could not finish';
  const passed = checkPassed(check);
  const previous = check.phase === 'after' ? checks.find(candidate => candidate.phase === 'baseline' && checkName(candidate.input) === checkName(check.input)) : undefined;
  if (previous && previous.result.exitCode !== null && !previous.result.cancelled && !previous.result.timedOut) {
    if (!passed && checkPassed(previous)) return 'New failure';
    if (!passed) return 'Failed before and after';
    if (!checkPassed(previous)) return 'Now passing';
  }
  return passed ? 'Passed' : 'Failed';
}

let evidenceSignature;
let reviewerText;
function renderEvidence() {
  const review = state.review;
  const proposal = state.proposals.find(item => item.id === state.verification?.proposalId);
  const evidence = state.evidence;
  const plan = state.verification;
  const signature = JSON.stringify([review, evidence, plan, proposal?.state, state.auxiliary, state.status]);
  if (signature === evidenceSignature) return;
  evidenceSignature = signature;
  const report = $('review-report');
  if (review && reviewerText !== JSON.stringify(review)) {
    reviewerText = JSON.stringify(review);
    const card = element('section', 'evidence-card');
    card.append(element('strong', '', 'Independent review'), element('p', '', review.model), button('Reviewer session ↗', 'small-button', () => send('openReviewSession')));
    if (review.stale) card.append(element('p', 'review-note', 'Hunk decisions changed after this review.'));
    const body = element('div', 'message-body');
    renderMessageContent(body, review.text || 'Waiting for reviewer output…');
    card.append(body);
    report.replaceChildren(card);
  } else if (!review) {
    reviewerText = undefined;
    report.replaceChildren();
  }
  const output = $('verification-list');
  const openChecks = new Set([...output.querySelectorAll('details[open]')].map(check => check.dataset.index));
  output.replaceChildren();
  if (plan && proposal) {
    const card = element('section', 'evidence-card');
    card.append(element('strong', '', 'Verification plan'), element('p', '', plan.inputs.map(checkName).join(' · ')));
    if (proposal.state === 'pending') card.append(button(plan.baselineDone ? 'Baseline recorded' : 'Run baseline checks', 'small-button', () => send('runChecks', { proposalId: proposal.id, phase: 'baseline' }), !!state.auxiliary || !!plan.baselineDone));
    if (proposal.state === 'applied') card.append(button(plan.afterDone ? 'Post-change checks recorded' : 'Run same checks', 'small-button', () => send('runChecks', { proposalId: proposal.id, phase: 'after' }), !!state.auxiliary || !!plan.afterDone));
    output.append(card);
  }
  const checks = evidence?.checks ?? [];
  for (const [index, check] of checks.entries()) {
    const details = element('details', 'evidence-card check-output');
    details.dataset.index = String(index);
    details.open = openChecks.has(details.dataset.index);
    const phase = { baseline: 'Baseline', after: 'After changes', agent: 'Agent check' }[check.phase];
    const status = checkStatus(check, checks);
    const summary = element('summary', 'check-summary');
    summary.append(element('strong', '', `${phase} · ${checkName(check.input)}`), element('span', checkPassed(check) ? 'outcome-applied' : 'outcome-rejected', status));
    details.append(summary, element('p', '', `Exit ${check.result.exitCode ?? 'unavailable'} · ${(check.durationMs / 1000).toFixed(1)}s`));
    if (check.changedSource.length) details.append(element('p', 'review-note', `Detected source changes: ${check.changedSource.join(', ')}`));
    if (check.result.truncated || check.detectionPartial) details.append(element('p', 'review-note', check.result.truncated ? 'Output truncated by the command runner.' : 'Source-change detection was partial.'));
    const text = [check.result.stdout, check.result.stderr].filter(Boolean).join('\n');
    if (text) details.append(element('pre', 'code-block-content', text.slice(0, 8000)));
    details.append(button('Open captured output', 'small-button', () => send('showCheck', { index })));
    output.append(details);
  }
  const result = $('run-evidence');
  result.replaceChildren();
  if (!evidence) return;
  const card = element('section', 'forgeproof-card');
  card.append(element('strong', 'forgeproof-title', 'ForgeProof'));
  const after = checks.filter(check => check.phase !== 'baseline');
  const edited = [...new Set(evidence.edits.flatMap(edit => edit.paths))];
  const staged = state.proposals.filter(item => item.state === 'pending').flatMap(item => item.files.map(file => file.path));
  if (staged.length) card.append(element('p', 'outcome-pending', `${new Set(staged).size} files staged for review`));
  if (edited.length) card.append(element('p', 'outcome-applied', `${edited.length} files applied`));
  if (after.length) card.append(element('p', '', `${after.filter(checkPassed).length} of ${after.length} executed checks passed`));
  const stats = [];
  if (evidence.finishedAt) stats.push(`${((evidence.finishedAt - evidence.startedAt) / 1000).toFixed(1)}s`);
  stats.push(evidence.usage.measured ? `${evidence.usage.tokens.toLocaleString()} reported tokens` : 'Usage unavailable');
  if (evidence.usage.estimatedCost !== undefined) stats.push(`≈ $${evidence.usage.estimatedCost.toFixed(4)}`);
  if (evidence.stopReason) stats.push(evidence.stopReason);
  card.append(element('p', 'review-note', stats.join(' · ')));
  const files = element('div', 'forgeproof-file-list');
  for (const file of edited) files.append(button(file, 'forgeproof-file-pill', () => send('openDiff', { path: file })));
  card.append(files);
  const actions = element('div', 'review-actions');
  actions.append(button('Export receipt', 'small-button', () => send('exportEvidence')));
  if (edited.length && evidence.finishedAt) actions.append(button('Prepare draft PR', 'small-button', () => send('draftPullRequest'), !!state.auxiliary));
  card.append(actions);
  result.append(card);
}

function renderContextEditor() {
  const pane = $('context-editor');
  if (pane.hidden) return;
  const choices = $('context-picks');
  $('context-add').disabled = $('context-refresh').disabled = $('symbol-graph').disabled = !!state.auxiliary || isRunning();
  choices.replaceChildren();
  for (const [key, label] of [['pins', 'Pinned'], ['excluded', 'Excluded']]) {
    for (const file of draft[key]) {
      choices.append(button(`${label} · ${file} ×`, 'small-button', () => {
        draft[key] = draft[key].filter(item => item !== file);
        refreshDraft();
      }, !!state.auxiliary || isRunning()));
    }
  }
  const list = $('draft-context-list');
  list.replaceChildren();
  if (!state.draftContext) return;
  for (const chunk of state.draftContext.chunks) {
    const card = element('div', 'context-chip');
    card.append(element('strong', '', chunk.path), element('small', '', `${chunk.tokens.toLocaleString()} estimated units · ${chunk.reason}`));
    const actions = element('div', 'review-actions');
    actions.append(
      button('Pin', 'small-button', () => setPin(chunk.path), draft.pins.includes(chunk.path) || !!state.auxiliary || isRunning()),
      button('Remove', 'small-button', () => {
        draft.pins = draft.pins.filter(file => file !== chunk.path);
        draft.excluded = [...new Set([...draft.excluded, chunk.path])];
        refreshDraft();
      }, !!state.auxiliary || isRunning()),
      button('Replace', 'small-button', () => { replacement = chunk.path; send('contextPick'); }, !!state.auxiliary || isRunning()),
    );
    card.append(actions);
    list.append(card);
  }
}

function statusLabel() {
  if (state.retry) return `${state.retry.message} · ${Math.max(0, Math.ceil((state.retry.until - Date.now()) / 1000))}s`;
  if (state.auxiliary) return state.auxiliary;
  if (state.status === 'cancelled' && state.evidence?.stopReason) return state.evidence.stopReason;
  return ({
    running: 'Working through your repository…', connecting: 'Connecting to TrueForge…',
    'awaiting-review': 'Review required', cancelling: 'Stopping and cleaning up…',
    cancelled: 'Run stopped', completed: 'Task complete', failed: 'Needs attention',
  })[state.status] || state.status;
}

const feed = document.querySelector('main');
const nearEnd = () => feed.scrollHeight - feed.scrollTop - feed.clientHeight < 140;
const scrollToEnd = () => feed.scrollTo({ top: feed.scrollHeight });
let followFeed = true;
let announcedStatus;
function markJump() {
  $('jump-latest').hidden = followFeed || nearEnd();
}
feed.addEventListener('scroll', () => { followFeed = nearEnd(); markJump(); }, { passive: true });
$('jump-latest').addEventListener('click', () => { followFeed = true; scrollToEnd(); markJump(); });
setInterval(() => { if (state.retry) $('status-text').textContent = statusLabel(); }, 300);

function render() {
  const busy = isRunning() || !!state.auxiliary;
  
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
  const pMode = state.permissionMode || 'review';
  const pCfg = PERM_CONFIG[pMode] || PERM_CONFIG.auto;
  const pIcon = $('perm-icon');
  const pLabel = $('perm-label');
  if (pIcon && pCfg.iconSvg) pIcon.innerHTML = pCfg.iconSvg;
  if (pLabel) pLabel.textContent = pCfg.label;

  document.querySelectorAll('.perm-option').forEach(opt => {
    opt.classList.toggle('active', opt.dataset.mode === pMode);
  });

  $('hero').hidden = state.messages.length > 0;
  $('run-status').hidden = state.status === 'idle' && !state.auxiliary;
  $('run-status').classList.toggle('busy', busy);
  $('run-status').dataset.runState = state.retry ? 'retry' : state.status;
  if (isRunning() && !state.retry && !state.auxiliary) {
    $('status-text').replaceChildren(createDynamicLoadingElement(getCurrentProcess(state, busy).text));
  } else {
    $('status-text').textContent = statusLabel();
  }
  const announce = state.retry?.message || statusLabel();
  if (announce !== announcedStatus && announce !== 'idle') $('announce').textContent = announce;
  announcedStatus = announce;
  $('stop').hidden = !busy; $('send').disabled = busy; $('prompt').disabled = busy;
  $('workflow').disabled = $('preview-context').disabled = $('isolated').disabled = busy;
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

  const currentNodes = Array.from(transcript.children).filter(node => !node.classList.contains('impact-radar-card'));
  transcript.querySelectorAll(':scope > .impact-radar-card').forEach(node => node.remove());
  if (newNodes.length !== currentNodes.length || newNodes.some((node, index) => node !== currentNodes[index])) {
    transcript.replaceChildren(...newNodes);
  }

  if (transcript.scrollHeight > oldHeight && state.status === 'running' && followFeed) requestAnimationFrame(scrollToEnd);
  requestAnimationFrame(markJump);

  $('error').hidden = !state.error;
  $('error-text').textContent = state.error || '';
  if (state.error && state.error !== renderedError) requestAnimationFrame(() => $('error').scrollIntoView({ block: 'nearest', behavior: 'auto' }));
  renderedError = state.error || null;

  $('contexts').hidden = !state.context;
  if (state.context) {
    const c = state.context;
    const costs = new Map();
    for (const chunk of c.chunks) costs.set(chunk.path, (costs.get(chunk.path) ?? 0) + (chunk.tokens ?? 0));
    $('budget-label').textContent = `${c.usedTokens.toLocaleString()} / ${c.budgetTokens.toLocaleString()} tokens`;
    $('budget-index').textContent = c.selectionOnly ? '1 file' : `${c.indexedFiles} files`;
    $('meter-bar').style.width = `${Math.min(100, c.usedTokens / Math.max(1, c.budgetTokens) * 100)}%`;
    $('source-list').replaceChildren(...c.chunks.map(chunk => {
      const card = element('div', 'context-chip');
      card.append(
        button(`${chunk.path} (L${chunk.startLine}–${chunk.endLine})`, 'context-file-link', () => send('openSource', { path: chunk.path, line: chunk.startLine })),
        element('small', 'context-cost', `${costs.get(chunk.path).toLocaleString()} estimated units for this file`),
        element('p', 'context-reason', chunk.reason),
      );
      return card;
    }));
  }

  renderReview();
  renderEvidence();
  renderContextEditor();

  // Render command checks with modern agent CLI card styling
  const activeApprovals = state.approvals.filter(a => a.name === 'run_command' && !dismissedApprovals.has(a.toolCallId));
  $('command-list').replaceChildren(...activeApprovals.map(a => {
    const card = element('div', 'command-card');
    const decision = approvalDecisions.get(a.toolCallId);
    const dismiss = () => {
      if (!approvalDecisions.has(a.toolCallId)) {
        approvalDecisions.set(a.toolCallId, 'denied');
        send('commandDecision', { toolCallId: a.toolCallId, allow: false });
      }
      dismissedApprovals.add(a.toolCallId);
      card.remove();
    };

    // Header
    const header = element('div', 'command-card-header');
    const headerLeft = element('div', 'command-header-left');
    const termIcon = element('span', 'command-header-icon');
    termIcon.innerHTML = SVG_ICONS.terminal;

    const tagStatus = decision ? decision : 'required';
    const tagText = decision === 'allowed' ? 'Allowed' : decision === 'denied' ? 'Denied' : 'Approval required';
    const badgeTag = element('span', `command-badge-tag ${tagStatus}`, tagText);

    headerLeft.append(termIcon, element('span', 'command-card-title', 'Terminal Command Request'), badgeTag);

    // Cross / dismiss button
    const crossBtn = button('', 'card-dismiss-btn', dismiss);
    crossBtn.title = decision ? 'Dismiss request' : 'Deny and dismiss request';
    crossBtn.innerHTML = SVG_ICONS.close;
    header.append(headerLeft, crossBtn);
    card.append(header);

    // Command CLI code box
    const cmdStr = formatCommandString(a.args);
    const cliBox = element('div', 'command-cli-box');
    const cliLine = element('div', 'command-cli-line');
    const promptSym = element('span', 'command-prompt-symbol', '$');
    const codeEl = element('code', 'command-cli-code', cmdStr);
    cliLine.append(promptSym, codeEl);

    const copyBtn = element('button', 'command-copy-btn');
    copyBtn.type = 'button';
    copyBtn.title = 'Copy command';
    copyBtn.innerHTML = `${SVG_ICONS.copy}<span>Copy</span>`;
    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(cmdStr).then(() => {
        copyBtn.innerHTML = `${SVG_ICONS.check}<span>Copied!</span>`;
        setTimeout(() => {
          copyBtn.innerHTML = `${SVG_ICONS.copy}<span>Copy</span>`;
        }, 1500);
      }).catch(() => {});
    });

    cliBox.append(cliLine, copyBtn);
    card.append(cliBox);

    // Security note
    const secRow = element('div', 'command-security-row');
    const shieldIcon = element('span', 'command-security-icon');
    shieldIcon.innerHTML = SVG_ICONS.shield;
    secRow.append(shieldIcon, element('span', '', 'Runs locally in workspace with your user permissions'));
    card.append(secRow);

    // Actions
    const actions = element('div', 'command-actions');
    function showResolvedActions(status) {
      crossBtn.title = 'Dismiss request';
      actions.replaceChildren();
      const statusRow = element('div', 'command-status-row');
      const statusMsg = element('div', `command-status-msg ${status}`);
      statusMsg.innerHTML = status === 'allowed'
        ? `<span class="icon-inline">${SVG_ICONS.check}</span> Command allowed`
        : `<span class="icon-inline">${SVG_ICONS.close}</span> Command denied`;

      const dismissAction = button('Dismiss', 'review-dismiss-action', dismiss);
      dismissAction.title = 'Dismiss';
      statusRow.append(statusMsg, dismissAction);
      actions.append(statusRow);
    }

    if (!decision) {
      const denyBtn = button('Deny', 'command-action-btn command-deny-btn', () => {
        approvalDecisions.set(a.toolCallId, 'denied');
        send('commandDecision', { toolCallId: a.toolCallId, allow: false });
        badgeTag.className = 'command-badge-tag denied';
        badgeTag.textContent = 'Denied';
        showResolvedActions('denied');
      });
      const allowBtn = button('Allow once', 'command-action-btn command-allow-btn', () => {
        approvalDecisions.set(a.toolCallId, 'allowed');
        send('commandDecision', { toolCallId: a.toolCallId, allow: true });
        badgeTag.className = 'command-badge-tag allowed';
        badgeTag.textContent = 'Allowed';
        showResolvedActions('allowed');
      });
      actions.append(denyBtn, allowBtn);
    } else {
      showResolvedActions(decision);
    }

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
  renderProviders();
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
    const openConversation = () => {
      closeAllDrawers();
      send('switchConversation', { id: conv.id });
    };
    item.addEventListener('click', openConversation);
    item.addEventListener('keydown', event => {
      if (event.target === item && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        openConversation();
      }
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

let previousReproFields;
function renderRepro(state) {
  const panel = $('repro-panel');
  if (!panel) return;
  const session = state.reproSession;
  if (!session) {
    panel.hidden = true;
    previousReproFields = undefined;
    return;
  }
  panel.hidden = false;
  const errInput = $('repro-error-input');
  const stackInput = $('repro-stack-input');
  const fileInput = $('repro-file-input');
  const headerText = $('repro-header-text');
  const fields = [session.errorText, session.stackTrace, session.affectedFile];
  [errInput, stackInput, fileInput].forEach((input, index) => {
    if (input && (!previousReproFields || fields[index] !== previousReproFields[index])) input.value = fields[index] || '';
    if (input) input.disabled = session.phase === 'red_running';
  });
  previousReproFields = fields;
  $('repro-submit-btn').disabled = $('repro-quick-pick').disabled = session.phase === 'red_running';

  if (headerText) {
    if (session.phase === 'red_running') {
      headerText.textContent = 'Repro-to-Regression (Running Red-Green Protocol…)';
    } else if (session.phase === 'done') {
      headerText.textContent = 'Repro-to-Regression (Review check results)';
    } else if (session.phase === 'incomplete') {
      headerText.textContent = 'Repro-to-Regression (Run incomplete)';
    } else {
      headerText.textContent = 'Repro-to-Regression';
    }
  }
}

function createImpactRadarCard(res, isStandalone = false) {
  const card = element('div', `impact-radar-card ${res.riskLevel}`);
  const hdr = element('div', 'impact-header');
  const title = element('div', 'impact-title');
  const icon = element('span', 'icon-inline');
  icon.innerHTML = SVG_ICONS.zap;
  title.append(icon, document.createTextNode(' Impact Radar · '), element('code', '', res.targetFile));
  const badge = element('span', `impact-badge ${res.riskLevel}`, `${res.riskLevel.toUpperCase()} RISK`);

  if (isStandalone) {
    const hdrRight = element('div', 'impact-hdr-right');
    hdrRight.style.display = 'flex';
    hdrRight.style.alignItems = 'center';
    hdrRight.style.gap = '6px';
    hdrRight.append(badge);

    const dismissBtn = button('', 'card-dismiss-btn', () => card.remove());
    dismissBtn.title = 'Dismiss Impact Radar';
    dismissBtn.innerHTML = SVG_ICONS.close;
    hdrRight.append(dismissBtn);
    hdr.append(title, hdrRight);
  } else {
    hdr.append(title, badge);
  }
  card.append(hdr);

  const body = element('div', 'impact-body');
  if (res.partial) body.append(element('p', 'impact-subhead', 'Some workspace files were outside the scan or could not be read.'));
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
    iso.textContent = 'No downstream consumers found in the scanned files.';
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
  // If proposals are displayed in review-list, impact is embedded inside the proposal cards.
  // Only display in transcript if there are no visible proposals.
  const activeProposals = state.proposals.filter(p => !dismissedProposals.has(p.id));
  if (activeProposals.length === 0) {
    for (const res of results) {
      transcript.append(createImpactRadarCard(res, true));
    }
  }
}

const promptInput = $('prompt');
const workflow = $('workflow');
promptInput.value = typeof saved.prompt === 'string' ? saved.prompt : '';
workflow.value = ['build', 'ask', 'plan'].includes(saved.workflow) ? saved.workflow : 'build';
function storeDraft() { vscode.setState?.({ demo: demoMode, prompt: promptInput.value, workflow: workflow.value }); }
function adjustPromptHeight() {
  promptInput.style.height = 'auto';
  promptInput.style.height = `${Math.min(200, Math.max(52, promptInput.scrollHeight))}px`;
}
function renderMentions() {
  const tray = $('mention-chips');
  const mentions = [...promptInput.value.matchAll(/@(?:file|folder|symbol)(?:\([^\r\n)]+\)|:(?:"[^"\r\n]+"|[^\s,;]+))|@[\w.\-]+(?:\/[\w.\-]+)+/g)];
  tray.hidden = !mentions.length;
  tray.replaceChildren(...mentions.map(match => {
    const chip = button(`${match[0]} ×`, 'small-button', () => {
      promptInput.setRangeText('', match.index, match.index + match[0].length, 'start');
      refreshComposer();
      promptInput.focus();
    });
    chip.type = 'button';
    chip.setAttribute('aria-label', `Remove ${match[0]}`);
    return chip;
  }));
}
function refreshComposer() { adjustPromptHeight(); renderMentions(); storeDraft(); }
function syncWorkflow() {
  $('send').textContent = ({ ask: 'Ask ↗', plan: 'Plan ↗', build: 'Build ↗' })[workflow.value];
  storeDraft();
}
workflow.addEventListener('change', syncWorkflow);
function refreshDraft() {
  renderContextEditor();
  if (!state.auxiliary && !isRunning()) send('contextPreview', { prompt: promptInput.value.trim(), context: draft });
}
function setPin(file) {
  if (replacement && replacement !== file) {
    draft.pins = draft.pins.filter(item => item !== replacement);
    draft.excluded = [...new Set([...draft.excluded, replacement])];
  }
  replacement = undefined;
  draft.excluded = draft.excluded.filter(item => item !== file);
  draft.pins = [...new Set([...draft.pins, file])].slice(0, 20);
  refreshDraft();
}
$('preview-context').addEventListener('click', () => {
  $('context-editor').hidden = !$('context-editor').hidden;
  if (!$('context-editor').hidden) refreshDraft();
});
$('context-refresh').addEventListener('click', refreshDraft);
$('context-add').addEventListener('click', () => { replacement = undefined; send('contextPick'); });
$('symbol-graph').addEventListener('change', event => { draft.semantic = event.target.checked; refreshDraft(); });

promptInput.addEventListener('input', () => {
  refreshComposer();

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
  if (prompt && !isRunning() && !state.auxiliary) {
    const limits = Object.fromEntries(['seconds', 'tokens', 'cost', 'rate'].map(key => [key, Number($(`limit-${key}`).value || 0)]));
    if (limits.cost && !limits.rate) {
      $('run-options').open = true;
      $('limit-rate').setCustomValidity('Enter an estimated price per million tokens.');
      $('limit-rate').reportValidity();
      return;
    }
    hideSlashMenu();
    hideMentionMenu();
    turnStartTime = Date.now();
    lastCompletedDuration = null;
    followFeed = true;
    send('run', { prompt, workflow: workflow.value, context: draft, limits });
    $('prompt').value = '';
    $('context-editor').hidden = true;
    refreshComposer();
  }
});
$('limit-rate').addEventListener('input', () => $('limit-rate').setCustomValidity(''));
$('limit-cost').addEventListener('input', () => $('limit-rate').setCustomValidity(''));

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
const providerDrawer = $('provider-drawer');
const providerTrigger = $('model');
const modelIcon = $('model-provider-icon');
const defaultModelIcon = modelIcon.firstElementChild.cloneNode(true);
const providerLogos = { gemini: geminiLogo, groq: groqLogo, openrouter: openRouterLogo, 'workers-ai': workersAiLogo, cohere: cohereLogo, vercel: vercelLogo };
let activeProvider;
let shownProviderLogo;
let providerSignature;

function providerLogo(id) {
  if (!Object.hasOwn(providerLogos, id)) return element('span', 'provider-monogram', id === 'custom' ? '↗' : id[0].toUpperCase());
  const image = element('img', 'provider-logo');
  image.src = providerLogos[id];
  image.alt = '';
  image.dataset.brand = id;
  return image;
}

function renderProviders() {
  const groups = state.providers ?? [];
  const selected = groups.find(group => group.models.some(model => model.name === state.model));
  if (shownProviderLogo !== selected?.id) {
    shownProviderLogo = selected?.id;
    modelIcon.replaceChildren(selected ? providerLogo(selected.id) : defaultModelIcon.cloneNode(true));
  }
  if (providerDrawer.hidden) return;
  const search = $('provider-search');
  const group = groups.find(item => item.id === activeProvider) ?? selected ?? groups[0];
  const busy = isRunning() || !!state.auxiliary || !!state.providerBusy;
  const signature = JSON.stringify([groups, group?.id, state.model, state.connected, state.providerError, busy, search.value]);
  if (signature === providerSignature) return;
  providerSignature = signature;
  const options = $('provider-options');
  const modelList = $('provider-models');
  const focused = document.activeElement.dataset.providerFocus;
  options.replaceChildren(...groups.map(item => {
    const choice = button('', 'provider-option', () => {
      activeProvider = item.id;
      search.value = '';
      renderProviders();
    });
    choice.append(providerLogo(item.id), element('span', '', item.label));
    choice.setAttribute('aria-pressed', String(item.id === group?.id));
    choice.dataset.providerFocus = item.id;
    return choice;
  }));
  $('provider-detail').hidden = !group;
  $('provider-feedback').textContent = state.providerError || (state.providerBusy ? 'Saving provider in TrueForge…' : state.connected ? '' : 'Start TrueForge with npm run harness, then refresh.');
  $('provider-refresh').disabled = !!state.providerBusy;
  if (!group) return;
  $('provider-name').textContent = group.label;
  $('provider-note').textContent = group.note;
  $('provider-status').textContent = group.models.length ? 'Configured' : group.needsToken ? 'API token needed' : 'Setup needed';
  $('provider-status').dataset.configured = String(!!group.models.length);
  search.hidden = group.models.length < 4;
  const query = search.hidden ? '' : search.value.trim().toLowerCase();
  const models = group.models.filter(model => model.label.toLowerCase().includes(query));
  modelList.replaceChildren(...models.map(model => {
    const current = state.model === model.name;
    const choice = button(model.label, 'provider-model', () => send('selectProviderModel', { model: model.name }), busy || !state.connected);
    choice.title = model.name;
    choice.dataset.providerFocus = model.name;
    choice.setAttribute('aria-pressed', String(current));
    if (current) choice.append(element('span', 'provider-current', 'Selected'));
    return choice;
  }));
  if (group.models.length && !models.length) modelList.append(element('p', '', 'No matching models.'));
  if (!group.models.length && group.presets?.length) {
    const presets = element('ul', 'provider-presets');
    presets.setAttribute('aria-label', 'Models added during setup');
    presets.append(...group.presets.map(name => element('li', '', name)));
    modelList.append(presets);
  }
  const configure = $('provider-configure');
  const manage = group.models.length || group.id === 'custom' || group.id === 'gemini';
  configure.textContent = manage ? 'Manage in TrueForge ↗' : group.needsToken ? 'Add API token' : 'Connect provider';
  configure.disabled = busy || !state.connected;
  configure.onclick = () => send(manage ? 'providerSettings' : 'configureProvider', manage ? {} : { provider: group.id });
  if (focused) [...options.children, ...modelList.children].find(node => node.dataset.providerFocus === focused)?.focus({ preventScroll: true });
}

function openProviders() {
  activeProvider = (state.providers ?? []).find(group => group.models.some(model => model.name === state.model))?.id;
  $('provider-search').value = '';
  providerSignature = undefined;
  openDrawer(providerDrawer);
  renderProviders();
  $('providers-close').focus();
  send('refreshProviders');
}
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
    refreshComposer();
    turnStartTime = Date.now();
    lastCompletedDuration = null;
    send('run', { prompt: cmdObj.cmd });
  } else if (cmdObj.action === 'repro') {
    promptInput.value = '';
    refreshComposer();
    send('startRepro');
  } else {
    promptInput.value = `${cmdObj.cmd} `;
    refreshComposer();
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
  refreshComposer();
  send('mention', { kind });
}

function closeAllDrawers() {
  if (permMenu) permMenu.hidden = true;
  if (historyDrawer) historyDrawer.hidden = true;
  providerDrawer.hidden = true;
  providerTrigger.setAttribute('aria-expanded', 'false');
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
  } else if (drawer === providerDrawer) {
    providerTrigger.setAttribute('aria-expanded', 'true');
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
if (drawerNewChat) drawerNewChat.addEventListener('click', () => { closeAllDrawers(); $('new-chat').click(); });
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
    const providersOpen = !providerDrawer.hidden;
    closeAllDrawers();
    hideSlashMenu();
    hideMentionMenu();
    if (providersOpen) { e.preventDefault(); providerTrigger.focus(); }
  }
});

$('stop').addEventListener('click', () => send('stop'));
$('sticky-stop').addEventListener('click', () => send('stop'));
$('next-hunk').addEventListener('click', nextHunk);
$('sticky-apply').addEventListener('click', () => { const active = activeReview(); if (active) send('apply', { proposalId: active.id }); });
document.addEventListener('keydown', event => {
  const active = activeReview();
  if (!event.altKey || event.ctrlKey || event.metaKey || !active || state.auxiliary || event.target.closest?.('textarea,input,select')) return;
  const key = event.key.toLowerCase();
  if (key === 'enter' && !$('sticky-apply').disabled) $('sticky-apply').click();
  else if (key === 'n') nextHunk();
  else if (key === 'a' || key === 'r') {
    const pending = document.activeElement.closest?.('.hunk') ?? document.querySelector('.hunk[data-decision="pending"]');
    if (pending?.dataset.proposalId === active.id) send('decide', { proposalId: active.id, hunkId: pending.dataset.hunkId, decision: key === 'a' ? 'accept' : 'reject' });
  } else return;
  event.preventDefault();
});
providerTrigger.addEventListener('click', () => { if (providerDrawer.hidden) openProviders(); else closeAllDrawers(); });
$('connect').addEventListener('click', openProviders);
$('providers-close').addEventListener('click', () => { closeAllDrawers(); providerTrigger.focus(); });
$('provider-refresh').addEventListener('click', () => send('refreshProviders'));
$('provider-settings').addEventListener('click', () => send('providerSettings'));
$('provider-search').addEventListener('input', renderProviders);
$('session').addEventListener('click', () => send('session'));
const sessionBtnEl = $('session-btn');
if (sessionBtnEl) {
  sessionBtnEl.addEventListener('click', () => {
    closeAllDrawers();
    send('session');
  });
}
$('isolated').addEventListener('click', () => { closeAllDrawers(); send('isolated'); });
function applyDemoMode() {
  document.body.classList.toggle('demo-mode', demoMode);
  $('demo-mode').setAttribute('aria-pressed', String(demoMode));
  storeDraft();
}
$('demo-mode').addEventListener('click', () => { demoMode = !demoMode; applyDemoMode(); closeAllDrawers(); });
$('file-mention').addEventListener('click', () => send('mention', { kind: 'file' }));
const folderMention = $('folder-mention');
if (folderMention) folderMention.addEventListener('click', () => send('mention', { kind: 'folder' }));
$('symbol-mention').addEventListener('click', () => send('mention', { kind: 'symbol' }));
$('new-chat').addEventListener('click', () => {
  if (!isRunning() && !state.auxiliary) {
    draft.pins = []; draft.excluded = []; draft.semantic = false;
    replacement = undefined;
    $('symbol-graph').checked = false;
    $('context-editor').hidden = true;
    promptInput.value = '';
    refreshComposer();
  }
  send('newChat');
});
for (const card of document.querySelectorAll('[data-prompt]')) {
  card.addEventListener('click', () => {
    $('prompt').value = card.dataset.prompt;
    refreshComposer();
    $('prompt').focus();
  });
}

window.addEventListener('message', event => {
  if (event.data.type === 'state') {
    state = event.data.state;
    render();
  } else if (event.data.type === 'openProviders') {
    openProviders();
  } else if (event.data.type === 'insertMention') {
    $('prompt').value += `${$('prompt').value ? ' ' : ''}${event.data.text} `;
    refreshComposer();
    $('prompt').focus();
  } else if (event.data.type === 'pinContext' && typeof event.data.path === 'string') {
    setPin(event.data.path);
  }
});

syncWorkflow();
applyDemoMode();
refreshComposer();
send('ready');
