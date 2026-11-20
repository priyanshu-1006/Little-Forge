import { createInterface, type Interface } from 'node:readline/promises';
import type { ContextResult, Hunk } from '../../../src/core/types.js';

// Strip terminal escapes and invisible direction controls from model and repository output.
export function printable(value: string): string {
  return value.replace(/\r\n/g, '\n').replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, '');
}

export function contextSummary(context: ContextResult) {
  const { usedTokens, budgetTokens, indexedFiles, truncated } = context;
  const files = context.chunks.map(({ path, startLine, endLine, reason, tokens }) => ({ path, startLine, endLine, reason, tokens }));
  return { indexedFiles, usedTokens, budgetTokens, truncated, files };
}

export class Terminal {
  private input?: Interface;
  private readonly closed = new AbortController();
  private streaming = false;
  readonly interactive: boolean;
  private readonly color: boolean;

  constructor(readonly json: boolean, plain: boolean, private readonly abort: AbortController) {
    this.interactive = !json && Boolean(process.stdin.isTTY && process.stderr.isTTY);
    this.color = !json && !plain && Boolean(process.stderr.isTTY) && !Object.hasOwn(process.env, 'NO_COLOR');
  }

  private paint(value: string, style: number) {
    const text = printable(value);
    return this.color ? '\x1b[' + style + 'm' + text + '\x1b[0m' : text;
  }

  write(value: string) { process.stdout.write(printable(value) + '\n'); }

  result(value: unknown) { process.stdout.write(JSON.stringify(value, null, 2) + '\n'); }

  note(value: string) {
    if (!this.json) process.stderr.write(printable(value) + '\n');
  }

  heading(value: string) {
    if (!this.json) process.stderr.write(this.paint(value, 95) + '\n');
  }

  fragment(value: string) {
    if (this.json || !value) return;
    const text = printable(value);
    process.stdout.write(text);
    this.streaming = !text.endsWith('\n');
  }

  finishAnswer() {
    if (this.streaming) process.stdout.write('\n');
    this.streaming = false;
  }

  showContext(summary: ReturnType<typeof contextSummary>) {
    this.heading('Repository context · ' + summary.usedTokens + '/' + summary.budgetTokens + ' units · ' + summary.indexedFiles + ' files indexed');
    for (const file of summary.files) this.note('  ' + file.path + '#L' + file.startLine + '-L' + file.endLine + '  ' + file.reason);
    if (summary.truncated) this.note('  Some context was omitted to stay within the retrieval limits.');
  }

  diff(path: string, line: number, hunk: Hunk) {
    if (this.json) return;
    this.heading(path + ':' + line);
    for (const [value, prefix, style] of [[hunk.before, '-', 91], [hunk.after, '+', 92]] as const) {
      if (!value) continue;
      const lines = value.replace(/\r?\n$/, '').split(/\r?\n/);
      for (const text of lines) process.stderr.write(this.paint(prefix + ' ' + text, style) + '\n');
    }
  }

  async question(prompt: string): Promise<string> {
    if (!this.interactive || this.closed.signal.aborted || this.abort.signal.aborted) return '';
    if (!this.input) {
      this.input = createInterface({ input: process.stdin, output: process.stderr });
      this.input.on('SIGINT', () => this.abort.abort());
      this.input.once('close', () => this.closed.abort());
    }
    try {
      return (await this.input.question(prompt, { signal: AbortSignal.any([this.abort.signal, this.closed.signal]) })).trim();
    } catch (error) {
      if (this.abort.signal.aborted || this.closed.signal.aborted) return '';
      throw error;
    }
  }

  async confirm(prompt: string) { return /^y(?:es)?$/i.test(await this.question(prompt + ' [y/N] ')); }

  close() { this.input?.close(); }
}
