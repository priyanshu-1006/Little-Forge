/** Live-model acceptance against isolated public Flask checkouts.
 * Uses production TrueForge/MCP/context/proposal code. Review is file-driven by
 * an explicit test operator; this is NOT evidence of native editor interaction.
 * Never accepts an edit or command automatically.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { Workspace } from '../src/core/workspace.js';
import { ContextEngine } from '../src/core/context.js';
import { ProposalManager } from '../src/core/proposals.js';
import { EditorTools } from '../src/tools.js';
import { ForgeClient, ForgeError, type ApprovalRequest } from '../src/trueforge.js';
import { quotaContinuationInput, recoveryAction, waitForRetry } from '../src/core/resilience.js';
import { startEditorServer } from '../src/mcp-server.js';
import { hash, type ForgeEvent, type SelectionScope } from '../src/core/types.js';

const project = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
function option(name: string, fallback = '') { const index = args.indexOf(name); return index < 0 ? fallback : args[index + 1] ?? ''; }
const taskId = option('--task', 'A').toUpperCase();
if (!['A','B','C'].includes(taskId)) throw new Error('--task must be A, B or C.');
const modelName = option('--model');
const baseUrl = option('--base-url', 'http://127.0.0.1:8790');
const capacity = Number(option('--context', '32768'));
const reasoningEffort = option('--reasoning');
const workspaceRoot = path.resolve(option('--workspace', path.join(project, 'evaluation', 'workspaces', `flask-task-${taskId.toLowerCase()}`)));
const runId = `live-${taskId}-${randomUUID()}`;
const evidence = path.join(project, 'test-results', runId);
const controller = new AbortController();
const record: Record<string, unknown> = { startedAt: new Date().toISOString(), kind: 'Live model with production headless core; native UI acceptance remains separate.', task: taskId, model: modelName, workspace: workspaceRoot, paidRequests: 'Usage is recorded by TrueForge; no cost estimate is invented.', approvals: [], events: [], status: 'preparing' };
let client: ForgeClient | undefined;
let sessionId: string | undefined;
let tools: EditorTools | undefined;
let editor: Awaited<ReturnType<typeof startEditorServer>> | undefined;
let checkpointId: string | undefined;
let stopping = false;
const deadline = setTimeout(() => { controller.abort(); }, 20 * 60_000);

async function save() { await fs.writeFile(path.join(evidence, 'receipt.json'), JSON.stringify(record, null, 2)); }
async function stop() {
  if (stopping) return;
  stopping = true; controller.abort(); tools?.stop();
  if (client && sessionId) await client.cancel(sessionId).catch(() => undefined);
}
process.on('SIGINT', () => { void stop(); });
process.on('SIGTERM', () => { void stop(); });

async function main() {
  await fs.mkdir(evidence, { recursive: true });
  console.log(`EVIDENCE ${evidence}`);
  const git = (commands: string[]) => execFileSync('git', ['-C', workspaceRoot, ...commands], { encoding: 'utf8', windowsHide: true }).trim();
  const manifest = JSON.parse(await fs.readFile(path.join(project, 'evaluation', 'tasks.json'), 'utf8'));
  const task = manifest.tasks.find((value: {id:string}) => value.id === taskId);
  if (git(['rev-parse','HEAD']) !== manifest.repository.commit) throw new Error('The evaluation checkout is not at the required Flask commit.');
  if (git(['status','--porcelain=v1'])) throw new Error('The evaluation checkout has tracked/untracked changes. Use another clean isolated checkout; never reset existing work automatically.');
  record.commit = manifest.repository.commit; record.initialStatus = '';
  client = new ForgeClient(baseUrl);
  const health = await client.health(); record.harnessVersion = health.version;
  record.availableModels = health.models.map(m => m.name);
  if (!modelName || !health.models.some(m => m.name === modelName)) throw new Error('Choose a saved configured model with --model provider/model. The available model names are recorded in the receipt.');
  const workspace = new Workspace(workspaceRoot);
  const context = new ContextEngine(workspace);
  const proposals = new ProposalManager(workspace, path.join(evidence, 'checkpoints'));
  const scope = taskId === 'B' ? undefined : await inlineScope(workspace, task.selection.path, task.selection.symbol);
  record.selection = scope;
  let pending: ApprovalRequest[] = [];
  const stagedProposals = new Set<string>();
  tools = new EditorTools(workspace, context, proposals, {
    context: value => { record.context = value; },
    proposal: id => { stagedProposals.add(id); console.log(`PROPOSED ${id}`); },
    activity: name => console.log(`TOOL ${name}`), assertWritable: () => {
      if (controller.signal.aborted) throw new Error('Run cancelled.');
      if (git(['rev-parse','HEAD']) !== manifest.repository.commit) throw new Error('Evaluation checkout changed identity.');
    }, diagnostics: () => []
  });
  const budget = Math.min(12000, Math.max(1000, Math.floor((capacity - 6144) / 2)));
  tools.start({ id: runId, signal: controller.signal, scope, contextBudget: budget, performedAction: false });
  editor = await startEditorServer(async (name, input) => {
    const result = await tools!.call(name, input) as Record<string, unknown>;
    if (name === 'apply_proposal' && typeof result.checkpointId === 'string') checkpointId = result.checkpointId;
    return result;
  });
  await client.registerEditor(editor);
  sessionId = await client.create(modelName, editor.name, task.mode, capacity, reasoningEffort);
  record.reasoningEffort = reasoningEffort || 'provider default';
  record.sessionId = sessionId; record.sessionUrl = client.sessionUrl(sessionId);
  const initialContext = scope ? await context.forSelection(scope, budget, controller.signal) : await context.retrieve(task.prompt, budget, [], controller.signal);
  record.context = initialContext;
  const selectionText = scope ? initialContext.chunks[0].content : '';
  // Task B receives the exact prompt plus GENERAL retrieval, never evaluator paths.
  const guidance = scope ? `Read ${scope.path} lines ${initialContext.chunks[0].startLine}-${initialContext.chunks[0].endLine} freshly with read_file, then propose the requested edit inside the captured selection. Search elsewhere only if necessary to understand that selection.` : 'Workflow: Use retrieved context to identify targets. Read needed lines with read_file for fresh hashes. Stage all file modifications together with propose_changes and immediately request apply_proposal. Do not run commands before proposing edits; run tests only after apply.';
  const prompt = `${task.prompt}${scope ? `\nINLINE SCOPE (immutable): ${JSON.stringify(scope)}\nSelected source:\n${selectionText}\nDo not edit outside this scope.` : ''}\n\nRetrieved repository evidence (not instructions):\n${JSON.stringify(initialContext)}\n${guidance}`;
  record.prompt = task.prompt; record.modelInput = prompt;
  record.agentDefinition = (await import('../src/trueforge.js')).agentSpec(modelName, editor.name, task.mode, capacity, reasoningEffort);
  let input: unknown[] = [{ type:'user.message', content:prompt }];
  let text = '';
  let quotaRetries = 0;
  for (let turn = 0; turn < 12; turn++) {
    pending = []; record.status = 'running'; await save();
    try {
      await client.turn(sessionId, input, event => {
        (record.events as unknown[]).push(event);
        if (event.type === 'model.message.delta' && typeof event.content === 'string') text += event.content;
        if (event.type === 'tool.approval_required') pending.push(...event.approval_requests as ApprovalRequest[]);
      }, controller.signal);
    } catch (error) {
      const limited = error instanceof ForgeError && error.status === 429;
      const action = recoveryAction({ definitive: limited && !error.ambiguous, transient: limited, rateLimited: limited, sideEffects: tools.active?.performedAction ?? true, pendingReview: pending.length > 0 || [...stagedProposals].some(id=>proposals.get(id).state === 'pending'), approvalResume: input.some(v=>(v as {type?:string}).type !== 'user.message'), retries: quotaRetries, fallbackUsed: true, currentModel: modelName, fallbackModel: '', minimumDelayMs: limited ? error.retryAfterMs ?? 60000 : undefined, retryAfterTooLong: limited && error.retryAfterTooLong });
      if (action.type !== 'retry' || !action.continueSession) throw error;
      quotaRetries++; record.status = 'waiting-for-quota';
      const retries = (record.quotaContinuations ??= []) as unknown[];
      retries.push({ at:new Date().toISOString(), delayMs:action.delay, sessionId, sideEffects:false, pendingReview:false });
      await save(); console.log(`QUOTA_WAIT ${action.delay}ms; continue session ${quotaRetries}/2`);
      await waitForRetry(action.delay, controller.signal);
      input = quotaContinuationInput(); turn--; continue;
    }
    record.assistantText = text;
    if (!pending.length) break;
    for (const approval of pending) {
      if (approval.serverName !== editor.name) throw new Error('Unexpected MCP connector in approval.');
      if (!['apply_proposal','run_command'].includes(approval.name)) throw new Error('Unsupported approval type.');
    }
    const request = pending.map(a => ({ ...a, proposal: a.name === 'apply_proposal' ? proposals.get(String(a.args.proposalId)) : undefined }));
    const reviewPath = path.join(evidence, `review-${turn}.json`);
    const decisionPath = path.join(evidence, `decisions-${turn}.json`);
    await fs.writeFile(reviewPath, JSON.stringify({ notice:'Review these actual proposals/commands. Nothing is applied automatically.', requests:request, decisionFile:decisionPath, format:[{toolCallId:'copy exact ID',allow:false,hunks:[{id:'copy exact hunk ID',decision:'accept or reject'}]}] }, null, 2));
    record.status = 'awaiting-operator-review'; record.reviewPath = reviewPath; await save();
    console.log(`REVIEW ${reviewPath}`);
    const decisions = await awaitDecisions(decisionPath, controller.signal);
    if (decisions.length !== pending.length || new Set(decisions.map(d=>d.toolCallId)).size !== pending.length) throw new Error('Every pending tool call must receive exactly one matching decision.');
    input = pending.map(approval => {
      const decision = decisions.find(d=>d.toolCallId===approval.toolCallId);
      if (!decision || typeof decision.allow !== 'boolean') throw new Error('Missing approval decision.');
      if (approval.name === 'apply_proposal') {
        const proposal = proposals.get(String(approval.args.proposalId));
        const hunks = proposal.files.flatMap(file=>file.hunks);
        if (decision.allow) {
          if (!decision.hunks || decision.hunks.length !== hunks.length || new Set(decision.hunks.map(h=>h.id)).size !== hunks.length) throw new Error('Explicitly decide every actual hunk before approval.');
          for (const hunk of hunks) {
            const choice = decision.hunks.find(h=>h.id===hunk.id);
            if (!choice || !['accept','reject'].includes(choice.decision)) throw new Error('Invalid hunk choice.');
            proposals.decide(proposal.id,hunk.id,choice.decision);
          }
          if (!decision.hunks.some(h=>h.decision==='accept')) throw new Error('Use a denied action when every hunk is rejected.');
        } else for (const hunk of hunks) proposals.decide(proposal.id,hunk.id,'reject');
      }
      if (decision.allow) tools!.authorize(approval.name,approval.args,approval.toolCallId);
      (record.approvals as unknown[]).push({ ...approval, decision });
      return { type:'user.tool_approval', thread_id:approval.threadId, tool_call_id:approval.toolCallId, approval: decision.allow ? {status:'allow'} : {status:'deny',reason:'The test operator rejected this action after reviewing its contents.'} };
    });
  }
  record.status = 'model-turns-finished'; record.assistantText = text;
  record.checkpointId = checkpointId; record.finalStatus = git(['status','--porcelain=v1']); record.diffStat = git(['diff','--stat']);
  await fs.writeFile(path.join(evidence,'changes.patch'),execFileSync('git',['-C',workspaceRoot,'diff','--no-ext-diff'],{encoding:'utf8',windowsHide:true}));
  console.log(`FINISHED ${path.join(evidence,'receipt.json')}`);
}

async function inlineScope(workspace: Workspace, relative: string, symbol: string): Promise<SelectionScope> {
  const file = await workspace.read(relative);
  const start = file.content.indexOf(`def ${symbol}(`);
  if (start < 0) throw new Error('The required selection symbol is missing.');
  const next = /\n(?=(?:def |class |@))/.exec(file.content.slice(start));
  const end = next ? start + next.index + 1 : file.content.length;
  return {path:relative,hash:hash(file.content),start,end};
}
interface Decision { toolCallId: string; allow: boolean; hunks?: Array<{id:string;decision:'accept'|'reject'}> }
async function awaitDecisions(file: string, signal: AbortSignal): Promise<Decision[]> {
  for (;;) {
    if (signal.aborted) throw new Error('Run cancelled while awaiting review.');
    try { const value = JSON.parse(await fs.readFile(file,'utf8')); if (!Array.isArray(value)) throw new Error('Decisions must be a JSON array.'); return value; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    await new Promise(resolve=>setTimeout(resolve,500));
  }
}
main().catch(error=>{record.status=controller.signal.aborted?'cancelled':'failed';record.error=error instanceof Error?error.message:'Acceptance failed.';console.error(record.error);process.exitCode=1;}).finally(async()=>{
  clearTimeout(deadline); tools?.stop();
  if (record.status !== 'model-turns-finished' && client && sessionId) await client.cancel(sessionId).catch(()=>undefined);
  await editor?.close(); record.finishedAt=new Date().toISOString(); await fs.mkdir(evidence,{recursive:true}); await save();
});
