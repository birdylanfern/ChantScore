import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGabc } from '@/src/lib/gabc/parser';
import {
  DEFAULT_TEMPO_BPM,
  MAX_TEMPO_BPM,
  MIN_TEMPO_BPM,
  buildChantTimeline,
  clampTempoBpm,
  findNextTimelineEventAtOrAfter,
  findTimelineEventAtTime,
  findTimelineEventForSelection,
} from '@/src/lib/audio/chantTimeline';
import {
  findNoteInfoForSelection,
  moveNoteSelection,
} from '@/src/lib/notation/noteNavigation';
import { DEFAULT_PREFS, loadWorkspacePrefs, saveWorkspacePrefs } from '@/src/lib/workspacePrefs';

test('tempo constants and clamping support 40..200 BPM with default 140', () => {
  assert.equal(MIN_TEMPO_BPM, 40);
  assert.equal(DEFAULT_TEMPO_BPM, 140);
  assert.equal(MAX_TEMPO_BPM, 200);
  assert.equal(DEFAULT_PREFS.tempoBpm, 140);

  assert.equal(clampTempoBpm(10), 40);
  assert.equal(clampTempoBpm(140), 140);
  assert.equal(clampTempoBpm(200), 200);
  assert.equal(clampTempoBpm(280), 200);
  assert.equal(clampTempoBpm(Number.NaN), 140);
});

test('buildChantTimeline scales note duration at default 140 BPM and up to 200 BPM', () => {
  const score = parseGabc('name: Test;\n%%\n(c4) Al(f)le(gh)lu(h)ia.(h)');
  const defaultTl = buildChantTimeline(score);
  const explicit140 = buildChantTimeline(score, 140);
  const fastTl = buildChantTimeline(score, 200);

  assert.equal(defaultTl.events.length, explicit140.events.length);
  assert.ok(Math.abs(defaultTl.events[0].durationSec - 60 / 140) < 1e-6);
  assert.ok(Math.abs(fastTl.events[0].durationSec - 60 / 200) < 1e-6);
  assert.ok(fastTl.totalDurationSec < defaultTl.totalDurationSec);
});

test('workspacePrefs persists and clamps tempoBpm in 40..200', () => {
  const prevDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
      clear: () => store.clear(),
    },
  });

  try {
    assert.equal(loadWorkspacePrefs().tempoBpm, 140);
    saveWorkspacePrefs({ ...DEFAULT_PREFS, tempoBpm: 192 });
    assert.equal(loadWorkspacePrefs().tempoBpm, 192);

    saveWorkspacePrefs({ ...DEFAULT_PREFS, tempoBpm: 250 });
    assert.equal(loadWorkspacePrefs().tempoBpm, 140);
  } finally {
    if (prevDescriptor) {
      Object.defineProperty(globalThis, 'localStorage', prevDescriptor);
    } else {
      delete (globalThis as Record<string, unknown>).localStorage;
    }
  }
});

test('moveNoteSelection traverses notes from null, non-note items, and adjacent notes', () => {
  const score = parseGabc('name: Nav;\n%%\n(c4) Ky(f)ri(g)e(h) (,) e(i)le(h)i(g)son.(f)');
  const clefItem = score.items.find((it) => it.kind === 'clef')!;
  const divItem = score.items.find((it) => it.kind === 'division')!;

  assert.equal(moveNoteSelection(score, null, 1), null);
  const first = moveNoteSelection(score, null, 1, { selectBoundaryWhenEmpty: true });
  assert.ok(first?.noteId);
  const second = moveNoteSelection(score, first, 1);
  assert.ok(second?.noteId && second.noteId !== first.noteId);
  const backToFirst = moveNoteSelection(score, second, -1);
  assert.equal(backToFirst?.noteId, first.noteId);

  const last = moveNoteSelection(score, null, -1, { selectBoundaryWhenEmpty: true });
  assert.ok(last?.noteId && last.noteId !== first.noteId);

  const fromClefForward = moveNoteSelection(score, { itemId: clefItem.id }, 1, {
    selectBoundaryWhenEmpty: true,
  });
  assert.equal(fromClefForward?.noteId, first.noteId);

  const afterDiv = moveNoteSelection(score, { itemId: divItem.id }, 1, {
    selectBoundaryWhenEmpty: true,
  });
  const beforeDiv = moveNoteSelection(score, { itemId: divItem.id }, -1, {
    selectBoundaryWhenEmpty: true,
  });
  assert.ok(afterDiv?.noteId && beforeDiv?.noteId);
  assert.notEqual(afterDiv.noteId, beforeDiv.noteId);
});

test('findNoteInfoForSelection resolves clef, key-signature flat, modal accidentals, and division resets', () => {
  const score = parseGabc('name: Acc;\n%%\n(c4) A(ixgi) B(i) (,) C(i) (cb4) D(i) E(iyhi) F(i)');
  const syllables = score.items.filter((it) => it.kind === 'syllable');

  const noteA = syllables[0].groups[0].notes[2]; // i after ix
  const noteB = syllables[1].groups[0].notes[0]; // inherits flat
  const noteC = syllables[2].groups[0].notes[0]; // after comma division, flat resets
  const noteD = syllables[3].groups[0].notes[0]; // under cb4, B has key flat
  const noteE = syllables[4].groups[0].notes[2]; // i after iy natural

  const infoA = findNoteInfoForSelection(score, { itemId: syllables[0].id, groupId: syllables[0].groups[0].id, noteId: noteA.id });
  const infoB = findNoteInfoForSelection(score, { itemId: syllables[1].id, groupId: syllables[1].groups[0].id, noteId: noteB.id });
  const infoC = findNoteInfoForSelection(score, { itemId: syllables[2].id, groupId: syllables[2].groups[0].id, noteId: noteC.id });
  const infoD = findNoteInfoForSelection(score, { itemId: syllables[3].id, groupId: syllables[3].groups[0].id, noteId: noteD.id });
  const infoE = findNoteInfoForSelection(score, { itemId: syllables[4].id, groupId: syllables[4].groups[0].id, noteId: noteE.id });

  assert.equal(infoA?.clef, 'c4');
  assert.equal(infoA?.effectiveAccidental, 'flat');
  assert.equal(infoB?.effectiveAccidental, 'flat');
  assert.equal(infoC?.effectiveAccidental, null);
  assert.equal(infoD?.clef, 'cb4');
  assert.equal(infoD?.effectiveAccidental, 'flat');
  assert.equal(infoE?.effectiveAccidental, null);
});

test('timeline helpers resolve selected note for resume and active playing note at timestamps', () => {
  const score = parseGabc('name: Resume;\n%%\n(c4) A(ixgh) B(h) (,) C(g)');
  const timeline = buildChantTimeline(score, 140);
  const syllables = score.items.filter((it) => it.kind === 'syllable');
  const clefItem = score.items.find((it) => it.kind === 'clef')!;

  const accNote = syllables[0].groups[0].notes[0]; // ix (accidentalOnly)
  const gNote = syllables[0].groups[0].notes[1]; // g
  const hNote = syllables[0].groups[0].notes[2]; // h
  const bNote = syllables[1].groups[0].notes[0]; // h
  const cNote = syllables[2].groups[0].notes[0]; // g after comma

  // Boundary between notes picks the note starting at that exact time
  const evH = timeline.events.find((e) => e.noteId === hNote.id)!;
  assert.equal(findTimelineEventAtTime(timeline, evH.startSec)?.noteId, hNote.id);

  // Mid-gap after B's end (comma division pause) returns null for active, C for next
  const evB = timeline.events.find((e) => e.noteId === bNote.id)!;
  const gapSec = evB.startSec + evB.durationSec + 0.08;
  assert.equal(findTimelineEventAtTime(timeline, gapSec), null);
  assert.equal(findNextTimelineEventAtOrAfter(timeline, gapSec)?.noteId, cNote.id);

  // Selection lookup returns the selected note (single or earliest of multi-select)
  assert.equal(
    findTimelineEventForSelection(score, timeline, {
      itemId: syllables[1].id,
      groupId: syllables[1].groups[0].id,
      noteId: bNote.id,
    })?.noteId,
    bNote.id
  );
  assert.equal(
    findTimelineEventForSelection(score, timeline, {
      itemId: syllables[2].id,
      groupId: syllables[2].groups[0].id,
      noteId: cNote.id,
      selectedNotes: [
        { itemId: syllables[0].id, groupId: syllables[0].groups[0].id, noteId: hNote.id },
        { itemId: syllables[2].id, groupId: syllables[2].groups[0].id, noteId: cNote.id },
      ],
    })?.noteId,
    hNote.id
  );

  // Accidental-only selection falls back to first sounding note in its group
  assert.equal(
    findTimelineEventForSelection(score, timeline, {
      itemId: syllables[0].id,
      groupId: syllables[0].groups[0].id,
      noteId: accNote.id,
    })?.noteId,
    gNote.id
  );

  // Non-note selection returns null so resume falls back to paused elapsed time
  assert.equal(findTimelineEventForSelection(score, timeline, { itemId: clefItem.id }), null);
  assert.equal(findTimelineEventForSelection(score, timeline, null), null);
});
