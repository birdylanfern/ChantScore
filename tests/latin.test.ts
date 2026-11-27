import test from 'node:test';
import assert from 'node:assert/strict';
import { syllabifyWord, syllabifyText } from '@/src/lib/text/latinSyllabify';
import { applyLyricsToScore } from '@/src/lib/notation/lyricsImport';
import { parseGabc } from '@/src/lib/gabc/parser';
import { serializeGabc } from '@/src/lib/gabc/serializer';

const CASES: Record<string, string> = {
  Dominus: 'Do-mi-nus',
  Sanctus: 'San-ctus',
  Gloria: 'Glo-ri-a',
  Kyrie: 'Ky-ri-e',
  eleison: 'e-le-i-son',
  Christe: 'Chri-ste',
  Iesu: 'Ie-su',
  Alleluia: 'Al-le-lu-ia',
  excelsis: 'ex-cel-sis',
  saecula: 'sae-cu-la',
  Deus: 'De-us',
  laudamus: 'lau-da-mus',
  Spiritui: 'Spi-ri-tu-i',
  sanguis: 'san-guis',
  quoniam: 'quo-ni-am',
  filius: 'fi-li-us',
  tuum: 'tu-um',
  hominibus: 'ho-mi-ni-bus',
  omnipotens: 'om-ni-po-tens',
  terra: 'ter-ra',
  Magnificat: 'Ma-gni-fi-cat',
  pax: 'pax',
  et: 'et',
  Agnus: 'A-gnus',
  mysterium: 'my-ste-ri-um',
  Maria: 'Ma-ri-a',
  lingua: 'lin-gua',
  bonae: 'bo-nae',
  Dóminus: 'Dó-mi-nus',
};

for (const [word, expected] of Object.entries(CASES)) {
  test(`syllabify ${word}`, () => {
    assert.equal(syllabifyWord(word).join('-'), expected);
  });
}

test('punctuation stays on the edge syllables', () => {
  assert.deepEqual(syllabifyWord('(Gloria),'), ['(Glo', 'ri', 'a),']);
});

test('hand-hyphenated words are respected', () => {
  assert.deepEqual(syllabifyWord('Ky-ri-e'), ['Ky', 'ri', 'e']);
});

test('syllabifyText marks word ends', () => {
  const s = syllabifyText('Gloria in');
  assert.deepEqual(s.map((x) => [x.text, x.wordEnd]), [['Glo', false], ['ri', false], ['a', true], ['in', true]]);
});

test('applyLyricsToScore distributes syllables over note-bearing items', () => {
  const score = parseGabc('name: T;\n%%\n(c4) x(f) x(g) x(h) (:) x(i)');
  const res = applyLyricsToScore(score, 'Gloria in');
  assert.equal(res.assigned, 4);
  assert.equal(res.leftoverSyllables, 0);
  assert.equal(res.unfilledItems, 0);
  const out = serializeGabc(res.score);
  assert.match(out, /\(c4\) Glo\(f\)ri\(g\)a\(h\) \(:\) in\(i\)/);
});

test('melismas count as one syllable and short text leaves items unfilled', () => {
  const score = parseGabc('name: T;\n%%\n(c4) x(f/g/h) x(i) x(h)');
  const res = applyLyricsToScore(score, 'Al-le');
  assert.equal(res.assigned, 2);
  assert.equal(res.unfilledItems, 1);
});

test('extra text is reported as leftover', () => {
  const score = parseGabc('name: T;\n%%\n(c4) x(f) x(g)');
  const res = applyLyricsToScore(score, 'Gloria in excelsis');
  assert.equal(res.assigned, 2);
  assert.equal(res.leftoverSyllables, 5);
});

test('words with qu/gu inside split correctly', () => {
  assert.equal(syllabifyWord('aqua').join('-'), 'a-qua');
  assert.equal(syllabifyWord('sequitur').join('-'), 'se-qui-tur');
});

import { moveNoteSelection } from '@/src/lib/notation/noteNavigation';

test('keyboard note navigation steps through notes in score order', () => {
  const score = parseGabc('name: T;\n%%\n(c4) a(fg) b(h)');
  const notes = score.items.flatMap((i) => (i.kind === 'syllable' ? i.groups.flatMap((g) => g.notes) : []));
  const first = { itemId: '', noteId: notes[0].id };
  const step1 = moveNoteSelection(score, first, 1);
  assert.equal(step1?.noteId, notes[1].id);
  const step2 = moveNoteSelection(score, step1, 1);
  assert.equal(step2?.noteId, notes[2].id);
  assert.equal(moveNoteSelection(score, step2, 1), null, 'no neighbour after the last note');
  assert.equal(moveNoteSelection(score, first, -1), null, 'no neighbour before the first note');
  assert.equal(moveNoteSelection(score, null, 1), null);
});
