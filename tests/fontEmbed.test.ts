import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFontFaceCss,
  clearFontEmbedCache,
  EMBEDDABLE_FONTS,
  embedFontsInSvg,
  familiesUsedInSvg,
  injectStyleIntoSvg,
} from '@/src/lib/export/fontEmbed';
import { BUNDLED_FONT_FACES } from '@/src/lib/export/fontFaceUrls';

test('all bundled fonts provide latin woff2 faces with font-family, style, and weight', () => {
  for (const font of EMBEDDABLE_FONTS) {
    const faces = BUNDLED_FONT_FACES[font.family];
    assert.ok(faces && faces.length > 0, `expected faces for ${font.family}`);
    for (const face of faces) {
      assert.match(face.descriptors, new RegExp(`font-family:\\s*'${font.family}'`));
      assert.match(face.descriptors, /font-style:\s*(normal|italic)/);
      assert.match(face.descriptors, /font-weight:\s*\d{3}/);
      assert.match(face.url, /\.woff2/);
    }
  }
});

test('css is injected right after the svg opening tag', () => {
  const css = buildFontFaceCss([
    { descriptors: "font-family: 'X'", dataUri: 'data:font/woff2;base64,AAAA' },
  ]);
  const out = injectStyleIntoSvg(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1"><text>a</text></svg>',
    css
  );
  assert.match(
    out,
    /^<svg [^>]*><defs><style>@font-face\{font-family: 'X';src:url\(data:font\/woff2;base64,AAAA\)/
  );
  assert.equal(injectStyleIntoSvg('<svg></svg>', ''), '<svg></svg>');
});

test('only fonts actually referenced are selected', () => {
  const svg = '<svg><text font-family="&quot;Cinzel&quot;, serif">x</text></svg>';
  assert.deepEqual(
    familiesUsedInSvg(svg).map((f) => f.family),
    ['Cinzel']
  );
});

test('embedFontsInSvg fetches bundled woff2 URLs offline and degrades gracefully on fetch failure', async () => {
  const prevFetch = globalThis.fetch;
  clearFontEmbedCache();
  const requested: string[] = [];

  try {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      requested.push(String(input));
      return new Response(new Uint8Array([0x77, 0x4f, 0x46, 0x32]), { status: 200 });
    }) as typeof fetch;

    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text font-family="&quot;Lora&quot;, serif">Kyrie</text></svg>';
    const embedded = await embedFontsInSvg(svg, async () => [
      { descriptors: "font-family: 'Lora'; font-style: normal; font-weight: 400", url: '/assets/lora-latin-400-normal.woff2' },
    ]);
    assert.deepEqual(requested, ['/assets/lora-latin-400-normal.woff2']);
    assert.match(embedded, /data:font\/woff2;base64,d09GMg==/);

    // Failure degrades cleanly without throwing
    globalThis.fetch = (async () => new Response(null, { status: 404 })) as typeof fetch;
    const fallback = await embedFontsInSvg(svg, async () => [
      { descriptors: "font-family: 'Lora'; font-style: normal; font-weight: 400", url: '/assets/missing.woff2' },
    ]);
    assert.equal(fallback, svg);
  } finally {
    clearFontEmbedCache();
    globalThis.fetch = prevFetch;
  }
});
