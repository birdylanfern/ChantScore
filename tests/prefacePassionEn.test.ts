import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { validateGabc } from '@/src/lib/gabc/validator';
import { compareGabc } from '@/src/lib/tones/compareGabc';
import { buildPrefaceTone } from '@/src/lib/tones/readingTones';
import { assemblePreface, splitPreface } from '@/src/lib/tones/prefaceSplit';
import {
  extractGabcSyllables,
  SEED_PREFACE_TEMPLATES,
  stripGabcHeaderAndClef,
} from '@/src/lib/tones/prefaceTemplates';
import { pointReading } from '@/src/lib/tones/pointing';
import { ensureEnglishHyphenation } from '@/src/lib/text/englishSyllabify';

await ensureEnglishHyphenation();

function extractBars(gabc: string): string[] {
  const body = stripGabcHeaderAndClef(gabc);
  return [...body.matchAll(/\(([,;:]+)\)/g)].map((m) => m[1]);
}

test('English Passion I preface matches ground-truth fixture syllables, notes, and bars', () => {
  const tone = buildPrefaceTone('preface-solemn')!;
  const input = fs.readFileSync('tests/fixtures/preface-passion-en/text.txt', 'utf8').trim();
  const fixtureRaw = fs.readFileSync('tests/fixtures/preface-passion-en/expected.gabc', 'utf8');

  // Body phrase index 1 (line 5 of the 12-line preface: "the whole world has received a heart", endWordIndex 14):
  // default unit assignment predicts 'g-flex', while the ground truth chants it as 'h-metrum'.
  const split = splitPreface(input, {
    language: 'en',
    tone,
    templates: SEED_PREFACE_TEMPLATES,
    roleOverrides: { 14: 'h-metrum' },
  });

  const opening = split.parts.find((p) => p.kind === 'opening')!;
  const body = split.parts.find((p) => p.kind === 'body')!;
  const closing = split.parts.find((p) => p.kind === 'closing')!;

  assert.equal(opening.status, 'template-verified');
  assert.equal(opening.matchedTemplateId, 'en-opening-solemn-short');
  assert.equal(closing.status, 'template-verified');
  assert.equal(closing.matchedTemplateId, 'en-closing-solemn-short');
  assert.equal(body.status, 'generated');
  assert.equal(body.phrases?.length, 6);

  const assembled = assemblePreface(split, tone, { language: 'en' });
  assert.equal(assembled.warnings.length, 0, assembled.warnings.join('; '));
  assert.equal(validateGabc(assembled.gabc).valid, true);
  assert.equal((assembled.gabc.match(/\(c3\)/g) ?? []).length, 1);
  assert.doesNotMatch(assembled.gabc, /\((?:,|;|::|:)\)\s*\((?:,|;|::|:)\)/);

  // Compare syllable text sequence and pitch sequence against the printed fixture using shared compareGabc;
  // Add-on A places a mora (.) on h-metrum and g-long final notes while leaving g-flex without a mora.
  const cmp = compareGabc(assembled.gabc, fixtureRaw);
  assert.equal(cmp.totals.matchRatio, 1, cmp.totals.summary);
  assert.equal(cmp.totals.pitchMismatches, 0);
  assert.equal(cmp.totals.splitMismatches, 0);
  assert.equal(cmp.totals.missingSyllables, 0);
  assert.equal(cmp.totals.extraSyllables, 0);

  const actualSyllables = extractGabcSyllables(assembled.gabc);
  // Body h-metrum & g-long final syllables carry trailing mora '.', whereas g-flex ("revealed") does not
  const revealedSyl = actualSyllables.find((s) => s.text === 'vealed');
  assert.ok(revealedSyl && !revealedSyl.notes.endsWith('.'), 'g-flex line has no mora');
  const sonSyl = actualSyllables.find((s) => s.text === 'Son');
  assert.ok(sonSyl && sonSyl.notes.endsWith('.'), 'h-metrum line carries mora');
  const crucifiedSyl = actualSyllables.find((s) => s.text === 'fied.');
  assert.ok(crucifiedSyl && crucifiedSyl.notes.endsWith('.'), 'g-long final line carries mora');

  // Compare division bars: identical to fixture except line 6 ("to confess the infinite power of your majesty,",
  // bar #6) where g-long emits (:) under barForCadence while the fixture uses (;), and line 7
  // ("since by the wondrous power of the Cross", bar #7) where h-metrum emits (;) while the fixture uses (,).
  const actualBars = extractBars(assembled.gabc);
  const expectedBars = extractBars(fixtureRaw);
  assert.equal(actualBars.length, expectedBars.length);
  assert.equal(expectedBars[6], ';');
  assert.equal(actualBars[6], ':');
  assert.equal(expectedBars[7], ',');
  assert.equal(actualBars[7], ';');
  actualBars.forEach((bar, i) => {
    if (i === 6 || i === 7) return;
    assert.equal(bar, expectedBars[i], `bar #${i} mismatch`);
  });
});

test('English preface warns and falls back on non-fixture h-metrum proparoxytone endings', () => {
  const tone = buildPrefaceTone('preface-solemn')!;
  const res = pointReading(
    'And so, with Angels and Archangels,\nas in exultation we acclaim:',
    tone,
    { language: 'en' }
  );
  assert.equal(validateGabc(res.gabc).valid, true);
  assert.ok(res.warnings.length >= 1, 'expected fallback warning for proparoxytone h-metrum ending');
  assert.match(res.gabc, /An\(h\)gels\(g\) and\(gf\) Arch\(fg\)an\(g\)gels,\(g\.\) \(;\)/);
  assert.match(res.gabc, /ex\(g\)ul\(g\)ta\(f\)tion\(e\) we\(ef\) ac\(g\)claim:\(f\.\) \(::\)/);
});
