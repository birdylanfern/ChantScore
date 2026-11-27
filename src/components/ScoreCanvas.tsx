import React, { useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Check, ChevronDown, Scissors, X } from 'lucide-react';
import {
  ChantScore,
  ClefType,
  DivisionType,
  NeumePresetId,
  PaletteDragPayload,
  PhraseBreakKey,
  SelectedNoteRef,
  SelectionState,
  TextSelectionTarget,
  ToneLink,
  TonePhraseLinkItem,
  VowelAccentType,
} from '@/src/types/chant';
import type { ReadingCadenceKind } from '@/src/lib/tones/tone';
import {
  CADENCE_CHOICE_META,
  cadenceKindToLabel,
  getValidPhraseCadenceChoices,
  PhraseCadenceChoice,
} from '@/src/lib/tones/phraseCadenceUtils';
import { CADENCE_BADGE_CLASS } from './PhraseCadencePicker';
import {
  layoutPresetPreview,
  NOTE_W,
  paginateScoreLayout,
  PageSystem,
  pitchToY,
  ScorePage,
  STAFF_HEIGHT,
  yToPitch,
} from '@/src/lib/notation/layoutEngine';
import {
  getStaffLineYs,
  INK_BLACK,
  renderClefElements,
  renderCustosMarkup,
  renderDivisionElements,
  renderGroupSvgMarkup,
  RUBRIC_RED,
  STAFF_LINE_INK,
} from '@/src/lib/notation/svgDrawing';
import {
  applyAccentToStringRange,
  getFontCss,
  getMissalHeaderMetrics,
  getPageDimensions,
  resolveEffectiveWordSpacing,
  resolveScoreTypography,
  splitTextIntoColoredSegments,
  textHasVowel,
  VOWEL_ACCENT_OPTIONS,
} from '@/src/lib/typography';
import { parseClefConfig, resolvePitch } from '@/src/lib/gabc/pitch';
import { getSelectedNoteRefs } from '@/src/lib/notation/scoreMutations';

interface HoverPreviewState {
  pageIndex: number;
  systemIndex: number;
  x: number;
  pitch: number;
  activeClef: ClefType;
  target:
    | { mode: 'append-to-syllable'; itemId: string; label: string }
    | { mode: 'insert-new-syllable'; insertAfterIndex: number; label: string };
}

interface PlacedPhraseMarker {
  phrase: TonePhraseLinkItem;
  pageIndex: number;
  systemIndex: number;
  anchorX: number;
  centerX: number;
  topY: number;
  width: number;
  compact: boolean;
  label: string;
}

export function layoutSystemPhraseMarkers(
  entries: {
    phrase: TonePhraseLinkItem;
    pageIndex: number;
    systemIndex: number;
    anchorX: number;
    bottomY: number;
  }[],
  staffLeftX: number,
  staffRightX: number
): PlacedPhraseMarker[] {
  if (entries.length === 0) return [];
  const sorted = [...entries].sort((a, b) => a.anchorX - b.anchorX);
  const gap = 3;
  const pillH = 18;

  const prepared = sorted.map((e) => {
    const meta = CADENCE_CHOICE_META[e.phrase.choiceLabel];
    const fullText = `${meta.label}${e.phrase.merged ? ` ×${e.phrase.mergedFrom}` : ''}${e.phrase.autoJoined ? ' auto' : ''}`;
    const compactText = `${meta.shortGlyph}${e.phrase.merged ? `×${e.phrase.mergedFrom}` : ''}${e.phrase.autoJoined ? '·auto' : ''}`;
    const fullW = Math.max(44, Math.round(fullText.length * 5.6 + 16));
    const compactW = Math.max(24, Math.round(compactText.length * 6.4 + 12));
    return {
      ...e,
      fullText,
      compactText,
      fullW,
      compactW,
      compact: false,
    };
  });

  // Detect horizontal collisions at full width and compact colliding neighbors
  for (let i = 0; i < prepared.length - 1; i++) {
    const cur = prepared[i];
    const nxt = prepared[i + 1];
    const curCx = Math.max(staffLeftX + cur.fullW / 2, Math.min(staffRightX - cur.fullW / 2, cur.anchorX));
    const nxtCx = Math.max(staffLeftX + nxt.fullW / 2, Math.min(staffRightX - nxt.fullW / 2, nxt.anchorX));
    if (curCx + cur.fullW / 2 + gap > nxtCx - nxt.fullW / 2) {
      cur.compact = true;
      nxt.compact = true;
    }
  }

  const widths = prepared.map((p) => (p.compact ? p.compactW : p.fullW));
  const centers = prepared.map((p, i) =>
    Math.max(staffLeftX + widths[i] / 2, Math.min(staffRightX - widths[i] / 2, p.anchorX))
  );

  // Forward pass: push overlapping rightwards
  for (let i = 1; i < centers.length; i++) {
    const minCenter = centers[i - 1] + widths[i - 1] / 2 + gap + widths[i] / 2;
    if (centers[i] < minCenter) {
      centers[i] = minCenter;
    }
  }
  // Backward pass: keep inside staffRightX
  if (centers.length > 0) {
    const lastIdx = centers.length - 1;
    centers[lastIdx] = Math.min(centers[lastIdx], staffRightX - widths[lastIdx] / 2);
    for (let i = lastIdx - 1; i >= 0; i--) {
      const maxCenter = centers[i + 1] - widths[i + 1] / 2 - gap - widths[i] / 2;
      if (centers[i] > maxCenter) {
        centers[i] = Math.max(staffLeftX + widths[i] / 2, maxCenter);
      }
    }
  }

  return prepared.map((p, i) => ({
    phrase: p.phrase,
    pageIndex: p.pageIndex,
    systemIndex: p.systemIndex,
    anchorX: p.anchorX,
    centerX: centers[i],
    topY: Math.max(6, p.bottomY - pillH),
    width: widths[i],
    compact: p.compact,
    label: p.compact ? p.compactText : p.fullText,
  }));
}

interface ScoreCanvasProps {
  score: ChantScore;
  selection: SelectionState | null;
  textSelection: TextSelectionTarget | null;
  playingNoteId: string | null;
  toolMode: 'select' | 'insert';
  activePreset: NeumePresetId | null;
  draggingPayload: PaletteDragPayload | null;
  zoom?: number;
  panMode?: boolean;
  zoomModeActive?: boolean;
  zoomCursorOut?: boolean;
  scrollTargetItemId?: string | null;
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
}

export const ScoreCanvas: React.FC<ScoreCanvasProps> = ({
  score,
  selection,
  textSelection,
  playingNoteId,
  toolMode,
  activePreset,
  draggingPayload,
  zoom = 1,
  panMode = false,
  zoomModeActive = false,
  zoomCursorOut = false,
  scrollTargetItemId = null,
  toneLink = null,
  showPhraseControls = true,
  onSelectPhraseCadence,
  onJoinPhrases,
  onSplitMergedPhrase,
  onRestoreBreak,
  onToggleExtraBreak,
  onSelect,
  onSelectText,
  onDropOrStampNeume,
  onDropDivision,
  onDropClef,
  onDragNotePitch,
  onUpdateLyric,
  onUpdateHeader,
  onCreateBlankSyllable,
}) => {
  const svgRefs = useRef<(SVGSVGElement | null)[]>([]);
  const lyricInputRef = useRef<HTMLInputElement | null>(null);
  const officeInputRef = useRef<HTMLInputElement | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const prevEditingScoreLyricRef = useRef<string>('');
  const [hoverPreview, setHoverPreview] = useState<HoverPreviewState | null>(null);
  const [hoveredPhraseKey, setHoveredPhraseKey] = useState<number | null>(null);
  const [openPhraseKey, setOpenPhraseKey] = useState<number | null>(null);
  const markerButtonRefs = useRef<Record<number, HTMLButtonElement | null>>({});
  const popoverMenuRef = useRef<HTMLDivElement | null>(null);
  const [editingLyricId, setEditingLyricId] = useState<string | null>(null);
  const [lyricDraft, setLyricDraft] = useState('');
  const [lyricSelRange, setLyricSelRange] = useState<{ start: number; end: number } | null>(null);
  const [editingHeaderField, setEditingHeaderField] = useState<
    'name' | 'officePart' | 'mode' | 'annotation' | null
  >(null);
  const [marquee, setMarquee] = useState<{
    pageIndex: number;
    startX: number;
    startY: number;
    curX: number;
    curY: number;
  } | null>(null);
  const [draggingNote, setDraggingNote] = useState<{
    pageIndex: number;
    itemId: string;
    noteId: string;
    clef: ClefType;
    systemYTop: number;
    lastPitch: number;
    didDrag: boolean;
    pendingSingleSelect?: {
      sel: SelectionState;
      pitch: number;
      clef: ClefType;
    };
  } | null>(null);

  const selectedNoteIds = useMemo(() => {
    return new Set(getSelectedNoteRefs(selection).map((r) => r.noteId));
  }, [selection]);

  const selectedItemIds = useMemo(() => {
    const ids = new Set(getSelectedNoteRefs(selection).map((r) => r.itemId));
    if (selection?.itemId) ids.add(selection.itemId);
    return ids;
  }, [selection]);

  const [isPrinting, setIsPrinting] = useState(false);

  useEffect(() => {
    const onBeforePrint = () => {
      flushSync(() => setIsPrinting(true));
    };
    const onAfterPrint = () => {
      setIsPrinting(false);
    };
    window.addEventListener('beforeprint', onBeforePrint);
    window.addEventListener('afterprint', onAfterPrint);
    const mq = typeof window.matchMedia === 'function' ? window.matchMedia('print') : null;
    const onMediaChange = (e: MediaQueryListEvent) => {
      flushSync(() => setIsPrinting(e.matches));
    };
    mq?.addEventListener?.('change', onMediaChange);
    return () => {
      window.removeEventListener('beforeprint', onBeforePrint);
      window.removeEventListener('afterprint', onAfterPrint);
      mq?.removeEventListener?.('change', onMediaChange);
    };
  }, []);

  const pageDims = useMemo(() => getPageDimensions(score.pageSetup), [score.pageSetup]);
  const typo = useMemo(() => resolveScoreTypography(score.typography), [score.typography]);
  const effectiveWordSpacing = resolveEffectiveWordSpacing(
    typo.wordSpacing,
    typo.lyricFontSize,
    isPrinting
  );
  const lyricFontCss = useMemo(() => getFontCss(typo.lyricFont, 'eb-garamond'), [typo.lyricFont]);
  const titleFontCss = useMemo(() => getFontCss(typo.titleFont, 'cinzel'), [typo.titleFont]);
  const { ruleY, firstPageHeaderHeight } = useMemo(
    () => getMissalHeaderMetrics(typo.titleFontSize),
    [typo.titleFontSize]
  );

  const { layout, pages } = useMemo(
    () =>
      paginateScoreLayout(
        score,
        pageDims.svgWidth,
        pageDims.svgHeight,
        true,
        {
          lyricFontCss,
          lyricFontSize: typo.lyricFontSize,
          dropCapFontCss: titleFontCss,
          lineSpacing: typo.lineSpacing,
          wordSpacing: effectiveWordSpacing,
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
      lyricFontCss,
      typo.lyricFontSize,
      typo.lineSpacing,
      effectiveWordSpacing,
      titleFontCss,
      firstPageHeaderHeight,
    ]
  );

  const phraseOverlaysActive =
    !isPrinting &&
    showPhraseControls &&
    Boolean(toneLink) &&
    (toneLink?.phrases.length ?? 0) > 0;

  useEffect(() => {
    if (!phraseOverlaysActive) {
      setOpenPhraseKey(null);
      setHoveredPhraseKey(null);
      return;
    }
    if (
      openPhraseKey !== null &&
      !toneLink?.phrases.some((ph) => ph.endWordIndex === openPhraseKey)
    ) {
      setOpenPhraseKey(null);
    }
  }, [phraseOverlaysActive, openPhraseKey, toneLink]);

  useEffect(() => {
    if (openPhraseKey === null) return;
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      const triggerEl = markerButtonRefs.current[openPhraseKey];
      if (
        popoverMenuRef.current &&
        !popoverMenuRef.current.contains(target) &&
        (!triggerEl || !triggerEl.contains(target))
      ) {
        setOpenPhraseKey(null);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [openPhraseKey]);

  useEffect(() => {
    if (openPhraseKey === null) return;
    const timer = window.setTimeout(() => {
      const menuEl = popoverMenuRef.current;
      if (!menuEl) return;
      const activeItem =
        menuEl.querySelector<HTMLButtonElement>('[role="menuitemradio"][aria-checked="true"]') ??
        menuEl.querySelector<HTMLButtonElement>(
          '[role="menuitem"]:not(:disabled), [role="menuitemradio"]:not(:disabled)'
        );
      activeItem?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [openPhraseKey]);

  const itemIndexById = useMemo(() => {
    const map = new Map<string, number>();
    score.items.forEach((it, idx) => map.set(it.id, idx));
    return map;
  }, [score.items]);

  const phraseByEndDivisionId = useMemo(() => {
    const map = new Map<string, TonePhraseLinkItem>();
    if (!phraseOverlaysActive || !toneLink) return map;
    for (const ph of toneLink.phrases) {
      if (ph.endDivisionItemId) {
        map.set(ph.endDivisionItemId, ph);
      }
    }
    return map;
  }, [phraseOverlaysActive, toneLink]);

  const markersByPage = useMemo(() => {
    const result = new Map<number, PlacedPhraseMarker[]>();
    if (!phraseOverlaysActive || !toneLink) return result;

    const phrasesByAnchorId = new Map<string, TonePhraseLinkItem[]>();
    for (const ph of toneLink.phrases) {
      const anchorId = ph.endDivisionItemId ?? ph.endItemId ?? ph.lastSyllableItemId;
      if (!anchorId) continue;
      const list = phrasesByAnchorId.get(anchorId);
      if (list) list.push(ph);
      else phrasesByAnchorId.set(anchorId, [ph]);
    }

    for (const page of pages) {
      const pageMarkers: PlacedPhraseMarker[] = [];
      for (const ps of page.systems) {
        const rawEntries: {
          phrase: TonePhraseLinkItem;
          pageIndex: number;
          systemIndex: number;
          anchorX: number;
          bottomY: number;
        }[] = [];

        for (const placed of ps.system.items) {
          const matched = phrasesByAnchorId.get(placed.item.id);
          if (!matched) continue;
          const anchorX = placed.neumeStartX + placed.neumeWidth / 2;
          let minNoteY = ps.pageYTop;
          for (const nearby of ps.system.items) {
            if (nearby.x + nearby.width < anchorX - 44 || nearby.x > anchorX + 44) continue;
            if (nearby.groups) {
              for (const pg of nearby.groups) {
                for (const pn of pg.groupLayout.notes) {
                  minNoteY = Math.min(minNoteY, ps.pageYTop + pn.yOffset - 6);
                }
              }
            }
          }
          const bottomY = Math.min(ps.pageYTop - 6, minNoteY - 8);
          for (const ph of matched) {
            rawEntries.push({
              phrase: ph,
              pageIndex: page.pageIndex,
              systemIndex: ps.system.systemIndex,
              anchorX,
              bottomY,
            });
          }
        }

        pageMarkers.push(
          ...layoutSystemPhraseMarkers(rawEntries, layout.staffLeftX, layout.staffRightX)
        );
      }
      result.set(page.pageIndex, pageMarkers);
    }
    return result;
  }, [phraseOverlaysActive, toneLink, pages, layout.staffLeftX, layout.staffRightX]);

  const highlightedPhraseRange = useMemo(() => {
    const activeKey = openPhraseKey ?? hoveredPhraseKey;
    if (!phraseOverlaysActive || !toneLink || activeKey === null) return null;
    const ph = toneLink.phrases.find((p) => p.endWordIndex === activeKey);
    if (!ph) return null;
    const startIdx = ph.firstSyllableItemId
      ? (itemIndexById.get(ph.firstSyllableItemId) ?? -1)
      : -1;
    const endAnchorId = ph.endDivisionItemId ?? ph.endItemId ?? ph.lastSyllableItemId;
    const endIdx = endAnchorId ? (itemIndexById.get(endAnchorId) ?? -1) : -1;
    if (startIdx < 0 || endIdx < startIdx) return null;
    return { startIdx, endIdx };
  }, [openPhraseKey, hoveredPhraseKey, phraseOverlaysActive, toneLink, itemIndexById]);

  useEffect(() => {
    if (!scrollTargetItemId) return;
    for (const svg of svgRefs.current) {
      if (!svg) continue;
      const el = svg.querySelector(`[data-item-id="${scrollTargetItemId}"]`);
      if (el && typeof (el as HTMLElement).scrollIntoView === 'function') {
        (el as HTMLElement).scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
          inline: 'nearest',
        });
        break;
      }
    }
  }, [scrollTargetItemId, pages.length]);

  useEffect(() => {
    if (!editingLyricId) return;
    const item = score.items.find((it) => it.id === editingLyricId);
    if (!item || item.kind !== 'syllable') return;
    if (item.lyric !== prevEditingScoreLyricRef.current) {
      prevEditingScoreLyricRef.current = item.lyric;
      setLyricDraft(item.lyric);
      if (textSelection?.kind === 'lyric-range' && textSelection.itemId === editingLyricId) {
        const r = { start: textSelection.start, end: textSelection.end };
        setLyricSelRange(r);
        requestAnimationFrame(() => {
          if (lyricInputRef.current) {
            lyricInputRef.current.focus();
            lyricInputRef.current.setSelectionRange(r.start, r.end);
          }
        });
      }
    }
  }, [editingLyricId, score.items, textSelection]);

  const firstSyllableWithTextIdx = useMemo(
    () => score.items.findIndex((it) => it.kind === 'syllable' && it.lyric.trim().length > 0),
    [score.items]
  );

  const dropCapChar = useMemo(() => {
    if (score.header.initialStyle === '0' || firstSyllableWithTextIdx === -1) return '';
    const item = score.items[firstSyllableWithTextIdx];
    if (item.kind !== 'syllable') return '';
    return item.lyric.trim()[0]?.toUpperCase() || '';
  }, [score.header.initialStyle, score.items, firstSyllableWithTextIdx]);

  const hasSyllables = useMemo(
    () => score.items.some((it) => it.kind === 'syllable'),
    [score.items]
  );

  const activePayload: PaletteDragPayload | null =
    draggingPayload ||
    (toolMode === 'insert' && activePreset ? { kind: 'neume', preset: activePreset } : null);

  function clientToPageSvgCoords(
    pageIndex: number,
    clientX: number,
    clientY: number
  ): { x: number; y: number } | null {
    const svg = svgRefs.current[pageIndex];
    const page = pages[pageIndex];
    if (!svg || !page) return null;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const x = ((clientX - rect.left) / rect.width) * page.pageWidth;
    const y = ((clientY - rect.top) / rect.height) * page.pageHeight;
    return { x, y };
  }

  function findClosestPageSystem(page: ScorePage, y: number): PageSystem {
    let best = page.systems[0];
    let bestDist = Infinity;
    for (const ps of page.systems) {
      const center = ps.pageYTop + STAFF_HEIGHT / 2;
      const dist = Math.abs(y - center);
      if (dist < bestDist) {
        bestDist = dist;
        best = ps;
      }
    }
    return best;
  }

  function resolvePointerTarget(page: ScorePage, x: number, y: number): HoverPreviewState | null {
    if (page.systems.length === 0) return null;
    const ps = findClosestPageSystem(page, y);
    const sys = ps.system;
    const pitch = yToPitch(y, ps.pageYTop);
    let activeClef: ClefType = sys.openingClef;

    for (const placed of sys.items) {
      activeClef = placed.activeClef;
      if (placed.item.kind === 'syllable') {
        if (x >= placed.x - 2 && x <= placed.x + placed.width + 2) {
          return {
            pageIndex: page.pageIndex,
            systemIndex: sys.systemIndex,
            x: placed.neumeStartX + placed.neumeWidth + 4,
            pitch,
            activeClef,
            target: {
              mode: 'append-to-syllable',
              itemId: placed.item.id,
              label: placed.item.lyric ? `Add to "${placed.item.lyric}"` : 'Add to syllable',
            },
          };
        }
      }
    }

    let insertAfterIndex = score.items.length - 1;
    let previewX = Math.max(layout.staffLeftX + 42, Math.min(layout.staffRightX - 28, x));

    if (sys.items.length > 0) {
      let foundBefore = false;
      for (let i = 0; i < sys.items.length; i++) {
        const pi = sys.items[i];
        if (x < pi.x + pi.width / 2) {
          insertAfterIndex = pi.indexInScore - 1;
          activeClef = pi.activeClef;
          previewX = Math.max(layout.staffLeftX + 32, pi.x - 10);
          foundBefore = true;
          break;
        }
      }
      if (!foundBefore) {
        const lastInSys = sys.items[sys.items.length - 1];
        insertAfterIndex = lastInSys.indexInScore;
        activeClef = lastInSys.activeClef;
        previewX = Math.min(layout.staffRightX - 26, lastInSys.x + lastInSys.width + 10);
      }
    } else if (sys.systemIndex > 0) {
      const prevSys = layout.systems[sys.systemIndex - 1];
      if (prevSys.items.length > 0) {
        insertAfterIndex = prevSys.items[prevSys.items.length - 1].indexInScore;
      }
    }

    const prevAtInsert =
      insertAfterIndex >= 0 && insertAfterIndex < score.items.length
        ? score.items[insertAfterIndex]
        : null;
    const defaultLabel =
      prevAtInsert && prevAtInsert.kind === 'syllable'
        ? prevAtInsert.lyric
          ? `Add to "${prevAtInsert.lyric}"`
          : 'Add note'
        : 'New syllable';

    return {
      pageIndex: page.pageIndex,
      systemIndex: sys.systemIndex,
      x: previewX,
      pitch,
      activeClef,
      target: {
        mode: 'insert-new-syllable',
        insertAfterIndex,
        label: defaultLabel,
      },
    };
  }

  const handleSvgPointerDown = (
    pageIndex: number,
    e: React.PointerEvent<SVGSVGElement>
  ) => {
    if (panMode || zoomModeActive || toolMode !== 'select' || e.button !== 0) return;
    const coords = clientToPageSvgCoords(pageIndex, e.clientX, e.clientY);
    if (!coords) return;
    setMarquee({
      pageIndex,
      startX: coords.x,
      startY: coords.y,
      curX: coords.x,
      curY: coords.y,
    });
  };

  const handleSvgPointerMove = (
    page: ScorePage,
    e: React.PointerEvent<SVGSVGElement>
  ) => {
    const coords = clientToPageSvgCoords(page.pageIndex, e.clientX, e.clientY);
    if (!coords) return;

    if (marquee && marquee.pageIndex === page.pageIndex) {
      setMarquee((prev) => (prev ? { ...prev, curX: coords.x, curY: coords.y } : null));
      return;
    }

    if (draggingNote && draggingNote.pageIndex === page.pageIndex) {
      const newPitch = yToPitch(coords.y, draggingNote.systemYTop);
      const delta = newPitch - draggingNote.lastPitch;
      if (delta !== 0) {
        setDraggingNote({ ...draggingNote, lastPitch: newPitch, didDrag: true });
        onDragNotePitch(
          draggingNote.itemId,
          draggingNote.noteId,
          newPitch,
          delta,
          draggingNote.clef
        );
      }
      return;
    }

    if (activePayload) {
      const preview = resolvePointerTarget(page, coords.x, coords.y);
      setHoverPreview(preview);
    } else if (hoverPreview) {
      setHoverPreview(null);
    }
  };

  const handleSvgPointerUp = (page: ScorePage) => {
    if (marquee && marquee.pageIndex === page.pageIndex) {
      const x1 = Math.min(marquee.startX, marquee.curX);
      const x2 = Math.max(marquee.startX, marquee.curX);
      const y1 = Math.min(marquee.startY, marquee.curY);
      const y2 = Math.max(marquee.startY, marquee.curY);
      const moved = x2 - x1 > 5 || y2 - y1 > 5;

      if (moved) {
        const matchedRefs: SelectedNoteRef[] = [];
        let fallbackItemId: string | null = null;
        for (const ps of page.systems) {
          const sysTop = ps.pageYTop - 12;
          const sysBottom = ps.pageYTop + layout.lyricYOffset + 12;
          if (y2 < sysTop || y1 > sysBottom) continue;

          for (const placed of ps.system.items) {
            if (placed.x + placed.width < x1 || placed.x > x2) continue;
            if (!fallbackItemId) fallbackItemId = placed.item.id;
            if (placed.item.kind === 'syllable') {
              for (const grp of placed.item.groups) {
                for (const note of grp.notes) {
                  matchedRefs.push({
                    itemId: placed.item.id,
                    groupId: grp.id,
                    noteId: note.id,
                  });
                }
              }
            }
          }
        }

        if (matchedRefs.length > 0) {
          onSelectText(null);
          onSelect({
            itemId: matchedRefs[0].itemId,
            groupId: matchedRefs[0].groupId,
            noteId: matchedRefs[0].noteId,
            selectedNotes: matchedRefs,
          });
        } else if (fallbackItemId) {
          onSelectText(null);
          onSelect({ itemId: fallbackItemId });
        }
      } else {
        onSelect(null);
        onSelectText(null);
      }

      setMarquee(null);
      return;
    }

    if (draggingNote) {
      if (!draggingNote.didDrag && draggingNote.pendingSingleSelect) {
        onSelectText(null);
        onSelect(draggingNote.pendingSingleSelect.sel, {
          pitch: draggingNote.pendingSingleSelect.pitch,
          clef: draggingNote.pendingSingleSelect.clef,
        });
      }
      setDraggingNote(null);
    }
  };

  const handleSvgDragOver = (page: ScorePage, e: React.DragEvent<SVGSVGElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const coords = clientToPageSvgCoords(page.pageIndex, e.clientX, e.clientY);
    if (!coords) return;
    const preview = resolvePointerTarget(page, coords.x, coords.y);
    setHoverPreview(preview);
  };

  const handleSvgDrop = (page: ScorePage, e: React.DragEvent<SVGSVGElement>) => {
    e.preventDefault();
    let payload: PaletteDragPayload | null = draggingPayload;
    const raw = e.dataTransfer.getData('application/x-chant-item');
    if (raw) {
      try {
        payload = JSON.parse(raw) as PaletteDragPayload;
      } catch {
        // ignore parse fallback
      }
    }
    const coords = clientToPageSvgCoords(page.pageIndex, e.clientX, e.clientY);
    setHoverPreview(null);
    if (!payload || !coords) return;

    const preview = resolvePointerTarget(page, coords.x, coords.y);
    if (!preview) return;

    const previewTarget = preview.target;
    if (payload.kind === 'neume') {
      onDropOrStampNeume(payload.preset, preview.pitch, previewTarget);
    } else if (payload.kind === 'division') {
      const afterIdx =
        previewTarget.mode === 'insert-new-syllable'
          ? previewTarget.insertAfterIndex
          : score.items.findIndex((it) => it.id === previewTarget.itemId);
      onDropDivision(payload.division, afterIdx);
    } else if (payload.kind === 'clef') {
      const afterIdx =
        previewTarget.mode === 'insert-new-syllable'
          ? previewTarget.insertAfterIndex
          : score.items.findIndex((it) => it.id === previewTarget.itemId);
      onDropClef(payload.clef, afterIdx);
    }
  };

  const handleSvgClick = (page: ScorePage, e: React.MouseEvent<SVGSVGElement>) => {
    if (panMode || zoomModeActive || toolMode !== 'insert' || !activePreset) return;
    const coords = clientToPageSvgCoords(page.pageIndex, e.clientX, e.clientY);
    if (!coords) return;
    const preview = resolvePointerTarget(page, coords.x, coords.y);
    if (!preview) return;
    onDropOrStampNeume(activePreset, preview.pitch, preview.target);
  };

  const startLyricEdit = (itemId: string, currentLyric: string) => {
    prevEditingScoreLyricRef.current = currentLyric;
    setEditingLyricId(itemId);
    setLyricDraft(currentLyric);
    setLyricSelRange(null);
  };

  const commitLyricEdit = (itemId: string, advanceNext = false) => {
    const trimmed = lyricDraft;
    let wordEnd: boolean | undefined = undefined;
    let finalLyric = trimmed;
    if (trimmed.endsWith('-')) {
      wordEnd = false;
      finalLyric = trimmed.slice(0, -1);
    } else if (trimmed.endsWith(' ')) {
      wordEnd = true;
      finalLyric = trimmed.trimEnd();
    }
    prevEditingScoreLyricRef.current = finalLyric;
    onUpdateLyric(itemId, finalLyric, wordEnd);
    setEditingLyricId(null);
    setLyricSelRange(null);

    if (advanceNext) {
      const idx = score.items.findIndex((it) => it.id === itemId);
      const nextSyl = score.items.slice(idx + 1).find((it) => it.kind === 'syllable');
      if (nextSyl && nextSyl.kind === 'syllable') {
        prevEditingScoreLyricRef.current = nextSyl.lyric;
        setEditingLyricId(nextSyl.id);
        setLyricDraft(nextSyl.lyric);
      }
    }
  };

  const applyInlineLyricAccent = (accent: VowelAccentType) => {
    if (!editingLyricId || !lyricSelRange || lyricSelRange.end <= lyricSelRange.start) return;
    const res = applyAccentToStringRange(
      lyricDraft,
      lyricSelRange.start,
      lyricSelRange.end,
      accent
    );
    if (!res.changed) return;
    prevEditingScoreLyricRef.current = res.text;
    setLyricDraft(res.text);
    setLyricSelRange(res.nextRange);
    onUpdateLyric(editingLyricId, res.text);
    onSelectText({
      kind: 'lyric-range',
      itemId: editingLyricId,
      start: res.nextRange.start,
      end: res.nextRange.end,
    });
    requestAnimationFrame(() => {
      if (lyricInputRef.current) {
        lyricInputRef.current.focus();
        lyricInputRef.current.setSelectionRange(res.nextRange.start, res.nextRange.end);
      }
    });
  };

  const applyInlineHeaderAccent = (field: 'name' | 'officePart', accent: VowelAccentType) => {
    if (
      textSelection?.kind !== 'header' ||
      textSelection.field !== field ||
      !textSelection.range ||
      textSelection.range.end <= textSelection.range.start
    ) {
      return;
    }
    const currentVal = field === 'name' ? score.header.name : score.header.officePart;
    const res = applyAccentToStringRange(
      currentVal,
      textSelection.range.start,
      textSelection.range.end,
      accent
    );
    if (!res.changed) return;
    onUpdateHeader(field === 'name' ? { name: res.text } : { officePart: res.text });
    onSelectText({ kind: 'header', field, range: res.nextRange });
    const inputEl = field === 'name' ? nameInputRef.current : officeInputRef.current;
    requestAnimationFrame(() => {
      if (inputEl) {
        inputEl.focus();
        inputEl.setSelectionRange(res.nextRange.start, res.nextRange.end);
      }
    });
  };

  const hoverPitchInfo = hoverPreview
    ? resolvePitch(
        hoverPreview.pitch,
        hoverPreview.activeClef,
        parseClefConfig(hoverPreview.activeClef).hasFlatSignature
      )
    : null;

  const scaledPageWidth = Math.round(pageDims.svgWidth * zoom);
  const scaledPageHeight = Math.round(pageDims.svgHeight * zoom);
  const metaHeaderFontSize = Math.min(18, Math.max(10, Math.round(typo.titleFontSize * 0.44)));

  const titleText = score.header.name || 'Cantus Novus';
  const titleSegments = splitTextIntoColoredSegments(
    titleText,
    score.header.titleColor || '#151210',
    score.header.titleSpans
  );

  const rawOfficePart = score.header.officePart?.trim() || '';
  const rawMode = score.header.mode?.trim() || '';
  const rawAnnotation = score.header.annotation?.trim() || '';

  const officeSegments = splitTextIntoColoredSegments(
    rawOfficePart,
    score.header.officePartColor || '#9E1B1E',
    score.header.officePartSpans
  );

  const firstPageSys0 = pages[0]?.systems[0] ?? null;
  const showLabelsAboveDropCap = Boolean(dropCapChar && firstPageSys0);
  const modeAboveDropCap = (rawMode || rawAnnotation).trim();
  const topRightAnnotation =
    rawAnnotation && rawAnnotation !== rawMode && rawAnnotation !== rawOfficePart
      ? rawAnnotation
      : '';

  const handleHeaderSelectionCheck = (
    field: 'name' | 'officePart',
    el: HTMLInputElement
  ) => {
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    if (end > start) {
      onSelectText({ kind: 'header', field, range: { start, end } });
    } else {
      onSelectText({ kind: 'header', field });
    }
  };

  return (
    <div className="mx-auto flex flex-col items-center gap-7 py-7 px-4 sm:px-7 print:p-0 print:gap-0">
      {pages.map((page) => {
        const isFirstPage = page.pageIndex === 0;
        const rulePad = Math.min(120, Math.round(page.pageWidth * 0.14));

        return (
          <div
            key={page.pageIndex}
            className="print-page-wrapper relative shrink-0"
            style={{ width: `${scaledPageWidth}px`, height: `${scaledPageHeight}px` }}
          >
            <div
              className="missal-folio print-folio relative origin-top-left overflow-hidden rounded-sm border border-[#CFC3AE] shadow-[0_8px_32px_rgba(29,25,21,0.12)]"
              style={{
                width: `${page.pageWidth}px`,
                height: `${page.pageHeight}px`,
                transform: `scale(${zoom})`,
              }}
            >
              {/* Full-Page SVG Engraved Score */}
              <svg
                ref={(el) => {
                  svgRefs.current[page.pageIndex] = el;
                }}
                viewBox={`0 0 ${page.pageWidth} ${page.pageHeight}`}
                className={`block h-full w-full select-none ${
                  panMode
                    ? 'cursor-grab active:cursor-grabbing'
                    : zoomModeActive
                    ? zoomCursorOut
                      ? 'cursor-zoom-out'
                      : 'cursor-zoom-in'
                    : toolMode === 'insert'
                    ? 'cursor-crosshair'
                    : 'cursor-default'
                }`}
                onPointerDown={(e) => handleSvgPointerDown(page.pageIndex, e)}
                onPointerMove={(e) => handleSvgPointerMove(page, e)}
                onPointerUp={() => handleSvgPointerUp(page)}
                onPointerLeave={() => {
                  setHoverPreview(null);
                  setDraggingNote(null);
                  setMarquee(null);
                }}
                onDragOver={(e) => handleSvgDragOver(page, e)}
                onDragLeave={() => setHoverPreview(null)}
                onDrop={(e) => handleSvgDrop(page, e)}
                onClick={(e) => handleSvgClick(page, e)}
              >
                {/* Archival Folio Inner Border matching PNG/PDF export */}
                <rect
                  x={16}
                  y={16}
                  width={page.pageWidth - 32}
                  height={page.pageHeight - 32}
                  fill="none"
                  stroke="#D8CFC0"
                  strokeWidth={1}
                  className="pointer-events-none"
                />

                {/* Rubric Divider Hairline on Page 1 */}
                {isFirstPage && (
                  <line
                    x1={rulePad}
                    y1={ruleY}
                    x2={page.pageWidth - rulePad}
                    y2={ruleY}
                    stroke={RUBRIC_RED}
                    strokeOpacity={0.38}
                    strokeWidth={1}
                    className="pointer-events-none"
                  />
                )}

                {page.systems.map((ps) => {
                  const sys = ps.system;
                  const yTop = ps.pageYTop;
                  const lineYs = getStaffLineYs(yTop);
                  const staffStartX =
                    sys.systemIndex === 0 && dropCapChar
                      ? layout.staffStartXFirstSystem
                      : layout.staffLeftX;

                  const isDropCapSelected =
                    textSelection?.kind === 'header' && textSelection.field === 'dropCap';

                  let highlightBand: { x1: number; x2: number } | null = null;
                  if (highlightedPhraseRange) {
                    const matchingPlaced = sys.items.filter(
                      (pi) =>
                        pi.indexInScore >= highlightedPhraseRange.startIdx &&
                        pi.indexInScore <= highlightedPhraseRange.endIdx
                    );
                    if (matchingPlaced.length > 0) {
                      highlightBand = {
                        x1: Math.min(...matchingPlaced.map((pi) => pi.x)) - 3,
                        x2: Math.max(...matchingPlaced.map((pi) => pi.x + pi.width)) + 3,
                      };
                    }
                  }

                  return (
                    <g key={sys.systemIndex}>
                      {/* Hovered/Open Phrase Span Highlight Band (below staff) */}
                      {highlightBand && (
                        <rect
                          x={highlightBand.x1}
                          y={yTop + STAFF_HEIGHT + 2}
                          width={Math.max(10, highlightBand.x2 - highlightBand.x1)}
                          height={Math.max(18, layout.lyricYOffset - STAFF_HEIGHT + 8)}
                          rx={3}
                          fill="rgba(180, 131, 39, 0.14)"
                          stroke="rgba(180, 131, 39, 0.45)"
                          strokeWidth={1}
                          className="no-print pointer-events-none"
                          data-phrase-highlight-band="true"
                        />
                      )}

                      {/* Engraved 4-line Staff */}
                      {lineYs.map((ly, li) => (
                        <line
                          key={li}
                          x1={staffStartX}
                          y1={ly}
                          x2={layout.staffRightX}
                          y2={ly}
                          stroke={STAFF_LINE_INK}
                          strokeOpacity={0.78}
                          strokeWidth={0.9}
                        />
                      ))}

                      {/* Drop-Cap Initial on System 0 — bottom aligned flush with first-line lyric baseline */}
                      {sys.systemIndex === 0 && dropCapChar && (
                        <g
                          className={panMode ? undefined : 'cursor-pointer'}
                          onPointerDown={(e) => {
                            if (panMode) return;
                            e.stopPropagation();
                          }}
                          onClick={(e) => {
                            if (panMode) return;
                            e.stopPropagation();
                            onSelect(null);
                            onSelectText({ kind: 'header', field: 'dropCap' });
                          }}
                        >
                          <rect
                            x={layout.staffLeftX - 4}
                            y={yTop - 6}
                            width={Math.max(48, layout.staffStartXFirstSystem - layout.staffLeftX)}
                            height={layout.lyricYOffset + 12}
                            rx={3}
                            fill={isDropCapSelected ? 'rgba(139, 30, 36, 0.08)' : 'transparent'}
                            stroke={isDropCapSelected ? RUBRIC_RED : 'transparent'}
                            strokeDasharray="3 2"
                          />
                          <text
                            x={layout.dropCapCenterX}
                            y={yTop + layout.lyricYOffset}
                            textAnchor="middle"
                            fontFamily={titleFontCss}
                            fontSize={layout.dropCapFontSize}
                            fontWeight={600}
                            fill={score.header.dropCapColor || RUBRIC_RED}
                          >
                            {dropCapChar}
                          </text>
                        </g>
                      )}

                      {/* Opening Clef on Wrapped Systems */}
                      {sys.showOpeningClef && (
                        <g
                          dangerouslySetInnerHTML={{
                            __html: renderClefElements(
                              sys.openingClef,
                              layout.staffLeftX + 4,
                              yTop,
                              INK_BLACK
                            ),
                          }}
                        />
                      )}

                      {/* Placed Score Items */}
                      {sys.items.map((placed) => {
                        const item = placed.item;
                        const isItemSelected = selectedItemIds.has(item.id);
                        const isHoveredSyllable =
                          hoverPreview?.target.mode === 'append-to-syllable' &&
                          hoverPreview.target.itemId === item.id;

                        if (item.kind === 'clef') {
                          return (
                            <g
                              key={item.id}
                              data-item-id={item.id}
                              className={panMode ? undefined : 'cursor-pointer'}
                              onPointerDown={(e) => {
                                if (panMode) return;
                                e.stopPropagation();
                              }}
                              onClick={(e) => {
                                if (panMode || toolMode === 'insert') return;
                                e.stopPropagation();
                                onSelectText(null);
                                onSelect({ itemId: item.id });
                              }}
                            >
                              <rect
                                x={placed.neumeStartX - 4}
                                y={yTop - 8}
                                width={placed.neumeWidth + 8}
                                height={STAFF_HEIGHT + 16}
                                rx={2}
                                fill={isItemSelected ? 'rgba(158,27,30,0.08)' : 'transparent'}
                                stroke={isItemSelected ? RUBRIC_RED : 'transparent'}
                                strokeDasharray="2 2"
                              />
                              <g
                                dangerouslySetInnerHTML={{
                                  __html: renderClefElements(
                                    item.clef,
                                    placed.neumeStartX,
                                    yTop,
                                    isItemSelected ? RUBRIC_RED : INK_BLACK
                                  ),
                                }}
                              />
                            </g>
                          );
                        }

                        if (item.kind === 'division') {
                          return (
                            <g
                              key={item.id}
                              data-item-id={item.id}
                              className={panMode ? undefined : 'cursor-pointer'}
                              onPointerDown={(e) => {
                                if (panMode) return;
                                e.stopPropagation();
                              }}
                              onClick={(e) => {
                                if (panMode || toolMode === 'insert') return;
                                e.stopPropagation();
                                onSelectText(null);
                                onSelect({ itemId: item.id });
                              }}
                            >
                              <rect
                                x={placed.x}
                                y={yTop - 8}
                                width={placed.width}
                                height={layout.lyricYOffset + 16}
                                rx={2}
                                fill={isItemSelected ? 'rgba(158,27,30,0.08)' : 'transparent'}
                                stroke={isItemSelected ? RUBRIC_RED : 'transparent'}
                                strokeDasharray="2 2"
                              />
                              <g
                                dangerouslySetInnerHTML={{
                                  __html: renderDivisionElements(
                                    item.division,
                                    placed.neumeStartX,
                                    yTop,
                                    isItemSelected ? RUBRIC_RED : INK_BLACK
                                  ),
                                }}
                              />
                              {item.lyric && (
                                <text
                                  x={placed.lyricX}
                                  y={yTop + layout.lyricYOffset}
                                  textAnchor="middle"
                                  fontFamily={lyricFontCss}
                                  fontSize={typo.lyricFontSize}
                                  fontStyle="italic"
                                  fill={item.lyricColor || RUBRIC_RED}
                                >
                                  {item.lyric}
                                </text>
                              )}
                            </g>
                          );
                        }

                        if (item.kind === 'syllable') {
                          const isFirstTextSyl =
                            placed.indexInScore === firstSyllableWithTextIdx &&
                            dropCapChar.length > 0;
                          const textBody = isFirstTextSyl ? item.lyric.slice(1) : item.lyric;
                          const displayLyric =
                            textBody + (!item.wordEnd && textBody ? '-' : '');
                          const hasPlayingNote = item.groups.some((g) =>
                            g.notes.some((n) => n.id === playingNoteId)
                          );
                          const isRubricToken =
                            displayLyric === '*' || displayLyric === '†';
                          const baseLyricColor =
                            item.lyricColor ||
                            (isRubricToken
                              ? RUBRIC_RED
                              : item.lyric
                              ? INK_BLACK
                              : '#B3A693');

                          const shiftedSpans =
                            isFirstTextSyl && item.lyricSpans
                              ? item.lyricSpans
                                  .map((sp) => ({
                                    ...sp,
                                    start: sp.start - 1,
                                    end: sp.end - 1,
                                  }))
                                  .filter((sp) => sp.end > 0)
                              : item.lyricSpans;

                          const lyricSegments = splitTextIntoColoredSegments(
                            displayLyric,
                            baseLyricColor,
                            shiftedSpans
                          );

                          return (
                            <g key={item.id} data-item-id={item.id}>
                              <rect
                                x={placed.x - 1}
                                y={yTop - 12}
                                width={placed.width + 2}
                                height={layout.lyricYOffset + 22}
                                rx={3}
                                fill={
                                  hasPlayingNote
                                    ? 'rgba(180, 120, 24, 0.14)'
                                    : isHoveredSyllable
                                    ? 'rgba(158, 27, 30, 0.08)'
                                    : isItemSelected
                                    ? 'rgba(158, 27, 30, 0.04)'
                                    : 'transparent'
                                }
                                stroke={
                                  isHoveredSyllable
                                    ? 'rgba(158, 27, 30, 0.5)'
                                    : isItemSelected
                                    ? 'rgba(158, 27, 30, 0.25)'
                                    : 'transparent'
                                }
                                strokeDasharray={isHoveredSyllable ? '3 2' : undefined}
                                className="pointer-events-none"
                              />

                              {placed.groups?.map((pg) => {
                                const grpMarkup = renderGroupSvgMarkup(
                                  pg.groupLayout,
                                  pg.x,
                                  yTop,
                                  INK_BLACK
                                );

                                return (
                                  <g key={pg.groupLayout.group.id}>
                                    <g dangerouslySetInnerHTML={{ __html: grpMarkup }} />

                                    {pg.groupLayout.notes.map((pn) => {
                                      const nx = pg.x + pn.x;
                                      const cy = yTop + pn.yOffset;
                                      const isNoteSelected = selectedNoteIds.has(pn.note.id);
                                      const isNotePlaying = playingNoteId === pn.note.id;

                                      return (
                                        <g key={pn.note.id}>
                                          {(isNoteSelected || isNotePlaying) && (
                                            <rect
                                              x={nx - 3}
                                              y={cy - 8}
                                              width={NOTE_W + 6}
                                              height={16}
                                              rx={2}
                                              fill={
                                                isNotePlaying
                                                  ? 'rgba(185, 118, 16, 0.32)'
                                                  : 'rgba(158, 27, 30, 0.18)'
                                              }
                                              stroke={isNotePlaying ? '#B47610' : RUBRIC_RED}
                                              strokeWidth={1.3}
                                              className="pointer-events-none"
                                            />
                                          )}
                                          <rect
                                            x={nx - 3}
                                            y={cy - 10}
                                            width={NOTE_W + 6}
                                            height={20}
                                            fill="transparent"
                                            className={
                                              panMode
                                                ? ''
                                                : toolMode === 'select'
                                                ? 'cursor-ns-resize'
                                                : 'cursor-crosshair'
                                            }
                                            onPointerDown={(e) => {
                                              if (panMode || toolMode === 'insert') return;
                                              e.stopPropagation();
                                              onSelectText(null);
                                              const noteSel: SelectionState = {
                                                itemId: item.id,
                                                groupId: pg.groupLayout.group.id,
                                                noteId: pn.note.id,
                                              };
                                              if (e.shiftKey || e.metaKey || e.ctrlKey) {
                                                onSelect(
                                                  noteSel,
                                                  {
                                                    pitch: pn.note.pitch,
                                                    clef: placed.activeClef,
                                                  },
                                                  {
                                                    shiftKey: e.shiftKey,
                                                    toggleKey: e.metaKey || e.ctrlKey,
                                                  }
                                                );
                                                return;
                                              }
                                              if (
                                                selectedNoteIds.size > 1 &&
                                                selectedNoteIds.has(pn.note.id)
                                              ) {
                                                setDraggingNote({
                                                  pageIndex: page.pageIndex,
                                                  itemId: item.id,
                                                  noteId: pn.note.id,
                                                  clef: placed.activeClef,
                                                  systemYTop: yTop,
                                                  lastPitch: pn.note.pitch,
                                                  didDrag: false,
                                                  pendingSingleSelect: {
                                                    sel: noteSel,
                                                    pitch: pn.note.pitch,
                                                    clef: placed.activeClef,
                                                  },
                                                });
                                                return;
                                              }
                                              onSelect(noteSel, {
                                                pitch: pn.note.pitch,
                                                clef: placed.activeClef,
                                              });
                                              setDraggingNote({
                                                pageIndex: page.pageIndex,
                                                itemId: item.id,
                                                noteId: pn.note.id,
                                                clef: placed.activeClef,
                                                systemYTop: yTop,
                                                lastPitch: pn.note.pitch,
                                                didDrag: false,
                                              });
                                            }}
                                          />
                                        </g>
                                      );
                                    })}
                                  </g>
                                );
                              })}

                              {/* Clickable Lyric Underlay */}
                              <g
                                className={panMode ? undefined : 'cursor-text'}
                                onPointerDown={(e) => {
                                  if (panMode) return;
                                  e.stopPropagation();
                                }}
                                onClick={(e) => {
                                  if (panMode) return;
                                  e.stopPropagation();
                                  const noteSel: SelectionState = {
                                    itemId: item.id,
                                    groupId: item.groups[0]?.id,
                                    noteId: item.groups[0]?.notes[0]?.id,
                                  };
                                  onSelectText(null);
                                  if (e.shiftKey || e.metaKey || e.ctrlKey) {
                                    onSelect(noteSel, undefined, {
                                      shiftKey: e.shiftKey,
                                      toggleKey: e.metaKey || e.ctrlKey,
                                    });
                                    return;
                                  }
                                  onSelect(noteSel);
                                  startLyricEdit(item.id, item.lyric);
                                }}
                              >
                                <rect
                                  x={placed.x}
                                  y={yTop + STAFF_HEIGHT + 8}
                                  width={placed.width}
                                  height={Math.max(24, layout.lyricYOffset - STAFF_HEIGHT + 10)}
                                  fill="transparent"
                                />
                                <text
                                  x={placed.lyricX}
                                  y={yTop + layout.lyricYOffset}
                                  textAnchor="middle"
                                  fontFamily={lyricFontCss}
                                  fontSize={typo.lyricFontSize}
                                  fill={baseLyricColor}
                                  fontStyle={item.lyric ? 'normal' : 'italic'}
                                >
                                  {lyricSegments.length <= 1
                                    ? displayLyric
                                    : lyricSegments.map((seg, sIdx) => (
                                        <tspan key={sIdx} fill={seg.color}>
                                          {seg.text}
                                        </tspan>
                                      ))}
                                </text>
                              </g>
                            </g>
                          );
                        }

                        return null;
                      })}

                      {/* End-of-line Custos */}
                      {sys.custosPitch !== null && (
                        <g
                          dangerouslySetInnerHTML={{
                            __html: renderCustosMarkup(
                              layout.staffRightX - 9,
                              pitchToY(sys.custosPitch, yTop),
                              sys.custosPitch,
                              INK_BLACK
                            ),
                          }}
                        />
                      )}

                      {/* Live Ghost Preview on Hover / Drag */}
                      {hoverPreview &&
                        hoverPreview.pageIndex === page.pageIndex &&
                        hoverPreview.systemIndex === sys.systemIndex &&
                        activePayload && (
                          <g className="pointer-events-none" opacity={0.62}>
                            {activePayload.kind === 'neume' && (
                              <g
                                dangerouslySetInnerHTML={{
                                  __html: renderGroupSvgMarkup(
                                    layoutPresetPreview(activePayload.preset, hoverPreview.pitch),
                                    hoverPreview.x,
                                    yTop,
                                    RUBRIC_RED
                                  ),
                                }}
                              />
                            )}
                            {activePayload.kind === 'division' && (
                              <g
                                dangerouslySetInnerHTML={{
                                  __html: renderDivisionElements(
                                    activePayload.division,
                                    hoverPreview.x,
                                    yTop,
                                    RUBRIC_RED
                                  ),
                                }}
                              />
                            )}
                            {activePayload.kind === 'clef' && (
                              <g
                                dangerouslySetInnerHTML={{
                                  __html: renderClefElements(
                                    activePayload.clef,
                                    hoverPreview.x,
                                    yTop,
                                    RUBRIC_RED
                                  ),
                                }}
                              />
                            )}

                            {hoverPitchInfo && (
                              <g transform={`translate(${hoverPreview.x + 8}, ${yTop - 16})`}>
                                <rect
                                  x={-48}
                                  y={-13}
                                  width={116}
                                  height={17}
                                  rx={2}
                                  fill="#151210"
                                  fillOpacity={0.86}
                                />
                                <text
                                  x={10}
                                  y={-1}
                                  textAnchor="middle"
                                  fontFamily={lyricFontCss}
                                  fontSize={10.5}
                                  fill="#FAF6EE"
                                >
                                  {hoverPitchInfo.solfege} ({hoverPitchInfo.gabcChar}) ·{' '}
                                  {hoverPreview.target.label}
                                </text>
                              </g>
                            )}
                          </g>
                        )}
                    </g>
                  );
                })}

                {/* Page Number Footer when split into multiple pages */}
                {pages.length > 1 && (
                  <text
                    x={page.pageWidth / 2}
                    y={page.pageHeight - 28}
                    textAnchor="middle"
                    fontFamily={titleFontCss}
                    fontSize={11}
                    letterSpacing={1.2}
                    fill="#6B6257"
                    className="pointer-events-none"
                  >
                    — {page.pageIndex + 1} —
                  </text>
                )}

                {/* Marquee Drag Selection Box */}
                {marquee && marquee.pageIndex === page.pageIndex && (
                  <rect
                    x={Math.min(marquee.startX, marquee.curX)}
                    y={Math.min(marquee.startY, marquee.curY)}
                    width={Math.abs(marquee.curX - marquee.startX)}
                    height={Math.abs(marquee.curY - marquee.startY)}
                    fill="rgba(139, 30, 36, 0.08)"
                    stroke="#8B1E24"
                    strokeWidth={1}
                    strokeDasharray="4 2"
                    className="pointer-events-none"
                  />
                )}
              </svg>

              {/* Interactive Header Overlay on Page 1 */}
              {isFirstPage && (
                <div className="pointer-events-none absolute inset-x-0 top-0 z-10 px-[48px] pt-[30px] text-center">
                  <div className="mb-1.5 flex min-h-[20px] items-center justify-between gap-2 tracking-[0.14em] uppercase">
                    {!showLabelsAboveDropCap ? (
                      <div
                        className="pointer-events-auto flex items-center gap-1.5"
                        style={{ fontFamily: titleFontCss, fontSize: `${typo.officePartFontSize}px` }}
                      >
                        {editingHeaderField === 'officePart' ? (
                          <div className="relative">
                            {textSelection?.kind === 'header' &&
                              textSelection.field === 'officePart' &&
                              textSelection.range &&
                              textSelection.range.end > textSelection.range.start &&
                              textHasVowel(
                                score.header.officePart.slice(
                                  textSelection.range.start,
                                  textSelection.range.end
                                )
                              ) && (
                                <div className="no-print absolute top-full left-0 z-30 mt-1 flex items-center gap-0.5 rounded border border-[#CFC3AE] bg-[#FAF6EE] px-1 py-0.5 shadow-md">
                                  {VOWEL_ACCENT_OPTIONS.map((opt) => (
                                    <button
                                      key={opt.id}
                                      type="button"
                                      onMouseDown={(e) => e.preventDefault()}
                                      onClick={() => applyInlineHeaderAccent('officePart', opt.id)}
                                      title={opt.tooltip}
                                      className="h-5 min-w-[20px] rounded px-1 font-[family-name:var(--font-serif)] text-xs font-semibold normal-case tracking-normal text-[#1D1915] hover:bg-[#8B1E24] hover:text-[#FAF6EE]"
                                    >
                                      {opt.id === 'none' ? 'a' : opt.preview}
                                    </button>
                                  ))}
                                </div>
                              )}
                            <input
                              ref={officeInputRef}
                              autoFocus
                              type="text"
                              value={score.header.officePart}
                              onChange={(e) => onUpdateHeader({ officePart: e.target.value })}
                              onSelect={(e) => handleHeaderSelectionCheck('officePart', e.currentTarget)}
                              onKeyUp={(e) => handleHeaderSelectionCheck('officePart', e.currentTarget)}
                              onMouseUp={(e) => handleHeaderSelectionCheck('officePart', e.currentTarget)}
                              onBlur={() => setEditingHeaderField(null)}
                              onKeyDown={(e) => e.key === 'Enter' && setEditingHeaderField(null)}
                              placeholder="Office part"
                              style={{
                                fontFamily: titleFontCss,
                                color: score.header.officePartColor || '#9E1B1E',
                              }}
                              className="w-36 border-b border-[#9E1B1E] bg-transparent text-xs uppercase tracking-[0.14em] focus:outline-none"
                            />
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              onSelect(null);
                              onSelectText({ kind: 'header', field: 'officePart' });
                              setEditingHeaderField('officePart');
                            }}
                            className={`group/office min-h-[18px] min-w-[3.5rem] rounded-sm px-1 text-left hover:underline focus-visible:outline-1 focus-visible:outline-[#9E1B1E] ${
                              textSelection?.kind === 'header' &&
                              textSelection.field === 'officePart'
                                ? 'ring-1 ring-[#8B1E24]/60 bg-[#8B1E24]/5'
                                : ''
                            }`}
                            title={
                              rawOfficePart
                                ? 'Click to edit or color liturgical office part'
                                : 'Click to add office part'
                            }
                          >
                            {rawOfficePart ? (
                              officeSegments.map((seg, i) => (
                                <span key={i} style={{ color: seg.color }}>
                                  {seg.text}
                                </span>
                              ))
                            ) : (
                              <span className="no-print text-[10px] tracking-normal normal-case text-[#9E1B1E]/65 opacity-0 transition-opacity group-hover/office:opacity-100 group-focus-visible/office:opacity-100">
                                + Office
                              </span>
                            )}
                          </button>
                        )}

                        {rawOfficePart && rawMode && (
                          <span className="text-[#9E1B1E]" aria-hidden="true">
                            ·
                          </span>
                        )}

                        {editingHeaderField === 'mode' ? (
                          <input
                            autoFocus
                            type="text"
                            value={score.header.mode}
                            onChange={(e) =>
                              onUpdateHeader({ mode: e.target.value, annotation: e.target.value })
                            }
                            onBlur={() => setEditingHeaderField(null)}
                            onKeyDown={(e) => e.key === 'Enter' && setEditingHeaderField(null)}
                            placeholder="VIII"
                            style={{
                              fontFamily: titleFontCss,
                              fontSize: `${typo.modeFontSize}px`,
                              color: score.header.modeColor || '#9E1B1E',
                            }}
                            className="w-16 border-b border-[#9E1B1E] bg-transparent text-xs uppercase tracking-[0.14em] focus:outline-none"
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              onSelect(null);
                              onSelectText({ kind: 'header', field: 'mode' });
                              setEditingHeaderField('mode');
                            }}
                            style={{ fontSize: `${typo.modeFontSize}px`, color: score.header.modeColor || '#9E1B1E' }}
                            className={`group/mode min-h-[18px] min-w-[3rem] rounded-sm px-1 text-left hover:underline focus-visible:outline-1 focus-visible:outline-[#9E1B1E] ${
                              textSelection?.kind === 'header' && textSelection.field === 'mode'
                                ? 'ring-1 ring-[#8B1E24]/60 bg-[#8B1E24]/5'
                                : ''
                            }`}
                            title={
                              rawMode
                                ? 'Click to edit or color chant mode'
                                : 'Click to set chant mode'
                            }
                          >
                            {rawMode ? (
                              `Mode ${rawMode}`
                            ) : (
                              <span className="no-print text-[10px] tracking-normal normal-case text-[#9E1B1E]/65 opacity-0 transition-opacity group-hover/mode:opacity-100 group-focus-visible/mode:opacity-100">
                                + Mode
                              </span>
                            )}
                          </button>
                        )}
                      </div>
                    ) : (
                      <div />
                    )}

                    <div className="pointer-events-auto">
                      {editingHeaderField === 'annotation' ? (
                        <input
                          autoFocus
                          type="text"
                          value={score.header.annotation}
                          onChange={(e) => onUpdateHeader({ annotation: e.target.value })}
                          onBlur={() => setEditingHeaderField(null)}
                          onKeyDown={(e) => e.key === 'Enter' && setEditingHeaderField(null)}
                          placeholder="Annotation"
                          style={{
                            fontFamily: titleFontCss,
                            fontSize: `${typo.modeFontSize}px`,
                            color: score.header.annotationColor || '#6B6257',
                          }}
                          className="w-28 border-b border-[#9E1B1E] bg-transparent text-right text-[11px] uppercase tracking-[0.14em] focus:outline-none"
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            onSelect(null);
                            onSelectText({ kind: 'header', field: 'annotation' });
                            setEditingHeaderField('annotation');
                          }}
                          style={{
                            fontFamily: titleFontCss,
                            fontSize: `${metaHeaderFontSize}px`,
                            color: score.header.annotationColor || '#9E1B1E',
                          }}
                          className={`group/ann min-h-[18px] min-w-[3.5rem] rounded-sm px-1 text-right hover:underline ${
                            textSelection?.kind === 'header' &&
                            textSelection.field === 'annotation'
                              ? 'ring-1 ring-[#8B1E24]/60 bg-[#8B1E24]/5'
                              : ''
                          }`}
                          title={
                            (showLabelsAboveDropCap ? topRightAnnotation : rawAnnotation)
                              ? 'Click to edit or color annotation'
                              : 'Click to add annotation'
                          }
                        >
                          {(showLabelsAboveDropCap ? topRightAnnotation : rawAnnotation) || (
                            <span className="no-print text-[10px] tracking-normal normal-case text-[#6B6257]/75 opacity-0 transition-opacity group-hover/ann:opacity-100 group-focus-visible/ann:opacity-100">
                              + Note
                            </span>
                          )}
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="pointer-events-auto">
                    {editingHeaderField === 'name' ? (
                      <div className="relative mx-auto max-w-lg">
                        {textSelection?.kind === 'header' &&
                          textSelection.field === 'name' &&
                          textSelection.range &&
                          textSelection.range.end > textSelection.range.start &&
                          textHasVowel(
                            score.header.name.slice(
                              textSelection.range.start,
                              textSelection.range.end
                            )
                          ) && (
                            <div className="no-print absolute top-full left-1/2 z-30 mt-1 flex -translate-x-1/2 items-center gap-0.5 rounded border border-[#CFC3AE] bg-[#FAF6EE] px-1.5 py-0.5 shadow-md">
                              <span className="mr-1 text-[10px] font-medium text-[#6B6257] whitespace-nowrap">
                                Accent:
                              </span>
                              {VOWEL_ACCENT_OPTIONS.map((opt) => (
                                <button
                                  key={opt.id}
                                  type="button"
                                  onMouseDown={(e) => e.preventDefault()}
                                  onClick={() => applyInlineHeaderAccent('name', opt.id)}
                                  title={opt.tooltip}
                                  className="h-5 min-w-[22px] rounded px-1 font-[family-name:var(--font-serif)] text-xs font-semibold text-[#1D1915] hover:bg-[#8B1E24] hover:text-[#FAF6EE]"
                                >
                                  {opt.id === 'none' ? 'Plain' : opt.preview}
                                </button>
                              ))}
                            </div>
                          )}
                        <input
                          ref={nameInputRef}
                          autoFocus
                          type="text"
                          value={score.header.name}
                          onChange={(e) => onUpdateHeader({ name: e.target.value })}
                          onSelect={(e) => handleHeaderSelectionCheck('name', e.currentTarget)}
                          onKeyUp={(e) => handleHeaderSelectionCheck('name', e.currentTarget)}
                          onMouseUp={(e) => handleHeaderSelectionCheck('name', e.currentTarget)}
                          onBlur={() => setEditingHeaderField(null)}
                          onKeyDown={(e) => e.key === 'Enter' && setEditingHeaderField(null)}
                          style={{
                            fontFamily: titleFontCss,
                            fontSize: `${typo.titleFontSize}px`,
                            color: score.header.titleColor || '#151210',
                          }}
                          className="mx-auto block w-full border-b border-[#9E1B1E] bg-transparent text-center font-semibold leading-[1.1] focus:outline-none"
                        />
                      </div>
                    ) : (
                      <h1
                        onClick={() => {
                          onSelect(null);
                          onSelectText({ kind: 'header', field: 'name' });
                          setEditingHeaderField('name');
                        }}
                        title="Click to edit title or highlight words to color"
                        style={{
                          fontFamily: titleFontCss,
                          fontSize: `${typo.titleFontSize}px`,
                        }}
                        className={`mx-auto inline-block cursor-text rounded-sm px-2 font-semibold leading-[1.1] tracking-wide transition-colors text-balance ${
                          textSelection?.kind === 'header' && textSelection.field === 'name'
                            ? 'ring-1 ring-[#8B1E24]/50 bg-[#8B1E24]/5'
                            : ''
                        }`}
                      >
                        {titleSegments.map((seg, i) => (
                          <span key={i} style={{ color: seg.color }}>
                            {seg.text}
                          </span>
                        ))}
                      </h1>
                    )}
                  </div>
                </div>
              )}

              {/* Traditional Liturgical Office Part & Mode stacked right above the Drop Cap */}
              {isFirstPage &&
                showLabelsAboveDropCap &&
                firstPageSys0 &&
                (() => {
                  const yTop = firstPageSys0.pageYTop;
                  const dropCapHeaderBottomY = Math.min(
                    yTop - 5,
                    yTop + layout.lyricYOffset - layout.dropCapFontSize * 0.72 - 5
                  );
                  const maxCenteredW = Math.max(40, (layout.dropCapCenterX - 24) * 2);
                  const estMaxW = Math.max(
                    rawOfficePart.length * typo.officePartFontSize * 0.51,
                    modeAboveDropCap.length * typo.modeFontSize * 0.58
                  );
                  const alignLeft =
                    estMaxW > maxCenteredW ||
                    editingHeaderField === 'officePart' ||
                    editingHeaderField === 'mode';

                  return (
                    <div
                      style={{
                        left: `${alignLeft ? 24 : layout.dropCapCenterX}px`,
                        top: `${Math.max(18, dropCapHeaderBottomY)}px`,
                      }}
                      className={`group/stack pointer-events-auto absolute z-20 flex min-h-[18px] min-w-[44px] -translate-y-full flex-col justify-end gap-0.5 leading-[1.15] ${
                        alignLeft
                          ? 'items-start text-left'
                          : '-translate-x-1/2 items-center text-center'
                      }`}
                    >
                      {editingHeaderField === 'officePart' ? (
                        <div className="relative">
                          {textSelection?.kind === 'header' &&
                            textSelection.field === 'officePart' &&
                            textSelection.range &&
                            textSelection.range.end > textSelection.range.start &&
                            textHasVowel(
                              score.header.officePart.slice(
                                textSelection.range.start,
                                textSelection.range.end
                              )
                            ) && (
                              <div className="no-print absolute top-full left-0 z-30 mt-1 flex items-center gap-0.5 rounded border border-[#CFC3AE] bg-[#FAF6EE] px-1 py-0.5 shadow-md">
                                {VOWEL_ACCENT_OPTIONS.map((opt) => (
                                  <button
                                    key={opt.id}
                                    type="button"
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => applyInlineHeaderAccent('officePart', opt.id)}
                                    title={opt.tooltip}
                                    className="h-5 min-w-[20px] rounded px-1 font-[family-name:var(--font-serif)] text-xs font-semibold normal-case tracking-normal text-[#1D1915] hover:bg-[#8B1E24] hover:text-[#FAF6EE]"
                                  >
                                    {opt.id === 'none' ? 'a' : opt.preview}
                                  </button>
                                ))}
                              </div>
                            )}
                          <input
                            ref={officeInputRef}
                            autoFocus
                            type="text"
                            value={score.header.officePart}
                            onChange={(e) => onUpdateHeader({ officePart: e.target.value })}
                            onSelect={(e) => handleHeaderSelectionCheck('officePart', e.currentTarget)}
                            onKeyUp={(e) => handleHeaderSelectionCheck('officePart', e.currentTarget)}
                            onMouseUp={(e) => handleHeaderSelectionCheck('officePart', e.currentTarget)}
                            onBlur={() => setEditingHeaderField(null)}
                            onKeyDown={(e) => e.key === 'Enter' && setEditingHeaderField(null)}
                            placeholder="Antiphona"
                            style={{
                              fontFamily: lyricFontCss,
                              fontSize: `${typo.officePartFontSize}px`,
                              color: score.header.officePartColor || '#9E1B1E',
                            }}
                            className="w-32 border-b border-[#9E1B1E] bg-transparent text-[11.5px] italic leading-tight focus:outline-none"
                          />
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            onSelect(null);
                            onSelectText({ kind: 'header', field: 'officePart' });
                            setEditingHeaderField('officePart');
                          }}
                          style={{ fontFamily: lyricFontCss, fontSize: `${typo.officePartFontSize}px` }}
                          className={`group/office whitespace-nowrap rounded-sm px-1 text-[11.5px] italic leading-[1.15] hover:underline focus-visible:outline-1 focus-visible:outline-[#9E1B1E] ${
                            rawOfficePart
                              ? 'min-h-[14px]'
                              : 'no-print h-0 overflow-hidden opacity-0 transition-opacity group-hover/stack:h-auto group-hover/stack:opacity-100 focus-visible:h-auto focus-visible:opacity-100'
                          } ${
                            textSelection?.kind === 'header' &&
                            textSelection.field === 'officePart'
                              ? 'ring-1 ring-[#8B1E24]/60 bg-[#8B1E24]/5'
                              : ''
                          }`}
                          title={
                            rawOfficePart
                              ? 'Click to edit or color liturgical office part'
                              : 'Click to add office part (e.g. Antiphona)'
                          }
                        >
                          {rawOfficePart ? (
                            officeSegments.map((seg, i) => (
                              <span key={i} style={{ color: seg.color }}>
                                {seg.text}
                              </span>
                            ))
                          ) : (
                            <span className="not-italic text-[10px] text-[#9E1B1E]/70">
                              + Office
                            </span>
                          )}
                        </button>
                      )}

                      {editingHeaderField === 'mode' ? (
                        <input
                          autoFocus
                          type="text"
                          value={score.header.mode}
                          onChange={(e) =>
                            onUpdateHeader({ mode: e.target.value, annotation: e.target.value })
                          }
                          onBlur={() => setEditingHeaderField(null)}
                          onKeyDown={(e) => e.key === 'Enter' && setEditingHeaderField(null)}
                          placeholder="VIII"
                          style={{
                            fontFamily: titleFontCss,
                            fontSize: `${typo.modeFontSize}px`,
                            color: score.header.modeColor || '#9E1B1E',
                          }}
                          className="w-16 border-b border-[#9E1B1E] bg-transparent text-[11px] font-semibold tracking-[0.08em] focus:outline-none"
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            onSelect(null);
                            onSelectText({ kind: 'header', field: 'mode' });
                            setEditingHeaderField('mode');
                          }}
                          style={{
                            fontFamily: titleFontCss,
                            fontSize: `${typo.modeFontSize}px`,
                            color:
                              score.header.modeColor ||
                              score.header.annotationColor ||
                              '#9E1B1E',
                          }}
                          className={`group/mode whitespace-nowrap rounded-sm px-1 text-[11px] font-semibold tracking-[0.08em] leading-[1.15] hover:underline focus-visible:outline-1 focus-visible:outline-[#9E1B1E] ${
                            modeAboveDropCap
                              ? 'min-h-[14px]'
                              : 'no-print h-0 overflow-hidden opacity-0 transition-opacity group-hover/stack:h-auto group-hover/stack:opacity-100 focus-visible:h-auto focus-visible:opacity-100'
                          } ${
                            textSelection?.kind === 'header' && textSelection.field === 'mode'
                              ? 'ring-1 ring-[#8B1E24]/60 bg-[#8B1E24]/5'
                              : ''
                          }`}
                          title={
                            modeAboveDropCap
                              ? 'Click to edit or color chant mode'
                              : 'Click to set chant mode'
                          }
                        >
                          {modeAboveDropCap || (
                            <span className="font-normal tracking-normal text-[#9E1B1E]/70">
                              + Mode
                            </span>
                          )}
                        </button>
                      )}
                    </div>
                  );
                })()}

              {/* Inline Lyric Editor for syllables on this page */}
              {editingLyricId &&
                (() => {
                  for (const ps of page.systems) {
                    const placed = ps.system.items.find((pi) => pi.item.id === editingLyricId);
                    if (placed && placed.item.kind === 'syllable') {
                      const placedItem = placed.item;
                      const checkLyricRange = (el: HTMLInputElement) => {
                        const s = el.selectionStart ?? 0;
                        const e = el.selectionEnd ?? 0;
                        if (e > s) {
                          setLyricSelRange({ start: s, end: e });
                          if (lyricDraft !== placedItem.lyric) {
                            prevEditingScoreLyricRef.current = lyricDraft;
                            onUpdateLyric(editingLyricId, lyricDraft);
                          }
                          onSelectText({
                            kind: 'lyric-range',
                            itemId: editingLyricId,
                            start: s,
                            end: e,
                          });
                        } else {
                          setLyricSelRange(null);
                          if (
                            textSelection?.kind === 'lyric-range' &&
                            textSelection.itemId === editingLyricId
                          ) {
                            onSelectText(null);
                          }
                        }
                      };
                      const inputTop = ps.pageYTop + layout.lyricYOffset - typo.lyricFontSize - 2;
                      const inputWidth = Math.max(48, placed.width);
                      const hasVowelSelection =
                        !!lyricSelRange &&
                        lyricSelRange.end > lyricSelRange.start &&
                        textHasVowel(lyricDraft.slice(lyricSelRange.start, lyricSelRange.end));

                      return (
                        <React.Fragment key={editingLyricId}>
                          {hasVowelSelection && (
                            <div
                              style={{
                                left: `${placed.lyricX}px`,
                                top: `${Math.max(8, inputTop - 30)}px`,
                              }}
                              className="no-print absolute z-30 flex -translate-x-1/2 items-center gap-0.5 rounded border border-[#CFC3AE] bg-[#FAF6EE] px-1 py-0.5 shadow-md"
                            >
                              {VOWEL_ACCENT_OPTIONS.map((opt) => (
                                <button
                                  key={opt.id}
                                  type="button"
                                  onMouseDown={(e) => e.preventDefault()}
                                  onClick={() => applyInlineLyricAccent(opt.id)}
                                  title={opt.tooltip}
                                  aria-label={opt.tooltip}
                                  className={`h-5 min-w-[22px] rounded px-1 font-[family-name:var(--font-serif)] text-xs font-semibold transition-colors ${
                                    opt.id === 'none'
                                      ? 'text-[10px] font-sans font-medium text-[#5C5349] hover:bg-[#EAE2D3] hover:text-[#1D1915]'
                                      : 'text-[#1D1915] hover:bg-[#8B1E24] hover:text-[#FAF6EE]'
                                  }`}
                                >
                                  {opt.id === 'none' ? 'Plain' : opt.preview}
                                </button>
                              ))}
                            </div>
                          )}
                          <input
                            ref={lyricInputRef}
                            autoFocus
                            type="text"
                            value={lyricDraft}
                            onChange={(e) => setLyricDraft(e.target.value)}
                            onSelect={(e) => checkLyricRange(e.currentTarget)}
                            onKeyUp={(e) => checkLyricRange(e.currentTarget)}
                            onMouseUp={(e) => checkLyricRange(e.currentTarget)}
                            onBlur={() => commitLyricEdit(editingLyricId, false)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === 'Tab') {
                                e.preventDefault();
                                commitLyricEdit(editingLyricId, true);
                              } else if (e.key === 'Escape') {
                                setEditingLyricId(null);
                                setLyricSelRange(null);
                              }
                            }}
                            placeholder="syllable"
                            style={{
                              left: `${placed.lyricX - inputWidth / 2}px`,
                              width: `${inputWidth}px`,
                              top: `${inputTop}px`,
                              fontFamily: lyricFontCss,
                              fontSize: `${Math.max(12, Math.round(typo.lyricFontSize * 0.92))}px`,
                            }}
                            className="absolute z-20 rounded-sm border border-[#9E1B1E] bg-[#FAF6EE] px-1 py-0.5 text-center text-[#151210] shadow-sm focus:outline-none"
                          />
                        </React.Fragment>
                      );
                    }
                  }
                  return null;
                })()}

              {/* Score Phrase Markers, Bar-Line Join Handles & Anchored Popover */}
              {phraseOverlaysActive && toneLink && !panMode && (
                <>
                  {/* Thin Clickable Bar-Line Join Handles */}
                  {page.systems.flatMap((ps) =>
                    ps.system.items.map((placed) => {
                      if (placed.item.kind !== 'division') return null;
                      const ph = phraseByEndDivisionId.get(placed.item.id);
                      if (!ph || !ph.canJoinNext || !onJoinPhrases) return null;
                      const barCenterX = placed.neumeStartX + placed.neumeWidth / 2;
                      return (
                        <button
                          key={`join_${ph.endWordIndex}`}
                          type="button"
                          data-phrase-join-handle={ph.endWordIndex}
                          title="Join phrases"
                          aria-label={`Join phrase ${ph.index + 1} with next phrase`}
                          style={{
                            left: `${barCenterX - 7}px`,
                            top: `${ps.pageYTop - 4}px`,
                            width: '14px',
                            height: `${STAFF_HEIGHT + 8}px`,
                          }}
                          onPointerDown={(e) => e.stopPropagation()}
                          onMouseEnter={() => setHoveredPhraseKey(ph.endWordIndex)}
                          onMouseLeave={() =>
                            setHoveredPhraseKey((cur) => (cur === ph.endWordIndex ? null : cur))
                          }
                          onFocus={() => setHoveredPhraseKey(ph.endWordIndex)}
                          onBlur={() =>
                            setHoveredPhraseKey((cur) => (cur === ph.endWordIndex ? null : cur))
                          }
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenPhraseKey(null);
                            onJoinPhrases(ph.endWordIndex, 'next');
                          }}
                          className="no-print pointer-events-auto absolute z-20 flex items-center justify-center rounded-sm border border-transparent bg-transparent hover:border-[#B48327]/70 hover:bg-[#B48327]/20 focus-visible:border-[#8B1E24] focus-visible:bg-[#B48327]/25 focus-visible:outline-none transition-colors"
                        >
                          <span className="sr-only">Join phrases</span>
                        </button>
                      );
                    })
                  )}

                  {/* Above-Staff Phrase Cadence Marker Pills */}
                  {(markersByPage.get(page.pageIndex) ?? []).map((marker) => {
                    const ph = marker.phrase;
                    const meta = CADENCE_CHOICE_META[ph.choiceLabel];
                    const defaultChoice = cadenceKindToLabel(ph.defaultKind, undefined);
                    const defaultMeta = CADENCE_CHOICE_META[defaultChoice];
                    const isOpen = openPhraseKey === ph.endWordIndex;

                    return (
                      <button
                        key={`marker_${ph.endWordIndex}`}
                        ref={(el) => {
                          markerButtonRefs.current[ph.endWordIndex] = el;
                        }}
                        type="button"
                        data-phrase-marker={ph.endWordIndex}
                        data-phrase-compact={marker.compact ? 'true' : 'false'}
                        aria-haspopup="menu"
                        aria-expanded={isOpen}
                        aria-label={`Phrase ${ph.index + 1}: ${meta.label} (${meta.technicalName})${
                          ph.merged ? `, merged from ${ph.mergedFrom} phrases` : ''
                        }${ph.autoJoined ? ', auto-joined' : ''}${
                          ph.overridden ? `, changed from default ${defaultMeta.label}` : ''
                        }. Click to edit termination or phrase breaks.`}
                        title={`Phrase ${ph.index + 1} · ${meta.label} (${meta.technicalName})${
                          ph.merged ? ` · merged ×${ph.mergedFrom}` : ''
                        }${ph.autoJoined ? ' · auto' : ''}${
                          ph.overridden ? ` · overridden (default: ${defaultMeta.label})` : ''
                        }`}
                        style={{
                          left: `${marker.centerX - marker.width / 2}px`,
                          top: `${marker.topY}px`,
                          minWidth: `${marker.width}px`,
                        }}
                        onPointerDown={(e) => e.stopPropagation()}
                        onMouseEnter={() => setHoveredPhraseKey(ph.endWordIndex)}
                        onMouseLeave={() =>
                          setHoveredPhraseKey((cur) => (cur === ph.endWordIndex ? null : cur))
                        }
                        onFocus={() => setHoveredPhraseKey(ph.endWordIndex)}
                        onBlur={() =>
                          setHoveredPhraseKey((cur) => (cur === ph.endWordIndex ? null : cur))
                        }
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenPhraseKey((cur) =>
                            cur === ph.endWordIndex ? null : ph.endWordIndex
                          );
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            e.stopPropagation();
                            setOpenPhraseKey(ph.endWordIndex);
                          } else if (e.key === 'Escape' && isOpen) {
                            e.preventDefault();
                            e.stopPropagation();
                            setOpenPhraseKey(null);
                          }
                        }}
                        className={`no-print pointer-events-auto absolute z-20 inline-flex h-[18px] items-center justify-center gap-0.5 rounded border px-1.5 text-[9.5px] font-semibold leading-none shadow-xs transition-colors whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#8B1E24] ${
                          CADENCE_BADGE_CLASS[ph.choiceLabel]
                        }${ph.overridden ? ' ring-1 ring-[#B48327]' : ''}`}
                      >
                        <span>{marker.label}</span>
                        <ChevronDown className="h-2.5 w-2.5 opacity-75 shrink-0" aria-hidden="true" />
                      </button>
                    );
                  })}

                  {/* Anchored Popover Menu */}
                  {openPhraseKey !== null &&
                    (() => {
                      const openMarker = (markersByPage.get(page.pageIndex) ?? []).find(
                        (m) => m.phrase.endWordIndex === openPhraseKey
                      );
                      if (!openMarker) return null;
                      const ph = openMarker.phrase;
                      const baseChoices = getValidPhraseCadenceChoices({
                        isEnglishPreface: toneLink.isEnglishPreface,
                        hasQuestion: toneLink.hasQuestionCadence,
                      });
                      const defaultChoice = cadenceKindToLabel(ph.defaultKind, undefined);
                      const choices = baseChoices.includes(defaultChoice)
                        ? baseChoices
                        : [...baseChoices, defaultChoice];
                      const popoverWidth = 304;
                      const popoverLeft = Math.max(
                        12,
                        Math.min(page.pageWidth - popoverWidth - 12, openMarker.centerX - popoverWidth / 2)
                      );
                      const placeAbove = openMarker.topY > page.pageHeight * 0.62;
                      const popoverTop = placeAbove
                        ? Math.max(12, openMarker.topY - 320)
                        : Math.min(page.pageHeight - 60, openMarker.topY + 22);
                      const internalBreakSet = new Set(
                        ph.internalMergedBreaks.map((b) => b.endWordIndex)
                      );

                      const handlePopoverKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
                        const menuEl = popoverMenuRef.current;
                        if (!menuEl) return;
                        const items = Array.from(
                          menuEl.querySelectorAll<HTMLButtonElement>(
                            '[role="menuitemradio"]:not(:disabled), [role="menuitem"]:not(:disabled)'
                          )
                        );
                        if (items.length === 0) return;
                        const activeIdx = items.findIndex((el) => el === document.activeElement);
                        if (e.key === 'ArrowDown') {
                          e.preventDefault();
                          e.stopPropagation();
                          items[(activeIdx + 1) % items.length]?.focus();
                        } else if (e.key === 'ArrowUp') {
                          e.preventDefault();
                          e.stopPropagation();
                          items[(activeIdx - 1 + items.length) % items.length]?.focus();
                        } else if (e.key === 'Home') {
                          e.preventDefault();
                          e.stopPropagation();
                          items[0]?.focus();
                        } else if (e.key === 'End') {
                          e.preventDefault();
                          e.stopPropagation();
                          items[items.length - 1]?.focus();
                        } else if (e.key === 'Escape') {
                          e.preventDefault();
                          e.stopPropagation();
                          const targetKey = ph.endWordIndex;
                          setOpenPhraseKey(null);
                          markerButtonRefs.current[targetKey]?.focus();
                        } else if (e.key === 'Tab') {
                          setOpenPhraseKey(null);
                        }
                      };

                      return (
                        <div
                          ref={popoverMenuRef}
                          role="menu"
                          data-phrase-popover={ph.endWordIndex}
                          aria-label={`Phrase ${ph.index + 1} controls`}
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={handlePopoverKeyDown}
                          style={{
                            left: `${popoverLeft}px`,
                            top: `${popoverTop}px`,
                            width: `${popoverWidth}px`,
                          }}
                          className="no-print pointer-events-auto absolute z-40 max-h-[360px] overflow-y-auto rounded border border-[#CFC3AE] bg-[#FAF6EE] p-1.5 text-left text-[#1D1915] shadow-xl"
                        >
                          <div className="flex items-center justify-between gap-2 border-b border-[#E3D8C6] px-1.5 pb-1 mb-1">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="text-[10.5px] font-semibold text-[#8B1E24] truncate">
                                Phrase {ph.index + 1}
                              </span>
                              {ph.merged && (
                                <span className="rounded border border-[#C8B898] bg-[#EFE5D1] px-1 py-0 text-[9px] font-semibold text-[#6B4E16]">
                                  merged ×{ph.mergedFrom}
                                </span>
                              )}
                              {ph.autoJoined && (
                                <span
                                  data-auto-joined-badge="true"
                                  className="rounded border border-[#B8D0B9] bg-[#E8F3EA] px-1 py-0 text-[9px] font-semibold text-[#1E5B2D]"
                                >
                                  auto
                                </span>
                              )}
                            </div>
                            <button
                              type="button"
                              aria-label="Close phrase controls"
                              onClick={() => {
                                const targetKey = ph.endWordIndex;
                                setOpenPhraseKey(null);
                                markerButtonRefs.current[targetKey]?.focus();
                              }}
                              className="rounded p-0.5 text-[#6B6257] hover:bg-[#EFE8DA] hover:text-[#1D1915]"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>

                          <div className="px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-[#6B6257]">
                            Termination
                          </div>
                          {choices.map((choice) => {
                            const meta = CADENCE_CHOICE_META[choice];
                            const isSelected = choice === ph.choiceLabel;
                            return (
                              <button
                                key={choice}
                                type="button"
                                role="menuitemradio"
                                aria-checked={isSelected}
                                onClick={() => {
                                  onSelectPhraseCadence?.(ph.endWordIndex, choice, ph.defaultKind);
                                  setOpenPhraseKey(null);
                                }}
                                className={`flex w-full items-start gap-2 rounded px-1.5 py-1 text-left transition-colors focus-visible:outline-2 focus-visible:outline-[#8B1E24] ${
                                  isSelected
                                    ? 'bg-[#EFE8DA] text-[#1D1915]'
                                    : 'text-[#2A241E] hover:bg-[#F5EFE4]'
                                }`}
                              >
                                <span className="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center text-[#8B1E24]">
                                  {isSelected && <Check className="h-3 w-3" aria-hidden="true" />}
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="flex flex-wrap items-center gap-1">
                                    <span
                                      className={`inline-block rounded border px-1.5 py-0 text-[9.5px] font-semibold ${CADENCE_BADGE_CLASS[choice]}`}
                                    >
                                      {meta.label}
                                    </span>
                                    <span className="text-[9.5px] text-[#7C7060]">
                                      {meta.technicalName}
                                    </span>
                                    {choice === defaultChoice && (
                                      <span className="rounded bg-[#E6DEC8] px-1 py-0 text-[8.5px] font-semibold text-[#5C5349]">
                                        Default
                                      </span>
                                    )}
                                  </span>
                                  <span className="mt-0.5 block text-[10px] leading-snug text-[#5C5349]">
                                    {meta.description}
                                  </span>
                                </span>
                              </button>
                            );
                          })}

                          {ph.overridden && (
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                onSelectPhraseCadence?.(
                                  ph.endWordIndex,
                                  defaultChoice,
                                  ph.defaultKind
                                );
                                setOpenPhraseKey(null);
                              }}
                              className="mt-0.5 flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-[10.5px] font-medium text-[#8B1E24] hover:bg-[#F5EFE4] focus-visible:outline-2 focus-visible:outline-[#8B1E24]"
                            >
                              <span>Reset to default</span>
                            </button>
                          )}

                          <div className="my-1 border-t border-[#E3D8C6]" />
                          <div className="px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-[#6B6257]">
                            Phrase breaks
                          </div>

                          <div className="space-y-0.5">
                            <button
                              type="button"
                              role="menuitem"
                              disabled={!ph.canJoinPrev}
                              onClick={() => {
                                onJoinPhrases?.(ph.endWordIndex, 'prev');
                                setOpenPhraseKey(null);
                              }}
                              className="flex w-full items-center rounded px-2 py-1 text-left text-[10.5px] font-medium text-[#1D1915] hover:bg-[#F5EFE4] disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-[#8B1E24]"
                            >
                              Join with previous phrase
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              disabled={!ph.canJoinNext}
                              onClick={() => {
                                onJoinPhrases?.(ph.endWordIndex, 'next');
                                setOpenPhraseKey(null);
                              }}
                              className="flex w-full items-center rounded px-2 py-1 text-left text-[10.5px] font-medium text-[#1D1915] hover:bg-[#F5EFE4] disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-[#8B1E24]"
                            >
                              Join with next phrase
                            </button>
                            {ph.merged && (
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                  onSplitMergedPhrase?.(ph.endWordIndex);
                                  setOpenPhraseKey(null);
                                }}
                                className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-[10.5px] font-medium text-[#8B1E24] hover:bg-[#F5EFE4] focus-visible:outline-2 focus-visible:outline-[#8B1E24]"
                              >
                                <Scissors className="h-3 w-3" aria-hidden="true" />
                                <span>Split into {ph.mergedFrom} phrases</span>
                              </button>
                            )}
                          </div>

                          {ph.internalMergedBreaks.length > 0 && onRestoreBreak && (
                            <div className="mt-1 border-t border-[#EDE5D5] px-1.5 pt-1">
                              <div className="mb-1 text-[9.5px] font-medium text-[#6B6257]">
                                Restore individual break:
                              </div>
                              <div className="flex flex-wrap gap-1">
                                {ph.internalMergedBreaks.map((bk) => (
                                  <button
                                    key={`${bk.endWordIndex}_${bk.wordText}`}
                                    type="button"
                                    role="menuitem"
                                    onClick={() => {
                                      onRestoreBreak(bk);
                                      setOpenPhraseKey(null);
                                    }}
                                    className="inline-flex items-center gap-0.5 rounded border border-[#C8B898] bg-[#EFE5D1] px-1.5 py-0.5 text-[10px] font-medium text-[#6B4E16] hover:bg-white focus-visible:outline-2 focus-visible:outline-[#8B1E24]"
                                  >
                                    <span>+ after "{bk.wordText}"</span>
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}

                          {ph.words.length > 1 && onToggleExtraBreak && (
                            <div className="mt-1 border-t border-[#EDE5D5] px-1.5 pt-1 pb-0.5">
                              <div className="mb-1 text-[9.5px] font-medium text-[#6B6257]">
                                Split here inside phrase:
                              </div>
                              <div className="flex flex-wrap items-center gap-1">
                                {ph.words.map((word, wi) => {
                                  if (wi >= ph.words.length - 1) return null;
                                  const absWordIdx = ph.startWordIndex + wi;
                                  if (internalBreakSet.has(absWordIdx)) return null;
                                  return (
                                    <button
                                      key={`${absWordIdx}_${word}`}
                                      type="button"
                                      role="menuitem"
                                      title={`Split phrase after "${word}"`}
                                      onClick={() => {
                                        onToggleExtraBreak({
                                          endWordIndex: absWordIdx,
                                          wordText: word,
                                        });
                                        setOpenPhraseKey(null);
                                      }}
                                      className="inline-flex items-center gap-0.5 rounded border border-[#CFC3AE] bg-[#F5EFE4] px-1.5 py-0.5 text-[10px] text-[#3F3830] hover:bg-white hover:border-[#8B1E24] focus-visible:outline-2 focus-visible:outline-[#8B1E24]"
                                    >
                                      <span className="font-[family-name:var(--font-serif)]">{word}</span>
                                      <span className="font-bold text-[#8B1E24]">+</span>
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                </>
              )}

              {/* Clean Empty-Score Guidance on Page 1 */}
              {isFirstPage && !hasSyllables && (
                <div
                  className="no-print pointer-events-auto absolute inset-x-12 z-10 border-t border-[#DDD4C4] pt-5 text-center"
                  style={{ top: `${page.headerHeight + 170}px` }}
                >
                  <p className="font-[family-name:var(--font-serif)] text-base text-[#5C5349]">
                    Drag neumes from the top palette onto the staff, click to stamp notes directly, or open the GABC Source panel to paste notation.
                  </p>
                  <div className="mt-3 flex flex-wrap items-center justify-center gap-3">
                    <button
                      type="button"
                      onClick={onCreateBlankSyllable}
                      className="rounded border border-[#8B1E24] bg-[#8B1E24] px-4 py-1.5 text-xs font-medium text-[#FAF6EE] hover:bg-[#72171B] transition-colors whitespace-nowrap"
                    >
                      Add First Note
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};
