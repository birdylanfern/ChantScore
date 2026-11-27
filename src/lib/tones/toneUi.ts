import { ChantLanguage } from '@/src/types/chant';
import {
  cadenceToString,
  parseCadence,
  parseToneDefinition,
  ReadingCadenceKind,
  ToneDefinition,
  toneToDefinition,
} from './tone';
import type { ToneMode } from './pointing';
import {
  applyPhraseCadenceChoiceOverride,
  CADENCE_CHOICE_META,
  type CadenceChoiceMeta,
  choiceLabelToKind,
  getPhraseCadenceChoiceLabel,
  getReadingCadenceDisplayLabel,
  getValidPhraseCadenceChoices,
} from './phraseCadenceUtils';

export {
  applyPhraseCadenceChoiceOverride,
  CADENCE_CHOICE_META,
  type CadenceChoiceMeta,
  choiceLabelToKind,
  getPhraseCadenceChoiceLabel,
  getReadingCadenceDisplayLabel,
  getValidPhraseCadenceChoices,
};

export const TONE_CLEF_OPTIONS: { value: string; label: string }[] = [
  { value: 'c4', label: 'c4 (Do, 4th line)' },
  { value: 'c3', label: 'c3 (Do, 3rd line)' },
  { value: 'c2', label: 'c2 (Do, 2nd line)' },
  { value: 'c1', label: 'c1 (Do, 1st line)' },
  { value: 'f3', label: 'f3 (Fa, 3rd line)' },
  { value: 'f4', label: 'f4 (Fa, 4th line)' },
  { value: 'f2', label: 'f2 (Fa, 2nd line)' },
  { value: 'f1', label: 'f1 (Fa, 1st line)' },
  { value: 'cb3', label: 'cb3 (Do ♭, 3rd line)' },
  { value: 'cb4', label: 'cb4 (Do ♭, 4th line)' },
];

export type ToneSimpleFormField =
  | 'name'
  | 'clef'
  | 'tenor'
  | 'intonation'
  | 'flex'
  | 'mediant'
  | 'termination'
  | 'metrum'
  | 'flexa'
  | 'punctum'
  | 'question'
  | 'prefinal'
  | 'final';

export interface ToneSimpleFormValues {
  name: string;
  clef: string;
  tenor: string;
  intonation: string;
  // Psalm cadences
  flex: string;
  mediant: string;
  termination: string;
  // Reading cadences
  metrum: string;
  flexa: string;
  punctum: string;
  question: string;
  prefinal: string;
  final: string;
}

function readingCadenceFieldText(
  tone: ToneDefinition,
  kind: ReadingCadenceKind,
  language?: ChantLanguage
): string {
  const langMap = language ? tone.readingByLanguage?.[language] : undefined;
  const hasLangOverride = langMap && Object.prototype.hasOwnProperty.call(langMap, kind);
  const c = hasLangOverride ? langMap![kind] : tone.reading?.[kind];
  if (c === undefined) return '';
  if (c === null) return 'none';
  return cadenceToString(c);
}

export function toneToFormValues(
  tone: ToneDefinition,
  language?: ChantLanguage
): ToneSimpleFormValues {
  return {
    name: tone.name,
    clef: tone.clef,
    tenor: tone.tenor,
    intonation: tone.intonation.join(' '),
    flex: tone.flex ? cadenceToString(tone.flex) : '',
    mediant: tone.mediant ? cadenceToString(tone.mediant) : '',
    termination: tone.termination ? cadenceToString(tone.termination) : '',
    metrum: readingCadenceFieldText(tone, 'metrum', language),
    flexa: readingCadenceFieldText(tone, 'flex', language),
    punctum: readingCadenceFieldText(tone, 'punctum', language),
    question: readingCadenceFieldText(tone, 'question', language),
    prefinal: readingCadenceFieldText(tone, 'prefinal', language),
    final: readingCadenceFieldText(tone, 'final', language),
  };
}

function validateLineWithParser(key: string, rawValue: string, baseTone?: ToneDefinition): string | null {
  const safeTenor = baseTone?.tenor || 'h';
  const safeMediant = baseTone?.mediant ? cadenceToString(baseTone.mediant) : 'h*';
  const safeTerm = baseTone?.termination ? cadenceToString(baseTone.termination) : 'h*';
  const lines = [`tenor: ${safeTenor}`];
  if (key !== 'mediant' && key !== 'termination') {
    lines.push(`mediant: ${safeMediant}`, `termination: ${safeTerm}`);
  }
  if (key === 'mediant') {
    lines.push(`mediant: ${rawValue}`, `termination: ${safeTerm}`);
  } else if (key === 'termination') {
    lines.push(`mediant: ${safeMediant}`, `termination: ${rawValue}`);
  } else if (key === 'tenor') {
    lines.length = 0;
    lines.push(`tenor: ${rawValue}`, `mediant: ${safeMediant}`, `termination: ${safeTerm}`);
  } else {
    lines.push(`${key}: ${rawValue}`);
  }
  const parsed = parseToneDefinition(lines.join('\n'));
  return parsed.errors[0] ?? null;
}

export function formValuesToTone(
  form: ToneSimpleFormValues,
  baseTone: ToneDefinition | undefined,
  mode: ToneMode,
  language?: ChantLanguage
): {
  tone?: ToneDefinition;
  fieldErrors: Partial<Record<ToneSimpleFormField, string>>;
} {
  const fieldErrors: Partial<Record<ToneSimpleFormField, string>> = {};
  const isPsalm = mode === 'psalm';

  const clefVal = form.clef.trim();
  if (!/^(c|f)b?[1-4]$/.test(clefVal)) {
    fieldErrors.clef = validateLineWithParser('clef', clefVal, baseTone) ?? 'Clef must look like c4';
  }

  const tenorVal = form.tenor.trim();
  if (!/^[a-m]$/.test(tenorVal)) {
    fieldErrors.tenor =
      validateLineWithParser('tenor', tenorVal, baseTone) ?? 'Reciting note must be a single letter a–m.';
  }

  const intonationVal = form.intonation.trim();
  let parsedIntonation: string[] = [];
  if (intonationVal) {
    const err = validateLineWithParser('intonation', intonationVal, baseTone);
    if (err) {
      fieldErrors.intonation = err;
    } else {
      parsedIntonation = intonationVal.split(/\s+/).filter(Boolean);
    }
  }

  const next: ToneDefinition = {
    name: form.name.trim() || 'Custom tone',
    clef: clefVal || 'c4',
    tenor: tenorVal || 'h',
    intonation: parsedIntonation,
  };
  if (baseTone?.shortTenor) next.shortTenor = baseTone.shortTenor;
  if (baseTone?.magnificatIntonation?.length) {
    next.magnificatIntonation = [...baseTone.magnificatIntonation];
  }
  if (baseTone?.reintone) next.reintone = true;
  if (baseTone?.phrasing && baseTone.phrasing !== 'punctuation') {
    next.phrasing = baseTone.phrasing;
  }
  if (baseTone?.psalmByLanguage) {
    next.psalmByLanguage = { ...baseTone.psalmByLanguage };
  }
  if (baseTone?.readingByLanguage) {
    next.readingByLanguage = {
      ...(baseTone.readingByLanguage.la ? { la: { ...baseTone.readingByLanguage.la } } : {}),
      ...(baseTone.readingByLanguage.en ? { en: { ...baseTone.readingByLanguage.en } } : {}),
    };
  }

  if (isPsalm) {
    const flexVal = form.flex.trim();
    if (flexVal && !/^none$/i.test(flexVal)) {
      const c = parseCadence(flexVal);
      if (!c) fieldErrors.flex = validateLineWithParser('flex', flexVal, baseTone) ?? 'Invalid flex cadence.';
      else next.flex = c;
    }

    const mediantVal = form.mediant.trim();
    if (!mediantVal) {
      fieldErrors.mediant = 'Mediant cadence is required for a psalm tone.';
    } else {
      const c = parseCadence(mediantVal);
      if (!c) {
        fieldErrors.mediant =
          validateLineWithParser('mediant', mediantVal, baseTone) ?? 'Invalid mediant cadence.';
      } else {
        next.mediant = c;
      }
    }

    const termVal = form.termination.trim();
    if (!termVal) {
      fieldErrors.termination = 'Ending (termination) cadence is required for a psalm tone.';
    } else {
      const c = parseCadence(termVal);
      if (!c) {
        fieldErrors.termination =
          validateLineWithParser('termination', termVal, baseTone) ?? 'Invalid termination cadence.';
      } else {
        next.termination = c;
      }
    }

    if (baseTone?.reading) next.reading = { ...baseTone.reading };
  } else {
    if (baseTone?.flex) next.flex = baseTone.flex;
    if (baseTone?.mediant) next.mediant = baseTone.mediant;
    if (baseTone?.termination) next.termination = baseTone.termination;

    const reading: NonNullable<ToneDefinition['reading']> = baseTone?.reading
      ? { ...baseTone.reading }
      : {};

    const readingEntries: [ToneSimpleFormField, string, ReadingCadenceKind][] = [
      ['metrum', 'metrum', 'metrum'],
      ['flexa', 'flexa', 'flex'],
      ['punctum', 'punctum', 'punctum'],
      ['question', 'question', 'question'],
      ['prefinal', 'prefinal', 'prefinal'],
      ['final', 'final', 'final'],
    ];

    const editingLangMap =
      language && next.readingByLanguage?.[language] ? next.readingByLanguage[language]! : null;

    for (const [field, parserKey, kind] of readingEntries) {
      const raw = form[field].trim();
      const targetIsLangOverride =
        editingLangMap !== null && Object.prototype.hasOwnProperty.call(editingLangMap, kind);

      if (!raw) {
        if (targetIsLangOverride) {
          delete editingLangMap![kind];
        } else {
          delete reading[kind];
        }
        continue;
      }
      if (/^none$/i.test(raw)) {
        if (targetIsLangOverride) {
          editingLangMap![kind] = null;
        } else {
          reading[kind] = null;
        }
        continue;
      }
      const c = parseCadence(raw);
      if (!c) {
        fieldErrors[field] =
          validateLineWithParser(parserKey, raw, baseTone) ?? `Invalid "${parserKey}" cadence.`;
      } else if (targetIsLangOverride) {
        editingLangMap![kind] = c;
      } else {
        reading[kind] = c;
      }
    }

    if (Object.keys(reading).length > 0 || (next.readingByLanguage && Object.keys(next.readingByLanguage).length > 0)) {
      next.reading = reading;
    }
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { fieldErrors };
  }

  // Normalize through parseToneDefinition(toneToDefinition(next)) so output matches parser identically
  const serialized = toneToDefinition(next);
  const reParsed = parseToneDefinition(serialized);
  if (!reParsed.tone) {
    return { fieldErrors: { tenor: reParsed.errors[0] ?? 'Invalid tone definition.' } };
  }
  return { tone: reParsed.tone, fieldErrors: {} };
}

export function mapDefinitionErrorToField(err: string): ToneSimpleFormField | null {
  const lower = err.toLowerCase();
  if (lower.includes('"tenor"') || lower.includes('"tenor:"') || lower.includes('tenor is a single')) {
    return 'tenor';
  }
  if (lower.includes('clef')) return 'clef';
  if (lower.includes('"intonation"') || lower.includes('intonation notes')) return 'intonation';
  if (lower.includes('"flexa"') || lower.includes('"flexa.')) return 'flexa';
  if (lower.includes('"flex"') || lower.includes('"flex.')) return 'flex';
  if (lower.includes('"mediant"') || lower.includes('"mediant.')) return 'mediant';
  if (lower.includes('"termination"') || lower.includes('"termination.')) return 'termination';
  if (lower.includes('"metrum"') || lower.includes('"metrum.')) return 'metrum';
  if (lower.includes('"punctum"') || lower.includes('"punctum.')) return 'punctum';
  if (lower.includes('"question"') || lower.includes('"question.')) return 'question';
  if (lower.includes('"prefinal"') || lower.includes('"prefinal.')) return 'prefinal';
  if (lower.includes('"final"') || lower.includes('"final.')) return 'final';
  return null;
}

export interface CadencePreviewSlot {
  gabc: string;
  accent: boolean;
  segmentBreakBefore?: boolean;
}

export function cadenceSpecToPreviewTokens(
  spec: string,
  tenor: string
): { isNone: boolean; recite: string; slots: CadencePreviewSlot[] } | null {
  const trimmed = spec.trim();
  if (!trimmed || /^none$/i.test(trimmed)) {
    return { isNone: true, recite: tenor || 'h', slots: [] };
  }
  const c = parseCadence(trimmed);
  if (!c) return null;
  const recite = c.recite ?? (tenor || 'h');
  const slots: CadencePreviewSlot[] = [];
  c.segments.forEach((seg, segIdx) => {
    const segStart = slots.length;
    for (const p of seg.prep) {
      slots.push({ gabc: p, accent: false });
    }
    slots.push({ gabc: seg.accent, accent: !c.positional });
    for (const post of seg.post) {
      slots.push({ gabc: post, accent: false });
    }
    if (segIdx > 0 && slots.length > segStart) {
      slots[segStart].segmentBreakBefore = true;
    }
  });
  return { isNone: false, recite, slots };
}
