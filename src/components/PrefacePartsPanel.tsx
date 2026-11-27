import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Code2,
  Download,
  Eye,
  EyeOff,
  FileText,
  Library,
  RotateCcw,
  Save,
  Scissors,
  Trash2,
  Upload,
  X,
  XCircle,
} from 'lucide-react';
import { ChantLanguage, PhraseBreakKey } from '@/src/types/chant';
import { parseGabc } from '@/src/lib/gabc/parser';
import { cadenceKindToLabel, PhraseCadenceChoice } from '@/src/lib/tones/pointing';
import {
  compareGabc,
  GabcComparisonResult,
  PhraseComparison,
  WordComparison,
} from '@/src/lib/tones/compareGabc';
import {
  PrefaceAssemblyChecklist,
  PrefaceBodyPhrase,
  PrefacePart,
  PrefacePartKind,
  PrefacePartStatus,
  PrefaceSplitResult,
  PrefaceWordItem,
} from '@/src/lib/tones/prefaceSplit';
import {
  getPrefaceTemplateStatus,
  PrefaceTemplate,
  PrefaceTemplateKind,
  stripGabcHeaderAndClef,
} from '@/src/lib/tones/prefaceTemplates';
import { EnglishPrefaceRole, ReadingCadenceKind } from '@/src/lib/tones/tone';
import { CadenceColorLegend, PhraseCadencePicker } from './PhraseCadencePicker';

const STATUS_BADGE: Record<PrefacePartStatus, { label: string; className: string }> = {
  'template-verified': {
    label: 'user-verified',
    className: 'border-[#9CC2A3] bg-[#E8F3EA] text-[#1E5B2D]',
  },
  'template-needs-review': {
    label: 'needs review',
    className: 'border-[#E0BE70] bg-[#FEF3C7] text-[#7A5200]',
  },
  generated: {
    label: 'Generated',
    className: 'border-[#CFC3AE] bg-[#EAE2D3] text-[#4F473E]',
  },
  'no-match': {
    label: 'No match',
    className: 'border-[#D8D0C3] bg-[#F5EFE4] text-[#7C7060]',
  },
};

const TEMPLATE_STATUS_BADGE = {
  'user-verified': {
    label: 'user-verified',
    className: 'border-[#9CC2A3] bg-[#E8F3EA] text-[#1E5B2D]',
  },
  'needs-review': {
    label: 'needs review',
    className: 'border-[#E0BE70] bg-[#FEF3C7] text-[#7A5200]',
  },
} as const;

interface ReviewTarget {
  id: string;
  label: string;
}

interface WordCardMapping {
  cardId: string;
  label: string;
}

interface PhraseTemplateDraft {
  phraseKey: number;
  id?: string;
  text: string;
  gabc: string;
}

function countParsedWordsInFragment(gabcFragment: string): number {
  const trimmed = gabcFragment.trim();
  if (!trimmed) return 0;
  const normalized = trimmed.includes('%%') ? trimmed : `%%\n(c3) ${stripGabcHeaderAndClef(trimmed)}`;
  const score = parseGabc(normalized);
  let words = 0;
  let hasSyl = false;
  for (const item of score.items) {
    if (item.kind === 'syllable') {
      hasSyl = true;
      if (item.wordEnd) {
        words += 1;
        hasSyl = false;
      }
    } else if (item.kind === 'division' || item.kind === 'clef' || item.kind === 'linebreak') {
      if (hasSyl) {
        words += 1;
        hasSyl = false;
      }
    }
  }
  if (hasSyl) words += 1;
  return words;
}

function sanitizeFixtureStem(raw: string): string {
  return (
    raw
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'preface-fixture'
  );
}

function triggerFileDownload(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function formatFixtureGabc(displayName: string, rawGabc: string, fallbackGabc: string | null): string {
  const source = (rawGabc.trim() ? rawGabc : fallbackGabc ?? '').trim();
  if (!source) return '';
  if (source.includes('%%')) {
    return `${source}\n`;
  }
  const hasLeadingClef = /^\((?:c|f)b?[1-4]\)/i.test(source);
  const bodyWithClef = hasLeadingClef ? source : `(c3) ${source}`;
  return `name: ${displayName};\ninitial-style: 1;\n%%\n${bodyWithClef}\n`;
}

export interface PrefacePartsPanelProps {
  language: ChantLanguage;
  rawText?: string;
  activeToneId?: string;
  split: PrefaceSplitResult | null;
  assembledGabc?: string | null;
  templates?: PrefaceTemplate[];
  hiddenTemplateCount?: number;
  hasQuestionCadence: boolean;
  hasCadenceOverrides: boolean;
  hasStressOverrides: boolean;
  hasMergedOrSplitBreaks?: boolean;
  markersAvailable?: boolean;
  treatLineBreaksAsPhraseBreaks?: boolean;
  checklist: PrefaceAssemblyChecklist | null;
  onToggleWordStress: (word: PrefaceWordItem) => void;
  onSelectPhraseCadence: (
    phraseKey: number,
    choice: PhraseCadenceChoice,
    defaultKind: ReadingCadenceKind | null
  ) => void;
  onRestorePhraseTemplate?: (phraseKey: number) => void;
  onChangePhraseRole?: (phraseKey: number, role: EnglishPrefaceRole | null) => void;
  onToggleTreatLineBreaksAsPhraseBreaks?: (next: boolean) => void;
  onResetCadenceOverrides: () => void;
  onResetStressOverrides: () => void;
  onResetPhraseBreaks?: () => void;
  onJoinPhrases?: (endWordIndex: number, dir: 'prev' | 'next') => void;
  onSplitMergedPhrase?: (endWordIndex: number) => void;
  onRestoreBreak?: (breakKey: PhraseBreakKey) => void;
  onSetPartRawGabc: (kind: PrefacePartKind, gabc: string | undefined) => void;
  onSetPhraseRawGabc: (phraseKey: number, gabc: string | undefined) => void;
  onSaveAsTemplate: (params: {
    id?: string;
    kind: PrefaceTemplateKind;
    text: string;
    gabc: string;
    language?: ChantLanguage;
    tone?: string;
  }) => void;
  onVerifyTemplate?: (id: string) => void;
  onDeleteTemplate?: (id: string) => void;
  onRestoreDefaultTemplates?: () => void;
  onExportTemplates: () => void;
  onImportTemplatesFile: (file: File) => void;
}

export const PrefacePartsPanel: React.FC<PrefacePartsPanelProps> = ({
  language,
  rawText = '',
  activeToneId = 'preface-solemn',
  split,
  assembledGabc = null,
  templates = [],
  hiddenTemplateCount = 0,
  hasQuestionCadence,
  hasCadenceOverrides,
  hasStressOverrides,
  hasMergedOrSplitBreaks = false,
  markersAvailable = false,
  treatLineBreaksAsPhraseBreaks = false,
  checklist,
  onToggleWordStress,
  onSelectPhraseCadence,
  onRestorePhraseTemplate,
  onChangePhraseRole,
  onToggleTreatLineBreaksAsPhraseBreaks,
  onResetCadenceOverrides,
  onResetStressOverrides,
  onResetPhraseBreaks,
  onJoinPhrases,
  onSplitMergedPhrase,
  onRestoreBreak,
  onSetPartRawGabc,
  onSetPhraseRawGabc,
  onSaveAsTemplate,
  onVerifyTemplate,
  onDeleteTemplate,
  onRestoreDefaultTemplates,
  onExportTemplates,
  onImportTemplatesFile,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [collapsed, setCollapsed] = useState<Partial<Record<PrefacePartKind, boolean>>>({});
  const [phraseListOpenOverride, setPhraseListOpenOverride] = useState<boolean | null>(null);
  const [editingPartRaw, setEditingPartRaw] = useState<Partial<Record<PrefacePartKind, boolean>>>({});
  const [editingPhraseRaw, setEditingPhraseRaw] = useState<Record<number, boolean>>({});
  const [phraseTemplateDraft, setPhraseTemplateDraft] = useState<PhraseTemplateDraft | null>(null);
  const [reviewCursor, setReviewCursor] = useState(0);
  const [highlightedTargetId, setHighlightedTargetId] = useState<string | null>(null);

  // Compare with ground truth
  const [compareOpen, setCompareOpen] = useState(false);
  const [groundTruthInput, setGroundTruthInput] = useState('');

  // Templates manager modal
  const [templatesModalOpen, setTemplatesModalOpen] = useState(false);
  const [templateFilter, setTemplateFilter] = useState<'all' | 'needs-review' | 'user-verified'>(
    'all'
  );
  const [expandedTemplateGabc, setExpandedTemplateGabc] = useState<Record<string, boolean>>({});

  // Export as test fixture
  const [fixturePopoverOpen, setFixturePopoverOpen] = useState(false);
  const [fixtureName, setFixtureName] = useState(() => `preface-${language}-custom`);

  const prevMarkersAvailRef = useRef(markersAvailable);
  if (prevMarkersAvailRef.current !== markersAvailable) {
    prevMarkersAvailRef.current = markersAvailable;
    if (phraseListOpenOverride !== null) {
      setPhraseListOpenOverride(null);
    }
  }
  const phraseListOpen =
    phraseListOpenOverride !== null ? phraseListOpenOverride : !markersAvailable;

  const reviewTargets = useMemo<ReviewTarget[]>(() => {
    if (!split) return [];
    const targets: ReviewTarget[] = [];
    for (const part of split.parts) {
      if (part.status === 'template-needs-review' || part.flagged) {
        targets.push({ id: `part-${part.kind}`, label: part.label });
      }
      if (part.kind === 'body' && part.phrases) {
        for (const ph of part.phrases) {
          if (ph.status === 'template-needs-review') {
            targets.push({ id: `phrase-${ph.endWordIndex}`, label: `Phrase ${ph.index + 1}` });
          }
          for (const w of ph.words) {
            if (w.uncertain) {
              targets.push({
                id: `word-${ph.endWordIndex}-${w.wordIndex}`,
                label: w.text,
              });
            }
          }
        }
      }
    }
    return targets;
  }, [split]);

  const jumpToCardTarget = (targetId: string) => {
    const needsBodyList = targetId.startsWith('phrase-') || targetId.startsWith('word-');
    const needsOpening = targetId === 'part-opening';
    const needsClosing = targetId === 'part-closing';
    setCollapsed((prev) => {
      const next = { ...prev };
      if (needsBodyList && next.body) next.body = false;
      if (needsOpening && next.opening) next.opening = false;
      if (needsClosing && next.closing) next.closing = false;
      return next;
    });
    if (needsBodyList) {
      setPhraseListOpenOverride(true);
    }
    setHighlightedTargetId(targetId);

    const scrollTarget = () => {
      const el = containerRef.current?.querySelector<HTMLElement>(
        `[data-review-id="${targetId}"]`
      );
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        el.focus?.();
      }
    };
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(scrollTarget);
    } else {
      scrollTarget();
    }
  };

  const jumpToReview = (delta: number) => {
    if (reviewTargets.length === 0) return;
    const nextIdx = (reviewCursor + delta + reviewTargets.length) % reviewTargets.length;
    setReviewCursor(nextIdx);
    jumpToCardTarget(reviewTargets[nextIdx].id);
  };

  // Map each generated word index from `assembledGabc` back to the owning card (`part-opening`, `phrase-<endWordIndex>`, `part-closing`)
  const wordToCardMap = useMemo<WordCardMapping[]>(() => {
    if (!split) return [];
    const map: WordCardMapping[] = [];
    for (const part of split.parts) {
      if (part.kind === 'body' && part.phrases && part.phrases.length > 0) {
        for (const ph of part.phrases) {
          const frag = ph.rawGabcOverride ?? ph.gabc;
          const count = countParsedWordsInFragment(frag);
          for (let i = 0; i < count; i++) {
            map.push({
              cardId: `phrase-${ph.endWordIndex}`,
              label: `Phrase ${ph.index + 1}`,
            });
          }
        }
      } else {
        const frag = part.rawGabcOverride ?? part.gabc;
        const count = countParsedWordsInFragment(frag);
        for (let i = 0; i < count; i++) {
          map.push({
            cardId: `part-${part.kind}`,
            label: part.label,
          });
        }
      }
    }
    return map;
  }, [split]);

  const groundTruthComparison = useMemo<GabcComparisonResult | null>(() => {
    if (!compareOpen || !groundTruthInput.trim() || !assembledGabc?.trim()) return null;
    return compareGabc(assembledGabc, groundTruthInput);
  }, [compareOpen, groundTruthInput, assembledGabc]);

  const needsReviewTemplateCount = useMemo(
    () => templates.filter((t) => getPrefaceTemplateStatus(t) === 'needs-review').length,
    [templates]
  );

  const filteredTemplates = useMemo(() => {
    if (templateFilter === 'all') return templates;
    return templates.filter((t) => getPrefaceTemplateStatus(t) === templateFilter);
  }, [templates, templateFilter]);

  const resolvePhraseCardTarget = (phrase: PhraseComparison, word?: WordComparison): WordCardMapping | null => {
    if (word && word.generatedWordIndex >= 0 && wordToCardMap[word.generatedWordIndex]) {
      return wordToCardMap[word.generatedWordIndex];
    }
    for (const w of phrase.words) {
      if (w.generatedWordIndex >= 0 && wordToCardMap[w.generatedWordIndex]) {
        return wordToCardMap[w.generatedWordIndex];
      }
    }
    if (phrase.startWordIndex >= 0 && wordToCardMap[phrase.startWordIndex]) {
      return wordToCardMap[phrase.startWordIndex];
    }
    return null;
  };

  const renderStatusBadge = (status: PrefacePartStatus, flagged?: boolean) => {
    if (flagged && status === 'generated') {
      return (
        <span className="inline-flex items-center gap-0.5 rounded border border-[#E5B84B] bg-[#FEF3C7] px-1.5 py-0.5 text-[10px] font-semibold text-[#7A5200] whitespace-nowrap">
          <AlertTriangle className="h-2.5 w-2.5" />
          Flagged
        </span>
      );
    }
    const info = STATUS_BADGE[status];
    return (
      <span
        className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap ${info.className}`}
      >
        {info.label}
      </span>
    );
  };

  const renderPhraseRow = (ph: PrefaceBodyPhrase) => {
    const phraseKey = ph.endWordIndex;
    const isEditing = Boolean(editingPhraseRaw[phraseKey]);
    const currentGabc = ph.rawGabcOverride ?? ph.gabc;
    const phraseTpl = ph.templateMatch?.template;
    const reviewTargetId = `phrase-${phraseKey}`;
    const isHighlighted = highlightedTargetId === reviewTargetId;
    const draftActive = phraseTemplateDraft?.phraseKey === phraseKey;

    const openPhraseTemplateDraft = () => {
      setPhraseTemplateDraft({
        phraseKey,
        id: phraseTpl?.id,
        text: ph.text,
        gabc: stripGabcHeaderAndClef(currentGabc),
      });
    };

    return (
      <div
        key={phraseKey}
        data-review-id={reviewTargetId}
        tabIndex={-1}
        className={`py-1.5 px-2 transition-colors focus:outline-none ${
          ph.paragraphBreak ? 'border-t-2 border-t-[#D6CBB8] pt-2' : ''
        } ${isHighlighted ? 'bg-[#FDF4DE] ring-1 ring-inset ring-[#B48327]' : ''}`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0 flex-1 flex flex-wrap items-baseline gap-y-1 font-[family-name:var(--font-serif)] text-[13px] leading-snug">
            <span className="mr-1.5 font-sans text-[10px] text-[#8A7E6D]">{ph.index + 1}.</span>
            {ph.words.map((w) => {
              const reviewId = `word-${phraseKey}-${w.wordIndex}`;
              return (
                <button
                  key={`${phraseKey}_${w.wordIndex}`}
                  type="button"
                  data-review-id={w.uncertain ? reviewId : undefined}
                  onClick={() => onToggleWordStress(w)}
                  title={
                    w.uncertain
                      ? `"${w.text}" — uncertain word/hyphenation (click to toggle stress)`
                      : `"${w.text}" — click to toggle stress`
                  }
                  className={`mr-1 inline-flex items-baseline rounded px-0.5 transition-colors focus-visible:outline-2 focus-visible:outline-[#8B1E24] ${
                    w.uncertain
                      ? 'border border-[#E5B84B] bg-[#FEF3C7] text-[#7A5200] hover:bg-[#FDE68A]'
                      : 'hover:bg-[#EAE2D3] text-[#1D1915]'
                  }`}
                >
                  {w.uncertain && (
                    <AlertTriangle
                      className="mr-0.5 h-2.5 w-2.5 shrink-0 self-center text-[#B48327]"
                      aria-hidden="true"
                    />
                  )}
                  {w.syllables.length > 0 ? (
                    w.syllables.map((s, si) => (
                      <React.Fragment key={s.globalIndex}>
                        {si > 0 && (
                          <span className="text-[#9E917B] select-none" aria-hidden="true">
                            ·
                          </span>
                        )}
                        <span
                          className={
                            s.stressed
                              ? 'font-bold text-[#8B1E24] underline decoration-[#8B1E24] decoration-2 underline-offset-2'
                              : ''
                          }
                        >
                          {s.text}
                        </span>
                      </React.Fragment>
                    ))
                  ) : (
                    <span>{w.text}</span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap shrink-0 items-center gap-1">
            {ph.merged && (
              <span
                className="rounded border border-[#C8B898] bg-[#EFE5D1] px-1.5 py-0.5 text-[9.5px] font-semibold text-[#6B4E16]"
                title={`Merged from ${ph.mergedFrom} phrases`}
              >
                merged ×{ph.mergedFrom}
              </span>
            )}
            {ph.autoJoined && (
              <span
                data-auto-joined-badge="true"
                className="rounded border border-[#B8D0B9] bg-[#E8F3EA] px-1 py-0.5 text-[9.5px] font-semibold text-[#1E5B2D]"
                title="Automatically joined short phrase"
              >
                auto
              </span>
            )}
            {ph.edited ? (
              <>
                <span
                  className="rounded border border-[#B48327] bg-[#FEF3C7] px-1.5 py-0.5 text-[9.5px] font-semibold text-[#7A5200]"
                  title="Regenerated from cadence override or manual edit (originally matched a template)"
                >
                  Edited
                </span>
                <button
                  type="button"
                  onClick={() => {
                    if (onRestorePhraseTemplate) {
                      onRestorePhraseTemplate(phraseKey);
                    } else {
                      onSelectPhraseCadence(
                        phraseKey,
                        cadenceKindToLabel(ph.defaultKind, undefined),
                        ph.defaultKind
                      );
                    }
                  }}
                  title="Clear overrides on this phrase and restore its original template notes"
                  className="inline-flex items-center gap-0.5 rounded border border-[#9CC2A3] bg-[#E8F3EA] px-1.5 py-0.5 text-[9.5px] font-semibold text-[#1E5B2D] hover:bg-white transition-colors"
                >
                  <RotateCcw className="h-2.5 w-2.5" />
                  <span>Restore template</span>
                </button>
              </>
            ) : (
              (ph.status === 'template-verified' || ph.status === 'template-needs-review') && (
                <span
                  className={`rounded border px-1.5 py-0.5 text-[9.5px] font-semibold ${
                    STATUS_BADGE[ph.status].className
                  }`}
                >
                  {ph.status === 'template-verified' ? 'user-verified' : 'needs review'}
                </span>
              )
            )}
            {language === 'en' && Boolean(treatLineBreaksAsPhraseBreaks) && onChangePhraseRole && (
              <select
                aria-label={`Phrase ${ph.index + 1} line role`}
                value={ph.roleOverridden && ph.effectiveRole ? ph.effectiveRole : 'auto'}
                onChange={(e) => {
                  const val = e.target.value;
                  onChangePhraseRole(phraseKey, val === 'auto' ? null : (val as EnglishPrefaceRole));
                }}
                title={
                  ph.defaultRole
                    ? `Line role (Auto: ${ph.defaultRole})`
                    : 'Line role'
                }
                className={`h-6 rounded border px-1.5 text-[10px] font-medium focus:border-[#8B1E24] focus:outline-none ${
                  ph.roleOverridden
                    ? 'border-[#B48327] bg-[#FEF3C7] text-[#7A5200]'
                    : 'border-[#CFC3AE] bg-[#FAF6EE] text-[#1D1915]'
                }`}
              >
                <option value="auto">Auto</option>
                <option value="h-metrum">h-metrum</option>
                <option value="g-flex">g-flex</option>
                <option value="g-long">g-long</option>
              </select>
            )}
            <PhraseCadencePicker
              phraseIndex={ph.index}
              currentChoice={ph.choiceLabel}
              defaultKind={ph.defaultKind}
              overridden={ph.overridden}
              isEnglishPreface={language === 'en'}
              hasQuestionCadence={hasQuestionCadence}
              onSelectChoice={(_idx, choice, defKind) =>
                onSelectPhraseCadence(phraseKey, choice, defKind)
              }
            />
            {onJoinPhrases && (
              <>
                <button
                  type="button"
                  disabled={!ph.canJoinPrev}
                  onClick={() => onJoinPhrases(phraseKey, 'prev')}
                  title="Join with previous phrase"
                  className="rounded border border-[#CFC3AE] bg-[#F5EFE4] px-1.5 py-0.5 text-[10px] font-medium text-[#4F473E] hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Join prev
                </button>
                <button
                  type="button"
                  disabled={!ph.canJoinNext}
                  onClick={() => onJoinPhrases(phraseKey, 'next')}
                  title="Join with next phrase"
                  className="rounded border border-[#CFC3AE] bg-[#F5EFE4] px-1.5 py-0.5 text-[10px] font-medium text-[#4F473E] hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Join next
                </button>
              </>
            )}
            {ph.merged && onSplitMergedPhrase && (
              <button
                type="button"
                onClick={() => onSplitMergedPhrase(phraseKey)}
                title={`Split into ${ph.mergedFrom} phrases`}
                className="inline-flex items-center gap-0.5 rounded border border-[#CFC3AE] bg-[#F5EFE4] px-1.5 py-0.5 text-[10px] font-medium text-[#4F473E] hover:bg-white"
              >
                <Scissors className="h-2.5 w-2.5" />
                <span>Split</span>
              </button>
            )}
            <button
              type="button"
              onClick={() =>
                setEditingPhraseRaw((prev) => ({ ...prev, [phraseKey]: !prev[phraseKey] }))
              }
              title="Edit phrase raw GABC"
              aria-expanded={isEditing}
              className={`inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
                isEditing || ph.rawGabcOverride !== undefined
                  ? 'border-[#8B1E24] bg-[#FBF2F2] text-[#8B1E24]'
                  : 'border-[#CFC3AE] bg-[#F5EFE4] text-[#4F473E] hover:bg-white'
              }`}
            >
              <Code2 className="h-2.5 w-2.5" />
              <span>GABC</span>
            </button>
          </div>
        </div>

        {ph.internalMergedBreaks.length > 0 && onRestoreBreak && (
          <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px] text-[#6B6257]">
            <span>Restore break:</span>
            {ph.internalMergedBreaks.map((bk) => (
              <button
                key={`${bk.endWordIndex}_${bk.wordText}`}
                type="button"
                onClick={() => onRestoreBreak(bk)}
                className="inline-flex items-center gap-0.5 rounded border border-[#CFC3AE] bg-[#F5EFE4] px-1.5 py-0 text-[10px] font-medium text-[#4F473E] hover:bg-white hover:text-[#1D1915]"
              >
                <span>+ after "{bk.wordText}"</span>
              </button>
            ))}
          </div>
        )}

        {isEditing && (
          <div className="mt-1.5 rounded border border-[#DDD3C1] bg-[#F5EFE4] p-2">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
              <span className="text-[10px] font-semibold text-[#5C5349]">
                Raw phrase GABC (no header/clef)
              </span>
              <div className="flex flex-wrap items-center gap-1.5">
                {ph.rawGabcOverride !== undefined && (
                  <button
                    type="button"
                    onClick={() => onSetPhraseRawGabc(phraseKey, undefined)}
                    className="inline-flex items-center gap-0.5 rounded border border-[#CFC3AE] bg-[#FAF6EE] px-1.5 py-0.5 text-[10px] text-[#4F473E] hover:bg-white"
                  >
                    <RotateCcw className="h-2.5 w-2.5" />
                    <span>Reset</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() =>
                    draftActive ? setPhraseTemplateDraft(null) : openPhraseTemplateDraft()
                  }
                  className="inline-flex items-center gap-1 rounded border border-[#72171B] bg-[#8B1E24] px-2 py-0.5 text-[10px] font-semibold text-[#FAF6EE] hover:bg-[#A1252B]"
                >
                  <Save className="h-2.5 w-2.5" />
                  <span>Save this phrase as a template</span>
                </button>
              </div>
            </div>
            <input
              type="text"
              value={currentGabc}
              onChange={(e) => {
                const nextVal = e.target.value;
                onSetPhraseRawGabc(phraseKey, nextVal);
                if (phraseTemplateDraft?.phraseKey === phraseKey) {
                  setPhraseTemplateDraft((prev) =>
                    prev ? { ...prev, gabc: stripGabcHeaderAndClef(nextVal) } : null
                  );
                }
              }}
              spellCheck={false}
              aria-label={`Phrase ${ph.index + 1} raw GABC`}
              className="w-full rounded border border-[#CFC3AE] bg-[#FAF6EE] px-2 py-1 font-[family-name:var(--font-mono)] text-[11px] text-[#1D1915] focus:border-[#8B1E24] focus:outline-none"
            />

            {draftActive && phraseTemplateDraft && (
              <div
                className="mt-2 rounded border border-[#C8B898] bg-[#FAF6EE] p-2 space-y-1.5"
                aria-label="Save phrase template form"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[10.5px] font-semibold text-[#1D1915]">
                    Save phrase template ({language.toUpperCase()} · {activeToneId})
                  </span>
                  <span
                    className={`rounded border px-1.5 py-0.5 text-[9.5px] font-semibold ${
                      TEMPLATE_STATUS_BADGE['user-verified'].className
                    }`}
                  >
                    {TEMPLATE_STATUS_BADGE['user-verified'].label}
                  </span>
                </div>
                <div>
                  <label className="block text-[9.5px] font-semibold text-[#5C5349] mb-0.5">
                    Phrase text
                  </label>
                  <input
                    type="text"
                    value={phraseTemplateDraft.text}
                    onChange={(e) =>
                      setPhraseTemplateDraft((prev) =>
                        prev ? { ...prev, text: e.target.value } : null
                      )
                    }
                    className="w-full rounded border border-[#CFC3AE] bg-white px-2 py-1 text-[11px] text-[#1D1915] focus:border-[#8B1E24] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[9.5px] font-semibold text-[#5C5349] mb-0.5">
                    Template GABC (without header/clef)
                  </label>
                  <input
                    type="text"
                    value={phraseTemplateDraft.gabc}
                    onChange={(e) =>
                      setPhraseTemplateDraft((prev) =>
                        prev ? { ...prev, gabc: e.target.value } : null
                      )
                    }
                    spellCheck={false}
                    className="w-full rounded border border-[#CFC3AE] bg-white px-2 py-1 font-[family-name:var(--font-mono)] text-[11px] text-[#1D1915] focus:border-[#8B1E24] focus:outline-none"
                  />
                </div>
                <div className="flex items-center justify-end gap-1.5 pt-0.5">
                  <button
                    type="button"
                    onClick={() => setPhraseTemplateDraft(null)}
                    className="rounded border border-[#CFC3AE] bg-[#F5EFE4] px-2 py-0.5 text-[10px] font-medium text-[#4F473E] hover:bg-white"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={!phraseTemplateDraft.text.trim() || !phraseTemplateDraft.gabc.trim()}
                    onClick={() => {
                      onSaveAsTemplate({
                        id: phraseTemplateDraft.id,
                        kind: 'phrase',
                        text: phraseTemplateDraft.text,
                        gabc: phraseTemplateDraft.gabc,
                        language,
                        tone: activeToneId,
                      });
                      setPhraseTemplateDraft(null);
                    }}
                    className="inline-flex items-center gap-1 rounded border border-[#72171B] bg-[#8B1E24] px-2.5 py-0.5 text-[10px] font-semibold text-[#FAF6EE] hover:bg-[#A1252B] disabled:opacity-40"
                  >
                    <Save className="h-2.5 w-2.5" />
                    <span>Save template</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderPartCard = (part: PrefacePart) => {
    const isCollapsed = Boolean(collapsed[part.kind]);
    const isEditingRaw = Boolean(editingPartRaw[part.kind]);
    const currentGabc = part.rawGabcOverride ?? part.gabc;
    const isFormula = part.kind === 'opening' || part.kind === 'closing';
    const partReviewId = `part-${part.kind}`;
    const isHighlighted = highlightedTargetId === partReviewId;

    return (
      <div
        key={part.kind}
        data-review-id={partReviewId}
        tabIndex={-1}
        className={`rounded border bg-[#FAF6EE] focus:outline-none ${
          isHighlighted ? 'border-[#B48327] ring-1 ring-[#B48327]' : 'border-[#D6CBB8]'
        }`}
      >
        <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 bg-[#F5EFE4] rounded-t">
          <button
            type="button"
            aria-expanded={!isCollapsed}
            onClick={() => setCollapsed((prev) => ({ ...prev, [part.kind]: !prev[part.kind] }))}
            className="flex min-w-0 flex-1 items-center gap-1.5 text-left font-semibold text-[#1D1915]"
          >
            {isCollapsed ? (
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[#8B1E24]" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[#8B1E24]" />
            )}
            <span className="truncate">{part.label}</span>
            {part.kind === 'body' && part.phrases && part.phrases.length > 0 && (
              <span className="text-[10px] font-normal text-[#6B6257]">
                ({part.phrases.length} phrases)
              </span>
            )}
          </button>

          <div className="flex items-center gap-1.5 shrink-0">
            {renderStatusBadge(part.status, part.flagged)}
            {(part.status !== 'no-match' || part.rawGabcOverride !== undefined) && (
              <button
                type="button"
                onClick={() =>
                  setEditingPartRaw((prev) => ({ ...prev, [part.kind]: !prev[part.kind] }))
                }
                aria-expanded={isEditingRaw}
                className={`inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
                  isEditingRaw || part.rawGabcOverride !== undefined
                    ? 'border-[#8B1E24] bg-[#FBF2F2] text-[#8B1E24]'
                    : 'border-[#CFC3AE] bg-[#FAF6EE] text-[#4F473E] hover:bg-white'
                }`}
              >
                <Code2 className="h-2.5 w-2.5" />
                <span>Edit GABC</span>
              </button>
            )}
          </div>
        </div>

        {!isCollapsed && (
          <div className="border-t border-[#E6DEC8]">
            {part.flagReason && (
              <div className="flex items-start gap-1.5 border-b border-[#EFE3BA] bg-[#FFFBEB] px-2.5 py-1.5 text-[10.5px] text-[#7A5200]">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-[#B48327]" />
                <span>{part.flagReason}</span>
              </div>
            )}

            {part.diff && part.diff.length > 0 && (
              <div
                className="border-b border-[#EDE5D5] bg-[#FDFBF6] px-2.5 py-1.5 text-[11px]"
                aria-label={`${part.label} template diff`}
              >
                <span className="mr-1.5 text-[10px] font-semibold uppercase tracking-wide text-[#6B6257]">
                  Diff vs template:
                </span>
                <span className="font-[family-name:var(--font-serif)] text-[12px] leading-relaxed">
                  {part.diff.map((tok, i) => {
                    if (tok.type === 'equal') {
                      return (
                        <span key={i} className="mr-1 text-[#2A241E]">
                          {tok.word}
                        </span>
                      );
                    }
                    if (tok.type === 'delete') {
                      return (
                        <del
                          key={i}
                          className="mr-1 rounded bg-[#FEE2E2] px-0.5 text-[#991B1B]"
                        >
                          {tok.word}
                        </del>
                      );
                    }
                    return (
                      <ins
                        key={i}
                        className="mr-1 rounded bg-[#FEF3C7] px-0.5 font-semibold text-[#7A5200] no-underline"
                      >
                        +{tok.word}
                      </ins>
                    );
                  })}
                </span>
              </div>
            )}

            {part.kind === 'body' ? (
              part.phrases && part.phrases.length > 0 ? (
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#EDE5D5] px-2 py-1">
                    <button
                      type="button"
                      aria-expanded={phraseListOpen}
                      onClick={() => setPhraseListOpenOverride(!phraseListOpen)}
                      className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-[#4F473E] hover:text-[#1D1915]"
                    >
                      {phraseListOpen ? (
                        <ChevronDown className="h-3 w-3 text-[#8B1E24]" />
                      ) : (
                        <ChevronRight className="h-3 w-3 text-[#8B1E24]" />
                      )}
                      <span>Phrase list ({part.phrases.length})</span>
                    </button>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {hasCadenceOverrides && (
                        <button
                          type="button"
                          onClick={onResetCadenceOverrides}
                          className="inline-flex items-center gap-1 rounded border border-[#CFC3AE] bg-[#F5EFE4] px-1.5 py-0.5 text-[10px] font-medium text-[#4F473E] hover:bg-white hover:text-[#1D1915]"
                        >
                          <RotateCcw className="h-2.5 w-2.5" />
                          <span>Reset terminations</span>
                        </button>
                      )}
                      {hasMergedOrSplitBreaks && onResetPhraseBreaks && (
                        <button
                          type="button"
                          onClick={onResetPhraseBreaks}
                          className="inline-flex items-center gap-1 rounded border border-[#CFC3AE] bg-[#F5EFE4] px-1.5 py-0.5 text-[10px] font-medium text-[#4F473E] hover:bg-white hover:text-[#1D1915]"
                        >
                          <RotateCcw className="h-2.5 w-2.5" />
                          <span>Reset phrases</span>
                        </button>
                      )}
                    </div>
                  </div>
                  {phraseListOpen && (
                    <>
                      <div className="border-b border-[#EDE5D5] px-2 pt-1.5 pb-0.5">
                        <CadenceColorLegend />
                      </div>
                      <div className="divide-y divide-[#EDE5D5]">
                        {part.phrases.map(renderPhraseRow)}
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <p className="px-2.5 py-2 text-[11px] text-[#7C7060]">
                  No proper body phrases detected.
                </p>
              )
            ) : part.status === 'no-match' ? (
              <p className="px-2.5 py-1.5 text-[11px] text-[#7C7060]">
                No matching {part.kind} template found.
              </p>
            ) : (
              <p className="px-2.5 py-1.5 whitespace-pre-line font-[family-name:var(--font-serif)] text-[12px] text-[#2A241E]">
                {part.text}
              </p>
            )}

            {isEditingRaw && (
              <div className="border-t border-[#E6DEC8] bg-[#F5EFE4] p-2">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-[10px] font-semibold text-[#5C5349]">
                    Raw {part.label.toLowerCase()} GABC (without header or clef)
                  </span>
                  <div className="flex items-center gap-1.5">
                    {part.rawGabcOverride !== undefined && (
                      <button
                        type="button"
                        onClick={() => onSetPartRawGabc(part.kind, undefined)}
                        className="inline-flex items-center gap-0.5 rounded border border-[#CFC3AE] bg-[#FAF6EE] px-1.5 py-0.5 text-[10px] text-[#4F473E] hover:bg-white"
                      >
                        <RotateCcw className="h-2.5 w-2.5" />
                        <span>Reset</span>
                      </button>
                    )}
                    {isFormula && part.text.trim() && (
                      <button
                        type="button"
                        onClick={() =>
                          onSaveAsTemplate({
                            id: part.matchedTemplateId,
                            kind: part.kind as PrefaceTemplateKind,
                            text: part.text,
                            gabc: currentGabc,
                          })
                        }
                        className="inline-flex items-center gap-1 rounded border border-[#72171B] bg-[#8B1E24] px-2 py-0.5 text-[10px] font-semibold text-[#FAF6EE] hover:bg-[#A1252B]"
                      >
                        <Save className="h-2.5 w-2.5" />
                        <span>Save as template</span>
                      </button>
                    )}
                  </div>
                </div>
                <textarea
                  rows={3}
                  value={currentGabc}
                  onChange={(e) => onSetPartRawGabc(part.kind, e.target.value)}
                  spellCheck={false}
                  aria-label={`${part.label} raw GABC`}
                  className="w-full rounded border border-[#CFC3AE] bg-[#FAF6EE] p-1.5 font-[family-name:var(--font-mono)] text-[11px] text-[#1D1915] focus:border-[#8B1E24] focus:outline-none"
                />
              </div>
            )}

            {!isEditingRaw && isFormula && part.status === 'template-needs-review' && part.text.trim() && (
              <div className="flex justify-end border-t border-[#EDE5D5] bg-[#FBF8F1] px-2.5 py-1">
                <button
                  type="button"
                  onClick={() =>
                    onSaveAsTemplate({
                      id: part.matchedTemplateId,
                      kind: part.kind as PrefaceTemplateKind,
                      text: part.text,
                      gabc: currentGabc,
                    })
                  }
                  className="inline-flex items-center gap-1 rounded border border-[#72171B] bg-[#8B1E24] px-2 py-0.5 text-[10px] font-semibold text-[#FAF6EE] hover:bg-[#A1252B]"
                >
                  <Save className="h-2.5 w-2.5" />
                  <span>Mark verified & save as template</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const canExportFixture = rawText.trim().length > 0 && Boolean(groundTruthInput.trim() || assembledGabc?.trim());

  const handleDownloadFixture = () => {
    if (!canExportFixture) return;
    const stem = sanitizeFixtureStem(fixtureName);
    const txtContent = `${rawText.trimEnd()}\n`;
    const gabcContent = formatFixtureGabc(stem, groundTruthInput, assembledGabc);
    triggerFileDownload(`${stem}.txt`, txtContent, 'text/plain;charset=utf-8');
    if (gabcContent) {
      triggerFileDownload(`${stem}.gabc`, gabcContent, 'text/plain;charset=utf-8');
    }
    setFixturePopoverOpen(false);
  };

  return (
    <div ref={containerRef} className="mt-2 space-y-2" aria-label="Preface parts">
      {/* Controls bar: Latin line-break toggle + Needs review jump + Reset + Templates manager & Fixture export */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-[#D6CBB8] bg-[#F5EFE4] px-2.5 py-1.5">
        <div className="flex items-center gap-2">
          {onToggleTreatLineBreaksAsPhraseBreaks && (
            <label className="inline-flex items-center gap-1.5 text-[10.5px] font-medium text-[#3F3830] select-none cursor-pointer">
              <input
                type="checkbox"
                checked={Boolean(treatLineBreaksAsPhraseBreaks)}
                onChange={(e) => onToggleTreatLineBreaksAsPhraseBreaks(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-[#CFC3AE] accent-[#8B1E24]"
              />
              <span>Treat line breaks as phrase breaks</span>
            </label>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {reviewTargets.length > 0 && (
            <div className="inline-flex items-center gap-1 rounded border border-[#E5B84B] bg-[#FEF3C7] px-1.5 py-0.5 text-[10px] font-semibold text-[#7A5200]">
              <AlertTriangle className="h-3 w-3" />
              <span>Needs review ({reviewTargets.length})</span>
              <button
                type="button"
                onClick={() => jumpToReview(-1)}
                title="Previous item needing review"
                aria-label="Previous item needing review"
                className="ml-0.5 rounded hover:bg-[#FDE68A] p-0.5"
              >
                <ChevronLeft className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={() => jumpToReview(1)}
                title="Next item needing review"
                aria-label="Next item needing review"
                className="rounded hover:bg-[#FDE68A] p-0.5"
              >
                <ChevronRight className="h-3 w-3" />
              </button>
            </div>
          )}

          {hasCadenceOverrides && (
            <button
              type="button"
              onClick={onResetCadenceOverrides}
              className="inline-flex items-center gap-1 rounded border border-[#CFC3AE] bg-[#FAF6EE] px-1.5 py-0.5 text-[10px] font-medium text-[#4F473E] hover:bg-white"
            >
              <RotateCcw className="h-2.5 w-2.5" />
              <span>Reset terminations</span>
            </button>
          )}

          {hasMergedOrSplitBreaks && onResetPhraseBreaks && (
            <button
              type="button"
              onClick={onResetPhraseBreaks}
              className="inline-flex items-center gap-1 rounded border border-[#CFC3AE] bg-[#FAF6EE] px-1.5 py-0.5 text-[10px] font-medium text-[#4F473E] hover:bg-white"
            >
              <RotateCcw className="h-2.5 w-2.5" />
              <span>Reset phrases</span>
            </button>
          )}

          {hasStressOverrides && (
            <button
              type="button"
              onClick={onResetStressOverrides}
              className="inline-flex items-center gap-1 rounded border border-[#CFC3AE] bg-[#FAF6EE] px-1.5 py-0.5 text-[10px] font-medium text-[#4F473E] hover:bg-white"
            >
              <RotateCcw className="h-2.5 w-2.5" />
              <span>Reset stress</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setTemplatesModalOpen(true)}
            title="Manage preface templates (view, verify, delete, export, import)"
            className="inline-flex items-center gap-1 rounded border border-[#CFC3AE] bg-[#FAF6EE] px-1.5 py-0.5 text-[10px] font-medium text-[#4F473E] hover:bg-white"
          >
            <Library className="h-2.5 w-2.5 text-[#8B1E24]" />
            <span>Templates ({templates.length})</span>
            {needsReviewTemplateCount > 0 && (
              <span className="rounded bg-[#FEF3C7] px-1 text-[9.5px] font-semibold text-[#7A5200]">
                {needsReviewTemplateCount} review
              </span>
            )}
          </button>

          <button
            type="button"
            disabled={!canExportFixture}
            onClick={() => setFixturePopoverOpen((prev) => !prev)}
            title="Download preface text (.txt) and ground-truth GABC (.gabc) as a test fixture"
            className="inline-flex items-center gap-1 rounded border border-[#CFC3AE] bg-[#FAF6EE] px-1.5 py-0.5 text-[10px] font-medium text-[#4F473E] hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <FileText className="h-2.5 w-2.5 text-[#8B1E24]" />
            <span>Export as test fixture</span>
          </button>

          <button
            type="button"
            onClick={onExportTemplates}
            title="Export preface templates as JSON"
            className="inline-flex items-center gap-1 rounded border border-[#CFC3AE] bg-[#FAF6EE] px-1.5 py-0.5 text-[10px] font-medium text-[#4F473E] hover:bg-white"
          >
            <Download className="h-2.5 w-2.5" />
            <span>Export JSON</span>
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            title="Import preface templates from JSON"
            className="inline-flex items-center gap-1 rounded border border-[#CFC3AE] bg-[#FAF6EE] px-1.5 py-0.5 text-[10px] font-medium text-[#4F473E] hover:bg-white"
          >
            <Upload className="h-2.5 w-2.5" />
            <span>Import JSON</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onImportTemplatesFile(file);
              e.target.value = '';
            }}
          />
        </div>
      </div>

      {/* Inline "Export as test fixture" prompt bar */}
      {fixturePopoverOpen && (
        <div
          className="rounded border border-[#C8B898] bg-[#FAF6EE] px-2.5 py-2 space-y-1.5"
          aria-label="Export as test fixture"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10.5px] font-semibold text-[#1D1915]">
              Export test fixture (<span className="font-[family-name:var(--font-mono)]">&lt;name&gt;.txt</span> +{' '}
              <span className="font-[family-name:var(--font-mono)]">&lt;name&gt;.gabc</span>)
            </span>
            <button
              type="button"
              onClick={() => setFixturePopoverOpen(false)}
              aria-label="Close fixture export"
              className="rounded p-0.5 text-[#6B6257] hover:bg-[#EAE2D3]"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={fixtureName}
              onChange={(e) => setFixtureName(e.target.value)}
              placeholder={`preface-${language}-custom`}
              aria-label="Fixture name"
              className="min-w-[180px] flex-1 rounded border border-[#CFC3AE] bg-white px-2 py-1 font-[family-name:var(--font-mono)] text-[11px] text-[#1D1915] focus:border-[#8B1E24] focus:outline-none"
            />
            <span className="text-[10px] text-[#6B6257]">
              GABC source: {groundTruthInput.trim() ? 'pasted ground truth' : 'current assembled output'}
            </span>
            <button
              type="button"
              onClick={handleDownloadFixture}
              disabled={!canExportFixture}
              className="inline-flex items-center gap-1 rounded border border-[#72171B] bg-[#8B1E24] px-2.5 py-1 text-[10.5px] font-semibold text-[#FAF6EE] hover:bg-[#A1252B] disabled:opacity-40"
            >
              <Download className="h-3 w-3" />
              <span>Download .txt &amp; .gabc</span>
            </button>
          </div>
        </div>
      )}

      {/* Collapsible cards per part */}
      {split && (
        <div className="space-y-1.5">
          {split.parts.map(renderPartCard)}
        </div>
      )}

      {/* Collapsible "Compare with ground truth" section */}
      <div className="rounded border border-[#D6CBB8] bg-[#FAF6EE]" aria-label="Compare with ground truth">
        <div className="flex items-center justify-between gap-2 bg-[#F5EFE4] px-2.5 py-1.5 rounded-t">
          <button
            type="button"
            aria-expanded={compareOpen}
            onClick={() => setCompareOpen((prev) => !prev)}
            className="flex min-w-0 flex-1 items-center gap-1.5 text-left font-semibold text-[#1D1915]"
          >
            {compareOpen ? (
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[#8B1E24]" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[#8B1E24]" />
            )}
            <span>Compare with ground truth</span>
            {groundTruthComparison && (
              <span className="ml-1 rounded border border-[#CFC3AE] bg-[#FAF6EE] px-1.5 py-0 text-[10px] font-semibold text-[#4F473E]">
                {groundTruthComparison.totals.summary}
              </span>
            )}
          </button>
          {compareOpen && groundTruthInput && (
            <button
              type="button"
              onClick={() => setGroundTruthInput('')}
              className="rounded border border-[#CFC3AE] bg-[#FAF6EE] px-1.5 py-0.5 text-[10px] text-[#4F473E] hover:bg-white"
            >
              Clear
            </button>
          )}
        </div>

        {compareOpen && (
          <div className="border-t border-[#E6DEC8] p-2.5 space-y-2">
            <div>
              <label
                htmlFor="ground-truth-gabc-input"
                className="block text-[10.5px] font-medium text-[#5C5349] mb-1"
              >
                Paste known-good GABC for the whole preface (click any mismatch below to jump to its card):
              </label>
              <textarea
                id="ground-truth-gabc-input"
                rows={4}
                value={groundTruthInput}
                onChange={(e) => setGroundTruthInput(e.target.value)}
                spellCheck={false}
                placeholder="name: ...;\n%%\n(c3) It(f) is(h) tru(h)ly..."
                className="w-full rounded border border-[#CFC3AE] bg-white p-1.5 font-[family-name:var(--font-mono)] text-[11px] text-[#1D1915] focus:border-[#8B1E24] focus:outline-none"
              />
            </div>

            {!assembledGabc?.trim() && (
              <p className="text-[11px] text-[#7C7060]">
                Paste preface text above to generate GABC before comparing.
              </p>
            )}

            {groundTruthComparison && (
              <div className="space-y-2">
                {/* Summary bar */}
                <div className="flex flex-wrap items-center gap-1.5 rounded border border-[#D6CBB8] bg-[#F5EFE4] px-2.5 py-1.5 text-[11px]">
                  <span className="font-semibold text-[#1D1915]">
                    {groundTruthComparison.totals.summary}
                  </span>
                  <span className="text-[#6B6257]">
                    ({Math.round(groundTruthComparison.totals.matchRatio * 100)}%)
                  </span>
                  {groundTruthComparison.totals.pitchMismatches > 0 && (
                    <span className="rounded border border-[#E5A0A0] bg-[#FEE2E2] px-1.5 py-0.5 text-[10px] font-semibold text-[#991B1B]">
                      {groundTruthComparison.totals.pitchMismatches} pitch diff
                      {groundTruthComparison.totals.pitchMismatches === 1 ? '' : 's'}
                    </span>
                  )}
                  {groundTruthComparison.totals.splitMismatches > 0 && (
                    <span className="rounded border border-[#E0BE70] bg-[#FEF3C7] px-1.5 py-0.5 text-[10px] font-semibold text-[#7A5200]">
                      {groundTruthComparison.totals.splitMismatches} syllable-split mismatch
                      {groundTruthComparison.totals.splitMismatches === 1 ? '' : 'es'}
                    </span>
                  )}
                  {groundTruthComparison.totals.divisionMismatches > 0 && (
                    <span className="rounded border border-[#CFC3AE] bg-[#EAE2D3] px-1.5 py-0.5 text-[10px] font-medium text-[#4F473E]">
                      {groundTruthComparison.totals.divisionMismatches} bar diff
                      {groundTruthComparison.totals.divisionMismatches === 1 ? '' : 's'}
                    </span>
                  )}
                  {(groundTruthComparison.totals.missingSyllables > 0 ||
                    groundTruthComparison.totals.extraSyllables > 0) && (
                    <span className="rounded border border-[#D8D0C3] bg-white px-1.5 py-0.5 text-[10px] text-[#5C5349]">
                      {groundTruthComparison.totals.missingSyllables > 0 &&
                        `${groundTruthComparison.totals.missingSyllables} missing`}
                      {groundTruthComparison.totals.missingSyllables > 0 &&
                        groundTruthComparison.totals.extraSyllables > 0 &&
                        ' · '}
                      {groundTruthComparison.totals.extraSyllables > 0 &&
                        `${groundTruthComparison.totals.extraSyllables} extra`}
                    </span>
                  )}
                </div>

                {/* Per-phrase breakdown */}
                <div className="max-h-72 overflow-y-auto divide-y divide-[#EDE5D5] rounded border border-[#D6CBB8] bg-white">
                  {groundTruthComparison.phrases.map((phrase) => {
                    const phraseTarget = resolvePhraseCardTarget(phrase);
                    return (
                      <div key={phrase.phraseIndex} className="px-2.5 py-2 space-y-1">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-[#6B6257]">
                          <span className="font-semibold text-[#3F3830]">
                            Phrase {phrase.phraseIndex + 1} · {phrase.matchedSyllables}/
                            {phrase.totalSyllables} match
                            {phraseTarget ? ` (${phraseTarget.label})` : ''}
                          </span>
                          {phrase.divisionMismatch && (
                            <span className="rounded border border-[#E0BE70] bg-[#FEF3C7] px-1.5 py-0 text-[9.5px] font-semibold text-[#7A5200]">
                              Bar: got ({phrase.generatedDivision ?? 'none'}) vs exp (
                              {phrase.expectedDivision ?? 'none'})
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-1 leading-relaxed">
                          {phrase.words.map((word, wIdx) => {
                            const target = resolvePhraseCardTarget(phrase, word);
                            if (word.status === 'split-mismatch') {
                              const genSplit = (word.generatedSyllableBreakdown ?? [])
                                .map((s) => `${s.text}(${s.notes})`)
                                .join('·');
                              const expSplit = (word.expectedSyllableBreakdown ?? [])
                                .map((s) => `${s.text}(${s.notes})`)
                                .join('·');
                              return (
                                <button
                                  key={`${word.generatedWordIndex}_${word.expectedWordIndex}_${wIdx}`}
                                  type="button"
                                  onClick={() => target && jumpToCardTarget(target.cardId)}
                                  title={`Syllable-split mismatch on "${word.generatedText}"${
                                    target ? ` — click to jump to ${target.label}` : ''
                                  }`}
                                  className="inline-flex flex-wrap items-center gap-1 rounded border border-[#E0BE70] bg-[#FEF3C7] px-1.5 py-0.5 text-[10.5px] text-[#7A5200] hover:bg-[#FDE68A] cursor-pointer"
                                >
                                  <span className="font-semibold">split:</span>
                                  <span className="font-[family-name:var(--font-mono)]">
                                    got {genSplit || word.generatedText}
                                  </span>
                                  <span>vs</span>
                                  <span className="font-[family-name:var(--font-mono)]">
                                    exp {expSplit || word.expectedText}
                                  </span>
                                </button>
                              );
                            }

                            if (word.status === 'missing') {
                              return (
                                <button
                                  key={`missing_${word.expectedWordIndex}_${wIdx}`}
                                  type="button"
                                  onClick={() => target && jumpToCardTarget(target.cardId)}
                                  className="inline-flex items-center gap-1 rounded border border-dashed border-[#E5A0A0] bg-[#FEF2F2] px-1.5 py-0.5 text-[10.5px] text-[#991B1B] hover:bg-[#FEE2E2]"
                                >
                                  missing "{word.expectedText}"
                                </button>
                              );
                            }

                            if (word.status === 'extra') {
                              return (
                                <button
                                  key={`extra_${word.generatedWordIndex}_${wIdx}`}
                                  type="button"
                                  onClick={() => target && jumpToCardTarget(target.cardId)}
                                  className="inline-flex items-center gap-1 rounded border border-dashed border-[#CFC3AE] bg-[#F5EFE4] px-1.5 py-0.5 text-[10.5px] text-[#5C5349] hover:bg-[#EAE2D3]"
                                >
                                  extra "{word.generatedText}"
                                </button>
                              );
                            }

                            return (
                              <span
                                key={`${word.generatedWordIndex}_${word.expectedWordIndex}_${wIdx}`}
                                className="inline-flex items-center gap-0.5 mr-1"
                              >
                                {word.syllables.map((syl, sIdx) => {
                                  if (syl.status === 'match') {
                                    return (
                                      <span
                                        key={sIdx}
                                        className="rounded border border-[#B8D0B9] bg-[#E8F3EA] px-1 py-0.5 text-[11px] text-[#1E5B2D]"
                                        title={`Match (${syl.generatedNotes})`}
                                      >
                                        {syl.text}
                                      </span>
                                    );
                                  }
                                  return (
                                    <button
                                      key={sIdx}
                                      type="button"
                                      onClick={() => target && jumpToCardTarget(target.cardId)}
                                      title={
                                        target
                                          ? `Pitch mismatch: got (${syl.generatedNotes}), expected (${syl.expectedNotes}) — click to jump to ${target.label}`
                                          : `Pitch mismatch: got (${syl.generatedNotes}), expected (${syl.expectedNotes})`
                                      }
                                      className="inline-flex items-center gap-0.5 rounded border border-[#E5A0A0] bg-[#FEE2E2] px-1 py-0.5 text-[11px] font-semibold text-[#991B1B] hover:bg-[#FECACA] cursor-pointer"
                                    >
                                      <span>{syl.text}</span>
                                      <span className="font-[family-name:var(--font-mono)] text-[9.5px]">
                                        ({syl.generatedNotes}→{syl.expectedNotes})
                                      </span>
                                    </button>
                                  );
                                })}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Final checklist after assembly */}
      {checklist && (
        <div
          className="rounded border border-[#D6CBB8] bg-[#FAF6EE] px-2.5 py-1.5"
          aria-label="Preface assembly checklist"
        >
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[#6B6257]">
            Assembly checklist
          </div>
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
            <li className="flex items-center gap-1.5">
              {checklist.everyPhraseHasCadence ? (
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[#1E5B2D]" />
              ) : (
                <XCircle className="h-3.5 w-3.5 shrink-0 text-[#991B1B]" />
              )}
              <span>
                Every phrase ends in a cadence
                {!checklist.everyPhraseHasCadence &&
                  ` (missing on phrase ${checklist.phrasesWithoutCadence.map((n) => n + 1).join(', ')})`}
              </span>
            </li>
            <li className="flex items-center gap-1.5">
              {checklist.noFinalFunctionWordAccent ? (
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[#1E5B2D]" />
              ) : (
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-[#B48327]" />
              )}
              <span>
                No final unstressed function-word accent
                {!checklist.noFinalFunctionWordAccent &&
                  ` (${checklist.functionWordAccentPhrases
                    .map((p) => `#${p.phraseIndex + 1} "${p.word}"`)
                    .join(', ')})`}
              </span>
            </li>
            <li className="flex items-center gap-1.5">
              {checklist.everyTemplateUsedVerbatim ? (
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[#1E5B2D]" />
              ) : (
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-[#B48327]" />
              )}
              <span>Every template part was used verbatim</span>
            </li>
            <li className="flex items-center gap-1.5">
              {checklist.unverifiedTemplateCount === 0 ? (
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[#1E5B2D]" />
              ) : (
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-[#B48327]" />
              )}
              <span>
                Unverified template parts: <strong>{checklist.unverifiedTemplateCount}</strong>
              </span>
            </li>
          </ul>
        </div>
      )}

      {/* Templates manager modal */}
      {templatesModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Preface templates manager"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        >
          <div className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-lg border border-[#C8B898] bg-[#FAF6EE] shadow-xl">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#DDD3C1] bg-[#EAE2D3] px-4 py-2.5 rounded-t-lg">
              <div className="flex items-center gap-2">
                <Library className="h-4 w-4 text-[#8B1E24]" />
                <h3 className="font-[family-name:var(--font-display)] text-sm font-semibold text-[#1D1915]">
                  Preface templates manager
                </h3>
                <span className="text-[10.5px] text-[#6B6257]">
                  {templates.length} total · {needsReviewTemplateCount} needs review
                </span>
              </div>
              <button
                type="button"
                onClick={() => setTemplatesModalOpen(false)}
                aria-label="Close templates manager"
                className="rounded p-1 text-[#5C5349] hover:bg-[#DDD3C1] hover:text-[#1D1915]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E6DEC8] bg-[#F5EFE4] px-4 py-2">
              <div className="flex items-center gap-1">
                {(
                  [
                    ['all', `All (${templates.length})`],
                    ['needs-review', `Needs review (${needsReviewTemplateCount})`],
                    ['user-verified', `User-verified (${templates.length - needsReviewTemplateCount})`],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setTemplateFilter(key)}
                    className={`rounded border px-2 py-0.5 text-[10.5px] font-medium transition-colors ${
                      templateFilter === key
                        ? 'border-[#8B1E24] bg-[#8B1E24] text-[#FAF6EE]'
                        : 'border-[#CFC3AE] bg-[#FAF6EE] text-[#4F473E] hover:bg-white'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {hiddenTemplateCount > 0 && onRestoreDefaultTemplates && (
                  <button
                    type="button"
                    onClick={onRestoreDefaultTemplates}
                    className="inline-flex items-center gap-1 rounded border border-[#CFC3AE] bg-[#FAF6EE] px-2 py-0.5 text-[10.5px] font-medium text-[#4F473E] hover:bg-white"
                  >
                    <RotateCcw className="h-3 w-3" />
                    <span>Restore defaults ({hiddenTemplateCount})</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={onExportTemplates}
                  className="inline-flex items-center gap-1 rounded border border-[#CFC3AE] bg-[#FAF6EE] px-2 py-0.5 text-[10.5px] font-medium text-[#4F473E] hover:bg-white"
                >
                  <Download className="h-3 w-3" />
                  <span>Export JSON</span>
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1 rounded border border-[#CFC3AE] bg-[#FAF6EE] px-2 py-0.5 text-[10.5px] font-medium text-[#4F473E] hover:bg-white"
                >
                  <Upload className="h-3 w-3" />
                  <span>Import JSON</span>
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-[#E6DEC8] px-4 py-1">
              {filteredTemplates.length === 0 ? (
                <p className="py-6 text-center text-[11.5px] text-[#7C7060]">
                  No templates match this filter.
                </p>
              ) : (
                filteredTemplates.map((tpl) => {
                  const status = getPrefaceTemplateStatus(tpl);
                  const badge = TEMPLATE_STATUS_BADGE[status];
                  const showGabc = Boolean(expandedTemplateGabc[tpl.id]);
                  return (
                    <div key={tpl.id} className="py-2.5 space-y-1.5">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0 flex-1 space-y-0.5">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span
                              className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[9.5px] font-semibold ${badge.className}`}
                            >
                              {badge.label}
                            </span>
                            <span className="rounded border border-[#CFC3AE] bg-[#F5EFE4] px-1.5 py-0.5 text-[9.5px] font-semibold uppercase text-[#4F473E]">
                              {tpl.language} · {tpl.kind}
                            </span>
                            <span className="font-[family-name:var(--font-mono)] text-[10px] text-[#6B6257]">
                              {tpl.id}
                            </span>
                            <span className="text-[10px] text-[#7C7060]">({tpl.source})</span>
                          </div>
                          <p className="whitespace-pre-line font-[family-name:var(--font-serif)] text-[12px] text-[#1D1915]">
                            {tpl.text}
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedTemplateGabc((prev) => ({
                                ...prev,
                                [tpl.id]: !prev[tpl.id],
                              }))
                            }
                            className="inline-flex items-center gap-1 rounded border border-[#CFC3AE] bg-[#F5EFE4] px-2 py-0.5 text-[10px] font-medium text-[#4F473E] hover:bg-white"
                          >
                            {showGabc ? (
                              <EyeOff className="h-3 w-3" />
                            ) : (
                              <Eye className="h-3 w-3" />
                            )}
                            <span>{showGabc ? 'Hide GABC' : 'View GABC'}</span>
                          </button>
                          {status === 'needs-review' && onVerifyTemplate && (
                            <button
                              type="button"
                              onClick={() => onVerifyTemplate(tpl.id)}
                              className="inline-flex items-center gap-1 rounded border border-[#9CC2A3] bg-[#E8F3EA] px-2 py-0.5 text-[10px] font-semibold text-[#1E5B2D] hover:bg-white"
                            >
                              <Check className="h-3 w-3" />
                              <span>Mark verified</span>
                            </button>
                          )}
                          {onDeleteTemplate && (
                            <button
                              type="button"
                              onClick={() => onDeleteTemplate(tpl.id)}
                              title={`Delete template "${tpl.id}"`}
                              aria-label={`Delete template ${tpl.id}`}
                              className="inline-flex items-center gap-1 rounded border border-[#E5A0A0] bg-[#FEF2F2] px-2 py-0.5 text-[10px] font-medium text-[#991B1B] hover:bg-[#FEE2E2]"
                            >
                              <Trash2 className="h-3 w-3" />
                              <span>Delete</span>
                            </button>
                          )}
                        </div>
                      </div>

                      {showGabc && (
                        <pre className="overflow-x-auto rounded border border-[#DDD3C1] bg-white p-2 font-[family-name:var(--font-mono)] text-[10.5px] text-[#1D1915]">
                          {tpl.gabc}
                        </pre>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
