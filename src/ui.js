/* Host-owned state; model text is always rendered through textContent. */
const vscode = acquireVsCodeApi();
let state = { status: 'idle', messages: [], context: null, proposals: [], approvals: [], checkpoints: [], activity: [], connected: false, model: '' };
let renderedError = null;
const $ = id => document.getElementById(id);
const send = (type, data = {}) => vscode.postMessage({ type, ...data });
const element = (tag, cls, text) => { const el = document.createElement(tag); if (cls) el.className = cls; if (text !== undefined) el.textContent = text; return el; };
function button(text, cls, action, disabled = false) { const el = element('button', cls, text); el.disabled = disabled; el.addEventListener('click', action); return el; }
function render() {
  const busy = !['idle', 'completed', 'failed', 'cancelled'].includes(state.status);
  $('connection').textContent = state.connected ? 'Connected' : 'Local harness';
  $('dot').classList.toggle('online', state.connected);
  $('model').textContent = state.model ? state.model.split('/').pop() : 'Choose model';
  $('model').title = state.model || 'Configure a model in TrueForge';
  $('hero').hidden = state.messages.length > 0;
  $('run-status').hidden = state.status === 'idle';
  $('run-status').classList.toggle('busy', busy);
  $('status-text').textContent = ({ running: 'Working through your repository', connecting: 'Connecting to TrueForge', 'awaiting-review': 'Your review is needed', cancelling: 'Stopping and cleaning up', cancelled: 'Run stopped', completed: 'Turn complete', failed: 'Run needs attention' })[state.status] || state.status;
  $('stop').hidden = !busy; $('send').disabled = busy; $('prompt').disabled = busy;
  $('session').hidden = !state.sessionId;
  $('activity').replaceChildren(...state.activity.slice(-5).map(t => element('div', '', `› ${t}`)));
  const transcript = $('transcript');
  const oldHeight = transcript.scrollHeight;
  transcript.replaceChildren(...state.messages.map(message => {
    const row = element('div', `message ${message.role}`); row.append(element('span', 'role', message.role === 'user' ? 'YOU' : 'LITTLE FORGE'));
    const pieces = message.text.split('```');
    pieces.forEach((part, index) => row.append(element(index % 2 ? 'pre' : 'span', '', index % 2 ? part.replace(/^\w+\n/, '') : part)));
    return row;
  }));
  const feed = document.querySelector('main');
  if (transcript.scrollHeight > oldHeight && state.status === 'running' && feed.scrollHeight - feed.scrollTop - feed.clientHeight < 160) requestAnimationFrame(() => feed.scrollTo({ top: feed.scrollHeight, behavior: 'smooth' }));
  $('error').hidden = !state.error;
  $('error-text').textContent = state.error || '';
  if (state.error && state.error !== renderedError) requestAnimationFrame(() => $('error').scrollIntoView({ block: 'nearest', behavior: 'auto' }));
  renderedError = state.error || null;
  $('contexts').hidden = !state.context;
  if (state.context) {
    const c = state.context;
    $('budget-label').textContent = `${c.usedTokens.toLocaleString()} / ${c.budgetTokens.toLocaleString()} conservative token units`;
    $('budget-index').textContent = c.selectionOnly ? 'Selected region · 1 file' : `${c.indexedFiles} files indexed`;
    $('meter-bar').style.width = `${Math.min(100, c.usedTokens / Math.max(1, c.budgetTokens) * 100)}%`;
    $('source-list').replaceChildren(...c.chunks.map(chunk => {
      const card = element('div', 'context-card');
      card.append(button(`${chunk.path}:${chunk.startLine}-${chunk.endLine}`, '', () => send('openSource', { path: chunk.path, line: chunk.startLine })));
      card.append(element('p', '', chunk.reason));
      if (chunk.declarations?.length) card.append(element('p', '', `Relevant declarations: ${chunk.declarations.map(d=>`${d.name}:${d.line}`).join(', ')}`));
      return card;
    }));
  }
  $('review-list').replaceChildren(...state.proposals.map(proposal => {
    const section = element('section', 'review');
    const head = element('div', 'review-header'); head.append(element('strong', '', 'Review changes'), element('small', '', `${proposal.files.length} files · ${proposal.state}`)); section.append(head);
    for (const file of proposal.files) {
      const fh = element('div', 'file-head', file.path); fh.append(button('Open diff ↗', '', () => send('preview', { proposalId: proposal.id, path: file.path }))); section.append(fh);
      file.hunks.forEach((hunk, i) => {
        const line = (file.original || '').slice(0,hunk.start).split('\n').length;
        const row = element('div', 'hunk'); const label = element('div', 'hunk-label'); label.append(element('span', '', `HUNK ${i + 1} · LINE ${line}`), element('span', '', hunk.decision)); row.append(label);
        if (hunk.before) row.append(element('pre', 'before', hunk.before));
        if (hunk.after) row.append(element('pre', 'after', hunk.after));
        const actions = element('div', 'hunk-actions');
        actions.append(button('Reject', `small-button ${hunk.decision === 'reject' ? 'rejected' : ''}`, () => send('decide', { proposalId: proposal.id, hunkId: hunk.id, decision: 'reject' }), proposal.state !== 'pending'), button('Accept', `small-button ${hunk.decision === 'accept' ? 'accepted' : ''}`, () => send('decide', { proposalId: proposal.id, hunkId: hunk.id, decision: 'accept' }), proposal.state !== 'pending'));
        row.append(actions); section.append(row);
      });
    }
    const awaiting = state.approvals.some(a => a.name === 'apply_proposal' && a.args.proposalId === proposal.id);
    const pending = proposal.files.some(f => f.hunks.some(h => h.decision === 'pending'));
    const accepted = proposal.files.some(f => f.hunks.some(h => h.decision === 'accept'));
    const footer = element('div', 'review-footer');
    footer.append(button(accepted ? 'Apply selected hunks' : 'Finish review', 'primary wide', () => send('apply', { proposalId: proposal.id }), !awaiting || pending || proposal.state !== 'pending'));
    if (proposal.state === 'pending') footer.append(button('Reject all remaining', 'mention-button', () => send('rejectRemaining', { proposalId: proposal.id })));
    footer.append(element('div', 'review-note', awaiting ? 'Your choices are applied through TrueForge approval.' : proposal.state === 'pending' ? 'Waiting for the agent to request the apply checkpoint.' : 'Review decisions are preserved.'));
    section.append(footer); return section;
  }));
  $('command-list').replaceChildren(...state.approvals.filter(a => a.name === 'run_command').map(a => {
    const card = element('div', 'context-card'); card.append(element('strong', '', 'Run project check?'), element('pre', '', JSON.stringify(a.args, null, 2)), element('p', '', 'Project code runs with your user permissions and may have side effects.'));
    card.append(button('Deny', 'small-button', () => send('commandDecision', { toolCallId: a.toolCallId, allow: false })), button('Allow once', 'small-button accepted', () => send('commandDecision', { toolCallId: a.toolCallId, allow: true }))); return card;
  }));
  $('checkpoints').hidden = !state.checkpoints.length;
  $('checkpoint-list').replaceChildren(...state.checkpoints.slice(-4).reverse().map(cp => {
    const row = element('div', 'checkpoint'); row.append(element('span', '', `${cp.paths.length} files · ${cp.state}`), button('Undo change', 'small-button', () => send('undo', { id: cp.id }), busy)); return row;
  }));
}
$('form').addEventListener('submit', event => { event.preventDefault(); const prompt = $('prompt').value.trim(); if (prompt) { send('run', { prompt }); $('prompt').value = ''; } });
$('prompt').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); $('form').requestSubmit(); } });
$('stop').addEventListener('click', () => send('stop'));
$('model').addEventListener('click', () => send('setup'));
$('connect').addEventListener('click', () => send('setup'));
$('session').addEventListener('click', () => send('session'));
$('file-mention').addEventListener('click', () => send('mention', { kind: 'file' }));
$('symbol-mention').addEventListener('click', () => send('mention', { kind: 'symbol' }));
$('new-chat').addEventListener('click', () => send('newChat'));
for (const card of document.querySelectorAll('[data-prompt]')) card.addEventListener('click', () => { $('prompt').value = card.dataset.prompt; $('prompt').focus(); });
window.addEventListener('message', event => { if (event.data.type === 'state') { state = event.data.state; render(); } else if (event.data.type === 'insertMention') { $('prompt').value += `${$('prompt').value ? ' ' : ''}${event.data.text} `; $('prompt').focus(); } });
send('ready');
