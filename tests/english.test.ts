import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ensureEnglishHyphenation,
  syllabifyEnglishWord,
  syllabifyEnglishText,
} from '@/src/lib/text/englishSyllabify';
import {
  englishStressedSyllableIndex,
  isEnglishFunctionWord,
  toEnglishToneSyllables,
} from '@/src/lib/tones/englishAccent';
import { toToneSyllables } from '@/src/lib/tones/latinAccent';
import { pointPsalm, pointReading, extractTonePreview } from '@/src/lib/tones/pointing';
import { buildPsalmTone } from '@/src/lib/tones/psalmTones';
import { parseToneDefinition } from '@/src/lib/tones/tone';
import { applyLyricsToScore } from '@/src/lib/notation/lyricsImport';
import { parseGabc } from '@/src/lib/gabc/parser';
import { serializeGabc } from '@/src/lib/gabc/serializer';
import { validateGabc } from '@/src/lib/gabc/validator';
import { loadWorkspacePrefs, saveWorkspacePrefs } from '@/src/lib/workspacePrefs';

await ensureEnglishHyphenation();

test('English syllabification: common liturgical words and punctuation', () => {
  assert.equal(syllabifyEnglishWord('glory').join('-'), 'glo-ry');
  assert.equal(syllabifyEnglishWord('Father').join('-'), 'Fa-ther');
  assert.equal(syllabifyEnglishWord('Spirit').join('-'), 'Spir-it');
  assert.equal(syllabifyEnglishWord('Almighty').join('-'), 'Al-migh-ty');
  assert.equal(syllabifyEnglishWord('Jerusalem,').join('-'), 'Je-ru-sa-lem,');
  assert.equal(syllabifyEnglishWord('(mercy).').join('-'), '(mer-cy).');
});

test('English syllabification: user hyphens override automatic splitting', () => {
  assert.deepEqual(syllabifyEnglishWord('glo-ry'), ['glo', 'ry']);
  assert.deepEqual(syllabifyEnglishWord('ev-er-last-ing'), ['ev', 'er', 'last', 'ing']);
});

test('English syllabification: apostrophes and contractions remain one word', () => {
  assert.deepEqual(syllabifyEnglishWord("don't"), ["don't"]);
  assert.deepEqual(syllabifyEnglishWord("o'er"), ["o'er"]);
  assert.deepEqual(syllabifyEnglishWord("Father's"), ['Fa', "ther's"]);
  const text = syllabifyEnglishText("Father's mercy");
  assert.deepEqual(
    text.map((s) => [s.text, s.wordEnd]),
    [
      ['Fa', false],
      ["ther's", true],
      ['mer', false],
      ['cy', true],
    ]
  );
});

test('English syllabification: text marks word ends cleanly', () => {
  const s = syllabifyEnglishText('Praise the Lord');
  assert.deepEqual(
    s.map((x) => [x.text, x.wordEnd]),
    [
      ['Praise', true],
      ['the', true],
      ['Lord', true],
    ]
  );
});

test('applyLyricsToScore with language="en" distributes English syllables and preserves melismas', () => {
  const score = parseGabc('name: Test;\n%%\n(c4) x(f/g) x(h) x(i) x(j) x(h)');
  const res = applyLyricsToScore(score, 'Glory to God', 'en');
  assert.equal(res.assigned, 4);
  assert.equal(res.unfilledItems, 1);
  assert.equal(res.leftoverSyllables, 0);
  const out = serializeGabc(res.score);
  assert.match(out, /Glo\(f\/g\)ry\(h\) to\(i\) God\(j\)/);
});

test('English lexical stress: function words vs monosyllabic content words', () => {
  assert.equal(isEnglishFunctionWord('the'), true);
  assert.equal(isEnglishFunctionWord('of'), true);
  assert.equal(isEnglishFunctionWord('Lord'), false);

  const phrase = toEnglishToneSyllables('to the Lord');
  assert.deepEqual(
    phrase.map((s) => s.stressed),
    [false, false, true]
  );

  // Monosyllabic content word stays stressed even at end of phrase
  const son = toEnglishToneSyllables('and to the Son');
  assert.deepEqual(
    son.map((s) => s.stressed),
    [false, false, false, true]
  );
});

test('English lexical stress: default first syllable and unstressed prefix shift', () => {
  assert.equal(englishStressedSyllableIndex(['glo', 'ry']), 0);
  assert.equal(englishStressedSyllableIndex(['Fa', 'ther']), 0);
  assert.equal(englishStressedSyllableIndex(['al', 'migh', 'ty']), 1);
  assert.equal(englishStressedSyllableIndex(['be', 'gin', 'ning']), 1);
  assert.equal(englishStressedSyllableIndex(['re', 'joice']), 1);
  assert.equal(englishStressedSyllableIndex(['de', 'li', 'ver']), 1);
  assert.equal(englishStressedSyllableIndex(['con', 'fess']), 1);
  assert.equal(englishStressedSyllableIndex(['ex', 'alt']), 1);
});

test('English lexical stress: acute accent overrides heuristic', () => {
  assert.equal(englishStressedSyllableIndex(['gló', 'ry']), 0);
  assert.equal(englishStressedSyllableIndex(['A', 'mén']), 1);
  const s = toToneSyllables('A-mén', { language: 'en' });
  assert.deepEqual(
    s.map((x) => x.stressed),
    [false, true]
  );
});

test('English stress overrides work via toToneSyllables and extractTonePreview', () => {
  const base = toToneSyllables('the glory', { language: 'en' });
  assert.deepEqual(
    base.map((s) => s.stressed),
    [false, true, false]
  );
  const overridden = toToneSyllables('the glory', {
    language: 'en',
    stressOverrides: { 0: true, 1: false },
  });
  assert.deepEqual(
    overridden.map((s) => s.stressed),
    [true, false, false]
  );

  const rows = extractTonePreview('psalm', 'The Lord * my God', {
    language: 'en',
    stressOverrides: { 0: true },
  });
  assert.equal(rows.length, 1);
  const firstTok = rows[0][0];
  assert.equal(firstTok.kind, 'syllable');
  if (firstTok.kind === 'syllable') {
    assert.equal(firstTok.stressed, true);
  }
});

test('English psalm verse pointed with tone 1 D produces valid GABC', () => {
  const tone = buildPsalmTone('1', 'D')!;
  const res = pointPsalm(
    'The Lord said unto my Lord: * Sit thou at my right hand.',
    tone,
    { language: 'en', gloriaPatri: true, title: 'Psalm 110' }
  );
  assert.equal(res.warnings.length, 0);
  const v = validateGabc(res.gabc);
  assert.equal(v.valid, true, JSON.stringify(v.errors));
  assert.match(res.gabc, /\(c4\)/);
  assert.match(res.gabc, /The\(f\) Lord\(gh\)/);
  assert.match(res.gabc, /\*\(:\)/);
  assert.match(res.gabc, /right\(f\) hand\.\(ghgvFED\.\)/);
  assert.match(res.gabc, /Spír\(gh\)it\.\(gvFED\.\)/, 'appends English Gloria Patri with paroxytone termination');
  assert.match(res.gabc, /Gló\(/);
  const parsed = parseGabc(res.gabc);
  assert.ok(parsed.items.some((it) => it.kind === 'syllable' && it.lyric === 'Lord'));
});

test('English reading tone produces valid GABC', () => {
  const tone = parseToneDefinition(
    'name: English Reading\nclef: c4\ntenor: h\nflexa: h* g\nmetrum: h* g\npunctum: h* g g\nquestion: h* i'
  ).tone!;
  const res = pointReading('In the beginning, God created heaven and earth. Who is like him?', tone, {
    language: 'en',
  });
  assert.equal(res.warnings.length, 0);
  assert.equal(validateGabc(res.gabc).valid, true);
});

test('workspacePrefs loads legacy prefs without language/tones errors and persists new fields', () => {
  const store = new Map<string, string>();
  const mockStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  };
  (globalThis as unknown as { localStorage: typeof mockStorage }).localStorage = mockStorage;
  // Simulate legacy saved prefs without `language`
  store.set('chantscore.prefs.v2', JSON.stringify({ ribbonTab: 'home', organ: 'pipe' }));
  const loadedLegacy = loadWorkspacePrefs();
  assert.equal(loadedLegacy.ribbonTab, 'home');
  assert.equal(loadedLegacy.language, 'la');

  // Persist 'tones' tab and 'en' language
  saveWorkspacePrefs({ ...loadedLegacy, ribbonTab: 'tones', language: 'en' });
  const loadedUpdated = loadWorkspacePrefs();
  assert.equal(loadedUpdated.ribbonTab, 'tones');
  assert.equal(loadedUpdated.language, 'en');
});
