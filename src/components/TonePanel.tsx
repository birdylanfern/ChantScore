import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, ChevronUp, PanelBottom, PanelRight, RotateCcw, Scissors } from 'lucide-react';
import {
  ChantLanguage,
  PhraseBreakKey,
  ToneLayoutMode,
  TonePhraseLinkItem,
} from '@/src/types/chant';
import {
  EnglishPrefaceRole,
  getReadingCadence,
  parseToneDefinition,
  ReadingCadenceKind,
  toneToDefinition,
} from '@/src/lib/tones/tone';
import {
  clampAutoJoinShortPhrases,
  DEFAULT_AUTO_JOIN_SHORT_PHRASES,
  extractReadingPhrases,
  extractTonePreview,
  getReadingWordList,
  joinPhraseBreak,
  PhraseCadenceChoice,
  pointText,
  prunePhraseBreakKeys,
  ReadingPhrase,
  remapPhraseBreakKeys,
  restoreBreakWithForcedBreaks,
  restoreMergedBreakKey,
  splitMergedPhraseBreaks,
  splitPhraseWithForcedBreaks,
  toggleExtraBreakKey,
  ToneMode,
} from '@/src/lib/tones/pointing';
import { buildPsalmTone, listPsalmTones, psalmToneLabel } from '@/src/lib/tones/psalmTones';
import {
  DEFAULT_READING_OPENING_FORMULA,
  getReadingOpeningFormulaText,
  migrateSavedReadingOpeningFormula,
  normalizeReadingOpeningFormula,
  PREFACE_TONES,
  READING_OPENING_FORMULAS,
  READING_TONES,
  ReadingOpeningFormulaId,
} from '@/src/lib/tones/readingTones';
import { loadVulgatePsalmText, VULGATE_ENTRIES } from '@/src/lib/tones/vulgatePsalms';
import {
  ensureEnglishHyphenation,
  isEnglishHyphenationLoaded,
} from '@/src/lib/text/englishSyllabify';
import {
  deletePrefaceTemplate,
  exportPrefaceTemplatesJson,
  importPrefaceTemplatesJson,
  loadHiddenPrefaceTemplateIds,
  loadPrefaceTemplates,
  markPrefaceTemplateVerified,
  PrefaceTemplate,
  PrefaceTemplateKind,
  restoreDefaultPrefaceTemplates,
  saveCorrectedPrefaceTemplate,
} from '@/src/lib/tones/prefaceTemplates';
import {
  assemblePreface,
  PrefaceAssemblyChecklist,
  PrefacePartKind,
  PrefaceSplitResult,
  PrefaceWordItem,
  remapBodyPhraseOverrides,
  splitPreface,
} from '@/src/lib/tones/prefaceSplit';
import {
  applyPhraseCadenceChoiceOverride,
  CADENCE_CHOICE_META,
  formValuesToTone,
  TONE_CLEF_OPTIONS,
  ToneSimpleFormField,
  ToneSimpleFormValues,
  toneToFormValues,
} from '@/src/lib/tones/toneUi';
import { CadenceColorLegend, PhraseCadencePicker } from './PhraseCadencePicker';
import { MiniCadencePreview } from './MiniCadencePreview';

const LazyPrefacePartsPanel = React.lazy(() =>
  import('./PrefacePartsPanel').then((m) => ({ default: m.PrefacePartsPanel }))
);

export const PSALM_TONES = listPsalmTones();
export { READING_TONES, READING_OPENING_FORMULAS, PREFACE_TONES };

export interface ToneCatalog {
  psalmTones: typeof PSALM_TONES;
  readingTones: typeof READING_TONES;
  prefaceTones: typeof PREFACE_TONES;
  readingOpeningFormulas: typeof READING_OPENING_FORMULAS;
  psalmToneLabel: typeof psalmToneLabel;
}

const TONE_CATALOG: ToneCatalog = {
  psalmTones: PSALM_TONES,
  readingTones: READING_TONES,
  prefaceTones: PREFACE_TONES,
  readingOpeningFormulas: READING_OPENING_FORMULAS,
  psalmToneLabel,
};

const STORAGE_KEY = 'chantscore.tones.v1';

export interface SavedToneSettings {
  mode: ToneMode;
  definition: string;
  repeatIntonation: boolean;
  autoFlex: boolean;
  gloriaPatri: boolean;
  /** Last built-in psalm tone loaded, so the pickers keep showing it. */
  psalmTone: string;
  psalmEnding: string;
  psalmSolemn: boolean;
  /** Last built-in reading tone loaded, so the picker keeps showing it. */
  readingTone: string;
  /** Optional Latin opening formula prepended in reading mode. */
  readingOpeningFormula: ReadingOpeningFormulaId;
  /** True once the user has explicitly selected an opening formula (including None). */
  readingOpeningFormulaTouched: boolean;
  /** Last built-in preface tone loaded, so the picker keeps showing it. */
  prefaceTone: string;
  /** Per-language preface toggle: treat single line breaks as phrase breaks (default false for Latin, true for English). */
  prefaceLineBreaksAsPhrases: Record<ChantLanguage, boolean>;
  /** Removed default phrase breaks, keyed by { endWordIndex, wordText }. */
  mergedBreaks: PhraseBreakKey[];
  /** Auto-joined phrase breaks explicitly restored/kept split by user. */
  forcedBreaks: PhraseBreakKey[];
  /** Added interior phrase breaks, keyed by { endWordIndex, wordText }. */
  extraBreaks: PhraseBreakKey[];
  /** Auto-join short phrases threshold N for Reading mode (0 = off, default 3, range 0-6). */
  autoJoinShortPhrasesReading: number;
  /** Auto-join short phrases threshold N for Preface mode (0 = off, default 3, range 0-6). */
  autoJoinShortPhrasesPreface: number;
}

const FORMAT_EXAMPLE = `# FORMAT EXAMPLE ONLY - not a Liber Usualis tone.
# Replace the notes with the tone you want to use.
name: Format example
clef: c4
tenor: h
intonation: g h        # one note per syllable
flex: h* g             # * marks the accented syllable
mediant: g h i* h      # prep notes, accent*, post-accent notes
termination: h g* g`;

const READING_EXAMPLE = `# FORMAT EXAMPLE ONLY - not a Liber Usualis tone.
name: Reading format example
clef: c4
tenor: h
flexa: h* g            # at a comma
metrum: h* g           # at ; or :
punctum: h* g g        # at a full stop
question: h* i         # at a question mark`;

function defaults(): SavedToneSettings {
  return {
    mode: 'psalm',
    definition: FORMAT_EXAMPLE,
    repeatIntonation: false,
    autoFlex: false,
    gloriaPatri: false,
    psalmTone: '',
    psalmEnding: '',
    psalmSolemn: false,
    readingTone: '',
    readingOpeningFormula: '',
    readingOpeningFormulaTouched: false,
    prefaceTone: 'preface-solemn',
    prefaceLineBreaksAsPhrases: { la: false, en: true },
    mergedBreaks: [],
    forcedBreaks: [],
    extraBreaks: [],
    autoJoinShortPhrasesReading: DEFAULT_AUTO_JOIN_SHORT_PHRASES,
    autoJoinShortPhrasesPreface: DEFAULT_AUTO_JOIN_SHORT_PHRASES,
  };
}

function getSamplePsalmText(language: ChantLanguage): string {
  return language === 'en'
    ? 'The Lord said unto my Lord: * Sit thou at my right hand.'
    : 'Dixit Dóminus Dómino meo: * Sede a dextris meis.';
}

function getSampleReadingText(language: ChantLanguage): string {
  return language === 'en'
    ? 'The Lord said to me: You are my Son; this day I have begotten you.'
    : 'Dóminus dixit ad me: Fílius meus es tu; ego hódie génui te.';
}

function parsePrefaceLineBreaksMap(rawVal: unknown): Record<ChantLanguage, boolean> {
  const fallback = defaults().prefaceLineBreaksAsPhrases;
  if (typeof rawVal === 'boolean') {
    return { la: rawVal, en: fallback.en };
  }
  if (rawVal && typeof rawVal === 'object') {
    const obj = rawVal as Record<string, unknown>;
    return {
      la: typeof obj.la === 'boolean' ? obj.la : fallback.la,
      en: typeof obj.en === 'boolean' ? obj.en : fallback.en,
    };
  }
  return { ...fallback };
}

function parsePhraseBreakKeys(rawVal: unknown): PhraseBreakKey[] {
  if (!Array.isArray(rawVal)) return [];
  const out: PhraseBreakKey[] = [];
  for (const item of rawVal) {
    if (
      item &&
      typeof item === 'object' &&
      typeof (item as PhraseBreakKey).endWordIndex === 'number' &&
      Number.isInteger((item as PhraseBreakKey).endWordIndex) &&
      (item as PhraseBreakKey).endWordIndex >= 0 &&
      typeof (item as PhraseBreakKey).wordText === 'string'
    ) {
      out.push({
        endWordIndex: (item as PhraseBreakKey).endWordIndex,
        wordText: (item as PhraseBreakKey).wordText,
      });
    }
  }
  return out;
}

export function parseSavedToneSettings(rawObj: Record<string, unknown>): SavedToneSettings {
  const d = defaults();
  const rawMode = rawObj.mode;
  let mode: ToneMode =
    rawMode === 'psalm' || rawMode === 'reading' || rawMode === 'preface' ? rawMode : d.mode;
  let readingTone = typeof rawObj.readingTone === 'string' ? rawObj.readingTone : d.readingTone;
  let prefaceTone = typeof rawObj.prefaceTone === 'string' ? rawObj.prefaceTone : d.prefaceTone;

  if (mode === 'reading' && readingTone === 'preface-solemn') {
    mode = 'preface';
    prefaceTone = 'preface-solemn';
    readingTone = '';
  }

  let psalmTone = typeof rawObj.psalmTone === 'string' ? rawObj.psalmTone : d.psalmTone;
  let psalmEnding = typeof rawObj.psalmEnding === 'string' ? rawObj.psalmEnding : d.psalmEnding;
  let psalmSolemn = typeof rawObj.psalmSolemn === 'boolean' ? rawObj.psalmSolemn : d.psalmSolemn;
  if (psalmTone && !PSALM_TONES.some((t) => t.id === psalmTone)) {
    psalmTone = '';
    psalmEnding = '';
    psalmSolemn = false;
  }

  const migratedFormula = migrateSavedReadingOpeningFormula(rawObj);
  return {
    mode,
    definition: typeof rawObj.definition === 'string' ? rawObj.definition : d.definition,
    repeatIntonation:
      typeof rawObj.repeatIntonation === 'boolean' ? rawObj.repeatIntonation : d.repeatIntonation,
    autoFlex: typeof rawObj.autoFlex === 'boolean' ? rawObj.autoFlex : d.autoFlex,
    gloriaPatri: typeof rawObj.gloriaPatri === 'boolean' ? rawObj.gloriaPatri : d.gloriaPatri,
    psalmTone,
    psalmEnding,
    psalmSolemn,
    readingTone,
    readingOpeningFormula: migratedFormula.readingOpeningFormula,
    readingOpeningFormulaTouched: migratedFormula.readingOpeningFormulaTouched,
    prefaceTone,
    prefaceLineBreaksAsPhrases: parsePrefaceLineBreaksMap(rawObj.prefaceLineBreaksAsPhrases),
    mergedBreaks: parsePhraseBreakKeys(rawObj.mergedBreaks),
    forcedBreaks: parsePhraseBreakKeys(rawObj.forcedBreaks),
    extraBreaks: parsePhraseBreakKeys(rawObj.extraBreaks),
    autoJoinShortPhrasesReading:
      typeof rawObj.autoJoinShortPhrasesReading === 'number'
        ? clampAutoJoinShortPhrases(rawObj.autoJoinShortPhrasesReading)
        : typeof rawObj.autoJoinShortPhrasesReading === 'boolean'
        ? rawObj.autoJoinShortPhrasesReading
          ? DEFAULT_AUTO_JOIN_SHORT_PHRASES
          : 0
        : d.autoJoinShortPhrasesReading,
    autoJoinShortPhrasesPreface:
      typeof rawObj.autoJoinShortPhrasesPreface === 'number'
        ? clampAutoJoinShortPhrases(rawObj.autoJoinShortPhrasesPreface)
        : typeof rawObj.autoJoinShortPhrasesPreface === 'boolean'
        ? rawObj.autoJoinShortPhrasesPreface
          ? DEFAULT_AUTO_JOIN_SHORT_PHRASES
          : 0
        : d.autoJoinShortPhrasesPreface,
  };
}

function loadSavedToneSettings(): SavedToneSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return parseSavedToneSettings(parsed as Record<string, unknown>);
      }
    }
  } catch {
    /* ignore */
  }
  return defaults();
}

export interface BuiltInToneOrigin {
  kind: 'psalm' | 'reading' | 'preface';
  id: string;
  ending?: string;
  solemn?: boolean;
  definition: string;
}

function resolveBuiltInOrigin(s: SavedToneSettings): BuiltInToneOrigin | null {
  if (s.mode === 'psalm' && s.psalmTone) {
    const choice = PSALM_TONES.find((t) => t.id === s.psalmTone);
    if (!choice) return null;
    const end = choice.endings.includes(s.psalmEnding) ? s.psalmEnding : choice.endings[0];
    const useSolemn = Boolean(s.psalmSolemn && choice.hasSolemn);
    const tone = buildPsalmTone(s.psalmTone, end, useSolemn);
    if (!tone) return null;
    return {
      kind: 'psalm',
      id: s.psalmTone,
      ending: end,
      solemn: useSolemn,
      definition: toneToDefinition(tone, 'Built-in psalm tone. You can edit the notes below.'),
    };
  }
  if (s.mode === 'reading' && s.readingTone) {
    const entry = READING_TONES.find((t) => t.id === s.readingTone);
    if (!entry) return null;
    return { kind: 'reading', id: entry.id, definition: entry.definition };
  }
  if (s.mode === 'preface' && s.prefaceTone) {
    const entry = PREFACE_TONES.find((t) => t.id === s.prefaceTone);
    if (!entry) return null;
    return { kind: 'preface', id: entry.id, definition: entry.definition };
  }
  return null;
}

export interface CommitToneLinkPayload {
  mode: 'reading' | 'preface';
  language: ChantLanguage;
  isEnglishPreface: boolean;
  hasQuestionCadence: boolean;
  phrases: TonePhraseLinkItem[];
}

export interface ToneController {
  saved: SavedToneSettings;
  builtInOrigin: BuiltInToneOrigin | null;
  text: string;
  stressOverrides: Record<number, boolean>;
  cadenceOverrides: Record<number, ReadingCadenceKind | null>;
  roleOverrides: Record<number, EnglishPrefaceRole>;
  mergedBreaks: PhraseBreakKey[];
  forcedBreaks?: PhraseBreakKey[];
  extraBreaks: PhraseBreakKey[];
  note: { text: string; isError?: boolean } | null;
  dockOpen: boolean;
  definitionOpen: boolean;
  editorTab: 'simple' | 'advanced';
  selectedVulgatePsalm: string;
  isPrefaceWorkflow: boolean;
  activePrefaceToneId: string;
  prefaceSplit: PrefaceSplitResult | null;
  assembledPrefaceGabc: string | null;
  prefaceTemplates: PrefaceTemplate[];
  hiddenPrefaceTemplateCount: number;
  assemblyChecklist: PrefaceAssemblyChecklist | null;
  enHyphenationVersion?: number;
  catalog?: ToneCatalog;
  setDockOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setDefinitionOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setEditorTab: React.Dispatch<React.SetStateAction<'simple' | 'advanced'>>;
  setText: (next: string) => void;
  importVulgatePsalm: (id: string) => Promise<void>;
  setMode: (mode: ToneMode) => void;
  update: (patch: Partial<SavedToneSettings>) => void;
  loadPsalmTone: (id: string, ending: string, solemn: boolean) => void;
  loadReadingTone: (id: string) => void;
  setReadingOpeningFormula: (id: string) => void;
  loadPrefaceTone: (id: string) => void;
  resetToBuiltIn: () => void;
  toggleSyllableStress: (globalIndex: number, currentStressed: boolean) => void;
  toggleWordStress: (word: PrefaceWordItem) => void;
  resetStressOverrides: () => void;
  selectPhraseCadence: (
    phraseKey: number,
    choice: PhraseCadenceChoice,
    defaultKind: ReadingCadenceKind | null
  ) => void;
  restorePhraseTemplate: (phraseKey: number) => void;
  setPhraseRole: (phraseKey: number, role: EnglishPrefaceRole | null) => void;
  setPrefaceLineBreaksAsPhrases: (next: boolean) => void;
  resetCadenceOverrides: () => void;
  joinPhrases: (endWordIndex: number, dir: 'prev' | 'next') => void;
  splitMergedPhrase: (endWordIndex: number) => void;
  restoreBreak: (breakKey: PhraseBreakKey) => void;
  toggleExtraBreak: (breakKey: PhraseBreakKey) => void;
  resetPhrases: () => void;
  reapplyTone: () => void;
  setPartRawGabc: (kind: PrefacePartKind, gabc: string | undefined) => void;
  setPhraseRawGabc: (phraseKey: number, gabc: string | undefined) => void;
  saveAsPrefaceTemplate: (params: {
    id?: string;
    kind: PrefaceTemplateKind;
    text: string;
    gabc: string;
    language?: ChantLanguage;
    tone?: string;
  }) => void;
  verifyPrefaceTemplate: (id: string) => void;
  removePrefaceTemplate: (id: string) => void;
  restoreBuiltInPrefaceTemplates: () => void;
  exportPrefaceTemplates: () => void;
  importPrefaceTemplatesFile: (file: File) => void;
}

export interface CommitToneCallbacks {
  onCommitted: () => void;
  onCancelled: () => void;
  bypassConfirm?: boolean;
}

export function useToneState(options: {
  language: ChantLanguage;
  onChangeLanguage?: (lang: ChantLanguage) => void;
  onCommitToneGabc: (
    gabc: string,
    callbacks?: CommitToneCallbacks,
    toneLinkPayload?: CommitToneLinkPayload | null
  ) => void;
}): ToneController {
  const { language, onChangeLanguage, onCommitToneGabc } = options;
  const onChangeLanguageRef = useRef(onChangeLanguage);
  onChangeLanguageRef.current = onChangeLanguage;
  const onCommitToneGabcRef = useRef(onCommitToneGabc);
  onCommitToneGabcRef.current = onCommitToneGabc;

  const [saved, setSaved] = useState<SavedToneSettings>(loadSavedToneSettings);
  const [builtInOrigin, setBuiltInOrigin] = useState<BuiltInToneOrigin | null>(() =>
    resolveBuiltInOrigin(saved)
  );
  const [text, setTextRaw] = useState('');
  const [selectedVulgatePsalm, setSelectedVulgatePsalm] = useState('');
  const [stressOverrides, setStressOverrides] = useState<Record<number, boolean>>({});
  const [cadenceOverrides, setCadenceOverrides] = useState<Record<number, ReadingCadenceKind | null>>({});
  const [roleOverrides, setRoleOverrides] = useState<Record<number, EnglishPrefaceRole>>({});
  const [mergedBreaks, setMergedBreaksRaw] = useState<PhraseBreakKey[]>(() => saved.mergedBreaks);
  const [forcedBreaks, setForcedBreaksRaw] = useState<PhraseBreakKey[]>(() => saved.forcedBreaks);
  const [extraBreaks, setExtraBreaksRaw] = useState<PhraseBreakKey[]>(() => saved.extraBreaks);
  const [partRawOverrides, setPartRawOverrides] = useState<Partial<Record<PrefacePartKind, string>>>({});
  const [phraseRawOverrides, setPhraseRawOverrides] = useState<Record<number, string>>({});
  const [prefaceTemplates, setPrefaceTemplates] = useState<PrefaceTemplate[]>(() =>
    loadPrefaceTemplates()
  );
  const [hiddenPrefaceTemplateCount, setHiddenPrefaceTemplateCount] = useState<number>(
    () => loadHiddenPrefaceTemplateIds().length
  );
  const [assemblyChecklist, setAssemblyChecklist] = useState<PrefaceAssemblyChecklist | null>(null);
  const [note, setNote] = useState<{ text: string; isError?: boolean } | null>(null);
  const [dockOpen, setDockOpen] = useState(true);
  const [definitionOpen, setDefinitionOpen] = useState(false);
  const [editorTab, setEditorTab] = useState<'simple' | 'advanced'>('simple');
  const [enHyphenationVersion, setEnHyphenationVersion] = useState(() =>
    isEnglishHyphenationLoaded() ? 1 : 0
  );

  const [commitRequest, setCommitRequest] = useState<{
    seq: number;
    debounceMs: number;
    explicit: boolean;
  }>({ seq: 0, debounceMs: 0, explicit: false });
  const hasCommittedToneRef = useRef(false);
  const autoCommitPausedRef = useRef(false);
  const autoSeededKindRef = useRef<'psalm' | 'reading' | null>(null);
  const lastCommittedGabcRef = useRef<string | null>(null);
  const prevLanguageRef = useRef<ChantLanguage>(language);
  const textRef = useRef(text);
  textRef.current = text;

  const persistBreakKeys = (
    nextMerged: PhraseBreakKey[],
    nextExtra: PhraseBreakKey[],
    nextForced: PhraseBreakKey[] = forcedBreaks
  ) => {
    setMergedBreaksRaw(nextMerged);
    setExtraBreaksRaw(nextExtra);
    setForcedBreaksRaw(nextForced);
    setSaved((prev) => {
      const next = {
        ...prev,
        mergedBreaks: nextMerged,
        extraBreaks: nextExtra,
        forcedBreaks: nextForced,
      };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const clearBreakKeys = () => {
    if (mergedBreaks.length === 0 && extraBreaks.length === 0 && forcedBreaks.length === 0) return;
    persistBreakKeys([], [], []);
  };

  const parsedTone = useMemo(() => parseToneDefinition(saved.definition), [saved.definition]);

  const isPrefaceWorkflow =
    saved.mode === 'preface' ||
    (saved.mode === 'reading' &&
      (saved.readingTone === 'preface-solemn' || parsedTone.tone?.phrasing === 'lines'));

  const activePrefaceToneId =
    saved.mode === 'preface'
      ? saved.prefaceTone || 'preface-solemn'
      : saved.readingTone || 'preface-solemn';

  const treatPrefaceLineBreaksAsPhrases = saved.prefaceLineBreaksAsPhrases[language];
  const activeAutoJoinSetting = isPrefaceWorkflow
    ? saved.autoJoinShortPhrasesPreface
    : saved.autoJoinShortPhrasesReading;
  const effectiveAutoJoinThreshold =
    isPrefaceWorkflow && language === 'en' && treatPrefaceLineBreaksAsPhrases
      ? 0
      : activeAutoJoinSetting;

  const prefaceSplit = useMemo(() => {
    if (!isPrefaceWorkflow || !parsedTone.tone) return null;
    if (!text.trim()) return null;
    return splitPreface(text, {
      language,
      tone: parsedTone.tone,
      toneId: activePrefaceToneId,
      templates: prefaceTemplates,
      stressOverrides,
      cadenceOverrides,
      roleOverrides,
      mergedBreaks,
      forcedBreaks,
      extraBreaks,
      autoJoinShortPhrases: effectiveAutoJoinThreshold,
      partRawOverrides,
      phraseRawOverrides,
      treatLineBreaksAsPhraseBreaks: treatPrefaceLineBreaksAsPhrases,
    });
  }, [
    isPrefaceWorkflow,
    parsedTone.tone,
    text,
    language,
    activePrefaceToneId,
    prefaceTemplates,
    stressOverrides,
    cadenceOverrides,
    roleOverrides,
    mergedBreaks,
    forcedBreaks,
    extraBreaks,
    effectiveAutoJoinThreshold,
    partRawOverrides,
    phraseRawOverrides,
    treatPrefaceLineBreaksAsPhrases,
    enHyphenationVersion,
  ]);

  const assembledPrefacePreview = useMemo(() => {
    if (!isPrefaceWorkflow || !prefaceSplit || !parsedTone.tone) return null;
    return assemblePreface(prefaceSplit, parsedTone.tone, {
      language,
      stressOverrides,
    });
  }, [isPrefaceWorkflow, prefaceSplit, parsedTone.tone, language, stressOverrides]);
  const assembledPrefaceGabc = assembledPrefacePreview?.gabc ?? null;

  const requestAutoCommit = (debounceMs = 0, explicit = false) => {
    if (explicit) {
      autoCommitPausedRef.current = false;
    }
    setCommitRequest((prev) => ({
      seq: prev.seq + 1,
      debounceMs,
      explicit,
    }));
  };

  const commitCurrentTone = (explicit: boolean, bypassConfirm = false) => {
    if (!parsedTone.tone) {
      if (explicit) {
        setNote({
          text: parsedTone.errors[0] ?? 'The tone definition is not valid.',
          isError: true,
        });
        setDockOpen(true);
        setDefinitionOpen(true);
      }
      return;
    }

    const hasQuestionCadence = Boolean(getReadingCadence(parsedTone.tone, 'question', language));

    if (isPrefaceWorkflow && prefaceSplit) {
      const assembled = assemblePreface(prefaceSplit, parsedTone.tone, {
        language,
        stressOverrides,
      });
      if (!assembled.gabc) {
        lastCommittedGabcRef.current = null;
        if (explicit) {
          setNote({ text: assembled.warnings[0] ?? 'Paste preface text to point.' });
        }
        return;
      }
      if (!explicit && !bypassConfirm && assembled.gabc === lastCommittedGabcRef.current) {
        return;
      }
      const linkPayload: CommitToneLinkPayload = {
        mode: 'preface',
        language,
        isEnglishPreface: language === 'en',
        hasQuestionCadence,
        phrases: assembled.phrases ?? [],
      };
      onCommitToneGabcRef.current(
        assembled.gabc,
        {
          bypassConfirm,
          onCommitted: () => {
            hasCommittedToneRef.current = true;
            autoCommitPausedRef.current = false;
            lastCommittedGabcRef.current = assembled.gabc;
            setAssemblyChecklist(assembled.checklist);
            setNote({
              text:
                assembled.checklist.unverifiedTemplateCount > 0
                  ? `Assembled preface (${assembled.checklist.unverifiedTemplateCount} unverified template part(s) need review). Press Undo to revert.`
                  : 'Assembled preface. Press Undo to revert.',
            });
          },
          onCancelled: () => {
            autoCommitPausedRef.current = true;
            setNote({ text: 'Kept current score.' });
          },
        },
        linkPayload
      );
      return;
    }

    const isReadingLike = saved.mode === 'reading' || saved.mode === 'preface';
    const activeOpeningFormula =
      saved.mode === 'reading' && !isPrefaceWorkflow && language === 'la'
        ? getReadingOpeningFormulaText(saved.readingOpeningFormula)
        : '';
    const psalmTitle =
      saved.mode === 'psalm' && selectedVulgatePsalm
        ? `${/^\d/.test(selectedVulgatePsalm) ? 'Psalm ' : ''}${selectedVulgatePsalm} (${parsedTone.tone.name})`
        : undefined;
    const result = pointText(saved.mode, text, parsedTone.tone, {
      repeatIntonation: saved.repeatIntonation,
      magnificat: saved.mode === 'psalm' && selectedVulgatePsalm === 'Magnificat',
      autoFlexSyllables: saved.autoFlex ? 14 : 0,
      gloriaPatri: saved.mode === 'psalm' && saved.gloriaPatri,
      title: psalmTitle,
      language,
      stressOverrides,
      cadenceOverrides: isReadingLike ? cadenceOverrides : undefined,
      mergedBreaks: isReadingLike ? mergedBreaks : undefined,
      forcedBreaks: isReadingLike ? forcedBreaks : undefined,
      extraBreaks: isReadingLike ? extraBreaks : undefined,
      autoJoinShortPhrases: isReadingLike ? effectiveAutoJoinThreshold : undefined,
      openingFormula: activeOpeningFormula || undefined,
      treatLineBreaksAsPhraseBreaks: treatPrefaceLineBreaksAsPhrases,
    });
    if (!result.gabc) {
      lastCommittedGabcRef.current = null;
      if (explicit) {
        setNote({ text: result.warnings[0] ?? 'Paste text to point.' });
      }
      return;
    }
    if (!explicit && !bypassConfirm && result.gabc === lastCommittedGabcRef.current) {
      return;
    }
    const successNote = result.warnings.length
      ? { text: `Pointed, with notes: ${result.warnings.join(' ')}` }
      : {
          text:
            language === 'en'
              ? 'Pointed. Click any syllable in the stress preview to adjust accent placement, or press Undo to revert.'
              : 'Pointed. Put an acute accent on any stressed vowel (or click a syllable below) if needed.',
        };

    const linkPayload: CommitToneLinkPayload | null = isReadingLike
      ? {
          mode: 'reading',
          language,
          isEnglishPreface: false,
          hasQuestionCadence,
          phrases: result.phrases ?? [],
        }
      : null;

    onCommitToneGabcRef.current(
      result.gabc,
      {
        bypassConfirm,
        onCommitted: () => {
          hasCommittedToneRef.current = true;
          autoCommitPausedRef.current = false;
          lastCommittedGabcRef.current = result.gabc;
          setNote(successNote);
        },
        onCancelled: () => {
          autoCommitPausedRef.current = true;
          setNote({ text: 'Kept current score.' });
        },
      },
      linkPayload
    );
  };

  const commitFnRef = useRef(commitCurrentTone);
  commitFnRef.current = commitCurrentTone;

  useEffect(() => {
    if (commitRequest.seq === 0) return;
    if (!commitRequest.explicit && autoCommitPausedRef.current) return;
    if (commitRequest.debounceMs <= 0) {
      commitFnRef.current(commitRequest.explicit);
      return;
    }
    const timer = window.setTimeout(() => {
      commitFnRef.current(commitRequest.explicit);
    }, commitRequest.debounceMs);
    return () => window.clearTimeout(timer);
  }, [commitRequest]);

  useEffect(() => {
    if (prevLanguageRef.current === language) return;
    prevLanguageRef.current = language;
    if (autoSeededKindRef.current === 'psalm') {
      setTextRaw(getSamplePsalmText(language));
      setStressOverrides({});
    } else if (autoSeededKindRef.current === 'reading') {
      setTextRaw(getSampleReadingText(language));
      setStressOverrides({});
    }
    if (hasCommittedToneRef.current || autoSeededKindRef.current !== null || text.trim().length > 0) {
      requestAutoCommit(0, false);
    }
  }, [language]);

  useEffect(() => {
    if (language !== 'en' || isEnglishHyphenationLoaded()) return;
    let cancelled = false;
    void ensureEnglishHyphenation().then(() => {
      if (cancelled) return;
      setEnHyphenationVersion((v) => v + 1);
      if (
        hasCommittedToneRef.current ||
        autoSeededKindRef.current !== null ||
        textRef.current.trim().length > 0
      ) {
        requestAutoCommit(0, false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [language]);

  const update = (patch: Partial<SavedToneSettings>) => {
    const next = { ...saved, ...patch };
    setSaved(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
    setNote(null);
    if (Object.prototype.hasOwnProperty.call(patch, 'definition')) {
      requestAutoCommit(220, false);
    } else if (
      Object.prototype.hasOwnProperty.call(patch, 'gloriaPatri') ||
      Object.prototype.hasOwnProperty.call(patch, 'repeatIntonation') ||
      Object.prototype.hasOwnProperty.call(patch, 'autoFlex') ||
      Object.prototype.hasOwnProperty.call(patch, 'autoJoinShortPhrasesReading') ||
      Object.prototype.hasOwnProperty.call(patch, 'autoJoinShortPhrasesPreface')
    ) {
      requestAutoCommit(0, true);
    }
  };

  const setText = (next: string) => {
    autoSeededKindRef.current = null;
    setSelectedVulgatePsalm('');
    setTextRaw(next);
    setStressOverrides({});
    if (
      isPrefaceWorkflow &&
      parsedTone.tone &&
      next.trim()
    ) {
      const prevBodyWords = prefaceSplit?.bodyWords ?? [];
      const nextRawSplit = splitPreface(next, {
        language,
        tone: parsedTone.tone,
        toneId: activePrefaceToneId,
        templates: prefaceTemplates,
        treatLineBreaksAsPhraseBreaks: treatPrefaceLineBreaksAsPhrases,
      });
      const prunedMerged = remapPhraseBreakKeys(mergedBreaks, prevBodyWords, nextRawSplit.bodyWords);
      const prunedExtra = remapPhraseBreakKeys(extraBreaks, prevBodyWords, nextRawSplit.bodyWords);
      const prunedForced = remapPhraseBreakKeys(forcedBreaks, prevBodyWords, nextRawSplit.bodyWords);
      if (
        prunedMerged.length !== mergedBreaks.length ||
        prunedExtra.length !== extraBreaks.length ||
        prunedForced.length !== forcedBreaks.length ||
        prunedMerged.some((b, i) => b.endWordIndex !== mergedBreaks[i]?.endWordIndex) ||
        prunedExtra.some((b, i) => b.endWordIndex !== extraBreaks[i]?.endWordIndex) ||
        prunedForced.some((b, i) => b.endWordIndex !== forcedBreaks[i]?.endWordIndex)
      ) {
        persistBreakKeys(prunedMerged, prunedExtra, prunedForced);
      }
      if (Object.keys(cadenceOverrides).length > 0 || Object.keys(roleOverrides).length > 0) {
        const nextWithBreaks = splitPreface(next, {
          language,
          tone: parsedTone.tone,
          toneId: activePrefaceToneId,
          templates: prefaceTemplates,
          mergedBreaks: prunedMerged,
          forcedBreaks: prunedForced,
          extraBreaks: prunedExtra,
          autoJoinShortPhrases: effectiveAutoJoinThreshold,
          treatLineBreaksAsPhraseBreaks: treatPrefaceLineBreaksAsPhrases,
        });
        const prevBodyItems =
          prefaceSplit?.parts
            .find((p) => p.kind === 'body')
            ?.phrases?.map((ph) => ({ text: ph.text, endWordIndex: ph.endWordIndex })) ?? [];
        const nextBodyItems =
          nextWithBreaks.parts
            .find((p) => p.kind === 'body')
            ?.phrases?.map((ph) => ({ text: ph.text, endWordIndex: ph.endWordIndex })) ?? [];
        setCadenceOverrides((prev) => remapBodyPhraseOverrides(prevBodyItems, nextBodyItems, prev));
        setRoleOverrides((prev) => remapBodyPhraseOverrides(prevBodyItems, nextBodyItems, prev));
      }
    } else if (!isPrefaceWorkflow && (saved.mode === 'reading' || saved.mode === 'preface')) {
      const activeOpening =
        saved.mode === 'reading' && language === 'la'
          ? getReadingOpeningFormulaText(saved.readingOpeningFormula)
          : '';
      const prevWords = parsedTone.tone
        ? getReadingWordList(text, parsedTone.tone, {
            language,
            openingFormula: activeOpening || undefined,
            treatLineBreaksAsPhraseBreaks: treatPrefaceLineBreaksAsPhrases,
          })
        : [];
      const words = parsedTone.tone
        ? getReadingWordList(next, parsedTone.tone, {
            language,
            openingFormula: activeOpening || undefined,
            treatLineBreaksAsPhraseBreaks: treatPrefaceLineBreaksAsPhrases,
          })
        : [];
      const prunedMerged = remapPhraseBreakKeys(mergedBreaks, prevWords, words);
      const prunedExtra = remapPhraseBreakKeys(extraBreaks, prevWords, words);
      const prunedForced = remapPhraseBreakKeys(forcedBreaks, prevWords, words);
      if (
        prunedMerged.length !== mergedBreaks.length ||
        prunedExtra.length !== extraBreaks.length ||
        prunedForced.length !== forcedBreaks.length ||
        prunedMerged.some((b, i) => b.endWordIndex !== mergedBreaks[i]?.endWordIndex) ||
        prunedExtra.some((b, i) => b.endWordIndex !== extraBreaks[i]?.endWordIndex) ||
        prunedForced.some((b, i) => b.endWordIndex !== forcedBreaks[i]?.endWordIndex)
      ) {
        persistBreakKeys(prunedMerged, prunedExtra, prunedForced);
      }
      setCadenceOverrides({});
      setRoleOverrides({});
    } else {
      setCadenceOverrides({});
      setRoleOverrides({});
      clearBreakKeys();
    }
    setPartRawOverrides({});
    setPhraseRawOverrides({});
    setAssemblyChecklist(null);
    setNote(null);
    if (next.trim() || saved.gloriaPatri) {
      requestAutoCommit(180, false);
    } else {
      lastCommittedGabcRef.current = null;
    }
  };

  const importVulgatePsalm = async (id: string) => {
    if (!id) {
      setSelectedVulgatePsalm('');
      return;
    }
    const psalmText = await loadVulgatePsalmText(id);
    if (!psalmText) {
      setNote({ text: `Could not find Vulgate psalm "${id}".`, isError: true });
      return;
    }
    autoSeededKindRef.current = null;
    setSelectedVulgatePsalm(id);
    setTextRaw(psalmText);
    setStressOverrides({});
    setCadenceOverrides({});
    setRoleOverrides({});
    clearBreakKeys();
    setPartRawOverrides({});
    setPhraseRawOverrides({});
    setAssemblyChecklist(null);
    if (language !== 'la') {
      onChangeLanguageRef.current?.('la');
    }
    const shouldRepeatIntonation = id === 'Magnificat' || id === 'Benedictus';
    if (saved.repeatIntonation !== shouldRepeatIntonation) {
      const nextSaved = { ...saved, repeatIntonation: shouldRepeatIntonation };
      setSaved(nextSaved);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(nextSaved));
      } catch {
        /* ignore */
      }
    }
    const hasActivePsalmTone =
      saved.psalmTone !== '' ||
      saved.definition !== FORMAT_EXAMPLE ||
      hasCommittedToneRef.current;
    if (hasActivePsalmTone) {
      setNote(null);
      requestAutoCommit(0, true);
    } else {
      setNote({
        text: `Imported ${/^\d/.test(id) ? `Psalm ${id}` : id} from the Vulgate. Select a psalm tone above to point it.`,
      });
    }
  };

  const setMode = (mode: ToneMode) => {
    setCadenceOverrides({});
    setRoleOverrides({});
    clearBreakKeys();
    setPartRawOverrides({});
    setPhraseRawOverrides({});
    setAssemblyChecklist(null);
    if (autoSeededKindRef.current && autoSeededKindRef.current !== mode) {
      autoSeededKindRef.current = null;
      setTextRaw('');
      setStressOverrides({});
    }
    if (mode !== 'psalm') {
      setSelectedVulgatePsalm('');
    }
    const hadText = !autoSeededKindRef.current && text.trim().length > 0;
    if (mode === 'preface') {
      const defaultPreface = PREFACE_TONES[0];
      const def = defaultPreface?.definition ?? READING_EXAMPLE;
      setBuiltInOrigin(
        defaultPreface
          ? { kind: 'preface', id: defaultPreface.id, definition: defaultPreface.definition }
          : null
      );
      update({
        mode: 'preface',
        psalmTone: '',
        readingTone: '',
        prefaceTone: defaultPreface?.id ?? '',
        definition: def,
        mergedBreaks: [],
        forcedBreaks: [],
        extraBreaks: [],
      });
      if (hadText) {
        requestAutoCommit(0, false);
      }
      return;
    }
    setBuiltInOrigin(null);
    update({
      mode,
      psalmTone: '',
      readingTone: '',
      prefaceTone: '',
      definition: mode === 'reading' ? READING_EXAMPLE : FORMAT_EXAMPLE,
      mergedBreaks: [],
      forcedBreaks: [],
      extraBreaks: [],
    });
    if (hadText) {
      requestAutoCommit(0, false);
    }
  };

  const loadPsalmTone = (id: string, ending: string, solemn: boolean) => {
    const choice = PSALM_TONES.find((t) => t.id === id);
    if (!choice) {
      setBuiltInOrigin(null);
      update({ psalmTone: '', psalmEnding: '', psalmSolemn: false });
      setDefinitionOpen(true);
      return;
    }
    const end = choice.endings.includes(ending) ? ending : choice.endings[0];
    const useSolemn = solemn && choice.hasSolemn;
    const tone = buildPsalmTone(id, end, useSolemn);
    if (!tone) return;
    if (!text.trim() && !saved.gloriaPatri) {
      autoSeededKindRef.current = 'psalm';
      setTextRaw(getSamplePsalmText(language));
      setStressOverrides({});
    }
    const def = toneToDefinition(tone, 'Built-in psalm tone. You can edit the notes below.');
    setBuiltInOrigin({ kind: 'psalm', id, ending: end, solemn: useSolemn, definition: def });
    update({
      psalmTone: id,
      psalmEnding: end,
      psalmSolemn: useSolemn,
      definition: def,
    });
    requestAutoCommit(0, true);
  };

  const loadReadingTone = (id: string) => {
    const entry = READING_TONES.find((t) => t.id === id);
    if (!entry) {
      setBuiltInOrigin(null);
      update({ readingTone: '' });
      setDefinitionOpen(true);
      return;
    }
    setCadenceOverrides({});
    setRoleOverrides({});
    setMergedBreaksRaw([]);
    setForcedBreaksRaw([]);
    setExtraBreaksRaw([]);
    setPartRawOverrides({});
    setPhraseRawOverrides({});
    setAssemblyChecklist(null);
    if (!text.trim()) {
      autoSeededKindRef.current = 'reading';
      setTextRaw(getSampleReadingText(language));
      setStressOverrides({});
    }
    const nextOpeningFormula = saved.readingOpeningFormulaTouched
      ? saved.readingOpeningFormula
      : (DEFAULT_READING_OPENING_FORMULA[id] ?? '');
    setBuiltInOrigin({ kind: 'reading', id, definition: entry.definition });
    update({
      readingTone: id,
      definition: entry.definition,
      readingOpeningFormula: nextOpeningFormula,
      mergedBreaks: [],
      forcedBreaks: [],
      extraBreaks: [],
    });
    requestAutoCommit(0, true);
  };

  const setReadingOpeningFormula = (id: string) => {
    const nextId = normalizeReadingOpeningFormula(id);
    setCadenceOverrides({});
    setStressOverrides({});
    setMergedBreaksRaw([]);
    setForcedBreaksRaw([]);
    setExtraBreaksRaw([]);
    update({
      readingOpeningFormula: nextId,
      readingOpeningFormulaTouched: true,
      mergedBreaks: [],
      forcedBreaks: [],
      extraBreaks: [],
    });
    if (text.trim()) {
      requestAutoCommit(0, true);
    }
  };

  const loadPrefaceTone = (id: string) => {
    const entry = PREFACE_TONES.find((t) => t.id === id);
    if (!entry) {
      setBuiltInOrigin(null);
      update({ prefaceTone: '' });
      setDefinitionOpen(true);
      return;
    }
    setCadenceOverrides({});
    setRoleOverrides({});
    setMergedBreaksRaw([]);
    setForcedBreaksRaw([]);
    setExtraBreaksRaw([]);
    setPartRawOverrides({});
    setPhraseRawOverrides({});
    setAssemblyChecklist(null);
    if (autoSeededKindRef.current) {
      autoSeededKindRef.current = null;
      setTextRaw('');
      setStressOverrides({});
    }
    setBuiltInOrigin({ kind: 'preface', id, definition: entry.definition });
    update({
      prefaceTone: id,
      definition: entry.definition,
      mergedBreaks: [],
      forcedBreaks: [],
      extraBreaks: [],
    });
    if (text.trim()) {
      requestAutoCommit(0, true);
    }
  };

  const resetToBuiltIn = () => {
    if (!builtInOrigin) return;
    if (builtInOrigin.kind === 'psalm') {
      loadPsalmTone(builtInOrigin.id, builtInOrigin.ending ?? '', Boolean(builtInOrigin.solemn));
    } else if (builtInOrigin.kind === 'reading') {
      loadReadingTone(builtInOrigin.id);
    } else if (builtInOrigin.kind === 'preface') {
      loadPrefaceTone(builtInOrigin.id);
    }
  };

  const toggleSyllableStress = (globalIndex: number, currentStressed: boolean) => {
    setStressOverrides((prev) => ({
      ...prev,
      [globalIndex]: !currentStressed,
    }));
    setAssemblyChecklist(null);
    setNote(null);
    requestAutoCommit(0, true);
  };

  const toggleWordStress = (word: PrefaceWordItem) => {
    if (word.syllables.length === 0) return;
    setStressOverrides((prev) => {
      const next = { ...prev };
      if (word.syllables.length === 1) {
        const idx = word.syllables[0].globalIndex;
        next[idx] = !word.syllables[0].stressed;
        return next;
      }
      const curIdx = word.syllables.findIndex((s) => s.stressed);
      const nextIdx = curIdx < 0 ? 0 : (curIdx + 1) % word.syllables.length;
      word.syllables.forEach((s, i) => {
        next[s.globalIndex] = i === nextIdx;
      });
      return next;
    });
    setAssemblyChecklist(null);
    setNote(null);
    requestAutoCommit(0, true);
  };

  const resetStressOverrides = () => {
    setStressOverrides({});
    setAssemblyChecklist(null);
    setNote(null);
    requestAutoCommit(0, true);
  };

  const selectPhraseCadence = (
    phraseKey: number,
    chosenChoice: PhraseCadenceChoice,
    defaultKind: ReadingCadenceKind | null
  ) => {
    setRoleOverrides((prev) => {
      if (!Object.prototype.hasOwnProperty.call(prev, phraseKey)) return prev;
      const next = { ...prev };
      delete next[phraseKey];
      return next;
    });
    setCadenceOverrides((prev) =>
      applyPhraseCadenceChoiceOverride(prev, phraseKey, chosenChoice, defaultKind)
    );
    setAssemblyChecklist(null);
    setNote(null);
    requestAutoCommit(0, true);
  };

  const restorePhraseTemplate = (phraseKey: number) => {
    setCadenceOverrides((prev) => {
      if (!Object.prototype.hasOwnProperty.call(prev, phraseKey)) return prev;
      const next = { ...prev };
      delete next[phraseKey];
      return next;
    });
    setRoleOverrides((prev) => {
      if (!Object.prototype.hasOwnProperty.call(prev, phraseKey)) return prev;
      const next = { ...prev };
      delete next[phraseKey];
      return next;
    });
    setPhraseRawOverrides((prev) => {
      if (!Object.prototype.hasOwnProperty.call(prev, phraseKey)) return prev;
      const next = { ...prev };
      delete next[phraseKey];
      return next;
    });
    setAssemblyChecklist(null);
    setNote(null);
    requestAutoCommit(0, true);
  };

  const setPhraseRole = (phraseKey: number, role: EnglishPrefaceRole | null) => {
    setCadenceOverrides((prev) => {
      if (!Object.prototype.hasOwnProperty.call(prev, phraseKey)) return prev;
      const next = { ...prev };
      delete next[phraseKey];
      return next;
    });
    setRoleOverrides((prev) => {
      const next = { ...prev };
      if (role === null) delete next[phraseKey];
      else next[phraseKey] = role;
      return next;
    });
    setAssemblyChecklist(null);
    setNote(null);
    requestAutoCommit(0, true);
  };

  const setPrefaceLineBreaksAsPhrases = (nextVal: boolean) => {
    if (
      isPrefaceWorkflow &&
      parsedTone.tone &&
      text.trim() &&
      (Object.keys(cadenceOverrides).length > 0 ||
        Object.keys(roleOverrides).length > 0 ||
        Object.keys(phraseRawOverrides).length > 0)
    ) {
      const prevBodyItems =
        prefaceSplit?.parts
          .find((p) => p.kind === 'body')
          ?.phrases?.map((ph) => ({ text: ph.text, endWordIndex: ph.endWordIndex })) ?? [];
      const nextSplit = splitPreface(text, {
        language,
        tone: parsedTone.tone,
        toneId: activePrefaceToneId,
        templates: prefaceTemplates,
        mergedBreaks,
        forcedBreaks,
        extraBreaks,
        autoJoinShortPhrases:
          language === 'en' && nextVal ? 0 : saved.autoJoinShortPhrasesPreface,
        treatLineBreaksAsPhraseBreaks: nextVal,
      });
      const nextBodyItems =
        nextSplit.parts
          .find((p) => p.kind === 'body')
          ?.phrases?.map((ph) => ({ text: ph.text, endWordIndex: ph.endWordIndex })) ?? [];
      setCadenceOverrides((prev) => remapBodyPhraseOverrides(prevBodyItems, nextBodyItems, prev));
      setRoleOverrides((prev) => remapBodyPhraseOverrides(prevBodyItems, nextBodyItems, prev));
      setPhraseRawOverrides((prev) => remapBodyPhraseOverrides(prevBodyItems, nextBodyItems, prev));
    }
    setAssemblyChecklist(null);
    update({
      prefaceLineBreaksAsPhrases: {
        ...saved.prefaceLineBreaksAsPhrases,
        [language]: nextVal,
      },
    });
    if (text.trim()) {
      requestAutoCommit(0, true);
    }
  };

  const resetCadenceOverrides = () => {
    setCadenceOverrides({});
    setRoleOverrides({});
    setAssemblyChecklist(null);
    setNote(null);
    requestAutoCommit(0, true);
  };

  const getCurrentPhrasesForBreakOps = (): ReadingPhrase[] => {
    if (!parsedTone.tone || !text.trim()) return [];
    if (isPrefaceWorkflow && prefaceSplit) {
      const bodyPhrases = prefaceSplit.parts.find((p) => p.kind === 'body')?.phrases ?? [];
      return bodyPhrases.map((ph) => ({
        index: ph.index,
        text: ph.text,
        words: ph.wordTokens,
        startWordIndex: ph.startWordIndex,
        endWordIndex: ph.endWordIndex,
        endWordText: ph.endWordText,
        defaultKind: ph.defaultKind,
        effectiveKind: ph.effectiveKind,
        choiceLabel: ph.choiceLabel,
        overridden: ph.overridden,
        startsPhrase: true,
        paragraphBreak: ph.paragraphBreak,
        defaultRole: ph.defaultRole,
        effectiveRole: ph.effectiveRole,
        roleOverridden: ph.roleOverridden,
        merged: ph.merged,
        mergedFrom: ph.mergedFrom,
        autoJoined: ph.autoJoined,
        internalMergedBreaks: ph.internalMergedBreaks,
        isOpeningFormula: false,
        canJoinPrev: ph.canJoinPrev,
        canJoinNext: ph.canJoinNext,
      }));
    }
    if (saved.mode === 'reading' || saved.mode === 'preface') {
      const activeOpening =
        saved.mode === 'reading' && !isPrefaceWorkflow && language === 'la'
          ? getReadingOpeningFormulaText(saved.readingOpeningFormula)
          : '';
      return extractReadingPhrases(text, parsedTone.tone, {
        language,
        cadenceOverrides,
        mergedBreaks,
        forcedBreaks,
        extraBreaks,
        autoJoinShortPhrases: effectiveAutoJoinThreshold,
        openingFormula: activeOpening || undefined,
        treatLineBreaksAsPhraseBreaks: treatPrefaceLineBreaksAsPhrases,
      });
    }
    return [];
  };

  const joinPhrases = (endWordIndex: number, dir: 'prev' | 'next') => {
    const phrases = getCurrentPhrasesForBreakOps();
    const res = joinPhraseBreak({
      phrases,
      targetPhraseEndWordIndex: endWordIndex,
      direction: dir,
      mergedBreaks,
      forcedBreaks,
      extraBreaks,
      cadenceOverrides,
      roleOverrides,
      phraseRawOverrides,
    });
    if (!res.changed) return;
    persistBreakKeys(res.mergedBreaks, res.extraBreaks, res.forcedBreaks);
    setCadenceOverrides(res.cadenceOverrides);
    setRoleOverrides(res.roleOverrides);
    setPhraseRawOverrides(res.phraseRawOverrides);
    setAssemblyChecklist(null);
    setNote(null);
    requestAutoCommit(0, true);
  };

  const splitMergedPhrase = (endWordIndex: number) => {
    const phrases = getCurrentPhrasesForBreakOps();
    const ph = phrases.find((p) => p.endWordIndex === endWordIndex);
    if (!ph || !ph.merged) return;

    const { mergedBreaks: nextMerged, forcedBreaks: nextForced } = splitPhraseWithForcedBreaks(
      ph,
      mergedBreaks,
      forcedBreaks
    );
    persistBreakKeys(nextMerged, extraBreaks, nextForced);
    setAssemblyChecklist(null);
    setNote(null);
    requestAutoCommit(0, true);
  };

  const restoreBreak = (breakKey: PhraseBreakKey) => {
    const phrases = getCurrentPhrasesForBreakOps();
    const parentPhrase = phrases.find((p) =>
      p.internalMergedBreaks.some((b) => b.endWordIndex === breakKey.endWordIndex)
    );
    const { mergedBreaks: nextMerged, forcedBreaks: nextForced } = restoreBreakWithForcedBreaks(
      breakKey,
      mergedBreaks,
      forcedBreaks,
      Boolean(parentPhrase?.autoJoined)
    );
    persistBreakKeys(nextMerged, extraBreaks, nextForced);
    setAssemblyChecklist(null);
    setNote(null);
    requestAutoCommit(0, true);
  };

  const toggleExtraBreak = (breakKey: PhraseBreakKey) => {
    const nextExtra = toggleExtraBreakKey(extraBreaks, breakKey);
    persistBreakKeys(mergedBreaks, nextExtra, forcedBreaks);
    setAssemblyChecklist(null);
    setNote(null);
    requestAutoCommit(0, true);
  };

  const resetPhrases = () => {
    if (mergedBreaks.length === 0 && extraBreaks.length === 0 && forcedBreaks.length === 0) return;
    persistBreakKeys([], [], []);
    setAssemblyChecklist(null);
    setNote(null);
    requestAutoCommit(0, true);
  };

  const reapplyTone = () => {
    autoCommitPausedRef.current = false;
    setNote(null);
    commitFnRef.current(true, true);
  };

  const setPartRawGabc = (kind: PrefacePartKind, gabc: string | undefined) => {
    setPartRawOverrides((prev) => {
      const next = { ...prev };
      if (gabc === undefined) delete next[kind];
      else next[kind] = gabc;
      return next;
    });
    setAssemblyChecklist(null);
    setNote(null);
    requestAutoCommit(0, true);
  };

  const setPhraseRawGabc = (phraseKey: number, gabc: string | undefined) => {
    setPhraseRawOverrides((prev) => {
      const next = { ...prev };
      if (gabc === undefined) delete next[phraseKey];
      else next[phraseKey] = gabc;
      return next;
    });
    setAssemblyChecklist(null);
    setNote(null);
    requestAutoCommit(0, true);
  };

  const saveAsPrefaceTemplate = (params: {
    id?: string;
    kind: PrefaceTemplateKind;
    text: string;
    gabc: string;
    language?: ChantLanguage;
    tone?: string;
  }) => {
    const res = saveCorrectedPrefaceTemplate({
      id: params.id,
      language: params.language ?? language,
      tone: params.tone ?? activePrefaceToneId,
      kind: params.kind,
      text: params.text,
      gabc: params.gabc,
    });
    setPrefaceTemplates(res.templates);
    setHiddenPrefaceTemplateCount(loadHiddenPrefaceTemplateIds().length);
    if (params.kind === 'opening' || params.kind === 'closing') {
      setPartRawOverrides((prev) => {
        const next = { ...prev };
        delete next[params.kind as PrefacePartKind];
        return next;
      });
    } else if (params.kind === 'phrase' && prefaceSplit) {
      const bodyPart = prefaceSplit.parts.find((p) => p.kind === 'body');
      if (bodyPart?.phrases) {
        setPhraseRawOverrides((prev) => {
          const next = { ...prev };
          for (const ph of bodyPart.phrases!) {
            if (ph.text === params.text) delete next[ph.endWordIndex];
          }
          return next;
        });
      }
    }
    setAssemblyChecklist(null);
    setNote({
      text: `Saved "${params.kind}" as user-verified template. Future pastes will reuse it.`,
    });
    if (isPrefaceWorkflow && text.trim()) {
      requestAutoCommit(0, true);
    }
  };

  const verifyPrefaceTemplate = (id: string) => {
    const res = markPrefaceTemplateVerified(id);
    if (!res.template) return;
    setPrefaceTemplates(res.templates);
    setHiddenPrefaceTemplateCount(loadHiddenPrefaceTemplateIds().length);
    setAssemblyChecklist(null);
    setNote({
      text: `Marked template "${res.template.id}" as user-verified.`,
    });
    if (isPrefaceWorkflow && text.trim()) {
      requestAutoCommit(0, true);
    }
  };

  const removePrefaceTemplate = (id: string) => {
    const next = deletePrefaceTemplate(id);
    setPrefaceTemplates(next);
    setHiddenPrefaceTemplateCount(loadHiddenPrefaceTemplateIds().length);
    setAssemblyChecklist(null);
    setNote({ text: `Removed template "${id}".` });
    if (isPrefaceWorkflow && text.trim()) {
      requestAutoCommit(0, true);
    }
  };

  const restoreBuiltInPrefaceTemplates = () => {
    const next = restoreDefaultPrefaceTemplates();
    setPrefaceTemplates(next);
    setHiddenPrefaceTemplateCount(loadHiddenPrefaceTemplateIds().length);
    setAssemblyChecklist(null);
    setNote({ text: 'Restored built-in preface templates.' });
    if (isPrefaceWorkflow && text.trim()) {
      requestAutoCommit(0, true);
    }
  };

  const exportPrefaceTemplates = () => {
    const json = exportPrefaceTemplatesJson(prefaceTemplates);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'chantscore-preface-templates.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setNote({ text: `Exported ${prefaceTemplates.length} preface templates as JSON.` });
  };

  const importPrefaceTemplatesFile = (file: File) => {
    file
      .text()
      .then((content) => {
        const res = importPrefaceTemplatesJson(content);
        if (res.error) {
          setNote({ text: res.error, isError: true });
          return;
        }
        setPrefaceTemplates(res.templates);
        setHiddenPrefaceTemplateCount(loadHiddenPrefaceTemplateIds().length);
        setAssemblyChecklist(null);
        setNote({ text: `Imported ${res.importedCount} preface template(s).` });
        if (isPrefaceWorkflow && text.trim()) {
          requestAutoCommit(0, true);
        }
      })
      .catch(() => {
        setNote({ text: 'Failed to read template JSON file.', isError: true });
      });
  };

  const handlersRef = useRef({
    setText,
    importVulgatePsalm,
    setMode,
    update,
    loadPsalmTone,
    loadReadingTone,
    setReadingOpeningFormula,
    loadPrefaceTone,
    resetToBuiltIn,
    toggleSyllableStress,
    toggleWordStress,
    resetStressOverrides,
    selectPhraseCadence,
    restorePhraseTemplate,
    setPhraseRole,
    setPrefaceLineBreaksAsPhrases,
    resetCadenceOverrides,
    joinPhrases,
    splitMergedPhrase,
    restoreBreak,
    toggleExtraBreak,
    resetPhrases,
    reapplyTone,
    setPartRawGabc,
    setPhraseRawGabc,
    saveAsPrefaceTemplate,
    verifyPrefaceTemplate,
    removePrefaceTemplate,
    restoreBuiltInPrefaceTemplates,
    exportPrefaceTemplates,
    importPrefaceTemplatesFile,
  });
  handlersRef.current = {
    setText,
    importVulgatePsalm,
    setMode,
    update,
    loadPsalmTone,
    loadReadingTone,
    setReadingOpeningFormula,
    loadPrefaceTone,
    resetToBuiltIn,
    toggleSyllableStress,
    toggleWordStress,
    resetStressOverrides,
    selectPhraseCadence,
    restorePhraseTemplate,
    setPhraseRole,
    setPrefaceLineBreaksAsPhrases,
    resetCadenceOverrides,
    joinPhrases,
    splitMergedPhrase,
    restoreBreak,
    toggleExtraBreak,
    resetPhrases,
    reapplyTone,
    setPartRawGabc,
    setPhraseRawGabc,
    saveAsPrefaceTemplate,
    verifyPrefaceTemplate,
    removePrefaceTemplate,
    restoreBuiltInPrefaceTemplates,
    exportPrefaceTemplates,
    importPrefaceTemplatesFile,
  };

  const stableActions = useMemo(
    () => ({
      setDockOpen,
      setDefinitionOpen,
      setEditorTab,
      setText: (next: string) => handlersRef.current.setText(next),
      importVulgatePsalm: (id: string) => handlersRef.current.importVulgatePsalm(id),
      setMode: (mode: ToneMode) => handlersRef.current.setMode(mode),
      update: (patch: Partial<SavedToneSettings>) => handlersRef.current.update(patch),
      loadPsalmTone: (id: string, ending: string, solemn: boolean) =>
        handlersRef.current.loadPsalmTone(id, ending, solemn),
      loadReadingTone: (id: string) => handlersRef.current.loadReadingTone(id),
      setReadingOpeningFormula: (id: string) => handlersRef.current.setReadingOpeningFormula(id),
      loadPrefaceTone: (id: string) => handlersRef.current.loadPrefaceTone(id),
      resetToBuiltIn: () => handlersRef.current.resetToBuiltIn(),
      toggleSyllableStress: (globalIndex: number, currentStressed: boolean) =>
        handlersRef.current.toggleSyllableStress(globalIndex, currentStressed),
      toggleWordStress: (word: PrefaceWordItem) => handlersRef.current.toggleWordStress(word),
      resetStressOverrides: () => handlersRef.current.resetStressOverrides(),
      selectPhraseCadence: (
        phraseKey: number,
        choice: PhraseCadenceChoice,
        defaultKind: ReadingCadenceKind | null
      ) => handlersRef.current.selectPhraseCadence(phraseKey, choice, defaultKind),
      restorePhraseTemplate: (phraseKey: number) =>
        handlersRef.current.restorePhraseTemplate(phraseKey),
      setPhraseRole: (phraseKey: number, role: EnglishPrefaceRole | null) =>
        handlersRef.current.setPhraseRole(phraseKey, role),
      setPrefaceLineBreaksAsPhrases: (next: boolean) =>
        handlersRef.current.setPrefaceLineBreaksAsPhrases(next),
      resetCadenceOverrides: () => handlersRef.current.resetCadenceOverrides(),
      joinPhrases: (endWordIndex: number, dir: 'prev' | 'next') =>
        handlersRef.current.joinPhrases(endWordIndex, dir),
      splitMergedPhrase: (endWordIndex: number) =>
        handlersRef.current.splitMergedPhrase(endWordIndex),
      restoreBreak: (breakKey: PhraseBreakKey) => handlersRef.current.restoreBreak(breakKey),
      toggleExtraBreak: (breakKey: PhraseBreakKey) =>
        handlersRef.current.toggleExtraBreak(breakKey),
      resetPhrases: () => handlersRef.current.resetPhrases(),
      reapplyTone: () => handlersRef.current.reapplyTone(),
      setPartRawGabc: (kind: PrefacePartKind, gabc: string | undefined) =>
        handlersRef.current.setPartRawGabc(kind, gabc),
      setPhraseRawGabc: (phraseKey: number, gabc: string | undefined) =>
        handlersRef.current.setPhraseRawGabc(phraseKey, gabc),
      saveAsPrefaceTemplate: (params: {
        id?: string;
        kind: PrefaceTemplateKind;
        text: string;
        gabc: string;
        language?: ChantLanguage;
        tone?: string;
      }) => handlersRef.current.saveAsPrefaceTemplate(params),
      verifyPrefaceTemplate: (id: string) => handlersRef.current.verifyPrefaceTemplate(id),
      removePrefaceTemplate: (id: string) => handlersRef.current.removePrefaceTemplate(id),
      restoreBuiltInPrefaceTemplates: () =>
        handlersRef.current.restoreBuiltInPrefaceTemplates(),
      exportPrefaceTemplates: () => handlersRef.current.exportPrefaceTemplates(),
      importPrefaceTemplatesFile: (file: File) =>
        handlersRef.current.importPrefaceTemplatesFile(file),
    }),
    []
  );

  return useMemo(
    () => ({
      saved,
      builtInOrigin,
      text,
      stressOverrides,
      cadenceOverrides,
      roleOverrides,
      mergedBreaks,
      forcedBreaks,
      extraBreaks,
      note,
      dockOpen,
      definitionOpen,
      editorTab,
      selectedVulgatePsalm,
      isPrefaceWorkflow,
      activePrefaceToneId,
      prefaceSplit,
      assembledPrefaceGabc,
      prefaceTemplates,
      hiddenPrefaceTemplateCount,
      assemblyChecklist,
      enHyphenationVersion,
      catalog: TONE_CATALOG,
      ...stableActions,
    }),
    [
      saved,
      builtInOrigin,
      text,
      stressOverrides,
      cadenceOverrides,
      roleOverrides,
      mergedBreaks,
      forcedBreaks,
      extraBreaks,
      note,
      dockOpen,
      definitionOpen,
      editorTab,
      selectedVulgatePsalm,
      isPrefaceWorkflow,
      activePrefaceToneId,
      prefaceSplit,
      assembledPrefaceGabc,
      prefaceTemplates,
      hiddenPrefaceTemplateCount,
      assemblyChecklist,
      enHyphenationVersion,
      stableActions,
    ]
  );
}

export interface ToneStateBridgeProps {
  language: ChantLanguage;
  onChangeLanguage?: (lang: ChantLanguage) => void;
  onCommitToneGabc: (
    gabc: string,
    callbacks?: CommitToneCallbacks,
    toneLinkPayload?: CommitToneLinkPayload | null
  ) => void;
  onControllerChange: (controller: ToneController) => void;
}

export const ToneStateBridge: React.FC<ToneStateBridgeProps> = ({
  language,
  onChangeLanguage,
  onCommitToneGabc,
  onControllerChange,
}) => {
  const controller = useToneState({ language, onChangeLanguage, onCommitToneGabc });
  const onControllerChangeRef = useRef(onControllerChange);
  onControllerChangeRef.current = onControllerChange;
  useEffect(() => {
    onControllerChangeRef.current(controller);
  }, [controller]);
  return null;
};

export interface ToneDockPanelProps {
  controller: ToneController;
  language: ChantLanguage;
  layoutMode?: ToneLayoutMode;
  panelWidth?: number;
  toneLinkValid?: boolean;
  toneLinkStale?: boolean;
  showPhraseControls?: boolean;
  onToggleShowPhraseControls?: (next: boolean) => void;
  onToggleLayoutMode?: () => void;
  onCollapse?: () => void;
}

const EMPTY_SIMPLE_FORM: ToneSimpleFormValues = {
  name: '',
  clef: 'c4',
  tenor: 'h',
  intonation: '',
  flex: '',
  mediant: '',
  termination: '',
  metrum: '',
  flexa: '',
  punctum: '',
  question: '',
  prefinal: '',
  final: '',
};

interface CadenceFieldRowConfig {
  field: ToneSimpleFormField;
  label: string;
  badge?: string;
  placeholder: string;
  help: string;
}

const PSALM_CADENCE_ROWS: CadenceFieldRowConfig[] = [
  {
    field: 'flex',
    label: 'Half-verse flex',
    badge: '†',
    placeholder: 'h* g or none',
    help: 'Optional dip at †. Use pitch letters (a–m), * on the accented syllable, and / between segments. Leave blank or type none to omit.',
  },
  {
    field: 'mediant',
    label: 'Mediant',
    badge: '*',
    placeholder: 'g h i* h',
    help: 'Turn at the * middle break. Prep notes come before the accented* syllable, e.g. g h i* h.',
  },
  {
    field: 'termination',
    label: 'Termination',
    badge: '::',
    placeholder: 'h g* g',
    help: 'Closing cadence at the end of the verse. * marks the accented syllable.',
  },
];

const READING_CADENCE_ROWS: CadenceFieldRowConfig[] = [
  {
    field: 'metrum',
    label: CADENCE_CHOICE_META.metrum.label,
    placeholder: 'h* g',
    help: 'Cadence at a semicolon or colon (; / :). * marks the accented syllable; type none to keep reciting.',
  },
  {
    field: 'flexa',
    label: CADENCE_CHOICE_META.flex.label,
    placeholder: 'h* g or none',
    help: 'Cadence at a comma (,). Leave blank or type none to keep reciting.',
  },
  {
    field: 'punctum',
    label: CADENCE_CHOICE_META.long.label,
    placeholder: 'h* g g',
    help: 'Cadence at a full stop (.). * marks the accented syllable.',
  },
  {
    field: 'question',
    label: CADENCE_CHOICE_META.question.label,
    placeholder: 'positional; h. gr f g gh..',
    help: 'Cadence at a question mark (?). Prefix with positional; for fixed end-syllable notes.',
  },
  {
    field: 'prefinal',
    label: CADENCE_CHOICE_META.prefinal.label,
    placeholder: 'optional',
    help: 'Optional cadence for the second-to-last phrase. Leave blank to reuse Full stop.',
  },
  {
    field: 'final',
    label: CADENCE_CHOICE_META.final.label,
    placeholder: 'fh* hr h. / gr gh* hr h.',
    help: 'Closing formula for the final phrase. Leave blank to reuse Full stop.',
  },
];

export const ToneDockPanel: React.FC<ToneDockPanelProps> = ({
  controller,
  language,
  layoutMode = 'side',
  panelWidth,
  toneLinkValid = false,
  toneLinkStale = false,
  showPhraseControls = true,
  onToggleShowPhraseControls,
  onToggleLayoutMode,
  onCollapse,
}) => {
  const {
    saved,
    builtInOrigin,
    text,
    stressOverrides,
    cadenceOverrides,
    roleOverrides,
    mergedBreaks,
    forcedBreaks = [],
    extraBreaks,
    note,
    definitionOpen,
    editorTab,
    isPrefaceWorkflow,
    activePrefaceToneId,
    prefaceSplit,
    assembledPrefaceGabc,
    prefaceTemplates,
    hiddenPrefaceTemplateCount,
    assemblyChecklist,
    setDefinitionOpen,
    setEditorTab,
    setText,
    update,
    resetToBuiltIn,
    toggleSyllableStress,
    toggleWordStress,
    resetStressOverrides,
    selectPhraseCadence,
    restorePhraseTemplate,
    setPhraseRole,
    setPrefaceLineBreaksAsPhrases,
    resetCadenceOverrides,
    joinPhrases,
    splitMergedPhrase,
    restoreBreak,
    resetPhrases,
    reapplyTone,
    setPartRawGabc,
    setPhraseRawGabc,
    saveAsPrefaceTemplate,
    verifyPrefaceTemplate,
    removePrefaceTemplate,
    restoreBuiltInPrefaceTemplates,
    exportPrefaceTemplates,
    importPrefaceTemplatesFile,
  } = controller;

  const panelRef = useRef<HTMLElement | null>(null);
  const [measuredWidth, setMeasuredWidth] = useState<number | null>(null);
  const [phraseListOpenOverride, setPhraseListOpenOverride] = useState<boolean | null>(null);

  const prevToneLinkValidRef = useRef(toneLinkValid);
  if (prevToneLinkValidRef.current !== toneLinkValid) {
    prevToneLinkValidRef.current = toneLinkValid;
    if (phraseListOpenOverride !== null) {
      setPhraseListOpenOverride(null);
    }
  }
  const readingPhraseListOpen =
    phraseListOpenOverride !== null ? phraseListOpenOverride : !toneLinkValid;

  useEffect(() => {
    const el = panelRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setMeasuredWidth(entry.contentRect.width);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const parsedTone = useMemo(() => parseToneDefinition(saved.definition), [saved.definition]);
  const [simpleDraft, setSimpleDraft] = useState<ToneSimpleFormValues>(() =>
    parsedTone.tone ? toneToFormValues(parsedTone.tone, language) : EMPTY_SIMPLE_FORM
  );
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<ToneSimpleFormField, string>>>({});
  const lastSimpleSyncKeyRef = useRef<string>('');

  useEffect(() => {
    const syncKey = `${saved.definition}::${language}::${saved.mode}`;
    if (syncKey === lastSimpleSyncKeyRef.current) return;
    lastSimpleSyncKeyRef.current = syncKey;
    if (parsedTone.tone) {
      setSimpleDraft(toneToFormValues(parsedTone.tone, language));
      setFieldErrors({});
    }
  }, [saved.definition, saved.mode, language, parsedTone.tone]);

  const handleSimpleFieldChange = (fieldKey: ToneSimpleFormField, value: string) => {
    if (!parsedTone.tone) return;
    const nextForm = { ...simpleDraft, [fieldKey]: value };
    setSimpleDraft(nextForm);
    const res = formValuesToTone(nextForm, parsedTone.tone, saved.mode, language);
    setFieldErrors(res.fieldErrors);
    if (res.tone) {
      const nextDef = toneToDefinition(res.tone);
      lastSimpleSyncKeyRef.current = `${nextDef}::${language}::${saved.mode}`;
      update({
        definition: nextDef,
        psalmTone: '',
        readingTone: '',
        prefaceTone: '',
      });
    }
  };

  const canResetToBuiltIn =
    builtInOrigin !== null && saved.definition !== builtInOrigin.definition;
  const cadenceRows = saved.mode === 'psalm' ? PSALM_CADENCE_ROWS : READING_CADENCE_ROWS;
  const hasCustomClef =
    Boolean(simpleDraft.clef.trim()) &&
    !TONE_CLEF_OPTIONS.some((opt) => opt.value === simpleDraft.clef.trim().toLowerCase());

  const isReadingLike = saved.mode === 'reading' || saved.mode === 'preface';
  const activeOpeningFormula =
    saved.mode === 'reading' && !isPrefaceWorkflow && language === 'la'
      ? getReadingOpeningFormulaText(saved.readingOpeningFormula)
      : '';

  const treatPrefaceLineBreaksAsPhrases = saved.prefaceLineBreaksAsPhrases[language];
  const isEnglishLineBasedPreface =
    isPrefaceWorkflow && language === 'en' && treatPrefaceLineBreaksAsPhrases;
  const activeAutoJoinVal = isPrefaceWorkflow
    ? saved.autoJoinShortPhrasesPreface
    : saved.autoJoinShortPhrasesReading;
  const effectiveAutoJoinVal = isEnglishLineBasedPreface ? 0 : activeAutoJoinVal;

  const readingPhrases = useMemo(() => {
    if (isPrefaceWorkflow || !isReadingLike || !parsedTone.tone) return [];
    return extractReadingPhrases(text, parsedTone.tone, {
      language,
      cadenceOverrides,
      mergedBreaks,
      forcedBreaks,
      extraBreaks,
      autoJoinShortPhrases: effectiveAutoJoinVal,
      openingFormula: activeOpeningFormula || undefined,
      treatLineBreaksAsPhraseBreaks: treatPrefaceLineBreaksAsPhrases,
    });
  }, [
    isPrefaceWorkflow,
    isReadingLike,
    parsedTone.tone,
    text,
    language,
    cadenceOverrides,
    mergedBreaks,
    forcedBreaks,
    extraBreaks,
    effectiveAutoJoinVal,
    activeOpeningFormula,
    treatPrefaceLineBreaksAsPhrases,
    controller.enHyphenationVersion,
  ]);

  const hasQuestionCadence = Boolean(
    parsedTone.tone && getReadingCadence(parsedTone.tone, 'question', language)
  );

  const previewRows = useMemo(
    () =>
      isPrefaceWorkflow
        ? []
        : extractTonePreview(saved.mode, text, {
            language,
            autoFlexSyllables: saved.autoFlex ? 14 : 0,
            hasFlex: !!parsedTone.tone?.flex,
            stressOverrides,
            tone: isReadingLike ? parsedTone.tone : undefined,
            cadenceOverrides: isReadingLike ? cadenceOverrides : undefined,
            mergedBreaks: isReadingLike ? mergedBreaks : undefined,
            forcedBreaks: isReadingLike ? forcedBreaks : undefined,
            extraBreaks: isReadingLike ? extraBreaks : undefined,
            autoJoinShortPhrases: isReadingLike ? effectiveAutoJoinVal : undefined,
            openingFormula: activeOpeningFormula || undefined,
            treatLineBreaksAsPhraseBreaks: treatPrefaceLineBreaksAsPhrases,
          }),
    [
      isPrefaceWorkflow,
      saved.mode,
      isReadingLike,
      text,
      language,
      saved.autoFlex,
      parsedTone.tone,
      stressOverrides,
      cadenceOverrides,
      mergedBreaks,
      forcedBreaks,
      extraBreaks,
      effectiveAutoJoinVal,
      activeOpeningFormula,
      treatPrefaceLineBreaksAsPhrases,
      controller.enHyphenationVersion,
    ]
  );

  const hasOverrides = Object.keys(stressOverrides).length > 0;
  const hasCadenceOverrides =
    Object.keys(cadenceOverrides).length > 0 || Object.keys(roleOverrides).length > 0;
  const hasMergedOrSplitBreaks =
    mergedBreaks.length > 0 || extraBreaks.length > 0 || forcedBreaks.length > 0;
  const field =
    'w-full rounded border border-[#CFC3AE] bg-[#FAF6EE] p-2 text-[12px] text-[#1D1915] focus:border-[#8B1E24] focus:outline-none';

  const effectiveSideWidth = measuredWidth ?? panelWidth ?? 0;
  const gridClass =
    layoutMode === 'below'
      ? 'grid grid-cols-1 lg:grid-cols-2 gap-2.5 items-start'
      : effectiveSideWidth > 720
      ? 'grid grid-cols-2 gap-2.5 items-start'
      : 'grid grid-cols-1 gap-2.5 items-start';

  return (
    <aside
      ref={panelRef}
      data-tone-layout-mode={layoutMode}
      className="no-print flex flex-1 min-h-0 w-full flex-col overflow-y-auto bg-[#EFE8DA] text-[11px] text-[#1D1915]"
      aria-label="Tone text and definition workspace"
    >
      <div className="sticky top-0 z-10 shrink-0 flex flex-wrap items-center justify-between gap-2 border-b border-[#DDD3C1] bg-[#EAE2D3] px-3 py-1.5">
        <div className="flex items-center gap-1.5 min-w-0">
          <h2 className="font-[family-name:var(--font-display)] text-xs font-semibold tracking-wider text-[#8B1E24] truncate">
            Tones
          </h2>
          <span className="text-[10px] font-medium uppercase tracking-wide text-[#6B6257] whitespace-nowrap">
            {saved.mode}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1 shrink-0">
          {isReadingLike && !isEnglishLineBasedPreface && (
            <label
              className="inline-flex h-6 items-center gap-1 rounded border border-[#CFC3AE] bg-[#FAF6EE] px-1.5 text-[10px] font-medium text-[#4F473E]"
              title="Automatically join short phrases (up to N words) into a neighboring phrase; 0 = off"
            >
              <span className="whitespace-nowrap">Auto-join short phrases</span>
              <select
                aria-label="Auto-join short phrases"
                value={activeAutoJoinVal}
                onChange={(e) => {
                  const val = clampAutoJoinShortPhrases(Number(e.target.value));
                  update(
                    isPrefaceWorkflow
                      ? { autoJoinShortPhrasesPreface: val }
                      : { autoJoinShortPhrasesReading: val }
                  );
                }}
                className="bg-transparent font-semibold text-[#1D1915] focus:outline-none cursor-pointer"
              >
                <option value={0}>Off (0)</option>
                <option value={1}>≤ 1 word</option>
                <option value={2}>≤ 2 words</option>
                <option value={3}>≤ 3 words</option>
                <option value={4}>≤ 4 words</option>
                <option value={5}>≤ 5 words</option>
                <option value={6}>≤ 6 words</option>
              </select>
            </label>
          )}
          {isReadingLike && hasCadenceOverrides && (
            <button
              type="button"
              onClick={resetCadenceOverrides}
              className="inline-flex h-6 items-center gap-1 rounded border border-[#CFC3AE] bg-[#FAF6EE] px-1.5 text-[10px] font-medium text-[#4F473E] hover:bg-white hover:text-[#1D1915] whitespace-nowrap"
            >
              <RotateCcw className="h-2.5 w-2.5" />
              <span>Reset terminations</span>
            </button>
          )}
          {isReadingLike && hasMergedOrSplitBreaks && (
            <button
              type="button"
              onClick={resetPhrases}
              className="inline-flex h-6 items-center gap-1 rounded border border-[#CFC3AE] bg-[#FAF6EE] px-1.5 text-[10px] font-medium text-[#4F473E] hover:bg-white hover:text-[#1D1915] whitespace-nowrap"
            >
              <RotateCcw className="h-2.5 w-2.5" />
              <span>Reset phrases</span>
            </button>
          )}
          {isReadingLike && toneLinkValid && onToggleShowPhraseControls && (
            <button
              type="button"
              aria-pressed={showPhraseControls}
              onClick={() => onToggleShowPhraseControls(!showPhraseControls)}
              className={`inline-flex h-6 items-center gap-1 rounded border px-2 text-[10px] font-medium transition-colors whitespace-nowrap ${
                showPhraseControls
                  ? 'border-[#8B1E24] bg-[#8B1E24] text-[#FAF6EE]'
                  : 'border-[#CFC3AE] bg-[#FAF6EE] text-[#4F473E] hover:bg-white hover:text-[#1D1915]'
              }`}
            >
              <span>Show phrase controls</span>
            </button>
          )}
          {onToggleLayoutMode && (
            <button
              type="button"
              onClick={onToggleLayoutMode}
              title={
                layoutMode === 'side'
                  ? 'Move Tones panel below the ribbon'
                  : 'Dock Tones panel side-by-side on the right'
              }
              aria-label={
                layoutMode === 'side'
                  ? 'Switch Tones panel to Below layout'
                  : 'Switch Tones panel to Side by side layout'
              }
              data-tone-layout-toggle={layoutMode}
              className="inline-flex h-6 items-center gap-1 rounded border border-[#CFC3AE] bg-[#FAF6EE] px-2 text-[10.5px] font-medium text-[#1D1915] hover:bg-white transition-colors whitespace-nowrap"
            >
              {layoutMode === 'side' ? (
                <>
                  <PanelBottom className="h-3 w-3 text-[#8B1E24]" />
                  <span>Below</span>
                </>
              ) : (
                <>
                  <PanelRight className="h-3 w-3 text-[#8B1E24]" />
                  <span>Side</span>
                </>
              )}
            </button>
          )}
          <button
            type="button"
            onClick={onCollapse ?? (() => controller.setDockOpen(false))}
            title="Collapse Tones panel"
            aria-label="Collapse Tones panel"
            data-tone-collapse
            className="inline-flex h-6 w-6 items-center justify-center rounded border border-[#CFC3AE] bg-[#FAF6EE] text-[#4F473E] hover:bg-white hover:text-[#1D1915] transition-colors"
          >
            {layoutMode === 'below' ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </div>

      <div className="px-3 sm:px-4 py-2">
        <div className={gridClass}>
        {/* Left column: Verse / Reading text + Preface parts or phrase cadences + syllable stress preview */}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
            <label htmlFor="tone-text" className="font-semibold text-[#1D1915]">
              {saved.mode === 'psalm'
                ? 'Psalm / canticle text (one verse per line; * mediant, † flex)'
                : saved.mode === 'preface'
                ? parsedTone.tone?.phrasing === 'lines'
                  ? !treatPrefaceLineBreaksAsPhrases
                    ? 'Preface text (phrases end at , ; : . ? !; blank line = paragraph break)'
                    : 'Preface text (one phrase per line; blank line = paragraph break)'
                  : 'Preface text (punctuated clauses)'
                : parsedTone.tone?.phrasing === 'lines'
                ? 'Reading text (one phrase per line; blank line = paragraph break)'
                : 'Reading text (punctuated clauses)'}
            </label>
            <div className="flex items-center gap-2">
              {saved.mode === 'psalm' && (
                <select
                  aria-label="Import Vulgate psalm or canticle"
                  value={controller.selectedVulgatePsalm}
                  onChange={(e) => void controller.importVulgatePsalm(e.target.value)}
                  className="h-6 max-w-[200px] rounded border border-[#CFC3AE] bg-[#FAF6EE] px-1.5 text-[11px] font-medium text-[#1D1915] focus:border-[#8B1E24] focus:outline-none"
                >
                  <option value="">Import Vulgate psalm…</option>
                  <optgroup label="Vulgate Psalms (1–150)">
                    {VULGATE_ENTRIES.filter((entry) => entry.group === 'psalm').map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.label}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Canticles">
                    {VULGATE_ENTRIES.filter((entry) => entry.group === 'canticle').map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.label}
                      </option>
                    ))}
                  </optgroup>
                </select>
              )}
              <span className="text-[10.5px] text-[#6B6257] whitespace-nowrap">
                {language === 'en' ? 'English' : 'Latin'}
              </span>
            </div>
          </div>
          <textarea
            id="tone-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            className={field}
            placeholder={
              language === 'en'
                ? saved.mode === 'psalm'
                  ? 'The Lord said unto my Lord: * Sit thou at my right hand.'
                  : saved.mode === 'preface' || isPrefaceWorkflow
                  ? 'It is truly right and just, our duty and our salvation,\nalways and everywhere to give you thanks,'
                  : 'Paste English reading text here'
                : saved.mode === 'psalm'
                ? 'Dixit Dóminus Dómino meo: * Sede a dextris meis.'
                : saved.mode === 'preface' || isPrefaceWorkflow
                ? 'Vere dignum et iustum est, æquum et salutáre;\nnos tibi semper et ubíque, grátias ágere;'
                : 'Paste Latin reading text here'
            }
          />

          {isReadingLike && toneLinkStale && text.trim().length > 0 && (
            <div
              role="status"
              data-testid="tone-link-stale-notice"
              className="mt-1.5 flex flex-wrap items-center justify-between gap-2 rounded border border-[#D6CBB8] bg-[#FAF6EE] px-2.5 py-1.5 text-[10.5px] text-[#5C5349]"
            >
              <span>
                Phrase controls are available only for the unedited tone output - Re-apply tone to enable them.
              </span>
              <button
                type="button"
                onClick={reapplyTone}
                className="shrink-0 rounded border border-[#8B1E24] bg-[#8B1E24] px-2 py-0.5 text-[10px] font-semibold text-[#FAF6EE] hover:bg-[#70161B] transition-colors"
              >
                Re-apply
              </button>
            </div>
          )}

          {isPrefaceWorkflow && (
            <React.Suspense
              fallback={
                <div className="mt-1.5 rounded border border-[#DDD3C1] bg-[#FAF6EE] px-2.5 py-2 text-[11px] text-[#6B6257]">
                  Loading tones…
                </div>
              }
            >
              <LazyPrefacePartsPanel
                language={language}
                rawText={text}
                activeToneId={activePrefaceToneId}
                split={prefaceSplit}
                assembledGabc={assembledPrefaceGabc}
                templates={prefaceTemplates}
                hiddenTemplateCount={hiddenPrefaceTemplateCount}
                hasQuestionCadence={hasQuestionCadence}
                hasCadenceOverrides={hasCadenceOverrides}
                hasStressOverrides={hasOverrides}
                hasMergedOrSplitBreaks={hasMergedOrSplitBreaks}
                markersAvailable={toneLinkValid}
                treatLineBreaksAsPhraseBreaks={treatPrefaceLineBreaksAsPhrases}
                checklist={assemblyChecklist}
                onToggleWordStress={toggleWordStress}
                onSelectPhraseCadence={selectPhraseCadence}
                onRestorePhraseTemplate={restorePhraseTemplate}
                onChangePhraseRole={setPhraseRole}
                onToggleTreatLineBreaksAsPhraseBreaks={setPrefaceLineBreaksAsPhrases}
                onResetCadenceOverrides={resetCadenceOverrides}
                onResetStressOverrides={resetStressOverrides}
                onResetPhraseBreaks={resetPhrases}
                onJoinPhrases={joinPhrases}
                onSplitMergedPhrase={splitMergedPhrase}
                onRestoreBreak={restoreBreak}
                onSetPartRawGabc={setPartRawGabc}
                onSetPhraseRawGabc={setPhraseRawGabc}
                onSaveAsTemplate={saveAsPrefaceTemplate}
                onVerifyTemplate={verifyPrefaceTemplate}
                onDeleteTemplate={removePrefaceTemplate}
                onRestoreDefaultTemplates={restoreBuiltInPrefaceTemplates}
                onExportTemplates={exportPrefaceTemplates}
                onImportTemplatesFile={importPrefaceTemplatesFile}
              />
            </React.Suspense>
          )}

          {!isPrefaceWorkflow && isReadingLike && readingPhrases.length > 0 && (
            <div
              className="mt-1.5 rounded border border-[#DDD3C1] bg-[#FAF6EE] px-2.5 py-1.5"
              aria-label="Phrase cadences preview"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  aria-expanded={readingPhraseListOpen}
                  onClick={() => setPhraseListOpenOverride(!readingPhraseListOpen)}
                  className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-[#4F473E] hover:text-[#1D1915]"
                >
                  {readingPhraseListOpen ? (
                    <ChevronDown className="h-3 w-3 text-[#8B1E24]" />
                  ) : (
                    <ChevronRight className="h-3 w-3 text-[#8B1E24]" />
                  )}
                  <span>Phrase list ({readingPhrases.length})</span>
                </button>
                <div className="flex flex-wrap items-center gap-1.5">
                  {hasCadenceOverrides && (
                    <button
                      type="button"
                      onClick={resetCadenceOverrides}
                      className="inline-flex items-center gap-1 rounded border border-[#CFC3AE] bg-[#F5EFE4] px-1.5 py-0.5 text-[10px] font-medium text-[#4F473E] hover:bg-white hover:text-[#1D1915]"
                    >
                      <RotateCcw className="h-2.5 w-2.5" />
                      <span>Reset terminations</span>
                    </button>
                  )}
                  {hasMergedOrSplitBreaks && (
                    <button
                      type="button"
                      onClick={resetPhrases}
                      className="inline-flex items-center gap-1 rounded border border-[#CFC3AE] bg-[#F5EFE4] px-1.5 py-0.5 text-[10px] font-medium text-[#4F473E] hover:bg-white hover:text-[#1D1915]"
                    >
                      <RotateCcw className="h-2.5 w-2.5" />
                      <span>Reset phrases</span>
                    </button>
                  )}
                </div>
              </div>
              {readingPhraseListOpen && (
                <div className="mt-1.5 border-t border-[#EDE5D5] pt-1">
                  <CadenceColorLegend />
                  <div className="divide-y divide-[#EDE5D5]">
                    {readingPhrases.map((ph) => {
                      const phraseKey = ph.endWordIndex;
                      return (
                        <div
                          key={phraseKey}
                          className={`py-1 ${
                            ph.paragraphBreak ? 'border-t-2 border-t-[#D6CBB8] pt-1.5 mt-0.5' : ''
                          }`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-1.5">
                            <span className="min-w-0 flex-1 truncate font-[family-name:var(--font-serif)] text-[12px] text-[#2A241E]">
                              <span className="mr-1.5 font-sans text-[10px] text-[#8A7E6D]">
                                {ph.index + 1}.
                              </span>
                              {ph.text}
                            </span>
                            <div className="flex flex-wrap items-center gap-1 shrink-0">
                              {ph.merged && (
                                <span className="rounded border border-[#C8B898] bg-[#EFE5D1] px-1 py-0 text-[9.5px] font-semibold text-[#6B4E16]">
                                  merged ×{ph.mergedFrom}
                                </span>
                              )}
                              {ph.autoJoined && (
                                <span
                                  data-auto-joined-badge="true"
                                  className="rounded border border-[#9CC2A3] bg-[#E8F3EA] px-1 py-0 text-[9.5px] font-semibold text-[#1E5B2D]"
                                >
                                  auto
                                </span>
                              )}
                              <PhraseCadencePicker
                                phraseIndex={ph.index}
                                currentChoice={ph.choiceLabel}
                                defaultKind={ph.defaultKind}
                                overridden={ph.overridden}
                                isEnglishPreface={false}
                                hasQuestionCadence={hasQuestionCadence}
                                onSelectChoice={(_idx, choice, defKind) =>
                                  selectPhraseCadence(phraseKey, choice, defKind)
                                }
                              />
                              <button
                                type="button"
                                disabled={!ph.canJoinPrev}
                                onClick={() => joinPhrases(phraseKey, 'prev')}
                                title="Join with previous phrase"
                                className="rounded border border-[#CFC3AE] bg-[#F5EFE4] px-1.5 py-0.5 text-[10px] font-medium text-[#4F473E] hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed"
                              >
                                Join prev
                              </button>
                              <button
                                type="button"
                                disabled={!ph.canJoinNext}
                                onClick={() => joinPhrases(phraseKey, 'next')}
                                title="Join with next phrase"
                                className="rounded border border-[#CFC3AE] bg-[#F5EFE4] px-1.5 py-0.5 text-[10px] font-medium text-[#4F473E] hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed"
                              >
                                Join next
                              </button>
                              {ph.merged && (
                                <button
                                  type="button"
                                  onClick={() => splitMergedPhrase(phraseKey)}
                                  title={`Split into ${ph.mergedFrom} phrases`}
                                  className="inline-flex items-center gap-0.5 rounded border border-[#CFC3AE] bg-[#F5EFE4] px-1.5 py-0.5 text-[10px] font-medium text-[#4F473E] hover:bg-white"
                                >
                                  <Scissors className="h-2.5 w-2.5" />
                                  <span>Split</span>
                                </button>
                              )}
                            </div>
                          </div>
                          {ph.internalMergedBreaks.length > 0 && (
                            <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px] text-[#6B6257]">
                              <span>Restore break:</span>
                              {ph.internalMergedBreaks.map((bk) => (
                                <button
                                  key={`${bk.endWordIndex}_${bk.wordText}`}
                                  type="button"
                                  onClick={() => restoreBreak(bk)}
                                  className="inline-flex items-center gap-0.5 rounded border border-[#CFC3AE] bg-[#F5EFE4] px-1.5 py-0 text-[10px] font-medium text-[#4F473E] hover:bg-white hover:text-[#1D1915]"
                                >
                                  <span>+ after "{bk.wordText}"</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {previewRows.length > 0 && (
            <div className="mt-1.5 rounded border border-[#DDD3C1] bg-[#FAF6EE] px-2.5 py-1.5">
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-[#6B6257]">
                  Syllable stress preview · click a syllable to toggle accent
                </span>
                {hasOverrides && (
                  <button
                    type="button"
                    onClick={resetStressOverrides}
                    className="inline-flex items-center gap-1 rounded border border-[#CFC3AE] bg-[#F5EFE4] px-1.5 py-0.5 text-[10px] font-medium text-[#4F473E] hover:bg-white hover:text-[#1D1915]"
                  >
                    <RotateCcw className="h-2.5 w-2.5" />
                    <span>Reset stress</span>
                  </button>
                )}
              </div>
              <div className="space-y-1 font-[family-name:var(--font-serif)] text-[13px] leading-relaxed">
                {previewRows.map((row, rowIdx) => (
                  <div key={rowIdx} className="flex flex-wrap items-baseline">
                    {row.map((tok, tokIdx) => {
                      if (tok.kind === 'marker') {
                        return (
                          <span
                            key={`m_${rowIdx}_${tokIdx}`}
                            className="mx-1.5 font-bold text-[#9A6B16]"
                            aria-hidden="true"
                          >
                            {tok.symbol}
                          </span>
                        );
                      }
                      const overridden = Object.prototype.hasOwnProperty.call(
                        stressOverrides,
                        tok.globalIndex
                      );
                      return (
                        <React.Fragment key={`s_${tok.globalIndex}`}>
                          <button
                            type="button"
                            aria-pressed={tok.stressed}
                            title={`"${tok.text}" — ${tok.stressed ? 'stressed' : 'unstressed'} (click to toggle)`}
                            onClick={() => toggleSyllableStress(tok.globalIndex, tok.stressed)}
                            className={`rounded-sm px-0.5 transition-colors focus-visible:outline-2 focus-visible:outline-[#8B1E24] ${
                              tok.stressed
                                ? 'font-bold text-[#8B1E24] underline decoration-[#8B1E24] decoration-2 underline-offset-2'
                                : 'text-[#4F473E] hover:bg-[#EAE2D3] hover:text-[#1D1915]'
                            }${overridden ? ' bg-[#B48327]/15' : ''}`}
                          >
                            {tok.text}
                          </button>
                          {!tok.wordEnd ? (
                            <span className="text-[#9E917B] select-none" aria-hidden="true">
                              ·
                            </span>
                          ) : (
                            <span className="w-1.5 inline-block" aria-hidden="true" />
                          )}
                        </React.Fragment>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right column: Collapsible Customize tone editor (collapsed by default) */}
        <div className="min-w-0">
          <div className="rounded border border-[#D6CBB8] bg-[#F5EFE4]">
            <button
              type="button"
              aria-expanded={definitionOpen}
              onClick={() => setDefinitionOpen((open) => !open)}
              className="flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left font-semibold text-[#1D1915] hover:bg-[#FAF6EE] transition-colors rounded"
            >
              <span className="flex items-center gap-1.5">
                {definitionOpen ? (
                  <ChevronDown className="h-3.5 w-3.5 text-[#8B1E24]" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 text-[#8B1E24]" />
                )}
                <span>Customize tone</span>
              </span>
              <span className="text-[10.5px] font-normal text-[#6B6257] truncate">
                {parsedTone.tone
                  ? `${parsedTone.tone.name} (${parsedTone.tone.clef})`
                  : 'Syntax error'}
              </span>
            </button>

            {definitionOpen && (
              <div className="border-t border-[#DDD3C1] p-2 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E3D8C6] pb-1.5">
                  <div
                    role="tablist"
                    aria-label="Tone editor mode"
                    className="inline-flex rounded border border-[#CFC3AE] bg-[#EFE8DA] p-0.5"
                  >
                    <button
                      type="button"
                      role="tab"
                      aria-selected={editorTab === 'simple'}
                      onClick={() => {
                        setEditorTab('simple');
                        if (parsedTone.tone && Object.keys(fieldErrors).length > 0) {
                          setSimpleDraft(toneToFormValues(parsedTone.tone, language));
                          setFieldErrors({});
                        }
                      }}
                      className={`rounded px-2 py-0.5 text-[10.5px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-[#8B1E24] ${
                        editorTab === 'simple'
                          ? 'bg-[#8B1E24] text-[#FAF6EE]'
                          : 'text-[#4F473E] hover:text-[#1D1915]'
                      }`}
                    >
                      Simple
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={editorTab === 'advanced'}
                      onClick={() => setEditorTab('advanced')}
                      className={`rounded px-2 py-0.5 text-[10.5px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-[#8B1E24] ${
                        editorTab === 'advanced'
                          ? 'bg-[#8B1E24] text-[#FAF6EE]'
                          : 'text-[#4F473E] hover:text-[#1D1915]'
                      }`}
                    >
                      Advanced (text)
                    </button>
                  </div>

                  {canResetToBuiltIn && (
                    <button
                      type="button"
                      onClick={resetToBuiltIn}
                      className="inline-flex items-center gap-1 rounded border border-[#CFC3AE] bg-[#FAF6EE] px-2 py-0.5 text-[10.5px] font-medium text-[#4F473E] hover:bg-white hover:text-[#1D1915] focus-visible:outline-2 focus-visible:outline-[#8B1E24]"
                    >
                      <RotateCcw className="h-3 w-3 text-[#8B1E24]" aria-hidden="true" />
                      <span>Reset to built-in</span>
                    </button>
                  )}
                </div>

                {editorTab === 'simple' ? (
                  <div role="tabpanel" aria-label="Simple tone editor" className="space-y-2">
                    {!parsedTone.tone && (
                      <div
                        role="alert"
                        className="rounded border border-[#DFC9C9] bg-[#FDF4F4] px-2.5 py-1.5 text-[10.5px] text-[#991B1B]"
                      >
                        <p className="font-semibold">
                          The tone text currently has a syntax error, so Simple fields are read-only until fixed in Advanced (text){canResetToBuiltIn ? ' or reset to built-in' : ''}:
                        </p>
                        {parsedTone.errors.length > 0 && (
                          <ul className="mt-1 list-disc pl-4 space-y-0.5">
                            {parsedTone.errors.map((err, i) => (
                              <li key={i}>{err}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                      <div className="sm:col-span-5">
                        <label
                          htmlFor="tone-simple-name"
                          className="block text-[10.5px] font-semibold text-[#4F473E] mb-0.5"
                        >
                          Tone name
                        </label>
                        <input
                          id="tone-simple-name"
                          type="text"
                          value={simpleDraft.name}
                          disabled={!parsedTone.tone}
                          onChange={(e) => handleSimpleFieldChange('name', e.target.value)}
                          className="w-full rounded border border-[#CFC3AE] bg-[#FAF6EE] px-2 py-1 text-[11.5px] text-[#1D1915] focus:border-[#8B1E24] focus:outline-none disabled:opacity-60"
                        />
                      </div>

                      <div className="sm:col-span-4">
                        <label
                          htmlFor="tone-simple-clef"
                          className="block text-[10.5px] font-semibold text-[#4F473E] mb-0.5"
                        >
                          Clef
                        </label>
                        <select
                          id="tone-simple-clef"
                          value={simpleDraft.clef.trim().toLowerCase()}
                          disabled={!parsedTone.tone}
                          onChange={(e) => handleSimpleFieldChange('clef', e.target.value)}
                          className="w-full rounded border border-[#CFC3AE] bg-[#FAF6EE] px-1.5 py-1 text-[11.5px] text-[#1D1915] focus:border-[#8B1E24] focus:outline-none disabled:opacity-60"
                        >
                          {hasCustomClef && (
                            <option value={simpleDraft.clef.trim().toLowerCase()}>
                              {simpleDraft.clef.trim()}
                            </option>
                          )}
                          {TONE_CLEF_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                        {fieldErrors.clef && (
                          <p role="alert" className="mt-0.5 text-[10px] font-medium text-[#991B1B]">
                            {fieldErrors.clef}
                          </p>
                        )}
                      </div>

                      <div className="sm:col-span-3">
                        <label
                          htmlFor="tone-simple-tenor"
                          className="block text-[10.5px] font-semibold text-[#4F473E] mb-0.5"
                        >
                          Reciting note
                        </label>
                        <input
                          id="tone-simple-tenor"
                          type="text"
                          value={simpleDraft.tenor}
                          disabled={!parsedTone.tone}
                          onChange={(e) => handleSimpleFieldChange('tenor', e.target.value)}
                          aria-invalid={Boolean(fieldErrors.tenor)}
                          placeholder="h"
                          className={`w-full rounded border bg-[#FAF6EE] px-2 py-1 font-[family-name:var(--font-mono)] text-[11.5px] text-[#1D1915] focus:outline-none disabled:opacity-60 ${
                            fieldErrors.tenor
                              ? 'border-[#991B1B] focus:border-[#991B1B]'
                              : 'border-[#CFC3AE] focus:border-[#8B1E24]'
                          }`}
                        />
                        {fieldErrors.tenor && (
                          <p role="alert" className="mt-0.5 text-[10px] font-medium text-[#991B1B]">
                            {fieldErrors.tenor}
                          </p>
                        )}
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center gap-1 mb-0.5">
                        <label
                          htmlFor="tone-simple-intonation"
                          className="text-[10.5px] font-semibold text-[#4F473E]"
                        >
                          Opening notes (intonation, optional)
                        </label>
                        <span
                          tabIndex={0}
                          role="img"
                          aria-label="Help: Space-separated pitch groups sung at the beginning of a phrase or verse, e.g. f gh"
                          title="Space-separated GABC note groups sung on the opening syllables before reciting, e.g. f gh"
                          className="inline-flex h-3.5 w-3.5 cursor-help items-center justify-center rounded-full border border-[#CFC3AE] bg-[#FAF6EE] text-[9px] font-bold text-[#6B6257]"
                        >
                          ?
                        </span>
                      </div>
                      <input
                        id="tone-simple-intonation"
                        type="text"
                        value={simpleDraft.intonation}
                        disabled={!parsedTone.tone}
                        onChange={(e) => handleSimpleFieldChange('intonation', e.target.value)}
                        aria-invalid={Boolean(fieldErrors.intonation)}
                        placeholder="optional (e.g. f gh)"
                        className={`w-full rounded border bg-[#FAF6EE] px-2 py-1 font-[family-name:var(--font-mono)] text-[11.5px] text-[#1D1915] focus:outline-none disabled:opacity-60 ${
                          fieldErrors.intonation
                            ? 'border-[#991B1B] focus:border-[#991B1B]'
                            : 'border-[#CFC3AE] focus:border-[#8B1E24]'
                        }`}
                      />
                      {fieldErrors.intonation && (
                        <p role="alert" className="mt-0.5 text-[10px] font-medium text-[#991B1B]">
                          {fieldErrors.intonation}
                        </p>
                      )}
                    </div>

                    <div className="rounded border border-[#DDD3C1] bg-[#FAF6EE] divide-y divide-[#EDE5D5]">
                      {cadenceRows.map((row) => {
                        const val = simpleDraft[row.field];
                        const err = fieldErrors[row.field];
                        const inputId = `tone-simple-${row.field}`;
                        return (
                          <div key={row.field} className="px-2 py-1.5">
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="flex items-center gap-1 w-32 shrink-0">
                                <label
                                  htmlFor={inputId}
                                  className="text-[10.5px] font-semibold text-[#2A241E]"
                                >
                                  {row.label}
                                </label>
                                {row.badge && (
                                  <span className="rounded border border-[#D6CBB8] bg-[#F5EFE4] px-1 text-[9.5px] font-bold text-[#8B1E24]">
                                    {row.badge}
                                  </span>
                                )}
                                <span
                                  tabIndex={0}
                                  role="img"
                                  aria-label={`Help for ${row.label}: ${row.help}`}
                                  title={row.help}
                                  className="inline-flex h-3.5 w-3.5 shrink-0 cursor-help items-center justify-center rounded-full border border-[#CFC3AE] bg-[#F5EFE4] text-[9px] font-bold text-[#6B6257]"
                                >
                                  ?
                                </span>
                              </div>
                              <input
                                id={inputId}
                                type="text"
                                value={val}
                                disabled={!parsedTone.tone}
                                onChange={(e) => handleSimpleFieldChange(row.field, e.target.value)}
                                aria-invalid={Boolean(err)}
                                placeholder={row.placeholder}
                                spellCheck={false}
                                className={`min-w-[120px] flex-1 rounded border bg-white px-2 py-1 font-[family-name:var(--font-mono)] text-[11px] text-[#1D1915] focus:outline-none disabled:opacity-60 ${
                                  err
                                    ? 'border-[#991B1B] focus:border-[#991B1B]'
                                    : 'border-[#CFC3AE] focus:border-[#8B1E24]'
                                }`}
                              />
                              <MiniCadencePreview
                                clef={simpleDraft.clef}
                                tenor={simpleDraft.tenor}
                                spec={val}
                                label={row.label}
                              />
                            </div>
                            {err && (
                              <p role="alert" className="mt-1 text-[10px] font-medium text-[#991B1B]">
                                {err}
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div role="tabpanel" aria-label="Advanced text tone editor">
                    <label htmlFor="tone-def" className="block text-[10.5px] text-[#5C5349] mb-1">
                      Tone definition (notes are GABC letters; <code>*</code> marks the accented syllable)
                    </label>
                    <textarea
                      id="tone-def"
                      value={saved.definition}
                      onChange={(e) =>
                        update({
                          definition: e.target.value,
                          psalmTone: '',
                          readingTone: '',
                          prefaceTone: '',
                        })
                      }
                      rows={6}
                      spellCheck={false}
                      className={`${field} font-[family-name:var(--font-mono)]`}
                    />
                    {parsedTone.errors.length > 0 && (
                      <div className="mt-1 space-y-0.5 text-[10.5px] font-medium text-[#991B1B]">
                        {parsedTone.errors.map((err, i) => (
                          <p key={i}>{err}</p>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {note && (
            <p
              role="status"
              className={`mt-2 rounded border px-2.5 py-1.5 text-[11px] ${
                note.isError
                  ? 'border-[#DFC9C9] bg-[#FDF4F4] font-medium text-[#991B1B]'
                  : 'border-[#DDD3C1] bg-[#FAF6EE] text-[#4F473E]'
              }`}
            >
              {note.text}
            </p>
          )}
        </div>
      </div>
      </div>
    </aside>
  );
};
