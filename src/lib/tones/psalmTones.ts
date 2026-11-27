import { Cadence, CadenceSegment, ToneDefinition } from './tone';

/**
 * Built-in psalm tones.
 *
 * The melodies are kept in the compact GABC notation used by the Source & Summit
 * psalm-tone tool they came from, so they can be checked against it line by line:
 *
 *   - space-separated syllable slots, GABC pitch letters (a-m), `x` = flat
 *   - a leading `'` marks the accented syllable
 *   - a trailing `r` marks an "open" slot: the note repeats on as many
 *     unaccented syllables as the text needs (the recitation / punctum cavum)
 *   - slots before the first open slot are the intonation
 *   - `.` is a punctum mora
 *
 * `buildPsalmTone` converts one family + ending into the engine's ToneDefinition.
 */
export interface PsalmToneSource {
  clef: string;
  mediant: string;
  solemn?: string;
  termination?: string;
  terminations?: Record<string, string>;
}

/** Dedicated Magníficat verse-1 incipit per tone number (shared across all endings and simple/solemn). */
const MAGNIFICAT_INCIPIT: Record<string, string[]> = {
  '2': ['e', 'fe', 'eh hr'],
};

export const PSALM_TONE_SOURCE: Record<string, PsalmToneSource> = {
  '1': {
    clef: 'c4',
    mediant: "f gh hr 'ixi hr 'g hr h.",
    solemn: "f gh hr hg ixgi h hr 'hg gh..",
    terminations: {
      D: "hr g f 'gh gr gvFED.",
      'D-': "hr g f 'g gr gvFED.",
      D2: "hr g f gr 'gf d.",
      f: "hr g f 'gh gr gf..",
      g: "hr g f 'gh gr g.",
      g2: "hr g f 'g gr ghg.",
      g3: "hr g f 'g gr g.",
      a: "hr g f 'g hr h.",
      a2: "hr g f 'g gr gh..",
      a3: "hr g f 'gh gr gh..",
    },
  },
  '2': {
    clef: 'f3',
    mediant: "e f hr 'i hr h.",
    solemn: "e fe eh hr hg hi i 'hi hr h.",
    termination: "hr g 'e fr f.",
  },
  '3': {
    clef: 'c4',
    mediant: "g hj jr 'k jr jr 'ih j.",
    solemn: "g hj jr 'jk jr jr 'ih hj..",
    terminations: {
      b: "jr h 'j jr i.",
      a: "jr h 'j jr ih..",
      a2: "jr ji hi 'h gr gh..",
      g: "jr ji hi 'h gr g.",
      g2: "jr h j i 'h gr g.",
    },
  },
  '4': {
    clef: 'c4',
    mediant: "h gh hr g h 'i hr h.",
    solemn: "h gh hr hg gi i 'hi hr h.",
    terminations: {
      g: "hr 'h gr g.",
      E: "hr g h ih gr 'gf e.",
    },
  },
  '5': {
    clef: 'c3',
    mediant: "d f hr 'i hr h.",
    solemn: "d f hr i 'i hr h.",
    termination: "hr 'i gr 'h fr f.",
  },
  '6': {
    clef: 'c4',
    mediant: "f gh hr 'ixi hr 'g hr h.",
    solemn: "f gh hr hg ixgi h hr 'hg gh..",
    termination: "hr f gh 'g fr f.",
  },
  '7': {
    clef: 'c3',
    mediant: "hg hi ir 'k jr 'i jr j.",
    solemn: "ehg hi ir 'ik jr jr 'ji ij..",
    terminations: {
      a: "ir 'j ir 'h hr gf..",
      b: "ir 'j ir 'h hr g.",
      c: "ir 'j ir 'h hr gh..",
      c2: "ir 'j ir 'h hr ih..",
      d: "ir 'j ir 'h hr gi..",
    },
  },
  '8': {
    clef: 'c4',
    mediant: "g h jr 'k jr j.",
    solemn: "g hg gj jr ji jk k 'jk jr j.",
    terminations: {
      G: "jr i j 'h gr g.",
      'G*': "jr i j 'h gr gh..",
      c: "jr h j 'k jr j.",
    },
  },
  'peregrinus': {
    clef: 'c4',
    mediant: "ixhi hr g ixi h 'g fr f.",
    termination: "gr d 'f fr ed..",
  },
  irregularis: {
    clef: 'c4',
    mediant: "f gh hr 'g fr f.",
    terminations: {
      a2: "hr 'ixi gr gr 'ixi ir h.",
    },
  },
  'in directum (romanus)': {
    clef: 'c3',
    mediant: "hr g f 'h hr h.",
    termination: "hr 'h fr f.",
  },
  'in directum (T.P.)': {
    clef: 'c3',
    mediant: "e f hr i 'i fr f.",
    termination: "hr e f 'g fr f.",
  },
};

interface LegacyParse {
  intonation: string[];
  tenor: string | null;
  segments: CadenceSegment[];
}

/** Read one compact cadence string into intonation / tenor / accent segments. */
function parseLegacy(spec: string): LegacyParse | null {
  const tokens = spec.trim().split(/\s+/).filter(Boolean);
  let intonation: string[] = [];
  let tenor: string | null = null;
  let seenOpen = false;
  let pending: string[] = [];
  const segments: CadenceSegment[] = [];
  let cur: CadenceSegment | null = null;

  for (const tok of tokens) {
    const m = tok.match(/^('?)(.+?)(r?)$/);
    if (!m) return null;
    const accent = m[1] === "'";
    const body = m[2];
    const open = m[3] === 'r' && !accent;

    if (accent) {
      cur = { prep: pending, accent: body, post: [] };
      segments.push(cur);
      pending = [];
    } else if (open) {
      if (!seenOpen) {
        // first open slot = the reciting note; everything before it is the intonation
        seenOpen = true;
        tenor = body[0];
        intonation = pending;
        pending = [];
      } else if (cur && pending.length === 0) {
        cur.post.push(body); // open slot after an accent: repeats on extra unaccented syllables
      }
      // otherwise: an open slot sitting among preparatory notes, which is simply the tenor again
    } else {
      pending.push(body);
    }
  }
  if (!cur) return null; // no accent: not expressible as a cadence (fixed-length endings)
  if (pending.length) cur.post.push(...pending);
  return { intonation, tenor, segments };
}

/**
 * The flex falls a whole tone below the tenor, or a minor third when the step
 * below would be a semitone (tenor on do or fa). Depends on the clef.
 */
export function flexNote(tenor: string, clef: string): string {
  const clefBase = clef[0] === 'f' ? 6 : 1;
  const clefValue = clefBase + parseInt(clef.slice(-1), 10) * 2;
  const degree = (parseInt(tenor, 36) - 10 + 16 - clefValue) % 8;
  const code = tenor.charCodeAt(0) - (degree === 0 || degree === 3 ? 2 : 1);
  return String.fromCharCode(code);
}

export interface PsalmToneChoice {
  id: string;
  /** Endings that can be built (those without an accent cannot be expressed and are left out). */
  endings: string[];
  hasSolemn: boolean;
}

function endingsOf(src: PsalmToneSource): Record<string, string> {
  if (src.terminations) return src.terminations;
  return src.termination ? { '': src.termination } : {};
}

/** Tones and endings the user can pick from. */
export function listPsalmTones(): PsalmToneChoice[] {
  const out: PsalmToneChoice[] = [];
  for (const [id, src] of Object.entries(PSALM_TONE_SOURCE)) {
    const endings = Object.keys(endingsOf(src)).filter((name) => buildPsalmTone(id, name) !== null);
    if (endings.length) {
      out.push({ id, endings, hasSolemn: !!src.solemn && buildPsalmTone(id, endings[0], true) !== null });
    }
  }
  return out;
}

export function psalmToneLabel(id: string, ending: string, solemn: boolean): string {
  const isDirectum = id.startsWith('in directum');
  const base = isDirectum || id === 'irregularis' || id.startsWith('peregrinus') ? `Tonus ${id}` : `Tone ${id}`;
  return `${base}${ending ? ` ${ending}` : ''}${solemn ? ' (solemn)' : ''}`;
}

/** Build a ready-to-use tone, or null if the combination does not exist. */
export function buildPsalmTone(id: string, ending: string, solemn = false): ToneDefinition | null {
  const src = PSALM_TONE_SOURCE[id];
  if (!src) return null;
  const termSpec = endingsOf(src)[ending];
  if (!termSpec) return null;
  const med = parseLegacy(solemn && src.solemn ? src.solemn : src.mediant);
  const term = parseLegacy(termSpec);
  if (!med || !term || !med.tenor) return null;
  // A second half that opens with its own intonation cannot be expressed yet.
  if (term.intonation.length) return null;

  const mediant: Cadence = { segments: med.segments };
  const termination: Cadence = { segments: term.segments };
  // When the second half recites on a different note (tonus peregrinus), say so.
  if (term.tenor && term.tenor !== med.tenor) termination.recite = term.tenor;

  const f = flexNote(med.tenor, src.clef);
  const flex: Cadence = { segments: [{ prep: [], accent: med.tenor, post: [f, `${f}.`] }] };

  return {
    name: psalmToneLabel(id, ending, solemn),
    clef: src.clef,
    tenor: med.tenor,
    intonation: med.intonation,
    ...(MAGNIFICAT_INCIPIT[id] ? { magnificatIntonation: [...MAGNIFICAT_INCIPIT[id]] } : {}),
    flex,
    mediant,
    termination,
  };
}
