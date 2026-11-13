import { createHash } from 'node:crypto';

export function hash(content: string | Buffer): string { return createHash('sha256').update(content).digest('hex'); }
export function cancelled(signal?: AbortSignal): void { if (signal?.aborted) throw new Error('Run cancelled.'); }
export interface FileEntry { path: string; size: number; mtimeMs: number }
export interface FileSnapshot { path: string; content: string; hash: string }
export interface SearchHit { path: string; line: number; text: string }
export interface ContextChunk { path: string; startLine: number; endLine: number; content: string; reason: string; tokens: number; hash: string; declarations?: Array<{name: string; line: number}> }
export interface ContextResult { chunks: ContextChunk[]; usedTokens: number; budgetTokens: number; indexedFiles: number; truncated: boolean; selectionOnly?: boolean }
export interface Mention { kind: 'file' | 'symbol'; path: string; name?: string; line?: number }
export interface SelectionScope { path: string; hash: string; start: number; end: number }
export interface StageFile { path: string; beforeHash: string | null; content: string | null }
export type HunkDecision = 'pending' | 'accept' | 'reject';
export interface Hunk { id: string; start: number; end: number; before: string; after: string; decision: HunkDecision }
export interface ProposalFile { path: string; baseHash: string | null; original: string | null; proposed: string | null; hunks: Hunk[] }
export interface Proposal { id: string; runId: string; createdAt: number; state: 'pending' | 'applied' | 'rejected' | 'expired'; files: ProposalFile[] }
export interface ApplyResult { status: 'applied' | 'rejected'; checkpointId?: string; paths: string[] }
export interface ForgeEvent { type: string; [key: string]: unknown }
export interface AgentBinding { name: string; url: string; token: string }
