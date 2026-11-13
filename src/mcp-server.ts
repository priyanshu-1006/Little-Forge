import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

const descriptions = {
  get_workspace_map: 'Inspect the permitted repository structure. Start here for an unfamiliar project; paths are workspace-relative.',
  search_workspace: 'Search permitted code, tests and documentation for literal text. Returns bounded line-level matches.',
  read_file: 'Read fresh source lines and the exact full-file SHA-256 used by proposals. Never infer source from filenames.',
  find_symbols: 'Find declarations by name across the workspace, returning paths and line numbers.',
  retrieve_context: 'Retrieve budgeted source, test and documentation excerpts with visible reasons; discover relevant files without user path hints.',
  get_diagnostics: 'Read current editor diagnostics for permitted files.',
  propose_changes: 'Stage an immutable patch for native per-hunk review. Does not write source files. Use exact oldText/newText replacements and beforeHash from a fresh read. Then request apply_proposal.',
  apply_proposal: 'Apply only the hunks a human selected in the editor for an existing proposal. Requires TrueForge tool approval and a one-use editor grant. Rejection cannot be bypassed.',
  run_command: 'Run a separately reviewed project check. Tests execute project code with user permissions; arbitrary shells and source-writing commands are unavailable.'
};

export async function startEditorServer(dispatch: (name: string, args: Record<string, unknown>) => Promise<unknown>) {
  const token = randomBytes(32).toString('hex');
  const name = `little-forge-${randomBytes(5).toString('hex')}`;
  const schemas = {
    get_workspace_map: { query: z.string().max(2000).optional() },
    search_workspace: { query: z.string().min(1).max(300), glob: z.string().max(160).optional(), limit: z.number().int().min(1).max(100).optional() },
    read_file: { path: z.string().min(1).max(1000), startLine: z.number().int().min(1).optional(), endLine: z.number().int().min(1).optional() },
    find_symbols: { query: z.string().max(200).optional() },
    retrieve_context: { query: z.string().min(1).max(4000), budgetTokens: z.number().int().min(500).max(12000).optional() },
    get_diagnostics: { paths: z.array(z.string().max(1000)).max(20).optional() },
    propose_changes: { files: z.array(z.object({ path: z.string().max(1000), beforeHash: z.string().nullable(), content: z.string().max(131072).nullable().optional(), edits: z.array(z.object({ oldText: z.string().min(1).max(65000), newText: z.string().max(65000) })).max(32).optional() }).strict()).min(1).max(8) },
    apply_proposal: { proposalId: z.string().min(1).max(100) },
    run_command: { task: z.enum(['pytest', 'npm-test', 'typecheck', 'git-diff-check']), args: z.array(z.string().max(250)).max(24).optional(), cwd: z.string().max(1000).optional() }
  };
  const transports = new Set<StreamableHTTPServerTransport>();
  const http = createServer((req, res) => { void handle(req, res).catch(error => { if (!res.headersSent) res.writeHead(500); res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'MCP request failed.' })); }); });
  let port = 0;
  async function handle(req: IncomingMessage, res: ServerResponse) {
    const credential = req.headers.authorization ?? '';
    const expected = `Bearer ${token}`;
    const origin = req.headers.origin;
    const validOrigin = !origin || /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(origin);
    if (!validOrigin || req.headers.host !== `127.0.0.1:${port}`) { res.writeHead(403); res.end(); return; }
    const suppliedBytes = Buffer.from(credential), expectedBytes = Buffer.from(expected);
    if (suppliedBytes.length !== expectedBytes.length || !timingSafeEqual(suppliedBytes, expectedBytes)) { res.writeHead(401); res.end(); return; }
    if (req.url !== '/mcp') { res.writeHead(404); res.end(); return; }
    if (req.method !== 'POST') { res.writeHead(405, { Allow: 'POST' }); res.end(); return; }
    const buffers: Buffer[] = []; let bytes = 0;
    for await (const chunk of req) { bytes += chunk.length; if (bytes > 2_000_000) { res.writeHead(413); res.end(); return; } buffers.push(chunk); }
    let body: unknown;
    try { body = JSON.parse(Buffer.concat(buffers).toString('utf8')); } catch { res.writeHead(400); res.end(); return; }
    const server = new McpServer({ name: 'little-forge-editor', version: '0.1.0' });
    for (const tool of Object.keys(schemas) as Array<keyof typeof schemas>) {
      server.registerTool(tool, { description: descriptions[tool], inputSchema: schemas[tool], annotations: { readOnlyHint: !['apply_proposal', 'run_command'].includes(tool), destructiveHint: ['apply_proposal', 'run_command'].includes(tool), idempotentHint: !['propose_changes', 'apply_proposal', 'run_command'].includes(tool), openWorldHint: tool === 'run_command' } }, async (args: Record<string, unknown>) => {
        try { const result = await dispatch(tool, args); return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }; }
        catch (error) { return { isError: true, content: [{ type: 'text' as const, text: error instanceof Error ? error.message : 'Editor tool failed.' }] }; }
      });
    }
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    transports.add(transport);
    res.on('close', () => { transports.delete(transport); void transport.close(); void server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  }
  await new Promise<void>((resolve, reject) => { http.once('error', reject); http.listen(0, '127.0.0.1', () => resolve()); });
  const address = http.address();
  if (!address || typeof address === 'string') throw new Error('Could not bind editor MCP.');
  port = address.port;
  return { name, url: `http://127.0.0.1:${port}/mcp`, token, async close() { for (const transport of transports) await transport.close(); http.closeAllConnections(); await new Promise<void>(resolve => http.close(() => resolve())); } };
}
