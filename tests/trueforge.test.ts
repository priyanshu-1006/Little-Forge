import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { agentSpec, approvalRequests, consumeSse, ForgeClient, ForgeError, httpRetryHint, indexForgeEvent, providerRetryHint, recoveryFailure } from '../src/trueforge.js';
import { MAX_RETRY_DELAY_MS, recoveryAction } from '../src/core/resilience.js';
import type { ForgeEvent } from '../src/core/types.js';

type Handler = (request: IncomingMessage, response: ServerResponse, body: Record<string, unknown>) => void | Promise<void>;
async function fixture(handler: Handler, run: (client: ForgeClient) => Promise<void>): Promise<void> {
  const server = createServer(async (request, response) => {
    const bytes: Buffer[] = [];
    for await (const chunk of request) bytes.push(Buffer.from(chunk));
    const body = bytes.length ? JSON.parse(Buffer.concat(bytes).toString()) as Record<string, unknown> : {};
    try { await handler(request, response, body); } catch (error) { response.statusCode = 500; response.end(String(error)); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  try { await run(new ForgeClient(`http://127.0.0.1:${address.port}`)); }
  finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}
function json(response: ServerResponse, value: unknown, code = 200): void { response.writeHead(code, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(value)); }
function sse(response: ServerResponse, events: Array<[number, ForgeEvent]>): void {
  response.writeHead(200, { 'Content-Type': 'text/event-stream' });
  for (const [id, event] of events) response.write(`id: ${id}\r\ndata: ${JSON.stringify(event)}\r\n\r\n`);
  response.end();
}
const created: ForgeEvent = { type: 'turn.created', id: 'created', turn_id: 'turn1', thread_id: null, state: { status: 'running' } };
const done: ForgeEvent = { type: 'turn.done', id: 'done', state: { status: 'done', output: null } };
const prompt = [{ type: 'user.message', content: 'Explain the change.' }];

test('uses actual health/model endpoints and registers a new header-auth connector without overwriting settings', async () => {
  let registrations = 0;
  await fixture((request, response, body) => {
    if (request.url === '/healthz') return json(response, { status: 'ok', version: '0.180.1' });
    if (request.url === '/api/v1/models') return json(response, { data: [{ name: 'local/tool-model', properties: { context_length: 32768 } }] });
    assert.equal(request.url, '/api/v1/settings/mcp-servers'); assert.equal(request.method, 'POST'); registrations++;
    const manifest = body.manifest as Record<string, unknown>;
    assert.equal(manifest.name, 'little-test'); assert.equal(manifest.type, 'remote'); assert.equal(manifest.url, 'http://127.0.0.1:9876/mcp');
    assert.deepEqual(manifest.auth, { type: 'header', headers: { Authorization: 'Bearer 12345678901234567890123456789012' } });
    json(response, { data: { name: manifest.name } }, 201);
  }, async client => {
    assert.deepEqual(await client.health(), { models: [{ name: 'local/tool-model' }], version: '0.180.1' });
    const binding = { name: 'little-test', url: 'http://127.0.0.1:9876/mcp', token: '12345678901234567890123456789012' };
    await client.registerEditor(binding); await client.registerEditor(binding); assert.equal(registrations, 1);
  });
});

test('refuses nonlocal and credential-bearing URLs, redirects and binding collisions', async () => {
  for (const url of ['https://127.0.0.1:8790', 'http://example.com', 'http://127.0.0.1:8790/unsafe', 'http://user:pass@localhost:8790', 'http://127.0.0.1:8790?token=secret']) assert.throws(() => new ForgeClient(url), ForgeError);
  await fixture((_request, response) => json(response, { error: { message: 'secret-must-not-be-echoed' } }, 409), async client => {
    await assert.rejects(client.registerEditor({ name: 'collision', url: 'http://127.0.0.1:1234/mcp', token: '12345678901234567890123456789012' }), error => error instanceof ForgeError && error.status === 409 && !error.message.includes('secret-must'));
  });
  await fixture((_request, response) => { response.writeHead(302, { Location: 'http://example.com/receive' }); response.end(); }, async client => { await assert.rejects(client.health(), /Cannot reach TrueForge/); });
});

test('creates provider-independent inline specs and streams original wire events', async () => {
  await fixture((request, response, body) => {
    if (request.url === '/api/v1/sessions') {
      const spec = (body.agent as { spec: Record<string, unknown> }).spec;
      assert.deepEqual(spec.model, { name: 'any-provider/tool-model', params: { max_tokens: 8192 } });
      const connector = (spec.mcp_servers as Array<Record<string, unknown>>)[0];
      assert.deepEqual(connector.require_approval_for_tools, ['apply_proposal', 'run_command']);
      assert.equal(connector.preload, true);
      assert.equal(Object.hasOwn(connector, 'preload_tools'), false);
      json(response, { data: { id: 'session1' } }, 201); return;
    }
    assert.equal(request.url, '/api/v1/sessions/session1/turns');
    assert.deepEqual(body, { input: prompt, stream: true, previous_turn_id: 'auto' });
    sse(response, [[1, created], [2, { type: 'model.message', id: 'msg', thread_id: 'main', content: '' }], [3, { type: 'model.message.delta', id: 'msg', thread_id: 'main', content: 'hello' }], [4, done]]);
  }, async client => {
    const id = await client.create('any-provider/tool-model', 'little-test', 'agent', 32768);
    const events: ForgeEvent[] = []; await client.turn(id, prompt, event => events.push(event));
    assert.deepEqual(events.map(event => event.type), ['turn.created', 'model.message', 'model.message.delta', 'turn.done']);
    assert.equal(events[2].content, 'hello'); assert.match(client.sessionUrl(id), /\/sessions\/session1$/);
  });
  const inline = agentSpec('other/model', 'binding', 'inline', 8192);
  assert.ok(!(inline.mcp_servers as Array<{ enable_tools: string[] }>)[0].enable_tools.includes('run_command'));
  const config = inline.config as Record<string, { enabled?: boolean }>;
  for (const name of ['sandbox', 'dynamic_sub_agents', 'generative_ui', 'ask_user_questions']) assert.equal(config[name].enabled, false);
});

test('optional reasoning effort reaches the pinned harness wire schema without changing provider defaults', async () => {
  const { AgentSpecSchema } = await import('@truefoundry/trueforge-core/agent-session');
  const spec=AgentSpecSchema.parse(agentSpec('configured/model','editor','agent',32768,'medium'));
  assert.equal(spec.model.params?.reasoning_effort,'medium');
  let requests=0;
  await fixture((request,response,body)=>{
    requests++; assert.equal(request.url,'/api/v1/sessions');
    assert.deepEqual((body.agent as {spec:{model:unknown}}).spec.model,{name:'configured/model',params:{max_tokens:8192,reasoning_effort:'medium'}});
    json(response,{data:{id:'reasoning-session'}},201);
  },async client=>{
    assert.equal(await client.create('configured/model','editor','agent',32768,'medium'),'reasoning-session');
    await assert.rejects(client.create('configured/model','editor','agent',32768,'unsupported'),/Reasoning effort/);
  });
  assert.equal(requests,1);
  assert.equal(Object.hasOwn((agentSpec('configured/model','editor','agent',32768).model as {params:object}).params,'reasoning_effort'),false);
});

test('official pinned schema/runtime eagerly exposes allowed tools while preserving apply/command approval', async () => {
  const { AgentSpecSchema } = await import('@truefoundry/trueforge-core/agent-session');
  const { ToolSet } = await import('@truefoundry/trueforge-core/core');
  const names = ['get_workspace_map', 'search_workspace', 'read_file', 'find_symbols', 'retrieve_context', 'get_diagnostics', 'propose_changes', 'apply_proposal', 'run_command'];
  for (const mode of ['inline', 'agent'] as const) {
    const spec = AgentSpecSchema.parse(agentSpec('local/model', 'editor', mode, 32768));
    const entry = spec.mcp_servers![0]!;
    let calls = 0;
    const tools = new ToolSet({
      source: {
        id: 'editor', name: 'editor',
        async listTools() { return { result: { tools: [...names, 'unexpected_tool'].map(name => ({ name, inputSchema: { type: 'object' as const, properties: {} }, annotations: { readOnlyHint: true }, preload: false })) }, wasInitialized: undefined }; },
        async toolCallInfo(params) { return { type: 'mcp' as const, mcp_server_id: 'editor', mcp_server_name: 'editor', original_tool_name: params.name }; },
        async callTool() { calls++; return { result: { content: [] }, wasInitialized: undefined }; },
      },
      selectors: { enableTools: entry.enable_tools, disableTools: entry.disable_tools, preloadTools: entry.preload_tools, requireApprovalForTools: entry.require_approval_for_tools },
      preload: entry.preload, approvalPolicies: undefined,
    });
    const listed = await tools.listTools(); assert.ok('result' in listed);
    assert.equal(tools.preload, true); assert.equal(tools.hasPreloadedTools, true);
    assert.deepEqual(listed.result.tools.map(tool => tool.name), mode === 'agent' ? names : names.filter(name => name !== 'run_command'));
    assert.ok(listed.result.tools.every(tool => tool.preload));
    assert.equal((await tools.toolCallInfo({ name: 'read_file' })).is_approval_required, false);
    assert.ok('approvalRequired' in await tools.callTool({ name: 'apply_proposal', arguments: { proposalId: 'p' } }));
    if (mode === 'agent') assert.ok('approvalRequired' in await tools.callTool({ name: 'run_command', arguments: { task: 'pytest' } }));
    assert.equal(calls, 0);
    await assert.rejects(tools.callTool({ name: 'unexpected_tool' }), /not allowed/);
  }
  for (const mode of ['ask', 'plan'] as const) {
    const spec = AgentSpecSchema.parse(agentSpec('local/model', 'editor', mode, 32768));
    assert.deepEqual(spec.mcp_servers![0].enable_tools, names.slice(0, 6));
    assert.deepEqual(spec.mcp_servers![0].require_approval_for_tools, []);
  }
  const reviewer = AgentSpecSchema.parse(agentSpec('different/model', '', 'reviewer', 32768, '', 500));
  assert.deepEqual(reviewer.mcp_servers, []);
  assert.equal(reviewer.model.params?.max_tokens, 500);
});

test('SSE handles byte-split UTF-8, comments and multiline JSON; rejects incomplete or oversized frames', async () => {
  const source = Buffer.from(': heartbeat\r\nid: 7\r\ndata: {"type":"model.message.delta",\r\ndata: "content":"नमस्ते"}\r\n\r\n');
  const events: ForgeEvent[] = [];
  const stream = new ReadableStream<Uint8Array>({ start(controller) { for (const byte of source) controller.enqueue(Uint8Array.of(byte)); controller.close(); } });
  await consumeSse(new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } }), (event, sequence) => { assert.equal(sequence, 7); events.push(event); });
  assert.equal(events[0].content, 'नमस्ते');
  await assert.rejects(consumeSse(new Response('data: {"type":"turn.done"}', { headers: { 'Content-Type': 'text/event-stream' } }), () => undefined), /incomplete frame/);
  await assert.rejects(consumeSse(new Response('data: broken\n\n', { headers: { 'Content-Type': 'text/event-stream' } }), () => undefined), /malformed event JSON/);
  await assert.rejects(consumeSse(new Response('x'.repeat(2 * 1024 * 1024 + 1), { headers: { 'Content-Type': 'text/event-stream' } }), () => undefined), /size limit/);
});

test('resolves fragmented direct and deferred MCP approvals using real source event refs', () => {
  const events = new Map<string, ForgeEvent>();
  indexForgeEvent(events, { type: 'model.message', id: 'msg', thread_id: 'main' });
  indexForgeEvent(events, { type: 'model.message.delta', id: 'msg', tool_calls: [{ index: 0, id: 'call1', function: { name: 'call_tool', arguments: '{"mcp_server":"editor","tool_name":"apply_proposal",' }, tool_info: { type: 'mcp', server_name: 'editor', name: 'apply_proposal' } }] });
  indexForgeEvent(events, { type: 'model.message.delta', id: 'msg', tool_calls: [{ index: 0, function: { arguments: '"input":{"proposalId":"p1"}}' } }] });
  const approval: ForgeEvent = { type: 'tool.approval_required', thread_id: 'main', tool_calls: [{ id: 'call1', source_event_id: 'msg' }] };
  assert.deepEqual(approvalRequests(approval, events), [{ toolCallId: 'call1', threadId: 'main', name: 'apply_proposal', args: { proposalId: 'p1' }, serverName: 'editor' }]);
  assert.throws(() => approvalRequests({ ...approval, thread_id: 'other' }, events), /source was not observed/);
  assert.throws(() => approvalRequests({ ...approval, tool_calls: [{ id: 'unknown', source_event_id: 'msg' }] }, events), /not observed/);
  indexForgeEvent(events, { type: 'model.message', id: 'direct', thread_id: 'main', tool_calls: [{ id: 'call2', function: { name: 'editor_run_command', arguments: '{"task":"pytest"}' }, tool_info: { type: 'mcp', server_name: 'editor', name: 'run_command' } }] });
  assert.equal(approvalRequests({ ...approval, tool_calls: [{ id: 'call2', source_event_id: 'direct' }] }, events)[0].name, 'run_command');
  const actualRuntime = structuredClone(events.get('msg')!);
  (actualRuntime.tool_calls as Array<Record<string, unknown>>)[0].tool_info = { type: 'truefoundry-system', name: 'call_tool' };
  events.set('msg', actualRuntime);
  assert.equal(approvalRequests(approval, events)[0].serverName, 'editor');
});

test('accepts paused turn.update and carries normalized approval refs; resume uses a separate turn input', async () => {
  let requests = 0;
  await fixture((_request, response, body) => {
    requests++;
    if (requests === 1) {
      sse(response, [[1, created], [2, { type: 'model.message', id: 'm1', thread_id: 'main', tool_calls: [{ id: 'c1', function: { name: 'apply_proposal', arguments: '{"proposalId":"p"}' }, tool_info: { type: 'mcp', name: 'apply_proposal', server_name: 'editor' } }] }], [3, { type: 'tool.approval_required', id: 'approval1', thread_id: 'main', tool_calls: [{ id: 'c1', source_event_id: 'm1' }] }], [4, { type: 'turn.update', id: 'pause1', state: { status: 'paused' } }]]); return;
    }
    assert.deepEqual(body.input, [{ type: 'user.tool_approval', thread_id: 'main', tool_call_id: 'c1', approval: { status: 'deny', reason: 'Rejected by user' } }]);
    sse(response, [[1, created], [2, done]]);
  }, async client => {
    const observed: ForgeEvent[] = []; await client.turn('session', prompt, event => observed.push(event));
    assert.equal((observed.find(event => event.type === 'tool.approval_required')?.approval_requests as Array<{ name: string }>)[0].name, 'apply_proposal');
    await client.turn('session', [{ type: 'user.tool_approval', thread_id: 'main', tool_call_id: 'c1', approval: { status: 'deny', reason: 'Rejected by user' } }], () => undefined);
    await assert.rejects(client.turn('session', [...prompt, { type: 'user.tool_approval' }], () => undefined), /Do not mix/);
  });
});

test('disconnect reconciliation inspects and subscribes without posting the original request twice', async () => {
  let posts = 0;
  await fixture((request, response) => {
    if (request.method === 'POST') { posts++; sse(response, [[1, created]]); return; }
    if (request.url?.endsWith('/turns/turn1')) return json(response, { data: { id: 'turn1', state: { status: 'running' } } });
    assert.match(request.url ?? '', /\/subscribe\?after_sequence_number=1$/);
    sse(response, [[1, created], [2, done]]);
  }, async client => {
    const events: ForgeEvent[] = []; await client.turn('session', prompt, event => events.push(event));
    assert.equal(posts, 1); assert.deepEqual(events.map(event => event.type), ['turn.created', 'turn.done']);
  });
});

test('abort cancels server execution separately and suppresses subsequent events', async () => {
  let cancels = 0;
  await fixture((request, response) => {
    if (request.url?.endsWith('/cancel')) { cancels++; json(response, {}); return; }
    response.writeHead(200, { 'Content-Type': 'text/event-stream' }); response.write(`id: 1\ndata: ${JSON.stringify(created)}\n\n`);
  }, async client => {
    const controller = new AbortController(); const events: ForgeEvent[] = [];
    await assert.rejects(client.turn('session', prompt, event => { events.push(event); controller.abort(); }, controller.signal), /cancelled/);
    assert.equal(cancels, 1); assert.equal(events.length, 1);
  });
});

test('remote cancellation rejects a terminal wire event without claiming completion or replaying', async () => {
  let posts = 0; let cancels = 0;
  await fixture((request, response) => {
    if (request.url?.endsWith('/cancel')) { cancels++; json(response, {}); return; }
    assert.equal(request.method, 'POST'); posts++;
    sse(response, [[1, created], [2, { type: 'turn.done', state: { status: 'cancelled', completed_at: '2026-10-30T18:00:00.000Z' } }]]);
  }, async client => {
    const controller = new AbortController(); const events: ForgeEvent[] = [];
    await assert.rejects(client.turn('session', prompt, event => events.push(event), controller.signal), error => {
      assert.ok(error instanceof ForgeError); assert.match(error.message, /Run cancelled in TrueForge/);
      assert.equal(error.status, undefined); assert.equal(error.ambiguous, true);
      assert.deepEqual(recoveryAction({ definitive: !error.ambiguous, transient: true, sideEffects: false, pendingReview: false, approvalResume: false, retries: 0, fallbackUsed: false, currentModel: 'a/model', fallbackModel: 'b/model' }), { type: 'stop' });
      return true;
    });
    assert.equal(controller.signal.aborted, false); assert.equal(posts, 1); assert.equal(cancels, 0);
    assert.deepEqual(events.map(event => event.type), ['turn.created', 'turn.done']);
  });
});

test('remote cancellation discovered through durable reconciliation also rejects without resubmitting', async () => {
  let posts = 0; let gets = 0;
  await fixture((request, response) => {
    if (request.method === 'POST') { posts++; sse(response, [[1, created]]); return; }
    assert.match(request.url ?? '', /\/turns\/turn1$/); gets++;
    json(response, { data: { id: 'turn1', state: { status: 'cancelled' } } });
  }, async client => {
    const events: ForgeEvent[] = [];
    await assert.rejects(client.turn('session', prompt, event => events.push(event)), error => error instanceof ForgeError && error.ambiguous && /cancelled in TrueForge/.test(error.message));
    assert.equal(posts, 1); assert.equal(gets, 1);
    assert.equal(events.at(-1)?.recovered, true); assert.equal((events.at(-1)?.state as { status: string }).status, 'cancelled');
  });
});

test('terminal model error is useful and redacted; HTTP errors never echo arbitrary bodies', async () => {
  await fixture((_request, response) => sse(response, [[1, created], [2, { type: 'turn.done', state: { status: 'error', message: '[Model Error] Request failed (401): Invalid key Bearer sk-super-secret-value-1234567890' } }]]), async client => {
    const observed: ForgeEvent[] = [];
    await assert.rejects(client.turn('session', prompt, event => observed.push(event)), error => error instanceof ForgeError && error.status === 401 && error.message.includes('[redacted]') && !error.message.includes('super-secret'));
    assert.ok(!JSON.stringify(observed).includes('super-secret'));
  });
  await fixture((_request, response) => json(response, { error: { message: 'sk-do-not-display-this-ever-123456' } }, 401), async client => {
    await assert.rejects(client.health(), error => error instanceof ForgeError && error.status === 401 && !error.message.includes('do-not-display'));
  });
});

test('a terminal provider reset can retry/fall back while unknown delivery and side effects stay blocked', async () => {
  await fixture((_request,response)=>sse(response,[[1,created],[2,{type:'turn.done',state:{status:'error',message:'[Model Error] Cannot connect to API: read ECONNRESET'}}]]),async client=>{
    await assert.rejects(client.turn('session',prompt,()=>undefined),error=>{
      assert.ok(error instanceof ForgeError);
      const context={...recoveryFailure(error),sideEffects:false,pendingReview:false,approvalResume:false,retries:2,fallbackUsed:false,currentModel:'a/model',fallbackModel:'b/model'};
      assert.deepEqual(recoveryAction(context),{type:'fallback',model:'b/model'});
      assert.deepEqual(recoveryAction({...context,retries:0}),{type:'retry',delay:1000});
      for(const unsafe of [{sideEffects:true},{pendingReview:true},{approvalResume:true}]) assert.deepEqual(recoveryAction({...context,...unsafe}),{type:'stop'});
      assert.deepEqual(recoveryAction({...context,...recoveryFailure(new ForgeError(error.message,undefined,true))}),{type:'stop'});
      return true;
    });
  });
  assert.deepEqual(recoveryFailure(new Error('ECONNRESET')),{definitive:false,transient:false});
});

test('retry hints parse actual fractional seconds exactly and reject malformed or overlong waits safely', () => {
  assert.deepEqual(providerRetryHint('Quota exceeded. Please retry in 55.856552065s.'), { retryAfterMs: 55_857 });
  assert.deepEqual(providerRetryHint('Please retry in 55.000000000000000001s.'), { retryAfterMs: 55_001 });
  assert.deepEqual(providerRetryHint('retry in 0s; retry in 2 seconds.'), { retryAfterMs: 2000 });
  assert.deepEqual(providerRetryHint('retry in 120s.'), { retryAfterMs: MAX_RETRY_DELAY_MS });
  for (const hint of ['120.0001s', '86400s', '9'.repeat(400) + 's']) assert.deepEqual(providerRetryHint(`Please retry in ${hint}.`), { retryAfterTooLong: true });
  for (const hint of ['-5s', '+5s', 'NaNs', 'Infinitys', '0x10s', '1e9s', '5ms', '55garbage']) assert.deepEqual(providerRetryHint(`Please retry in ${hint}.`), {});
  assert.deepEqual(providerRetryHint('Daily quota exhausted. Check your account quota.'), {});
  assert.deepEqual(providerRetryHint('retry in 56s. Another limit: retry in 60s.'), { retryAfterMs: 60_000 });
});

test('explicit compound daily quota waits stop recovery instead of falling back to short retries', () => {
  assert.deepEqual(providerRetryHint('Please retry in 8h37m11.125265746s.'), {retryAfterTooLong:true});
  assert.deepEqual(providerRetryHint('Please retry in 1m 0.0005s.'), {retryAfterMs:60001});
  assert.deepEqual(providerRetryHint('Please retry in 2m0s.'), {retryAfterMs:120000});
  assert.deepEqual(providerRetryHint('Please retry in 2m0.0001s.'), {retryAfterTooLong:true});
  assert.deepEqual(providerRetryHint('Please retry in 999999999999h0m0s.'), {retryAfterTooLong:true});
  assert.deepEqual(providerRetryHint('Please retry in 1m -2s.'), {});
  const hint = providerRetryHint('Please retry in 8h37m11.125265746s.');
  assert.deepEqual(recoveryAction({definitive:true,transient:true,rateLimited:true,sideEffects:false,pendingReview:false,approvalResume:false,retries:0,fallbackUsed:false,currentModel:'a/model',fallbackModel:'b/model',...hint}),{type:'stop'});
});

test('HTTP Retry-After supports seconds and strict dates without guessing malformed daily resets', () => {
  const now = Date.UTC(2026, 9, 30, 12, 0, 0);
  assert.deepEqual(httpRetryHint(' 55.856552065 ', now), { retryAfterMs: 55_857 });
  assert.deepEqual(httpRetryHint('Fri, 30 Oct 2026 12:01:00 GMT', now), { retryAfterMs: 60_000 });
  assert.deepEqual(httpRetryHint('Fri, 30 Oct 2026 11:59:00 GMT', now), { retryAfterMs: 0 });
  assert.deepEqual(httpRetryHint('Sat, 31 Oct 2026 12:00:00 GMT', now), { retryAfterTooLong: true });
  assert.deepEqual(httpRetryHint('9'.repeat(400), now), { retryAfterTooLong: true });
  for (const header of [null, '', '-1', 'NaN', 'Infinity', '1e3', 'tomorrow', 'Fri, 31 Feb 2026 12:00:00 GMT', 'Thu, 30 Oct 2026 12:01:00 GMT']) assert.deepEqual(httpRetryHint(header, now), {});
});

test('nested429 delay survives display truncation and later events while errors remain redacted', async () => {
  const message = '[Model Error] Request failed (429): Bearer gsk-secret-value-that-must-not-leak. ' + 'quota detail '.repeat(65) + 'Please retry in 55.856552065s.';
  await fixture((_request, response) => sse(response, [[1, created], [2, { type: 'turn.update', state: { status: 'error', message } }], [3, { type: 'usage.observation', id: 'usage-only' }], [4, { type: 'turn.done', state: { status: 'error' } }]]), async client => {
    const events: ForgeEvent[] = [];
    await assert.rejects(client.turn('session', prompt, event => events.push(event)), error => {
      assert.ok(error instanceof ForgeError);
      assert.equal(error.status, 429); assert.equal(error.retryAfterMs, 55_857); assert.equal(error.retryAfterTooLong, false);
      assert.deepEqual(recoveryAction({ definitive: !error.ambiguous, transient: true, sideEffects: false, pendingReview: false, approvalResume: false, retries: 0, fallbackUsed: false, currentModel: 'a/model', fallbackModel: '', minimumDelayMs: error.retryAfterMs }), { type: 'retry', delay: 55_857 });
      assert.ok(!error.message.includes('secret-value')); return true;
    });
    assert.ok(!JSON.stringify(events).includes('secret-value'));
  });
});

test('HTTP429 forwards only Retry-After metadata; SSE header and provider hints use the larger wait', async () => {
  await fixture((_request, response) => { response.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '55.856552065' }); response.end('{"secret":"do-not-echo"}'); }, async client => {
    await assert.rejects(client.turn('session', prompt, () => undefined), error => error instanceof ForgeError && error.status === 429 && error.retryAfterMs === 55_857 && !error.message.includes('do-not-echo'));
  });
  await fixture((_request, response) => { response.setHeader('Retry-After', '60'); sse(response, [[1, created], [2, { type: 'turn.done', state: { status: 'error', message: '[Model Error] Request failed (429): Please retry in 55.856552065s.' } }]]); }, async client => {
    await assert.rejects(client.turn('session', prompt, () => undefined), error => error instanceof ForgeError && error.retryAfterMs === 60_000);
  });
  await fixture((_request, response) => sse(response, [[1, created], [2, { type: 'turn.done', state: { status: 'error', message: '[Model Error] Request failed (429): Please retry in 86400s.' } }]]), async client => {
    await assert.rejects(client.turn('session', prompt, () => undefined), error => error instanceof ForgeError && error.retryAfterMs === undefined && error.retryAfterTooLong);
  });
});
