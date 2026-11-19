import type { CommandInput, CommandResult } from './commands.js';
import { hash, type ForgeEvent, type Proposal } from './types.js';

export type Workflow = 'ask' | 'plan' | 'build';
export type CheckPhase = 'baseline' | 'after' | 'agent';
export interface CheckRecord {
  input: CommandInput;
  phase: CheckPhase;
  durationMs: number;
  result: CommandResult;
  changedSource: string[];
  detectionPartial: boolean;
}

export interface RunEvidence {
  id: string;
  workflow: Workflow | 'inline';
  startedAt: number;
  finishedAt?: number;
  sessions: { id: string; model: string; purpose: 'run' | 'review'; turnIds?: string[] }[];
  checks: CheckRecord[];
  edits: { proposalId: string; checkpointId?: string; paths: string[] }[];
  usage: { tokens: number; measured: boolean; estimatedCost?: number };
  limits: { seconds?: number; tokens?: number; cost?: number; rate?: number };
  stopReason?: string;
}

export function observeTurn(evidence: RunEvidence, sessionId: string, event: ForgeEvent): void {
  if (event.type !== 'turn.created' || typeof event.turn_id !== 'string') return;
  const session = evidence.sessions.find(item => item.id === sessionId);
  if (!session) return;
  const ids = session.turnIds ??= [];
  if (!ids.includes(event.turn_id)) ids.push(event.turn_id);
}

export function observeUsage(evidence: RunEvidence, event: ForgeEvent, turn: { tokens: number }): void {
  if (event.type !== 'turn.update' && event.type !== 'turn.done') return;
  const state = event.state as {metrics?: {total_tokens?: unknown}} | undefined;
  const tokens = state?.metrics?.total_tokens;
  if (typeof tokens !== 'number' || !Number.isSafeInteger(tokens) || tokens < turn.tokens) return;
  evidence.usage.measured = true;
  evidence.usage.tokens += tokens - turn.tokens;
  turn.tokens = tokens;
  if (evidence.limits.rate !== undefined) evidence.usage.estimatedCost = evidence.usage.tokens * evidence.limits.rate / 1_000_000;
}

export function usageLimit(evidence: RunEvidence): string | undefined {
  const { limits, usage } = evidence;
  if (limits.tokens !== undefined && usage.tokens >= limits.tokens) return 'Reported token limit reached.';
  if (limits.cost !== undefined && usage.estimatedCost !== undefined && usage.estimatedCost >= limits.cost) return 'Estimated cost limit reached.';
}

export function completedCheck(record: CheckRecord): boolean {
  const { result } = record;
  return result.exitCode === 0 && !result.timedOut && !result.cancelled && result.cleanupConfirmed;
}

export function publicReceipt(evidence: RunEvidence, proposals: Proposal[], sessionUrl: (id: string) => string) {
  return {
    schema: 1,
    ...evidence,
    sessions: evidence.sessions.map(session => ({ ...session, url: sessionUrl(session.id) })),
    checks: evidence.checks.map(({ input, phase, durationMs, result, changedSource, detectionPartial }) => ({
      input, phase, durationMs, exitCode: result.exitCode, timedOut: result.timedOut, cancelled: result.cancelled,
      cleanupConfirmed: result.cleanupConfirmed, resultHash: hash(JSON.stringify([result.stdout, result.stderr])),
      truncated: result.truncated, changedSource, detectionPartial,
    })),
    proposals: proposals.filter(proposal => proposal.runId === evidence.id).map(proposal => ({
      id: proposal.id, state: proposal.state, files: proposal.files.map(file => ({
        path: file.path, baseHash: file.baseHash,
        hunks: file.hunks.map(hunk => ({
          id: hunk.id, start: hunk.start, end: hunk.end, decision: hunk.decision,
          beforeHash: hash(hunk.before), afterHash: hash(hunk.after),
        })),
      })),
    })),
  };
}
