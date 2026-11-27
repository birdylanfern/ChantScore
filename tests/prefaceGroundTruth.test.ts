import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { validateGabc } from '@/src/lib/gabc/validator';
import { compareGabc } from '@/src/lib/tones/compareGabc';
import { assemblePreface, splitPreface } from '@/src/lib/tones/prefaceSplit';
import { SEED_PREFACE_TEMPLATES } from '@/src/lib/tones/prefaceTemplates';
import { buildPrefaceTone } from '@/src/lib/tones/readingTones';
import { ensureEnglishHyphenation } from '@/src/lib/text/englishSyllabify';
import { ChantLanguage } from '@/src/types/chant';

await ensureEnglishHyphenation();

interface FixtureThreshold {
  language: ChantLanguage;
  tone: string;
  autoJoinShortPhrases?: number;
  treatLineBreaksAsPhraseBreaks?: boolean;
  minMatchRatio: number;
}

const FIXTURES_ROOT = path.join('tests', 'fixtures');

const fixtureDirs = fs
  .readdirSync(FIXTURES_ROOT, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name.startsWith('preface-'))
  .map((entry) => entry.name)
  .sort();

test('Discovers at least the initial preface ground-truth fixtures', () => {
  assert.ok(fixtureDirs.includes('preface-advent-la'));
  assert.ok(fixtureDirs.includes('preface-passion-en'));
});

for (const dirName of fixtureDirs) {
  test(`Ground-truth fixture ${dirName} meets minimum match ratio`, () => {
    const dirPath = path.join(FIXTURES_ROOT, dirName);
    const text = fs.readFileSync(path.join(dirPath, 'text.txt'), 'utf8').trim();
    const expectedGabc = fs.readFileSync(path.join(dirPath, 'expected.gabc'), 'utf8');
    const threshold = JSON.parse(
      fs.readFileSync(path.join(dirPath, 'threshold.json'), 'utf8')
    ) as FixtureThreshold;

    const tone = buildPrefaceTone(threshold.tone);
    assert.ok(tone, `Unknown tone ${threshold.tone} in ${dirName}`);

    const split = splitPreface(text, {
      language: threshold.language,
      tone,
      toneId: threshold.tone,
      templates: SEED_PREFACE_TEMPLATES,
      autoJoinShortPhrases: threshold.autoJoinShortPhrases,
      treatLineBreaksAsPhraseBreaks: threshold.treatLineBreaksAsPhraseBreaks,
    });
    const assembled = assemblePreface(split, tone, { language: threshold.language });
    assert.equal(validateGabc(assembled.gabc).valid, true);

    const cmp = compareGabc(assembled.gabc, expectedGabc);
    assert.ok(
      cmp.totals.matchRatio >= threshold.minMatchRatio,
      `${dirName}: ${cmp.totals.summary} (ratio ${cmp.totals.matchRatio.toFixed(
        4
      )}) fell below minMatchRatio ${threshold.minMatchRatio}`
    );
  });
}

test('compareGabc reports syllable matches, pitch mismatches, syllable-split mismatches, and divisions', () => {
  const expected = `name: Sample;
%%
(c3) Dó(f)mi(h)nus(h) vo(g)bís(f)cum,(g) (;) et(f) cum(h) spí(h)ri(g)tu(f) tu(g)o.(g) (::)`;

  const exact = compareGabc(expected, expected);
  assert.equal(exact.totals.summary, '13/13 syllables match');
  assert.equal(exact.totals.matchRatio, 1);
  assert.equal(exact.totals.pitchMismatches, 0);
  assert.equal(exact.totals.splitMismatches, 0);
  assert.equal(exact.totals.divisionMismatches, 0);

  // Pitch diff + shifted syllable split on "spíritu" ("spí-ri-tu" vs "spíri-tu") + division diff
  const generated = `name: Sample;
%%
(c3) Dó(h)mi(h)nus(h) vo(g)bís(h)cum,(g) (,) et(f) cum(h) spíri(h)tu(g) tu(g)o.(g) (::)`;

  const cmp = compareGabc(generated, expected);
  assert.equal(cmp.totals.expectedSyllables, 13);
  assert.equal(cmp.totals.splitMismatches, 3); // "spí-ri-tu" has 3 expected syllables flagged as split-mismatch
  assert.equal(cmp.totals.pitchMismatches, 2); // "Dó" (h vs f) and "bís" (h vs g)
  assert.equal(cmp.totals.matchedSyllables, 8);
  assert.equal(cmp.totals.divisionMismatches, 1); // phrase 1 (,) vs (;)
  assert.equal(cmp.totals.summary, '8/13 syllables match');

  const phrase0 = cmp.phrases[0];
  assert.equal(phrase0.divisionMismatch, true);
  assert.equal(phrase0.generatedDivision, ',');
  assert.equal(phrase0.expectedDivision, ';');
  assert.equal(phrase0.words[0].syllables[0].status, 'pitch-mismatch');
  assert.equal(phrase0.words[0].syllables[0].generatedNotes, 'h');
  assert.equal(phrase0.words[0].syllables[0].expectedNotes, 'f');

  const splitWord = cmp.phrases[1].words.find((w) => w.status === 'split-mismatch');
  assert.ok(splitWord);
  assert.equal(splitWord.generatedSyllableBreakdown?.length, 2);
  assert.equal(splitWord.expectedSyllableBreakdown?.length, 3);
  // Alignment still resumes cleanly after the split mismatch on "tu(g)o.(g)"
  const lastWord = cmp.phrases[1].words[cmp.phrases[1].words.length - 1];
  assert.equal(lastWord.status, 'match');
});
