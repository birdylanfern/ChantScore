import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGabc, parseGabcWithDiagnostics } from '@/src/lib/gabc/parser';
import { serializeGabc } from '@/src/lib/gabc/serializer';
import { serializeGabcWithMap } from '@/src/lib/gabc/sourceMap';
import { DEFAULT_HYMN_GABC } from '@/src/lib/gabc/defaultHymn';

const body = (gabc: string) => gabc.slice(gabc.indexOf('%%') + 2).trim();
/** Normalise only insignificant whitespace between tokens. */
const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

const SAMPLES: Record<string, string> = {
  exotic_tokens: 'name: T;\n%%\n(cb1) Al(f)le(g)lu(h)ia.(h_r) (:z) (,0) Ky(f)(g)ri(h) e(::)',
  rubrics_and_markup: 'name: T;\n%%\n(c4) <c>Ant.</c>(f) <i>Ky</i>(g)ri(h) <b>e</b>(i)',
  layout_tags: 'name: T;\n%%\n(c4) Ky(f[ocba:1;6mm]g)ri(h[ll:1])e(i)',
  alt_with_parens: 'name: T;\n%%\n(c4) <alt>(see note)</alt>Ky(f)ri(g)e(h)',
  virgula_and_variants: "name: T;\n%%\n(c3) a(f)b(g) (') c(h) (;3) d(i) (:?)",
  accidentals_and_liquescents: 'name: T;\n%%\n(c4) a(fgixhg~) b(h>)(i<) c(j.)',
  default_hymn: DEFAULT_HYMN_GABC,
};

for (const [name, src] of Object.entries(SAMPLES)) {
  test(`round-trip keeps notation body byte-for-byte (modulo spacing): ${name}`, () => {
    const out = serializeGabc(parseGabc(src));
    assert.equal(squash(body(out)), squash(body(src)));
  });

  test(`round-trip is stable (idempotent): ${name}`, () => {
    const once = serializeGabc(parseGabc(src));
    const twice = serializeGabc(parseGabc(once));
    assert.equal(twice, once);
  });
}

test('editing a note regenerates only that token', () => {
  const score = parseGabc('name: T;\n%%\n(c4) Al(fgr)le(g_r)lu(h)ia.(h)');
  const syl = score.items.find((i) => i.kind === 'syllable' && i.lyric === 'le');
  assert.ok(syl && syl.kind === 'syllable');
  syl.groups[0].notes[0].pitch = 8; // g -> i, an edit
  const out = squash(body(serializeGabc(score)));
  assert.match(out, /Al\(fgr\)/, 'untouched syllable keeps its unmodeled r');
  assert.match(out, /le\(i_\)/, 'edited syllable is regenerated from the model');
});

test('retyping a lyric regenerates the lyric but keeps untouched neumes', () => {
  const score = parseGabc('name: T;\n%%\n(c4) <c>Al</c>(fgr)le(g)');
  const syl = score.items.find((i) => i.kind === 'syllable');
  assert.ok(syl && syl.kind === 'syllable');
  syl.lyric = 'Ol';
  syl.lyricColor = undefined;
  syl.lyricSpans = undefined;
  const out = squash(body(serializeGabc(score)));
  assert.match(out, /Ol\(fgr\)/);
});

test('a fused line break is not emitted twice and deleting the division regenerates it', () => {
  const score = parseGabc('name: T;\n%%\n(c4) a(f) (:z) b(g)');
  assert.equal(squash(body(serializeGabc(score))), '(c4) a(f) (:z) b(g)');
  const divIdx = score.items.findIndex((i) => i.kind === 'division');
  score.items.splice(divIdx, 1);
  assert.match(body(serializeGabc(score)), /\(z\)/);
});

test('second annotation line is preserved', () => {
  const src = 'name: T;\nannotation: Ant.;\nannotation: VIII;\n%%\n(c4) a(f)';
  const out = serializeGabc(parseGabc(src));
  assert.match(out, /annotation: Ant\.;\nannotation: VIII;/);
});

test('parser reports what the visual model cannot show', () => {
  const { warnings } = parseGabcWithDiagnostics(
    'name: T;\n%%\n% a comment\n(c4) Ky(fr)ri(g[ll:1])e(h)'
  );
  const msgs = warnings.map((w) => w.message).join('\n');
  assert.match(msgs, /comment dropped/);
  assert.match(msgs, /modifier 'r'/);
  assert.match(msgs, /layout tags/);
});

test('source map stays consistent with the emitted text for raw and regenerated tokens', () => {
  const score = parseGabc('name: T;\n%%\n(c4) Ky(fr)ri(g)e(h)');
  const edited = score.items.find((i) => i.kind === 'syllable' && i.lyric === 'ri');
  assert.ok(edited && edited.kind === 'syllable');
  edited.groups[0].notes[0].pitch = 8;
  const { gabc, spans } = serializeGabcWithMap(score);
  for (const s of spans) {
    assert.ok(s.start >= 0 && s.end <= gabc.length && s.start <= s.end, 'span inside text');
    assert.ok(s.tokenStart <= s.start && s.end <= s.tokenEnd, 'note span inside its token');
  }
  const note = spans.find((s) => s.noteId === edited.groups[0].notes[0].id)!;
  assert.equal(gabc.slice(note.start, note.end), 'i');
  assert.equal(serializeGabc(score), gabc);
});

import { validateGabc } from '@/src/lib/gabc/validator';

test('validator surfaces unmodeled features as located warnings, not errors', () => {
  const src = 'name: T;\n%%\n(c4) Ky(fr)ri(g)e(h)';
  const res = validateGabc(src);
  assert.equal(res.valid, true);
  const w = res.warnings.find((x) => /modifier 'r'/.test(x.message));
  assert.ok(w, 'warning present');
  assert.equal(src.slice(w.start, w.end), '(fr)');
});
