import { parseToneDefinition, ToneDefinition } from './tone';

/**
 * Built-in reading tones (prophecy, epistle, gospel).
 *
 * Prophecy and Epistle pitches are relative to the reciting note DO, written for a c4 clef:
 *   DO = j   RE = k   SI = i (a semitone below DO)   LA = h (a minor third below DO)
 * The Gospel tone ("more ancient" from ChantTools) is written in absolute pitches in c4 clef
 * with the reciting tenor on h.
 * The titles ("Lectio Epistolae ...", "Dominus vobiscum ...") and the closing responses
 * (Verbum Domini, Laus tibi Christe) are not generated.
 * Check against Liber Usualis / Graduale Romanum before printing.
 */

/** Interrogation: the phrase is recited a semitone below the tenor, ending SI-LA-SI, then a podatus SI-DO. */
const QUESTION = 'question: recite=i; i h i ij* j';

export const EPISTLE_DEFINITION = `# Tonus Epistolae (ancient tone, ad libitum): recite on DO
name: Epistle tone
clef: c4
tenor: j
flexa: none            # no flex in the Epistle; a comma is just a pause
metrum: h j* i / i* j  # LA before the first accent, DO-SI, then SI-DO
punctum: jk* i / h* i  # podatus DO-RE, down to SI, LA on the last accent, SI after it
${QUESTION}
prefinal: hj*          # next-to-last phrase: podatus LA-DO on its last accent
final: recite=i; ij* j # last phrase recited on SI, podatus SI-DO on its last accent`;

// ChantTools Question ("h. , gr f g gh..") and Conclusion ("'fh hr h. , gr 'gh hr h.") use a comma
// as a boundary between two sub-phrases: Question lays all five slots positionally with no extra
// syllable between `h.` and `gr`, and Conclusion treats the comma as segment separator ` / `.
export const GOSPEL_DEFINITION = `# Tonus Evangelii (more ancient, ChantTools): c4 clef, tenor on h
name: Gospel tone (ancient)
clef: c4
tenor: h
flexa: none
metrum: f h* gr / g* hr h.
punctum: g* gr g.
question: positional; h. gr f g gh..
final: fh* hr h. / gr gh* hr h.`;

export const PROPHECY_DEFINITION = `# Tonus Prophetiae: recite on DO
name: Prophecy tone
clef: c4
tenor: j
flexa: positional; i.   # flex: the last syllable of the phrase drops a semitone (DO-SI)
metrum: positional; i.  # same flex at ; and :
punctum: j* f           # full stop: after the last accent the voice falls a fifth (DO-FA)
${QUESTION}
final: k* j / xi.* xi.  # RE-DO on the next-to-last accent, then SI flat to the end`;

/**
 * Preface body, solemn tone (c3 clef, recite on h). Derived from, and checked
 * against, a complete setting of the Advent preface (De duobus adventibus
 * Christi): 196 of its 205 syllables are reproduced.
 *
 * Punctuation decides the cadence, so punctuate the text the way you want it sung:
 *   ,   no cadence (just a pause)
 *   ; : metrum  (... lu(gf) tá(fg) re(g))
 *   .   the long cadence (fe ef g fg f); with a stressed syllable two before it,
 *       the "Per Christum Dóminum nostrum" lead-in (f!gwh g) is added
 * The last phrase of the text takes the long cadence whatever its punctuation.
 * Each phrase after ; : . starts on f.
 * Not generated: the "Et ideo," figure, phrases the book sets on g with a lifted
 * accent ("quod vigilántes"), and the "trá" flourish in "trámitem".
 */
export const PREFACE_SOLEMN_DEFINITION = `# Preface body, solemn tone: recite on h
name: Preface tone (solemn)
clef: c3
tenor: h
intonation: f            # first syllable of each phrase
reintone: yes            # ... repeated after ; : . (not after a comma)
phrasing: lines          # line ends terminate phrases; blank lines start paragraphs
flexa: none              # comma: no cadence
flexa.en: recite=g; positional; f g h
metrum: ?g gf fg* g      # g only when the syllable before it is the previous accent
metrum.en: g f fg* g
punctum: recite=g; positional; ?g ?^f!gwh ?g fe ef g fg f
punctum.en: recite=g; fe* ef g / fg* f
question: none
final: recite=g; positional; ?g ?^f!gwh ?g fe ef g fg f
final.en: recite=g; fe* ef g / fg* f`;

export interface ReadingToneEntry {
  id: string;
  label: string;
  definition: string;
}

export const READING_TONES: ReadingToneEntry[] = [
  { id: 'prophecy', label: 'Prophecy tone (with flex)', definition: PROPHECY_DEFINITION },
  { id: 'epistle', label: 'Epistle tone (ancient, with metrum)', definition: EPISTLE_DEFINITION },
  { id: 'gospel', label: 'Gospel tone (ancient)', definition: GOSPEL_DEFINITION },
];

export const PREFACE_TONES: ReadingToneEntry[] = [
  { id: 'preface-solemn', label: 'Preface body, solemn tone', definition: PREFACE_SOLEMN_DEFINITION },
];

export type ReadingOpeningFormulaId =
  | ''
  | 'in-illo-tempore'
  | 'in-diebus-illis'
  | 'fratres'
  | 'carissime';

export interface ReadingOpeningFormula {
  id: Exclude<ReadingOpeningFormulaId, ''>;
  text: string;
}

export const READING_OPENING_FORMULAS: ReadingOpeningFormula[] = [
  { id: 'in-illo-tempore', text: 'In illo témpore:' },
  { id: 'in-diebus-illis', text: 'In diébus illis,' },
  { id: 'fratres', text: 'Fratres,' },
  { id: 'carissime', text: 'Caríssime,' },
];

export const DEFAULT_READING_OPENING_FORMULA: Record<string, ReadingOpeningFormulaId> = {
  gospel: 'in-illo-tempore',
  prophecy: 'in-diebus-illis',
  epistle: 'fratres',
};

export function normalizeReadingOpeningFormula(raw: unknown): ReadingOpeningFormulaId {
  if (typeof raw !== 'string') return '';
  return READING_OPENING_FORMULAS.some((f) => f.id === raw)
    ? (raw as ReadingOpeningFormulaId)
    : '';
}

export function getReadingOpeningFormulaText(id: string | undefined): string {
  if (!id) return '';
  return READING_OPENING_FORMULAS.find((f) => f.id === id)?.text ?? '';
}

export function migrateSavedReadingOpeningFormula<
  T extends { readingOpeningFormula?: unknown; readingOpeningFormulaTouched?: unknown },
>(
  parsed: T
): T & { readingOpeningFormula: ReadingOpeningFormulaId; readingOpeningFormulaTouched: boolean } {
  const readingOpeningFormula = normalizeReadingOpeningFormula(parsed.readingOpeningFormula);
  const readingOpeningFormulaTouched =
    typeof parsed.readingOpeningFormulaTouched === 'boolean'
      ? parsed.readingOpeningFormulaTouched
      : readingOpeningFormula !== '';
  return {
    ...parsed,
    readingOpeningFormula,
    readingOpeningFormulaTouched,
  };
}

export function buildReadingTone(id: string): ToneDefinition | null {
  const entry = READING_TONES.find((t) => t.id === id) ?? PREFACE_TONES.find((t) => t.id === id);
  if (!entry) return null;
  return parseToneDefinition(entry.definition).tone ?? null;
}

export function buildPrefaceTone(id: string): ToneDefinition | null {
  const entry = PREFACE_TONES.find((t) => t.id === id);
  if (!entry) return null;
  return parseToneDefinition(entry.definition).tone ?? null;
}
