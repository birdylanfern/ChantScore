import { parseGabc } from '@/src/lib/gabc/parser';
import { serializeGroupsText } from '@/src/lib/gabc/serializeCore';
import { normalizePrefaceText } from './prefaceTemplates';

export type SyllableCompareStatus =
  | 'match'
  | 'pitch-mismatch'
  | 'split-mismatch'
  | 'extra'
  | 'missing';

export interface SyllableComparison {
  status: SyllableCompareStatus;
  text: string;
  generatedText?: string;
  expectedText?: string;
  generatedNotes?: string;
  expectedNotes?: string;
  wordIndex: number;
  expectedWordIndex: number;
  syllableIndex: number;
  expectedSyllableIndex: number;
}

export interface WordComparison {
  status: 'match' | 'pitch-mismatch' | 'split-mismatch' | 'extra' | 'missing';
  generatedText: string;
  expectedText: string;
  generatedWordIndex: number;
  expectedWordIndex: number;
  phraseIndex: number;
  syllables: SyllableComparison[];
  generatedSyllableBreakdown?: { text: string; notes: string }[];
  expectedSyllableBreakdown?: { text: string; notes: string }[];
}

export interface PhraseComparison {
  phraseIndex: number;
  text: string;
  generatedDivision?: string;
  expectedDivision?: string;
  divisionMismatch: boolean;
  startWordIndex: number;
  endWordIndex: number;
  words: WordComparison[];
  syllables: SyllableComparison[];
  matchedSyllables: number;
  totalSyllables: number;
  pitchMismatches: number;
  splitMismatches: number;
  missingSyllables: number;
  extraSyllables: number;
}

export interface GabcComparisonResult {
  totals: {
    matchedSyllables: number;
    expectedSyllables: number;
    generatedSyllables: number;
    pitchMismatches: number;
    splitMismatches: number;
    missingSyllables: number;
    extraSyllables: number;
    divisionMismatches: number;
    matchRatio: number;
    summary: string;
  };
  phrases: PhraseComparison[];
  syllables: SyllableComparison[];
}

export interface CompareGabcOptions {
  /** Ignore trailing mora dots (`.`) when comparing pitches. Defaults to `true`. */
  ignoreMora?: boolean;
}

interface ExtractedSyllable {
  text: string;
  notes: string;
  compareNotes: string;
}

interface ExtractedWord {
  wordIndex: number;
  phraseIndex: number;
  rawText: string;
  normText: string;
  syllables: ExtractedSyllable[];
  trailingDivision?: string;
}

function normalizeWordForAlign(raw: string): string {
  return normalizePrefaceText(raw.replace(/-/g, '')).replace(/\s+/g, '');
}

function normalizeSyllableForAlign(raw: string): string {
  return normalizePrefaceText(raw.replace(/-/g, '')).replace(/\s+/g, '');
}

function extractParsedWords(gabc: string, ignoreMora: boolean): ExtractedWord[] {
  if (!gabc.trim()) return [];
  const score = parseGabc(gabc);
  const words: ExtractedWord[] = [];
  let curSyls: ExtractedSyllable[] = [];
  let phraseIdx = 0;

  const flushWord = () => {
    if (curSyls.length === 0) return;
    const rawText = curSyls.map((s) => s.text).join('');
    const normText = normalizeWordForAlign(rawText);
    words.push({
      wordIndex: words.length,
      phraseIndex: phraseIdx,
      rawText,
      normText,
      syllables: curSyls,
    });
    curSyls = [];
  };

  for (const item of score.items) {
    if (item.kind === 'syllable') {
      const canonNotes = serializeGroupsText(item.groups);
      const displayNotes = item.raw?.body ?? canonNotes;
      const compareNotes = ignoreMora ? canonNotes.replace(/\.+$/g, '') : canonNotes;
      curSyls.push({
        text: item.lyric,
        notes: displayNotes,
        compareNotes,
      });
      if (item.wordEnd) {
        flushWord();
      }
    } else if (item.kind === 'division') {
      flushWord();
      if (words.length > 0 && words[words.length - 1].phraseIndex === phraseIdx) {
        words[words.length - 1].trailingDivision = item.division;
        phraseIdx += 1;
      }
    } else if (item.kind === 'clef' || item.kind === 'linebreak') {
      flushWord();
    }
  }
  flushWord();

  return words;
}

type WordAlignOp =
  | { type: 'aligned'; gen: ExtractedWord; exp: ExtractedWord }
  | { type: 'extra'; gen: ExtractedWord }
  | { type: 'missing'; exp: ExtractedWord };

function alignWords(genWords: ExtractedWord[], expWords: ExtractedWord[]): WordAlignOp[] {
  const m = genWords.length;
  const n = expWords.length;

  if (m === n && genWords.every((w, i) => w.normText === expWords[i].normText)) {
    return genWords.map((gen, i) => ({ type: 'aligned', gen, exp: expWords[i] }));
  }

  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (genWords[i - 1].normText && genWords[i - 1].normText === expWords[j - 1].normText) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = dp[i - 1][j] >= dp[i][j - 1] ? dp[i - 1][j] : dp[i][j - 1];
      }
    }
  }

  const ops: WordAlignOp[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (
      i > 0 &&
      j > 0 &&
      genWords[i - 1].normText &&
      genWords[i - 1].normText === expWords[j - 1].normText
    ) {
      ops.push({ type: 'aligned', gen: genWords[i - 1], exp: expWords[j - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.push({ type: 'missing', exp: expWords[j - 1] });
      j--;
    } else {
      ops.push({ type: 'extra', gen: genWords[i - 1] });
      i--;
    }
  }
  ops.reverse();

  // Pair up 1-to-1 substituted words (adjacent extra + missing between aligned anchors)
  // when neither looks like a completely disjoint insertion/deletion.
  const compacted: WordAlignOp[] = [];
  let k = 0;
  while (k < ops.length) {
    if (ops[k].type === 'aligned') {
      compacted.push(ops[k]);
      k++;
      continue;
    }
    const extras: ExtractedWord[] = [];
    const missings: ExtractedWord[] = [];
    while (k < ops.length && ops[k].type !== 'aligned') {
      const op = ops[k];
      if (op.type === 'extra') extras.push(op.gen);
      else if (op.type === 'missing') missings.push(op.exp);
      k++;
    }
    if (extras.length === missings.length) {
      for (let idx = 0; idx < extras.length; idx++) {
        compacted.push({ type: 'aligned', gen: extras[idx], exp: missings[idx] });
      }
    } else {
      const pairCount = Math.min(extras.length, missings.length);
      for (let idx = 0; idx < pairCount; idx++) {
        compacted.push({ type: 'aligned', gen: extras[idx], exp: missings[idx] });
      }
      for (let idx = pairCount; idx < extras.length; idx++) {
        compacted.push({ type: 'extra', gen: extras[idx] });
      }
      for (let idx = pairCount; idx < missings.length; idx++) {
        compacted.push({ type: 'missing', exp: missings[idx] });
      }
    }
  }
  return compacted;
}

function compareAlignedWord(
  gen: ExtractedWord,
  exp: ExtractedWord,
  phraseIndex: number
): WordComparison {
  const gSyls = gen.syllables;
  const eSyls = exp.syllables;
  const sameCount = gSyls.length === eSyls.length;
  const sameBounds =
    sameCount &&
    gSyls.every(
      (gs, idx) => normalizeSyllableForAlign(gs.text) === normalizeSyllableForAlign(eSyls[idx].text)
    );

  if (sameCount && sameBounds) {
    const syllables: SyllableComparison[] = gSyls.map((gs, idx) => {
      const es = eSyls[idx];
      const matched = gs.compareNotes === es.compareNotes;
      return {
        status: matched ? 'match' : 'pitch-mismatch',
        text: gs.text,
        generatedText: gs.text,
        expectedText: es.text,
        generatedNotes: gs.notes,
        expectedNotes: es.notes,
        wordIndex: gen.wordIndex,
        expectedWordIndex: exp.wordIndex,
        syllableIndex: idx,
        expectedSyllableIndex: idx,
      };
    });
    const anyPitchMismatch = syllables.some((s) => s.status === 'pitch-mismatch');
    return {
      status: anyPitchMismatch ? 'pitch-mismatch' : 'match',
      generatedText: gen.rawText,
      expectedText: exp.rawText,
      generatedWordIndex: gen.wordIndex,
      expectedWordIndex: exp.wordIndex,
      phraseIndex,
      syllables,
    };
  }

  // Syllable-split mismatch: preserve alignment on surrounding words and flag this word
  const syllables: SyllableComparison[] = eSyls.map((es, idx) => ({
    status: 'split-mismatch',
    text: es.text,
    generatedText: idx === 0 ? gen.rawText : undefined,
    expectedText: es.text,
    generatedNotes: idx === 0 ? gSyls.map((s) => `${s.text}(${s.notes})`).join('') : undefined,
    expectedNotes: es.notes,
    wordIndex: gen.wordIndex,
    expectedWordIndex: exp.wordIndex,
    syllableIndex: idx < gSyls.length ? idx : -1,
    expectedSyllableIndex: idx,
  }));

  return {
    status: 'split-mismatch',
    generatedText: gen.rawText,
    expectedText: exp.rawText,
    generatedWordIndex: gen.wordIndex,
    expectedWordIndex: exp.wordIndex,
    phraseIndex,
    syllables,
    generatedSyllableBreakdown: gSyls.map((s) => ({ text: s.text, notes: s.notes })),
    expectedSyllableBreakdown: eSyls.map((s) => ({ text: s.text, notes: s.notes })),
  };
}

/**
 * Compare a generated GABC score/fragment against a known-good ground-truth GABC.
 * Parses both with `parseGabc`, aligns word by word then syllable by syllable,
 * and flags pitch mismatches and syllable-split mismatches without aborting alignment.
 */
export function compareGabc(
  generated: string,
  expected: string,
  options: CompareGabcOptions = {}
): GabcComparisonResult {
  const ignoreMora = options.ignoreMora ?? true;
  const genWords = extractParsedWords(generated, ignoreMora);
  const expWords = extractParsedWords(expected, ignoreMora);
  const ops = alignWords(genWords, expWords);

  const phraseWordsMap = new Map<number, WordComparison[]>();
  const phraseLastGenMap = new Map<number, ExtractedWord>();
  const phraseLastExpMap = new Map<number, ExtractedWord>();
  let currentPhraseIndex = 0;

  for (const op of ops) {
    if (op.type === 'aligned') {
      currentPhraseIndex = op.gen.phraseIndex;
      const wc = compareAlignedWord(op.gen, op.exp, currentPhraseIndex);
      const arr = phraseWordsMap.get(currentPhraseIndex) ?? [];
      arr.push(wc);
      phraseWordsMap.set(currentPhraseIndex, arr);
      phraseLastGenMap.set(currentPhraseIndex, op.gen);
      phraseLastExpMap.set(currentPhraseIndex, op.exp);
    } else if (op.type === 'extra') {
      currentPhraseIndex = op.gen.phraseIndex;
      const wc: WordComparison = {
        status: 'extra',
        generatedText: op.gen.rawText,
        expectedText: '',
        generatedWordIndex: op.gen.wordIndex,
        expectedWordIndex: -1,
        phraseIndex: currentPhraseIndex,
        syllables: op.gen.syllables.map((gs, idx) => ({
          status: 'extra',
          text: gs.text,
          generatedText: gs.text,
          generatedNotes: gs.notes,
          wordIndex: op.gen.wordIndex,
          expectedWordIndex: -1,
          syllableIndex: idx,
          expectedSyllableIndex: -1,
        })),
      };
      const arr = phraseWordsMap.get(currentPhraseIndex) ?? [];
      arr.push(wc);
      phraseWordsMap.set(currentPhraseIndex, arr);
      phraseLastGenMap.set(currentPhraseIndex, op.gen);
    } else {
      const pIdx = genWords.length > 0 ? currentPhraseIndex : op.exp.phraseIndex;
      const wc: WordComparison = {
        status: 'missing',
        generatedText: '',
        expectedText: op.exp.rawText,
        generatedWordIndex: -1,
        expectedWordIndex: op.exp.wordIndex,
        phraseIndex: pIdx,
        syllables: op.exp.syllables.map((es, idx) => ({
          status: 'missing',
          text: es.text,
          expectedText: es.text,
          expectedNotes: es.notes,
          wordIndex: -1,
          expectedWordIndex: op.exp.wordIndex,
          syllableIndex: -1,
          expectedSyllableIndex: idx,
        })),
      };
      const arr = phraseWordsMap.get(pIdx) ?? [];
      arr.push(wc);
      phraseWordsMap.set(pIdx, arr);
      phraseLastExpMap.set(pIdx, op.exp);
    }
  }

  const orderedPhraseIndices = [...phraseWordsMap.keys()].sort((a, b) => a - b);
  const phrases: PhraseComparison[] = [];
  const allSyllables: SyllableComparison[] = [];

  let matchedSyllables = 0;
  let expectedSyllables = 0;
  let generatedSyllables = 0;
  let pitchMismatches = 0;
  let splitMismatches = 0;
  let missingSyllables = 0;
  let extraSyllables = 0;
  let divisionMismatches = 0;

  for (const rawIdx of orderedPhraseIndices) {
    const words = phraseWordsMap.get(rawIdx) ?? [];
    const phraseSyllables: SyllableComparison[] = [];
    let pMatched = 0;
    let pExpected = 0;
    let pPitch = 0;
    let pSplit = 0;
    let pMissing = 0;
    let pExtra = 0;

    let startWordIndex = -1;
    let endWordIndex = -1;

    for (const w of words) {
      if (w.generatedWordIndex >= 0) {
        if (startWordIndex === -1) startWordIndex = w.generatedWordIndex;
        endWordIndex = w.generatedWordIndex;
        const gCount = w.generatedSyllableBreakdown
          ? w.generatedSyllableBreakdown.length
          : w.syllables.length;
        generatedSyllables += gCount;
      }

      for (const s of w.syllables) {
        phraseSyllables.push(s);
        allSyllables.push(s);
        if (s.status === 'match') {
          pMatched += 1;
          pExpected += 1;
        } else if (s.status === 'pitch-mismatch') {
          pPitch += 1;
          pExpected += 1;
        } else if (s.status === 'split-mismatch') {
          pSplit += 1;
          pExpected += 1;
        } else if (s.status === 'missing') {
          pMissing += 1;
          pExpected += 1;
        } else if (s.status === 'extra') {
          pExtra += 1;
        }
      }
    }

    const lastGen = phraseLastGenMap.get(rawIdx);
    const lastExp = phraseLastExpMap.get(rawIdx);
    const generatedDivision = lastGen?.trailingDivision;
    const expectedDivision = lastExp?.trailingDivision;
    const divisionMismatch =
      Boolean(generatedDivision || expectedDivision) && generatedDivision !== expectedDivision;
    if (divisionMismatch) divisionMismatches += 1;

    matchedSyllables += pMatched;
    expectedSyllables += pExpected;
    pitchMismatches += pPitch;
    splitMismatches += pSplit;
    missingSyllables += pMissing;
    extraSyllables += pExtra;

    const text = words
      .map((w) => w.generatedText || w.expectedText)
      .filter(Boolean)
      .join(' ');

    phrases.push({
      phraseIndex: phrases.length,
      text,
      generatedDivision,
      expectedDivision,
      divisionMismatch,
      startWordIndex,
      endWordIndex,
      words,
      syllables: phraseSyllables,
      matchedSyllables: pMatched,
      totalSyllables: pExpected > 0 ? pExpected : phraseSyllables.length,
      pitchMismatches: pPitch,
      splitMismatches: pSplit,
      missingSyllables: pMissing,
      extraSyllables: pExtra,
    });
  }

  const matchRatio =
    expectedSyllables > 0
      ? matchedSyllables / expectedSyllables
      : generatedSyllables === 0
      ? 1
      : 0;

  return {
    totals: {
      matchedSyllables,
      expectedSyllables,
      generatedSyllables,
      pitchMismatches,
      splitMismatches,
      missingSyllables,
      extraSyllables,
      divisionMismatches,
      matchRatio,
      summary: `${matchedSyllables}/${expectedSyllables} syllables match`,
    },
    phrases,
    syllables: allSyllables,
  };
}
