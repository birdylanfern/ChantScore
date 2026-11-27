/**
 * Exports render the score as SVG and draw it through an <img>. An SVG used as
 * an image cannot see the page's web fonts, so lyrics and titles silently fall
 * back to a default serif. This module fetches the bundled same-origin Latin
 * woff2 faces and inlines them into the SVG as base64 @font-face rules so
 * exports match the score typography and work offline. Everything degrades to
 * the previous behaviour if a font cannot be fetched.
 */

import type { BundledFontFace } from './fontFaceUrls';

export interface EmbeddableFont {
  family: string;
}

/** Keep in sync with src/styles/core-fonts.css and src/styles/font-*.css. */
export const EMBEDDABLE_FONTS: EmbeddableFont[] = [
  { family: 'Cinzel' },
  { family: 'Cormorant Garamond' },
  { family: 'Crimson Pro' },
  { family: 'EB Garamond' },
  { family: 'Lora' },
  { family: 'Plus Jakarta Sans' },
];

export function familiesUsedInSvg(svg: string): EmbeddableFont[] {
  return EMBEDDABLE_FONTS.filter((f) => svg.includes(f.family));
}

export function buildFontFaceCss(faces: { descriptors: string; dataUri: string }[]): string {
  return faces
    .map((f) => `@font-face{${f.descriptors};src:url(${f.dataUri}) format('woff2');}`)
    .join('\n');
}

export function injectStyleIntoSvg(svg: string, css: string): string {
  if (!css) return svg;
  return svg.replace(/<svg\b[^>]*>/, (open) => `${open}<defs><style>${css}</style></defs>`);
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

const cache = new Map<string, Promise<string>>();

export function clearFontEmbedCache(): void {
  cache.clear();
}

async function fetchWithTimeout(url: string, ms = 8000): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function defaultLoadFaces(family: string): Promise<BundledFontFace[]> {
  const { BUNDLED_FONT_FACES } = await import('./fontFaceUrls');
  return BUNDLED_FONT_FACES[family] ?? [];
}

async function loadFontCss(
  font: EmbeddableFont,
  getFaces: (family: string) => Promise<BundledFontFace[]>
): Promise<string> {
  const faces = await getFaces(font.family);
  if (faces.length === 0) return '';
  const withData = await Promise.all(
    faces.map(async (f) => {
      const bytes = new Uint8Array(await (await fetchWithTimeout(f.url)).arrayBuffer());
      return {
        descriptors: f.descriptors,
        dataUri: `data:font/woff2;base64,${bytesToBase64(bytes)}`,
      };
    })
  );
  return buildFontFaceCss(withData);
}

/** Returns the SVG with the fonts it uses embedded; returns the input unchanged on any failure. */
export async function embedFontsInSvg(
  svg: string,
  getFaces: (family: string) => Promise<BundledFontFace[]> = defaultLoadFaces
): Promise<string> {
  const used = familiesUsedInSvg(svg);
  if (used.length === 0) return svg;
  const chunks: string[] = [];
  for (const font of used) {
    const useCache = getFaces === defaultLoadFaces;
    let pending = useCache ? cache.get(font.family) : undefined;
    if (!pending) {
      pending = loadFontCss(font, getFaces);
      if (useCache) {
        cache.set(font.family, pending);
        pending.catch(() => cache.delete(font.family)); // allow a retry next export
      }
    }
    try {
      const css = await pending;
      if (css) chunks.push(css);
    } catch (err) {
      console.warn(
        `Could not embed font "${font.family}" in export; falling back to a system font.`,
        err
      );
    }
  }
  return injectStyleIntoSvg(svg, chunks.join('\n'));
}
