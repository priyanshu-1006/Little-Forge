import * as vscode from 'vscode';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { isSensitivePath, Workspace } from './core/workspace.js';
import { ContextEngine, parseMentions } from './core/context.js';
import { ProposalManager } from './core/proposals.js';
import { hash, type ContextResult, type ForgeEvent, type Proposal, type SelectionScope } from './core/types.js';
import { ForgeClient, ForgeError, recoveryFailure, type ApprovalRequest } from './trueforge.js';
import { startEditorServer } from './mcp-server.js';
import { EditorTools } from './tools.js';
import { MAX_RETRY_DELAY_MS, quotaContinuationInput, recoveryAction, waitForRetry } from './core/resilience.js';

type Status = 'idle' | 'connecting' | 'running' | 'awaiting-review' | 'cancelling' | 'cancelled' | 'completed' | 'failed';
export type PermissionMode = 'review' | 'default' | 'auto' | 'turbo';
interface Message { role: 'user' | 'assistant'; text: string }
interface UiState { status: Status; connected: boolean; model: string; permissionMode: PermissionMode; sessionId?: string; messages: Message[]; activity: string[]; context?: ContextResult; proposals: Proposal[]; approvals: ApprovalRequest[]; checkpoints: Array<{id:string;paths:string[];state:string}>; error?: string }
interface Running { id: string; abort: AbortController; assistant: Message; model: string; reasoningEffort: string; mode: 'inline' | 'agent'; decisions: Map<string, boolean>; scope?: SelectionScope; retries: number; fallbackUsed: boolean; inFlight: boolean; resuming: boolean }

export function activate(context: vscode.ExtensionContext) {
  const forge = new ForgeExtension(context);
  context.subscriptions.push(forge, vscode.window.registerWebviewViewProvider('littleForge.agent', forge, { webviewOptions: { retainContextWhenHidden: true } }));
  const register = (command: string, action: () => unknown) => context.subscriptions.push(vscode.commands.registerCommand(command, () => Promise.resolve(action()).catch(e => forge.report(e))));
  register('littleForge.open', () => vscode.commands.executeCommand('littleForge.agent.focus'));
  register('littleForge.inlineEdit', () => forge.inline());
  register('littleForge.stop', () => forge.stop());
  register('littleForge.undo', () => forge.undo());
  register('littleForge.setup', () => forge.setup());
  register('littleForge.review', () => forge.reviewLatest());
}

class ForgeExtension implements vscode.WebviewViewProvider, vscode.Disposable {
  private view?: vscode.WebviewView;
  private readonly output = vscode.window.createOutputChannel('Little Forge');
  private readonly virtual = new Map<string, string>();
  private readonly disposables: vscode.Disposable[] = [];
  private state: UiState = { status: 'idle', connected: false, model: '', permissionMode: 'auto', messages: [], activity: [], proposals: [], approvals: [], checkpoints: [] };
  private workspace?: Workspace;
  private context?: ContextEngine;
  private proposals?: ProposalManager;
  private tools?: EditorTools;
  private bridge?: Awaited<ReturnType<typeof startEditorServer>>;
  private client?: ForgeClient;
  private run?: Running;
  private preparing = false;
  private preparationGeneration = 0;
  private sessionModel?: string;
  private sessionMode?: string;
  private publishTimer?: ReturnType<typeof setTimeout>;
  private disposed = false;
  private readonly virtualChanges = new vscode.EventEmitter<vscode.Uri>();

  constructor(private readonly extension: vscode.ExtensionContext) {
    this.state.model = this.config().get<string>('model', '');
    this.state.permissionMode = extension.workspaceState.get<PermissionMode>('permissionMode') || this.config().get<PermissionMode>('permissionMode', 'auto');
    this.state.sessionId = extension.workspaceState.get<string>('sessionId');
    const history = extension.workspaceState.get<Message[]>('transcript', []);
    if (Array.isArray(history)) this.state.messages = history.filter(m => ['user', 'assistant'].includes(m.role) && typeof m.text === 'string').slice(-12).map(m => ({ role: m.role, text: m.text.slice(0, 16000) }));
    this.disposables.push(this.virtualChanges, vscode.workspace.registerTextDocumentContentProvider('little-forge', { onDidChange: this.virtualChanges.event, provideTextDocumentContent: uri => this.virtual.get(uri.toString()) ?? 'This review has expired.' }));
    const watcher = vscode.workspace.createFileSystemWatcher('**/*');
    const invalidate = (uri: vscode.Uri) => {
      if (uri.scheme !== 'file') return;
      const context = this.context;
      if (context) void context.handleFileEvent(uri.fsPath).catch(() => context.invalidate());
    };
    this.disposables.push(watcher, watcher.onDidChange(invalidate), watcher.onDidCreate(invalidate), watcher.onDidDelete(invalidate));
    this.disposables.push(vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration('littleForge')) { this.state.model = this.config().get<string>('model', ''); this.publish(); } }));
  }
  private config() { return vscode.workspace.getConfiguration('littleForge'); }
  private busy() { return this.preparing || !!this.run; }
  private publish(immediate = false) {
    if (this.disposed) return;
    if (immediate) { clearTimeout(this.publishTimer); this.publishTimer = undefined; void this.view?.webview.postMessage({ type: 'state', state: this.state }); return; }
    if (!this.publishTimer) this.publishTimer = setTimeout(() => this.publish(true), 45);
  }
  private log(message: string) { this.output.appendLine(`[${new Date().toISOString()}] ${message}`); this.state.activity.push(message); this.state.activity = this.state.activity.slice(-30); this.publish(); }
  report(error: unknown) { this.state.error = this.safeError(error); if (!this.busy()) this.state.status = 'failed'; this.publish(true); this.output.appendLine(this.state.error); }
  private safeError(error: unknown) { return (error instanceof Error ? error.message : 'The operation failed.').replace(/Bearer\s+[^\s"',;]+/gi, 'Bearer [redacted]').replace(/\b(?:sk|gsk|hf)[-_][A-Za-z0-9_-]{10,}\b/g, '[redacted]').slice(0, 1000); }

  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.extension.extensionUri, 'dist')] };
    const uri = (name: string) => view.webview.asWebviewUri(vscode.Uri.joinPath(this.extension.extensionUri, 'dist', name));
    const nonce = randomUUID().replaceAll('-', '');
    view.webview.html = `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${view.webview.cspSource}; script-src 'nonce-${nonce}';"><link rel="stylesheet" href="${uri('ui.css')}"></head><body>
      <header><div class="brand"><span class="logo">ϟ</span><span>LITTLE FORGE</span><span class="version-badge">2.0</span><span class="status"><i id="dot" class="dot"></i><span id="connection">Local harness</span></span></div><div class="toolbar"><button id="model" class="pill">Choose model</button><button id="permissions-btn" class="pill" title="Local Permissions"><span id="perm-icon">🛡️</span> <span id="perm-label">Auto</span> ▾</button><button id="session-btn" class="pill" title="Open TrueForge session">Session ↗</button><button id="connect" class="pill" title="Connect and configure">Connect ↗</button><span class="spacer"></span><button id="new-chat" class="pill" title="New chat">＋</button></div><div id="permissions-menu" class="permissions-dropdown" hidden><div class="perm-title">Local Permissions</div><button type="button" class="perm-option" data-mode="review"><span class="perm-option-icon">👁️</span><div class="perm-option-info"><div class="perm-option-name">Request Review</div><div class="perm-option-desc">Every command and file change requires approval.</div></div><span class="perm-check">✓</span></button><button type="button" class="perm-option" data-mode="default"><span class="perm-option-icon">🔒</span><div class="perm-option-info"><div class="perm-option-name">Default</div><div class="perm-option-desc">Ask before sensitive operations and commands.</div></div><span class="perm-check">✓</span></button><button type="button" class="perm-option" data-mode="auto"><span class="perm-option-icon">🛡️</span><div class="perm-option-info"><div class="perm-option-name">Auto <span class="badge-rec">Default</span></div><div class="perm-option-desc">Automatically decide if commands run; auto-apply safe workspace changes.</div></div><span class="perm-check">✓</span></button><button type="button" class="perm-option" data-mode="turbo"><span class="perm-option-icon">⚡</span><div class="perm-option-info"><div class="perm-option-name">Turbo</div><div class="perm-option-desc">Run all safe checks and edits without restrictions; protect credentials.</div></div><span class="perm-check">✓</span></button></div></header>
      <main><section id="hero" class="hero"><div class="eyebrow">BUILT ON TRUEFORGE</div><h1>Your code.<br>Your call.</h1><p>Autonomous context discovery. Exact multi-file diffs.<br>Every hunk stays yours to review before it lands.</p><div class="workflow"><b>Discover</b><span>→</span><b>Propose</b><span>→</span><b>Review</b><span>→</span><b>Verify</b></div><div class="suggestions"><button class="suggestion" data-prompt="Explain how this repository is structured. Find the main entry points and tests, and cite source paths."><div><strong>Map this repository</strong><small>Trace the code before changing it.</small></div></button><button class="suggestion" data-prompt="Find a small missing edge-case test, explain why it matters, and propose a focused improvement with the relevant implementation and documentation changes if needed."><div><strong>Make a focused improvement</strong><small>Let the agent discover the files.</small></div></button></div></section>
      <div id="run-status" class="run-status" hidden><div class="spinner"></div><i class="activity-dot" style="display:none"></i><span id="status-text"></span><span class="spacer"></span><button id="session" class="mention-button" hidden>Session ↗</button></div><div id="error" class="error" role="alert" hidden><strong>Needs attention</strong><span id="error-text"></span></div><div id="activity" class="activity-log"></div><div id="transcript"></div><details id="contexts" class="context-drawer" hidden><summary class="context-summary"><span class="context-icon">📑</span><span>Context references (<span id="budget-index"></span>)</span><span id="budget-label" class="context-token-badge"></span><span class="context-arrow">▾</span></summary><div class="context-body"><div class="meter"><i id="meter-bar"></i></div><div id="source-list"></div></div></details><div id="review-list"></div><div id="command-list"></div><section id="checkpoints" hidden><div class="section-title">Accepted changes</div><div id="checkpoint-list"></div></section></main>
      <footer class="composer"><form id="form"><div class="compose-box"><textarea id="prompt" aria-label="Coding request" placeholder="Describe a change, or mention @file / @symbol…"></textarea><div class="compose-actions"><button type="button" id="file-mention" class="mention-button">@file</button><button type="button" id="symbol-mention" class="mention-button">@symbol</button><span class="spacer"></span><button id="stop" type="button" class="stop" hidden>■ Stop</button><button id="send" type="submit" class="primary send">Build ↗</button></div></div></form><div class="footnote"><span>Every edit stays yours to approve.</span><span class="badge">Ctrl ↵</span></div></footer><script nonce="${nonce}" src="${uri('ui.js')}"></script></body></html>`;
    this.disposables.push(view.webview.onDidReceiveMessage(message => { void this.receive(message).catch(error => this.report(error)); }));
    this.publish(true);
  }

  private async receive(value: unknown) {
    if (!value || typeof value !== 'object') return;
    const message = value as Record<string, unknown>;
    const str = (name: string, max = 2000) => { const v = message[name]; if (typeof v !== 'string' || v.length > max) throw new Error('Invalid editor action.'); return v; };
    switch (message.type) {
      case 'ready':
        void this.checkConnection();
        this.publish(true);
        return;
      case 'run': await this.start(str('prompt', 12000)); return;
      case 'stop': await this.stop(); return;
      case 'setup': await this.setup(); return;
      case 'session': {
        const baseUrl = this.config().get<string>('endpoint', 'http://127.0.0.1:8790');
        const targetUrl = this.client && this.state.sessionId
          ? this.client.sessionUrl(this.state.sessionId)
          : baseUrl;
        await vscode.env.openExternal(vscode.Uri.parse(targetUrl));
        return;
      }
      case 'newChat': if (this.busy()) throw new Error('Stop the active run before starting a new chat.'); this.state.messages = []; this.state.sessionId = undefined; this.state.context = undefined; this.state.error = undefined; this.state.proposals = []; this.state.approvals = []; this.state.status = 'idle'; this.virtual.clear(); this.publish(true); await this.saveHistory(); return;
      case 'mention': await this.mention(str('kind')); return;
      case 'openSource': { const absolute = await this.workspace?.resolve(str('path')); if (absolute) { const editor = await vscode.window.showTextDocument(vscode.Uri.file(absolute), { preview: true }); const line = Math.max(0, Math.min(editor.document.lineCount - 1, Number(message.line) - 1 || 0)); editor.revealRange(new vscode.Range(line, 0, line, 0)); } return; }
      case 'preview': await this.preview(str('proposalId'), str('path')); return;
      case 'decide': { const proposalId = str('proposalId'); this.assertCurrent(proposalId); const decision = str('decision'); if (decision !== 'accept' && decision !== 'reject') throw new Error('Invalid hunk decision.'); this.proposals!.decide(proposalId, str('hunkId'), decision); this.refreshProposal(proposalId); return; }
      case 'setPermissionMode': {
        const mode = str('mode') as PermissionMode;
        if (['review', 'default', 'auto', 'turbo'].includes(mode)) {
          this.state.permissionMode = mode;
          await this.extension.workspaceState.update('permissionMode', mode);
          this.log(`Permissions set to: ${mode}`);
          this.publish(true);
        }
        return;
      }
      case 'acceptAllHunks': {
        const id = str('proposalId');
        const proposal = this.assertCurrent(id);
        for (const file of proposal.files) for (const hunk of file.hunks) this.proposals!.decide(id, hunk.id, 'accept');
        this.refreshProposal(id);
        return;
      }
      case 'rejectRemaining': { const id = str('proposalId'); const proposal = this.assertCurrent(id); for (const file of proposal.files) for (const hunk of file.hunks) if (hunk.decision === 'pending') this.proposals!.decide(id, hunk.id, 'reject'); this.refreshProposal(id); return; }
      case 'apply': await this.applySelection(str('proposalId')); return;
      case 'commandDecision': { const id = str('toolCallId'); const approval = this.state.approvals.find(a => a.toolCallId === id && a.name === 'run_command'); if (!approval || !this.run) throw new Error('This command approval expired.'); this.run.decisions.set(id, message.allow === true); await this.maybeResume(); return; }
      case 'undo': await this.undo(str('id')); return;
    }
  }
  private assertCurrent(id: string) { const proposal = this.proposals?.get(id); if (!this.run || !proposal || proposal.runId !== this.run.id || this.run.abort.signal.aborted) throw new Error('This proposal belongs to an expired run.'); return proposal; }
  private refreshProposal(id: string) {
    const current = this.proposals!.get(id); this.state.proposals = this.state.proposals.map(p => p.id === id ? current : p);
    for (const file of current.files) { const uri = vscode.Uri.from({ scheme: 'little-forge', path: `/${id}/proposed/${file.path}` }); if (this.virtual.has(uri.toString())) { this.virtual.set(uri.toString(), this.proposals!.preview(id, file.path) ?? ''); this.virtualChanges.fire(uri); } }
    this.publish(true);
  }

  private async initialise() {
    const folders = vscode.workspace.workspaceFolders;
    const active = vscode.window.activeTextEditor?.document.uri;
    const folder = active ? vscode.workspace.getWorkspaceFolder(active) ?? folders?.[0] : folders?.[0];
    if (!folder || folder.uri.scheme !== 'file') throw new Error('Open a local repository folder in VS Code first.');
    if (this.workspace?.root !== folder.uri.fsPath) {
      if (this.run) throw new Error('Stop the current run before changing workspace.');
      await this.bridge?.close();
      this.workspace = new Workspace(folder.uri.fsPath);
      this.context = new ContextEngine(this.workspace);
      this.proposals = new ProposalManager(this.workspace, path.join(this.extension.globalStorageUri.fsPath, 'checkpoints', hash(this.workspace.root).slice(0, 24)), { assertWritable: paths => this.assertWritable(paths) });
      this.tools = new EditorTools(this.workspace, this.context, this.proposals, {
        context: value => { this.state.context = value; this.publish(); },
        proposal: id => { this.state.proposals.push(this.proposals!.get(id)); this.publish(true); },
        activity: text => this.log(text), assertWritable: paths => this.assertWritable(paths), diagnostics: paths => this.diagnostics(paths)
      });
      this.bridge = await startEditorServer((name, args) => this.tools!.call(name, args));
      this.state.sessionId = undefined;
      await this.refreshCheckpoints();
    }
    const baseUrl = this.config().get<string>('baseUrl', 'http://127.0.0.1:8790');
    if (this.client?.baseUrl !== new URL(baseUrl).origin) { this.client = new ForgeClient(baseUrl); this.state.sessionId = undefined; }
    this.client ??= new ForgeClient(baseUrl);
  }
  private assertWritable(paths: string[]) {
    if (!vscode.workspace.isTrusted) throw new Error('Trust this workspace before applying edits or running project checks.');
    const roots = new Set(paths.map(p => path.resolve(this.workspace!.root, p).toLowerCase()));
    if (vscode.workspace.textDocuments.some(d => d.uri.scheme === 'file' && d.isDirty && roots.has(path.resolve(d.uri.fsPath).toLowerCase()))) throw new Error('Save the affected editor documents before proposing, applying or undoing changes.');
  }
  private async diagnostics(paths?: string[]) {
    const allowed = new Set((await this.workspace!.list(this.run?.abort.signal)).map(f => f.path));
    return vscode.languages.getDiagnostics().flatMap(([uri, values]) => {
      try { const relative = this.workspace!.relative(uri.fsPath); if (!allowed.has(relative) || (paths && !paths.includes(relative))) return []; return values.slice(0, 10).map(d => ({ path: relative, line: d.range.start.line + 1, message: d.message.slice(0, 500), severity: d.severity })); } catch { return []; }
    }).slice(0, 40);
  }
  async setup(internal = false) {
    if (this.busy() && !internal) throw new Error('Stop the active run before changing the model connection.');
    if (!internal) this.preparing = true;
    try { await this.setupReserved(); } finally { if (!internal) this.preparing = false; this.publish(true); }
  }
  private async setupReserved() {
    await this.initialise();
    try {
      const health = await this.client!.health(); this.state.connected = true;
      if (!health.models.length) {
        this.state.error = 'TrueForge is running. Add your chosen provider under Settings → Models, then choose Connect again. API keys stay in TrueForge.';
        await vscode.env.openExternal(vscode.Uri.parse(this.client!.baseUrl)); this.publish(true); return;
      }
      const selected = await vscode.window.showQuickPick(health.models.map(m => ({ label: m.name })), { title: 'Little Forge · choose a configured TrueForge model', placeHolder: 'Provider credentials remain in TrueForge settings' });
      if (selected) { await this.config().update('model', selected.label, vscode.ConfigurationTarget.Global); this.state.model = selected.label; this.state.sessionId = undefined; this.state.error = undefined; }
    } catch (error) {
      this.state.connected = false; this.state.error = `${this.safeError(error)}\nRun “npm run harness” in the little-forge folder, then open the local TrueForge page and configure your provider.`;
      const action = await vscode.window.showInformationMessage('Start the local TrueForge harness, configure your provider, then reconnect.', 'Open local setup', 'Show output');
      if (action === 'Open local setup') await vscode.env.openExternal(vscode.Uri.parse(this.client!.baseUrl));
      if (action === 'Show output') this.output.show();
    }
    this.publish(true);
  }
  async mention(kind: string) {
    await this.initialise();
    if (kind === 'file') {
      const file = await vscode.window.showQuickPick((await this.context!.files()).map(f => ({ label: f.path })), { title: 'Mention a permitted file' });
      if (file) await this.view?.webview.postMessage({ type: 'insertMention', text: `@file(${file.label})` });
    } else if (kind === 'symbol') {
      const symbol = await vscode.window.showQuickPick((await this.context!.symbols()).map(s => ({ label: s.name, description: `${s.path}:${s.line}`, symbol: s })), { title: 'Mention a symbol' });
      if (symbol) await this.view?.webview.postMessage({ type: 'insertMention', text: `@symbol(${symbol.symbol.path}#${symbol.symbol.name})` });
    }
  }
  async inline() {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.selection.isEmpty || editor.document.uri.scheme !== 'file') throw new Error('Select a saved region of code first.');
    if (editor.document.isDirty) throw new Error('Save the file before requesting an inline edit.');
    await this.initialise();
    const relative = this.workspace!.relative(editor.document.uri.fsPath);
    const file = await this.workspace!.read(relative);
    const selection = editor.selection;
    const scope: SelectionScope = { path: relative, hash: file.hash, start: editor.document.offsetAt(selection.start), end: editor.document.offsetAt(selection.end) };
    if (file.content !== editor.document.getText()) throw new Error('Editor contents differ from disk. Save and retry the selection.');
    const instruction = await vscode.window.showInputBox({ title: 'Little Forge · edit selection', prompt: 'Describe the change. Every proposed hunk is reviewed before application.', placeHolder: 'Treat off and n as false, case-insensitively…', ignoreFocusOut: true });
    if (!instruction?.trim()) return;
    await vscode.commands.executeCommand('littleForge.agent.focus');
    await this.start(instruction, scope);
  }

  async start(prompt: string, scope?: SelectionScope) {
    if (this.busy()) throw new Error('A run is active. Stop it before sending another request.');
    this.preparing = true; const generation = ++this.preparationGeneration; this.state.status = 'connecting'; this.publish(true);
    try { await this.startReserved(prompt, scope, generation); }
    finally { this.preparing = false; if (!this.run && this.state.status === 'connecting') this.state.status = 'idle'; this.publish(true); }
  }
  private async startReserved(prompt: string, scope: SelectionScope | undefined, generation: number) {
    await this.initialise();
    if (generation !== this.preparationGeneration) return;
    const model = this.config().get<string>('model', '');
    if (!model) { await this.setup(true); if (!this.config().get<string>('model', '') || generation !== this.preparationGeneration) return; }
    const selectedModel = this.config().get<string>('model', '');
    this.state.model = selectedModel;
    const assistant: Message = { role: 'assistant', text: '' };
    const run: Running = { id: randomUUID(), abort: new AbortController(), assistant, model: selectedModel, reasoningEffort: this.config().get<string>('reasoningEffort', ''), mode: scope ? 'inline' : 'agent', decisions: new Map(), scope, retries: 0, fallbackUsed: false, inFlight: false, resuming: false };
    this.run = run; this.state.status = 'connecting'; this.state.error = undefined; this.state.activity = []; this.state.proposals = []; this.state.approvals = []; this.state.context = undefined;
    this.state.messages.push({ role: 'user', text: scope ? `${prompt}\n\nSelection: ${scope.path}` : prompt }, assistant); this.state.messages = this.state.messages.slice(-20);
    const capacity = this.config().get<number>('contextTokens', 32768);
    const contextBudget = Math.min(12000, Math.max(1000, Math.floor((capacity - 6144) / 2)));
    this.publish(true);
    try {
      await this.client!.health(); this.state.connected = true;
      if (run.abort.signal.aborted) return;
      // A late call from an older harness session must never enter a newer run.
      // Each user request gets a new endpoint, bearer token and inline session binding.
      await this.bridge?.close();
      if (run.abort.signal.aborted || this.run !== run) return;
      const tools = this.tools!;
      tools.start({ id: run.id, signal: run.abort.signal, scope, contextBudget, performedAction: false });
      this.bridge = await startEditorServer((name, args) => { if (tools.active?.id !== run.id || run.abort.signal.aborted) return Promise.reject(new Error('This MCP endpoint belongs to an expired run.')); return tools.call(name, args); });
      await this.client!.registerEditor(this.bridge!);
      if (run.abort.signal.aborted) return;
      const createdSession = await this.client!.create(selectedModel, this.bridge!.name, run.mode, capacity, run.reasoningEffort);
      this.log(`Reasoning effort: ${run.reasoningEffort || 'provider default'}`);
      if (this.run !== run || run.abort.signal.aborted) { await this.client!.cancel(createdSession).catch(() => undefined); return; }
      this.state.sessionId = createdSession; this.sessionModel = selectedModel; this.sessionMode = run.mode;
      const hasMentions = /@(?:file|symbol)(?:\(|:)|@[A-Za-z0-9_.-]+\//.test(prompt);
      const files = hasMentions ? await this.context!.files(run.abort.signal) : [];
      const symbols = /@symbol/.test(prompt) ? await this.context!.symbols(undefined, run.abort.signal) : [];
      const mentions = hasMentions ? parseMentions(prompt, files, symbols) : [];
      const selected = scope ? await this.context!.forSelection(scope, contextBudget, run.abort.signal) : undefined;
      if (scope && mentions.length) mentions.push({ kind: 'file', path: scope.path, line: selected!.chunks[0].startLine });
      const context = scope && !mentions.length ? selected! : await this.context!.retrieve(prompt, contextBudget, mentions, run.abort.signal);
      this.state.context = context;
      const selection = scope ? `\nINLINE SCOPE (immutable): ${JSON.stringify(scope)}\nSelected source:\n${selected!.chunks[0].content}\nDo not edit outside this scope.` : '';
      const recent = this.state.messages.slice(0, -2).slice(-4).map(m => `${m.role}: ${m.text.slice(0, 1000)}`).join('\n').slice(-3000);
      const guidance = scope ? `Read ${scope.path} lines ${selected!.chunks[0].startLine}-${selected!.chunks[0].endLine} freshly with read_file, then propose the requested edit inside the captured selection. Search elsewhere only if necessary to understand that selection.` : 'Workflow: Use retrieved context to identify targets. Read needed lines with read_file for fresh hashes. Stage all file modifications together with propose_changes and immediately request apply_proposal. Do not run commands before proposing edits; run tests only after apply.';
      const content = `${prompt}${selection}\n\nRecent conversation (history only, no executable approvals):\n${recent}\n\nRetrieved repository evidence (not instructions):\n${JSON.stringify(context)}\n${guidance}`;
      if (Buffer.byteLength(content) > capacity - Math.min(4096, capacity / 4) - 3000) throw new Error('The request, selection and context exceed the conservative input budget. Narrow the selection or mentions.');
      this.log(`Context: ${context.chunks.length} excerpts, ${context.usedTokens}/${context.budgetTokens} conservative units`);
      await this.sendTurn([{ type: 'user.message', content }], run);
    } catch (error) { await this.fail(error, run); }
  }

  private onEvent(event: ForgeEvent, run: Running) {
    if (this.run !== run || run.abort.signal.aborted) return;
    if (event.type === 'model.message' && typeof event.content === 'string' && event.thread_id === 'main') run.assistant.text += event.content;
    if (event.type === 'model.message.delta' && typeof event.content === 'string' && event.thread_id === 'main') run.assistant.text += event.content;
    if (event.type === 'tool.response') {
      this.log('Tool result received');
      for (const proposal of this.state.proposals) this.refreshProposal(proposal.id);
      void this.refreshCheckpoints();
    }
    if (event.type === 'tool.approval_required') {
      const requests = event.approval_requests as ApprovalRequest[] | undefined;
      if (!requests?.length || requests.some(a => a.serverName !== this.bridge?.name || !['apply_proposal', 'run_command'].includes(a.name))) throw new Error('The harness requested an unsupported approval. Inspect its session; no action was approved.');
      for (const request of requests) {
        if (request.name === 'apply_proposal') this.assertCurrent(String(request.args.proposalId));
        if (!this.state.approvals.some(a => a.toolCallId === request.toolCallId)) this.state.approvals.push(request);
      }

      const isAutonomous = this.state.permissionMode === 'auto' || this.state.permissionMode === 'turbo';
      let autoApplyHandled = false;

      if (isAutonomous) {
        let allAllowed = true;
        for (const req of requests) {
          if (req.name === 'apply_proposal') {
            const proposalId = String(req.args.proposalId);
            const proposal = this.proposals?.get(proposalId);
            const sensitive = proposal?.files.find(f => isSensitivePath(f.path));
            if (sensitive) {
              this.log(`Sensitive file detected (${sensitive.path}). Pausing for explicit human review.`);
              allAllowed = false;
              break;
            }
            if (proposal) {
              for (const file of proposal.files) {
                for (const hunk of file.hunks) {
                  if (hunk.decision === 'pending') this.proposals!.decide(proposalId, hunk.id, 'accept');
                }
              }
              this.refreshProposal(proposalId);
            }
            run.decisions.set(req.toolCallId, true);
          } else if (req.name === 'run_command') {
            run.decisions.set(req.toolCallId, true);
            this.log(`Auto-allowed verification check: ${(req.args.args as string[])?.join(' ') || req.args.task}`);
          }
        }

        if (allAllowed && requests.every(r => run.decisions.has(r.toolCallId))) {
          autoApplyHandled = true;
          this.log('Local Permissions: Auto-applying approved workspace changes.');
          void this.maybeResume().catch(err => this.report(err));
        }
      }

      if (!autoApplyHandled) {
        this.state.status = 'awaiting-review'; this.log('TrueForge paused for your approval');
        const first = requests.find(a => a.name === 'apply_proposal');
        if (first) { const proposal = this.proposals!.get(String(first.args.proposalId)); void this.preview(proposal.id, proposal.files[0].path).catch(error => this.report(error)); }
      }
    }
    if (event.type === 'turn.done') {
      const state = event.state as Record<string, unknown> | undefined;
      if (state?.status === 'done' && !run.assistant.text && state.output && typeof state.output === 'object') run.assistant.text = String((state.output as Record<string, unknown>).content ?? '');
    }
    this.publish();
  }
  private async sendTurn(input: unknown[], run: Running, originalInput = input) {
    if (this.run !== run || run.abort.signal.aborted) return;
    run.inFlight = true; this.state.status = 'running'; this.publish(true);
    try { await this.client!.turn(this.state.sessionId!, input, event => this.onEvent(event, run), run.abort.signal); }
    catch (error) {
      run.inFlight = false;
      const failure = recoveryFailure(error);
      const quotaFailure = error instanceof ForgeError && error.status === 429;
      const action = recoveryAction({ ...failure, sideEffects: this.tools?.active?.performedAction ?? true, pendingReview: this.state.proposals.length > 0 || this.state.approvals.length > 0, approvalResume: input.some(v => (v as Record<string, unknown>).type !== 'user.message'), retries: run.retries, fallbackUsed: run.fallbackUsed, currentModel: run.model, fallbackModel: this.config().get<string>('fallbackModel', ''), minimumDelayMs: quotaFailure ? error.retryAfterMs : undefined, retryAfterTooLong: quotaFailure && error.retryAfterTooLong, rateLimited: quotaFailure });
      if (quotaFailure && error.retryAfterTooLong) this.log(`Provider retry delay exceeds the ${MAX_RETRY_DELAY_MS / 1000}s automatic wait limit. Check the provider quota before trying again.`);
      if (this.run !== run || run.abort.signal.aborted || action.type === 'stop') throw error;
      if (action.type === 'retry') {
        run.retries++; this.log(`Model request failed conclusively. Retry ${run.retries}/2 in ${action.delay / 1000}s.`);
        await waitForRetry(action.delay, run.abort.signal);
        if (action.continueSession) {
          this.log('Quota wait finished. Continuing the existing TrueForge session with its observed reads.');
          await this.sendTurn(quotaContinuationInput(), run, originalInput); return;
        }
      } else {
        run.fallbackUsed = true; run.model = action.model; this.state.model = action.model;
        this.log(`Primary model failed. Switching through TrueForge to ${action.model}${action.delay ? ` after the provider's ${action.delay / 1000}s wait` : ''}.`);
        if (action.delay) await waitForRetry(action.delay, run.abort.signal);
      }
      if (run.abort.signal.aborted) throw new Error('Run cancelled.');
      const retrySession = await this.client!.create(run.model, this.bridge!.name, run.mode, this.config().get<number>('contextTokens', 32768), run.reasoningEffort);
      if (this.run !== run || run.abort.signal.aborted) { await this.client!.cancel(retrySession).catch(() => undefined); throw new Error('Run cancelled.'); }
      this.state.sessionId = retrySession;
      run.assistant.text = ''; await this.sendTurn(originalInput, run, originalInput); return;
    }
    finally { run.inFlight = false; }
    if (this.run !== run || run.abort.signal.aborted) return;
    if (this.state.approvals.length) { this.state.status = 'awaiting-review'; this.publish(true); await this.maybeResume(); }
    else {
      this.state.status = 'completed'; this.tools!.stop(); this.run = undefined;
      for (const p of this.state.proposals) this.refreshProposal(p.id);
      await this.refreshCheckpoints(); this.publish(true); await this.saveHistory();
    }
  }
  private async applySelection(proposalId: string) {
    const proposal = this.assertCurrent(proposalId);
    const approval = this.state.approvals.find(a => a.name === 'apply_proposal' && a.args.proposalId === proposalId);
    if (!approval) throw new Error('Wait for TrueForge to request this proposal’s apply checkpoint.');
    const hunks = proposal.files.flatMap(f => f.hunks);
    if (hunks.some(h => h.decision === 'pending')) throw new Error('Accept or reject each hunk before finishing review.');
    const accepted = hunks.some(h => h.decision === 'accept');
    if (accepted) this.assertWritable(proposal.files.map(f => f.path));
    this.run!.decisions.set(approval.toolCallId, accepted);
    await this.maybeResume();
  }
  private async maybeResume() {
    const run = this.run;
    if (!run || run.inFlight || run.resuming || !this.state.approvals.length || this.state.approvals.some(a => !run.decisions.has(a.toolCallId))) return;
    run.resuming = true;
    const approvals = [...this.state.approvals];
    try {
      for (const approval of approvals) if (run.decisions.get(approval.toolCallId)) this.tools!.authorize(approval.name, approval.args, approval.toolCallId);
      const inputs = approvals.map(a => ({ type: 'user.tool_approval', thread_id: a.threadId, tool_call_id: a.toolCallId, approval: run.decisions.get(a.toolCallId) ? { status: 'allow' } : { status: 'deny', reason: 'The user rejected this action in the editor.' } }));
      for (const approval of approvals) {
        if (approval.name === 'apply_proposal' && !run.decisions.get(approval.toolCallId)) {
          const id = String(approval.args.proposalId); // Mark all rejected; the harness receives denial.
          const p = this.proposals!.get(id); for (const f of p.files) for (const h of f.hunks) this.proposals!.decide(id, h.id, 'reject'); this.refreshProposal(id);
        }
      }
      this.state.approvals = []; run.resuming = false;
      await this.sendTurn(inputs, run);
    } catch (error) { await this.fail(error, run); }
    finally { run.resuming = false; }
  }
  private async fail(error: unknown, run: Running) {
    if (this.run !== run) return;
    this.state.status = run.abort.signal.aborted ? 'cancelled' : 'failed';
    this.state.error = run.abort.signal.aborted ? undefined : this.safeError(error);
    run.abort.abort(); this.tools?.stop(); this.state.approvals = []; this.run = undefined;
    this.state.proposals = this.state.proposals.map(p => this.proposals!.get(p.id)); this.publish(true);
    if (this.state.sessionId) { try { await this.client?.cancel(this.state.sessionId); } catch { this.log('Remote cancellation could not be confirmed; inspect the TrueForge session. Local write grants are revoked.'); } }
    this.publish(true); await this.refreshCheckpoints(); await this.saveHistory();
  }
  async stop() {
    const run = this.run; if (!run) { if (this.preparing) { ++this.preparationGeneration; this.state.status = 'cancelled'; this.publish(true); } return; }
    this.state.status = 'cancelling'; run.abort.abort(); this.tools?.stop(); this.state.approvals = []; this.publish(true);
    try { if (this.state.sessionId) await this.client?.cancel(this.state.sessionId); }
    catch { this.state.error = 'Local actions are revoked. Remote cancellation is unconfirmed; inspect the TrueForge session.'; }
    if (this.run === run) { this.run = undefined; this.state.status = 'cancelled'; this.state.proposals = this.state.proposals.map(p => this.proposals!.get(p.id)); await this.refreshCheckpoints(); this.publish(true); await this.saveHistory(); }
  }
  async preview(proposalId: string, filePath: string) {
    const proposal = this.proposals?.get(proposalId); const file = proposal?.files.find(f => f.path === filePath);
    if (!file) throw new Error('This file is not in the proposal.');
    const before = vscode.Uri.from({ scheme: 'little-forge', path: `/${proposalId}/before/${file.path}` });
    const after = vscode.Uri.from({ scheme: 'little-forge', path: `/${proposalId}/proposed/${file.path}` });
    this.virtual.set(before.toString(), file.original ?? ''); this.virtual.set(after.toString(), this.proposals!.preview(proposalId, file.path) ?? '');
    await vscode.commands.executeCommand('vscode.diff', before, after, `${file.path} · Little Forge reviewed proposal`, { preview: true });
  }
  async reviewLatest() { const proposal = this.state.proposals.at(-1); if (!proposal) throw new Error('No proposed changes to review.'); await this.preview(proposal.id, proposal.files[0].path); await vscode.commands.executeCommand('littleForge.agent.focus'); }
  async undo(id?: string) {
    if (this.busy()) throw new Error('Stop the active run before restoring a checkpoint.');
    this.preparing = true;
    try { await this.undoReserved(id); } finally { this.preparing = false; this.publish(true); }
  }
  private async undoReserved(id?: string) {
    await this.initialise(); const checkpoints = await this.proposals!.checkpoints();
    const selected = id ?? (await vscode.window.showQuickPick(checkpoints.map(cp => ({ label: cp.paths.join(', '), description: cp.state, id: cp.id })), { title: 'Undo an accepted or interrupted change' }))?.id;
    if (!selected) return;
    const record = checkpoints.find(cp => cp.id === selected); if (!record) throw new Error('Unknown checkpoint.'); this.assertWritable(record.paths);
    const result = await this.proposals!.undo(selected); this.context!.invalidate(); await this.refreshCheckpoints();
    // A passive notification resolves on dismissal, not on display. It must not
    // hold the editor's operation gate after restoration has already completed.
    if (result.conflicts.length) void vscode.window.showWarningMessage(`Preserved later edits; resolve undo conflicts in: ${result.conflicts.join(', ')}`);
    else void vscode.window.showInformationMessage(`Restored ${result.restored.length} file(s) from the checkpoint.`);
    this.publish(true);
  }
  private async checkConnection() {
    try {
      if (!this.client) {
        const baseUrl = this.config().get<string>('endpoint', 'http://127.0.0.1:8790');
        this.client = new ForgeClient(baseUrl);
      }
      await this.client.health();
      this.state.connected = true;
    } catch {
      this.state.connected = false;
    }
    this.publish(true);
  }
  private async refreshCheckpoints() { this.state.checkpoints = await this.proposals?.checkpoints() ?? []; this.publish(); }
  private async saveHistory() {
    await this.extension.workspaceState.update('sessionId', this.state.sessionId);
    await this.extension.workspaceState.update('transcript', this.state.messages.slice(-12).map(m => ({ role: m.role, text: m.text.slice(0, 16000) })));
  }
  dispose() { this.disposed = true; this.run?.abort.abort(); this.tools?.stop(); clearTimeout(this.publishTimer); void this.bridge?.close(); this.output.dispose(); for (const disposable of this.disposables) disposable.dispose(); }
}
