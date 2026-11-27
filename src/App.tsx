import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccidentalType,
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
  PaletteDragPayload,
  RibbonTab,
  ScorePageSetup,
  ScoreTypography,
  SelectionState,
  TextSelectionTarget,
  ToneLayoutMode,
  ToneLink,
  VowelAccentType,
  WorkspaceMode,
  ZoomMode,
} from '@/src/types/chant';
import { hashGabc } from '@/src/lib/tones/phraseCadenceUtils';
import { ensureFontFamilyLoaded } from '@/src/lib/fonts/optionalFonts';
import { createEmptyScore, parseGabc } from '@/src/lib/gabc/parser';
import { serializeGabc } from '@/src/lib/gabc/serializer';
import { DEFAULT_HYMN_GABC } from '@/src/lib/gabc/defaultHymn';
import { loadSavedScore, parseProjectJson, saveScore, wrapProject } from '@/src/lib/projectStorage';
import {
  findGabcRangeForSelection,
  findSelectionForGabcOffset,
  serializeGabcWithMap,
} from '@/src/lib/gabc/sourceMap';
import { midiToFrequency, parseClefConfig, resolvePitch } from '@/src/lib/gabc/pitch';
import {
  applyTextColorToSelection,
  applyVowelAccentToSelection,
  copySelectionPayload,
  deleteSelectedFromScore,
  getOrderedScoreNotes,
  getSelectedNoteRefs,
  insertDivisionIntoScore,
  insertLineBreak,
  insertNeumeIntoScore,
  insertOrReplaceClef,
  mergeEmptySyllableIntoPrevious,
  mergeWithPreviousGroup,
  pastePayloadIntoScore,
  replaceSelectedNoteWithPreset,
  setNoteLiquescentDir,
  setNotePitch,
  shiftSelectedPitch,
  shiftSyllableLyric,
  splitGroupAtNote,
  splitSyllableAtNote,
  toggleModifierOnSelection,
  updateHeader,
  updateScorePageSetup,
  updateScoreTypography,
  updateSyllableText,
} from '@/src/lib/notation/scoreMutations';
import {
  buildChantTimeline,
  ChantTimeline,
  clampTempoBpm,
  findNextTimelineEventAtOrAfter,
  findTimelineEventForSelection,
  ScheduledNoteEvent,
} from '@/src/lib/audio/chantTimeline';
import { LiveOrganPlayer, ORGAN_PROFILES, PlayTimelineOptions } from '@/src/lib/audio/organEngine';
import {
  exportAsGabc,
  exportAsLibraryBackup,
  exportAsMp3,
  exportAsPdf,
  exportAsPng,
  exportAsProjectFile,
  exportToSourceAndSummit,
  copyShareLink,
} from '@/src/lib/export/exportScore';
import {
  applyBackupRestore,
  BackupMetadata,
  createLibraryBackupEnvelope,
  createLibraryEntry,
  createScoreStore,
  deriveScoreName,
  getBackupNudgeLabel,
  inspectBackupRestore,
  loadActiveScoreId,
  loadBackupMetadata,
  migrateLegacyLocalStorageToLibrary,
  parseLibraryBackupJson,
  saveActiveScoreId,
  saveBackupMetadata,
  ScoreLibraryEntry,
  ScoreStore,
} from '@/src/lib/scoreLibrary';
import { consumeSharedGabc } from '@/src/lib/shareLink';
import { findNoteInfoForSelection, moveNoteSelection } from '@/src/lib/notation/noteNavigation';
import { installAutoAriaLabels } from '@/src/lib/a11y';
import {
  getPageDimensions,
  resolvePageSetup,
  resolveScoreTypography,
} from '@/src/lib/typography';
import {
  clampToneWidth,
  loadWorkspacePrefs,
  resolveToneLayoutMode,
  saveWorkspacePrefs,
} from '@/src/lib/workspacePrefs';
import { StudioLayout } from '@/src/components/StudioLayout';
import { RibbonToolbar } from '@/src/components/RibbonToolbar';
import { ScoreWorkspace } from '@/src/components/ScoreWorkspace';
import { GabcEditor } from '@/src/components/GabcEditor';
import type {
  CommitToneCallbacks,
  CommitToneLinkPayload,
  ToneController,
} from '@/src/components/TonePanel';
import { ExportFormat } from '@/src/components/ExportMenu';
import { PendingBackupRestore, ScoreLibraryModal } from '@/src/components/ScoreLibraryModal';

const LazyToneDockPanel = React.lazy(() =>
  import('@/src/components/TonePanel').then((m) => ({ default: m.ToneDockPanel }))
);
const LazyToneStateBridge = React.lazy(() =>
  import('@/src/components/TonePanel').then((m) => ({ default: m.ToneStateBridge }))
);

const MAX_HISTORY = 60;

function timelinesMatchAudio(a: ChantTimeline, b: ChantTimeline): boolean {
  if (a.events.length !== b.events.length) return false;
  for (let i = 0; i < a.events.length; i++) {
    const ea = a.events[i];
    const eb = b.events[i];
    if (
      ea.noteId !== eb.noteId ||
      Math.abs(ea.startSec - eb.startSec) > 0.0001 ||
      Math.abs(ea.durationSec - eb.durationSec) > 0.0001 ||
      Math.abs(ea.frequency - eb.frequency) > 0.01
    ) {
      return false;
    }
  }
  return true;
}

const SHORTCUT_NEUME_MAP: Record<string, NeumePresetId> = {
  '1': 'punctum',
  '2': 'virga',
  '3': 'diamond',
  '4': 'quilisma',
  '5': 'oriscus',
  '6': 'stropha',
  '7': 'podatus',
  '8': 'clivis',
  '9': 'torculus',
  '0': 'porrectus',
};

const DIGIT_CODE_NEUME_MAP: Record<string, NeumePresetId> = {
  Digit1: 'punctum',
  Digit2: 'virga',
  Digit3: 'diamond',
  Digit4: 'quilisma',
  Digit5: 'oriscus',
  Digit6: 'stropha',
  Digit7: 'podatus',
  Digit8: 'clivis',
  Digit9: 'torculus',
  Digit0: 'porrectus',
  Numpad1: 'punctum',
  Numpad2: 'virga',
  Numpad3: 'diamond',
  Numpad4: 'quilisma',
  Numpad5: 'oriscus',
  Numpad6: 'stropha',
  Numpad7: 'podatus',
  Numpad8: 'clivis',
  Numpad9: 'torculus',
  Numpad0: 'porrectus',
};

function isTextEntryTarget(target: HTMLElement | null): boolean {
  if (!target) return false;
  if (target.isContentEditable) return true;
  if (target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return true;
  if (target.tagName === 'INPUT') {
    const type = (target as HTMLInputElement).type?.toLowerCase() || 'text';
    return !['range', 'checkbox', 'radio', 'color', 'button', 'submit', 'reset', 'file'].includes(
      type
    );
  }
  return false;
}

export default function App() {
  const [initialPrefs] = useState(loadWorkspacePrefs);
  const defaultSampleGabcRef = useRef<string | null>(null);
  if (defaultSampleGabcRef.current === null) {
    defaultSampleGabcRef.current = serializeGabc(parseGabc(DEFAULT_HYMN_GABC));
  }
  const toneGeneratedGabcsRef = useRef<Set<string>>(new Set());
  const [toneLink, setToneLink] = useState<ToneLink | null>(null);
  const toneLinkByHashRef = useRef<Map<string, ToneLink>>(new Map());
  const [showPhraseControls, setShowPhraseControls] = useState<boolean>(true);

  const [sharedGabcOnBoot] = useState<string | null>(() =>
    consumeSharedGabc(false, () => true)
  );
  const [score, setScore] = useState<ChantScore>(() => {
    const saved = sharedGabcOnBoot ? parseGabc(sharedGabcOnBoot) : loadSavedScore();
    const base = saved ?? parseGabc(DEFAULT_HYMN_GABC);
    return {
      ...base,
      typography:
        base.typography ??
        resolveScoreTypography({
          lyricFont: initialPrefs.lyricFont,
          lyricFontSize: initialPrefs.lyricFontSize,
          titleFont: initialPrefs.titleFont,
          titleFontSize: initialPrefs.titleFontSize,
          lineSpacing: initialPrefs.lineSpacing,
          wordSpacing: initialPrefs.wordSpacing,
        }),
      pageSetup: base.pageSetup ?? {
        pageSize: initialPrefs.pageSize,
        orientation: initialPrefs.pageOrientation,
      },
    };
  });
  const [undoStack, setUndoStack] = useState<ChantScore[]>([]);
  const [redoStack, setRedoStack] = useState<ChantScore[]>([]);

  const [selection, setSelection] = useState<SelectionState | null>(null);
  const [textSelection, setTextSelection] = useState<TextSelectionTarget | null>(null);
  const [scrollTargetItemId, setScrollTargetItemId] = useState<string | null>(null);
  const [toolMode, setToolMode] = useState<EditorToolMode>('insert');
  const [activePreset, setActivePreset] = useState<NeumePresetId | null>('punctum');
  const [draggingPayload, setDraggingPayload] = useState<PaletteDragPayload | null>(null);
  const [clipboard, setClipboard] = useState<ClipboardPayload | null>(null);

  // Workspace Customization State (persisted)
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>(initialPrefs.mode);
  const [ribbonTab, setRibbonTab] = useState<RibbonTab>(initialPrefs.ribbonTab);
  const [ribbonCollapsed, setRibbonCollapsed] = useState<boolean>(initialPrefs.ribbonCollapsed);
  const [gabcWidth, setGabcWidth] = useState<number>(initialPrefs.gabcWidth);
  const [toneLayoutPref, setToneLayoutPref] = useState<ToneLayoutMode | null>(
    initialPrefs.toneLayoutMode
  );
  const [toneWidth, setToneWidth] = useState<number>(initialPrefs.toneWidth);
  const [viewportWidth, setViewportWidth] = useState<number>(() =>
    typeof window !== 'undefined' ? window.innerWidth : 1280
  );
  const [zoomMode, setZoomMode] = useState<ZoomMode>(initialPrefs.zoomMode);
  const [zoom, setZoom] = useState<number>(initialPrefs.zoom);
  const [language, setLanguage] = useState<ChantLanguage>(initialPrefs.language);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [dragZoomActive, setDragZoomActive] = useState<boolean>(false);
  const [spacePanActive, setSpacePanActive] = useState<boolean>(false);
  const spacePressRef = useRef<{
    pressed: boolean;
    heldToPan: boolean;
    timerId: number | null;
  }>({ pressed: false, heldToPan: false, timerId: null });

  // Playback State
  const [organ, setOrgan] = useState<OrganType>(initialPrefs.organ);
  const [tempoBpm, setTempoBpm] = useState<number>(initialPrefs.tempoBpm);
  const [transpose, setTranspose] = useState<number>(initialPrefs.transpose);
  const [volume, setVolume] = useState<number>(initialPrefs.volume);
  const [muted, setMuted] = useState<boolean>(initialPrefs.muted);

  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [elapsedSec, setElapsedSec] = useState<number>(0);
  const [playingNoteId, setPlayingNoteId] = useState<string | null>(null);

  const [busyExport, setBusyExport] = useState<ExportFormat | null>(null);
  const [exportStyle, setExportStyle] = useState<ExportSheetStyle>(initialPrefs.exportStyle);
  const [transparentPng, setTransparentPng] = useState<boolean>(initialPrefs.transparentPng);
  const [notice, setNotice] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'failed'>('saving');
  const scoreStoreRef = useRef<ScoreStore | null>(null);
  const [activeScoreId, setActiveScoreId] = useState<string | null>(() => loadActiveScoreId());
  const activeScoreIdRef = useRef<string | null>(activeScoreId);
  activeScoreIdRef.current = activeScoreId;
  const [libraryEntries, setLibraryEntries] = useState<ScoreLibraryEntry[]>([]);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [pendingRestore, setPendingRestore] = useState<PendingBackupRestore | null>(null);
  const [backupMeta, setBackupMeta] = useState<BackupMetadata>(() => loadBackupMetadata());
  const backupMetaRef = useRef(backupMeta);
  backupMetaRef.current = backupMeta;
  const isHydratedRef = useRef(false);
  const suppressNextAutosaveDirtyRef = useRef(false);
  const userEditedBeforeHydrateRef = useRef(false);
  const saveErrorNotifiedRef = useRef(false);
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    onConfirm: () => void;
    onCancel?: () => void;
  } | null>(null);

  const resolvedTypography = useMemo(
    () => resolveScoreTypography(score.typography),
    [score.typography]
  );
  const resolvedPageSetup = useMemo(
    () => resolvePageSetup(score.pageSetup),
    [score.pageSetup]
  );

  useEffect(() => {
    ensureFontFamilyLoaded(resolvedTypography.lyricFont);
    ensureFontFamilyLoaded(resolvedTypography.titleFont);
  }, [resolvedTypography.lyricFont, resolvedTypography.titleFont]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const effectiveToneLayoutMode = useMemo(
    () => resolveToneLayoutMode(toneLayoutPref, viewportWidth),
    [toneLayoutPref, viewportWidth]
  );
  const effectiveToneWidth = useMemo(
    () => clampToneWidth(toneWidth, viewportWidth),
    [toneWidth, viewportWidth]
  );

  // Persist workspace preferences
  useEffect(() => {
    saveWorkspacePrefs({
      mode: workspaceMode,
      ribbonTab,
      ribbonCollapsed,
      paletteVisible: false,
      gabcWidth,
      toneLayoutMode: toneLayoutPref,
      toneWidth,
      zoomMode,
      zoom,
      organ,
      tempoBpm,
      transpose,
      volume,
      muted,
      exportStyle,
      transparentPng,
      language,
      lyricFont: resolvedTypography.lyricFont,
      lyricFontSize: resolvedTypography.lyricFontSize,
      titleFont: resolvedTypography.titleFont,
      titleFontSize: resolvedTypography.titleFontSize,
      lineSpacing: resolvedTypography.lineSpacing,
      wordSpacing: resolvedTypography.wordSpacing ?? 'normal',
      pageSize: resolvedPageSetup.pageSize,
      pageOrientation: resolvedPageSetup.orientation,
    });
  }, [
    workspaceMode,
    ribbonTab,
    ribbonCollapsed,
    gabcWidth,
    toneLayoutPref,
    toneWidth,
    zoomMode,
    zoom,
    organ,
    tempoBpm,
    transpose,
    volume,
    muted,
    exportStyle,
    transparentPng,
    language,
    resolvedTypography,
    resolvedPageSetup,
  ]);

  // Dynamic @page size and orientation rule for browser printing
  useEffect(() => {
    const dims = getPageDimensions(resolvedPageSetup);
    let styleEl = document.getElementById('chantscore-print-page') as HTMLStyleElement | null;
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'chantscore-print-page';
      document.head.appendChild(styleEl);
    }
    styleEl.textContent = `@media print { @page { size: ${dims.cssPageRule}; } }`;
  }, [resolvedPageSetup]);

  // Give icon-only buttons an accessible name (see lib/a11y.ts).
  useEffect(() => installAutoAriaLabels(), []);

  // Score library hydration & autosave are initialized after showNotice & scoreRef below.

  const playerRef = useRef<LiveOrganPlayer | null>(null);
  if (!playerRef.current && typeof window !== 'undefined') {
    playerRef.current = new LiveOrganPlayer();
  }
  const selectionAnchorNoteIdRef = useRef<string | null>(null);

  const scoreRef = useRef(score);
  scoreRef.current = score;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const organRef = useRef(organ);
  organRef.current = organ;
  const tempoRef = useRef(tempoBpm);
  tempoRef.current = tempoBpm;
  const transposeRef = useRef(transpose);
  transposeRef.current = transpose;
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;
  const isPausedRef = useRef(isPaused);
  isPausedRef.current = isPaused;
  const elapsedSecRef = useRef(elapsedSec);
  elapsedSecRef.current = elapsedSec;
  const playbackTempoRef = useRef(tempoBpm);
  const tempoRescheduleTimerRef = useRef<number | null>(null);

  // Sync volume to organ engine
  useEffect(() => {
    playerRef.current?.setVolume(muted ? 0 : volume);
  }, [muted, volume]);

  // Stop audio and timers on unmount
  useEffect(() => {
    return () => {
      if (tempoRescheduleTimerRef.current !== null) {
        window.clearTimeout(tempoRescheduleTimerRef.current);
      }
      playerRef.current?.stop(0.03);
    };
  }, []);

  // Sync browser fullscreen events
  useEffect(() => {
    const onFsChange = () => {
      if (!document.fullscreenElement) {
        setIsFullscreen(false);
      }
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const handleToggleFullscreen = useCallback(() => {
    if (!isFullscreen) {
      setIsFullscreen(true);
      if (document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen().catch(() => {
          // Graceful CSS fullscreen fallback inside iframe
        });
      }
    } else {
      setIsFullscreen(false);
      if (document.fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      }
    }
  }, [isFullscreen]);

  const showNotice = useCallback((msg: string) => {
    setNotice(msg);
    window.setTimeout(() => {
      setNotice((prev) => (prev === msg ? null : prev));
    }, 3200);
  }, []);

  const markDirtySinceBackup = useCallback(() => {
    if (!backupMetaRef.current.dirtySinceBackup) {
      const next: BackupMetadata = { ...backupMetaRef.current, dirtySinceBackup: true };
      backupMetaRef.current = next;
      setBackupMeta(next);
      saveBackupMetadata(next);
    }
  }, []);

  const markBackedUp = useCallback(() => {
    const next: BackupMetadata = {
      lastBackupAt: new Date().toISOString(),
      dirtySinceBackup: false,
      dismissedUntil: null,
    };
    backupMetaRef.current = next;
    setBackupMeta(next);
    saveBackupMetadata(next);
  }, []);

  const handleDismissBackupNudge = useCallback(() => {
    const dismissedUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const next: BackupMetadata = { ...backupMetaRef.current, dismissedUntil };
    backupMetaRef.current = next;
    setBackupMeta(next);
    saveBackupMetadata(next);
  }, []);

  const persistScoreToLibrary = useCallback(
    async (targetScore: ChantScore): Promise<boolean> => {
      const store = scoreStoreRef.current;
      if (!store) {
        return saveScore(targetScore);
      }
      try {
        const now = new Date();
        const iso = now.toISOString();
        const id = activeScoreIdRef.current;
        const existing = id ? await store.get(id) : null;
        if (!id || !existing) {
          const entry = createLibraryEntry(targetScore, { id: id ?? undefined, now });
          await store.put(entry);
          activeScoreIdRef.current = entry.id;
          setActiveScoreId(entry.id);
          saveActiveScoreId(entry.id);
        } else {
          const updated: ScoreLibraryEntry = {
            ...existing,
            name: deriveScoreName(targetScore),
            updatedAt: iso,
            project: wrapProject(targetScore, now),
          };
          await store.put(updated);
        }
        const entries = await store.list();
        setLibraryEntries(entries);
        saveErrorNotifiedRef.current = false;
        return true;
      } catch (err) {
        console.error(err);
        if (!saveErrorNotifiedRef.current) {
          saveErrorNotifiedRef.current = true;
          showNotice('Could not save score to browser storage — export a backup copy.');
        }
        return false;
      }
    },
    [showNotice]
  );

  // Hydrate multi-score library on startup (non-destructive migration from localStorage)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { store, usingFallback } = await createScoreStore();
      if (cancelled) return;
      scoreStoreRef.current = store;
      if (usingFallback) {
        showNotice(
          'Browser database unavailable — using local storage fallback. Back up your work regularly.'
        );
      }
      await migrateLegacyLocalStorageToLibrary(store);
      if (cancelled) return;

      let targetId = activeScoreIdRef.current;
      if (sharedGabcOnBoot) {
        const entry = createLibraryEntry(scoreRef.current);
        await store.put(entry);
        targetId = entry.id;
        activeScoreIdRef.current = targetId;
        setActiveScoreId(targetId);
        saveActiveScoreId(targetId);
        showNotice('Opened shared score as a new entry in My scores');
      } else {
        const entries = await store.list();
        let target = targetId ? entries.find((e) => e.id === targetId) ?? null : null;
        if (!target && entries.length > 0) {
          target = entries[0];
        }
        if (target) {
          targetId = target.id;
          activeScoreIdRef.current = targetId;
          setActiveScoreId(targetId);
          saveActiveScoreId(targetId);
          if (!userEditedBeforeHydrateRef.current) {
            const hydratedScore: ChantScore = {
              ...target.project.score,
              typography:
                target.project.score.typography ??
                resolveScoreTypography({
                  lyricFont: initialPrefs.lyricFont,
                  lyricFontSize: initialPrefs.lyricFontSize,
                  titleFont: initialPrefs.titleFont,
                  titleFontSize: initialPrefs.titleFontSize,
                  lineSpacing: initialPrefs.lineSpacing,
                  wordSpacing: initialPrefs.wordSpacing,
                }),
              pageSetup: target.project.score.pageSetup ?? {
                pageSize: initialPrefs.pageSize,
                orientation: initialPrefs.pageOrientation,
              },
            };
            suppressNextAutosaveDirtyRef.current = true;
            scoreRef.current = hydratedScore;
            setScore(hydratedScore);
          }
        } else {
          const entry = createLibraryEntry(scoreRef.current);
          await store.put(entry);
          targetId = entry.id;
          activeScoreIdRef.current = targetId;
          setActiveScoreId(targetId);
          saveActiveScoreId(targetId);
        }
      }

      const finalEntries = await store.list();
      if (cancelled) return;
      setLibraryEntries(finalEntries);
      isHydratedRef.current = true;
      setSaveStatus('saved');
    })();
    return () => {
      cancelled = true;
    };
  }, [initialPrefs, sharedGabcOnBoot, showNotice]);

  // Autosave active score to library
  useEffect(() => {
    if (!isHydratedRef.current && !userEditedBeforeHydrateRef.current) {
      return;
    }
    if (suppressNextAutosaveDirtyRef.current) {
      suppressNextAutosaveDirtyRef.current = false;
      setSaveStatus('saved');
      return;
    }
    setSaveStatus('saving');
    const timer = window.setTimeout(() => {
      void persistScoreToLibrary(score).then((ok) => {
        setSaveStatus(ok ? 'saved' : 'failed');
      });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [score, persistScoreToLibrary]);

  const startLiveTimelinePlayback = useCallback(
    (
      timeline: ChantTimeline,
      targetOrgan: OrganType,
      targetTempo: number,
      offsetSec: number,
      options?: PlayTimelineOptions
    ) => {
      playbackTempoRef.current = clampTempoBpm(targetTempo);
      isPlayingRef.current = true;
      isPausedRef.current = false;
      setIsPlaying(true);
      setIsPaused(false);

      const eventByNoteId = new Map<string, ScheduledNoteEvent>();
      for (const ev of timeline.events) {
        if (!eventByNoteId.has(ev.noteId)) {
          eventByNoteId.set(ev.noteId, ev);
        }
      }

      const syncSelectionToEvent = (ev: ScheduledNoteEvent) => {
        selectionAnchorNoteIdRef.current = ev.noteId;
        setSelection((prev) =>
          prev?.noteId === ev.noteId && (!prev.selectedNotes || prev.selectedNotes.length <= 1)
            ? prev
            : {
                itemId: ev.itemId,
                groupId: ev.groupId,
                noteId: ev.noteId,
              }
        );
      };

      const initialEvent = findNextTimelineEventAtOrAfter(timeline, offsetSec);
      if (initialEvent) {
        setPlayingNoteId(initialEvent.noteId);
        syncSelectionToEvent(initialEvent);
      }

      playerRef.current?.playTimeline(
        timeline,
        targetOrgan,
        (noteId, sec) => {
          elapsedSecRef.current = sec;
          setPlayingNoteId(noteId);
          setElapsedSec(sec);
          if (noteId) {
            const ev = eventByNoteId.get(noteId);
            if (ev) {
              syncSelectionToEvent(ev);
            }
          }
        },
        () => {
          isPlayingRef.current = false;
          isPausedRef.current = false;
          elapsedSecRef.current = 0;
          setIsPlaying(false);
          setIsPaused(false);
          setElapsedSec(0);
          setPlayingNoteId(null);
        },
        offsetSec,
        options
      );
    },
    []
  );

  const commitScore = useCallback(
    (nextScore: ChantScore, recordHistory = true) => {
      userEditedBeforeHydrateRef.current = true;
      markDirtySinceBackup();
      const prevScore = scoreRef.current;
      scoreRef.current = nextScore;
      if (recordHistory) {
        setScore((prev) => {
          setUndoStack((u) => [...u.slice(-(MAX_HISTORY - 1)), prev]);
          setRedoStack([]);
          return nextScore;
        });

        if (isPlayingRef.current) {
          const prevTimeline = buildChantTimeline(
            prevScore,
            tempoRef.current,
            transposeRef.current
          );
          const nextTimeline = buildChantTimeline(
            nextScore,
            tempoRef.current,
            transposeRef.current
          );
          if (!timelinesMatchAudio(prevTimeline, nextTimeline)) {
            if (nextTimeline.events.length === 0) {
              playerRef.current?.stop();
              isPlayingRef.current = false;
              isPausedRef.current = false;
              elapsedSecRef.current = 0;
              setIsPlaying(false);
              setIsPaused(false);
              setElapsedSec(0);
              setPlayingNoteId(null);
            } else {
              const liveOffset = playerRef.current?.getElapsedSec() ?? elapsedSecRef.current;
              startLiveTimelinePlayback(
                nextTimeline,
                organRef.current,
                tempoRef.current,
                liveOffset,
                { fadePrevSec: 0.035, lookaheadSec: 0.015 }
              );
            }
          }
        }
      } else {
        setScore(nextScore);
      }
    },
    [markDirtySinceBackup, startLiveTimelinePlayback]
  );

  const handleUndo = useCallback(() => {
    userEditedBeforeHydrateRef.current = true;
    markDirtySinceBackup();
    setUndoStack((prev) => {
      if (prev.length === 0) return prev;
      const previous = prev[prev.length - 1];
      setScore((current) => {
        setRedoStack((r) => [...r, current]);
        return previous;
      });
      return prev.slice(0, -1);
    });
  }, [markDirtySinceBackup]);

  const handleRedo = useCallback(() => {
    userEditedBeforeHydrateRef.current = true;
    markDirtySinceBackup();
    setRedoStack((prev) => {
      if (prev.length === 0) return prev;
      const next = prev[prev.length - 1];
      setScore((current) => {
        setUndoStack((u) => [...u, current]);
        return next;
      });
      return prev.slice(0, -1);
    });
  }, [markDirtySinceBackup]);

  // Serialize GABC with character-level source map for bidirectional sync
  const { gabc: liveGabc, spans: gabcSpans } = useMemo(
    () => serializeGabcWithMap(score),
    [score]
  );

  const currentGabcHash = useMemo(() => hashGabc(liveGabc), [liveGabc]);

  const activeToneLink = useMemo<ToneLink | null>(() => {
    const mapped = toneLinkByHashRef.current.get(currentGabcHash);
    if (mapped) return mapped;
    if (toneLink && toneLink.gabcHash === currentGabcHash) return toneLink;
    return null;
  }, [currentGabcHash, toneLink]);

  const highlightedGabcRange = useMemo(
    () => findGabcRangeForSelection(selection, gabcSpans),
    [selection, gabcSpans]
  );

  const fullTimeline = useMemo(
    () => buildChantTimeline(score, tempoBpm, transpose),
    [score, tempoBpm, transpose]
  );

  const activeNoteLabel = useMemo(() => {
    const targetId = playingNoteId || selection?.noteId;
    if (!targetId) return null;
    let activeClef: ClefType = 'c4';
    for (const it of score.items) {
      if (it.kind === 'clef') activeClef = it.clef;
      if (it.kind === 'syllable') {
        for (const g of it.groups) {
          const n = g.notes.find((nt) => nt.id === targetId);
          if (n) {
            const info = resolvePitch(
              n.pitch,
              activeClef,
              parseClefConfig(activeClef).hasFlatSignature,
              n.accidental,
              transpose
            );
            return `${info.solfege} · ${info.noteName}`;
          }
        }
      }
    }
    return null;
  }, [playingNoteId, score.items, selection?.noteId, transpose]);

  const auditionPitchOnOrgan = useCallback(
    (pitch: number, clef: ClefType, accidental: AccidentalType = null) => {
      const hasFlat = parseClefConfig(clef).hasFlatSignature;
      const info = resolvePitch(pitch, clef, hasFlat, accidental, transpose);
      playerRef.current?.auditionNote(midiToFrequency(info.midi), organ, 0.38);
    },
    [organ, transpose]
  );

  const getActiveClefAtItem = useCallback(
    (itemId?: string | null): ClefType => {
      let clef: ClefType = 'c4';
      for (const it of score.items) {
        if (it.kind === 'clef') clef = it.clef;
        if (itemId && it.id === itemId) break;
      }
      return clef;
    },
    [score.items]
  );

  const handleStopPlayback = useCallback(() => {
    if (tempoRescheduleTimerRef.current !== null) {
      window.clearTimeout(tempoRescheduleTimerRef.current);
      tempoRescheduleTimerRef.current = null;
    }
    playerRef.current?.stop();
    isPlayingRef.current = false;
    isPausedRef.current = false;
    elapsedSecRef.current = 0;
    setIsPlaying(false);
    setIsPaused(false);
    setElapsedSec(0);
    setPlayingNoteId(null);
  }, []);

  const handlePausePlayback = useCallback(() => {
    if (!isPlayingRef.current) return;
    if (tempoRescheduleTimerRef.current !== null) {
      window.clearTimeout(tempoRescheduleTimerRef.current);
      tempoRescheduleTimerRef.current = null;
    }
    const currentOffset = playerRef.current?.getElapsedSec() ?? elapsedSecRef.current;
    const clampedTargetTempo = clampTempoBpm(tempoRef.current);
    const scaledOffset =
      playbackTempoRef.current !== clampedTargetTempo
        ? currentOffset * (playbackTempoRef.current / clampedTargetTempo)
        : currentOffset;
    playbackTempoRef.current = clampedTargetTempo;

    playerRef.current?.stop();
    isPlayingRef.current = false;
    isPausedRef.current = true;
    elapsedSecRef.current = scaledOffset;
    setIsPlaying(false);
    setIsPaused(true);
    setElapsedSec(scaledOffset);
    setPlayingNoteId(null);
  }, []);

  const handleStartPlayback = useCallback(
    (fromNoteId?: string | null, resumeFromSec?: number) => {
      if (isPlayingRef.current && !fromNoteId && resumeFromSec === undefined) {
        handlePausePlayback();
        return;
      }

      if (tempoRescheduleTimerRef.current !== null) {
        window.clearTimeout(tempoRescheduleTimerRef.current);
        tempoRescheduleTimerRef.current = null;
      }

      const activeTimeline = buildChantTimeline(
        scoreRef.current,
        tempoRef.current,
        transposeRef.current
      );

      if (fromNoteId) {
        if (activeTimeline.events.length === 0) {
          showNotice('Add neumes to the staff before playing.');
          return;
        }
        const fullIdx = activeTimeline.events.findIndex((e) => e.noteId === fromNoteId);
        const startOffset = fullIdx >= 0 ? activeTimeline.events[fullIdx].startSec : 0;
        startLiveTimelinePlayback(activeTimeline, organRef.current, tempoRef.current, startOffset);
        return;
      }

      if (activeTimeline.events.length === 0) {
        showNotice('Add neumes to the staff or paste GABC in the Source panel before playing.');
        return;
      }

      let startSec = 0;
      let startOptions: PlayTimelineOptions | undefined = undefined;
      if (resumeFromSec !== undefined) {
        startSec = resumeFromSec;
        startOptions = { fadePrevSec: 0.035, lookaheadSec: 0.015 };
      } else if (isPausedRef.current) {
        const selectedEvent = findTimelineEventForSelection(
          scoreRef.current,
          activeTimeline,
          selectionRef.current
        );
        startSec = selectedEvent ? selectedEvent.startSec : elapsedSecRef.current;
      }

      elapsedSecRef.current = startSec;
      setElapsedSec(startSec);
      startLiveTimelinePlayback(
        activeTimeline,
        organRef.current,
        tempoRef.current,
        startSec,
        startOptions
      );
    },
    [handlePausePlayback, showNotice, startLiveTimelinePlayback]
  );

  const handleSeekPlayback = useCallback(
    (sec: number) => {
      elapsedSecRef.current = sec;
      setElapsedSec(sec);
      if (isPlayingRef.current) {
        handleStartPlayback(null, sec);
      } else {
        const paused = sec > 0;
        isPausedRef.current = paused;
        setIsPaused(paused);
        if (paused) {
          const activeTimeline = buildChantTimeline(
            scoreRef.current,
            tempoRef.current,
            transposeRef.current
          );
          const seekEvent = findNextTimelineEventAtOrAfter(activeTimeline, sec);
          if (seekEvent) {
            selectionAnchorNoteIdRef.current = seekEvent.noteId;
            setSelection({
              itemId: seekEvent.itemId,
              groupId: seekEvent.groupId,
              noteId: seekEvent.noteId,
            });
          } else {
            selectionAnchorNoteIdRef.current = null;
            setSelection(null);
          }
        }
      }
    },
    [handleStartPlayback]
  );

  const handleChangeOrgan = useCallback(
    (nextOrgan: OrganType) => {
      if (nextOrgan === organRef.current) return;
      organRef.current = nextOrgan;
      setOrgan(nextOrgan);

      if (isPlayingRef.current) {
        if (tempoRescheduleTimerRef.current !== null) {
          window.clearTimeout(tempoRescheduleTimerRef.current);
          tempoRescheduleTimerRef.current = null;
        }
        const rawOffset = playerRef.current?.getElapsedSec() ?? elapsedSecRef.current;
        const clampedTempo = clampTempoBpm(tempoRef.current);
        const liveOffset =
          playbackTempoRef.current !== clampedTempo
            ? rawOffset * (playbackTempoRef.current / clampedTempo)
            : rawOffset;

        const nextTimeline = buildChantTimeline(
          scoreRef.current,
          clampedTempo,
          transposeRef.current
        );
        if (nextTimeline.events.length === 0) return;

        elapsedSecRef.current = liveOffset;
        setElapsedSec(liveOffset);
        startLiveTimelinePlayback(nextTimeline, nextOrgan, clampedTempo, liveOffset, {
          fadePrevSec: 0.035,
          lookaheadSec: 0.015,
        });
      }
    },
    [startLiveTimelinePlayback]
  );

  const handleChangeTranspose = useCallback(
    (delta: number) => {
      const nextTranspose = Math.max(-6, Math.min(6, transposeRef.current + delta));
      if (nextTranspose === transposeRef.current) return;
      transposeRef.current = nextTranspose;
      setTranspose(nextTranspose);

      if (isPlayingRef.current) {
        if (tempoRescheduleTimerRef.current !== null) {
          window.clearTimeout(tempoRescheduleTimerRef.current);
          tempoRescheduleTimerRef.current = null;
        }
        const rawOffset = playerRef.current?.getElapsedSec() ?? elapsedSecRef.current;
        const clampedTempo = clampTempoBpm(tempoRef.current);
        const liveOffset =
          playbackTempoRef.current !== clampedTempo
            ? rawOffset * (playbackTempoRef.current / clampedTempo)
            : rawOffset;

        const nextTimeline = buildChantTimeline(
          scoreRef.current,
          clampedTempo,
          nextTranspose
        );
        if (nextTimeline.events.length === 0) return;

        elapsedSecRef.current = liveOffset;
        setElapsedSec(liveOffset);
        startLiveTimelinePlayback(
          nextTimeline,
          organRef.current,
          clampedTempo,
          liveOffset,
          { fadePrevSec: 0.035, lookaheadSec: 0.015 }
        );
      }
    },
    [startLiveTimelinePlayback]
  );

  const handleChangeTempo = useCallback(
    (nextTempo: number) => {
      const clampedTempo = clampTempoBpm(nextTempo);
      const prevTempo = clampTempoBpm(tempoRef.current);
      if (clampedTempo === prevTempo) return;

      tempoRef.current = clampedTempo;
      setTempoBpm(clampedTempo);

      if (isPlayingRef.current) {
        if (tempoRescheduleTimerRef.current !== null) {
          window.clearTimeout(tempoRescheduleTimerRef.current);
        }
        tempoRescheduleTimerRef.current = window.setTimeout(() => {
          tempoRescheduleTimerRef.current = null;
          if (!isPlayingRef.current) return;
          const targetTempo = clampTempoBpm(tempoRef.current);
          const currentOffset = playerRef.current?.getElapsedSec() ?? elapsedSecRef.current;
          const scaledOffset = currentOffset * (playbackTempoRef.current / targetTempo);
          const nextTimeline = buildChantTimeline(
            scoreRef.current,
            targetTempo,
            transposeRef.current
          );
          if (nextTimeline.events.length === 0) return;
          elapsedSecRef.current = scaledOffset;
          setElapsedSec(scaledOffset);
          startLiveTimelinePlayback(
            nextTimeline,
            organRef.current,
            targetTempo,
            scaledOffset,
            { fadePrevSec: 0.035, lookaheadSec: 0.015 }
          );
        }, 65);
      } else if (isPausedRef.current) {
        const scaledOffset = elapsedSecRef.current * (prevTempo / clampedTempo);
        playbackTempoRef.current = clampedTempo;
        elapsedSecRef.current = scaledOffset;
        setElapsedSec(scaledOffset);
      } else {
        playbackTempoRef.current = clampedTempo;
      }
    },
    [startLiveTimelinePlayback]
  );

  const openScoreAsNewLibraryEntry = useCallback(
    async (nextRawScore: ChantScore, noticeMsg?: string) => {
      handleStopPlayback();
      setToneLink(null);
      if (activeScoreIdRef.current && scoreStoreRef.current) {
        await persistScoreToLibrary(scoreRef.current);
      }
      const prepared: ChantScore = {
        ...nextRawScore,
        typography: nextRawScore.typography ?? resolvedTypography,
        pageSetup: nextRawScore.pageSetup ?? resolvedPageSetup,
      };
      const entry = createLibraryEntry(prepared);
      const store = scoreStoreRef.current;
      if (store) {
        await store.put(entry);
        const entries = await store.list();
        setLibraryEntries(entries);
      } else {
        saveScore(prepared);
      }
      activeScoreIdRef.current = entry.id;
      setActiveScoreId(entry.id);
      saveActiveScoreId(entry.id);
      suppressNextAutosaveDirtyRef.current = true;
      scoreRef.current = prepared;
      setScore(prepared);
      setUndoStack([]);
      setRedoStack([]);
      selectionAnchorNoteIdRef.current = null;
      setSelection(null);
      setTextSelection(null);
      setToolMode('insert');
      setActivePreset('punctum');
      setSaveStatus('saved');
      if (noticeMsg) showNotice(noticeMsg);
    },
    [
      handleStopPlayback,
      persistScoreToLibrary,
      resolvedPageSetup,
      resolvedTypography,
      showNotice,
    ]
  );

  const handleNewScore = () => {
    void openScoreAsNewLibraryEntry(createEmptyScore(), 'Created new score');
  };

  const handleDirectGabcEdit = useCallback(
    (raw: string, recordHistory = true) => {
      if (isPlayingRef.current || isPausedRef.current) {
        handleStopPlayback();
      }
      const current = scoreRef.current;
      const parsed = parseGabc(raw);
      commitScore(
        {
          ...parsed,
          typography: current.typography ?? resolvedTypography,
          pageSetup: current.pageSetup ?? resolvedPageSetup,
          header: {
            ...parsed.header,
            titleColor: current.header.titleColor,
            titleSpans: current.header.titleSpans,
            officePartColor: current.header.officePartColor,
            officePartSpans: current.header.officePartSpans,
            modeColor: current.header.modeColor,
            annotationColor: current.header.annotationColor,
            dropCapColor: current.header.dropCapColor,
          },
        },
        recordHistory
      );
      selectionAnchorNoteIdRef.current = null;
      setSelection(null);
      setTextSelection(null);
    },
    [commitScore, handleStopPlayback, resolvedPageSetup, resolvedTypography]
  );

  const handleCommitToneGabc = useCallback(
    (
      gabc: string,
      callbacks?: CommitToneCallbacks,
      toneLinkPayload?: CommitToneLinkPayload | null
    ) => {
      const current = scoreRef.current;
      const currentSerialized = serializeGabc(current);
      const hasMusicalOrTextContent =
        current.items.some((it) => it.kind !== 'clef') || !!current.header.name?.trim();
      const isUntouchedSample =
        undoStack.length === 0 && currentSerialized === defaultSampleGabcRef.current;
      const isToneProduced = toneGeneratedGabcsRef.current.has(currentSerialized);

      const applyTone = () => {
        if (isPlayingRef.current || isPausedRef.current) {
          handleStopPlayback();
        }
        const latest = scoreRef.current;
        const parsed = parseGabc(gabc);
        const nextScore: ChantScore = {
          ...parsed,
          typography: latest.typography ?? resolvedTypography,
          pageSetup: latest.pageSetup ?? resolvedPageSetup,
        };
        toneGeneratedGabcsRef.current.add(serializeGabc(nextScore));

        if (toneLinkPayload && toneLinkPayload.phrases.length > 0) {
          const { gabc: serializedWithMap, spans } = serializeGabcWithMap(nextScore);
          const gabcHash = hashGabc(serializedWithMap);
          const syllableItems = nextScore.items
            .map((item, idx) => ({ item, idx }))
            .filter((entry) => entry.item.kind === 'syllable');
          const spanByItemId = new Map<string, { start: number; end: number }>();
          for (const sp of spans) {
            const existing = spanByItemId.get(sp.itemId);
            if (!existing) {
              spanByItemId.set(sp.itemId, { start: sp.start, end: sp.end });
            } else {
              existing.start = Math.min(existing.start, sp.start);
              existing.end = Math.max(existing.end, sp.end);
            }
          }

          const resolvedPhrases = toneLinkPayload.phrases.map((ph) => {
            const firstEntry = syllableItems[ph.firstSyllableIndex];
            const lastEntry = syllableItems[ph.lastSyllableIndex];
            const firstSyllableItemId = firstEntry?.item.id ?? ph.firstSyllableItemId;
            const lastSyllableItemId = lastEntry?.item.id ?? ph.lastSyllableItemId;
            let endDivisionItemId: string | undefined;
            if (lastEntry) {
              const nextItem = nextScore.items[lastEntry.idx + 1];
              if (nextItem?.kind === 'division') {
                endDivisionItemId = nextItem.id;
              }
            }
            const endItemId = endDivisionItemId || lastSyllableItemId;
            const firstSpan = firstSyllableItemId ? spanByItemId.get(firstSyllableItemId) : undefined;
            const endSpan = endItemId ? spanByItemId.get(endItemId) : undefined;
            return {
              ...ph,
              firstSyllableItemId,
              lastSyllableItemId,
              endDivisionItemId,
              endItemId,
              sourceStart: firstSpan?.start ?? ph.sourceStart,
              sourceEnd: endSpan?.end ?? ph.sourceEnd,
              endAnchorOffset: endSpan?.start ?? ph.endAnchorOffset,
            };
          });

          const resolvedLink: ToneLink = {
            ...toneLinkPayload,
            gabcHash,
            phrases: resolvedPhrases,
          };
          toneLinkByHashRef.current.set(gabcHash, resolvedLink);
          setToneLink(resolvedLink);
        } else {
          setToneLink(null);
        }

        scoreRef.current = nextScore;
        commitScore(nextScore, true);
        selectionAnchorNoteIdRef.current = null;
        setSelection(null);
        setTextSelection(null);
        callbacks?.onCommitted();
      };

      if (
        !callbacks?.bypassConfirm &&
        hasMusicalOrTextContent &&
        !isUntouchedSample &&
        !isToneProduced
      ) {
        setConfirmDialog({
          title: 'Replace current score?',
          message:
            'Your score has hand edits not produced by a tone. Applying this tone will replace it (you can still press Undo to restore it).',
          confirmLabel: 'Replace score',
          onConfirm: () => {
            setConfirmDialog(null);
            applyTone();
          },
          onCancel: () => {
            setConfirmDialog(null);
            callbacks?.onCancelled();
          },
        });
        return;
      }

      applyTone();
    },
    [
      commitScore,
      handleStopPlayback,
      resolvedPageSetup,
      resolvedTypography,
      undoStack.length,
    ]
  );

  const [tonesRequested, setTonesRequested] = useState<boolean>(
    () => initialPrefs.ribbonTab === 'tones'
  );
  const [toneController, setToneController] = useState<ToneController | null>(null);

  useEffect(() => {
    if (ribbonTab === 'tones') {
      setTonesRequested(true);
    }
  }, [ribbonTab]);

  const toneLinkStale = useMemo(
    () =>
      Boolean(
        toneLink &&
          activeToneLink === null &&
          toneController &&
          (toneController.saved.mode === 'reading' || toneController.saved.mode === 'preface') &&
          toneController.text.trim().length > 0
      ),
    [activeToneLink, toneController, toneLink]
  );

  const handleChangeTypography = useCallback(
    (patch: Partial<ScoreTypography>) => {
      commitScore(updateScoreTypography(score, patch));
    },
    [commitScore, score]
  );

  const handleChangePageSetup = useCallback(
    (patch: Partial<ScorePageSetup>) => {
      commitScore(updateScorePageSetup(score, patch));
    },
    [commitScore, score]
  );

  const handleApplyTextColor = useCallback(
    (color: string | null) => {
      commitScore(applyTextColorToSelection(score, selection, textSelection, color));
    },
    [commitScore, score, selection, textSelection]
  );

  const handleApplyVowelAccent = useCallback(
    (accent: VowelAccentType) => {
      const res = applyVowelAccentToSelection(score, selection, textSelection, accent);
      if (res.changed) {
        commitScore(res.nextScore);
        if (res.nextTextSelection !== textSelection) {
          setTextSelection(res.nextTextSelection);
        }
      }
    },
    [commitScore, score, selection, textSelection]
  );

  const handleGabcCursorSync = useCallback(
    (offset: number, draftText: string, isDirty: boolean) => {
      const matched = findSelectionForGabcOffset(
        draftText,
        offset,
        score,
        gabcSpans,
        isDirty
      );
      if (matched) {
        selectionAnchorNoteIdRef.current = matched.noteId || null;
        setSelection(matched);
        setScrollTargetItemId(matched.itemId);
      }
    },
    [gabcSpans, score]
  );

  const handleDropOrStampNeume = (
    preset: NeumePresetId,
    pitch: number,
    target:
      | { mode: 'append-to-syllable'; itemId: string }
      | { mode: 'insert-new-syllable'; insertAfterIndex: number }
  ) => {
    const res = insertNeumeIntoScore(score, preset, pitch, target);
    commitScore(res.nextScore);
    selectionAnchorNoteIdRef.current = res.selection.noteId || null;
    setSelection(res.selection);
    const clef = getActiveClefAtItem(res.selection.itemId);
    auditionPitchOnOrgan(res.firstNotePitch, clef);
  };

  const handleDropDivision = (division: DivisionType, insertAfterIndex: number) => {
    const res = insertDivisionIntoScore(score, division, insertAfterIndex);
    commitScore(res.nextScore);
    selectionAnchorNoteIdRef.current = null;
    setSelection(res.selection);
  };

  const handleDropClef = (clef: ClefType, insertAfterIndex: number) => {
    const res = insertOrReplaceClef(score, clef, selection?.itemId, insertAfterIndex);
    commitScore(res.nextScore);
    selectionAnchorNoteIdRef.current = null;
    setSelection(res.selection);
  };

  const handleInsertDivisionFromPalette = (division: DivisionType) => {
    const idx = selection
      ? score.items.findIndex((it) => it.id === selection.itemId)
      : score.items.length - 1;
    const res = insertDivisionIntoScore(score, division, idx === -1 ? score.items.length - 1 : idx);
    commitScore(res.nextScore);
    selectionAnchorNoteIdRef.current = null;
    setSelection(res.selection);
  };

  const handleSelectClefFromPalette = (clef: ClefType) => {
    const idx = selection
      ? score.items.findIndex((it) => it.id === selection.itemId)
      : score.items.length - 1;
    const res = insertOrReplaceClef(score, clef, selection?.itemId, idx);
    commitScore(res.nextScore);
    selectionAnchorNoteIdRef.current = null;
    setSelection(res.selection);
  };

  const handleInsertLineBreakFromPalette = () => {
    const idx = selection
      ? score.items.findIndex((it) => it.id === selection.itemId)
      : score.items.length - 1;
    const res = insertLineBreak(score, idx === -1 ? score.items.length - 1 : idx);
    commitScore(res.nextScore);
    selectionAnchorNoteIdRef.current = null;
    setSelection(res.selection);
  };

  const handleToggleModifier = useCallback(
    (mod: ModifierPresetId) => {
      if (!selection) return;
      commitScore(toggleModifierOnSelection(score, selection, mod));
    },
    [commitScore, score, selection]
  );

  const handleSetLiquescentDir = useCallback(
    (dir: 'asc' | 'desc' | 'dim') => {
      if (!selection) return;
      commitScore(setNoteLiquescentDir(score, selection, dir));
    },
    [commitScore, score, selection]
  );

  const handleSplitGroup = useCallback(() => {
    if (!selection || !selection.noteId) return;
    const res = splitGroupAtNote(score, selection.itemId, selection.noteId);
    if (res) {
      commitScore(res.nextScore);
      setSelection(res.nextSelection);
    }
  }, [commitScore, score, selection]);

  const handleMergeGroup = useCallback(() => {
    if (!selection || !selection.groupId) return;
    const res = mergeWithPreviousGroup(score, selection.itemId, selection.groupId);
    if (res) {
      commitScore(res.nextScore);
      setSelection(res.nextSelection);
    }
  }, [commitScore, score, selection]);

  const handleShiftSyllableLyric = useCallback(
    (itemId: string, dir: 'prev' | 'next') => {
      const res = shiftSyllableLyric(score, itemId, dir);
      if (res) {
        commitScore(res.nextScore);
        setSelection(res.nextSelection);
      }
    },
    [commitScore, score]
  );

  const handleShiftPitch = useCallback(
    (delta: number) => {
      if (!selection) return;
      const next = shiftSelectedPitch(score, selection, delta);
      commitScore(next);
      const syl = next.items.find((it) => it.id === selection.itemId);
      if (syl && syl.kind === 'syllable') {
        const grp = syl.groups.find((g) => g.id === selection.groupId) || syl.groups[0];
        const note = grp?.notes.find((n) => n.id === selection.noteId) || grp?.notes[0];
        if (note) {
          auditionPitchOnOrgan(note.pitch, getActiveClefAtItem(syl.id));
        }
      }
    },
    [auditionPitchOnOrgan, commitScore, getActiveClefAtItem, score, selection]
  );

  const handleDeleteSelection = useCallback(() => {
    if (!selection) return;
    const res = deleteSelectedFromScore(score, selection);
    commitScore(res.nextScore);
    selectionAnchorNoteIdRef.current = res.nextSelection?.noteId || null;
    setSelection(res.nextSelection);
    setTextSelection(null);
  }, [commitScore, score, selection]);

  const handleCopy = useCallback(() => {
    const payload = copySelectionPayload(score, selection);
    if (payload) {
      setClipboard(payload);
      showNotice(
        payload.kind === 'notes'
          ? `Copied ${payload.notes.length} note${payload.notes.length > 1 ? 's' : ''}`
          : `Copied ${payload.kind}`
      );
    }
  }, [score, selection, showNotice]);

  const handlePaste = useCallback(() => {
    if (!clipboard) return;
    const res = pastePayloadIntoScore(score, selection, clipboard);
    commitScore(res.nextScore);
    selectionAnchorNoteIdRef.current = res.nextSelection.noteId || null;
    setSelection(res.nextSelection);
  }, [clipboard, commitScore, score, selection]);

  const handleSelectPreset = useCallback(
    (preset: NeumePresetId) => {
      setDragZoomActive(false);
      if (toolMode === 'select' && getSelectedNoteRefs(selection).length > 0 && selection) {
        const res = replaceSelectedNoteWithPreset(score, selection, preset);
        if (res) {
          commitScore(res.nextScore);
          selectionAnchorNoteIdRef.current = res.nextSelection.noteId || null;
          setSelection(res.nextSelection);
          auditionPitchOnOrgan(res.firstNotePitch, getActiveClefAtItem(res.nextSelection.itemId));
          return;
        }
      }
      setActivePreset(preset);
      setToolMode('insert');
    },
    [auditionPitchOnOrgan, commitScore, getActiveClefAtItem, score, selection, toolMode]
  );

  const handleAppendBlankSyllable = () => {
    const res = insertNeumeIntoScore(
      score,
      'punctum',
      5,
      {
        mode: 'insert-new-syllable',
        insertAfterIndex: score.items.length - 1,
      },
      true
    );
    commitScore(res.nextScore);
    selectionAnchorNoteIdRef.current = res.selection.noteId || null;
    setSelection(res.selection);
    auditionPitchOnOrgan(res.firstNotePitch, getActiveClefAtItem(res.selection.itemId));
  };

  const handleAssignSyllableToNote = useCallback(
    (itemId: string, noteId: string, newLyric: string) => {
      const res = splitSyllableAtNote(score, itemId, noteId, newLyric);
      commitScore(res.nextScore);
      selectionAnchorNoteIdRef.current = res.nextSelection.noteId || null;
      setSelection(res.nextSelection);
    },
    [commitScore, score]
  );

  const handleCommitEmptySyllable = useCallback(
    (itemId: string) => {
      const res = mergeEmptySyllableIntoPrevious(score, itemId, selection);
      if (res.merged) {
        commitScore(res.nextScore);
        selectionAnchorNoteIdRef.current = res.nextSelection?.noteId || null;
        setSelection(res.nextSelection);
      }
    },
    [commitScore, score, selection]
  );

  const loadProjectText = async (text: string, label: string): Promise<boolean> => {
    try {
      const rawObj = JSON.parse(text) as { app?: string } | null;
      if (rawObj && typeof rawObj === 'object' && rawObj.app === 'chantscore-library') {
        const parsed = parseLibraryBackupJson(text);
        if (!parsed.ok) {
          showNotice(
            parsed.reason === 'newer-schema'
              ? `"${label}" was created by a newer version of ChantScore and cannot be opened here.`
              : `"${label}" is not a valid ChantScore backup file.`
          );
          return false;
        }
        const store = scoreStoreRef.current;
        if (store) {
          const inspection = await inspectBackupRestore(parsed.envelope, store);
          setPendingRestore({
            fileName: label,
            envelope: parsed.envelope,
            inspection,
          });
          setLibraryOpen(true);
          return true;
        }
      }
    } catch {
      /* fall through to parseProjectJson check */
    }

    const loaded = parseProjectJson(text);
    if (!loaded) {
      showNotice(`"${label}" is not a valid ChantScore project file.`);
      return false;
    }
    markDirtySinceBackup();
    await openScoreAsNewLibraryEntry(loaded, `Opened "${label}" as a new score`);
    return true;
  };

  const openProjectFile = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.chantscore-library.json,application/json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      await loadProjectText(await file.text(), file.name);
    };
    input.click();
  };

  const handleOpenLibraryScore = useCallback(
    async (id: string) => {
      const store = scoreStoreRef.current;
      if (!store) return;
      if (activeScoreIdRef.current && activeScoreIdRef.current !== id) {
        await persistScoreToLibrary(scoreRef.current);
      }
      const entry = await store.get(id);
      if (!entry) return;
      handleStopPlayback();
      setToneLink(null);
      const prepared: ChantScore = {
        ...entry.project.score,
        typography: entry.project.score.typography ?? resolvedTypography,
        pageSetup: entry.project.score.pageSetup ?? resolvedPageSetup,
      };
      activeScoreIdRef.current = entry.id;
      setActiveScoreId(entry.id);
      saveActiveScoreId(entry.id);
      suppressNextAutosaveDirtyRef.current = true;
      scoreRef.current = prepared;
      setScore(prepared);
      setUndoStack([]);
      setRedoStack([]);
      selectionAnchorNoteIdRef.current = null;
      setSelection(null);
      setTextSelection(null);
      setSaveStatus('saved');
      setLibraryEntries(await store.list());
    },
    [handleStopPlayback, persistScoreToLibrary, resolvedPageSetup, resolvedTypography]
  );

  const handleDuplicateLibraryScore = useCallback(
    async (id: string) => {
      const store = scoreStoreRef.current;
      if (!store) return;
      if (id === activeScoreIdRef.current) {
        await persistScoreToLibrary(scoreRef.current);
      }
      const copy = await store.duplicate(id);
      setLibraryEntries(await store.list());
      if (copy) {
        markDirtySinceBackup();
        showNotice(`Duplicated "${copy.name}"`);
      }
    },
    [markDirtySinceBackup, persistScoreToLibrary, showNotice]
  );

  const handleRenameLibraryScore = useCallback(
    async (id: string, nextName: string) => {
      const store = scoreStoreRef.current;
      if (!store) return;
      if (id === activeScoreIdRef.current) {
        await persistScoreToLibrary(scoreRef.current);
      }
      const updated = await store.rename(id, nextName);
      if (updated && id === activeScoreIdRef.current) {
        suppressNextAutosaveDirtyRef.current = true;
        scoreRef.current = updated.project.score;
        setScore(updated.project.score);
      }
      if (updated) {
        markDirtySinceBackup();
      }
      setLibraryEntries(await store.list());
    },
    [markDirtySinceBackup, persistScoreToLibrary]
  );

  const handleDeleteLibraryScore = useCallback(
    async (id: string) => {
      const store = scoreStoreRef.current;
      if (!store) return;
      await store.delete(id);
      const remaining = await store.list();
      if (id === activeScoreIdRef.current) {
        handleStopPlayback();
        setToneLink(null);
        setUndoStack([]);
        setRedoStack([]);
        selectionAnchorNoteIdRef.current = null;
        setSelection(null);
        setTextSelection(null);
        if (remaining.length > 0) {
          const next = remaining[0];
          const prepared: ChantScore = {
            ...next.project.score,
            typography: next.project.score.typography ?? resolvedTypography,
            pageSetup: next.project.score.pageSetup ?? resolvedPageSetup,
          };
          activeScoreIdRef.current = next.id;
          setActiveScoreId(next.id);
          saveActiveScoreId(next.id);
          suppressNextAutosaveDirtyRef.current = true;
          scoreRef.current = prepared;
          setScore(prepared);
          setLibraryEntries(remaining);
        } else {
          const blank: ChantScore = {
            ...createEmptyScore(),
            typography: resolvedTypography,
            pageSetup: resolvedPageSetup,
          };
          const fresh = createLibraryEntry(blank);
          await store.put(fresh);
          activeScoreIdRef.current = fresh.id;
          setActiveScoreId(fresh.id);
          saveActiveScoreId(fresh.id);
          suppressNextAutosaveDirtyRef.current = true;
          scoreRef.current = blank;
          setScore(blank);
          setLibraryEntries(await store.list());
        }
      } else {
        setLibraryEntries(remaining);
      }
      showNotice('Score deleted');
    },
    [handleStopPlayback, resolvedPageSetup, resolvedTypography, showNotice]
  );

  const handleBackupAll = useCallback(async () => {
    const store = scoreStoreRef.current;
    if (!store) return;
    if (activeScoreIdRef.current) {
      await persistScoreToLibrary(scoreRef.current);
    }
    const envelope = await createLibraryBackupEnvelope(store);
    exportAsLibraryBackup(envelope);
    markBackedUp();
    showNotice(
      `Backed up ${envelope.scores.length} ${envelope.scores.length === 1 ? 'score' : 'scores'}`
    );
  }, [markBackedUp, persistScoreToLibrary, showNotice]);

  const handleSelectRestoreFile = useCallback(
    async (file: File) => {
      const store = scoreStoreRef.current;
      if (!store) return;
      const text = await file.text();
      const parsed = parseLibraryBackupJson(text);
      if (!parsed.ok) {
        showNotice(
          parsed.reason === 'newer-schema'
            ? `"${file.name}" was created by a newer version of ChantScore and cannot be opened here.`
            : `"${file.name}" is not a valid ChantScore backup file.`
        );
        return;
      }
      const inspection = await inspectBackupRestore(parsed.envelope, store);
      setPendingRestore({
        fileName: file.name,
        envelope: parsed.envelope,
        inspection,
      });
    },
    [showNotice]
  );

  const handleConfirmRestore = useCallback(
    async (mode: 'overwrite' | 'keep-both' | 'skip-existing') => {
      const store = scoreStoreRef.current;
      if (!store || !pendingRestore) return;
      const summary = await applyBackupRestore(pendingRestore.envelope, store, {
        conflictMode: mode,
        restoreSettings: true,
      });
      const entries = await store.list();
      setLibraryEntries(entries);
      if (mode === 'overwrite' && activeScoreIdRef.current) {
        const updatedActive = entries.find((e) => e.id === activeScoreIdRef.current);
        if (updatedActive) {
          suppressNextAutosaveDirtyRef.current = true;
          scoreRef.current = updatedActive.project.score;
          setScore(updatedActive.project.score);
        }
      }
      setPendingRestore(null);
      const totalImportedScores =
        summary.restoredScores + summary.replacedScores + summary.copiedScores;
      const parts = [
        `${totalImportedScores} ${totalImportedScores === 1 ? 'score' : 'scores'}`,
      ];
      if (summary.restoredTemplates > 0) {
        parts.push(
          `${summary.restoredTemplates} ${
            summary.restoredTemplates === 1 ? 'template' : 'templates'
          }`
        );
      }
      if (summary.skippedScores > 0) {
        parts.push(`${summary.skippedScores} skipped`);
      }
      showNotice(`Restored ${parts.join(', ')}`);
    },
    [pendingRestore, showNotice]
  );

  const handleExport = async (format: ExportFormat) => {
    setBusyExport(format);
    const styleLabel =
      exportStyle === 'sheet-red'
        ? 'Chant Sheet (Red Ink)'
        : exportStyle === 'sheet'
        ? 'Chant Sheet (Black Ink)'
        : 'Missal Folio';
    try {
      if (format === 'gabc') {
        exportAsGabc(score);
        markBackedUp();
        showNotice('Exported GABC file');
      } else if (format === 'png') {
        const res = await exportAsPng(score, { style: exportStyle, transparentPng });
        showNotice(
          res.isZip
            ? `Exported ${res.pageCount} ${styleLabel} PNG pages as ZIP (${res.pixelWidth}×${res.pixelHeight} px)`
            : `Exported ${styleLabel} PNG (${res.pixelWidth}×${res.pixelHeight} px${transparentPng ? ', transparent' : ''})`
        );
      } else if (format === 'pdf') {
        const res = await exportAsPdf(score, { style: exportStyle });
        showNotice(
          res.pageCount > 1
            ? `Exported ${res.pageCount}-page ${styleLabel} PDF`
            : `Exported ${styleLabel} PDF`
        );
      } else if (format === 'mp3') {
        const timeline = buildChantTimeline(score, tempoBpm, transpose);
        if (timeline.events.length === 0) {
          showNotice('Add neumes before exporting MP3 audio.');
        } else {
          await exportAsMp3(score, organ, tempoBpm, transpose);
          showNotice(`Exported MP3 (${ORGAN_PROFILES[organ].label})`);
        }
      } else if (format === 'project') {
        exportAsProjectFile(score);
        markBackedUp();
        showNotice('Saved project file (includes fonts, page setup and colours)');
      } else if (format === 'openproject') {
        openProjectFile();
      } else if (format === 'link') {
        const res = await copyShareLink(score);
        showNotice(
          res === 'copied'
            ? 'Share link copied (notation and text only; fonts and colours are not included)'
            : res === 'too-large'
            ? 'This score is too large for a link. Use Save Project instead.'
            : 'Could not copy the link.'
        );
      } else if (format === 'sourceandsummit') {
        const res = exportToSourceAndSummit(score);
        showNotice(
          res.hashIncluded
            ? 'Opened Source & Summit Editor with GABC loaded (also copied to clipboard)'
            : res.copied
            ? 'Opened Source & Summit Editor — GABC copied to clipboard (paste with Ctrl/Cmd+V)'
            : 'Opened Source & Summit Editor'
        );
      }
    } catch (err) {
      console.error(err);
      showNotice(`Failed to export ${format.toUpperCase()}. Please try again.`);
    } finally {
      setBusyExport(null);
    }
  };

  // Global Studio Keyboard Shortcuts
  useEffect(() => {
    const clearSpacePanState = () => {
      if (spacePressRef.current.timerId !== null) {
        window.clearTimeout(spacePressRef.current.timerId);
      }
      spacePressRef.current = { pressed: false, heldToPan: false, timerId: null };
      setSpacePanActive(false);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTyping = isTextEntryTarget(target);
      const lower = e.key.toLowerCase();

      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && lower === 's') {
        e.preventDefault();
        setSaveStatus('saving');
        void persistScoreToLibrary(scoreRef.current).then((ok) => {
          setSaveStatus(ok ? 'saved' : 'failed');
          showNotice(ok ? 'Score saved' : 'Could not save locally — use Export → Save Project');
        });
        return;
      }
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && lower === 'e') {
        e.preventDefault();
        if (isFullscreen) handleToggleFullscreen();
        setRibbonTab('export');
        setRibbonCollapsed(false);
        showNotice('Export tab opened');
        return;
      }

      if ((e.metaKey || e.ctrlKey) && lower === 'z') {
        if (isTyping) return;
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && lower === 'y') {
        if (isTyping) return;
        e.preventDefault();
        handleRedo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && lower === 'c') {
        if (isTyping) return;
        if (selection) {
          e.preventDefault();
          handleCopy();
        }
        return;
      }
      if ((e.metaKey || e.ctrlKey) && lower === 'v') {
        if (isTyping) return;
        if (clipboard) {
          e.preventDefault();
          handlePaste();
        }
        return;
      }

      if (isTyping) return;

      if ((e.code === 'Space' || e.key === ' ') && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        if (e.repeat || spacePressRef.current.pressed) return;
        const timerId = window.setTimeout(() => {
          spacePressRef.current.heldToPan = true;
          spacePressRef.current.timerId = null;
          setSpacePanActive(true);
        }, 200);
        spacePressRef.current = { pressed: true, heldToPan: false, timerId };
        return;
      }

      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const presetForKey =
        SHORTCUT_NEUME_MAP[e.key] || (!e.shiftKey ? DIGIT_CODE_NEUME_MAP[e.code] : undefined);

      if (e.key === 'Escape') {
        if (isFullscreen) {
          handleToggleFullscreen();
        } else if (dragZoomActive) {
          setDragZoomActive(false);
        } else {
          setToolMode('select');
        }
      } else if (lower === 'v') {
        e.preventDefault();
        setDragZoomActive(false);
        setToolMode('select');
      } else if (lower === 'n') {
        e.preventDefault();
        setDragZoomActive(false);
        setToolMode('insert');
        if (!activePreset) setActivePreset('punctum');
      } else if (lower === 'z') {
        e.preventDefault();
        setDragZoomActive((prev) => !prev);
      } else if (lower === 'f') {
        e.preventDefault();
        setZoomMode((prev) => (prev === 'fit-width' ? 'fit-page' : 'fit-width'));
      } else if (e.key === '`') {
        e.preventDefault();
        handleToggleFullscreen();
      } else if (presetForKey) {
        e.preventDefault();
        handleSelectPreset(presetForKey);
      } else if (lower === 'm' && getSelectedNoteRefs(selection).length > 0) {
        e.preventDefault();
        handleToggleModifier('mora');
      } else if (lower === 'e' && getSelectedNoteRefs(selection).length > 0) {
        e.preventDefault();
        handleToggleModifier('episemaH');
      } else if (lower === 'i' && getSelectedNoteRefs(selection).length > 0) {
        e.preventDefault();
        handleToggleModifier('episemaV');
      } else if (lower === 'b' && getSelectedNoteRefs(selection).length > 0) {
        e.preventDefault();
        handleToggleModifier('flat');
      } else if (lower === 'h' && getSelectedNoteRefs(selection).length > 0) {
        e.preventDefault();
        handleToggleModifier('natural');
      } else if (lower === 'l' && getSelectedNoteRefs(selection).length > 0) {
        e.preventDefault();
        handleToggleModifier('liquescent');
      } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.shiftKey) {
        const next = moveNoteSelection(score, selection, e.key === 'ArrowLeft' ? -1 : 1, {
          selectBoundaryWhenEmpty: true,
        });
        if (next) {
          e.preventDefault();
          selectionAnchorNoteIdRef.current = next.noteId ?? null;
          setSelection(next);
          setScrollTargetItemId(next.itemId);
          const info = findNoteInfoForSelection(score, next);
          if (info && !info.note.accidentalOnly) {
            auditionPitchOnOrgan(info.note.pitch, info.clef, info.effectiveAccidental);
          }
        }
      } else if (e.key === 'ArrowUp' && getSelectedNoteRefs(selection).length > 0) {
        e.preventDefault();
        handleShiftPitch(1);
      } else if (e.key === 'ArrowDown' && getSelectedNoteRefs(selection).length > 0) {
        e.preventDefault();
        handleShiftPitch(-1);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selection) {
        e.preventDefault();
        handleDeleteSelection();
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if ((e.code === 'Space' || e.key === ' ') && spacePressRef.current.pressed) {
        e.preventDefault();
        const wasPan = spacePressRef.current.heldToPan;
        clearSpacePanState();
        if (!wasPan) {
          handleStartPlayback();
        }
      }
    };

    const onPointerDownWhileSpace = () => {
      if (spacePressRef.current.pressed && !spacePressRef.current.heldToPan) {
        if (spacePressRef.current.timerId !== null) {
          window.clearTimeout(spacePressRef.current.timerId);
          spacePressRef.current.timerId = null;
        }
        spacePressRef.current.heldToPan = true;
        setSpacePanActive(true);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('pointerdown', onPointerDownWhileSpace, true);
    window.addEventListener('blur', clearSpacePanState);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('pointerdown', onPointerDownWhileSpace, true);
      window.removeEventListener('blur', clearSpacePanState);
      if (spacePressRef.current.timerId !== null) {
        window.clearTimeout(spacePressRef.current.timerId);
      }
    };
  }, [
    activePreset,
    auditionPitchOnOrgan,
    clipboard,
    dragZoomActive,
    handleCopy,
    handleDeleteSelection,
    handlePaste,
    handleRedo,
    handleSelectPreset,
    handleShiftPitch,
    handleStartPlayback,
    handleToggleFullscreen,
    handleToggleModifier,
    handleUndo,
    isFullscreen,
    persistScoreToLibrary,
    score,
    selection,
    showNotice,
  ]);

  const activeModifiers = useMemo(() => {
    const defaults = {
      mora: false,
      episemaH: false,
      episemaV: false,
      flat: false,
      natural: false,
      liquescent: false,
    };
    const refs = getSelectedNoteRefs(selection);
    if (refs.length === 0) return defaults;

    const idSet = new Set(refs.map((r) => r.noteId));
    const notes: ChantNote[] = [];
    for (const item of score.items) {
      if (item.kind !== 'syllable') continue;
      for (const grp of item.groups) {
        for (const n of grp.notes) {
          if (idSet.has(n.id)) notes.push(n);
        }
      }
    }
    if (notes.length === 0) return defaults;
    const nonAcc = notes.filter((n) => !n.accidentalOnly);
    return {
      mora: nonAcc.length > 0 && nonAcc.every((n) => !!n.mora),
      episemaH: nonAcc.length > 0 && nonAcc.every((n) => !!n.episemaH),
      episemaV: nonAcc.length > 0 && nonAcc.every((n) => !!n.episemaV),
      flat: notes.every((n) => n.accidental === 'flat'),
      natural: notes.every((n) => n.accidental === 'natural'),
      liquescent: nonAcc.length > 0 && nonAcc.every((n) => !!n.liquescent),
    };
  }, [score.items, selection]);

  const handleWorkspaceFileDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      if (file.name.toLowerCase().endsWith('.json')) {
        e.preventDefault();
        await loadProjectText(await file.text(), file.name);
      } else if (file.name.endsWith('.gabc') || file.type.startsWith('text/')) {
        e.preventDefault();
        const text = await file.text();
        markDirtySinceBackup();
        await openScoreAsNewLibraryEntry(parseGabc(text), `Opened "${file.name}" as a new score`);
      }
    }
  };

  const backupNudgeLabel = useMemo(() => getBackupNudgeLabel(backupMeta), [backupMeta]);

  return (
    <>
      <StudioLayout
        workspaceMode={workspaceMode}
        isFullscreen={isFullscreen}
        gabcWidth={gabcWidth}
        toneLayoutMode={effectiveToneLayoutMode}
        toneWidth={effectiveToneWidth}
        showTonePanel={ribbonTab === 'tones' && (toneController ? toneController.dockOpen : true)}
        tonePanelActive={ribbonTab === 'tones'}
        onSetWorkspaceMode={setWorkspaceMode}
        onChangeGabcWidth={setGabcWidth}
        onChangeToneWidth={setToneWidth}
        onExpandTonePanel={() => toneController?.setDockOpen(true)}
        onFileDrop={handleWorkspaceFileDrop}
        tonePanel={
          tonesRequested ? (
            <React.Suspense
              fallback={
                <div className="p-3 text-xs text-[#6B6257]">Loading tones…</div>
              }
            >
              {toneController ? (
                <LazyToneDockPanel
                  controller={toneController}
                  language={language}
                  layoutMode={effectiveToneLayoutMode}
                  panelWidth={effectiveToneWidth}
                  toneLinkValid={Boolean(activeToneLink)}
                  toneLinkStale={toneLinkStale}
                  showPhraseControls={showPhraseControls}
                  onToggleShowPhraseControls={setShowPhraseControls}
                  onToggleLayoutMode={() =>
                    setToneLayoutPref(effectiveToneLayoutMode === 'side' ? 'below' : 'side')
                  }
                  onCollapse={() => toneController.setDockOpen(false)}
                />
              ) : (
                <div className="p-3 text-xs text-[#6B6257]">Loading tones…</div>
              )}
            </React.Suspense>
          ) : null
        }
        ribbon={
          <RibbonToolbar
            activeTab={ribbonTab}
            collapsed={ribbonCollapsed}
            workspaceMode={workspaceMode}
            saveStatus={saveStatus}
            score={score}
            selection={selection}
            textSelection={textSelection}
            toolMode={toolMode}
            activePreset={activePreset}
            activeModifiers={activeModifiers}
            canUndo={undoStack.length > 0}
            canRedo={redoStack.length > 0}
            clipboard={clipboard}
            isPlaying={isPlaying}
            isPaused={isPaused}
            elapsedSec={elapsedSec}
            totalDurationSec={fullTimeline.totalDurationSec}
            activeNoteLabel={activeNoteLabel}
            organ={organ}
            tempoBpm={tempoBpm}
            transpose={transpose}
            volume={volume}
            muted={muted}
            language={language}
            toneController={toneController}
            busyExport={busyExport}
            exportStyle={exportStyle}
            transparentPng={transparentPng}
            onSelectTab={setRibbonTab}
            onToggleCollapse={() => setRibbonCollapsed((c) => !c)}
            onSetWorkspaceMode={setWorkspaceMode}
            onSetToolMode={(mode) => {
              setDragZoomActive(false);
              setToolMode(mode);
              if (mode === 'insert' && !activePreset) setActivePreset('punctum');
            }}
            onSelectPreset={handleSelectPreset}
            onStartDrag={setDraggingPayload}
            onEndDrag={() => setDraggingPayload(null)}
            onUndo={handleUndo}
            onRedo={handleRedo}
            onCopy={handleCopy}
            onPaste={handlePaste}
            onNewScore={handleNewScore}
            onDeleteSelection={handleDeleteSelection}
            onShiftPitch={handleShiftPitch}
            onToggleModifier={handleToggleModifier}
            onSetLiquescentDir={handleSetLiquescentDir}
            onSplitGroup={handleSplitGroup}
            onMergeGroup={handleMergeGroup}
            onInsertDivision={handleInsertDivisionFromPalette}
            onSelectClef={handleSelectClefFromPalette}
            onInsertLineBreak={handleInsertLineBreakFromPalette}
            onUpdateLyric={(itemId, lyric, wordEnd) =>
              commitScore(updateSyllableText(score, itemId, lyric, wordEnd))
            }
            onAssignSyllableToNote={handleAssignSyllableToNote}
            onCommitEmptySyllable={handleCommitEmptySyllable}
            onShiftSyllableLyric={handleShiftSyllableLyric}
            onPlay={() => handleStartPlayback()}
            onPause={handlePausePlayback}
            onStop={handleStopPlayback}
            onSeek={handleSeekPlayback}
            onPlayFromSelection={(noteId) => handleStartPlayback(noteId)}
            onChangeOrgan={handleChangeOrgan}
            onChangeTempo={handleChangeTempo}
            onChangeTranspose={handleChangeTranspose}
            onChangeVolume={(v) => {
              setVolume(v);
              if (v > 0 && muted) setMuted(false);
            }}
            onToggleMute={() => setMuted((m) => !m)}
            onChangeLanguage={setLanguage}
            onExport={handleExport}
            onChangeExportStyle={setExportStyle}
            onToggleTransparentPng={() => setTransparentPng((v) => !v)}
            onPrint={() => window.print()}
            onToggleDropCap={() =>
              commitScore(
                updateHeader(score, {
                  initialStyle: score.header.initialStyle === '0' ? '1' : '0',
                })
              )
            }
            onChangeTypography={handleChangeTypography}
            onChangePageSetup={handleChangePageSetup}
            onApplyTextColor={handleApplyTextColor}
            onApplyVowelAccent={handleApplyVowelAccent}
            onSelectText={setTextSelection}
            onClearTextSelection={() => setTextSelection(null)}
            scoreCount={libraryEntries.length}
            backupNudgeLabel={backupNudgeLabel}
            onOpenLibrary={() => setLibraryOpen(true)}
            onDismissBackupNudge={handleDismissBackupNudge}
            onTriggerBackupAll={() => void handleBackupAll()}
          />
        }
        workspace={
          <ScoreWorkspace
            score={score}
            selection={selection}
            textSelection={textSelection}
            playingNoteId={playingNoteId}
            toolMode={toolMode}
            activePreset={activePreset}
            draggingPayload={draggingPayload}
            zoom={zoom}
            zoomMode={zoomMode}
            isFullscreen={isFullscreen}
            spacePanActive={spacePanActive}
            dragZoomActive={dragZoomActive}
            scrollTargetItemId={scrollTargetItemId}
            notice={notice}
            onChangeZoom={(nextZoom, nextMode) => {
              setZoom(nextZoom);
              setZoomMode(nextMode);
            }}
            onToggleFullscreen={handleToggleFullscreen}
            onToggleDragZoom={() => setDragZoomActive((prev) => !prev)}
            onSelectText={setTextSelection}
            onSelect={(sel, audition, modifiers) => {
              setScrollTargetItemId(null);
              if (!sel || !sel.noteId) {
                selectionAnchorNoteIdRef.current = null;
                setSelection(sel);
                return;
              }

              if (modifiers?.shiftKey) {
                const ordered = getOrderedScoreNotes(score);
                const anchorId =
                  selectionAnchorNoteIdRef.current || selection?.noteId || sel.noteId;
                const anchorIdx = ordered.findIndex((r) => r.noteId === anchorId);
                const targetIdx = ordered.findIndex((r) => r.noteId === sel.noteId);

                if (anchorIdx !== -1 && targetIdx !== -1) {
                  const lo = Math.min(anchorIdx, targetIdx);
                  const hi = Math.max(anchorIdx, targetIdx);
                  const range = ordered.slice(lo, hi + 1);
                  if (!selectionAnchorNoteIdRef.current) {
                    selectionAnchorNoteIdRef.current = anchorId;
                  }
                  setSelection({
                    itemId: sel.itemId,
                    groupId: sel.groupId,
                    noteId: sel.noteId,
                    selectedNotes: range,
                  });
                } else {
                  selectionAnchorNoteIdRef.current = sel.noteId;
                  setSelection(sel);
                }
              } else if (modifiers?.toggleKey) {
                const currentRefs = getSelectedNoteRefs(selection);
                const exists = currentRefs.some((r) => r.noteId === sel.noteId);
                const clickedRef = {
                  itemId: sel.itemId,
                  groupId: sel.groupId || '',
                  noteId: sel.noteId,
                };
                let nextRefs = exists
                  ? currentRefs.filter((r) => r.noteId !== sel.noteId)
                  : [...currentRefs, clickedRef];

                const ordered = getOrderedScoreNotes(score);
                const nextSet = new Set(nextRefs.map((r) => r.noteId));
                nextRefs = ordered.filter((r) => nextSet.has(r.noteId));

                if (nextRefs.length === 0) {
                  selectionAnchorNoteIdRef.current = null;
                  setSelection(null);
                } else {
                  const primary = nextRefs.some((r) => r.noteId === sel.noteId)
                    ? clickedRef
                    : nextRefs[nextRefs.length - 1];
                  selectionAnchorNoteIdRef.current = primary.noteId;
                  setSelection({
                    itemId: primary.itemId,
                    groupId: primary.groupId,
                    noteId: primary.noteId,
                    selectedNotes: nextRefs,
                  });
                }
              } else {
                selectionAnchorNoteIdRef.current = sel.noteId;
                setSelection(sel);
              }

              if (audition) {
                auditionPitchOnOrgan(audition.pitch, audition.clef);
              }
            }}
            onDropOrStampNeume={handleDropOrStampNeume}
            onDropDivision={handleDropDivision}
            onDropClef={handleDropClef}
            onDragNotePitch={(itemId, noteId, newPitch, pitchDelta, clef) => {
              const refs = getSelectedNoteRefs(selection);
              if (refs.length > 1 && refs.some((r) => r.noteId === noteId) && selection) {
                const next = shiftSelectedPitch(score, selection, pitchDelta);
                commitScore(next, false);
                auditionPitchOnOrgan(newPitch, clef);
                return;
              }
              const next = setNotePitch(score, itemId, noteId, newPitch);
              commitScore(next, false);
              auditionPitchOnOrgan(newPitch, clef);
            }}
            onUpdateLyric={(itemId, lyric, wordEnd) => {
              const updated = updateSyllableText(score, itemId, lyric, wordEnd);
              if (lyric.trim() === '') {
                const mergedRes = mergeEmptySyllableIntoPrevious(updated, itemId, selection);
                if (mergedRes.merged) {
                  commitScore(mergedRes.nextScore);
                  selectionAnchorNoteIdRef.current = mergedRes.nextSelection?.noteId || null;
                  setSelection(mergedRes.nextSelection);
                  return;
                }
              }
              commitScore(updated);
            }}
            onUpdateHeader={(patch) => {
              commitScore(updateHeader(score, patch));
            }}
            onCreateBlankSyllable={handleAppendBlankSyllable}
            toneLink={activeToneLink}
            showPhraseControls={showPhraseControls}
            onSelectPhraseCadence={toneController?.selectPhraseCadence}
            onJoinPhrases={toneController?.joinPhrases}
            onSplitMergedPhrase={toneController?.splitMergedPhrase}
            onRestoreBreak={toneController?.restoreBreak}
            onToggleExtraBreak={toneController?.toggleExtraBreak}
          />
        }
        gabcEditor={
          <GabcEditor
            syncedGabc={liveGabc}
            highlightedRange={highlightedGabcRange}
            width={gabcWidth}
            language={language}
            onChangeLanguage={setLanguage}
            onGabcEdited={handleDirectGabcEdit}
            onCursorOffsetChange={handleGabcCursorSync}
            onClosePanel={() => setWorkspaceMode('notation')}
          />
        }
      />

      {tonesRequested && (
        <React.Suspense fallback={null}>
          <LazyToneStateBridge
            language={language}
            onChangeLanguage={setLanguage}
            onCommitToneGabc={handleCommitToneGabc}
            onControllerChange={setToneController}
          />
        </React.Suspense>
      )}

      <ScoreLibraryModal
        open={libraryOpen}
        entries={libraryEntries}
        activeScoreId={activeScoreId}
        lastBackupAt={backupMeta.lastBackupAt}
        pendingRestore={pendingRestore}
        onClose={() => {
          setPendingRestore(null);
          setLibraryOpen(false);
        }}
        onOpenScore={(id) => void handleOpenLibraryScore(id)}
        onNewScore={handleNewScore}
        onDuplicateScore={(id) => void handleDuplicateLibraryScore(id)}
        onRenameScore={(id, name) => void handleRenameLibraryScore(id, name)}
        onDeleteScore={(id) => void handleDeleteLibraryScore(id)}
        onBackupAll={() => void handleBackupAll()}
        onSelectRestoreFile={(file) => void handleSelectRestoreFile(file)}
        onConfirmRestore={(mode) => void handleConfirmRestore(mode)}
        onCancelRestore={() => setPendingRestore(null)}
      />

      {confirmDialog && (
        <div
          className="no-print fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-dialog-title"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              confirmDialog.onCancel?.();
            }
          }}
        >
          <div className="w-full max-w-sm rounded-md border border-[#CFC3AE] bg-[#FAF6EE] p-4 shadow-xl text-[#1D1915]">
            <h2
              id="confirm-dialog-title"
              className="font-[family-name:var(--font-display)] text-sm font-semibold text-[#8B1E24]"
            >
              {confirmDialog.title}
            </h2>
            <p className="mt-1.5 text-xs leading-relaxed text-[#4F473E]">
              {confirmDialog.message}
            </p>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => confirmDialog.onCancel?.()}
                className="h-8 rounded border border-[#CFC3AE] bg-[#F5EFE4] px-3 text-xs font-medium text-[#1D1915] hover:bg-white"
              >
                Cancel
              </button>
              <button
                type="button"
                autoFocus
                onClick={confirmDialog.onConfirm}
                className="h-8 rounded border border-[#72171B] bg-[#8B1E24] px-3 text-xs font-semibold text-[#FAF6EE] hover:bg-[#A1252B]"
              >
                {confirmDialog.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
