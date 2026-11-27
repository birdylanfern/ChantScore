import { ChantLanguage } from '@/src/types/chant';
import { syllabifyWord } from '@/src/lib/text/latinSyllabify';
import { toEnglishToneSyllables } from './englishAccent';

/**
 * Stress detection for Latin words, for applying tones to pasted text.
 *
 * Order of authority:
 *  1. an acute accent written in the text (á é í ó ú ý ǽ) — always wins;
 *  2. a small exception list of very common words the rules get wrong;
 *  3. the penultimate rule: stress the penult if it is heavy (closed syllable
 *     or diphthong) or if the word ends in a common long-penult ending (-orum, -arum, -erunt, -atur, -etur, -amus, -atis, -emus, -etis, -aris); otherwise the
 *     antepenult.
 *
 * The rules cannot see natural vowel length, so anything uncommon can be
 * corrected by typing an acute accent on the stressed vowel.
 */

const ACUTE = /[\u00e1\u00e9\u00ed\u00f3\u00fa\u00fd\u01fd\u0301]/;

/** word (lowercase, no accents/punctuation) -> index of stressed syllable, counted from the END (0 = last). */
const EXCEPTIONS_FROM_END: Record<string, number> = {
  amen: 0,
  israel: 0,
  michael: 0,
  gabriel: 0,
  raphael: 0,
  emmanuel: 0,
  alleluia: 1,
  maria: 1,
  mariae: 1,
  eleison: 2,
  ierusalem: 2,
  hierusalem: 2,
  sion: 0,
  iesu: 1,
  isaac: 0,
  iacob: 0,
  david: 1,
};

function stripToLetters(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}]/gu, '')
    .toLowerCase();
}

function isVowelChar(ch: string): boolean {
  return /[aeiouyæœ]/i.test(ch.normalize('NFD')[0] ?? '');
}

/** A syllable is heavy if it is closed (ends in a consonant) or contains a diphthong. */
function isHeavy(syl: string): boolean {
  const letters = stripToLetters(syl);
  if (/ae|oe|au|æ|œ/.test(letters)) return true;
  const last = letters[letters.length - 1];
  return !!last && !isVowelChar(last);
}

/** Index (into `syllables`) of the stressed syllable of one word. */
export function stressedSyllableIndex(syllables: string[]): number {
  const n = syllables.length;
  if (n <= 1) return 0;

  for (let i = 0; i < n; i++) {
    if (ACUTE.test(syllables[i].normalize('NFC')) || ACUTE.test(syllables[i].normalize('NFD'))) return i;
  }

  const word = stripToLetters(syllables.join(''));
  if (word in EXCEPTIONS_FROM_END) {
    const idx = n - 1 - EXCEPTIONS_FROM_END[word];
    if (idx >= 0) return idx;
  }

  if (n === 2) return 0;
  if (/(orum|arum|erunt|atur|etur|amus|atis|emus|etis|aris)$/.test(word)) return n - 2;
  return isHeavy(syllables[n - 2]) ? n - 2 : n - 3;
}

export interface ToneSyllable {
  /** Text as it will appear under the note (with attached punctuation). */
  text: string;
  stressed: boolean;
  wordStart: boolean;
  wordEnd: boolean;
  /** Index of the word within the verse text. */
  wordIndex: number;
}

export interface ToToneSyllablesOptions {
  language?: ChantLanguage;
  stressOverrides?: Record<number, boolean>;
  offset?: number;
}

/**
 * Split text into syllables with stress flags.
 * In Latin ('la'), monosyllables are unstressed unless the text consists of
 * monosyllables only (then the last one carries the accent).
 * In English ('en'), lexical stress rules apply per word.
 */
export function toToneSyllables(text: string, opts: ToToneSyllablesOptions = {}): ToneSyllable[] {
  const language = opts.language ?? 'la';
  let out: ToneSyllable[];

  if (language === 'en') {
    out = toEnglishToneSyllables(text);
  } else {
    const words = text.split(/\s+/).filter(Boolean);
    out = [];
    const anyPolysyllable = words.some((w) => syllabifyWord(w).length > 1);
    words.forEach((word, wordIndex) => {
      const parts = syllabifyWord(word);
      const stress = parts.length > 1 ? stressedSyllableIndex(parts) : -1;
      parts.forEach((p, i) => {
        out.push({
          text: p,
          stressed: i === stress,
          wordStart: i === 0,
          wordEnd: i === parts.length - 1,
          wordIndex,
        });
      });
      if (parts.length === 1 && !anyPolysyllable && wordIndex === words.length - 1) {
        out[out.length - 1].stressed = true;
      }
    });
  }

  if (opts.stressOverrides) {
    const baseOffset = opts.offset ?? 0;
    for (let i = 0; i < out.length; i++) {
      const override = opts.stressOverrides[baseOffset + i];
      if (typeof override === 'boolean') {
        out[i] = { ...out[i], stressed: override };
      }
    }
  }

  return out;
}

/**
 * True when a Latin word has 3+ syllables, no acute accent, is not in the
 * exception table, and ends in an open penultimate syllable where vowel length
 * is invisible in plain spelling.
 */
export function isLatinWordUncertain(word: string): boolean {
  const parts = syllabifyWord(word);
  if (parts.length < 3) return false;
  for (const p of parts) {
    if (ACUTE.test(p.normalize('NFC')) || ACUTE.test(p.normalize('NFD'))) return false;
  }
  const plain = stripToLetters(parts.join(''));
  if (plain in EXCEPTIONS_FROM_END) return false;
  if (/(orum|arum|erunt|atur|etur|amus|atis|emus|etis|aris)$/.test(plain)) return false;
  // Closed/diphthong penult is unambiguously heavy; open penult depends on natural vowel length.
  return !isHeavy(parts[parts.length - 2]);
}
