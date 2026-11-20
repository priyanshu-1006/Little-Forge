import { printable } from './terminal.js';
import type { RunMode } from './run.js';

export type Tone = 'text' | 'muted' | 'accent' | 'user' | 'code' | 'add' | 'remove' | 'warning' | 'forge-silver' | 'forge-violet' | 'forge-lavender';
export type Entry = { tone: Tone; text: string; caption?: string };
type Part = { tone: Tone; text: string };
export type Line = Part & { parts?: Part[] };

// Terminal rendition of the silver L and the two violet strokes in the product icon.
const forgeMark = [
  ['  ▟██', '', ''],
  ['  ███', ' ▄██████████▀', ''],
  ['  ███', '▟███▀', ''],
  ['  ███', '██▀  ', '  ▟████▀'],
  ['  ██████████', '', '       ▀▀▀▀'],
  ['  ▀▀▀▀▀▀▀███', '', ''],
  ['         ▀██', '', ''],
] as const;

function welcome(width: number, height: number): Line[] {
  if (width < 58 || height < 8) {
    const compact: Line[] = [
      { tone: 'accent', text: '  Little Forge' },
      { tone: 'muted', text: clip('  Enter a task or press Ctrl+P.', width) },
    ];
    return compact.slice(0, height);
  }

  const copy = [
    '', 'Little Forge', 'Powered by TrueForge', '',
    'Tab       Switch modes', 'Ctrl+P    Browse commands', '@         Find files',
  ];
  return [{ tone: 'text', text: '' }, ...forgeMark.map(([silver, violet, lavender], index): Line => {
    const parts: Part[] = [
      { tone: 'text', text: '  ' },
      { tone: 'forge-silver', text: silver.padEnd(12) },
      { tone: 'forge-violet', text: violet },
      { tone: 'forge-lavender', text: lavender.padEnd(14 - violet.length) },
      { tone: index === 1 ? 'accent' : 'muted', text: '    ' + clip(copy[index], width - 32) },
    ];
    return { tone: 'text', text: parts.map(part => part.text).join(''), parts };
  })];
}

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const wide = /[\u1100-\u115f\u2329\u232a\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe6f\uff01-\uff60\uffe0-\uffe6\u{20000}-\u{3fffd}]|\p{Emoji_Presentation}|\p{Regional_Indicator}|\uFE0F/u;
const mark = /^[\p{Mark}\u200d]+$/u;

function cells(grapheme: string) {
  if (mark.test(grapheme)) return 0;
  return wide.test(grapheme) ? 2 : 1;
}

export function displayWidth(text: string): number {
  let width = 0;
  for (const { segment } of segmenter.segment(text)) width += cells(segment);
  return width;
}

export function clip(text: string, width: number): string {
  let result = '';
  for (const { segment } of segmenter.segment(text)) {
    width -= cells(segment);
    if (width < 0) break;
    result += segment;
  }
  return result;
}

export function cursorStops(text: string): number[] {
  return [...segmenter.segment(text)].map(item => item.index).concat(text.length);
}

/** Retain UTF-16 offsets for the cursor as a draft wraps into physical screen rows. */
function wrap(text: string, width: number) {
  const rows: Array<{ text: string; start: number }> = [{ text: '', start: 0 }];
  let column = 0;
  for (const { segment, index } of segmenter.segment(text)) {
    const token = segment === '\t' ? ' '.repeat(4 - column % 4) : segment;
    const next = segment === '\t' ? token.length : cells(token);
    if (segment === '\n' || (column && column + next > width)) {
      rows.push({ text: '', start: index + (segment === '\n' ? 1 : 0) });
      column = 0;
    }
    if (segment !== '\n') {
      rows[rows.length - 1].text += token;
      column += next;
    }
  }
  return rows;
}

function wrapProse(text: string, width: number) {
  const words = text.trim().split(/\s+/u);
  const rows: string[] = [];
  let current = '';
  for (const word of words) {
    if (current && displayWidth(current) + 1 + displayWidth(word) > width) {
      rows.push(current);
      current = '';
    }
    if (displayWidth(word) > width) {
      const pieces = wrap(word, width).map(row => row.text);
      current = pieces.pop() ?? '';
      rows.push(...pieces);
    } else {
      current += (current ? ' ' : '') + word;
    }
  }
  return rows.concat(current);
}

function entryLines(entry: Entry, width: number): Line[] {
  let code = false;
  const prefix = entry.tone === 'add' ? '+ ' : entry.tone === 'remove' ? '− ' : '';
  const lines: Line[] = entry.caption ? [{ tone: 'accent', text: entry.caption }] : [];
  const text = printable(entry.text);
  for (const line of text.split('\n')) {
    if (entry.caption === 'Little Forge' && /^\s*\x60{3}/.test(line)) {
      code = !code;
      const language = line.trim().slice(3).trim();
      if (code && language) lines.push({ tone: 'muted', text: '  ' + language });
      continue;
    }
    const indent = prefix.length || (code ? 2 : 0);
    const max = Math.max(1, width - indent);
    const rows = entry.caption === 'Little Forge' && !code && !/^\s/.test(line) ? wrapProse(line, max) : wrap(line, max).map(row => row.text);
    for (const [index, row] of rows.entries()) {
      lines.push({ tone: code ? 'code' : entry.tone, text: (index ? ' '.repeat(indent) : prefix || ' '.repeat(indent)) + row });
    }
  }
  return lines;
}

export const modes: readonly RunMode[] = ['ask', 'plan', 'build'];

export function frame(options: {
  width: number; height: number; root: string; mode: RunMode; model?: string; status: string;
  transcript: Entry[]; draft: string; cursor: number; scroll: number;
  choices: Array<{ label: string; detail: string; selected: boolean }>;
  question?: { title: string; confirm: boolean; allow: boolean };
}) {
  const { width, height, root, mode, model, status, transcript, draft, cursor, scroll, choices, question } = options;
  const lines: Line[] = [];
  const push = (tone: Tone, text: string) => lines.push({ tone, text: clip(printable(text).replace(/[\n\t]/g, ' '), width) });
  if (width < 27 || height < 9) {
    push('accent', 'Little Forge');
    push('muted', 'Enlarge the terminal.');
    push('muted', 'Ctrl+C stops or exits');
    return { lines, scroll: 0 };
  }

  const selected = modes.map(value => value === mode ? '[' + value.toUpperCase() + ']' : value.toUpperCase()).join('  ');
  const brand = 'LITTLE FORGE  /  TERMINAL';
  if (width >= brand.length + selected.length + 5) push('accent', brand + ' '.repeat(width - brand.length - selected.length - 2) + selected);
  else push('accent', 'Little Forge  ' + selected.replaceAll('  ', ' '));
  const modelText = model ?? 'Choose model with /models';
  const room = Math.max(7, width - displayWidth(modelText) - 4);
  push('muted', clip(root, room) + '  ·  ' + modelText);

  const commandRows = question ? 0 : Math.min(4, choices.length, Math.max(0, height - 10));
  const composer = question?.confirm
    ? [{ text: question.allow ? '[ Approve ]    Decline' : '  Approve    [ Decline ]', start: 0 }]
    : wrap(draft, width - 5);
  const nextRow = composer.findIndex(line => line.start > cursor);
  const row = nextRow < 0 ? composer.length - 1 : nextRow - 1;
  const maxRows = Math.min(4, Math.max(1, height - 10));
  const start = question?.confirm ? 0 : Math.max(0, row - maxRows + 1);
  const composerRows = composer.slice(start, start + maxRows);
  const transcriptHeight = Math.max(1, height - 6 - composerRows.length - commandRows);
  const view: Line[] = [];
  const contentWidth = width - 4;
  for (let index = transcript.length - 1; index >= 0 && view.length < transcriptHeight + scroll; index--) {
    const message = entryLines(transcript[index], contentWidth);
    if (view.length && transcript[index + 1].caption) message.push({ tone: 'text', text: '' });
    for (let line = message.length - 1; line >= 0; line--) view.push(message[line]);
  }
  const offset = Math.min(scroll, Math.max(0, view.length - transcriptHeight));
  const visible = view.slice(offset, offset + transcriptHeight).reverse();
  if (transcript.length) {
    for (const line of visible) push(line.tone, line.text ? '  ' + line.text : '');
  } else {
    lines.push(...welcome(width, transcriptHeight));
  }
  const transcriptEnd = transcriptHeight + 2;
  while (lines.length < transcriptEnd) push('text', '');
  push('muted', '─'.repeat(width - 1));
  push(question ? 'warning' : 'muted', '  ' + (question?.title ?? status) + (offset ? '  ·  Scrollback' : ''));
  for (const item of choices.slice(0, commandRows)) push(item.selected ? 'accent' : 'muted', '  ' + (item.selected ? '› ' : '  ') + item.label.padEnd(16) + item.detail);
  const first = lines.length;
  for (const [index, line] of composerRows.entries()) {
    const placeholder = !draft && !question && index === 0 ? 'Describe what you want to do' : '';
    push(question?.confirm ? 'warning' : placeholder ? 'muted' : 'text', (index === 0 ? '  › ' : '    ') + (placeholder || line.text));
  }
  push('muted', question?.confirm ? '  Y/N or ←/→ select   Enter confirms   PgUp reviews   Esc declines'
    : question ? '  Enter selects   PgUp reviews   Esc clears' : '  Enter send   Tab mode   Ctrl+P commands   Esc stop');
  const position = question?.confirm ? undefined : {
    row: first + Math.max(0, row - start) + 1,
    column: Math.min(width, 5 + displayWidth(wrap(draft.slice(composer[row].start, cursor), width - 5).at(-1)?.text ?? '')),
  };
  return { lines, cursor: position, scroll: offset };
}
