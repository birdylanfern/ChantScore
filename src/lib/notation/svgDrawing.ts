import { AccidentalType, ClefType, DivisionType, NoteShape } from '@/src/types/chant';
import { parseClefConfig } from '@/src/lib/gabc/pitch';
import { GRECILIAE_GLYPHS, GreciliaeGlyphDef } from './greciliaeGlyphs';
import {
  GroupLayout,
  NOTE_H,
  NOTE_W,
  pitchToY,
  PositionedNote,
  STAFF_HALF_STEP,
  STAFF_HEIGHT,
  STAFF_LINE_SPACING,
} from './layoutEngine';

export const INK_BLACK = '#151210';
export const STAFF_LINE_INK = '#3A332C';
export const RUBRIC_RED = '#9E1B1E';

const NOTE_SCALE = NOTE_W / 100; // 0.092 -> 100 font units = 9.2px
const CLEF_SCALE = 0.105;
const ACC_SCALE = 0.092;

function renderGlyph(
  glyph: GreciliaeGlyphDef,
  x: number,
  cy: number,
  scale: number,
  color: string,
  extraWidth = NOTE_W
): string {
  let tx = x;
  if (glyph.align === 'center') {
    tx = x + extraWidth / 2;
  } else if (glyph.align === 'right') {
    tx = x + extraWidth;
  }
  const fillRule = glyph.evenOdd ? ' fill-rule="evenodd"' : '';
  return `<path d="${glyph.d}" transform="translate(${tx}, ${cy}) scale(${scale})" fill="${color}"${fillRule} />`;
}

export function porrectusRibbonPath(
  x0: number,
  cy0: number,
  x1: number,
  cy1: number
): string {
  const halfH = 5.0;
  const rightX = x1 + NOTE_W;
  const dx = rightX - x0;
  const dy = cy1 - cy0;
  return [
    `M ${x0} ${cy0 - halfH}`,
    `C ${x0 + dx * 0.36} ${cy0 - halfH + dy * 0.14}, ${x0 + dx * 0.64} ${cy1 - halfH - dy * 0.14}, ${rightX} ${cy1 - halfH}`,
    `L ${rightX} ${cy1 + halfH}`,
    `C ${x0 + dx * 0.64} ${cy1 + halfH - dy * 0.14}, ${x0 + dx * 0.36} ${cy0 + halfH + dy * 0.14}, ${x0} ${cy0 + halfH}`,
    'Z',
  ].join(' ');
}

export function renderAccidentalMarkup(
  type: AccidentalType,
  x: number,
  cy: number,
  color: string
): string {
  if (type === 'flat') return renderGlyph(GRECILIAE_GLYPHS.Flat, x, cy, ACC_SCALE, color, 0);
  if (type === 'natural') return renderGlyph(GRECILIAE_GLYPHS.Natural, x, cy, ACC_SCALE, color, 0);
  if (type === 'sharp') return renderGlyph(GRECILIAE_GLYPHS.Sharp, x, cy, 0.082, color, 0);
  return '';
}

export function renderCustosMarkup(
  x: number,
  cy: number,
  pitch: number,
  color = INK_BLACK
): string {
  const glyph = pitch >= 8 ? GRECILIAE_GLYPHS.CustosDescLong : GRECILIAE_GLYPHS.CustosLong;
  return renderGlyph(glyph, x, cy, 0.094, color, 0);
}

export function renderClefElements(
  clef: ClefType,
  x: number,
  staffTopY: number,
  color = INK_BLACK
): string {
  const cfg = parseClefConfig(clef);
  const cy = pitchToY(cfg.pitchIndex, staffTopY);
  const parts: string[] = [];

  if (cfg.clefType === 'c') {
    parts.push(renderGlyph(GRECILIAE_GLYPHS.DoClef, x, cy, CLEF_SCALE, color, 0));
  } else {
    parts.push(renderGlyph(GRECILIAE_GLYPHS.FaClef, x, cy, CLEF_SCALE, color, 0));
  }

  if (cfg.hasFlatSignature) {
    const bPitch = cfg.pitchIndex - 1;
    const by = pitchToY(bPitch, staffTopY);
    const flatOffset = cfg.clefType === 'c' ? 13.5 : 22.5;
    parts.push(renderGlyph(GRECILIAE_GLYPHS.Flat, x + flatOffset, by, ACC_SCALE, color, 0));
  }

  return parts.join('');
}

export function renderDivisionElements(
  division: DivisionType,
  x: number,
  staffTopY: number,
  color = INK_BLACK
): string {
  if (division === ',') {
    const y1 = staffTopY - 4.5;
    const y2 = staffTopY + 7;
    return `<line x1="${x + 5}" y1="${y1}" x2="${x + 5}" y2="${y2}" stroke="${color}" stroke-width="1.25" stroke-linecap="round" />`;
  }
  if (division === ';') {
    const y1 = staffTopY + STAFF_LINE_SPACING * 0.65;
    const y2 = staffTopY + STAFF_LINE_SPACING * 2.35;
    return `<line x1="${x + 5}" y1="${y1}" x2="${x + 5}" y2="${y2}" stroke="${color}" stroke-width="1.25" stroke-linecap="round" />`;
  }
  if (division === ':') {
    return `<line x1="${x + 5}" y1="${staffTopY}" x2="${x + 5}" y2="${staffTopY + STAFF_HEIGHT}" stroke="${color}" stroke-width="1.35" />`;
  }
  // '::'
  return `<line x1="${x + 3.2}" y1="${staffTopY}" x2="${x + 3.2}" y2="${staffTopY + STAFF_HEIGHT}" stroke="${color}" stroke-width="1.35" /><line x1="${x + 8.4}" y1="${staffTopY}" x2="${x + 8.4}" y2="${staffTopY + STAFF_HEIGHT}" stroke="${color}" stroke-width="1.85" />`;
}

function selectNoteGlyph(
  pn: PositionedNote
): { glyph: GreciliaeGlyphDef; scale: number; builtInRightStem: boolean } {
  const shape: NoteShape = pn.note.shape;
  const liq = !!pn.note.liquescent;

  if (shape === 'diamond') {
    return {
      glyph: liq ? GRECILIAE_GLYPHS.PunctumInclinatumLiquescent : GRECILIAE_GLYPHS.PunctumInclinatum,
      scale: NOTE_SCALE * 0.94,
      builtInRightStem: false,
    };
  }
  if (shape === 'quilisma') {
    return { glyph: GRECILIAE_GLYPHS.Quilisma, scale: NOTE_SCALE, builtInRightStem: false };
  }
  if (shape === 'oriscus') {
    return { glyph: GRECILIAE_GLYPHS.OriscusAsc, scale: NOTE_SCALE, builtInRightStem: false };
  }
  if (shape === 'stropha') {
    return {
      glyph: liq ? GRECILIAE_GLYPHS.StrophaLiquescent : GRECILIAE_GLYPHS.Stropha,
      scale: NOTE_SCALE,
      builtInRightStem: false,
    };
  }
  if (shape === 'virga') {
    return {
      glyph: GRECILIAE_GLYPHS.VirgaLong,
      scale: NOTE_SCALE,
      builtInRightStem: true,
    };
  }
  if (pn.connectToNext === 'podatus') {
    return {
      glyph: pn.compactHeight ? GRECILIAE_GLYPHS.PodatusLowerShort : GRECILIAE_GLYPHS.PodatusLower,
      scale: NOTE_SCALE,
      builtInRightStem: false,
    };
  }
  if (pn.isPodatusUpper && !liq) {
    return {
      glyph: pn.compactHeight ? GRECILIAE_GLYPHS.PodatusUpperShort : GRECILIAE_GLYPHS.PodatusUpper,
      scale: NOTE_SCALE,
      builtInRightStem: false,
    };
  }
  if (liq) {
    const asc = pn.isPodatusUpper || pn.note.liquescentDir === 'asc';
    return {
      glyph: asc
        ? GRECILIAE_GLYPHS.PunctumQuadratumAscLiquescent
        : GRECILIAE_GLYPHS.PunctumQuadratumDesLiquescent,
      scale: NOTE_SCALE,
      builtInRightStem: false,
    };
  }
  return {
    glyph: GRECILIAE_GLYPHS.PunctumQuadratum,
    scale: NOTE_SCALE,
    builtInRightStem: false,
  };
}

export function renderGroupSvgMarkup(
  groupLayout: GroupLayout,
  baseX: number,
  staffTopY: number,
  color = INK_BLACK
): string {
  const parts: string[] = [];
  const pNotes = groupLayout.notes;

  for (let idx = 0; idx < pNotes.length; idx++) {
    const pn: PositionedNote = pNotes[idx];
    const nx = baseX + pn.x;
    const cy = staffTopY + pn.yOffset;

    // Ledger lines if pitch <= 1 ('b','a') or >= 11 ('l','m') on actual noteheads
    if (!pn.note.accidentalOnly && !pn.hiddenHead) {
      if (pn.note.pitch <= 1) {
        const ly = pitchToY(1, staffTopY);
        parts.push(
          `<line x1="${nx - 3.2}" y1="${ly}" x2="${nx + NOTE_W + 3.2}" y2="${ly}" stroke="${STAFF_LINE_INK}" stroke-opacity="0.78" stroke-width="0.9" />`
        );
      }
      if (pn.note.pitch >= 11) {
        const ly = pitchToY(11, staffTopY);
        parts.push(
          `<line x1="${nx - 3.2}" y1="${ly}" x2="${nx + NOTE_W + 3.2}" y2="${ly}" stroke="${STAFF_LINE_INK}" stroke-opacity="0.78" stroke-width="0.9" />`
        );
      }
    }

    if (pn.note.accidental && pn.accidentalX !== undefined) {
      parts.push(renderAccidentalMarkup(pn.note.accidental, baseX + pn.accidentalX, cy, color));
    }

    if (
      pn.connectToNext === 'porrectus' &&
      pn.porrectusNextPitch !== undefined &&
      idx + 1 < pNotes.length
    ) {
      const nextPn = pNotes[idx + 1];
      const nextCy = staffTopY + nextPn.yOffset;
      parts.push(`<path d="${porrectusRibbonPath(nx, cy, baseX + nextPn.x, nextCy)}" fill="${color}" />`);
      if (pn.hasLeftStem) {
        parts.push(`<rect x="${nx}" y="${cy}" width="1.0" height="${pn.stemHeight || 18.5}" fill="${color}" />`);
      }
      continue;
    }

    if (pn.hiddenHead) continue;

    const { glyph, scale, builtInRightStem } = selectNoteGlyph(pn);
    parts.push(renderGlyph(glyph, nx, cy, scale, color, NOTE_W));

    if (pn.hasLeftStem) {
      parts.push(
        `<rect x="${nx}" y="${cy}" width="1.0" height="${pn.stemHeight || 18.5}" fill="${color}" />`
      );
    }
    if (pn.hasRightStem && !builtInRightStem) {
      const stemH = pn.stemHeight || 18.5;
      parts.push(
        `<rect x="${nx + NOTE_W - 0.95}" y="${cy}" width="0.95" height="${stemH}" fill="${color}" />`
      );
    }
    if ((pn.connectToNext === 'podatus' || pn.connectToNext === 'quilisma-pes') && idx + 1 < pNotes.length) {
      const nextCy = staffTopY + pNotes[idx + 1].yOffset;
      parts.push(
        `<rect x="${nx + NOTE_W - 0.95}" y="${nextCy}" width="0.95" height="${Math.max(4, cy - nextCy)}" fill="${color}" />`
      );
    }
    if (
      (pn.connectToNext === 'clivis' ||
        pn.connectToNext === 'torculus-down' ||
        pn.connectToNext === 'torculus-up') &&
      idx + 1 < pNotes.length
    ) {
      const nextPn = pNotes[idx + 1];
      const nextCy = staffTopY + nextPn.yOffset;
      parts.push(
        `<line x1="${nx + NOTE_W - 0.5}" y1="${cy}" x2="${baseX + nextPn.x + 0.5}" y2="${nextCy}" stroke="${color}" stroke-width="1.05" />`
      );
    }

    if (pn.moraX !== undefined && pn.moraYOffset !== undefined) {
      const mx = baseX + pn.moraX;
      const my = staffTopY + pn.moraYOffset;
      parts.push(
        `<path d="${GRECILIAE_GLYPHS.Mora.d}" transform="translate(${mx - 48 * 0.088}, ${my}) scale(0.088)" fill="${color}" />`
      );
    }

    if (pn.note.episemaH && !pn.skipEpisemaH) {
      const hOffset = (pn.compactHeight ? 7.8 : NOTE_H) / 2 + 4.0;
      const ey = pn.episemaBelow ? cy + hOffset : cy - hOffset;
      const spanStart = pn.episemaSpanStartX !== undefined ? baseX + pn.episemaSpanStartX : nx;
      const spanEnd =
        pn.episemaSpanEndX !== undefined ? baseX + pn.episemaSpanEndX : nx + NOTE_W;
      parts.push(
        `<rect x="${spanStart - 0.3}" y="${ey - 0.8}" width="${spanEnd - spanStart + 0.6}" height="1.6" rx="0.65" fill="${color}" />`
      );
    }

    if (pn.note.episemaV) {
      const hOffset = (pn.compactHeight ? 7.8 : NOTE_H) / 2 + 2.2;
      if (pn.episemaVAbove) {
        const iy = cy - hOffset;
        parts.push(
          `<path d="${GRECILIAE_GLYPHS.VerticalEpisemaAbove.d}" transform="translate(${nx + NOTE_W / 2}, ${iy}) scale(${NOTE_SCALE})" fill="${color}" />`
        );
      } else {
        const iy = cy + hOffset;
        parts.push(
          `<path d="${GRECILIAE_GLYPHS.VerticalEpisemaBelow.d}" transform="translate(${nx + NOTE_W / 2}, ${iy}) scale(${NOTE_SCALE})" fill="${color}" />`
        );
      }
    }
  }

  return parts.join('');
}

export function getStaffLineYs(staffTopY: number): number[] {
  return [
    staffTopY,
    staffTopY + STAFF_LINE_SPACING,
    staffTopY + STAFF_LINE_SPACING * 2,
    staffTopY + STAFF_LINE_SPACING * 3,
  ];
}

export { STAFF_HALF_STEP, STAFF_HEIGHT, STAFF_LINE_SPACING, NOTE_W, NOTE_H };
