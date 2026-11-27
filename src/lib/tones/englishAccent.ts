import {
  isEnglishHyphenationUncertain,
  isKnownLiturgicalEnglishWord,
  syllabifyEnglishWord,
} from '@/src/lib/text/englishSyllabify';
import type { ToneSyllable } from './latinAccent';

const ACUTE = /[\u00e1\u00e9\u00ed\u00f3\u00fa\u00fd\u0301]/;

/**
 * Monosyllabic English function words that are normally unstressed in chant
 * pointing (articles, conjunctions, short prepositions, pronouns, auxiliaries).
 */
export const ENGLISH_FUNCTION_WORDS = new Set([
  'a', 'an', 'the',
  'and', 'or', 'but', 'nor', 'yet', 'so', 'for', 'than', 'as', 'if', 'when',
  'of', 'to', 'in', 'on', 'at', 'by', 'from', 'with', 'till', 'through',
  'all',
  'i', 'me', 'my', 'mine',
  'we', 'us', 'our', 'ours',
  'you', 'your', 'yours',
  'he', 'him', 'his',
  'she', 'her', 'hers',
  'it', 'its', "it's",
  'they', 'them', 'their', 'theirs',
  'thou', 'thee', 'thy', 'thine', 'ye',
  'who', 'whom', 'whose', 'which', 'that', 'this',
  'is', 'am', 'are', 'was', 'were', 'be', 'been',
  'have', 'has', 'had',
  'do', 'does', 'did',
  'will', 'would', 'shall', 'should', 'may', 'might', 'can', 'could', 'must',
  "i'm", "i'll", "i've", "i'd",
  "you're", "you'll", "you've", "you'd",
  "he's", "he'll", "he'd",
  "she's", "she'll", "she'd",
  "we're", "we'll", "we've", "we'd",
  "they're", "they'll", "they've", "they'd",
  "that's", "who's", "there's",
]);

/** Common unstressed initial prefix syllables that shift stress to the root. */
const UNSTRESSED_PREFIXES = new Set([
  'a', 'be', 'de', 're', 'con', 'com', 'ex', 'dis', 'en', 'em', 'pre', 'pro', 'per', 'sub',
]);

/**
 * Words starting with a prefix-shaped first syllable where stress actually falls
 * on the first syllable, or multi-syllable words with non-initial primary stress.
 */
const ENGLISH_STRESS_EXCEPTIONS: Record<string, number> = {
  // First-syllable exceptions despite prefix-like onset or suffix shape
  able: 0,
  abraham: 0,
  after: 0,
  altar: 0,
  altars: 0,
  always: 0,
  ancient: 0,
  angel: 0,
  angels: 0,
  apple: 0,
  archangel: 0,
  archangels: 0,
  army: 0,
  armies: 0,
  comfort: 0,
  coming: 0,
  conquer: 0,
  covenant: 0,
  david: 0,
  desert: 0,
  duty: 0,
  everywhere: 0,
  exodus: 0,
  father: 0,
  fathers: 0,
  glory: 0,
  heaven: 0,
  heavens: 0,
  holy: 0,
  human: 0,
  israel: 0,
  jacob: 0,
  lowliness: 0,
  majesty: 0,
  manifest: 0,
  opened: 0,
  power: 0,
  powers: 0,
  precious: 0,
  promise: 0,
  promised: 0,
  promises: 0,
  prophet: 0,
  prophets: 0,
  refuge: 0,
  rescue: 0,
  reverence: 0,
  suburbs: 0,
  truly: 0,
  // Non-initial stress exceptions
  acclaim: 1,
  acclaimed: 1,
  acclaims: 1,
  again: 1,
  ago: 1,
  alleluia: 2,
  almighty: 1,
  altogether: 2,
  amen: 1,
  assume: 1,
  assumed: 1,
  assumes: 1,
  authority: 1,
  confess: 1,
  crucified: 0,
  design: 1,
  designed: 1,
  designs: 1,
  dominion: 1,
  dominions: 1,
  elizabeth: 1,
  emmanuel: 1,
  eternal: 1,
  eternally: 1,
  exultation: 2,
  forever: 1,
  forevermore: 1,
  forgive: 1,
  forgiven: 1,
  forsake: 1,
  fulfill: 1,
  fulfilled: 1,
  fulfills: 1,
  hallelujah: 2,
  hosanna: 1,
  immanuel: 1,
  infinite: 0,
  inherit: 1,
  inherited: 1,
  inherits: 1,
  jerusalem: 1,
  judgement: 0,
  judgment: 0,
  magnificat: 1,
  passion: 0,
  received: 1,
  revealed: 1,
  salvation: 1,
  saving: 0,
  understand: 2,
  understanding: 2,
  unless: 1,
  until: 1,
  upon: 1,
  within: 1,
  without: 1,
  wondrous: 0,
};

function stripToLetters(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}]/gu, '')
    .toLowerCase();
}

function stripToWordKey(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/’/g, "'")
    .replace(/[^\p{L}']/gu, '')
    .replace(/^'+|'+$/g, '')
    .toLowerCase();
}

export function hasAcuteAccent(s: string): boolean {
  return ACUTE.test(s.normalize('NFC')) || ACUTE.test(s.normalize('NFD'));
}

export function isEnglishFunctionWord(word: string): boolean {
  return ENGLISH_FUNCTION_WORDS.has(stripToWordKey(word));
}

/**
 * Determine which syllable index of a polysyllabic English word is stressed.
 * An acute accent always wins; otherwise checks exceptions, `-tion`/`-sion`
 * suffixes, unstressed prefixes (a-, be-, de-, re-, con-, ex-, ...), and falls
 * back to the first syllable.
 */
export function englishStressedSyllableIndex(syllables: string[]): number {
  const n = syllables.length;
  if (n <= 1) return 0;

  // 1. Acute accent typed by user always wins
  for (let i = 0; i < n; i++) {
    if (hasAcuteAccent(syllables[i])) return i;
  }

  const word = stripToLetters(syllables.join(''));
  if (word in ENGLISH_STRESS_EXCEPTIONS) {
    const idx = ENGLISH_STRESS_EXCEPTIONS[word];
    if (idx >= 0 && idx < n) return idx;
  }

  // 2. -tion / -sion / -cious / -tious words stress the syllable right before the ending
  if (n >= 3) {
    const lastSyl = stripToLetters(syllables[n - 1]);
    if (/^(tion|tions|sion|sions|cious|tious)$/.test(lastSyl)) {
      return n - 2;
    }
  }

  // 3. Common unstressed prefix shifts stress to the root (second syllable),
  //    unless the second syllable is an inflectional suffix (-ing, -ed, -es, etc.)
  const firstSyl = stripToLetters(syllables[0]);
  const lastSyl = stripToLetters(syllables[n - 1]);
  const isTwoSylInflected = n === 2 && /^(ing|ings|ed|es|er|ers|est|ly|ness|less)$/.test(lastSyl);
  if (UNSTRESSED_PREFIXES.has(firstSyl) && !isTwoSylInflected) {
    return 1;
  }

  // 4. Default: first syllable
  return 0;
}

/**
 * Split English text into syllables with lexical stress flags:
 * - Acute accent on any syllable always marks that syllable stressed.
 * - Monosyllabic function words are unstressed (unless accented).
 * - Monosyllabic content words are stressed.
 * - Polysyllables use `englishStressedSyllableIndex`.
 */
export function toEnglishToneSyllables(text: string): ToneSyllable[] {
  const words = text.split(/\s+/).filter(Boolean);
  const out: ToneSyllable[] = [];

  words.forEach((word, wordIndex) => {
    const parts = syllabifyEnglishWord(word);
    if (parts.length === 1) {
      const accented = hasAcuteAccent(parts[0]);
      const stressed = accented || !isEnglishFunctionWord(parts[0]);
      out.push({
        text: parts[0],
        stressed,
        wordStart: true,
        wordEnd: true,
        wordIndex,
      });
    } else {
      const stressIdx = englishStressedSyllableIndex(parts);
      parts.forEach((p, i) => {
        out.push({
          text: p,
          stressed: i === stressIdx,
          wordStart: i === 0,
          wordEnd: i === parts.length - 1,
          wordIndex,
        });
      });
    }
  });

  return out;
}

/**
 * True when an English word is not in the liturgical/stress dictionaries or its
 * hyphenation required rule-based vowel splitting (meaning a human reviewer should
 * verify syllable split and accent placement).
 */
export function isEnglishWordUncertain(word: string): boolean {
  if (!word.trim()) return false;
  if (hasAcuteAccent(word) || word.includes('-')) return false;
  const key = stripToWordKey(word);
  if (!key) return false;
  if (ENGLISH_FUNCTION_WORDS.has(key)) return false;

  const lettersOnly = stripToLetters(word);
  if (Object.prototype.hasOwnProperty.call(ENGLISH_STRESS_EXCEPTIONS, lettersOnly)) return false;
  if (isKnownLiturgicalEnglishWord(word)) return false;
  if (isEnglishHyphenationUncertain(word)) return true;

  const parts = syllabifyEnglishWord(word);
  // Any polysyllabic word not in the curated stress/syllable dictionaries gets flagged.
  return parts.length >= 2;
}
