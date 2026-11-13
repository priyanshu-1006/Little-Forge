import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startEditorServer } from '../src/mcp-server.js';

async function fixture(t: TestContext, dispatch: (name: string, args: Record<string, unknown>) => Promise<unknown> = async (name, args) => ({ name, args })) {
  const server = await startEditorServer(dispatch);
  const clients: Client[] = [];
  t.after(async () => { for (const client of clients) await client.close(); await server.close(); });
  const connect = async () => {
    const client = new Client({ name: 'little-forge-test-client', version: '1.0.0' });
    clients.push(client);
    const transport = new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers: { Authorization: `Bearer ${server.token}` } }, reconnectionOptions: { maxRetries: 0, initialReconnectionDelay: 10, maxReconnectionDelay: 10, reconnectionDelayGrowFactor: 1 } });
    await client.connect(transport);
    return client;
  };
  return { server, connect };
}
async function raw(url: string, options: { method?: string; path?: string; body?: string; headers?: Record<string, string> } = {}): Promise<{ status: number; body: string; headers: Record<string, unknown> }> {
  const target = new URL(url);
  return await new Promise((resolve, reject) => {
    const req = request({ hostname: target.hostname, port: target.port, path: options.path ?? target.pathname, method: options.method ?? 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...options.headers } }, res => {
      const chunks: Buffer[] = [];
      res.on('data', chunk => chunks.push(Buffer.from(chunk)));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8'), headers: res.headers }));
    });
    req.once('error', reject); req.end(options.body ?? '{}');
  });
}
function text(result: unknown): string {
  assert.ok(result && typeof result === 'object' && 'content' in result);
  const content = (result as { content: unknown }).content;
  assert.ok(Array.isArray(content));
  return content.filter(item => item && typeof item === 'object' && item.type === 'text').map(item => String(item.text)).join('\n');
}

test('official MCP client initializes, discovers editor capabilities and invokes a real HTTP tool', async t => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const { connect } = await fixture(t, async (name, args) => { calls.push({ name, args }); return { matches: [{ path: 'src/app.py', line: 7, text: 'configuration' }] }; });
  const client = await connect();
  assert.equal(client.getServerVersion()?.name, 'little-forge-editor');
  const listing = await client.listTools();
  assert.deepEqual(listing.tools.map(tool => tool.name).sort(), ['apply_proposal', 'find_symbols', 'get_diagnostics', 'get_workspace_map', 'propose_changes', 'read_file', 'retrieve_context', 'run_command', 'search_workspace']);
  assert.equal(listing.tools.find(tool => tool.name === 'read_file')?.annotations?.readOnlyHint, true);
  assert.equal(listing.tools.find(tool => tool.name === 'apply_proposal')?.annotations?.destructiveHint, true);
  assert.equal(listing.tools.find(tool => tool.name === 'run_command')?.annotations?.readOnlyHint, false);
  const result = await client.callTool({ name: 'search_workspace', arguments: { query: 'configuration', glob: '**/*.py', limit: 5 } });
  assert.ok(!result.isError);
  assert.deepEqual(JSON.parse(text(result)), { matches: [{ path: 'src/app.py', line: 7, text: 'configuration' }] });
  assert.deepEqual(calls, [{ name: 'search_workspace', args: { query: 'configuration', glob: '**/*.py', limit: 5 } }]);
});

test('tool validation and dispatch errors remain protocol errors without executing invalid calls', async t => {
  const calls: string[] = [];
  const { connect } = await fixture(t, async name => { calls.push(name); throw new Error('No active editor run.'); });
  const client = await connect();
  const failed = await client.callTool({ name: 'read_file', arguments: { path: 'src/app.py' } });
  assert.equal(failed.isError, true); assert.match(text(failed), /No active editor run/);
  const invalid = await client.callTool({ name: 'search_workspace', arguments: { query: '', limit: 1000 } });
  assert.equal(invalid.isError, true); assert.deepEqual(calls, ['read_file']);
  const unknown = await client.callTool({ name: 'not_a_tool', arguments: {} });
  assert.equal(unknown.isError, true); assert.deepEqual(calls, ['read_file']);
});

test('loopback MCP rejects absent, forged and non-ASCII credentials before dispatch', async t => {
  let calls = 0;
  const { server } = await fixture(t, async () => { calls++; return {}; });
  assert.equal((await raw(server.url)).status, 401);
  assert.equal((await raw(server.url, { headers: { Authorization: `Bearer ${'0'.repeat(64)}` } })).status, 401);
  assert.equal((await raw(server.url, { headers: { Authorization: `Bearer ${'é'.repeat(64)}` } })).status, 401);
  assert.equal(calls, 0);
});

test('host and browser-origin checks deny rebinding and foreign sites even with a valid bearer', async t => {
  const { server } = await fixture(t);
  const auth = { Authorization: `Bearer ${server.token}` };
  assert.equal((await raw(server.url, { headers: { ...auth, Origin: 'https://attacker.example' } })).status, 403);
  assert.equal((await raw(server.url, { headers: { ...auth, Origin: 'null' } })).status, 403);
  assert.equal((await raw(server.url, { headers: { ...auth, Host: 'attacker.example' } })).status, 403);
  const acceptedOrigin = await raw(server.url, { headers: { ...auth, Origin: 'http://127.0.0.1:8790' }, body: '{' });
  assert.equal(acceptedOrigin.status, 400);
});

test('HTTP framing rejects malformed JSON, unsupported methods, routes and oversized bodies', async t => {
  const { server } = await fixture(t);
  const headers = { Authorization: `Bearer ${server.token}` };
  assert.equal((await raw(server.url, { headers, body: '{' })).status, 400);
  assert.equal((await raw(server.url, { headers, path: '/other' })).status, 404);
  const get = await raw(server.url, { headers, method: 'GET', body: '' });
  assert.equal(get.status, 405); assert.equal(get.headers.allow, 'POST');
  assert.equal((await raw(server.url, { headers, body: JSON.stringify({ data: 'x'.repeat(2_000_001) }) })).status, 413);
});

test('each server has a private token and one instance cannot authorize another', async t => {
  const first = await fixture(t), second = await fixture(t);
  assert.notEqual(first.server.token, second.server.token); assert.notEqual(first.server.name, second.server.name);
  assert.equal((await raw(second.server.url, { headers: { Authorization: `Bearer ${first.server.token}` } })).status, 401);
  const client = await second.connect(); assert.ok((await client.listTools()).tools.length > 0);
});
