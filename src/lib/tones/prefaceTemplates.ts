import { ChantLanguage } from '@/src/types/chant';
import { toToneSyllables } from './latinAccent';

export type PrefaceTemplateKind = 'opening' | 'closing' | 'phrase';

export type PrefaceTemplateStatus = 'user-verified' | 'needs-review';

export interface PrefaceTemplate {
  id: string;
  language: ChantLanguage;
  tone: string;
  kind: PrefaceTemplateKind;
  text: string;
  /** Note groups aligned to syllables, stored without header or clef. */
  gabc: string;
  verified: boolean;
  source: string;
  /** Alternative text spellings/wordings mapped to this template without inventing GABC. */
  variants?: string[];
}

export function getPrefaceTemplateStatus(
  template: Pick<PrefaceTemplate, 'verified'>
): PrefaceTemplateStatus {
  return template.verified ? 'user-verified' : 'needs-review';
}

export interface WordDiffToken {
  type: 'equal' | 'insert' | 'delete';
  word: string;
}

export interface TemplateAlignmentResult {
  aligned: boolean;
  expectedSyllables: number;
  actualSyllables: number;
}

export interface TemplateMatchResult {
  matched: boolean;
  template?: PrefaceTemplate;
  /** True when matched via `variants` rather than primary `text`. */
  isVariant?: boolean;
  /** Rendered body GABC (verbatim for primary text; note-mapped for aligned variants). */
  gabc?: string;
  /** Populated when text matched or partially matched a template whose syllable count differed. */
  rejectedCandidate?: PrefaceTemplate;
  syllableMismatch?: { expected: number; actual: number };
  diff?: WordDiffToken[];
}

export const PREFACE_TEMPLATES_STORAGE_KEY = 'chantscore.prefaceTemplates.v1';
export const PREFACE_HIDDEN_TEMPLATES_STORAGE_KEY = 'chantscore.prefaceTemplates.hidden.v1';

const LA_OPENING_TEXT = `Vere dignum et iustum est,
æquum et salutáre;
nos tibi semper et ubíque
grátias ágere:
Dómine, sancte Pater, omnípotens ætérne Deus:
per Christum Dóminum nostrum.`;

const LA_OPENING_GABC = `Ve(f)re(h) di(h)gnum(h) et(h) iu(h)stum(h) est,(h) (,)
æ(h)quum(h) et(h) sa(h)lu(gf)tá(fg)re,(g) (;)
nos(f) ti(h)bi(h) sem(h)per(h) et(h) u(h)bí(h)que(h) (,)
grá(h)ti(g)as(gf) á(fg)ge(g)re:(g) (;)
Dó(f)mi(h)ne,(h) san(h)cte(h) Pa(h)ter,(h) om(h)ní(h)po(h)tens(h) æ(h)tér(h)ne(gf) De(fg)us:(g) (;)
per(g) Chri(f!gwh)stum(g) Dó(fe)mi(ef)num(g) no(fg)strum.(f) (:)`;

const LA_CLOSING_TEXT = `Et ídeo, cum Angelis et Archángelis,
cum Thronis et Dominationibus,
cumque omni milítia cæléstis exércitus,
hymnum glóriæ tuæ cánimus,
sine fine dicéntes:`;

const LA_CLOSING_GABC = `Et(f) í(ef)de(f)o(f) (,) cum(f) An(h)ge(h)lis(h) et(h) Ar(gf)chán(fg)ge(g)lis,(g) (;)
cum(f) Thro(h)nis(h) et(h) Do(h)mi(h)na(h)ti(gf)ó(fg)ni(g)bus,(g) (;)
cum(f)que(h) om(h)ni(h) mi(h)lí(h)ti(h)a(h) cæ(h)lé(h)stis(g) e(gf)xér(fg)ci(g)tus,(g) (;)
hym(f)num(h) gló(h)ri(h)æ(h) tu(h)æ(gf) cá(fg)ni(g)mus,(g) (;)
si(f!gwh)ne(g) fi(fe)ne(ef) di(g)cén(fg)tes:(f)`;

const EN_OPENING_SHORT_TEXT = `It is truly right and just, our duty and our salvation,
always and everywhere to give you thanks,
Lord, holy Father, almighty and eternal God.`;

const EN_OPENING_SHORT_GABC = `It(f) is(h) tru(h)ly(h) right(h) and(h) just,(h) (,) our(h) du(h)ty(h) and(h) our(g) sal(f)va(fg)tion,(g) (;)
al(f)ways(h) and(h) ev(h)ery(h)where(h) to(h) give(hg) you(f) thanks,(g) (;)
Lord,(f) ho(h)ly(h) Fa(h)ther,(h) al(h)migh(h)ty(h) and(h) e(h)ter(hg)nal(f) God.(g) (:)`;

const EN_OPENING_TEXT = `It is truly right and just, our duty and our salvation,
always and everywhere to give you thanks,
Lord, holy Father, almighty and eternal God,
through Christ our Lord.`;

const EN_OPENING_GABC = `It(f) is(h) tru(h)ly(h) right(h) and(h) just,(h) (,) our(h) du(h)ty(h) and(h) our(g) sal(f)va(fg)tion,(g) (;)
al(f)ways(h) and(h) ev(h)ery(h)where(h) to(h) give(hg) you(f) thanks,(g) (;)
Lord,(f) ho(h)ly(h) Fa(h)ther,(h) al(h)migh(h)ty(h) and(h) e(h)ter(hg)nal(f) God,(g) (;)
through(g) Christ(fe) our(g) Lord.(fgf) (:)`;

const EN_CLOSING_SHORT_TEXT = `And so, Lord, with all the Angels and Saints,
we, too, give you thanks,
as in exultation we acclaim:`;

const EN_CLOSING_SHORT_GABC = `And(f) so,(h) Lord,(h) with(h) all(h) the(h) An(h)gels(g) and(f) Saints,(g) (;)
we,(g) too,(g) give(f) you(g) thanks,(h) (,)
as(g) in(g) ex(g)ul(g)ta(f)tion(e) we(ef) ac(g)claim:(f) (::)`;

const EN_CLOSING_TEXT = `And so, with Angels and Archangels,
with Thrones and Dominions,
and with all the hosts and Powers of heaven,
we sing the hymn of your glory,
as without end we acclaim:`;

const EN_CLOSING_GABC = `And(f) so,(h) with(h) An(h)gels(g) and(gf) Arch(fg)an(g)gels,(g) (;)
with(g) Thrones(g) and(g) Do(f)min(g)ions,(h) (,)
and(g) with(g) all(g) the(g) hosts(g) and(g) Pow(g)ers(g) of(f) heav(g)en,(h) (,)
we(g) sing(g) the(g) hymn(g) of(g) your(f) glo(g)ry,(h) (,)
as(g) with(g)out(f) end(e) we(ef) ac(g)claim:(f) (::)`;

const EN_CLOSING_VARIANT_ALL_ANGELS = `And so, with all the Angels and Archangels,
with Thrones and Dominions,
and with all the hosts and Powers of heaven,
we sing the hymn of your glory,
as without end we acclaim:`;

export const SEED_PREFACE_TEMPLATES: PrefaceTemplate[] = [
  {
    id: 'la-opening-solemn',
    language: 'la',
    tone: 'preface-solemn',
    kind: 'opening',
    text: LA_OPENING_TEXT,
    gabc: LA_OPENING_GABC,
    verified: true,
    source: 'user-supplied setting',
  },
  {
    id: 'la-closing-solemn',
    language: 'la',
    tone: 'preface-solemn',
    kind: 'closing',
    text: LA_CLOSING_TEXT,
    gabc: LA_CLOSING_GABC,
    verified: true,
    source: 'user-supplied setting',
  },
  {
    id: 'en-opening-solemn-short',
    language: 'en',
    tone: 'preface-solemn',
    kind: 'opening',
    text: EN_OPENING_SHORT_TEXT,
    gabc: EN_OPENING_SHORT_GABC,
    verified: true,
    source: 'user-supplied setting',
  },
  {
    id: 'en-opening-solemn',
    language: 'en',
    tone: 'preface-solemn',
    kind: 'opening',
    text: EN_OPENING_TEXT,
    gabc: EN_OPENING_GABC,
    verified: false,
    source: 'generated, needs review',
  },
  {
    id: 'en-closing-solemn-short',
    language: 'en',
    tone: 'preface-solemn',
    kind: 'closing',
    text: EN_CLOSING_SHORT_TEXT,
    gabc: EN_CLOSING_SHORT_GABC,
    verified: true,
    source: 'user-supplied setting',
  },
  {
    id: 'en-closing-solemn',
    language: 'en',
    tone: 'preface-solemn',
    kind: 'closing',
    text: EN_CLOSING_TEXT,
    gabc: EN_CLOSING_GABC,
    verified: false,
    source: 'generated, needs review',
    variants: [EN_CLOSING_VARIANT_ALL_ANGELS],
  },
  {
    id: 'en-phrase-through-christ',
    language: 'en',
    tone: 'preface-solemn',
    kind: 'phrase',
    text: 'through Christ our Lord.',
    gabc: 'through(g) Christ(fe) our(g) Lord.(fgf)',
    verified: false,
    source: 'generated, needs review',
  },
  {
    id: 'la-phrase-per-christum',
    language: 'la',
    tone: 'preface-solemn',
    kind: 'phrase',
    text: 'Per Christum Dóminum nostrum.',
    gabc: 'per(g) Chri(f!gwh)stum(g) Dó(fe)mi(ef)num(g) no(fg)strum.(f)',
    verified: true,
    source: 'user-supplied setting',
  },
];

/**
 * Normalize text for template matching and diff comparison:
 * normalizes case, whitespace, curly quotes/apostrophes, ligatures (æ/œ),
 * diacritics, punctuation, and Latin spelling variants (j->i, v->u, ae/oe->e, xs->x).
 */
export function normalizePrefaceText(text: string): string {
  return text
    .normalize('NFC')
    .replace(/[æǽÆǼ]/g, 'ae')
    .replace(/[œŒ]/g, 'oe')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[‘’`´]/g, "'")
    .replace(/[“”«»]/g, '"')
    .toLowerCase()
    .replace(/j/g, 'i')
    .replace(/v/g, 'u')
    .replace(/(?:ae|oe)/g, 'e')
    .replace(/xs/g, 'x')
    .replace(/[.,;:?!'"()\[\]{}—–\-…\/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenizeNormalizedWords(text: string): string[] {
  const norm = normalizePrefaceText(text);
  return norm ? norm.split(' ') : [];
}

/**
 * Remove any GABC header (`... %%`) and leading clef `(c3)`/`(f4)` if present.
 */
export function stripGabcHeaderAndClef(rawGabc: string): string {
  let body = rawGabc.trim();
  const sepIdx = body.indexOf('%%');
  if (sepIdx >= 0) {
    body = body.slice(sepIdx + 2).trim();
  }
  body = body.replace(/^\((?:c|f)b?[1-4]\)\s*/i, '').trim();
  return body;
}

export interface GabcSyllableToken {
  text: string;
  notes: string;
}

const NON_SYLLABLE_NOTE_RE = /^(?:[,;:`]+|z0?|Z0?|(?:c|f)b?[1-4])$/;

/** Extract syllable + note group pairs from body GABC (excluding division bars, line breaks, and clefs). */
export function extractGabcSyllables(gabc: string): GabcSyllableToken[] {
  const body = stripGabcHeaderAndClef(gabc);
  const out: GabcSyllableToken[] = [];
  const re = /([^\s()]+)\(([^)]*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const text = m[1];
    const notes = m[2];
    if (!text || NON_SYLLABLE_NOTE_RE.test(notes)) continue;
    out.push({ text, notes });
  }
  return out;
}

export function countGabcSyllables(gabc: string): number {
  return extractGabcSyllables(gabc).length;
}

export function checkTemplateAlignment(
  text: string,
  template: Pick<PrefaceTemplate, 'language' | 'gabc'>
): TemplateAlignmentResult {
  const actualSyllables = toToneSyllables(text, { language: template.language }).length;
  const expectedSyllables = countGabcSyllables(template.gabc);
  return {
    aligned: actualSyllables > 0 && actualSyllables === expectedSyllables,
    expectedSyllables,
    actualSyllables,
  };
}

/** Map a template's syllable note groups 1-to-1 onto new text with identical syllable count, preserving division bars and line breaks. */
export function mapTemplateNotesToText(
  text: string,
  template: Pick<PrefaceTemplate, 'language' | 'gabc'>
): string | null {
  const inputSylls = toToneSyllables(text, { language: template.language });
  const body = stripGabcHeaderAndClef(template.gabc);
  const re = /([^\s()]*)\(([^)]*)\)/g;
  const syllPositions: { start: number; end: number; notes: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const sylText = m[1];
    const notes = m[2];
    if (!sylText || NON_SYLLABLE_NOTE_RE.test(notes)) continue;
    syllPositions.push({ start: m.index, end: m.index + m[0].length, notes });
  }
  if (inputSylls.length === 0 || inputSylls.length !== syllPositions.length) return null;

  let out = body.slice(0, syllPositions[0].start);
  inputSylls.forEach((s, i) => {
    const cleanText = s.text.replace(/[()\[\]<>]/g, '');
    out += `${cleanText}(${syllPositions[i].notes})`;
    if (i < inputSylls.length - 1) {
      const gap = body.slice(syllPositions[i].end, syllPositions[i + 1].start);
      if (/\S/.test(gap)) {
        out += gap;
      } else if (s.wordEnd) {
        out += gap || ' ';
      }
    }
  });
  out += body.slice(syllPositions[syllPositions.length - 1].end);
  return out;
}

/** Word-level LCS similarity in [0, 1] over normalized words. */
export function tokenSimilarity(a: string, b: string): number {
  const wa = tokenizeNormalizedWords(a);
  const wb = tokenizeNormalizedWords(b);
  if (wa.length === 0 && wb.length === 0) return 1;
  if (wa.length === 0 || wb.length === 0) return 0;

  const lcsLen = computeLcsLength(wa, wb);
  return (2 * lcsLen) / (wa.length + wb.length);
}

function computeLcsLength(a: string[], b: string[]): number {
  const m = a.length;
  const n = b.length;
  let prev = new Array<number>(n + 1).fill(0);
  let curr = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) curr[j] = prev[j - 1] + 1;
      else curr[j] = prev[j] >= curr[j - 1] ? prev[j] : curr[j - 1];
    }
    const tmp = prev;
    prev = curr;
    curr = tmp;
    curr.fill(0);
  }
  return prev[n];
}

/**
 * Word-level diff comparing `actualText` against `expectedText` (e.g. template text).
 * `equal`: matched word, `insert`: extra/changed word in pasted text, `delete`: missing template word.
 */
export function computeWordDiff(actualText: string, expectedText: string): WordDiffToken[] {
  const actualRaw = actualText.trim().split(/\s+/).filter(Boolean);
  const expectedRaw = expectedText.trim().split(/\s+/).filter(Boolean);
  const actualNorm = actualRaw.map((w) => normalizePrefaceText(w));
  const expectedNorm = expectedRaw.map((w) => normalizePrefaceText(w));

  const m = actualNorm.length;
  const n = expectedNorm.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (actualNorm[i - 1] && actualNorm[i - 1] === expectedNorm[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const out: WordDiffToken[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && actualNorm[i - 1] && actualNorm[i - 1] === expectedNorm[j - 1]) {
      out.push({ type: 'equal', word: actualRaw[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      out.push({ type: 'delete', word: expectedRaw[j - 1] });
      j--;
    } else {
      out.push({ type: 'insert', word: actualRaw[i - 1] });
      i--;
    }
  }
  return out.reverse();
}

/**
 * Match `text` against templates of `(language, tone, kind)`.
 * Verifies normalized text AND exact syllable count alignment.
 */
export function matchPrefaceTemplate(
  text: string,
  templates: PrefaceTemplate[],
  filter: { language: ChantLanguage; tone: string; kind: PrefaceTemplateKind }
): TemplateMatchResult {
  const normInput = normalizePrefaceText(text);
  if (!normInput) return { matched: false };

  const candidates = templates.filter(
    (t) => t.language === filter.language && t.tone === filter.tone && t.kind === filter.kind
  );

  // Prefer verified templates over unverified ones when both exist
  const ordered = [
    ...candidates.filter((t) => t.verified),
    ...candidates.filter((t) => !t.verified),
  ];

  for (const tpl of ordered) {
    const isPrimary = normalizePrefaceText(tpl.text) === normInput;
    const isVariant =
      !isPrimary && (tpl.variants ?? []).some((v) => normalizePrefaceText(v) === normInput);

    if (!isPrimary && !isVariant) continue;

    const alignment = checkTemplateAlignment(text, tpl);
    if (!alignment.aligned) {
      return {
        matched: false,
        rejectedCandidate: tpl,
        syllableMismatch: {
          expected: alignment.expectedSyllables,
          actual: alignment.actualSyllables,
        },
        diff: computeWordDiff(text, tpl.text),
      };
    }

    if (isPrimary) {
      const stripEdgePunct = (w: string) => w.replace(/^[.,;:?!'"()\[\]{}—–\-…\/]+|[.,;:?!'"()\[\]{}—–\-…\/]+$/g, '');
      const inputWords = text.trim().split(/\s+/).filter(Boolean).map(stripEdgePunct);
      const tplWords = tpl.text.trim().split(/\s+/).filter(Boolean).map(stripEdgePunct);
      const exactRawWords =
        inputWords.length === tplWords.length && inputWords.every((w, idx) => w === tplWords[idx]);
      if (exactRawWords) {
        return {
          matched: true,
          template: tpl,
          isVariant: false,
          gabc: stripGabcHeaderAndClef(tpl.gabc),
        };
      }
      const mapped = mapTemplateNotesToText(text, tpl);
      if (!mapped) {
        return {
          matched: false,
          rejectedCandidate: tpl,
          syllableMismatch: {
            expected: alignment.expectedSyllables,
            actual: alignment.actualSyllables,
          },
          diff: computeWordDiff(text, tpl.text),
        };
      }
      return {
        matched: true,
        template: tpl,
        isVariant: false,
        gabc: mapped,
      };
    }

    const mapped = mapTemplateNotesToText(text, tpl);
    if (!mapped) {
      return {
        matched: false,
        rejectedCandidate: tpl,
        syllableMismatch: {
          expected: alignment.expectedSyllables,
          actual: alignment.actualSyllables,
        },
        diff: computeWordDiff(text, tpl.text),
      };
    }

    return {
      matched: true,
      template: tpl,
      isVariant: true,
      gabc: mapped,
    };
  }

  return { matched: false };
}

function safeStorageGet(key: string): string | null {
  try {
    if (typeof localStorage !== 'undefined') return localStorage.getItem(key);
  } catch {
    /* ignore */
  }
  return null;
}

function safeStorageSet(key: string, value: string): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

function isValidTemplate(raw: unknown): raw is PrefaceTemplate {
  if (!raw || typeof raw !== 'object') return false;
  const r = raw as Record<string, unknown>;
  return (
    typeof r.id === 'string' &&
    r.id.length > 0 &&
    (r.language === 'la' || r.language === 'en') &&
    typeof r.tone === 'string' &&
    r.tone.length > 0 &&
    (r.kind === 'opening' || r.kind === 'closing' || r.kind === 'phrase') &&
    typeof r.text === 'string' &&
    typeof r.gabc === 'string' &&
    typeof r.verified === 'boolean' &&
    typeof r.source === 'string'
  );
}

export function loadHiddenPrefaceTemplateIds(): string[] {
  const raw = safeStorageGet(PREFACE_HIDDEN_TEMPLATES_STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function saveHiddenPrefaceTemplateIds(ids: string[]): void {
  const unique = [...new Set(ids.filter((id) => typeof id === 'string' && id.length > 0))];
  safeStorageSet(PREFACE_HIDDEN_TEMPLATES_STORAGE_KEY, JSON.stringify(unique));
}

/** Merge user-saved templates over seeded defaults (user templates win on id or normalized key). */
export function mergePrefaceTemplates(
  userTemplates: PrefaceTemplate[],
  hiddenSeedIds: string[] = loadHiddenPrefaceTemplateIds()
): PrefaceTemplate[] {
  const hiddenSet = new Set(hiddenSeedIds);
  const byKey = new Map<string, PrefaceTemplate>();
  const keyOf = (t: PrefaceTemplate) =>
    `${t.language}|${t.tone}|${t.kind}|${normalizePrefaceText(t.text)}`;

  for (const seed of SEED_PREFACE_TEMPLATES) {
    if (hiddenSet.has(seed.id)) continue;
    byKey.set(keyOf(seed), seed);
  }
  for (const u of userTemplates) {
    if (!isValidTemplate(u)) continue;
    // Also replace any seed with the same id even if wording slightly changed
    for (const [k, existing] of byKey.entries()) {
      if (existing.id === u.id) byKey.delete(k);
    }
    byKey.set(keyOf(u), { ...u, gabc: stripGabcHeaderAndClef(u.gabc) });
  }
  return [...byKey.values()];
}

export function loadUserPrefaceTemplates(): PrefaceTemplate[] {
  const raw = safeStorageGet(PREFACE_TEMPLATES_STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidTemplate);
  } catch {
    return [];
  }
}

export function loadPrefaceTemplates(): PrefaceTemplate[] {
  return mergePrefaceTemplates(loadUserPrefaceTemplates(), loadHiddenPrefaceTemplateIds());
}

export function saveUserPrefaceTemplates(userTemplates: PrefaceTemplate[]): PrefaceTemplate[] {
  const cleaned = userTemplates.filter(isValidTemplate).map((t) => ({
    ...t,
    gabc: stripGabcHeaderAndClef(t.gabc),
  }));
  safeStorageSet(PREFACE_TEMPLATES_STORAGE_KEY, JSON.stringify(cleaned));
  return mergePrefaceTemplates(cleaned, loadHiddenPrefaceTemplateIds());
}

export function saveCorrectedPrefaceTemplate(input: {
  id?: string;
  language: ChantLanguage;
  tone: string;
  kind: PrefaceTemplateKind;
  text: string;
  gabc: string;
  variants?: string[];
}): { template: PrefaceTemplate; templates: PrefaceTemplate[] } {
  const userTemplates = loadUserPrefaceTemplates();
  const normText = normalizePrefaceText(input.text);
  const existingUserIdx = userTemplates.findIndex(
    (t) =>
      (input.id && t.id === input.id) ||
      (t.language === input.language &&
        t.tone === input.tone &&
        t.kind === input.kind &&
        normalizePrefaceText(t.text) === normText)
  );

  const seedMatch = SEED_PREFACE_TEMPLATES.find(
    (t) =>
      (input.id && t.id === input.id) ||
      (t.language === input.language &&
        t.tone === input.tone &&
        t.kind === input.kind &&
        normalizePrefaceText(t.text) === normText)
  );

  const template: PrefaceTemplate = {
    id:
      existingUserIdx >= 0
        ? userTemplates[existingUserIdx].id
        : input.id || seedMatch?.id || `user-${input.language}-${input.kind}-${Date.now()}`,
    language: input.language,
    tone: input.tone,
    kind: input.kind,
    text: input.text.trim(),
    gabc: stripGabcHeaderAndClef(input.gabc),
    verified: true,
    source: 'user-corrected',
    ...(input.variants ?? seedMatch?.variants ? { variants: input.variants ?? seedMatch?.variants } : {}),
  };

  if (existingUserIdx >= 0) {
    userTemplates[existingUserIdx] = template;
  } else {
    userTemplates.push(template);
  }
  const hidden = loadHiddenPrefaceTemplateIds();
  if (hidden.includes(template.id)) {
    saveHiddenPrefaceTemplateIds(hidden.filter((hid) => hid !== template.id));
  }
  const templates = saveUserPrefaceTemplates(userTemplates);
  return { template, templates };
}

export function markPrefaceTemplateVerified(id: string): {
  template: PrefaceTemplate | null;
  templates: PrefaceTemplate[];
} {
  const current = loadPrefaceTemplates();
  const target = current.find((t) => t.id === id);
  if (!target) {
    return { template: null, templates: current };
  }
  const userTemplates = loadUserPrefaceTemplates();
  const nextSource =
    target.source === 'generated, needs review' ? 'user-verified' : target.source;
  const updated: PrefaceTemplate = {
    ...target,
    verified: true,
    source: nextSource,
  };
  const existingIdx = userTemplates.findIndex((t) => t.id === id);
  if (existingIdx >= 0) {
    userTemplates[existingIdx] = updated;
  } else {
    userTemplates.push(updated);
  }
  const hidden = loadHiddenPrefaceTemplateIds();
  if (hidden.includes(id)) {
    saveHiddenPrefaceTemplateIds(hidden.filter((hid) => hid !== id));
  }
  const templates = saveUserPrefaceTemplates(userTemplates);
  return { template: updated, templates };
}

export function deletePrefaceTemplate(id: string): PrefaceTemplate[] {
  const userTemplates = loadUserPrefaceTemplates().filter((t) => t.id !== id);
  if (SEED_PREFACE_TEMPLATES.some((s) => s.id === id)) {
    const hidden = loadHiddenPrefaceTemplateIds();
    if (!hidden.includes(id)) {
      saveHiddenPrefaceTemplateIds([...hidden, id]);
    }
  }
  return saveUserPrefaceTemplates(userTemplates);
}

export function restoreDefaultPrefaceTemplates(): PrefaceTemplate[] {
  saveHiddenPrefaceTemplateIds([]);
  return loadPrefaceTemplates();
}

export function exportPrefaceTemplatesJson(templates: PrefaceTemplate[] = loadPrefaceTemplates()): string {
  return JSON.stringify(templates, null, 2);
}

export function importPrefaceTemplatesJson(jsonText: string): {
  importedCount: number;
  templates: PrefaceTemplate[];
  error?: string;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return {
      importedCount: 0,
      templates: loadPrefaceTemplates(),
      error: 'Invalid JSON file.',
    };
  }

  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { templates?: unknown }).templates)
    ? (parsed as { templates: unknown[] }).templates
    : null;

  if (!list) {
    return {
      importedCount: 0,
      templates: loadPrefaceTemplates(),
      error: 'Expected a JSON array of preface templates.',
    };
  }

  const isObsoletePartEntry = (raw: unknown): boolean => {
    if (!raw || typeof raw !== 'object') return false;
    const r = raw as Record<string, unknown>;
    return (
      typeof r.kind === 'string' &&
      r.kind !== 'opening' &&
      r.kind !== 'closing' &&
      r.kind !== 'phrase'
    );
  };
  const activeEntries = list.filter((item) => !isObsoletePartEntry(item));
  const valid = activeEntries.filter(isValidTemplate);
  if (valid.length === 0) {
    if (activeEntries.length === 0 && list.length > 0) {
      return { importedCount: 0, templates: loadPrefaceTemplates() };
    }
    return {
      importedCount: 0,
      templates: loadPrefaceTemplates(),
      error: 'No valid preface templates found in JSON.',
    };
  }

  const existingUser = loadUserPrefaceTemplates();
  const mergedUser = new Map<string, PrefaceTemplate>();
  const keyOf = (t: PrefaceTemplate) =>
    `${t.language}|${t.tone}|${t.kind}|${normalizePrefaceText(t.text)}`;
  for (const t of existingUser) mergedUser.set(keyOf(t), t);
  for (const t of valid) {
    mergedUser.set(keyOf(t), { ...t, gabc: stripGabcHeaderAndClef(t.gabc) });
  }

  const importedIds = new Set(valid.map((t) => t.id));
  const hidden = loadHiddenPrefaceTemplateIds();
  if (hidden.some((hid) => importedIds.has(hid))) {
    saveHiddenPrefaceTemplateIds(hidden.filter((hid) => !importedIds.has(hid)));
  }

  const templates = saveUserPrefaceTemplates([...mergedUser.values()]);
  return { importedCount: valid.length, templates };
}
