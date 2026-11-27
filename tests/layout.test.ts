import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGabc } from '@/src/lib/gabc/parser';
import { computeScoreLayout, NOTE_W, PlacedItem } from '@/src/lib/notation/layoutEngine';
import {
  DEFAULT_TYPOGRAPHY,
  getWordSpacingGaps,
  LARGE_PRINT_FONT_SIZE_THRESHOLD,
  resolveEffectiveWordSpacing,
  resolveScoreTypography,
} from '@/src/lib/typography';

function placedSyllables(gabc: string, opts?: Parameters<typeof computeScoreLayout>[3]) {
  const score = parseGabc(gabc);
  const layout = computeScoreLayout(score, 850, true, opts);
  return layout.systems.flatMap((s) => s.items).filter((p) => p.item.kind === 'syllable');
}

test('lyric is centred under the FIRST note of a multi-note cluster, not the middle', () => {
  const [p] = placedSyllables('name: T;\n%%\n(c4) Glo(f/hgfe)ri(g)a(h)');
  const first = p.groups![0].groupLayout.notes.find((n) => !n.hiddenHead)!;
  const firstCentre = p.groups![0].x + first.x + NOTE_W / 2;
  const neumeMiddle = p.neumeStartX + p.neumeWidth / 2;
  assert.ok(Math.abs(p.lyricX - firstCentre) < 6, `lyric (${p.lyricX}) should sit on first note (${firstCentre})`);
  assert.ok(Math.abs(p.lyricX - neumeMiddle) > 6 || p.neumeWidth < 14, 'and not on the neume middle');
});

test('a single-note syllable is still centred on its note', () => {
  const [p] = placedSyllables('name: T;\n%%\n(c4) a(f) b(g)');
  const note = p.groups![0].groupLayout.notes[0];
  const noteCentre = p.groups![0].x + note.x + NOTE_W / 2;
  assert.ok(Math.abs(p.lyricX - noteCentre) < 1);
});

test('slots never overlap: wide text before a long neume still fits in its slot', () => {
  const syl = placedSyllables('name: T;\n%%\n(c4) Alleluia(fghgfe) x(g)');
  for (const p of syl) {
    assert.ok(p.lyricX >= p.x && p.lyricX <= p.x + p.width, 'anchor lies inside the slot');
  }
  const [a, b] = syl;
  assert.ok(a.x + a.width <= b.x + 0.001, 'consecutive slots do not overlap');
});

test('psalm recitation: word-end x gap exceeds mid-word x gap by at least preset difference across all presets', () => {
  const psalmLine = 'name: Psalm;\n%%\n(c4) Di(h)xit(h) Dó(h)mi(h)nus(h) Dó(h)mi(h)no(h) me(h)o:(h)';
  const score = parseGabc(psalmLine);

  for (const preset of ['compact', 'normal', 'wide'] as const) {
    const layout = computeScoreLayout(score, 850, false, { wordSpacing: preset });
    assert.equal(layout.systems.length, 1, `${preset}: short psalm line stays on one system`);

    const syls = layout.systems[0].items.filter((p) => p.item.kind === 'syllable');
    const { wordEndGap, midWordGap } = getWordSpacingGaps(preset, DEFAULT_TYPOGRAPHY.lyricFontSize);
    const minDiff = wordEndGap - midWordGap;

    const midGaps: number[] = [];
    const wordEndGaps: number[] = [];
    for (let i = 0; i < syls.length - 1; i++) {
      const cur = syls[i];
      const next = syls[i + 1];
      const gap = next.x - (cur.x + cur.width);
      assert.ok(gap >= 0, `${preset}: slots do not overlap`);
      if (cur.item.kind === 'syllable' && cur.item.wordEnd) {
        wordEndGaps.push(gap);
      } else {
        midGaps.push(gap);
      }
    }

    assert.ok(midGaps.length > 0 && wordEndGaps.length > 0);
    for (const wg of wordEndGaps) {
      for (const mg of midGaps) {
        assert.ok(
          wg - mg >= minDiff - 0.01,
          `${preset}: word-end gap (${wg}) - mid-word gap (${mg}) should be >= ${minDiff}`
        );
      }
    }
  }
});

test('mid-word minimum slot width can shrink to 18px while word-end and single-syllable words stay >= 26px', () => {
  // Use 10px font and 1-char mid-word/word-end syllables so slot widths hit minimum clamps
  const syls = placedSyllables('name: T;\n%%\n(c4) i(h)o(h) a(h)', {
    lyricFontSize: 10,
    wordSpacing: 'normal',
  });
  assert.equal(syls.length, 3);
  assert.equal(syls[0].width, 18, 'mid-word syllable uses 18px minimum');
  assert.equal(syls[1].width, 26, 'last syllable of word keeps 26px minimum');
  assert.equal(syls[2].width, 26, 'single-syllable word keeps 26px minimum');
});

test('two mid-word syllables sit visibly closer than two syllables of different words without overlapping', () => {
  const syls = placedSyllables('name: T;\n%%\n(c4) a(h)b(h) c(h)d(h)', {
    wordSpacing: 'normal',
  });
  assert.equal(syls.length, 4);

  const midWordSlotGap = syls[1].x - (syls[0].x + syls[0].width);
  const crossWordSlotGap = syls[2].x - (syls[1].x + syls[1].width);
  const midWordNoteStep = syls[1].neumeStartX - syls[0].neumeStartX;
  const crossWordNoteStep = syls[2].neumeStartX - syls[1].neumeStartX;

  assert.ok(midWordSlotGap >= 1 && midWordSlotGap <= 2, `mid-word gap (${midWordSlotGap}) is 1-2px`);
  assert.ok(
    midWordSlotGap < crossWordSlotGap,
    `mid-word gap (${midWordSlotGap}) < cross-word gap (${crossWordSlotGap})`
  );
  assert.ok(
    midWordNoteStep < crossWordNoteStep,
    `mid-word note distance (${midWordNoteStep}) < cross-word note distance (${crossWordNoteStep})`
  );
  assert.ok(syls[0].x + syls[0].width <= syls[1].x, 'mid-word slots do not overlap');
});

test('word spacing scales with lyric font size and preset, and uses Wide when printing large fonts', () => {
  const normalSmall = getWordSpacingGaps('normal', 16.5);
  const normalLarge = getWordSpacingGaps('normal', 24);
  const compact = getWordSpacingGaps('compact', 16.5);
  const wide = getWordSpacingGaps('wide', 16.5);

  assert.ok(compact.wordEndGap < normalSmall.wordEndGap);
  assert.ok(normalSmall.wordEndGap < wide.wordEndGap);
  assert.ok(normalLarge.wordEndGap > normalSmall.wordEndGap);
  assert.ok(compact.midWordGap < normalSmall.midWordGap);
  assert.ok(normalSmall.midWordGap < wide.midWordGap);
  assert.ok(normalLarge.midWordGap > normalSmall.midWordGap);
  assert.ok(compact.midWordGap >= 1 && wide.midWordGap <= 2);

  assert.equal(resolveScoreTypography().wordSpacing, 'normal');
  assert.equal(resolveEffectiveWordSpacing('compact', 16.5, false), 'compact');
  assert.equal(resolveEffectiveWordSpacing('compact', 16.5, true), 'compact');
  assert.equal(
    resolveEffectiveWordSpacing('compact', LARGE_PRINT_FONT_SIZE_THRESHOLD, false),
    'compact'
  );
  assert.equal(
    resolveEffectiveWordSpacing('compact', LARGE_PRINT_FONT_SIZE_THRESHOLD, true),
    'wide'
  );
  assert.equal(
    resolveEffectiveWordSpacing('normal', LARGE_PRINT_FONT_SIZE_THRESHOLD + 4, true),
    'wide'
  );
});

test('systems still break on width correctly with Wide spacing and drop cap without overflowing maxX', () => {
  const words = Array.from(
    { length: 14 },
    () => 'Dó(h)mi(h)nus(h)'
  ).join(' ');
  const score = parseGabc(`name: Long Recitation;\n%%\n(c4) ${words}`);
  const layout = computeScoreLayout(score, 600, true, { wordSpacing: 'wide', lyricFontSize: 18 });
  const maxX = layout.staffRightX - 28;

  assert.ok(layout.systems.length > 2, 'Wide spacing wraps long recitation into multiple systems');
  assert.ok(layout.staffStartXFirstSystem > layout.staffLeftX, 'drop-cap offset preserved');

  for (const sys of layout.systems) {
    const firstSysSyl = sys.items.find((p: PlacedItem) => p.item.kind === 'syllable');
    if (sys.systemIndex === 0 && firstSysSyl) {
      assert.ok(
        firstSysSyl.x >= layout.staffStartXFirstSystem,
        'first syllable respects drop-cap offset'
      );
    }
    for (let i = 0; i < sys.items.length; i++) {
      const placed = sys.items[i];
      if (i > 0) {
        assert.ok(
          placed.x + placed.width <= maxX + 0.001,
          `System ${sys.systemIndex} item ${i} (${placed.x + placed.width}) must not overflow maxX (${maxX})`
        );
      }
      if (i < sys.items.length - 1) {
        assert.ok(
          placed.x + placed.width <= sys.items[i + 1].x + 0.001,
          'consecutive items do not overlap'
        );
      }
    }
  }
});

