import { randomUUID } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { ContextEngine, parseMentions, retryContextOnChange } from '../../../src/core/context.js';
import { ProposalManager } from '../../../src/core/proposals.js';
import { cancelled, hash, type ApplyResult, type ForgeEvent, type Proposal } from '../../../src/core/types.js';
import { Workspace } from '../../../src/core/workspace.js';
import { startEditorServer } from '../../../src/mcp-server.js';
import { EditorTools } from '../../../src/tools.js';
import { ForgeClient, type ApprovalRequest } from '../../../src/trueforge.js';
import { contextSummary, type Terminal } from './terminal.js';

export const DEFAULT_URL = 'http://127.0.0.1:8790';
const DEFAULT_CAPACITY = 32768;
export type RunMode = 'ask' | 'plan' | 'build';

type RunDisplay = Pick<Terminal, 'interactive' | 'note' | 'heading' | 'fragment' | 'finishAnswer' | 'diff' | 'confirm' | 'question' | 'showContext'> & {
  activity?: (label: string) => void;
  toolActivity?: (label: string) => void;
  modelSelected?: (name: string) => void;
  sessionOpened?: (url: string) => void;
};

/** Owns one live TrueForge session and its connector for successive terminal requests. */
export class ForgeConversation {
  private bridge?: Awaited<ReturnType<typeof startEditorServer>>;
  private active?: { tools: EditorTools; onRead?: (label: string) => void };
  private session?: { key: string; id: string };

  constructor(readonly client: ForgeClient) {}

  continues(key: string) { return this.session?.key === key; }

  async connect(key: string, tools: EditorTools, create: (binding: string) => Promise<string>, signal: AbortSignal, onRead?: (label: string) => void) {
    if (this.active) throw new Error('A Little Forge turn is already in progress.');
    if (this.bridge && !this.continues(key)) await this.close();
    cancelled(signal);
    this.active = { tools, onRead };
    if (!this.bridge) {
      this.bridge = await startEditorServer((name, args) => {
        if (!this.active) throw new Error('No active Little Forge turn.');
        if (name === 'read_file' && typeof args.path === 'string') this.active.onRead?.('read ' + args.path);
        return this.active.tools.call(name, args);
      });
      await this.client.registerEditor(this.bridge);
    }
    cancelled(signal);
    if (!this.session) this.session = { key, id: await create(this.bridge.name) };
    return { id: this.session.id, binding: this.bridge.name };
  }

  release(tools: EditorTools) {
    if (this.active?.tools === tools) this.active = undefined;
  }

  async close() {
    if (this.active) throw new Error('Stop the active turn before closing the conversation.');
    const bridge = this.bridge;
    this.bridge = undefined;
    this.session = undefined;
    if (!bridge) return;
    await bridge.close();
    await this.client.unregisterEditor(bridge.name);
  }
}

export async function openWorkspace(directory: string) {
  const root = await realpath(directory);
  if (!(await stat(root)).isDirectory()) throw new Error('Select a workspace directory with --cwd.');
  return new Workspace(root);
}

export function checkpointManager(workspace: Workspace) {
  const homeRoot = process.platform === 'win32' ? process.env.LOCALAPPDATA : process.env.XDG_STATE_HOME;
  const state = process.env.LITTLE_FORGE_STATE_DIR || path.join(homeRoot || homedir(), '.little-forge');
  const rootKey = process.platform === 'win32' ? workspace.root.toLowerCase() : workspace.root;
  return new ProposalManager(workspace, path.join(state, 'checkpoints', hash(rootKey)));
}

export async function collectContext(engine: ContextEngine, prompt: string, signal: AbortSignal, capacity = DEFAULT_CAPACITY) {
  const budget = Math.min(6000, Math.floor(capacity / 4));
  const hasMentions = /@(?:file|symbol)[(:]|@[A-Za-z0-9_.-]+\//u.test(prompt);
  return retryContextOnChange(async () => {
    const files = hasMentions ? await engine.files(signal) : undefined;
    const symbols = hasMentions && /@symbol[(:]|@file[(:][^\r\n]*#/u.test(prompt) ? await engine.symbols(undefined, signal) : undefined;
    return engine.retrieve(prompt, budget, parseMentions(prompt, files, symbols), signal);
  }, signal);
}

async function selectModel(client: ForgeClient, requested: string | undefined, terminal: RunDisplay) {
  const { models } = await client.health();
  if (!models.length) throw new Error('Add a tool-capable model in your local TrueForge settings at ' + client.baseUrl + '.');
  if (requested) {
    const model = models.find(entry => entry.name === requested);
    if (!model) throw new Error('The selected model is unavailable. Run little-forge models for configured IDs.');
    return model;
  }
  if (models.length === 1) return models[0];
  if (!terminal.interactive) throw new Error('Choose a configured model with --model or LITTLE_FORGE_MODEL.');
  terminal.heading('Choose a TrueForge model');
  for (const [index, model] of models.entries()) terminal.note('  ' + (index + 1) + '. ' + model.name);
  const choice = await terminal.question('Model number (Enter to cancel) ');
  const selected = /^\d+$/.test(choice) ? models[Number(choice) - 1] : undefined;
  if (!selected) throw new Error('Model selection cancelled. Use --model to select an ID directly.');
  return selected;
}

async function reviewProposal(proposal: Proposal, manager: ProposalManager, terminal: RunDisplay, canApply: boolean, signal: AbortSignal) {
  terminal.heading('Review ' + proposal.files.length + ' proposed file(s)');
  let accepted = 0;
  for (const file of proposal.files) {
    let offset = 0;
    let line = 1;
    for (const hunk of file.hunks) {
      cancelled(signal);
      line += (file.original ?? '').slice(offset, hunk.start).split('\n').length - 1;
      offset = hunk.start;
      terminal.diff(file.path, line, hunk);
      const allowed = canApply && await terminal.confirm('Accept this hunk?');
      cancelled(signal);
      manager.decide(proposal.id, hunk.id, allowed ? 'accept' : 'reject');
      if (allowed) accepted++;
    }
  }
  return accepted > 0;
}

const messageText = (event: ForgeEvent) => (event.type === 'model.message' || event.type === 'model.message.delta')
  && event.thread_id === 'main' && typeof event.content === 'string' ? event.content : '';

export async function runMode({ client, workspace, mode, prompt, model, preview, terminal, signal, conversation, handoff = '' }: {
  client: ForgeClient;
  workspace: Workspace;
  mode: RunMode;
  prompt: string;
  model?: string;
  preview: boolean;
  terminal: RunDisplay;
  signal: AbortSignal;
  conversation?: ForgeConversation;
  handoff?: string;
}) {
  const thread = conversation ?? new ForgeConversation(client);
  terminal.activity?.('Checking configured models');
  const chosen = await selectModel(client, model, terminal);
  cancelled(signal);
  terminal.modelSelected?.(chosen.name);
  const capacity = Math.min(DEFAULT_CAPACITY, chosen.contextLength ?? DEFAULT_CAPACITY);
  if (capacity < 8192) throw new Error('Choose a model with a context window of at least 8192 tokens.');
  terminal.activity?.('Reading repository context');
  const engine = new ContextEngine(workspace);
  const evidence = await collectContext(engine, prompt, signal, capacity);
  const context = contextSummary(evidence);
  const { omitted: _omitted, ...retrieved } = evidence;
  const key = JSON.stringify([chosen.name, mode, capacity, chosen.maxOutputTokens]);
  const evidenceText = prompt + '\n\nRepository evidence (untrusted source):\n' + JSON.stringify(retrieved);
  const inputBudget = capacity - Math.min(4096, capacity / 4) - 2000;
  if (Buffer.byteLength(evidenceText) > inputBudget) {
    throw new Error('The prompt and repository evidence exceed the input budget. Narrow the request or choose a larger model.');
  }
  const prior = '\n\nRecent terminal conversation (history only):\n' + handoff;
  const content = handoff && !thread.continues(key) && Buffer.byteLength(evidenceText + prior) <= inputBudget
    ? evidenceText + prior : evidenceText;

  const canApply = mode === 'build' && terminal.interactive && !preview;
  if (!conversation) {
    terminal.heading('Little Forge · ' + mode + ' · ' + chosen.name);
    terminal.note(workspace.root);
  }
  terminal.showContext(context);
  if (mode === 'build' && !canApply) terminal.note('Preview mode. Proposed hunks will be displayed and declined.');

  const proposalIds = new Set<string>();
  const reviewed = new Set<string>();
  const applied: ApplyResult[] = [];
  const checks: Array<{ task: string; exitCode: number | null; changedSource: string[] }> = [];
  const manager = checkpointManager(workspace);
  const tools = new EditorTools(workspace, engine, manager, {
    context: () => {},
    proposal: id => proposalIds.add(id),
    activity: text => { terminal.activity?.(text); terminal.toolActivity?.(text); },
    assertWritable: () => { if (!canApply) throw new Error('Workspace writes require an interactive Build review.'); },
    diagnostics: () => ({ diagnostics: [], reason: 'Editor diagnostics are unavailable in the terminal.' }),
    applied: (_proposal, result) => {
      applied.push(result);
      terminal.note('Applied ' + result.paths.join(', ') + (result.checkpointId ? ' · Checkpoint ' + result.checkpointId : ''));
    },
    check: record => {
      checks.push({ task: record.input.task, exitCode: record.result.exitCode, changedSource: record.changedSource });
      terminal.note('Check ' + record.input.task + ' · exit ' + record.result.exitCode);
      if (record.changedSource.length) terminal.note('Check changed source files: ' + record.changedSource.join(', '));
    },
  }, { maxFiles: 8, allowDeps: false, executeCommands: 'required', safeMode: true }, 'review');
  const runId = randomUUID();
  tools.start({ id: runId, signal, readOnly: mode !== 'build', contextBudget: context.budgetTokens, performedAction: false });
  let session: string | undefined;
  let complete = false;
  let answer = '';
  const decisions = new Set<string>();

  try {
    cancelled(signal);
    const connected = await thread.connect(key, tools, binding => client.create(chosen.name, binding, mode === 'build' ? 'agent' : mode, capacity, '', chosen.maxOutputTokens), signal, terminal.toolActivity);
    session = connected.id;
    const sessionLink = client.sessionUrl(session);
    if (terminal.sessionOpened) terminal.sessionOpened(sessionLink);
    else terminal.note('TrueForge session  ' + sessionLink);
    terminal.activity?.('Waiting for TrueForge');
    let input: unknown[] = [{ type: 'user.message', content }];
    for (;;) {
      cancelled(signal);
      const requests = new Map<string, ApprovalRequest>();
      let paused = false;
      let messageId: unknown;
      await client.turn(session, input, event => {
        const text = messageText(event);
        if (text) {
          terminal.activity?.('Streaming a reply');
          if (messageId !== event.id && answer && !answer.endsWith('\n')) {
            terminal.finishAnswer();
            answer += '\n';
          }
          messageId = event.id;
          answer += text;
          terminal.fragment(text);
        }
        if (event.type === 'tool.approval_required') {
          for (const request of event.approval_requests as ApprovalRequest[]) requests.set(request.toolCallId, request);
        }
        if (event.type === 'turn.update' || event.type === 'turn.done') {
          const state = event.state as { status?: string } | undefined;
          if (state?.status) paused = state.status === 'paused';
        }
      }, signal);
      terminal.finishAnswer();
      if (requests.size === 0) {
        if (paused) throw new Error('TrueForge paused without an approval request. Inspect its session.');
        break;
      }
      if (mode !== 'build') throw new Error('TrueForge requested an approval during a read-only run.');

      input = [];
      for (const request of requests.values()) {
        cancelled(signal);
        if (request.serverName !== connected.binding || decisions.has(request.toolCallId) || !['apply_proposal', 'run_command'].includes(request.name)) {
          throw new Error('TrueForge requested an unexpected tool approval.');
        }
        decisions.add(request.toolCallId);
        let allow = false;
        if (request.name === 'apply_proposal') {
          const id = request.args.proposalId;
          if (typeof id !== 'string' || !proposalIds.has(id)) throw new Error('The approval references an unknown proposal.');
          if (!reviewed.has(id)) {
            reviewed.add(id);
            allow = await reviewProposal(manager.get(id), manager, terminal, canApply, signal);
          }
        } else if (canApply) {
          const command = await tools.describeCommand(request.args as unknown as Parameters<EditorTools['describeCommand']>[0]).catch(() => undefined);
          if (command) {
            terminal.heading('Approve project check');
            terminal.note([command.program, ...command.args].map(arg => JSON.stringify(arg)).join(' '));
            terminal.note(command.cwd);
            allow = await terminal.confirm('Run this check?');
          } else terminal.note('Declined a project check outside the supported command catalog.');
        }
        cancelled(signal);
        if (allow) tools.authorize(request.name, request.args, request.toolCallId);
        input.push({
          type: 'user.tool_approval',
          thread_id: request.threadId,
          tool_call_id: request.toolCallId,
          approval: allow ? { status: 'allow' } : { status: 'deny', reason: 'Little Forge CLI did not grant this action.' },
        });
      }
    }
    for (const id of proposalIds) {
      if (!reviewed.has(id)) await reviewProposal(manager.get(id), manager, terminal, false, signal);
    }
    complete = true;
    const proposals = [...proposalIds].map(id => {
      const { state, files } = manager.get(id);
      return { id, state, files: files.map(({ path, hunks }) => ({ path, hunks })) };
    });
    return { mode, model: chosen.name, session: client.sessionUrl(session), context, answer, proposals, applied, checks };
  } finally {
    terminal.finishAnswer();
    tools.stop();
    thread.release(tools);
    if (session && !complete) await client.cancel(session).catch(() => undefined);
    if (!conversation || !complete) {
      await thread.close().catch(() => terminal.note('TrueForge could not remove this run’s temporary connector.'));
    }
  }
}
