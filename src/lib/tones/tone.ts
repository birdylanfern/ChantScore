import { ChantLanguage } from '@/src/types/chant';
import { ToneSyllable } from './latinAccent';

/** One syllable slot of a cadence: the GABC pitch letters for it, and whether it is the accent. */
export interface CadenceToken {
  notes: string;
  accent: boolean;
}

/** A cadence is one or more segments: [preparatory syllables] accent [post-accent syllables]. */
export interface CadenceSegment {
  /**
   * Optional leading segment (`?` before the segment): applied only when a real
   * stressed syllable exists far enough before the following segment's start.
   */
  optional?: boolean;
  /**
   * The first `condPrep` preparatory notes (written `?note`) are only used when the
   * syllable before them is stressed, e.g. the `g` in "gra-ti-as a-ge-re" (g gf fg).
   */
  condPrep?: number;
  prep: string[];
  accent: string;
  post: string[];
}

export interface Cadence {
  segments: CadenceSegment[];
  /**
   * Note on which the rest of the phrase is recited when it differs from the
   * tone's tenor (the second half of the tonus peregrinus, interrogations, ...).
   */
  recite?: string;
  /**
   * End-aligned cadence: the notes are laid on the last syllables of the phrase
   * whatever their stress (e.g. the Gospel full stop, "the fourth syllable from the end").
   */
  positional?: boolean;
  /**
   * Positional cadences only: the first `optional` slots are laid on the syllables
   * before the core slots only when the syllable at slot `optionalTrigger`
   * (default 0) is stressed. Used for the "Per Christum Dominum nostrum" opening
   * of the preface conclusion.
   */
  optional?: number;
  optionalTrigger?: number;
}

export type ReadingCadenceKind = 'flex' | 'metrum' | 'punctum' | 'question' | 'prefinal' | 'final';
export type EnglishPrefaceRole = 'h-metrum' | 'g-flex' | 'g-long';
export type TonePhrasingMode = 'punctuation' | 'lines';

export interface ToneDefinition {
  name: string;
  clef: string;
  /** Reciting note, one GABC pitch letter. */
  tenor: string;
  /** Optional reciting note when a short first half-verse omits the mediant cadence. */
  shortTenor?: string;
  /** Notes for the first syllables of the first verse (one entry per syllable). */
  intonation: string[];
  /** Optional Magníficat verse-1 incipit override (one GABC group per syllable; may include space-separated neumes). */
  magnificatIntonation?: string[];
  /**
   * Reading tones: repeat the intonation at the start of every phrase that follows
   * a ; : . or ? (not a comma), as the preface tone does.
   */
  reintone?: boolean;
  /**
   * Reading tones: phrase segmentation mode ('punctuation' default, or 'lines'
   * where each line end terminates a phrase).
   */
  phrasing?: TonePhrasingMode;
  flex?: Cadence;
  mediant?: Cadence;
  termination?: Cadence;
  /**
   * Reading tones: cadence used at each kind of punctuation. `null` means
   * "deliberately none: recite on the tenor" (no warning); a missing key warns.
   * `prefinal` is used on the next-to-last phrase and `final` on the last one.
   */
  reading?: Partial<Record<ReadingCadenceKind, Cadence | null>>;
  /** Per-language overrides for reading cadences (e.g. `punctum.en:`, `final.en:`). */
  readingByLanguage?: Partial<Record<ChantLanguage, Partial<Record<ReadingCadenceKind, Cadence | null>>>>;
  /** Per-language overrides for psalm cadences (`flex.en:`, `mediant.en:`, `termination.en:`). */
  psalmByLanguage?: Partial<Record<ChantLanguage, Partial<Record<'flex' | 'mediant' | 'termination', Cadence>>>>;
}

/**
 * One syllable's worth of GABC: pitch letters a-m (upper case = punctum
 * inclinatum), optionally with flat/natural signs (x, y) and the modifiers
 * v V w s o ~ < > . _ ' that the score parser understands. `#` is not allowed
 * because it starts a comment in tone definition files.
 */
const PITCH = /^[a-mA-Mxy][a-mA-Mxyvwso~<>._'!0-9VWSRr]*$/;

/**
 * Cadence syntax: space-separated slots, one per syllable. Each slot is GABC
 * pitch letters (`h`, or `gh` for a two-note neume). The accent syllable is
 * marked with `*`. Segments for multi-accent cadences are separated by `/`.
 *
 *   "g h i* h"      two preparatory syllables, accent on i, one post-accent syllable
 *   "h* g"          accent on h, one post-accent syllable
 *   "g h* h / g h* h"   a two-accent cadence
 */
export function parseCadence(spec: string): Cadence | null {
  // Optional modifiers before the notes, separated by ";":
  //   recite=i; ij* j        recite the rest of the phrase on i
  //   positional; h j j j    end-aligned: the last four syllables, stress ignored
  const parts = spec.split(';');
  const body = parts.pop() as string;
  let recite: string | undefined;
  let positional = false;
  for (const raw of parts) {
    const mod = raw.trim();
    if (!mod) continue;
    const rm = mod.match(/^recite\s*=\s*(\S+)$/i);
    if (rm) {
      if (!PITCH.test(rm[1])) return null;
      recite = rm[1];
    } else if (/^positional$/i.test(mod)) positional = true;
    else return null;
  }

  const segments: CadenceSegment[] = [];
  let optCount = 0;
  let optionalTrigger = 0;
  for (const part of body.split('/')) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return null;
    const seg: CadenceSegment = { prep: [], accent: '', post: [] };
    if (!positional && tokens[0] === '?') {
      seg.optional = true;
      tokens.shift();
      if (tokens.length === 0) return null;
    }
    let seenAccent = false;
    for (let tokIdx = 0; tokIdx < tokens.length; tokIdx++) {
      let tok = tokens[tokIdx];
      // Optional leading slots (positional cadences): ?note, ?^note marks the trigger.
      if (positional && tok.startsWith('?')) {
        if (seg.prep.length !== optCount || seenAccent) return null;
        tok = tok.slice(1);
        if (tok.startsWith('^')) {
          optionalTrigger = optCount;
          tok = tok.slice(1);
        }
        optCount++;
      }
      if (!positional && tok.startsWith('?')) {
        if (tokIdx === 0 && tok.endsWith('*') && !seg.optional) {
          // Optional leading segment written "?accent* ..."
          seg.optional = true;
          tok = tok.slice(1);
        } else {
          if (seenAccent || seg.prep.length !== (seg.condPrep ?? 0)) return null;
          tok = tok.slice(1);
          seg.condPrep = (seg.condPrep ?? 0) + 1;
        }
      }
      const isAccent = tok.endsWith('*');
      const notes = isAccent ? tok.slice(0, -1) : tok;
      if (!PITCH.test(notes)) return null;
      if (isAccent) {
        if (seenAccent) return null;
        seenAccent = true;
        seg.accent = notes;
      } else if (seenAccent) seg.post.push(notes);
      else seg.prep.push(notes);
    }
    if (!seenAccent) {
      // An end-aligned cadence needs no accent mark: its first note is the "accent".
      if (!positional) return null;
      seg.accent = seg.prep.shift() as string;
      seg.post = seg.prep;
      seg.prep = [];
    }
    segments.push(seg);
  }
  const cadence: Cadence = { segments };
  if (recite) cadence.recite = recite;
  if (positional) cadence.positional = true;
  if (optCount > 0) {
    cadence.optional = optCount;
    if (optionalTrigger) cadence.optionalTrigger = optionalTrigger;
  }
  return cadence;
}

/** Inverse of parseCadence, for showing a built-in tone as an editable definition. */
export function cadenceToString(c: Cadence): string {
  const mods: string[] = [];
  if (c.recite) mods.push(`recite=${c.recite}`);
  if (c.positional) mods.push('positional');
  const body = c.positional
    ? [c.segments[0].accent, ...c.segments[0].post]
        .map((n, i) => {
          if (!c.optional || i >= c.optional) return n;
          return `?${i === (c.optionalTrigger ?? 0) ? '^' : ''}${n}`;
        })
        .join(' ')
    : c.segments
        .map((s) => {
          const prepStrs = s.prep.map((n, i) => (i < (s.condPrep ?? 0) ? `?${n}` : n));
          if (s.optional && prepStrs.length === 0) {
            return [`?${s.accent}*`, ...s.post].join(' ');
          }
          const base = [...prepStrs, `${s.accent}*`, ...s.post].join(' ');
          return s.optional ? `? ${base}` : base;
        })
        .join(' / ');
  return mods.length ? `${mods.join('; ')}; ${body}` : body;
}

const READING_KEY_OF: Record<ReadingCadenceKind, string> = {
  flex: 'flexa',
  metrum: 'metrum',
  punctum: 'punctum',
  question: 'question',
  prefinal: 'prefinal',
  final: 'final',
};

/** Inverse of parseToneDefinition. */
export function toneToDefinition(tone: ToneDefinition, comment?: string): string {
  const lines: string[] = [];
  if (comment) comment.split('\n').forEach((l) => lines.push(`# ${l}`));
  lines.push(`name: ${tone.name}`, `clef: ${tone.clef}`, `tenor: ${tone.tenor}`);
  if (tone.shortTenor) lines.push(`short-tenor: ${tone.shortTenor}`);
  if (tone.intonation.length) lines.push(`intonation: ${tone.intonation.join(' ')}`);
  if (tone.magnificatIntonation?.length) {
    lines.push(`magnificat-intonation: ${tone.magnificatIntonation.join(' | ')}`);
  }
  if (tone.reintone) lines.push('reintone: yes');
  if (tone.phrasing && tone.phrasing !== 'punctuation') lines.push(`phrasing: ${tone.phrasing}`);
  if (tone.flex) lines.push(`flex: ${cadenceToString(tone.flex)}`);
  if (tone.mediant) lines.push(`mediant: ${cadenceToString(tone.mediant)}`);
  if (tone.termination) lines.push(`termination: ${cadenceToString(tone.termination)}`);
  if (tone.psalmByLanguage) {
    (['la', 'en'] as ChantLanguage[]).forEach((lang) => {
      const map = tone.psalmByLanguage![lang];
      if (!map) return;
      (['flex', 'mediant', 'termination'] as const).forEach((k) => {
        const c = map[k];
        if (c) lines.push(`${k}.${lang}: ${cadenceToString(c)}`);
      });
    });
  }
  if (tone.reading) {
    (Object.keys(READING_KEY_OF) as ReadingCadenceKind[]).forEach((k) => {
      const c = tone.reading![k];
      if (c === undefined) return;
      lines.push(`${READING_KEY_OF[k]}: ${c === null ? 'none' : cadenceToString(c)}`);
    });
  }
  if (tone.readingByLanguage) {
    (['la', 'en'] as ChantLanguage[]).forEach((lang) => {
      const map = tone.readingByLanguage![lang];
      if (!map) return;
      (Object.keys(READING_KEY_OF) as ReadingCadenceKind[]).forEach((k) => {
        const c = map[k];
        if (c === undefined) return;
        lines.push(`${READING_KEY_OF[k]}.${lang}: ${c === null ? 'none' : cadenceToString(c)}`);
      });
    });
  }
  return lines.join('\n');
}

export interface ToneParseResult {
  tone?: ToneDefinition;
  errors: string[];
}

/**
 * Tone definition file, one `key: value` per line (# starts a comment):
 *
 *   name: My tone
 *   clef: c4
 *   tenor: h
 *   intonation: g h          (optional, one note per syllable)
 *   flex: h* g               (optional)
 *   mediant: g h i* h
 *   termination: h g* g
 *
 * Reading tones use `flexa:`, `metrum:`, `punctum:` and `question:` instead of
 * mediant/termination, plus optional `prefinal:` (next-to-last phrase) and
 * `final:` (last phrase). `none` means "recite on the tenor here".
 * Cadences may start with `recite=<note>;` and/or `positional;` (see parseCadence).
 */
export function parseToneDefinition(text: string): ToneParseResult {
  const errors: string[] = [];
  const tone: ToneDefinition = { name: 'Custom tone', clef: 'c4', tenor: '', intonation: [] };
  const reading: NonNullable<ToneDefinition['reading']> = {};
  const readingByLanguage: NonNullable<ToneDefinition['readingByLanguage']> = {};
  const psalmByLanguage: NonNullable<ToneDefinition['psalmByLanguage']> = {};
  const readingKeys: Record<string, ReadingCadenceKind> = {
    flexa: 'flex',
    metrum: 'metrum',
    punctum: 'punctum',
    question: 'question',
    prefinal: 'prefinal',
    final: 'final',
  };

  text.split('\n').forEach((raw, i) => {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) return;
    const m = line.match(/^([a-z-]+(?:\.[a-z]+)?)\s*:\s*(.*)$/i);
    if (!m) {
      errors.push(`Line ${i + 1}: expected "key: value"`);
      return;
    }
    const rawKey = m[1].toLowerCase();
    const dotIdx = rawKey.indexOf('.');
    const key = dotIdx >= 0 ? rawKey.slice(0, dotIdx) : rawKey;
    const langSuffix = dotIdx >= 0 ? rawKey.slice(dotIdx + 1) : undefined;
    if (langSuffix !== undefined && langSuffix !== 'la' && langSuffix !== 'en') {
      errors.push(`Line ${i + 1}: unknown language suffix ".${langSuffix}" in "${rawKey}"`);
      return;
    }
    const lang = langSuffix as ChantLanguage | undefined;
    const value = m[2].trim();
    const cadence = (k: string) => {
      const c = parseCadence(value);
      if (!c) errors.push(`Line ${i + 1}: "${k}" must be notes a-m with one accent marked *, e.g. "g h i* h"`);
      return c;
    };

    if (lang) {
      if (key === 'flex' || key === 'mediant' || key === 'termination') {
        const c = cadence(rawKey);
        if (c) {
          psalmByLanguage[lang] ??= {};
          psalmByLanguage[lang]![key] = c;
        }
        return;
      }
      if (key in readingKeys) {
        const kind = readingKeys[key];
        readingByLanguage[lang] ??= {};
        if (/^none$/i.test(value)) {
          readingByLanguage[lang]![kind] = null;
        } else {
          const c = cadence(rawKey);
          if (c) readingByLanguage[lang]![kind] = c;
        }
        return;
      }
      errors.push(`Line ${i + 1}: unknown key "${rawKey}"`);
      return;
    }

    switch (key) {
      case 'name':
        tone.name = value || tone.name;
        break;
      case 'clef':
        if (!/^(c|f)b?[1-4]$/.test(value)) errors.push(`Line ${i + 1}: clef must look like c4`);
        else tone.clef = value;
        break;
      case 'tenor':
        if (!/^[a-m]$/.test(value)) errors.push(`Line ${i + 1}: tenor is a single note a-m`);
        else tone.tenor = value;
        break;
      case 'short-tenor':
        if (!/^[a-m]$/.test(value)) errors.push(`Line ${i + 1}: short-tenor is a single note a-m`);
        else tone.shortTenor = value;
        break;
      case 'reintone':
        tone.reintone = /^(yes|true|on)$/i.test(value);
        break;
      case 'phrasing':
        if (!/^(punctuation|lines)$/i.test(value)) {
          errors.push(`Line ${i + 1}: phrasing must be "punctuation" or "lines"`);
        } else {
          tone.phrasing = value.toLowerCase() as TonePhrasingMode;
        }
        break;
      case 'intonation': {
        const notes = value.split(/\s+/).filter(Boolean);
        if (notes.some((n) => !PITCH.test(n))) errors.push(`Line ${i + 1}: intonation notes must be a-m`);
        else tone.intonation = notes;
        break;
      }
      case 'magnificat-intonation': {
        const groups = value
          .split('|')
          .map((g) => g.trim())
          .filter(Boolean);
        const valid =
          groups.length > 0 &&
          groups.every((g) => g.split(/\s+/).every((tok) => PITCH.test(tok)));
        if (!valid) {
          errors.push(`Line ${i + 1}: magnificat-intonation entries must be GABC neumes separated by "|"`);
        } else {
          tone.magnificatIntonation = groups;
        }
        break;
      }
      case 'flex': {
        const c = cadence('flex');
        if (c) tone.flex = c;
        break;
      }
      case 'mediant': {
        const c = cadence('mediant');
        if (c) tone.mediant = c;
        break;
      }
      case 'termination': {
        const c = cadence('termination');
        if (c) tone.termination = c;
        break;
      }
      case 'flexa':
      case 'metrum':
      case 'punctum':
      case 'question':
      case 'prefinal':
      case 'final': {
        if (/^none$/i.test(value)) {
          reading[readingKeys[key]] = null;
          break;
        }
        const c = cadence(key);
        if (c) reading[readingKeys[key]] = c;
        break;
      }
      default:
        errors.push(`Line ${i + 1}: unknown key "${key}"`);
    }
  });

  if (!tone.tenor) errors.push('Missing "tenor:" (the reciting note).');
  const hasReading = Object.keys(reading).length > 0 || Object.keys(readingByLanguage).length > 0;
  if (hasReading) tone.reading = reading;
  if (Object.keys(readingByLanguage).length > 0) tone.readingByLanguage = readingByLanguage;
  if (Object.keys(psalmByLanguage).length > 0) tone.psalmByLanguage = psalmByLanguage;
  if (!hasReading && (!tone.mediant || !tone.termination)) {
    errors.push('A psalm tone needs both "mediant:" and "termination:" (or use reading cadences).');
  }
  return errors.length ? { errors } : { tone, errors };
}

/** Resolve a reading cadence for a given language, falling back to the base cadence. */
export function getReadingCadence(
  tone: ToneDefinition,
  kind: ReadingCadenceKind,
  language: ChantLanguage = 'la'
): Cadence | null | undefined {
  const langMap = tone.readingByLanguage?.[language];
  if (langMap && Object.prototype.hasOwnProperty.call(langMap, kind)) {
    return langMap[kind];
  }
  return tone.reading?.[kind];
}

/** Resolve a psalm cadence (flex/mediant/termination) for a given language. */
export function getPsalmCadence(
  tone: ToneDefinition,
  kind: 'flex' | 'mediant' | 'termination',
  language: ChantLanguage = 'la'
): Cadence | undefined {
  return tone.psalmByLanguage?.[language]?.[kind] ?? tone[kind];
}

/**
 * Append `append` notes onto `base`, merging adjacent identical pitches
 * ("fg" + "g" -> "fg", "fg" + "f" -> "fgf") and keeping a trailing punctum
 * mora "." on the last note.
 */
export function mergeNeumeNotes(base: string, append: string): string {
  const baseDot = base.endsWith('.');
  const appendDot = append.endsWith('.');
  const baseCore = base.replace(/\.+$/, '');
  const appendCore = append.replace(/\.+$/, '');
  if (!baseCore) return append;
  if (!appendCore) return base;

  const lastPitchMatch = baseCore.match(/([a-mA-M])[^a-mA-M]*$/);
  const firstPitchMatch = appendCore.match(/^([^a-mA-M]*)([a-mA-M])(.*)$/);
  let combined: string;
  if (
    lastPitchMatch &&
    firstPitchMatch &&
    firstPitchMatch[1] === '' &&
    lastPitchMatch[1].toLowerCase() === firstPitchMatch[2].toLowerCase()
  ) {
    combined = baseCore + firstPitchMatch[3];
  } else {
    combined = baseCore + appendCore;
  }
  return baseDot || appendDot ? `${combined}.` : combined;
}

/**
 * Assign notes to the final syllables of `sylls` using a cadence, aligning the
 * last accent to the last stressed syllable and working backwards. Returns a
 * map syllable index -> GABC notes for the syllables the cadence covers.
 *
 * Post-accent slots: if the text has MORE unstressed syllables after the accent
 * than the cadence has slots (a proparoxytone ending), the extra syllables
 * repeat the first post-accent note (the "punctum cavum"); if it has fewer, the
 * last slots are used. When the final accent lands on the final syllable, the
 * segment's post-accent notes are folded onto that syllable's neume.
 */
export function applyCadence(
  sylls: ToneSyllable[],
  cadence: Cadence,
  end = sylls.length
): Map<number, string> {
  const notes = new Map<number, string>();

  if (cadence.positional) {
    // End-aligned: lay the slots on the last syllables, ignoring stress.
    const seg = cadence.segments[cadence.segments.length - 1];
    const slots = [...seg.prep, seg.accent, ...seg.post];
    const opt = Math.min(cadence.optional ?? 0, slots.length);
    for (let k = 0, i = end - 1; k < slots.length - opt && i >= 0; k++, i--) {
      notes.set(i, slots[slots.length - 1 - k]);
    }
    if (opt > 0) {
      const start = end - slots.length; // syllable index of the first slot
      const trigger = sylls[start + (cadence.optionalTrigger ?? 0)];
      if (trigger?.stressed) {
        for (let j = 0; j < opt; j++) if (start + j >= 0) notes.set(start + j, slots[j]);
      }
    }
    return notes;
  }

  let limit = end; // exclusive: syllables at index >= limit are already taken
  const floor = 0; // first index this cadence may use

  for (let s = cadence.segments.length - 1; s >= 0; s--) {
    const seg = cadence.segments[s];
    const P = seg.post.length;

    if (seg.optional) {
      // Optional leading segment: requires a real stressed syllable far enough
      // before the next segment (at least P post-accent syllables available).
      let accentIdx = -1;
      for (let i = limit - 1 - P; i >= floor; i--) {
        if (sylls[i].stressed) {
          accentIdx = i;
          break;
        }
      }
      if (accentIdx < 0 || accentIdx - seg.prep.length < floor) {
        continue;
      }
      notes.set(accentIdx, seg.accent);
      const Q = limit - 1 - accentIdx;
      if (P > 0 && Q > 0) {
        if (Q >= P) {
          const extras = Q - P;
          let idx = accentIdx + 1;
          for (let e = 0; e < extras; e++) notes.set(idx++, seg.post[0]);
          for (let p = 0; p < P; p++) notes.set(idx++, seg.post[p]);
        } else {
          const tail = seg.post.slice(P - Q);
          tail.forEach((n, k) => notes.set(accentIdx + 1 + k, n));
        }
      }
      let first = accentIdx;
      for (let p = seg.prep.length - 1, i = accentIdx - 1; p >= 0 && i >= floor; p--, i--) {
        if (p < (seg.condPrep ?? 0) && !sylls[i - 1]?.stressed) {
          i++;
          continue;
        }
        notes.set(i, seg.prep[p]);
        first = i;
      }
      limit = first;
      continue;
    }

    let accentIdx = -1;
    // A single-segment monotone-step cadence (no prep; accent and post notes all share one pitch,
    // e.g. Gospel `g* gr g.`) steps down on a final monosyllabic word as if it carries the accent.
    const basePitch = seg.accent.replace(/[^a-mA-M]/g, '').toLowerCase();
    const isMonotoneStep =
      cadence.segments.length === 1 &&
      !seg.optional &&
      seg.prep.length === 0 &&
      basePitch.length === 1 &&
      seg.post.every((p) => p.replace(/[^a-mA-M]/g, '').toLowerCase() === basePitch);
    const lastSyll = limit > floor ? sylls[limit - 1] : undefined;
    if (isMonotoneStep && lastSyll && lastSyll.wordStart && lastSyll.wordEnd) {
      accentIdx = limit - 1;
    } else {
      for (let i = limit - 1; i >= floor; i--) {
        if (sylls[i].stressed) {
          accentIdx = i;
          break;
        }
      }
    }
    if (accentIdx < 0) {
      // No stressed syllable available: fall back to the slot positions.
      accentIdx = Math.max(floor, limit - 1 - seg.post.length);
    }

    const Q = limit - 1 - accentIdx;
    if (Q === 0 && P > 0 && s === cadence.segments.length - 1) {
      // Final accent is the last syllable: fold post notes onto its neume (skipping cavum `r`).
      let folded = seg.accent;
      for (const postNote of seg.post) {
        folded = mergeNeumeNotes(folded, postNote.replace(/r/gi, ''));
      }
      notes.set(accentIdx, folded);
    } else {
      notes.set(accentIdx, seg.accent);
      if (Q > 0 && P > 0) {
        if (Q >= P) {
          const extras = Q - P;
          let idx = accentIdx + 1;
          for (let e = 0; e < extras; e++) notes.set(idx++, seg.post[0]);
          for (let p = 0; p < P; p++) notes.set(idx++, seg.post[p]);
        } else {
          const tail = seg.post.slice(P - Q);
          tail.forEach((n, k) => notes.set(accentIdx + 1 + k, n));
        }
      }
    }

    let first = accentIdx;
    for (let p = seg.prep.length - 1, i = accentIdx - 1; p >= 0 && i >= floor; p--, i--) {
      if (p < (seg.condPrep ?? 0) && !sylls[i - 1]?.stressed) {
        i++; // conditional slot not used here: the syllable keeps the tenor
        continue;
      }
      notes.set(i, seg.prep[p]);
      first = i;
    }
    limit = first;
  }
  return notes;
}

export interface EnglishPrefaceNotesResult {
  notes: Map<number, string>;
  tenor: string;
  warnings: string[];
}

/**
 * Assign notes to one English preface line according to its role
 * (`'h-metrum' | 'g-flex' | 'g-long'`).
 *
 * - `h-metrum`: intonation `f` on syllable 0, tenor `h`;
 *   - final syllable stressed: last 3 = `(hg|g) f g` (`hg` when first of the 3 is stressed)
 *   - penultimate stressed: last 4 = `g f fg g` (unconditional `g`)
 *   - other endings: fall back to legacy metrum (`?g gf fg* g`) and warn.
 * - `g-flex`: no intonation, tenor `g`, last 3 = `f g h`.
 * - `g-long`: no intonation, tenor `g`; let `A` = last stressed syllable:
 *   - `A < n - 1`: `A = fg`, `A+1..n-1 = f`; `A === n - 1`: `A = f`
 *   - `A - 1 = g`, `A - 2 = ef`
 *   - `A - 3 = fe`, or split `f` on `A - 4` + `e` on `A - 3` if `A - 4` is stressed.
 */
export function applyEnglishPrefaceRole(
  sylls: ToneSyllable[],
  role: EnglishPrefaceRole,
  fallbackTone?: ToneDefinition,
  phraseText?: string
): EnglishPrefaceNotesResult {
  const n = sylls.length;
  if (n === 0) {
    return {
      notes: new Map<number, string>(),
      tenor: role === 'h-metrum' ? fallbackTone?.tenor || 'h' : 'g',
      warnings: [],
    };
  }

  if (role === 'h-metrum') {
    const tenor = fallbackTone?.tenor || 'h';
    const intonationNote = fallbackTone?.intonation[0] || 'f';
    const notes = new Map<number, string>();

    let lastAccent = -1;
    for (let i = n - 1; i >= 0; i--) {
      if (sylls[i].stressed) {
        lastAccent = i;
        break;
      }
    }

    if (lastAccent === n - 1) {
      if (n >= 3) {
        notes.set(n - 3, sylls[n - 3].stressed ? 'hg' : 'g');
        notes.set(n - 2, 'f');
        notes.set(n - 1, 'g');
      } else if (n === 2) {
        notes.set(0, 'f');
        notes.set(1, 'g');
      } else {
        notes.set(0, 'g');
      }
      if (!notes.has(0)) notes.set(0, intonationNote);
      return { notes, tenor, warnings: [] };
    }

    if (lastAccent === n - 2) {
      notes.set(n - 1, 'g');
      notes.set(n - 2, 'fg');
      if (n - 3 >= 0) notes.set(n - 3, 'f');
      if (n - 4 >= 0) notes.set(n - 4, 'g');
      if (!notes.has(0)) notes.set(0, intonationNote);
      return { notes, tenor, warnings: [] };
    }

    const legacyCadence =
      (fallbackTone ? getReadingCadence(fallbackTone, 'metrum', 'la') : null) ??
      parseCadence('?g gf fg* g')!;
    const legacyNotes = applyCadence(sylls, legacyCadence);
    if (!legacyNotes.has(0)) legacyNotes.set(0, intonationNote);
    const label = phraseText ?? sylls.map((s) => s.text).join('');
    return {
      notes: legacyNotes,
      tenor,
      warnings: [
        `English h-metrum cadence for "${label}" has an ending not covered by the Passion I fixture; fell back to legacy metrum.`,
      ],
    };
  }

  if (role === 'g-flex') {
    const notes = new Map<number, string>();
    if (n >= 3) {
      notes.set(n - 3, 'f');
      notes.set(n - 2, 'g');
      notes.set(n - 1, 'h');
    } else if (n === 2) {
      notes.set(0, 'g');
      notes.set(1, 'h');
    } else {
      notes.set(0, 'h');
    }
    return { notes, tenor: 'g', warnings: [] };
  }

  // g-long
  const notes = new Map<number, string>();
  let accentIdx = -1;
  for (let i = n - 1; i >= 0; i--) {
    if (sylls[i].stressed) {
      accentIdx = i;
      break;
    }
  }

  if (accentIdx < 0) {
    const legacyCadence =
      (fallbackTone
        ? getReadingCadence(fallbackTone, 'punctum', 'en') ??
          getReadingCadence(fallbackTone, 'punctum', 'la')
        : null) ?? parseCadence('recite=g; fe* ef g / fg* f')!;
    const legacyNotes = applyCadence(sylls, legacyCadence);
    const label = phraseText ?? sylls.map((s) => s.text).join('');
    return {
      notes: legacyNotes,
      tenor: legacyCadence.recite ?? 'g',
      warnings: [
        `English g-long cadence for "${label}" has no stressed syllable; fell back to legacy cadence.`,
      ],
    };
  }

  if (accentIdx < n - 1) {
    notes.set(accentIdx, 'fg');
    for (let k = accentIdx + 1; k < n; k++) notes.set(k, 'f');
  } else {
    notes.set(accentIdx, 'f');
  }

  if (accentIdx - 1 >= 0) notes.set(accentIdx - 1, 'g');
  if (accentIdx - 2 >= 0) notes.set(accentIdx - 2, 'ef');
  if (accentIdx - 3 >= 0) {
    if (accentIdx - 4 >= 0 && sylls[accentIdx - 4].stressed) {
      notes.set(accentIdx - 4, 'f');
      notes.set(accentIdx - 3, 'e');
    } else {
      notes.set(accentIdx - 3, 'fe');
    }
  }

  return { notes, tenor: 'g', warnings: [] };
}

