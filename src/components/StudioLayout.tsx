import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import { ToneLayoutMode, WorkspaceMode } from '@/src/types/chant';
import {
  clampToneWidth,
  DEFAULT_TONE_WIDTH,
  resolveToneLayoutMode,
  TONE_MAX_WIDTH_RATIO,
  TONE_MIN_WIDTH,
} from '@/src/lib/workspacePrefs';

interface StudioLayoutProps {
  workspaceMode: WorkspaceMode;
  isFullscreen: boolean;
  gabcWidth: number;
  ribbon: React.ReactNode;
  workspace: React.ReactNode;
  gabcEditor: React.ReactNode;
  tonePanel?: React.ReactNode;
  showTonePanel?: boolean;
  tonePanelActive?: boolean;
  toneLayoutMode?: ToneLayoutMode | null;
  toneWidth?: number;
  containerWidthOverride?: number;
  onSetWorkspaceMode: (mode: WorkspaceMode) => void;
  onChangeGabcWidth: (w: number) => void;
  onChangeToneWidth?: (w: number) => void;
  onExpandTonePanel?: () => void;
  onFileDrop: (e: React.DragEvent<HTMLDivElement>) => void;
}

export const StudioLayout: React.FC<StudioLayoutProps> = ({
  workspaceMode,
  isFullscreen,
  gabcWidth,
  ribbon,
  workspace,
  gabcEditor,
  tonePanel,
  showTonePanel = false,
  tonePanelActive = false,
  toneLayoutMode = null,
  toneWidth = DEFAULT_TONE_WIDTH,
  containerWidthOverride,
  onSetWorkspaceMode,
  onChangeGabcWidth,
  onChangeToneWidth,
  onExpandTonePanel,
  onFileDrop,
}) => {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [measuredWidth, setMeasuredWidth] = useState<number>(() => {
    if (typeof containerWidthOverride === 'number') return containerWidthOverride;
    if (typeof window !== 'undefined') return window.innerWidth;
    return 1280;
  });
  const [resizingGabc, setResizingGabc] = useState(false);
  const [resizingTone, setResizingTone] = useState(false);
  const gabcDragStartRef = useRef<{ x: number; startW: number } | null>(null);
  const toneDragStartRef = useRef<{ x: number; startW: number } | null>(null);

  useEffect(() => {
    if (typeof containerWidthOverride === 'number') {
      setMeasuredWidth(containerWidthOverride);
      return;
    }
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const updateWidth = () => {
      const next = el.getBoundingClientRect().width;
      if (next > 0) setMeasuredWidth(next);
    };
    updateWidth();
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setMeasuredWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [containerWidthOverride]);

  const effectiveContainerWidth =
    typeof containerWidthOverride === 'number' ? containerWidthOverride : measuredWidth;
  const effectiveToneLayoutMode = resolveToneLayoutMode(toneLayoutMode, effectiveContainerWidth);
  const effectiveToneWidth = clampToneWidth(toneWidth, effectiveContainerWidth);
  const maxToneWidth = Math.max(
    TONE_MIN_WIDTH,
    Math.floor(effectiveContainerWidth * TONE_MAX_WIDTH_RATIO)
  );

  const handleGabcSplitterDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    gabcDragStartRef.current = { x: e.clientX, startW: gabcWidth };
    setResizingGabc(true);

    const onMove = (ev: PointerEvent) => {
      if (!gabcDragStartRef.current) return;
      const delta = gabcDragStartRef.current.x - ev.clientX;
      const next = Math.max(280, Math.min(680, gabcDragStartRef.current.startW + delta));
      onChangeGabcWidth(next);
    };

    const onUp = () => {
      gabcDragStartRef.current = null;
      setResizingGabc(false);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const handleToneSplitterDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!onChangeToneWidth) return;
    e.preventDefault();
    toneDragStartRef.current = { x: e.clientX, startW: effectiveToneWidth };
    setResizingTone(true);

    const onMove = (ev: PointerEvent) => {
      if (!toneDragStartRef.current) return;
      const delta = toneDragStartRef.current.x - ev.clientX;
      const next = clampToneWidth(
        toneDragStartRef.current.startW + delta,
        effectiveContainerWidth
      );
      onChangeToneWidth(next);
    };

    const onUp = () => {
      toneDragStartRef.current = null;
      setResizingTone(false);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const handleToneSplitterKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!onChangeToneWidth) return;
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      onChangeToneWidth(clampToneWidth(effectiveToneWidth + 24, effectiveContainerWidth));
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      onChangeToneWidth(clampToneWidth(effectiveToneWidth - 24, effectiveContainerWidth));
    }
  };

  const showSourcePanel = workspaceMode === 'source' && !isFullscreen;
  const hasTonePanel = Boolean(tonePanel);
  const showToneBelow = !isFullscreen && hasTonePanel && showTonePanel && effectiveToneLayoutMode === 'below';
  const showToneSide = !isFullscreen && hasTonePanel && showTonePanel && effectiveToneLayoutMode === 'side';
  const showToneFullscreenOverlay = isFullscreen && hasTonePanel && showTonePanel;
  const showToneExpandRail =
    hasTonePanel &&
    !showTonePanel &&
    tonePanelActive &&
    Boolean(onExpandTonePanel) &&
    (isFullscreen || effectiveToneLayoutMode === 'side');

  return (
    <div
      ref={rootRef}
      className="flex h-screen flex-col overflow-hidden bg-[#E8E0D0] text-[#1D1915]"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) e.preventDefault();
      }}
      onDrop={onFileDrop}
    >
      {/* Ribbon (brand, save status, and tabs live in its tab row) */}
      {!isFullscreen && ribbon}

      {/* Tones Panel in Below mode (sits under the ribbon with size cap) */}
      {showToneBelow && (
        <div
          data-testid="tone-panel-below"
          className="no-print flex max-h-[38vh] w-full shrink-0 flex-col overflow-hidden border-b border-[#D6CBB8] bg-[#EFE8DA]"
        >
          {tonePanel}
        </div>
      )}

      {/* Central Score Workspace + Side-by-Side Tones / GABC Panels */}
      <div className="relative flex flex-1 min-h-0 overflow-hidden">
        {workspace}

        {/* Side-by-Side Resizable Tones Panel (placed directly right of score canvas) */}
        {showToneSide && (
          <>
            <div
              role="separator"
              tabIndex={0}
              aria-orientation="vertical"
              aria-label="Resize Tones panel"
              aria-valuemin={TONE_MIN_WIDTH}
              aria-valuemax={maxToneWidth}
              aria-valuenow={effectiveToneWidth}
              onPointerDown={handleToneSplitterDown}
              onKeyDown={handleToneSplitterKeyDown}
              title="Drag to resize Tones panel"
              data-testid="tone-panel-splitter"
              className={`no-print flex w-1.5 shrink-0 cursor-col-resize items-center justify-center border-l border-[#CFC3AE] transition-colors focus-visible:outline-2 focus-visible:outline-[#8B1E24] ${
                resizingTone ? 'bg-[#8B1E24]' : 'bg-[#E5DCCB] hover:bg-[#C7B89E]'
              }`}
            >
              <div className="h-8 w-0.5 rounded-full bg-[#9E917B]" />
            </div>

            <div
              data-testid="tone-panel-side"
              style={{ width: `${effectiveToneWidth}px` }}
              className="no-print flex h-full max-w-full shrink-0 flex-col bg-[#EFE8DA]"
            >
              {tonePanel}
            </div>
          </>
        )}

        {/* Collapsed Tone Panel Re-Expand Rail (Side mode or Fullscreen) */}
        {!isFullscreen && showToneExpandRail && (
          <div className="no-print flex shrink-0 items-center border-l border-[#CFC3AE] bg-[#EAE2D3]">
            <button
              type="button"
              onClick={onExpandTonePanel}
              title="Expand Tones panel"
              aria-label="Expand Tones panel"
              data-testid="tone-panel-expand-rail"
              className="flex h-full w-6 flex-col items-center justify-center gap-1.5 text-[#5C5349] hover:bg-[#FAF6EE] hover:text-[#8B1E24] transition-colors"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              <span className="text-[9.5px] font-semibold uppercase tracking-widest [writing-mode:vertical-rl] rotate-180">
                Tones
              </span>
            </button>
          </div>
        )}

        {/* Desktop Side-by-Side Resizable GABC Panel */}
        {showSourcePanel && (
          <>
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize GABC source panel"
              onPointerDown={handleGabcSplitterDown}
              title="Drag to resize GABC panel"
              className={`no-print hidden lg:flex w-1.5 shrink-0 cursor-col-resize items-center justify-center border-l border-[#CFC3AE] transition-colors ${
                resizingGabc ? 'bg-[#8B1E24]' : 'bg-[#E5DCCB] hover:bg-[#C7B89E]'
              }`}
            >
              <div className="h-8 w-0.5 rounded-full bg-[#9E917B]" />
            </div>

            <div className="no-print hidden lg:flex h-full shrink-0">
              {gabcEditor}
            </div>

            {/* Mobile / Tablet Slide-Out Drawer for GABC Source */}
            <div
              className="no-print fixed inset-0 z-30 bg-black/35 lg:hidden"
              onClick={() => onSetWorkspaceMode('notation')}
              aria-hidden="true"
            />
            <div className="no-print fixed inset-y-0 right-0 z-40 flex max-w-[92vw] lg:hidden shadow-2xl">
              {gabcEditor}
            </div>
          </>
        )}

        {/* Fullscreen Overlay Tones Panel on the Right */}
        {showToneFullscreenOverlay && (
          <div
            data-testid="tone-panel-fullscreen"
            className="no-print absolute inset-y-0 right-0 z-30 flex max-w-[92vw] shadow-2xl"
          >
            <div
              role="separator"
              tabIndex={0}
              aria-orientation="vertical"
              aria-label="Resize Tones panel"
              aria-valuemin={TONE_MIN_WIDTH}
              aria-valuemax={maxToneWidth}
              aria-valuenow={effectiveToneWidth}
              onPointerDown={handleToneSplitterDown}
              onKeyDown={handleToneSplitterKeyDown}
              title="Drag to resize Tones panel"
              data-testid="tone-panel-splitter"
              className={`flex w-1.5 shrink-0 cursor-col-resize items-center justify-center border-l border-[#CFC3AE] transition-colors ${
                resizingTone ? 'bg-[#8B1E24]' : 'bg-[#E5DCCB] hover:bg-[#C7B89E]'
              }`}
            >
              <div className="h-8 w-0.5 rounded-full bg-[#9E917B]" />
            </div>
            <div
              style={{ width: `${effectiveToneWidth}px` }}
              className="flex h-full max-w-full flex-col bg-[#EFE8DA]"
            >
              {tonePanel}
            </div>
          </div>
        )}

        {isFullscreen && showToneExpandRail && (
          <button
            type="button"
            onClick={onExpandTonePanel}
            title="Expand Tones panel"
            aria-label="Expand Tones panel"
            data-testid="tone-panel-expand-rail"
            className="no-print absolute right-3 top-12 z-30 inline-flex h-7 items-center gap-1 rounded border border-[#CFC3AE] bg-[#FAF6EE]/95 px-2 text-[11px] font-medium text-[#1D1915] shadow-md hover:bg-white"
          >
            <ChevronLeft className="h-3.5 w-3.5 text-[#8B1E24]" />
            <span>Tones</span>
          </button>
        )}
      </div>
    </div>
  );
};

