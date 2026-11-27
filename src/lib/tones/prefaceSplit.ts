import { parseGabc } from '@/src/lib/gabc/parser';
import { ChantLanguage, PhraseBreakKey, TonePhraseLinkItem } from '@/src/types/chant';
import { isEnglishFunctionWord } from './englishAccent';
import { isEnglishWordUncertain } from './englishAccent';
import { isLatinWordUncertain, toToneSyllables } from './latinAccent';
import {
  barForCadence,
  extractReadingPhrases,
  getReadingWordList,
  PhraseCadenceChoice,
  pointEnglishPrefacePhrase,
  pointReading,
} from './pointing';
import {
  computeWordDiff,
  matchPrefaceTemplate,
  normalizePrefaceText,
  PrefaceTemplate,
  stripGabcHeaderAndClef,
  TemplateMatchResult,
  tokenSimilarity,
  WordDiffToken,
} from './prefaceTemplates';
import { EnglishPrefaceRole, getReadingCadence, ReadingCadenceKind, ToneDefinition } from './tone';

export type PrefacePartKind = 'opening' | 'body' | 'closing';

export type PrefacePartStatus =
  | 'template-verified'
  | 'template-needs-review'
  | 'generated'
  | 'no-match';

export interface PrefaceWordItem {
  text: string;
  wordIndex: number;
  uncertain: boolean;
  syllables: {
    text: string;
    globalIndex: number;
    stressed: boolean;
  }[];
}

export interface PrefaceBodyPhrase {
  index: number;
  text: string;
  wordTokens: string[];
  startWordIndex: number;
  endWordIndex: number;
  endWordText: string;
  paragraphBreak: boolean;
  defaultKind: ReadingCadenceKind | null;
  effectiveKind: ReadingCadenceKind | null;
  choiceLabel: PhraseCadenceChoice;
  overridden: boolean;
  defaultRole?: EnglishPrefaceRole;
  effectiveRole?: EnglishPrefaceRole;
  roleOverridden?: boolean;
  merged: boolean;
  mergedFrom: number;
  autoJoined?: boolean;
  internalMergedBreaks: PhraseBreakKey[];
  canJoinPrev: boolean;
  canJoinNext: boolean;
  status: PrefacePartStatus;
  edited?: boolean;
  templateMatch?: TemplateMatchResult;
  gabc: string;
  rawGabcOverride?: string;
  words: PrefaceWordItem[];
  uncertainWordCount: number;
  warnings?: string[];
}

export interface PrefacePart {
  kind: PrefacePartKind;
  label: string;
  text: string;
  status: PrefacePartStatus;
  gabc: string;
  rawGabcOverride?: string;
  matchedTemplateId?: string;
  matchedTemplate?: PrefaceTemplate;
  similarity?: number;
  flagged?: boolean;
  flagReason?: string;
  diff?: WordDiffToken[];
  syllableMismatch?: { expected: number; actual: number };
  /** Populated for `kind === 'body'`. */
  phrases?: PrefaceBodyPhrase[];
}

export interface PrefaceSplitResult {
  parts: PrefacePart[];
  /** Word tokens of the Proper Body before merges/extra-splits, for break-key pruning. */
  bodyWords: string[];
}

export interface PrefaceAssemblyChecklist {
  everyPhraseHasCadence: boolean;
  phrasesWithoutCadence: number[];
  noFinalFunctionWordAccent: boolean;
  functionWordAccentPhrases: { phraseIndex: number; word: string }[];
  everyTemplateUsedVerbatim: boolean;
  unverifiedTemplateCount: number;
}

export interface PrefaceAssembleResult {
  gabc: string;
  warnings: string[];
  checklist: PrefaceAssemblyChecklist;
  phrases?: TonePhraseLinkItem[];
}

const FUZZY_THRESHOLD = 0.85;
const TRAILING_BAR_RE = /\s*\((?:,|;|::|:)\)\s*$/;
const LEADING_BAR_RE = /^\s*\((?:,|;|::|:)\)\s*/;

/** Split single-line (no `\n`) text on `.`, `;`, `:` and sentence structure. */
function splitUnbrokenClauses(text: string): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const clauses: string[] = [];
  let cur: string[] = [];
  for (const w of words) {
    cur.push(w);
    if (/[.;:?!]['"”’)\]]*$/.test(w)) {
      clauses.push(cur.join(' '));
      cur = [];
    }
  }
  if (cur.length > 0) clauses.push(cur.join(' '));
  return clauses;
}

/**
 * Strip an optional concluding doxological tag ("through Christ our Lord." /
 * "per Christum Dominum nostrum.") from an opening template so missing-ending
 * openings still match.
 */
function stripOpeningConclusion(text: string, language: ChantLanguage): string {
  if (language === 'en') {
    return text.replace(/[\s,;:.]*through\s+Christ\s+our\s+Lord[.?!,;:\s]*$/i, '').trim();
  }
  return text
    .replace(/[\s,;:.]*per\s+Christum\s+D[oó]minum\s+nostrum[.?!,;:\s]*$/i, '')
    .trim();
}

function hasOpeningConclusion(text: string, language: ChantLanguage): boolean {
  const norm = normalizePrefaceText(text);
  return language === 'en'
    ? /\bthrough christ our lord\b/.test(norm)
    : /\bper christum dominum nostrum\b/.test(norm);
}

interface CandidateMatch {
  template: PrefaceTemplate;
  similarity: number;
  missingConclusion: boolean;
}

function bestFuzzyTemplate(
  text: string,
  templates: PrefaceTemplate[],
  filter: { language: ChantLanguage; tone: string; kind: 'opening' | 'closing' }
): CandidateMatch | null {
  const pool = templates.filter(
    (t) => t.language === filter.language && t.tone === filter.tone && t.kind === filter.kind
  );
  let best: CandidateMatch | null = null;

  for (const tpl of pool) {
    const simFull = tokenSimilarity(text, tpl.text);
    if (simFull >= FUZZY_THRESHOLD && (!best || simFull > best.similarity)) {
      best = { template: tpl, similarity: simFull, missingConclusion: false };
    }

    for (const v of tpl.variants ?? []) {
      const simVar = tokenSimilarity(text, v);
      if (simVar >= FUZZY_THRESHOLD && (!best || simVar > best.similarity)) {
        best = { template: tpl, similarity: simVar, missingConclusion: false };
      }
    }

    if (filter.kind === 'opening') {
      const stripped = stripOpeningConclusion(tpl.text, filter.language);
      if (stripped && stripped !== tpl.text.trim()) {
        const simPrefix = tokenSimilarity(text, stripped);
        const omitted = !hasOpeningConclusion(text, filter.language);
        if (simPrefix >= FUZZY_THRESHOLD && omitted) {
          const score = Math.max(simFull, simPrefix);
          if (!best || score > best.similarity) {
            best = { template: tpl, similarity: score, missingConclusion: true };
          }
        }
      }
    }
  }

  return best;
}

function generateRawLinesGabc(
  text: string,
  tone: ToneDefinition,
  language: ChantLanguage,
  options: { isLastPart?: boolean; stressOverrides?: Record<number, boolean>; cadenceOverrides?: Record<number, ReadingCadenceKind | null> } = {}
): string {
  const toneForPart: ToneDefinition =
    !options.isLastPart && tone.reading
      ? {
          ...tone,
          reading: {
            ...tone.reading,
            final: getReadingCadence(tone, 'punctum', language) ?? tone.reading.final,
          },
          readingByLanguage: tone.readingByLanguage
            ? {
                ...tone.readingByLanguage,
                [language]: {
                  ...tone.readingByLanguage[language],
                  final: getReadingCadence(tone, 'punctum', language) ?? tone.readingByLanguage[language]?.final,
                },
              }
            : undefined,
        }
      : tone;

  const res = pointReading(text, toneForPart, {
    language,
    stressOverrides: options.stressOverrides,
    cadenceOverrides: options.cadenceOverrides,
    autoJoinShortPhrases: 0,
  });
  return stripGabcHeaderAndClef(res.gabc).replace(/\s*\(::\)\s*$/, '').trim();
}

function resolveFormulaPart(
  kind: 'opening' | 'closing',
  label: string,
  candidateText: string,
  templates: PrefaceTemplate[],
  tone: ToneDefinition,
  toneId: string,
  language: ChantLanguage,
  rawOverride?: string
): PrefacePart {
  if (!candidateText.trim()) {
    return {
      kind,
      label,
      text: '',
      status: 'no-match',
      gabc: '',
      rawGabcOverride: rawOverride,
    };
  }

  const exact = matchPrefaceTemplate(candidateText, templates, {
    language,
    tone: toneId,
    kind,
  });

  if (exact.matched && exact.template && exact.gabc) {
    return {
      kind,
      label,
      text: candidateText,
      status: exact.template.verified ? 'template-verified' : 'template-needs-review',
      gabc: exact.gabc,
      rawGabcOverride: rawOverride,
      matchedTemplateId: exact.template.id,
      matchedTemplate: exact.template,
      similarity: 1,
      flagged: !exact.template.verified,
      flagReason: exact.template.verified ? undefined : 'Template is unverified (generated, needs review).',
    };
  }

  if (exact.rejectedCandidate && exact.syllableMismatch) {
    const generated = generateRawLinesGabc(candidateText, tone, language, {
      isLastPart: kind === 'closing',
    });
    return {
      kind,
      label,
      text: candidateText,
      status: 'generated',
      gabc: generated,
      rawGabcOverride: rawOverride,
      matchedTemplateId: exact.rejectedCandidate.id,
      matchedTemplate: exact.rejectedCandidate,
      similarity: tokenSimilarity(candidateText, exact.rejectedCandidate.text),
      flagged: true,
      flagReason: `Syllable count mismatch (expected ${exact.syllableMismatch.expected}, got ${exact.syllableMismatch.actual}); fell back to generator.`,
      syllableMismatch: exact.syllableMismatch,
      diff: exact.diff,
    };
  }

  const fuzzy = bestFuzzyTemplate(candidateText, templates, {
    language,
    tone: toneId,
    kind,
  });

  if (fuzzy) {
    const generated = generateRawLinesGabc(candidateText, tone, language, {
      isLastPart: kind === 'closing',
    });
    const conclusionName =
      language === 'en' ? '"through Christ our Lord."' : '"per Christum Dóminum nostrum."';
    return {
      kind,
      label,
      text: candidateText,
      status: 'generated',
      gabc: generated,
      rawGabcOverride: rawOverride,
      matchedTemplateId: fuzzy.template.id,
      matchedTemplate: fuzzy.template,
      similarity: fuzzy.similarity,
      flagged: true,
      flagReason: fuzzy.missingConclusion
        ? `Opening matches template but omits ${conclusionName}`
        : 'Differs from template; showing diff and using generated notes.',
      diff: computeWordDiff(candidateText, fuzzy.template.text),
    };
  }

  return {
    kind,
    label,
    text: candidateText,
    status: 'no-match',
    gabc: '',
    rawGabcOverride: rawOverride,
  };
}

function buildWordItems(
  phraseText: string,
  language: ChantLanguage,
  syllOffset: number,
  stressOverrides?: Record<number, boolean>
): { words: PrefaceWordItem[]; uncertainWordCount: number; syllableCount: number } {
  const rawWords = phraseText.split(/\s+/).filter(Boolean);
  const sylls = toToneSyllables(phraseText, {
    language,
    stressOverrides,
    offset: syllOffset,
  });

  const byWord = new Map<number, PrefaceWordItem['syllables']>();
  sylls.forEach((s, i) => {
    const list = byWord.get(s.wordIndex) ?? [];
    list.push({
      text: s.text,
      globalIndex: syllOffset + i,
      stressed: s.stressed,
    });
    byWord.set(s.wordIndex, list);
  });

  let uncertainWordCount = 0;
  const words: PrefaceWordItem[] = rawWords.map((w, wordIndex) => {
    const uncertain =
      language === 'en' ? isEnglishWordUncertain(w) : isLatinWordUncertain(w);
    if (uncertain) uncertainWordCount += 1;
    return {
      text: w,
      wordIndex,
      uncertain,
      syllables: byWord.get(wordIndex) ?? [],
    };
  });

  return { words, uncertainWordCount, syllableCount: sylls.length };
}

export interface SplitPrefaceOptions {
  language: ChantLanguage;
  tone: ToneDefinition;
  toneId?: string;
  templates: PrefaceTemplate[];
  stressOverrides?: Record<number, boolean>;
  cadenceOverrides?: Record<number, ReadingCadenceKind | null>;
  roleOverrides?: Record<number, EnglishPrefaceRole>;
  mergedBreaks?: PhraseBreakKey[];
  forcedBreaks?: PhraseBreakKey[];
  extraBreaks?: PhraseBreakKey[];
  autoJoinShortPhrases?: number;
  partRawOverrides?: Partial<Record<PrefacePartKind, string>>;
  phraseRawOverrides?: Record<number, string>;
  /**
   * Treat single line breaks as phrase breaks instead of soft wraps.
   * Defaults to false for Latin and true for English.
   */
  treatLineBreaksAsPhraseBreaks?: boolean;
}

function splitUnitsForFormulaSearch(
  para: string,
  hasNewlines: boolean
): string[] {
  return hasNewlines
    ? para.split('\n').map((l) => l.trim()).filter(Boolean)
    : splitUnbrokenClauses(para);
}

function findOpeningPrefixLen(
  units: string[],
  hasNewlines: boolean,
  templates: PrefaceTemplate[],
  language: ChantLanguage,
  toneId: string
): number {
  let bestOpenLen = 0;
  let bestOpenScore = 0;
  const maxOpenPrefix = Math.min(units.length, 8);
  for (let len = 1; len <= maxOpenPrefix; len++) {
    const sliceText = units.slice(0, len).join(hasNewlines ? '\n' : ' ');
    const exact = matchPrefaceTemplate(sliceText, templates, {
      language,
      tone: toneId,
      kind: 'opening',
    });
    if (exact.matched) {
      if (bestOpenScore < 2 || len > bestOpenLen) {
        bestOpenLen = len;
        bestOpenScore = 2; // Exact match always wins; longer exact match wins ties
      }
      continue;
    }
    const fuzzy = bestFuzzyTemplate(sliceText, templates, {
      language,
      tone: toneId,
      kind: 'opening',
    });
    if (fuzzy && fuzzy.similarity > bestOpenScore) {
      bestOpenScore = fuzzy.similarity;
      bestOpenLen = len;
    }
  }
  return bestOpenLen;
}

function findClosingSuffixLen(
  units: string[],
  startIdx: number,
  hasNewlines: boolean,
  templates: PrefaceTemplate[],
  language: ChantLanguage,
  toneId: string
): number {
  let bestCloseLen = 0;
  let bestCloseScore = 0;
  const remaining = units.length - startIdx;
  const maxCloseSuffix = Math.min(remaining, 8);
  for (let len = 1; len <= maxCloseSuffix; len++) {
    const sliceText = units.slice(units.length - len).join(hasNewlines ? '\n' : ' ');
    const exact = matchPrefaceTemplate(sliceText, templates, {
      language,
      tone: toneId,
      kind: 'closing',
    });
    if (exact.matched) {
      if (bestCloseScore < 2 || len > bestCloseLen) {
        bestCloseLen = len;
        bestCloseScore = 2;
      }
      continue;
    }
    const fuzzy = bestFuzzyTemplate(sliceText, templates, {
      language,
      tone: toneId,
      kind: 'closing',
    });
    if (fuzzy && fuzzy.similarity > bestCloseScore) {
      bestCloseScore = fuzzy.similarity;
      bestCloseLen = len;
    }
  }
  return bestCloseLen;
}

/**
 * Segment a pasted preface into Opening, Proper Body, and Closing.
 */
export function splitPreface(text: string, opts: SplitPrefaceOptions): PrefaceSplitResult {
  const {
    language,
    tone,
    toneId = 'preface-solemn',
    templates,
    stressOverrides,
    cadenceOverrides,
    roleOverrides,
    mergedBreaks,
    forcedBreaks,
    extraBreaks,
    autoJoinShortPhrases,
    partRawOverrides = {},
    phraseRawOverrides = {},
    treatLineBreaksAsPhraseBreaks,
  } = opts;

  const treatLineBreaksAsPhrases = treatLineBreaksAsPhraseBreaks ?? language === 'en';
  const trimmed = text.replace(/\r\n/g, '\n').trim();
  const hasNewlines = treatLineBreaksAsPhrases && /\n/.test(trimmed);

  let openingText = '';
  let closingText = '';
  let bodyText = '';

  if (trimmed) {
    const rawParagraphs = trimmed
      .split(/\n(?:[ \t]*\n)+/)
      .map((p) => p.trim())
      .filter(Boolean);
    const paragraphs = !treatLineBreaksAsPhrases
      ? rawParagraphs.map((p) => p.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean)
      : rawParagraphs;

    if (paragraphs.length >= 2) {
      const workParagraphs = [...paragraphs];
      let startIdx = 0;
      let endIdx = workParagraphs.length - 1;

      const openTry = resolveFormulaPart(
        'opening',
        'Opening',
        workParagraphs[0],
        templates,
        tone,
        toneId,
        language
      );
      if (openTry.status !== 'no-match') {
        openingText = workParagraphs[0];
        startIdx = 1;
      } else {
        const units0 = splitUnitsForFormulaSearch(workParagraphs[0], hasNewlines);
        const prefixLen = findOpeningPrefixLen(units0, hasNewlines, templates, language, toneId);
        if (prefixLen > 0) {
          const sep = hasNewlines ? '\n' : ' ';
          openingText = units0.slice(0, prefixLen).join(sep);
          const rest = units0.slice(prefixLen).join(sep).trim();
          if (rest) {
            workParagraphs[0] = rest;
          } else {
            startIdx = 1;
          }
        }
      }

      if (endIdx >= startIdx) {
        const closeTry = resolveFormulaPart(
          'closing',
          'Closing',
          workParagraphs[endIdx],
          templates,
          tone,
          toneId,
          language
        );
        if (closeTry.status !== 'no-match') {
          closingText = workParagraphs[endIdx];
          endIdx -= 1;
        } else {
          const unitsLast = splitUnitsForFormulaSearch(workParagraphs[endIdx], hasNewlines);
          const suffixLen = findClosingSuffixLen(
            unitsLast,
            0,
            hasNewlines,
            templates,
            language,
            toneId
          );
          if (suffixLen > 0) {
            const sep = hasNewlines ? '\n' : ' ';
            closingText = unitsLast.slice(unitsLast.length - suffixLen).join(sep);
            const rest = unitsLast.slice(0, unitsLast.length - suffixLen).join(sep).trim();
            if (rest) {
              workParagraphs[endIdx] = rest;
            } else {
              endIdx -= 1;
            }
          }
        }
      }

      if (endIdx >= startIdx) {
        bodyText = workParagraphs.slice(startIdx, endIdx + 1).join('\n\n');
      }
    } else {
      // For Latin, collapse missal-style line breaks and split by punctuation only.
      const singlePara = paragraphs[0] ?? trimmed;
      const units = splitUnitsForFormulaSearch(singlePara, hasNewlines);

      let startIdx = 0;
      let endIdx = units.length - 1;

      const bestOpenLen = findOpeningPrefixLen(units, hasNewlines, templates, language, toneId);
      if (bestOpenLen > 0) {
        openingText = units.slice(0, bestOpenLen).join(hasNewlines ? '\n' : ' ');
        startIdx = bestOpenLen;
      }

      const bestCloseLen = findClosingSuffixLen(
        units,
        startIdx,
        hasNewlines,
        templates,
        language,
        toneId
      );
      if (bestCloseLen > 0) {
        closingText = units.slice(units.length - bestCloseLen).join(hasNewlines ? '\n' : ' ');
        endIdx = units.length - bestCloseLen - 1;
      }

      if (endIdx >= startIdx) {
        bodyText = units.slice(startIdx, endIdx + 1).join(treatLineBreaksAsPhrases ? '\n' : ' ');
      }
    }
  }

  const parts: PrefacePart[] = [];

  // Part 1: Opening
  const openingPart = resolveFormulaPart(
    'opening',
    'Opening',
    openingText,
    templates,
    tone,
    toneId,
    language,
    partRawOverrides.opening
  );
  parts.push(openingPart);

  // Part 2: Proper Body
  const closingPart = resolveFormulaPart(
    'closing',
    'Closing',
    closingText,
    templates,
    tone,
    toneId,
    language,
    partRawOverrides.closing
  );

  const hasClosingAfterBody = closingPart.status !== 'no-match' && Boolean(closingPart.text.trim());
  const bodyTone: ToneDefinition =
    hasClosingAfterBody && tone.reading
      ? {
          ...tone,
          phrasing: 'lines',
          reading: {
            ...tone.reading,
            final: getReadingCadence(tone, 'punctum', language) ?? tone.reading.final,
          },
          readingByLanguage: tone.readingByLanguage
            ? {
                ...tone.readingByLanguage,
                [language]: {
                  ...tone.readingByLanguage[language],
                  final:
                    getReadingCadence(tone, 'punctum', language) ??
                    tone.readingByLanguage[language]?.final,
                },
              }
            : undefined,
        }
      : {
          ...tone,
          phrasing: 'lines',
        };

  const bodyWords = bodyText
    ? getReadingWordList(bodyText, bodyTone, {
        language,
        treatLineBreaksAsPhraseBreaks: treatLineBreaksAsPhrases,
      })
    : [];

  const bodyPhrasesRaw = bodyText
    ? extractReadingPhrases(bodyText, bodyTone, {
        language,
        cadenceOverrides,
        roleOverrides,
        mergedBreaks,
        forcedBreaks,
        extraBreaks,
        autoJoinShortPhrases,
        treatLineBreaksAsPhraseBreaks: treatLineBreaksAsPhrases,
      })
    : [];

  // Global syllable offset starts after Opening (so stressOverrides can align if needed)
  let bodyCursor = 0;
  const bodyPhrases: PrefaceBodyPhrase[] = bodyPhrasesRaw.map((ph, phIdx) => {
    const { words, uncertainWordCount, syllableCount } = buildWordItems(
      ph.text,
      language,
      bodyCursor,
      stressOverrides
    );

    const phraseTplMatch = matchPrefaceTemplate(ph.text, templates, {
      language,
      tone: toneId,
      kind: 'phrase',
    });

    let phraseStatus: PrefacePartStatus = 'generated';
    let phraseGabc = '';
    let phraseWarnings: string[] = [];
    const isCadenceOrRoleOverridden = Boolean(
      ph.effectiveKind !== ph.defaultKind || ph.roleOverridden
    );
    const hasManualEdit = Boolean(
      isCadenceOrRoleOverridden || ph.overridden || phraseRawOverrides[ph.endWordIndex] !== undefined
    );
    const phraseEdited = Boolean(phraseTplMatch.matched && hasManualEdit);

    const isLastOfWholeText = !hasClosingAfterBody && phIdx === bodyPhrasesRaw.length - 1;
    const expectedBar = barForCadence(ph.effectiveKind, isLastOfWholeText);

    if (
      phraseTplMatch.matched &&
      phraseTplMatch.template &&
      phraseTplMatch.gabc &&
      !isCadenceOrRoleOverridden
    ) {
      phraseStatus = phraseTplMatch.template.verified
        ? 'template-verified'
        : 'template-needs-review';
      const tplGabc = phraseTplMatch.gabc.trim();
      if (TRAILING_BAR_RE.test(tplGabc)) {
        phraseGabc =
          isLastOfWholeText && expectedBar
            ? tplGabc.replace(TRAILING_BAR_RE, ` (${expectedBar})`)
            : tplGabc;
      } else {
        phraseGabc = expectedBar ? `${tplGabc} (${expectedBar})` : tplGabc;
      }
    } else {
      const localStressOverrides: Record<number, boolean> = {};
      if (stressOverrides) {
        for (let k = 0; k < syllableCount; k++) {
          if (typeof stressOverrides[bodyCursor + k] === 'boolean') {
            localStressOverrides[k] = stressOverrides[bodyCursor + k];
          }
        }
      }
      if (language === 'en') {
        const generated = pointEnglishPrefacePhrase(ph.text, bodyTone, {
          role: ph.effectiveRole,
          effectiveKind: ph.effectiveKind,
          isLastOfWholeText,
          startsPhrase: ph.startsPhrase,
          stressOverrides: localStressOverrides,
        });
        phraseGabc = generated.gabc;
        phraseWarnings = generated.warnings;
      } else {
        const baseTone: ToneDefinition =
          isCadenceOrRoleOverridden && ph.effectiveKind === 'final'
            ? {
                ...tone,
                phrasing: 'lines',
              }
            : {
                ...bodyTone,
                phrasing: 'lines',
              };
        const singleTone: ToneDefinition = ph.startsPhrase
          ? baseTone
          : { ...baseTone, intonation: [] };
        const localMergedBreaks: PhraseBreakKey[] = ph.internalMergedBreaks.map((b) => ({
          endWordIndex: b.endWordIndex - ph.startWordIndex,
          wordText: b.wordText,
        }));
        const localEndWordIndex = Math.max(0, ph.words.length - 1);
        const generated = pointReading(ph.text, singleTone, {
          language,
          stressOverrides: localStressOverrides,
          cadenceOverrides: { [localEndWordIndex]: ph.effectiveKind },
          mergedBreaks: localMergedBreaks,
          autoJoinShortPhrases: 0,
          treatLineBreaksAsPhraseBreaks: treatLineBreaksAsPhrases,
        });
        const coreGabc = stripGabcHeaderAndClef(generated.gabc).replace(TRAILING_BAR_RE, '').trim();
        phraseGabc = expectedBar ? `${coreGabc} (${expectedBar})` : coreGabc;
        phraseWarnings = generated.warnings;
      }
    }

    bodyCursor += syllableCount;

    return {
      index: ph.index,
      text: ph.text,
      wordTokens: ph.words,
      startWordIndex: ph.startWordIndex,
      endWordIndex: ph.endWordIndex,
      endWordText: ph.endWordText,
      paragraphBreak: ph.paragraphBreak,
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
      canJoinPrev: ph.canJoinPrev,
      canJoinNext: ph.canJoinNext,
      status: phraseStatus,
      edited: phraseEdited,
      templateMatch: phraseTplMatch.matched ? phraseTplMatch : undefined,
      gabc: phraseGabc,
      rawGabcOverride: phraseRawOverrides[ph.endWordIndex],
      words,
      uncertainWordCount,
      warnings: phraseWarnings,
    };
  });

  const bodyPart: PrefacePart = {
    kind: 'body',
    label: 'Body',
    text: bodyText,
    status: bodyPhrases.length > 0 ? 'generated' : 'no-match',
    gabc: bodyPhrases.map((p) => (p.rawGabcOverride ?? p.gabc).trim()).filter(Boolean).join(' '),
    rawGabcOverride: partRawOverrides.body,
    phrases: bodyPhrases,
  };
  parts.push(bodyPart);

  // Closing
  parts.push(closingPart);

  return {
    parts,
    bodyWords,
  };
}

/**
 * Remap body-phrase overrides when preface text is edited so overrides keyed on
 * endWordIndex (or phrase strings) survive edits to other phrases (including insertions/deletions).
 */
export function remapBodyPhraseOverrides<T>(
  prevItems: (string | { text: string; endWordIndex: number })[],
  nextItems: (string | { text: string; endWordIndex: number })[],
  overrides: Record<number, T>
): Record<number, T> {
  const keys = Object.keys(overrides);
  if (keys.length === 0 || nextItems.length === 0) return {};

  const toEntries = (arr: (string | { text: string; endWordIndex: number })[]) => {
    let wordAcc = 0;
    return arr.map((it) => {
      if (typeof it === 'string') {
        const wCount = Math.max(1, it.trim().split(/\s+/).filter(Boolean).length);
        wordAcc += wCount;
        return { norm: normalizePrefaceText(it), key: wordAcc - 1 };
      }
      return { norm: normalizePrefaceText(it.text), key: it.endWordIndex };
    });
  };

  const prevList = toEntries(prevItems);
  const nextList = toEntries(nextItems);
  const m = prevList.length;
  const n = nextList.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        prevList[i - 1].norm && prevList[i - 1].norm === nextList[j - 1].norm
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  const out: Record<number, T> = {};
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (prevList[i - 1].norm && prevList[i - 1].norm === nextList[j - 1].norm) {
      const oldKey = prevList[i - 1].key;
      const newKey = nextList[j - 1].key;
      if (Object.prototype.hasOwnProperty.call(overrides, oldKey)) {
        out[newKey] = overrides[oldKey];
      }
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }
  return out;
}

/** Collapse accidental consecutive division bars like `(:) (:)` or `(::) (:)` to one bar. */
function collapseDoubledBars(gabcBody: string): string {
  return gabcBody.replace(/(\((?:,|;|::|:)\))(?:\s*\((?:,|;|::|:)\))+/g, '$1');
}

function countGabcSyllableItems(chunkGabc: string, clef: string): number {
  if (!chunkGabc.trim()) return 0;
  const parsed = parseGabc(`name: count;\n%%\n(${clef}) ${chunkGabc}\n`);
  return parsed.items.filter((it) => it.kind === 'syllable').length;
}

/**
 * Assemble Preface parts into a single complete GABC document with:
 * - one header and clef
 * - parts concatenated in order
 * - one cadence bar between parts (no doubled bars)
 * - assembly checklist
 * - contiguous phrase map for body phrases
 */
export function assemblePreface(
  split: PrefaceSplitResult,
  tone: ToneDefinition,
  options: { title?: string; language?: ChantLanguage; stressOverrides?: Record<number, boolean> } = {}
): PrefaceAssembleResult {
  const language = options.language ?? 'la';
  const warnings: string[] = [];

  const activeChunks: { part: PrefacePart; body: string }[] = [];

  for (const part of split.parts) {
    if (part.kind === 'body') {
      const bodyStr =
        part.rawGabcOverride !== undefined
          ? stripGabcHeaderAndClef(part.rawGabcOverride)
          : (part.phrases ?? [])
              .map((ph) => stripGabcHeaderAndClef(ph.rawGabcOverride ?? ph.gabc))
              .filter(Boolean)
              .join(' ');
      if (bodyStr.trim()) {
        activeChunks.push({ part, body: bodyStr.trim() });
      }
      continue;
    }

    const raw = part.rawGabcOverride !== undefined ? part.rawGabcOverride : part.gabc;
    const cleaned = stripGabcHeaderAndClef(raw);
    if (cleaned.trim()) {
      activeChunks.push({ part, body: cleaned.trim() });
    }
  }

  if (activeChunks.length === 0) {
    return {
      gabc: '',
      warnings: ['Paste some preface text first.'],
      checklist: {
        everyPhraseHasCadence: false,
        phrasesWithoutCadence: [],
        noFinalFunctionWordAccent: true,
        functionWordAccentPhrases: [],
        everyTemplateUsedVerbatim: true,
        unverifiedTemplateCount: 0,
      },
      phrases: [],
    };
  }

  const headerPrefix = `name: ${options.title || tone.name};\ninitial-style: 0;\n%%\n(${tone.clef}) `;

  // Concatenate with exactly one cadence bar between parts and (::) at the end, tracking exact offsets
  let combined = '';
  let syllableCursor = 0;
  const phraseLinks: TonePhraseLinkItem[] = [];

  for (let i = 0; i < activeChunks.length; i++) {
    const chunk = activeChunks[i];
    const isLastChunk = i === activeChunks.length - 1;

    if (chunk.part.kind === 'body' && chunk.part.rawGabcOverride === undefined && chunk.part.phrases?.length) {
      const phrases = chunk.part.phrases;
      const bodyRanges: {
        ph: PrefaceBodyPhrase;
        relStart: number;
        relEnd: number;
        tokenEndRel: number;
        hasTrailingBar: boolean;
        firstSylIdx: number;
        lastSylIdx: number;
      }[] = [];

      if (combined) {
        combined += '\n';
      }

      for (let pi = 0; pi < phrases.length; pi++) {
        const ph = phrases[pi];
        let phSeg = collapseDoubledBars(stripGabcHeaderAndClef(ph.rawGabcOverride ?? ph.gabc).trim());
        if (pi === 0 && i > 0) {
          phSeg = phSeg.replace(LEADING_BAR_RE, '').trim();
        }
        const isLastPhraseInDoc = isLastChunk && pi === phrases.length - 1;
        const isLastPhraseBeforeClosing = !isLastChunk && pi === phrases.length - 1;

        if (isLastPhraseBeforeClosing && !TRAILING_BAR_RE.test(phSeg)) {
          const interBar =
            ph.rawGabcOverride === undefined
              ? barForCadence(ph.effectiveKind, false)
              : barForCadence('punctum', false);
          if (interBar) {
            phSeg = `${phSeg} (${interBar})`;
          }
        }
        if (isLastPhraseInDoc) {
          const endBar = barForCadence('final', true) ?? '::';
          if (/\(::\)\s*$/.test(phSeg)) {
            // already ends with (::)
          } else if (TRAILING_BAR_RE.test(phSeg)) {
            phSeg = phSeg.replace(TRAILING_BAR_RE, ` (${endBar})`);
          } else {
            phSeg += ` (${endBar})`;
          }
        }
        phSeg = collapseDoubledBars(phSeg);

        const sylCount = countGabcSyllableItems(phSeg, tone.clef);
        const firstSylIdx = syllableCursor;
        const lastSylIdx = syllableCursor + Math.max(0, sylCount - 1);
        syllableCursor += sylCount;

        const relStart = combined.length;
        const hasNextBodyPhrase = pi < phrases.length - 1;
        combined += phSeg;
        const tokenEndRel = combined.length;
        if (hasNextBodyPhrase) {
          combined += ' ';
        }
        const relEnd = combined.length;
        const hasTrailingBar = TRAILING_BAR_RE.test(phSeg);

        bodyRanges.push({
          ph,
          relStart,
          relEnd,
          tokenEndRel,
          hasTrailingBar,
          firstSylIdx,
          lastSylIdx,
        });
      }

      for (const br of bodyRanges) {
        phraseLinks.push({
          index: br.ph.index,
          text: br.ph.text,
          words: br.ph.wordTokens,
          startWordIndex: br.ph.startWordIndex,
          endWordIndex: br.ph.endWordIndex,
          endWordText: br.ph.endWordText,
          defaultKind: br.ph.defaultKind,
          effectiveKind: br.ph.effectiveKind,
          choiceLabel: br.ph.choiceLabel,
          overridden: br.ph.overridden,
          defaultRole: br.ph.defaultRole,
          effectiveRole: br.ph.effectiveRole,
          roleOverridden: br.ph.roleOverridden,
          merged: br.ph.merged,
          mergedFrom: br.ph.mergedFrom,
          autoJoined: br.ph.autoJoined,
          internalMergedBreaks: br.ph.internalMergedBreaks,
          paragraphBreak: br.ph.paragraphBreak,
          canJoinPrev: br.ph.canJoinPrev,
          canJoinNext: br.ph.canJoinNext,
          sourceStart: headerPrefix.length + br.relStart,
          sourceEnd: headerPrefix.length + br.relEnd,
          endAnchorOffset: headerPrefix.length + Math.max(br.relStart, br.tokenEndRel - 1),
          hasTrailingBar: br.hasTrailingBar,
          firstSyllableIndex: br.firstSylIdx,
          lastSyllableIndex: br.lastSylIdx,
        });
      }
      continue;
    }

    let seg = collapseDoubledBars(chunk.body.trim());
    if (i > 0) {
      seg = seg.replace(LEADING_BAR_RE, '').trim();
      if (combined && !TRAILING_BAR_RE.test(combined)) {
        const interBar = barForCadence('punctum', false);
        if (interBar) {
          combined += ` (${interBar})`;
        }
      }
    }
    if (isLastChunk) {
      const endBar = barForCadence('final', true) ?? '::';
      if (/\(::\)\s*$/.test(seg)) {
        // already ends with (::)
      } else if (TRAILING_BAR_RE.test(seg)) {
        seg = seg.replace(TRAILING_BAR_RE, ` (${endBar})`);
      } else {
        seg += ` (${endBar})`;
      }
    }
    seg = collapseDoubledBars(seg);
    syllableCursor += countGabcSyllableItems(seg, tone.clef);
    combined = combined ? `${combined}\n${seg}` : seg;
  }

  const gabc = `${headerPrefix}${combined}\n`;

  // ---- Final Checklist ----
  const bodyPart = split.parts.find((p) => p.kind === 'body');
  const bodyPhrases = bodyPart?.phrases ?? [];
  const phrasesWithoutCadence = bodyPhrases
    .filter((ph) => ph.effectiveKind === null || ph.choiceLabel === 'none')
    .map((ph) => ph.index);

  const functionWordAccentPhrases: { phraseIndex: number; word: string }[] = [];
  for (const ph of bodyPhrases) {
    if (ph.effectiveKind === null || ph.words.length === 0) continue;
    let lastStressedWordIdx = -1;
    for (const w of ph.words) {
      if (w.syllables.some((s) => s.stressed)) {
        lastStressedWordIdx = w.wordIndex;
      }
    }
    const lastWord = ph.words[ph.words.length - 1];
    const accentWord =
      lastStressedWordIdx >= 0
        ? ph.words.find((w) => w.wordIndex === lastStressedWordIdx)
        : lastWord;

    if (language === 'en') {
      const lastIsUnstressedFn =
        isEnglishFunctionWord(lastWord.text) &&
        !lastWord.syllables.some((s) => s.stressed);
      const accentIsUnstressedFn =
        Boolean(accentWord) &&
        isEnglishFunctionWord(accentWord!.text) &&
        !(
          options.stressOverrides &&
          accentWord!.syllables.some((s) => options.stressOverrides?.[s.globalIndex] === true)
        );
      if (lastIsUnstressedFn || accentIsUnstressedFn) {
        functionWordAccentPhrases.push({
          phraseIndex: ph.index,
          word: lastIsUnstressedFn ? lastWord.text : accentWord!.text,
        });
      }
    } else if (lastStressedWordIdx < 0) {
      functionWordAccentPhrases.push({ phraseIndex: ph.index, word: lastWord.text });
    }
  }

  let everyTemplateUsedVerbatim = true;
  let unverifiedTemplateCount = 0;

  for (const part of split.parts) {
    if (part.status === 'template-verified' || part.status === 'template-needs-review') {
      if (part.status === 'template-needs-review') unverifiedTemplateCount += 1;
      if (part.rawGabcOverride === undefined && part.matchedTemplate) {
        const expected = stripGabcHeaderAndClef(part.gabc || part.matchedTemplate.gabc).trim();
        const expectedNoTrailBar = expected.replace(TRAILING_BAR_RE, '').trim();
        if (expected && !combined.includes(expected) && !(expectedNoTrailBar && combined.includes(expectedNoTrailBar))) {
          everyTemplateUsedVerbatim = false;
        }
      }
    }
    if (part.kind === 'body' && part.phrases) {
      for (const ph of part.phrases) {
        if (ph.status === 'template-verified' || ph.status === 'template-needs-review') {
          if (ph.status === 'template-needs-review') unverifiedTemplateCount += 1;
          if (ph.rawGabcOverride === undefined && ph.templateMatch?.gabc) {
            const expected = stripGabcHeaderAndClef(ph.templateMatch.gabc).trim();
            const expectedNoTrailBar = expected.replace(TRAILING_BAR_RE, '').trim();
            if (
              expected &&
              !combined.includes(expected) &&
              !(expectedNoTrailBar && combined.includes(expectedNoTrailBar))
            ) {
              everyTemplateUsedVerbatim = false;
            }
          }
        }
      }
    }
  }

  for (const ph of bodyPhrases) {
    if (ph.rawGabcOverride === undefined && ph.warnings?.length) {
      for (const w of ph.warnings) {
        if (!warnings.includes(w)) warnings.push(w);
      }
    }
  }

  return {
    gabc,
    warnings,
    checklist: {
      everyPhraseHasCadence: phrasesWithoutCadence.length === 0,
      phrasesWithoutCadence,
      noFinalFunctionWordAccent: functionWordAccentPhrases.length === 0,
      functionWordAccentPhrases,
      everyTemplateUsedVerbatim,
      unverifiedTemplateCount,
    },
    phrases: phraseLinks,
  };
}
