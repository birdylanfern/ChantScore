import { AccidentalType, ClefType, NeumePresetId, NoteShape } from '@/src/types/chant';

export const PITCH_LETTERS = 'abcdefghijklm';

export function pitchIndexToChar(pitch: number): string {
  const clamped = Math.max(0, Math.min(12, Math.round(pitch)));
  return PITCH_LETTERS[clamped];
}

export function charToPitchIndex(ch: string): number {
  const idx = PITCH_LETTERS.indexOf(ch.toLowerCase());
  return idx === -1 ? 5 : idx;
}

export interface ClefConfig {
  clefType: 'c' | 'f';
  line: number; // 1..4
  pitchIndex: number; // 3, 5, 7, 9
  hasFlatSignature: boolean;
}

export function parseClefConfig(clef: ClefType): ClefConfig {
  const hasFlatSignature = clef.startsWith('cb');
  const clefType: 'c' | 'f' = clef.startsWith('f') ? 'f' : 'c';
  const line = parseInt(clef[clef.length - 1], 10) || 4;
  const pitchIndex = 1 + line * 2; // 1->3(d), 2->5(f), 3->7(h), 4->9(j)
  return { clefType, line, pitchIndex, hasFlatSignature };
}

// Diatonic intervals from C in semitones: C, D, E, F, G, A, B
const MAJOR_SCALE_SEMITONES = [0, 2, 4, 5, 7, 9, 11];
const SOLFEGE_NAMES = ['Do', 'Re', 'Mi', 'Fa', 'Sol', 'La', 'Si'];
const NOTE_NAMES = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

export interface PitchInfo {
  midi: number;
  solfege: string;
  noteName: string;
  gabcChar: string;
  diatonicStep: number; // 0=C, 1=D, 2=E, 3=F, 4=G, 5=A, 6=B
}

export function resolvePitch(
  pitchIndex: number,
  clef: ClefType,
  activeFlatOrMap: boolean | ReadonlyMap<number, 'flat' | 'sharp'>,
  noteAccidental?: AccidentalType,
  transposeSemitones = 0
): PitchInfo {
  const cfg = parseClefConfig(clef);
  const delta = pitchIndex - cfg.pitchIndex;

  // Base diatonic reference:
  // c3, c4 -> clef line is C5 (midi 72, step 0) so standard chant sits in C4..F5
  // c1, c2 -> clef line is C4 (midi 60, step 0)
  // f1..f4 -> clef line is F4 (midi 65, step 3)
  let baseMidi: number;
  let baseStep: number;
  if (cfg.clefType === 'c') {
    baseStep = 0;
    baseMidi = cfg.line >= 3 ? 72 : 60;
  } else {
    baseStep = 3; // F
    baseMidi = 65;
  }

  const totalSteps = baseStep + delta;
  const octaveOffset = Math.floor(totalSteps / 7);
  const stepInOctave = mod(totalSteps, 7);

  let midi = baseMidi - MAJOR_SCALE_SEMITONES[baseStep] + octaveOffset * 12 + MAJOR_SCALE_SEMITONES[stepInOctave];

  // Apply active key/modal accidental or explicit accidental on this note
  const inheritedAccidental: 'flat' | 'sharp' | null =
    typeof activeFlatOrMap === 'boolean'
      ? stepInOctave === 6 && activeFlatOrMap
        ? 'flat'
        : null
      : activeFlatOrMap.get(stepInOctave) ?? null;

  let accidentalLabel = '';
  if (noteAccidental === 'flat') {
    midi -= 1;
    accidentalLabel = '♭';
  } else if (noteAccidental === 'sharp') {
    midi += 1;
    accidentalLabel = '♯';
  } else if (noteAccidental === 'natural') {
    accidentalLabel = '♮';
  } else if (inheritedAccidental === 'flat') {
    midi -= 1;
    accidentalLabel = '♭';
  } else if (inheritedAccidental === 'sharp') {
    midi += 1;
    accidentalLabel = '♯';
  }

  midi += transposeSemitones;

  const octaveNumber = Math.floor(midi / 12) - 1;
  return {
    midi,
    solfege: `${SOLFEGE_NAMES[stepInOctave]}${accidentalLabel}`,
    noteName: `${NOTE_NAMES[stepInOctave]}${accidentalLabel}${octaveNumber}`,
    gabcChar: pitchIndexToChar(pitchIndex),
    diatonicStep: stepInOctave,
  };
}

export function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export interface PresetNoteTemplate {
  offset: number;
  shape: NoteShape;
}

export const NEUME_PRESET_TEMPLATES: Record<NeumePresetId, PresetNoteTemplate[]> = {
  punctum: [{ offset: 0, shape: 'punctum' }],
  virga: [{ offset: 0, shape: 'virga' }],
  diamond: [{ offset: 0, shape: 'diamond' }],
  quilisma: [{ offset: 0, shape: 'quilisma' }],
  oriscus: [{ offset: 0, shape: 'oriscus' }],
  stropha: [{ offset: 0, shape: 'stropha' }],
  podatus: [
    { offset: 0, shape: 'punctum' },
    { offset: 1, shape: 'punctum' },
  ],
  clivis: [
    { offset: 0, shape: 'punctum' },
    { offset: -1, shape: 'punctum' },
  ],
  torculus: [
    { offset: 0, shape: 'punctum' },
    { offset: 1, shape: 'punctum' },
    { offset: 0, shape: 'punctum' },
  ],
  porrectus: [
    { offset: 0, shape: 'punctum' },
    { offset: -1, shape: 'punctum' },
    { offset: 0, shape: 'punctum' },
  ],
  scandicus: [
    { offset: 0, shape: 'punctum' },
    { offset: 1, shape: 'punctum' },
    { offset: 2, shape: 'punctum' },
  ],
  climacus: [
    { offset: 0, shape: 'virga' },
    { offset: -1, shape: 'diamond' },
    { offset: -2, shape: 'diamond' },
  ],
};

export function createNotesFromPreset(
  preset: NeumePresetId,
  anchorPitch: number,
  makeId: () => string
): { id: string; pitch: number; shape: NoteShape }[] {
  const template = NEUME_PRESET_TEMPLATES[preset];
  // Ensure all notes in the preset stay within 0..12
  const minOffset = Math.min(...template.map((t) => t.offset));
  const maxOffset = Math.max(...template.map((t) => t.offset));
  const safeAnchor = Math.max(-minOffset, Math.min(12 - maxOffset, anchorPitch));

  return template.map((t) => ({
    id: makeId(),
    pitch: safeAnchor + t.offset,
    shape: t.shape,
  }));
}
