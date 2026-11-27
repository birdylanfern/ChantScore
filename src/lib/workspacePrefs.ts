import {
  ChantFontId,
  ChantLanguage,
  ExportSheetStyle,
  OrganType,
  PageOrientation,
  PageSizeId,
  RibbonTab,
  ToneLayoutMode,
  WordSpacingPreset,
  WorkspaceMode,
  ZoomMode,
} from '@/src/types/chant';
import {
  DEFAULT_PAGE_SETUP,
  DEFAULT_TYPOGRAPHY,
  isValidFontId,
  isValidPageSizeId,
  isValidWordSpacing,
  MAX_LINE_SPACING,
  MAX_LYRIC_FONT_SIZE,
  MAX_TITLE_FONT_SIZE,
  MIN_LINE_SPACING,
  MIN_LYRIC_FONT_SIZE,
  MIN_TITLE_FONT_SIZE,
} from '@/src/lib/typography';

export const TONE_SIDE_BREAKPOINT_PX = 1100;
export const TONE_MIN_WIDTH = 340;
export const TONE_MAX_WIDTH_RATIO = 0.6;
export const DEFAULT_TONE_WIDTH = 420;

export function resolveToneLayoutMode(
  savedMode: ToneLayoutMode | null | undefined,
  viewportWidth: number
): ToneLayoutMode {
  if (savedMode === 'side' || savedMode === 'below') return savedMode;
  return viewportWidth >= TONE_SIDE_BREAKPOINT_PX ? 'side' : 'below';
}

export function clampToneWidth(width: number, containerWidth: number): number {
  const safeContainer = Number.isFinite(containerWidth) && containerWidth > 0 ? containerWidth : 1200;
  const maxWidth = Math.max(TONE_MIN_WIDTH, Math.floor(safeContainer * TONE_MAX_WIDTH_RATIO));
  const target = Number.isFinite(width) ? width : DEFAULT_TONE_WIDTH;
  return Math.max(TONE_MIN_WIDTH, Math.min(maxWidth, Math.round(target)));
}

export interface WorkspacePreferences {
  mode: WorkspaceMode;
  ribbonTab: RibbonTab;
  ribbonCollapsed: boolean;
  paletteVisible: boolean;
  gabcWidth: number;
  toneLayoutMode: ToneLayoutMode | null;
  toneWidth: number;
  zoomMode: ZoomMode;
  zoom: number;
  organ: OrganType;
  tempoBpm: number;
  transpose: number;
  volume: number;
  muted: boolean;
  exportStyle: ExportSheetStyle;
  transparentPng: boolean;
  lyricFont: ChantFontId;
  lyricFontSize: number;
  titleFont: ChantFontId;
  titleFontSize: number;
  lineSpacing: number;
  wordSpacing: WordSpacingPreset;
  pageSize: PageSizeId;
  pageOrientation: PageOrientation;
  language: ChantLanguage;
}

const PREFS_KEY = 'chantscore.workspace.prefs.v1';

export const DEFAULT_PREFS: WorkspacePreferences = {
  mode: 'source',
  ribbonTab: 'home',
  ribbonCollapsed: false,
  paletteVisible: true,
  gabcWidth: 380,
  toneLayoutMode: null,
  toneWidth: DEFAULT_TONE_WIDTH,
  zoomMode: 'fit-width',
  zoom: 1,
  organ: 'pipe',
  tempoBpm: 140,
  transpose: 0,
  volume: 0.85,
  muted: false,
  exportStyle: 'missal',
  transparentPng: false,
  lyricFont: DEFAULT_TYPOGRAPHY.lyricFont,
  lyricFontSize: DEFAULT_TYPOGRAPHY.lyricFontSize,
  titleFont: DEFAULT_TYPOGRAPHY.titleFont,
  titleFontSize: DEFAULT_TYPOGRAPHY.titleFontSize,
  lineSpacing: DEFAULT_TYPOGRAPHY.lineSpacing,
  wordSpacing: DEFAULT_TYPOGRAPHY.wordSpacing ?? 'normal',
  pageSize: DEFAULT_PAGE_SETUP.pageSize,
  pageOrientation: DEFAULT_PAGE_SETUP.orientation,
  language: 'la',
};

export function loadWorkspacePrefs(): WorkspacePreferences {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<WorkspacePreferences>;
    return {
      mode: parsed.mode === 'notation' || parsed.mode === 'source' ? parsed.mode : DEFAULT_PREFS.mode,
      ribbonTab:
        parsed.ribbonTab === 'home' ||
        parsed.ribbonTab === 'neumes' ||
        parsed.ribbonTab === 'notation' ||
        parsed.ribbonTab === 'tones' ||
        parsed.ribbonTab === 'playback' ||
        parsed.ribbonTab === 'export'
          ? parsed.ribbonTab
          : DEFAULT_PREFS.ribbonTab,
      ribbonCollapsed:
        typeof parsed.ribbonCollapsed === 'boolean'
          ? parsed.ribbonCollapsed
          : DEFAULT_PREFS.ribbonCollapsed,
      paletteVisible:
        typeof parsed.paletteVisible === 'boolean'
          ? parsed.paletteVisible
          : DEFAULT_PREFS.paletteVisible,
      gabcWidth:
        typeof parsed.gabcWidth === 'number' && parsed.gabcWidth >= 260 && parsed.gabcWidth <= 720
          ? parsed.gabcWidth
          : DEFAULT_PREFS.gabcWidth,
      toneLayoutMode:
        parsed.toneLayoutMode === 'side' || parsed.toneLayoutMode === 'below'
          ? parsed.toneLayoutMode
          : DEFAULT_PREFS.toneLayoutMode,
      toneWidth:
        typeof parsed.toneWidth === 'number' &&
        Number.isFinite(parsed.toneWidth) &&
        parsed.toneWidth >= TONE_MIN_WIDTH &&
        parsed.toneWidth <= 1800
          ? Math.round(parsed.toneWidth)
          : DEFAULT_PREFS.toneWidth,
      zoomMode:
        parsed.zoomMode === 'custom' ||
        parsed.zoomMode === 'fit-width' ||
        parsed.zoomMode === 'fit-page'
          ? parsed.zoomMode
          : DEFAULT_PREFS.zoomMode,
      zoom:
        typeof parsed.zoom === 'number' && parsed.zoom >= 0.4 && parsed.zoom <= 2.2
          ? parsed.zoom
          : DEFAULT_PREFS.zoom,
      organ:
        parsed.organ === 'flute' || parsed.organ === 'pipe' || parsed.organ === 'wind'
          ? parsed.organ
          : DEFAULT_PREFS.organ,
      tempoBpm:
        typeof parsed.tempoBpm === 'number' && parsed.tempoBpm >= 40 && parsed.tempoBpm <= 200
          ? parsed.tempoBpm
          : DEFAULT_PREFS.tempoBpm,
      transpose:
        typeof parsed.transpose === 'number' && parsed.transpose >= -6 && parsed.transpose <= 6
          ? parsed.transpose
          : DEFAULT_PREFS.transpose,
      volume:
        typeof parsed.volume === 'number' && parsed.volume >= 0 && parsed.volume <= 1
          ? parsed.volume
          : DEFAULT_PREFS.volume,
      muted: typeof parsed.muted === 'boolean' ? parsed.muted : DEFAULT_PREFS.muted,
      exportStyle:
        parsed.exportStyle === 'missal' ||
        parsed.exportStyle === 'sheet' ||
        parsed.exportStyle === 'sheet-red'
          ? parsed.exportStyle
          : DEFAULT_PREFS.exportStyle,
      transparentPng:
        typeof parsed.transparentPng === 'boolean'
          ? parsed.transparentPng
          : DEFAULT_PREFS.transparentPng,
      lyricFont: isValidFontId(parsed.lyricFont)
        ? parsed.lyricFont
        : DEFAULT_PREFS.lyricFont,
      lyricFontSize:
        typeof parsed.lyricFontSize === 'number' &&
        parsed.lyricFontSize >= MIN_LYRIC_FONT_SIZE &&
        parsed.lyricFontSize <= MAX_LYRIC_FONT_SIZE
          ? parsed.lyricFontSize
          : DEFAULT_PREFS.lyricFontSize,
      titleFont: isValidFontId(parsed.titleFont)
        ? parsed.titleFont
        : DEFAULT_PREFS.titleFont,
      titleFontSize:
        typeof parsed.titleFontSize === 'number' &&
        parsed.titleFontSize >= MIN_TITLE_FONT_SIZE &&
        parsed.titleFontSize <= MAX_TITLE_FONT_SIZE
          ? parsed.titleFontSize
          : DEFAULT_PREFS.titleFontSize,
      lineSpacing:
        typeof parsed.lineSpacing === 'number' &&
        parsed.lineSpacing >= MIN_LINE_SPACING &&
        parsed.lineSpacing <= MAX_LINE_SPACING
          ? parsed.lineSpacing
          : DEFAULT_PREFS.lineSpacing,
      wordSpacing: isValidWordSpacing(parsed.wordSpacing)
        ? parsed.wordSpacing
        : DEFAULT_PREFS.wordSpacing,
      pageSize: isValidPageSizeId(parsed.pageSize)
        ? parsed.pageSize
        : DEFAULT_PREFS.pageSize,
      pageOrientation:
        parsed.pageOrientation === 'portrait' || parsed.pageOrientation === 'landscape'
          ? parsed.pageOrientation
          : DEFAULT_PREFS.pageOrientation,
      language:
        parsed.language === 'la' || parsed.language === 'en'
          ? parsed.language
          : DEFAULT_PREFS.language,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function saveWorkspacePrefs(prefs: WorkspacePreferences): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // ignore storage failures
  }
}

