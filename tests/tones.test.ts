import test from 'node:test';
import assert from 'node:assert/strict';
import { stressedSyllableIndex, toToneSyllables } from '@/src/lib/tones/latinAccent';
import { parseCadence, parseToneDefinition, applyCadence, mergeNeumeNotes } from '@/src/lib/tones/tone';
import { pointPsalm, pointReading, autoSplitVerse, extractReadingPhrases } from '@/src/lib/tones/pointing';
import { syllabifyWord } from '@/src/lib/text/latinSyllabify';
import {
  ensureEnglishHyphenation,
  syllabifyEnglishWord,
} from '@/src/lib/text/englishSyllabify';
import { toEnglishToneSyllables } from '@/src/lib/tones/englishAccent';
import { parseGabc } from '@/src/lib/gabc/parser';
import { validateGabc } from '@/src/lib/gabc/validator';

await ensureEnglishHyphenation();

const stressOf = (w: string) => {
  const s = syllabifyWord(w);
  return s[stressedSyllableIndex(s)];
};

test('stress: common words', () => {
  assert.equal(stressOf('Dominus'), 'Do');
  assert.equal(stressOf('Gloria'), 'Glo');
  assert.equal(stressOf('Spiritui'), 'ri');
  assert.equal(stressOf('saeculorum'), 'lo');
  assert.equal(stressOf('Deus'), 'De');
  assert.equal(stressOf('omnipotens'), 'ni');
  assert.equal(stressOf('sanctificetur'), 'ce');
  assert.equal(stressOf('Amen'), 'men');
  assert.equal(stressOf('Maria'), 'ri');
  assert.equal(stressOf('Alleluia'), 'lu');
  assert.equal(stressOf('principio'), 'ci');
  assert.equal(stressOf('Filio'), 'Fi');
});

test('an acute accent in the text overrides the rules', () => {
  assert.equal(stressOf('Dominórum'), 'nó');
  assert.equal(stressOf('Spirítui'), 'rí');
  assert.equal(stressOf('Fílio'), 'Fí');
});

test('monosyllables are unstressed unless the text has no polysyllable', () => {
  const s = toToneSyllables('in me');
  assert.deepEqual(s.map((x) => x.stressed), [false, true]);
  const t = toToneSyllables('super me');
  assert.deepEqual(t.map((x) => x.stressed), [true, false, false]);
});

test('cadence parsing', () => {
  assert.deepEqual(parseCadence('g h i* h'), { segments: [{ prep: ['g', 'h'], accent: 'i', post: ['h'] }] });
  assert.deepEqual(parseCadence('gh* g'), { segments: [{ prep: [], accent: 'gh', post: ['g'] }] });
  assert.equal(parseCadence('g h i'), null, 'needs an accent');
  assert.equal(parseCadence('g h* i* h'), null, 'only one accent per segment');
  assert.equal(parseCadence('g z* h'), null, 'invalid pitch');
  assert.equal(parseCadence('g h* h / g h* h')!.segments.length, 2);
});

test('tone definition parsing and errors', () => {
  const ok = parseToneDefinition('# demo\nname: Demo\nclef: c4\ntenor: h\nintonation: g h\nmediant: g h i* h\ntermination: h g* g');
  assert.equal(ok.errors.length, 0);
  assert.equal(ok.tone!.tenor, 'h');
  const bad = parseToneDefinition('tenor: hh\nmediant: nonsense');
  assert.ok(bad.errors.length >= 2);
});

// Synthetic tone for exercising the engine (NOT a Liber Usualis tone).
const DEMO = parseToneDefinition(
  'name: Demo\nclef: c4\ntenor: h\nintonation: g h\nflex: h* g\nmediant: g h i* h\ntermination: h g* g'
).tone!;

test('cadence aligns to the last stressed syllable; paroxytone ending', () => {
  // "sede a dextris meis": me-is, stress on 'me'
  const sylls = toToneSyllables('sede a dextris meis');
  const notes = applyCadence(sylls, DEMO.mediant!);
  const text = sylls.map((s) => s.text);
  const at = (t: string) => notes.get(text.lastIndexOf(t));
  assert.equal(at('me'), 'i', 'accent on the stressed syllable');
  assert.equal(at('is'), 'h', 'post-accent note on the last syllable');
  assert.equal(at('tris'), 'h', 'preparatory notes precede the accent');
  assert.equal(at('dex'), 'g');
});

test('proparoxytone ending repeats the first post-accent note (punctum cavum)', () => {
  const sylls = toToneSyllables('et Dominus');
  const notes = applyCadence(sylls, DEMO.mediant!);
  const text = sylls.map((s) => s.text); // et Do mi nus
  assert.equal(notes.get(text.indexOf('Do')), 'i');
  assert.equal(notes.get(text.indexOf('mi')), 'h');
  assert.equal(notes.get(text.indexOf('nus')), 'h');
});

test('oxytone ending (final stress) folds the post-accent note onto the final syllable', () => {
  const sylls = toToneSyllables('et Israel');
  const notes = applyCadence(sylls, DEMO.mediant!);
  assert.equal(notes.get(sylls.length - 1), 'ih');
});

test('two-accent cadence places both accents', () => {
  const c = parseCadence('g* h / h* g')!;
  const sylls = toToneSyllables('Dominus regnávit decórem');
  const notes = applyCadence(sylls, c);
  const text = sylls.map((s) => s.text);
  assert.equal(notes.get(text.indexOf('có')), 'h');
  assert.equal(notes.get(text.indexOf('gná')), 'g');
});

test('psalm pointing produces valid GABC with intonation, mediant and termination', () => {
  const r = pointPsalm('Dixit Dominus Domino meo: * sede a dextris meis.', DEMO, { title: 'Ps 109' });
  assert.equal(r.warnings.length, 0);
  assert.match(r.gabc, /^name: Ps 109;/);
  assert.match(r.gabc, /\(c4\)/);
  assert.match(r.gabc, /Di\(g\)xit\(h\)/, 'intonation on the first two syllables');
  assert.match(r.gabc, /\*\(:\)/, 'mediant mark as a division with an asterisk');
  assert.match(r.gabc, /\(::\)/);
  const v = validateGabc(r.gabc);
  assert.equal(v.valid, true, JSON.stringify(v.errors));
  const score = parseGabc(r.gabc);
  assert.ok(score.items.filter((i) => i.kind === 'syllable').length > 10);
});

test('intonation only on the first verse unless repeated', () => {
  const text = 'Dixit Dominus Domino meo: * sede a dextris meis.\nDonec ponam inimicos tuos: * scabellum pedum tuorum.';
  const once = pointPsalm(text, DEMO).gabc.split('\n');
  assert.match(once[3] ?? once[2], /^/);
  const lines = pointPsalm(text, DEMO).gabc.split('\n').filter((l) => /\(::\)/.test(l));
  assert.match(lines[0], /Di\(g\)xit\(h\)/);
  assert.doesNotMatch(lines[1], /Do\(g\)nec\(h\)/);
  const rep = pointPsalm(text, DEMO, { repeatIntonation: true }).gabc.split('\n').filter((l) => /\(::\)/.test(l));
  assert.match(rep[1], /Do\(g\)nec\(h\)/);
});

test('explicit flex mark uses the flex cadence', () => {
  const r = pointPsalm('Beatus vir qui non abiit in consilio impiorum † et in via peccatorum non stetit * et in cathedra pestilentiae non sedit.', DEMO);
  assert.match(r.gabc, /\u2020\(,\)/);
  assert.match(r.gabc, /ru\(g\)m\(g\)|rum\(g\)|\(g\) \u2020/);
});

test('gloria patri is appended and pointed', () => {
  const r = pointPsalm('Dixit Dominus Domino meo: * sede a dextris meis.', DEMO, { gloriaPatri: true });
  assert.match(r.gabc, /Gl\u00F3\(?/);
  assert.match(r.gabc, /men\.\(/);
});

test('auto split picks punctuation near the middle', () => {
  const [a, b] = autoSplitVerse('Dixit Dominus Domino meo, sede a dextris meis')!;
  assert.equal(a, 'Dixit Dominus Domino meo,');
  assert.equal(b, 'sede a dextris meis');
});

const READING = parseToneDefinition(
  'name: Demo reading\nclef: c4\ntenor: h\nflexa: h* g\nmetrum: h* g\npunctum: h* g g\nquestion: h* i'
).tone!;

test('reading tone: recite on the tenor, cadence at each punctuation mark', () => {
  const r = pointReading('In illo tempore, dixit Iesus discipulis suis. Quis est?', READING);
  assert.equal(r.warnings.length, 0);
  assert.match(r.gabc, /tem\(h\)po\(g\)re,\(g\)/);
  assert.match(r.gabc, /\(::\)\s*$/);
  assert.equal(validateGabc(r.gabc).valid, true);
});

test('missing cadence for a punctuation mark warns and recites', () => {
  const t = parseToneDefinition('tenor: h\nflexa: h* g').tone!;
  const r = pointReading('Dixit Iesus. Amen', t, { autoJoinShortPhrases: 0 });
  assert.ok(r.warnings.some((w) => /punctum/.test(w)));
});

// ---- built-in tones ----
import { buildPsalmTone, listPsalmTones, flexNote } from '@/src/lib/tones/psalmTones';
import {
  buildPrefaceTone,
  buildReadingTone,
  DEFAULT_READING_OPENING_FORMULA,
  getReadingOpeningFormulaText,
  migrateSavedReadingOpeningFormula,
  normalizeReadingOpeningFormula,
  PREFACE_TONES,
  READING_OPENING_FORMULAS,
  READING_TONES,
} from '@/src/lib/tones/readingTones';
import { extractTonePreview, pointText } from '@/src/lib/tones/pointing';
import { toneToDefinition, cadenceToString } from '@/src/lib/tones/tone';

test('cadence modifiers: recite, positional, flats and neume shapes', () => {
  assert.deepEqual(parseCadence('recite=i; i h i ij* j'), {
    segments: [{ prep: ['i', 'h', 'i'], accent: 'ij', post: ['j'] }],
    recite: 'i',
  });
  const p = parseCadence('positional; h j j j')!;
  assert.equal(p.positional, true);
  assert.equal(p.segments[0].accent, 'h');
  assert.deepEqual(p.segments[0].post, ['j', 'j', 'j']);
  assert.ok(parseCadence('ixi* h / g* h h.'));
  assert.ok(parseCadence('g f gh* g gvFED.'));
  assert.ok(parseCadence('hiwj* j'));
  assert.equal(parseCadence('bogus=1; h*'), null);
  assert.equal(parseCadence('g z* h'), null);
});

test('cadence text round-trips', () => {
  for (const spec of ['recite=g; d f* f ed..', 'ixi* h / g* h h.', 'positional; h j j j']) {
    const c = parseCadence(spec)!;
    assert.deepEqual(parseCadence(cadenceToString(c)), c);
  }
});

test('positional cadence ignores stress and aligns to the end', () => {
  const c = parseCadence('positional; h j j j')!;
  const sylls = toToneSyllables('Altissimi obumbrabit tibi');
  const notes = applyCadence(sylls, c);
  assert.equal(notes.get(sylls.length - 4), 'h');
  assert.equal(notes.get(sylls.length - 1), 'j');
  assert.equal(notes.has(sylls.length - 5), false);
});

test('flex falls a tone, or a minor third below do and fa', () => {
  assert.equal(flexNote('h', 'c4'), 'g'); // la -> sol
  assert.equal(flexNote('j', 'c4'), 'h'); // do -> la
  assert.equal(flexNote('h', 'f3'), 'f'); // fa -> re
});

test('every built-in psalm tone builds, round-trips and points to valid GABC', () => {
  const tones = listPsalmTones();
  assert.deepEqual(
    tones.map((t) => t.id),
    ['1', '2', '3', '4', '5', '6', '7', '8', 'peregrinus', 'irregularis', 'in directum (romanus)', 'in directum (T.P.)']
  );
  const text = 'Dixit Dominus Domino meo: * sede a dextris meis, donec ponam inimicos tuos † scabellum pedum tuorum.';
  for (const t of tones) {
    for (const ending of t.endings) {
      for (const solemn of t.hasSolemn ? [false, true] : [false]) {
        const tone = buildPsalmTone(t.id, ending, solemn)!;
        assert.ok(tone, `${t.id} ${ending}`);
        const back = parseToneDefinition(toneToDefinition(tone));
        assert.equal(back.errors.length, 0, `${tone.name}: ${back.errors.join(' ')}`);
        const r = pointPsalm(text, back.tone!, { gloriaPatri: true });
        const v = validateGabc(r.gabc);
        assert.equal(v.valid, true, `${tone.name}: ${JSON.stringify(v.errors)}`);
      }
    }
  }
});

test('psalm tone 1 D: intonation, accent and termination notes', () => {
  const tone = buildPsalmTone('1', 'D')!;
  assert.equal(tone.tenor, 'h');
  assert.deepEqual(tone.intonation, ['f', 'gh']);
  const r = pointPsalm('Dixit Dominus Domino meo: * sede a dextris meis.', tone);
  assert.match(r.gabc, /Di\(f\)xit\(gh\)/);
  assert.match(r.gabc, /me\(gh\)is\.\(gvFED\.\)/);
});

test('tonus peregrinus recites the second half on g', () => {
  const tone = buildPsalmTone('peregrinus', '')!;
  assert.equal(tone.termination!.recite, 'g');
  const r = pointPsalm('In exitu Israel de Aegypto: * domus Iacob de populo barbaro.', tone);
  const second = r.gabc.split('*(:)')[1];
  assert.match(second, /do\(g\)mus\(g\)/);
});

test('epistle tone: full stop, metrum, final formula', () => {
  const tone = buildReadingTone('epistle')!;
  assert.equal(tone.tenor, 'j');
  const r = pointReading(
    'Fratres: Sicut in Christo vivificabuntur omnes. Ordo autem unusquisque in suo ordine; primitiae Christus. Deinde ii qui sunt Christi. Christus primitiae.',
    tone,
    { autoJoinShortPhrases: 0 }
  );
  assert.equal(r.warnings.length, 0, r.warnings.join(' '));
  assert.match(r.gabc, /bun\(jk\)tur\(i\) om\(h\)nes\.\(i\.\)/, 'full stop: podatus DO-RE, SI, LA, SI.');
  assert.match(r.gabc, /in\(h\) su\(j\)o\(i\) or\(i\)di\(j\)ne;\(j\.\)/, 'metrum: LA, DO-SI, SI-DO.');
  assert.match(r.gabc, /Chri\(i\)stus\(i\) pri\(i\)mi\(ij\)ti\(j\)ae\.\(j\.\)/, 'final phrase on SI, podatus SI-DO.');
  assert.match(r.gabc, /sunt\(j\) Chri\(hj\)sti\.\(j\.\)/, 'the phrase before the last gets podatus LA-DO.');
  assert.equal(validateGabc(r.gabc).valid, true);
});

import { GOSPEL_DEFINITION } from '@/src/lib/tones/readingTones';

test('gospel tone (ancient): parse, round-trip, tenor h, no flexa/prefinal, mediant, punctum, question, final', () => {
  const parsed = parseToneDefinition(GOSPEL_DEFINITION);
  assert.equal(parsed.errors.length, 0, parsed.errors.join(' '));
  const tone = buildReadingTone('gospel')!;
  assert.ok(tone);
  assert.equal(tone.name, 'Gospel tone (ancient)');
  assert.equal(tone.clef, 'c4');
  assert.equal(tone.tenor, 'h');
  assert.equal(tone.reading?.flex, null, 'flexa is none');
  assert.equal(tone.reading?.prefinal, undefined, 'prefinal is omitted');

  // Round-trip serialize/parse
  const roundTripped = parseToneDefinition(toneToDefinition(tone));
  assert.equal(roundTripped.errors.length, 0, roundTripped.errors.join(' '));
  assert.deepEqual(roundTripped.tone, tone);

  // Flexa (comma) produces no notes; mediant at ; and :
  const medRes = pointReading(
    'Dixit Iesus, discípulis suis; in nómine Dómini: Quóniam ipsórum est regnum cælórum.',
    tone,
    { autoJoinShortPhrases: 0 }
  );
  assert.equal(medRes.warnings.length, 0, medRes.warnings.join(' '));
  assert.equal(validateGabc(medRes.gabc).valid, true);
  assert.match(medRes.gabc, /Di\(h\)xit\(h\) Ie\(h\)sus,\(h\) \(,\) di\(f\)scí\(h\)pu\(gr\)lis\(gr\) su\(g\)is;\(h\.\) \(;\)/);
  assert.match(medRes.gabc, /in\(f\) nó\(h\)mi\(gr\)ne\(gr\) Dó\(g\)mi\(hr\)ni:\(h\.\) \(;\)/);
  assert.match(medRes.gabc, /Quó\(h\)ni\(h\)am\(h\) ip\(h\)só\(h\)rum\(h\) est\(h\) re\(fh\)gnum\(h\.\) cæ\(gr\)ló\(gh\)rum\.\(h\.\) \(::\)/);

  // Full stop (punctum): proparoxytone, paroxytone, polysyllabic oxytone, and monosyllabic final word;
  // also confirms next-to-last phrase falls back to punctum and only last phrase gets final.
  const proparoxytone = pointReading('Vidit Iesus Dóminum. Penúltima Dóminum. Ultima clávis est cælórum.', tone, {
    autoJoinShortPhrases: 0,
  });
  assert.equal(proparoxytone.warnings.length, 0);
  assert.equal(validateGabc(proparoxytone.gabc).valid, true);
  assert.match(proparoxytone.gabc, /Vi\(h\)dit\(h\) Ie\(h\)sus\(h\) Dó\(g\)mi\(gr\)num\.\(g\.\)/);
  assert.match(proparoxytone.gabc, /Pe\(h\)núl\(h\)ti\(h\)ma\(h\) Dó\(g\)mi\(gr\)num\.\(g\.\)/);
  assert.match(proparoxytone.gabc, /Ul\(h\)ti\(h\)ma\(h\) clá\(fh\)vis\(hr\) est\(h\.\) cæ\(gr\)ló\(gh\)rum\.\(h\.\)/);

  const paroxytone = pointReading('Dixit Iesus discípulis suis. Finális cláusula.', tone);
  assert.equal(validateGabc(paroxytone.gabc).valid, true);
  assert.match(paroxytone.gabc, /Di\(h\)xit\(h\) Ie\(h\)sus\(h\) di\(h\)scí\(h\)pu\(h\)lis\(h\) su\(g\)is\.\(g\.\)/);

  const oxytone = pointReading('Cantáte Dómino Amén. Venit usque ad Israël. Finális cláusula.', tone, {
    autoJoinShortPhrases: 0,
  });
  assert.equal(validateGabc(oxytone.gabc).valid, true);
  assert.match(oxytone.gabc, /Can\(h\)tá\(h\)te\(h\) Dó\(h\)mi\(h\)no\(h\) A\(h\)mén\.\(g\.\)/);
  assert.match(oxytone.gabc, /Ve\(h\)nit\(h\) us\(h\)que\(h\) ad\(h\) Is\(h\)raël\.\(g\.\)/);

  const monosyllable = pointReading('Sed ex Deo natus est. Finális cláusula.', tone);
  assert.equal(validateGabc(monosyllable.gabc).valid, true);
  assert.match(monosyllable.gabc, /Sed\(h\) ex\(h\) De\(h\)o\(h\) na\(h\)tus\(h\) est\.\(g\.\)/);

  // Question
  const question = pointReading('Quid enim dixit Iesus? Finális cláusula.', tone);
  assert.equal(question.warnings.length, 0);
  assert.equal(validateGabc(question.gabc).valid, true);
  assert.match(question.gabc, /Quid\(h\) e\(h\)nim\(h\.\) di\(gr\)xit\(f\) Ie\(g\)sus\?\(gh\.\.\)/);

  // Conclusion (final)
  const finalRes = pointReading('Dixit Iesus. Dóminus et Dóminum.', tone, { autoJoinShortPhrases: 0 });
  assert.equal(finalRes.warnings.length, 0);
  assert.equal(validateGabc(finalRes.gabc).valid, true);
  assert.match(finalRes.gabc, /Dó\(fh\)mi\(hr\)nus\(h\.\) et\(gr\) Dó\(gh\)mi\(hr\)num\.\(h\.\) \(::\)/);
});

test('questions are recited on SI and end with a podatus SI-DO in epistle and prophecy tones', () => {
  for (const id of ['prophecy', 'epistle']) {
    const tone = buildReadingTone(id)!;
    const r = pointReading('Dixit Iesus. Quis est iste?', tone, { autoJoinShortPhrases: 0 });
    assert.match(r.gabc, /\(i\) i\(ij\)ste\?\(j\.\)|\(h\) est\(i\) i\(ij\)ste\?\(j\.\)/, id);
  }
});

test('prophecy tone: flex on the last syllable, full stop falls a fifth, flat final', () => {
  const tone = buildReadingTone('prophecy')!;
  const r = pointReading(
    'Dixit Dominus ad serpentem, quia fecísti hoc. Maledictus es inter omnia animantia terrae.',
    tone,
    { autoJoinShortPhrases: 0 }
  );
  assert.equal(r.warnings.length, 0, r.warnings.join(' '));
  assert.match(r.gabc, /ser\(j\)pen\(j\)tem,\(i\.\)/, 'flex: DO-SI on the last syllable');
  assert.match(r.gabc, /cí\(j\)sti\(f\) hoc\.\(f\.\)/, 'full stop: DO on the last accent, then FA.');
  assert.match(r.gabc, /\(k\)/, 'RE on the next-to-last accent of the final phrase');
  assert.match(r.gabc, /\(xi\.\)/, 'flat SI at the end');
  assert.equal(validateGabc(r.gabc).valid, true);
});

import fs from 'node:fs';
import { compareGabc } from '@/src/lib/tones/compareGabc';

test('conditional prep notes and optional positional slots round-trip', () => {
  for (const spec of ['?g gf fg* g', 'recite=g; positional; ?g ?^f!gwh ?g fe ef g fg f']) {
    const c = parseCadence(spec)!;
    assert.ok(c, spec);
    assert.deepEqual(parseCadence(cadenceToString(c)), c);
  }
  assert.equal(parseCadence('g ?gf fg* g'), null, 'conditional slots must come first');
});

test('conditional prep note only after a stressed syllable', () => {
  const c = parseCadence('?g gf fg* g')!;
  // grá-ti-as á-ge-re: two syllables between the accents, so g gf
  let sy = toToneSyllables('grátias ágere');
  let n = applyCadence(sy, c);
  assert.equal(n.get(1), 'g');
  assert.equal(n.get(2), 'gf');
  // sa-lu-tá-re after an unstressed syllable: gf only
  sy = toToneSyllables('et salutáre');
  n = applyCadence(sy, c);
  assert.equal(n.has(1), false);
  assert.equal(n.get(2), 'gf');
});

test('solemn preface tone reproduces the Advent preface setting', () => {
  const tone = buildReadingTone('preface-solemn')!;
  assert.ok(tone);
  const text = fs.readFileSync('tests/fixtures/preface-advent-la/text.txt', 'utf8').trim();
  const ref = fs.readFileSync('tests/fixtures/preface-advent-la/expected.gabc', 'utf8');
  const r = pointReading(text, tone, { autoJoinShortPhrases: 0 });
  assert.equal(r.warnings.length, 0, r.warnings.join(' '));
  assert.equal(validateGabc(r.gabc).valid, true);
  const cmp = compareGabc(r.gabc, ref);
  assert.equal(cmp.totals.generatedSyllables, cmp.totals.expectedSyllables);
  assert.equal(cmp.totals.expectedSyllables, 205);
  assert.equal(
    cmp.totals.pitchMismatches,
    9,
    `${cmp.totals.pitchMismatches} syllable pitches differ (expected the 9 known ones)`
  );
  assert.equal(cmp.totals.summary, '173/205 syllables match');
});

// ---- Change C: folding post-accent notes on final accent ----
test('mergeNeumeNotes and applyCadence fold post notes on final accent, merge adjacent pitches, and keep trailing dot', () => {
  assert.equal(mergeNeumeNotes('fg', 'g'), 'fg');
  assert.equal(mergeNeumeNotes('fg', 'f'), 'fgf');
  assert.equal(mergeNeumeNotes('fg', 'g.'), 'fg.');
  assert.equal(mergeNeumeNotes('fg', 'f.'), 'fgf.');

  const cSame = parseCadence('?g gf fg* g')!;
  const sThanks = toToneSyllables('give you thanks,', { language: 'en' });
  const nThanks = applyCadence(sThanks, cSame);
  assert.equal(nThanks.get(sThanks.length - 1), 'fg');

  const cDiff = parseCadence('fg* f')!;
  const sLord = toToneSyllables('our Lord.', { language: 'en' });
  const nLord = applyCadence(sLord, cDiff);
  assert.equal(nLord.get(sLord.length - 1), 'fgf');

  const cDot = parseCadence('fg* f.')!;
  const nDot = applyCadence(sLord, cDot);
  assert.equal(nDot.get(sLord.length - 1), 'fgf.');
});

// ---- Change A & B: lines phrasing, language cadences, optional leading segment ----
test('phrasing: lines, punctum.en, and optional ? segment round-trip and point cleanly', () => {
  const c = parseCadence('recite=g; ?f!gwh* g / fe* ef g / fg* f')!;
  assert.ok(c);
  assert.equal(c.segments.length, 3);
  assert.equal(c.segments[0].optional, true);
  assert.deepEqual(parseCadence(cadenceToString(c)), c);

  const tone = buildReadingTone('preface-solemn')!;
  assert.equal(tone.phrasing, 'lines');
  const roundTripped = parseToneDefinition(toneToDefinition(tone));
  assert.equal(roundTripped.errors.length, 0, roundTripped.errors.join(' '));
  assert.equal(roundTripped.tone!.phrasing, 'lines');
  assert.ok(roundTripped.tone!.readingByLanguage?.en?.punctum);
  assert.ok(roundTripped.tone!.readingByLanguage?.en?.final);

  // Mid-line comma gives no cadence; mid-line semicolon ends phrase with metrum;
  // line-end without punct gives metrum; blank line marks paragraph break;
  // manual override replaces cadence kind.
  const sample = 'First part, second part; third part\n\nFourth part.';
  const phrases = extractReadingPhrases(sample, tone, { language: 'en' });
  assert.deepEqual(
    phrases.map((p) => [p.text, p.choiceLabel, p.paragraphBreak]),
    [
      ['First part, second part;', 'metrum', false],
      ['third part', 'long', false],
      ['Fourth part.', 'final', true],
    ]
  );

  const overridden = pointReading(sample, tone, {
    language: 'en',
    cadenceOverrides: { 5: null, 7: 'metrum' },
  });
  assert.equal(validateGabc(overridden.gabc).valid, true);
  assert.match(overridden.gabc, /third\(f\) part\(h\)/);
});

// ---- Acceptance tests for English Advent I preface ----
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

test('Acceptance 1: English syllabification counts, lexical stress, and overrides', () => {
  const expectedCounts: Record<string, number> = {
    our: 1, you: 1, through: 1, dare: 1, formed: 1, comes: 1,
    without: 2, heaven: 2, Powers: 2, always: 2, duty: 2, truly: 2,
    assumed: 2, opened: 2, again: 2, glory: 2, promise: 2, holy: 2,
    Father: 2, human: 2, fulfilled: 2, design: 2, acclaim: 2,
    eternal: 3, salvation: 3, everywhere: 3, almighty: 3, inherit: 3,
    majesty: 3, manifest: 3, lowliness: 3, Archangels: 3, Dominions: 3,
  };
  for (const [word, count] of Object.entries(expectedCounts)) {
    assert.equal(syllabifyEnglishWord(word).length, count, `${word} syllable count`);
  }

  const expectedStresses: Record<string, string> = {
    truly: 'TRU-ly',
    duty: 'DU-ty',
    salvation: 'sal-VA-tion',
    always: 'AL-ways',
    everywhere: 'EV-ery-where',
    eternal: 'e-TER-nal',
    almighty: 'al-MIGH-ty',
    holy: 'HO-ly',
    Father: 'FA-ther',
    assumed: 'as-SUMED',
    coming: 'COM-ing',
    lowliness: 'LOW-li-ness',
    human: 'HU-man',
    fulfilled: 'ful-FILLED',
    design: 'de-SIGN',
    ago: 'a-GO',
    opened: 'O-pened',
    again: 'a-GAIN',
    glory: 'GLO-ry',
    majesty: 'MAJ-es-ty',
    manifest: 'MAN-i-fest',
    promise: 'PROM-ise',
    inherit: 'in-HER-it',
    Angels: 'AN-gels',
    Archangels: 'ARCH-an-gels',
    Dominions: 'do-MIN-ions',
    Powers: 'POW-ers',
    heaven: 'HEAV-en',
    without: 'with-OUT',
    acclaim: 'AC-claim'.toLowerCase().replace('claim', 'CLAIM'),
  };
  for (const [word, pattern] of Object.entries(expectedStresses)) {
    const syl = toEnglishToneSyllables(word);
    const actual = syl.map((s) => (s.stressed ? s.text.toUpperCase() : s.text.toLowerCase())).join('-');
    assert.equal(actual, pattern, `${word} stress`);
  }

  const contentMono = ['right', 'just', 'thanks', 'Lord', 'God', 'Christ', 'flesh', 'long', 'way', 'last', 'day', 'hope', 'now', 'end', 'hymn', 'thrones', 'hosts'];
  for (const w of contentMono) {
    assert.equal(toEnglishToneSyllables(w)[0].stressed, true, `content monosyllable "${w}" stressed`);
  }

  const fnWords = ['it', 'is', 'and', 'our', 'to', 'you', 'the', 'of', 'for', 'he', 'his', 'at', 'so', 'we', 'who', 'that', 'may', 'in', 'which', 'with', 'all', 'I', 'my', 'thy', 'through'];
  for (const w of fnWords) {
    assert.equal(toEnglishToneSyllables(w)[0].stressed, false, `function word "${w}" unstressed`);
  }

  // Typed acute accent overrides stress; typed hyphen fixes split
  assert.deepEqual(toEnglishToneSyllables('glorý').map((s) => s.stressed), [false, true]);
  assert.deepEqual(syllabifyEnglishWord('ev-er-y-where'), ['ev', 'er', 'y', 'where']);
});

test('Acceptance 2: English Advent I preface has 18 phrases with expected cadence kinds', () => {
  const tone = buildReadingTone('preface-solemn')!;
  const phrases = extractReadingPhrases(ENGLISH_ADVENT_PREFACE, tone, { language: 'en' });
  assert.equal(phrases.length, 18);
  assert.deepEqual(
    phrases.map((p) => p.choiceLabel),
    [
      'metrum', 'flex', 'flex', 'long',
      'metrum', 'flex', 'flex', 'long',
      'metrum', 'flex', 'flex', 'flex', 'long',
      'metrum', 'flex', 'flex', 'flex', 'final',
    ]
  );
  assert.equal(phrases[4].paragraphBreak, true);
  assert.equal(phrases[13].paragraphBreak, true);
});

test('Acceptance 3: English Advent I preface specific GABC notes and intonations', () => {
  const tone = buildReadingTone('preface-solemn')!;
  const res = pointReading(ENGLISH_ADVENT_PREFACE, tone, { language: 'en' });
  assert.equal(res.warnings.length, 2, res.warnings.join(' '));
  assert.match(res.warnings[0], /glory and majesty.*legacy metrum/);
  assert.match(res.warnings[1], /Angels and Archangels.*legacy metrum/);
  assert.equal(validateGabc(res.gabc).valid, true);
  assert.match(res.gabc, /\(c3\)/);

  // Required cadence snippets under the new English preface rules (with Add-on A moras on h-metrum and g-long)
  assert.match(res.gabc, /sal\(f\)va\(fg\)tion,\(g\.\) \(;\)/);
  assert.match(res.gabc, /give\(f\) you\(g\) thanks,\(h\) \(,\)/);
  assert.match(res.gabc, /e\(g\)ter\(f\)nal\(g\) God,\(h\) \(,\)/);
  assert.match(res.gabc, /through\(fe\) Christ\(ef\) our\(g\) Lord\.\(f\.\) \(:\)/);
  assert.match(res.gabc, /now\(f\) we\(e\) dare\(ef\) to\(g\) hope\.\(f\.\) \(:\)/);

  // h-metrum phrases start on `f`; g-flex and g-long phrases recite on `g` with no `f` intonation
  const phrases = extractReadingPhrases(ENGLISH_ADVENT_PREFACE, tone, { language: 'en' });
  phrases.forEach((ph) => {
    const phEndWordIdx = ph.text.trim().split(/\s+/).filter(Boolean).length - 1;
    const single = pointReading(ph.text, tone, {
      language: 'en',
      roleOverrides: ph.effectiveRole ? { [phEndWordIdx]: ph.effectiveRole } : undefined,
    });
    const notes = [...single.gabc.split('(c3)')[1].matchAll(/\(([^,;:()]+)\)/g)].map((m) => m[1]);
    if (ph.effectiveRole === 'h-metrum') {
      assert.equal(notes[0], 'f', `h-metrum phrase ${ph.index + 1} starts on f`);
    } else if (notes.length > (ph.effectiveRole === 'g-flex' ? 3 : 5)) {
      assert.equal(notes[0], 'g', `${ph.effectiveRole} phrase ${ph.index + 1} recites on g`);
    } else {
      assert.notEqual(notes[0], 'f', `${ph.effectiveRole} short phrase ${ph.index + 1} has no h-line intonation`);
    }
  });
});

test('PREFACE_TONES is separate from READING_TONES and preface mode points and previews', () => {
  assert.deepEqual(
    READING_TONES.map((t) => t.id),
    ['prophecy', 'epistle', 'gospel']
  );
  assert.deepEqual(
    PREFACE_TONES.map((t) => t.id),
    ['preface-solemn']
  );

  const prefaceTone = buildPrefaceTone('preface-solemn')!;
  assert.ok(prefaceTone);
  assert.equal(buildReadingTone('preface-solemn')?.name, prefaceTone.name);

  const pointed = pointText('preface', ENGLISH_ADVENT_PREFACE, prefaceTone, { language: 'en' });
  assert.equal(pointed.warnings.length, 2);
  assert.equal(validateGabc(pointed.gabc).valid, true);
  assert.match(pointed.gabc, /through\(fe\) Christ\(ef\) our\(g\) Lord\.\(f\.\) \(:\)/);

  const previewRows = extractTonePreview('preface', ENGLISH_ADVENT_PREFACE, {
    language: 'en',
    tone: prefaceTone,
  });
  assert.equal(previewRows.length, 18);
});

import { loadVulgatePsalmText, VULGATE_ENTRIES } from '@/src/lib/tones/vulgatePsalms';

test('Vulgate psalm dataset resolves all 150 psalms, divisions, and canticles with * and † markers', async () => {
  for (let i = 1; i <= 150; i++) {
    const txt = await loadVulgatePsalmText(String(i));
    assert.ok(txt && txt.length > 20, `Psalm ${i} missing`);
    for (const line of txt.split('\n').filter(Boolean)) {
      assert.ok(line.includes('*'), `Psalm ${i} line missing *: ${line}`);
    }
  }

  const ps90 = (await loadVulgatePsalmText('90'))!;
  assert.ok(ps90.includes('†'), 'Psalm 90 should include flex † markers');
  assert.ok(ps90.includes('*'), 'Psalm 90 should include mediant * markers');

  const ps118_1 = (await loadVulgatePsalmText('118.1'))!;
  assert.equal(ps118_1.split('\n').filter(Boolean).length, 16, 'Psalm 118.1 has 16 verses');

  const ps148Joined = (await loadVulgatePsalmText('148 & 149 & 150 (monastic, Lauds)'))!;
  assert.ok(ps148Joined.includes('Laudáte Dóminum de cælis'));
  assert.ok(ps148Joined.includes('Laudáte Dóminum in sanctis ejus'));

  const magnificat = (await loadVulgatePsalmText('Magnificat'))!;
  assert.match(magnificat, /^Magníficat \* ánima mea Dóminum\./);

  const tone1D = buildPsalmTone('1', 'D')!;
  const pointed = pointPsalm(ps90, tone1D, { language: 'la' });
  assert.equal(validateGabc(pointed.gabc).valid, true);
  assert.ok(pointed.gabc.includes('†(,)'), 'flex marker should be rendered into GABC');
  assert.ok(pointed.gabc.includes('*(:)'), 'mediant marker should be rendered into GABC');
  assert.ok(VULGATE_ENTRIES.some((e) => e.id === '109' && e.group === 'psalm'));
  assert.ok(VULGATE_ENTRIES.some((e) => e.id === 'Magnificat' && e.group === 'canticle'));
});

const MAGNIFICAT_EXPECTED_FIRST_HALF: Array<[string, boolean, string]> = [
  ['1', false, 'Ma(f)gní(gh)fi(h)cat(h.)'],
  ['1', true, 'Ma(f)gní(gh)fi(h)cat(h.)'],
  ['2', false, 'Ma(e)gní(fe)fi(eh hr)cat(h.)'],
  ['2', true, 'Ma(e)gní(fe)fi(eh hr)cat(h.)'],
  ['3', false, 'Ma(g)gní(hj)fi(j)cat(j.)'],
  ['3', true, 'Ma(g)gní(hj)fi(j)cat(j.)'],
  ['4', false, 'Ma(h)gní(gh)fi(h)cat(h.)'],
  ['4', true, 'Ma(h)gní(gh)fi(h)cat(h.)'],
  ['5', false, 'Ma(d)gní(f)fi(h)cat(h.)'],
  ['5', true, 'Ma(d)gní(f)fi(h)cat(h.)'],
  ['6', false, 'Ma(f)gní(gh)fi(h)cat(h.)'],
  ['6', true, 'Ma(f)gní(gh)fi(h)cat(h.)'],
  ['7', false, 'Ma(hg)gní(hi)fi(i)cat(i.)'],
  ['7', true, 'Ma(ehg)gní(hi)fi(i)cat(i.)'],
  ['8', false, 'Ma(g)gní(h)fi(j)cat(j.)'],
  ['8', true, 'Ma(g)gní(hg)fi(gj)cat(j.)'],
  ['peregrinus', false, 'Ma(ixhi)gní(h)fi(h)cat(h.)'],
  ['irregularis', false, 'Ma(f)gní(gh)fi(h)cat(h.)'],
  ['in directum (romanus)', false, 'Ma(f)gní(h)fi(h)cat(h.)'],
  ['in directum (T.P.)', false, 'Ma(e)gní(f)fi(h)cat(h.)'],
];

test('Magnificat short first half-verse preserves intonation across all psalm tones and carries intonation to verse 2', async () => {
  const magnificat = (await loadVulgatePsalmText('Magnificat'))!;
  const tonesById = new Map(listPsalmTones().map((t) => [t.id, t]));
  for (const [id, solemn, expectedPrefix] of MAGNIFICAT_EXPECTED_FIRST_HALF) {
    const choice = tonesById.get(id)!;
    const tone = buildPsalmTone(id, choice.endings[0], solemn)!;
    const res = pointPsalm(magnificat, tone, { magnificat: true, repeatIntonation: false });
    assert.equal(validateGabc(res.gabc).valid, true, `${tone.name} valid GABC`);
    const verseLines = res.gabc.split('\n').filter((l) => l.includes('*(:)'));
    const firstHalf = verseLines[0].replace(/^\([^)]+\)\s*/, '').split(' *(:)')[0];
    assert.equal(firstHalf, expectedPrefix, `${tone.name} Magníficat first half`);
    if (tone.intonation.length > 0) {
      const v2FirstSylls = verseLines[1].split(' ').slice(0, 2).join(' ');
      assert.match(v2FirstSylls, /^Et\(/, `${tone.name} verse 2 starts on Et`);
      assert.ok(
        verseLines[1].startsWith(`Et(${tone.intonation[0]})`),
        `${tone.name} verse 2 keeps intonation (${verseLines[1]})`
      );
      assert.ok(
        verseLines[2].startsWith(`Qui(${tone.tenor})`),
        `${tone.name} verse 3 recites on tenor when repeatIntonation is false`
      );
    }
  }

  const repeated = pointPsalm(magnificat, buildPsalmTone('1', 'D')!, {
    magnificat: true,
    repeatIntonation: true,
  });
  const repLines = repeated.gabc.split('\n').filter((l) => l.includes('*(:)'));
  assert.ok(repLines[2].startsWith('Qui(f)a(gh)'), 'repeatIntonation repeats intonation on verse 3');
});

test('Magnificat first half-verse is identical across every ending for each tone number', async () => {
  const magnificat = (await loadVulgatePsalmText('Magnificat'))!;
  const expectedByToneAndSolemn = new Map(
    MAGNIFICAT_EXPECTED_FIRST_HALF.map(([id, solemn, prefix]) => [`${id}:${solemn}`, prefix])
  );

  for (const choice of listPsalmTones()) {
    for (const solemn of choice.hasSolemn ? [false, true] : [false]) {
      const expected = expectedByToneAndSolemn.get(`${choice.id}:${solemn}`);
      assert.ok(expected, `Expected entry missing for ${choice.id} solemn=${solemn}`);
      for (const ending of choice.endings) {
        const tone = buildPsalmTone(choice.id, ending, solemn)!;
        const res = pointPsalm(magnificat, tone, { magnificat: true, repeatIntonation: false });
        assert.equal(validateGabc(res.gabc).valid, true, `${tone.name} valid GABC`);
        const firstHalf = res.gabc
          .split('\n')
          .filter((l) => l.includes('*(:)'))[0]
          .replace(/^\([^)]+\)\s*/, '')
          .split(' *(:)')[0];
        assert.equal(firstHalf, expected, `${tone.name} Magníficat first half across endings`);
      }
    }
  }
});

test('Magnificat guard cases: tone 5 unchanged, non-magnificat tone 2 unchanged, and tone 2 verse 2 keeps e f', async () => {
  const magnificat = (await loadVulgatePsalmText('Magnificat'))!;

  const tone5Res = pointPsalm(magnificat, buildPsalmTone('5', '')!, { magnificat: true });
  const tone5FirstHalf = tone5Res.gabc
    .split('\n')
    .filter((l) => l.includes('*(:)'))[0]
    .replace(/^\([^)]+\)\s*/, '')
    .split(' *(:)')[0];
  assert.equal(tone5FirstHalf, 'Ma(d)gní(f)fi(h)cat(h.)');

  const tone2SimplePlain = pointPsalm(magnificat, buildPsalmTone('2', '', false)!, {
    repeatIntonation: false,
  });
  assert.equal(
    tone2SimplePlain.gabc
      .split('\n')
      .filter((l) => l.includes('*(:)'))[0]
      .replace(/^\([^)]+\)\s*/, '')
      .split(' *(:)')[0],
    'Ma(e)gní(f)fi(h)cat(h.)'
  );

  const tone2SolemnPlain = pointPsalm(magnificat, buildPsalmTone('2', '', true)!, {
    repeatIntonation: false,
  });
  assert.equal(
    tone2SolemnPlain.gabc
      .split('\n')
      .filter((l) => l.includes('*(:)'))[0]
      .replace(/^\([^)]+\)\s*/, '')
      .split(' *(:)')[0],
    'Ma(e)gní(fe)fi(eh)cat(h.)'
  );

  const tone2Mag = pointPsalm(magnificat, buildPsalmTone('2', '', false)!, {
    magnificat: true,
    repeatIntonation: false,
  });
  const verseLines = tone2Mag.gabc.split('\n').filter((l) => l.includes('*(:)'));
  assert.ok(verseLines[1].startsWith('Et(e) ex(f)sul(h)'), `Expected Et(e) ex(f)sul(h), got: ${verseLines[1]}`);
});

test('magnificat-intonation definition field round-trips and works on custom tones', () => {
  const custom = parseToneDefinition(
    'name: Custom Mag\nclef: f3\ntenor: h\nintonation: e f\nmagnificat-intonation: e | fe | eh hr\nmediant: i* h h.\ntermination: g e* f f.'
  );
  assert.equal(custom.errors.length, 0, custom.errors.join(' '));
  assert.deepEqual(custom.tone!.magnificatIntonation, ['e', 'fe', 'eh hr']);
  const serialized = toneToDefinition(custom.tone!);
  assert.match(serialized, /magnificat-intonation: e \| fe \| eh hr/);
  const back = parseToneDefinition(serialized);
  assert.equal(back.errors.length, 0, back.errors.join(' '));
  assert.deepEqual(back.tone!.magnificatIntonation, ['e', 'fe', 'eh hr']);

  const res = pointPsalm('Magníficat * ánima mea Dóminum.', back.tone!, { magnificat: true });
  assert.equal(validateGabc(res.gabc).valid, true);
  assert.match(res.gabc, /Ma\(e\)gní\(fe\)fi\(eh hr\)cat\(h\.\)/);

  const withoutKey = parseToneDefinition(
    'name: No Mag Key\nclef: f3\ntenor: h\nintonation: e f\nmediant: i* h h.\ntermination: g e* f f.'
  );
  assert.equal(withoutKey.errors.length, 0);
  assert.equal(withoutKey.tone!.magnificatIntonation, undefined);
});

test('short-tenor definition field round-trips and overrides short half-verse recitation pitch', () => {
  const custom = parseToneDefinition(
    'name: Custom Short\nclef: c3\ntenor: j\nshort-tenor: i\nintonation: hg hi\nmediant: k* j / i* j j.\ntermination: j* i i.'
  );
  assert.equal(custom.errors.length, 0);
  assert.equal(custom.tone!.shortTenor, 'i');
  const serialized = toneToDefinition(custom.tone!);
  assert.match(serialized, /short-tenor: i/);
  const back = parseToneDefinition(serialized);
  assert.equal(back.errors.length, 0);
  assert.equal(back.tone!.shortTenor, 'i');
  const res = pointPsalm('Magníficat * ánima mea Dóminum.', back.tone!);
  assert.match(res.gabc, /Ma\(hg\)gní\(hi\)fi\(i\)cat\(i\.\)/);
});

test('reading opening formula: None leaves epistle, gospel, and prophecy byte-identical', () => {
  const sample = 'Dóminus dixit ad me: Fílius meus es tu; ego hódie génui te.';
  for (const id of ['epistle', 'gospel', 'prophecy'] as const) {
    const tone = buildReadingTone(id)!;
    const base = pointReading(sample, tone);
    const withEmpty = pointReading(sample, tone, { openingFormula: '' });
    const withSpaces = pointReading(sample, tone, { openingFormula: '   ' });
    assert.equal(withEmpty.gabc, base.gabc, `${id} empty openingFormula`);
    assert.equal(withSpaces.gabc, base.gabc, `${id} whitespace openingFormula`);
  }
});

test('reading opening formula: applies tone metrum/flexa rules across gospel, prophecy, and epistle without affecting body', () => {
  const multiPhrase = 'Dóminus dixit ad me: Fílius meus es tu; ego hódie génui te.';
  const onePhrase = 'Dóminus dixit ad me.';

  const gospel = buildReadingTone('gospel')!;
  const prophecy = buildReadingTone('prophecy')!;
  const epistle = buildReadingTone('epistle')!;

  const gInIllo = pointReading(multiPhrase, gospel, { openingFormula: 'In illo témpore:' });
  assert.equal(validateGabc(gInIllo.gabc).valid, true);
  assert.ok(
    gInIllo.gabc.includes('In(f) il(h)lo(gr) tém(g)po(hr)re:(h.)'),
    `Expected Gospel metrum on "In illo témpore:", got: ${gInIllo.gabc}`
  );

  const pInDiebus = pointReading(multiPhrase, prophecy, { openingFormula: 'In diébus illis,' });
  assert.equal(validateGabc(pInDiebus.gabc).valid, true);
  assert.ok(
    pInDiebus.gabc.includes('In(j) di(j)é(j)bus(j) il(j)lis,(i.)'),
    `Expected Prophecy flexa on "In diébus illis,", got: ${pInDiebus.gabc}`
  );

  const eFratres = pointReading(multiPhrase, epistle, { openingFormula: 'Fratres,' });
  assert.equal(validateGabc(eFratres.gabc).valid, true);
  assert.ok(
    eFratres.gabc.includes('Fra(j)tres,(j)'),
    `Expected Epistle tenor on "Fratres,", got: ${eFratres.gabc}`
  );

  const eCarissime = pointReading(multiPhrase, epistle, { openingFormula: 'Caríssime,' });
  assert.equal(validateGabc(eCarissime.gabc).valid, true);
  assert.ok(
    eCarissime.gabc.includes('Ca(j)rís(j)si(j)me,(j)'),
    `Expected Epistle tenor on "Caríssime,", got: ${eCarissime.gabc}`
  );

  // Every tone × every formula matches pointing "<formula> <body...>" directly and preserves body GABC.
  const stripHeader = (gabc: string) => gabc.split('%%\n')[1]?.replace(/^\([^)]+\)\s*/, '').trim() ?? '';
  for (const tone of [gospel, prophecy, epistle]) {
    const baseBody = stripHeader(pointReading(multiPhrase, tone).gabc);
    for (const formula of READING_OPENING_FORMULAS) {
      const res = pointReading(multiPhrase, tone, { openingFormula: formula.text });
      assert.equal(validateGabc(res.gabc).valid, true, `${tone.name} + ${formula.text}`);
      const direct = pointReading(`${formula.text} ${multiPhrase}`, tone);
      assert.equal(res.gabc, direct.gabc, `${tone.name} + ${formula.text} matches direct concatenation`);
      assert.ok(
        stripHeader(res.gabc).endsWith(baseBody),
        `${tone.name} + ${formula.text} preserves body pointing:\n  got: ${stripHeader(res.gabc)}\n  end: ${baseBody}`
      );
    }
  }

  // Single-phrase reading: formula must NOT get prefinal or final; body phrase still gets final.
  const eSingleBase = stripHeader(pointReading(onePhrase, epistle).gabc);
  const eSingleWithFratres = stripHeader(
    pointReading(onePhrase, epistle, { openingFormula: 'Fratres,' }).gabc
  );
  assert.equal(eSingleWithFratres, `Fra(j)tres,(j) (,) ${eSingleBase}`);

  const gSingleBase = stripHeader(pointReading(onePhrase, gospel).gabc);
  const gSingleWithInIllo = stripHeader(
    pointReading(onePhrase, gospel, { openingFormula: 'In illo témpore:' }).gabc
  );
  assert.equal(gSingleWithInIllo, `In(f) il(h)lo(gr) tém(g)po(hr)re:(h.) (;) ${gSingleBase}`);
});

test('reading opening formula: preview, cadenceOverrides, empty-text & language/mode guards, and migration', () => {
  const epistle = buildReadingTone('epistle')!;
  const text = 'Dóminus dixit ad me.';

  // Empty text box still warns rather than emitting a bare formula
  assert.equal(pointReading('   ', epistle, { openingFormula: 'Fratres,' }).gabc, '');

  // Phrase 0 is the opening formula and accepts cadenceOverrides + preview syllable indexing
  const phrases = extractReadingPhrases(text, epistle, {
    language: 'la',
    openingFormula: 'Fratres,',
  });
  assert.equal(phrases.length, 2);
  assert.equal(phrases[0].text, 'Fratres,');
  assert.equal(phrases[0].effectiveKind, 'flex');
  assert.equal(phrases[1].effectiveKind, 'final');

  const prophecy = buildReadingTone('prophecy')!;
  const overriddenProphecy = pointReading(text, prophecy, {
    language: 'la',
    openingFormula: 'Fratres,',
    cadenceOverrides: { 0: 'punctum' },
  });
  assert.ok(
    overriddenProphecy.gabc.includes('Fra(j)tres,(f.)'),
    `Expected punctum override with mora on Fra-tres: ${overriddenProphecy.gabc}`
  );

  const overriddenEpistle = pointReading(text, epistle, {
    language: 'la',
    openingFormula: 'In illo témpore:',
    cadenceOverrides: { 2: 'flex' },
  });
  assert.ok(
    overriddenEpistle.gabc.includes('In(j) il(j)lo(j) tém(j)po(j)re:(j)'),
    `Expected flex override on In illo témpore: ${overriddenEpistle.gabc}`
  );

  const previewRows = extractTonePreview('reading', text, {
    language: 'la',
    tone: epistle,
    openingFormula: 'Fratres,',
  });
  assert.equal(previewRows.length, 1);
  const previewTexts = previewRows[0]
    .filter((t) => t.kind === 'syllable')
    .map((t) => (t.kind === 'syllable' ? t.text : ''));
  assert.deepEqual(previewTexts.slice(0, 2), ['Fra', 'tres,']);

  // English reading ignores Latin opening formula even if passed
  const enBase = pointReading('The Lord said to me.', epistle, { language: 'en' });
  const enWithFormula = pointReading('The Lord said to me.', epistle, {
    language: 'en',
    openingFormula: 'Fratres,',
  });
  assert.equal(enWithFormula.gabc, enBase.gabc);

  // Saved state migration & defaults
  assert.deepEqual(migrateSavedReadingOpeningFormula({}), {
    readingOpeningFormula: '',
    readingOpeningFormulaTouched: false,
  });
  assert.equal(
    migrateSavedReadingOpeningFormula({ readingOpeningFormula: 'in-illo-tempore' }).readingOpeningFormulaTouched,
    true
  );
  assert.equal(normalizeReadingOpeningFormula('unknown'), '');
  assert.equal(getReadingOpeningFormulaText('carissime'), 'Caríssime,');
  assert.deepEqual(DEFAULT_READING_OPENING_FORMULA, {
    gospel: 'in-illo-tempore',
    prophecy: 'in-diebus-illis',
    epistle: 'fratres',
  });
});

test('Latin reading bars: comma -> (,), colon/semicolon -> (;), full stop/question -> (:), final -> (::) with no doubling', () => {
  const reading =
    'In illo témpore, dixit Iesus discípulis suis: Hoc est mandátum meum; ut diligátis ínvicem. Quid ergo fáciet Dóminus? Veniet et salvábit nos.';
  for (const id of ['epistle', 'gospel', 'prophecy'] as const) {
    const tone = buildReadingTone(id)!;
    const res = pointReading(reading, tone, { autoJoinShortPhrases: 0 });
    assert.equal(validateGabc(res.gabc).valid, true, `${id} valid GABC`);
    const body = res.gabc.split('%%\n')[1]!.replace(/^\([^)]+\)\s*/, '').trim();
    const bars = [...body.matchAll(/\(([,;:]+)\)/g)].map((m) => m[1]);
    assert.deepEqual(bars, [',', ';', ';', ':', ':', '::'], `${id} phrase bars`);
    assert.doesNotMatch(body, /\(::\)\s*\(::\)/, `${id} does not double final (::)`);
    assert.ok(body.endsWith('(::)'), `${id} ends with (::)`);
  }

  // Single-phrase reading ends with (::) and no intermediate bar
  const single = pointReading('Dóminus dixit ad me.', buildReadingTone('gospel')!);
  const singleBars = [...single.gabc.split('%%\n')[1]!.matchAll(/\(([,;:]+)\)/g)].map((m) => m[1]);
  assert.deepEqual(singleBars, ['::']);

  // Cadence override drives the bar when overridden, and prefinal keeps sentence-end punctuation bar
  const epistle = buildReadingTone('epistle')!;
  const overridden = pointReading('Prima pars. Secúnda pars.', epistle, {
    cadenceOverrides: { 1: 'metrum' },
    autoJoinShortPhrases: 0,
  });
  const overriddenBars = [...overridden.gabc.split('%%\n')[1]!.matchAll(/\(([,;:]+)\)/g)].map((m) => m[1]);
  assert.deepEqual(overriddenBars, [';', '::']);

  // English reading emits bars using the same barForCadence rule (including prefinal -> (;))
  const enReading = pointReading('In the beginning, God created heaven; and earth. Who is like him?', epistle, {
    language: 'en',
    autoJoinShortPhrases: 0,
  });
  const enBars = [...enReading.gabc.split('%%\n')[1]!.matchAll(/\(([,;:]+)\)/g)].map((m) => m[1]);
  assert.deepEqual(enBars, [',', ';', ';', '::']);

  const gospelEn = pointReading('In the beginning, God created heaven; and earth. Who is like him?', buildReadingTone('gospel')!, {
    language: 'en',
    autoJoinShortPhrases: 0,
  });
  const gospelEnBars = [...gospelEn.gabc.split('%%\n')[1]!.matchAll(/\(([,;:]+)\)/g)].map((m) => m[1]);
  assert.deepEqual(gospelEnBars, [',', ';', ':', '::']);

  // Latin preface (lines phrasing) emits bars via barForCadence, and none override omits the bar
  const latinPrefaceTone = buildReadingTone('preface-solemn')!;
  const laPreface = pointReading('Vere dignum et iustum est, æquum et salutáre; Dómino Deo nostro.', latinPrefaceTone, {
    language: 'la',
    autoJoinShortPhrases: 0,
  });
  const laPrefBars = [...laPreface.gabc.split('%%\n')[1]!.matchAll(/\(([,;:]+)\)/g)].map((m) => m[1]);
  assert.deepEqual(laPrefBars, [',', ';', '::']);

  const laPrefaceNoneOverride = pointReading(
    'Vere dignum et iustum est; Dómino Deo nostro.',
    latinPrefaceTone,
    { language: 'la', cadenceOverrides: { 4: null }, autoJoinShortPhrases: 0 }
  );
  const laPrefNoneBars = [
    ...laPrefaceNoneOverride.gabc.split('%%\n')[1]!.matchAll(/\(([,;:]+)\)/g),
  ].map((m) => m[1]);
  assert.deepEqual(laPrefNoneBars, ['::']);
});

test('psalm bars: flex uses †(,), mediant uses *(:), and verse end uses (::)', () => {
  const tone = buildPsalmTone('1', 'D')!;
  const res = pointPsalm(
    'Beátus vir qui non ábiit in consílio impiórum † et in via peccatórum non stetit * et in cáthedra pestiléntiae non sedit.',
    tone
  );
  assert.equal(validateGabc(res.gabc).valid, true);
  assert.ok(res.gabc.includes('†(,)'), 'flex keeps (,)');
  assert.ok(res.gabc.includes('*(:)'), 'mediant uses (:)');
  assert.ok(!res.gabc.includes('*(;)'), 'mediant no longer uses (;)');
  assert.ok(res.gabc.includes('(::) (Z)'), 'verse end keeps (::)');
});

import { barForCadence } from '@/src/lib/tones/pointing';
import { parseSavedToneSettings } from '@/src/components/TonePanel';
import {
  applyPhraseCadenceChoiceOverride,
  cadenceSpecToPreviewTokens,
  choiceLabelToKind,
  formValuesToTone,
  getPhraseCadenceChoiceLabel,
  getReadingCadenceDisplayLabel,
  getValidPhraseCadenceChoices,
  mapDefinitionErrorToField,
  toneToFormValues,
} from '@/src/lib/tones/toneUi';

test('phrase cadence labels map every ReadingCadenceKind and PhraseCadenceChoice to plain-language labels', () => {
  assert.equal(getReadingCadenceDisplayLabel(null), 'Keep reciting');
  assert.equal(getReadingCadenceDisplayLabel('flex'), 'Light pause ,');
  assert.equal(getReadingCadenceDisplayLabel('metrum'), 'Pause ;');
  assert.equal(getReadingCadenceDisplayLabel('prefinal'), 'Near the end');
  assert.equal(getReadingCadenceDisplayLabel('punctum'), 'Full stop .');
  assert.equal(getReadingCadenceDisplayLabel('question'), 'Question ?');
  assert.equal(getReadingCadenceDisplayLabel('final'), 'Ending');

  assert.equal(getPhraseCadenceChoiceLabel('none'), 'Keep reciting');
  assert.equal(getPhraseCadenceChoiceLabel('flex'), 'Light pause ,');
  assert.equal(getPhraseCadenceChoiceLabel('metrum'), 'Pause ;');
  assert.equal(getPhraseCadenceChoiceLabel('prefinal'), 'Near the end');
  assert.equal(getPhraseCadenceChoiceLabel('long'), 'Full stop .');
  assert.equal(getPhraseCadenceChoiceLabel('question'), 'Question ?');
  assert.equal(getPhraseCadenceChoiceLabel('final'), 'Ending');
});

test('selecting a cadence from the menu produces identical cadenceOverrides state and clears when matching default', () => {
  const defaultLatinOrder = getValidPhraseCadenceChoices({ isEnglishPreface: false, hasQuestion: true });
  assert.deepEqual(defaultLatinOrder, ['none', 'flex', 'metrum', 'long', 'question', 'final']);
  assert.deepEqual(
    getValidPhraseCadenceChoices({ isEnglishPreface: false, hasQuestion: false }),
    ['none', 'flex', 'metrum', 'long', 'final']
  );
  assert.deepEqual(
    getValidPhraseCadenceChoices({ isEnglishPreface: true, hasQuestion: true }),
    ['none', 'metrum', 'flex', 'long']
  );

  // Simulate choosing each item on phrase 1 whose default is 'metrum'
  let overrides: Record<number, import('@/src/lib/tones/tone').ReadingCadenceKind | null> = {};
  overrides = applyPhraseCadenceChoiceOverride(overrides, 1, 'long', 'metrum');
  assert.deepEqual(overrides, { 1: 'punctum' });
  assert.equal(choiceLabelToKind('long'), 'punctum');

  overrides = applyPhraseCadenceChoiceOverride(overrides, 1, 'none', 'metrum');
  assert.deepEqual(overrides, { 1: null });

  // Choosing the phrase's default cadence deletes the override entry
  overrides = applyPhraseCadenceChoiceOverride(overrides, 1, 'metrum', 'metrum');
  assert.deepEqual(overrides, {});
});

test('Customize tone form round-trip leaves reading, psalm, and preface tones unchanged', () => {
  for (const id of ['prophecy', 'epistle', 'gospel'] as const) {
    const tone = buildReadingTone(id)!;
    const form = toneToFormValues(tone, 'la');
    const converted = formValuesToTone(form, tone, 'reading', 'la');
    assert.deepEqual(converted.fieldErrors, {}, `${id} should have no field errors`);
    assert.ok(converted.tone, `${id} should produce a ToneDefinition`);
    const text = toneToDefinition(converted.tone!);
    const reparsed = parseToneDefinition(text);
    assert.equal(reparsed.errors.length, 0, `${id} reparse errors`);
    assert.deepEqual(toneToFormValues(reparsed.tone!, 'la'), form, `${id} form round-trip`);
  }

  for (const [id, ending] of [
    ['1', 'D'],
    ['2', ''],
    ['peregrinus', ''],
  ] as const) {
    const tone = buildPsalmTone(id, ending)!;
    const form = toneToFormValues(tone, 'la');
    const converted = formValuesToTone(form, tone, 'psalm', 'la');
    assert.deepEqual(converted.fieldErrors, {}, `psalm ${id} should have no field errors`);
    const reparsed = parseToneDefinition(toneToDefinition(converted.tone!));
    assert.equal(reparsed.errors.length, 0, `psalm ${id} reparse errors`);
    assert.deepEqual(toneToFormValues(reparsed.tone!, 'la'), form, `psalm ${id} form round-trip`);
  }

  const prefaceTone = buildReadingTone('preface-solemn')!;
  for (const lang of ['la', 'en'] as const) {
    const form = toneToFormValues(prefaceTone, lang);
    const converted = formValuesToTone(form, prefaceTone, 'preface', lang);
    assert.deepEqual(converted.fieldErrors, {}, `preface (${lang}) no field errors`);
    const reparsed = parseToneDefinition(toneToDefinition(converted.tone!));
    assert.equal(reparsed.errors.length, 0, `preface (${lang}) reparse errors`);
    assert.deepEqual(toneToFormValues(reparsed.tone!, lang), form, `preface (${lang}) form round-trip`);
  }
});

test('Customize tone form inline validation reports errors under the offending field', () => {
  const gospel = buildReadingTone('gospel')!;
  const baseForm = toneToFormValues(gospel, 'la');

  const badTenor = formValuesToTone({ ...baseForm, tenor: 'zz' }, gospel, 'reading', 'la');
  assert.equal(badTenor.tone, undefined);
  assert.ok(badTenor.fieldErrors.tenor, 'invalid tenor produces tenor field error');

  const badMetrum = formValuesToTone({ ...baseForm, metrum: 'bad$$' }, gospel, 'reading', 'la');
  assert.equal(badMetrum.tone, undefined);
  assert.ok(badMetrum.fieldErrors.metrum, 'invalid metrum produces metrum field error');

  const tone1 = buildPsalmTone('1', 'D')!;
  const psalmForm = toneToFormValues(tone1, 'la');
  const badTerm = formValuesToTone({ ...psalmForm, termination: '' }, tone1, 'psalm', 'la');
  assert.equal(badTerm.tone, undefined);
  assert.ok(badTerm.fieldErrors.termination, 'empty termination produces termination field error');

  assert.equal(mapDefinitionErrorToField('Unknown key "punctum." syntax'), 'punctum');
  assert.equal(mapDefinitionErrorToField('Could not understand clef "x9".'), 'clef');

  // Mini preview tokens parse positional and accented cadences cleanly
  const nonePreview = cadenceSpecToPreviewTokens('none', 'h');
  assert.equal(nonePreview?.isNone, true);
  const positionalPreview = cadenceSpecToPreviewTokens('positional; h. gr f g gh..', 'h');
  assert.equal(positionalPreview?.slots.length, 5);
  assert.equal(positionalPreview?.slots.some((s) => s.accent), false);
});

test('Latin preface pointing treats single line breaks as soft wraps by default, starts phrases after ; : . (not ,), and honors treatLineBreaksAsPhraseBreaks', () => {
  const prefaceTone = buildReadingTone('preface-solemn')!;
  const wrapped = `Vere dignum et justum est,
ǽquum et salutáre, nos tibi semper,
et ubíque grátias ágere: Dómine sancte,
Pater omnípotens, ætérne Deus.

Et ídeo, cum Angelis et Archángelis;
hymnum glóriæ tuæ cánimus.`;

  const oneLine =
    'Vere dignum et justum est, ǽquum et salutáre, nos tibi semper, et ubíque grátias ágere: Dómine sancte, Pater omnípotens, ætérne Deus.\n\nEt ídeo, cum Angelis et Archángelis; hymnum glóriæ tuæ cánimus.';

  const wrappedPhrases = extractReadingPhrases(wrapped, prefaceTone, {
    language: 'la',
    autoJoinShortPhrases: 0,
  });
  const oneLinePhrases = extractReadingPhrases(oneLine, prefaceTone, {
    language: 'la',
    autoJoinShortPhrases: 0,
  });
  assert.deepEqual(wrappedPhrases, oneLinePhrases);
  assert.deepEqual(
    wrappedPhrases.map((p) => [p.choiceLabel, p.paragraphBreak]),
    [
      ['flex', false],
      ['flex', false],
      ['flex', false],
      ['metrum', false],
      ['flex', false],
      ['flex', false],
      ['long', false],
      ['flex', true],
      ['metrum', false],
      ['final', false],
    ]
  );

  const wrappedPointed = pointReading(wrapped, prefaceTone, { language: 'la', autoJoinShortPhrases: 0 });
  const oneLinePointed = pointReading(oneLine, prefaceTone, { language: 'la', autoJoinShortPhrases: 0 });
  assert.equal(wrappedPointed.gabc, oneLinePointed.gabc);
  // Also identical under default N=3 auto-join
  assert.equal(
    pointReading(wrapped, prefaceTone, { language: 'la' }).gabc,
    pointReading(oneLine, prefaceTone, { language: 'la' }).gabc
  );
  // Words after commas stay on tenor h (no f intonation), whereas phrase after `:` starts on f
  assert.match(wrappedPointed.gabc, /ǽ\(h\)quum\(h\)/);
  assert.match(wrappedPointed.gabc, /et\(h\) u\(h\)bí\(h\)que\(h\)/);
  assert.match(wrappedPointed.gabc, /Dó\(f\)mi\(h\)ne\(h\)/);

  const lineBreaksOnPhrases = extractReadingPhrases(wrapped, prefaceTone, {
    language: 'la',
    treatLineBreaksAsPhraseBreaks: true,
    autoJoinShortPhrases: 0,
  });
  assert.equal(lineBreaksOnPhrases.length, 7);
  assert.equal(lineBreaksOnPhrases[0].choiceLabel, 'metrum');
});

test('barForCadence maps every cadence kind + last-of-text flag and saved prefaceLineBreaksAsPhrases defaults per language', () => {
  assert.equal(barForCadence(null, false), null);
  assert.equal(barForCadence(undefined, false), null);
  assert.equal(barForCadence('flex', false), ',');
  assert.equal(barForCadence('metrum', false), ';');
  assert.equal(barForCadence('prefinal', false), ';');
  assert.equal(barForCadence('punctum', false), ':');
  assert.equal(barForCadence('question', false), ':');
  assert.equal(barForCadence('final', false), ':');
  assert.equal(barForCadence(null, true), '::');
  assert.equal(barForCadence('metrum', true), '::');

  // Saved settings defaults & migration: Latin false, English true
  assert.deepEqual(parseSavedToneSettings({}).prefaceLineBreaksAsPhrases, { la: false, en: true });
  assert.deepEqual(
    parseSavedToneSettings({ prefaceLineBreaksAsPhrases: true }).prefaceLineBreaksAsPhrases,
    { la: true, en: true }
  );
  assert.deepEqual(
    parseSavedToneSettings({ prefaceLineBreaksAsPhrases: { la: true, en: false } })
      .prefaceLineBreaksAsPhrases,
    { la: true, en: false }
  );
});

test('Preface comma splitting: flex default, (,) (,) (;) bars, reintone rule, override round-trip, and flex vs none distinction', () => {
  const prefaceTone = buildReadingTone('preface-solemn')!;

  // 1. Comma splits into flex phrases with (,) (,) (;) when followed by continuation (with auto-join off for exact unjoined phrases)
  const sample =
    'Vere dignum et justum est, aequum et salutare, nos tibi semper et ubique gratias agere: Domine, sancte Pater.';
  const phrases = extractReadingPhrases(sample, prefaceTone, { language: 'la', autoJoinShortPhrases: 0 });
  assert.deepEqual(
    phrases.slice(0, 3).map((p) => [p.text, p.effectiveKind, p.choiceLabel, p.startsPhrase]),
    [
      ['Vere dignum et justum est,', 'flex', 'flex', true],
      ['aequum et salutare,', 'flex', 'flex', false],
      ['nos tibi semper et ubique gratias agere:', 'metrum', 'metrum', false],
    ]
  );
  // Phrase after `:` (index 3) DOES start a new phrase with intonation
  assert.equal(phrases[3].startsPhrase, true);

  const pointed = pointReading(sample, prefaceTone, { language: 'la', autoJoinShortPhrases: 0 });
  const bars = [...pointed.gabc.split('%%\n')[1]!.matchAll(/\(([,;:]+)\)/g)].map((m) => m[1]);
  assert.deepEqual(bars.slice(0, 3), [',', ',', ';']);

  // Also test the exact three-phrase string on its own (last phrase of whole text upgrades to final / ::)
  const threeOnly =
    'Vere dignum et justum est, aequum et salutare, nos tibi semper et ubique gratias agere:';
  const threePhrases = extractReadingPhrases(threeOnly, prefaceTone, {
    language: 'la',
    autoJoinShortPhrases: 0,
  });
  assert.deepEqual(
    threePhrases.map((p) => p.defaultKind),
    ['flex', 'flex', 'final']
  );

  // 2. First syllable after comma does NOT take intonation; after semicolon or colon it DOES
  const commaVsSemiColon =
    'Prima pars huius textus, secunda pars nostrae orationis; tertia pars sancti evangelii: quarta pars eiusdem textus.';
  const cscPhrases = extractReadingPhrases(commaVsSemiColon, prefaceTone, { language: 'la' });
  assert.deepEqual(
    cscPhrases.map((p) => p.startsPhrase),
    [true, false, true, true]
  );
  const cscPointed = pointReading(commaVsSemiColon, prefaceTone, { language: 'la' });
  assert.match(cscPointed.gabc, /^name:[\s\S]*Pri\(f\)ma\(h\)/);
  assert.match(cscPointed.gabc, /se\(h\)cun\(h\)da\(h\)/);
  assert.match(cscPointed.gabc, /ter\(f\)ti\(h\)a\(h\)/);
  assert.match(cscPointed.gabc, /quar\(f\)ta\(g\)/);

  // 3. Changing a comma phrase to metrum gives metrum notes + (;) and reintones next phrase; changing back to flex restores original
  const phrase0Key = phrases[0].endWordIndex;
  const toMetrumOverrides = applyPhraseCadenceChoiceOverride({}, phrase0Key, 'metrum', phrases[0].defaultKind);
  assert.deepEqual(toMetrumOverrides, { [phrase0Key]: 'metrum' });
  const withMetrum = pointReading(sample, prefaceTone, {
    language: 'la',
    cadenceOverrides: toMetrumOverrides,
    autoJoinShortPhrases: 0,
  });
  const metrumBars = [...withMetrum.gabc.split('%%\n')[1]!.matchAll(/\(([,;:]+)\)/g)].map((m) => m[1]);
  assert.equal(metrumBars[0], ';');
  assert.notEqual(withMetrum.gabc, pointed.gabc);
  assert.match(withMetrum.gabc, /ae\(f\)quum\(h\)/, 'phrase after overridden metrum now takes f intonation');

  const backToFlexOverrides = applyPhraseCadenceChoiceOverride(
    toMetrumOverrides,
    phrase0Key,
    'flex',
    phrases[0].defaultKind
  );
  assert.deepEqual(backToFlexOverrides, {});
  const restored = pointReading(sample, prefaceTone, {
    language: 'la',
    cadenceOverrides: backToFlexOverrides,
    autoJoinShortPhrases: 0,
  });
  assert.equal(restored.gabc, pointed.gabc);

  // 4. flex and none stay distinct choices for solemn preface (bar (,) & no next intonation vs no bar & next intonation)
  const withNone = pointReading(sample, prefaceTone, {
    language: 'la',
    cadenceOverrides: { [phrase0Key]: null },
    autoJoinShortPhrases: 0,
  });
  const nonePhrases = extractReadingPhrases(sample, prefaceTone, {
    language: 'la',
    cadenceOverrides: { [phrase0Key]: null },
    autoJoinShortPhrases: 0,
  });
  assert.equal(nonePhrases[0].choiceLabel, 'none');
  assert.equal(nonePhrases[1].startsPhrase, true);
  assert.notEqual(withNone.gabc, pointed.gabc);
  const noneBars = [...withNone.gabc.split('%%\n')[1]!.matchAll(/\(([,;:]+)\)/g)].map((m) => m[1]);
  assert.deepEqual(noneBars, [',', ';', ',', '::']);

  // 5. Unpunctuated trailing clause defaults to 'none' with no bar
  const unpunctuated = extractReadingPhrases('Prima pars, sine fine', prefaceTone, {
    language: 'la',
    autoJoinShortPhrases: 0,
  });
  assert.deepEqual(
    unpunctuated.map((p) => p.choiceLabel),
    ['flex', 'none']
  );

  // 6. Wrapped vs unwrapped versions of the same text produce identical output
  const wrappedSame =
    'Vere dignum et justum est,\naequum et salutare,\nnos tibi semper et ubique gratias agere:\nDomine, sancte Pater.';
  assert.equal(
    pointReading(wrappedSame, prefaceTone, { language: 'la', autoJoinShortPhrases: 0 }).gabc,
    pointed.gabc
  );
});

// ---- Add-on A & Add-on B Tests ----
import {
  countRealWords,
  joinPhraseBreak,
  remapPhraseBreakKeys,
  restoreBreakWithForcedBreaks,
  splitPhraseWithForcedBreaks,
} from '@/src/lib/tones/pointing';
import { buildPrefaceTone as buildPrefTone } from '@/src/lib/tones/readingTones';
import { assemblePreface, splitPreface } from '@/src/lib/tones/prefaceSplit';
import { SEED_PREFACE_TEMPLATES } from '@/src/lib/tones/prefaceTemplates';

function getPhraseTailTokens(gabc: string): { lastNote: string; bar: string | null }[] {
  const body = gabc.split('%%\n')[1]?.replace(/^\([^)]+\)\s*/, '').trim() ?? '';
  const tokens = body.split(/\s+/).filter(Boolean);
  const res: { lastNote: string; bar: string | null }[] = [];
  let lastNote = '';
  for (const tok of tokens) {
    const barM = tok.match(/^\(([,;:]+)\)$/);
    if (barM) {
      res.push({ lastNote, bar: barM[1] });
      lastNote = '';
    } else {
      const notes = [...tok.matchAll(/\(([^)]+)\)/g)].map((m) => m[1]);
      if (notes.length > 0) lastNote = notes[notes.length - 1];
    }
  }
  if (lastNote) res.push({ lastNote, bar: null });
  return res;
}

test('Add-on A: mora follows effective termination across every reading tone & preface tone, and toggles with bar on changes/merges', () => {
  const sample =
    'Prima pars huius textus, secúnda pars huius textus; tértia pars huius textus: quarta pars huius textus. Quid est hoc quod loquitur? Ultima pars eiusdem textus.';
  const tones = [
    ['prophecy', buildReadingTone('prophecy')!],
    ['epistle', buildReadingTone('epistle')!],
    ['gospel', buildReadingTone('gospel')!],
    ['preface-solemn', buildPrefTone('preface-solemn')!],
  ] as const;

  for (const [id, tone] of tones) {
    const phrases = extractReadingPhrases(sample, tone, { language: 'la', autoJoinShortPhrases: 0 });
    const res = pointReading(sample, tone, { language: 'la', autoJoinShortPhrases: 0 });
    const tails = getPhraseTailTokens(res.gabc);
    const barBearingPhrases = phrases.filter((p, i) => i === phrases.length - 1 || p.effectiveKind !== null);
    assert.equal(tails.length, barBearingPhrases.length, `${id} phrase tail count`);

    barBearingPhrases.forEach((ph, i) => {
      const tail = tails[i];
      if (
        ph.effectiveKind === 'metrum' ||
        ph.effectiveKind === 'punctum' ||
        ph.effectiveKind === 'question' ||
        ph.effectiveKind === 'prefinal' ||
        ph.effectiveKind === 'final'
      ) {
        assert.ok(
          tail.lastNote.endsWith('.'),
          `${id} phrase ${i} (${ph.effectiveKind}) must end with mora, got ${tail.lastNote}`
        );
        assert.ok(tail.bar !== null, `${id} phrase ${i} must have division bar`);
      } else if (ph.effectiveKind === 'flex') {
        assert.equal(tail.bar, ',', `${id} flex bar`);
        if (id === 'prophecy') {
          assert.equal(tail.lastNote, 'i.', 'Prophecy flexa preserves i. from definition');
        } else {
          assert.equal(tail.lastNote.endsWith('.'), false, `${id} flex has no engine-added mora`);
        }
      }
    });
    if (id === 'preface-solemn') {
      // Unhandled question cadence emits no mora and no bar after "loquitur?"
      assert.match(res.gabc, /lo\(h\)qui\(h\)tur\?\(h\) Ul\(/);
    }

    // Unpunctuated trailing clause ('none') has neither mora nor bar when followed by nothing -> only final bar '::' or mid-phrase none
    const noneMidSample = 'Prima pars huius textus. Secúnda pars sine fine';
    const noneMidRes = pointReading(noneMidSample, tone, {
      language: 'la',
      cadenceOverrides: { 3: null },
      autoJoinShortPhrases: 0,
    });
    const noneTails = getPhraseTailTokens(noneMidRes.gabc);
    // Phrase 0 was overridden to null ('none') -> no bar in GABC, so 1 combined tail (only final phrase 1)
    assert.equal(noneTails.length, 1);
    const noneMidBody = noneMidRes.gabc.split('%%\n')[1]!;
    assert.match(noneMidBody, /tex\(.\)tus\./, `${id} mid-phrase none omits bar and mora`);
    assert.doesNotMatch(noneMidBody, /tex\(.\.\)tus\./, `${id} mid-phrase none note has no mora`);

    // Changing comma phrase (phrase 0) to metrum adds both mora and (;) bar, changing back removes both
    const p0Key = phrases[0].endWordIndex;
    const toMetrum = pointReading(sample, tone, {
      language: 'la',
      cadenceOverrides: { [p0Key]: 'metrum' },
      autoJoinShortPhrases: 0,
    });
    const metrumTail0 = getPhraseTailTokens(toMetrum.gabc)[0];
    assert.ok(metrumTail0.lastNote.endsWith('.'), `${id} flex->metrum adds mora`);
    assert.equal(metrumTail0.bar, ';', `${id} flex->metrum adds (;) bar`);

    const backToFlex = pointReading(sample, tone, {
      language: 'la',
      cadenceOverrides: {},
      autoJoinShortPhrases: 0,
    });
    assert.equal(backToFlex.gabc, res.gabc);
  }

  // English preface punctuation mode: h-metrum and g-long have mora; g-flex and none do not; toggle none -> metrum adds both
  const prefTone = buildPrefTone('preface-solemn')!;
  const enPunct =
    'It is truly right and just, always and everywhere to give you thanks; Lord almighty and eternal God.';
  const enPhrases = extractReadingPhrases(enPunct, prefTone, {
    language: 'en',
    treatLineBreaksAsPhraseBreaks: false,
    autoJoinShortPhrases: 0,
  });
  const enRes = pointReading(enPunct, prefTone, {
    language: 'en',
    treatLineBreaksAsPhraseBreaks: false,
    autoJoinShortPhrases: 0,
  });
  const enTails = getPhraseTailTokens(enRes.gabc);
  assert.equal(enTails[0].lastNote.endsWith('.'), false, 'en g-flex has no mora');
  assert.equal(enTails[0].bar, ',');
  assert.equal(enTails[1].lastNote.endsWith('.'), true, 'en h-metrum has mora');
  assert.equal(enTails[1].bar, ';');
  assert.equal(enTails[2].lastNote.endsWith('.'), true, 'en final g-long has mora');
  assert.equal(enTails[2].bar, '::');

  const enNoneToMetrum = pointReading(enPunct, prefTone, {
    language: 'en',
    treatLineBreaksAsPhraseBreaks: false,
    cadenceOverrides: { [enPhrases[0].endWordIndex]: 'metrum' },
    autoJoinShortPhrases: 0,
  });
  const enOverTails = getPhraseTailTokens(enNoneToMetrum.gabc);
  assert.equal(enOverTails[0].lastNote.endsWith('.'), true);
  assert.equal(enOverTails[0].bar, ';');

  // Merge updates notes, mora, and bar together (joining a metrum phrase into a comma flex phrase drops intermediate mora+bar)
  const prefPhrases = extractReadingPhrases(sample, prefTone, { language: 'la', autoJoinShortPhrases: 0 });
  const merged = pointReading(sample, prefTone, {
    language: 'la',
    mergedBreaks: [{ endWordIndex: prefPhrases[1].endWordIndex, wordText: prefPhrases[1].endWordText }],
    autoJoinShortPhrases: 0,
  });
  const mergedTails = getPhraseTailTokens(merged.gabc);
  assert.equal(mergedTails.length, prefPhrases.filter((p, i) => i === prefPhrases.length - 1 || p.effectiveKind !== null).length - 1);
  assert.equal(mergedTails[0].bar, ',', 'first phrase comma flex');
  assert.equal(mergedTails[1].bar, ';', 'merged phrase keeps colon metrum');
  assert.ok(mergedTails[1].lastNote.endsWith('.'), 'merged metrum phrase ends with mora');
});

test('Add-on B: auto-join short phrases rules, directions, exclusions, 3-state break persistence, and Advent N=3 report', () => {
  const prefTone = buildPrefTone('preface-solemn')!;
  const gospel = buildReadingTone('gospel')!;
  const epistle = buildReadingTone('epistle')!;

  // 1. Real word counter ignores bare punctuation tokens
  assert.equal(countRealWords(['*', 'Et', 'ídeo,', '—']), 2);
  assert.equal(countRealWords(['†', ',', ';']), 0);

  // 2. "Vere dignum et justum est, / ǽquum et salutáre, / nos tibi semper et ubíque grátias ágere:" with N=3
  const threeWithCont =
    'Vere dignum et justum est, ǽquum et salutáre, nos tibi semper et ubíque grátias ágere: Dómine sancte Pater omnípotens Deus.';
  const joined3 = extractReadingPhrases(threeWithCont, prefTone, { language: 'la' });
  assert.equal(joined3[0].text, 'Vere dignum et justum est, ǽquum et salutáre,');
  assert.equal(joined3[0].autoJoined, true);
  assert.equal(joined3[0].effectiveKind, 'flex');
  assert.equal(joined3[1].text, 'nos tibi semper et ubíque grátias ágere:');
  assert.equal(joined3[1].effectiveKind, 'metrum');
  assert.equal(joined3[1].autoJoined, false);
  const pointedJoined3 = pointReading(threeWithCont, prefTone, { language: 'la' });
  const j3Tails = getPhraseTailTokens(pointedJoined3.gabc);
  assert.equal(j3Tails[0].bar, ',');
  assert.equal(j3Tails[0].lastNote.endsWith('.'), false);
  assert.equal(j3Tails[1].bar, ';');
  assert.equal(j3Tails[1].lastNote.endsWith('.'), true);

  // 3. 2-word phrase directly after a period (or ? / !) joins NEXT; 2-word phrase at start of paragraph joins NEXT
  const afterSentenceAndParaStart =
    'Prima pars huius longo témpore decántata est. Et ídeo, cum Ángelis et Archángelis hymnum cánimus.\n\nIn primo, secúndo loco laudámus te Dómine.';
  const dirPhrases = extractReadingPhrases(afterSentenceAndParaStart, epistle, { language: 'la' });
  assert.deepEqual(
    dirPhrases.map((p) => p.text),
    [
      'Prima pars huius longo témpore decántata est.',
      'Et ídeo, cum Ángelis et Archángelis hymnum cánimus.',
      'In primo, secúndo loco laudámus te Dómine.',
    ]
  );
  assert.equal(dirPhrases[1].autoJoined, true);
  assert.equal(dirPhrases[2].autoJoined, true);
  assert.equal(dirPhrases[2].paragraphBreak, true);

  // 4. Short last phrase left alone; short phrase with no allowed neighbour left alone (no error)
  const shortEnds = 'Prima pars huius textus longíssima est. Brevis clausula.';
  const shortEndPhrases = extractReadingPhrases(shortEnds, epistle, { language: 'la' });
  assert.equal(shortEndPhrases.length, 2);
  assert.equal(shortEndPhrases[1].text, 'Brevis clausula.');
  assert.equal(shortEndPhrases[1].autoJoined, false);

  const isolatedBetweenBreaks =
    'Prima pars huius textus longíssima est.\n\nSolo duo.\n\nSecúnda pars huius textus longíssima est.';
  const isoPhrases = extractReadingPhrases(isolatedBetweenBreaks, epistle, { language: 'la' });
  assert.equal(isoPhrases.length, 3);
  assert.equal(isoPhrases[1].text, 'Solo duo.');
  assert.equal(isoPhrases[1].paragraphBreak, true);
  assert.equal(isoPhrases[2].paragraphBreak, true);

  const blockedBeforeParaBreak =
    'Prima pars huius textus longíssima est. Brevis ante.\n\nSecúnda pars huius textus longíssima est.';
  const blockedPhrases = extractReadingPhrases(blockedBeforeParaBreak, epistle, { language: 'la' });
  assert.equal(blockedPhrases.length, 3);
  assert.equal(blockedPhrases[1].text, 'Brevis ante.');

  // 5. Never auto-joins across paragraph break or opening formula (inline & picker)
  for (const opening of ['In illo témpore:', 'In diébus illis,', 'Fratres,', 'Caríssime,']) {
    const inlineRes = extractReadingPhrases(
      `${opening} dixit Iesus discípulis suis.`,
      gospel,
      { language: 'la' }
    );
    assert.equal(inlineRes.length, 2, `inline "${opening}" not auto-joined`);
    assert.equal(inlineRes[0].text, opening);

    const optRes = extractReadingPhrases('dixit Iesus discípulis suis.', gospel, {
      language: 'la',
      openingFormula: opening,
    });
    assert.equal(optRes.length, 2, `openingFormula "${opening}" not auto-joined`);
  }
  // Gospel "In illo témpore:" keeps the mediant cadence
  const inIlloGospel = pointReading('In illo témpore: dixit Iesus discípulis suis.', gospel, {
    language: 'la',
  });
  assert.match(inIlloGospel.gabc, /In\(f\) il\(h\)lo\(gr\) tém\(g\)po\(hr\)re:\(h\.\) \(;\)/);

  // 6. N=0 reproduces output without auto-join; changing N regenerates phrases
  const multiLen = 'Uno. Duo verba, tria quattuor quinque sex; septem octo.';
  assert.equal(
    extractReadingPhrases(multiLen, epistle, { language: 'la', autoJoinShortPhrases: 0 }).length,
    4
  );
  assert.equal(
    extractReadingPhrases(multiLen, epistle, { language: 'la', autoJoinShortPhrases: 1 }).length,
    3
  );
  assert.equal(
    extractReadingPhrases(multiLen, epistle, { language: 'la', autoJoinShortPhrases: 3 }).length,
    2
  );

  // 7. Three-state breaks: user split records forcedBreaks, survives edits to other phrases and changes to N,
  //    user mergedBreaks survive too, and reset clears all break lists returning to automatic result
  const baseText = 'Vere dignum et justum est, ǽquum et salutáre, nos tibi semper et ubíque grátias ágere.';
  const autoRes = extractReadingPhrases(baseText, prefTone, { language: 'la' });
  assert.equal(autoRes[0].autoJoined, true);
  assert.equal(autoRes[0].internalMergedBreaks.length, 1);

  const afterSplit = splitPhraseWithForcedBreaks(autoRes[0], [], []);
  assert.deepEqual(afterSplit.mergedBreaks, []);
  assert.deepEqual(afterSplit.forcedBreaks, [{ endWordIndex: 4, wordText: 'est,' }]);

  // Forced break stays unjoined even under N=6
  const unjoinedWithForced = extractReadingPhrases(baseText, prefTone, {
    language: 'la',
    autoJoinShortPhrases: 6,
    mergedBreaks: afterSplit.mergedBreaks,
    forcedBreaks: afterSplit.forcedBreaks,
  });
  assert.equal(unjoinedWithForced.length, 3);

  // Edit another phrase later in text ("ágere." -> "referre Dómino semper."): forcedBreak survives remapping
  const editedText = 'Vere dignum et justum est, ǽquum et salutáre, nos tibi semper et ubíque grátias reférre Dómino.';
  const remappedForced = remapPhraseBreakKeys(
    afterSplit.forcedBreaks,
    baseText.split(/\s+/),
    editedText.split(/\s+/)
  );
  assert.deepEqual(remappedForced, [{ endWordIndex: 4, wordText: 'est,' }]);
  const afterOtherEdit = extractReadingPhrases(editedText, prefTone, {
    language: 'la',
    autoJoinShortPhrases: 3,
    forcedBreaks: remappedForced,
  });
  assert.equal(afterOtherEdit.length, 3);

  // User merge of phrase 1 + 2 survives alongside forced break on 0|1
  const userJoin = joinPhraseBreak({
    phrases: unjoinedWithForced,
    targetPhraseEndWordIndex: unjoinedWithForced[1].endWordIndex,
    direction: 'next',
    mergedBreaks: afterSplit.mergedBreaks,
    forcedBreaks: afterSplit.forcedBreaks,
    extraBreaks: [],
  });
  const mixedRes = extractReadingPhrases(baseText, prefTone, {
    language: 'la',
    autoJoinShortPhrases: 3,
    mergedBreaks: userJoin.mergedBreaks,
    forcedBreaks: userJoin.forcedBreaks,
  });
  assert.equal(mixedRes.length, 2);
  assert.equal(mixedRes[0].text, 'Vere dignum et justum est,');
  assert.equal(mixedRes[1].text, 'ǽquum et salutáre, nos tibi semper et ubíque grátias ágere.');

  // Restore individual auto-joined break
  const individualRestore = restoreBreakWithForcedBreaks(
    autoRes[0].internalMergedBreaks[0],
    [],
    [],
    true
  );
  assert.deepEqual(individualRestore.forcedBreaks, [{ endWordIndex: 4, wordText: 'est,' }]);

  // Reset returns to automatic result
  const resetRes = extractReadingPhrases(baseText, prefTone, {
    language: 'la',
    autoJoinShortPhrases: 3,
    mergedBreaks: [],
    forcedBreaks: [],
    extraBreaks: [],
  });
  assert.equal(resetRes[0].autoJoined, true);

  // Saved settings store separate thresholds for Reading & Preface (default 3, range 0..6) and forcedBreaks
  const defaultSaved = parseSavedToneSettings({});
  assert.equal(defaultSaved.autoJoinShortPhrasesReading, 3);
  assert.equal(defaultSaved.autoJoinShortPhrasesPreface, 3);
  assert.deepEqual(defaultSaved.forcedBreaks, []);
  const clampedSaved = parseSavedToneSettings({
    autoJoinShortPhrasesReading: 99,
    autoJoinShortPhrasesPreface: -2,
    forcedBreaks: [{ endWordIndex: 4, wordText: 'est,' }],
  });
  assert.equal(clampedSaved.autoJoinShortPhrasesReading, 6);
  assert.equal(clampedSaved.autoJoinShortPhrasesPreface, 0);
  assert.deepEqual(clampedSaved.forcedBreaks, [{ endWordIndex: 4, wordText: 'est,' }]);

  // 8. English line-based preface mode ignores auto-join even when short 1-2 word lines exist, and Opening/Closing stay verbatim
  const enShortLines = `It is truly right and just, our duty and our salvation,
always and everywhere to give you thanks,
Lord, holy Father, almighty and eternal God,
through Christ our Lord.

For he assumed,
by grace,
salvation now.

And so, with Angels and Archangels,
with Thrones and Dominions,
and with all the hosts and Powers of heaven,
we sing the hymn of your glory,
as without end we acclaim:`;
  const enSplitAuto = splitPreface(enShortLines, {
    language: 'en',
    tone: prefTone,
    templates: SEED_PREFACE_TEMPLATES,
    autoJoinShortPhrases: 5,
    treatLineBreaksAsPhraseBreaks: true,
  });
  assert.equal(enSplitAuto.parts.find((p) => p.kind === 'opening')!.status, 'template-needs-review');
  assert.equal(enSplitAuto.parts.find((p) => p.kind === 'closing')!.status, 'template-needs-review');
  const enBody = enSplitAuto.parts.find((p) => p.kind === 'body')!.phrases!;
  assert.equal(enBody.length, 3);
  assert.equal(enBody.every((p) => !p.autoJoined), true);

  // 9. Advent preface fixture report: pointReading N=0 vs N=3 ("Et ídeo," & short clauses change) while N=0 preserves 9 pitch diffs
  const adventFull =
    'Vere dignum et iustum est, æquum et salutáre; nos tibi semper et ubíque, grátias ágere; Dómine, sancte Pater, omnípotens ætérne Deus; per Christum Dóminum nostrum. Qui, primo advéntu in humilitáte carnis assúmptæ; dispositiónis antíquæ munus implévit; nobísque salútis perpétuæ trámitem reserávit. ut, cum secúndo vénerit in suæ glória maiestátis; manifésto demum múnere capiámus; quod vigilántes, nunc audémus exspectáre promíssum. Et ídeo, cum Angelis et Archángelis; cum Thronis et Dominationibus; cumque omni milítia cæléstis exércitus; hymnum glóriæ tuæ cánimus; sine fine dicéntes.';
  const adventPhrases0 = extractReadingPhrases(adventFull, prefTone, {
    language: 'la',
    autoJoinShortPhrases: 0,
  });
  const adventPhrases3 = extractReadingPhrases(adventFull, prefTone, {
    language: 'la',
    autoJoinShortPhrases: 3,
  });
  assert.equal(adventPhrases0.length, 23);
  assert.equal(adventPhrases3.length, 14);
  assert.ok(
    adventPhrases3.some((p) => p.text === 'Et ídeo, cum Angelis et Archángelis;' && p.autoJoined),
    'Under N=3, "Et ídeo," auto-joins "cum Angelis et Archángelis;"'
  );
  // Under splitPreface (template-first workflow), Opening and Closing parts (including "Et ídeo,") stay verbatim regardless of N
  const advSplit0 = splitPreface(adventFull, {
    language: 'la',
    tone: prefTone,
    templates: SEED_PREFACE_TEMPLATES,
    autoJoinShortPhrases: 0,
  });
  const advSplit3 = splitPreface(adventFull, {
    language: 'la',
    tone: prefTone,
    templates: SEED_PREFACE_TEMPLATES,
    autoJoinShortPhrases: 3,
  });
  assert.equal(
    advSplit3.parts.find((p) => p.kind === 'closing')!.gabc,
    advSplit0.parts.find((p) => p.kind === 'closing')!.gabc
  );
  assert.equal(advSplit0.parts.find((p) => p.kind === 'body')!.phrases?.length, 9);
  assert.equal(advSplit3.parts.find((p) => p.kind === 'body')!.phrases?.length, 6);
  // Assembled Advent preface GABC stays valid under both N=0 and N=3
  assert.equal(validateGabc(assemblePreface(advSplit3, prefTone, { language: 'la' }).gabc).valid, true);
});
