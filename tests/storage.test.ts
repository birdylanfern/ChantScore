import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGabc } from '@/src/lib/gabc/parser';
import { serializeGabc } from '@/src/lib/gabc/serializer';
import {
  PROJECT_SCHEMA_VERSION,
  parseProjectJson,
  serializeProjectJson,
  unwrapProject,
} from '@/src/lib/projectStorage';
import { buildShareUrl, decodeShareFragment, encodeShareFragment } from '@/src/lib/shareLink';

const score = parseGabc('name: Tést ✠;\n%%\n(c4) Al(f)le(g)lu(h)ia.(h)');

test('project file round-trips and keeps raw GABC tokens and typography', () => {
  const withTypo = { ...score, typography: { lyricFont: 'cinzel' as const, lyricFontSize: 20, titleFont: 'cinzel' as const, titleFontSize: 30, officePartFontSize: 12, modeFontSize: 12, lineSpacing: 1 } };
  const back = parseProjectJson(serializeProjectJson(withTypo));
  assert.ok(back);
  assert.equal(back.typography?.lyricFontSize, 20);
  assert.equal(serializeGabc(back), serializeGabc(withTypo));
});

test('legacy v1 bare scores still load', () => {
  assert.ok(unwrapProject(JSON.parse(JSON.stringify(score))));
});

test('files from a newer schema are refused, not mangled', () => {
  const env = { app: 'chantscore', schema: PROJECT_SCHEMA_VERSION + 1, savedAt: '', score };
  assert.equal(unwrapProject(env), null);
});

test('garbage is rejected', () => {
  assert.equal(parseProjectJson('not json'), null);
  assert.equal(parseProjectJson('{"items":[{"kind":"clef","id":"x","clef":"zz"}],"header":{"name":"x"}}'), null);
});

test('share fragment round-trips unicode GABC', () => {
  const gabc = serializeGabc(score);
  const frag = encodeShareFragment(gabc);
  assert.ok(frag && frag.startsWith('#gabc='));
  assert.equal(decodeShareFragment(frag), gabc);
});

test('share fragment rejects junk and oversized input', () => {
  assert.equal(decodeShareFragment('#gabc=***'), null);
  assert.equal(decodeShareFragment('#other=abc'), null);
  assert.equal(encodeShareFragment('(f)'.repeat(40000)), null);
  assert.equal(buildShareUrl('(f)'.repeat(40000), 'https://x.y/'), null);
});
