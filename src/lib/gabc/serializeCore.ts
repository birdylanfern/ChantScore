import { ChantNote, ChantScore, ClefItem, DivisionItem, NeumeGroup, SyllableItem } from '@/src/types/chant';
import { pitchIndexToChar } from './pitch';

/** The only text colour GABC can express (`<c>…</c>`, rubric red). */
export const RUBRIC_COLOR = '#8B1E24';

export function serializeNoteModifiers(note: ChantNote): string {
  let out = '';
  if (note.shape === 'virga') out += 'v';
  else if (note.shape === 'virgaLeft') out += 'V';
  else if (note.shape === 'quilisma') out += 'w';
  else if (note.shape === 'oriscus') out += 'o';
  else if (note.shape === 'stropha') out += 's';

  if (note.liquescent) {
    if (note.liquescentDir === 'desc') out += '>';
    else if (note.liquescentDir === 'asc') out += '<';
    else out += '~';
  }
  if (note.episemaH) out += '_';
  if (note.episemaV) out += "'";
  if (note.mora) out += '.';
  return out;
}

export function serializeNoteString(note: ChantNote): string {
  const baseChar = pitchIndexToChar(note.pitch);

  if (note.accidentalOnly) {
    if (note.accidental === 'flat') return `${baseChar}x`;
    if (note.accidental === 'natural') return `${baseChar}y`;
    if (note.accidental === 'sharp') return `${baseChar}#`;
  }

  let prefix = '';
  if (note.accidental === 'flat') prefix = `${baseChar}x`;
  else if (note.accidental === 'natural') prefix = `${baseChar}y`;
  else if (note.accidental === 'sharp') prefix = `${baseChar}#`;

  const head = note.shape === 'diamond' ? baseChar.toUpperCase() : baseChar;
  return `${prefix}${head}${serializeNoteModifiers(note)}`;
}

export function serializeGroupWithOffsets(
  group: NeumeGroup
): { text: string; noteRanges: { noteId: string; start: number; end: number }[] } {
  const parts: string[] = [];
  const noteRanges: { noteId: string; start: number; end: number }[] = [];
  let cursor = 0;

  for (let i = 0; i < group.notes.length; i++) {
    const note = group.notes[i];
    const prev = i > 0 ? group.notes[i - 1] : null;
    const piece =
      prev &&
      prev.shape === 'stropha' &&
      note.shape === 'stropha' &&
      prev.pitch === note.pitch &&
      !note.accidental &&
      !note.accidentalOnly &&
      !prev.accidentalOnly &&
      !prev.mora &&
      !prev.episemaH &&
      !prev.episemaV
        ? serializeNoteModifiers(note)
        : serializeNoteString(note);
    noteRanges.push({ noteId: note.id, start: cursor, end: cursor + piece.length });
    parts.push(piece);
    cursor += piece.length;
  }
  return { text: parts.join(''), noteRanges };
}

/** Serialized neume text for a syllable's groups (empty groups skipped, joined by '/'). */
export function serializeGroupsText(groups: NeumeGroup[]): string {
  return groups
    .filter((g) => g.notes.length > 0)
    .map((g) => serializeGroupWithOffsets(g).text)
    .join('/');
}

/** Stable signature of the editable lyric state (text plus colour information). */
export function lyricSignature(item: {
  lyric?: string;
  lyricColor?: string;
  lyricSpans?: { start: number; end: number; color: string }[];
}): string {
  return JSON.stringify([item.lyric ?? '', item.lyricColor ?? null, item.lyricSpans ?? null]);
}

function wrapRubricSpans(text: string, spans?: { start: number; end: number; color: string }[]): string {
  if (!spans || spans.length === 0) return text;
  const rubric = spans
    .filter((s) => s.color.toUpperCase() === RUBRIC_COLOR && s.end > s.start)
    .sort((a, b) => a.start - b.start);
  let out = '';
  let cursor = 0;
  for (const s of rubric) {
    if (s.start < cursor) continue;
    out += text.slice(cursor, s.start) + '<c>' + text.slice(s.start, s.end) + '</c>';
    cursor = s.end;
  }
  return out + text.slice(cursor);
}

type LyricCarrier = SyllableItem | DivisionItem;

/** GABC text for the part of a token that precedes the parenthesis. */
export function lyricToGabc(item: LyricCarrier): string {
  const raw = item.raw;
  if (raw && raw.lyric !== undefined && raw.lyricSig === lyricSignature(item)) {
    return raw.lyric;
  }
  const text = item.lyric ?? '';
  if (!text) return '';
  if (item.lyricColor && item.lyricColor.toUpperCase() === RUBRIC_COLOR) return `<c>${text}</c>`;
  if (item.kind === 'syllable') return wrapRubricSpans(text, item.lyricSpans);
  return text;
}

export function clefUsesRaw(item: ClefItem): boolean {
  return !!item.raw && item.raw.bodySig === item.clef;
}

export function divisionUsesRaw(item: DivisionItem): boolean {
  return !!item.raw && item.raw.bodySig === item.division;
}

export function syllableUsesRawBody(item: SyllableItem): boolean {
  return !!item.raw && item.raw.bodySig === serializeGroupsText(item.groups);
}

export function headerLines(score: ChantScore): string[] {
  const h = score.header;
  const lines: string[] = [`name: ${h.name || 'Untitled Chant'};`];
  if (h.officePart) lines.push(`office-part: ${h.officePart};`);
  if (h.mode) lines.push(`mode: ${h.mode};`);
  if (h.annotation) lines.push(`annotation: ${h.annotation};`);
  for (const extra of h.annotationExtra || []) {
    if (extra) lines.push(`annotation: ${extra};`);
  }
  lines.push(`initial-style: ${h.initialStyle || '1'};`);
  for (const [k, v] of Object.entries(h.extraHeaders || {})) {
    if (v) lines.push(`${k}: ${v};`);
  }
  lines.push('%%');
  return lines;
}
