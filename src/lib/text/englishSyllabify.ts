import type { TextSyllable } from './latinSyllabify';

interface HypherLike {
  hyphenate: (word: string) => string[];
}

let hypherInstance: HypherLike | null = null;
let englishHyphenationPromise: Promise<void> | null = null;

/**
 * Dynamically load `hypher` and `hyphenation.en-us` once when English
 * syllabification is needed, so Latin-only users never download them.
 */
export function ensureEnglishHyphenation(): Promise<void> {
  if (hypherInstance) return Promise.resolve();
  if (!englishHyphenationPromise) {
    englishHyphenationPromise = Promise.all([
      import('hypher'),
      import('hyphenation.en-us'),
    ])
      .then(([hypherMod, enUsMod]) => {
        const HypherCtor =
          (hypherMod as unknown as { default?: new (opts: unknown) => HypherLike }).default ??
          (hypherMod as unknown as new (opts: unknown) => HypherLike);
        const enUsPatterns =
          (enUsMod as unknown as { default?: Record<string, unknown> }).default ??
          (enUsMod as unknown as Record<string, unknown>);
        // Use leftmin=1, rightmin=2 so spoken 2-letter prefixes/endings like "a-men",
        // "o-ver", "glo-ry", "ho-ly", "mer-cy" can split, while single-letter suffixes
        // like "-s" are not orphaned. Any consonant-only piece is merged below.
        hypherInstance = new HypherCtor({
          ...enUsPatterns,
          leftmin: 1,
          rightmin: 2,
        });
      })
      .catch((err) => {
        englishHyphenationPromise = null;
        throw err;
      });
  }
  return englishHyphenationPromise;
}

export function isEnglishHyphenationLoaded(): boolean {
  return hypherInstance !== null;
}

const HAS_VOWEL_RE = /[aeiouy]/i;

function hasSyllabicVowel(part: string, isInitial = false): boolean {
  const plain = stripDiacritics(part).toLowerCase();
  // Leading `y` before a vowel (or alone at word start like "y-our") is consonantal.
  if (isInitial && /^[^aeiou]*y$/.test(plain)) return false;
  return HAS_VOWEL_RE.test(plain.replace(/^y(?=[aeiou])/, ''));
}

/**
 * Curated spoken-syllable templates for common English liturgical & biblical
 * words where typographic TeX line-break patterns either suppress splits
 * ("holy", "almighty", "jerusalem") or place them awkwardly for singing.
 * Keys are lowercase ASCII letters (diacritics stripped).
 */
const LITURGICAL_SYLLABLES: Record<string, string> = {
  above: 'a-bove',
  acclaim: 'ac-claim',
  again: 'a-gain',
  against: 'a-gainst',
  ago: 'a-go',
  alleluia: 'al-le-lu-ia',
  almighty: 'al-migh-ty',
  alone: 'a-lone',
  always: 'al-ways',
  amen: 'a-men',
  among: 'a-mong',
  angel: 'an-gel',
  angels: 'an-gels',
  archangel: 'arch-an-gel',
  archangels: 'arch-an-gels',
  around: 'a-round',
  assumed: 'as-sumed',
  authority: 'au-tho-ri-ty',
  away: 'a-way',
  because: 'be-cause',
  before: 'be-fore',
  behold: 'be-hold',
  beloved: 'be-lov-ed',
  beneath: 'be-neath',
  beside: 'be-side',
  between: 'be-tween',
  blessed: 'blessed',
  christ: 'christ',
  comes: 'comes',
  comfort: 'com-fort',
  coming: 'com-ing',
  compassion: 'com-pas-sion',
  confess: 'con-fess',
  covenant: 'cov-e-nant',
  creation: 'cre-a-tion',
  crucified: 'cru-ci-fied',
  dare: 'dare',
  david: 'da-vid',
  deliver: 'de-liv-er',
  design: 'de-sign',
  dominion: 'do-min-ion',
  dominions: 'do-min-ions',
  duty: 'du-ty',
  eternal: 'e-ter-nal',
  ever: 'ev-er',
  everlasting: 'ev-er-last-ing',
  every: 'ev-ery',
  everywhere: 'ev-ery-where',
  exultation: 'ex-ul-ta-tion',
  father: 'fa-ther',
  fathers: 'fa-thers',
  forever: 'for-ev-er',
  forevermore: 'for-ev-er-more',
  forgive: 'for-give',
  formed: 'formed',
  forsake: 'for-sake',
  fulfilled: 'ful-filled',
  glory: 'glo-ry',
  glorious: 'glo-ri-ous',
  hallelujah: 'hal-le-lu-jah',
  heaven: 'heav-en',
  heavens: 'heav-ens',
  holy: 'ho-ly',
  hosanna: 'ho-san-na',
  human: 'hu-man',
  infinite: 'in-fi-nite',
  inherit: 'in-her-it',
  into: 'in-to',
  isaac: 'i-saac',
  israel: 'is-ra-el',
  jacob: 'ja-cob',
  jerusalem: 'je-ru-sa-lem',
  jesus: 'je-sus',
  judgement: 'judge-ment',
  judgment: 'judg-ment',
  kingdom: 'king-dom',
  lion: 'li-on',
  lovingkindness: 'lov-ing-kind-ness',
  lowliness: 'low-li-ness',
  magnificat: 'mag-ni-fi-cat',
  magnify: 'mag-ni-fy',
  majesty: 'maj-es-ty',
  manifest: 'man-i-fest',
  mary: 'ma-ry',
  mercy: 'mer-cy',
  mercies: 'mer-cies',
  only: 'on-ly',
  opened: 'o-pened',
  our: 'our',
  over: 'o-ver',
  passion: 'pas-sion',
  people: 'peo-ple',
  peoples: 'peo-ples',
  power: 'pow-er',
  powers: 'pow-ers',
  praise: 'praise',
  praises: 'prais-es',
  promise: 'prom-ise',
  quiet: 'qui-et',
  received: 're-ceived',
  rejoice: 're-joice',
  rejoices: 're-joic-es',
  remember: 're-mem-ber',
  revealed: 're-vealed',
  righteous: 'righ-teous',
  righteousness: 'righ-teous-ness',
  salvation: 'sal-va-tion',
  sanctuary: 'sanc-tu-a-ry',
  saving: 'sa-ving',
  savior: 'sa-vior',
  saviour: 'sa-viour',
  shepherd: 'shep-herd',
  sion: 'si-on',
  spirit: 'spir-it',
  spirits: 'spir-its',
  tabernacle: 'tab-er-na-cle',
  testimony: 'tes-ti-mo-ny',
  through: 'through',
  truly: 'tru-ly',
  under: 'un-der',
  understand: 'un-der-stand',
  understanding: 'un-der-stand-ing',
  until: 'un-til',
  unto: 'un-to',
  upon: 'up-on',
  virgin: 'vir-gin',
  water: 'wa-ter',
  waters: 'wa-ters',
  without: 'with-out',
  wondrous: 'won-drous',
  you: 'you',
  your: 'your',
  yours: 'yours',
  zion: 'zi-on',
};

const SYLLABIC_NT_STEMS = new Set([
  'is',
  'was',
  'has',
  'have',
  'had',
  'did',
  'does',
  'could',
  'should',
  'would',
  'might',
  'must',
  'need',
  'dare',
]);

function isLetter(ch: string): boolean {
  return /\p{L}/u.test(ch);
}

function stripDiacritics(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Split a word's characters into clusters where each cluster is one base
 * character plus any trailing combining marks, so slicing by base index
 * never separates an accent from its vowel.
 */
function toClusters(word: string): string[] {
  const clusters: string[] = [];
  for (const ch of word) {
    if (/[\u0300-\u036f]/.test(ch) && clusters.length > 0) {
      clusters[clusters.length - 1] += ch;
    } else {
      clusters.push(ch);
    }
  }
  return clusters;
}

function sliceByLengths(clusters: string[], lengths: number[]): string[] {
  const out: string[] = [];
  let pos = 0;
  for (let i = 0; i < lengths.length; i++) {
    const len = i === lengths.length - 1 ? clusters.length - pos : lengths[i];
    if (len > 0) {
      out.push(clusters.slice(pos, pos + len).join(''));
      pos += len;
    }
  }
  return out.length > 0 ? out : [clusters.join('')];
}

/** Merge any chunk that has no vowel into an adjacent syllabic chunk. */
function mergeNonSyllabicParts(parts: string[]): string[] {
  if (parts.length <= 1) return parts;
  const out: string[] = [];
  let pendingPrefix = '';

  for (const p of parts) {
    const cur = pendingPrefix + p;
    pendingPrefix = '';
    if (!hasSyllabicVowel(cur, out.length === 0)) {
      if (out.length > 0) {
        out[out.length - 1] += cur;
      } else {
        pendingPrefix = cur;
      }
    } else {
      out.push(cur);
    }
  }

  if (pendingPrefix) {
    if (out.length > 0) out[out.length - 1] += pendingPrefix;
    else out.push(pendingPrefix);
  }
  return out;
}

/**
 * Rule-based vowel-nucleus refinement for chunks that TeX left unsplit
 * (e.g. "leluia" -> "le-lu-ia", "ation" -> "a-tion").
 */
const VOWEL_DIGRAPHS = new Set([
  'ai', 'au', 'aw', 'ay',
  'ea', 'ee', 'ei', 'eu', 'ew', 'ey',
  'ie', 'oa', 'oe', 'oi', 'oo', 'ou', 'ow', 'oy',
  'ue', 'ui', 'uy',
]);
const ONSET_PAIRS = new Set([
  'bl', 'br', 'ch', 'cl', 'cr', 'dr', 'fl', 'fr', 'gh', 'gl', 'gr',
  'ph', 'pl', 'pr', 'qu', 'sc', 'sh', 'sk', 'sl', 'sm', 'sn', 'sp',
  'st', 'sw', 'th', 'tr', 'tw', 'wh', 'wr',
]);

function splitPlainChunkFallback(chunk: string): string[] {
  const lower = chunk.toLowerCase();
  // Don't split short words or silent-e endings unnecessarily
  if (lower.length <= 3) return [chunk];

  // Collect vowel-nucleus spans
  const nuclei: { start: number; end: number }[] = [];
  let i = 0;
  while (i < lower.length) {
    const ch = lower[i];
    const isY = ch === 'y' && i > 0 && !/[aeiou]/.test(lower[i - 1]);
    const isV = /[aeiou]/.test(ch) || isY;
    if (!isV) {
      i += 1;
      continue;
    }
    // qu / gu before a vowel: u is consonantal
    if (ch === 'u' && i > 0 && (lower[i - 1] === 'q' || lower[i - 1] === 'g') && i + 1 < lower.length && /[aeiou]/.test(lower[i + 1])) {
      i += 1;
      continue;
    }
    // Palatal i in -tion/-sion/-tious/-cious is part of the suffix nucleus, not a separate syllable
    if (
      ch === 'i' &&
      i > 0 &&
      (lower[i - 1] === 't' || lower[i - 1] === 's' || lower[i - 1] === 'c') &&
      /^(?:on|ons|ous)$/.test(lower.slice(i + 1))
    ) {
      i += 1;
      continue;
    }
    const start = i;
    if (i + 1 < lower.length && VOWEL_DIGRAPHS.has(ch + lower[i + 1])) {
      i += 2;
    } else {
      i += 1;
    }
    nuclei.push({ start, end: i });
  }

  // Drop trailing silent -e, -es, -ed (except -le after consonant like "ta-ble", or -ted/-ded)
  if (nuclei.length >= 2) {
    const last = nuclei[nuclei.length - 1];
    const prev = nuclei[nuclei.length - 2];
    const tail = lower.slice(last.start);
    const between = lower.slice(prev.end, last.start);
    if (tail === 'e' && !/^[bcdfgptkzv]l$/.test(between) && between.length > 0) {
      nuclei.pop();
    } else if (tail === 'ed' && !/[td]$/.test(between) && between.length > 0) {
      nuclei.pop();
    } else if (tail === 'es' && !/(ch|sh|s|x|z|g|c)$/.test(between) && between.length > 0) {
      nuclei.pop();
    }
  }

  if (nuclei.length <= 1) return [chunk];

  const boundaries: number[] = [];
  for (let k = 0; k < nuclei.length - 1; k++) {
    const from = nuclei[k].end;
    const to = nuclei[k + 1].start;
    const gapLen = to - from;
    if (gapLen === 0) {
      boundaries.push(to);
    } else if (gapLen === 1) {
      boundaries.push(from);
    } else {
      const pair = lower.slice(to - 2, to);
      boundaries.push(ONSET_PAIRS.has(pair) ? to - 2 : to - 1);
    }
  }

  const out: string[] = [];
  let start = 0;
  for (const b of boundaries) {
    if (b > start) {
      out.push(chunk.slice(start, b));
      start = b;
    }
  }
  out.push(chunk.slice(start));
  return mergeNonSyllabicParts(out);
}

function syllabifyPlainEnglish(word: string): string[] {
  const clusters = toClusters(word);
  if (clusters.length === 0) return [word];

  const plainLetters = clusters.map((c) => stripDiacritics(c).toLowerCase()).join('');
  const exception = LITURGICAL_SYLLABLES[plainLetters];
  if (exception) {
    const lengths = exception.split('-').map((s) => s.length);
    return sliceByLengths(clusters, lengths);
  }

  if (plainLetters.length <= 3) {
    return [word];
  }

  let hypherParts: string[];
  try {
    hypherParts = hypherInstance ? hypherInstance.hyphenate(plainLetters) : [plainLetters];
  } catch {
    hypherParts = [plainLetters];
  }

  const merged = mergeNonSyllabicParts(hypherParts);
  const refined = merged.flatMap((part) => splitPlainChunkFallback(part));
  const lengths = refined.map((p) => p.length);
  return sliceByLengths(clusters, lengths);
}

function syllabifyCoreWithContractions(core: string): string[] {
  if (core.includes('-')) {
    const parts = core.split('-').filter(Boolean);
    return parts.length > 0 ? parts : [core];
  }

  // Handle n't contractions where n't forms its own syllable (isn't, couldn't, etc.)
  const ntMatch = core.match(/^(.+?)(n['’]t)$/i);
  if (ntMatch) {
    const stemKey = stripDiacritics(ntMatch[1]).toLowerCase();
    if (SYLLABIC_NT_STEMS.has(stemKey)) {
      const stemParts = syllabifyPlainEnglish(ntMatch[1]);
      return [...stemParts, ntMatch[2]];
    }
    // don't, can't, won't, etc. stay together as one syllable
    return [core];
  }

  // Handle contractions and possessives with apostrophes as part of one word
  const aposIdx = core.search(/['’]/);
  if (aposIdx >= 0) {
    const before = core.slice(0, aposIdx);
    const after = core.slice(aposIdx);
    const afterLetters = stripDiacritics(after).toLowerCase();
    // Poetic contractions like o'er, ne'er, e'er, heav'n
    if (/^['’](er|n)$/i.test(after) || before.length <= 1) {
      return [core];
    }
    // Possessives / standard contractions ('s, 'd, 'll, 've, 're, 'm)
    if (/^['’](s|d|ll|ve|re|m|t)$/i.test(afterLetters)) {
      const stemParts = syllabifyPlainEnglish(before);
      stemParts[stemParts.length - 1] += after;
      return stemParts;
    }
    return [core];
  }

  return syllabifyPlainEnglish(core);
}

/**
 * Syllabify one English word, respecting explicit hyphens and keeping
 * contractions/apostrophes as part of one word and surrounding punctuation on
 * the edge syllables.
 */
export function syllabifyEnglishWord(token: string): string[] {
  const normalized = token.normalize('NFC');
  const chars = [...normalized];
  let lead = 0;
  let trail = chars.length;
  while (lead < trail && !isLetter(chars[lead])) lead += 1;
  while (trail > lead && !isLetter(chars[trail - 1])) trail -= 1;

  const prefix = chars.slice(0, lead).join('');
  const suffix = chars.slice(trail).join('');
  const core = chars.slice(lead, trail).join('');
  if (!core) return [token];

  const parts = syllabifyCoreWithContractions(core);
  if (parts.length === 0) return [token];
  parts[0] = prefix + parts[0];
  parts[parts.length - 1] = parts[parts.length - 1] + suffix;
  return parts;
}

export function isKnownLiturgicalEnglishWord(token: string): boolean {
  const plain = stripDiacritics(token).replace(/[^\p{L}]/gu, '').toLowerCase();
  return plain.length > 0 && Object.prototype.hasOwnProperty.call(LITURGICAL_SYLLABLES, plain);
}

export function isEnglishHyphenationUncertain(token: string): boolean {
  const normalized = token.normalize('NFC');
  const chars = [...normalized];
  let lead = 0;
  let trail = chars.length;
  while (lead < trail && !isLetter(chars[lead])) lead += 1;
  while (trail > lead && !isLetter(chars[trail - 1])) trail -= 1;
  const core = chars.slice(lead, trail).join('');
  if (!core || core.includes('-')) return false;
  if (/[\u00e1\u00e9\u00ed\u00f3\u00fa\u00fd\u0301]/.test(core.normalize('NFD'))) return false;

  const plainLetters = stripDiacritics(core).toLowerCase();
  if (plainLetters.length <= 3) return false;
  if (Object.prototype.hasOwnProperty.call(LITURGICAL_SYLLABLES, plainLetters)) return false;
  if (/['’]/.test(core)) return false;

  if (!hypherInstance) return true;
  let hypherParts: string[];
  try {
    hypherParts = hypherInstance.hyphenate(plainLetters);
  } catch {
    return true;
  }
  const merged = mergeNonSyllabicParts(hypherParts);
  const refined = merged.flatMap((part) => splitPlainChunkFallback(part));
  // Uncertain if rule-based fallback had to split a chunk Hypher left whole
  return refined.length !== merged.length;
}

export function syllabifyEnglishText(text: string): TextSyllable[] {
  const out: TextSyllable[] = [];
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const parts = syllabifyEnglishWord(word);
    parts.forEach((p, idx) => out.push({ text: p, wordEnd: idx === parts.length - 1 }));
  }
  return out;
}
