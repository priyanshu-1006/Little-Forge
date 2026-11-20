import { basename } from 'node:path';
import { emitKeypressEvents, type Key } from 'node:readline';
import { ContextEngine } from '../../../src/core/context.js';
import { cancelled, type Hunk } from '../../../src/core/types.js';
import type { Workspace } from '../../../src/core/workspace.js';
import type { ForgeClient } from '../../../src/trueforge.js';
import { checkpointManager, collectContext, ForgeConversation, runMode, type RunMode } from './run.js';
import { cursorStops, frame, modes, type Entry, type Tone } from './screen.js';
import { contextSummary, printable } from './terminal.js';

const commands = [
  ['/ask', 'Read-only repository questions'],
  ['/plan', 'Read-only implementation planning'],
  ['/build', 'Propose changes for review'],
  ['/models', 'Choose a configured model'],
  ['/context', 'Inspect the files used in the last turn'],
  ['/continue', 'Continue the previous task from current files'],
  ['/checkpoints', 'List previously accepted changes'],
  ['/undo', 'Review and restore a checkpoint'],
  ['/session', 'Show the TrueForge session URL'],
  ['/new', 'Start a fresh conversation'],
  ['/help', 'Show shortcuts and commands'],
  ['/exit', 'Return to the shell'],
] as const;

type Draft = { text: string; cursor: number };
type Question = { title: string; confirm: boolean; allow: boolean; draft: Draft; resolve: (answer: string) => void };
type Choice = { label: string; detail: string; file?: string };
type Summary = ReturnType<typeof contextSummary>;

const styles: Record<Tone, string> = {
  text: '0', muted: '38;5;249', accent: '1;38;5;183', user: '38;5;225',
  code: '38;5;159', add: '38;5;120', remove: '38;5;217', warning: '1;38;5;222',
  'forge-silver': '48;5;235;38;5;255', 'forge-violet': '48;5;235;38;5;135', 'forge-lavender': '48;5;235;38;5;183',
};
const esc = '\x1b[';
const emptyDraft = (): Draft => ({ text: '', cursor: 0 });

export function hasTerminal() {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY && process.stderr.isTTY &&
    (process.platform === 'win32' || process.env.TERM !== 'dumb'));
}

export async function openWorkbench(options: {
  client: ForgeClient; workspace: Workspace; mode: RunMode; model?: string; plain: boolean; initialPrompt?: string;
}) {
  if (!hasTerminal()) {
    throw new Error('Interactive chat needs a terminal. Use ask, plan, or build for a piped command.');
  }
  await new Workbench(options.client, options.workspace, options.mode, options.model, options.plain).open(options.initialPrompt);
}

class Workbench {
  readonly interactive = true;
  private readonly thread: ForgeConversation;
  private readonly transcript: Entry[] = [];
  private readonly history: string[] = [];
  private historyIndex = 0;
  private savedDraft = '';
  private readonly recent: Array<{ prompt: string; answer: string }> = [];
  private sessionUrl?: string;
  private lastContext?: Summary;
  private lastPrompt?: string;
  private draft = emptyDraft();
  private questionState?: Question;
  private active?: AbortController;
  private queued: string | undefined;
  private status = 'Ready · /help for commands';
  private scroll = 0;
  private assistant?: Entry;
  private paintTimer?: NodeJS.Timeout;
  private wasRaw = false;
  private mounted = false;
  private shuttingDown = false;
  private done?: () => void;
  private choiceIndex = 0;
  private palette = false;
  private paste: string | undefined;
  private files?: string[];
  private loadingFiles = false;

  constructor(private readonly client: ForgeClient, private readonly workspace: Workspace,
    private mode: RunMode, private model: string | undefined, private readonly plain: boolean) {
    this.thread = new ForgeConversation(client);
  }

  async open(initialPrompt?: string) {
    if (initialPrompt) {
      const text = printable(initialPrompt);
      this.draft = { text, cursor: text.length };
    }
    const finished = new Promise<void>(resolve => { this.done = resolve; });
    this.wasRaw = process.stdin.isRaw;
    process.stdin.setRawMode(true);
    this.mounted = true;
    process.stdout.write(esc + '?1049h' + esc + '?2004h' + esc + '?25l');
    emitKeypressEvents(process.stdin);
    process.stdin.on('keypress', this.keypress);
    process.stdin.on('end', this.exit);
    process.stdout.on('resize', this.render);
    process.on('SIGINT', this.interrupt);
    process.on('SIGTERM', this.exit);
    process.on('exit', this.restore);
    process.stdin.resume();
    this.render();
    try { await finished; }
    finally {
      this.restore();
      await this.thread.close().catch(error => process.stderr.write(printable(String(error)) + '\n'));
    }
  }

  private restore = () => {
    if (!this.mounted) return;
    this.mounted = false;
    clearTimeout(this.paintTimer);
    process.stdin.off('keypress', this.keypress);
    process.stdin.off('end', this.exit);
    process.stdout.off('resize', this.render);
    process.off('SIGINT', this.interrupt);
    process.off('SIGTERM', this.exit);
    process.off('exit', this.restore);
    process.stdin.setRawMode(this.wasRaw);
    process.stdin.pause();
    process.stdout.write(esc + '?2004l' + esc + '0m' + esc + '?1049l' + esc + '?25h');
  };

  private render = () => {
    if (!this.mounted || this.paintTimer) return;
    this.paintTimer = setTimeout(() => {
      this.paintTimer = undefined;
      const matches = this.choices();
      const offset = Math.max(0, this.choiceIndex - Math.min(3, Math.max(0, process.stdout.rows - 11)));
      const editor = this.questionState?.draft ?? this.draft;
      const result = frame({
        width: Math.min(process.stdout.columns || 80, 400), height: Math.min(process.stdout.rows || 24, 200),
        root: basename(this.workspace.root) || this.workspace.root, mode: this.mode, model: this.model,
        status: this.status + (this.queued ? ' · 1 follow-up queued' : ''),
        transcript: this.transcript, draft: editor.text, cursor: editor.cursor, scroll: this.scroll,
        question: this.questionState, choices: matches.slice(offset).map((choice, index) => ({ ...choice, selected: index + offset === this.choiceIndex })),
      });
      this.scroll = result.scroll;
      const height = process.stdout.rows || 24;
      const lines = result.lines.slice(0, height).map(line => this.plain ? line.text :
        (line.parts ?? [line]).map(part => esc + styles[part.tone] + 'm' + part.text + esc + '0m').join(''));
      // Move explicitly per row, so a full-width line never scrolls the alternate buffer.
      const contents = lines.map((line, index) => esc + (index + 1) + ';1H' + esc + '2K' + line).join('');
      process.stdout.write(esc + '?25l' + contents + esc + 'J' +
        (result.cursor ? esc + result.cursor.row + ';' + result.cursor.column + 'H' + esc + '?25h' : ''));
    }, 25);
  };

  private append(tone: Tone, value: string, caption?: string) {
    this.transcript.push({ tone, text: printable(value), caption });
    if (this.transcript.length > 800) this.transcript.shift();
    this.render();
  }

  heading = (label: string) => this.append('accent', label);
  note = (label: string) => this.append('muted', label);
  activity = (label: string) => { this.status = label; this.render(); };
  toolActivity = (label: string) => this.append('muted', '  Tool  ' + label);
  modelSelected = (name: string) => { this.model = name; this.render(); };
  sessionOpened = (url: string) => {
    if (url !== this.sessionUrl) this.note('Session · ' + url);
    this.sessionUrl = url;
  };
  showContext = (summary: Summary) => {
    this.lastContext = summary;
    this.note('Context · ' + summary.files.length + ' excerpts · ' + summary.usedTokens + '/' + summary.budgetTokens + ' units · /context to inspect');
  };
  fragment = (text: string) => {
    if (!this.assistant) {
      this.append('text', '', 'Little Forge');
      this.assistant = this.transcript.at(-1);
    }
    if (this.assistant) this.assistant.text += printable(text);
    this.render();
  };
  finishAnswer = () => { this.assistant = undefined; };
  diff = (path: string, line: number, hunk: Hunk) => {
    this.heading(path + ':' + line);
    if (hunk.before) this.append('remove', hunk.before.replace(/\r?\n$/, ''));
    if (hunk.after) this.append('add', hunk.after.replace(/\r?\n$/, ''));
  };

  private ask(title: string, confirm: boolean) {
    if (this.active?.signal.aborted) return Promise.resolve('');
    this.scroll = 0;
    return new Promise<string>(resolve => {
      this.questionState = { title, confirm, allow: false, resolve, draft: emptyDraft() };
      this.render();
    });
  }

  question = (title: string) => this.ask(title, false);
  confirm = async (title: string) => await this.ask(title, true) === 'yes';

  private answer(value: string) {
    const question = this.questionState;
    this.questionState = undefined;
    question?.resolve(value);
    this.render();
  }

  private interrupt = () => {
    if (this.active) {
      this.active.abort();
      this.answer('');
      this.activity('Stopping');
    } else this.exit();
  };

  private exit = () => {
    this.shuttingDown = true;
    if (this.active) this.interrupt();
    else this.done?.();
  };

  private mention() {
    if (this.palette || this.draft.text.startsWith('/')) return null;
    return /(?:^|\s)@([^\s@()]*)$/.exec(this.draft.text.slice(0, this.draft.cursor));
  }

  private choices(): Choice[] {
    if (this.questionState || this.active) return [];
    const value = this.draft.text.trimStart();
    if (this.palette || (value.startsWith('/') && !/\s/.test(value))) {
      const query = this.palette && !value.startsWith('/') ? '' : value.toLowerCase();
      return commands.filter(([name]) => name.startsWith(query)).map(([label, detail]) => ({ label, detail }));
    }
    const query = this.mention()?.[1].toLowerCase();
    if (query === undefined || !this.files) return [];
    return this.files.filter(path => path.toLowerCase().includes(query)).slice(0, 20)
      .map(file => ({ label: file, detail: '', file }));
  }

  private loadFiles() {
    if (!this.mention() || this.files || this.loadingFiles) return;
    this.loadingFiles = true;
    void new ContextEngine(this.workspace).files().then(files => {
      this.files = files.map(file => file.path).filter(path => !/[()\r\n]/.test(path));
    }, () => { this.files = []; }).finally(() => { this.loadingFiles = false; this.render(); });
  }

  private insert(editor: Draft, text: string) {
    const value = editor.text.slice(0, editor.cursor) + text + editor.text.slice(editor.cursor);
    if (Buffer.byteLength(value) > 8000) { this.activity('Prompt limit · 8000 bytes'); return; }
    editor.text = value;
    editor.cursor += text.length;
    this.choiceIndex = 0;
    this.loadFiles();
  }

  private edit(editor: Draft, str: string, key: Key) {
    const name = key.name;
    const stops = cursorStops(editor.text);
    const previous = stops[Math.max(0, stops.findIndex(stop => stop >= editor.cursor) - 1)];
    const next = stops.find(stop => stop > editor.cursor) ?? editor.text.length;
    if (name === 'backspace' || name === 'delete') {
      const start = name === 'backspace' ? previous : editor.cursor;
      editor.text = editor.text.slice(0, start) + editor.text.slice(name === 'backspace' ? editor.cursor : next);
      editor.cursor = start;
      this.choiceIndex = 0;
    } else if (name === 'left' || name === 'right') editor.cursor = name === 'left' ? previous : next;
    else if (name === 'home' || (key.ctrl && name === 'a')) editor.cursor = 0;
    else if (name === 'end' || (key.ctrl && name === 'e')) editor.cursor = editor.text.length;
    else if (key.ctrl && name === 'u') { editor.text = ''; editor.cursor = 0; }
    else if ((key.meta && name === 'return') || name === 'enter' || (key.ctrl && name === 'j')) this.insert(editor, '\n');
    else if (str && !key.ctrl && !key.meta && !/[\x00-\x1f\x7f]/.test(str)) this.insert(editor, printable(str));
  }

  private keypress = (str: string, key: Key) => {
    const name = key.name;
    if (name === 'paste-start') { this.paste = ''; return; }
    if (name === 'paste-end') {
      if (this.paste && !this.questionState?.confirm) {
        this.insert(this.questionState?.draft ?? this.draft, printable(this.paste.replace(/\r\n?/g, '\n')));
      }
      this.paste = undefined; this.render(); return;
    }
    if (this.paste !== undefined) { this.paste = (this.paste + (str ?? key.sequence ?? '')).slice(0, 8000); return; }
    if (key.ctrl && name === 'c') { this.interrupt(); return; }
    if (key.ctrl && name === 'd' && !this.active && !this.draft.text) { this.exit(); return; }
    if (name === 'pageup' || name === 'pagedown') {
      const step = Math.max(3, (process.stdout.rows || 24) - 10);
      this.scroll = Math.max(0, Math.min(8000, this.scroll + (name === 'pageup' ? step : -step)));
      this.render(); return;
    }
    if (name === 'escape') {
      if (this.questionState) this.answer('');
      else if (this.active) this.interrupt();
      else if (this.palette) this.palette = false;
      else if (this.queued) { this.note('Queued follow-up removed.'); this.queued = undefined; }
      else this.scroll = 0;
      this.render(); return;
    }
    const question = this.questionState;
    const enter = name === 'return' && !key.meta && !key.shift && !key.ctrl;
    if (question) {
      if (question.confirm) {
        if (str?.toLowerCase() === 'y' || name === 'left') question.allow = true;
        else if (str?.toLowerCase() === 'n' || name === 'right') question.allow = false;
        else if (enter) this.answer(question.allow ? 'yes' : '');
      } else if (enter) this.answer(question.draft.text.trim());
      else this.edit(question.draft, str, key);
      this.render(); return;
    }
    if (key.ctrl && name === 'p' && !this.active) { this.palette = !this.palette; this.choiceIndex = 0; this.render(); return; }
    const choices = this.choices();
    if ((name === 'up' || name === 'down') && choices.length) {
      this.choiceIndex = (this.choiceIndex + choices.length + (name === 'up' ? -1 : 1)) % choices.length;
    } else if (name === 'up' || name === 'down') {
      if (this.historyIndex === this.history.length) this.savedDraft = this.draft.text;
      this.historyIndex = Math.max(0, Math.min(this.history.length, this.historyIndex + (name === 'up' ? -1 : 1)));
      const text = this.history[this.historyIndex] ?? this.savedDraft;
      this.draft = { text, cursor: text.length };
    } else if (name === 'tab' && !this.active) {
      if (choices[this.choiceIndex]) this.choose(choices[this.choiceIndex], true);
      else this.setMode(modes[(modes.indexOf(this.mode) + modes.length + (key.shift ? -1 : 1)) % modes.length]);
    } else if (enter && !this.shuttingDown) {
      if (choices[this.choiceIndex]) this.choose(choices[this.choiceIndex], false);
      else this.sendDraft();
    } else if (key.shift && (name === 'return' || name === 'enter')) this.insert(this.draft, '\n');
    else this.edit(this.draft, str, key);
    this.render();
  };

  private choose(choice: Choice, completeOnly: boolean) {
    if (choice.file) {
      const match = this.mention();
      if (!match) return;
      const start = this.draft.cursor - match[1].length - 1;
      const replacement = '@file(' + choice.file + ') ';
      const text = this.draft.text.slice(0, start) + replacement + this.draft.text.slice(this.draft.cursor);
      if (Buffer.byteLength(text) <= 8000) this.draft = { text, cursor: start + replacement.length };
      this.choiceIndex = 0;
      return;
    }
    this.palette = false;
    this.choiceIndex = 0;
    if (completeOnly) {
      const text = choice.label + ' ';
      this.draft = { text, cursor: text.length };
    } else {
      if (this.draft.text.trimStart().startsWith('/')) this.draft = emptyDraft();
      this.accept(choice.label);
    }
  }

  private sendDraft() {
    const text = this.draft.text.trim();
    if (!text) return;
    if (this.active) {
      if (this.queued || text.startsWith('/')) {
        this.activity(this.queued ? 'Follow-up already queued · draft kept' : 'Wait or stop before running a command');
        return;
      }
      this.queued = text;
    }
    this.draft = emptyDraft();
    this.palette = false;
    this.choiceIndex = 0;
    this.history.push(text);
    if (this.history.length > 500) this.history.shift();
    this.historyIndex = this.history.length;
    this.scroll = 0;
    if (!this.active) this.accept(text);
  }

  private setMode(mode: RunMode) {
    this.mode = mode;
    this.activity(mode === 'build' ? 'Build · review required for changes' : mode === 'ask' ? 'Ask · read-only' : 'Plan · read-only');
  }

  private accept(text: string) {
    if (this.active || this.shuttingDown) return;
    const run = new AbortController();
    this.active = run;
    this.scroll = 0;
    void this.execute(text, run.signal).then(() => {
      if (run.signal.aborted) this.restoreQueued();
      this.activity(run.signal.aborted ? 'Stopped' : 'Ready');
    }, error => {
      if (run.signal.aborted) this.activity('Stopped · /continue to inspect and resume');
      else { this.append('warning', error instanceof Error ? error.message : String(error), 'Run stopped'); this.activity('Ready · /continue to inspect and resume'); }
      this.restoreQueued();
    }).finally(() => {
      this.active = undefined;
      if (this.shuttingDown) this.done?.();
      else if (this.queued && !run.signal.aborted) {
        const next = this.queued;
        this.queued = undefined;
        this.accept(next);
      }
      this.render();
    });
  }

  private restoreQueued() {
    if (!this.queued) return;
    if (!this.draft.text) this.draft = { text: this.queued, cursor: this.queued.length };
    else this.note('Queued follow-up held in prompt history.');
    this.queued = undefined;
  }

  private async execute(text: string, signal: AbortSignal) {
    if (!text.startsWith('/')) return this.prompt(text, signal);
    const command = text.split(/\s/, 1)[0].toLowerCase();
    const argument = text.slice(command.length).trim();
    const mode = modes.find(value => '/' + value === command);
    if (mode) { this.setMode(mode); if (argument) await this.prompt(argument, signal); return; }
    switch (command) {
      case '/exit': this.shuttingDown = true; return;
      case '/new':
        await this.thread.close();
        this.transcript.length = 0;
        this.recent.length = 0;
        this.lastPrompt = undefined;
        this.lastContext = undefined;
        this.sessionUrl = undefined;
        return;
      case '/session': this.note(this.sessionUrl ?? 'Send a prompt to create a TrueForge session.'); return;
      case '/help':
        this.heading('Terminal shortcuts');
        this.note('Enter sends or queues one follow-up. Alt+Enter or Ctrl+J adds a line. Tab switches mode when the composer has no suggestions.');
        this.note('Ctrl+P opens commands. Type @ for workspace files. Up and Down recall prompts. Page Up and Page Down scroll the transcript. Esc stops a run or declines a pending review.');
        for (const [name, detail] of commands) this.note(name.padEnd(15) + detail);
        return;
      case '/models': {
        this.activity('Loading TrueForge models');
        const { models } = await this.client.health();
        cancelled(signal);
        if (!models.length) { this.note('Configure a tool-capable model in ' + this.client.baseUrl); return; }
        this.heading('Configured TrueForge models');
        for (const [index, model] of models.entries()) this.note(String(index + 1) + '. ' + model.name);
        const choice = argument || await this.question('Choose a model by number or ID');
        cancelled(signal);
        if (!choice) return;
        const selected = /^\d+$/.test(choice) ? models[Number(choice) - 1] : models.find(model => model.name === choice);
        if (!selected) throw new Error('Model unavailable. Choose an ID from /models.');
        this.modelSelected(selected.name);
        return;
      }
      case '/context': {
        const context = argument ? contextSummary(await collectContext(new ContextEngine(this.workspace), argument, signal)) : this.lastContext;
        if (!context) { this.note('Send a prompt first, or enter /context followed by a query.'); return; }
        this.heading('Repository context · ' + context.usedTokens + '/' + context.budgetTokens + ' units');
        for (const file of context.files) this.note(file.path + '#L' + file.startLine + '-L' + file.endLine + '  ' + file.reason);
        if (context.truncated) this.note('Some context was omitted to stay within the retrieval limits.');
        return;
      }
      case '/checkpoints': {
        const entries = await checkpointManager(this.workspace).checkpoints();
        if (!entries.length) this.note('No CLI checkpoints for this workspace.');
        for (const entry of entries) this.note(entry.id + '  ' + entry.state + '  ' + entry.paths.join(', '));
        return;
      }
      case '/undo': {
        if (!argument) { this.note('Choose an ID with /checkpoints, then enter /undo <id>.'); return; }
        const manager = checkpointManager(this.workspace);
        const entries = await manager.previewUndo(argument);
        if (!entries.length) this.note('This checkpoint has already been restored.');
        for (const entry of entries) this.note(entry.path + '  ' + entry.state);
        if (entries.some(entry => entry.state === 'can restore') && await this.confirm('Restore the matching files?')) {
          const result = await manager.undo(argument, signal);
          for (const path of result.restored) this.note('Restored ' + path);
          for (const path of result.conflicts) this.append('warning', 'Conflict · ' + path);
        }
        return;
      }
      case '/continue':
        if (!this.lastPrompt) { this.note('Send a task first.'); return; }
        return this.prompt('Inspect the current workspace and continue this task. Preserve completed work and avoid repeating changes or checks unnecessarily.\n\n' + this.lastPrompt, signal, true);
      default: this.note('Unknown command ' + command + ' · /help lists commands');
    }
  }

  private async prompt(text: string, signal: AbortSignal, continued = false) {
    if (!continued) this.lastPrompt = text;
    this.append('user', text, 'You · ' + this.mode);
    const handoff = JSON.stringify(this.recent.slice(-2).map(item => ({ request: item.prompt.slice(0, 600), answer: item.answer.slice(-1100) })));
    const result = await runMode({
      client: this.client, workspace: this.workspace, mode: this.mode, model: this.model,
      prompt: text, preview: false, terminal: this, signal, conversation: this.thread, handoff: this.recent.length ? handoff : '',
    });
    this.recent.push({ prompt: text, answer: result.answer });
    if (this.recent.length > 2) this.recent.shift();
    this.files = undefined;
  }
}
