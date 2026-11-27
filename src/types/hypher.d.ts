declare module 'hypher' {
  export interface HyphenationPattern {
    id: string | string[];
    leftmin: number;
    rightmin: number;
    patterns: Record<number, string>;
    exceptions?: string;
  }

  export default class Hypher {
    constructor(language: HyphenationPattern);
    hyphenate(word: string): string[];
    hyphenateText(text: string): string;
  }
}

declare module 'hyphenation.en-us' {
  import type { HyphenationPattern } from 'hypher';
  const pattern: HyphenationPattern;
  export default pattern;
}
