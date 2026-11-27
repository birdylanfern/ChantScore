import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Hand,
  Maximize,
  Maximize2,
  Minimize2,
  MoveHorizontal,
  Search,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  ChantScore,
  ClefType,
  DivisionType,
  NeumePresetId,
  PaletteDragPayload,
  PhraseBreakKey,
  SelectionState,
  TextSelectionTarget,
  ToneLink,
  ZoomMode,
} from '@/src/types/chant';
import type { PhraseCadenceChoice } from '@/src/lib/tones/pointing';
import type { ReadingCadenceKind } from '@/src/lib/tones/tone';
import { paginateScoreLayout } from '@/src/lib/notation/layoutEngine';
import {
  getFontCss,
  getMissalHeaderMetrics,
  getPageDimensions,
  resolveScoreTypography,
} from '@/src/lib/typography';
import { ScoreCanvas } from '@/src/components/ScoreCanvas';

interface ScoreWorkspaceProps {
  score: ChantScore;
  selection: SelectionState | null;
  textSelection: TextSelectionTarget | null;
  playingNoteId: string | null;
  toolMode: 'select' | 'insert';
  activePreset: NeumePresetId | null;
  draggingPayload: PaletteDragPayload | null;
  zoom: number;
  zoomMode: ZoomMode;
  isFullscreen: boolean;
  spacePanActive?: boolean;
  dragZoomActive?: boolean;
  scrollTargetItemId: string | null;
  notice: string | null;
  onChangeZoom: (zoom: number, mode: ZoomMode) => void;
  onToggleFullscreen: () => void;
  onToggleDragZoom?: () => void;
  onSelect: (
    sel: SelectionState | null,
    auditionPitch?: { pitch: number; clef: ClefType },
    modifiers?: { shiftKey?: boolean; toggleKey?: boolean }
  ) => void;
  onSelectText: (target: TextSelectionTarget | null) => void;
  onDropOrStampNeume: (
    preset: NeumePresetId,
    pitch: number,
    target:
      | { mode: 'append-to-syllable'; itemId: string }
      | { mode: 'insert-new-syllable'; insertAfterIndex: number }
  ) => void;
  onDropDivision: (division: DivisionType, insertAfterIndex: number) => void;
  onDropClef: (clef: ClefType, insertAfterIndex: number) => void;
  onDragNotePitch: (
    itemId: string,
    noteId: string,
    newPitch: number,
    pitchDelta: number,
    clef: ClefType
  ) => void;
  onUpdateLyric: (itemId: string, lyric: string, wordEnd?: boolean) => void;
  onUpdateHeader: (patch: Partial<ChantScore['header']>) => void;
  onCreateBlankSyllable: () => void;
  toneLink?: ToneLink | null;
  showPhraseControls?: boolean;
  onSelectPhraseCadence?: (
    phraseKey: number,
    choice: PhraseCadenceChoice,
    defaultKind: ReadingCadenceKind | null
  ) => void;
  onJoinPhrases?: (endWordIndex: number, dir: 'prev' | 'next') => void;
  onSplitMergedPhrase?: (endWordIndex: number) => void;
  onRestoreBreak?: (breakKey: PhraseBreakKey) => void;
  onToggleExtraBreak?: (breakKey: PhraseBreakKey) => void;
}

export const ScoreWorkspace: React.FC<ScoreWorkspaceProps> = ({
  score,
  selection,
  textSelection,
  playingNoteId,
  toolMode,
  activePreset,
  draggingPayload,
  zoom,
  zoomMode,
  isFullscreen,
  spacePanActive = false,
  dragZoomActive = false,
  scrollTargetItemId,
  notice,
  onChangeZoom,
  onToggleFullscreen,
  onToggleDragZoom,
  onSelect,
  onSelectText,
  onDropOrStampNeume,
  onDropDivision,
  onDropClef,
  onDragNotePitch,
  onUpdateLyric,
  onUpdateHeader,
  onCreateBlankSyllable,
  toneLink = null,
  showPhraseControls = true,
  onSelectPhraseCadence,
  onJoinPhrases,
  onSplitMergedPhrase,
  onRestoreBreak,
  onToggleExtraBreak,
}) => {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [viewportSize, setViewportSize] = useState<{ width: number; height: number }>({
    width: 960,
    height: 680,
  });
  const [panToolActive, setPanToolActive] = useState(false);
  const [altKeyHeld, setAltKeyHeld] = useState(false);
  const [panDragging, setPanDragging] = useState<{
    startX: number;
    startY: number;
    scrollLeft: number;
    scrollTop: number;
  } | null>(null);
  const [zoomDragging, setZoomDragging] = useState<{
    startX: number;
    startY: number;
    startZoom: number;
    dxFromCenter: number;
    contentY: number;
    anchorX: number;
    anchorY: number;
    didDrag: boolean;
    direction: 'in' | 'out';
  } | null>(null);
  const pendingScrollAnchorRef = useRef<{
    startZoom: number;
    dxFromCenter: number;
    contentY: number;
    anchorX: number;
    anchorY: number;
  } | null>(null);

  const MIN_ZOOM = 0.25;
  const MAX_ZOOM = 4.0;
  const effectivePanMode = panToolActive || spacePanActive;
  const zoomCursorOut = zoomDragging ? zoomDragging.direction === 'out' : altKeyHeld;

  useEffect(() => {
    if (dragZoomActive && panToolActive) {
      setPanToolActive(false);
    }
  }, [dragZoomActive, panToolActive]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Alt' || e.altKey) setAltKeyHeld(true);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Alt' || !e.altKey) setAltKeyHeld(false);
    };
    const onBlur = () => setAltKeyHeld(false);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  const pageDims = useMemo(() => getPageDimensions(score.pageSetup), [score.pageSetup]);
  const typo = useMemo(() => resolveScoreTypography(score.typography), [score.typography]);
  const { firstPageHeaderHeight } = useMemo(
    () => getMissalHeaderMetrics(typo.titleFontSize),
    [typo.titleFontSize]
  );
  const { layout: estLayout, pages: estPages } = useMemo(
    () =>
      paginateScoreLayout(
        score,
        pageDims.svgWidth,
        pageDims.svgHeight,
        true,
        {
          lyricFontCss: getFontCss(typo.lyricFont, 'eb-garamond'),
          lyricFontSize: typo.lyricFontSize,
          dropCapFontCss: getFontCss(typo.titleFont, 'cinzel'),
          lineSpacing: typo.lineSpacing,
          wordSpacing: typo.wordSpacing,
        },
        {
          firstPageHeaderHeight,
          contPageHeaderHeight: 36,
          firstSystemTopPad: 24,
          bottomMargin: 52,
        }
      ),
    [
      score,
      pageDims.svgWidth,
      pageDims.svgHeight,
      typo.lyricFont,
      typo.lyricFontSize,
      typo.lineSpacing,
      typo.wordSpacing,
      typo.titleFont,
      firstPageHeaderHeight,
    ]
  );
  const basePageWidth = pageDims.svgWidth;
  const estimatedPageHeight = pageDims.svgHeight;

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setViewportSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const effectiveZoom = useMemo(() => {
    if (zoomMode === 'fit-width') {
      const availW = Math.max(320, viewportSize.width - 56);
      return Math.max(0.45, Math.min(1.5, availW / basePageWidth));
    }
    if (zoomMode === 'fit-page') {
      const availW = Math.max(320, viewportSize.width - 56);
      const availH = Math.max(300, viewportSize.height - 64);
      const zW = availW / basePageWidth;
      const zH = availH / estimatedPageHeight;
      return Math.max(0.42, Math.min(1.35, Math.min(zW, zH)));
    }
    return zoom;
  }, [basePageWidth, estimatedPageHeight, viewportSize.height, viewportSize.width, zoom, zoomMode]);

  useLayoutEffect(() => {
    const pending = pendingScrollAnchorRef.current;
    const el = scrollContainerRef.current;
    if (!pending || !el) return;
    pendingScrollAnchorRef.current = null;
    const ratio = effectiveZoom / pending.startZoom;
    const targetLeft = el.scrollWidth / 2 + pending.dxFromCenter * ratio - pending.anchorX;
    const targetTop = 28 + pending.contentY * ratio - pending.anchorY;
    el.scrollLeft = Math.max(0, targetLeft);
    el.scrollTop = Math.max(0, targetTop);
  }, [effectiveZoom]);

  const handleZoomStep = useCallback(
    (delta: number) => {
      const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Number((effectiveZoom + delta).toFixed(2))));
      onChangeZoom(next, 'custom');
    },
    [effectiveZoom, onChangeZoom]
  );

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.altKey) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const anchorX = e.clientX - rect.left;
      const anchorY = e.clientY - rect.top;
      const zoomOut = e.deltaY > 0;
      const factor = zoomOut ? 1 / 1.15 : 1.15;
      const nextZoom = Math.max(
        MIN_ZOOM,
        Math.min(MAX_ZOOM, Number((effectiveZoom * factor).toFixed(3)))
      );
      if (nextZoom === effectiveZoom) return;
      pendingScrollAnchorRef.current = {
        startZoom: effectiveZoom,
        dxFromCenter: el.scrollLeft + anchorX - el.scrollWidth / 2,
        contentY: el.scrollTop + anchorY - 28,
        anchorX,
        anchorY,
      };
      onChangeZoom(nextZoom, 'custom');
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [effectiveZoom, onChangeZoom]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = scrollContainerRef.current;
    if (!el) return;
    if (e.altKey !== altKeyHeld) setAltKeyHeld(e.altKey);
    const isMiddle = e.button === 1;
    if (effectivePanMode || isMiddle) {
      e.preventDefault();
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      setPanDragging({
        startX: e.clientX,
        startY: e.clientY,
        scrollLeft: el.scrollLeft,
        scrollTop: el.scrollTop,
      });
      return;
    }
    if (dragZoomActive && e.button === 0) {
      e.preventDefault();
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      const rect = el.getBoundingClientRect();
      const anchorX = e.clientX - rect.left;
      const anchorY = e.clientY - rect.top;
      setZoomDragging({
        startX: e.clientX,
        startY: e.clientY,
        startZoom: effectiveZoom,
        dxFromCenter: el.scrollLeft + anchorX - el.scrollWidth / 2,
        contentY: el.scrollTop + anchorY - 28,
        anchorX,
        anchorY,
        didDrag: false,
        direction: e.altKey ? 'out' : 'in',
      });
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = scrollContainerRef.current;
    if (!el) return;
    if (e.altKey !== altKeyHeld) setAltKeyHeld(e.altKey);
    if (panDragging) {
      const dx = e.clientX - panDragging.startX;
      const dy = e.clientY - panDragging.startY;
      el.scrollLeft = panDragging.scrollLeft - dx;
      el.scrollTop = panDragging.scrollTop - dy;
      return;
    }
    if (zoomDragging) {
      const dx = e.clientX - zoomDragging.startX;
      const dy = e.clientY - zoomDragging.startY;
      const didDrag = zoomDragging.didDrag || Math.hypot(dx, dy) > 4;
      if (!didDrag) return;
      const dominant = Math.abs(dx) >= Math.abs(dy) ? dx : -dy;
      const direction: 'in' | 'out' = dominant < 0 ? 'out' : 'in';
      const nextZoom = Math.max(
        MIN_ZOOM,
        Math.min(MAX_ZOOM, Number((zoomDragging.startZoom * Math.exp(dominant * 0.006)).toFixed(3)))
      );
      if (nextZoom !== effectiveZoom) {
        pendingScrollAnchorRef.current = {
          startZoom: zoomDragging.startZoom,
          dxFromCenter: zoomDragging.dxFromCenter,
          contentY: zoomDragging.contentY,
          anchorX: zoomDragging.anchorX,
          anchorY: zoomDragging.anchorY,
        };
      }
      setZoomDragging((prev) => (prev ? { ...prev, didDrag: true, direction } : null));
      onChangeZoom(nextZoom, 'custom');
    }
  };

  const handlePointerUp = (e?: React.PointerEvent<HTMLDivElement>) => {
    if (e) {
      if (e.altKey !== altKeyHeld) setAltKeyHeld(e.altKey);
      try {
        if (scrollContainerRef.current?.hasPointerCapture(e.pointerId)) {
          scrollContainerRef.current.releasePointerCapture(e.pointerId);
        }
      } catch {
        /* ignore */
      }
    }
    if (panDragging) setPanDragging(null);
    if (zoomDragging) {
      if (!zoomDragging.didDrag) {
        const zoomOut = Boolean(e?.altKey);
        const factor = zoomOut ? 1 / 1.25 : 1.25;
        const clamped = Math.max(
          MIN_ZOOM,
          Math.min(MAX_ZOOM, Number((zoomDragging.startZoom * factor).toFixed(2)))
        );
        const nextZoom =
          clamped === zoomDragging.startZoom
            ? zoomOut
              ? Math.max(MIN_ZOOM, Number((zoomDragging.startZoom - 0.05).toFixed(2)))
              : Math.min(MAX_ZOOM, Number((zoomDragging.startZoom + 0.05).toFixed(2)))
            : clamped;
        if (nextZoom !== zoomDragging.startZoom) {
          pendingScrollAnchorRef.current = {
            startZoom: zoomDragging.startZoom,
            dxFromCenter: zoomDragging.dxFromCenter,
            contentY: zoomDragging.contentY,
            anchorX: zoomDragging.anchorX,
            anchorY: zoomDragging.anchorY,
          };
          onChangeZoom(nextZoom, 'custom');
        }
      }
      setZoomDragging(null);
    }
  };

  return (
    <main className="studio-desk relative flex flex-1 min-w-0 flex-col overflow-hidden">
      {/* Subtle Workspace View & Zoom Strip */}
      <div className="no-print flex items-center justify-between gap-2 border-b border-[#CFC3AE] bg-[#EAE2D3]/90 px-3 sm:px-4 py-1 text-xs shrink-0">
        <div className="flex items-center gap-2 text-[11px] text-[#5C5349] truncate">
          <span className="tabular-nums whitespace-nowrap">
            {estLayout.systems.length} {estLayout.systems.length === 1 ? 'system' : 'systems'}
          </span>
          <span aria-hidden="true">·</span>
          <span className="tabular-nums whitespace-nowrap">
            {estPages.length} {estPages.length === 1 ? 'page' : 'pages'}
          </span>
          <span className="hidden md:inline" aria-hidden="true">·</span>
          <span className="hidden md:inline whitespace-nowrap">
            {pageDims.spec.shortLabel} {pageDims.orientation === 'landscape' ? 'Landscape' : 'Portrait'}
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            aria-pressed={effectivePanMode}
            onClick={() => {
              setPanToolActive((v) => !v);
              if (dragZoomActive && onToggleDragZoom) onToggleDragZoom();
            }}
            title="Hand Pan tool (Hold Spacebar or middle-click drag to pan score)"
            className={`inline-flex h-7 items-center gap-1 rounded border px-2 text-[11px] font-medium transition-colors whitespace-nowrap ${
              effectivePanMode
                ? 'border-[#8B1E24] bg-[#8B1E24] text-[#FAF6EE]'
                : 'border-[#CFC3AE] bg-[#FAF6EE] text-[#1D1915] hover:bg-white'
            }`}
          >
            <Hand className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Pan (Space)</span>
          </button>

          {onToggleDragZoom && (
            <button
              type="button"
              aria-pressed={dragZoomActive}
              onClick={onToggleDragZoom}
              title="Zoom tool (Z) — click or drag right to zoom in, Alt+click or drag left to zoom out, hold Space to pan"
              className={`inline-flex h-7 items-center gap-1 rounded border px-2 text-[11px] font-medium transition-colors whitespace-nowrap ${
                dragZoomActive
                  ? 'border-[#8B1E24] bg-[#8B1E24] text-[#FAF6EE]'
                  : 'border-[#CFC3AE] bg-[#FAF6EE] text-[#1D1915] hover:bg-white'
              }`}
            >
              <Search className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Zoom (Z)</span>
            </button>
          )}

          <div className="flex items-center rounded border border-[#CFC3AE] bg-[#FAF6EE] p-0.5">
            <button
              type="button"
              onClick={() => handleZoomStep(-0.1)}
              title="Zoom out"
              className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-[#1D1915] hover:bg-[#EFE7D8]"
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onChangeZoom(1, 'custom')}
              title="Reset zoom to 100%"
              className="px-2 font-[family-name:var(--font-mono)] text-[11px] tabular-nums text-[#1D1915] hover:text-[#8B1E24]"
            >
              {Math.round(effectiveZoom * 100)}%
            </button>
            <button
              type="button"
              onClick={() => handleZoomStep(0.1)}
              title="Zoom in"
              className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-[#1D1915] hover:bg-[#EFE7D8]"
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="hidden sm:flex items-center rounded border border-[#CFC3AE] bg-[#FAF6EE] p-0.5">
            <button
              type="button"
              onClick={() => onChangeZoom(effectiveZoom, 'fit-width')}
              title="Fit score width to workspace (F)"
              className={`inline-flex h-6 items-center gap-1 rounded-sm px-2 text-[11px] font-medium transition-colors whitespace-nowrap ${
                zoomMode === 'fit-width'
                  ? 'bg-[#8B1E24] text-[#FAF6EE]'
                  : 'text-[#4F473E] hover:text-[#1D1915]'
              }`}
            >
              <MoveHorizontal className="h-3 w-3" />
              <span>Fit Width (F)</span>
            </button>
            <button
              type="button"
              onClick={() => onChangeZoom(effectiveZoom, 'fit-page')}
              title="Fit entire page in view (F)"
              className={`inline-flex h-6 items-center gap-1 rounded-sm px-2 text-[11px] font-medium transition-colors whitespace-nowrap ${
                zoomMode === 'fit-page'
                  ? 'bg-[#8B1E24] text-[#FAF6EE]'
                  : 'text-[#4F473E] hover:text-[#1D1915]'
              }`}
            >
              <Maximize className="h-3 w-3" />
              <span>Fit Page (F)</span>
            </button>
          </div>

          <button
            type="button"
            onClick={onToggleFullscreen}
            title={
              isFullscreen
                ? 'Exit full-screen notation editing (`)'
                : 'Full-screen notation editing (`)'
            }
            className={`inline-flex h-7 items-center gap-1 rounded border px-2 text-[11px] font-medium transition-colors whitespace-nowrap ${
              isFullscreen
                ? 'border-[#8B1E24] bg-[#8B1E24] text-[#FAF6EE]'
                : 'border-[#CFC3AE] bg-[#FAF6EE] text-[#1D1915] hover:bg-white'
            }`}
          >
            {isFullscreen ? (
              <Minimize2 className="h-3.5 w-3.5" />
            ) : (
              <Maximize2 className="h-3.5 w-3.5" />
            )}
            <span className="hidden md:inline">
              {isFullscreen ? 'Exit Full (`)' : 'Full Screen (`)'}
            </span>
          </button>
        </div>
      </div>

      {/* Scrollable / Pannable Score Canvas Viewport */}
      <div
        ref={scrollContainerRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className={`relative flex-1 overflow-auto ${
          effectivePanMode
            ? panDragging
              ? 'cursor-grabbing'
              : 'cursor-grab'
            : dragZoomActive
            ? zoomCursorOut
              ? 'cursor-zoom-out'
              : 'cursor-zoom-in'
            : ''
        }`}
      >
        {/* Persistent live region so screen readers announce each notice. */}
        <div role="status" aria-live="polite" className="no-print sticky top-3 z-30">
          {notice && (
            <div className="mx-auto w-fit rounded border border-[#B48327]/50 bg-[#1C1917] px-4 py-1.5 text-xs text-[#FAF6EE] shadow-lg">
              {notice}
            </div>
          )}
        </div>

        <div
          className={`flex min-h-full min-w-full items-start justify-center ${
            effectivePanMode || dragZoomActive ? 'pointer-events-none' : ''
          }`}
        >
          <ScoreCanvas
            score={score}
            selection={selection}
            textSelection={textSelection}
            playingNoteId={playingNoteId}
            toolMode={toolMode}
            activePreset={activePreset}
            draggingPayload={draggingPayload}
            zoom={effectiveZoom}
            panMode={effectivePanMode}
            zoomModeActive={dragZoomActive && !effectivePanMode}
            zoomCursorOut={zoomCursorOut}
            scrollTargetItemId={scrollTargetItemId}
            onSelect={onSelect}
            onSelectText={onSelectText}
            onDropOrStampNeume={onDropOrStampNeume}
            onDropDivision={onDropDivision}
            onDropClef={onDropClef}
            onDragNotePitch={onDragNotePitch}
            onUpdateLyric={onUpdateLyric}
            onUpdateHeader={onUpdateHeader}
            onCreateBlankSyllable={onCreateBlankSyllable}
            toneLink={toneLink}
            showPhraseControls={showPhraseControls}
            onSelectPhraseCadence={onSelectPhraseCadence}
            onJoinPhrases={onJoinPhrases}
            onSplitMergedPhrase={onSplitMergedPhrase}
            onRestoreBreak={onRestoreBreak}
            onToggleExtraBreak={onToggleExtraBreak}
          />
        </div>
      </div>
    </main>
  );
};

