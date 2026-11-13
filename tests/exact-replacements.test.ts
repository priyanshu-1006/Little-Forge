import test from 'node:test';
import assert from 'node:assert/strict';
import { applyExactReplacements } from '../src/core/exact-replacements.js';

test('LF multiline oldText matches CRLF source and inserted text keeps CRLF without changing outside bytes', () => {
  const prefix = '\uFEFF# 😀 prefix\r\n', suffix = '\r\n# unchanged suffix\r\n';
  const source = prefix + 'def flag():\r\n    return False\r\n' + suffix;
  const result = applyExactReplacements(source, [{ oldText: 'def flag():\n    return False\n', newText: 'def flag():\n    """Updated."""\n    return True\n' }]);
  assert.equal(result, prefix + 'def flag():\r\n    """Updated."""\r\n    return True\r\n' + suffix);
  assert.deepEqual(Buffer.from(result.slice(0, prefix.length)), Buffer.from(prefix));
  assert.deepEqual(Buffer.from(result.slice(-suffix.length)), Buffer.from(suffix));
  assert.ok(!/(?<!\r)\n/.test(result));
});

test('LF source accepts CRLF model text and keeps LF for replacement lines', () => {
  assert.equal(applyExactReplacements('before\none\ntwo\nafter\n', [{ oldText: 'one\r\ntwo', newText: 'ONE\r\nTWO\r\nTHREE' }]), 'before\nONE\nTWO\nTHREE\nafter\n');
  assert.equal(applyExactReplacements('one\r\ntwo', [{ oldText: 'one\ntwo', newText: 'ONE\r\nTWO' }]), 'ONE\r\nTWO');
});

test('normalized copies and overlapping matches are ambiguous even when one raw match is unique', () => {
  assert.throws(() => applyExactReplacements('one\r\ntwo|one\ntwo', [{ oldText: 'one\r\ntwo', newText: 'changed' }]), /match exactly once/);
  assert.throws(() => applyExactReplacements('a\r\na\r\na', [{ oldText: 'a\na', newText: 'changed' }]), /match exactly once/);
  assert.throws(() => applyExactReplacements('same same', [{ oldText: 'same', newText: 'changed' }]), /match exactly once/);
});

test('matching never relaxes indentation, spaces, case, quotes, or bare carriage returns', () => {
  for (const oldText of ['one\n  two', 'ONE\n    two', 'one \n    two', 'one\r    two']) assert.throws(() => applyExactReplacements('one\r\n    two', [{ oldText, newText: 'changed' }]), /match exactly once/);
  assert.throws(() => applyExactReplacements('value = "one"\r\n', [{ oldText: "value = 'one'", newText: 'changed' }]), /match exactly once/);
  assert.throws(() => applyExactReplacements('one\r\ntwo', [{ oldText: '\r', newText: '' }]), /match exactly once/);
  assert.equal(applyExactReplacements('one\rtwo', [{ oldText: 'one\rtwo', newText: 'changed' }]), 'changed');
  assert.throws(() => applyExactReplacements('source', [{ oldText: '', newText: 'insert' }]), /match exactly once/);
});

test('sequential replacements can match newly inserted lines while preserving EOL style', () => {
  assert.equal(applyExactReplacements('prefix\r\none\r\ntwo\r\nsuffix', [
    { oldText: 'one\ntwo', newText: 'ONE\ninserted\nTWO' },
    { oldText: 'inserted\nTWO', newText: 'middle\r\nlast' },
  ]), 'prefix\r\nONE\r\nmiddle\r\nlast\r\nsuffix');
});

test('substring replacements use their own line style in a mixed-ending file', () => {
  const source = 'first value\r\nsecond value\nlast value';
  assert.equal(applyExactReplacements(source, [{ oldText: 'first value', newText: 'FIRST\nvalue' }]), 'FIRST\r\nvalue\r\nsecond value\nlast value');
  assert.equal(applyExactReplacements(source, [{ oldText: 'second value', newText: 'SECOND\r\nvalue' }]), 'first value\r\nSECOND\nvalue\nlast value');
  assert.equal(applyExactReplacements(source, [{ oldText: 'last value', newText: 'LAST\nvalue' }]), 'first value\r\nsecond value\nLAST\nvalue');
  assert.equal(applyExactReplacements('plain', [{ oldText: 'plain', newText: 'first\r\nsecond' }]), 'first\nsecond');
});

test('mixed-ending spans require splitting when inserting line breaks, but deletion stays exact', () => {
  const source = 'prefix\r\none\r\ntwo\nthree\r\nsuffix';
  assert.throws(() => applyExactReplacements(source, [{ oldText: 'one\ntwo\nthree', newText: 'ONE\ntwo\nthree' }]), /mixed LF\/CRLF.*Split/);
  assert.equal(applyExactReplacements(source, [{ oldText: 'one\ntwo\nthree', newText: 'combined' }]), 'prefix\r\ncombined\r\nsuffix');
  assert.equal(applyExactReplacements(source, [{ oldText: 'one\ntwo\nthree', newText: '' }]), 'prefix\r\n\r\nsuffix');
});
