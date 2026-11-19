import { ForgeClient } from '../src/trueforge.js';
import { spawn } from 'node:child_process';
import { createServer, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { startEditorServer } from '../src/mcp-server.js';
import { Workspace } from '../src/core/workspace.js';
import { ContextEngine } from '../src/core/context.js';
import { ProposalManager } from '../src/core/proposals.js';
import { EditorTools } from '../src/tools.js';
import type { ForgeEvent } from '../src/core/types.js';
import type { ApprovalRequest } from '../src/trueforge.js';

/** Read-only harness reachability probe. No model credentials or inferred model calls. */
async function main(): Promise<void> {
  if (process.argv.includes('--integration')) { await integration(); return; }
  const client = new ForgeClient(process.env.TRUEFORGE_BASE_URL ?? 'http://127.0.0.1:8790');
  const health = await client.health();
  const persistentStateExists = await fs.stat(path.resolve(__dirname, '..', '.trueforge', 'db.sqlite')).then(stat => stat.isFile()).catch(() => false);
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), server: client.baseUrl, version: health.version ?? 'unreported', configuredModels: health.models.map(model => model.name), persistentStateExists, runtimeVerified: true, inferenceVerified: false, note: 'This probe reads health and configured model names only. It does not start or stop the harness. Run the extension to prove MCP, review, inference and cancellation.' }, null, 2));
}

/** Real local harness + real MCP/transaction code, driven by a deterministic model fixture.
 * This proves protocol behavior, never live model reasoning or contest-task completion.
 */
async function integration(): Promise<void> {
  const project = path.resolve(__dirname, '..');
  const root = await fs.mkdtemp(path.join(await ensure(path.join(project, 'test-results')), 'harness-spike-'));
  const fixtureRoot = await ensure(path.join(root, 'workspace'));
  await ensure(path.join(fixtureRoot, 'src'));
  const original = 'export const message = "before";\n';
  const changed = 'export const message = "after";\n';
  await fs.writeFile(path.join(fixtureRoot, 'src', 'hello.ts'), original);
  const workspace = new Workspace(fixtureRoot);
  const context = new ContextEngine(workspace);
  const proposals = new ProposalManager(workspace, path.join(root, 'checkpoints'));
  const calls: string[] = [];
  let stagedId = '';
  let checkpointId = '';
  let beforeHash = '';
  const tools = new EditorTools(workspace, context, proposals, { context: () => undefined, proposal: id => { stagedId = id; }, activity: () => undefined, assertWritable: () => undefined, diagnostics: () => [] });
  const abort = new AbortController();
  tools.start({ id: 'spike-run', signal: abort.signal, contextBudget: 6000, performedAction: false });
  const editor = await startEditorServer(async (name, args) => {
    calls.push(name);
    const result = await tools.call(name, args) as Record<string, unknown>;
    if (name === 'read_file') beforeHash = String(result.hash);
    if (name === 'apply_proposal') checkpointId = String(result.checkpointId);
    return result;
  });
  let modelCalls = 0;
  let scenarioStep = 0;
  let scenario: string = 'apply';
  let fixtureStreamClosed = false;
  const expectedEditorTools = ['get_workspace_map', 'search_workspace', 'read_file', 'find_symbols', 'retrieve_context', 'get_diagnostics', 'propose_changes', 'apply_proposal', 'run_command'];
  const observedEagerTools = new Set<string>();
  const model = createServer(async (request, response) => {
    try {
      const buffers: Buffer[] = []; for await (const chunk of request) buffers.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(buffers).toString()) as { model?: string; tools?: Array<{ function: { name: string } }> };
      assert.match(request.url ?? '', /\/chat\/completions$/);
      modelCalls++;
      if (scenario === 'auth-failure' || scenario === 'transient-failure') {
        const status = scenario === 'auth-failure' ? 401 : 503;
        response.writeHead(status, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ error: { message: status === 401 ? 'Fixture invalid API key' : 'Fixture temporary provider outage', type: status === 401 ? 'authentication_error' : 'server_error', code: status === 401 ? 'invalid_api_key' : 'service_unavailable' } }));
        return;
      }
      if (scenario === 'cancel-stream') {
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        response.once('close', () => { fixtureStreamClosed = true; });
        response.write(`data: ${JSON.stringify({ id: 'cancel-fixture', object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'scripted', choices: [{ index: 0, delta: { role: 'assistant', content: 'Fixture generation is waiting.' }, finish_reason: null }] })}\n\n`);
        return; // Keep generation in flight until the harness aborts its actual HTTP request.
      }
      const available = body.tools?.map(tool => tool.function.name) ?? [];
      const name = (wanted: string) => { const match = available.find(tool => tool === wanted || tool.endsWith('_' + wanted)); assert.ok(match, `Fixture needs tool ${wanted}; available=${available.join(',')}`); return match; };
      if (scenario === 'ask' || scenario === 'plan') {
        assert.equal(available.some(tool => /(?:propose_changes|apply_proposal|run_command)$/.test(tool)), false);
        for (const tool of expectedEditorTools.slice(0, 6)) name(tool);
        const step = scenarioStep++;
        modelReply(response, step, step === 0 ? { name: name('read_file'), args: { path: 'src/hello.ts' } } : undefined);
        return;
      }
      if (scenario === 'reviewer') {
        assert.equal(body.model, 'scripted-review');
        assert.equal(available.some(tool => expectedEditorTools.some(name => tool.endsWith(name))), false);
        modelReply(response, scenarioStep++);
        return;
      }
      for (const tool of expectedEditorTools) { name(tool); observedEagerTools.add(tool); }
      const steps: Array<() => { name: string; args: unknown } | undefined> = [
        () => ({ name: name('read_file'), args: { path: 'src/hello.ts' } }),
        () => ({ name: name('propose_changes'), args: { files: [{ path: 'src/hello.ts', beforeHash, edits: [{ oldText: '"before"', newText: '"after"' }] }] } }),
        () => ({ name: name('apply_proposal'), args: { proposalId: stagedId } }),
      ];
      const index = scenarioStep++;
      const step = steps[index]?.();
      modelReply(response, index, step);
    } catch (error) { response.writeHead(500, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ error: { message: error instanceof Error ? error.message : 'Fixture failed' } })); }
  });
  model.listen(0, '127.0.0.1'); await once(model, 'listening');
  const modelAddress = model.address(); assert.ok(modelAddress && typeof modelAddress !== 'string');
  // Reserve an available port briefly; never take over another process's listener.
  const reserve = createServer(); reserve.listen(0, '127.0.0.1'); await once(reserve, 'listening');
  const harnessAddress = reserve.address(); assert.ok(harnessAddress && typeof harnessAddress !== 'string');
  await new Promise<void>(resolve => reserve.close(() => resolve()));
  const harnessUrl = `http://127.0.0.1:${harnessAddress.port}`;
  const child = spawn(process.execPath, [path.join(project, 'node_modules', '@truefoundry', 'trueforge', 'dist', 'cli.js'), '--port', String(harnessAddress.port)], {
    cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, STANDALONE: 'true', HOST: '127.0.0.1', SQLITE_PATH: path.join(root, 'db.sqlite'), LOCALAPPDATA: root, APPDATA: root, OUTBOUND_URL_ALLOWED_HOSTS: '["127.0.0.1"]', MODEL_HTTP_MAX_RETRIES: '2', LOG_LEVEL: 'warn', ACCESS_LOGS: 'false', SENTRY_DSN: '', POSTHOG_API_KEY: '' },
  });
  let log = ''; child.stdout.on('data', data => { log = (log + data.toString()).slice(-2_000_000); }); child.stderr.on('data', data => { log = (log + data.toString()).slice(-2_000_000); });
  const exit = once(child, 'exit');
  try {
    const client = new ForgeClient(harnessUrl);
    let healthy = false;
    const startupDeadline = Date.now() + 120000;
    while (Date.now() < startupDeadline) {
      if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Owned harness exited ${child.exitCode ?? child.signalCode}. ${log.slice(-1800)}`);
      try { await client.health(); healthy = true; break; } catch { await new Promise(resolve => setTimeout(resolve, 300)); }
    }
    assert.ok(healthy, `Harness did not become healthy. ${log.slice(-1800)}`);
    const models = ['scripted', 'scripted-review'].map(name => ({ name, model_id: name, properties: { context_length: 32768, max_output_tokens: 4096 } }));
    const configured = await fetch(`${harnessUrl}/api/v1/settings/model-providers`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ manifest: { type: 'custom', name: 'spike-fixture', base_url: `http://127.0.0.1:${modelAddress.port}/v1`, models } }) });
    assert.equal(configured.status, 201, await configured.text());
    await client.registerEditor(editor);
    const sessionId = await client.create('spike-fixture/scripted', editor.name, 'agent', 32768);
    const events: ForgeEvent[] = [];
    const pending: ApprovalRequest[] = [];
    const observe = (event: ForgeEvent) => { events.push(event); if (event.type === 'tool.approval_required') pending.push(...event.approval_requests as ApprovalRequest[]); };
    await client.turn(sessionId, [{ type: 'user.message', content: 'Use the editor tools to change the greeting from before to after. This is a deterministic protocol fixture.' }], observe);
    assert.equal(pending.length, 1, `Expected one real harness approval, saw ${pending.length}. ${JSON.stringify(events.slice(-4))}`);
    assert.equal(await fs.readFile(path.join(fixtureRoot, 'src', 'hello.ts'), 'utf8'), original, 'Staging must not write source.');
    const approval = pending[0]!;
    assert.equal(approval.name, 'apply_proposal'); assert.equal(approval.serverName, editor.name); assert.equal(approval.args.proposalId, stagedId);
    const proposal = proposals.get(stagedId);
    for (const file of proposal.files) for (const hunk of file.hunks) proposals.decide(proposal.id, hunk.id, 'accept');
    tools.authorize(approval.name, approval.args, approval.toolCallId);
    await client.turn(sessionId, [{ type: 'user.tool_approval', thread_id: approval.threadId, tool_call_id: approval.toolCallId, approval: { status: 'allow' } }], observe);
    assert.equal(await fs.readFile(path.join(fixtureRoot, 'src', 'hello.ts'), 'utf8'), changed);
    assert.ok(checkpointId && checkpointId !== 'undefined', 'Actual apply must return a checkpoint.');
    const restored = await proposals.undo(checkpointId);
    assert.deepEqual(restored.conflicts, []);
    assert.equal(await fs.readFile(path.join(fixtureRoot, 'src', 'hello.ts'), 'utf8'), original);

    const scenarioReceipts: Array<Record<string, unknown>> = [];
    const reset = (name: string) => {
      tools.stop(); scenario = name; scenarioStep = 0; stagedId = ''; beforeHash = '';
      const controller = new AbortController();
      tools.start({ id: `spike-${name}`, signal: controller.signal, contextBudget: 6000, performedAction: false, readOnly: name === 'ask' || name === 'plan' || name === 'reviewer' });
      return controller;
    };
    const stageScenario = async (name: string) => {
      reset(name);
      const id = await client.create('spike-fixture/scripted', editor.name, 'agent', 32768);
      const approvals: ApprovalRequest[] = [];
      await client.turn(id, [{ type: 'user.message', content: `Stage the deterministic ${name} fixture edit for review.` }], event => { events.push(event); if (event.type === 'tool.approval_required') approvals.push(...event.approval_requests as ApprovalRequest[]); });
      assert.equal(approvals.length, 1);
      assert.equal(await fs.readFile(path.join(fixtureRoot, 'src', 'hello.ts'), 'utf8'), original);
      return { id, approval: approvals[0]!, proposal: proposals.get(stagedId) };
    };

    const deny = await stageScenario('deny');
    const appliedBeforeDeny = calls.filter(name => name === 'apply_proposal').length;
    for (const file of deny.proposal.files) for (const hunk of file.hunks) proposals.decide(deny.proposal.id, hunk.id, 'reject');
    await client.turn(deny.id, [{ type: 'user.tool_approval', thread_id: deny.approval.threadId, tool_call_id: deny.approval.toolCallId, approval: { status: 'deny', reason: 'Fixture user rejected every hunk.' } }], observe);
    assert.equal(calls.filter(name => name === 'apply_proposal').length, appliedBeforeDeny, 'Harness denial must not execute the MCP mutation.');
    await assert.rejects(tools.call('apply_proposal', deny.approval.args), /approval/);
    assert.equal(await fs.readFile(path.join(fixtureRoot, 'src', 'hello.ts'), 'utf8'), original);
    scenarioReceipts.push({ name: 'deny', sessionId: deny.id, sourceUnchanged: true, harnessSkippedMcpMutation: true, lateUnapprovedApplyRejected: true });

    const pendingCancel = await stageScenario('cancel-pending');
    for (const file of pendingCancel.proposal.files) for (const hunk of file.hunks) proposals.decide(pendingCancel.proposal.id, hunk.id, 'accept');
    // Exercise the race: a legitimate local grant exists, then Stop revokes it before delivery.
    tools.authorize(pendingCancel.approval.name, pendingCancel.approval.args, pendingCancel.approval.toolCallId);
    tools.stop();
    await client.cancel(pendingCancel.id);
    await assert.rejects(tools.call('apply_proposal', pendingCancel.approval.args), /No active editor run/);
    let lateResumeError: string | undefined;
    try { await client.turn(pendingCancel.id, [{ type: 'user.tool_approval', thread_id: pendingCancel.approval.threadId, tool_call_id: pendingCancel.approval.toolCallId, approval: { status: 'allow' } }], observe); }
    catch (error) { lateResumeError = error instanceof Error ? error.message : 'Late resume rejected'; }
    assert.equal(await fs.readFile(path.join(fixtureRoot, 'src', 'hello.ts'), 'utf8'), original);
    assert.equal(proposals.get(pendingCancel.proposal.id).state, 'expired');
    scenarioReceipts.push({ name: 'cancel-pending', sessionId: pendingCancel.id, sourceUnchanged: true, existingGrantRevoked: true, lateApplyRejected: true, lateResumeError });

    const streamingAbort = reset('cancel-stream');
    const streamingSession = await client.create('spike-fixture/scripted', editor.name, 'agent', 32768);
    let sawStreamingToken = false;
    await assert.rejects(client.turn(streamingSession, [{ type: 'user.message', content: 'Stream until cancelled in the deterministic fixture.' }], event => {
      events.push(event);
      if (event.type === 'model.message.delta' && typeof event.content === 'string' && event.content.includes('waiting')) { sawStreamingToken = true; tools.stop(); streamingAbort.abort(); }
    }, streamingAbort.signal), /cancelled/i);
    const cancelledTurn = await client.getTurnStatus(streamingSession);
    assert.equal((cancelledTurn.state as Record<string, unknown>).status, 'cancelled');
    for (let attempt = 0; attempt < 20 && !fixtureStreamClosed; attempt++) await new Promise(resolve => setTimeout(resolve, 100));
    assert.ok(sawStreamingToken && fixtureStreamClosed, 'The real harness must stream a token and abort the model HTTP stream.');
    assert.equal(await fs.readFile(path.join(fixtureRoot, 'src', 'hello.ts'), 'utf8'), original);
    scenarioReceipts.push({ name: 'cancel-stream', sessionId: streamingSession, tokenObservedBeforeStop: true, persistedTurnStatus: 'cancelled', modelHttpStreamClosed: true, sourceUnchanged: true });

    for (const name of ['auth-failure', 'transient-failure']) {
      reset(name);
      const id = await client.create('spike-fixture/scripted', editor.name, 'agent', 32768);
      let terminalState: unknown;
      let surfacedError = '';
      const beforeCalls = modelCalls;
      try { await client.turn(id, [{ type: 'user.message', content: 'Exercise a deterministic provider error.' }], event => { events.push(event); if (event.type === 'turn.done') terminalState = event.state; }); }
      catch (error) { surfacedError = error instanceof Error ? error.message : String(error); }
      assert.equal((terminalState as Record<string, unknown>).status, 'error');
      assert.ok(surfacedError.includes('TrueForge model failed'));
      assert.equal(modelCalls - beforeCalls, name === 'auth-failure' ? 1 : 3, '401 must not retry; 503 must use the configured two retries.');
      assert.equal(await fs.readFile(path.join(fixtureRoot, 'src', 'hello.ts'), 'utf8'), original);
      scenarioReceipts.push({ name, sessionId: id, upstreamFixtureStatus: name === 'auth-failure' ? 401 : 503, providerRequests: modelCalls - beforeCalls, terminalState, surfacedError, sourceUnchanged: true });
    }
    for (const mode of ['ask', 'plan', 'reviewer'] as const) {
      reset(mode);
      const reviewer = mode === 'reviewer';
      const modelName = reviewer ? 'spike-fixture/scripted-review' : 'spike-fixture/scripted';
      const id = await client.create(modelName, reviewer ? '' : editor.name, mode, 32768, '', 512);
      const initialCalls = calls.length;
      let finished = false;
      await client.turn(id, [{ type: 'user.message', content: 'Exercise a read-only workflow using the deterministic fixture.' }], event => {
        events.push(event);
        if (event.type === 'turn.done') finished = (event.state as {status?: string}).status === 'done';
      });
      assert.ok(finished, `${mode} must complete through the real harness.`);
      assert.deepEqual(calls.slice(initialCalls), reviewer ? [] : ['read_file']);
      assert.equal(await fs.readFile(path.join(fixtureRoot, 'src', 'hello.ts'), 'utf8'), original);
      scenarioReceipts.push({ name: mode, sessionId: id, model: modelName, workspaceCalls: calls.slice(initialCalls), sourceUnchanged: true });
    }
    const health = await client.health();
    assert.deepEqual([...observedEagerTools].sort(), [...expectedEditorTools].sort(), 'All nine editor tools must be exposed directly to the fixture model.');
    const receipt = { checkedAt: new Date().toISOString(), fixture: 'Deterministic OpenAI-compatible protocol fixture; no real model inference.', harnessVersion: health.version, sessionId, harnessUrl, sessionUrl: client.sessionUrl(sessionId), storage: root, modelCalls, editorCalls: calls, eagerEditorTools: [...observedEagerTools].sort(), eventTypes: [...new Set(events.map(event => event.type))], assertions: { realHarness: true, realMcpRead: calls.includes('read_file'), privateStaging: true, trueForgeApproval: true, eagerEditorToolExposure: observedEagerTools.size === expectedEditorTools.length, reviewedApply: true, checkpointUndo: true, deniedApplySkipped: true, cancelledGrantRevoked: true, streamingCancellation: true, authenticationFailure: true, transientFailure: true, readOnlyAsk: true, readOnlyPlan: true, independentToolFreeReviewer: true }, scenarios: scenarioReceipts, liveModelReasoningVerified: false };
    await fs.writeFile(path.join(project, 'test-results', 'trueforge-spike.json'), JSON.stringify(receipt, null, 2) + '\n');
    console.log(JSON.stringify(receipt, null, 2));
  } finally {
    tools.stop(); await editor.close(); model.closeAllConnections(); await new Promise<void>(resolve => model.close(() => resolve()));
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await Promise.race([exit, new Promise(resolve => setTimeout(resolve, 5000))]);
    await fs.writeFile(path.join(root, 'harness.log'), log);
    if (child.exitCode === null && child.signalCode === null) throw new Error('Owned harness cleanup did not finish.');
  }
}
async function ensure(directory: string): Promise<string> { await fs.mkdir(directory, { recursive: true }); return directory; }
function modelReply(response: ServerResponse, index: number, tool?: { name: string; args: unknown }): void {
  response.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const chunk = (delta: unknown, finish: string | null) => ({ id: `fixture-${index}`, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'scripted', choices: [{ index: 0, delta, finish_reason: finish }] });
  const delta = tool ? { role: 'assistant', tool_calls: [{ index: 0, id: `fixture-call-${index}`, type: 'function', function: { name: tool.name, arguments: JSON.stringify(tool.args) } }] } : { role: 'assistant', content: 'The deterministic fixture observed the approved editor operation.' };
  response.write(`data: ${JSON.stringify(chunk(delta, null))}\n\n`);
  response.write(`data: ${JSON.stringify(chunk({}, tool ? 'tool_calls' : 'stop'))}\n\n`);
  response.end('data: [DONE]\n\n');
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Harness probe failed.'); process.exitCode = 1; });
