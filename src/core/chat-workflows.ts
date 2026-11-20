import type { CheckRecord } from './run-evidence.js';

interface SearchMessage {
  role: 'user' | 'assistant';
  text: string;
  attempt?: { error?: string; receipt?: { reviews: { paths: string[] }[]; checks: CheckRecord[] } };
}

export interface ChatMatch { id: string; messageIndex?: number; excerpt?: string }

export function branchMessages(messages: SearchMessage[], index: number): { role: 'user' | 'assistant'; text: string }[] {
  if (!Number.isInteger(index) || index < 0 || index >= messages.length) return [];
  return messages.slice(0, index + 1).filter(message => message.text.trim())
    .map(({ role, text }) => ({ role, text: text.slice(0, 16000) }));
}

export function shouldSendFollowUp(
  queue: { status: 'queued' | 'held'; waitingOn: string },
  status: string, completedAttempt: string | undefined, busy: boolean,
): boolean {
  return !busy && queue.status === 'queued' && status === 'completed' && queue.waitingOn === completedAttempt;
}

export function searchChats(query: string, chats: { id: string; title: string; messages: SearchMessage[] }[]): ChatMatch[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return chats.flatMap(chat => {
    for (let index = chat.messages.length - 1; index >= 0; index--) {
      const message = chat.messages[index];
      const receipt = message.attempt?.receipt;
      const fields = [message.text, message.attempt?.error, ...(receipt?.reviews.flatMap(review => review.paths) ?? []),
        ...(receipt?.checks.map(check => [check.input.task, ...(check.input.args ?? []), check.input.cwd].filter(Boolean).join(' ')) ?? [])];
      for (const field of fields) {
        const offset = field?.toLowerCase().indexOf(needle) ?? -1;
        if (field && offset >= 0) {
          const start = Math.max(0, offset - 26);
          const excerpt = (start ? '…' : '') + field.slice(start, offset + 90).replace(/\s+/g, ' ').trim();
          return [{ id: chat.id, messageIndex: index, excerpt }];
        }
      }
    }
    return chat.title.toLowerCase().includes(needle) ? [{ id: chat.id }] : [];
  }).slice(0, 50);
}

export function checkResult(check: CheckRecord): 'Passed' | 'Failed' | 'Timed out' | 'Cancelled' | 'Unconfirmed' {
  if (check.result.cancelled) return 'Cancelled';
  if (check.result.timedOut) return 'Timed out';
  if (check.result.exitCode == null || !check.result.cleanupConfirmed) return 'Unconfirmed';
  return check.result.exitCode === 0 ? 'Passed' : 'Failed';
}

export interface VerificationPair {
  baseline?: number;
  after?: number;
  label: string;
}

export function compareVerification(checks: CheckRecord[]): VerificationPair[] {
  const entries = new Map<string, { baseline?: number; after?: number }>();
  for (const [index, check] of checks.entries()) {
    if (check.phase === 'agent') continue;
    const { task, args, cwd } = check.input;
    const key = JSON.stringify([task, args ?? [], cwd ?? '.']);
    const pair = entries.get(key) ?? {};
    if (check.phase === 'baseline') entries.set(key, { baseline: index });
    else entries.set(key, { ...pair, after: index });
  }
  return [...entries.values()].map(pair => {
    const before = pair.baseline === undefined ? undefined : checkResult(checks[pair.baseline]);
    const after = pair.after === undefined ? undefined : checkResult(checks[pair.after]);
    let label: string;
    if (!before) label = 'No baseline recorded';
    else if (!after) label = 'After check missing';
    else if (!['Passed', 'Failed'].includes(before) || !['Passed', 'Failed'].includes(after)) label = 'Comparison inconclusive';
    else if (before === 'Failed' && after === 'Passed') label = 'Now passing';
    else if (before === 'Passed' && after === 'Failed') label = 'New failure';
    else label = before === 'Passed' ? 'Passed before and after' : 'Failed before and after';
    return { ...pair, label };
  });
}

export function redactShareText(text: string): string {
  return text
    .replace(/-----BEGIN [^-\r\n]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-\r\n]*PRIVATE KEY-----|$)/gi, '[redacted private key]')
    .replace(/\b(Bearer|Basic)\s+[\w./+~=-]{8,}/gi, '$1 [redacted]')
    .replace(/\b((?:[\w.-]*[_-])?(?:api[_-]?key|access[_-]?token|auth[_-]?token|password|secret|token))["']?\s*[:=]\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}&]+)/gi, '$1=[redacted]')
    .replace(/\b(?:sk[-_]|gsk_|hf_|gh[pousr]_|github_pat_|AIza|xox[baprs]-|AKIA)[\w-]{12,}/g, '[redacted]')
    .replace(/(https?:\/\/)[^\s/]+:[^\s/@]+@/gi, '$1[redacted]@')
    .replace(/\b(?:https?:\/\/)?(?:127\.0\.0\.1|localhost)(?::\d+)?\/sessions\/[^\s)\]}]+/gi, '[local session]');
}

function literal(text: string): string {
  const clean = redactShareText(text);
  const fenceSize = Math.max(3, ...Array.from(clean.matchAll(/`+/g), match => match[0].length + 1));
  const fence = '`'.repeat(fenceSize);
  return `${fence}text\n${clean.trim()}\n${fence}`;
}

export function shareRunSummary(data: { prompt?: string; reply?: string; paths: string[]; checks: CheckRecord[] }): string {
  const parts = ['# Little Forge run summary'];
  if (data.prompt?.trim()) parts.push('## Request', literal(data.prompt));
  if (data.reply?.trim()) parts.push('## Result', literal(data.reply));
  if (data.paths.length) parts.push('## Applied files', literal([...new Set(data.paths)].join('\n')));
  if (data.checks.length) {
    const rows = data.checks.map(check => {
      const name = [check.input.task, ...(check.input.args ?? [])].join(' ');
      return `${check.phase} | ${checkResult(check)} | exit ${check.result.exitCode ?? 'unavailable'} | ${name}${check.input.cwd ? ` (${check.input.cwd})` : ''}`;
    });
    parts.push('## Verification', literal(rows.join('\n')));
    const comparisons = compareVerification(data.checks).filter(pair => pair.baseline !== undefined && pair.after !== undefined);
    if (comparisons.length) parts.push('## Baseline comparison', literal(comparisons.map(pair => {
      const input = data.checks[pair.after!].input;
      return `${[input.task, ...(input.args ?? [])].join(' ')} | ${pair.label}`;
    }).join('\n')));
  }
  if (parts.length === 1) parts.push('No applied changes or checks were recorded for this turn.');
  return parts.join('\n\n') + '\n';
}
