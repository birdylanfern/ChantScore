import { ChantScore, ClefType, SelectionState } from '@/src/types/chant';
import { midiToFrequency, parseClefConfig, resolvePitch } from '@/src/lib/gabc/pitch';
import { getSelectedNoteRefs } from '@/src/lib/notation/scoreMutations';

export interface ScheduledNoteEvent {
  itemId: string;
  groupId: string;
  noteId: string;
  startSec: number;
  durationSec: number;
  midi: number;
  frequency: number;
  legatoTailSec: number;
}

export interface ChantTimeline {
  events: ScheduledNoteEvent[];
  totalDurationSec: number;
}

export const MIN_TEMPO_BPM = 40;
export const MAX_TEMPO_BPM = 200;
export const DEFAULT_TEMPO_BPM = 140;

export function clampTempoBpm(tempoBpm: number): number {
  if (!Number.isFinite(tempoBpm)) return DEFAULT_TEMPO_BPM;
  return Math.max(MIN_TEMPO_BPM, Math.min(MAX_TEMPO_BPM, Math.round(tempoBpm)));
}

export function buildChantTimeline(
  score: ChantScore,
  tempoBpm = DEFAULT_TEMPO_BPM,
  transposeSemitones = 0,
  startFromNoteId?: string | null
): ChantTimeline {
  const beatSec = 60 / clampTempoBpm(tempoBpm);

  let activeClef: ClefType = 'c4';
  let keyFlatB = false;
  let activeAccidentals = new Map<number, 'flat' | 'sharp'>();

  const resetAccidentalsToSignature = () => {
    activeAccidentals = new Map<number, 'flat' | 'sharp'>();
    if (keyFlatB) activeAccidentals.set(6, 'flat');
  };

  const rawEvents: ScheduledNoteEvent[] = [];
  let cursorSec = 0;

  for (const item of score.items) {
    if (item.kind === 'clef') {
      activeClef = item.clef;
      keyFlatB = parseClefConfig(item.clef).hasFlatSignature;
      resetAccidentalsToSignature();
      continue;
    }

    if (item.kind === 'division') {
      // Divisions reset temporary modal accidentals unless clef has key signature flat
      resetAccidentalsToSignature();
      let pauseBeats = 0.35;
      if (item.division === ';') pauseBeats = 0.6;
      else if (item.division === ':') pauseBeats = 0.9;
      else if (item.division === '::') pauseBeats = 1.25;
      cursorSec += pauseBeats * beatSec;
      continue;
    }

    if (item.kind === 'linebreak') {
      continue;
    }

    if (item.kind === 'syllable') {
      for (let gIdx = 0; gIdx < item.groups.length; gIdx++) {
        const grp = item.groups[gIdx];
        for (let nIdx = 0; nIdx < grp.notes.length; nIdx++) {
          const note = grp.notes[nIdx];
          const info = resolvePitch(
            note.pitch,
            activeClef,
            activeAccidentals,
            note.accidental,
            transposeSemitones
          );

          // Update modal accidental state for this diatonic step until next division
          if (note.accidental === 'flat' || note.accidental === 'sharp') {
            activeAccidentals.set(info.diatonicStep, note.accidental);
          } else if (note.accidental === 'natural') {
            activeAccidentals.delete(info.diatonicStep);
          }

          // Standalone accidental glyphs (ix, iy, i#) are silent in playback
          if (note.accidentalOnly) {
            continue;
          }

          let beats = 1.0;
          if (note.mora) beats = 2.0;
          else if (note.episemaH) beats = 1.35;
          else if (note.shape === 'quilisma') beats = 1.15;
          else if (note.liquescent && note.shape !== 'stropha') beats = 0.85;

          const durSec = beats * beatSec;
          const isLastInGroup = nIdx === grp.notes.length - 1;
          const nextNote = !isLastInGroup ? grp.notes[nIdx + 1] : null;
          const samePitchRepercussion =
            nextNote &&
            !nextNote.accidentalOnly &&
            nextNote.pitch === note.pitch &&
            (note.shape === 'stropha' || nextNote.shape === 'stropha');
          const legatoTailSec = samePitchRepercussion ? 0.004 : isLastInGroup ? 0.015 : 0.035;

          rawEvents.push({
            itemId: item.id,
            groupId: grp.id,
            noteId: note.id,
            startSec: cursorSec,
            durationSec: durSec,
            midi: info.midi,
            frequency: midiToFrequency(info.midi),
            legatoTailSec,
          });

          cursorSec += durSec;
        }
      }
      // Subtle articulation space between words
      if (item.wordEnd && item.groups.length > 0) {
        cursorSec += 0.06 * beatSec;
      }
    }
  }

  let events = rawEvents;
  let totalDurationSec = cursorSec;

  if (startFromNoteId && rawEvents.length > 0) {
    const startIdx = rawEvents.findIndex((ev) => ev.noteId === startFromNoteId);
    if (startIdx > 0) {
      const offset = rawEvents[startIdx].startSec;
      events = rawEvents.slice(startIdx).map((ev) => ({
        ...ev,
        startSec: ev.startSec - offset,
      }));
      totalDurationSec = Math.max(0.5, cursorSec - offset);
    }
  }

  return {
    events,
    totalDurationSec,
  };
}

export function findTimelineEventAtTime(
  timeline: ChantTimeline,
  sec: number
): ScheduledNoteEvent | null {
  const { events } = timeline;
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    const endSec = ev.startSec + ev.durationSec;
    if (sec >= ev.startSec && (sec < endSec || (i === events.length - 1 && sec <= endSec))) {
      return ev;
    }
  }
  return null;
}

export function findNextTimelineEventAtOrAfter(
  timeline: ChantTimeline,
  sec: number
): ScheduledNoteEvent | null {
  const active = findTimelineEventAtTime(timeline, sec);
  if (active) return active;
  for (const ev of timeline.events) {
    if (ev.startSec >= sec) return ev;
  }
  return null;
}

export function findTimelineEventForSelection(
  score: ChantScore,
  timeline: ChantTimeline,
  selection: SelectionState | null
): ScheduledNoteEvent | null {
  if (!selection) return null;
  const refs = getSelectedNoteRefs(selection);
  if (refs.length === 0) return null;

  const selectedIds = new Set(refs.map((r) => r.noteId));
  const direct = timeline.events.find((ev) => selectedIds.has(ev.noteId));
  if (direct) return direct;

  // If only an accidentalOnly glyph was selected, fall back to the first sounding note in that group/syllable
  const anchor = refs[0];
  const item = score.items.find((it) => it.id === anchor.itemId);
  if (!item || item.kind !== 'syllable') return null;
  const grp = item.groups.find((g) => g.id === anchor.groupId);
  if (grp) {
    const grpIds = new Set(grp.notes.map((n) => n.id));
    const inGroup = timeline.events.find((ev) => grpIds.has(ev.noteId));
    if (inGroup) return inGroup;
  }
  return timeline.events.find((ev) => ev.itemId === item.id) ?? null;
}
