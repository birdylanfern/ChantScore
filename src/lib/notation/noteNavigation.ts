import { AccidentalType, ChantNote, ChantScore, ClefType, SelectionState } from '@/src/types/chant';
import { parseClefConfig, resolvePitch } from '@/src/lib/gabc/pitch';
import { getOrderedScoreNotes } from './scoreMutations';

/**
 * Move the single-note selection to the previous/next note in score order
 * (keyboard navigation). If no note is selected yet, ArrowRight selects the
 * first note (or first note after a selected non-note item) and ArrowLeft
 * selects the last note (or nearest preceding note).
 */
export function moveNoteSelection(
  score: ChantScore,
  selection: SelectionState | null,
  delta: -1 | 1,
  options?: { selectBoundaryWhenEmpty?: boolean }
): SelectionState | null {
  const ordered = getOrderedScoreNotes(score);
  if (ordered.length === 0) return null;

  const anchorId = selection?.noteId;
  if (anchorId) {
    const idx = ordered.findIndex((r) => r.noteId === anchorId);
    if (idx < 0) return null;
    const next = ordered[idx + delta];
    if (!next) return null;
    return { itemId: next.itemId, groupId: next.groupId, noteId: next.noteId };
  }

  if (!options?.selectBoundaryWhenEmpty) {
    return null;
  }

  if (selection?.itemId) {
    const itemIdx = score.items.findIndex((it) => it.id === selection.itemId);
    if (itemIdx >= 0) {
      if (delta === 1) {
        for (let i = itemIdx; i < score.items.length; i++) {
          const it = score.items[i];
          if (it.kind !== 'syllable') continue;
          const grp = it.groups[0];
          const note = grp?.notes[0];
          if (grp && note) {
            return { itemId: it.id, groupId: grp.id, noteId: note.id };
          }
        }
      } else {
        for (let i = itemIdx; i >= 0; i--) {
          const it = score.items[i];
          if (it.kind !== 'syllable') continue;
          const grp = it.groups[it.groups.length - 1];
          const note = grp?.notes[grp.notes.length - 1];
          if (grp && note) {
            return { itemId: it.id, groupId: grp.id, noteId: note.id };
          }
        }
      }
    }
  }

  const fallback = delta === 1 ? ordered[0] : ordered[ordered.length - 1];
  return { itemId: fallback.itemId, groupId: fallback.groupId, noteId: fallback.noteId };
}

export interface SelectedNoteAudioInfo {
  note: ChantNote;
  clef: ClefType;
  effectiveAccidental: AccidentalType;
}

/**
 * Resolve the pitch, active clef, and active key/modal accidental for a selected note
 * so keyboard navigation can audition the exact pitch on the organ.
 */
export function findNoteInfoForSelection(
  score: ChantScore,
  selection: SelectionState | null
): SelectedNoteAudioInfo | null {
  const targetId = selection?.noteId;
  if (!targetId) return null;

  let activeClef: ClefType = 'c4';
  let keyFlatB = false;
  let activeAccidentals = new Map<number, 'flat' | 'sharp'>();

  const resetAccidentals = () => {
    activeAccidentals = new Map<number, 'flat' | 'sharp'>();
    if (keyFlatB) activeAccidentals.set(6, 'flat');
  };

  for (const item of score.items) {
    if (item.kind === 'clef') {
      activeClef = item.clef;
      keyFlatB = parseClefConfig(item.clef).hasFlatSignature;
      resetAccidentals();
      continue;
    }
    if (item.kind === 'division') {
      resetAccidentals();
      continue;
    }
    if (item.kind !== 'syllable') continue;

    for (const grp of item.groups) {
      for (const note of grp.notes) {
        const info = resolvePitch(
          note.pitch,
          activeClef,
          activeAccidentals,
          note.accidental
        );

        let effectiveAccidental: AccidentalType = note.accidental ?? null;
        if (!effectiveAccidental) {
          const inherited = activeAccidentals.get(info.diatonicStep) ?? null;
          if (inherited) effectiveAccidental = inherited;
        }

        if (note.accidental === 'flat' || note.accidental === 'sharp') {
          activeAccidentals.set(info.diatonicStep, note.accidental);
        } else if (note.accidental === 'natural') {
          activeAccidentals.delete(info.diatonicStep);
        }

        if (note.id === targetId) {
          return {
            note,
            clef: activeClef,
            effectiveAccidental,
          };
        }
      }
    }
  }

  return null;
}
