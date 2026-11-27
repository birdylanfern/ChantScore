import { ChantLanguage, PhraseBreakKey, TonePhraseLinkItem } from '@/src/types/chant';
import { ToneSyllable, toToneSyllables } from './latinAccent';
import {
  applyCadence,
  applyEnglishPrefaceRole,
  Cadence,
  EnglishPrefaceRole,
  getPsalmCadence,
  getReadingCadence,
  ReadingCadenceKind,
  ToneDefinition,
} from './tone';
import {
  cadenceKindToLabel,
  hashGabc,
  type PhraseCadenceChoice,
} from './phraseCadenceUtils';
export { cadenceKindToLabel, hashGabc, type PhraseCadenceChoice };

export interface PointingOptions {
  /** Repeat the intonation on every verse (Magnificat, Benedictus) instead of the first only. */
  repeatIntonation?: boolean;
  /** Use tone.magnificatIntonation (when set) for the shortened first half-verse of the Latin Magníficat. */
  magnificat?: boolean;
  /** Insert a flex automatically in half-verses with at least this many syllables (0 = only at †). */
  autoFlexSyllables?: number;
  /** Append the Gloria Patri, pointed with the same tone. */
  gloriaPatri?: boolean;
  title?: string;
  /** Language used for syllabification and stress detection ('la' | 'en'). */
  language?: ChantLanguage;
  /** Manual stress overrides keyed by 0-based global syllable index in the input text. */
  stressOverrides?: Record<number, boolean>;
  /** Manual reading-phrase cadence overrides keyed by 0-based endWordIndex (`null` = none). */
  cadenceOverrides?: Record<number, ReadingCadenceKind | null>;
  /** Manual English preface per-line role overrides keyed by 0-based endWordIndex. */
  roleOverrides?: Record<number, EnglishPrefaceRole>;
  /** Default phrase breaks removed (joined) by user, keyed by word before the break. */
  mergedBreaks?: PhraseBreakKey[];
  /** Auto-joined phrase breaks explicitly restored/kept split by user. */
  forcedBreaks?: PhraseBreakKey[];
  /** Extra phrase breaks added by user inside phrases, keyed by word before the break. */
  extraBreaks?: PhraseBreakKey[];
  /**
   * Auto-join phrases with at most N real words (0 = off, default 3, range 0-6).
   * Ignored in English line-based preface mode and psalm mode.
   */
  autoJoinShortPhrases?: number;
  /** Optional Latin reading opening formula prepended as phrase 0 (e.g. "In illo témpore:"). */
  openingFormula?: string;
  /**
   * For prefaces (`tone.phrasing === 'lines'`), treat single line breaks as phrase breaks instead
   * of soft wraps. Defaults to false for Latin and true for English.
   */
  treatLineBreaksAsPhraseBreaks?: boolean;
}

export interface PointingResult {
  gabc: string;
  warnings: string[];
  phrases?: TonePhraseLinkItem[];
}

/** Latin Gloria Patri with the stressed vowels marked, as two verses. */
export const GLORIA_PATRI = [
  'Gl\u00F3ria Patri, et F\u00EDlio, * et Spir\u00EDtui Sancto.',
  'Sicut erat in princ\u00EDpio, et nunc, et semper, * et in s\u00E6cula saecul\u00F3rum. Amen.',
];

/** English Gloria Patri, as two verses. */
export const GLORIA_PATRI_EN = [
  'Gl\u00F3ry be to the F\u00E1ther, and to the Son, * and to the H\u00F3ly Sp\u00EDrit.',
  'As it was in the beg\u00EDnning, is now, and \u00E9ver shall be, * world without end. Am\u00E9n.',
];

const MEDIANT_MARK = '*';
const FLEX_MARK = '\u2020'; // †

function gabcSafe(text: string): string {
  return text.replace(/[()\[\]<>]/g, '');
}

function renderSyllables(sylls: ToneSyllable[], notes: Map<number, string>, tenor: string): string {
  let out = '';
  sylls.forEach((s, i) => {
    out += `${gabcSafe(s.text)}(${notes.get(i) ?? tenor})`;
    if (s.wordEnd && i < sylls.length - 1) out += ' ';
  });
  return out;
}

function syllableCount(text: string, language: ChantLanguage = 'la'): number {
  return toToneSyllables(text, { language }).length;
}

/** Choose where to break a verse without an explicit asterisk: the punctuation nearest the middle, else the middle word. */
export function autoSplitVerse(text: string, language: ChantLanguage = 'la'): [string, string] | null {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return null;
  const counts = words.map((w) => syllableCount(w, language));
  const total = counts.reduce((a, b) => a + b, 0);
  let best = -1;
  let bestScore = Infinity;
  let acc = 0;
  for (let i = 0; i < words.length - 1; i++) {
    acc += counts[i];
    const punct = /[,;:.?!]$/.test(words[i]);
    const score = Math.abs(total / 2 - acc) + (punct ? 0 : total * 0.15);
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }
  if (best < 0) return null;
  return [words.slice(0, best + 1).join(' '), words.slice(best + 1).join(' ')];
}

function splitVerse(line: string, language: ChantLanguage): { first: string; second: string | null } {
  const idx = line.indexOf(MEDIANT_MARK);
  if (idx >= 0) {
    return { first: line.slice(0, idx).trim(), second: line.slice(idx + 1).replace(/\*/g, '').trim() };
  }
  const auto = autoSplitVerse(line, language);
  return auto ? { first: auto[0], second: auto[1] } : { first: line.trim(), second: null };
}

function splitAtFlex(
  half: string,
  autoFlexSyllables: number,
  language: ChantLanguage
): { before: string; after: string } | null {
  const idx = half.indexOf(FLEX_MARK);
  if (idx >= 0) return { before: half.slice(0, idx).trim(), after: half.slice(idx + 1).replace(/\u2020/g, '').trim() };
  if (autoFlexSyllables > 0 && syllableCount(half, language) >= autoFlexSyllables) {
    const auto = autoSplitVerse(half, language);
    if (auto && syllableCount(auto[0], language) >= 4 && syllableCount(auto[1], language) >= 4) {
      return { before: auto[0], after: auto[1] };
    }
  }
  return null;
}

/** Point one verse, returning whether the first half-verse was shortened to preserve the intonation. */
function pointVerse(
  line: string,
  tone: ToneDefinition,
  useIntonation: boolean,
  useMagnificatIncipit: boolean,
  autoFlexSyllables: number,
  language: ChantLanguage,
  stressOverrides: Record<number, boolean> | undefined,
  cursor: { index: number },
  useOverrides: boolean,
  warnings: string[]
): { gabc: string; shortened: boolean } {
  const { first, second } = splitVerse(line, language);
  const mediant = getPsalmCadence(tone, 'mediant', language) as Cadence;
  const termination = getPsalmCadence(tone, 'termination', language) as Cadence;
  const flex = getPsalmCadence(tone, 'flex', language);
  let out = '';
  let shortened = false;

  // ---- first half ----
  const flexParts = splitAtFlex(first, autoFlexSyllables, language);
  const segments: { text: string; kind: 'flex' | 'mediant' }[] = [];
  if (flexParts && flex) {
    segments.push({ text: flexParts.before, kind: 'flex' }, { text: flexParts.after, kind: 'mediant' });
  } else {
    if (flexParts && !flex) warnings.push('This tone has no flex; the † mark was ignored.');
    segments.push({ text: first.replace(/\u2020/g, '').trim(), kind: 'mediant' });
  }

  segments.forEach((seg, segIdx) => {
    const sylls = toToneSyllables(seg.text, {
      language,
      stressOverrides: useOverrides ? stressOverrides : undefined,
      offset: cursor.index,
    });
    cursor.index += sylls.length;
    const notes = applyCadence(sylls, seg.kind === 'flex' ? (flex as Cadence) : mediant);
    let reciteNote = tone.tenor;
    if (segIdx === 0 && useIntonation && tone.intonation.length > 0) {
      const minCadenceIdx = notes.size > 0 ? Math.min(...notes.keys()) : sylls.length;
      if (sylls.length <= tone.intonation.length || minCadenceIdx < tone.intonation.length) {
        shortened = true;
        notes.clear();
        reciteNote = tone.shortTenor ?? tone.tenor;
        const incipitNotes =
          useMagnificatIncipit && tone.magnificatIntonation?.length
            ? tone.magnificatIntonation
            : tone.intonation;
        for (let i = 0; i < sylls.length; i++) {
          const baseNote = i < incipitNotes.length ? incipitNotes[i] : reciteNote;
          notes.set(
            i,
            i === sylls.length - 1 && !baseNote.endsWith('.') ? `${baseNote}.` : baseNote
          );
        }
      } else {
        tone.intonation.forEach((n, i) => {
          if (i < sylls.length && !notes.has(i)) notes.set(i, n);
        });
      }
    }
    out += renderSyllables(sylls, notes, reciteNote);
    if (seg.kind === 'flex') out += ` ${FLEX_MARK}(,) `;
  });

  // ---- second half ----
  if (second !== null) {
    out += ` ${MEDIANT_MARK}(:) `;
    const sylls = toToneSyllables(second, {
      language,
      stressOverrides: useOverrides ? stressOverrides : undefined,
      offset: cursor.index,
    });
    cursor.index += sylls.length;
    out += renderSyllables(sylls, applyCadence(sylls, termination), termination.recite ?? tone.tenor);
  }
  return { gabc: out, shortened };
}

function header(tone: ToneDefinition, title?: string): string {
  return `name: ${title || tone.name};\ninitial-style: 0;\n%%\n(${tone.clef})`;
}

export function pointPsalm(text: string, tone: ToneDefinition, opts: PointingOptions = {}): PointingResult {
  const warnings: string[] = [];
  const language = opts.language ?? 'la';
  if (!getPsalmCadence(tone, 'mediant', language) || !getPsalmCadence(tone, 'termination', language)) {
    return { gabc: '', warnings: ['This tone has no mediant/termination; use a reading tone instead.'] };
  }
  const userLines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const doxology = language === 'en' ? GLORIA_PATRI_EN : GLORIA_PATRI;
  const lines = opts.gloriaPatri ? [...userLines, ...doxology] : userLines;
  if (lines.length === 0) return { gabc: '', warnings: ['Paste some text first.'] };

  const cursor = { index: 0 };
  let usedFullFirstVerse = false;
  const body = lines.map((line, i) => {
    const useIntonation = !usedFullFirstVerse || !!opts.repeatIntonation;
    const useMagnificatIncipit = !!opts.magnificat && language === 'la' && i === 0;
    const isUserLine = i < userLines.length;
    const verse = pointVerse(
      line,
      tone,
      useIntonation,
      useMagnificatIncipit,
      opts.autoFlexSyllables ?? 0,
      language,
      opts.stressOverrides,
      cursor,
      isUserLine,
      warnings
    );
    if (!verse.shortened) usedFullFirstVerse = true;
    return `${verse.gabc} (::) (Z)`;
  });
  return { gabc: `${header(tone, opts.title)} ${body.join('\n')}\n`, warnings: [...new Set(warnings)] };
}

const PUNCT_KIND: Record<string, ReadingCadenceKind> = {
  ',': 'flex',
  ';': 'metrum',
  ':': 'metrum',
  '.': 'punctum',
  '?': 'question',
  '!': 'punctum',
};

export const DEFAULT_AUTO_JOIN_SHORT_PHRASES = 3;
export const MAX_AUTO_JOIN_SHORT_PHRASES = 6;

export function clampAutoJoinShortPhrases(val: number | undefined): number {
  if (typeof val !== 'number' || !Number.isFinite(val)) {
    return DEFAULT_AUTO_JOIN_SHORT_PHRASES;
  }
  const rounded = Math.round(val);
  return Math.max(0, Math.min(MAX_AUTO_JOIN_SHORT_PHRASES, rounded));
}

const REAL_WORD_CHAR_RE = /[\p{L}\p{N}]/u;

export function countRealWords(words: string[]): number {
  let count = 0;
  for (const w of words) {
    if (REAL_WORD_CHAR_RE.test(w)) count += 1;
  }
  return count;
}

function normalizeOpeningFormulaCheck(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[,;:?!.\s'""“”’()\[\]]+/g, ' ')
    .trim();
}

const PROTECTED_READING_OPENINGS = new Set([
  'in illo tempore',
  'in diebus illis',
  'fratres',
  'carissime',
]);

function isProtectedReadingOpeningText(text: string): boolean {
  return PROTECTED_READING_OPENINGS.has(normalizeOpeningFormulaCheck(text));
}

function terminationRequiresMora(kind: ReadingCadenceKind | null | undefined): boolean {
  return (
    kind === 'metrum' ||
    kind === 'punctum' ||
    kind === 'question' ||
    kind === 'prefinal' ||
    kind === 'final'
  );
}

export interface ReadingPhrase {
  index: number;
  text: string;
  words: string[];
  startWordIndex: number;
  endWordIndex: number;
  endWordText: string;
  defaultKind: ReadingCadenceKind | null;
  effectiveKind: ReadingCadenceKind | null;
  choiceLabel: PhraseCadenceChoice;
  overridden: boolean;
  startsPhrase: boolean;
  paragraphBreak: boolean;
  defaultRole?: EnglishPrefaceRole;
  effectiveRole?: EnglishPrefaceRole;
  roleOverridden?: boolean;
  merged: boolean;
  mergedFrom: number;
  autoJoined?: boolean;
  internalMergedBreaks: PhraseBreakKey[];
  isOpeningFormula?: boolean;
  canJoinPrev: boolean;
  canJoinNext: boolean;
}

export function prunePhraseBreakKeys(breaks: PhraseBreakKey[], allWords: string[]): PhraseBreakKey[] {
  if (!breaks.length || !allWords.length) return [];
  const seen = new Set<number>();
  const out: PhraseBreakKey[] = [];
  for (const br of breaks) {
    if (
      typeof br.endWordIndex === 'number' &&
      Number.isInteger(br.endWordIndex) &&
      br.endWordIndex >= 0 &&
      br.endWordIndex < allWords.length &&
      allWords[br.endWordIndex] === br.wordText &&
      !seen.has(br.endWordIndex)
    ) {
      seen.add(br.endWordIndex);
      out.push({ endWordIndex: br.endWordIndex, wordText: br.wordText });
    }
  }
  return out.sort((a, b) => a.endWordIndex - b.endWordIndex);
}

export function migrateIndexOverridesToEndWord<T>(
  overrides: Record<number, T>,
  defaultPhrases: Pick<ReadingPhrase, 'index' | 'endWordIndex'>[]
): Record<number, T> {
  const entries = Object.entries(overrides);
  if (entries.length === 0 || defaultPhrases.length === 0) return {};
  const byIndex = new Map<number, number>();
  for (const ph of defaultPhrases) {
    byIndex.set(ph.index, ph.endWordIndex);
  }
  const out: Record<number, T> = {};
  for (const [k, val] of entries) {
    const endWordIdx = byIndex.get(Number(k));
    if (endWordIdx !== undefined) {
      out[endWordIdx] = val;
    }
  }
  return out;
}

export function remapPhraseBreakKeys(
  breaks: PhraseBreakKey[],
  prevWords: string[],
  nextWords: string[]
): PhraseBreakKey[] {
  if (!breaks.length || !nextWords.length) return [];
  if (!prevWords.length) return prunePhraseBreakKeys(breaks, nextWords);
  if (prevWords.length === nextWords.length && prevWords.every((w, i) => w === nextWords[i])) {
    return prunePhraseBreakKeys(breaks, nextWords);
  }
  const m = prevWords.length;
  const n = nextWords.length;
  if (m * n > 250000) {
    return prunePhraseBreakKeys(breaks, nextWords);
  }
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        prevWords[i - 1] === nextWords[j - 1]
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  const indexMap = new Map<number, number>();
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (prevWords[i - 1] === nextWords[j - 1]) {
      indexMap.set(i - 1, j - 1);
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }
  const mapped: PhraseBreakKey[] = [];
  for (const br of breaks) {
    const newIdx = indexMap.get(br.endWordIndex);
    if (newIdx !== undefined && nextWords[newIdx] === br.wordText) {
      mapped.push({ endWordIndex: newIdx, wordText: br.wordText });
    }
  }
  return prunePhraseBreakKeys(mapped, nextWords);
}

export function joinPhraseBreak<
  TCadence = ReadingCadenceKind | null,
  TRole = EnglishPrefaceRole,
>(opts: {
  phrases: ReadingPhrase[];
  targetPhraseEndWordIndex: number;
  direction: 'prev' | 'next';
  mergedBreaks: PhraseBreakKey[];
  extraBreaks: PhraseBreakKey[];
  forcedBreaks?: PhraseBreakKey[];
  cadenceOverrides?: Record<number, TCadence>;
  roleOverrides?: Record<number, TRole>;
  phraseRawOverrides?: Record<number, string>;
}): {
  mergedBreaks: PhraseBreakKey[];
  extraBreaks: PhraseBreakKey[];
  forcedBreaks: PhraseBreakKey[];
  cadenceOverrides: Record<number, TCadence>;
  roleOverrides: Record<number, TRole>;
  phraseRawOverrides: Record<number, string>;
  changed: boolean;
} {
  const idx = opts.phrases.findIndex((p) => p.endWordIndex === opts.targetPhraseEndWordIndex);
  const baseCadence = { ...(opts.cadenceOverrides ?? {}) };
  const baseRole = { ...(opts.roleOverrides ?? {}) };
  const baseRaw = { ...(opts.phraseRawOverrides ?? {}) };
  const baseForced = opts.forcedBreaks ?? [];
  if (idx < 0) {
    return {
      mergedBreaks: opts.mergedBreaks,
      extraBreaks: opts.extraBreaks,
      forcedBreaks: baseForced,
      cadenceOverrides: baseCadence,
      roleOverrides: baseRole,
      phraseRawOverrides: baseRaw,
      changed: false,
    };
  }

  const target = opts.phrases[idx];
  if (opts.direction === 'prev' && !target.canJoinPrev) {
    return {
      mergedBreaks: opts.mergedBreaks,
      extraBreaks: opts.extraBreaks,
      forcedBreaks: baseForced,
      cadenceOverrides: baseCadence,
      roleOverrides: baseRole,
      phraseRawOverrides: baseRaw,
      changed: false,
    };
  }
  if (opts.direction === 'next' && !target.canJoinNext) {
    return {
      mergedBreaks: opts.mergedBreaks,
      extraBreaks: opts.extraBreaks,
      forcedBreaks: baseForced,
      cadenceOverrides: baseCadence,
      roleOverrides: baseRole,
      phraseRawOverrides: baseRaw,
      changed: false,
    };
  }

  const left = opts.direction === 'prev' ? opts.phrases[idx - 1] : target;
  const right = opts.direction === 'prev' ? target : opts.phrases[idx + 1];
  if (!left || !right || right.paragraphBreak || left.isOpeningFormula || right.isOpeningFormula) {
    return {
      mergedBreaks: opts.mergedBreaks,
      extraBreaks: opts.extraBreaks,
      forcedBreaks: baseForced,
      cadenceOverrides: baseCadence,
      roleOverrides: baseRole,
      phraseRawOverrides: baseRaw,
      changed: false,
    };
  }

  // Discard overrides attached to the earlier piece (right piece's endWordIndex becomes the merged phrase key).
  delete baseCadence[left.endWordIndex];
  delete baseRole[left.endWordIndex];
  delete baseRaw[left.endWordIndex];

  const nextForcedBreaks = baseForced.filter((b) => b.endWordIndex !== left.endWordIndex);
  const isExtraBreak = opts.extraBreaks.some(
    (b) => b.endWordIndex === left.endWordIndex && b.wordText === left.endWordText
  );
  let nextMergedBreaks = opts.mergedBreaks;
  let nextExtraBreaks = opts.extraBreaks;
  if (isExtraBreak) {
    nextExtraBreaks = opts.extraBreaks.filter((b) => b.endWordIndex !== left.endWordIndex);
  } else if (!opts.mergedBreaks.some((b) => b.endWordIndex === left.endWordIndex)) {
    nextMergedBreaks = [
      ...opts.mergedBreaks,
      { endWordIndex: left.endWordIndex, wordText: left.endWordText },
    ].sort((a, b) => a.endWordIndex - b.endWordIndex);
  }

  return {
    mergedBreaks: nextMergedBreaks,
    extraBreaks: nextExtraBreaks,
    forcedBreaks: nextForcedBreaks,
    cadenceOverrides: baseCadence,
    roleOverrides: baseRole,
    phraseRawOverrides: baseRaw,
    changed: true,
  };
}

export function splitMergedPhraseBreaks(
  phrase: Pick<ReadingPhrase, 'internalMergedBreaks' | 'merged'>,
  mergedBreaks: PhraseBreakKey[]
): PhraseBreakKey[] {
  if (!phrase.merged || phrase.internalMergedBreaks.length === 0) return mergedBreaks;
  const toRemove = new Set(phrase.internalMergedBreaks.map((b) => b.endWordIndex));
  return mergedBreaks.filter((b) => !toRemove.has(b.endWordIndex));
}

export function splitPhraseWithForcedBreaks(
  phrase: Pick<ReadingPhrase, 'internalMergedBreaks' | 'merged' | 'autoJoined'>,
  mergedBreaks: PhraseBreakKey[],
  forcedBreaks: PhraseBreakKey[]
): { mergedBreaks: PhraseBreakKey[]; forcedBreaks: PhraseBreakKey[] } {
  if (!phrase.merged || phrase.internalMergedBreaks.length === 0) {
    return { mergedBreaks, forcedBreaks };
  }
  const mergedSet = new Set(mergedBreaks.map((b) => b.endWordIndex));
  const nextMerged = splitMergedPhraseBreaks(phrase, mergedBreaks);
  const nextForced = [...forcedBreaks];
  const forcedSet = new Set(forcedBreaks.map((b) => b.endWordIndex));
  for (const bk of phrase.internalMergedBreaks) {
    const wasAutoJoined = !mergedSet.has(bk.endWordIndex) || Boolean(phrase.autoJoined);
    if (wasAutoJoined && !forcedSet.has(bk.endWordIndex)) {
      forcedSet.add(bk.endWordIndex);
      nextForced.push({ endWordIndex: bk.endWordIndex, wordText: bk.wordText });
    }
  }
  nextForced.sort((a, b) => a.endWordIndex - b.endWordIndex);
  return { mergedBreaks: nextMerged, forcedBreaks: nextForced };
}

export function restoreMergedBreakKey(
  mergedBreaks: PhraseBreakKey[],
  breakKey: PhraseBreakKey
): PhraseBreakKey[] {
  return mergedBreaks.filter((b) => b.endWordIndex !== breakKey.endWordIndex);
}

export function restoreBreakWithForcedBreaks(
  breakKey: PhraseBreakKey,
  mergedBreaks: PhraseBreakKey[],
  forcedBreaks: PhraseBreakKey[],
  phraseAutoJoined = false
): { mergedBreaks: PhraseBreakKey[]; forcedBreaks: PhraseBreakKey[] } {
  const wasInMerged = mergedBreaks.some((b) => b.endWordIndex === breakKey.endWordIndex);
  const nextMerged = restoreMergedBreakKey(mergedBreaks, breakKey);
  const nextForced = [...forcedBreaks];
  if (
    (!wasInMerged || phraseAutoJoined) &&
    !nextForced.some((b) => b.endWordIndex === breakKey.endWordIndex)
  ) {
    nextForced.push({ endWordIndex: breakKey.endWordIndex, wordText: breakKey.wordText });
    nextForced.sort((a, b) => a.endWordIndex - b.endWordIndex);
  }
  return { mergedBreaks: nextMerged, forcedBreaks: nextForced };
}

export function toggleExtraBreakKey(
  extraBreaks: PhraseBreakKey[],
  breakKey: PhraseBreakKey
): PhraseBreakKey[] {
  if (extraBreaks.some((b) => b.endWordIndex === breakKey.endWordIndex)) {
    return extraBreaks.filter((b) => b.endWordIndex !== breakKey.endWordIndex);
  }
  return [...extraBreaks, breakKey].sort((a, b) => a.endWordIndex - b.endWordIndex);
}

function trailingPunctChar(word: string): string {
  const m = word.match(/([,;:.?!]+)['"”’)\]]*$/);
  return m ? m[1][m[1].length - 1] : '';
}

function splitReadingClauses(
  text: string
): { words: string[]; kind: ReadingCadenceKind | null; paragraphBreak: boolean }[] {
  const rawParagraphs = text
    .split(/\r?\n(?:[ \t]*\r?\n)+/)
    .map((p) => p.replace(/\s*\r?\n\s*/g, ' ').trim())
    .filter(Boolean);
  const clauses: { words: string[]; kind: ReadingCadenceKind | null; paragraphBreak: boolean }[] = [];
  for (let pi = 0; pi < rawParagraphs.length; pi++) {
    let pendingBreak = pi > 0 && clauses.length > 0;
    const words = rawParagraphs[pi].split(/\s+/).filter(Boolean);
    let current: string[] = [];
    for (const w of words) {
      current.push(w);
      const m = w.match(/[,;:.?!]+$/);
      if (m) {
        const kind = PUNCT_KIND[m[0][m[0].length - 1]] ?? null;
        clauses.push({ words: current, kind, paragraphBreak: pendingBreak });
        current = [];
        pendingBreak = false;
      }
    }
    if (current.length) clauses.push({ words: current, kind: null, paragraphBreak: pendingBreak });
  }
  return clauses;
}

function splitLinesPhrases(
  text: string,
  tone: ToneDefinition,
  language: ChantLanguage,
  treatLineBreaksAsPhraseBreaks: boolean
): { words: string[]; kind: ReadingCadenceKind | null; paragraphBreak: boolean }[] {
  const hasQuestion = Boolean(getReadingCadence(tone, 'question', language));

  if (!treatLineBreaksAsPhraseBreaks) {
    const rawParagraphs = text
      .split(/\r?\n(?:[ \t]*\r?\n)+/)
      .map((p) => p.replace(/\s*\r?\n\s*/g, ' ').trim())
      .filter(Boolean);
    const phrases: { words: string[]; kind: ReadingCadenceKind | null; paragraphBreak: boolean }[] = [];

    for (let pi = 0; pi < rawParagraphs.length; pi++) {
      let pendingBreak = pi > 0 && phrases.length > 0;
      const words = rawParagraphs[pi].split(/\s+/).filter(Boolean);
      let current: string[] = [];
      for (const w of words) {
        current.push(w);
        const ch = trailingPunctChar(w);
        if (ch === ',') {
          phrases.push({ words: current, kind: 'flex', paragraphBreak: pendingBreak });
          current = [];
          pendingBreak = false;
        } else if (ch === ';' || ch === ':') {
          phrases.push({ words: current, kind: 'metrum', paragraphBreak: pendingBreak });
          current = [];
          pendingBreak = false;
        } else if (ch === '.' || ch === '!') {
          phrases.push({ words: current, kind: 'punctum', paragraphBreak: pendingBreak });
          current = [];
          pendingBreak = false;
        } else if (ch === '?') {
          phrases.push({
            words: current,
            kind: hasQuestion ? 'question' : null,
            paragraphBreak: pendingBreak,
          });
          current = [];
          pendingBreak = false;
        }
      }
      if (current.length > 0) {
        phrases.push({ words: current, kind: null, paragraphBreak: pendingBreak });
      }
    }
    return phrases;
  }

  const rawLines = text.split(/\r?\n/);
  const phrases: { words: string[]; kind: ReadingCadenceKind | null; paragraphBreak: boolean }[] = [];
  let pendingBreak = false;

  for (const rawLine of rawLines) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      if (phrases.length > 0) pendingBreak = true;
      continue;
    }
    const words = trimmed.split(/\s+/).filter(Boolean);
    let current: string[] = [];
    for (let wi = 0; wi < words.length; wi++) {
      const w = words[wi];
      current.push(w);
      const isLineEnd = wi === words.length - 1;
      const ch = trailingPunctChar(w);

      if (!isLineEnd) {
        if (ch === ';' || (language === 'la' && ch === ':')) {
          phrases.push({ words: current, kind: 'metrum', paragraphBreak: pendingBreak });
          current = [];
          pendingBreak = false;
        } else if (ch === '.' || ch === '!' || (language !== 'la' && ch === ':')) {
          phrases.push({ words: current, kind: 'punctum', paragraphBreak: pendingBreak });
          current = [];
          pendingBreak = false;
        } else if (ch === '?') {
          phrases.push({
            words: current,
            kind: hasQuestion ? 'question' : null,
            paragraphBreak: pendingBreak,
          });
          current = [];
          pendingBreak = false;
        }
        // Mid-line comma (`,`) gives no cadence and does not end the phrase.
      } else {
        let kind: ReadingCadenceKind | null;
        if (ch === '.' || ch === '!' || (language !== 'la' && ch === ':')) {
          kind = 'punctum';
        } else if (ch === '?') {
          kind = hasQuestion ? 'question' : null;
        } else {
          // `,`, `;`, `:` (Latin), or no punctuation at line end -> metrum
          kind = 'metrum';
        }
        phrases.push({ words: current, kind, paragraphBreak: pendingBreak });
        current = [];
        pendingBreak = false;
      }
    }
  }
  return phrases;
}

const ENGLISH_UNIT_STARTER_RE = /^(?:since|that|so\s+that|because|until|which|where|when)\b/i;

export function assignEnglishPrefaceRoles(
  phrases: { text: string; paragraphBreak: boolean }[]
): EnglishPrefaceRole[] {
  if (phrases.length === 0) return [];
  const unitStarts: number[] = [];
  for (let i = 0; i < phrases.length; i++) {
    const isStart =
      i === 0 ||
      phrases[i].paragraphBreak ||
      /[.?!]['"”’)\]]*$/.test(phrases[i - 1].text.trim()) ||
      ENGLISH_UNIT_STARTER_RE.test(phrases[i].text.trim());
    if (isStart) unitStarts.push(i);
  }

  const roles = new Array<EnglishPrefaceRole>(phrases.length);
  for (let u = 0; u < unitStarts.length; u++) {
    const start = unitStarts[u];
    const end = u + 1 < unitStarts.length ? unitStarts[u + 1] : phrases.length;
    const len = end - start;
    for (let k = 0; k < len; k++) {
      if (k === len - 1) roles[start + k] = 'g-long';
      else if (k === 0) roles[start + k] = 'h-metrum';
      else roles[start + k] = 'g-flex';
    }
  }
  return roles;
}

export function roleToReadingKind(
  role: EnglishPrefaceRole,
  isFinalLine: boolean
): ReadingCadenceKind {
  if (role === 'h-metrum') return 'metrum';
  if (role === 'g-flex') return 'flex';
  return isFinalLine ? 'final' : 'punctum';
}

export function readingKindToRole(kind: ReadingCadenceKind): EnglishPrefaceRole | undefined {
  if (kind === 'metrum') return 'h-metrum';
  if (kind === 'flex') return 'g-flex';
  if (kind === 'punctum' || kind === 'final') return 'g-long';
  return undefined;
}

export function barForCadence(
  effectiveKind: ReadingCadenceKind | null | undefined,
  isLastOfWholeText: boolean
): ',' | ';' | ':' | '::' | null {
  if (isLastOfWholeText) return '::';
  switch (effectiveKind) {
    case 'punctum':
    case 'question':
    case 'final':
      return ':';
    case 'metrum':
    case 'prefinal':
      return ';';
    case 'flex':
      return ',';
    default:
      return null;
  }
}

export function englishPrefaceBar(
  _phraseText: string,
  roleOrKind: EnglishPrefaceRole | ReadingCadenceKind | null | undefined,
  isLastOfWholeText: boolean
): ',' | ';' | ':' | '::' | null {
  const effectiveKind: ReadingCadenceKind | null | undefined =
    roleOrKind === 'h-metrum'
      ? 'metrum'
      : roleOrKind === 'g-flex'
      ? 'flex'
      : roleOrKind === 'g-long'
      ? 'punctum'
      : roleOrKind;
  return barForCadence(effectiveKind, isLastOfWholeText);
}

export function getReadingWordList(
  text: string,
  tone: ToneDefinition,
  opts: {
    language?: ChantLanguage;
    openingFormula?: string;
    treatLineBreaksAsPhraseBreaks?: boolean;
  } = {}
): string[] {
  const language = opts.language ?? 'la';
  const isLinesMode = tone.phrasing === 'lines';
  const treatLineBreaksAsPhrases = opts.treatLineBreaksAsPhraseBreaks ?? language === 'en';
  const bodyPhrases = isLinesMode
    ? splitLinesPhrases(text, tone, language, treatLineBreaksAsPhrases)
    : splitReadingClauses(text).map((cl) => ({ ...cl, paragraphBreak: false }));
  if (bodyPhrases.length === 0) return [];
  const formulaText = language === 'la' && !isLinesMode ? opts.openingFormula?.trim() : '';
  const allWords: string[] = [];
  if (formulaText) {
    for (const cl of splitReadingClauses(formulaText)) {
      allWords.push(...cl.words);
    }
  }
  for (const p of bodyPhrases) {
    allWords.push(...p.words);
  }
  return allWords;
}

export function extractReadingPhrases(
  text: string,
  tone: ToneDefinition,
  opts: {
    language?: ChantLanguage;
    cadenceOverrides?: Record<number, ReadingCadenceKind | null>;
    roleOverrides?: Record<number, EnglishPrefaceRole>;
    mergedBreaks?: PhraseBreakKey[];
    forcedBreaks?: PhraseBreakKey[];
    extraBreaks?: PhraseBreakKey[];
    autoJoinShortPhrases?: number;
    openingFormula?: string;
    treatLineBreaksAsPhraseBreaks?: boolean;
  } = {}
): ReadingPhrase[] {
  const language = opts.language ?? 'la';
  const overrides = opts.cadenceOverrides ?? {};
  const roleOverrides = opts.roleOverrides ?? {};
  const isLinesMode = tone.phrasing === 'lines';
  const isEnglishPreface = isLinesMode && language === 'en';
  const treatLineBreaksAsPhrases = opts.treatLineBreaksAsPhraseBreaks ?? language === 'en';

  const bodyPhrases = isLinesMode
    ? splitLinesPhrases(text, tone, language, treatLineBreaksAsPhrases)
    : splitReadingClauses(text);

  if (bodyPhrases.length === 0) return [];

  const formulaText = language === 'la' && !isLinesMode ? opts.openingFormula?.trim() : '';
  const basePiecesRaw: {
    words: string[];
    kind: ReadingCadenceKind | null;
    paragraphBreak: boolean;
    isOpeningFormula?: boolean;
    isAutoJoinProtected?: boolean;
  }[] = formulaText
    ? [
        ...splitReadingClauses(formulaText).map((cl) => ({
          ...cl,
          paragraphBreak: false,
          isOpeningFormula: true,
          isAutoJoinProtected: true,
        })),
        ...bodyPhrases,
      ]
    : bodyPhrases.map((bp, bpIdx) => ({
        ...bp,
        isAutoJoinProtected:
          !isLinesMode &&
          language === 'la' &&
          bpIdx === 0 &&
          isProtectedReadingOpeningText(bp.words.join(' ')),
      }));

  // Assign contiguous 0-based word indices across all words in basePiecesRaw
  const allWords: string[] = [];
  const indexedBase = basePiecesRaw.map((p) => {
    const startWordIndex = allWords.length;
    allWords.push(...p.words);
    const endWordIndex = allWords.length - 1;
    return {
      ...p,
      startWordIndex,
      endWordIndex,
    };
  });

  const validExtraBreaks = prunePhraseBreakKeys(opts.extraBreaks ?? [], allWords);
  const validMergedBreaks = prunePhraseBreakKeys(opts.mergedBreaks ?? [], allWords);
  const validForcedBreaks = prunePhraseBreakKeys(opts.forcedBreaks ?? [], allWords);
  const extraSet = new Set(validExtraBreaks.map((b) => b.endWordIndex));
  const mergedSet = new Set(validMergedBreaks.map((b) => b.endWordIndex));
  const forcedSet = new Set(validForcedBreaks.map((b) => b.endWordIndex));

  // Compute unmerged English line-break roles on basePiecesRaw BEFORE extra/merged breaks
  // so that adding an interior extraBreak or merging keeps the original role assignments predictable.
  const baseRoles =
    isEnglishPreface && treatLineBreaksAsPhrases
      ? assignEnglishPrefaceRoles(
          indexedBase.map((p) => ({ text: p.words.join(' '), paragraphBreak: p.paragraphBreak }))
        )
      : [];

  // Apply interior extraBreaks (left sub-piece defaults to kind=null / no role; right sub-piece keeps original)
  interface SubPiece {
    words: string[];
    startWordIndex: number;
    endWordIndex: number;
    kind: ReadingCadenceKind | null;
    defaultRole?: EnglishPrefaceRole;
    paragraphBreak: boolean;
    isOpeningFormula?: boolean;
    isAutoJoinProtected?: boolean;
    isExtraSplitLeft?: boolean;
  }
  const subPieces: SubPiece[] = [];
  indexedBase.forEach((p, bIdx) => {
    const baseRole = baseRoles[bIdx];
    if (p.isOpeningFormula || p.words.length <= 1) {
      subPieces.push({
        words: p.words,
        startWordIndex: p.startWordIndex,
        endWordIndex: p.endWordIndex,
        kind: p.kind,
        defaultRole: baseRole,
        paragraphBreak: p.paragraphBreak,
        isOpeningFormula: p.isOpeningFormula,
        isAutoJoinProtected: p.isAutoJoinProtected,
      });
      return;
    }

    let segStartLocal = 0;
    for (let wi = 0; wi < p.words.length - 1; wi++) {
      const globalWi = p.startWordIndex + wi;
      if (extraSet.has(globalWi)) {
        subPieces.push({
          words: p.words.slice(segStartLocal, wi + 1),
          startWordIndex: p.startWordIndex + segStartLocal,
          endWordIndex: globalWi,
          kind: null,
          defaultRole: undefined,
          paragraphBreak: segStartLocal === 0 ? p.paragraphBreak : false,
          isOpeningFormula: p.isOpeningFormula,
          isAutoJoinProtected: p.isAutoJoinProtected,
          isExtraSplitLeft: true,
        });
        segStartLocal = wi + 1;
      }
    }
    subPieces.push({
      words: p.words.slice(segStartLocal),
      startWordIndex: p.startWordIndex + segStartLocal,
      endWordIndex: p.endWordIndex,
      kind: p.kind,
      defaultRole: baseRole,
      paragraphBreak: segStartLocal === 0 ? p.paragraphBreak : false,
      isOpeningFormula: p.isOpeningFormula,
      isAutoJoinProtected: p.isAutoJoinProtected,
    });
  });

  // Add-on B: Default single left-to-right auto-join pass per paragraph BEFORE user merges.
  const effectiveAutoJoin =
    isEnglishPreface && treatLineBreaksAsPhrases
      ? 0
      : opts.autoJoinShortPhrases === undefined
      ? DEFAULT_AUTO_JOIN_SHORT_PHRASES
      : clampAutoJoinShortPhrases(opts.autoJoinShortPhrases);

  interface WorkingGroup {
    pieces: SubPiece[];
    autoBreakIds: Set<number>;
  }

  const autoGroups: WorkingGroup[] = [];
  const lastGlobalIdx = subPieces.length - 1;

  const canAutoJoinBoundary = (leftPiece: SubPiece, rightPiece: SubPiece): boolean => {
    if (rightPiece.paragraphBreak) return false;
    if (leftPiece.isOpeningFormula || leftPiece.isAutoJoinProtected) return false;
    if (rightPiece.isOpeningFormula || rightPiece.isAutoJoinProtected) return false;
    if (leftPiece.isExtraSplitLeft) return false;
    if (forcedSet.has(leftPiece.endWordIndex) || mergedSet.has(leftPiece.endWordIndex)) return false;
    return true;
  };

  if (effectiveAutoJoin > 0 && subPieces.length > 0) {
    // Partition into contiguous runs; opening formulas are standalone, otherwise split at paragraphBreak.
    let cursor = 0;
    while (cursor < subPieces.length) {
      if (subPieces[cursor].isOpeningFormula || subPieces[cursor].isAutoJoinProtected) {
        autoGroups.push({ pieces: [subPieces[cursor]], autoBreakIds: new Set() });
        cursor++;
        continue;
      }
      const runStart = cursor;
      let runEnd = cursor;
      while (
        runEnd + 1 < subPieces.length &&
        !subPieces[runEnd + 1].paragraphBreak &&
        !subPieces[runEnd + 1].isOpeningFormula &&
        !subPieces[runEnd + 1].isAutoJoinProtected
      ) {
        runEnd++;
      }

      const paraGroups: WorkingGroup[] = [];
      let i = runStart;
      while (i <= runEnd) {
        const piece = subPieces[i];
        const curPieces: SubPiece[] = [piece];
        const autoBreakIds = new Set<number>();
        let nextIdx = i + 1;

        const isLastOfWholeText = i === lastGlobalIdx;
        const wordCount = countRealWords(piece.words);
        const isFirstInPara = paraGroups.length === 0;
        const prevGroup = paraGroups.length > 0 ? paraGroups[paraGroups.length - 1] : null;
        const prevLastPiece = prevGroup ? prevGroup.pieces[prevGroup.pieces.length - 1] : null;
        const prevLastWord = prevLastPiece
          ? prevLastPiece.words[prevLastPiece.words.length - 1] ?? ''
          : '';
        const prevEndedWithSentence = /[.?!]['"”’)\]]*$/.test(prevLastWord);

        if (!isLastOfWholeText && wordCount <= effectiveAutoJoin) {
          if (isFirstInPara || prevEndedWithSentence) {
            // Allowed direction: NEXT
            while (nextIdx <= runEnd) {
              const curLast = curPieces[curPieces.length - 1];
              const candidateNext = subPieces[nextIdx];
              if (!canAutoJoinBoundary(curLast, candidateNext)) break;
              autoBreakIds.add(curLast.endWordIndex);
              curPieces.push(candidateNext);
              const mergedEndIdx = nextIdx;
              nextIdx++;
              if (mergedEndIdx === lastGlobalIdx) break;
              const mergedWordCount = countRealWords(curPieces.flatMap((p) => p.words));
              if (mergedWordCount > effectiveAutoJoin) break;
            }
            paraGroups.push({ pieces: curPieces, autoBreakIds });
            i = nextIdx;
            continue;
          } else if (prevGroup && prevLastPiece && canAutoJoinBoundary(prevLastPiece, piece)) {
            // Allowed direction: PREVIOUS
            prevGroup.autoBreakIds.add(prevLastPiece.endWordIndex);
            prevGroup.pieces.push(piece);
            i = nextIdx;
            continue;
          }
        }

        paraGroups.push({ pieces: curPieces, autoBreakIds });
        i = nextIdx;
      }

      autoGroups.push(...paraGroups);
      cursor = runEnd + 1;
    }
  } else {
    for (const sp of subPieces) {
      autoGroups.push({ pieces: [sp], autoBreakIds: new Set() });
    }
  }

  // Step 2: Merge adjacent autoGroups along valid user mergedBreaks (refusing paragraphBreak & openingFormula boundaries)
  const mergedGroups: WorkingGroup[] = [];
  for (const ag of autoGroups) {
    const firstOfAg = ag.pieces[0];
    const prevGroup = mergedGroups[mergedGroups.length - 1];
    const prevLast = prevGroup ? prevGroup.pieces[prevGroup.pieces.length - 1] : null;
    const canMergeWithPrev =
      Boolean(prevLast) &&
      mergedSet.has(prevLast!.endWordIndex) &&
      !firstOfAg.paragraphBreak &&
      !prevLast!.isOpeningFormula &&
      !firstOfAg.isOpeningFormula;
    if (canMergeWithPrev) {
      prevGroup!.pieces.push(...ag.pieces);
      for (const id of ag.autoBreakIds) {
        prevGroup!.autoBreakIds.add(id);
      }
    } else {
      mergedGroups.push({
        pieces: [...ag.pieces],
        autoBreakIds: new Set(ag.autoBreakIds),
      });
    }
  }

  let prevEffectiveKind: ReadingCadenceKind | null = null;

  return mergedGroups.map((wg, idx) => {
    const group = wg.pieces;
    const first = group[0];
    const last = group[group.length - 1];
    const words = group.flatMap((g) => g.words);
    const phraseText = words.join(' ');
    const startWordIndex = first.startWordIndex;
    const endWordIndex = last.endWordIndex;
    const endWordText = words[words.length - 1] ?? '';
    const isLast = idx === mergedGroups.length - 1;
    const internalMergedBreaks: PhraseBreakKey[] = group
      .slice(0, -1)
      .map((g) => ({
        endWordIndex: g.endWordIndex,
        wordText: allWords[g.endWordIndex] ?? '',
      }));
    const autoJoined = wg.autoBreakIds.size > 0;

    const prevGroup = idx > 0 ? mergedGroups[idx - 1].pieces : null;
    const nextGroup = idx < mergedGroups.length - 1 ? mergedGroups[idx + 1].pieces : null;
    const canJoinPrev = Boolean(
      prevGroup &&
        !first.paragraphBreak &&
        !first.isOpeningFormula &&
        !prevGroup[0].isOpeningFormula
    );
    const canJoinNext = Boolean(
      nextGroup &&
        !first.isOpeningFormula &&
        !nextGroup[0].isOpeningFormula &&
        !nextGroup[0].paragraphBreak
    );

    if (isEnglishPreface) {
      const hasRoleOverride = Object.prototype.hasOwnProperty.call(roleOverrides, endWordIndex);
      const hasCadenceOverride = Object.prototype.hasOwnProperty.call(overrides, endWordIndex);

      let defaultKind: ReadingCadenceKind | null;
      let defaultRole: EnglishPrefaceRole | undefined;
      if (treatLineBreaksAsPhrases) {
        if (last.isExtraSplitLeft) {
          defaultRole = undefined;
          defaultKind = null;
        } else {
          defaultRole = last.defaultRole;
          defaultKind = defaultRole
            ? roleToReadingKind(
                defaultRole,
                isLast && getReadingCadence(tone, 'final', language) !== undefined
              )
            : last.kind;
        }
      } else {
        // In punctuation-based English preface mode, preserve the cadence
        // implied by punctuation. An unfinished final phrase has no cadence;
        // being last in the pasted text must not turn it into a final formula.
        defaultKind = last.kind;
        defaultRole = defaultKind ? readingKindToRole(defaultKind) : undefined;
      }

      let effectiveRole: EnglishPrefaceRole | undefined = hasRoleOverride
        ? roleOverrides[endWordIndex]
        : defaultRole;
      let effectiveKind: ReadingCadenceKind | null = effectiveRole
        ? roleToReadingKind(
            effectiveRole,
            isLast && getReadingCadence(tone, 'final', language) !== undefined
          )
        : defaultKind;

      if (!hasRoleOverride && hasCadenceOverride) {
        effectiveKind = overrides[endWordIndex];
        effectiveRole = effectiveKind ? readingKindToRole(effectiveKind) : undefined;
      } else if (hasRoleOverride) {
        effectiveKind = roleToReadingKind(
          roleOverrides[endWordIndex],
          isLast && getReadingCadence(tone, 'final', language) !== undefined
        );
      }

      const resolvedCadence = effectiveKind ? getReadingCadence(tone, effectiveKind, language) : null;
      const choiceLabel = cadenceKindToLabel(effectiveKind, resolvedCadence);

      const startsPhrase = treatLineBreaksAsPhrases
        ? effectiveKind === null || effectiveRole === 'h-metrum'
        : effectiveRole
        ? effectiveRole === 'h-metrum'
        : idx === 0 || (tone.reintone === true && prevEffectiveKind !== 'flex');

      prevEffectiveKind = effectiveKind;

      return {
        index: idx,
        text: phraseText,
        words,
        startWordIndex,
        endWordIndex,
        endWordText,
        defaultKind,
        effectiveKind,
        choiceLabel,
        overridden: hasRoleOverride || hasCadenceOverride,
        startsPhrase,
        paragraphBreak: first.paragraphBreak,
        defaultRole,
        effectiveRole,
        roleOverridden: hasRoleOverride,
        merged: group.length > 1,
        mergedFrom: group.length,
        autoJoined,
        internalMergedBreaks,
        isOpeningFormula: first.isOpeningFormula,
        canJoinPrev,
        canJoinNext,
      };
    }

    let defaultKind = last.kind;
    if (isLinesMode) {
      if (
        isLast &&
        defaultKind !== null &&
        defaultKind !== 'question' &&
        getReadingCadence(tone, 'final', language) !== undefined
      ) {
        defaultKind = 'final';
      }
    } else if (!first.isOpeningFormula && defaultKind !== 'question') {
      if (isLast && defaultKind !== null && getReadingCadence(tone, 'final', language)) {
        defaultKind = 'final';
      } else if (
        idx === mergedGroups.length - 2 &&
        defaultKind !== null &&
        getReadingCadence(tone, 'prefinal', language)
      ) {
        defaultKind = 'prefinal';
      }
    }

    const overridden = Object.prototype.hasOwnProperty.call(overrides, endWordIndex);
    const effectiveKind = overridden ? overrides[endWordIndex] : defaultKind;
    const resolvedCadence = effectiveKind ? getReadingCadence(tone, effectiveKind, language) : null;
    const choiceLabel = cadenceKindToLabel(effectiveKind, resolvedCadence);

    const startsPhrase =
      isLinesMode && treatLineBreaksAsPhrases
        ? true
        : idx === 0 || (tone.reintone === true && prevEffectiveKind !== 'flex');

    prevEffectiveKind = effectiveKind;

    return {
      index: idx,
      text: phraseText,
      words,
      startWordIndex,
      endWordIndex,
      endWordText,
      defaultKind,
      effectiveKind,
      choiceLabel,
      overridden,
      startsPhrase,
      paragraphBreak: first.paragraphBreak,
      merged: group.length > 1,
      mergedFrom: group.length,
      autoJoined,
      internalMergedBreaks,
      isOpeningFormula: first.isOpeningFormula,
      canJoinPrev,
      canJoinNext,
    };
  });
}

export function pointEnglishPrefacePhrase(
  phraseText: string,
  tone: ToneDefinition,
  opts: {
    role?: EnglishPrefaceRole;
    effectiveKind?: ReadingCadenceKind | null;
    isLastOfWholeText?: boolean;
    startsPhrase?: boolean;
    stressOverrides?: Record<number, boolean>;
    syllOffset?: number;
  } = {}
): { gabc: string; warnings: string[]; syllableCount: number } {
  const sylls = toToneSyllables(phraseText, {
    language: 'en',
    stressOverrides: opts.stressOverrides,
    offset: opts.syllOffset ?? 0,
  });
  const warnings: string[] = [];
  let notes = new Map<number, string>();
  let tenor = tone.tenor;

  let appliedQuestionMissingCadence = false;
  if (opts.effectiveKind === null) {
    if (opts.startsPhrase !== false && tone.intonation.length > 0) {
      tone.intonation.forEach((n, i) => {
        if (i < sylls.length) notes.set(i, n);
      });
    }
  } else if (opts.effectiveKind === 'question') {
    const qCadence = getReadingCadence(tone, 'question', 'en');
    if (qCadence) {
      notes = applyCadence(sylls, qCadence);
      tenor = qCadence.recite ?? tone.tenor;
    } else {
      appliedQuestionMissingCadence = true;
      warnings.push('No "question" cadence defined; reciting on the tenor.');
    }
  } else {
    const role = opts.role ?? 'h-metrum';
    const res = applyEnglishPrefaceRole(sylls, role, tone, phraseText);
    notes = res.notes;
    tenor = res.tenor;
    warnings.push(...res.warnings);
  }

  const effectiveKindForBar: ReadingCadenceKind | null | undefined =
    opts.effectiveKind !== undefined
      ? opts.effectiveKind
      : opts.role === 'h-metrum'
      ? 'metrum'
      : opts.role === 'g-flex'
      ? 'flex'
      : opts.role === 'g-long'
      ? 'punctum'
      : 'metrum';
  if (
    sylls.length > 0 &&
    !appliedQuestionMissingCadence &&
    terminationRequiresMora(effectiveKindForBar)
  ) {
    const lastIdx = sylls.length - 1;
    const lastNote = notes.get(lastIdx) ?? tenor;
    if (!lastNote.endsWith('.')) {
      notes.set(lastIdx, `${lastNote}.`);
    }
  }
  const bar = barForCadence(effectiveKindForBar, Boolean(opts.isLastOfWholeText));
  const rendered = renderSyllables(sylls, notes, tenor);
  return {
    gabc: bar ? `${rendered} (${bar})` : rendered,
    warnings,
    syllableCount: sylls.length,
  };
}

/** Point a reading (epistle, gospel, prophecy, preface...): recite on the tenor, cadence at each phrase end. */
export function pointReading(text: string, tone: ToneDefinition, opts: PointingOptions = {}): PointingResult {
  const warnings: string[] = [];
  const language = opts.language ?? 'la';
  const phrases = extractReadingPhrases(text, tone, {
    language,
    cadenceOverrides: opts.cadenceOverrides,
    roleOverrides: opts.roleOverrides,
    mergedBreaks: opts.mergedBreaks,
    forcedBreaks: opts.forcedBreaks,
    extraBreaks: opts.extraBreaks,
    autoJoinShortPhrases: opts.autoJoinShortPhrases,
    openingFormula: opts.openingFormula,
    treatLineBreaksAsPhraseBreaks: opts.treatLineBreaksAsPhraseBreaks,
  });
  if (phrases.length === 0) return { gabc: '', warnings: ['Paste some text first.'], phrases: [] };

  const prefix = `${header(tone, opts.title)} `;
  const isEnglishPreface = language === 'en' && tone.phrasing === 'lines';
  const phraseLinks: TonePhraseLinkItem[] = [];
  let body = '';
  let cursor = 0;

  if (isEnglishPreface) {
    phrases.forEach((ph, idx) => {
      const sourceStart = prefix.length + body.length;
      const firstSyllableIndex = cursor;
      const res = pointEnglishPrefacePhrase(ph.text, tone, {
        role: ph.effectiveRole,
        effectiveKind: ph.effectiveKind,
        isLastOfWholeText: idx === phrases.length - 1,
        startsPhrase: ph.startsPhrase,
        stressOverrides: opts.stressOverrides,
        syllOffset: cursor,
      });
      cursor += res.syllableCount;
      const lastSyllableIndex = cursor - 1;
      warnings.push(...res.warnings);
      const chunk = res.gabc.trim();
      const tokenEndOffset = sourceStart + chunk.length;
      const hasTrailingBar = /\s*\((?:,|;|::|:)\)\s*$/.test(chunk);
      const endAnchorOffset = Math.max(sourceStart, tokenEndOffset - 1);
      const isLastPhrase = idx === phrases.length - 1;
      body += isLastPhrase ? chunk : `${chunk} `;
      const sourceEnd = prefix.length + body.length;

      phraseLinks.push({
        index: ph.index,
        text: ph.text,
        words: ph.words,
        startWordIndex: ph.startWordIndex,
        endWordIndex: ph.endWordIndex,
        endWordText: ph.endWordText,
        defaultKind: ph.defaultKind,
        effectiveKind: ph.effectiveKind,
        choiceLabel: ph.choiceLabel,
        overridden: ph.overridden,
        defaultRole: ph.defaultRole,
        effectiveRole: ph.effectiveRole,
        roleOverridden: ph.roleOverridden,
        merged: ph.merged,
        mergedFrom: ph.mergedFrom,
        autoJoined: ph.autoJoined,
        internalMergedBreaks: ph.internalMergedBreaks,
        paragraphBreak: ph.paragraphBreak,
        isOpeningFormula: ph.isOpeningFormula,
        canJoinPrev: ph.canJoinPrev,
        canJoinNext: ph.canJoinNext,
        sourceStart,
        sourceEnd,
        endAnchorOffset,
        hasTrailingBar,
        firstSyllableIndex,
        lastSyllableIndex,
      });
    });
    return {
      gabc: `${prefix}${body.trimEnd()}\n`,
      warnings: [...new Set(warnings)],
      phrases: phraseLinks,
    };
  }

  phrases.forEach((ph, idx) => {
    const sourceStart = prefix.length + body.length;
    const firstSyllableIndex = cursor;
    const sylls = toToneSyllables(ph.text, {
      language,
      stressOverrides: opts.stressOverrides,
      offset: cursor,
    });
    cursor += sylls.length;
    const lastSyllableIndex = cursor - 1;
    let notes = new Map<number, string>();
    const kind = ph.effectiveKind;
    const cadence = kind ? getReadingCadence(tone, kind, language) : null;
    if (kind && cadence === undefined) {
      warnings.push(`No "${kind === 'flex' ? 'flexa' : kind}" cadence defined; reciting on the tenor.`);
    }
    if (cadence) notes = applyCadence(sylls, cadence);
    const isShortRecitePickup = Boolean(cadence?.recite && cadence.recite !== tone.tenor && notes.has(1));
    if (ph.startsPhrase && tone.intonation.length > 0 && !isShortRecitePickup) {
      tone.intonation.forEach((n, i) => {
        if (i < sylls.length && !notes.has(i)) notes.set(i, n);
      });
    }
    const tenor = cadence?.recite ?? tone.tenor;
    if (sylls.length > 0 && cadence && terminationRequiresMora(kind)) {
      const lastIdx = sylls.length - 1;
      const lastNote = notes.get(lastIdx) ?? tenor;
      if (!lastNote.endsWith('.')) {
        notes.set(lastIdx, `${lastNote}.`);
      }
    }
    const rendered = renderSyllables(sylls, notes, tenor);
    const bar = barForCadence(kind, idx === phrases.length - 1);
    const chunk = bar ? `${rendered} (${bar})` : rendered;
    const tokenEndOffset = sourceStart + chunk.length;
    const endAnchorOffset = Math.max(sourceStart, tokenEndOffset - 1);
    const isLastPhrase = idx === phrases.length - 1;
    body += isLastPhrase ? chunk : `${chunk} `;
    const sourceEnd = prefix.length + body.length;

    phraseLinks.push({
      index: ph.index,
      text: ph.text,
      words: ph.words,
      startWordIndex: ph.startWordIndex,
      endWordIndex: ph.endWordIndex,
      endWordText: ph.endWordText,
      defaultKind: ph.defaultKind,
      effectiveKind: ph.effectiveKind,
      choiceLabel: ph.choiceLabel,
      overridden: ph.overridden,
      defaultRole: ph.defaultRole,
      effectiveRole: ph.effectiveRole,
      roleOverridden: ph.roleOverridden,
      merged: ph.merged,
      mergedFrom: ph.mergedFrom,
      autoJoined: ph.autoJoined,
      internalMergedBreaks: ph.internalMergedBreaks,
      paragraphBreak: ph.paragraphBreak,
      isOpeningFormula: ph.isOpeningFormula,
      canJoinPrev: ph.canJoinPrev,
      canJoinNext: ph.canJoinNext,
      sourceStart,
      sourceEnd,
      endAnchorOffset,
      hasTrailingBar: Boolean(bar),
      firstSyllableIndex,
      lastSyllableIndex,
    });
  });
  return {
    gabc: `${prefix}${body.trimEnd()}\n`,
    warnings: [...new Set(warnings)],
    phrases: phraseLinks,
  };
}

export type ToneMode = 'psalm' | 'reading' | 'preface';

export function pointText(
  mode: ToneMode,
  text: string,
  tone: ToneDefinition,
  opts: PointingOptions = {}
): PointingResult {
  return mode === 'psalm' ? pointPsalm(text, tone, opts) : pointReading(text, tone, opts);
}

export type PreviewToken =
  | { kind: 'syllable'; globalIndex: number; text: string; stressed: boolean; wordStart: boolean; wordEnd: boolean }
  | { kind: 'marker'; symbol: '*' | '†' };

/**
 * Extract the exact syllable list & global indices that `pointText` uses,
 * so the interactive stress-preview UI stays 1-to-1 with tone pointing.
 */
export function extractTonePreview(
  mode: ToneMode,
  text: string,
  opts: {
    language?: ChantLanguage;
    autoFlexSyllables?: number;
    hasFlex?: boolean;
    stressOverrides?: Record<number, boolean>;
    tone?: ToneDefinition;
    cadenceOverrides?: Record<number, ReadingCadenceKind | null>;
    mergedBreaks?: PhraseBreakKey[];
    forcedBreaks?: PhraseBreakKey[];
    extraBreaks?: PhraseBreakKey[];
    autoJoinShortPhrases?: number;
    openingFormula?: string;
    treatLineBreaksAsPhraseBreaks?: boolean;
  } = {}
): PreviewToken[][] {
  const language = opts.language ?? 'la';
  let cursor = 0;

  const pushSyllables = (out: PreviewToken[], segText: string) => {
    const sylls = toToneSyllables(segText, {
      language,
      stressOverrides: opts.stressOverrides,
      offset: cursor,
    });
    for (const s of sylls) {
      out.push({
        kind: 'syllable',
        globalIndex: cursor,
        text: s.text,
        stressed: s.stressed,
        wordStart: s.wordStart,
        wordEnd: s.wordEnd,
      });
      cursor += 1;
    }
  };

  if (mode === 'reading' || mode === 'preface') {
    if (opts.tone) {
      const phrases = extractReadingPhrases(text, opts.tone, {
        language,
        cadenceOverrides: opts.cadenceOverrides,
        mergedBreaks: opts.mergedBreaks,
        forcedBreaks: opts.forcedBreaks,
        extraBreaks: opts.extraBreaks,
        autoJoinShortPhrases: opts.autoJoinShortPhrases,
        openingFormula: opts.openingFormula,
        treatLineBreaksAsPhraseBreaks: opts.treatLineBreaksAsPhraseBreaks,
      });
      if (phrases.length === 0) return [];
      if (opts.tone.phrasing === 'lines') {
        return phrases.map((ph) => {
          const row: PreviewToken[] = [];
          pushSyllables(row, ph.text);
          return row;
        });
      }
      const line: PreviewToken[] = [];
      for (const ph of phrases) {
        pushSyllables(line, ph.text);
      }
      return [line];
    }
    const clauses = splitReadingClauses(text);
    if (clauses.length === 0) return [];
    const line: PreviewToken[] = [];
    for (const cl of clauses) {
      pushSyllables(line, cl.words.join(' '));
    }
    return [line];
  }

  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  return lines.map((line) => {
    const row: PreviewToken[] = [];
    const { first, second } = splitVerse(line, language);
    const flexParts = splitAtFlex(first, opts.autoFlexSyllables ?? 0, language);
    if (flexParts && opts.hasFlex !== false) {
      pushSyllables(row, flexParts.before);
      row.push({ kind: 'marker', symbol: '†' });
      pushSyllables(row, flexParts.after);
    } else {
      pushSyllables(row, first.replace(/\u2020/g, '').trim());
    }
    if (second !== null) {
      row.push({ kind: 'marker', symbol: '*' });
      pushSyllables(row, second);
    }
    return row;
  });
}
