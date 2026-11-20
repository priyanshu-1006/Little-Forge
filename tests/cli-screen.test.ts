import test from 'node:test';
import assert from 'node:assert/strict';
import { clip, cursorStops, displayWidth, frame } from '../packages/cli/src/screen.js';

const base = {
  width: 44, height: 16, root: 'Flask', mode: 'build' as const, status: 'Ready',
  transcript: [], draft: '', cursor: 0, scroll: 0, choices: [],
};

test('the welcome mark fits the viewport and yields to the conversation', () => {
  const wide = frame({ ...base, width: 80, height: 24 });
  const parts = wide.lines.flatMap(line => line.parts ?? []);
  assert.ok(parts.some(part => part.tone === 'forge-silver' && part.text.includes('██')));
  assert.ok(parts.some(part => part.tone === 'forge-violet' && part.text.includes('██')));
  assert.ok(wide.lines.every(line => displayWidth(line.text) <= 80));
  assert.ok(frame(base).lines.every(line => !line.parts));
  const active = frame({ ...base, width: 80, transcript: [{ tone: 'text', text: 'A reply' }] });
  assert.ok(active.lines.every(line => !line.parts));
});

test('the terminal wraps graphemes without splitting emoji and keeps a multiline cursor inside the frame', () => {
  assert.deepEqual(cursorStops('x👩‍💻é'), [0, 1, 6, 7]);
  assert.equal(displayWidth('x👩‍💻é'), 4);
  assert.equal(clip('x👩‍💻é', 3), 'x👩‍💻');
  const draft = 'First line\n' + '文'.repeat(35) + '\nLast line';
  const result = frame({ ...base, draft, cursor: draft.length });
  assert.ok(result.cursor && result.cursor.row < base.height && result.cursor.column <= base.width);
  assert.ok(result.lines.every(line => displayWidth(line.text) <= base.width));
});

test('review remains distinct from tool output and displays the default decline selection', () => {
  const result = frame({
    ...base,
    transcript: [
      { tone: 'remove', text: 'return false' },
      { tone: 'add', text: '\x1b[2Jreturn true' },
    ],
    question: { title: 'Accept this hunk?', confirm: true, allow: false },
  });
  assert.equal(result.cursor, undefined);
  assert.ok(result.lines.some(line => line.tone === 'add' && line.text.includes('return true')));
  assert.ok(result.lines.some(line => line.text.includes('[ Decline ]')));
  assert.ok(result.lines.every(line => !line.text.includes('\x1b')));
});
