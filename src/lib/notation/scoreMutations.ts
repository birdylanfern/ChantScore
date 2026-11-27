import {
  ChantHeader,
  ChantNote,
  ChantScore,
  ClefType,
  ClipboardPayload,
  DivisionType,
  ModifierPresetId,
  NeumeGroup,
  NeumePresetId,
  ScoreItem,
  ScorePageSetup,
  ScoreTypography,
  SelectedNoteRef,
  SelectionState,
  SyllableItem,
  TextSelectionTarget,
  VowelAccentType,
} from '@/src/types/chant';
import { createNotesFromPreset } from '@/src/lib/gabc/pitch';
import { nextId } from '@/src/lib/gabc/parser';
import {
  adjustSpansAfterEdit,
  applyAccentToStringRange,
  applySpanColor,
  getSyllablePrimaryVowelRange,
  resolvePageSetup,
  resolveScoreTypography,
  textHasVowel,
} from '@/src/lib/typography';

export function getSelectedNoteRefs(selection: SelectionState | null): SelectedNoteRef[] {
  if (!selection) return [];
  if (selection.selectedNotes && selection.selectedNotes.length > 0) {
    return selection.selectedNotes;
  }
  if (selection.noteId) {
    return [
      {
        itemId: selection.itemId,
        groupId: selection.groupId || '',
        noteId: selection.noteId,
      },
    ];
  }
  return [];
}

export function getOrderedScoreNotes(score: ChantScore): SelectedNoteRef[] {
  const out: SelectedNoteRef[] = [];
  for (const item of score.items) {
    if (item.kind !== 'syllable') continue;
    for (const grp of item.groups) {
      for (const note of grp.notes) {
        out.push({ itemId: item.id, groupId: grp.id, noteId: note.id });
      }
    }
  }
  return out;
}

export function updateHeader(score: ChantScore, patch: Partial<ChantHeader>): ChantScore {
  const nextHeader: ChantHeader = {
    ...score.header,
    ...patch,
  };
  if (patch.name !== undefined && patch.titleSpans === undefined && nextHeader.titleSpans) {
    nextHeader.titleSpans = nextHeader.titleSpans
      .map((s) => ({
        ...s,
        start: Math.min(s.start, patch.name!.length),
        end: Math.min(s.end, patch.name!.length),
      }))
      .filter((s) => s.end > s.start);
  }
  if (
    patch.officePart !== undefined &&
    patch.officePartSpans === undefined &&
    nextHeader.officePartSpans
  ) {
    nextHeader.officePartSpans = nextHeader.officePartSpans
      .map((s) => ({
        ...s,
        start: Math.min(s.start, patch.officePart!.length),
        end: Math.min(s.end, patch.officePart!.length),
      }))
      .filter((s) => s.end > s.start);
  }
  return {
    ...score,
    header: nextHeader,
  };
}

export function updateScoreTypography(
  score: ChantScore,
  patch: Partial<ScoreTypography>
): ChantScore {
  const current = resolveScoreTypography(score.typography);
  return {
    ...score,
    typography: resolveScoreTypography({ ...current, ...patch }),
  };
}

export function updateScorePageSetup(
  score: ChantScore,
  patch: Partial<ScorePageSetup>
): ChantScore {
  const current = resolvePageSetup(score.pageSetup);
  return {
    ...score,
    pageSetup: resolvePageSetup({ ...current, ...patch }),
  };
}

export function insertNeumeIntoScore(
  score: ChantScore,
  preset: NeumePresetId,
  anchorPitch: number,
  target:
    | { mode: 'append-to-syllable'; itemId: string }
    | { mode: 'insert-new-syllable'; insertAfterIndex: number },
  forceNewSyllable = false
): { nextScore: ChantScore; selection: SelectionState; firstNotePitch: number } {
  const newNotes: ChantNote[] = createNotesFromPreset(preset, anchorPitch, () => nextId('note'));
  const newGroupId = nextId('grp');
  const firstNote = newNotes[0];

  if (target.mode === 'append-to-syllable') {
    const nextItems = score.items.map((item) => {
      if (item.id === target.itemId && item.kind === 'syllable') {
        return {
          ...item,
          groups: [...item.groups, { id: newGroupId, notes: newNotes }],
        };
      }
      return item;
    });
    return {
      nextScore: { ...score, items: nextItems },
      selection: {
        itemId: target.itemId,
        groupId: newGroupId,
        noteId: firstNote.id,
      },
      firstNotePitch: firstNote.pitch,
    };
  }

  const idx = Math.max(0, Math.min(score.items.length, target.insertAfterIndex + 1));
  const prevItem = idx > 0 ? score.items[idx - 1] : null;

  // If no syllable is explicitly assigned, default to the last contiguous syllable
  if (!forceNewSyllable && prevItem && prevItem.kind === 'syllable') {
    const nextItems = score.items.map((item) => {
      if (item.id === prevItem.id && item.kind === 'syllable') {
        return {
          ...item,
          groups: [...item.groups, { id: newGroupId, notes: newNotes }],
        };
      }
      return item;
    });
    return {
      nextScore: { ...score, items: nextItems },
      selection: {
        itemId: prevItem.id,
        groupId: newGroupId,
        noteId: firstNote.id,
      },
      firstNotePitch: firstNote.pitch,
    };
  }

  const newSylId = nextId('syl');
  const newSyl: ScoreItem = {
    id: newSylId,
    kind: 'syllable',
    lyric: '',
    wordEnd: true,
    groups: [{ id: newGroupId, notes: newNotes }],
  };

  const nextItems = [...score.items];
  nextItems.splice(idx, 0, newSyl);

  return {
    nextScore: { ...score, items: nextItems },
    selection: {
      itemId: newSylId,
      groupId: newGroupId,
      noteId: firstNote.id,
    },
    firstNotePitch: firstNote.pitch,
  };
}

export function insertDivisionIntoScore(
  score: ChantScore,
  division: DivisionType,
  insertAfterIndex: number
): { nextScore: ChantScore; selection: SelectionState } {
  const id = nextId('div');
  const newItem: ScoreItem = {
    id,
    kind: 'division',
    division,
  };
  const nextItems = [...score.items];
  const idx = Math.max(0, Math.min(nextItems.length, insertAfterIndex + 1));
  nextItems.splice(idx, 0, newItem);
  return {
    nextScore: { ...score, items: nextItems },
    selection: { itemId: id },
  };
}

export function insertOrReplaceClef(
  score: ChantScore,
  clef: ClefType,
  selectedItemId?: string | null,
  insertAfterIndex?: number
): { nextScore: ChantScore; selection: SelectionState } {
  // If a clef is currently selected, update it in place
  if (selectedItemId) {
    const target = score.items.find((it) => it.id === selectedItemId);
    if (target && target.kind === 'clef') {
      return {
        nextScore: {
          ...score,
          items: score.items.map((it) =>
            it.id === selectedItemId && it.kind === 'clef' ? { ...it, clef } : it
          ),
        },
        selection: { itemId: selectedItemId },
      };
    }
  }

  // If score only has the initial clef and nothing else, replace that opening clef
  if (score.items.length === 1 && score.items[0].kind === 'clef') {
    const id = score.items[0].id;
    return {
      nextScore: {
        ...score,
        items: [{ id, kind: 'clef', clef }],
      },
      selection: { itemId: id },
    };
  }

  const id = nextId('clef');
  const nextItems = [...score.items];
  const idx =
    insertAfterIndex !== undefined
      ? Math.max(0, Math.min(nextItems.length, insertAfterIndex + 1))
      : nextItems.length;
  nextItems.splice(idx, 0, { id, kind: 'clef', clef });

  return {
    nextScore: { ...score, items: nextItems },
    selection: { itemId: id },
  };
}

export function insertLineBreak(
  score: ChantScore,
  insertAfterIndex: number
): { nextScore: ChantScore; selection: SelectionState } {
  const id = nextId('lb');
  const nextItems = [...score.items];
  const idx = Math.max(0, Math.min(nextItems.length, insertAfterIndex + 1));
  nextItems.splice(idx, 0, { id, kind: 'linebreak', justified: true });
  return {
    nextScore: { ...score, items: nextItems },
    selection: { itemId: id },
  };
}

export function shiftSelectedPitch(
  score: ChantScore,
  selection: SelectionState,
  delta: number
): ChantScore {
  const selectedRefs = getSelectedNoteRefs(selection);
  const selectedNoteIds = new Set(selectedRefs.map((r) => r.noteId));

  return {
    ...score,
    items: score.items.map((item) => {
      if (item.kind !== 'syllable') return item;
      const itemMatches =
        selectedNoteIds.size > 0
          ? item.groups.some((g) => g.notes.some((n) => selectedNoteIds.has(n.id)))
          : item.id === selection.itemId;
      if (!itemMatches) return item;

      return {
        ...item,
        groups: item.groups.map((grp) => ({
          ...grp,
          notes: grp.notes.map((n) => {
            if (selectedNoteIds.size > 0) {
              if (!selectedNoteIds.has(n.id)) return n;
            } else if (selection.groupId && grp.id !== selection.groupId) {
              return n;
            }
            return {
              ...n,
              pitch: Math.max(0, Math.min(12, n.pitch + delta)),
            };
          }),
        })),
      };
    }),
  };
}

export function setNotePitch(
  score: ChantScore,
  itemId: string,
  noteId: string,
  newPitch: number
): ChantScore {
  const clamped = Math.max(0, Math.min(12, newPitch));
  return {
    ...score,
    items: score.items.map((item) => {
      if (item.id !== itemId || item.kind !== 'syllable') return item;
      return {
        ...item,
        groups: item.groups.map((grp) => ({
          ...grp,
          notes: grp.notes.map((n) => (n.id === noteId ? { ...n, pitch: clamped } : n)),
        })),
      };
    }),
  };
}

export function replaceSelectedNoteWithPreset(
  score: ChantScore,
  selection: SelectionState,
  preset: NeumePresetId
): { nextScore: ChantScore; nextSelection: SelectionState; firstNotePitch: number } | null {
  const selectedRefs = getSelectedNoteRefs(selection);
  const selectedNoteIds = new Set(selectedRefs.map((r) => r.noteId));

  const sampleProbe = createNotesFromPreset(preset, 5, () => 'probe');

  // Single-note shape preset: transform ALL selected notes in place
  if (sampleProbe.length === 1 && selectedNoteIds.size > 0) {
    const newShape = sampleProbe[0].shape;
    let firstPitch: number | null = null;
    const nextScore: ChantScore = {
      ...score,
      items: score.items.map((it) => {
        if (it.kind !== 'syllable') return it;
        const hasMatch = it.groups.some((g) => g.notes.some((n) => selectedNoteIds.has(n.id)));
        if (!hasMatch) return it;
        return {
          ...it,
          groups: it.groups.map((grp) => ({
            ...grp,
            notes: grp.notes.map((n) => {
              if (!selectedNoteIds.has(n.id)) return n;
              if (firstPitch === null) firstPitch = n.pitch;
              return { ...n, shape: newShape, accidentalOnly: undefined };
            }),
          })),
        };
      }),
    };
    if (firstPitch === null) return null;
    return {
      nextScore,
      nextSelection: selection,
      firstNotePitch: firstPitch,
    };
  }

  const item = score.items.find((it) => it.id === selection.itemId);
  if (!item || item.kind !== 'syllable') return null;

  let targetGroupId = selection.groupId;
  let targetNote: ChantNote | undefined;
  for (const grp of item.groups) {
    if (selection.noteId) {
      const found = grp.notes.find((n) => n.id === selection.noteId);
      if (found) {
        targetGroupId = grp.id;
        targetNote = found;
        break;
      }
    } else if (grp.id === selection.groupId && grp.notes[0]) {
      targetGroupId = grp.id;
      targetNote = grp.notes[0];
      break;
    }
  }
  if (!targetNote || !targetGroupId) return null;

  const generated = createNotesFromPreset(preset, targetNote.pitch, () => nextId('note'));
  const replacementNotes: ChantNote[] = generated.map((g, idx) =>
    idx === 0 && targetNote!.accidental ? { ...g, accidental: targetNote!.accidental } : g
  );

  const nextScore: ChantScore = {
    ...score,
    items: score.items.map((it) => {
      if (it.id !== item.id || it.kind !== 'syllable') return it;
      return {
        ...it,
        groups: it.groups.map((grp) => {
          if (grp.id !== targetGroupId) return grp;
          const idx = grp.notes.findIndex((n) => n.id === targetNote!.id);
          if (idx === -1) return grp;
          const nextNotes = [...grp.notes];
          nextNotes.splice(idx, 1, ...replacementNotes);
          return { ...grp, notes: nextNotes };
        }),
      };
    }),
  };

  return {
    nextScore,
    nextSelection: {
      itemId: item.id,
      groupId: targetGroupId,
      noteId: replacementNotes[0].id,
    },
    firstNotePitch: replacementNotes[0].pitch,
  };
}

function noteHasModifier(n: ChantNote, modifier: ModifierPresetId): boolean {
  if (modifier === 'mora') return !!n.mora;
  if (modifier === 'episemaH') return !!n.episemaH;
  if (modifier === 'episemaV') return !!n.episemaV;
  if (modifier === 'liquescent') return !!n.liquescent;
  if (modifier === 'flat') return n.accidental === 'flat';
  if (modifier === 'natural') return n.accidental === 'natural';
  return false;
}

export function toggleModifierOnSelection(
  score: ChantScore,
  selection: SelectionState,
  modifier: ModifierPresetId
): ChantScore {
  const selectedRefs = getSelectedNoteRefs(selection);
  const selectedNoteIds = new Set(selectedRefs.map((r) => r.noteId));

  // Determine target notes to compute unified smart toggle state
  const targetNotes: ChantNote[] = [];
  for (const item of score.items) {
    if (item.kind !== 'syllable') continue;
    for (const grp of item.groups) {
      for (const n of grp.notes) {
        if (selectedNoteIds.size > 0) {
          if (selectedNoteIds.has(n.id)) targetNotes.push(n);
        } else if (item.id === selection.itemId && (!selection.groupId || grp.id === selection.groupId)) {
          targetNotes.push(n);
        }
      }
    }
  }

  const applicable = targetNotes.filter(
    (n) => !n.accidentalOnly || modifier === 'flat' || modifier === 'natural'
  );
  const allActive =
    applicable.length > 0 && applicable.every((n) => noteHasModifier(n, modifier));
  const turnOn = !allActive;

  return {
    ...score,
    items: score.items.map((item) => {
      if (item.kind !== 'syllable') return item;
      const itemMatches =
        selectedNoteIds.size > 0
          ? item.groups.some((g) => g.notes.some((n) => selectedNoteIds.has(n.id)))
          : item.id === selection.itemId;
      if (!itemMatches) return item;

      return {
        ...item,
        groups: item.groups.map((grp) => {
          if (selectedNoteIds.size === 0 && selection.groupId && grp.id !== selection.groupId) {
            return grp;
          }
          return {
            ...grp,
            notes: grp.notes.map((n) => {
              if (selectedNoteIds.size > 0 && !selectedNoteIds.has(n.id)) return n;
              if (n.accidentalOnly) {
                if (modifier === 'flat') return { ...n, accidental: 'flat' };
                if (modifier === 'natural') return { ...n, accidental: 'natural' };
                return n;
              }
              if (modifier === 'mora') return { ...n, mora: turnOn };
              if (modifier === 'episemaH') return { ...n, episemaH: turnOn };
              if (modifier === 'episemaV') return { ...n, episemaV: turnOn };
              if (modifier === 'liquescent') return { ...n, liquescent: turnOn };
              if (modifier === 'flat') {
                return { ...n, accidental: turnOn ? 'flat' : null };
              }
              if (modifier === 'natural') {
                return { ...n, accidental: turnOn ? 'natural' : null };
              }
              return n;
            }),
          };
        }),
      };
    }),
  };
}

export function updateSyllableText(
  score: ChantScore,
  itemId: string,
  lyric: string,
  wordEnd?: boolean
): ChantScore {
  return {
    ...score,
    items: score.items.map((item) => {
      if (item.id !== itemId || item.kind !== 'syllable') return item;
      const trimmedSpans = item.lyricSpans
        ? item.lyricSpans
            .map((s) => ({
              ...s,
              start: Math.min(s.start, lyric.length),
              end: Math.min(s.end, lyric.length),
            }))
            .filter((s) => s.end > s.start)
        : undefined;
      return {
        ...item,
        lyric,
        wordEnd: wordEnd !== undefined ? wordEnd : item.wordEnd,
        lyricSpans: trimmedSpans && trimmedSpans.length > 0 ? trimmedSpans : undefined,
      };
    }),
  };
}

export function splitSyllableAtNote(
  score: ChantScore,
  itemId: string,
  noteId: string,
  newLyric: string
): { nextScore: ChantScore; nextSelection: SelectionState } {
  const itemIdx = score.items.findIndex((it) => it.id === itemId);
  if (itemIdx === -1) {
    return { nextScore: score, nextSelection: { itemId, noteId } };
  }
  const item = score.items[itemIdx];
  if (item.kind !== 'syllable') {
    return { nextScore: score, nextSelection: { itemId } };
  }

  let splitGroupIdx = -1;
  let splitNoteIdx = -1;
  for (let g = 0; g < item.groups.length; g++) {
    const nIdx = item.groups[g].notes.findIndex((n) => n.id === noteId);
    if (nIdx !== -1) {
      splitGroupIdx = g;
      splitNoteIdx = nIdx;
      break;
    }
  }

  if (splitGroupIdx === -1) {
    return { nextScore: score, nextSelection: { itemId, noteId } };
  }

  const leftGroups = item.groups.slice(0, splitGroupIdx);
  const rightGroups = item.groups.slice(splitGroupIdx + 1);
  const splitGroup = item.groups[splitGroupIdx];

  const leftNotes = splitGroup.notes.slice(0, splitNoteIdx);
  const rightNotes = splitGroup.notes.slice(splitNoteIdx);

  if (leftNotes.length > 0) {
    leftGroups.push({ ...splitGroup, notes: leftNotes });
  }
  const firstRightGroup =
    leftNotes.length > 0
      ? { id: nextId('grp'), notes: rightNotes }
      : { ...splitGroup, notes: rightNotes };

  const allRightGroups = [firstRightGroup, ...rightGroups];

  // If splitting at the very first note of the syllable, just update its lyric
  if (leftGroups.length === 0) {
    return {
      nextScore: updateSyllableText(score, itemId, newLyric),
      nextSelection: {
        itemId,
        groupId: allRightGroups[0].id,
        noteId,
      },
    };
  }

  const newSylId = nextId('syl');
  const nextItems = [...score.items];
  nextItems[itemIdx] = {
    ...item,
    groups: leftGroups,
  };
  nextItems.splice(itemIdx + 1, 0, {
    id: newSylId,
    kind: 'syllable',
    lyric: newLyric,
    wordEnd: item.wordEnd,
    groups: allRightGroups,
  });

  return {
    nextScore: { ...score, items: nextItems },
    nextSelection: {
      itemId: newSylId,
      groupId: firstRightGroup.id,
      noteId,
    },
  };
}

export function mergeEmptySyllableIntoPrevious(
  score: ChantScore,
  itemId: string,
  selection: SelectionState | null
): { nextScore: ChantScore; nextSelection: SelectionState | null; merged: boolean } {
  const itemIdx = score.items.findIndex((it) => it.id === itemId);
  if (itemIdx <= 0) {
    return { nextScore: score, nextSelection: selection, merged: false };
  }
  const item = score.items[itemIdx];
  const prevItem = score.items[itemIdx - 1];
  if (
    item.kind !== 'syllable' ||
    prevItem.kind !== 'syllable' ||
    item.lyric.trim() !== ''
  ) {
    return { nextScore: score, nextSelection: selection, merged: false };
  }

  const nextItems = [...score.items];
  nextItems[itemIdx - 1] = {
    ...prevItem,
    wordEnd: item.wordEnd,
    groups: [...prevItem.groups, ...item.groups],
  };
  nextItems.splice(itemIdx, 1);

  const nextSelection: SelectionState | null =
    selection && selection.itemId === itemId
      ? {
          itemId: prevItem.id,
          groupId: selection.groupId || item.groups[0]?.id,
          noteId: selection.noteId || item.groups[0]?.notes[0]?.id,
        }
      : selection;

  return {
    nextScore: { ...score, items: nextItems },
    nextSelection,
    merged: true,
  };
}

export function deleteSelectedFromScore(
  score: ChantScore,
  selection: SelectionState
): { nextScore: ChantScore; nextSelection: SelectionState | null } {
  const selectedRefs = getSelectedNoteRefs(selection);

  // Multi-note deletion
  if (selectedRefs.length > 1) {
    const selectedNoteIds = new Set(selectedRefs.map((r) => r.noteId));
    const firstItemIdx = score.items.findIndex((it) => it.id === selectedRefs[0].itemId);
    const nextItems: ScoreItem[] = [];

    for (const item of score.items) {
      if (item.kind !== 'syllable') {
        nextItems.push(item);
        continue;
      }
      const nextGroups = item.groups
        .map((g) => ({
          ...g,
          notes: g.notes.filter((n) => !selectedNoteIds.has(n.id)),
        }))
        .filter((g) => g.notes.length > 0);

      if (nextGroups.length > 0) {
        nextItems.push({ ...item, groups: nextGroups });
      }
    }

    const neighbor = nextItems[Math.min(Math.max(0, firstItemIdx), nextItems.length - 1)];
    let nextSel: SelectionState | null = null;
    if (neighbor) {
      if (neighbor.kind === 'syllable' && neighbor.groups[0]?.notes[0]) {
        nextSel = {
          itemId: neighbor.id,
          groupId: neighbor.groups[0].id,
          noteId: neighbor.groups[0].notes[0].id,
        };
      } else {
        nextSel = { itemId: neighbor.id };
      }
    }

    return {
      nextScore: { ...score, items: nextItems },
      nextSelection: nextSel,
    };
  }

  const targetIdx = score.items.findIndex((it) => it.id === selection.itemId);
  if (targetIdx === -1) return { nextScore: score, nextSelection: null };

  const targetItem = score.items[targetIdx];

  // Keep at least one opening clef
  if (targetItem.kind === 'clef' && targetIdx === 0) {
    return { nextScore: score, nextSelection: selection };
  }

  if (targetItem.kind === 'syllable' && selection.noteId) {
    // Remove only the selected note if the syllable has more than 1 note total
    const totalNotes = targetItem.groups.reduce((acc, g) => acc + g.notes.length, 0);
    if (totalNotes > 1) {
      const nextGroups = targetItem.groups
        .map((g) => ({
          ...g,
          notes: g.notes.filter((n) => n.id !== selection.noteId),
        }))
        .filter((g) => g.notes.length > 0);

      const nextScore: ChantScore = {
        ...score,
        items: score.items.map((it) =>
          it.id === targetItem.id && it.kind === 'syllable'
            ? { ...it, groups: nextGroups }
            : it
        ),
      };
      const fallbackGroup = nextGroups[0];
      const fallbackNote = fallbackGroup?.notes[0];
      return {
        nextScore,
        nextSelection: fallbackNote
          ? { itemId: targetItem.id, groupId: fallbackGroup.id, noteId: fallbackNote.id }
          : { itemId: targetItem.id },
      };
    }
  }

  // Otherwise remove the entire item
  const nextItems = score.items.filter((it) => it.id !== selection.itemId);
  const neighbor = nextItems[Math.min(targetIdx, nextItems.length - 1)];
  let nextSel: SelectionState | null = null;
  if (neighbor) {
    if (neighbor.kind === 'syllable' && neighbor.groups[0]?.notes[0]) {
      nextSel = {
        itemId: neighbor.id,
        groupId: neighbor.groups[0].id,
        noteId: neighbor.groups[0].notes[0].id,
      };
    } else {
      nextSel = { itemId: neighbor.id };
    }
  }

  return {
    nextScore: { ...score, items: nextItems },
    nextSelection: nextSel,
  };
}

export function setNoteLiquescentDir(
  score: ChantScore,
  selection: SelectionState,
  dir: 'asc' | 'desc' | 'dim'
): ChantScore {
  const selectedRefs = getSelectedNoteRefs(selection);
  const selectedNoteIds = new Set(selectedRefs.map((r) => r.noteId));
  return {
    ...score,
    items: score.items.map((item) => {
      if (item.kind !== 'syllable') return item;
      return {
        ...item,
        groups: item.groups.map((grp) => ({
          ...grp,
          notes: grp.notes.map((n) => {
            if (selectedNoteIds.size > 0 ? !selectedNoteIds.has(n.id) : item.id !== selection.itemId) {
              return n;
            }
            if (n.accidentalOnly) return n;
            return { ...n, liquescent: true, liquescentDir: dir };
          }),
        })),
      };
    }),
  };
}

export function splitGroupAtNote(
  score: ChantScore,
  itemId: string,
  noteId: string
): { nextScore: ChantScore; nextSelection: SelectionState } | null {
  const item = score.items.find((it) => it.id === itemId);
  if (!item || item.kind !== 'syllable') return null;

  for (let gIdx = 0; gIdx < item.groups.length; gIdx++) {
    const grp = item.groups[gIdx];
    const nIdx = grp.notes.findIndex((n) => n.id === noteId);
    if (nIdx > 0) {
      const left: NeumeGroup = { ...grp, notes: grp.notes.slice(0, nIdx) };
      const right: NeumeGroup = { id: nextId('grp'), notes: grp.notes.slice(nIdx) };
      const nextGroups = [...item.groups];
      nextGroups.splice(gIdx, 1, left, right);
      return {
        nextScore: {
          ...score,
          items: score.items.map((it) =>
            it.id === itemId && it.kind === 'syllable' ? { ...it, groups: nextGroups } : it
          ),
        },
        nextSelection: {
          itemId,
          groupId: right.id,
          noteId,
        },
      };
    }
  }
  return null;
}

export function mergeWithPreviousGroup(
  score: ChantScore,
  itemId: string,
  groupId: string
): { nextScore: ChantScore; nextSelection: SelectionState } | null {
  const item = score.items.find((it) => it.id === itemId);
  if (!item || item.kind !== 'syllable') return null;

  const gIdx = item.groups.findIndex((g) => g.id === groupId);
  if (gIdx <= 0) return null;

  const prevGrp = item.groups[gIdx - 1];
  const currGrp = item.groups[gIdx];
  const merged: NeumeGroup = {
    ...prevGrp,
    notes: [...prevGrp.notes, ...currGrp.notes],
  };
  const nextGroups = [...item.groups];
  nextGroups.splice(gIdx - 1, 2, merged);

  return {
    nextScore: {
      ...score,
      items: score.items.map((it) =>
        it.id === itemId && it.kind === 'syllable' ? { ...it, groups: nextGroups } : it
      ),
    },
    nextSelection: {
      itemId,
      groupId: merged.id,
      noteId: currGrp.notes[0]?.id || merged.notes[0]?.id,
    },
  };
}

export function shiftSyllableLyric(
  score: ChantScore,
  itemId: string,
  direction: 'prev' | 'next'
): { nextScore: ChantScore; nextSelection: SelectionState } | null {
  const idx = score.items.findIndex((it) => it.id === itemId);
  if (idx === -1) return null;
  const current = score.items[idx];
  if (current.kind !== 'syllable') return null;

  const step = direction === 'prev' ? -1 : 1;
  let targetIdx = idx + step;
  while (targetIdx >= 0 && targetIdx < score.items.length) {
    if (score.items[targetIdx].kind === 'syllable') break;
    targetIdx += step;
  }
  if (targetIdx < 0 || targetIdx >= score.items.length) return null;

  const target = score.items[targetIdx] as SyllableItem;
  const nextItems = [...score.items];
  nextItems[idx] = { ...current, lyric: target.lyric, wordEnd: target.wordEnd };
  nextItems[targetIdx] = { ...target, lyric: current.lyric, wordEnd: current.wordEnd };

  return {
    nextScore: { ...score, items: nextItems },
    nextSelection: {
      itemId: target.id,
      groupId: target.groups[0]?.id,
      noteId: target.groups[0]?.notes[0]?.id,
    },
  };
}

export function copySelectionPayload(
  score: ChantScore,
  selection: SelectionState | null
): ClipboardPayload | null {
  if (!selection) return null;
  const refs = getSelectedNoteRefs(selection);
  if (refs.length > 0) {
    const idSet = new Set(refs.map((r) => r.noteId));
    const notes: ChantNote[] = [];
    for (const item of score.items) {
      if (item.kind !== 'syllable') continue;
      for (const grp of item.groups) {
        for (const n of grp.notes) {
          if (idSet.has(n.id)) notes.push({ ...n });
        }
      }
    }
    if (notes.length > 0) {
      return { kind: 'notes', notes };
    }
  }

  const item = score.items.find((it) => it.id === selection.itemId);
  if (!item) return null;
  if (item.kind === 'syllable') {
    return {
      kind: 'syllable',
      item: {
        ...item,
        groups: item.groups.map((g) => ({
          ...g,
          notes: g.notes.map((n) => ({ ...n })),
        })),
      },
    };
  }
  if (item.kind === 'division') {
    return { kind: 'division', division: item.division, lyric: item.lyric };
  }
  if (item.kind === 'clef') {
    return { kind: 'clef', clef: item.clef };
  }
  return null;
}

export function pastePayloadIntoScore(
  score: ChantScore,
  selection: SelectionState | null,
  payload: ClipboardPayload
): { nextScore: ChantScore; nextSelection: SelectionState } {
  const selIdx = selection
    ? score.items.findIndex((it) => it.id === selection.itemId)
    : -1;
  const insertAfterIndex = selIdx >= 0 ? selIdx : score.items.length - 1;

  if (payload.kind === 'notes') {
    const freshNotes = payload.notes.map((n) => ({ ...n, id: nextId('note') }));
    const freshGroup: NeumeGroup = { id: nextId('grp'), notes: freshNotes };

    if (selection) {
      const targetItem = score.items.find((it) => it.id === selection.itemId);
      if (targetItem && targetItem.kind === 'syllable') {
        const nextItems = score.items.map((it) =>
          it.id === targetItem.id && it.kind === 'syllable'
            ? { ...it, groups: [...it.groups, freshGroup] }
            : it
        );
        return {
          nextScore: { ...score, items: nextItems },
          nextSelection: {
            itemId: targetItem.id,
            groupId: freshGroup.id,
            noteId: freshNotes[0].id,
          },
        };
      }
    }

    const newSylId = nextId('syl');
    const newSyl: SyllableItem = {
      id: newSylId,
      kind: 'syllable',
      lyric: '',
      wordEnd: true,
      groups: [freshGroup],
    };
    const nextItems = [...score.items];
    nextItems.splice(insertAfterIndex + 1, 0, newSyl);
    return {
      nextScore: { ...score, items: nextItems },
      nextSelection: {
        itemId: newSylId,
        groupId: freshGroup.id,
        noteId: freshNotes[0].id,
      },
    };
  }

  if (payload.kind === 'syllable') {
    const newSylId = nextId('syl');
    const newGroups = payload.item.groups.map((g) => ({
      id: nextId('grp'),
      notes: g.notes.map((n) => ({ ...n, id: nextId('note') })),
    }));
    const newSyl: SyllableItem = {
      id: newSylId,
      kind: 'syllable',
      lyric: payload.item.lyric,
      wordEnd: payload.item.wordEnd,
      groups: newGroups,
    };
    const nextItems = [...score.items];
    nextItems.splice(insertAfterIndex + 1, 0, newSyl);
    return {
      nextScore: { ...score, items: nextItems },
      nextSelection: {
        itemId: newSylId,
        groupId: newGroups[0]?.id,
        noteId: newGroups[0]?.notes[0]?.id,
      },
    };
  }

  if (payload.kind === 'division') {
    const id = nextId('div');
    const nextItems = [...score.items];
    nextItems.splice(insertAfterIndex + 1, 0, {
      id,
      kind: 'division',
      division: payload.division,
      lyric: payload.lyric,
    });
    return {
      nextScore: { ...score, items: nextItems },
      nextSelection: { itemId: id },
    };
  }

  const id = nextId('clef');
  const nextItems = [...score.items];
  nextItems.splice(insertAfterIndex + 1, 0, {
    id,
    kind: 'clef',
    clef: payload.clef,
  });
  return {
    nextScore: { ...score, items: nextItems },
    nextSelection: { itemId: id },
  };
}

export function applyTextColorToSelection(
  score: ChantScore,
  selection: SelectionState | null,
  textSelection: TextSelectionTarget | null,
  color: string | null
): ChantScore {
  if (textSelection?.kind === 'header') {
    const { field, range } = textSelection;
    if (field === 'name') {
      const text = score.header.name || 'Cantus Novus';
      if (range && range.end > range.start && (range.start > 0 || range.end < text.length)) {
        const nextSpans = applySpanColor(
          text.length,
          score.header.titleSpans,
          range.start,
          range.end,
          color
        );
        return updateHeader(score, {
          titleSpans: nextSpans.length > 0 ? nextSpans : undefined,
        });
      }
      return updateHeader(score, {
        titleColor: color || undefined,
        titleSpans: undefined,
      });
    }
    if (field === 'officePart') {
      const text = score.header.officePart || '';
      if (range && range.end > range.start && (range.start > 0 || range.end < text.length)) {
        const nextSpans = applySpanColor(
          text.length,
          score.header.officePartSpans,
          range.start,
          range.end,
          color
        );
        return updateHeader(score, {
          officePartSpans: nextSpans.length > 0 ? nextSpans : undefined,
        });
      }
      return updateHeader(score, {
        officePartColor: color || undefined,
        officePartSpans: undefined,
      });
    }
    if (field === 'mode') {
      return updateHeader(score, { modeColor: color || undefined });
    }
    if (field === 'annotation') {
      return updateHeader(score, { annotationColor: color || undefined });
    }
    if (field === 'dropCap') {
      return updateHeader(score, { dropCapColor: color || undefined });
    }
  }

  if (textSelection?.kind === 'lyric-range') {
    const targetItem = score.items.find((it) => it.id === textSelection.itemId);
    if (targetItem && targetItem.kind === 'syllable') {
      const text = targetItem.lyric;
      const s = Math.max(0, Math.min(text.length, textSelection.start));
      const e = Math.max(0, Math.min(text.length, textSelection.end));
      if (e > s && (s > 0 || e < text.length)) {
        const nextSpans = applySpanColor(text.length, targetItem.lyricSpans, s, e, color);
        return {
          ...score,
          items: score.items.map((it) =>
            it.id === targetItem.id && it.kind === 'syllable'
              ? { ...it, lyricSpans: nextSpans.length > 0 ? nextSpans : undefined }
              : it
          ),
        };
      }
      return {
        ...score,
        items: score.items.map((it) =>
          it.id === targetItem.id && it.kind === 'syllable'
            ? { ...it, lyricColor: color || undefined, lyricSpans: undefined }
            : it
        ),
      };
    }
  }

  if (!selection) return score;

  const selectedRefs = getSelectedNoteRefs(selection);
  const selectedItemIds = new Set<string>(selectedRefs.map((r) => r.itemId));
  if (selection.itemId) selectedItemIds.add(selection.itemId);

  return {
    ...score,
    items: score.items.map((item) => {
      if (!selectedItemIds.has(item.id)) return item;
      if (item.kind === 'syllable') {
        return {
          ...item,
          lyricColor: color || undefined,
          lyricSpans: undefined,
        };
      }
      if (item.kind === 'division') {
        return {
          ...item,
          lyricColor: color || undefined,
        };
      }
      return item;
    }),
  };
}

export function getSelectionCurrentColor(
  score: ChantScore,
  selection: SelectionState | null,
  textSelection: TextSelectionTarget | null
): string | null {
  if (textSelection?.kind === 'header') {
    const { field } = textSelection;
    if (field === 'name') return score.header.titleColor || null;
    if (field === 'officePart') return score.header.officePartColor || null;
    if (field === 'mode') return score.header.modeColor || null;
    if (field === 'annotation') return score.header.annotationColor || null;
    if (field === 'dropCap') return score.header.dropCapColor || null;
  }

  if (textSelection?.kind === 'lyric-range') {
    const item = score.items.find((it) => it.id === textSelection.itemId);
    if (item?.kind === 'syllable') {
      const matched = item.lyricSpans?.find(
        (sp) => sp.start <= textSelection.start && sp.end >= textSelection.end
      );
      return matched?.color || item.lyricColor || null;
    }
  }

  if (!selection) return null;
  const item = score.items.find((it) => it.id === selection.itemId);
  if (item && (item.kind === 'syllable' || item.kind === 'division')) {
    return item.lyricColor || null;
  }
  return null;
}

export function getAccentTargetInfo(
  score: ChantScore,
  selection: SelectionState | null,
  textSelection: TextSelectionTarget | null
): { hasTarget: boolean; hasVowels: boolean; label: string } {
  if (textSelection?.kind === 'lyric-range') {
    const item = score.items.find((it) => it.id === textSelection.itemId);
    if (item?.kind === 'syllable') {
      const slice = item.lyric.slice(textSelection.start, textSelection.end);
      const hasVowels = textHasVowel(slice);
      return {
        hasTarget: hasVowels,
        hasVowels,
        label: slice
          ? hasVowels
            ? `Vowel sel. “${slice}”`
            : `No vowel in “${slice}”`
          : 'Highlight vowel',
      };
    }
  }

  if (textSelection?.kind === 'header') {
    const { field, range } = textSelection;
    if ((field === 'name' || field === 'officePart') && range && range.end > range.start) {
      const raw =
        field === 'name' ? score.header.name || 'Cantus Novus' : score.header.officePart || '';
      const slice = raw.slice(range.start, range.end);
      const hasVowels = textHasVowel(slice);
      const prefix = field === 'name' ? 'Title' : 'Office';
      return {
        hasTarget: hasVowels,
        hasVowels,
        label: hasVowels ? `${prefix} “${slice}”` : `No vowel in “${slice}”`,
      };
    }
    return {
      hasTarget: false,
      hasVowels: false,
      label: 'Highlight vowel in text',
    };
  }

  if (selection) {
    const refs = getSelectedNoteRefs(selection);
    const uniqueItems = new Set(refs.map((r) => r.itemId));
    if (selection.itemId) uniqueItems.add(selection.itemId);
    const item = score.items.find((it) => it.id === selection.itemId);
    if (uniqueItems.size <= 1 && item && (item.kind === 'syllable' || item.kind === 'division') && item.lyric) {
      const primary = getSyllablePrimaryVowelRange(item.lyric);
      if (primary) {
        return {
          hasTarget: true,
          hasVowels: true,
          label: `“${primary.vowelText}” in “${item.lyric}”`,
        };
      }
      return {
        hasTarget: false,
        hasVowels: false,
        label: 'No vowel in syllable',
      };
    }
  }

  return {
    hasTarget: false,
    hasVowels: false,
    label: 'Highlight vowel or syllable',
  };
}

export function applyVowelAccentToSelection(
  score: ChantScore,
  selection: SelectionState | null,
  textSelection: TextSelectionTarget | null,
  accent: VowelAccentType
): {
  nextScore: ChantScore;
  nextTextSelection: TextSelectionTarget | null;
  changed: boolean;
} {
  if (textSelection?.kind === 'lyric-range') {
    const targetItem = score.items.find((it) => it.id === textSelection.itemId);
    if (targetItem && targetItem.kind === 'syllable') {
      const res = applyAccentToStringRange(
        targetItem.lyric,
        textSelection.start,
        textSelection.end,
        accent
      );
      if (!res.changed) {
        return { nextScore: score, nextTextSelection: textSelection, changed: false };
      }
      const nextSpans = adjustSpansAfterEdit(
        targetItem.lyricSpans,
        textSelection.start,
        textSelection.end,
        res.delta,
        res.text.length
      );
      return {
        nextScore: {
          ...score,
          items: score.items.map((it) =>
            it.id === targetItem.id && it.kind === 'syllable'
              ? { ...it, lyric: res.text, lyricSpans: nextSpans }
              : it
          ),
        },
        nextTextSelection: {
          kind: 'lyric-range',
          itemId: targetItem.id,
          start: res.nextRange.start,
          end: res.nextRange.end,
        },
        changed: true,
      };
    }
  }

  if (textSelection?.kind === 'header') {
    const { field, range } = textSelection;
    if ((field === 'name' || field === 'officePart') && range && range.end > range.start) {
      const raw =
        field === 'name' ? score.header.name || 'Cantus Novus' : score.header.officePart || '';
      const res = applyAccentToStringRange(raw, range.start, range.end, accent);
      if (!res.changed) {
        return { nextScore: score, nextTextSelection: textSelection, changed: false };
      }
      if (field === 'name') {
        const nextSpans = adjustSpansAfterEdit(
          score.header.titleSpans,
          range.start,
          range.end,
          res.delta,
          res.text.length
        );
        return {
          nextScore: updateHeader(score, { name: res.text, titleSpans: nextSpans }),
          nextTextSelection: { kind: 'header', field: 'name', range: res.nextRange },
          changed: true,
        };
      } else {
        const nextSpans = adjustSpansAfterEdit(
          score.header.officePartSpans,
          range.start,
          range.end,
          res.delta,
          res.text.length
        );
        return {
          nextScore: updateHeader(score, { officePart: res.text, officePartSpans: nextSpans }),
          nextTextSelection: { kind: 'header', field: 'officePart', range: res.nextRange },
          changed: true,
        };
      }
    }
  }

  if (selection) {
    const item = score.items.find((it) => it.id === selection.itemId);
    if (item && item.kind === 'syllable' && item.lyric) {
      const primary = getSyllablePrimaryVowelRange(item.lyric);
      if (primary) {
        const res = applyAccentToStringRange(item.lyric, primary.start, primary.end, accent);
        if (!res.changed) {
          return { nextScore: score, nextTextSelection: textSelection, changed: false };
        }
        const nextSpans = adjustSpansAfterEdit(
          item.lyricSpans,
          primary.start,
          primary.end,
          res.delta,
          res.text.length
        );
        return {
          nextScore: {
            ...score,
            items: score.items.map((it) =>
              it.id === item.id && it.kind === 'syllable'
                ? { ...it, lyric: res.text, lyricSpans: nextSpans }
                : it
            ),
          },
          nextTextSelection: textSelection,
          changed: true,
        };
      }
    } else if (item && item.kind === 'division' && item.lyric) {
      const primary = getSyllablePrimaryVowelRange(item.lyric);
      if (primary) {
        const res = applyAccentToStringRange(item.lyric, primary.start, primary.end, accent);
        if (!res.changed) {
          return { nextScore: score, nextTextSelection: textSelection, changed: false };
        }
        return {
          nextScore: {
            ...score,
            items: score.items.map((it) =>
              it.id === item.id && it.kind === 'division' ? { ...it, lyric: res.text } : it
            ),
          },
          nextTextSelection: textSelection,
          changed: true,
        };
      }
    }
  }

  return { nextScore: score, nextTextSelection: textSelection, changed: false };
}



