import { ChantLanguage, ChantScore, ScoreItem } from '@/src/types/chant';
import { syllabifyText } from '@/src/lib/text/latinSyllabify';
import { syllabifyEnglishText } from '@/src/lib/text/englishSyllabify';

export interface ApplyLyricsResult {
  score: ChantScore;
  /** Number of syllable items that received text. */
  assigned: number;
  /** Text syllables left over because the score ran out of notes. */
  leftoverSyllables: number;
  /** Singable syllable items that received no text. */
  unfilledItems: number;
}

/**
 * Distribute syllabified text across the score's note-bearing syllable items,
 * in order. A melisma (several neume groups on one syllable) counts as one
 * syllable. Existing lyrics are replaced; items without notes are untouched.
 */
export function applyLyricsToScore(
  score: ChantScore,
  text: string,
  language: ChantLanguage = 'la'
): ApplyLyricsResult {
  const syllables = language === 'en' ? syllabifyEnglishText(text) : syllabifyText(text);
  let cursor = 0;
  let assigned = 0;
  let unfilled = 0;

  const items: ScoreItem[] = score.items.map((item) => {
    if (item.kind !== 'syllable') return item;
    const singable = item.groups.some((g) => g.notes.some((n) => !n.accidentalOnly));
    if (!singable) return item;
    const next = syllables[cursor];
    if (!next) {
      unfilled += 1;
      return item;
    }
    cursor += 1;
    assigned += 1;
    return {
      ...item,
      lyric: next.text,
      wordEnd: next.wordEnd,
      lyricColor: undefined,
      lyricSpans: undefined,
    };
  });

  return {
    score: { ...score, items },
    assigned,
    leftoverSyllables: Math.max(0, syllables.length - cursor),
    unfilledItems: unfilled,
  };
}
