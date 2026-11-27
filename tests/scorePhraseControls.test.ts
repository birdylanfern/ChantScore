import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseGabc } from '@/src/lib/gabc/parser';
import { serializeGabcWithMap } from '@/src/lib/gabc/sourceMap';
import { validateGabc } from '@/src/lib/gabc/validator';
import { buildPrefaceTone, buildReadingTone } from '@/src/lib/tones/readingTones';
import {
  extractReadingPhrases,
  hashGabc,
  joinPhraseBreak,
  migrateIndexOverridesToEndWord,
  pointReading,
  prunePhraseBreakKeys,
  restoreMergedBreakKey,
  splitMergedPhraseBreaks,
  toggleExtraBreakKey,
} from '@/src/lib/tones/pointing';
import { assemblePreface, splitPreface } from '@/src/lib/tones/prefaceSplit';
import { SEED_PREFACE_TEMPLATES } from '@/src/lib/tones/prefaceTemplates';
import { layoutSystemPhraseMarkers, ScoreCanvas } from '@/src/components/ScoreCanvas';
import { PSALM_TONES, ToneController, ToneDockPanel } from '@/src/components/TonePanel';
import { buildPsalmTone } from '@/src/lib/tones/psalmTones';
import { toneToDefinition } from '@/src/lib/tones/tone';
import { ensureEnglishHyphenation } from '@/src/lib/text/englishSyllabify';
import { ChantScore, PhraseBreakKey, ToneLink, TonePhraseLinkItem } from '@/src/types/chant';

await ensureEnglishHyphenation();

function resolveToneLinkFromScore(
  score: ChantScore,
  mode: 'reading' | 'preface',
  isEnglishPreface: boolean,
  hasQuestionCadence: boolean,
  phrases: TonePhraseLinkItem[]
): ToneLink {
  const { gabc: serialized, spans } = serializeGabcWithMap(score);
  const syllableItems = score.items
    .map((item, idx) => ({ item, idx }))
    .filter((x) => x.item.kind === 'syllable');

  const spanByItemId = new Map<string, { start: number; end: number }>();
  for (const sp of spans) {
    const cur = spanByItemId.get(sp.itemId);
    if (!cur) spanByItemId.set(sp.itemId, { start: sp.start, end: sp.end });
    else {
      cur.start = Math.min(cur.start, sp.start);
      cur.end = Math.max(cur.end, sp.end);
    }
  }

  const resolvedPhrases = phrases.map((ph) => {
    const first = syllableItems[ph.firstSyllableIndex];
    const last = syllableItems[ph.lastSyllableIndex];
    const nextItem = last ? score.items[last.idx + 1] : undefined;
    const endDivisionItemId = nextItem?.kind === 'division' ? nextItem.id : undefined;
    const endItemId = endDivisionItemId || last?.item.id || '';
    const firstSpan = first ? spanByItemId.get(first.item.id) : undefined;
    const endSpan = endItemId ? spanByItemId.get(endItemId) : undefined;
    return {
      ...ph,
      firstSyllableItemId: first?.item.id ?? '',
      lastSyllableItemId: last?.item.id ?? '',
      endDivisionItemId,
      endItemId,
      sourceStart: firstSpan?.start ?? ph.sourceStart,
      sourceEnd: endSpan?.end ?? ph.sourceEnd,
      endAnchorOffset: endSpan?.start ?? ph.endAnchorOffset,
    };
  });

  return {
    gabcHash: hashGabc(serialized),
    mode,
    isEnglishPreface,
    hasQuestionCadence,
    phrases: resolvedPhrases,
  };
}

function makeMockController(overrides: Partial<ToneController> = {}): ToneController {
  const noop = () => {};
  const def = toneToDefinition(buildReadingTone('epistle')!);
  return {
    saved: {
      mode: 'reading',
      definition: def,
      repeatIntonation: false,
      autoFlex: false,
      gloriaPatri: false,
      psalmTone: PSALM_TONES[0].id,
      psalmEnding: PSALM_TONES[0].endings[0],
      psalmSolemn: false,
      readingTone: 'epistle',
      readingOpeningFormula: '',
      readingOpeningFormulaTouched: true,
      prefaceTone: 'preface-solemn',
      prefaceLineBreaksAsPhrases: { la: false, en: true },
      autoJoinShortPhrasesReading: 3,
      autoJoinShortPhrasesPreface: 3,
      mergedBreaks: [],
      forcedBreaks: [],
      extraBreaks: [],
    },
    builtInOrigin: { kind: 'reading', id: 'epistle', definition: def },
    text: 'Prima pars, secúnda pars; tértia pars.',
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

test('phrase map emits aligned syllable indices & source spans for reading (with opening formula) and preface (Latin & English)', () => {
  const epistle = buildReadingTone('epistle')!;
  const readingRes = pointReading('Dóminus dixit ad me, Fílius meus es tu.', epistle, {
    language: 'la',
    openingFormula: 'Fratres,',
  });
  assert.ok(readingRes.phrases && readingRes.phrases.length === 3);
  const readingScore = parseGabc(readingRes.gabc);
  const readingSyllables = readingScore.items.filter((i) => i.kind === 'syllable');
  assert.equal(readingRes.phrases[0].isOpeningFormula, true);
  assert.equal(readingRes.phrases[0].canJoinNext, false);
  assert.equal(readingRes.phrases[1].canJoinPrev, false);
  assert.equal(readingRes.phrases[0].firstSyllableIndex, 0);
  assert.equal(
    readingRes.phrases[readingRes.phrases.length - 1].lastSyllableIndex,
    readingSyllables.length - 1
  );
  for (let i = 1; i < readingRes.phrases.length; i++) {
    assert.equal(
      readingRes.phrases[i].firstSyllableIndex,
      readingRes.phrases[i - 1].lastSyllableIndex + 1
    );
    assert.ok(readingRes.phrases[i].sourceStart >= readingRes.phrases[i - 1].sourceStart);
  }

  const prefaceTone = buildPrefaceTone('preface-solemn')!;
  const laPrefaceText =
    'Vere dignum et iustum est, æquum et salutáre, nos tibi semper et ubíque grátias ágere: Dómine sancte, Pater omnípotens, ætérne Deus: per Christum Dóminum nostrum.\n\nQui, primo advéntu; Secúnda pars.\n\nEt ídeo cum Ángelis et Archángelis, cum Thronis et Dominatiónibus, cumque omni milítia cæléstis exércitus, hymnum glóriæ tuæ cánimus, sine fine dicéntes.';
  const laSplit = splitPreface(laPrefaceText, {
    language: 'la',
    tone: prefaceTone,
    templates: SEED_PREFACE_TEMPLATES,
    autoJoinShortPhrases: 0,
  });
  const laAssembled = assemblePreface(laSplit, prefaceTone, { language: 'la' });
  assert.equal(validateGabc(laAssembled.gabc).valid, true);
  assert.equal(laAssembled.phrases.length, 3);
  const laScore = parseGabc(laAssembled.gabc);
  const laLink = resolveToneLinkFromScore(laScore, 'preface', false, false, laAssembled.phrases);
  assert.ok(laLink.phrases.every((ph) => ph.firstSyllableItemId && ph.lastSyllableItemId && ph.endDivisionItemId));
});

test('joining and splitting phrases updates cadences, bars, endWordIndex overrides, and refuses paragraph/opening/closing joins', () => {
  const epistle = buildReadingTone('epistle')!;
  const text = 'Prima pars, secúnda pars; tértia pars.\n\nQuarta pars.';
  const basePhrases = extractReadingPhrases(text, epistle, { language: 'la', autoJoinShortPhrases: 0 });
  assert.equal(basePhrases.length, 4);
  assert.equal(basePhrases[0].endWordIndex, 1);
  assert.equal(basePhrases[1].endWordIndex, 3);

  // Key overrides by endWordIndex: earlier piece override is dropped when merged, last piece override is kept
  const joinRes = joinPhraseBreak({
    phrases: basePhrases,
    targetPhraseEndWordIndex: basePhrases[0].endWordIndex,
    direction: 'next',
    mergedBreaks: [],
    extraBreaks: [],
    cadenceOverrides: {
      [basePhrases[0].endWordIndex]: 'punctum',
      [basePhrases[1].endWordIndex]: 'punctum',
    },
  });
  assert.equal(joinRes.changed, true);
  assert.deepEqual(joinRes.mergedBreaks, [{ endWordIndex: 1, wordText: 'pars,' }]);
  assert.deepEqual(joinRes.cadenceOverrides, { [basePhrases[1].endWordIndex]: 'punctum' });

  const mergedPhrases = extractReadingPhrases(text, epistle, {
    language: 'la',
    mergedBreaks: joinRes.mergedBreaks,
    autoJoinShortPhrases: 0,
  });
  assert.equal(mergedPhrases.length, 3);
  assert.equal(mergedPhrases[0].text, 'Prima pars, secúnda pars;');
  assert.equal(mergedPhrases[0].defaultKind, 'metrum');
  assert.equal(mergedPhrases[0].startsPhrase, true);
  assert.equal(mergedPhrases[0].merged, true);
  assert.equal(mergedPhrases[0].mergedFrom, 2);

  // Split merged phrase restores all pieces
  const splitMerged = splitMergedPhraseBreaks(mergedPhrases[0], joinRes.mergedBreaks);
  assert.deepEqual(splitMerged, []);

  // Restore individual break
  const restoredOne = restoreMergedBreakKey(joinRes.mergedBreaks, { endWordIndex: 1, wordText: 'pars,' });
  assert.deepEqual(restoredOne, []);

  // Refuses join across blank-line paragraph break in English preface lines mode
  const prefaceTone = buildPrefaceTone('preface-solemn')!;
  const enSplit = splitPreface('First line of body,\nsecond line of body.\n\nNew paragraph line.', {
    language: 'en',
    tone: prefaceTone,
    templates: SEED_PREFACE_TEMPLATES,
    treatLineBreaksAsPhraseBreaks: true,
  });
  const enBody = enSplit.parts.find((p) => p.kind === 'body')!.phrases!;
  assert.equal(enBody[1].canJoinNext, false);
  assert.equal(enBody[2].canJoinPrev, false);

  // Merging two preface body phrases avoids false template match on unmerged template
  const bodyJoin = joinPhraseBreak({
    phrases: enBody.map((p) => ({ ...p, words: p.wordTokens, startsPhrase: true })),
    targetPhraseEndWordIndex: enBody[0].endWordIndex,
    direction: 'next',
    mergedBreaks: [],
    extraBreaks: [],
  });
  assert.equal(bodyJoin.changed, true);
  const enMergedSplit = splitPreface('First line of body,\nsecond line of body.\n\nNew paragraph line.', {
    language: 'en',
    tone: prefaceTone,
    templates: SEED_PREFACE_TEMPLATES,
    mergedBreaks: bodyJoin.mergedBreaks,
    treatLineBreaksAsPhraseBreaks: true,
  });
  const enMergedBody = enMergedSplit.parts.find((p) => p.kind === 'body')!.phrases!;
  assert.equal(enMergedBody[0].status, 'generated');
  assert.equal(enMergedBody[0].merged, true);
});

test('extraBreaks split a phrase interiorly with left default none, and joining across removes extraBreak', () => {
  const gospel = buildReadingTone('gospel')!;
  const text = 'Domine Deus omnipotens, exaudi nos.';
  const words = text.split(/\s+/);
  const extraKey: PhraseBreakKey = { endWordIndex: 1, wordText: words[1] }; // after "Deus"
  const extraBreaks = toggleExtraBreakKey([], extraKey);
  const phrases = extractReadingPhrases(text, gospel, {
    language: 'la',
    extraBreaks,
  });
  assert.equal(phrases.length, 3);
  assert.equal(phrases[0].text, 'Domine Deus');
  assert.equal(phrases[0].defaultKind, null);
  assert.equal(phrases[0].choiceLabel, 'none');
  assert.equal(phrases[1].text, 'omnipotens,');
  assert.equal(phrases[1].defaultKind, 'flex');

  // Joining across extra break removes from extraBreaks instead of adding to mergedBreaks
  const rejoin = joinPhraseBreak({
    phrases,
    targetPhraseEndWordIndex: phrases[0].endWordIndex,
    direction: 'next',
    mergedBreaks: [],
    extraBreaks,
  });
  assert.equal(rejoin.changed, true);
  assert.deepEqual(rejoin.extraBreaks, []);
  assert.deepEqual(rejoin.mergedBreaks, []);
});

test('stale break pruning drops mismatched words cleanly and migrateIndexOverridesToEndWord preserves legacy overrides', () => {
  const words = ['Prima', 'pars', 'nova,', 'secúnda', 'pars.'];
  const pruned = prunePhraseBreakKeys(
    [
      { endWordIndex: 1, wordText: 'pars,' }, // stale (word at index 1 is 'pars' not 'pars,')
      { endWordIndex: 2, wordText: 'nova,' }, // matches
      { endWordIndex: 99, wordText: 'out' }, // out of range
    ],
    words
  );
  assert.deepEqual(pruned, [{ endWordIndex: 2, wordText: 'nova,' }]);

  const epistle = buildReadingTone('epistle')!;
  const basePhrases = extractReadingPhrases('Prima pars, secúnda pars; tértia pars.', epistle, {
    language: 'la',
    autoJoinShortPhrases: 0,
  });
  assert.deepEqual(migrateIndexOverridesToEndWord({ 0: 'metrum', 1: 'punctum' }, basePhrases), {
    1: 'metrum',
    3: 'punctum',
  });
});

test('layoutSystemPhraseMarkers compacts overlapping markers and maintains minimum gap within staff bounds', () => {
  const makePhrase = (endWordIndex: number, choiceLabel: TonePhraseLinkItem['choiceLabel']): TonePhraseLinkItem => ({
    index: endWordIndex,
    text: 'Word,',
    words: ['Word,'],
    startWordIndex: endWordIndex,
    endWordIndex,
    endWordText: 'Word,',
    defaultKind: 'flex',
    effectiveKind: 'flex',
    choiceLabel,
    overridden: false,
    merged: false,
    mergedFrom: 1,
    internalMergedBreaks: [],
    paragraphBreak: false,
    canJoinPrev: true,
    canJoinNext: true,
    sourceStart: 0,
    sourceEnd: 10,
    endAnchorOffset: 5,
    hasTrailingBar: true,
    firstSyllableIndex: endWordIndex,
    lastSyllableIndex: endWordIndex,
    firstSyllableItemId: `s${endWordIndex}`,
    lastSyllableItemId: `s${endWordIndex}`,
    endItemId: `s${endWordIndex}`,
  });

  // Widely spaced -> not compacted
  const wide = layoutSystemPhraseMarkers(
    [
      { phrase: makePhrase(1, 'flex'), pageIndex: 0, systemIndex: 0, anchorX: 160, bottomY: 100 },
      { phrase: makePhrase(3, 'metrum'), pageIndex: 0, systemIndex: 0, anchorX: 460, bottomY: 100 },
    ],
    80,
    720
  );
  assert.equal(wide[0].compact, false);
  assert.equal(wide[1].compact, false);

  // Crowded -> compacted and strictly non-overlapping with >= 3px gap inside [80, 720]
  const crowded = layoutSystemPhraseMarkers(
    [
      { phrase: makePhrase(1, 'flex'), pageIndex: 0, systemIndex: 0, anchorX: 200, bottomY: 100 },
      { phrase: makePhrase(2, 'metrum'), pageIndex: 0, systemIndex: 0, anchorX: 215, bottomY: 100 },
      { phrase: makePhrase(3, 'long'), pageIndex: 0, systemIndex: 0, anchorX: 230, bottomY: 100 },
    ],
    80,
    720
  );
  assert.ok(crowded.every((m) => m.compact));
  for (let i = 0; i < crowded.length; i++) {
    const left = crowded[i].centerX - crowded[i].width / 2;
    const right = crowded[i].centerX + crowded[i].width / 2;
    assert.ok(left >= 80 && right <= 720, 'marker fits within staff bounds');
    if (i > 0) {
      const prevRight = crowded[i - 1].centerX + crowded[i - 1].width / 2;
      assert.ok(left - prevRight >= 2.99, `expected >= 3px gap, got ${left - prevRight}`);
    }
  }
});

test('ScoreCanvas & ToneDockPanel UI: renders phrase controls only for valid unedited reading/preface link, collapses phrase list, hides when toggled off or in psalm', () => {
  const epistle = buildReadingTone('epistle')!;
  const sampleText = 'Prima pars nostri textus, secúnda pars huius textus; tértia pars totíus textus.';
  const res = pointReading(sampleText, epistle, { language: 'la' });
  const score = parseGabc(res.gabc);
  const toneLink = resolveToneLinkFromScore(
    score,
    'reading',
    false,
    true,
    res.phrases ?? []
  );

  const canvasProps = {
    score,
    selection: null,
    textSelection: null,
    playingNoteId: null,
    toolMode: 'select' as const,
    activePreset: null,
    draggingPayload: null,
    zoom: 1,
    scrollTargetItemId: null,
    onSelect: () => {},
    onSelectText: () => {},
    onDropOrStampNeume: () => {},
    onDropDivision: () => {},
    onDropClef: () => {},
    onDragNotePitch: () => {},
    onUpdateLyric: () => {},
    onUpdateHeader: () => {},
    onCreateBlankSyllable: () => {},
    onSelectPhraseCadence: () => {},
    onJoinPhrases: () => {},
  };

  // 1. Valid toneLink + showPhraseControls=true -> renders markers and join handles marked no-print
  const htmlWithControls = renderToStaticMarkup(
    React.createElement(ScoreCanvas, {
      ...canvasProps,
      toneLink,
      showPhraseControls: true,
    })
  );
  assert.ok(htmlWithControls.includes('data-phrase-marker='));
  assert.ok(htmlWithControls.includes('data-phrase-join-handle='));
  const markerMatches = htmlWithControls.match(/data-phrase-marker=/g) ?? [];
  assert.equal(markerMatches.length, 3);
  assert.ok(htmlWithControls.includes('no-print'));

  // 2. Pan mode hides score phrase overlays cleanly
  const htmlPan = renderToStaticMarkup(
    React.createElement(ScoreCanvas, {
      ...canvasProps,
      toneLink,
      showPhraseControls: true,
      panMode: true,
    })
  );
  assert.equal(htmlPan.includes('data-phrase-marker='), false);
  assert.equal(htmlPan.includes('data-phrase-join-handle='), false);

  // 3. showPhraseControls=false or toneLink=null hides all score phrase controls
  const htmlToggledOff = renderToStaticMarkup(
    React.createElement(ScoreCanvas, {
      ...canvasProps,
      toneLink,
      showPhraseControls: false,
    })
  );
  assert.equal(htmlToggledOff.includes('data-phrase-marker='), false);
  const htmlNoLink = renderToStaticMarkup(
    React.createElement(ScoreCanvas, {
      ...canvasProps,
      toneLink: null,
      showPhraseControls: true,
    })
  );
  assert.equal(htmlNoLink.includes('data-phrase-marker='), false);

  // 4. ToneDockPanel shows collapsed Phrase list (3) + Show phrase controls when valid, and stale Re-apply banner when diverged
  const controller = makeMockController({ text: sampleText });
  const dockValid = renderToStaticMarkup(
    React.createElement(ToneDockPanel, {
      controller,
      language: 'la',
      toneLinkValid: true,
      toneLinkStale: false,
      showPhraseControls: true,
      onToggleShowPhraseControls: () => {},
    })
  );
  assert.ok(dockValid.includes('Show phrase controls'));
  assert.ok(dockValid.includes('Phrase list (3)'));
  assert.ok(!dockValid.includes('Re-apply tone to enable them'));
  assert.ok(dockValid.includes('aria-expanded="false"'));
  assert.equal(dockValid.includes('Join prev'), false);

  const dockStale = renderToStaticMarkup(
    React.createElement(ToneDockPanel, {
      controller,
      language: 'la',
      toneLinkValid: false,
      toneLinkStale: true,
      showPhraseControls: true,
    })
  );
  assert.ok(dockStale.includes('Phrase controls are available only for the unedited tone output'));
  assert.ok(dockStale.includes('Re-apply'));
  assert.ok(dockStale.includes('aria-expanded="true"'));
  assert.ok(dockStale.includes('Join prev'));

  // 5. Psalm mode never shows phrase controls or stale banner
  const psalmDef = toneToDefinition(buildPsalmTone(PSALM_TONES[0].id, PSALM_TONES[0].endings[0])!);
  const psalmController = makeMockController({
    saved: {
      ...controller.saved,
      mode: 'psalm',
      definition: psalmDef,
    },
    builtInOrigin: {
      kind: 'psalm',
      id: PSALM_TONES[0].id,
      ending: PSALM_TONES[0].endings[0],
      solemn: false,
      definition: psalmDef,
    },
    text: 'Dixit Dóminus Dómino meo: * Sede a dextris meis.',
  });
  const dockPsalm = renderToStaticMarkup(
    React.createElement(ToneDockPanel, {
      controller: psalmController,
      language: 'la',
      toneLinkValid: false,
      toneLinkStale: false,
      showPhraseControls: true,
    })
  );
  assert.equal(dockPsalm.includes('Show phrase controls'), false);
  assert.equal(dockPsalm.includes('Phrase list ('), false);
  assert.equal(dockPsalm.includes('Auto-join short phrases'), false);

  // 6. Auto-join header control visibility & "auto" badges in Reading / Preface / English line-based Preface
  assert.ok(dockValid.includes('Auto-join short phrases'));
  const autoJoinedReading = 'Vere dignum et justum est, ǽquum et salutáre, nos tibi semper et ubíque grátias ágere: Dómine sancte Pater.';
  const ajRes = pointReading(autoJoinedReading, epistle, { language: 'la' });
  const ajScore = parseGabc(ajRes.gabc);
  const ajLink = resolveToneLinkFromScore(ajScore, 'reading', false, true, ajRes.phrases ?? []);
  assert.ok(ajLink.phrases.some((p) => p.autoJoined));
  const htmlAutoScore = renderToStaticMarkup(
    React.createElement(ScoreCanvas, {
      ...canvasProps,
      score: ajScore,
      toneLink: ajLink,
      showPhraseControls: true,
    })
  );
  assert.ok(htmlAutoScore.includes('auto'), 'ScoreCanvas marker displays auto indicator');
  assert.ok(htmlAutoScore.includes('auto-joined'), 'ScoreCanvas marker aria-label mentions auto-joined');

  const dockAutoList = renderToStaticMarkup(
    React.createElement(ToneDockPanel, {
      controller: makeMockController({ text: autoJoinedReading }),
      language: 'la',
      toneLinkValid: false,
      toneLinkStale: true,
      showPhraseControls: true,
    })
  );
  assert.ok(dockAutoList.includes('data-auto-joined-badge="true"'));

  const prefaceTone = buildPrefaceTone('preface-solemn')!;
  const prefaceLaDock = renderToStaticMarkup(
    React.createElement(ToneDockPanel, {
      controller: makeMockController({
        saved: {
          ...controller.saved,
          mode: 'preface',
          definition: toneToDefinition(prefaceTone),
        },
        builtInOrigin: {
          kind: 'preface',
          id: 'preface-solemn',
          definition: toneToDefinition(prefaceTone),
        },
        isPrefaceWorkflow: true,
      }),
      language: 'la',
      toneLinkValid: true,
      toneLinkStale: false,
      showPhraseControls: true,
    })
  );
  assert.ok(prefaceLaDock.includes('Auto-join short phrases'), 'Latin preface shows auto-join control');

  const prefaceEnLinesDock = renderToStaticMarkup(
    React.createElement(ToneDockPanel, {
      controller: makeMockController({
        saved: {
          ...controller.saved,
          mode: 'preface',
          definition: toneToDefinition(prefaceTone),
          prefaceLineBreaksAsPhrases: { la: false, en: true },
        },
        builtInOrigin: {
          kind: 'preface',
          id: 'preface-solemn',
          definition: toneToDefinition(prefaceTone),
        },
        isPrefaceWorkflow: true,
      }),
      language: 'en',
      toneLinkValid: true,
      toneLinkStale: false,
      showPhraseControls: true,
    })
  );
  assert.equal(
    prefaceEnLinesDock.includes('Auto-join short phrases'),
    false,
    'English line-based preface hides auto-join control'
  );
});
