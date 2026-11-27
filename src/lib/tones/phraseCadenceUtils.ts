import type { ReadingCadenceKind } from './tone';

export type PhraseCadenceChoice =
  | 'none'
  | 'metrum'
  | 'long'
  | 'question'
  | 'final'
  | 'flex'
  | 'prefinal';

export function hashGabc(gabc: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < gabc.length; i++) {
    const c = gabc.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= c + i;
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  return `${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`;
}

export function cadenceKindToLabel(
  kind: ReadingCadenceKind | null,
  _cadence?: unknown
): PhraseCadenceChoice {
  if (kind === null) return 'none';
  if (kind === 'punctum') return 'long';
  return kind;
}

export interface CadenceChoiceMeta {
  label: string;
  shortGlyph: string;
  technicalName: string;
  description: string;
}

export const CADENCE_CHOICE_META: Record<PhraseCadenceChoice, CadenceChoiceMeta> = {
  none: {
    label: 'Keep reciting',
    shortGlyph: '—',
    technicalName: 'Recto tono (no cadence)',
    description: 'Keep reciting — no change in pitch',
  },
  flex: {
    label: 'Light pause ,',
    shortGlyph: ',',
    technicalName: 'Flexa',
    description: 'Light pause — a small drop at a comma',
  },
  metrum: {
    label: 'Pause ;',
    shortGlyph: ';',
    technicalName: 'Metrum',
    description: 'Pause — a small dip before the next phrase',
  },
  prefinal: {
    label: 'Near the end',
    shortGlyph: '·',
    technicalName: 'Pre-final',
    description: 'Near the end — prepares the closing phrase',
  },
  long: {
    label: 'Full stop .',
    shortGlyph: '.',
    technicalName: 'Punctum',
    description: 'Full stop — the voice falls at the last accent',
  },
  question: {
    label: 'Question ?',
    shortGlyph: '?',
    technicalName: 'Interrogatio (Question)',
    description: 'Question — rises slightly at the end',
  },
  final: {
    label: 'Ending',
    shortGlyph: '‖',
    technicalName: 'Final',
    description: 'Ending — the closing formula for the last phrase',
  },
};

export function getPhraseCadenceChoiceLabel(choice: PhraseCadenceChoice): string {
  return CADENCE_CHOICE_META[choice].label;
}

export function getReadingCadenceDisplayLabel(kind: ReadingCadenceKind | null): string {
  const choice = cadenceKindToLabel(kind, undefined);
  return CADENCE_CHOICE_META[choice].label;
}

export function choiceLabelToKind(choice: PhraseCadenceChoice): ReadingCadenceKind | null {
  switch (choice) {
    case 'none':
      return null;
    case 'long':
      return 'punctum';
    case 'metrum':
    case 'question':
    case 'final':
    case 'flex':
    case 'prefinal':
      return choice;
  }
}

export function getValidPhraseCadenceChoices(opts: {
  isEnglishPreface: boolean;
  hasQuestion: boolean;
}): PhraseCadenceChoice[] {
  if (opts.isEnglishPreface) {
    return ['none', 'metrum', 'flex', 'long'];
  }
  return opts.hasQuestion
    ? ['none', 'flex', 'metrum', 'long', 'question', 'final']
    : ['none', 'flex', 'metrum', 'long', 'final'];
}

export function applyPhraseCadenceChoiceOverride(
  prev: Record<number, ReadingCadenceKind | null>,
  overrideKey: number,
  chosenChoice: PhraseCadenceChoice,
  defaultKind: ReadingCadenceKind | null
): Record<number, ReadingCadenceKind | null> {
  const nextKind = choiceLabelToKind(chosenChoice);
  const next = { ...prev };
  if (nextKind === defaultKind) {
    delete next[overrideKey];
  } else {
    next[overrideKey] = nextKind;
  }
  return next;
}
