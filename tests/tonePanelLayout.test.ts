import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StudioLayout } from '@/src/components/StudioLayout';
import { PSALM_TONES, ToneController, ToneDockPanel } from '@/src/components/TonePanel';
import { RibbonToolbar } from '@/src/components/RibbonToolbar';
import { createEmptyScore } from '@/src/lib/gabc/parser';
import { buildPsalmTone } from '@/src/lib/tones/psalmTones';
import { toneToDefinition } from '@/src/lib/tones/tone';
import {
  clampToneWidth,
  DEFAULT_PREFS,
  DEFAULT_TONE_WIDTH,
  loadWorkspacePrefs,
  resolveToneLayoutMode,
  saveWorkspacePrefs,
  TONE_MIN_WIDTH,
} from '@/src/lib/workspacePrefs';

function makeMockToneController(overrides: Partial<ToneController> = {}): ToneController {
  const noop = () => {};
  const sampleDef = toneToDefinition(buildPsalmTone(PSALM_TONES[0].id, PSALM_TONES[0].endings[0])!);
  return {
    saved: {
      mode: 'psalm',
      definition: sampleDef,
      repeatIntonation: true,
      autoFlex: false,
      gloriaPatri: false,
      psalmTone: PSALM_TONES[0].id,
      psalmEnding: PSALM_TONES[0].endings[0],
      psalmSolemn: false,
      readingTone: 'epistle',
      readingOpeningFormula: 'none',
      readingOpeningFormulaTouched: false,
      prefaceTone: 'preface-solemn',
      prefaceLineBreaksAsPhrases: { la: false, en: true },
      autoJoinShortPhrasesReading: 3,
      autoJoinShortPhrasesPreface: 3,
      mergedBreaks: [],
      forcedBreaks: [],
      extraBreaks: [],
    },
    builtInOrigin: {
      kind: 'psalm',
      id: '1g',
      ending: 'g',
      solemn: false,
      definition: sampleDef,
    },
    text: 'Dixit Dóminus Dómino meo: * Sede a dextris meis.',
    stressOverrides: {},
    cadenceOverrides: {},
    roleOverrides: {},
    mergedBreaks: [],
    forcedBreaks: [],
    extraBreaks: [],
    note: null,
    dockOpen: true,
    definitionOpen: false,
    editorTab: 'simple',
    selectedVulgatePsalm: '',
    isPrefaceWorkflow: false,
    prefaceSplit: null,
    assemblyChecklist: null,
    setDockOpen: noop,
    setDefinitionOpen: noop,
    setEditorTab: noop,
    setText: noop,
    importVulgatePsalm: async () => {},
    setMode: noop,
    update: noop,
    loadPsalmTone: noop,
    loadReadingTone: noop,
    setReadingOpeningFormula: noop,
    loadPrefaceTone: noop,
    resetToBuiltIn: noop,
    toggleSyllableStress: noop,
    toggleWordStress: noop,
    resetStressOverrides: noop,
    selectPhraseCadence: noop,
    restorePhraseTemplate: noop,
    setPhraseRole: noop,
    setPrefaceLineBreaksAsPhrases: noop,
    resetCadenceOverrides: noop,
    joinPhrases: noop,
    splitMergedPhrase: noop,
    restoreBreak: noop,
    toggleExtraBreak: noop,
    resetPhrases: noop,
    reapplyTone: noop,
    setPartRawGabc: noop,
    setPhraseRawGabc: noop,
    saveAsPrefaceTemplate: noop,
    exportPrefaceTemplates: noop,
    importPrefaceTemplatesFile: noop,
    ...overrides,
  };
}

function renderLayout(opts: {
  width: number;
  toneLayoutMode?: 'side' | 'below' | null;
  toneWidth?: number;
  showTonePanel?: boolean;
  tonePanelActive?: boolean;
  isFullscreen?: boolean;
  controller?: ToneController;
}) {
  const controller = opts.controller ?? makeMockToneController();
  const resolvedMode = resolveToneLayoutMode(opts.toneLayoutMode ?? null, opts.width);
  const resolvedWidth = clampToneWidth(opts.toneWidth ?? DEFAULT_TONE_WIDTH, opts.width);

  return renderToStaticMarkup(
    React.createElement(StudioLayout, {
      workspaceMode: 'notation',
      isFullscreen: opts.isFullscreen ?? false,
      gabcWidth: 380,
      toneLayoutMode: resolvedMode,
      toneWidth: resolvedWidth,
      containerWidthOverride: opts.width,
      showTonePanel: opts.showTonePanel ?? true,
      tonePanelActive: opts.tonePanelActive ?? true,
      onSetWorkspaceMode: () => {},
      onChangeGabcWidth: () => {},
      onChangeToneWidth: () => {},
      onExpandTonePanel: () => {},
      onFileDrop: () => {},
      ribbon: React.createElement('header', { 'data-testid': 'mock-ribbon' }, 'Ribbon'),
      workspace: React.createElement('main', { 'data-testid': 'mock-workspace' }, 'ScoreCanvas'),
      gabcEditor: React.createElement('section', { 'data-testid': 'mock-gabc' }, 'GABC'),
      tonePanel: React.createElement(ToneDockPanel, {
        controller,
        language: 'la',
        layoutMode: resolvedMode,
        panelWidth: resolvedWidth,
        onToggleLayoutMode: () => {},
        onCollapse: () => {},
      }),
    })
  );
}

test('StudioLayout places ToneDockPanel on the right at 1400px with single-column inner grid', () => {
  const html = renderLayout({ width: 1400 });

  assert.ok(html.includes('data-testid="tone-panel-side"'));
  assert.ok(!html.includes('data-testid="tone-panel-below"'));
  assert.ok(html.includes('data-tone-layout-mode="side"'));

  // Side panel appears after the score workspace in DOM order
  const workspaceIdx = html.indexOf('data-testid="mock-workspace"');
  const sideIdx = html.indexOf('data-testid="tone-panel-side"');
  assert.ok(workspaceIdx !== -1 && sideIdx > workspaceIdx);

  // Sticky header, overflow-y-auto, no max-h-[38vh] or border-t on ToneDockPanel
  assert.ok(html.includes('sticky top-0'));
  assert.ok(html.includes('overflow-y-auto'));
  assert.ok(!html.includes('max-h-[38vh]'));
  assert.ok(!html.includes('lg:grid-cols-2'));
  assert.ok(!html.includes('grid-cols-2'));
});

test('StudioLayout places ToneDockPanel below the ribbon at 900px with size cap and two-column grid', () => {
  const html = renderLayout({ width: 900 });

  assert.ok(html.includes('data-testid="tone-panel-below"'));
  assert.ok(!html.includes('data-testid="tone-panel-side"'));
  assert.ok(html.includes('data-tone-layout-mode="below"'));
  assert.ok(html.includes('max-h-[38vh]'));
  assert.ok(html.includes('lg:grid-cols-2'));

  // Below panel appears after ribbon and before workspace
  const ribbonIdx = html.indexOf('data-testid="mock-ribbon"');
  const belowIdx = html.indexOf('data-testid="tone-panel-below"');
  const workspaceIdx = html.indexOf('data-testid="mock-workspace"');
  assert.ok(ribbonIdx < belowIdx && belowIdx < workspaceIdx);
});

test('ToneDockPanel switches to two columns in side mode when wider than 720px', () => {
  const html = renderLayout({ width: 1400, toneWidth: 760 });
  assert.ok(html.includes('data-testid="tone-panel-side"'));
  assert.ok(html.includes('width:760px'));
  assert.ok(html.includes('grid-cols-2'));
});

test('RibbonToolbar does not render ToneDockPanel internally while keeping Hide/Show text toggle', () => {
  const noop = () => {};
  const html = renderToStaticMarkup(
    React.createElement(RibbonToolbar, {
      activeTab: 'tones',
      collapsed: false,
      workspaceMode: 'notation',
      saveStatus: 'saved',
      score: createEmptyScore(),
      selection: null,
      textSelection: null,
      toolMode: 'insert',
      activePreset: 'punctum',
      activeModifiers: {
        mora: false,
        episemaH: false,
        episemaV: false,
        flat: false,
        natural: false,
        liquescent: false,
      },
      canUndo: false,
      canRedo: false,
      clipboard: null,
      isPlaying: false,
      isPaused: false,
      elapsedSec: 0,
      totalDurationSec: 0,
      activeNoteLabel: null,
      organ: 'cathedral',
      tempoBpm: 140,
      transpose: 0,
      volume: 0.8,
      muted: false,
      language: 'la',
      toneController: makeMockToneController({ dockOpen: true }),
      busyExport: null,
      exportStyle: 'illuminated',
      transparentPng: false,
      onSelectTab: noop,
      onToggleCollapse: noop,
      onSetWorkspaceMode: noop,
      onSetToolMode: noop,
      onSelectPreset: noop,
      onStartDrag: noop,
      onEndDrag: noop,
      onUndo: noop,
      onRedo: noop,
      onCopy: noop,
      onPaste: noop,
      onNewScore: noop,
      onDeleteSelection: noop,
      onShiftPitch: noop,
      onToggleModifier: noop,
      onSetLiquescentDir: noop,
      onSplitGroup: noop,
      onMergeGroup: noop,
      onInsertDivision: noop,
      onSelectClef: noop,
      onInsertLineBreak: noop,
      onUpdateLyric: noop,
      onAssignSyllableToNote: noop,
      onCommitEmptySyllable: noop,
      onShiftSyllableLyric: noop,
      onPlay: noop,
      onPause: noop,
      onStop: noop,
      onSeek: noop,
      onPlayFromSelection: noop,
      onChangeOrgan: noop,
      onChangeTempo: noop,
      onChangeTranspose: noop,
      onChangeVolume: noop,
      onToggleMute: noop,
      onChangeLanguage: noop,
      onExport: noop,
      onChangeExportStyle: noop,
      onToggleTransparentPng: noop,
      onPrint: noop,
      onToggleDropCap: noop,
      onChangeTypography: noop,
      onChangePageSetup: noop,
      onApplyTextColor: noop,
      onApplyVowelAccent: noop,
      onSelectText: noop,
      onClearTextSelection: noop,
    })
  );

  assert.ok(html.includes('Hide text'));
  assert.ok(html.includes('aria-expanded="true"'));
  assert.ok(!html.includes('Tone text and definition workspace'));
  assert.ok(!html.includes('data-tone-layout-mode'));
});

test('workspacePrefs restores saved toneLayoutMode and toneWidth across reloads and clamps splitter bounds', () => {
  const prevDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
      clear: () => store.clear(),
    },
  });

  try {
    assert.equal(loadWorkspacePrefs().toneLayoutMode, null);
    assert.equal(loadWorkspacePrefs().toneWidth, DEFAULT_TONE_WIDTH);
    assert.equal(resolveToneLayoutMode(null, 1400), 'side');
    assert.equal(resolveToneLayoutMode(null, 900), 'below');

    // User switches to 'below' even on a 1400px screen and sets width 540
    saveWorkspacePrefs({
      ...DEFAULT_PREFS,
      toneLayoutMode: 'below',
      toneWidth: 540,
    });
    const reloaded = loadWorkspacePrefs();
    assert.equal(reloaded.toneLayoutMode, 'below');
    assert.equal(reloaded.toneWidth, 540);
    assert.equal(resolveToneLayoutMode(reloaded.toneLayoutMode, 1400), 'below');

    const htmlAt1400 = renderLayout({
      width: 1400,
      toneLayoutMode: reloaded.toneLayoutMode,
      toneWidth: reloaded.toneWidth,
    });
    assert.ok(htmlAt1400.includes('data-testid="tone-panel-below"'));

    // Splitter width clamping: min 340, max 60% of container
    assert.equal(clampToneWidth(200, 1400), TONE_MIN_WIDTH);
    assert.equal(clampToneWidth(1200, 1400), Math.floor(1400 * 0.6));

    // Width survives collapse -> expand cycle
    const collapsedHtml = renderLayout({
      width: 1400,
      toneLayoutMode: 'side',
      toneWidth: reloaded.toneWidth,
      showTonePanel: false,
      tonePanelActive: true,
    });
    assert.ok(!collapsedHtml.includes('data-testid="tone-panel-side"'));
    assert.ok(collapsedHtml.includes('data-testid="tone-panel-expand-rail"'));

    const expandedHtml = renderLayout({
      width: 1400,
      toneLayoutMode: 'side',
      toneWidth: reloaded.toneWidth,
      showTonePanel: true,
      tonePanelActive: true,
    });
    assert.ok(expandedHtml.includes('width:540px'));
  } finally {
    if (prevDescriptor) {
      Object.defineProperty(globalThis, 'localStorage', prevDescriptor);
    } else {
      delete (globalThis as Record<string, unknown>).localStorage;
    }
  }
});

test('StudioLayout overlays ToneDockPanel on the right in fullscreen mode', () => {
  const html = renderLayout({
    width: 1400,
    isFullscreen: true,
    showTonePanel: true,
  });

  assert.ok(html.includes('data-testid="tone-panel-fullscreen"'));
  assert.ok(!html.includes('data-testid="mock-ribbon"'));
});
