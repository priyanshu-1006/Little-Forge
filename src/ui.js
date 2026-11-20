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
import { appearances, isAppearance } from './appearance.js';
import { checkResult, compareVerification } from './core/chat-workflows.js';

for (const [name, language] of Object.entries({ bash, diff, javascript, json, powershell, python, typescript, xml })) highlighter.registerLanguage(name, language);

/* Host-owned state; model text is always rendered safely through textContent/DOM nodes. */
const vscode = acquireVsCodeApi();
let state = { status: 'idle', messages: [], context: null, proposals: [], approvals: [], checkpoints: [], activity: [], connected: false, model: '', permissionMode: 'review', conversations: [], activeConversationId: '' };
const isRunning = () => state.recovery?.kind === 'reconnect' || !['idle', 'completed', 'failed', 'cancelled'].includes(state.status);
const submittedCommands = new Set();
let submittedFollowUp;

function formatCommandString(args) {
  if (!args) return 'command';
  const task = args.task || 'command';
  const extra = Array.isArray(args.args) ? args.args.join(' ') : '';
  if (task === 'pytest') return extra ? `pytest ${extra}` : 'pytest';
  if (task === 'npm-test') return extra ? `npm test -- ${extra}` : 'npm test';
  if (task === 'typecheck') return 'npm run typecheck';
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
function button(text, cls, action, disabled = false) { const el = element('button', cls, text); el.type = 'button'; el.disabled = disabled; el.addEventListener('click', action); return el; }

const appearanceDialog = $('appearance-dialog');
const appearanceToggle = $('appearance-toggle');
const appearanceChoices = $('appearance-choices');
for (const appearance of appearances) {
  const option = element('label', 'appearance-option');
  const input = element('input');
  input.type = 'radio';
  input.name = 'appearance';
  input.value = appearance.id;
  const swatch = element('span', 'appearance-swatch');
  swatch.dataset.forgeTheme = appearance.id;
  swatch.setAttribute('aria-hidden', 'true');
  const caption = element('span', 'appearance-caption');
  const description = element('small', '', appearance.description);
  description.id = `appearance-description-${appearance.id}`;
  input.setAttribute('aria-describedby', description.id);
  caption.append(element('strong', '', appearance.label), description);
  option.append(swatch, caption, input);
  appearanceChoices.append(option);
}

function renderAppearance(value) {
  const selected = isAppearance(value) ? value : 'system';
  const appearance = appearances.find(option => option.id === selected);
  document.body.dataset.forgeTheme = selected;
  appearanceChoices.querySelector(`input[value="${selected}"]`).checked = true;
  appearanceToggle.title = `Appearance (${appearance.label})`;
}

appearanceToggle.addEventListener('click', () => {
  appearanceDialog.showModal();
  appearanceChoices.querySelector(':checked')?.focus();
});
appearanceChoices.addEventListener('change', event => {
  const appearance = event.target.value;
  if (isAppearance(appearance)) send('setAppearance', { appearance });
});
renderAppearance('system');

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
  if (text.startsWith('Search match: ')) {
    try {
      const [path, line] = JSON.parse(text.slice(14));
      if (typeof path === 'string' && Number.isInteger(line)) return { type: 'search', prefix: 'Match', text: `${path}:${line}`, path, line };
    } catch { return null; }
    return null;
  }
  if (text.startsWith('read file:')) {
    const [p, line] = text.replace('read file:', '').trim().split(' · Line ');
    return { type: 'read', prefix: 'Read', badge: getLangBadge(p), text: p, path: p, line: Number(line) || 1 };
  }
  if (text.startsWith('edited file:')) {
    const p = text.replace('edited file:', '').trim();
    return { type: 'edit', prefix: 'Edited', badge: getLangBadge(p), text: p, arrow: false, detail: p, path: p };
  }
  if (text.startsWith('staged file:')) {
    const p = text.replace('staged file:', '').trim();
    return { type: 'stage', prefix: 'Staged', badge: getLangBadge(p), text: p, path: p };
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
    return { type: 'approval', prefix: 'Allowed', text: cmd };
  }
  if (text.startsWith('Interrupted:')) return { type: 'error', prefix: 'Interrupted', text: text.slice(12).trim() };
  if (/approval|paused for/.test(text) && text.startsWith('TrueForge')) return { type: 'approval', text };
  if (text.startsWith('get workspace map') || text.startsWith('get_workspace_map')) {
    return { type: 'map', prefix: 'Explored', text: 'workspace tree', arrow: true };
  }
  if (text.startsWith('retrieve context') || text.startsWith('retrieve_context')) {
    return { type: 'context', prefix: 'Retrieved', text: 'context evidence', arrow: true };
  }
  if (text === 'Tool result received' || text.startsWith('Context:') || text.startsWith('Reasoning effort:') || text.startsWith('Local Permissions:') || text.startsWith('Permissions set to:')) {
    return null;
  }
  return { type: 'generic', text };
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
    button('Open in editor', 'copy-btn', () => send('openCodeBlock', { code, language: (language ?? '').slice(0, 50) }), code.length > 1024 * 1024),
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
      const citation = href?.match(/^(?:\.\/)?([^:#?]+\.[\w+-]+)#L([1-9]\d*)(?:-L([1-9]\d*))?$/);
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
        const line = Number(citation[2]);
        const endLine = citation[3] ? Number(citation[3]) : undefined;
        node.title = endLine && endLine > line ? `Open ${file}, lines ${line}–${endLine}` : `Open ${file} at line ${line}`;
        node.addEventListener('click', event => {
          event.preventDefault();
          send('openSource', { path: file, line, ...(endLine && endLine > line ? { endLine } : {}) });
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
  const signature = JSON.stringify(steps);
  if (list.dataset.steps === signature) return;
  list.dataset.steps = signature;
  const open = new Set([...list.querySelectorAll('details[open][data-step-key]')].map(item => item.dataset.stepKey));
  const groups = [];
  for (const step of steps) {
    const exploratory = step.type === 'read' || step.type === 'search';
    const last = groups.at(-1);
    if (exploratory && last?.exploratory) last.steps.push(step);
    else groups.push({ exploratory, steps: [step] });
  }
  const rows = groups.map(group => {
    if (group.steps.length === 1) return renderStep(group.steps[0], open, list.dataset.attemptId);
    const first = group.steps[0];
    const key = first.type + ':' + first.text;
    const batch = element('details', 'work-batch');
    batch.dataset.stepKey = key;
    batch.dataset.timelineKind = 'activity';
    batch.open = open.has(key);
    const files = new Set(group.steps.filter(step => step.type === 'read').map(step => step.path)).size;
    const searches = group.steps.filter(step => step.type === 'search' && !step.path).length;
    const matches = group.steps.filter(step => step.type === 'search' && step.path).length;
    const parts = [files && 'Read ' + files + ' ' + (files === 1 ? 'file' : 'files'),
      searches && searches + ' ' + (searches === 1 ? 'search' : 'searches'),
      matches && matches + ' ' + (matches === 1 ? 'match' : 'matches')].filter(Boolean);
    batch.append(element('summary', '', parts.join(' · ')), ...group.steps.map(step => renderStep(step, open, list.dataset.attemptId)));
    return batch;
  });
  list.replaceChildren(...rows);
}

function renderStep(step, open, attemptId) {
  const row = element(step.path ? 'button' : step.detail ? 'summary' : 'div', 'work-step-row');
  const kind = { edit: 'edits', stage: 'edits', command: 'checks', error: 'errors', approval: 'approvals' }[step.type] || 'activity';
  if (step.prefix) row.append(element('span', 'work-step-prefix', step.prefix));
  if (step.badge) row.append(element('span', 'lang-tag ' + step.badge.cls, step.badge.label));
  row.append(element('span', 'work-step-text', step.text));
  if (step.suffix) row.append(element('span', 'work-step-suffix', step.suffix));
  if (step.path) {
    row.type = 'button';
    const isSource = step.type === 'read' || step.type === 'search';
    row.title = isSource ? 'Open source in the editor' : 'Open file diff';
    row.dataset.timelineKind = kind;
    row.addEventListener('click', () => {
      if (isSource) send('openSource', { path: step.path, line: step.line ?? 1, ...(attemptId ? { attemptId } : {}) });
      else send('openDiff', { path: step.path });
    });
    return row;
  }
  if (!step.detail) {
    row.dataset.timelineKind = kind;
    return row;
  }
  const key = step.type + ':' + step.text;
  const details = element('details', 'work-step-item');
  details.dataset.stepKey = key;
  details.dataset.timelineKind = kind;
  details.open = open.has(key);
  details.append(row, element('p', 'work-step-detail', step.detail));
  return details;
}

function createWorkTraceElement(busy, steps, historical = false, attemptId) {
  const trace = element('details', 'work-trace');
  trace.open = busy;

  const summary = element('summary', 'work-trace-summary');
  const timerSpan = element('span', 'work-trace-timer');
  timerSpan.textContent = busy || historical ? 'Activity' : `Worked for ${formatDuration(lastCompletedDuration ?? 0)}`;
  const twisty = element('span', 'work-trace-twisty', '▾');
  summary.append(timerSpan, twisty);
  summary.addEventListener('click', () => { trace.dataset.userToggle = 'true'; });
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
    if (attemptId) list.dataset.attemptId = attemptId;
    renderStepList(list, steps);
    subgroup.append(list);
    trace.append(subgroup);
  }

  return trace;
}

function updateActiveAssistantRow(row, message, busy, state, steps) {
  const modelTag = row.querySelector('.model-tag');
  if (modelTag && (message.attempt?.model || state.model)) {
    modelTag.textContent = (message.attempt?.model || state.model).split('/').pop();
  }

  let trace = row.querySelector('.work-trace');
  if (steps.length > 0 || busy) {
    if (!trace) {
      trace = createWorkTraceElement(busy, steps, false, message.attempt?.id);
      const body = row.querySelector('.message-body');
      row.insertBefore(trace, body);
    } else {
      const timerSpan = trace.querySelector('.work-trace-timer');
      if (timerSpan) {
        timerSpan.textContent = busy ? 'Activity' : `Worked for ${formatDuration(lastCompletedDuration ?? 0)}`;
      }
      if (!busy && !trace.dataset.userToggle) trace.open = false;

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
          if (message.attempt?.id) list.dataset.attemptId = message.attempt.id;
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
    patchStreamingText(body, message.text || '');
  }

}

function patchStreamingText(body, text) {
  if (body.dataset.text === text) return;
  const selection = document.getSelection();
  if (selection && !selection.isCollapsed && (body.contains(selection.anchorNode) || body.contains(selection.focusNode))) {
    body.dataset.pendingText = text;
    return;
  }
  delete body.dataset.pendingText;
  body.dataset.text = text;
  body.replaceChildren();
  if (text.trim()) renderMessageContent(body, text);
}

document.addEventListener('selectionchange', () => {
  for (const body of document.querySelectorAll('.message-body[data-pending-text]')) patchStreamingText(body, body.dataset.pendingText);
});

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
    if (message.attempt?.model || state.model) {
      header.append(element('span', 'model-tag', (message.attempt?.model || state.model).split('/').pop()));
    }
    const copy = element('details', 'reply-copy');
    const copyStatus = element('summary', '', 'Reply actions');
    const actions = element('div', 'reply-copy-actions');
    for (const [label, transform] of [['Markdown', text => text], ['Plain text', plainResponse]]) {
      actions.append(button(label, 'small-button', async () => {
        try {
          const text = row.querySelector('.message-body').dataset.text || '';
          await navigator.clipboard.writeText(transform(text));
          copyStatus.textContent = 'Copied';
        } catch { copyStatus.textContent = 'Copy failed'; }
        copy.open = false;
        setTimeout(() => { copyStatus.textContent = 'Reply actions'; }, 2000);
      }));
    }
    actions.append(messageBranchButton(row, copy));
    if (message.attempt?.id) {
      actions.append(button('Share summary', 'small-button', () => {
        copy.open = false;
        send('shareRunSummary', { attemptId: message.attempt.id });
      }));
    }
    copy.append(copyStatus, actions);
    header.append(copy);
    row.append(header);

    if (message.attempt?.label) row.append(element('p', 'attempt-marker', message.attempt.label));
    if (steps.length > 0 || (busy && isLast)) row.append(createWorkTraceElement(busy && isLast, steps, !isLast, message.attempt?.id));
  }

  const body = element('div', 'message-body');
  if (!isUser) body.dataset.timelineKind = 'message';
  body.dataset.text = message.text || '';
  if (isUser) body.textContent = message.text || '';
  else if (message.text && message.text.trim()) renderMessageContent(body, message.text);
  row.append(body);
  if (isUser) {
    const actions = element('details', 'user-message-actions');
    const trigger = element('summary', '', '···');
    trigger.setAttribute('aria-label', 'Message actions');
    const menu = element('div', 'reply-copy-actions');
    menu.append(messageBranchButton(row, actions));
    actions.append(trigger, menu);
    row.append(actions);
  }


  return row;
}

function messageBranchButton(row, menu) {
  const branch = button('Branch from here', 'small-button branch-action', () => {
    if (isRunning() || state.auxiliary) return;
    menu.open = false;
    send('branchConversation', { id: state.activeConversationId, messageIndex: Number(row.dataset.messageIndex) });
  });
  return branch;
}

function renderAttemptEnd(row, attempt, activeError, busy) {
  const error = activeError ? undefined : attempt?.error;
  const receipt = attempt?.id !== state.evidence?.id ? attempt?.receipt : undefined;
  const checkpoints = receipt?.reviews.map(review => state.checkpoints.find(item => item.id === review.checkpointId)?.state);
  const summary = attempt && !busy ? attemptOutcome(attempt, receipt) : undefined;
  const signature = JSON.stringify([error, receipt, checkpoints, busy && !!receipt, attempt?.context, attempt?.workflow, attempt?.branch, summary]);
  if (row.dataset.attemptEnd === signature) return;
  row.dataset.attemptEnd = signature;
  const previousEnd = row.querySelector('.attempt-end');
  const open = new Set([...previousEnd?.querySelectorAll('details[open] > summary') ?? []].map(item => item.textContent));
  previousEnd?.remove();
  if (!attempt) return;
  const end = element('div', 'attempt-end');
  const label = [attempt.workflow ? workflowLabel(attempt.workflow) : '', attempt.workspace, attempt.branch].filter(Boolean).join(' · ');
  if (label) end.append(element('p', 'attempt-meta', label));
  if (summary) end.append(element('p', 'attempt-meta', summary));
  if (attempt.context) {
    const context = element('details', 'sent-context');
    const { chunks, omitted, usedTokens, budgetTokens, truncated } = attempt.context;
    context.append(element('summary', '', `Context sent · ${chunks.length} excerpt${chunks.length === 1 ? '' : 's'}`));
    context.append(element('p', 'check-note', `${usedTokens.toLocaleString()} of ${budgetTokens.toLocaleString()} estimated units${truncated ? ' · excerpts trimmed' : ''}`));
    for (const chunk of chunks) {
      const item = element('div', 'context-chip');
      item.append(button(`${chunk.path} · L${chunk.startLine}–${chunk.endLine}`, 'receipt-action', () =>
        send('openSource', { path: chunk.path, line: chunk.startLine, endLine: chunk.endLine, attemptId: attempt.id })),
      element('p', 'check-note', chunk.reason));
      context.append(item);
    }
    for (const item of omitted ?? []) context.append(element('p', 'check-note', `${item.path} · ${item.reason}`));
    end.append(context);
  }
  if (receipt) {
    for (const review of receipt.reviews) {
      const openDiff = review.checkpointId ? path => send('showArchivedDiff', { attemptId: attempt.id, reviewId: review.id, path }) : undefined;
      end.append(makeReviewReceipt(review.state, review.paths, openDiff, review.checkpointId, busy));
    }
    end.append(...renderVerificationReceipts(receipt.checks, index => send('showArchivedCheck', { attemptId: attempt.id, index })));
    for (const command of receipt.commands) {
      if (command.status === 'denied' || command.status === 'unconfirmed') {
        end.append(makeCommandReceipt(command, receipt.checks));
      }
    }
  } else if (error) {
    for (const edit of attempt.edits ?? []) {
      end.append(element('p', 'attempt-marker', `Applied ${edit.paths.length} ${edit.paths.length === 1 ? 'file' : 'files'}`));
    }
  }
  if (error) {
    const details = element('details', 'attempt-marker');
    details.dataset.timelineKind = 'errors';
    details.append(element('summary', '', 'Attempt interrupted'), element('p', '', error));
    end.append(details);
  }
  for (const item of end.querySelectorAll('details > summary')) if (open.has(item.textContent)) item.parentElement.open = true;
  row.append(end);
}

function workflowLabel(mode) {
  return { ask: 'Ask', plan: 'Plan', build: 'Build', inline: 'Edit selection' }[mode] ?? mode;
}

function attemptOutcome(attempt, receipt) {
  const status = { completed: 'Completed', failed: 'Interrupted', cancelled: 'Stopped' }[attempt.status];
  if (!status) return undefined;
  const live = state.evidence?.id === attempt.id ? state.evidence : undefined;
  const checks = live?.checks ?? receipt?.checks ?? [];
  const edits = live?.edits ?? receipt?.reviews.filter(item => item.state === 'applied') ?? [];
  const files = new Set(edits.flatMap(edit => edit.paths)).size;
  const passed = checks.filter(checkPassed).length;
  return [status, files ? `${files} applied ${files === 1 ? 'file' : 'files'}` : 'No files applied',
    checks.length ? `${passed}/${checks.length} checks passed` : 'No verification recorded'].join(' · ');
}

const fileReviewOpen = new Map();
let reviewSignature;
let selectedHunk;
let pendingHunksOnly = false;
let submittedProposal;

function applyReview(proposalId) {
  if (submittedProposal === proposalId) return;
  submittedProposal = proposalId;
  send('apply', { proposalId });
}
function activeReview() {
  return state.proposals.find(proposal => proposal.state === 'pending' && state.approvals.some(a => a.name === 'apply_proposal' && a.args?.proposalId === proposal.id));
}

function reviewSummary(proposal) {
  const counts = { accept: 0, reject: 0, pending: 0 };
  for (const file of proposal.files) for (const hunk of file.hunks) counts[hunk.decision]++;
  return counts;
}

function nextHunk(direction = 1) {
  const id = activeReview()?.id;
  const rows = [...document.querySelectorAll('#review-list .hunk')].filter(hunk => hunk.dataset.proposalId === id);
  if (direction < 0) rows.reverse();
  const previous = rows.findIndex(row => row.dataset.hunkId === selectedHunk);
  const ordered = [...rows.slice(previous + 1), ...rows.slice(0, previous + 1)];
  const group = ordered.find(row => row.dataset.decision === 'pending');
  if (!group) return;
  group.closest('details').open = true;
  group.scrollIntoView({ block: 'center' });
  group.focus({ preventScroll: true });
}

function renderReview() {
  const current = activeReview();
  const disconnected = state.recovery?.kind === 'reconnect';
  const bar = $('review-bar');
  const commandCount = state.approvals.filter(item => item.name === 'run_command' && !state.commandReceipts?.some(receipt => receipt.id === item.toolCallId)).length;
  bar.hidden = !current && !commandCount;
  $('review-commands').hidden = !commandCount;
  $('review-commands').textContent = `Review ${commandCount} command${commandCount === 1 ? '' : 's'}`;
  for (const id of ['open-review-diff', 'next-hunk', 'prev-hunk', 'sticky-apply']) $(id).hidden = !current;
  if (!current) $('review-count').textContent = commandCount ? 'Approval needed' : '';
  if (current) {
    const counts = reviewSummary(current);
    const pending = current.files.flatMap(file => file.hunks).filter(hunk => hunk.decision === 'pending');
    const index = pending.findIndex(hunk => hunk.id === selectedHunk);
    $('review-count').textContent = index >= 0 ? `Pending hunk ${index + 1} of ${pending.length}`
      : `${counts.accept} accepted · ${counts.reject} rejected · ${counts.pending} pending`;
    $('next-hunk').disabled = $('prev-hunk').disabled = !counts.pending;
    $('sticky-apply').textContent = counts.accept ? 'Apply' : 'Finish';
    $('sticky-apply').disabled = !!(disconnected || counts.pending || state.auxiliary || (counts.accept && state.stale?.proposalId === current.id));
  }
  const signature = JSON.stringify([state.proposals, current?.id, state.auxiliary, state.stale, state.verification?.proposalId, state.impactResults, state.evidence?.edits, state.checkpoints, state.status, pendingHunksOnly]);
  if (signature === reviewSignature) return;
  reviewSignature = signature;
  const list = $('review-list');
  const currentKeys = new Set(state.proposals.flatMap(proposal => proposal.files.map(file => `${proposal.id}:${file.path}`)));
  for (const key of fileReviewOpen.keys()) if (!currentKeys.has(key)) fileReviewOpen.delete(key);
  const focus = list.contains(document.activeElement) ? document.activeElement.dataset.reviewFocus : undefined;
  const previousProposal = list.contains(document.activeElement) ? document.activeElement.closest('[data-proposal-id]')?.dataset.proposalId : undefined;
  list.replaceChildren(...state.proposals.map(proposal => {
    if (proposal.state !== 'pending') return renderReviewReceipt(proposal);
    const section = element('section', 'review');
    section.dataset.timelineKind = 'edits approvals';
    section.dataset.actionRequired = 'true';
    section.dataset.proposalId = proposal.id;
    const editable = !state.auxiliary && !disconnected;
    const counts = reviewSummary(proposal);
    const head = element('div', 'review-header');
    head.append(element('strong', '', 'Review changes'), element('small', 'outcome-pending', `${proposal.files.length} ${proposal.files.length === 1 ? 'file' : 'files'} · Staged`));
    section.append(head, element('p', 'review-progress', `${counts.accept} accepted · ${counts.reject} rejected · ${counts.pending} pending`));
    const layout = element('div', 'review-actions');
    const toggle = button('Pending only', 'small-button', () => {
      pendingHunksOnly = !pendingHunksOnly;
      renderReview();
      list.querySelector('[data-review-focus="pending-only"]')?.focus();
    });
    toggle.dataset.reviewFocus = 'pending-only';
    toggle.setAttribute('aria-pressed', String(pendingHunksOnly));
    layout.append(toggle);
    layout.append(
      button('Accept all', 'small-button', () => send('acceptAllHunks', { proposalId: proposal.id }), !editable),
      button('Second opinion', 'small-button', () => send('reviewPatch', { proposalId: proposal.id }), !editable || current?.id !== proposal.id),
    );
    if (state.verification?.proposalId !== proposal.id) {
      layout.append(button('Select checks', 'small-button', () => send('planChecks', { proposalId: proposal.id }), !editable || current?.id !== proposal.id));
    }
    const stale = state.stale?.proposalId === proposal.id;
    if (stale) {
      section.append(element('p', 'review-note', `Changed since staging: ${state.stale.paths.join(', ')}`));
      layout.append(button('Refresh proposal', 'small-button', () => send('refreshStale', { proposalId: proposal.id }), !!state.auxiliary));
      for (const file of state.stale.paths) layout.append(button(`Compare ${file}`, 'receipt-action', () => send('previewStale', { proposalId: proposal.id, path: file })));
    }
    section.append(layout);
    for (const [fileIndex, file] of proposal.files.entries()) {
      const pending = file.hunks.filter(hunk => hunk.decision === 'pending').length;
      if (pendingHunksOnly && !pending) continue;
      const key = `${proposal.id}:${file.path}`;
      const group = element('details', `review-file${pending ? ' has-pending' : ''}`);
      group.open = fileReviewOpen.get(key) ?? (fileIndex === 0 && pending > 0);
      group.addEventListener('toggle', () => fileReviewOpen.set(key, group.open));
      group.append(element('summary', 'review-file-label', `${file.path} · ${pending} pending`));
      group.append(button('Open file diff', 'receipt-action review-diff', () => send('preview', { proposalId: proposal.id, path: file.path })));
      if (pending) {
        const bulk = element('div', 'hunk-actions');
        for (const decision of ['accept', 'reject']) {
          bulk.append(button(`${decision === 'accept' ? 'Accept' : 'Reject'} ${pending} in file`, 'small-button', () =>
            send('decideFile', { proposalId: proposal.id, path: file.path, decision }), !editable));
        }
        group.append(bulk);
      }
      let scannedOffset = 0;
      let line = 1;
      const original = file.original ?? '';
      for (const [i, hunk] of file.hunks.entries()) {
        line += original.slice(scannedOffset, hunk.start).split('\n').length - 1;
        scannedOffset = hunk.start;
        if (pendingHunksOnly && hunk.decision !== 'pending') continue;
        const row = element('div', 'hunk');
        row.tabIndex = -1;
        row.dataset.decision = hunk.decision;
        row.dataset.hunkId = hunk.id;
        row.dataset.proposalId = proposal.id;
        row.dataset.reviewFocus = hunk.id;
        row.addEventListener('focusin', () => { selectedHunk = hunk.id; renderReview(); });
        const label = element('div', 'hunk-label');
        const openHunk = button(`Hunk ${i + 1} · Line ${hunk.line ?? line}`, 'receipt-action',
          () => send('preview', { proposalId: proposal.id, path: file.path, hunkId: hunk.id }));
        openHunk.title = 'Open this hunk in the VS Code diff editor';
        openHunk.dataset.reviewFocus = `${hunk.id}:preview`;
        label.append(openHunk, element('span', '', hunk.decision));
        row.append(label);
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
    footer.append(button(counts.accept ? 'Apply selected hunks' : 'Finish review', 'primary wide', () => applyReview(proposal.id), current?.id !== proposal.id || !!counts.pending || !editable || (!!counts.accept && stale)));
    footer.append(button('Reject all remaining', 'mention-button', () => send('rejectRemaining', { proposalId: proposal.id }), !editable));
    section.append(footer);
    return section;
  }));
  const restored = focus && Array.from(list.querySelectorAll('[data-review-focus]')).find(node => node.dataset.reviewFocus === focus);
  if (restored) restored.focus({ preventScroll: true });
  else if (previousProposal) {
    const receipt = [...list.children].find(node => node.dataset.proposalId === previousProposal && node.classList.contains('action-receipt'));
    if (receipt) receipt.focus({ preventScroll: true });
    else nextHunk();
  }
  if (submittedProposal && !state.proposals.some(item => item.id === submittedProposal && item.state === 'pending')) {
    [...list.children].find(node => node.dataset.proposalId === submittedProposal)?.focus({ preventScroll: true });
    submittedProposal = undefined;
  }
  if (state.stale || state.error) submittedProposal = undefined;
}

function renderReviewReceipt(proposal) {
  const edit = state.evidence?.edits.find(item => item.proposalId === proposal.id);
  const paths = proposal.state === 'applied'
    ? (edit?.paths ?? proposal.files.filter(file => file.hunks.some(hunk => hunk.decision === 'accept')).map(file => file.path))
    : proposal.files.map(file => file.path);
  const receipt = makeReviewReceipt(proposal.state, paths, path => send('preview', { proposalId: proposal.id, path }), edit?.checkpointId, isRunning() || !!state.auxiliary);
  receipt.dataset.proposalId = proposal.id;
  if (proposal.state === 'expired') receipt.append(button('Refresh proposal', 'receipt-action', () => send('refreshStale', { proposalId: proposal.id }), !!state.auxiliary));
  if (proposal.state === 'applied' && !state.verification) {
    receipt.append(button('Select checks', 'receipt-action', () => send('planChecks', { proposalId: proposal.id }), !!state.auxiliary));
  }
  return receipt;
}

function makeReviewReceipt(status, paths, openDiff, checkpointId, busy) {
  const receipt = element('div', 'action-receipt');
  receipt.dataset.timelineKind = 'edits approvals';
  receipt.tabIndex = -1;
  const title = status === 'applied' ? `Applied ${paths.length} ${paths.length === 1 ? 'file' : 'files'}`
    : status === 'rejected' ? 'Changes rejected' : 'Review expired';
  const icon = element('span', 'receipt-icon');
  icon.innerHTML = status === 'applied' ? SVG_ICONS.check : SVG_ICONS.close;
  icon.setAttribute('aria-hidden', 'true');
  receipt.append(icon, element('strong', '', title));
  if (openDiff && paths.length === 1) {
    receipt.append(button('View diff', 'receipt-action', () => openDiff(paths[0])));
  } else if (openDiff && paths.length > 1) {
    const diffs = element('details', 'receipt-diffs');
    diffs.append(element('summary', 'receipt-action', 'View diffs'));
    for (const path of paths) diffs.append(button(path, 'receipt-action', () => openDiff(path)));
    receipt.append(diffs);
  }
  if (checkpointId && state.checkpoints.some(cp => cp.id === checkpointId && ['applied', 'restore-conflict'].includes(cp.state))) {
    receipt.append(button('Undo', 'receipt-action', () => send('undo', { id: checkpointId }), busy));
  }
  return receipt;
}

const checkName = input => [input.task, ...(input.args ?? [])].join(' ');
const checkPassed = check => check.result.exitCode === 0 && !check.result.timedOut && !check.result.cancelled && check.result.cleanupConfirmed;
function appendCheckDetails(container, check, showOutput, includePreview) {
  container.append(element('p', '', `Exit ${check.result.exitCode ?? 'unavailable'} · ${(check.durationMs / 1000).toFixed(1)}s`));
  if (check.changedSource.length) container.append(element('p', 'check-note', `Detected source changes: ${check.changedSource.join(', ')}`));
  if (check.detectionPartial) container.append(element('p', 'check-note', 'Source-change detection was partial.'));
  if (check.result.truncated) container.append(element('p', 'check-note', 'Captured output was truncated.'));
  const text = includePreview && [check.result.stdout, check.result.stderr].filter(Boolean).join('\n');
  if (text) container.append(element('pre', 'code-block-content', text.slice(0, 8000)));
  container.append(button('Open captured output', 'receipt-action', showOutput));
}

function renderCheckReceipt(check, showOutput, includePreview, comparison) {
  const details = element('details', 'check-output check-receipt');
  details.dataset.timelineKind = 'checks';
  const phase = { baseline: 'Baseline', after: 'After changes', agent: 'Agent check' }[check.phase];
  const summary = element('summary', 'check-summary');
  const command = element('strong', 'check-command', `${phase} · ${formatCommandString(check.input)}`);
  command.title = command.textContent;
  summary.append(command, element('span', checkPassed(check) ? 'outcome-applied' : 'outcome-rejected', checkResult(check)));
  details.append(summary);
  if (comparison) details.append(element('p', 'check-note', comparison));
  appendCheckDetails(details, check, showOutput, includePreview);
  return details;
}

function renderVerificationReceipts(checks, showOutput, includePreview = false, excluded = new Set()) {
  const comparisons = compareVerification(checks);
  const pairsByAfter = new Map(comparisons.filter(pair => pair.after !== undefined).map(pair => [pair.after, pair]));
  const pairedBaselines = new Set(comparisons.filter(pair => pair.after !== undefined).map(pair => pair.baseline));
  const missingAfter = new Set(comparisons.filter(pair => pair.after === undefined).map(pair => pair.baseline));
  return checks.flatMap((check, index) => {
    if (excluded.has(index) || pairedBaselines.has(index)) return [];
    const pair = pairsByAfter.get(index);
    if (pair?.baseline === undefined) {
      const receipt = renderCheckReceipt(check, () => showOutput(index), includePreview,
        pair?.label ?? (missingAfter.has(index) ? 'After check missing' : undefined));
      receipt.dataset.index = String(index);
      return [receipt];
    }
    const comparison = element('details', 'check-output check-receipt check-comparison');
    comparison.dataset.timelineKind = 'checks';
    comparison.dataset.index = String(index);
    const summary = element('summary', 'check-summary');
    summary.append(element('strong', 'check-command', formatCommandString(check.input)),
      element('span', checkPassed(check) ? 'outcome-applied' : 'outcome-rejected', pair.label));
    const results = element('div', 'comparison-results');
    for (const [label, checkIndex] of [['Baseline', pair.baseline], ['After changes', index]]) {
      const record = checks[checkIndex];
      const phase = element('section', 'comparison-phase');
      phase.append(element('strong', '', `${label} · ${checkResult(record)}`));
      appendCheckDetails(phase, record, () => showOutput(checkIndex), includePreview);
      results.append(phase);
    }
    comparison.append(summary, results);
    return [comparison];
  });
}

let evidenceSignature;
let reviewerText;
function renderEvidence() {
  const review = state.review;
  const proposal = state.proposals.find(item => item.id === state.verification?.proposalId);
  const evidence = state.evidence;
  const plan = state.verification;
  const signature = JSON.stringify([review, evidence, plan, proposal?.state, state.auxiliary, state.status, state.commandReceipts]);
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
  const recordedCommands = new Set(state.commandReceipts?.map(item => item.checkIndex));
  for (const details of renderVerificationReceipts(checks, index => send('showCheck', { index }), true, recordedCommands)) {
    details.open = openChecks.has(details.dataset.index);
    output.append(details);
  }
  const result = $('run-evidence');
  result.replaceChildren();
  if (!evidence) return;
  const openEvidence = result.dataset.expanded === 'true';
  const card = element('details', 'forgeproof-card');
  card.open = openEvidence;
  card.addEventListener('toggle', () => { result.dataset.expanded = String(card.open); });
  card.append(element('summary', 'forgeproof-title', 'Run evidence'));
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
  if (state.messages.some(message => message.attempt?.id === evidence.id)) {
    actions.append(button('Share summary', 'small-button', () => send('shareRunSummary', { attemptId: evidence.id })));
  }
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

let commandSignature;
function makeCommandReceipt(receipt, checks, showOutput) {
  const row = element('div', 'action-receipt command-receipt');
  row.dataset.commandId = receipt.id;
  row.dataset.timelineKind = 'approvals checks';
  row.tabIndex = -1;
  const check = checks[receipt.checkIndex];
  const status = check ? checkResult(check) : {
    allowed: 'Allowed', denied: 'Denied', running: 'Running', finished: 'Finished', unconfirmed: 'Outcome unconfirmed',
  }[receipt.status];
  const icon = element('span', 'receipt-icon');
  icon.innerHTML = SVG_ICONS.terminal;
  icon.setAttribute('aria-hidden', 'true');
  const label = element('span', check && checkPassed(check) ? 'outcome-applied' : '', status);
  const command = formatCommandString(receipt.args);
  const code = element('code', 'receipt-command', command);
  code.title = command;
  row.append(icon, code, label);
  if (check && showOutput) {
    const output = button('Output', 'receipt-action', showOutput);
    output.title = `Exit ${check.result.exitCode ?? 'unavailable'}${check.detectionPartial ? ' · Source-change detection was partial' : ''}`;
    row.append(output);
    const text = [check.result.stdout, check.result.stderr].filter(Boolean).join('\n');
    if (text) {
      const preview = element('details', 'command-output-preview');
      preview.append(element('summary', '', 'Preview'), element('pre', 'code-block-content', text.slice(0, 1200)));
      row.append(preview);
    }
  }
  return row;
}
function renderCommands() {
  const list = $('command-list');
  const receipts = state.commandReceipts ?? [];
  const pending = state.approvals.filter(approval => approval.name === 'run_command' && !receipts.some(item => item.id === approval.toolCallId));
  for (const id of submittedCommands) if (!pending.some(approval => approval.toolCallId === id)) submittedCommands.delete(id);
  const checks = state.evidence?.checks ?? [];
  const signature = JSON.stringify([receipts, pending, [...submittedCommands], state.commandPreviews, state.recovery?.kind === 'reconnect']);
  if (signature === commandSignature) return;
  commandSignature = signature;
  const focusedId = list.contains(document.activeElement) ? document.activeElement.closest('[data-command-id]')?.dataset.commandId : undefined;
  const cards = pending.map(approval => {
    const card = element('section', 'command-card');
    card.dataset.commandId = approval.toolCallId;
    card.dataset.timelineKind = 'approvals';
    card.dataset.actionRequired = 'true';
    const preview = state.commandPreviews?.[approval.toolCallId];
    const command = preview?.command ?? formatCommandString(approval.args);
    const header = element('div', 'command-card-header');
    header.append(element('strong', 'command-card-title', 'Allow this workspace command?'));
    const cli = element('div', 'command-cli-box');
    const commandLine = element('div', 'command-cli-line');
    commandLine.append(element('code', 'command-cli-code', command));
    const copy = button('Copy', 'command-copy-btn', async () => {
      try {
        await navigator.clipboard.writeText(command);
        copy.textContent = 'Copied';
      } catch {
        copy.textContent = 'Copy failed';
      }
    });
    copy.setAttribute('aria-label', 'Copy command');
    cli.append(commandLine, copy);
    const actions = element('div', 'command-actions');
    const decide = allow => {
      if (submittedCommands.has(approval.toolCallId)) return;
      submittedCommands.add(approval.toolCallId);
      send('commandDecision', { toolCallId: approval.toolCallId, allow });
      renderCommands();
    };
    if (submittedCommands.has(approval.toolCallId)) {
      actions.append(element('span', '', 'Submitting decision…'));
    } else {
      const disconnected = state.recovery?.kind === 'reconnect';
      actions.append(button('Deny', 'command-action-btn command-deny-btn', () => decide(false), disconnected),
        button('Allow once', 'command-action-btn command-allow-btn', () => decide(true), disconnected || (!!preview && !preview.command)));
    }
    card.tabIndex = -1;
    const cwd = preview?.cwd ?? (typeof approval.args?.cwd === 'string' ? approval.args.cwd : '.');
    card.append(header, cli, element('p', 'command-security-row', `Working directory: ${cwd} · Approval applies to this request`));
    if (preview && !preview.command) card.append(element('p', 'check-note', preview.error ?? 'Checking the workspace command…'));
    card.append(actions);
    return card;
  });
  const rows = receipts.map(receipt => makeCommandReceipt(receipt, checks, () => send('showCheck', { index: receipt.checkIndex })));
  list.replaceChildren(...rows, ...cards);
  if (focusedId) [...list.children].find(row => row.dataset.commandId === focusedId)?.focus({ preventScroll: true });
}

let recoverySignature;
let submittedRecovery;
function renderRecovery() {
  const dock = $('error');
  const limit = state.status === 'cancelled' ? state.evidence?.stopReason : undefined;
  dock.hidden = !state.error && !limit;
  if (dock.hidden) {
    recoverySignature = undefined;
    submittedRecovery = undefined;
    return;
  }
  const recovery = state.recovery;
  const selected = state.model !== recovery?.model && !!state.model;
  const ready = recovery?.notBefore && Date.now() >= recovery.notBefore;
  const signature = JSON.stringify([state.error, limit, recovery, selected, ready, submittedRecovery, state.status, state.evidence?.edits, state.evidence?.checks.length]);
  if (signature === recoverySignature) return;
  recoverySignature = signature;
  $('error-title').textContent = recovery?.title ?? (limit ? 'Run limit reached' : 'Needs attention');
  $('error-text').textContent = state.error ?? limit;
  const last = [...state.activity].reverse().find(item => /^(read file:|edited file:|ran command:|staged file:)/.test(item));
  const details = [recovery?.model ? `Model: ${recovery.model}` : '', recovery?.status ? `HTTP ${recovery.status}` : '',
    state.evidence && `${new Set(state.evidence.edits.flatMap(edit => edit.paths)).size} files applied`,
    state.evidence && `${state.evidence.checks.length} completed checks recorded`, last ? `Last recorded step: ${last}` : ''];
  $('error-progress').textContent = details.filter(Boolean).join(' · ');
  $('copy-diagnostic').hidden = !state.error;
  if (submittedRecovery !== recovery?.id) $('error-details').open = !recovery;
  const actions = [];
  if (recovery) {
    const canRecover = recovery.kind !== 'inspect' && (recovery.kind !== 'provider' || selected || ready);
    if (canRecover) {
      const label = { continue: 'Continue with applied changes (read-only)', retry: 'Try again', reconnect: 'Reconnect', provider: 'Resume' }[recovery.kind];
      actions.push(button(submittedRecovery === recovery.id ? 'Starting…' : label, 'primary', () => {
        if (submittedRecovery === recovery.id) return;
        submittedRecovery = recovery.id;
        send('recoverRun', { id: recovery.id });
        renderRecovery();
      }, submittedRecovery === recovery.id));
    } else if (recovery.kind === 'provider' && recovery.notBefore) {
      const countdown = element('span', 'recovery-meta');
      countdown.id = 'quota-countdown';
      actions.push(countdown);
    }
    const configurationError = recovery.kind === 'provider' && [400, 401, 403, 404, 422].includes(recovery.status);
    if (recovery.kind === 'provider' || recovery.kind === 'continue' || recovery.kind === 'retry') {
      actions.push(button('Change model', !canRecover && !configurationError ? 'primary' : 'receipt-action', openProviders));
    }
    if (configurationError) {
      actions.push(button('Open provider settings', canRecover ? 'receipt-action' : 'primary', () => send('providerSettings')));
    }
    if (recovery.sessionId) actions.push(button('Inspect session', recovery.kind === 'inspect' ? 'primary' : 'receipt-action', () => send('session')));
  }
  if (limit) {
    actions.push(button('Adjust run limits', 'primary', () => {
      $('compose-extras').open = true;
      $('run-options').open = true;
      const field = /tokens?/i.test(limit) ? 'tokens' : /cost/i.test(limit) ? 'cost' : 'seconds';
      $(`limit-${field}`).focus();
    }));
  }
  $('recovery-actions').replaceChildren(...actions);
  updateQuotaCountdown();
}
function updateQuotaCountdown() {
  const countdown = $('quota-countdown');
  if (countdown && state.recovery?.notBefore) {
    const seconds = Math.max(0, Math.ceil((state.recovery.notBefore - Date.now()) / 1000));
    countdown.textContent = `Retry in ${formatDuration(seconds)}`;
  }
}

let followUpSignature;
const followUpEditor = $('follow-up-editor');
const followUpPrompt = $('follow-up-prompt');
followUpEditor.addEventListener('close', () => {
  const { queueId, requeue } = followUpEditor.dataset;
  const update = { id: queueId, requeue: requeue === 'true' };
  if (followUpEditor.returnValue === 'save') update.prompt = followUpPrompt.value;
  send('updateFollowUp', update);
});
function renderFollowUp(busy) {
  const queue = state.queuedFollowUp;
  const tray = $('follow-up');
  const signature = JSON.stringify([queue, busy]);
  if (signature === followUpSignature) return;
  followUpSignature = signature;
  tray.hidden = !queue;
  if (!queue) { tray.replaceChildren(); return; }
  const text = element('span', 'follow-up-text', queue.prompt);
  text.title = queue.prompt;
  const controls = element('div', 'follow-up-actions');
  if (!busy) controls.append(button('Send now', 'receipt-action', () => send('sendFollowUp', { id: queue.id })));
  controls.append(
    button('Edit', 'receipt-action', () => send('editFollowUp', { id: queue.id })),
    button('Remove', 'receipt-action', () => send('removeFollowUp', { id: queue.id })),
  );
  tray.replaceChildren(element('strong', '', queue.status === 'queued' ? 'Follow-up queued' : 'Follow-up held'), text, controls);
}

const feed = document.querySelector('main');
const nearEnd = () => feed.scrollHeight - feed.scrollTop - feed.clientHeight < 64;
const scrollToEnd = () => feed.scrollTo({ top: feed.scrollHeight });
let followFeed = true;
let unreadActivity = 0;
let announcedStatus;
function markJump() {
  const jump = $('jump-latest');
  jump.hidden = followFeed;
  jump.textContent = unreadActivity ? `Jump to latest · ${unreadActivity > 99 ? '99+' : unreadActivity} new` : 'Jump to latest';
}
feed.addEventListener('scroll', () => {
  followFeed = nearEnd();
  if (followFeed) unreadActivity = 0;
  markJump();
}, { passive: true });
$('jump-latest').addEventListener('click', () => {
  followFeed = true;
  unreadActivity = 0;
  scrollToEnd();
  markJump();
  feed.focus({ preventScroll: true });
});
function trackNewActivity(previous, next) {
  if (previous.activeConversationId !== next.activeConversationId) {
    followFeed = true;
    unreadActivity = 0;
    return;
  }
  if (followFeed) return;
  const steps = Math.max(0, (next.activitySequence ?? 0) - (previous.activitySequence ?? 0));
  const oldLast = previous.messages.at(-1);
  const newLast = next.messages.at(-1);
  const milestones = previous.status !== next.status || previous.error !== next.error ||
    oldLast?.attempt?.id !== newLast?.attempt?.id || previous.approvals.length !== next.approvals.length ||
    previous.evidence?.checks.length !== next.evidence?.checks.length;
  unreadActivity += steps || Number(milestones);
}
setInterval(() => {
  if (state.retry) $('status-text').textContent = statusLabel();
  if (state.recovery?.notBefore) { renderRecovery(); updateQuotaCountdown(); }
}, 300);

function render() {
  renderAppearance(state.appearance);
  const oldFeedHeight = feed.scrollHeight;
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
  $('run-status').hidden = !state.auxiliary && (state.status === 'idle' || (state.status === 'failed' && !!state.error));
  $('run-status').classList.toggle('busy', busy);
  $('run-status').dataset.runState = state.retry ? 'retry' : state.status;
  if (isRunning() && !state.retry && !state.auxiliary) {
    $('status-text').replaceChildren(createDynamicLoadingElement(getCurrentProcess(state, busy).text));
  } else {
    $('status-text').textContent = statusLabel();
  }
  const pendingApprovals = state.approvals.filter(item => !state.commandReceipts?.some(receipt => receipt.id === item.toolCallId)).length;
  const announce = state.retry?.message || state.recovery?.title ||
    (state.status === 'awaiting-review' && pendingApprovals ? `${pendingApprovals} approval${pendingApprovals === 1 ? '' : 's'} waiting for review` : statusLabel());
  if (announce !== announcedStatus && announce !== 'idle' && !state.error) $('announce').textContent = announce;
  announcedStatus = announce;
  const canQueue = busy && state.canQueue && !state.auxiliary && !state.queuedFollowUp;
  $('stop').hidden = !busy;
  $('stop').lastChild.textContent = state.retry ? ' Stop retrying' : ' Stop';
  $('send').textContent = busy ? 'Queue' : 'Send';
  $('send').disabled = (busy && !canQueue) || !!submittedFollowUp;
  $('workflow').disabled = busy && !canQueue;
  $('preview-context').disabled = $('isolated').disabled = busy;
  $('session').hidden = !state.sessionId;
  const connectBtn = $('connect');
  if (connectBtn) {
    connectBtn.hidden = state.connected;
  }
  const sessionBtn = $('session-btn');
  if (sessionBtn) {
    sessionBtn.title = state.sessionId ? `Open TrueForge session (${state.sessionId.slice(-6)})` : 'Open TrueForge sessions dashboard';
  }

  // Render messages transcript
  const transcript = $('transcript');
  const liveResults = $('live-results');

  const visibleMessages = state.messages.filter((m, idx, arr) => {
    if (m.text && m.text.trim()) {
      if (m.role === 'user' && idx > 0 && arr[idx - 1].role === 'user' && arr[idx - 1].text === m.text) {
        return false;
      }
      return true;
    }
    if (m.role === 'assistant' && (m.attempt?.receipt || m.attempt?.error || m.attempt?.label || m.attempt?.activity?.length || (busy && idx === arr.length - 1))) return true;
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
    const indexedRow = existingRows[idx];
    const existing = message.attempt ? existingRows.find(row => row.dataset.attemptId === message.attempt.id)
      : indexedRow?.dataset.attemptId ? undefined : indexedRow;
    const messageSteps = isLast && state.activity.length ? steps : (message.attempt?.activity ?? []).map(parseAntigravityStep).filter(Boolean);

    let row;
    // Reuse existing DOM element for completed messages if role and text are identical
    if (!isLast && existing && existing.dataset.role === message.role && existing.dataset.text === message.text) {
      row = existing;
    } else if (isLast && existing && existing.dataset.role === 'assistant' && message.role === 'assistant') {
      // Reuse and update active assistant row in-place!
      updateActiveAssistantRow(existing, message, busy, state, messageSteps);
      existing.dataset.text = message.text || '';
      row = existing;
    } else {
      row = buildMessageRow(message, idx, isLast, busy, state, messageSteps);
      row.dataset.role = message.role;
      row.dataset.text = message.text || '';
      if (message.attempt) row.dataset.attemptId = message.attempt.id;
    }

    renderAttemptEnd(row, message.attempt, isLast && !!state.error, busy);
    row.dataset.messageIndex = String(state.messages.indexOf(message));
    const branch = row.querySelector('.branch-action');
    if (branch) branch.disabled = busy || !state.activeConversationId;
    newNodes.push(row);

    // Place the "Working through your repository…" component after the active input
    if (busy && (message.attempt?.label ? isLast : idx === activeUserIdx && !visibleMessages.at(-1)?.attempt?.label)) {
      newNodes.push($('run-status'));
    }
  });

  if (activeUserIdx === -1 || !busy) {
    const slot = $('status-slot');
    if (slot && $('run-status').parentElement !== slot) {
      slot.append($('run-status'));
    }
  }

  transcript.querySelectorAll(':scope > .impact-radar-card').forEach(node => node.remove());
  const nextNodes = new Set(newNodes);
  for (const node of Array.from(transcript.children)) if (!nextNodes.has(node)) node.remove();
  newNodes.forEach((node, index) => {
    if (transcript.children[index] !== node) transcript.insertBefore(node, transcript.children[index] ?? null);
  });
  const liveOwner = state.evidence?.id
    ? newNodes.find(node => node.dataset.attemptId === state.evidence.id) : undefined;
  const liveSlot = liveOwner ?? $('live-results-slot');
  if (liveResults.parentElement !== liveSlot) liveSlot.append(liveResults);

  renderRecovery();
  renderFollowUp(busy);

  $('contexts').hidden = !state.context;
  if (state.context) {
    const c = state.context;
    const costs = new Map();
    for (const chunk of c.chunks) costs.set(chunk.path, (costs.get(chunk.path) ?? 0) + (chunk.tokens ?? 0));
    $('budget-label').textContent = `${c.usedTokens.toLocaleString()} / ${c.budgetTokens.toLocaleString()} tokens`;
    const meter = $('meter-bar').parentElement;
    meter.setAttribute('role', 'progressbar');
    meter.setAttribute('aria-label', 'Estimated context budget');
    meter.setAttribute('aria-valuemin', '0');
    meter.setAttribute('aria-valuemax', String(c.budgetTokens || 1));
    meter.setAttribute('aria-valuenow', String(c.usedTokens));
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

  renderCommands();

  const attachedUndo = new Set([
    ...(state.evidence?.edits.map(edit => edit.checkpointId) ?? []),
    ...state.messages.flatMap(message => message.attempt?.receipt?.reviews.map(review => review.checkpointId) ?? []),
  ]);
  const checkpoints = state.checkpoints.filter(cp => !attachedUndo.has(cp.id));
  $('checkpoints').hidden = !checkpoints.length;
  $('checkpoint-list').replaceChildren(...checkpoints.slice(-4).reverse().map(cp => {
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
  filterTimeline();
  if (followFeed && (feed.scrollHeight !== oldFeedHeight || !nearEnd())) {
    requestAnimationFrame(() => { if (followFeed) scrollToEnd(); });
  }
  markJump();
}

function filterTimeline() {
  const filter = $('timeline-filter');
  filter.hidden = !state.messages.length;
  const value = filter.value;
  for (const node of feed.querySelectorAll('[data-timeline-kind]')) {
    node.classList.toggle('timeline-filtered', value !== 'all' && !node.dataset.actionRequired && !node.dataset.timelineKind.split(' ').includes(value));
  }
  for (const trace of feed.querySelectorAll('.work-trace')) {
    const matching = value !== 'all' && !!trace.querySelector('[data-timeline-kind]:not(.timeline-filtered)');
    trace.classList.toggle('timeline-filtered', value !== 'all' && !matching);
    if (matching && !trace.open) {
      trace.dataset.filterOpened = 'true';
      trace.open = true;
      const steps = trace.querySelector('.work-subgroup');
      if (steps) steps.open = true;
    } else if (value === 'all' && trace.dataset.filterOpened) {
      trace.open = false;
      delete trace.dataset.filterOpened;
    }
  }
}
$('timeline-filter').addEventListener('change', filterTimeline);
$('copy-diagnostic').addEventListener('click', () => send('copyDiagnostic'));
$('prompt').setAttribute('aria-keyshortcuts', 'Alt+C');
$('jump-latest').setAttribute('aria-keyshortcuts', 'Alt+J');
$('jump-latest').title = 'Jump to latest (Alt+J)';
$('recovery-actions').setAttribute('aria-keyshortcuts', 'Alt+E');

let historySearchQuery = '';
let historyFilter = 'all';
let historyMatches;
let historySignature;

function renderHistoryItems() {
  const historyItems = $('history-items');
  if (!historyItems) return;
  const conversations = Array.isArray(state.conversations) ? state.conversations : [];
  const result = historyMatches?.query === historySearchQuery ? historyMatches : undefined;
  const signature = JSON.stringify([conversations, state.activeConversationId, historyFilter, historySearchQuery, result]);
  if (signature === historySignature) return;
  historySignature = signature;
  const focusedChat = historyItems.contains(document.activeElement) ? document.activeElement.dataset.conversationId : undefined;

  const now = Date.now();
  const matches = new Map((result?.matches ?? []).map(match => [match.id, match]));
  const filtered = conversations.filter(c => {
    if (historyFilter === 'archived' ? !c.archived : c.archived) return false;
    if (historySearchQuery) {
      const match = (c.title || '').toLowerCase().includes(historySearchQuery);
      if (!match && !matches.has(c.id)) return false;
    }
    if (historyFilter === 'today') {
      return (now - (c.updatedAt || 0)) <= 86400000;
    }
    if (historyFilter === 'recent') {
      return (now - (c.updatedAt || 0)) <= 3 * 86400000;
    }
    return true;
  }).sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || (b.updatedAt ?? 0) - (a.updatedAt ?? 0));

  if (filtered.length === 0) {
    const empty = element('div', 'history-empty', historySearchQuery
      ? (historyMatches?.query === historySearchQuery ? 'No matching conversations.' : 'Searching conversations…')
      : 'No past conversations yet.');
    historyItems.replaceChildren(empty);
    return;
  }

  historyItems.replaceChildren(...filtered.map(conv => {
    const item = element('div', `history-item${conv.id === state.activeConversationId ? ' active' : ''}`);
    item.tabIndex = 0;
    item.dataset.conversationId = conv.id;

    const icon = element('span', 'history-item-icon');
    icon.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';

    const info = element('div', 'history-item-info');
    const title = element('div', 'history-item-title', conv.title || 'Conversation');
    const meta = element('div', 'history-item-meta', `${formatRelativeTime(conv.updatedAt)} · ${conv.messageCount} msg${conv.messageCount === 1 ? '' : 's'}`);
    info.append(title, meta);
    const status = { 'awaiting-review': 'Review needed', failed: 'Interrupted', cancelled: 'Stopped', running: 'Running' }[conv.status];
    const flags = [conv.pinned && 'Pinned', status].filter(Boolean);
    if (flags.length) info.append(element('div', 'history-item-meta', flags.join(' · ')));
    const match = matches.get(conv.id);
    if (match?.excerpt) info.append(element('div', 'history-match', match.excerpt));

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
    const menu = element('details', 'chat-item-menu');
    menu.addEventListener('click', event => event.stopPropagation());
    const trigger = element('summary', '', '···');
    trigger.setAttribute('aria-label', `Manage ${conv.title || 'conversation'}`);
    const choices = element('div', 'chat-item-options');
    for (const [type, label] of [
      ['renameConversation', 'Rename'],
      ['pinConversation', conv.pinned ? 'Unpin' : 'Pin'],
      ['archiveConversation', conv.archived ? 'Unarchive' : 'Archive'],
    ]) {
      choices.append(button(label, 'receipt-action', () => {
        menu.open = false;
        send(type, { id: conv.id });
      }));
    }
    delBtn.setAttribute('aria-label', 'Delete conversation');
    choices.append(delBtn);
    menu.append(trigger, choices);
    actions.append(menu);

    item.append(icon, info, actions);
    const openConversation = () => {
      closeAllDrawers();
      send('switchConversation', match?.messageIndex === undefined ? { id: conv.id } : { id: conv.id, messageIndex: match.messageIndex });
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
  if (focusedChat) [...historyItems.children].find(item => item.dataset.conversationId === focusedChat)?.focus({ preventScroll: true });
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
  const activeProposals = state.proposals.filter(p => p.state === 'pending');
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
const draftsByChat = new Map(Object.entries(saved.drafts ?? {}));
let draftChatId;
let firstDraft = true;
const limitKeys = ['seconds', 'tokens', 'cost', 'rate'];
function storeDraft() {
  if (draftChatId) {
    const value = {
      prompt: promptInput.value, workflow: workflow.value,
      context: { pins: [...draft.pins], excluded: [...draft.excluded], semantic: draft.semantic },
      limits: Object.fromEntries(limitKeys.map(key => [key, $(`limit-${key}`).value])),
    };
    draftsByChat.delete(draftChatId);
    draftsByChat.set(draftChatId, value);
    if (draftsByChat.size > 36) draftsByChat.delete(draftsByChat.keys().next().value);
  }
  vscode.setState?.({ demo: demoMode, drafts: Object.fromEntries(draftsByChat), ...(firstDraft ? { prompt: promptInput.value, workflow: workflow.value } : {}) });
}
function restoreChatDraft(id) {
  if (!id || id === draftChatId) return;
  const previous = draftChatId;
  if (previous) storeDraft();
  const value = draftsByChat.get(id) ?? (firstDraft ? saved : {});
  draftChatId = id;
  firstDraft = false;
  promptInput.value = typeof value.prompt === 'string' ? value.prompt : '';
  workflow.value = ['build', 'ask', 'plan'].includes(value.workflow) ? value.workflow : 'build';
  draft.pins = Array.isArray(value.context?.pins) ? value.context.pins : [];
  draft.excluded = Array.isArray(value.context?.excluded) ? value.context.excluded : [];
  draft.semantic = value.context?.semantic === true;
  replacement = undefined;
  $('symbol-graph').checked = draft.semantic;
  for (const key of limitKeys) $(`limit-${key}`).value = value.limits?.[key] ?? '';
  setContextOpen(false);
  $('compose-extras').open = false;
  refreshComposer();
  syncWorkflow();
}
function adjustPromptHeight() {
  promptInput.style.height = 'auto';
  promptInput.style.height = `${Math.min(200, Math.max(52, promptInput.scrollHeight))}px`;
}
function renderMentions() {
  const tray = $('mention-chips');
  const mentions = [...promptInput.value.matchAll(/@(?:file|folder|symbol)(?:\([^\r\n)]+\)|:(?:"[^"\r\n]+"|[^\s,;]+))|@[\w.\-]+(?:\/[\w.\-]+)+/g)];
  tray.hidden = !mentions.length;
  tray.replaceChildren(...mentions.map(match => {
    const group = element('span', 'attachment-chip');
    const open = button(match[0], 'receipt-action', () => send('previewMention', { reference: match[0] }));
    open.setAttribute('aria-label', `Preview ${match[0]}`);
    const chip = button('×', 'small-button', () => {
      promptInput.setRangeText('', match.index, match.index + match[0].length, 'start');
      refreshComposer();
      promptInput.focus();
    });
    chip.type = 'button';
    chip.setAttribute('aria-label', `Remove ${match[0]}`);
    group.append(open, chip);
    return group;
  }));
}
function refreshComposer() { adjustPromptHeight(); renderMentions(); storeDraft(); }
function syncWorkflow() {
  $('send').title = `Send in ${workflow.selectedOptions[0].textContent} mode (Ctrl+Enter)`;
  const help = {
    ask: 'Ask reads the workspace and answers questions.',
    plan: 'Plan reads the workspace and drafts implementation steps.',
    build: 'Build can stage edits and request approval for changes and checks.',
  };
  $('workflow-help').textContent = help[workflow.value];
  workflow.title = help[workflow.value];
  storeDraft();
}
workflow.addEventListener('change', syncWorkflow);
function refreshDraft() {
  storeDraft();
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
function setContextOpen(open) {
  $('context-editor').hidden = !open;
  $('preview-context').setAttribute('aria-expanded', String(open));
}
$('preview-context').addEventListener('click', () => {
  const open = $('context-editor').hidden;
  $('compose-extras').open = false;
  setContextOpen(open);
  if (open) refreshDraft();
});
$('context-refresh').addEventListener('click', refreshDraft);
$('context-add').addEventListener('click', () => { replacement = undefined; send('contextPick'); });
$('symbol-graph').addEventListener('change', event => { draft.semantic = event.target.checked; refreshDraft(); });

promptInput.addEventListener('input', () => {
  $('compose-extras').open = false;
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
  const running = isRunning();
  const canQueue = running && state.canQueue && !state.queuedFollowUp && state.evidence?.id;
  if (prompt && (!running || canQueue) && !state.auxiliary && !submittedFollowUp) {
    const limits = Object.fromEntries(limitKeys.map(key => [key, Number($(`limit-${key}`).value || 0)]));
    if (limits.cost && !limits.rate) {
      $('compose-extras').open = true;
      $('run-options').open = true;
      $('limit-rate').setCustomValidity('Enter an estimated price per million tokens.');
      $('limit-rate').reportValidity();
      return;
    }
    hideSlashMenu();
    hideMentionMenu();
    if (canQueue) {
      submittedFollowUp = { prompt, after: canQueue };
      $('send').disabled = true;
      send('queueFollowUp', { after: canQueue, prompt, workflow: workflow.value, context: draft, limits });
      return;
    }
    turnStartTime = Date.now();
    lastCompletedDuration = null;
    followFeed = true;
    unreadActivity = 0;
    send('run', { prompt, workflow: workflow.value, context: draft, limits });
    $('prompt').value = '';
    setContextOpen(false);
    $('compose-extras').open = false;
    refreshComposer();
  }
});
$('form').addEventListener('invalid', event => {
  if (event.target.closest('#run-options')) {
    $('compose-extras').open = true;
    $('run-options').open = true;
  }
}, true);
$('limit-rate').addEventListener('input', () => $('limit-rate').setCustomValidity(''));
$('limit-cost').addEventListener('input', () => $('limit-rate').setCustomValidity(''));
for (const key of limitKeys) $(`limit-${key}`).addEventListener('input', storeDraft);

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

function renderModelShortcuts(groups, favorites, recent, busy) {
  const container = $('model-shortcuts');
  const models = new Map(groups.flatMap(group => group.models.map(model => [model.name, { ...model, provider: group.id }])));
  const sections = [
    ['Favorites', favorites.filter(name => models.has(name))],
    ['Recent successes', recent.filter(name => models.has(name) && !favorites.includes(name))],
  ];
  container.replaceChildren();
  container.hidden = !sections.some(([, names]) => names.length);
  for (const [heading, names] of sections) {
    if (!names.length) continue;
    const section = element('div', 'model-shortcut-group');
    section.append(element('strong', '', heading));
    for (const name of names) {
      const model = models.get(name);
      const select = button('', 'model-shortcut', () => send('selectProviderModel', { model: name }), busy);
      select.append(providerLogo(model.provider), element('span', '', model.label));
      select.title = name;
      select.dataset.providerFocus = `shortcut:${name}`;
      select.setAttribute('aria-pressed', String(state.model === name));
      section.append(select);
    }
    container.append(section);
  }
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
  const favorites = state.favoriteModels ?? [];
  const recent = state.recentModels ?? [];
  const observations = state.providerObservations ?? {};
  const signature = JSON.stringify([groups, group?.id, state.model, state.connected, state.providerError, busy, search.value, favorites, recent, observations]);
  if (signature === providerSignature) return;
  providerSignature = signature;
  const options = $('provider-options');
  const modelList = $('provider-models');
  const focused = document.activeElement.dataset.providerFocus;
  renderModelShortcuts(groups, favorites, recent, busy || !state.connected);
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
  const recentObservation = group.models.map(model => observations[model.name]).filter(Boolean).sort((a, b) => b.at - a.at)[0];
  $('provider-note').textContent = [group.note, recentObservation && `Last observed ${recentObservation.outcome.toLowerCase()} · ${new Date(recentObservation.at).toLocaleString()}`].filter(Boolean).join(' · ');
  $('provider-status').textContent = group.models.length ? 'Configured' : group.needsToken ? 'API token needed' : 'Setup needed';
  $('provider-status').dataset.configured = String(!!group.models.length);
  search.hidden = group.models.length < 4;
  const query = search.hidden ? '' : search.value.trim().toLowerCase();
  const models = group.models.filter(model => model.label.toLowerCase().includes(query));
  modelList.replaceChildren(...models.map(model => {
    const row = element('div', 'provider-model-row');
    const current = state.model === model.name;
    const choice = button(model.label, 'provider-model', () => send('selectProviderModel', { model: model.name }), busy || !state.connected);
    choice.title = model.name;
    choice.dataset.providerFocus = model.name;
    choice.setAttribute('aria-pressed', String(current));
    if (current) choice.append(element('span', 'provider-current', 'Selected'));
    const observation = observations[model.name];
    const meta = [
      model.contextLength && `${model.contextLength.toLocaleString()} context`,
      model.maxOutputTokens && `${model.maxOutputTokens.toLocaleString()} max output`,
      observation?.retryAt && observation.retryAt > Date.now() ? `Retry after ${new Date(observation.retryAt).toLocaleTimeString()}` : '',
    ].filter(Boolean);
    if (meta.length) choice.append(element('small', 'model-capabilities', meta.join(' · ')));
    const pinned = favorites.includes(model.name);
    const pin = button('', 'model-pin', () => send('toggleFavoriteModel', { model: model.name }));
    pin.innerHTML = '<svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="M6 3.5h8l-1.4 5 2.3 3H5.1l2.3-3L6 3.5ZM10 11.5v5"/></svg>';
    pin.title = `${pinned ? 'Unpin' : 'Pin'} ${model.label}`;
    pin.setAttribute('aria-label', `Favorite ${model.label}`);
    pin.setAttribute('aria-pressed', String(pinned));
    pin.dataset.providerFocus = `pin:${model.name}`;
    row.append(choice, pin);
    return row;
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
  if (focused) [...providerDrawer.querySelectorAll('[data-provider-focus]')].find(node => node.dataset.providerFocus === focused)?.focus({ preventScroll: true });
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
        search.focus({ preventScroll: true });
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
    historySearchQuery = (e.target.value || '').trim().toLowerCase().slice(0, 160);
    if (historySearchQuery) send('searchHistory', { query: historySearchQuery });
    else historyMatches = undefined;
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
    const options = $('compose-extras');
    if (options.open && options.contains(document.activeElement)) {
      options.open = false;
      options.querySelector('summary').focus();
      e.preventDefault();
    }
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
$('prev-hunk').addEventListener('click', () => nextHunk(-1));
$('review-commands').addEventListener('click', () => {
  const command = $('command-list').querySelector('.command-card');
  command?.scrollIntoView({ block: 'center' });
  command?.querySelector('.command-actions button:not(:disabled)')?.focus({ preventScroll: true });
});
$('open-review-diff').addEventListener('click', () => {
  const proposal = activeReview();
  const file = proposal?.files.find(item => item.hunks.some(hunk => hunk.decision === 'pending')) ?? proposal?.files[0];
  if (file) send('preview', { proposalId: proposal.id, path: file.path });
});
$('sticky-apply').addEventListener('click', () => { const active = activeReview(); if (active) applyReview(active.id); });
document.addEventListener('keydown', event => {
  const active = activeReview();
  if (!event.altKey || event.ctrlKey || event.metaKey || event.target.closest?.('textarea,input,select')) return;
  const key = event.key.toLowerCase();
  if (key === 'c' || key === 'e' || key === 'j') {
    if (key === 'c') $('prompt').focus();
    if (key === 'e') $('recovery-actions').querySelector('button:not(:disabled)')?.focus();
    if (key === 'j') $('jump-latest').click();
    event.preventDefault();
    return;
  }
  if (!active || state.auxiliary) return;
  if (key === 'enter' && !$('sticky-apply').disabled) $('sticky-apply').click();
  else if (key === 'n') nextHunk();
  else if (key === 'p') nextHunk(-1);
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
for (const kind of ['file', 'folder', 'symbol']) {
  $(`${kind}-mention`).addEventListener('click', () => {
    $('compose-extras').open = false;
    send('mention', { kind });
  });
}
$('new-chat').addEventListener('click', () => {
  if (!isRunning() && !state.auxiliary) {
    storeDraft();
    draftChatId = undefined;
    firstDraft = false;
    draft.pins = []; draft.excluded = []; draft.semantic = false;
    replacement = undefined;
    $('symbol-graph').checked = false;
    setContextOpen(false);
    $('compose-extras').open = false;
    promptInput.value = '';
    for (const key of limitKeys) $(`limit-${key}`).value = '';
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
    if (submittedRecovery && event.data.state.error !== state.error) submittedRecovery = undefined;
    if (submittedProposal && event.data.state.error !== state.error && event.data.state.error) submittedProposal = undefined;
    trackNewActivity(state, event.data.state);
    state = event.data.state;
    restoreChatDraft(state.activeConversationId);
    if (submittedFollowUp && (state.queuedFollowUp || !state.canQueue || state.evidence?.id !== submittedFollowUp.after)) {
      if (state.queuedFollowUp?.prompt === submittedFollowUp.prompt && promptInput.value.trim() === submittedFollowUp.prompt) {
        promptInput.value = '';
        refreshComposer();
      }
      submittedFollowUp = undefined;
    }
    render();
  } else if (event.data.type === 'historyMatches' && event.data.query === historySearchQuery) {
    historyMatches = event.data;
    renderHistoryItems();
  } else if (event.data.type === 'diagnosticCopied') {
    $('copy-diagnostic').textContent = 'Copied';
    setTimeout(() => { $('copy-diagnostic').textContent = 'Copy diagnostic'; }, 1600);
  } else if (event.data.type === 'revealHistory' && event.data.id === state.activeConversationId && Number.isInteger(event.data.index)) {
    const row = $('transcript').querySelector(`[data-message-index="${event.data.index}"]`);
    if (row) {
      followFeed = false;
      row.tabIndex = -1;
      row.scrollIntoView({ block: 'center' });
      row.focus({ preventScroll: true });
      markJump();
    }
  } else if (event.data.type === 'editFollowUp' && !followUpEditor.open && event.data.id === state.queuedFollowUp?.id) {
    const { id, prompt, requeue } = event.data;
    followUpEditor.dataset.queueId = id;
    followUpEditor.dataset.requeue = String(requeue);
    followUpEditor.returnValue = '';
    followUpPrompt.value = prompt;
    followUpEditor.showModal();
    followUpPrompt.focus();
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
