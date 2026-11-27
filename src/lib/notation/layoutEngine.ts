import {
  ChantNote,
  ChantScore,
  ClefType,
  DivisionType,
  ModifierPresetId,
  NeumeGroup,
  NeumePresetId,
  ScoreItem,
  WordSpacingPreset,
} from '@/src/types/chant';
import { NEUME_PRESET_TEMPLATES } from '@/src/lib/gabc/pitch';
import { getWordSpacingGaps, isValidWordSpacing } from '@/src/lib/typography';

export const STAFF_LINE_SPACING = 14; // 4 lines -> 42px staff height
export const STAFF_HALF_STEP = 7;
export const STAFF_HEIGHT = STAFF_LINE_SPACING * 3; // 42px
export const NOTE_W = 9.2;
export const NOTE_H = 11.1;

export function pitchToY(pitch: number, staffTopY: number): number {
  return staffTopY + (9 - pitch) * STAFF_HALF_STEP;
}

export function yToPitch(y: number, staffTopY: number): number {
  const raw = Math.round(9 - (y - staffTopY) / STAFF_HALF_STEP);
  return Math.max(0, Math.min(12, raw));
}

export interface PositionedNote {
  note: ChantNote;
  x: number; // local X inside group (left edge of notehead)
  yOffset: number; // relative to staffTopY
  compactHeight?: boolean; // used when notes are 1 step apart in a podatus
  accidentalX?: number;
  moraX?: number;
  moraYOffset?: number;
  hasLeftStem?: boolean;
  hasRightStem?: boolean;
  stemDown?: boolean;
  stemHeight?: number;
  connectToNext?:
    | 'podatus'
    | 'clivis'
    | 'torculus-up'
    | 'torculus-down'
    | 'porrectus'
    | 'quilisma-pes';
  porrectusNextPitch?: number;
  hiddenHead?: boolean;
  episemaBelow?: boolean;
  episemaVAbove?: boolean;
  episemaSpanStartX?: number;
  episemaSpanEndX?: number;
  skipEpisemaH?: boolean;
  isPodatusUpper?: boolean;
}

export interface GroupLayout {
  group: NeumeGroup;
  width: number;
  notes: PositionedNote[];
}

function getMoraPosition(
  note: ChantNote,
  x: number,
  yOffset: number
): { moraX?: number; moraYOffset?: number } {
  if (!note.mora) return {};
  // If pitch is on a line (3,5,7,9), nudge dot slightly into adjacent space for legibility
  const onLine = note.pitch % 2 === 1;
  return {
    moraX: x + NOTE_W + 4.5,
    moraYOffset: onLine ? yOffset - 3.3 : yOffset,
  };
}

function getTwoNoteMoraPositions(
  upper: ChantNote,
  upperY: number,
  lower: ChantNote,
  lowerY: number,
  moraRightBaseX: number
): {
  upperMora: { moraX?: number; moraYOffset?: number };
  lowerMora: { moraX?: number; moraYOffset?: number };
} {
  const stepDiff = upper.pitch - lower.pitch;
  const upperOnLine = upper.pitch % 2 === 1;
  const lowerOnLine = lower.pitch % 2 === 1;

  let upperYOffset = upperOnLine ? upperY - 3.4 : upperY;
  let lowerYOffset = lowerOnLine ? lowerY - 3.4 : lowerY;

  // When both notes have moras and sit 1 step apart, avoid placing both dots in the same space
  if (upper.mora && lower.mora && stepDiff === 1) {
    if (lowerOnLine) {
      // upper is in the space directly above lower -> nudge lower dot DOWN into the space below
      lowerYOffset = lowerY + 3.4;
    } else if (upperOnLine) {
      // upper is on line, lower is in space below -> nudge upper dot UP (already upperY - 3.4)
      upperYOffset = upperY - 3.4;
    }
  } else if (lower.mora && !upper.mora && stepDiff === 1 && lowerOnLine) {
    // Keep lower dot legible without colliding with upper notehead
    lowerYOffset = lowerY + 3.4;
  }

  return {
    upperMora: upper.mora
      ? { moraX: moraRightBaseX + NOTE_W + 4.5, moraYOffset: upperYOffset }
      : {},
    lowerMora: lower.mora
      ? { moraX: moraRightBaseX + NOTE_W + 4.5, moraYOffset: lowerYOffset }
      : {},
  };
}

export function layoutNeumeGroup(group: NeumeGroup): GroupLayout {
  const notes = group.notes;
  const positioned: PositionedNote[] = [];
  let cursorX = 0;
  let i = 0;

  while (i < notes.length) {
    const n0 = notes[i];
    const n1 = i + 1 < notes.length ? notes[i + 1] : null;
    const n2 = i + 2 < notes.length ? notes[i + 2] : null;

    // Standalone accidental glyph (GABC ix / iy / i#): reserve accidental slot, no notehead
    if (n0.accidentalOnly) {
      const y0 = (9 - n0.pitch) * STAFF_HALF_STEP;
      positioned.push({
        note: n0,
        x: cursorX,
        yOffset: y0,
        accidentalX: cursorX,
        hiddenHead: true,
      });
      cursorX += 11.0;
      i += 1;
      continue;
    }

    if (n0.accidental) {
      cursorX += 11.5;
    }
    const accX = n0.accidental ? cursorX - 10.5 : undefined;

    // 1. Porrectus (3 notes: down then up, standard puncta)
    if (
      n1 &&
      n2 &&
      n0.shape === 'punctum' &&
      n1.shape === 'punctum' &&
      n2.shape === 'punctum' &&
      !n0.mora &&
      !n1.mora &&
      !n1.accidental &&
      !n2.accidental &&
      n0.pitch > n1.pitch &&
      n1.pitch < n2.pitch
    ) {
      const x0 = cursorX;
      const x1 = cursorX + 16;
      const y0 = (9 - n0.pitch) * STAFF_HALF_STEP;
      const y1 = (9 - n1.pitch) * STAFF_HALF_STEP;
      const y2 = (9 - n2.pitch) * STAFF_HALF_STEP;
      const spanUp = (n2.pitch - n1.pitch) * STAFF_HALF_STEP;

      positioned.push({
        note: n0,
        x: x0,
        yOffset: y0,
        accidentalX: accX,
        hasLeftStem: true,
        stemDown: true,
        stemHeight: 18.5,
        connectToNext: 'porrectus',
        porrectusNextPitch: n1.pitch,
        hiddenHead: true,
      });
      positioned.push({
        note: n1,
        x: x1,
        yOffset: y1,
        hiddenHead: true,
      });
      const mora = getMoraPosition(n2, x1, y2);
      positioned.push({
        note: n2,
        x: x1,
        yOffset: y2,
        compactHeight: n2.pitch - n1.pitch === 1,
        isPodatusUpper: true,
        hasRightStem: true,
        stemDown: true,
        stemHeight: Math.max(12, spanUp + 2),
        ...mora,
      });
      cursorX = x1 + NOTE_W + (n2.mora ? 9.5 : 2.5);
      i += 3;
      continue;
    }

    // 2. Torculus (3 notes: up then down, standard puncta -> connected arch)
    if (
      n1 &&
      n2 &&
      n0.shape === 'punctum' &&
      n1.shape === 'punctum' &&
      n2.shape === 'punctum' &&
      !n0.mora &&
      !n1.accidental &&
      !n2.accidental &&
      n0.pitch < n1.pitch &&
      n1.pitch > n2.pitch
    ) {
      const x0 = cursorX;
      const x1 = cursorX + NOTE_W - 0.8;
      const x2 = x1 + NOTE_W - 0.8;
      const y0 = (9 - n0.pitch) * STAFF_HALF_STEP;
      const y1 = (9 - n1.pitch) * STAFF_HALF_STEP;
      const y2 = (9 - n2.pitch) * STAFF_HALF_STEP;

      const allH = !!(n0.episemaH && n1.episemaH && n2.episemaH);
      const firstTwoH = !allH && !!(n0.episemaH && n1.episemaH);
      const lastTwoH = !allH && !!(n1.episemaH && n2.episemaH);

      const { upperMora: n1Mora, lowerMora: n2Mora } = getTwoNoteMoraPositions(n1, y1, n2, y2, x2);

      positioned.push({
        note: n0,
        x: x0,
        yOffset: y0,
        accidentalX: accX,
        connectToNext: 'torculus-up',
        episemaBelow: true,
        skipEpisemaH: allH || firstTwoH,
      });
      positioned.push({
        note: n1,
        x: x1,
        yOffset: y1,
        connectToNext: 'torculus-down',
        episemaSpanStartX: allH || firstTwoH ? x0 : lastTwoH ? x1 : undefined,
        episemaSpanEndX: allH || lastTwoH ? x2 + NOTE_W : firstTwoH ? x1 + NOTE_W : undefined,
        ...n1Mora,
      });
      positioned.push({
        note: n2,
        x: x2,
        yOffset: y2,
        episemaBelow: n1.pitch - n2.pitch === 1,
        skipEpisemaH: allH || lastTwoH,
        ...n2Mora,
      });

      cursorX = x2 + NOTE_W + (n1.mora || n2.mora ? 9.5 : 2.5);
      i += 3;
      continue;
    }

    // 3. Scandicus (3 ascending puncta -> punctum + stacked podatus)
    if (
      n1 &&
      n2 &&
      n0.shape === 'punctum' &&
      n1.shape === 'punctum' &&
      n2.shape === 'punctum' &&
      !n0.mora &&
      !n1.mora &&
      !n1.accidental &&
      !n2.accidental &&
      n0.pitch < n1.pitch &&
      n1.pitch < n2.pitch
    ) {
      const x0 = cursorX;
      const x1 = cursorX + NOTE_W + 0.5;
      const y0 = (9 - n0.pitch) * STAFF_HALF_STEP;
      const y1 = (9 - n1.pitch) * STAFF_HALF_STEP;
      const y2 = (9 - n2.pitch) * STAFF_HALF_STEP;
      const closeStep = n2.pitch - n1.pitch === 1;
      const podatusBothH = !!(n1.episemaH && n2.episemaH);

      positioned.push({
        note: n0,
        x: x0,
        yOffset: y0,
        accidentalX: accX,
      });
      positioned.push({
        note: n1,
        x: x1,
        yOffset: y1,
        compactHeight: closeStep,
        connectToNext: 'podatus',
        episemaBelow: true,
        skipEpisemaH: podatusBothH,
      });
      const mora = getMoraPosition(n2, x1, y2);
      positioned.push({
        note: n2,
        x: x1,
        yOffset: y2,
        compactHeight: closeStep,
        isPodatusUpper: true,
        hasRightStem: true,
        stemDown: true,
        stemHeight: (n2.pitch - n1.pitch) * STAFF_HALF_STEP,
        ...mora,
      });
      cursorX = x1 + NOTE_W + (n2.mora ? 9.5 : 2.5);
      i += 3;
      continue;
    }

    // 4. Podatus / Pes (2 ascending puncta, supports moras on one or both notes)
    if (
      n1 &&
      n0.shape === 'punctum' &&
      n1.shape === 'punctum' &&
      !n1.accidental &&
      n0.pitch < n1.pitch
    ) {
      const x = cursorX;
      const y0 = (9 - n0.pitch) * STAFF_HALF_STEP;
      const y1 = (9 - n1.pitch) * STAFF_HALF_STEP;
      const span = (n1.pitch - n0.pitch) * STAFF_HALF_STEP;
      const closeStep = n1.pitch - n0.pitch === 1;
      const bothH = !!(n0.episemaH && n1.episemaH);
      const { upperMora: n1Mora, lowerMora: n0Mora } = getTwoNoteMoraPositions(n1, y1, n0, y0, x);

      positioned.push({
        note: n0,
        x,
        yOffset: y0,
        compactHeight: closeStep,
        accidentalX: accX,
        connectToNext: 'podatus',
        episemaBelow: true,
        skipEpisemaH: bothH,
        ...n0Mora,
      });
      positioned.push({
        note: n1,
        x,
        yOffset: y1,
        compactHeight: closeStep,
        isPodatusUpper: true,
        hasRightStem: true,
        stemDown: true,
        stemHeight: span,
        ...n1Mora,
      });
      cursorX = x + NOTE_W + (n0.mora || n1.mora ? 9.5 : 2.5);
      i += 2;
      continue;
    }

    // 4b. Quilisma-Pes (quilisma ascending into punctum)
    if (
      n1 &&
      n0.shape === 'quilisma' &&
      n1.shape === 'punctum' &&
      !n0.mora &&
      !n1.accidental &&
      n0.pitch < n1.pitch
    ) {
      const x0 = cursorX;
      const x1 = cursorX + NOTE_W - 0.8;
      const y0 = (9 - n0.pitch) * STAFF_HALF_STEP;
      const y1 = (9 - n1.pitch) * STAFF_HALF_STEP;
      const bothH = !!(n0.episemaH && n1.episemaH);
      const mora = getMoraPosition(n1, x1, y1);

      positioned.push({
        note: n0,
        x: x0,
        yOffset: y0,
        accidentalX: accX,
        connectToNext: 'quilisma-pes',
        episemaBelow: true,
        skipEpisemaH: bothH,
      });
      positioned.push({
        note: n1,
        x: x1,
        yOffset: y1,
        episemaSpanStartX: bothH ? x0 : undefined,
        episemaSpanEndX: bothH ? x1 + NOTE_W : undefined,
        ...mora,
      });
      cursorX = x1 + NOTE_W + (n1.mora ? 9.5 : 2.5);
      i += 2;
      continue;
    }

    // 5. Clivis (2 descending puncta, supports moras on one or both notes e.g. f.e. / fe..)
    if (
      n1 &&
      n0.shape === 'punctum' &&
      n1.shape === 'punctum' &&
      !n1.accidental &&
      n0.pitch > n1.pitch
    ) {
      const x0 = cursorX;
      const x1 = cursorX + NOTE_W - 0.8;
      const y0 = (9 - n0.pitch) * STAFF_HALF_STEP;
      const y1 = (9 - n1.pitch) * STAFF_HALF_STEP;
      const bothH = !!(n0.episemaH && n1.episemaH);
      const { upperMora: n0Mora, lowerMora: n1Mora } = getTwoNoteMoraPositions(n0, y0, n1, y1, x1);

      positioned.push({
        note: n0,
        x: x0,
        yOffset: y0,
        accidentalX: accX,
        hasLeftStem: true,
        stemDown: true,
        stemHeight: 19,
        connectToNext: 'clivis',
        episemaVAbove: !!n0.episemaV,
        episemaSpanStartX: bothH ? x0 : undefined,
        episemaSpanEndX: bothH ? x1 + NOTE_W : undefined,
        ...n0Mora,
      });
      positioned.push({
        note: n1,
        x: x1,
        yOffset: y1,
        episemaBelow: n0.pitch - n1.pitch === 1,
        skipEpisemaH: bothH,
        ...n1Mora,
      });
      cursorX = x1 + NOTE_W + (n0.mora || n1.mora ? 9.5 : 2.5);
      i += 2;
      continue;
    }

    // 6. Single note (virga, diamond, quilisma, oriscus, stropha, standalone punctum)
    const x = cursorX;
    const y0 = (9 - n0.pitch) * STAFF_HALF_STEP;
    const mora = getMoraPosition(n0, x, y0);
    positioned.push({
      note: n0,
      x,
      yOffset: y0,
      accidentalX: accX,
      hasRightStem: n0.shape === 'virga',
      hasLeftStem: n0.shape === 'virgaLeft',
      stemDown: true,
      stemHeight: 20,
      ...mora,
    });

    let stepAdvance = NOTE_W + (n0.mora ? 9.5 : 2.5);
    if (n0.shape === 'diamond') {
      stepAdvance = NOTE_W + (n0.mora ? 9.5 : -0.5);
    } else if (
      n0.shape === 'stropha' &&
      n1?.shape === 'stropha' &&
      n1.pitch === n0.pitch &&
      !n0.mora &&
      !n1.accidental
    ) {
      stepAdvance = NOTE_W + 1.0;
    } else if (n0.shape === 'virga' && n1?.shape === 'diamond' && !n0.mora && !n1.accidental) {
      stepAdvance = NOTE_W + 1.2;
    }

    cursorX += stepAdvance;
    i += 1;
  }

  return {
    group,
    width: Math.max(NOTE_W, cursorX),
    notes: positioned,
  };
}

export function layoutPresetPreview(preset: NeumePresetId, anchorPitch = 5): GroupLayout {
  const tpl = NEUME_PRESET_TEMPLATES[preset];
  const minOffset = Math.min(...tpl.map((t) => t.offset));
  const maxOffset = Math.max(...tpl.map((t) => t.offset));
  const safeAnchor = Math.max(-minOffset, Math.min(12 - maxOffset, anchorPitch));

  const group: NeumeGroup = {
    id: 'preview',
    notes: tpl.map((t, idx) => ({
      id: `prev_${idx}`,
      pitch: safeAnchor + t.offset,
      shape: t.shape,
    })),
  };
  return layoutNeumeGroup(group);
}

export function layoutModifierPreview(modifier: ModifierPresetId): GroupLayout {
  const baseNote: ChantNote = {
    id: 'mod_prev',
    pitch: modifier === 'flat' || modifier === 'natural' ? 6 : 5,
    shape: 'punctum',
    mora: modifier === 'mora',
    episemaH: modifier === 'episemaH',
    episemaV: modifier === 'episemaV',
    accidental: modifier === 'flat' ? 'flat' : modifier === 'natural' ? 'natural' : null,
    liquescent: modifier === 'liquescent',
  };
  return layoutNeumeGroup({ id: 'mod_grp', notes: [baseNote] });
}

let measureCanvas: HTMLCanvasElement | null = null;
export function measureLyricWidth(
  text: string,
  fontSize = 16.5,
  fontCss = '"EB Garamond", Georgia, serif'
): number {
  if (!text) return 0;
  if (typeof document !== 'undefined') {
    if (!measureCanvas) measureCanvas = document.createElement('canvas');
    const ctx = measureCanvas.getContext('2d');
    if (ctx) {
      ctx.font = `${fontSize}px ${fontCss}`;
      return ctx.measureText(text).width;
    }
  }
  return text.length * (fontSize * 0.48);
}

export function measureDropCapWidth(
  char: string,
  fontSize: number,
  fontCss = '"Cinzel", Georgia, serif'
): number {
  if (!char) return 0;
  if (typeof document !== 'undefined') {
    if (!measureCanvas) measureCanvas = document.createElement('canvas');
    const ctx = measureCanvas.getContext('2d');
    if (ctx) {
      ctx.font = `600 ${fontSize}px ${fontCss}`;
      return ctx.measureText(char).width;
    }
  }
  return fontSize * 0.72;
}

export interface PlacedGroup {
  groupLayout: GroupLayout;
  x: number;
}

export interface PlacedItem {
  item: ScoreItem;
  indexInScore: number;
  x: number;
  width: number;
  neumeStartX: number;
  neumeWidth: number;
  /**
   * X coordinate the lyric text is centred on (render with text-anchor="middle").
   * For syllables this is the centre of the first note of the cluster.
   */
  lyricX: number;
  groups?: PlacedGroup[];
  activeClef: ClefType;
}

export interface StaffSystem {
  systemIndex: number;
  yTop: number; // Y of line 4 of the staff
  width: number;
  openingClef: ClefType;
  showOpeningClef: boolean;
  items: PlacedItem[];
  custosPitch: number | null;
}

export interface LayoutTypographyOptions {
  lyricFontCss?: string;
  lyricFontSize?: number;
  dropCapFontCss?: string;
  lineSpacing?: number;
  wordSpacing?: WordSpacingPreset;
}

export interface ScoreLayoutResult {
  systems: StaffSystem[];
  totalHeight: number;
  pageWidth: number;
  staffLeftX: number;
  staffRightX: number;
  lyricYOffset: number;
  dropCapFontSize: number;
  dropCapCenterX: number;
  staffStartXFirstSystem: number;
  lyricFontCss: string;
  lyricFontSize: number;
  systemRowHeight: number;
}

export interface PageSystem {
  system: StaffSystem;
  pageYTop: number;
}

export interface ScorePage {
  pageIndex: number;
  pageWidth: number;
  pageHeight: number;
  headerHeight: number;
  systems: PageSystem[];
}

export interface PaginatedScoreLayout {
  layout: ScoreLayoutResult;
  pages: ScorePage[];
}

export interface PaginationOptions {
  firstPageHeaderHeight?: number;
  contPageHeaderHeight?: number;
  firstSystemTopPad?: number;
  bottomMargin?: number;
}

export function computeScoreLayout(
  score: ChantScore,
  pageWidth = 850,
  hasDropCap = true,
  typography?: LayoutTypographyOptions
): ScoreLayoutResult {
  const lyricFontCss = typography?.lyricFontCss || '"EB Garamond", Georgia, serif';
  const lyricFontSize = typography?.lyricFontSize ?? 16.5;
  const dropCapFontCss = typography?.dropCapFontCss || '"Cinzel", Georgia, serif';
  const lineSpacing = typography?.lineSpacing ?? 32;
  const wordSpacing: WordSpacingPreset = isValidWordSpacing(typography?.wordSpacing)
    ? typography!.wordSpacing
    : 'normal';
  const { wordEndGap, midWordGap } = getWordSpacingGaps(wordSpacing, lyricFontSize);

  const marginX = 36;
  const staffLeftX = marginX;
  const staffRightX = pageWidth - marginX;
  const systemTopStart = 34;

  // Baseline of lyrics relative to sys.yTop (at 16.5px, STAFF_HEIGHT + 30 = 72px)
  const lyricYOffset = STAFF_HEIGHT + 13.5 + lyricFontSize;
  const systemRowHeight = Math.max(96, Math.round(lyricYOffset + 26 + lineSpacing));

  // Size drop cap so its top sits near line 4/3 while its baseline aligns flush with the first-line lyric baseline
  const dropCapFontSize = Math.round(lyricYOffset * 1.18);

  const firstSyllableWithText = score.items.find(
    (it) => it.kind === 'syllable' && it.lyric.trim().length > 0
  );
  const firstDropCapChar =
    hasDropCap &&
    score.header.initialStyle !== '0' &&
    firstSyllableWithText &&
    firstSyllableWithText.kind === 'syllable'
      ? firstSyllableWithText.lyric.trim()[0]?.toUpperCase() || ''
      : '';

  const measuredDropCapW = firstDropCapChar
    ? measureDropCapWidth(firstDropCapChar, dropCapFontSize, dropCapFontCss)
    : 0;
  const dropCapReserved = firstDropCapChar
    ? Math.max(64, Math.ceil(measuredDropCapW + 18))
    : 0;
  const staffStartXFirstSystem = firstDropCapChar
    ? staffLeftX + dropCapReserved - 6
    : staffLeftX;
  const dropCapCenterX = firstDropCapChar
    ? staffLeftX + (dropCapReserved - 12) / 2
    : staffLeftX;

  let currentClef: ClefType = 'c4';
  const systems: StaffSystem[] = [];

  let currentSystemItems: PlacedItem[] = [];
  let sysIdx = 0;

  const startNewSystem = (openingClef: ClefType, showOpeningClef: boolean) => {
    const startOffset = sysIdx === 0 ? dropCapReserved : 0;
    const clefW = showOpeningClef ? (openingClef.startsWith('cb') ? 34 : 22) : 0;
    return {
      systemIndex: sysIdx,
      yTop: systemTopStart + sysIdx * systemRowHeight,
      openingClef,
      showOpeningClef,
      cursorX: staffLeftX + startOffset + (showOpeningClef ? clefW + 14 : 8),
      maxX: staffRightX - 28,
    };
  };

  let sys = startNewSystem(currentClef, false);

  for (let idx = 0; idx < score.items.length; idx++) {
    const item = score.items[idx];

    if (item.kind === 'clef') {
      currentClef = item.clef;
      const clefW = item.clef.startsWith('cb') ? 34 : 22;
      if (sys.systemIndex === 0 && currentSystemItems.length === 0) {
        sys.openingClef = item.clef;
        currentSystemItems.push({
          item,
          indexInScore: idx,
          x: staffLeftX + dropCapReserved + 6,
          width: clefW + 10,
          neumeStartX: staffLeftX + dropCapReserved + 6,
          neumeWidth: clefW,
          lyricX: staffLeftX + dropCapReserved + 6 + clefW / 2,
          activeClef: currentClef,
        });
        sys.cursorX = staffLeftX + dropCapReserved + 6 + clefW + 14;
        continue;
      }

      if (sys.cursorX + clefW + 16 > sys.maxX && currentSystemItems.length > 0) {
        systems.push({
          systemIndex: sys.systemIndex,
          yTop: sys.yTop,
          width: staffRightX - staffLeftX,
          openingClef: sys.openingClef,
          showOpeningClef: sys.showOpeningClef,
          items: currentSystemItems,
          custosPitch: null,
        });
        sysIdx += 1;
        currentSystemItems = [];
        sys = startNewSystem(currentClef, false);
      }

      currentSystemItems.push({
        item,
        indexInScore: idx,
        x: sys.cursorX,
        width: clefW + 10,
        neumeStartX: sys.cursorX,
        neumeWidth: clefW,
        lyricX: sys.cursorX + clefW / 2,
        activeClef: currentClef,
      });
      sys.cursorX += clefW + 14;
      continue;
    }

    if (item.kind === 'linebreak') {
      systems.push({
        systemIndex: sys.systemIndex,
        yTop: sys.yTop,
        width: staffRightX - staffLeftX,
        openingClef: sys.openingClef,
        showOpeningClef: sys.showOpeningClef,
        items: currentSystemItems,
        custosPitch: null,
      });
      sysIdx += 1;
      currentSystemItems = [];
      sys = startNewSystem(currentClef, true);
      continue;
    }

    if (item.kind === 'division') {
      const divW = item.division === '::' ? 16 : 12;
      const lyricW = item.lyric
        ? measureLyricWidth(item.lyric, lyricFontSize, lyricFontCss) + 10
        : 0;
      const itemW = Math.max(divW + 16, lyricW);

      if (sys.cursorX + itemW > sys.maxX && currentSystemItems.length > 0) {
        systems.push({
          systemIndex: sys.systemIndex,
          yTop: sys.yTop,
          width: staffRightX - staffLeftX,
          openingClef: sys.openingClef,
          showOpeningClef: sys.showOpeningClef,
          items: currentSystemItems,
          custosPitch: null,
        });
        sysIdx += 1;
        currentSystemItems = [];
        sys = startNewSystem(currentClef, true);
      }

      currentSystemItems.push({
        item,
        indexInScore: idx,
        x: sys.cursorX,
        width: itemW,
        neumeStartX: sys.cursorX + (itemW - divW) / 2,
        neumeWidth: divW,
        lyricX: sys.cursorX + itemW / 2,
        activeClef: currentClef,
      });
      sys.cursorX += itemW + 8;
      continue;
    }

    if (item.kind === 'syllable') {
      const groupLayouts = item.groups.map(layoutNeumeGroup);
      const groupGap = 4.2;
      let neumeTotalW = 0;
      for (let g = 0; g < groupLayouts.length; g++) {
        neumeTotalW += groupLayouts[g].width;
        if (g < groupLayouts.length - 1) neumeTotalW += groupGap;
      }
      if (groupLayouts.length === 0) {
        neumeTotalW = 14;
      }

      const displayLyric =
        sys.systemIndex === 0 &&
        idx ===
          score.items.findIndex(
            (s) => s.kind === 'syllable' && s.lyric.trim().length > 0
          ) &&
        dropCapReserved > 0
          ? item.lyric.slice(1)
          : item.lyric;

      // The syllable is centred under the FIRST note of the cluster (not the
      // middle of the whole neume). Hyphens hang to the right so they do not
      // pull the text off the note.
      const hyphen = !item.wordEnd && displayLyric ? '-' : '';
      const textW = measureLyricWidth(displayLyric, lyricFontSize, lyricFontCss);
      const fullW = hyphen
        ? measureLyricWidth(displayLyric + hyphen, lyricFontSize, lyricFontCss)
        : textW;
      const hyphenW = fullW - textW;

      let anchorRel = neumeTotalW / 2;
      const firstLayout = groupLayouts.find((gl) => gl.notes.some((pn) => !pn.hiddenHead));
      if (firstLayout) {
        const firstNote = firstLayout.notes.find((pn) => !pn.hiddenHead);
        if (firstNote) {
          let offset = 0;
          for (const gl of groupLayouts) {
            if (gl === firstLayout) break;
            offset += gl.width + groupGap;
          }
          anchorRel = offset + firstNote.x + NOTE_W / 2;
        }
      }

      const pad = 5;
      const minEdge = item.wordEnd ? 4 : 3;
      const hasText = displayLyric.length > 0;
      const leftExtra = hasText ? Math.max(minEdge, textW / 2 + pad - anchorRel) : minEdge;
      const rightExtra = hasText
        ? Math.max(minEdge, anchorRel + textW / 2 + hyphenW + pad - neumeTotalW)
        : minEdge;
      let slotW = leftExtra + neumeTotalW + rightExtra;
      let slotLead = leftExtra;
      const minSlotW = item.wordEnd ? 26 : 18;
      if (slotW < minSlotW) {
        slotLead += (minSlotW - slotW) / 2;
        slotW = minSlotW;
      }
      const wordGap = item.wordEnd ? wordEndGap : midWordGap;

      if (sys.cursorX + slotW > sys.maxX && currentSystemItems.length > 0) {
        systems.push({
          systemIndex: sys.systemIndex,
          yTop: sys.yTop,
          width: staffRightX - staffLeftX,
          openingClef: sys.openingClef,
          showOpeningClef: sys.showOpeningClef,
          items: currentSystemItems,
          custosPitch: null,
        });
        sysIdx += 1;
        currentSystemItems = [];
        sys = startNewSystem(currentClef, true);
      }

      const neumeStartX = sys.cursorX + slotLead;
      const lyricX = neumeStartX + anchorRel + hyphenW / 2;
      const placedGroups: PlacedGroup[] = [];
      let gx = neumeStartX;
      for (const gl of groupLayouts) {
        placedGroups.push({ groupLayout: gl, x: gx });
        gx += gl.width + groupGap;
      }

      currentSystemItems.push({
        item,
        indexInScore: idx,
        x: sys.cursorX,
        width: slotW,
        neumeStartX,
        neumeWidth: neumeTotalW,
        lyricX,
        groups: placedGroups,
        activeClef: currentClef,
      });

      sys.cursorX += slotW + wordGap;
    }
  }

  systems.push({
    systemIndex: sys.systemIndex,
    yTop: sys.yTop,
    width: staffRightX - staffLeftX,
    openingClef: sys.openingClef,
    showOpeningClef: sys.showOpeningClef,
    items: currentSystemItems,
    custosPitch: null,
  });

  // Compute custos at the end of every non-final system
  for (let s = 0; s < systems.length - 1; s++) {
    for (let nextSys = s + 1; nextSys < systems.length; nextSys++) {
      let foundPitch: number | null = null;
      for (const pi of systems[nextSys].items) {
        if (pi.item.kind !== 'syllable') continue;
        for (const grp of pi.item.groups) {
          const sounding = grp.notes.find((n) => !n.accidentalOnly);
          if (sounding) {
            foundPitch = sounding.pitch;
            break;
          }
        }
        if (foundPitch !== null) break;
      }
      if (foundPitch !== null) {
        systems[s].custosPitch = foundPitch;
        break;
      }
    }
  }

  const totalHeight = Math.max(165, systemTopStart + systems.length * systemRowHeight + 16);

  return {
    systems,
    totalHeight,
    pageWidth,
    staffLeftX,
    staffRightX,
    lyricYOffset,
    dropCapFontSize,
    dropCapCenterX,
    staffStartXFirstSystem,
    lyricFontCss,
    lyricFontSize,
    systemRowHeight,
  };
}

export function paginateScoreLayout(
  score: ChantScore,
  pageWidth = 850,
  pageHeight = 1100,
  hasDropCap = true,
  typography?: LayoutTypographyOptions,
  options?: PaginationOptions
): PaginatedScoreLayout {
  const layout = computeScoreLayout(score, pageWidth, hasDropCap, typography);
  const firstPageHeaderHeight = options?.firstPageHeaderHeight ?? 132;
  const contPageHeaderHeight = options?.contPageHeaderHeight ?? 36;
  const firstSystemTopPad = options?.firstSystemTopPad ?? 24;
  const bottomMargin = options?.bottomMargin ?? 52;

  const pages: ScorePage[] = [];
  let pageIndex = 0;
  let currentHeaderH = firstPageHeaderHeight;
  let currentSystems: PageSystem[] = [];
  let nextPageYTop = currentHeaderH + firstSystemTopPad;
  const maxContentBottom = pageHeight - bottomMargin;

  for (const sys of layout.systems) {
    const sysBottom = nextPageYTop + layout.lyricYOffset + 14;
    if (currentSystems.length > 0 && sysBottom > maxContentBottom) {
      pages.push({
        pageIndex,
        pageWidth,
        pageHeight,
        headerHeight: currentHeaderH,
        systems: currentSystems,
      });
      pageIndex += 1;
      currentHeaderH = contPageHeaderHeight;
      currentSystems = [];
      nextPageYTop = currentHeaderH + firstSystemTopPad;
    }

    currentSystems.push({
      system: sys,
      pageYTop: nextPageYTop,
    });
    nextPageYTop += layout.systemRowHeight;
  }

  pages.push({
    pageIndex,
    pageWidth,
    pageHeight,
    headerHeight: currentHeaderH,
    systems: currentSystems,
  });

  return { layout, pages };
}

export function getDivisionLabel(div: DivisionType): string {
  switch (div) {
    case ',':
      return 'Quarter Bar (Minima)';
    case ';':
      return 'Half Bar (Minor)';
    case ':':
      return 'Full Bar (Major)';
    case '::':
      return 'Double Bar (Final)';
  }
}
