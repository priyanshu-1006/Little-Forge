/* Host-owned state; model text is always rendered through textContent. */
const vscode = acquireVsCodeApi();
let state = { status: 'idle', messages: [], context: null, proposals: [], approvals: [], checkpoints: [], activity: [], connected: false, model: '', permissionMode: 'auto' };
let renderedError = null;
const $ = id => document.getElementById(id);
const send = (type, data = {}) => vscode.postMessage({ type, ...data });
const element = (tag, cls, text) => { const el = document.createElement(tag); if (cls) el.className = cls; if (text !== undefined) el.textContent = text; return el; };
function button(text, cls, action, disabled = false) { const el = element('button', cls, text); el.disabled = disabled; el.addEventListener('click', action); return el; }

const PERM_CONFIG = {
  review: { icon: '👁️', label: 'Review' },
  default: { icon: '🔒', label: 'Default' },
  auto: { icon: '🛡️', label: 'Auto' },
  turbo: { icon: '⚡', label: 'Turbo' }
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
  if (text.startsWith('search workspace') || text.startsWith('search_workspace')) return { icon: '🔍', label: 'Searching workspace' };
  if (text.startsWith('read file') || text.startsWith('read_file')) return { icon: '📖', label: 'Reading source file' };
  if (text.startsWith('propose changes') || text.startsWith('propose_changes')) return { icon: '✏️', label: 'Staging multi-file changes' };
  if (text.startsWith('apply proposal') || text.startsWith('apply_proposal')) return { icon: '⚡', label: 'Applying approved changes' };
  if (text.startsWith('run command') || text.startsWith('run_command')) return { icon: '▶️', label: 'Running project command' };
  if (text.startsWith('get workspace map') || text.startsWith('get_workspace_map')) return { icon: '🗺️', label: 'Mapping repository tree' };
  if (text.startsWith('retrieve context') || text.startsWith('retrieve_context')) return { icon: '📚', label: 'Retrieving context evidence' };
  if (text === 'Tool result received') return { icon: '✓', label: 'Tool response processed' };
  if (text.startsWith('Context:')) return { icon: '📑', label: text };
  return { icon: '›', label: text };
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
      header.append(element('span', '', lang || 'CODE'));

      const copyBtn = button('Copy', 'copy-btn', () => {
        if (navigator.clipboard) {
          navigator.clipboard.writeText(code).then(() => {
            copyBtn.textContent = '✓ Copied';
            setTimeout(() => { copyBtn.textContent = 'Copy'; }, 2000);
          }).catch(() => undefined);
        }
      });
      header.append(copyBtn);
      wrapper.append(header);

      const pre = element('pre', 'code-block-content');
      pre.textContent = code;
      wrapper.append(pre);
      container.append(wrapper);
    } else {
      if (!part) return;
      const inlineChunks = part.split(/(`[^`]+`)/);
      inlineChunks.forEach(chunk => {
        if (chunk.startsWith('`') && chunk.endsWith('`') && chunk.length > 2) {
          const codeEl = element('code', 'inline-code', chunk.slice(1, -1));
          container.append(codeEl);
        } else if (chunk) {
          const span = element('span', '', chunk);
          container.append(span);
        }
      });
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
  const timerText = busy ? 'Thinking...' : `Worked for ${formatDuration(lastCompletedDuration || 14)}`;
  const timerSpan = element('span', 'work-trace-timer', timerText);
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
  titleGroup.append(
    element('span', 'forgeproof-badge', '✓ Verified'),
    element('strong', 'forgeproof-title', 'ForgeProof Outcome')
  );
  header.append(titleGroup);
  card.append(header);

  if (files.length > 0) {
    const filesSection = element('div', 'forgeproof-section');
    filesSection.append(element('div', 'forgeproof-section-label', `📁 ${files.length} Modified ${files.length === 1 ? 'File' : 'Files'}`));

    const pillList = element('div', 'forgeproof-file-list');
    for (const f of files) {
      const badge = getLangBadge(f);
      const pill = element('button', 'forgeproof-file-pill');
      pill.title = `Click to inspect diff for ${f}`;
      if (badge) pill.append(element('span', `lang-tag ${badge.cls}`, badge.label));
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
    checkSection.append(element('div', 'forgeproof-section-label', '✓ Verification Checks'));
    const checkList = element('div', 'forgeproof-check-list');
    for (const c of checks) {
      const cRow = element('div', 'forgeproof-check-row');
      cRow.append(element('span', 'check-icon', '✓'));
      cRow.append(element('span', 'check-text', c.text));
      checkList.append(cRow);
    }
    checkSection.append(checkList);
    card.append(checkSection);
  }

  const footer = element('div', 'forgeproof-footer');
  
  if (checkpointId) {
    const undoBtn = button('↺ Undo Changes', 'forgeproof-action-btn undo', () => send('undo', { id: checkpointId }));
    undoBtn.title = 'Restore workspace to checkpoint snapshot';
    footer.append(undoBtn);
  }

  if (sessionId) {
    const sessBtn = button('↗ TrueForge Session', 'forgeproof-action-btn session', () => send('session'));
    sessBtn.title = 'Open TrueForge session in browser';
    footer.append(sessBtn);
  }

  const copyBtn = button('📋 Copy Proof', 'forgeproof-action-btn copy', () => {
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
        copyBtn.textContent = '✓ Copied!';
        setTimeout(() => { copyBtn.textContent = '📋 Copy Proof'; }, 2000);
      });
    }
  });
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
        timerSpan.textContent = busy ? 'Thinking...' : `Worked for ${formatDuration(lastCompletedDuration || 14)}`;
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
    avatar.append(element('span', 'agent-icon', '⚡'), element('span', '', 'Little Forge'));
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
  $('model').textContent = state.model ? state.model.split('/').pop() : 'Choose model';
  $('model').title = state.model || 'Configure a model in TrueForge';

  // Update permissions pill
  const pMode = state.permissionMode || 'auto';
  const pCfg = PERM_CONFIG[pMode] || PERM_CONFIG.auto;
  const pIcon = $('perm-icon');
  const pLabel = $('perm-label');
  if (pIcon) pIcon.textContent = pCfg.icon;
  if (pLabel) pLabel.textContent = pCfg.label;

  document.querySelectorAll('.perm-option').forEach(opt => {
    opt.classList.toggle('active', opt.dataset.mode === pMode);
  });

  $('hero').hidden = state.messages.length > 0;
  $('run-status').hidden = state.status === 'idle';
  $('run-status').classList.toggle('busy', busy);
  $('status-text').textContent = ({
    running: 'Working through your repository…',
    connecting: 'Connecting to TrueForge…',
    'awaiting-review': 'Review required — waiting for your decision',
    cancelling: 'Stopping and cleaning up…',
    cancelled: 'Run stopped',
    completed: 'Task complete',
    failed: 'Needs attention'
  })[state.status] || state.status;
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
    const { icon, label } = formatToolStep(raw);
    const item = element('div', 'activity-item');
    item.append(element('span', 'step-icon', icon), element('span', 'step-text', label));
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
  const existingRows = Array.from(transcript.children);
  const newRows = visibleMessages.map((message, idx) => {
    const isLast = idx === visibleMessages.length - 1;
    const existing = existingRows[idx];

    // Reuse existing DOM element for completed messages if role and text are identical
    if (!isLast && existing && existing.dataset.role === message.role && existing.dataset.text === message.text) {
      return existing;
    }

    // Reuse and update active assistant row in-place!
    if (isLast && existing && existing.dataset.role === 'assistant' && message.role === 'assistant') {
      updateActiveAssistantRow(existing, message, busy, state, steps);
      existing.dataset.text = message.text || '';
      return existing;
    }

    const row = buildMessageRow(message, idx, isLast, busy, state, steps);
    row.dataset.role = message.role;
    row.dataset.text = message.text || '';
    return row;
  });

  transcript.replaceChildren(...newRows);

  const feed = document.querySelector('main');
  if (transcript.scrollHeight > oldHeight && state.status === 'running' && feed.scrollHeight - feed.scrollTop - feed.clientHeight < 160) {
    requestAnimationFrame(() => feed.scrollTo({ top: feed.scrollHeight, behavior: 'smooth' }));
  }

  $('error').hidden = !state.error;
  $('error-text').textContent = state.error || '';
  if (state.error && state.error !== renderedError) requestAnimationFrame(() => $('error').scrollIntoView({ block: 'nearest', behavior: 'auto' }));
  renderedError = state.error || null;

  $('contexts').hidden = !state.context;
  if (state.context) {
    const c = state.context;
    $('budget-label').textContent = `${c.usedTokens.toLocaleString()} / ${c.budgetTokens.toLocaleString()} tokens`;
    $('budget-index').textContent = c.selectionOnly ? '1 file' : `${c.indexedFiles} files`;
    $('meter-bar').style.width = `${Math.min(100, c.usedTokens / Math.max(1, c.budgetTokens) * 100)}%`;
    $('source-list').replaceChildren(...c.chunks.map(chunk => {
      const card = element('div', 'context-chip');
      card.append(button(`📄 ${chunk.path} (L${chunk.startLine}–${chunk.endLine})`, 'context-file-link', () => send('openSource', { path: chunk.path, line: chunk.startLine })));
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

    for (const file of proposal.files) {
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
    header.append(element('span', '', '▶️'), element('strong', '', 'Run project check?'));
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
}

const promptInput = $('prompt');
function adjustPromptHeight() {
  promptInput.style.height = 'auto';
  promptInput.style.height = `${Math.min(140, Math.max(38, promptInput.scrollHeight))}px`;
}
promptInput.addEventListener('input', adjustPromptHeight);

$('form').addEventListener('submit', event => {
  event.preventDefault();
  const prompt = $('prompt').value.trim();
  if (prompt) {
    turnStartTime = Date.now();
    lastCompletedDuration = null;
    send('run', { prompt });
    $('prompt').value = '';
    adjustPromptHeight();
  }
});

$('prompt').addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    $('form').requestSubmit();
  }
});

// Permissions menu toggle & option handlers
const permBtn = $('permissions-btn');
const permMenu = $('permissions-menu');
if (permBtn && permMenu) {
  permBtn.addEventListener('click', e => {
    e.stopPropagation();
    permMenu.hidden = !permMenu.hidden;
  });
  document.addEventListener('click', e => {
    if (!permMenu.contains(e.target) && e.target !== permBtn) {
      permMenu.hidden = true;
    }
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

$('stop').addEventListener('click', () => send('stop'));
$('model').addEventListener('click', () => send('setup'));
$('connect').addEventListener('click', () => send('setup'));
$('session').addEventListener('click', () => send('session'));
const sessionBtnEl = $('session-btn');
if (sessionBtnEl) sessionBtnEl.addEventListener('click', () => send('session'));
$('file-mention').addEventListener('click', () => send('mention', { kind: 'file' }));
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
