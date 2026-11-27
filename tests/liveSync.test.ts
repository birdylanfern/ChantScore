import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createLiveGabcController,
  evaluateLiveGabcDraft,
  HISTORY_COALESCE_PAUSE_MS,
  LIVE_PARSE_DEBOUNCE_MS,
  resolveIncomingGabcSync,
  shouldRecordTypingHistory,
} from '@/src/lib/gabc/liveSync';

const VALID_A = 'name: Test;\n%%\n(c4) Al(f)le(g)lu(h)ia.(g.)\n';
const VALID_B = 'name: Test;\n%%\n(c4) Al(f)le(g)lu(h)ia(i) Dó(h)mi(g)ne.(g.)\n';
const INVALID_GABC = 'name: Test;\n%%\n(c4) Al(f';

test('evaluateLiveGabcDraft commits valid changed GABC and skips unchanged raw text', () => {
  const first = evaluateLiveGabcDraft(VALID_A, null);
  assert.equal(first.valid, true);
  assert.equal(first.shouldCommit, true);
  assert.ok(first.score);
  assert.ok(first.normalizedGabc);

  const same = evaluateLiveGabcDraft(VALID_A, VALID_A);
  assert.equal(same.valid, true);
  assert.equal(same.shouldCommit, false);
  assert.equal(same.score, null);
});

test('evaluateLiveGabcDraft keeps score null and returns line diagnostics when invalid', () => {
  const bad = evaluateLiveGabcDraft(INVALID_GABC, VALID_A);
  assert.equal(bad.valid, false);
  assert.equal(bad.shouldCommit, false);
  assert.equal(bad.score, null);
  assert.ok(bad.errors.length >= 1);
  assert.equal(bad.errors[0].line, 3);
});

test('resolveIncomingGabcSync suppresses self-echo and protects focused editor', () => {
  assert.equal(
    resolveIncomingGabcSync({
      nextSyncedGabc: VALID_A,
      prevSyncedGabc: VALID_A,
      hasFocus: false,
      lastSelfSyncedGabc: null,
    }),
    'ignore'
  );

  assert.equal(
    resolveIncomingGabcSync({
      nextSyncedGabc: VALID_B,
      prevSyncedGabc: VALID_A,
      hasFocus: false,
      lastSelfSyncedGabc: VALID_B,
    }),
    'ignore-self-echo',
    'self-committed change never bounces back into textarea'
  );

  assert.equal(
    resolveIncomingGabcSync({
      nextSyncedGabc: VALID_B,
      prevSyncedGabc: VALID_A,
      hasFocus: true,
      lastSelfSyncedGabc: null,
    }),
    'defer-focused',
    'external changes do not rewrite textarea while focused'
  );

  assert.equal(
    resolveIncomingGabcSync({
      nextSyncedGabc: VALID_B,
      prevSyncedGabc: VALID_A,
      hasFocus: false,
      lastSelfSyncedGabc: null,
    }),
    'apply-external'
  );
});

test('shouldRecordTypingHistory coalesces bursts shorter than 800 ms', () => {
  assert.equal(shouldRecordTypingHistory(null, 1000), true);
  assert.equal(shouldRecordTypingHistory(1000, 1000 + LIVE_PARSE_DEBOUNCE_MS), false);
  assert.equal(shouldRecordTypingHistory(1000, 1000 + HISTORY_COALESCE_PAUSE_MS - 1), false);
  assert.equal(shouldRecordTypingHistory(1000, 1000 + HISTORY_COALESCE_PAUSE_MS), true);
});

test('createLiveGabcController manages parse/commit, no-loop echo suppression, error recovery, and coalescing', () => {
  const ctrl = createLiveGabcController(VALID_A);

  // 1. User types invalid GABC: score must not commit, text stays intact
  ctrl.onUserDraftChange(INVALID_GABC);
  const invalidFlush = ctrl.flushDraftParse(1000);
  assert.equal(invalidFlush.evaluation.valid, false);
  assert.equal(invalidFlush.evaluation.shouldCommit, false);
  assert.equal(ctrl.getState().draft, INVALID_GABC);

  // 2. User finishes typing valid GABC: commits and records first history step
  ctrl.onUserDraftChange(VALID_B);
  const validFlush = ctrl.flushDraftParse(1400);
  assert.equal(validFlush.evaluation.valid, true);
  assert.equal(validFlush.evaluation.shouldCommit, true);
  assert.equal(validFlush.recordHistory, true);
  const normalizedB = validFlush.evaluation.normalizedGabc!;

  // 3. Parent echoes syncedGabc back -> suppressed (no cursor jump / feedback loop)
  const echo = ctrl.onExternalSyncedGabc(normalizedB, true);
  assert.equal(echo.action, 'ignore-self-echo');
  assert.equal(echo.nextDraft, null);

  // 4. Another keystroke within 800ms -> commits without creating a new Undo entry
  const validC = 'name: Test;\n%%\n(c4) Al(f)le(g)lu(h)ia(i) Dó(h)mi(g)ne.(f.)\n';
  ctrl.onUserDraftChange(validC);
  const coalescedFlush = ctrl.flushDraftParse(1900);
  assert.equal(coalescedFlush.evaluation.valid, true);
  assert.equal(coalescedFlush.evaluation.shouldCommit, true);
  assert.equal(coalescedFlush.recordHistory, false);

  // 5. After an >= 800ms pause, next edit creates a fresh history entry
  const validD = 'name: Test;\n%%\n(c4) Al(f)le(g)lu(h)ia(i) Dó(h)mi(g)ne.(g.)\n';
  ctrl.onUserDraftChange(validD);
  const freshFlush = ctrl.flushDraftParse(2800);
  assert.equal(freshFlush.recordHistory, true);

  // 6. External change while focused is deferred until blur, then applied
  const extWhileFocused = ctrl.onExternalSyncedGabc(VALID_A, true);
  assert.equal(extWhileFocused.action, 'defer-focused');
  assert.equal(extWhileFocused.nextDraft, null);
  const onBlurRes = ctrl.onEditorBlur();
  assert.equal(onBlurRes.nextDraft, VALID_A);
  assert.equal(ctrl.getState().draft, VALID_A);
});
