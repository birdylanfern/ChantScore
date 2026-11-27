import { ChantScore } from '@/src/types/chant';
import { parseGabc } from './parser';
import { serializeGabc } from './serializer';
import { GabcDiagnostic, validateGabc } from './validator';

export interface LiveGabcEvaluation {
  valid: boolean;
  shouldCommit: boolean;
  score: ChantScore | null;
  normalizedGabc: string | null;
  errors: GabcDiagnostic[];
  warnings: GabcDiagnostic[];
}

export interface IncomingSyncDecisionInput {
  nextSyncedGabc: string;
  prevSyncedGabc: string;
  hasFocus: boolean;
  lastSelfSyncedGabc: string | null;
}

export type IncomingSyncDecision =
  | 'ignore'
  | 'ignore-self-echo'
  | 'defer-focused'
  | 'apply-external';

export const LIVE_PARSE_DEBOUNCE_MS = 300;
export const HISTORY_COALESCE_PAUSE_MS = 800;

/**
 * Validate and parse a GABC draft for live score updates.
 * When invalid, returns `score: null` and `shouldCommit: false` so the caller
 * preserves the last good score and keeps the user's text intact.
 */
export function evaluateLiveGabcDraft(
  raw: string,
  lastCommittedRaw: string | null
): LiveGabcEvaluation {
  const validation = validateGabc(raw);
  if (!validation.valid) {
    return {
      valid: false,
      shouldCommit: false,
      score: null,
      normalizedGabc: null,
      errors: validation.errors,
      warnings: validation.warnings,
    };
  }

  if (lastCommittedRaw !== null && raw === lastCommittedRaw) {
    return {
      valid: true,
      shouldCommit: false,
      score: null,
      normalizedGabc: null,
      errors: [],
      warnings: validation.warnings,
    };
  }

  try {
    const score = parseGabc(raw);
    const normalizedGabc = serializeGabc(score);
    return {
      valid: true,
      shouldCommit: true,
      score,
      normalizedGabc,
      errors: [],
      warnings: validation.warnings,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Could not parse GABC.';
    return {
      valid: false,
      shouldCommit: false,
      score: null,
      normalizedGabc: null,
      errors: [{ severity: 'error', line: 1, column: 1, start: 0, end: 1, message: msg }],
      warnings: validation.warnings,
    };
  }
}

/**
 * Decide how an incoming `syncedGabc` prop update should affect the GABC
 * textarea. Prevents feedback loops when the change came from the user's own
 * live commit, and avoids rewriting while the textarea holds focus.
 */
export function resolveIncomingGabcSync(
  input: IncomingSyncDecisionInput
): IncomingSyncDecision {
  if (input.nextSyncedGabc === input.prevSyncedGabc) {
    return 'ignore';
  }
  if (
    input.lastSelfSyncedGabc !== null &&
    input.nextSyncedGabc === input.lastSelfSyncedGabc
  ) {
    return 'ignore-self-echo';
  }
  if (input.hasFocus) {
    return 'defer-focused';
  }
  return 'apply-external';
}

/**
 * Return true when enough time has elapsed since the previous typing edit
 * (default ~800 ms) that the next live commit should start a fresh Undo step.
 */
export function shouldRecordTypingHistory(
  lastTypingCommitAtMs: number | null,
  nowMs: number,
  coalescePauseMs = HISTORY_COALESCE_PAUSE_MS
): boolean {
  if (lastTypingCommitAtMs === null) return true;
  return nowMs - lastTypingCommitAtMs >= coalescePauseMs;
}

export interface LiveGabcController {
  getState: () => {
    draft: string;
    lastSyncedGabc: string;
    lastCommittedRaw: string | null;
    lastSelfSyncedGabc: string | null;
    lastTypingAtMs: number | null;
    pendingExternalGabc: string | null;
  };
  onUserDraftChange: (nextDraft: string) => void;
  flushDraftParse: (nowMs: number) => {
    evaluation: LiveGabcEvaluation;
    recordHistory: boolean;
  };
  onExternalSyncedGabc: (
    nextSyncedGabc: string,
    hasFocus: boolean
  ) => { action: IncomingSyncDecision; nextDraft: string | null };
  onEditorBlur: () => { nextDraft: string | null };
  resetCoalescing: () => void;
}

/**
 * Stateful plain controller encapsulating live parse/commit, no-loop echo
 * suppression, focus protection, and typing history coalescing.
 */
export function createLiveGabcController(initialSyncedGabc: string): LiveGabcController {
  let draft = initialSyncedGabc;
  let lastSyncedGabc = initialSyncedGabc;
  let lastCommittedRaw: string | null = initialSyncedGabc;
  let lastSelfSyncedGabc: string | null = null;
  let lastTypingAtMs: number | null = null;
  let pendingExternalGabc: string | null = null;

  return {
    getState: () => ({
      draft,
      lastSyncedGabc,
      lastCommittedRaw,
      lastSelfSyncedGabc,
      lastTypingAtMs,
      pendingExternalGabc,
    }),
    onUserDraftChange: (nextDraft: string) => {
      draft = nextDraft;
      pendingExternalGabc = null;
    },
    flushDraftParse: (nowMs: number) => {
      const evaluation = evaluateLiveGabcDraft(draft, lastCommittedRaw);
      let recordHistory = false;
      if (evaluation.valid && evaluation.shouldCommit) {
        recordHistory = shouldRecordTypingHistory(lastTypingAtMs, nowMs);
        lastTypingAtMs = nowMs;
        lastCommittedRaw = draft;
        lastSelfSyncedGabc = evaluation.normalizedGabc;
      }
      return { evaluation, recordHistory };
    },
    onExternalSyncedGabc: (nextSyncedGabc: string, hasFocus: boolean) => {
      const decision = resolveIncomingGabcSync({
        nextSyncedGabc,
        prevSyncedGabc: lastSyncedGabc,
        hasFocus,
        lastSelfSyncedGabc,
      });
      lastSyncedGabc = nextSyncedGabc;

      if (decision === 'ignore-self-echo') {
        lastSelfSyncedGabc = null;
        return { action: decision, nextDraft: null };
      }
      if (decision === 'defer-focused') {
        pendingExternalGabc = nextSyncedGabc;
        return { action: decision, nextDraft: null };
      }
      if (decision === 'apply-external') {
        draft = nextSyncedGabc;
        lastCommittedRaw = nextSyncedGabc;
        lastSelfSyncedGabc = null;
        lastTypingAtMs = null;
        pendingExternalGabc = null;
        return { action: decision, nextDraft: nextSyncedGabc };
      }
      return { action: decision, nextDraft: null };
    },
    onEditorBlur: () => {
      if (pendingExternalGabc !== null && pendingExternalGabc !== draft) {
        const next = pendingExternalGabc;
        draft = next;
        lastCommittedRaw = next;
        lastSelfSyncedGabc = null;
        lastTypingAtMs = null;
        pendingExternalGabc = null;
        return { nextDraft: next };
      }
      pendingExternalGabc = null;
      return { nextDraft: null };
    },
    resetCoalescing: () => {
      lastTypingAtMs = null;
    },
  };
}
