import cinzel400 from '@fontsource/cinzel/files/cinzel-latin-400-normal.woff2?url';
import cinzel600 from '@fontsource/cinzel/files/cinzel-latin-600-normal.woff2?url';
import cinzel700 from '@fontsource/cinzel/files/cinzel-latin-700-normal.woff2?url';

import cormorant400 from '@fontsource/cormorant-garamond/files/cormorant-garamond-latin-400-normal.woff2?url';
import cormorant400i from '@fontsource/cormorant-garamond/files/cormorant-garamond-latin-400-italic.woff2?url';
import cormorant600 from '@fontsource/cormorant-garamond/files/cormorant-garamond-latin-600-normal.woff2?url';

import crimson400 from '@fontsource/crimson-pro/files/crimson-pro-latin-400-normal.woff2?url';
import crimson400i from '@fontsource/crimson-pro/files/crimson-pro-latin-400-italic.woff2?url';
import crimson600 from '@fontsource/crimson-pro/files/crimson-pro-latin-600-normal.woff2?url';

import ebGaramond400 from '@fontsource/eb-garamond/files/eb-garamond-latin-400-normal.woff2?url';
import ebGaramond400i from '@fontsource/eb-garamond/files/eb-garamond-latin-400-italic.woff2?url';
import ebGaramond500 from '@fontsource/eb-garamond/files/eb-garamond-latin-500-normal.woff2?url';
import ebGaramond600 from '@fontsource/eb-garamond/files/eb-garamond-latin-600-normal.woff2?url';

import lora400 from '@fontsource/lora/files/lora-latin-400-normal.woff2?url';
import lora400i from '@fontsource/lora/files/lora-latin-400-italic.woff2?url';
import lora600 from '@fontsource/lora/files/lora-latin-600-normal.woff2?url';

import plusJakarta400 from '@fontsource/plus-jakarta-sans/files/plus-jakarta-sans-latin-400-normal.woff2?url';
import plusJakarta500 from '@fontsource/plus-jakarta-sans/files/plus-jakarta-sans-latin-500-normal.woff2?url';
import plusJakarta600 from '@fontsource/plus-jakarta-sans/files/plus-jakarta-sans-latin-600-normal.woff2?url';
import plusJakarta700 from '@fontsource/plus-jakarta-sans/files/plus-jakarta-sans-latin-700-normal.woff2?url';

export interface BundledFontFace {
  descriptors: string;
  url: string;
}

/** Keep in sync with src/styles/core-fonts.css and src/styles/font-*.css. */
export const BUNDLED_FONT_FACES: Record<string, BundledFontFace[]> = {
  Cinzel: [
    { descriptors: "font-family: 'Cinzel'; font-style: normal; font-weight: 400", url: cinzel400 },
    { descriptors: "font-family: 'Cinzel'; font-style: normal; font-weight: 600", url: cinzel600 },
    { descriptors: "font-family: 'Cinzel'; font-style: normal; font-weight: 700", url: cinzel700 },
  ],
  'Cormorant Garamond': [
    { descriptors: "font-family: 'Cormorant Garamond'; font-style: normal; font-weight: 400", url: cormorant400 },
    { descriptors: "font-family: 'Cormorant Garamond'; font-style: italic; font-weight: 400", url: cormorant400i },
    { descriptors: "font-family: 'Cormorant Garamond'; font-style: normal; font-weight: 600", url: cormorant600 },
  ],
  'Crimson Pro': [
    { descriptors: "font-family: 'Crimson Pro'; font-style: normal; font-weight: 400", url: crimson400 },
    { descriptors: "font-family: 'Crimson Pro'; font-style: italic; font-weight: 400", url: crimson400i },
    { descriptors: "font-family: 'Crimson Pro'; font-style: normal; font-weight: 600", url: crimson600 },
  ],
  'EB Garamond': [
    { descriptors: "font-family: 'EB Garamond'; font-style: normal; font-weight: 400", url: ebGaramond400 },
    { descriptors: "font-family: 'EB Garamond'; font-style: italic; font-weight: 400", url: ebGaramond400i },
    { descriptors: "font-family: 'EB Garamond'; font-style: normal; font-weight: 500", url: ebGaramond500 },
    { descriptors: "font-family: 'EB Garamond'; font-style: normal; font-weight: 600", url: ebGaramond600 },
  ],
  Lora: [
    { descriptors: "font-family: 'Lora'; font-style: normal; font-weight: 400", url: lora400 },
    { descriptors: "font-family: 'Lora'; font-style: italic; font-weight: 400", url: lora400i },
    { descriptors: "font-family: 'Lora'; font-style: normal; font-weight: 600", url: lora600 },
  ],
  'Plus Jakarta Sans': [
    { descriptors: "font-family: 'Plus Jakarta Sans'; font-style: normal; font-weight: 400", url: plusJakarta400 },
    { descriptors: "font-family: 'Plus Jakarta Sans'; font-style: normal; font-weight: 500", url: plusJakarta500 },
    { descriptors: "font-family: 'Plus Jakarta Sans'; font-style: normal; font-weight: 600", url: plusJakarta600 },
    { descriptors: "font-family: 'Plus Jakarta Sans'; font-style: normal; font-weight: 700", url: plusJakarta700 },
  ],
};
