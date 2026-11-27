import type { ChantFontId } from '@/src/types/chant';

const loadedOptionalFonts = new Set<ChantFontId>();

/**
 * Load selectable non-default score font stylesheets only when used or selected.
 */
export function ensureFontFamilyLoaded(fontId?: ChantFontId): void {
  if (typeof document === 'undefined' || !fontId || loadedOptionalFonts.has(fontId)) return;
  loadedOptionalFonts.add(fontId);
  if (fontId === 'cormorant-garamond') {
    void import('@/src/styles/font-cormorant-garamond.css');
  } else if (fontId === 'crimson-pro') {
    void import('@/src/styles/font-crimson-pro.css');
  } else if (fontId === 'lora') {
    void import('@/src/styles/font-lora.css');
  }
}
