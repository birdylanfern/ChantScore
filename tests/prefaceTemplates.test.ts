import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { validateGabc } from '@/src/lib/gabc/validator';
import { buildPrefaceTone } from '@/src/lib/tones/readingTones';
import {
  assemblePreface,
  remapBodyPhraseOverrides,
  splitPreface,
} from '@/src/lib/tones/prefaceSplit';
import { compareGabc } from '@/src/lib/tones/compareGabc';
import {
  computeWordDiff,
  deletePrefaceTemplate,
  exportPrefaceTemplatesJson,
  getPrefaceTemplateStatus,
  importPrefaceTemplatesJson,
  loadPrefaceTemplates,
  markPrefaceTemplateVerified,
  matchPrefaceTemplate,
  normalizePrefaceText,
  PREFACE_TEMPLATES_STORAGE_KEY,
  restoreDefaultPrefaceTemplates,
  saveCorrectedPrefaceTemplate,
  SEED_PREFACE_TEMPLATES,
} from '@/src/lib/tones/prefaceTemplates';
import { applyPhraseCadenceChoiceOverride } from '@/src/lib/tones/toneUi';
import { ensureEnglishHyphenation } from '@/src/lib/text/englishSyllabify';

await ensureEnglishHyphenation();

const LATIN_ADVENT_PREFACE =
  'Vere dignum et iustum est, æquum et salutáre; nos tibi semper et ubíque, grátias ágere; Dómine, sancte Pater, omnípotens ætérne Deus; per Christum Dóminum nostrum. Qui, primo advéntu in humilitáte carnis assúmptæ; dispositiónis antíquæ munus implévit; nobísque salútis perpétuæ trámitem reserávit. ut, cum secúndo vénerit in suæ glória maiestátis; manifésto demum múnere capiámus; quod vigilántes, nunc audémus exspectáre promíssum. Et ídeo, cum Angelis et Archángelis; cum Thronis et Dominationibus; cumque omni milítia cæléstis exércitus; hymnum glóriæ tuæ cánimus; sine fine dicéntes.';

const ENGLISH_ADVENT_PREFACE = `It is truly right and just, our duty and our salvation,
always and everywhere to give you thanks,
Lord, holy Father, almighty and eternal God,
through Christ our Lord.

For he assumed at his first coming
the lowliness of human flesh,
and so fulfilled the design you formed long ago,
and opened for us the way to eternal salvation,
that, when he comes again in glory and majesty
and all is at last made manifest,
we who watch for that day
may inherit the great promise
in which now we dare to hope.

And so, with Angels and Archangels,
with Thrones and Dominions,
and with all the hosts and Powers of heaven,
we sing the hymn of your glory,
as without end we acclaim:`;

function withMockLocalStorage(fn: () => void) {
  const store = new Map<string, string>();
  const prev = (globalThis as unknown as { localStorage?: Storage }).localStorage;
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (k: string) => store.get(k) ?? null,
    key: (i: number) => [...store.keys()][i] ?? null,
    removeItem: (k: string) => {
      store.delete(k);
    },
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
  };
  try {
    fn();
  } finally {
    if (prev === undefined) {
      delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
    } else {
      (globalThis as unknown as { localStorage: Storage }).localStorage = prev;
    }
  }
}

test('Latin fixture: finds verified opening & closing templates, matches verbatim, whole preface <= 9 syllable diffs', () => {
  const tone = buildPrefaceTone('preface-solemn')!;
  const split = splitPreface(LATIN_ADVENT_PREFACE, {
    language: 'la',
    tone,
    templates: SEED_PREFACE_TEMPLATES,
    autoJoinShortPhrases: 0,
  });

  const opening = split.parts.find((p) => p.kind === 'opening')!;
  const body = split.parts.find((p) => p.kind === 'body')!;
  const closing = split.parts.find((p) => p.kind === 'closing')!;

  assert.equal(opening.status, 'template-verified');
  assert.equal(closing.status, 'template-verified');
  assert.equal(body.status, 'generated');
  assert.equal(body.phrases?.length, 9);

  const assembled = assemblePreface(split, tone, { language: 'la' });
  assert.equal(validateGabc(assembled.gabc).valid, true);
  assert.equal(assembled.checklist.everyTemplateUsedVerbatim, true);
  assert.equal(assembled.checklist.unverifiedTemplateCount, 0);
  assert.equal(assembled.checklist.everyPhraseHasCadence, true);

  // Fixture opening (lines 1-6) and closing (lines 13-17) appear verbatim in assembled output
  const refRaw = fs.readFileSync('tests/fixtures/preface-advent-la/expected.gabc', 'utf8').trim();
  const refLines = refRaw.split('\n').map((l) => l.trim());
  const refOpening = refLines.slice(0, 6).join('\n');
  const refClosingCore = refLines.slice(12, 17).join('\n').replace(/\s*\(::\)\s*$/, '').trim();
  assert.ok(assembled.gabc.includes(refOpening), 'Latin opening matches fixture verbatim');
  assert.ok(assembled.gabc.includes(refClosingCore), 'Latin closing matches fixture verbatim');

  const cmp = compareGabc(assembled.gabc, refRaw);
  assert.equal(cmp.totals.generatedSyllables, cmp.totals.expectedSyllables);
  assert.equal(cmp.totals.expectedSyllables, 205);
  assert.ok(
    cmp.totals.pitchMismatches <= 9,
    `expected <= 9 syllable pitch diffs, got ${cmp.totals.pitchMismatches}`
  );

  // Under default N=3 auto-join, Opening & Closing stay verbatim while short body clauses ("Qui,", "ut,", "quod vigilántes,") auto-join
  const splitN3 = splitPreface(LATIN_ADVENT_PREFACE, {
    language: 'la',
    tone,
    templates: SEED_PREFACE_TEMPLATES,
  });
  const openingN3 = splitN3.parts.find((p) => p.kind === 'opening')!;
  const bodyN3 = splitN3.parts.find((p) => p.kind === 'body')!;
  const closingN3 = splitN3.parts.find((p) => p.kind === 'closing')!;
  assert.equal(openingN3.gabc, opening.gabc);
  assert.equal(closingN3.gabc, closing.gabc);
  assert.equal(bodyN3.phrases?.length, 6);
  assert.equal(bodyN3.phrases!.filter((p) => p.autoJoined).length, 3);
});

test('English Advent I fixture: Opening (needs review), 9-line Body, and Closing (needs review)', () => {
  const tone = buildPrefaceTone('preface-solemn')!;
  const split = splitPreface(ENGLISH_ADVENT_PREFACE, {
    language: 'en',
    tone,
    templates: SEED_PREFACE_TEMPLATES,
  });

  assert.deepEqual(
    split.parts.map((p) => p.kind),
    ['opening', 'body', 'closing']
  );

  const opening = split.parts.find((p) => p.kind === 'opening')!;
  const body = split.parts.find((p) => p.kind === 'body')!;
  const closing = split.parts.find((p) => p.kind === 'closing')!;

  assert.equal(opening.status, 'template-needs-review');
  assert.equal(closing.status, 'template-needs-review');
  assert.equal(body.status, 'generated');
  assert.equal(body.phrases?.length, 9);
  assert.ok(body.phrases![0].text.startsWith('For he assumed'));
  assert.ok(body.phrases![8].text.endsWith('dare to hope.'));

  const assembled = assemblePreface(split, tone, { language: 'en' });
  assert.equal(validateGabc(assembled.gabc).valid, true);
  assert.equal(assembled.checklist.everyPhraseHasCadence, true);
  assert.equal(assembled.checklist.noFinalFunctionWordAccent, true);
  assert.equal(assembled.checklist.everyTemplateUsedVerbatim, true);
  assert.equal(assembled.checklist.unverifiedTemplateCount, 2);
});

test('Body phrase template matches "through Christ our Lord." verbatim', () => {
  const tone = buildPrefaceTone('preface-solemn')!;
  const withBodyPhrase = `It is truly right and just, our duty and our salvation,
always and everywhere to give you thanks,
Lord, holy Father, almighty and eternal God,
through Christ our Lord.

For by his glorious birth he renewed our fallen nature,
through Christ our Lord.

And so, with Angels and Archangels,
with Thrones and Dominions,
and with all the hosts and Powers of heaven,
we sing the hymn of your glory,
as without end we acclaim:`;

  const split = splitPreface(withBodyPhrase, {
    language: 'en',
    tone,
    templates: SEED_PREFACE_TEMPLATES,
  });
  const body = split.parts.find((p) => p.kind === 'body')!;
  assert.equal(body.phrases?.length, 2);
  assert.equal(body.phrases![1].status, 'template-needs-review');
  assert.equal(body.phrases![1].gabc, 'through(g) Christ(fe) our(g) Lord.(fgf) (:)');
});

test('Opening without "through Christ our Lord." picks verified en-opening-solemn-short; altered wording still fuzzy-matches', () => {
  const tone = buildPrefaceTone('preface-solemn')!;
  const textWithoutThroughChrist = `It is truly right and just, our duty and our salvation,
always and everywhere to give you thanks,
Lord, holy Father, almighty and eternal God.

For he assumed at his first coming
in which now we dare to hope.`;

  const split = splitPreface(textWithoutThroughChrist, {
    language: 'en',
    tone,
    templates: SEED_PREFACE_TEMPLATES,
  });

  const opening = split.parts.find((p) => p.kind === 'opening')!;
  assert.equal(opening.matchedTemplateId, 'en-opening-solemn-short');
  assert.equal(opening.status, 'template-verified');
  assert.equal(opening.flagged, false);

  // When only the long template is present, omitting "through Christ our Lord." triggers the fuzzy flag
  const onlyLongTemplates = SEED_PREFACE_TEMPLATES.filter((t) => t.id !== 'en-opening-solemn-short');
  const fuzzySplit = splitPreface(textWithoutThroughChrist, {
    language: 'en',
    tone,
    templates: onlyLongTemplates,
  });
  const fuzzyOpening = fuzzySplit.parts.find((p) => p.kind === 'opening')!;
  assert.equal(fuzzyOpening.matchedTemplateId, 'en-opening-solemn');
  assert.equal(fuzzyOpening.flagged, true);
  assert.match(fuzzyOpening.flagReason ?? '', /through Christ our Lord/i);
  assert.ok(fuzzyOpening.diff && fuzzyOpening.diff.some((d) => d.type === 'delete'));
  assert.equal(fuzzyOpening.status, 'generated');
});

test('Fuzzy matching: closing differing by one word shows diff and falls back to generation', () => {
  const tone = buildPrefaceTone('preface-solemn')!;
  const closingWithAll = `And so, with all the Angels and Archangels,
with Thrones and Dominions,
and with all the hosts and Powers of heaven,
we sing the hymn of your glory,
as without end we acclaim:`;

  const split = splitPreface(`For he assumed at his first coming.\n\n${closingWithAll}`, {
    language: 'en',
    tone,
    templates: SEED_PREFACE_TEMPLATES,
  });

  const closing = split.parts.find((p) => p.kind === 'closing')!;
  assert.equal(closing.matchedTemplateId, 'en-closing-solemn');
  assert.equal(closing.status, 'generated');
  assert.equal(closing.flagged, true);
  assert.ok(closing.diff && closing.diff.some((d) => d.type === 'insert' && d.word === 'all'));
});

test('Fuzzy matching: unrelated paragraph yields No match', () => {
  const tone = buildPrefaceTone('preface-solemn')!;
  const unrelated =
    'Blessed are the poor in spirit, for theirs is the kingdom of heaven.';

  const split = splitPreface(unrelated, {
    language: 'en',
    tone,
    templates: SEED_PREFACE_TEMPLATES,
  });

  const opening = split.parts.find((p) => p.kind === 'opening')!;
  const closing = split.parts.find((p) => p.kind === 'closing')!;
  assert.equal(opening.status, 'no-match');
  assert.equal(closing.status, 'no-match');
});

test('Template alignment: a template whose syllable count differs is rejected', () => {
  const mismatchedTemplate = {
    ...SEED_PREFACE_TEMPLATES.find((t) => t.id === 'en-phrase-through-christ')!,
    // Intentionally wrong syllable count (3 note groups for a 4-syllable phrase)
    gabc: 'through(g) Christ(fe) Lord.(fgf)',
  };

  const res = matchPrefaceTemplate('through Christ our Lord.', [mismatchedTemplate], {
    language: 'en',
    tone: 'preface-solemn',
    kind: 'phrase',
  });

  assert.equal(res.matched, false);
  assert.equal(res.rejectedCandidate?.id, mismatchedTemplate.id);
  assert.deepEqual(res.syllableMismatch, { expected: 3, actual: 4 });
});

test('Round trip: Save as template stores verified user-corrected version and JSON import/export preserves it', () => {
  withMockLocalStorage(() => {
    const tone = buildPrefaceTone('preface-solemn')!;
    const correctedClosingGabc =
      'And(f) so,(h) with(h) An(h)gels(g) and(gf) Arch(fg)an(g)gels,(g) with(f) Thrones(h) and(g) Do(gf)min(fg)ions,(g) and(f) with(h) all(h) the(h) hosts(h) and(h) Pow(h)ers(g) of(gf) heav(fg)en,(g) we(f) sing(h) the(h) hymn(h) of(g) your(gf) glo(fg)ry,(g) as(f) with(g)out(g) end(fe) we(ef) ac(g)claim:(fgf.)';

    const closingText = SEED_PREFACE_TEMPLATES.find((t) => t.id === 'en-closing-solemn')!.text;
    const saved = saveCorrectedPrefaceTemplate({
      id: 'en-closing-solemn',
      language: 'en',
      tone: 'preface-solemn',
      kind: 'closing',
      text: closingText,
      gabc: correctedClosingGabc,
    });

    assert.equal(saved.template.verified, true);
    assert.equal(saved.template.source, 'user-corrected');

    // Paste again: Closing is now Template (verified) and uses the user-corrected GABC verbatim
    const split = splitPreface(ENGLISH_ADVENT_PREFACE, {
      language: 'en',
      tone,
      templates: loadPrefaceTemplates(),
    });
    const closing = split.parts.find((p) => p.kind === 'closing')!;
    assert.equal(closing.status, 'template-verified');
    assert.equal(closing.gabc, correctedClosingGabc);

    const assembled = assemblePreface(split, tone, { language: 'en' });
    assert.ok(assembled.gabc.includes(correctedClosingGabc));
    assert.equal(assembled.checklist.everyTemplateUsedVerbatim, true);
    assert.equal(assembled.checklist.unverifiedTemplateCount, 1); // only opening remains unverified

    // JSON export & import round-trip
    const exported = exportPrefaceTemplatesJson();
    globalThis.localStorage.removeItem(PREFACE_TEMPLATES_STORAGE_KEY);
    const imported = importPrefaceTemplatesJson(exported);
    assert.equal(imported.error, undefined);
    const reloadedClosing = imported.templates.find((t) => t.id === 'en-closing-solemn')!;
    assert.equal(reloadedClosing.verified, true);
    assert.equal(reloadedClosing.gabc, correctedClosingGabc);
  });
});

test('Template status, markPrefaceTemplateVerified, deletePrefaceTemplate, and restoreDefaultPrefaceTemplates', () => {
  withMockLocalStorage(() => {
    const initial = loadPrefaceTemplates();
    const unverifiedEn = initial.find((t) => t.id === 'en-opening-solemn')!;
    assert.equal(getPrefaceTemplateStatus(unverifiedEn), 'needs-review');

    const verifiedSeed = initial.find((t) => t.id === 'la-opening-solemn')!;
    assert.equal(getPrefaceTemplateStatus(verifiedSeed), 'user-verified');

    const marked = markPrefaceTemplateVerified('en-opening-solemn');
    assert.ok(marked.template);
    assert.equal(getPrefaceTemplateStatus(marked.template!), 'user-verified');
    assert.equal(
      getPrefaceTemplateStatus(
        loadPrefaceTemplates().find((t) => t.id === 'en-opening-solemn')!
      ),
      'user-verified'
    );

    const afterDelete = deletePrefaceTemplate('en-opening-solemn');
    assert.equal(
      afterDelete.some((t) => t.id === 'en-opening-solemn'),
      false,
      'deleted template is hidden from loaded templates'
    );

    const afterRestore = restoreDefaultPrefaceTemplates();
    const restored = afterRestore.find((t) => t.id === 'en-opening-solemn');
    assert.ok(restored, 'restored built-in template returns');
    assert.equal(getPrefaceTemplateStatus(restored!), 'needs-review');
  });
});

test('Body word uncertainty flags non-dictionary polysyllabic words and checklist detects function-word cadence', () => {
  const tone = buildPrefaceTone('preface-solemn')!;
  const customPreface = `It is truly right and just, our duty and our salvation,
always and everywhere to give you thanks,
Lord, holy Father, almighty and eternal God,
through Christ our Lord.

By his ineffable incarnation and paschal mystery,
he brings us to the.`;

  const split = splitPreface(customPreface, {
    language: 'en',
    tone,
    templates: SEED_PREFACE_TEMPLATES,
  });
  const body = split.parts.find((p) => p.kind === 'body')!;
  assert.ok(body.phrases && body.phrases.length === 2);
  const firstWords = body.phrases![0].words;
  assert.equal(firstWords.find((w) => /ineffable/i.test(w.text))?.uncertain, true);
  assert.equal(firstWords.find((w) => /incarnation/i.test(w.text))?.uncertain, true);

  const assembled = assemblePreface(split, tone, { language: 'en' });
  assert.equal(assembled.checklist.noFinalFunctionWordAccent, false);
  assert.equal(assembled.checklist.functionWordAccentPhrases[0].phraseIndex, 1);
});

test('Template import silently skips removed part entries', () => {
  withMockLocalStorage(() => {
    const legacyEntry = {
      id: 'legacy-removed-part',
      language: 'la',
      tone: 'preface-solemn',
      kind: 'obsolete-part',
      text: 'Per omnia',
      gabc: 'Per(f) om(h)ni(h)a(h)',
      verified: true,
      source: 'legacy',
    };
    const resOnlyLegacy = importPrefaceTemplatesJson(JSON.stringify([legacyEntry]));
    assert.equal(resOnlyLegacy.error, undefined);
    assert.equal(resOnlyLegacy.importedCount, 0);

    const validPhrase = {
      id: 'user-phrase-test',
      language: 'la',
      tone: 'preface-solemn',
      kind: 'phrase',
      text: 'Per omnia saecula.',
      gabc: 'Per(f) om(h)ni(h)a(h) sae(g)cu(fg)la.(f)',
      verified: true,
      source: 'user-corrected',
    };
    const resMixed = importPrefaceTemplatesJson(JSON.stringify([legacyEntry, validPhrase]));
    assert.equal(resMixed.error, undefined);
    assert.equal(resMixed.importedCount, 1);
    assert.ok(resMixed.templates.some((t) => t.id === 'user-phrase-test'));
  });
});

test('Body phrase cadence control (Latin & English): each option changes only that phrase, marks template phrase edited, and reset restores default', () => {
  const tone = buildPrefaceTone('preface-solemn')!;

  // Latin: override phrase 1 across none / metrum / long / final, plus a verified phrase template
  const laBase = splitPreface(LATIN_ADVENT_PREFACE, {
    language: 'la',
    tone,
    templates: SEED_PREFACE_TEMPLATES,
  });
  const laBaseBody = laBase.parts.find((p) => p.kind === 'body')!.phrases!;
  const laDefaultGabc = assemblePreface(laBase, tone, { language: 'la' }).gabc;

  const customLatinTone = {
    ...tone,
    reading: {
      ...tone.reading!,
      final: {
        recite: 'g',
        segments: [{ prep: [], accent: 'h', post: ['g'] }],
      },
    },
  };

  const laPhrase1Key = laBaseBody[1].endWordIndex;
  for (const choice of ['none', 'metrum', 'long', 'final'] as const) {
    const overrides = applyPhraseCadenceChoiceOverride({}, laPhrase1Key, choice, laBaseBody[1].defaultKind);
    const next = splitPreface(LATIN_ADVENT_PREFACE, {
      language: 'la',
      tone: customLatinTone,
      templates: SEED_PREFACE_TEMPLATES,
      cadenceOverrides: overrides,
    });
    const nextPhrases = next.parts.find((p) => p.kind === 'body')!.phrases!;
    nextPhrases.forEach((ph, idx) => {
      if (idx === 1) {
        assert.equal(ph.choiceLabel, choice);
      } else if (idx !== nextPhrases.length - 1) {
        assert.equal(ph.gabc, laBaseBody[idx].gabc, `Latin phrase ${idx} stays unchanged for ${choice}`);
      }
    });
  }

  // Choosing the default again removes the override and restores default output
  const laRestoredOverrides = applyPhraseCadenceChoiceOverride(
    { [laPhrase1Key]: 'punctum' },
    laPhrase1Key,
    laBaseBody[1].choiceLabel,
    laBaseBody[1].defaultKind
  );
  assert.deepEqual(laRestoredOverrides, {});
  const laReset = splitPreface(LATIN_ADVENT_PREFACE, {
    language: 'la',
    tone,
    templates: SEED_PREFACE_TEMPLATES,
    cadenceOverrides: laRestoredOverrides,
  });
  assert.equal(assemblePreface(laReset, tone, { language: 'la' }).gabc, laDefaultGabc);

  // Overriding a verified Latin phrase template regenerates its notes and marks it edited
  const withVerifiedPhrase = `${LATIN_ADVENT_PREFACE.split('Qui,')[0].trim()}\n\nQui, primo advéntu carnis assúmptæ; Per Christum Dóminum nostrum.\n\nEt ídeo, cum Angelis et Archángelis; cum Thronis et Dominationibus; cumque omni milítia cæléstis exércitus; hymnum glóriæ tuæ cánimus; sine fine dicéntes.`;
  const tplSplit = splitPreface(withVerifiedPhrase, {
    language: 'la',
    tone,
    templates: SEED_PREFACE_TEMPLATES,
    autoJoinShortPhrases: 0,
  });
  const tplBody = tplSplit.parts.find((p) => p.kind === 'body')!.phrases!;
  assert.equal(tplBody[2].status, 'template-verified');
  assert.equal(tplBody[2].edited, false);

  const tplOverridden = splitPreface(withVerifiedPhrase, {
    language: 'la',
    tone,
    templates: SEED_PREFACE_TEMPLATES,
    cadenceOverrides: { [tplBody[2].endWordIndex]: null },
    autoJoinShortPhrases: 0,
  });
  const tplOverBody = tplOverridden.parts.find((p) => p.kind === 'body')!.phrases!;
  assert.equal(tplOverBody[2].status, 'generated');
  assert.equal(tplOverBody[2].edited, true);
  assert.equal(tplOverBody[2].overridden, true);
  assert.notEqual(tplOverBody[2].gabc, tplBody[2].gabc);

  // English: override phrase 1 across none / metrum / flex / long
  const enBase = splitPreface(ENGLISH_ADVENT_PREFACE, {
    language: 'en',
    tone,
    templates: SEED_PREFACE_TEMPLATES,
  });
  const enBaseBody = enBase.parts.find((p) => p.kind === 'body')!.phrases!;
  const enPhrase1Key = enBaseBody[1].endWordIndex;
  const enDefaultGabc = assemblePreface(enBase, tone, { language: 'en' }).gabc;
  const enOutputs = new Map<string, string>();

  for (const choice of ['none', 'metrum', 'flex', 'long'] as const) {
    const overrides = applyPhraseCadenceChoiceOverride({}, enPhrase1Key, choice, enBaseBody[1].defaultKind);
    const next = splitPreface(ENGLISH_ADVENT_PREFACE, {
      language: 'en',
      tone,
      templates: SEED_PREFACE_TEMPLATES,
      cadenceOverrides: overrides,
    });
    const nextPhrases = next.parts.find((p) => p.kind === 'body')!.phrases!;
    enOutputs.set(choice, nextPhrases[1].gabc);
    nextPhrases.forEach((ph, idx) => {
      if (idx === 1) {
        assert.equal(ph.choiceLabel, choice);
      } else {
        assert.equal(ph.gabc, enBaseBody[idx].gabc, `English phrase ${idx} stays unchanged for ${choice}`);
      }
    });
  }
  assert.equal(new Set(enOutputs.values()).size, 4, 'all 4 English cadence choices produce distinct phrase GABC');

  const enReset = splitPreface(ENGLISH_ADVENT_PREFACE, {
    language: 'en',
    tone,
    templates: SEED_PREFACE_TEMPLATES,
    cadenceOverrides: {},
  });
  assert.equal(assemblePreface(enReset, tone, { language: 'en' }).gabc, enDefaultGabc);

  // Body phrase overrides survive edits to other phrases
  assert.deepEqual(
    remapBodyPhraseOverrides(
      [
        { text: 'Alpha.', endWordIndex: 0 },
        { text: 'Beta.', endWordIndex: 1 },
        { text: 'Gamma.', endWordIndex: 2 },
      ],
      [
        { text: 'Alpha edited.', endWordIndex: 1 },
        { text: 'Beta.', endWordIndex: 2 },
        { text: 'Gamma.', endWordIndex: 3 },
      ],
      { 1: 'punctum' }
    ),
    { 2: 'punctum' }
  );
  assert.deepEqual(
    remapBodyPhraseOverrides(
      [
        { text: 'Alpha.', endWordIndex: 0 },
        { text: 'Beta.', endWordIndex: 1 },
        { text: 'Gamma.', endWordIndex: 2 },
      ],
      [
        { text: 'Inserted.', endWordIndex: 0 },
        { text: 'Alpha.', endWordIndex: 1 },
        { text: 'Beta.', endWordIndex: 2 },
        { text: 'Gamma.', endWordIndex: 3 },
      ],
      { 1: 'punctum' }
    ),
    { 2: 'punctum' }
  );
});

test('Latin spelling variants normalize equal, keep user spelling in output, and leave real typos flagged', () => {
  const pairs: [string, string][] = [
    ['justum', 'iustum'],
    ['cujus', 'cuius'],
    ['ǽquum', 'æquum'],
    ['aequum', 'æquum'],
    ['cœléstis', 'cæléstis'],
    ['caelestis', 'cæléstis'],
    ['coelestis', 'cæléstis'],
    ['celestis', 'cæléstis'],
    ['ætérne', 'aetérne'],
    ['exsultámus', 'exultámus'],
    ['Jesu', 'Iesu'],
    ['vere', 'uere'],
  ];
  for (const [a, b] of pairs) {
    assert.equal(normalizePrefaceText(a), normalizePrefaceText(b), `${a} should normalize equal to ${b}`);
  }

  // Opening match with spelling variants preserves user's spelling and all division bars without flagging
  const variantOpening =
    'Vere dignum et justum est, ǽquum et salutáre, nos tibi semper, et ubíque grátias ágere: Dómine sancte, Pater omnípotens, aetérne Deus: per Christum Dóminum nostrum.';
  const openMatch = matchPrefaceTemplate(variantOpening, SEED_PREFACE_TEMPLATES, {
    language: 'la',
    tone: 'preface-solemn',
    kind: 'opening',
  });
  assert.equal(openMatch.matched, true);
  assert.ok(openMatch.gabc?.includes('ju(h)stum(h)'), 'preserves j spelling');
  assert.ok(openMatch.gabc?.includes('ǽ(h)quum(h)'), 'preserves ǽ spelling');
  assert.ok(openMatch.gabc?.includes('ae(h)tér(h)ne'), 'preserves ae spelling');
  assert.ok(openMatch.gabc?.includes('(,)'), 'preserves template comma bar');
  assert.ok(openMatch.gabc?.includes('(;)'), 'preserves template semicolon bar');
  assert.ok(openMatch.gabc?.includes('(:)'), 'preserves template colon bar');

  // Closing match with cœléstis preserves cœléstis
  const variantClosing =
    'Et ídeo cum Ángelis et Archángelis, cum Thronis et Dominatiónibus, cumque omni militia cœléstis exércitus, hymnum glóriæ tuæ cánimus, sine fine dicéntes';
  const closeMatch = matchPrefaceTemplate(variantClosing, SEED_PREFACE_TEMPLATES, {
    language: 'la',
    tone: 'preface-solemn',
    kind: 'closing',
  });
  assert.equal(closeMatch.matched, true);
  assert.ok(closeMatch.gabc?.includes('cœ(h)lé(h)stis(g)'), 'preserves œ spelling');

  // Real typo ("afflulget" vs "affulget") is still flagged in diff while spelling variants beside it are equal
  const typoDiff = computeWordDiff(
    'justum dies afflúlget cœléstis',
    'iustum dies affúlget cæléstis'
  );
  assert.deepEqual(typoDiff, [
    { type: 'equal', word: 'justum' },
    { type: 'equal', word: 'dies' },
    { type: 'insert', word: 'afflúlget' },
    { type: 'delete', word: 'affúlget' },
    { type: 'equal', word: 'cœléstis' },
  ]);
});

test('Pasted Advent preface with spelling variants and missal-style line breaks produces no spelling-related flags', () => {
  const tone = buildPrefaceTone('preface-solemn')!;
  const pastedAdvent =
    'Vere dignum et justum est, ǽquum et salutáre, nos tibi semper, et ubíque grátias ágere: Dómine sancte, Pater omnípotens, ætérne Deus: per Christum Dóminum nostrum. Quem pérdito hóminum géneri Salvatórem miséricors et fidélis promisísti: cuius véritas instrúeret ínscios, sánctitas justificáret ímpios, virtus adiuváret infírmos. Dum ergo prope est ut véniat quem missúrus es, et dies afflúlget liberatiónis nostræ, in hac promissiónum tuárum fide, piis gáudiis exsultámus. Et ídeo cum Ángelis et Archángelis, cum Thronis et Dominatiónibus, cumque omni militia cœléstis exércitus, hymnum glóriæ tuæ cánimus, sine fine dicéntes';

  const pastedWrapped = `Vere dignum et justum est,
ǽquum et salutáre, nos tibi semper,
et ubíque grátias ágere: Dómine sancte,
Pater omnípotens, ætérne Deus:
per Christum Dóminum nostrum.
Quem pérdito hóminum géneri Salvatórem
miséricors et fidélis promisísti: cuius
véritas instrúeret ínscios,
sánctitas justificáret ímpios,
virtus adiuváret infírmos.
Dum ergo prope est ut véniat quem missúrus es,
et dies afflúlget liberatiónis nostræ,
in hac promissiónum tuárum fide,
piis gáudiis exsultámus.
Et ídeo cum Ángelis et Archángelis,
cum Thronis et Dominatiónibus,
cumque omni militia cœléstis exércitus,
hymnum glóriæ tuæ cánimus,
sine fine dicéntes`;

  for (const input of [pastedAdvent, pastedWrapped]) {
    const split = splitPreface(input, {
      language: 'la',
      tone,
      templates: SEED_PREFACE_TEMPLATES,
      autoJoinShortPhrases: 0,
    });
    const opening = split.parts.find((p) => p.kind === 'opening')!;
    const body = split.parts.find((p) => p.kind === 'body')!;
    const closing = split.parts.find((p) => p.kind === 'closing')!;

    assert.equal(opening.status, 'template-verified');
    assert.equal(opening.flagged, false);
    assert.equal(closing.status, 'template-verified');
    assert.equal(closing.flagged, false);
    assert.equal(body.phrases?.length, 8);
    assert.deepEqual(
      body.phrases!.map((p) => p.choiceLabel),
      ['metrum', 'flex', 'flex', 'long', 'flex', 'flex', 'flex', 'final']
    );
    assert.ok(opening.gabc.includes('ju(h)stum(h)'));
    assert.ok(opening.gabc.includes('ǽ(h)quum(h)'));
    assert.ok(closing.gabc.includes('cœ(h)lé(h)stis(g)'));

    const assembled = assemblePreface(split, tone, { language: 'la' });
    assert.equal(validateGabc(assembled.gabc).valid, true);
    assert.equal(assembled.checklist.everyTemplateUsedVerbatim, true);
    assert.equal(assembled.checklist.unverifiedTemplateCount, 0);

    // With default N=3, short 3-word body clauses auto-join cleanly with zero flags
    const splitAuto = splitPreface(input, {
      language: 'la',
      tone,
      templates: SEED_PREFACE_TEMPLATES,
    });
    assert.equal(splitAuto.parts.find((p) => p.kind === 'opening')!.flagged, false);
    assert.equal(splitAuto.parts.find((p) => p.kind === 'closing')!.flagged, false);
    assert.equal(splitAuto.parts.find((p) => p.kind === 'body')!.phrases?.length, 6);
  }
});

test('Latin preface soft line breaks: wrapped, one-line, and phrase-per-punctuation-line produce identical phrases, cadences, startsPhrase, and GABC', () => {
  const tone = buildPrefaceTone('preface-solemn')!;
  const wrapped = `Vere dignum et justum est,
ǽquum et salutáre, nos tibi semper,
et ubíque grátias ágere: Dómine sancte,
Pater omnípotens, ætérne Deus:
per Christum Dóminum nostrum.
Quem pérdito hóminum géneri Salvatórem
miséricors et fidélis promisísti: cuius
véritas instrúeret ínscios,
sánctitas justificáret ímpios,
virtus adiuváret infírmos.

Dum ergo prope est ut véniat quem missúrus es,
et dies affúlget liberatiónis nostræ,
in hac promissiónum tuárum fide,
piis gáudiis exsultámus.
Et ídeo cum Ángelis et Archángelis,
cum Thronis et Dominatiónibus,
cumque omni militia cœléstis exércitus,
hymnum glóriæ tuæ cánimus,
sine fine dicéntes`;

  const oneLine =
    'Vere dignum et justum est, ǽquum et salutáre, nos tibi semper, et ubíque grátias ágere: Dómine sancte, Pater omnípotens, ætérne Deus: per Christum Dóminum nostrum. Quem pérdito hóminum géneri Salvatórem miséricors et fidélis promisísti: cuius véritas instrúeret ínscios, sánctitas justificáret ímpios, virtus adiuváret infírmos.\n\nDum ergo prope est ut véniat quem missúrus es, et dies affúlget liberatiónis nostræ, in hac promissiónum tuárum fide, piis gáudiis exsultámus. Et ídeo cum Ángelis et Archángelis, cum Thronis et Dominatiónibus, cumque omni militia cœléstis exércitus, hymnum glóriæ tuæ cánimus, sine fine dicéntes';

  const phrasePerLine = `Vere dignum et justum est, ǽquum et salutáre, nos tibi semper, et ubíque grátias ágere:
Dómine sancte, Pater omnípotens, ætérne Deus:
per Christum Dóminum nostrum.
Quem pérdito hóminum géneri Salvatórem miséricors et fidélis promisísti:
cuius véritas instrúeret ínscios, sánctitas justificáret ímpios, virtus adiuváret infírmos.

Dum ergo prope est ut véniat quem missúrus es, et dies affúlget liberatiónis nostræ, in hac promissiónum tuárum fide, piis gáudiis exsultámus.
Et ídeo cum Ángelis et Archángelis, cum Thronis et Dominatiónibus, cumque omni militia cœléstis exércitus, hymnum glóriæ tuæ cánimus, sine fine dicéntes`;

  const splits = [wrapped, oneLine, phrasePerLine].map((input) =>
    splitPreface(input, {
      language: 'la',
      tone,
      templates: SEED_PREFACE_TEMPLATES,
      autoJoinShortPhrases: 0,
    })
  );
  const assembled = splits.map((s) => assemblePreface(s, tone, { language: 'la' }));

  const firstBody = splits[0].parts.find((p) => p.kind === 'body')!.phrases!;
  assert.equal(firstBody.length, 8);
  assert.deepEqual(
    firstBody.map((p) => p.choiceLabel),
    ['metrum', 'flex', 'flex', 'long', 'flex', 'flex', 'flex', 'final']
  );
  assert.equal(firstBody[4].paragraphBreak, true);
  // Words after commas stay on the reciting note (no f intonation), while `; : .` starts on f
  assert.ok(firstBody[1].gabc.startsWith('cu(f)ius(h)'), 'phrase after colon starts on f');
  assert.ok(firstBody[2].gabc.startsWith('sán(h)cti(h)tas(h)'), 'comma phrase recites without f intonation');
  assert.ok(firstBody[3].gabc.startsWith('vir(g)tus(g)'), 'punctum after comma recites on g without f intonation');

  for (let i = 1; i < splits.length; i++) {
    const body = splits[i].parts.find((p) => p.kind === 'body')!.phrases!;
    assert.deepEqual(
      body.map((p) => [p.text, p.choiceLabel, p.paragraphBreak, p.gabc]),
      firstBody.map((p) => [p.text, p.choiceLabel, p.paragraphBreak, p.gabc])
    );
    assert.equal(assembled[i].gabc, assembled[0].gabc);
  }

  // Wrapped/one-line/phrase-per-line also remain identical under default N=3 auto-join
  const autoSplits = [wrapped, oneLine, phrasePerLine].map((input) =>
    assemblePreface(
      splitPreface(input, { language: 'la', tone, templates: SEED_PREFACE_TEMPLATES }),
      tone,
      { language: 'la' }
    ).gabc
  );
  assert.equal(autoSplits[1], autoSplits[0]);
  assert.equal(autoSplits[2], autoSplits[0]);
});

test('Preface "Treat line breaks as phrase breaks" defaults OFF for Latin, ON for English, and switches English between line and punctuation phrasing', () => {
  const tone = buildPrefaceTone('preface-solemn')!;
  const wrappedBody = `Vere dignum et iustum est, æquum et salutáre; nos tibi semper et ubíque, grátias ágere; Dómine, sancte Pater, omnípotens ætérne Deus; per Christum Dóminum nostrum.

Quem pérdito hóminum géneri Salvatórem,
miséricors et fidélis promisísti,
cuius véritas instrúeret ínscios.

Et ídeo, cum Angelis et Archángelis; cum Thronis et Dominationibus; cumque omni milítia cæléstis exércitus; hymnum glóriæ tuæ cánimus; sine fine dicéntes.`;

  const defaultOff = splitPreface(wrappedBody, {
    language: 'la',
    tone,
    templates: SEED_PREFACE_TEMPLATES,
  });
  const offBody = defaultOff.parts.find((p) => p.kind === 'body')!.phrases!;
  assert.equal(offBody.length, 3);
  assert.deepEqual(
    offBody.map((p) => p.choiceLabel),
    ['flex', 'flex', 'final']
  );

  const lineBreaksOn = splitPreface(wrappedBody, {
    language: 'la',
    tone,
    templates: SEED_PREFACE_TEMPLATES,
    treatLineBreaksAsPhraseBreaks: true,
  });
  const onBody = lineBreaksOn.parts.find((p) => p.kind === 'body')!.phrases!;
  assert.equal(onBody.length, 3);
  assert.deepEqual(
    onBody.map((p) => p.choiceLabel),
    ['metrum', 'metrum', 'final']
  );

  // English defaults to line-per-phrase (9 body phrases on Advent I)
  const enDefault = splitPreface(ENGLISH_ADVENT_PREFACE, {
    language: 'en',
    tone,
    templates: SEED_PREFACE_TEMPLATES,
  });
  assert.equal(enDefault.parts.find((p) => p.kind === 'body')!.phrases?.length, 9);

  // Turning OFF "Treat line breaks as phrase breaks" for English splits by punctuation including commas (flex / g-flex)
  const enPunctBody = `It is truly right and just, our duty and our salvation,
always and everywhere to give you thanks,
Lord, holy Father, almighty and eternal God,
through Christ our Lord.

For by his glorious birth,
he renewed our fallen nature;
and by his wondrous passion,
he opened the gates of heaven.

Still waiting in hope,
without closing punctuation

And so, with Angels and Archangels,
with Thrones and Dominions,
and with all the hosts and Powers of heaven,
we sing the hymn of your glory,
as without end we acclaim:`;

  const enPunct = splitPreface(enPunctBody, {
    language: 'en',
    tone,
    templates: SEED_PREFACE_TEMPLATES,
    treatLineBreaksAsPhraseBreaks: false,
  });
  const enPunctPhrases = enPunct.parts.find((p) => p.kind === 'body')!.phrases!;
  assert.equal(enPunctPhrases.length, 6);
  assert.deepEqual(
    enPunctPhrases.map((p) => [p.choiceLabel, p.effectiveRole, p.paragraphBreak]),
    [
      ['flex', 'g-flex', false],
      ['metrum', 'h-metrum', false],
      ['flex', 'g-flex', false],
      ['long', 'g-long', false],
      ['flex', 'g-flex', true],
      ['none', undefined, false],
    ]
  );
  // Bars follow effective cadence: flex -> (,), metrum -> (;), long -> (:), none -> no bar
  assert.ok(enPunctPhrases[0].gabc.endsWith(' (,)'));
  assert.ok(enPunctPhrases[1].gabc.endsWith(' (;)'));
  assert.ok(enPunctPhrases[2].gabc.endsWith(' (,)'));
  assert.ok(enPunctPhrases[3].gabc.endsWith(' (:)'));
  assert.ok(enPunctPhrases[4].gabc.endsWith(' (,)'));
  assert.doesNotMatch(enPunctPhrases[5].gabc, /\((?:,|;|::|:)\)\s*$/);
});

test('Restoring template phrase override brings back verbatim template notes; checklist checks effective cadences; remap drops edited phrases', () => {
  const tone = buildPrefaceTone('preface-solemn')!;
  const input = `${LATIN_ADVENT_PREFACE.split('Qui,')[0].trim()}

Qui, primo advéntu carnis assúmptæ; Per Christum Dóminum nostrum.

Et ídeo, cum Angelis et Archángelis; cum Thronis et Dominationibus; cumque omni milítia cæléstis exércitus; hymnum glóriæ tuæ cánimus; sine fine dicéntes.`;

  const base = splitPreface(input, {
    language: 'la',
    tone,
    templates: SEED_PREFACE_TEMPLATES,
    autoJoinShortPhrases: 0,
  });
  const basePhrase2 = base.parts.find((p) => p.kind === 'body')!.phrases![2];
  assert.equal(basePhrase2.status, 'template-verified');
  assert.equal(basePhrase2.edited, false);

  // Overriding phrase 2 to 'none' regenerates notes, marks edited, and flags missing cadence in checklist
  const overridden = splitPreface(input, {
    language: 'la',
    tone,
    templates: SEED_PREFACE_TEMPLATES,
    cadenceOverrides: { [basePhrase2.endWordIndex]: null },
    autoJoinShortPhrases: 0,
  });
  const overPhrase2 = overridden.parts.find((p) => p.kind === 'body')!.phrases![2];
  assert.equal(overPhrase2.status, 'generated');
  assert.equal(overPhrase2.edited, true);
  assert.notEqual(overPhrase2.gabc, basePhrase2.gabc);

  const overChecklist = assemblePreface(overridden, tone, { language: 'la' }).checklist;
  assert.equal(overChecklist.everyPhraseHasCadence, false);
  assert.deepEqual(overChecklist.phrasesWithoutCadence, [2]);

  // Restoring removes the override and recovers verbatim template notes
  const restored = splitPreface(input, {
    language: 'la',
    tone,
    templates: SEED_PREFACE_TEMPLATES,
    cadenceOverrides: {},
    autoJoinShortPhrases: 0,
  });
  const restoredPhrase2 = restored.parts.find((p) => p.kind === 'body')!.phrases![2];
  assert.equal(restoredPhrase2.status, 'template-verified');
  assert.equal(restoredPhrase2.edited, false);
  assert.equal(restoredPhrase2.gabc, basePhrase2.gabc);

  const restoredAssembled = assemblePreface(restored, tone, { language: 'la' });
  assert.equal(restoredAssembled.checklist.everyPhraseHasCadence, true);
  assert.equal(restoredAssembled.checklist.everyTemplateUsedVerbatim, true);

  // Remapping drops override when the overridden phrase's text changed, even with equal phrase count
  assert.deepEqual(
    remapBodyPhraseOverrides(
      [
        { text: 'Alpha.', endWordIndex: 0 },
        { text: 'Beta.', endWordIndex: 1 },
        { text: 'Gamma.', endWordIndex: 2 },
      ],
      [
        { text: 'Alpha.', endWordIndex: 0 },
        { text: 'Completely new.', endWordIndex: 2 },
        { text: 'Gamma.', endWordIndex: 3 },
      ],
      {
        1: 'punctum',
        2: 'metrum',
      }
    ),
    { 3: 'metrum' }
  );
  // Deleting phrase 1 drops its override rather than shifting it onto Gamma.
  assert.deepEqual(
    remapBodyPhraseOverrides(
      [
        { text: 'Alpha.', endWordIndex: 0 },
        { text: 'Beta.', endWordIndex: 1 },
        { text: 'Gamma.', endWordIndex: 2 },
      ],
      [
        { text: 'Alpha.', endWordIndex: 0 },
        { text: 'Gamma.', endWordIndex: 1 },
      ],
      {
        1: 'punctum',
        2: 'metrum',
      }
    ),
    { 1: 'metrum' }
  );
});

test('Preface body bars follow effective cadence (not punctuation), template trailing bars are not doubled, and assemblePreface avoids duplicate (::)', () => {
  const tone = buildPrefaceTone('preface-solemn')!;
  const bodyOnly = 'Prima pars;\nSecúnda pars:\nTértia pars.';

  const baseSplit = splitPreface(bodyOnly, {
    language: 'la',
    tone,
    templates: SEED_PREFACE_TEMPLATES,
    treatLineBreaksAsPhraseBreaks: false,
    autoJoinShortPhrases: 0,
  });
  const basePhrases = baseSplit.parts.find((p) => p.kind === 'body')!.phrases!;
  assert.ok(basePhrases[0].gabc.endsWith(' (;)'));
  assert.ok(basePhrases[1].gabc.endsWith(' (;)'));
  assert.ok(basePhrases[2].gabc.endsWith(' (::)'));

  // Overriding phrase 0 (; -> long) emits (:), phrase 1 (: -> none) emits no bar
  const overSplit = splitPreface(bodyOnly, {
    language: 'la',
    tone,
    templates: SEED_PREFACE_TEMPLATES,
    treatLineBreaksAsPhraseBreaks: false,
    autoJoinShortPhrases: 0,
    cadenceOverrides: { [basePhrases[0].endWordIndex]: 'punctum', [basePhrases[1].endWordIndex]: null },
  });
  const overPhrases = overSplit.parts.find((p) => p.kind === 'body')!.phrases!;
  assert.ok(overPhrases[0].gabc.endsWith(' (:)'));
  assert.doesNotMatch(overPhrases[1].gabc, /\((?:,|;|::|:)\)\s*$/);
  assert.ok(overPhrases[2].gabc.endsWith(' (::)'));

  const assembled = assemblePreface(overSplit, tone, { language: 'la' });
  assert.equal(validateGabc(assembled.gabc).valid, true);
  assert.doesNotMatch(assembled.gabc, /\((?:,|;|::|:)\)\s*\((?:,|;|::|:)\)/);
  assert.doesNotMatch(assembled.gabc, /\(::\)\s*\(::\)/);

  // Template phrase whose GABC already ends with (:) does not get a second bar, and upgrades to (::) when last
  const barredTpl = {
    id: 'test-la-barred-phrase',
    language: 'la' as const,
    tone: 'preface-solemn',
    kind: 'phrase' as const,
    text: 'Per Christum Dóminum nostrum.',
    gabc: 'per(g) Chri(f!gwh)stum(g) Dó(fe)mi(ef)num(g) no(fg)strum.(f) (:)',
    verified: true,
    source: 'user-corrected',
  };
  const midTplSplit = splitPreface('Prima pars; Per Christum Dóminum nostrum. Tértia pars.', {
    language: 'la',
    tone,
    templates: [barredTpl],
    autoJoinShortPhrases: 0,
  });
  const midTplPhrase = midTplSplit.parts.find((p) => p.kind === 'body')!.phrases![1];
  assert.equal(midTplPhrase.gabc, barredTpl.gabc);

  const lastTplSplit = splitPreface('Prima pars; Per Christum Dóminum nostrum.', {
    language: 'la',
    tone,
    templates: [barredTpl],
    autoJoinShortPhrases: 0,
  });
  const lastTplPhrase = lastTplSplit.parts.find((p) => p.kind === 'body')!.phrases![1];
  assert.equal(
    lastTplPhrase.gabc,
    'per(g) Chri(f!gwh)stum(g) Dó(fe)mi(ef)num(g) no(fg)strum.(f) (::)'
  );
  const lastTplAssembled = assemblePreface(lastTplSplit, tone, { language: 'la' });
  assert.equal(lastTplAssembled.checklist.everyTemplateUsedVerbatim, true);
  assert.doesNotMatch(lastTplAssembled.gabc, /\(:\)\s*\(::\)/);
});
