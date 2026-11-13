import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { ContextEngine, parseMentions } from '../src/core/context.js';
import { Workspace } from '../src/core/workspace.js';
import { hash } from '../src/core/types.js';

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'little-forge-context-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const workspace = new Workspace(root), context = new ContextEngine(workspace);
  const put = async (file: string, value: string): Promise<void> => { const absolute = path.join(root, file); await fs.mkdir(path.dirname(absolute), { recursive: true }); await fs.writeFile(absolute, value); context.invalidate(); };
  return { root, workspace, context, put };
}

test('retrieval discovers source, related tests and RST documentation without named files', async t => {
  const { context, put } = await fixture(t);
  await put('src/app/cli.py', 'import click\n\ndef config_command():\n    """CLI command rendering configuration as JSON."""\n    return {}\n');
  await put('tests/test_cli.py', 'from app.cli import config_command\n\ndef test_config_output():\n    assert config_command() == {}\n');
  await put('docs/cli.rst', 'Command Line Interface\n======================\nBuilt-in CLI commands\nConfiguration output is JSON.\n');
  await put('src/app/unrelated.py', 'def unrelated():\n    return 1\n');
  const result = await context.retrieve('Add a CLI command showing configuration JSON and document it', 16000);
  const paths = result.chunks.map(chunk => chunk.path);
  assert.ok(paths.includes('src/app/cli.py')); assert.ok(paths.includes('tests/test_cli.py')); assert.ok(paths.includes('docs/cli.rst'));
  assert.ok(result.chunks.find(chunk => chunk.path === 'tests/test_cli.py')?.reason.includes('import relationship'));
  assert.ok(result.chunks.every(chunk => chunk.reason.length > 0 && chunk.startLine >= 1 && chunk.endLine >= chunk.startLine));
  assert.equal(result.indexedFiles, 4);
});

test('bounded declaration hints use fresh source lines, remain query relevant and count toward context budget', async t => {
  const {context,put}=await fixture(t);
  const source='class CommandRegistry:\n    def register_command(self):\n        pass\n\n'+'\n'.repeat(70)+Array.from({length:12},(_,i)=>`def help_command_${i}():\n    pass\n`).join('\n')+'\ndef unrelated_method():\n    pass\n';
  await put('src/tool/commands.py',source);
  const result=await context.retrieve('Add a built-in CLI command and help',5000);
  const chunk=result.chunks.find(c=>c.path==='src/tool/commands.py')!;
  assert.ok(chunk.declarations?.length && chunk.declarations.length<=6);
  assert.ok(chunk.declarations.every(d=>source.split('\n')[d.line-1]?.includes(d.name)));
  assert.ok(!chunk.declarations.some(d=>d.name==='unrelated_method'));
  assert.ok(chunk.tokens>=Buffer.byteLength(JSON.stringify(chunk),'utf8'));
  assert.ok(result.usedTokens<=5000);
  await put('src/tool/commands.py','\n\nclass CommandRegistry:\n    def register_command(self):\n        pass\n');
  const fresh=await context.retrieve('CLI command',5000);
  assert.ok(fresh.chunks[0].declarations?.some(d=>d.name==='CommandRegistry'&&d.line===3));
  assert.ok(fresh.chunks[0].declarations?.some(d=>d.name==='register_command'&&d.line===4));
});

test('context budget charges serialized UTF-8 bytes and metadata, including non-ASCII content', async t => {
  const { context, put } = await fixture(t);
  await put('docs/unicode.md', Array.from({ length: 80 }, (_, i) => `# configuration ${i} नमस्ते 😀 café "quoted"`).join('\n'));
  for (const budget of [0, 64, 512, 900, 2400, 5000]) {
    const result = await context.retrieve('configuration', budget);
    assert.ok(result.usedTokens <= budget);
    assert.equal(result.usedTokens, result.chunks.reduce((sum, chunk) => sum + chunk.tokens, 0));
    for (const chunk of result.chunks) assert.ok(chunk.tokens >= Buffer.byteLength(JSON.stringify(chunk), 'utf8'));
    if (result.chunks.length) assert.ok(result.usedTokens >= Buffer.byteLength(JSON.stringify(result), 'utf8'));
  }
  await assert.rejects(context.retrieve('configuration', -1), /budget/);
});

test('primary module keeps paired tests and documentation ahead of broad topical hubs', async t => {
  const { context, put } = await fixture(t);
  await put('src/tool/renderer.py', 'def renderer_configuration():\n    """Render configuration output using renderer settings."""\n    return {}\n');
  await put('tests/test_renderer.py', 'from tool.renderer import renderer_configuration\n\ndef test_renderer():\n    assert renderer_configuration() == {}\n');
  await put('docs/renderer.rst', 'Renderer reference\n==================\nUsage of this module.\n');
  await put('docs/configuration.rst', 'Configuration\n=============\nRender configuration output and renderer settings are global configuration options.\n');
  await put('tests/test_settings.py', 'def test_configuration_output_settings():\n    """Render configuration output and renderer settings."""\n    pass\n');
  const result = await context.retrieve('Add renderer configuration output, covered by a test and documented', 2600);
  assert.deepEqual(result.chunks.slice(0, 3).map(chunk => chunk.path), ['src/tool/renderer.py', 'tests/test_renderer.py', 'docs/renderer.rst']);
  assert.ok(result.chunks[2]?.reason.includes('paired with primary module'));
});

test('explicit file and symbol mentions resolve unique identities and outrank lexical matches', async t => {
  const { context, put } = await fixture(t);
  await put('src/first.py', 'def shared():\n    return 1\n\ndef selected_function():\n    return 2\n');
  await put('src/second.py', 'def shared():\n    return 2\n');
  await put('docs/notes.md', '# unrelated\nManually selected context.\n');
  const files = await context.files(), symbols = await context.symbols();
  const mentions = parseMentions('Check @file:docs/notes.md and @symbol(src/first.py#selected_function)', files, symbols);
  assert.equal(mentions.length, 2);
  assert.equal(mentions[1]?.line, 4);
  assert.throws(() => parseMentions('@symbol:shared', files, symbols), /ambiguous/);
  assert.throws(() => parseMentions('@file:missing.py', files, symbols), /could not be resolved/);
  assert.throws(() => parseMentions('@symbol:missing', files, symbols), /could not be resolved/);
  assert.equal(parseMentions('Inspect @src/first.py', files, symbols)[0]?.path, 'src/first.py');
  const result = await context.retrieve('shared', 6000, mentions);
  assert.ok(result.chunks[0]?.reason.includes('Explicit'));
  assert.ok(result.chunks.some(chunk => chunk.path === 'docs/notes.md' && chunk.reason.includes('@file')));
  assert.ok(result.chunks.some(chunk => chunk.path === 'src/first.py' && chunk.reason.includes('@symbol')));
});

test('fresh source and ignore policy replace cached retrieval evidence', async t => {
  const { context, put, root } = await fixture(t);
  await put('src/config.py', 'def config():\n    return "old"\n');
  const before = await context.retrieve('config', 5000);
  assert.ok(before.chunks[0]?.content.includes('old'));
  const replacement = 'def config():\n    return "new"\n';
  // No explicit invalidate: metadata refresh still notices an ordinary external save.
  await fs.writeFile(path.join(root, 'src/config.py'), replacement);
  const after = await context.retrieve('config', 5000);
  assert.ok(after.chunks[0]?.content.includes('new'));
  assert.equal(after.chunks[0]?.hash, hash(replacement));
  await put('.gitignore', 'src/config.py\n');
  assert.ok(!(await context.retrieve('config', 5000)).chunks.some(chunk => chunk.path === 'src/config.py'));
});

test('multiple explicitly mentioned symbols in one file each retain their own excerpt', async t => {
  const { context, put } = await fixture(t);
  await put('src/example.py', 'def first_symbol():\n    return 1\n' + '\n'.repeat(90) + 'def second_symbol():\n    return 2\n');
  const mentions = parseMentions('@symbol:first_symbol and @symbol:second_symbol', await context.files(), await context.symbols());
  const result = await context.retrieve('explain both', 9000, mentions);
  assert.equal(result.chunks.filter(chunk => chunk.path === 'src/example.py').length, 2);
  assert.ok(result.chunks.some(chunk => chunk.reason.includes('first_symbol') && chunk.content.includes('def first_symbol')));
  assert.ok(result.chunks.some(chunk => chunk.reason.includes('second_symbol') && chunk.content.includes('def second_symbol')));
});

test('renamed explicit symbols and unavailable files fail visibly instead of using stale line hints', async t => {
  const { context, put } = await fixture(t);
  await put('src/example.py', 'def old_name():\n    return 1\n');
  const mention = parseMentions('@symbol:old_name', await context.files(), await context.symbols());
  await put('src/example.py', 'def new_name():\n    return 1\n');
  await assert.rejects(context.retrieve('explain', 5000, mention), /no longer available/);
  await assert.rejects(context.retrieve('explain', 5000, [{ kind: 'file', path: '.env' }]), /unavailable|limit/);
});

test('overview fallback is deterministic and independent of an unrelated open editor', async t => {
  const { context, put } = await fixture(t);
  await put('README.md', '# Project\nA local tool.\n'); await put('package.json', '{"name":"example"}');
  const a = await context.retrieve('zzzzunknown', 5000), b = await context.retrieve('zzzzunknown', 5000);
  assert.deepEqual(a, b);
  assert.ok(a.chunks.every(chunk => chunk.reason.includes('fallback')));
});

test('cancelled indexing and retrieval never return partial success', async t => {
  const { context, put } = await fixture(t);
  await put('src/app.py', 'def app():\n    return 1');
  const controller = new AbortController(); controller.abort();
  await assert.rejects(context.retrieve('app', 5000, [], controller.signal), /cancelled/);
  await assert.rejects(context.symbols('', controller.signal), /cancelled/);
  assert.ok((await context.retrieve('app', 5000)).chunks.length > 0);
});

test('inline context contains the exact UTF-16 selection without scanning unrelated repository files', async t => {
  const {workspace,context,put}=await fixture(t);
  const prefix='\uFEFF# 😀 header\r\n\r\n';
  const selected='def chosen():\r\n    """Chosen region."""\r\n    return False\r\n';
  const source=prefix+selected+'\r\ndef unrelated():\r\n    return "many unrelated query terms"\r\n';
  await put('src/helpers.py',source);
  await put('docs/unrelated.md','Chosen region '.repeat(500));
  let scans=0; workspace.list=async()=>{scans++;throw new Error('Unrelated repository scan');};
  const result=await context.forSelection({path:'src/helpers.py',hash:hash(source),start:prefix.length,end:prefix.length+selected.length},2000);
  assert.equal(scans,0);assert.equal(result.selectionOnly,true);assert.equal(result.chunks.length,1);
  assert.equal(result.chunks[0].content,selected);assert.equal(result.chunks[0].hash,hash(source));
  assert.equal(result.chunks[0].startLine,3);assert.equal(result.chunks[0].endLine,5);
  assert.match(result.chunks[0].reason,/Captured editor selection/);
  assert.ok(result.usedTokens<=2000);assert.equal(result.truncated,false);
});

test('inline selection charges escaped UTF-8 metadata and refuses oversize regions without clipping', async t => {
  const {context,put}=await fixture(t);
  const source='text = "नमस्ते 😀 \\\""\n'.repeat(30);await put('src/unicode.py',source);
  const scope={path:'src/unicode.py',hash:hash(source),start:0,end:source.length};
  await assert.rejects(context.forSelection(scope,500),/exceeds the context budget/);
  const result=await context.forSelection(scope,12000);
  assert.equal(result.chunks[0].content,source);
  assert.ok(result.usedTokens>=Buffer.byteLength(JSON.stringify(result.chunks[0])));
  await assert.rejects(context.forSelection(scope,0),/positive context budget/);
});

test('inline context refuses stale captures, invalid ranges and newly protected source', async t => {
  const {context,put}=await fixture(t);const source='first\nsecond\n';await put('src/app.py',source);
  const scope={path:'src/app.py',hash:hash(source),start:0,end:5};
  for(const range of [{start:-1},{end:source.length+1},{end:0},{start:0.5}]) await assert.rejects(context.forSelection({...scope,...range},2000),/outside the saved source/);
  await put('src/app.py','changed\n');await assert.rejects(context.forSelection(scope,2000),/selected source changed/);
  await put('.gitignore','src/app.py\n');await assert.rejects(context.forSelection({...scope,hash:hash('changed\n')},2000),/ignored|excluded|protected/i);
});

test('a cancelled inline-context request performs no source reads', async t => {
  const {workspace,context}=await fixture(t);let reads=0;
  workspace.read=async()=>{reads++;throw new Error('Unexpected read');};
  const controller=new AbortController();controller.abort();
  await assert.rejects(context.forSelection({path:'src/app.py',hash:'unused',start:0,end:1},1000,controller.signal),/cancelled/i);
  assert.equal(reads,0);
});
