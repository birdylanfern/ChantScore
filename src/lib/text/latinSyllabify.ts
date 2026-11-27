/**
 * Ecclesiastical-Latin syllabification (chant-book conventions).
 *
 * Rules implemented:
 *  - ae / oe (and æ / œ) and au are diphthongs (one syllable); eu, ei, ui etc. are not (De-us, e-le-i-son).
 *  - u after q, and u between n/g and a vowel ("lingua", "sanguis"), is consonantal.
 *  - i at word start or between vowels before a vowel is consonantal (Iesu, ma-ies-tas, Al-le-lu-ia).
 *  - Between vowels, a consonant cluster splits before its longest valid onset:
 *    a single consonant, mute+liquid (bl br cl cr dr fl fr gl gr pl pr tr),
 *    or the chant-book pairs ch ph th rh gn ct pt st sc sp sq.
 *  - x and doubled consonants stay with the preceding syllable (ex-cel-sis, es-se).
 *
 * Words already containing hyphens are respected as written.
 */

const VOWELS = new Set(['a', 'e', 'i', 'o', 'u', 'y']);
const MUTE_LIQUID = /^[bcdfgpt][lr]$/;
const INSEPARABLE = new Set(['qu', 'gu', 'ch', 'ph', 'th', 'rh', 'gn', 'ct', 'pt', 'st', 'sc', 'sp', 'sq']);

function base(ch: string): string {
  const b = ch.normalize('NFD')[0] ?? ch;
  const lower = b.toLowerCase();
  if (lower === 'æ' || lower === 'œ') return lower;
  return lower;
}

function isLetter(ch: string): boolean {
  return /\p{L}/u.test(ch);
}

type Kind = 'V' | 'C';

interface Unit {
  text: string; // original characters (with accents, case)
  kind: Kind;
  /** The vowel unit is a diphthong/ligature (ae, oe, au, æ, œ). */
  letters: string; // lowercase base letters
}

function classify(word: string): Unit[] {
  const chars = [...word];
  const lower = chars.map(base);
  const units: Unit[] = [];
  const n = chars.length;
  const isV = (i: number) => i >= 0 && i < n && (VOWELS.has(lower[i]) || lower[i] === 'æ' || lower[i] === 'œ');

  let i = 0;
  while (i < n) {
    const c = lower[i];

    // Ligatures æ / œ
    if (c === 'æ' || c === 'œ') {
      units.push({ text: chars[i], kind: 'V', letters: c });
      i += 1;
      continue;
    }

    if (isV(i)) {
      // Diphthongs ae, oe, au (accent on either letter is fine)
      const next = i + 1 < n ? lower[i + 1] : '';
      const pair = c + next;
      if (pair === 'ae' || pair === 'oe' || pair === 'au') {
        units.push({ text: chars[i] + chars[i + 1], kind: 'V', letters: pair });
        i += 2;
        continue;
      }

      // Consonantal u: after q, or after g when preceded by n and followed by a vowel
      if (c === 'u') {
        const prev = i > 0 ? lower[i - 1] : '';
        const prev2 = i > 1 ? lower[i - 2] : '';
        if (prev === 'q' || (prev === 'g' && prev2 === 'n' && isV(i + 1))) {
          units.push({ text: chars[i], kind: 'C', letters: c });
          i += 1;
          continue;
        }
      }

      // Consonantal i: word start before a vowel, or between vowels before a vowel
      if (c === 'i' && isV(i + 1)) {
        const prevIsVowelUnit = i > 0 && units.length > 0 && units[units.length - 1].kind === 'V';
        if (i === 0 || prevIsVowelUnit) {
          units.push({ text: chars[i], kind: 'C', letters: c });
          i += 1;
          continue;
        }
      }

      units.push({ text: chars[i], kind: 'V', letters: c });
      i += 1;
      continue;
    }

    // j is a consonant; everything else non-vowel is a consonant
    units.push({ text: chars[i], kind: 'C', letters: c === 'j' ? 'i' : c });
    i += 1;
  }
  return units;
}

function splitPoint(cluster: Unit[]): number {
  // Returns how many units of the cluster stay with the preceding syllable.
  if (cluster.length <= 1) return 0;
  const last2 = cluster[cluster.length - 2].letters + cluster[cluster.length - 1].letters;
  // x closes the previous syllable: ex|cel
  let keep = cluster.length - 1;
  if (MUTE_LIQUID.test(last2) || INSEPARABLE.has(last2)) keep = cluster.length - 2;
  // 'x' never starts a syllable's onset cluster partner
  for (let k = 0; k < cluster.length; k++) {
    if (cluster[k].letters === 'x') keep = Math.max(keep, k + 1);
  }
  return Math.max(0, Math.min(keep, cluster.length));
}

function syllabifyPlain(word: string): string[] {
  const units = classify(word);
  const nuclei: number[] = [];
  units.forEach((u, idx) => {
    if (u.kind === 'V') nuclei.push(idx);
  });
  if (nuclei.length <= 1) return [units.map((u) => u.text).join('')];

  const boundaries: number[] = []; // index of first unit of each syllable after the first
  for (let k = 0; k < nuclei.length - 1; k++) {
    const from = nuclei[k] + 1;
    const to = nuclei[k + 1]; // exclusive
    const cluster = units.slice(from, to);
    if (cluster.length === 0) {
      boundaries.push(to); // hiatus: e-le-i-son, De-us
    } else {
      boundaries.push(from + splitPoint(cluster));
    }
  }

  const out: string[] = [];
  let start = 0;
  for (const b of boundaries) {
    out.push(units.slice(start, b).map((u) => u.text).join(''));
    start = b;
  }
  out.push(units.slice(start).map((u) => u.text).join(''));
  return out;
}

/** Syllabify one word, keeping surrounding punctuation on the first/last syllable. */
export function syllabifyWord(token: string): string[] {
  const chars = [...token];
  let lead = 0;
  let trail = chars.length;
  while (lead < trail && !isLetter(chars[lead])) lead += 1;
  while (trail > lead && !isLetter(chars[trail - 1])) trail -= 1;
  const prefix = chars.slice(0, lead).join('');
  const suffix = chars.slice(trail).join('');
  const core = chars.slice(lead, trail).join('');
  if (!core) return [token];

  const parts = core.includes('-')
    ? core.split('-').filter(Boolean).flatMap((p) => (p ? [p] : []))
    : syllabifyPlain(core);
  if (parts.length === 0) return [token];
  parts[0] = prefix + parts[0];
  parts[parts.length - 1] = parts[parts.length - 1] + suffix;
  return parts;
}

export interface TextSyllable {
  text: string;
  /** True when this syllable ends its word. */
  wordEnd: boolean;
}

export function syllabifyText(text: string): TextSyllable[] {
  const out: TextSyllable[] = [];
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const parts = syllabifyWord(word);
    parts.forEach((p, idx) => out.push({ text: p, wordEnd: idx === parts.length - 1 }));
  }
  return out;
}
