export type ClefType =
  | 'c1'
  | 'c2'
  | 'c3'
  | 'c4'
  | 'f1'
  | 'f2'
  | 'f3'
  | 'f4'
  | 'cb3'
  | 'cb4';

export type DivisionType = ',' | ';' | ':' | '::';

export type NoteShape =
  | 'punctum'
  | 'virga'
  | 'virgaLeft'
  | 'diamond'
  | 'quilisma'
  | 'oriscus'
  | 'stropha';

export type AccidentalType = 'flat' | 'natural' | 'sharp' | null;

export interface ChantNote {
  id: string;
  /** 0='a' .. 12='m' (lines are 3='d', 5='f', 7='h', 9='j') */
  pitch: number;
  shape: NoteShape;
  mora?: boolean;
  episemaH?: boolean;
  episemaV?: boolean;
  accidental?: AccidentalType;
  accidentalOnly?: boolean;
  liquescent?: boolean;
  liquescentDir?: 'asc' | 'desc' | 'dim';
}

export interface NeumeGroup {
  id: string;
  notes: ChantNote[];
}

export interface ColoredTextSpan {
  start: number;
  end: number;
  color: string;
}

export type ChantFontId =
  | 'eb-garamond'
  | 'crimson-pro'
  | 'cormorant-garamond'
  | 'lora'
  | 'cinzel'
  | 'plus-jakarta';

export type PageSizeId = 'letter' | 'a4' | 'legal' | 'half-letter' | 'a5';

export type PageOrientation = 'portrait' | 'landscape';

export type WordSpacingPreset = 'compact' | 'normal' | 'wide';

export interface ScoreTypography {
  lyricFont: ChantFontId;
  lyricFontSize: number;
  titleFont: ChantFontId;
  titleFontSize: number;
  officePartFontSize: number;
  modeFontSize: number;
  lineSpacing: number;
  wordSpacing?: WordSpacingPreset;
}

export interface ScorePageSetup {
  pageSize: PageSizeId;
  orientation: PageOrientation;
}

export type HeaderTextField = 'name' | 'officePart' | 'mode' | 'annotation' | 'dropCap';

export type TextSelectionTarget =
  | { kind: 'header'; field: HeaderTextField; range?: { start: number; end: number } }
  | { kind: 'lyric-range'; itemId: string; start: number; end: number };

/**
 * Original GABC text for a token, kept so untouched material round-trips
 * byte-for-byte. The `*Sig` fields record what the editable model serialized to
 * at parse time; if the model still serializes to the same value the original
 * text is emitted, otherwise the token is regenerated from the model.
 */
export interface RawGabcToken {
  /** Original text before the parenthesis (may include markup such as <c>, <i>, <alt>). */
  lyric?: string;
  lyricSig?: string;
  /** Original text inside the parentheses (may include r, q, [..] tags, custos, etc.). */
  body: string;
  bodySig: string;
}

export interface SyllableItem {
  id: string;
  kind: 'syllable';
  raw?: RawGabcToken;
  lyric: string;
  wordEnd: boolean;
  groups: NeumeGroup[];
  lyricColor?: string;
  lyricSpans?: ColoredTextSpan[];
}

export interface DivisionItem {
  id: string;
  kind: 'division';
  raw?: RawGabcToken;
  division: DivisionType;
  lyric?: string;
  lyricColor?: string;
}

export interface ClefItem {
  id: string;
  kind: 'clef';
  raw?: RawGabcToken;
  clef: ClefType;
}

export interface LineBreakItem {
  id: string;
  kind: 'linebreak';
  justified: boolean;
  /** True when the source wrote this break inside the previous division token, e.g. `(:z)`. */
  fusedWithPrev?: boolean;
}

export type ScoreItem = SyllableItem | DivisionItem | ClefItem | LineBreakItem;

export interface ChantHeader {
  name: string;
  officePart: string;
  mode: string;
  annotation: string;
  /** Additional `annotation:` lines beyond the first (GABC allows two). */
  annotationExtra?: string[];
  initialStyle: '0' | '1';
  extraHeaders: Record<string, string>;
  titleColor?: string;
  titleSpans?: ColoredTextSpan[];
  officePartColor?: string;
  officePartSpans?: ColoredTextSpan[];
  modeColor?: string;
  annotationColor?: string;
  dropCapColor?: string;
}

export interface ChantScore {
  header: ChantHeader;
  items: ScoreItem[];
  typography?: ScoreTypography;
  pageSetup?: ScorePageSetup;
}

export type OrganType = 'flute' | 'pipe' | 'wind';

export type EditorToolMode = 'select' | 'insert';

export type NeumePresetId =
  | 'punctum'
  | 'virga'
  | 'diamond'
  | 'quilisma'
  | 'oriscus'
  | 'stropha'
  | 'podatus'
  | 'clivis'
  | 'torculus'
  | 'porrectus'
  | 'scandicus'
  | 'climacus';

export type ModifierPresetId =
  | 'mora'
  | 'episemaH'
  | 'episemaV'
  | 'flat'
  | 'natural'
  | 'liquescent';

export type PaletteDragPayload =
  | { kind: 'neume'; preset: NeumePresetId }
  | { kind: 'division'; division: DivisionType }
  | { kind: 'clef'; clef: ClefType };

export interface SelectedNoteRef {
  itemId: string;
  groupId: string;
  noteId: string;
}

export interface SelectionState {
  itemId: string;
  groupId?: string;
  noteId?: string;
  selectedNotes?: SelectedNoteRef[];
}

export type RibbonTab = 'home' | 'neumes' | 'notation' | 'tones' | 'playback' | 'export';

export type ChantLanguage = 'la' | 'en';

export type WorkspaceMode = 'notation' | 'source';

export type ToneLayoutMode = 'side' | 'below';

export type ZoomMode = 'custom' | 'fit-width' | 'fit-page';

export type ClipboardPayload =
  | { kind: 'notes'; notes: ChantNote[] }
  | { kind: 'syllable'; item: SyllableItem }
  | { kind: 'division'; division: DivisionType; lyric?: string }
  | { kind: 'clef'; clef: ClefType };

export type ExportSheetStyle = 'missal' | 'sheet' | 'sheet-red';

export type VowelAccentType = 'acute' | 'grave' | 'circumflex' | 'diaeresis' | 'none';

export interface PhraseBreakKey {
  endWordIndex: number;
  wordText: string;
}

export type TonePhraseCadenceKind = 'metrum' | 'flex' | 'punctum' | 'question' | 'prefinal' | 'final';
export type TonePhraseCadenceChoice = 'none' | 'metrum' | 'long' | 'question' | 'final' | 'flex' | 'prefinal';
export type ToneEnglishPrefaceRole = 'h-metrum' | 'g-flex' | 'g-long';

export interface TonePhraseLinkItem {
  index: number;
  text: string;
  words: string[];
  startWordIndex: number;
  endWordIndex: number;
  endWordText: string;
  defaultKind: TonePhraseCadenceKind | null;
  effectiveKind: TonePhraseCadenceKind | null;
  choiceLabel: TonePhraseCadenceChoice;
  overridden: boolean;
  defaultRole?: ToneEnglishPrefaceRole;
  effectiveRole?: ToneEnglishPrefaceRole;
  roleOverridden?: boolean;
  merged: boolean;
  mergedFrom: number;
  autoJoined?: boolean;
  internalMergedBreaks: PhraseBreakKey[];
  paragraphBreak: boolean;
  isOpeningFormula?: boolean;
  canJoinPrev: boolean;
  canJoinNext: boolean;
  sourceStart: number;
  sourceEnd: number;
  endAnchorOffset: number;
  hasTrailingBar: boolean;
  firstSyllableIndex: number;
  lastSyllableIndex: number;
  endItemId?: string;
  firstSyllableItemId?: string;
  lastSyllableItemId?: string;
  endDivisionItemId?: string;
}

export interface ToneLink {
  gabcHash: string;
  mode: 'reading' | 'preface';
  language: ChantLanguage;
  isEnglishPreface: boolean;
  hasQuestionCadence: boolean;
  phrases: TonePhraseLinkItem[];
}
