export interface ExactReplacement { oldText: string; newText: string }
const UNIQUE_MATCH = 'Each oldText must match exactly once (LF and CRLF line separators are equivalent); include enough surrounding source.';

/** Only CRLF/LF separators are equivalent. Spaces, indentation, case, quotes and bare CR stay literal. */
function canonical(text: string): string { return text.replace(/\r\n/g, '\n'); }

/** Map normalized UTF-16 boundaries back to complete original separators without changing source bytes. */
function rawRange(source: string, start: number, end: number): { start: number; end: number } {
  let raw = 0, normalized = 0, rawStart = 0;
  while (normalized <= end) {
    if (normalized === start) rawStart = raw;
    if (normalized === end) return { start: rawStart, end: raw };
    raw += source[raw] === '\r' && source[raw + 1] === '\n' ? 2 : 1;
    normalized++;
  }
  throw new Error('The replacement source range is invalid.');
}

function insertionEol(source: string, start: number, end: number): '\r\n' | '\n' {
  const endings = new Set(source.slice(start, end).match(/\r\n|\n/g) ?? []);
  if (endings.size > 1) throw new Error('The matched source span has mixed LF/CRLF line endings. Split this replacement into spans with consistent line endings.');
  if (endings.has('\r\n')) return '\r\n';
  if (endings.has('\n')) return '\n';
  // A substring edit follows its containing line. An unterminated last line follows the preceding line.
  const next = source.indexOf('\n', start);
  const nearest = next >= 0 ? next : source.lastIndexOf('\n', start - 1);
  return nearest > 0 && source[nearest - 1] === '\r' ? '\r\n' : '\n';
}

/** Sequential exact replacements preserve untouched text and the source's local line-ending convention. */
export function applyExactReplacements(source: string, edits: readonly ExactReplacement[]): string {
  let current = source;
  for (const edit of edits) {
    if (typeof edit.oldText !== 'string' || !edit.oldText.length || typeof edit.newText !== 'string') throw new Error(UNIQUE_MATCH);
    const normalized = canonical(current), needle = canonical(edit.oldText);
    const at = normalized.indexOf(needle);
    // Check every normalized occurrence, including overlaps and copies with different raw EOL styles.
    if (at < 0 || normalized.indexOf(needle, at + 1) >= 0) throw new Error(UNIQUE_MATCH);
    const range = rawRange(current, at, at + needle.length);
    const inserted = edit.newText.includes('\n') ? canonical(edit.newText).replace(/\n/g, insertionEol(current, range.start, range.end)) : edit.newText;
    current = current.slice(0, range.start) + inserted + current.slice(range.end);
  }
  return current;
}
