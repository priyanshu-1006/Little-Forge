import { parseArgs } from 'node:util';
import { ContextEngine } from '../../../src/core/context.js';
import { cancelled } from '../../../src/core/types.js';
import { ForgeClient } from '../../../src/trueforge.js';
import { checkpointManager, collectContext, DEFAULT_URL, openWorkspace, runMode } from './run.js';
import { contextSummary, printable, Terminal } from './terminal.js';
import { hasTerminal, openWorkbench } from './workbench.js';

declare const __LITTLE_FORGE_CLI_VERSION__: string;
const maxPromptBytes = 8000;
const help = [
  'Little Forge CLI ' + __LITTLE_FORGE_CLI_VERSION__,
  '',
  'Usage  little-forge [command] [options]',
  '',
  '  chat [prompt]      Open the interactive coding workspace',
  '  ask <prompt>       Answer a repository question without editing',
  '  plan <prompt>      Plan an implementation with paths and verification steps',
  '  build <prompt>     Review each proposed source hunk before applying',
  '  context <prompt>   Show selected paths and reasons without calling a model',
  '  doctor             Check the workspace, TrueForge connection and model setup',
  '  models             List model IDs from your local TrueForge harness',
  '  checkpoints        List saved edit checkpoints for this workspace',
  '  undo <id>          Review and restore a saved checkpoint',
  '',
  '  --cwd <path>       Workspace directory (default: current directory)',
  '  --url <url>        TrueForge origin (default: ' + DEFAULT_URL + ')',
  '  --model <id>       Model ID from little-forge models',
  '  --mode <mode>      Starting chat mode: ask, plan, or build (default)',
  '  --preview          Build shows proposed hunks without writing files',
  '  --json             Emit JSON. Build runs in preview mode',
  '  --plain            Disable terminal colors',
  '  --version, -v      Print the CLI version',
  '  --help, -h         Show this guide',
  '',
  'Environment  LITTLE_FORGE_URL, LITTLE_FORGE_MODEL, LITTLE_FORGE_STATE_DIR, NO_COLOR',
  'Prompts accept a positional string or stdin. Ctrl+C stops the active run.',
].join('\n');

async function readPrompt(words: string[], terminal: Terminal, signal: AbortSignal) {
  let value = words.join(' ');
  if (!value && process.stdin.isTTY) value = await terminal.question('Prompt  ');
  if (!value && !process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    let bytes = 0;
    const stop = () => process.stdin.destroy();
    signal.addEventListener('abort', stop, { once: true });
    try {
      for await (const chunk of process.stdin) {
        cancelled(signal);
        const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += data.length;
        if (bytes > maxPromptBytes) throw new Error('The prompt exceeds 8000 bytes.');
        chunks.push(data);
      }
      value = Buffer.concat(chunks).toString('utf8');
    } finally { signal.removeEventListener('abort', stop); }
  }
  cancelled(signal);
  value = value.trim();
  if (!value) throw new Error('Enter a prompt as an argument or pipe it through stdin.');
  if (Buffer.byteLength(value) > maxPromptBytes) throw new Error('The prompt exceeds 8000 bytes.');
  return value;
}

async function main() {
  const abort = new AbortController();
  const interrupt = () => abort.abort();
  let terminal: Terminal | undefined;
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);

  try {
    const { values, positionals } = parseArgs({
      allowPositionals: true,
      options: {
        cwd: { type: 'string' }, url: { type: 'string' }, model: { type: 'string' }, mode: { type: 'string' },
        json: { type: 'boolean' }, plain: { type: 'boolean' }, preview: { type: 'boolean' },
        version: { type: 'boolean', short: 'v' }, help: { type: 'boolean', short: 'h' },
      },
    });
    const [explicitCommand, ...words] = positionals;
    const command = explicitCommand ?? (hasTerminal() && !values.json ? 'chat' : undefined);
    terminal = new Terminal(Boolean(values.json), Boolean(values.plain), abort);
    if (values.version) {
      terminal.write(__LITTLE_FORGE_CLI_VERSION__);
      return;
    }
    if (!command || values.help || command === 'help') {
      terminal.write(help);
      return;
    }
    if (!['chat', 'ask', 'plan', 'build', 'context', 'doctor', 'models', 'checkpoints', 'undo'].includes(command)) {
      throw new Error('Unknown command ' + command + '. Run little-forge --help.');
    }
    if (words.length && ['doctor', 'models', 'checkpoints'].includes(command)) {
      throw new Error('The ' + command + ' command does not take positional arguments.');
    }
    if (values.preview && command !== 'build') throw new Error('--preview applies to the build command.');
    if (values.mode && command !== 'chat') throw new Error('--mode applies to interactive chat.');
    const url = values.url ?? process.env.LITTLE_FORGE_URL ?? DEFAULT_URL;
    const workspacePath = values.cwd ?? process.cwd();
    const signal = abort.signal;

    if (command === 'chat') {
      if (values.json) throw new Error('Use ask, plan, or build with --json.');
      const mode = values.mode ?? 'build';
      if (mode !== 'ask' && mode !== 'plan' && mode !== 'build') throw new Error('Choose ask, plan, or build with --mode.');
      const initialPrompt = words.join(' ');
      if (Buffer.byteLength(initialPrompt) > maxPromptBytes) throw new Error('The prompt exceeds 8000 bytes.');
      const workspace = await openWorkspace(workspacePath);
      cancelled(signal);
      // The interactive UI owns signals while the alternate screen is active.
      process.off('SIGINT', interrupt);
      process.off('SIGTERM', interrupt);
      await openWorkbench({
        client: new ForgeClient(url), workspace, mode, model: values.model ?? process.env.LITTLE_FORGE_MODEL,
        plain: Boolean(values.plain) || Object.hasOwn(process.env, 'NO_COLOR'), initialPrompt,
      });
      return;
    }

    if (command === 'doctor' || command === 'models') {
      const client = new ForgeClient(url);
      const workspace = command === 'doctor' ? await openWorkspace(workspacePath) : undefined;
      const health = await client.health();
      cancelled(signal);
      if (terminal.json) terminal.result({ url: client.baseUrl, workspace: workspace?.root, ...health });
      else {
        if (workspace) terminal.write('Workspace  ' + workspace.root);
        terminal.write('TrueForge  ' + client.baseUrl + (health.version ? ' · ' + health.version : ' · connected'));
        for (const model of health.models) terminal.write('  ' + model.name + (model.contextLength ? ' · ' + model.contextLength + ' context tokens' : ''));
        if (!health.models.length) terminal.write('Configure a tool-capable model in the local TrueForge settings.');
      }
      return;
    }

    const workspace = await openWorkspace(workspacePath);
    if (command === 'checkpoints') {
      const entries = await checkpointManager(workspace).checkpoints();
      if (terminal.json) terminal.result(entries);
      else if (!entries.length) terminal.write('No CLI checkpoints for this workspace.');
      else for (const entry of entries) terminal.write(entry.id + '  ' + entry.state + '  ' + entry.paths.join(', '));
      return;
    }
    if (command === 'undo') {
      if (words.length !== 1) throw new Error('Provide one checkpoint ID from little-forge checkpoints.');
      if (!terminal.interactive) throw new Error('Undo requires an interactive terminal for confirmation.');
      const manager = checkpointManager(workspace);
      const entries = await manager.previewUndo(words[0]);
      if (!entries.length) {
        terminal.write('This checkpoint has already been restored.');
        return;
      }
      for (const entry of entries) terminal.note(entry.path + '  ' + entry.state);
      if (entries.some(entry => entry.state === 'can restore') && await terminal.confirm('Restore the matching files?')) {
        const result = await manager.undo(words[0], signal);
        terminal.write('Restored  ' + (result.restored.join(', ') || 'none'));
        if (result.conflicts.length) {
          terminal.note('Conflicts  ' + result.conflicts.join(', '));
          process.exitCode = 1;
        }
      } else {
        cancelled(signal);
        if (entries.some(entry => entry.state === 'conflict')) process.exitCode = 1;
      }
      return;
    }

    const prompt = await readPrompt(words, terminal, signal);
    if (command === 'context') {
      const summary = contextSummary(await collectContext(new ContextEngine(workspace), prompt, signal));
      if (terminal.json) terminal.result(summary);
      else terminal.showContext(summary);
      return;
    }
    if (command === 'ask' || command === 'plan' || command === 'build') {
      const result = await runMode({
        client: new ForgeClient(url), workspace, mode: command, prompt, signal, terminal,
        model: values.model ?? process.env.LITTLE_FORGE_MODEL,
        preview: Boolean(values.preview),
      });
      if (terminal.json) terminal.result(result);
    }
  } catch (error) {
    const message = abort.signal.aborted ? 'Run cancelled.' : error instanceof Error ? error.message : 'Little Forge failed.';
    if (terminal?.json) terminal.result({ error: message });
    else process.stderr.write('Little Forge  ' + printable(message) + '\n');
    process.exitCode = abort.signal.aborted ? 130 : 1;
  } finally {
    terminal?.close();
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', interrupt);
  }
}

void main();
