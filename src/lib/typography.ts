import {
  ChantFontId,
  ColoredTextSpan,
  PageOrientation,
  PageSizeId,
  ScorePageSetup,
  ScoreTypography,
  VowelAccentType,
  WordSpacingPreset,
} from '@/src/types/chant';

export interface FontOptionSpec {
  id: ChantFontId;
  label: string;
  cssFamily: string;
}

export const FONT_OPTIONS: FontOptionSpec[] = [
  {
    id: 'eb-garamond',
    label: 'EB Garamond',
    cssFamily: '"EB Garamond", Georgia, serif',
  },
  {
    id: 'crimson-pro',
    label: 'Crimson Pro',
    cssFamily: '"Crimson Pro", Georgia, serif',
  },
  {
    id: 'cormorant-garamond',
    label: 'Cormorant Garamond',
    cssFamily: '"Cormorant Garamond", Georgia, serif',
  },
  {
    id: 'lora',
    label: 'Lora',
    cssFamily: '"Lora", Georgia, serif',
  },
  {
    id: 'cinzel',
    label: 'Cinzel',
    cssFamily: '"Cinzel", Georgia, serif',
  },
  {
    id: 'plus-jakarta',
    label: 'Plus Jakarta Sans',
    cssFamily: '"Plus Jakarta Sans", system-ui, sans-serif',
  },
];

export const MIN_LYRIC_FONT_SIZE = 10;
export const MAX_LYRIC_FONT_SIZE = 100;
export const MIN_TITLE_FONT_SIZE = 12;
export const MAX_TITLE_FONT_SIZE = 100;
export const MIN_META_FONT_SIZE = 8;
export const MAX_META_FONT_SIZE = 48;
export const MIN_LINE_SPACING = 8;
export const MAX_LINE_SPACING = 160;
export const LARGE_PRINT_FONT_SIZE_THRESHOLD = 20;

export interface WordSpacingOptionSpec {
  id: WordSpacingPreset;
  label: string;
  wordEndGapPx: number;
  midWordGapPx: number;
  tooltip: string;
}

export const WORD_SPACING_OPTIONS: WordSpacingOptionSpec[] = [
  {
    id: 'compact',
    label: 'Compact',
    wordEndGapPx: 13,
    midWordGapPx: 1,
    tooltip: 'Compact word spacing',
  },
  {
    id: 'normal',
    label: 'Normal',
    wordEndGapPx: 18,
    midWordGapPx: 1.5,
    tooltip: 'Normal word spacing (default)',
  },
  {
    id: 'wide',
    label: 'Wide',
    wordEndGapPx: 26,
    midWordGapPx: 2,
    tooltip: 'Wide word spacing (also used automatically when printing at large font sizes)',
  },
];

export const DEFAULT_TYPOGRAPHY: ScoreTypography = {
  lyricFont: 'eb-garamond',
  lyricFontSize: 16.5,
  titleFont: 'cinzel',
  titleFontSize: 26,
  officePartFontSize: 11.5,
  modeFontSize: 11,
  lineSpacing: 32,
  wordSpacing: 'normal',
};

export function isValidFontId(val: unknown): val is ChantFontId {
  return FONT_OPTIONS.some((f) => f.id === val);
}

export function isValidWordSpacing(val: unknown): val is WordSpacingPreset {
  return val === 'compact' || val === 'normal' || val === 'wide';
}

export function getWordSpacingGaps(
  preset: WordSpacingPreset = 'normal',
  lyricFontSize = DEFAULT_TYPOGRAPHY.lyricFontSize
): { wordEndGap: number; midWordGap: number } {
  const spec = WORD_SPACING_OPTIONS.find((o) => o.id === preset) ?? WORD_SPACING_OPTIONS[1];
  const fontScale = Math.max(0.7, lyricFontSize / DEFAULT_TYPOGRAPHY.lyricFontSize);
  return {
    wordEndGap: Math.round(spec.wordEndGapPx * fontScale * 100) / 100,
    midWordGap: Math.round(spec.midWordGapPx * fontScale * 100) / 100,
  };
}

export function resolveEffectiveWordSpacing(
  wordSpacing: WordSpacingPreset | undefined,
  lyricFontSize: number,
  isPrinting = false
): WordSpacingPreset {
  const base: WordSpacingPreset = isValidWordSpacing(wordSpacing) ? wordSpacing : 'normal';
  if (isPrinting && lyricFontSize >= LARGE_PRINT_FONT_SIZE_THRESHOLD) {
    return 'wide';
  }
  return base;
}

export function getFontCss(id?: ChantFontId, fallback: ChantFontId = 'eb-garamond'): string {
  const found = FONT_OPTIONS.find((f) => f.id === id) || FONT_OPTIONS.find((f) => f.id === fallback);
  return found ? found.cssFamily : '"EB Garamond", Georgia, serif';
}

export function resolveScoreTypography(t?: Partial<ScoreTypography>): ScoreTypography {
  return {
    lyricFont: isValidFontId(t?.lyricFont) ? t.lyricFont : DEFAULT_TYPOGRAPHY.lyricFont,
    lyricFontSize:
      typeof t?.lyricFontSize === 'number' &&
      t.lyricFontSize >= MIN_LYRIC_FONT_SIZE &&
      t.lyricFontSize <= MAX_LYRIC_FONT_SIZE
        ? t.lyricFontSize
        : DEFAULT_TYPOGRAPHY.lyricFontSize,
    titleFont: isValidFontId(t?.titleFont) ? t.titleFont : DEFAULT_TYPOGRAPHY.titleFont,
    titleFontSize:
      typeof t?.titleFontSize === 'number' &&
      t.titleFontSize >= MIN_TITLE_FONT_SIZE &&
      t.titleFontSize <= MAX_TITLE_FONT_SIZE
        ? t.titleFontSize
        : DEFAULT_TYPOGRAPHY.titleFontSize,
    officePartFontSize: typeof t?.officePartFontSize === 'number' && t.officePartFontSize >= MIN_META_FONT_SIZE && t.officePartFontSize <= MAX_META_FONT_SIZE ? t.officePartFontSize : DEFAULT_TYPOGRAPHY.officePartFontSize,
    modeFontSize: typeof t?.modeFontSize === 'number' && t.modeFontSize >= MIN_META_FONT_SIZE && t.modeFontSize <= MAX_META_FONT_SIZE ? t.modeFontSize : DEFAULT_TYPOGRAPHY.modeFontSize,
    lineSpacing:
      typeof t?.lineSpacing === 'number' &&
      t.lineSpacing >= MIN_LINE_SPACING &&
      t.lineSpacing <= MAX_LINE_SPACING
        ? t.lineSpacing
        : DEFAULT_TYPOGRAPHY.lineSpacing,
    wordSpacing: isValidWordSpacing(t?.wordSpacing)
      ? t.wordSpacing
      : DEFAULT_TYPOGRAPHY.wordSpacing,
  };
}

export function getMissalHeaderMetrics(titleFontSize: number): {
  titleY: number;
  ruleY: number;
  firstPageHeaderHeight: number;
} {
  const extra = Math.max(0, titleFontSize - 26);
  return {
    titleY: 86 + Math.round(extra * 0.88),
    ruleY: 106 + Math.round(extra * 1.15),
    firstPageHeaderHeight: 132 + Math.round(extra * 1.15),
  };
}

export interface PageSizeSpec {
  id: PageSizeId;
  label: string;
  shortLabel: string;
  dimensionsLabel: string;
  widthPt: number;
  heightPt: number;
  cssSize: string;
}

export const PAGE_SIZE_SPECS: PageSizeSpec[] = [
  {
    id: 'letter',
    label: 'US Letter (8.5 × 11 in)',
    shortLabel: 'Letter',
    dimensionsLabel: '8.5 × 11 in',
    widthPt: 612,
    heightPt: 792,
    cssSize: 'letter',
  },
  {
    id: 'a4',
    label: 'A4 (210 × 297 mm)',
    shortLabel: 'A4',
    dimensionsLabel: '210 × 297 mm',
    widthPt: 595.28,
    heightPt: 841.89,
    cssSize: 'A4',
  },
  {
    id: 'legal',
    label: 'US Legal (8.5 × 14 in)',
    shortLabel: 'Legal',
    dimensionsLabel: '8.5 × 14 in',
    widthPt: 612,
    heightPt: 1008,
    cssSize: 'legal',
  },
  {
    id: 'half-letter',
    label: 'Booklet / Half-Letter (5.5 × 8.5 in)',
    shortLabel: 'Booklet',
    dimensionsLabel: '5.5 × 8.5 in',
    widthPt: 396,
    heightPt: 612,
    cssSize: '5.5in 8.5in',
  },
  {
    id: 'a5',
    label: 'A5 (148 × 210 mm)',
    shortLabel: 'A5',
    dimensionsLabel: '148 × 210 mm',
    widthPt: 419.53,
    heightPt: 595.28,
    cssSize: 'A5',
  },
];

export const DEFAULT_PAGE_SETUP: ScorePageSetup = {
  pageSize: 'letter',
  orientation: 'portrait',
};

export function isValidPageSizeId(val: unknown): val is PageSizeId {
  return PAGE_SIZE_SPECS.some((p) => p.id === val);
}

export function resolvePageSetup(setup?: Partial<ScorePageSetup>): ScorePageSetup {
  return {
    pageSize: isValidPageSizeId(setup?.pageSize)
      ? setup.pageSize
      : DEFAULT_PAGE_SETUP.pageSize,
    orientation:
      setup?.orientation === 'portrait' || setup?.orientation === 'landscape'
        ? setup.orientation
        : DEFAULT_PAGE_SETUP.orientation,
  };
}

export function getPageDimensions(setup?: Partial<ScorePageSetup>): {
  spec: PageSizeSpec;
  orientation: PageOrientation;
  widthPt: number;
  heightPt: number;
  svgWidth: number;
  svgHeight: number;
  cssPageRule: string;
} {
  const resolved = resolvePageSetup(setup);
  const spec = PAGE_SIZE_SPECS.find((p) => p.id === resolved.pageSize) || PAGE_SIZE_SPECS[0];
  const isLandscape = resolved.orientation === 'landscape';
  const widthPt = isLandscape ? spec.heightPt : spec.widthPt;
  const heightPt = isLandscape ? spec.widthPt : spec.heightPt;
  // 100 SVG units per inch (1 inch = 72 pt)
  const svgWidth = Math.round(widthPt / 0.72);
  const svgHeight = Math.round(heightPt / 0.72);
  return {
    spec,
    orientation: resolved.orientation,
    widthPt,
    heightPt,
    svgWidth,
    svgHeight,
    cssPageRule: `${spec.cssSize} ${resolved.orientation}`,
  };
}

export const TEXT_COLOR_PRESETS: { color: string; label: string }[] = [
  { color: '#111111', label: 'Pure Black' },
  { color: '#1D1915', label: 'Charcoal Ink' },
  { color: '#8B1E24', label: 'Rubric Red' },
  { color: '#B48327', label: 'Liturgical Gold' },
  { color: '#1E3A8A', label: 'Marian Blue' },
  { color: '#166534', label: 'Paschal Green' },
  { color: '#6B21A8', label: 'Penitential Violet' },
  { color: '#5C5349', label: 'Warm Slate' },
];

export function splitTextIntoColoredSegments(
  text: string,
  baseColor: string,
  spans?: ColoredTextSpan[]
): { text: string; color: string }[] {
  if (!text) return [];
  if (!spans || spans.length === 0) {
    return [{ text, color: baseColor }];
  }

  const normalized = spans
    .map((s) => ({
      start: Math.max(0, Math.min(text.length, s.start)),
      end: Math.max(0, Math.min(text.length, s.end)),
      color: s.color,
    }))
    .filter((s) => s.end > s.start)
    .sort((a, b) => a.start - b.start);

  if (normalized.length === 0) {
    return [{ text, color: baseColor }];
  }

  const segments: { text: string; color: string }[] = [];
  let cursor = 0;

  for (const sp of normalized) {
    if (sp.start > cursor) {
      segments.push({ text: text.slice(cursor, sp.start), color: baseColor });
    }
    const segStart = Math.max(cursor, sp.start);
    if (sp.end > segStart) {
      segments.push({ text: text.slice(segStart, sp.end), color: sp.color });
      cursor = sp.end;
    }
  }

  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), color: baseColor });
  }

  return segments;
}

export function applySpanColor(
  textLength: number,
  existingSpans: ColoredTextSpan[] | undefined,
  start: number,
  end: number,
  color: string | null
): ColoredTextSpan[] {
  const s = Math.max(0, Math.min(textLength, start));
  const e = Math.max(0, Math.min(textLength, end));
  if (e <= s) return existingSpans || [];

  // Build per-character color map to cleanly merge/override overlapping ranges
  const charColors: (string | null)[] = new Array(textLength).fill(null);
  if (existingSpans) {
    for (const sp of existingSpans) {
      const spStart = Math.max(0, Math.min(textLength, sp.start));
      const spEnd = Math.max(0, Math.min(textLength, sp.end));
      for (let i = spStart; i < spEnd; i++) {
        charColors[i] = sp.color;
      }
    }
  }

  for (let i = s; i < e; i++) {
    charColors[i] = color;
  }

  const merged: ColoredTextSpan[] = [];
  let curStart = -1;
  let curColor: string | null = null;

  for (let i = 0; i < textLength; i++) {
    const c = charColors[i];
    if (c !== curColor) {
      if (curColor !== null && curStart >= 0) {
        merged.push({ start: curStart, end: i, color: curColor });
      }
      curStart = c !== null ? i : -1;
      curColor = c;
    }
  }
  if (curColor !== null && curStart >= 0) {
    merged.push({ start: curStart, end: textLength, color: curColor });
  }

  return merged;
}

export interface VowelAccentOption {
  id: VowelAccentType;
  label: string;
  mark: string;
  preview: string;
  tooltip: string;
}

export const VOWEL_ACCENT_OPTIONS: VowelAccentOption[] = [
  {
    id: 'acute',
    label: 'Acute',
    mark: '´',
    preview: 'á',
    tooltip: 'Acute accent on selected vowels (á, é, í, ó, ú, ý, ǽ)',
  },
  {
    id: 'grave',
    label: 'Grave',
    mark: '`',
    preview: 'à',
    tooltip: 'Grave accent on selected vowels (à, è, ì, ò, ù, ỳ)',
  },
  {
    id: 'circumflex',
    label: 'Circumflex',
    mark: 'ˆ',
    preview: 'â',
    tooltip: 'Circumflex accent on selected vowels (â, ê, î, ô, û, ŷ)',
  },
  {
    id: 'diaeresis',
    label: 'Diaeresis',
    mark: '¨',
    preview: 'ä',
    tooltip: 'Diaeresis / trema on selected vowels (ä, ë, ï, ö, ü, ÿ)',
  },
  {
    id: 'none',
    label: 'Plain',
    mark: 'a',
    preview: 'a',
    tooltip: 'Remove accents from selected vowels',
  },
];

const VOWEL_BASES = new Set([
  'a',
  'e',
  'i',
  'o',
  'u',
  'y',
  'æ',
  'œ',
  'A',
  'E',
  'I',
  'O',
  'U',
  'Y',
  'Æ',
  'Œ',
]);

const PRECOMPOSED_ACCENTS: Record<Exclude<VowelAccentType, 'none'>, Record<string, string>> = {
  acute: {
    a: 'á',
    e: 'é',
    i: 'í',
    o: 'ó',
    u: 'ú',
    y: 'ý',
    æ: 'ǽ',
    A: 'Á',
    E: 'É',
    I: 'Í',
    O: 'Ó',
    U: 'Ú',
    Y: 'Ý',
    Æ: 'Ǽ',
    œ: 'œ\u0301',
    Œ: 'Œ\u0301',
  },
  grave: {
    a: 'à',
    e: 'è',
    i: 'ì',
    o: 'ò',
    u: 'ù',
    y: 'ỳ',
    A: 'À',
    E: 'È',
    I: 'Ì',
    O: 'Ò',
    U: 'Ù',
    Y: 'Ỳ',
  },
  circumflex: {
    a: 'â',
    e: 'ê',
    i: 'î',
    o: 'ô',
    u: 'û',
    y: 'ŷ',
    A: 'Â',
    E: 'Ê',
    I: 'Î',
    O: 'Ô',
    U: 'Û',
    Y: 'Ŷ',
  },
  diaeresis: {
    a: 'ä',
    e: 'ë',
    i: 'ï',
    o: 'ö',
    u: 'ü',
    y: 'ÿ',
    A: 'Ä',
    E: 'Ë',
    I: 'Ï',
    O: 'Ö',
    U: 'Ü',
    Y: 'Ÿ',
  },
};

const COMBINING_ACCENTS: Record<Exclude<VowelAccentType, 'none'>, string> = {
  acute: '\u0301',
  grave: '\u0300',
  circumflex: '\u0302',
  diaeresis: '\u0308',
};

interface TextCluster {
  cluster: string;
  start: number;
  end: number;
  baseVowel: string | null;
}

function splitVowelClusters(text: string): TextCluster[] {
  const clusters: TextCluster[] = [];
  let i = 0;
  while (i < text.length) {
    const start = i;
    const ch = text[i];
    i += 1;
    while (i < text.length && /[\u0300-\u036f]/.test(text[i])) {
      i += 1;
    }
    const cluster = text.slice(start, i);
    const nfd = cluster.normalize('NFD');
    const baseChar = nfd[0] || '';
    const isOnlyDiacriticsAfterBase = /^.[\u0300-\u036f]*$/.test(nfd);
    const baseVowel = isOnlyDiacriticsAfterBase && VOWEL_BASES.has(baseChar) ? baseChar : null;
    clusters.push({ cluster, start, end: i, baseVowel });
  }
  return clusters;
}

export function textHasVowel(text: string): boolean {
  return splitVowelClusters(text).some((c) => c.baseVowel !== null);
}

export function getSyllablePrimaryVowelRange(
  text: string
): { start: number; end: number; vowelText: string } | null {
  const clusters = splitVowelClusters(text);
  const vowelIndices: number[] = [];
  for (let i = 0; i < clusters.length; i++) {
    if (clusters[i].baseVowel !== null) {
      vowelIndices.push(i);
    }
  }
  if (vowelIndices.length === 0) return null;

  let chosenIdx = vowelIndices[0];
  if (vowelIndices.length > 1) {
    const firstIdx = vowelIndices[0];
    const firstBase = clusters[firstIdx].baseVowel?.toLowerCase();
    const prevCluster = firstIdx > 0 ? clusters[firstIdx - 1].cluster.toLowerCase() : '';
    const nextIsAdjacentVowel = vowelIndices[1] === firstIdx + 1;
    // Skip silent glide 'u' in qu-/gu- when followed immediately by another vowel (e.g. "qui", "quae", "gua")
    if (firstBase === 'u' && (prevCluster === 'q' || prevCluster === 'g') && nextIsAdjacentVowel) {
      chosenIdx = vowelIndices[1];
    }
  }

  const chosen = clusters[chosenIdx];
  return {
    start: chosen.start,
    end: chosen.end,
    vowelText: chosen.cluster,
  };
}

export function applyAccentToStringRange(
  text: string,
  start: number,
  end: number,
  accent: VowelAccentType
): {
  text: string;
  nextRange: { start: number; end: number };
  changed: boolean;
  delta: number;
} {
  const s = Math.max(0, Math.min(text.length, start));
  const e = Math.max(0, Math.min(text.length, end));
  if (e <= s) {
    return { text, nextRange: { start: s, end: e }, changed: false, delta: 0 };
  }

  const slice = text.slice(s, e);
  const clusters = splitVowelClusters(slice);
  let replaced = '';
  for (const c of clusters) {
    if (!c.baseVowel) {
      replaced += c.cluster;
    } else if (accent === 'none') {
      replaced += c.baseVowel;
    } else {
      const precomposed = PRECOMPOSED_ACCENTS[accent][c.baseVowel];
      replaced += precomposed ?? `${c.baseVowel}${COMBINING_ACCENTS[accent]}`;
    }
  }

  const nextText = text.slice(0, s) + replaced + text.slice(e);
  const delta = replaced.length - slice.length;
  return {
    text: nextText,
    nextRange: { start: s, end: s + replaced.length },
    changed: nextText !== text,
    delta,
  };
}

export function adjustSpansAfterEdit(
  spans: ColoredTextSpan[] | undefined,
  editStart: number,
  oldEnd: number,
  delta: number,
  newTextLength: number
): ColoredTextSpan[] | undefined {
  if (!spans || spans.length === 0) return spans;
  const shiftPos = (pos: number) => {
    if (pos >= oldEnd) return Math.max(0, Math.min(newTextLength, pos + delta));
    if (pos > editStart) return Math.max(editStart, Math.min(newTextLength, oldEnd + delta));
    return pos;
  };
  const next = spans
    .map((sp) => ({
      ...sp,
      start: shiftPos(sp.start),
      end: shiftPos(sp.end),
    }))
    .filter((sp) => sp.end > sp.start);
  return next.length > 0 ? next : undefined;
}

