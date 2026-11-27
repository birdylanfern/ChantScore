import React from 'react';
import {
  Archive,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronDown,
  ChevronUp,
  ClipboardPaste,
  Copy,
  ExternalLink,
  FileAudio,
  FileCode2,
  FileImage,
  FilePlus2,
  FileText,
  FolderOpen,
  Library,
  Loader2,
  MousePointer2,
  Pause,
  PenTool,
  Play,
  Printer,
  Redo2,
  Save,
  SplitSquareHorizontal,
  Square,
  Trash2,
  Undo2,
  Unlink,
  Link2,
  Volume2,
  VolumeX,
  PanelRight,
  RotateCcw,
} from 'lucide-react';
import {
  ChantFontId,
  ChantLanguage,
  ChantNote,
  ChantScore,
  ClefType,
  ClipboardPayload,
  DivisionType,
  EditorToolMode,
  ExportSheetStyle,
  ModifierPresetId,
  NeumePresetId,
  OrganType,
  PageSizeId,
  PaletteDragPayload,
  RibbonTab,
  ScorePageSetup,
  ScoreTypography,
  SelectionState,
  TextSelectionTarget,
  VowelAccentType,
  WorkspaceMode,
} from '@/src/types/chant';
import type { ToneController } from '@/src/components/TonePanel';
import { ExportFormat } from '@/src/components/ExportMenu';
import { ORGAN_PROFILES } from '@/src/lib/audio/organEngine';
import { parseClefConfig, resolvePitch } from '@/src/lib/gabc/pitch';
import {
  getAccentTargetInfo,
  getSelectedNoteRefs,
  getSelectionCurrentColor,
} from '@/src/lib/notation/scoreMutations';
import {
  applyAccentToStringRange,
  FONT_OPTIONS,
  MAX_LINE_SPACING,
  MAX_LYRIC_FONT_SIZE,
  MAX_TITLE_FONT_SIZE,
  MIN_LINE_SPACING,
  MIN_LYRIC_FONT_SIZE,
  MIN_TITLE_FONT_SIZE,
  PAGE_SIZE_SPECS,
  resolvePageSetup,
  resolveScoreTypography,
  TEXT_COLOR_PRESETS,
  VOWEL_ACCENT_OPTIONS,
  WORD_SPACING_OPTIONS,
} from '@/src/lib/typography';
import {
  CLEFS,
  DIVISIONS,
  MiniClefPreview,
  MiniDivisionPreview,
  MiniModifierPreview,
  MiniNeumePreview,
  MODIFIERS,
  SINGLE_NOTES,
  THREE_NOTE_NEUMES,
  TWO_NOTE_NEUMES,
} from '@/src/components/NeumePalette';
import { INK_BLACK } from '@/src/lib/notation/svgDrawing';

interface RibbonToolbarProps {
  activeTab: RibbonTab;
  collapsed: boolean;
  workspaceMode: WorkspaceMode;
  saveStatus: 'saved' | 'saving' | 'failed';
  score: ChantScore;
  selection: SelectionState | null;
  textSelection: TextSelectionTarget | null;
  toolMode: EditorToolMode;
  activePreset: NeumePresetId | null;
  activeModifiers: {
    mora: boolean;
    episemaH: boolean;
    episemaV: boolean;
    flat: boolean;
    natural: boolean;
    liquescent: boolean;
  };
  canUndo: boolean;
  canRedo: boolean;
  clipboard: ClipboardPayload | null;
  isPlaying: boolean;
  isPaused: boolean;
  elapsedSec: number;
  totalDurationSec: number;
  activeNoteLabel: string | null;
  organ: OrganType;
  tempoBpm: number;
  transpose: number;
  volume: number;
  muted: boolean;
  language: ChantLanguage;
  toneController: ToneController | null;
  busyExport: ExportFormat | null;
  exportStyle: ExportSheetStyle;
  transparentPng: boolean;
  onSelectTab: (tab: RibbonTab) => void;
  onToggleCollapse: () => void;
  onSetWorkspaceMode: (mode: WorkspaceMode) => void;
  onSetToolMode: (mode: EditorToolMode) => void;
  onSelectPreset: (preset: NeumePresetId) => void;
  onStartDrag: (payload: PaletteDragPayload) => void;
  onEndDrag: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onNewScore: () => void;
  onDeleteSelection: () => void;
  onShiftPitch: (delta: number) => void;
  onToggleModifier: (mod: ModifierPresetId) => void;
  onSetLiquescentDir: (dir: 'asc' | 'desc' | 'dim') => void;
  onSplitGroup: () => void;
  onMergeGroup: () => void;
  onInsertDivision: (div: DivisionType) => void;
  onSelectClef: (clef: ClefType) => void;
  onInsertLineBreak: () => void;
  onUpdateLyric: (itemId: string, lyric: string, wordEnd?: boolean) => void;
  onAssignSyllableToNote: (itemId: string, noteId: string, lyric: string) => void;
  onCommitEmptySyllable: (itemId: string) => void;
  onShiftSyllableLyric: (itemId: string, dir: 'prev' | 'next') => void;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onSeek: (sec: number) => void;
  onPlayFromSelection: (noteId: string) => void;
  onChangeOrgan: (organ: OrganType) => void;
  onChangeTempo: (bpm: number) => void;
  onChangeTranspose: (delta: number) => void;
  onChangeVolume: (vol: number) => void;
  onToggleMute: () => void;
  onChangeLanguage: (lang: ChantLanguage) => void;
  onExport: (format: ExportFormat) => void;
  onChangeExportStyle: (style: ExportSheetStyle) => void;
  onToggleTransparentPng: () => void;
  onPrint: () => void;
  onToggleDropCap: () => void;
  onChangeTypography: (patch: Partial<ScoreTypography>) => void;
  onChangePageSetup: (patch: Partial<ScorePageSetup>) => void;
  onApplyTextColor: (color: string | null) => void;
  onApplyVowelAccent: (accent: VowelAccentType) => void;
  onSelectText: (target: TextSelectionTarget | null) => void;
  onClearTextSelection: () => void;
  scoreCount?: number;
  backupNudgeLabel?: string | null;
  onOpenLibrary?: () => void;
  onDismissBackupNudge?: () => void;
  onTriggerBackupAll?: () => void;
}

function formatTime(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

const TABS: { id: RibbonTab; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'neumes', label: 'Neumes' },
  { id: 'notation', label: 'Notation' },
  { id: 'tones', label: 'Tones' },
  { id: 'playback', label: 'Playback' },
  { id: 'export', label: 'Export' },
];

function RibbonGroup({
  title,
  children,
  accent = false,
}: {
  title: string;
  children: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <div
      className={`flex shrink-0 flex-col justify-between px-2.5 py-1 border-r border-[#D6CBB8] last:border-r-0 ${
        accent ? 'bg-[#8B1E24]/[0.04]' : ''
      }`}
    >
      <div className="flex items-center gap-1.5">{children}</div>
      <div className="mt-1 text-center text-[10px] font-medium tracking-wide text-[#75695A] select-none whitespace-nowrap">
        {title}
      </div>
    </div>
  );
}

export const RibbonToolbar: React.FC<RibbonToolbarProps> = ({
  activeTab,
  collapsed,
  workspaceMode,
  saveStatus,
  score,
  selection,
  textSelection,
  toolMode,
  activePreset,
  activeModifiers,
  canUndo,
  canRedo,
  clipboard,
  isPlaying,
  isPaused,
  elapsedSec,
  totalDurationSec,
  activeNoteLabel,
  organ,
  tempoBpm,
  transpose,
  volume,
  muted,
  language,
  toneController,
  busyExport,
  exportStyle,
  transparentPng,
  onSelectTab,
  onToggleCollapse,
  onSetWorkspaceMode,
  onSetToolMode,
  onSelectPreset,
  onStartDrag,
  onEndDrag,
  onUndo,
  onRedo,
  onCopy,
  onPaste,
  onNewScore,
  onDeleteSelection,
  onShiftPitch,
  onToggleModifier,
  onSetLiquescentDir,
  onSplitGroup,
  onMergeGroup,
  onInsertDivision,
  onSelectClef,
  onInsertLineBreak,
  onUpdateLyric,
  onAssignSyllableToNote,
  onCommitEmptySyllable,
  onShiftSyllableLyric,
  onPlay,
  onPause,
  onStop,
  onSeek,
  onPlayFromSelection,
  onChangeOrgan,
  onChangeTempo,
  onChangeTranspose,
  onChangeVolume,
  onToggleMute,
  onChangeLanguage,
  onExport,
  onChangeExportStyle,
  onToggleTransparentPng,
  onPrint,
  onToggleDropCap,
  onChangeTypography,
  onChangePageSetup,
  onApplyTextColor,
  onApplyVowelAccent,
  onSelectText,
  onClearTextSelection,
  scoreCount,
  backupNudgeLabel,
  onOpenLibrary,
  onDismissBackupNudge,
  onTriggerBackupAll,
}) => {
  const contextualLyricInputRef = React.useRef<HTMLInputElement | null>(null);
  const selectedIdx = selection
    ? score.items.findIndex((it) => it.id === selection.itemId)
    : -1;
  const selectedItem = selectedIdx >= 0 ? score.items[selectedIdx] : null;
  const selectedRefs = getSelectedNoteRefs(selection);
  const selectedNoteIds = new Set(selectedRefs.map((r) => r.noteId));
  const isMultiSelect = selectedRefs.length > 1;
  const uniqueItemIds = new Set(selectedRefs.map((r) => r.itemId));

  let activeClef: ClefType = 'c4';
  if (selectedIdx >= 0) {
    for (let i = 0; i <= selectedIdx; i++) {
      const it = score.items[i];
      if (it.kind === 'clef') activeClef = it.clef;
    }
  }

  const selectedNoteObjects: ChantNote[] = [];
  if (selectedNoteIds.size > 0) {
    for (const scItem of score.items) {
      if (scItem.kind !== 'syllable') continue;
      for (const grp of scItem.groups) {
        for (const n of grp.notes) {
          if (selectedNoteIds.has(n.id)) selectedNoteObjects.push(n);
        }
      }
    }
  }

  const selectedSyllable = selectedItem?.kind === 'syllable' ? selectedItem : null;
  const selectedGroup =
    selectedSyllable?.groups.find((g) => g.id === selection?.groupId) ||
    selectedSyllable?.groups[0] ||
    null;
  const selectedNote =
    selectedGroup?.notes.find((n) => n.id === selection?.noteId) ||
    selectedGroup?.notes[0] ||
    null;

  const pitchInfo =
    !isMultiSelect && selectedNote
      ? resolvePitch(
          selectedNote.pitch,
          activeClef,
          parseClefConfig(activeClef).hasFlatSignature,
          selectedNote.accidental
        )
      : null;

  const allNotesInItem = selectedSyllable ? selectedSyllable.groups.flatMap((g) => g.notes) : [];
  const firstSoundingNote =
    allNotesInItem.find((n) => !n.accidentalOnly) || allNotesInItem[0] || null;
  const earliestSelectedInItem =
    allNotesInItem.find((n) => selectedNoteIds.has(n.id)) || selectedNote;
  const isSyllableHeadNote = isMultiSelect
    ? !!firstSoundingNote && selectedNoteIds.has(firstSoundingNote.id)
    : !selectedNote || !firstSoundingNote || selectedNote.id === firstSoundingNote.id;
  const syllableBoxValue = selectedSyllable
    ? isSyllableHeadNote
      ? selectedSyllable.lyric
      : ''
    : '';

  const canSplitGroup =
    !!selectedSyllable &&
    !!selectedGroup &&
    !!selectedNote &&
    selectedGroup.notes.findIndex((n) => n.id === selectedNote.id) > 0;
  const canMergeGroup =
    !!selectedSyllable &&
    !!selectedGroup &&
    selectedSyllable.groups.findIndex((g) => g.id === selectedGroup.id) > 0;

  const playStartNoteId = selectedNoteObjects[0]?.id || selectedNote?.id;

  const typography = resolveScoreTypography(score.typography);
  const pageSetup = resolvePageSetup(score.pageSetup);
  const currentTextColor = getSelectionCurrentColor(score, selection, textSelection);
  const hasColorTarget =
    !!textSelection ||
    !!selectedSyllable ||
    (selectedItem?.kind === 'division' && !!selectedItem.lyric);
  const accentInfo = getAccentTargetInfo(score, selection, textSelection);

  let textTargetLabel = 'Text';
  if (textSelection?.kind === 'header') {
    const fieldLabels: Record<string, string> = {
      name: 'Title',
      officePart: 'Office Part',
      mode: 'Mode',
      annotation: 'Annotation',
      dropCap: 'Drop Cap',
    };
    const baseLabel = fieldLabels[textSelection.field] || 'Header';
    textTargetLabel =
      textSelection.range && textSelection.range.end > textSelection.range.start
        ? `${baseLabel} (selection)`
        : baseLabel;
  } else if (textSelection?.kind === 'lyric-range') {
    const targetItem = score.items.find((it) => it.id === textSelection.itemId);
    const slice =
      targetItem?.kind === 'syllable'
        ? targetItem.lyric.slice(textSelection.start, textSelection.end)
        : '';
    textTargetLabel = slice ? `“${slice}”` : 'Lyric selection';
  } else if (selectedSyllable) {
    textTargetLabel =
      uniqueItemIds.size > 1
        ? `${uniqueItemIds.size} syllables`
        : selectedSyllable.lyric
        ? `“${selectedSyllable.lyric}”`
        : 'Syllable';
  } else if (selectedItem?.kind === 'division' && selectedItem.lyric) {
    textTargetLabel = `“${selectedItem.lyric}”`;
  }

  const renderInlineColorControls = () => (
    <div className="flex items-center gap-1" role="group" aria-label="Text color">
      {TEXT_COLOR_PRESETS.map((preset) => {
        const isActive =
          currentTextColor?.toLowerCase() === preset.color.toLowerCase();
        return (
          <button
            key={preset.color}
            type="button"
            disabled={!hasColorTarget}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onApplyTextColor(preset.color)}
            title={`${preset.label} (${preset.color})`}
            aria-label={`Set text color to ${preset.label}`}
            className={`flex h-5 w-5 items-center justify-center rounded border transition-colors disabled:opacity-35 ${
              isActive
                ? 'border-[#8B1E24] ring-1 ring-[#8B1E24] bg-white'
                : 'border-[#CFC3AE] bg-[#FAF6EE] hover:border-[#8B1E24]'
            }`}
          >
            <svg viewBox="0 0 12 12" className="h-3 w-3 rounded-[1px]" aria-hidden="true">
              <rect width="12" height="12" rx="1.5" fill={preset.color} />
            </svg>
          </button>
        );
      })}
      <label
        title="Custom text color"
        className={`flex h-5 w-5 items-center justify-center rounded border border-[#CFC3AE] bg-[#FAF6EE] px-0.5 ${
          hasColorTarget ? 'cursor-pointer hover:border-[#8B1E24]' : 'opacity-35 cursor-not-allowed'
        }`}
      >
        <input
          type="color"
          aria-label="Custom text color"
          disabled={!hasColorTarget}
          value={currentTextColor || '#1D1915'}
          onChange={(e) => onApplyTextColor(e.target.value)}
          className="h-3.5 w-4 cursor-pointer border-0 bg-transparent p-0 disabled:cursor-not-allowed"
        />
      </label>
      {currentTextColor && (
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onApplyTextColor(null)}
          title="Reset text color"
          aria-label="Reset text color"
          className="inline-flex h-5 items-center rounded border border-[#CFC3AE] bg-[#FAF6EE] px-1 text-[10px] font-medium text-[#4F473E] hover:bg-white hover:text-[#1D1915]"
        >
          <RotateCcw className="h-2.5 w-2.5" />
        </button>
      )}
    </div>
  );

  const handleAccentClick = (accent: VowelAccentType) => {
    const inputEl = contextualLyricInputRef.current;
    const isContextualFocused = inputEl && document.activeElement === inputEl;
    const prevStart = isContextualFocused ? inputEl.selectionStart : null;
    const prevEnd = isContextualFocused ? inputEl.selectionEnd : null;
    const nextRange =
      isContextualFocused && prevStart !== null && prevEnd !== null && prevEnd > prevStart
        ? applyAccentToStringRange(syllableBoxValue, prevStart, prevEnd, accent).nextRange
        : null;
    onApplyVowelAccent(accent);
    if (nextRange) {
      requestAnimationFrame(() => {
        if (contextualLyricInputRef.current) {
          contextualLyricInputRef.current.focus();
          contextualLyricInputRef.current.setSelectionRange(nextRange.start, nextRange.end);
        }
      });
    }
  };

  const renderInlineAccentControls = () => (
    <div className="flex items-center gap-0.5" role="group" aria-label="Vowel accents">
      {VOWEL_ACCENT_OPTIONS.map((opt) => (
        <button
          key={opt.id}
          type="button"
          disabled={!accentInfo.hasTarget}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => handleAccentClick(opt.id)}
          title={opt.tooltip}
          aria-label={opt.tooltip}
          className={`flex h-5.5 min-w-[22px] items-center justify-center rounded border px-1 text-xs transition-colors disabled:opacity-35 whitespace-nowrap ${
            opt.id === 'none'
              ? 'border-[#CFC3AE] bg-[#FAF6EE] text-[10px] font-medium text-[#4F473E] hover:bg-white hover:text-[#1D1915]'
              : 'border-[#CFC3AE] bg-[#FAF6EE] font-[family-name:var(--font-serif)] text-[13px] font-semibold text-[#1D1915] hover:border-[#8B1E24] hover:bg-white hover:text-[#8B1E24]'
          }`}
        >
          {opt.id === 'none' ? 'Plain' : opt.preview}
        </button>
      ))}
    </div>
  );

  const handleDragStart = (e: React.DragEvent, payload: PaletteDragPayload) => {
    e.dataTransfer.setData('application/x-chant-item', JSON.stringify(payload));
    e.dataTransfer.effectAllowed = 'copy';
    onStartDrag(payload);
  };

  return (
    <div className="no-print shrink-0 border-b border-[#CFC3AE] bg-[#F5EFE4] select-none">
      {/* Ribbon Tab Strip */}
      <div className="flex items-center justify-between gap-2 border-b border-[#DDD3C1] bg-[#EAE2D3] px-3 sm:px-4">
        <span className="hidden sm:inline shrink-0 pr-3 font-[family-name:var(--font-display)] text-sm font-semibold tracking-wider text-[#8B1E24] uppercase">
          CHANTSCORE
        </span>
        <div
          className="flex items-end gap-0.5 self-end overflow-x-auto overflow-y-hidden -mb-px shadow-[inset_0_-1px_0_#DDD3C1]"
          role="tablist"
          aria-label="Studio Ribbon Tabs"
        >
          {TABS.map((tab) => {
            const isActive = activeTab === tab.id && !collapsed;
            const isSelectedTab = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={isSelectedTab}
                onClick={() => {
                  if (collapsed) {
                    onSelectTab(tab.id);
                    onToggleCollapse();
                  } else {
                    onSelectTab(tab.id);
                  }
                }}
                onDoubleClick={() => onToggleCollapse()}
                title={`${tab.label} tab${tab.id === 'export' ? ' (Ctrl+E)' : ''} (double-click to ${collapsed ? 'expand' : 'collapse'} ribbon)`}
                className={`relative px-3 py-1.5 text-xs font-semibold tracking-wide transition-colors whitespace-nowrap shrink-0 border-x border-t focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#8B1E24] ${
                  isActive
                    ? 'bg-[#F5EFE4] text-[#8B1E24] border-[#CFC3AE] rounded-t-md'
                    : isSelectedTab && collapsed
                    ? 'border-transparent text-[#8B1E24] underline decoration-[#B48327] decoration-2 underline-offset-4'
                    : 'border-transparent text-[#4F473E] hover:text-[#1D1915] hover:bg-[#F5EFE4]/50'
                }`}
              >
                {tab.label}{tab.id === 'export' ? ' (Ctrl+E)' : ''}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2 shrink-0 py-1">
          {backupNudgeLabel && (
            <span
              data-testid="backup-nudge-chip"
              className="inline-flex h-6 items-center gap-1 rounded border border-[#C8B084] bg-[#FAF3E3] px-1.5 text-[10.5px] font-medium text-[#6B4E16]"
            >
              <button
                type="button"
                onClick={() =>
                  onTriggerBackupAll ? onTriggerBackupAll() : onSelectTab('export')
                }
                title="Download a backup of your scores and settings"
                className="hover:underline whitespace-nowrap"
              >
                {backupNudgeLabel}
              </button>
              {onDismissBackupNudge && (
                <button
                  type="button"
                  onClick={onDismissBackupNudge}
                  aria-label="Dismiss backup reminder for 7 days"
                  title="Snooze reminder for 7 days"
                  className="ml-0.5 text-[#7A6F60] hover:text-[#1D1915]"
                >
                  ×
                </button>
              )}
            </span>
          )}
          <span
            role="status"
            title={
              saveStatus === 'saved'
                ? 'Saved locally in this browser (Ctrl+S). Use Back up everything or Save Project for a file copy.'
                : saveStatus === 'saving'
                ? 'Saving…'
                : 'Not saved: browser storage is unavailable or full. Use Save Project.'
            }
            className={`inline-flex h-6 items-center gap-1 text-[11px] ${
              saveStatus === 'failed' ? 'font-semibold text-[#B91C1C]' : 'text-[#7A6F60]'
            }`}
          >
            <Save className="h-3.5 w-3.5" />
            <span className="hidden lg:inline">
              {saveStatus === 'saved' ? 'Saved' : saveStatus === 'saving' ? 'Saving…' : 'Not saved'}
            </span>
          </span>
          <button
            type="button"
            onClick={onToggleCollapse}
            title={collapsed ? 'Expand Ribbon' : 'Collapse Ribbon'}
            aria-label={collapsed ? 'Expand Ribbon' : 'Collapse Ribbon'}
            className="inline-flex h-6 w-6 items-center justify-center rounded border border-[#CFC3AE] bg-[#FAF6EE] text-[#4F473E] hover:bg-white transition-colors"
          >
            {collapsed ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {/* Ribbon Content Area */}
      {!collapsed && (
        <div className="flex items-stretch overflow-x-auto bg-[#F5EFE4] px-2 py-1 min-h-[70px]">
          {activeTab === 'home' && (
            <>
              <RibbonGroup title="Edit Mode">
                <button
                  type="button"
                  onClick={() => onSetToolMode('select')}
                  title="Select & Move Notes (V / Esc)"
                  className={`flex h-11 min-w-[64px] flex-col items-center justify-center rounded border px-2 text-[11px] font-medium transition-colors whitespace-nowrap ${
                    toolMode === 'select'
                      ? 'border-[#8B1E24] bg-[#8B1E24] text-[#FAF6EE]'
                      : 'border-[#D7CCB8] bg-[#FAF6EE] text-[#1D1915] hover:bg-white'
                  }`}
                >
                  <MousePointer2 className="h-3.5 w-3.5 mb-0.5" />
                  <span>Select (V)</span>
                </button>
                <button
                  type="button"
                  onClick={() => onSetToolMode('insert')}
                  title="Stamp Neumes onto Staff (N)"
                  className={`flex h-11 min-w-[64px] flex-col items-center justify-center rounded border px-2 text-[11px] font-medium transition-colors whitespace-nowrap ${
                    toolMode === 'insert'
                      ? 'border-[#8B1E24] bg-[#8B1E24] text-[#FAF6EE]'
                      : 'border-[#D7CCB8] bg-[#FAF6EE] text-[#1D1915] hover:bg-white'
                  }`}
                >
                  <PenTool className="h-3.5 w-3.5 mb-0.5" />
                  <span>Insert (N)</span>
                </button>
              </RibbonGroup>

              <RibbonGroup title="History & Clipboard">
                <div className="grid grid-cols-2 gap-1 h-11 content-center">
                  <button
                    type="button"
                    disabled={!canUndo}
                    onClick={onUndo}
                    title="Undo last edit (Ctrl+Z)"
                    className="inline-flex h-[21px] items-center gap-1 rounded border border-[#D7CCB8] bg-[#FAF6EE] px-2 text-[10.5px] font-medium text-[#1D1915] hover:bg-white disabled:opacity-40 transition-colors whitespace-nowrap"
                  >
                    <Undo2 className="h-3 w-3 shrink-0" />
                    <span>Undo (Ctrl+Z)</span>
                  </button>
                  <button
                    type="button"
                    disabled={!canRedo}
                    onClick={onRedo}
                    title="Redo edit (Ctrl+Y)"
                    className="inline-flex h-[21px] items-center gap-1 rounded border border-[#D7CCB8] bg-[#FAF6EE] px-2 text-[10.5px] font-medium text-[#1D1915] hover:bg-white disabled:opacity-40 transition-colors whitespace-nowrap"
                  >
                    <Redo2 className="h-3 w-3 shrink-0" />
                    <span>Redo (Ctrl+Y)</span>
                  </button>
                  <button
                    type="button"
                    disabled={!selection}
                    onClick={onCopy}
                    title="Copy selected note or syllable (Ctrl+C)"
                    className="inline-flex h-[21px] items-center gap-1 rounded border border-[#D7CCB8] bg-[#FAF6EE] px-2 text-[10.5px] font-medium text-[#1D1915] hover:bg-white disabled:opacity-40 transition-colors whitespace-nowrap"
                  >
                    <Copy className="h-3 w-3 shrink-0" />
                    <span>Copy (Ctrl+C)</span>
                  </button>
                  <button
                    type="button"
                    disabled={!clipboard}
                    onClick={onPaste}
                    title="Paste copied notation at selection (Ctrl+V)"
                    className="inline-flex h-[21px] items-center gap-1 rounded border border-[#D7CCB8] bg-[#FAF6EE] px-2 text-[10.5px] font-medium text-[#1D1915] hover:bg-white disabled:opacity-40 transition-colors whitespace-nowrap"
                  >
                    <ClipboardPaste className="h-3 w-3 shrink-0" />
                    <span>Paste (Ctrl+V)</span>
                  </button>
                </div>
              </RibbonGroup>

              <RibbonGroup title="Score & Source">
                <button
                  type="button"
                  onClick={onNewScore}
                  title="Create a new empty Gregorian score in My scores"
                  className="flex h-11 min-w-[50px] flex-col items-center justify-center rounded border border-[#D7CCB8] bg-[#FAF6EE] px-2 text-[11px] font-medium text-[#1D1915] hover:bg-white transition-colors whitespace-nowrap"
                >
                  <FilePlus2 className="h-3.5 w-3.5 mb-0.5 text-[#8B1E24]" />
                  <span>New</span>
                </button>
                {onOpenLibrary && (
                  <button
                    type="button"
                    onClick={onOpenLibrary}
                    title="Browse, switch, rename, duplicate, or back up saved scores"
                    className="flex h-11 min-w-[66px] flex-col items-center justify-center rounded border border-[#D7CCB8] bg-[#FAF6EE] px-2 text-[11px] font-medium text-[#1D1915] hover:bg-white transition-colors whitespace-nowrap"
                  >
                    <Library className="h-3.5 w-3.5 mb-0.5 text-[#8B1E24]" />
                    <span>
                      My scores{typeof scoreCount === 'number' && scoreCount > 1 ? ` (${scoreCount})` : ''}
                    </span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() =>
                    onSetWorkspaceMode(workspaceMode === 'source' ? 'notation' : 'source')
                  }
                  title="Toggle GABC Source Editor side panel"
                  className={`flex h-11 min-w-[66px] flex-col items-center justify-center rounded border px-2 text-[11px] font-medium transition-colors whitespace-nowrap ${
                    workspaceMode === 'source'
                      ? 'border-[#8B1E24] bg-[#8B1E24]/10 text-[#6E161B]'
                      : 'border-[#D7CCB8] bg-[#FAF6EE] text-[#1D1915] hover:bg-white'
                  }`}
                >
                  <PanelRight className="h-3.5 w-3.5 mb-0.5" />
                  <span>GABC Panel</span>
                </button>
              </RibbonGroup>

              <RibbonGroup title="Typography">
                <div className="flex h-11 flex-col justify-between py-0.5">
                  <div className="flex items-center gap-1.5">
                    <span className="w-8 text-[10px] font-medium text-[#6B6257] whitespace-nowrap">
                      Lyrics
                    </span>
                    <select
                      aria-label="Lyric font family"
                      value={typography.lyricFont}
                      onChange={(e) =>
                        onChangeTypography({ lyricFont: e.target.value as ChantFontId })
                      }
                      className="h-5 w-[124px] rounded border border-[#CFC3AE] bg-[#FAF6EE] px-1 text-[11px] font-medium text-[#1D1915] focus:border-[#8B1E24] focus:outline-none"
                    >
                      {FONT_OPTIONS.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.label}
                        </option>
                      ))}
                    </select>
                    <div className="flex items-center rounded border border-[#CFC3AE] bg-[#FAF6EE]">
                      <button
                        type="button"
                        onClick={() =>
                          onChangeTypography({
                            lyricFontSize: Math.max(
                              MIN_LYRIC_FONT_SIZE,
                              Math.round((typography.lyricFontSize - 0.5) * 2) / 2
                            ),
                          })
                        }
                        title="Decrease lyric font size"
                        className="h-4.5 w-4.5 text-[11px] font-bold text-[#1D1915] hover:bg-white"
                      >
                        −
                      </button>
                      <input
                        type="number"
                        aria-label="Lyric font size"
                        min={MIN_LYRIC_FONT_SIZE}
                        max={MAX_LYRIC_FONT_SIZE}
                        step={0.5}
                        value={typography.lyricFontSize}
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          if (Number.isFinite(val)) {
                            onChangeTypography({
                              lyricFontSize: Math.max(
                                MIN_LYRIC_FONT_SIZE,
                                Math.min(MAX_LYRIC_FONT_SIZE, val)
                              ),
                            });
                          }
                        }}
                        className="h-4.5 w-9 bg-transparent text-center font-[family-name:var(--font-mono)] text-[10px] text-[#1D1915] tabular-nums focus:bg-white focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          onChangeTypography({
                            lyricFontSize: Math.min(
                              MAX_LYRIC_FONT_SIZE,
                              Math.round((typography.lyricFontSize + 0.5) * 2) / 2
                            ),
                          })
                        }
                        title="Increase lyric font size"
                        className="h-4.5 w-4.5 text-[11px] font-bold text-[#1D1915] hover:bg-white"
                      >
                        +
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <span className="w-8 text-[10px] font-medium text-[#6B6257] whitespace-nowrap">
                      Title
                    </span>
                    <select
                      aria-label="Title and drop-cap font family"
                      value={typography.titleFont}
                      onChange={(e) =>
                        onChangeTypography({ titleFont: e.target.value as ChantFontId })
                      }
                      className="h-5 w-[124px] rounded border border-[#CFC3AE] bg-[#FAF6EE] px-1 text-[11px] font-medium text-[#1D1915] focus:border-[#8B1E24] focus:outline-none"
                    >
                      {FONT_OPTIONS.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.label}
                        </option>
                      ))}
                    </select>
                    <div className="flex items-center rounded border border-[#CFC3AE] bg-[#FAF6EE]">
                      <button
                        type="button"
                        onClick={() =>
                          onChangeTypography({
                            titleFontSize: Math.max(
                              MIN_TITLE_FONT_SIZE,
                              Math.round(typography.titleFontSize - 1)
                            ),
                          })
                        }
                        title="Decrease title font size"
                        className="h-4.5 w-4.5 text-[11px] font-bold text-[#1D1915] hover:bg-white"
                      >
                        −
                      </button>
                      <input
                        type="number"
                        aria-label="Title font size"
                        min={MIN_TITLE_FONT_SIZE}
                        max={MAX_TITLE_FONT_SIZE}
                        step={1}
                        value={typography.titleFontSize}
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          if (Number.isFinite(val)) {
                            onChangeTypography({
                              titleFontSize: Math.max(
                                MIN_TITLE_FONT_SIZE,
                                Math.min(MAX_TITLE_FONT_SIZE, Math.round(val))
                              ),
                            });
                          }
                        }}
                        className="h-4.5 w-9 bg-transparent text-center font-[family-name:var(--font-mono)] text-[10px] text-[#1D1915] tabular-nums focus:bg-white focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          onChangeTypography({
                            titleFontSize: Math.min(
                              MAX_TITLE_FONT_SIZE,
                              Math.round(typography.titleFontSize + 1)
                            ),
                          })
                        }
                        title="Increase title font size"
                        className="h-4.5 w-4.5 text-[11px] font-bold text-[#1D1915] hover:bg-white"
                      >
                        +
                      </button>
                    </div>
                  </div>
                </div>
              </RibbonGroup>

              <RibbonGroup title="Header & Spacing">
                <div className="flex h-11 flex-col justify-between py-0.5">
                  <div className="flex items-center gap-2">
                    {([['Office', 'officePartFontSize'], ['Mode', 'modeFontSize']] as const).map(
                      ([label, key]) => (
                        <div key={key} className="flex items-center gap-1">
                          <span className="text-[10px] font-medium text-[#6B6257] whitespace-nowrap">
                            {label}
                          </span>
                          <div className="flex items-center rounded border border-[#CFC3AE] bg-[#FAF6EE]">
                            <button
                              type="button"
                              aria-label={`Decrease ${label} font size`}
                              onClick={() =>
                                onChangeTypography({ [key]: Math.max(8, typography[key] - 0.5) })
                              }
                              className="h-4.5 w-4.5 text-[11px] font-bold text-[#1D1915] hover:bg-white"
                            >
                              −
                            </button>
                            <input
                              type="number"
                              aria-label={`${label} font size`}
                              min={8}
                              max={48}
                              step={0.5}
                              value={typography[key]}
                              onChange={(e) => {
                                const n = Number(e.target.value);
                                if (e.target.value !== '' && Number.isFinite(n))
                                  onChangeTypography({ [key]: Math.max(8, Math.min(48, n)) });
                              }}
                              className="h-4.5 w-8 bg-transparent text-center font-[family-name:var(--font-mono)] text-[10px] text-[#1D1915] tabular-nums focus:bg-white focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                            />
                            <button
                              type="button"
                              aria-label={`Increase ${label} font size`}
                              onClick={() =>
                                onChangeTypography({ [key]: Math.min(48, typography[key] + 0.5) })
                              }
                              className="h-4.5 w-4.5 text-[11px] font-bold text-[#1D1915] hover:bg-white"
                            >
                              +
                            </button>
                          </div>
                        </div>
                      )
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-medium text-[#6B6257] whitespace-nowrap">
                        Line Space
                      </span>
                      <div className="flex items-center rounded border border-[#CFC3AE] bg-[#FAF6EE]">
                        <button
                          type="button"
                          onClick={() =>
                            onChangeTypography({
                              lineSpacing: Math.max(
                                MIN_LINE_SPACING,
                                Math.round(typography.lineSpacing - 4)
                              ),
                            })
                          }
                          title="Decrease vertical space between chant lines"
                          className="h-4.5 w-4.5 text-[11px] font-bold text-[#1D1915] hover:bg-white"
                        >
                          −
                        </button>
                        <input
                          type="number"
                          aria-label="Space between lines"
                          min={MIN_LINE_SPACING}
                          max={MAX_LINE_SPACING}
                          step={2}
                          value={typography.lineSpacing}
                          onChange={(e) => {
                            const val = Number(e.target.value);
                            if (Number.isFinite(val)) {
                              onChangeTypography({
                                lineSpacing: Math.max(
                                  MIN_LINE_SPACING,
                                  Math.min(MAX_LINE_SPACING, Math.round(val))
                                ),
                              });
                            }
                          }}
                          className="h-4.5 w-9 bg-transparent text-center font-[family-name:var(--font-mono)] text-[10px] text-[#1D1915] tabular-nums focus:bg-white focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            onChangeTypography({
                              lineSpacing: Math.min(
                                MAX_LINE_SPACING,
                                Math.round(typography.lineSpacing + 4)
                              ),
                            })
                          }
                          title="Increase vertical space between chant lines"
                          className="h-4.5 w-4.5 text-[11px] font-bold text-[#1D1915] hover:bg-white"
                        >
                          +
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-medium text-[#6B6257] whitespace-nowrap">
                        Word spacing
                      </span>
                      <div
                        role="group"
                        aria-label="Word spacing"
                        className="inline-flex items-center rounded border border-[#CFC3AE] bg-[#EFE8DA] p-0.5"
                      >
                        {WORD_SPACING_OPTIONS.map((opt) => {
                          const active = (typography.wordSpacing ?? 'normal') === opt.id;
                          return (
                            <button
                              key={opt.id}
                              type="button"
                              aria-pressed={active}
                              title={opt.tooltip}
                              onClick={() => onChangeTypography({ wordSpacing: opt.id })}
                              className={`rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors whitespace-nowrap focus-visible:outline-2 focus-visible:outline-[#8B1E24] ${
                                active
                                  ? 'bg-[#8B1E24] text-[#FAF6EE]'
                                  : 'text-[#4F473E] hover:bg-[#FAF6EE] hover:text-[#1D1915]'
                              }`}
                            >
                              {opt.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              </RibbonGroup>
            </>
          )}

          {activeTab === 'neumes' && (
            <>
              <RibbonGroup title="Single Notes">
                {SINGLE_NOTES.map((item) => {
                  const active = toolMode === 'insert' && activePreset === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      draggable
                      onDragStart={(e) => handleDragStart(e, { kind: 'neume', preset: item.id })}
                      onDragEnd={onEndDrag}
                      onClick={() => onSelectPreset(item.id)}
                      title={`${item.label}${item.shortcut ? ` (${item.shortcut})` : ''} — click staff or drag`}
                      className={`relative flex h-11 min-w-[50px] flex-col items-center justify-center rounded border px-1.5 py-0.5 transition-colors cursor-grab active:cursor-grabbing ${
                        active
                          ? 'border-[#8B1E24] bg-[#8B1E24]/12 text-[#6E161B]'
                          : 'border-[#D7CCB8] bg-[#FAF6EE] text-[#1D1915] hover:bg-white'
                      }`}
                    >
                      {item.shortcut && (
                        <span
                          aria-hidden="true"
                          className={`absolute top-0.5 right-1 font-[family-name:var(--font-mono)] text-[9px] leading-none ${
                            active ? 'text-[#8B1E24]' : 'text-[#7A6F60]'
                          }`}
                        >
                          {item.shortcut}
                        </span>
                      )}
                      <MiniNeumePreview
                        preset={item.id}
                        anchorPitch={item.anchorPitch}
                        width={34}
                        height={25}
                        color={active ? '#6E161B' : INK_BLACK}
                      />
                      <span className="text-[10px] font-medium leading-none whitespace-nowrap">
                        {item.label}
                      </span>
                    </button>
                  );
                })}
              </RibbonGroup>

              <RibbonGroup title="Compound Neumes">
                {[...TWO_NOTE_NEUMES, ...THREE_NOTE_NEUMES].map((item) => {
                  const active = toolMode === 'insert' && activePreset === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      draggable
                      onDragStart={(e) => handleDragStart(e, { kind: 'neume', preset: item.id })}
                      onDragEnd={onEndDrag}
                      onClick={() => onSelectPreset(item.id)}
                      title={`${item.label}${item.shortcut ? ` (${item.shortcut})` : ''} — click staff or drag`}
                      className={`relative flex h-11 min-w-[52px] flex-col items-center justify-center rounded border px-1.5 py-0.5 transition-colors cursor-grab active:cursor-grabbing ${
                        active
                          ? 'border-[#8B1E24] bg-[#8B1E24]/12 text-[#6E161B]'
                          : 'border-[#D7CCB8] bg-[#FAF6EE] text-[#1D1915] hover:bg-white'
                      }`}
                    >
                      {item.shortcut && (
                        <span
                          aria-hidden="true"
                          className={`absolute top-0.5 right-1 font-[family-name:var(--font-mono)] text-[9px] leading-none ${
                            active ? 'text-[#8B1E24]' : 'text-[#7A6F60]'
                          }`}
                        >
                          {item.shortcut}
                        </span>
                      )}
                      <MiniNeumePreview
                        preset={item.id}
                        anchorPitch={item.anchorPitch}
                        width={36}
                        height={25}
                        color={active ? '#6E161B' : INK_BLACK}
                      />
                      <span className="text-[10px] font-medium leading-none whitespace-nowrap">
                        {item.label}
                      </span>
                    </button>
                  );
                })}
              </RibbonGroup>
            </>
          )}

          {activeTab === 'notation' && (
            <>
              <RibbonGroup title="Clefs">
                {CLEFS.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    draggable
                    onDragStart={(e) => handleDragStart(e, { kind: 'clef', clef: c.id })}
                    onDragEnd={onEndDrag}
                    onClick={() => onSelectClef(c.id)}
                    title={`Set or insert ${c.label} clef`}
                    className="flex h-11 min-w-[44px] flex-col items-center justify-center rounded border border-[#D7CCB8] bg-[#FAF6EE] px-1 py-0.5 text-[#1D1915] hover:bg-white transition-colors cursor-grab active:cursor-grabbing"
                  >
                    <MiniClefPreview clef={c.id} width={32} height={25} />
                    <span className="text-[10px] font-medium leading-none whitespace-nowrap">
                      {c.label}
                    </span>
                  </button>
                ))}
              </RibbonGroup>

              <RibbonGroup title="Divisions & Breaks">
                {DIVISIONS.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    draggable
                    onDragStart={(e) => handleDragStart(e, { kind: 'division', division: d.id })}
                    onDragEnd={onEndDrag}
                    onClick={() => onInsertDivision(d.id)}
                    title={`Insert ${d.label} division (${d.id})`}
                    className="flex h-11 min-w-[44px] flex-col items-center justify-center rounded border border-[#D7CCB8] bg-[#FAF6EE] px-1 py-0.5 text-[#1D1915] hover:bg-white transition-colors cursor-grab active:cursor-grabbing"
                  >
                    <MiniDivisionPreview division={d.id} width={30} height={25} />
                    <span className="text-[10px] font-medium leading-none whitespace-nowrap">
                      {d.label}
                    </span>
                  </button>
                ))}
                <button
                  type="button"
                  onClick={onInsertLineBreak}
                  title="Insert forced line break (z)"
                  className="flex h-11 min-w-[44px] flex-col items-center justify-center rounded border border-[#D7CCB8] bg-[#FAF6EE] px-1.5 text-[#1D1915] hover:bg-white transition-colors"
                >
                  <span className="font-[family-name:var(--font-mono)] text-sm font-semibold text-[#8B1E24]">
                    ↵
                  </span>
                  <span className="text-[10px] font-medium leading-none whitespace-nowrap">
                    Break
                  </span>
                </button>
              </RibbonGroup>

              <RibbonGroup title="Rhythm, Accidentals & Liquescent">
                {MODIFIERS.map((m) => {
                  const active = activeModifiers[m.id];
                  const disabled = selectedRefs.length === 0;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      disabled={disabled}
                      onClick={() => onToggleModifier(m.id)}
                      title={`Toggle ${m.label}${m.shortcut ? ` (${m.shortcut})` : ''}`}
                      className={`flex h-11 min-w-[48px] flex-col items-center justify-center rounded border px-1.5 py-0.5 transition-colors ${
                        disabled
                          ? 'border-[#DFD6C7] bg-[#EAE2D4] text-[#9A8E7D] opacity-65 cursor-not-allowed'
                          : active
                          ? 'border-[#8B1E24] bg-[#8B1E24] text-[#FAF6EE]'
                          : 'border-[#D7CCB8] bg-[#FAF6EE] text-[#1D1915] hover:bg-white'
                      }`}
                    >
                      <MiniModifierPreview modifier={m.id} active={active} width={32} height={25} />
                      <span className="text-[10px] font-medium leading-none whitespace-nowrap">
                        {m.label}{m.shortcut ? ` (${m.shortcut})` : ''}
                      </span>
                    </button>
                  );
                })}
              </RibbonGroup>
            </>
          )}

          {activeTab === 'tones' &&
            (!toneController ? (
              <div className="flex h-11 items-center px-3 text-xs text-[#6B6257]">
                Loading tones…
              </div>
            ) : (
              (() => {
                const psalmTones = toneController.catalog?.psalmTones ?? [];
                const readingTones = toneController.catalog?.readingTones ?? [];
                const prefaceTones = toneController.catalog?.prefaceTones ?? [];
                const openingFormulas = toneController.catalog?.readingOpeningFormulas ?? [];
                const formatPsalmLabel =
                  toneController.catalog?.psalmToneLabel ?? ((id: string) => id);
                return (
                  <>
                    <RibbonGroup title="Type">
                      <div className="flex h-11 items-center gap-1">
                        {(
                          [
                            { id: 'psalm', label: 'Psalm' },
                            { id: 'reading', label: 'Reading' },
                            { id: 'preface', label: 'Preface' },
                          ] as const
                        ).map((modeOpt) => {
                          const active = toneController.saved.mode === modeOpt.id;
                          return (
                            <button
                              key={modeOpt.id}
                              type="button"
                              aria-pressed={active}
                              onClick={() => toneController.setMode(modeOpt.id)}
                              className={`h-8 rounded border px-2.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                                active
                                  ? 'border-[#8B1E24] bg-[#8B1E24] text-[#FAF6EE]'
                                  : 'border-[#D7CCB8] bg-[#FAF6EE] text-[#1D1915] hover:bg-white'
                              }`}
                            >
                              {modeOpt.label}
                            </button>
                          );
                        })}
                      </div>
                    </RibbonGroup>

                    <RibbonGroup title="Tone">
                      <div className="flex h-11 items-center gap-2 px-0.5 text-[11px]">
                        {toneController.saved.mode === 'psalm' ? (
                          <>
                            <label className="flex flex-col gap-0.5">
                              <span className="text-[10px] font-medium text-[#6B6257]">
                                Built-in
                              </span>
                              <select
                                aria-label="Built-in psalm tone"
                                value={toneController.saved.psalmTone}
                                onChange={(e) =>
                                  toneController.loadPsalmTone(
                                    e.target.value,
                                    toneController.saved.psalmEnding,
                                    toneController.saved.psalmSolemn
                                  )
                                }
                                className="h-6 rounded border border-[#CFC3AE] bg-[#FAF6EE] px-1.5 text-[11px] font-medium text-[#1D1915] focus:border-[#8B1E24] focus:outline-none"
                              >
                                <option value="">Custom (edit below)</option>
                                {psalmTones.map((t) => (
                                  <option key={t.id} value={t.id}>
                                    {formatPsalmLabel(t.id, '', false)}
                                  </option>
                                ))}
                              </select>
                            </label>

                            {toneController.saved.psalmTone && (
                              <>
                                <label className="flex flex-col gap-0.5">
                                  <span className="text-[10px] font-medium text-[#6B6257]">
                                    Ending
                                  </span>
                                  <select
                                    aria-label="Psalm tone ending"
                                    value={toneController.saved.psalmEnding}
                                    onChange={(e) =>
                                      toneController.loadPsalmTone(
                                        toneController.saved.psalmTone,
                                        e.target.value,
                                        toneController.saved.psalmSolemn
                                      )
                                    }
                                    className="h-6 rounded border border-[#CFC3AE] bg-[#FAF6EE] px-1.5 text-[11px] font-medium text-[#1D1915] focus:border-[#8B1E24] focus:outline-none"
                                  >
                                    {(
                                      psalmTones.find(
                                        (t) => t.id === toneController.saved.psalmTone
                                      )?.endings ?? []
                                    ).map((end) => (
                                      <option key={end} value={end}>
                                        {end || 'standard'}
                                      </option>
                                    ))}
                                  </select>
                                </label>

                                {psalmTones.find((t) => t.id === toneController.saved.psalmTone)
                                  ?.hasSolemn && (
                                  <label className="mt-3 flex items-center gap-1 text-[11px] font-medium text-[#1D1915] whitespace-nowrap cursor-pointer">
                                    <input
                                      type="checkbox"
                                      checked={toneController.saved.psalmSolemn}
                                      onChange={(e) =>
                                        toneController.loadPsalmTone(
                                          toneController.saved.psalmTone,
                                          toneController.saved.psalmEnding,
                                          e.target.checked
                                        )
                                      }
                                      className="accent-[#8B1E24]"
                                    />
                                    <span>Solemn mediant</span>
                                  </label>
                                )}
                              </>
                            )}
                          </>
                        ) : toneController.saved.mode === 'reading' ? (
                          <>
                            <label className="flex flex-col gap-0.5">
                              <span className="text-[10px] font-medium text-[#6B6257]">
                                Built-in
                              </span>
                              <select
                                aria-label="Built-in reading tone"
                                value={toneController.saved.readingTone}
                                onChange={(e) => toneController.loadReadingTone(e.target.value)}
                                className="h-6 rounded border border-[#CFC3AE] bg-[#FAF6EE] px-1.5 text-[11px] font-medium text-[#1D1915] focus:border-[#8B1E24] focus:outline-none"
                              >
                                <option value="">Custom (edit below)</option>
                                {readingTones.map((t) => (
                                  <option key={t.id} value={t.id}>
                                    {t.label}
                                  </option>
                                ))}
                              </select>
                            </label>

                            {!toneController.isPrefaceWorkflow && language === 'la' && (
                              <label className="flex flex-col gap-0.5">
                                <span className="text-[10px] font-medium text-[#6B6257]">
                                  Opening formula
                                </span>
                                <select
                                  aria-label="Opening formula"
                                  value={toneController.saved.readingOpeningFormula}
                                  onChange={(e) =>
                                    toneController.setReadingOpeningFormula(e.target.value)
                                  }
                                  className="h-6 rounded border border-[#CFC3AE] bg-[#FAF6EE] px-1.5 text-[11px] font-medium text-[#1D1915] focus:border-[#8B1E24] focus:outline-none"
                                >
                                  <option value="">None</option>
                                  {openingFormulas.map((f) => (
                                    <option key={f.id} value={f.id}>
                                      {f.text}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            )}
                          </>
                        ) : (
                          <>
                            <label className="flex flex-col gap-0.5">
                              <span className="text-[10px] font-medium text-[#6B6257]">
                                Built-in
                              </span>
                              <select
                                aria-label="Built-in preface tone"
                                value={toneController.saved.prefaceTone}
                                onChange={(e) => toneController.loadPrefaceTone(e.target.value)}
                                className="h-6 rounded border border-[#CFC3AE] bg-[#FAF6EE] px-1.5 text-[11px] font-medium text-[#1D1915] focus:border-[#8B1E24] focus:outline-none"
                              >
                                <option value="">Custom (edit below)</option>
                                {prefaceTones.map((t) => (
                                  <option key={t.id} value={t.id}>
                                    {t.label}
                                  </option>
                                ))}
                              </select>
                            </label>
                          </>
                        )}
                      </div>
                    </RibbonGroup>

                    {toneController.saved.mode === 'psalm' && (
                      <RibbonGroup title="Options">
                        <div className="flex h-11 items-center gap-2.5 text-[11px] whitespace-nowrap">
                          <label className="flex items-center gap-1 cursor-pointer text-[#1D1915]">
                            <input
                              type="checkbox"
                              checked={toneController.saved.gloriaPatri}
                              onChange={(e) =>
                                toneController.update({ gloriaPatri: e.target.checked })
                              }
                              className="accent-[#8B1E24]"
                            />
                            <span>Gloria Patri</span>
                          </label>
                          <label className="flex items-center gap-1 cursor-pointer text-[#1D1915]">
                            <input
                              type="checkbox"
                              checked={toneController.saved.repeatIntonation}
                              onChange={(e) =>
                                toneController.update({ repeatIntonation: e.target.checked })
                              }
                              className="accent-[#8B1E24]"
                            />
                            <span>Repeat intonation</span>
                          </label>
                          <label className="flex items-center gap-1 cursor-pointer text-[#1D1915]">
                            <input
                              type="checkbox"
                              checked={toneController.saved.autoFlex}
                              onChange={(e) =>
                                toneController.update({ autoFlex: e.target.checked })
                              }
                              className="accent-[#8B1E24]"
                            />
                            <span>Auto flex</span>
                          </label>
                        </div>
                      </RibbonGroup>
                    )}

                    <RibbonGroup title="Language">
                      <div
                        className="flex h-11 items-center gap-1"
                        role="group"
                        aria-label="Text language"
                      >
                        {(
                          [
                            { id: 'la', label: 'Latin' },
                            { id: 'en', label: 'English' },
                          ] as const
                        ).map((langOpt) => {
                          const active = language === langOpt.id;
                          return (
                            <button
                              key={langOpt.id}
                              type="button"
                              aria-pressed={active}
                              onClick={() => onChangeLanguage(langOpt.id)}
                              className={`h-8 rounded border px-2.5 text-xs font-medium transition-colors whitespace-nowrap ${
                                active
                                  ? 'border-[#8B1E24] bg-[#8B1E24] text-[#FAF6EE]'
                                  : 'border-[#D7CCB8] bg-[#FAF6EE] text-[#1D1915] hover:bg-white'
                              }`}
                            >
                              {langOpt.label}
                            </button>
                          );
                        })}
                      </div>
                    </RibbonGroup>

                    <RibbonGroup title="Text Panel">
                      <div className="flex h-11 items-center">
                        <button
                          type="button"
                          aria-expanded={toneController.dockOpen}
                          onClick={() => toneController.setDockOpen((open) => !open)}
                          title={
                            toneController.dockOpen
                              ? 'Collapse tone text and definition panel'
                              : 'Expand tone text and definition panel'
                          }
                          className="inline-flex h-8 items-center gap-1 rounded border border-[#D7CCB8] bg-[#FAF6EE] px-2.5 text-[11px] font-medium text-[#1D1915] hover:bg-white transition-colors whitespace-nowrap"
                        >
                          {toneController.dockOpen ? (
                            <ChevronUp className="h-3.5 w-3.5" />
                          ) : (
                            <ChevronDown className="h-3.5 w-3.5" />
                          )}
                          <span>{toneController.dockOpen ? 'Hide text' : 'Show text'}</span>
                        </button>
                      </div>
                    </RibbonGroup>
                  </>
                );
              })()
            ))}

          {activeTab === 'playback' && (
            <>
              <RibbonGroup title="Transport">
                {isPlaying ? (
                  <button
                    type="button"
                    onClick={onPause}
                    title="Pause playback (Space)"
                    className="flex h-11 min-w-[70px] flex-col items-center justify-center rounded border border-[#9E701C] bg-[#B48327] px-2.5 text-[11px] font-semibold text-[#1C1917] hover:bg-[#C69333] whitespace-nowrap"
                  >
                    <Pause className="h-3.5 w-3.5 mb-0.5 fill-current" />
                    <span>Pause (Space)</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={onPlay}
                    title={
                      isPaused
                        ? playStartNoteId
                          ? 'Resume playback from selected note (Space)'
                          : 'Resume playback (Space)'
                        : 'Play chant (Space)'
                    }
                    className="flex h-11 min-w-[70px] flex-col items-center justify-center rounded border border-[#72171B] bg-[#8B1E24] px-2.5 text-[11px] font-semibold text-[#FAF6EE] hover:bg-[#A1252B] whitespace-nowrap"
                  >
                    <Play className="h-3.5 w-3.5 mb-0.5 fill-current" />
                    <span>{isPaused ? 'Resume (Space)' : 'Play (Space)'}</span>
                  </button>
                )}
                <button
                  type="button"
                  disabled={!isPlaying && !isPaused}
                  onClick={onStop}
                  title="Stop playback and reset to start"
                  aria-label="Stop playback"
                  className="flex h-11 min-w-[46px] flex-col items-center justify-center rounded border border-[#D7CCB8] bg-[#FAF6EE] px-2 text-[11px] font-medium text-[#1D1915] hover:bg-white disabled:opacity-40"
                >
                  <Square className="h-3.5 w-3.5 mb-0.5 fill-current" />
                  <span>Stop</span>
                </button>
                {playStartNoteId && (
                  <button
                    type="button"
                    onClick={() => onPlayFromSelection(playStartNoteId)}
                    title="Start organ playback from selected note"
                    className="flex h-11 min-w-[68px] flex-col items-center justify-center rounded border border-[#D7CCB8] bg-[#FAF6EE] px-2 text-[11px] font-medium text-[#1D1915] hover:bg-white whitespace-nowrap"
                  >
                    <Play className="h-3.5 w-3.5 mb-0.5 text-[#8B1E24]" />
                    <span>From Note</span>
                  </button>
                )}
              </RibbonGroup>

              <RibbonGroup title="Position & Note">
                <div className="flex h-11 flex-col justify-center gap-1 px-0.5 min-w-[185px]">
                  <div className="flex items-center gap-1.5">
                    <span className="font-[family-name:var(--font-mono)] text-[11px] tabular-nums text-[#4F473E] whitespace-nowrap">
                      {formatTime(elapsedSec)}
                    </span>
                    <input
                      type="range"
                      aria-label="Playback position"
                      min={0}
                      max={Math.max(1, totalDurationSec)}
                      step={0.1}
                      value={Math.min(elapsedSec, totalDurationSec || 1)}
                      onChange={(e) => onSeek(Number(e.target.value))}
                      disabled={totalDurationSec <= 0}
                      className="h-1.5 w-28 cursor-pointer accent-[#8B1E24] disabled:opacity-40"
                    />
                    <span className="font-[family-name:var(--font-mono)] text-[11px] tabular-nums text-[#6B6257] whitespace-nowrap">
                      {formatTime(totalDurationSec)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[10.5px]">
                    <span className="text-[#6B6257]">Active note</span>
                    <span className="font-[family-name:var(--font-mono)] font-medium text-[#8B1E24] tabular-nums">
                      {activeNoteLabel || '—'}
                    </span>
                  </div>
                </div>
              </RibbonGroup>

              <RibbonGroup title="Organ Registration">
                {(['flute', 'pipe', 'wind'] as OrganType[]).map((orgKey) => {
                  const prof = ORGAN_PROFILES[orgKey];
                  const active = organ === orgKey;
                  return (
                    <button
                      key={orgKey}
                      type="button"
                      aria-pressed={active}
                      onClick={() => onChangeOrgan(orgKey)}
                      title={prof.subtitle}
                      className={`flex h-11 flex-col items-start justify-center rounded border px-2.5 text-left transition-colors whitespace-nowrap ${
                        active
                          ? 'border-[#8B1E24] bg-[#8B1E24] text-[#FAF6EE]'
                          : 'border-[#D7CCB8] bg-[#FAF6EE] text-[#1D1915] hover:bg-white'
                      }`}
                    >
                      <span className="text-[11px] font-semibold leading-tight">{prof.label}</span>
                      <span
                        className={`text-[9.5px] leading-tight ${
                          active ? 'text-[#FAF6EE]/80' : 'text-[#6B6257]'
                        }`}
                      >
                        {orgKey === 'flute'
                          ? "8' Rohrflöte"
                          : orgKey === 'pipe'
                          ? "16' Bourdon"
                          : "8' Aeoline"}
                      </span>
                    </button>
                  );
                })}
              </RibbonGroup>

              <RibbonGroup title="Tempo, Pitch & Volume">
                <div className="flex h-11 items-center gap-2.5 px-0.5 text-xs">
                  <div className="flex items-center gap-1">
                    <label htmlFor="ribbon-playback-tempo" className="text-[11px] text-[#5C5349]">
                      Tempo
                    </label>
                    <input
                      id="ribbon-playback-tempo"
                      type="range"
                      aria-label="Tempo BPM"
                      min={40}
                      max={200}
                      value={tempoBpm}
                      onChange={(e) => onChangeTempo(Number(e.target.value))}
                      className="w-20 accent-[#8B1E24] cursor-pointer"
                    />
                    <span className="w-12 font-[family-name:var(--font-mono)] text-[11px] tabular-nums">
                      {tempoBpm} bpm
                    </span>
                  </div>
                  <div className="flex items-center gap-1 border-l border-[#D6CBB8] pl-2.5">
                    <span className="text-[11px] text-[#5C5349]">Transpose</span>
                    <button
                      type="button"
                      aria-label="Transpose down 1 semitone"
                      title="Transpose down 1 semitone"
                      onClick={() => onChangeTranspose(-1)}
                      className="h-5.5 w-5.5 rounded border border-[#CFC3AE] bg-[#FAF6EE] hover:bg-white"
                    >
                      −
                    </button>
                    <span className="w-6 text-center font-[family-name:var(--font-mono)] text-[11px] tabular-nums">
                      {transpose > 0 ? `+${transpose}` : transpose}
                    </span>
                    <button
                      type="button"
                      aria-label="Transpose up 1 semitone"
                      title="Transpose up 1 semitone"
                      onClick={() => onChangeTranspose(1)}
                      className="h-5.5 w-5.5 rounded border border-[#CFC3AE] bg-[#FAF6EE] hover:bg-white"
                    >
                      +
                    </button>
                  </div>
                  <div className="flex items-center gap-1 border-l border-[#D6CBB8] pl-2.5">
                    <button
                      type="button"
                      onClick={onToggleMute}
                      aria-label={muted ? 'Unmute organ' : 'Mute organ'}
                      className="text-[#4F473E] hover:text-[#1D1915]"
                      title={muted ? 'Unmute' : 'Mute'}
                    >
                      {muted || volume === 0 ? (
                        <VolumeX className="h-4 w-4 text-[#8B1E24]" />
                      ) : (
                        <Volume2 className="h-4 w-4" />
                      )}
                    </button>
                    <input
                      type="range"
                      aria-label="Master volume"
                      min={0}
                      max={100}
                      value={muted ? 0 : Math.round(volume * 100)}
                      onChange={(e) => onChangeVolume(Number(e.target.value) / 100)}
                      className="w-14 accent-[#8B1E24] cursor-pointer"
                    />
                  </div>
                </div>
              </RibbonGroup>
            </>
          )}

          {activeTab === 'export' && (
            <>
              <RibbonGroup title="Sheet Style">
                <div className="flex h-11 flex-col justify-between py-0.5">
                  <div className="flex items-center gap-1" role="group" aria-label="Sheet style">
                    {(
                      [
                        {
                          id: 'missal',
                          label: 'Missal Folio',
                          title: 'Archival parchment (#FAF6EE) with rubric red accents',
                        },
                        {
                          id: 'sheet',
                          label: 'Sheet · Black',
                          title: 'Monochrome black ink Chant Sheet',
                        },
                        {
                          id: 'sheet-red',
                          label: 'Sheet · Red',
                          title: 'Two-color liturgical Chant Sheet (red staff & rubrics)',
                        },
                      ] as const
                    ).map((st) => {
                      const active = exportStyle === st.id;
                      return (
                        <button
                          key={st.id}
                          type="button"
                          aria-pressed={active}
                          onClick={() => onChangeExportStyle(st.id)}
                          title={st.title}
                          className={`h-5.5 rounded border px-2 text-[10.5px] font-medium transition-colors whitespace-nowrap ${
                            active
                              ? 'border-[#8B1E24] bg-[#8B1E24] text-[#FAF6EE]'
                              : 'border-[#CFC3AE] bg-[#FAF6EE] text-[#1D1915] hover:bg-white'
                          }`}
                        >
                          {st.label}
                        </button>
                      );
                    })}
                  </div>
                  <label
                    title="Export PNG with transparent background instead of white/parchment"
                    className="inline-flex items-center gap-1.5 text-[10.5px] font-medium text-[#4F473E] cursor-pointer whitespace-nowrap"
                  >
                    <input
                      type="checkbox"
                      checked={transparentPng}
                      onChange={onToggleTransparentPng}
                      className="accent-[#8B1E24]"
                    />
                    <span>Transparent PNG background</span>
                  </label>
                </div>
              </RibbonGroup>

              <RibbonGroup title="Page Setup">
                <div className="flex h-11 flex-col justify-between py-0.5">
                  <select
                    aria-label="Page size"
                    value={pageSetup.pageSize}
                    onChange={(e) =>
                      onChangePageSetup({ pageSize: e.target.value as PageSizeId })
                    }
                    className="h-5.5 w-[150px] rounded border border-[#CFC3AE] bg-[#FAF6EE] px-1.5 text-[11px] font-medium text-[#1D1915] focus:border-[#8B1E24] focus:outline-none"
                  >
                    {PAGE_SIZE_SPECS.map((spec) => (
                      <option key={spec.id} value={spec.id}>
                        {spec.label}
                      </option>
                    ))}
                  </select>
                  <div className="flex items-center gap-1">
                    {(['portrait', 'landscape'] as const).map((orient) => {
                      const active = pageSetup.orientation === orient;
                      return (
                        <button
                          key={orient}
                          type="button"
                          aria-pressed={active}
                          onClick={() => onChangePageSetup({ orientation: orient })}
                          className={`flex-1 h-4.5 rounded border px-2 text-[10px] font-medium capitalize transition-colors whitespace-nowrap ${
                            active
                              ? 'border-[#8B1E24] bg-[#8B1E24] text-[#FAF6EE]'
                              : 'border-[#CFC3AE] bg-[#FAF6EE] text-[#1D1915] hover:bg-white'
                          }`}
                        >
                          {orient}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </RibbonGroup>

              <RibbonGroup title="Document, Project & Audio">
                <div className="grid grid-cols-4 gap-1 h-11 content-center">
                  {(
                    [
                      { id: 'gabc', label: 'GABC', ext: '.gabc', icon: FileCode2 },
                      { id: 'pdf', label: 'PDF', ext: '.pdf', icon: FileText },
                      {
                        id: 'png',
                        label: 'PNG',
                        ext: transparentPng ? '.png (α)' : '.png',
                        icon: FileImage,
                      },
                      { id: 'mp3', label: 'Organ MP3', ext: '.mp3', icon: FileAudio },
                      { id: 'project', label: 'Save Project', ext: '.json', icon: Save },
                      { id: 'openproject', label: 'Open Project', ext: '.json', icon: FolderOpen },
                      { id: 'link', label: 'Share Link', ext: 'URL', icon: Link2 },
                      {
                        id: 'sourceandsummit',
                        label: 'Source & Summit',
                        ext: 'Web',
                        icon: ExternalLink,
                      },
                    ] as const
                  ).map((fmt) => {
                    const Icon = fmt.icon;
                    const isBusy = busyExport === fmt.id;
                    return (
                      <button
                        key={fmt.id}
                        type="button"
                        disabled={busyExport !== null}
                        onClick={() => onExport(fmt.id)}
                        title={
                          fmt.id === 'png'
                            ? `Download score as PNG (${fmt.ext}, ZIP archive when multi-page)`
                            : fmt.id === 'sourceandsummit'
                            ? 'Open Source & Summit Score Editor in a new tab with GABC loaded'
                            : `${fmt.label} (${fmt.ext})`
                        }
                        className="inline-flex h-[21px] items-center gap-1 rounded border border-[#D7CCB8] bg-[#FAF6EE] px-2 text-[10.5px] font-medium text-[#1D1915] hover:bg-white disabled:opacity-50 transition-colors whitespace-nowrap"
                      >
                        {isBusy ? (
                          <Loader2 className="h-3 w-3 shrink-0 animate-spin text-[#8B1E24]" />
                        ) : (
                          <Icon className="h-3 w-3 shrink-0 text-[#8B1E24]" />
                        )}
                        <span>{fmt.label}</span>
                      </button>
                    );
                  })}
                </div>
              </RibbonGroup>

              <RibbonGroup title="Print & Initial">
                <button
                  type="button"
                  onClick={onPrint}
                  title="Print missal folio page (Ctrl+P)"
                  className="flex h-11 min-w-[74px] flex-col items-center justify-center rounded border border-[#D7CCB8] bg-[#FAF6EE] px-2.5 text-[11px] font-medium text-[#1D1915] hover:bg-white transition-colors whitespace-nowrap"
                >
                  <Printer className="h-3.5 w-3.5 mb-0.5 text-[#8B1E24]" />
                  <span>Print (Ctrl+P)</span>
                </button>
                <button
                  type="button"
                  onClick={onToggleDropCap}
                  title="Toggle illuminated rubric drop-cap initial on first syllable"
                  className={`flex h-11 items-center gap-1.5 rounded border px-2.5 text-[11px] font-medium transition-colors whitespace-nowrap ${
                    score.header.initialStyle !== '0'
                      ? 'border-[#8B1E24] bg-[#8B1E24]/10 text-[#6E161B]'
                      : 'border-[#D7CCB8] bg-[#FAF6EE] text-[#1D1915] hover:bg-white'
                  }`}
                >
                  <span className="font-[family-name:var(--font-display)] text-sm font-bold text-[#8B1E24]">
                    A
                  </span>
                  <span>Drop Cap: {score.header.initialStyle !== '0' ? 'On' : 'Off'}</span>
                </button>
              </RibbonGroup>

              {(onOpenLibrary || onTriggerBackupAll) && (
                <RibbonGroup title="Library & Backup">
                  {onOpenLibrary && (
                    <button
                      type="button"
                      onClick={onOpenLibrary}
                      title="Open My scores library, restore backups, or manage scores"
                      className="flex h-11 min-w-[68px] flex-col items-center justify-center rounded border border-[#D7CCB8] bg-[#FAF6EE] px-2 text-[11px] font-medium text-[#1D1915] hover:bg-white transition-colors whitespace-nowrap"
                    >
                      <Library className="h-3.5 w-3.5 mb-0.5 text-[#8B1E24]" />
                      <span>My scores</span>
                    </button>
                  )}
                  {onTriggerBackupAll && (
                    <button
                      type="button"
                      onClick={onTriggerBackupAll}
                      title="Download a single backup file of all saved scores, tone settings, and templates"
                      className="flex h-11 min-w-[78px] flex-col items-center justify-center rounded border border-[#D7CCB8] bg-[#FAF6EE] px-2 text-[11px] font-medium text-[#1D1915] hover:bg-white transition-colors whitespace-nowrap"
                    >
                      <Archive className="h-3.5 w-3.5 mb-0.5 text-[#8B1E24]" />
                      <span>Back up all</span>
                    </button>
                  )}
                </RibbonGroup>
              )}
            </>
          )}
        </div>
      )}

      {/* Slim Dedicated Contextual Selection Bar (never scrolls ribbon or duplicates active tab controls) */}
      {!collapsed && (selectedItem || textSelection) && (
        <div
          className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[#DDD3C1] bg-[#EFE6D5] px-3 py-1 text-[11px]"
          aria-label="Selection contextual controls"
        >
          {selectedSyllable ? (
            <>
              <div className="flex items-center gap-1.5">
                <span className="font-semibold text-[#8B1E24] tabular-nums whitespace-nowrap">
                  {isMultiSelect
                    ? `${selectedRefs.length} Notes`
                    : pitchInfo
                    ? `${pitchInfo.solfege} · ${pitchInfo.noteName}`
                    : 'Syllable'}
                </span>
                {!isMultiSelect && pitchInfo && (
                  <span className="font-[family-name:var(--font-mono)] text-[10px] text-[#6B6257]">
                    ({pitchInfo.gabcChar})
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => onShiftPitch(1)}
                  title="Raise pitch 1 step (Arrow Up)"
                  className="inline-flex h-5.5 w-5.5 items-center justify-center rounded border border-[#CFC3AE] bg-[#FAF6EE] text-[#1D1915] hover:bg-white"
                >
                  <ArrowUp className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() => onShiftPitch(-1)}
                  title="Lower pitch 1 step (Arrow Down)"
                  className="inline-flex h-5.5 w-5.5 items-center justify-center rounded border border-[#CFC3AE] bg-[#FAF6EE] text-[#1D1915] hover:bg-white"
                >
                  <ArrowDown className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  disabled={!canSplitGroup}
                  onClick={onSplitGroup}
                  title="Split note into a separate neume group"
                  className="inline-flex h-5.5 items-center gap-1 rounded border border-[#CFC3AE] bg-[#FAF6EE] px-1.5 text-[10.5px] font-medium text-[#1D1915] hover:bg-white disabled:opacity-35 whitespace-nowrap"
                >
                  <Unlink className="h-2.5 w-2.5" />
                  <span>Ungroup</span>
                </button>
                <button
                  type="button"
                  disabled={!canMergeGroup}
                  onClick={onMergeGroup}
                  title="Join with previous neume group"
                  className="inline-flex h-5.5 items-center gap-1 rounded border border-[#CFC3AE] bg-[#FAF6EE] px-1.5 text-[10.5px] font-medium text-[#1D1915] hover:bg-white disabled:opacity-35 whitespace-nowrap"
                >
                  <Link2 className="h-2.5 w-2.5" />
                  <span>Join</span>
                </button>
              </div>

              {activeTab !== 'notation' && (
                <div className="flex items-center gap-1 border-l border-[#D6CBB8] pl-2.5">
                  {(['mora', 'episemaH', 'episemaV', 'liquescent'] as ModifierPresetId[]).map(
                    (modId) => {
                      const active = activeModifiers[modId];
                      const labels: Record<string, string> = {
                        mora: 'Mora (M)',
                        episemaH: 'Episema (E)',
                        episemaV: 'Ictus (I)',
                        liquescent: 'Liquesc. (L)',
                      };
                      return (
                        <button
                          key={modId}
                          type="button"
                          onClick={() => onToggleModifier(modId)}
                          title={`Toggle ${labels[modId]}`}
                          className={`h-5.5 rounded border px-1.5 text-[10.5px] font-medium transition-colors whitespace-nowrap ${
                            active
                              ? 'border-[#8B1E24] bg-[#8B1E24] text-[#FAF6EE]'
                              : 'border-[#CFC3AE] bg-[#FAF6EE] text-[#1D1915] hover:bg-white'
                          }`}
                        >
                          {labels[modId]}
                        </button>
                      );
                    }
                  )}
                  {activeModifiers.liquescent && (
                    <div className="flex items-center gap-0.5 pl-1 border-l border-[#D6CBB8]">
                      {(['dim', 'asc', 'desc'] as const).map((dir) => (
                        <button
                          key={dir}
                          type="button"
                          onClick={() => onSetLiquescentDir(dir)}
                          title={`Liquescent direction: ${dir}`}
                          className={`h-5 rounded border px-1 text-[9.5px] font-medium ${
                            (selectedNote?.liquescentDir || 'dim') === dir
                              ? 'border-[#8B1E24] bg-[#8B1E24]/15 text-[#6E161B]'
                              : 'border-[#CFC3AE] bg-[#FAF6EE] text-[#5C5349]'
                          }`}
                        >
                          {dir === 'dim' ? 'Dim' : dir === 'asc' ? 'Asc' : 'Desc'}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="flex items-center gap-1 border-l border-[#D6CBB8] pl-2.5">
                {isMultiSelect && uniqueItemIds.size > 1 ? (
                  <span className="italic text-[#6B6257] px-1">Multiple syllables</span>
                ) : (
                  <>
                    <input
                      ref={contextualLyricInputRef}
                      type="text"
                      aria-label="Selected syllable text"
                      value={syllableBoxValue}
                      onChange={(e) => {
                        const val = e.target.value;
                        const targetSplitNote = earliestSelectedInItem;
                        if (!isSyllableHeadNote && targetSplitNote) {
                          if (val.length > 0) {
                            onAssignSyllableToNote(
                              selectedSyllable.id,
                              targetSplitNote.id,
                              val
                            );
                          }
                        } else {
                          onUpdateLyric(selectedSyllable.id, val);
                        }
                      }}
                      onSelect={(e) => {
                        if (!isSyllableHeadNote) return;
                        const s = e.currentTarget.selectionStart ?? 0;
                        const end = e.currentTarget.selectionEnd ?? 0;
                        if (end > s) {
                          onSelectText({
                            kind: 'lyric-range',
                            itemId: selectedSyllable.id,
                            start: s,
                            end,
                          });
                        } else if (
                          textSelection?.kind === 'lyric-range' &&
                          textSelection.itemId === selectedSyllable.id
                        ) {
                          onSelectText(null);
                        }
                      }}
                      onKeyUp={(e) => {
                        if (!isSyllableHeadNote) return;
                        const s = e.currentTarget.selectionStart ?? 0;
                        const end = e.currentTarget.selectionEnd ?? 0;
                        if (end > s) {
                          onSelectText({
                            kind: 'lyric-range',
                            itemId: selectedSyllable.id,
                            start: s,
                            end,
                          });
                        }
                      }}
                      onMouseUp={(e) => {
                        if (!isSyllableHeadNote) return;
                        const s = e.currentTarget.selectionStart ?? 0;
                        const end = e.currentTarget.selectionEnd ?? 0;
                        if (end > s) {
                          onSelectText({
                            kind: 'lyric-range',
                            itemId: selectedSyllable.id,
                            start: s,
                            end,
                          });
                        }
                      }}
                      onBlur={() => {
                        if (isSyllableHeadNote && selectedSyllable.lyric.trim() === '') {
                          onCommitEmptySyllable(selectedSyllable.id);
                        }
                      }}
                      placeholder={isSyllableHeadNote ? 'syllable' : 'split syllable'}
                      className="h-5.5 w-20 rounded border border-[#CFC3AE] bg-[#FAF6EE] px-1.5 font-[family-name:var(--font-serif)] text-[13px] text-[#1D1915] focus:border-[#8B1E24] focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateLyric(
                          selectedSyllable.id,
                          selectedSyllable.lyric,
                          !selectedSyllable.wordEnd
                        )
                      }
                      title="Toggle Word End vs Hyphenated syllable"
                      className={`h-5.5 rounded border px-1.5 text-[10.5px] font-medium whitespace-nowrap ${
                        selectedSyllable.wordEnd
                          ? 'border-[#CFC3AE] bg-[#FAF6EE] text-[#1D1915] hover:bg-white'
                          : 'border-[#8B1E24] bg-[#8B1E24]/12 text-[#6E161B]'
                      }`}
                    >
                      {selectedSyllable.wordEnd ? 'Word' : 'Hyphen -'}
                    </button>
                    <button
                      type="button"
                      onClick={() => onShiftSyllableLyric(selectedSyllable.id, 'prev')}
                      title="Shift syllable text to previous syllable"
                      className="inline-flex h-5.5 w-5 items-center justify-center rounded border border-[#CFC3AE] bg-[#FAF6EE] hover:bg-white"
                    >
                      <ArrowLeft className="h-2.5 w-2.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onShiftSyllableLyric(selectedSyllable.id, 'next')}
                      title="Shift syllable text to next syllable"
                      className="inline-flex h-5.5 w-5 items-center justify-center rounded border border-[#CFC3AE] bg-[#FAF6EE] hover:bg-white"
                    >
                      <ArrowRight className="h-2.5 w-2.5" />
                    </button>
                    {!isSyllableHeadNote && earliestSelectedInItem && (
                      <button
                        type="button"
                        onClick={() =>
                          onAssignSyllableToNote(
                            selectedSyllable.id,
                            earliestSelectedInItem.id,
                            'la'
                          )
                        }
                        title="Split syllable starting at selected note"
                        className="h-5.5 inline-flex items-center gap-1 rounded border border-[#CFC3AE] bg-[#FAF6EE] px-1.5 text-[10.5px] font-medium text-[#1D1915] hover:bg-white whitespace-nowrap"
                      >
                        <SplitSquareHorizontal className="h-3 w-3" />
                        <span>Split Syl.</span>
                      </button>
                    )}
                  </>
                )}
              </div>

              <div className="flex items-center gap-2 border-l border-[#D6CBB8] pl-2.5">
                {renderInlineColorControls()}
                {renderInlineAccentControls()}
              </div>

              <button
                type="button"
                onClick={onDeleteSelection}
                title="Delete selection (Backspace / Delete)"
                className="ml-auto h-5.5 inline-flex items-center gap-1 rounded border border-[#CFC3AE] bg-[#FAF6EE] px-2 text-[10.5px] font-medium text-[#8B1E24] hover:bg-white whitespace-nowrap"
              >
                <Trash2 className="h-3 w-3" />
                <span>Delete (Del)</span>
              </button>
            </>
          ) : selectedItem ? (
            <>
              <span className="font-semibold text-[#8B1E24] whitespace-nowrap">
                {selectedItem.kind === 'clef'
                  ? `Clef (${selectedItem.clef.toUpperCase()})`
                  : selectedItem.kind === 'division'
                  ? `Division (${selectedItem.division})`
                  : 'Staff Line Break'}
              </span>
              {selectedItem.kind === 'division' && selectedItem.lyric && (
                <div className="flex items-center gap-2 border-l border-[#D6CBB8] pl-2.5">
                  {renderInlineColorControls()}
                  {renderInlineAccentControls()}
                </div>
              )}
              <button
                type="button"
                onClick={onDeleteSelection}
                disabled={selectedItem.kind === 'clef' && selectedIdx === 0}
                title="Delete selected item (Backspace / Delete)"
                className="ml-auto inline-flex h-5.5 items-center gap-1 rounded border border-[#CFC3AE] bg-[#FAF6EE] px-2 text-[10.5px] font-medium text-[#8B1E24] hover:bg-white disabled:opacity-40 whitespace-nowrap"
              >
                <Trash2 className="h-3 w-3" />
                <span>Remove (Del)</span>
              </button>
            </>
          ) : (
            <>
              <span className="font-semibold text-[#8B1E24] whitespace-nowrap">
                {textTargetLabel}
              </span>
              <div className="flex items-center gap-2 border-l border-[#D6CBB8] pl-2.5">
                {renderInlineColorControls()}
                {renderInlineAccentControls()}
              </div>
              <button
                type="button"
                onClick={onClearTextSelection}
                title="Clear text selection"
                className="ml-auto h-5.5 rounded border border-[#CFC3AE] bg-[#FAF6EE] px-2 text-[10.5px] font-medium text-[#5C5349] hover:bg-white hover:text-[#1D1915] whitespace-nowrap"
              >
                Done
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
};
