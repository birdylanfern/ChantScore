import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Copy,
  FileUp,
  Languages,
  X,
} from 'lucide-react';
import { ChantLanguage } from '@/src/types/chant';
import { GabcDiagnostic, validateGabc } from '@/src/lib/gabc/validator';
import { parseGabc } from '@/src/lib/gabc/parser';
import { serializeGabc } from '@/src/lib/gabc/serializer';
import {
  createLiveGabcController,
  LIVE_PARSE_DEBOUNCE_MS,
} from '@/src/lib/gabc/liveSync';
import { applyLyricsToScore } from '@/src/lib/notation/lyricsImport';
import { ensureEnglishHyphenation } from '@/src/lib/text/englishSyllabify';

interface GabcEditorProps {
  syncedGabc: string;
  highlightedRange: { start: number; end: number } | null;
  width: number;
  language: ChantLanguage;
  onChangeLanguage: (language: ChantLanguage) => void;
  onGabcEdited: (rawGabc: string, recordHistory: boolean) => void;
  onCursorOffsetChange: (offset: number, draftText: string, isDirty: boolean) => void;
  onClosePanel: () => void;
}

interface AutocompleteItem {
  label: string;
  insert: string;
  desc: string;
}

const CLEF_COMPLETIONS: AutocompleteItem[] = [
  { label: 'c4', insert: 'c4)', desc: 'Do clef on 4th line' },
  { label: 'c3', insert: 'c3)', desc: 'Do clef on 3rd line' },
  { label: 'f3', insert: 'f3)', desc: 'Fa clef on 3rd line' },
  { label: 'cb4', insert: 'cb4)', desc: 'Do 4th line with B-flat' },
  { label: ',', insert: ',)', desc: 'Divisio minima' },
  { label: ';', insert: ';)', desc: 'Divisio minor' },
  { label: ':', insert: ':)', desc: 'Divisio major' },
  { label: '::', insert: '::)', desc: 'Divisio finalis' },
  { label: 'z', insert: 'z)', desc: 'Line break (justified)' },
];

const HEADER_COMPLETIONS: AutocompleteItem[] = [
  { label: 'name:', insert: 'name: ;', desc: 'Chant title' },
  { label: 'office-part:', insert: 'office-part: ;', desc: 'Liturgical genre' },
  { label: 'mode:', insert: 'mode: ;', desc: 'Gregorian mode (I–VIII)' },
  { label: 'annotation:', insert: 'annotation: ;', desc: 'Above drop cap' },
  { label: 'initial-style:', insert: 'initial-style: 1;', desc: 'Drop cap (1 or 0)' },
];

function formatDiagMessage(diag: GabcDiagnostic): string {
  if (/^Line\s+\d+/i.test(diag.message)) return diag.message;
  return `Line ${diag.line}: ${diag.message}`;
}

function renderHighlightedLines(
  text: string,
  highlightedRange: { start: number; end: number } | null,
  errors: GabcDiagnostic[]
): React.ReactNode[] {
  const normalized = text.replace(/\r\n/g, '\n');
  const sepIdx = normalized.indexOf('%%');
  const lines = normalized.split('\n');
  const errorLines = new Set(errors.map((e) => e.line));

  let offset = 0;

  return lines.map((line, lineIdx) => {
    const lineNum = lineIdx + 1;
    const lineStart = offset;
    const lineEnd = lineStart + line.length;
    offset = lineEnd + 1;

    const isHeaderRegion = sepIdx < 0 || lineStart < sepIdx;
    const isSepLine = line.trim() === '%%';
    const isComment = line.trimStart().startsWith('%') && !isSepLine;
    const hasLineError = errorLines.has(lineNum);

    const hlStart =
      highlightedRange && highlightedRange.end > lineStart && highlightedRange.start < lineEnd
        ? Math.max(0, highlightedRange.start - lineStart)
        : -1;
    const hlEnd =
      highlightedRange && highlightedRange.end > lineStart && highlightedRange.start < lineEnd
        ? Math.min(line.length, highlightedRange.end - lineStart)
        : -1;

    const renderNeumeInner = (inner: string, keyPrefix: string) => {
      const parts: React.ReactNode[] = [];
      let i = 0;
      const trimmed = inner.trim();
      if (/^(c|f|cb|fb)[1-4]$/i.test(trimmed) || /^(::|:|;|,|'|`|z|Z)$/.test(trimmed)) {
        return (
          <span key={keyPrefix} className="font-semibold text-[#8B1E24]">
            {inner}
          </span>
        );
      }
      while (i < inner.length) {
        const ch = inner[i];
        if (/[a-mA-M]/.test(ch)) {
          parts.push(
            <span key={`${keyPrefix}_${i}`} className="text-[#1F3A5F] font-medium">
              {ch}
            </span>
          );
        } else if (/[._'~<>vVwWoOsSxXyY#]/.test(ch)) {
          parts.push(
            <span key={`${keyPrefix}_${i}`} className="text-[#9A6B16] font-semibold">
              {ch}
            </span>
          );
        } else if (ch === '/') {
          parts.push(
            <span key={`${keyPrefix}_${i}`} className="text-[#8B1E24]">
              {ch}
            </span>
          );
        } else {
          parts.push(
            <span key={`${keyPrefix}_${i}`} className="text-[#5C5349]">
              {ch}
            </span>
          );
        }
        i += 1;
      }
      return parts;
    };

    const renderPlainSegment = (segment: string, keyPrefix: string) => {
      if (isSepLine) {
        return (
          <span key={keyPrefix} className="font-bold text-[#9A6B16]">
            {segment}
          </span>
        );
      }
      if (isComment) {
        return (
          <span key={keyPrefix} className="italic text-[#8B7F70]">
            {segment}
          </span>
        );
      }
      if (isHeaderRegion) {
        const colonIdx = segment.indexOf(':');
        if (colonIdx > 0) {
          return (
            <React.Fragment key={keyPrefix}>
              <span className="font-semibold text-[#8B1E24]">
                {segment.slice(0, colonIdx + 1)}
              </span>
              <span className="text-[#1D1915]">{segment.slice(colonIdx + 1)}</span>
            </React.Fragment>
          );
        }
        return (
          <span key={keyPrefix} className="text-[#1D1915]">
            {segment}
          </span>
        );
      }

      // Chant body: colorize (...) neume tokens vs lyric text
      const out: React.ReactNode[] = [];
      let cursor = 0;
      const parenRe = /\(([^)]*)\)/g;
      let m: RegExpExecArray | null;
      let idx = 0;
      while ((m = parenRe.exec(segment)) !== null) {
        if (m.index > cursor) {
          out.push(
            <span key={`${keyPrefix}_txt_${idx}`} className="text-[#1D1915]">
              {segment.slice(cursor, m.index)}
            </span>
          );
        }
        out.push(
          <span key={`${keyPrefix}_op_${idx}`} className="text-[#7B6F5F]">
            (
          </span>
        );
        out.push(renderNeumeInner(m[1], `${keyPrefix}_in_${idx}`));
        out.push(
          <span key={`${keyPrefix}_cl_${idx}`} className="text-[#7B6F5F]">
            )
          </span>
        );
        cursor = parenRe.lastIndex;
        idx += 1;
      }
      if (cursor < segment.length) {
        out.push(
          <span key={`${keyPrefix}_tail`} className="text-[#1D1915]">
            {segment.slice(cursor)}
          </span>
        );
      }
      return out;
    };

    let content: React.ReactNode;
    if (hlStart >= 0 && hlEnd > hlStart) {
      content = (
        <>
          {hlStart > 0 && renderPlainSegment(line.slice(0, hlStart), `l_${lineIdx}_pre`)}
          <mark className="rounded-[2px] bg-[#D4A64A]/40 text-inherit">
            {renderPlainSegment(line.slice(hlStart, hlEnd), `l_${lineIdx}_hl`)}
          </mark>
          {hlEnd < line.length && renderPlainSegment(line.slice(hlEnd), `l_${lineIdx}_post`)}
        </>
      );
    } else {
      content = line.length > 0 ? renderPlainSegment(line, `l_${lineIdx}`) : '\u200B';
    }

    return (
      <div
        key={lineIdx}
        className={hasLineError ? 'bg-[#8B1E24]/10 underline decoration-[#B91C1C] decoration-wavy' : undefined}
      >
        {content}
      </div>
    );
  });
}

export const GabcEditor: React.FC<GabcEditorProps> = ({
  syncedGabc,
  highlightedRange,
  width,
  language,
  onChangeLanguage,
  onGabcEdited,
  onCursorOffsetChange,
  onClosePanel,
}) => {
  const controllerRef = useRef(createLiveGabcController(syncedGabc));
  const [draft, setDraft] = useState(syncedGabc);
  const [liveErrors, setLiveErrors] = useState<GabcDiagnostic[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [lyricsOpen, setLyricsOpen] = useState(false);
  const [lyricsText, setLyricsText] = useState('');
  const [lyricsNote, setLyricsNote] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const preRef = useRef<HTMLPreElement | null>(null);
  const gutterRef = useRef<HTMLDivElement | null>(null);
  const debounceTimerRef = useRef<number | null>(null);

  const [autocompleteItems, setAutocompleteItems] = useState<AutocompleteItem[]>([]);
  const [autocompleteIdx, setAutocompleteIdx] = useState(0);
  const [autocompleteAnchor, setAutocompleteAnchor] = useState<{ start: number; end: number } | null>(
    null
  );

  const syncScroll = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    if (preRef.current) {
      preRef.current.scrollTop = ta.scrollTop;
      preRef.current.scrollLeft = ta.scrollLeft;
    }
    if (gutterRef.current) {
      gutterRef.current.scrollTop = ta.scrollTop;
    }
  }, []);

  const applyDraftPreservingScroll = useCallback(
    (nextText: string) => {
      const ta = textareaRef.current;
      const scrollTop = ta?.scrollTop ?? 0;
      const scrollLeft = ta?.scrollLeft ?? 0;
      setDraft(nextText);
      setLiveErrors([]);
      setFileError(null);
      requestAnimationFrame(() => {
        if (textareaRef.current) {
          textareaRef.current.scrollTop = scrollTop;
          textareaRef.current.scrollLeft = scrollLeft;
          syncScroll();
        }
      });
    },
    [syncScroll]
  );

  const clearPendingParse = useCallback(() => {
    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
  }, []);

  const flushLiveParse = useCallback(() => {
    clearPendingParse();
    const { evaluation, recordHistory } = controllerRef.current.flushDraftParse(Date.now());
    if (!evaluation.valid) {
      setLiveErrors(evaluation.errors);
      return;
    }
    setLiveErrors([]);
    setFileError(null);
    if (evaluation.shouldCommit) {
      onGabcEdited(controllerRef.current.getState().draft, recordHistory);
    }
  }, [clearPendingParse, onGabcEdited]);

  const scheduleLiveParse = useCallback(
    (nextDraft: string) => {
      controllerRef.current.onUserDraftChange(nextDraft);
      setFileError(null);
      clearPendingParse();
      debounceTimerRef.current = window.setTimeout(() => {
        debounceTimerRef.current = null;
        flushLiveParse();
      }, LIVE_PARSE_DEBOUNCE_MS);
    },
    [clearPendingParse, flushLiveParse]
  );

  // Sync incoming external score changes (visual editing, tones, undo/redo) without loops or cursor jumps
  useEffect(() => {
    const hasFocus =
      typeof document !== 'undefined' && document.activeElement === textareaRef.current;
    const { nextDraft } = controllerRef.current.onExternalSyncedGabc(syncedGabc, hasFocus);
    if (nextDraft !== null) {
      clearPendingParse();
      applyDraftPreservingScroll(nextDraft);
    }
  }, [applyDraftPreservingScroll, clearPendingParse, syncedGabc]);

  // Clean up debounce timer on unmount
  useEffect(() => clearPendingParse, [clearPendingParse]);

  // Scroll highlighted range into view when user clicks a neume in the score (not while typing)
  const draftRef = useRef(draft);
  draftRef.current = draft;
  useEffect(() => {
    if (!highlightedRange || !textareaRef.current || !preRef.current || !gutterRef.current) return;
    if (document.activeElement === textareaRef.current) return;
    const textBefore = draftRef.current.slice(0, highlightedRange.start);
    const lineIndex = textBefore.split('\n').length - 1;
    const lineHeightPx = 19.5;
    const targetTop = Math.max(0, lineIndex * lineHeightPx - 60);
    textareaRef.current.scrollTop = targetTop;
    preRef.current.scrollTop = targetTop;
    gutterRef.current.scrollTop = targetTop;
  }, [highlightedRange]);

  const validation = useMemo(() => validateGabc(draft), [draft]);
  const activeErrors = liveErrors.length > 0 ? liveErrors : validation.errors;
  const isErrorState = !!fileError || !validation.valid || liveErrors.length > 0;
  const lineCount = useMemo(() => draft.replace(/\r\n/g, '\n').split('\n').length, [draft]);

  const updateAutocomplete = (text: string, cursorPos: number, force = false) => {
    const sepIdx = text.indexOf('%%');
    const before = text.slice(0, cursorPos);

    // Inside parentheses in body
    const lastOpen = before.lastIndexOf('(');
    const lastClose = before.lastIndexOf(')');
    if (sepIdx >= 0 && cursorPos > sepIdx + 2 && lastOpen > lastClose) {
      const prefix = before.slice(lastOpen + 1);
      if (prefix.length <= 4) {
        const matches = CLEF_COMPLETIONS.filter((c) =>
          c.label.toLowerCase().startsWith(prefix.toLowerCase())
        );
        if (matches.length > 0 && (force || prefix.length === 0 || /^[cf,:;z]/i.test(prefix))) {
          setAutocompleteItems(matches);
          setAutocompleteAnchor({ start: lastOpen + 1, end: cursorPos });
          setAutocompleteIdx(0);
          return;
        }
      }
    }

    // Header region autocomplete
    if ((sepIdx < 0 || cursorPos < sepIdx) && (force || /^[a-z-]{1,8}$/i.test(before.split('\n').pop() || ''))) {
      const curLine = before.split('\n').pop() || '';
      const lineStart = cursorPos - curLine.length;
      const matches = HEADER_COMPLETIONS.filter((h) =>
        h.label.toLowerCase().startsWith(curLine.toLowerCase())
      );
      if (matches.length > 0 && (force || curLine.length >= 2)) {
        setAutocompleteItems(matches);
        setAutocompleteAnchor({ start: lineStart, end: cursorPos });
        setAutocompleteIdx(0);
        return;
      }
    }

    setAutocompleteItems([]);
    setAutocompleteAnchor(null);
  };

  const applyAutocompleteItem = (item: AutocompleteItem) => {
    if (!autocompleteAnchor || !textareaRef.current) return;
    const next =
      draft.slice(0, autocompleteAnchor.start) +
      item.insert +
      draft.slice(autocompleteAnchor.end);
    const caret = autocompleteAnchor.start + item.insert.length;
    setDraft(next);
    setAutocompleteItems([]);
    setAutocompleteAnchor(null);
    scheduleLiveParse(next);
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.selectionStart = caret;
        textareaRef.current.selectionEnd = caret;
      }
    });
  };

  const applyTextToNotes = async () => {
    const check = validateGabc(draft);
    if (!check.valid) {
      setLyricsNote(formatDiagMessage(check.errors[0]));
      return;
    }
    if (!lyricsText.trim()) {
      setLyricsNote(
        language === 'en' ? 'Paste some English text first.' : 'Paste some Latin text first.'
      );
      return;
    }
    if (language === 'en') {
      setLyricsNote('Loading English hyphenation…');
      await ensureEnglishHyphenation();
    }
    const result = applyLyricsToScore(parseGabc(draft), lyricsText, language);
    if (result.assigned === 0) {
      setLyricsNote('There are no notes to attach text to.');
      return;
    }
    const nextGabc = serializeGabc(result.score);
    clearPendingParse();
    controllerRef.current.resetCoalescing();
    controllerRef.current.onUserDraftChange(nextGabc);
    const { evaluation } = controllerRef.current.flushDraftParse(Date.now());
    setDraft(nextGabc);
    setLiveErrors([]);
    setFileError(null);
    if (evaluation.valid && evaluation.shouldCommit) {
      onGabcEdited(nextGabc, true);
    }
    const extra =
      result.leftoverSyllables > 0
        ? ` ${result.leftoverSyllables} syllable(s) of text did not fit.`
        : result.unfilledItems > 0
        ? ` ${result.unfilledItems} note group(s) have no text yet.`
        : '';
    setLyricsNote(`Placed ${result.assigned} syllable(s).${extra}`);
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    const cursor = e.target.selectionStart ?? val.length;
    setDraft(val);
    scheduleLiveParse(val);
    updateAutocomplete(val, cursor);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      clearPendingParse();
      controllerRef.current.resetCoalescing();
      controllerRef.current.onUserDraftChange(text);
      const { evaluation } = controllerRef.current.flushDraftParse(Date.now());
      setDraft(text);
      setFileError(null);
      if (evaluation.valid) {
        setLiveErrors([]);
        if (evaluation.shouldCommit) {
          onGabcEdited(text, true);
        }
      } else {
        setLiveErrors(evaluation.errors);
      }
    } catch {
      setFileError('Could not read this file.');
    }
    e.target.value = '';
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(draft);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // ignore clipboard errors
    }
  };

  const jumpToDiagnostic = (diag: GabcDiagnostic) => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.focus();
    ta.selectionStart = diag.start;
    ta.selectionEnd = diag.end;
    const lineHeightPx = 19.5;
    const targetTop = Math.max(0, (diag.line - 1) * lineHeightPx - 60);
    ta.scrollTop = targetTop;
    syncScroll();
  };

  const highlightedLines = useMemo(
    () => renderHighlightedLines(draft, highlightedRange, activeErrors),
    [draft, highlightedRange, activeErrors]
  );

  const isDirtyForCursorSync = draft !== syncedGabc;

  return (
    <aside
      aria-label="GABC Source Editor"
      style={{ width: `${width}px` }}
      className="no-print flex h-full max-w-full shrink-0 flex-col border-l border-[#CFC3AE] bg-[#F5EFE4]"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-[#DDD3C1] bg-[#EAE2D3] px-3 py-1.5">
        <h2 className="font-[family-name:var(--font-display)] text-xs font-semibold tracking-wider text-[#8B1E24] truncate">
          GABC Source
        </h2>

        <div className="flex items-center gap-1 shrink-0">
          <input
            ref={fileInputRef}
            type="file"
            accept=".gabc,.txt"
            onChange={handleFileUpload}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            title="Import a .gabc file"
            className="inline-flex h-7 items-center gap-1 rounded border border-[#CFC3AE] bg-[#FAF6EE] px-2 text-[11px] font-medium text-[#1D1915] hover:bg-white transition-colors whitespace-nowrap"
          >
            <FileUp className="h-3 w-3" />
            <span>Open</span>
          </button>
          <button
            type="button"
            onClick={() => setLyricsOpen((v) => !v)}
            title="Add text to score: auto-syllabified onto the notes"
            aria-expanded={lyricsOpen}
            className={`inline-flex h-7 items-center gap-1 rounded border px-2 text-[11px] font-medium transition-colors whitespace-nowrap ${
              lyricsOpen
                ? 'border-[#8B1E24] bg-[#8B1E24]/10 text-[#6E161B]'
                : 'border-[#CFC3AE] bg-[#FAF6EE] text-[#1D1915] hover:bg-white'
            }`}
          >
            <Languages className="h-3 w-3" />
            <span>Text</span>
          </button>
          <button
            type="button"
            onClick={handleCopy}
            title="Copy GABC source"
            className="inline-flex h-7 items-center gap-1 rounded border border-[#CFC3AE] bg-[#FAF6EE] px-2 text-[11px] font-medium text-[#1D1915] hover:bg-white transition-colors whitespace-nowrap"
          >
            {copied ? <Check className="h-3 w-3 text-[#14532D]" /> : <Copy className="h-3 w-3" />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>
          <button
            type="button"
            onClick={onClosePanel}
            title="Hide GABC Editor (switch to Notation Mode)"
            aria-label="Hide GABC Editor"
            className="inline-flex h-7 w-7 items-center justify-center rounded border border-[#CFC3AE] bg-[#FAF6EE] text-[#4F473E] hover:bg-white hover:text-[#1D1915] transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {lyricsOpen && (
        <div className="border-b border-[#DDD3C1] bg-[#F0E9DC] px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="lyrics-import-text" className="text-[11px] font-medium text-[#1D1915]">
              Add text to score (use hyphens to override)
            </label>
            <div className="flex items-center rounded border border-[#CFC3AE] bg-[#FAF6EE] p-0.5 text-[10.5px]" role="group" aria-label="Text syllabification language">
              {(
                [
                  { id: 'la', label: 'Latin' },
                  { id: 'en', label: 'English' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  aria-pressed={language === opt.id}
                  onClick={() => {
                    onChangeLanguage(opt.id);
                    if (opt.id === 'en') {
                      void ensureEnglishHyphenation().catch(() => {});
                    }
                    setLyricsNote(null);
                  }}
                  className={`rounded-sm px-2 py-0.5 font-medium transition-colors ${
                    language === opt.id
                      ? 'bg-[#8B1E24] text-[#FAF6EE]'
                      : 'text-[#4F473E] hover:text-[#1D1915]'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <textarea
            id="lyrics-import-text"
            value={lyricsText}
            onChange={(e) => {
              setLyricsText(e.target.value);
              setLyricsNote(null);
            }}
            rows={3}
            className="mt-1.5 w-full rounded border border-[#CFC3AE] bg-[#FAF6EE] p-1.5 text-[12px] focus:border-[#8B1E24] focus:outline-none"
            placeholder={
              language === 'en' ? 'Glory be to the Father' : 'Gloria in excelsis Deo'
            }
          />
          <div className="mt-1 flex items-center justify-between gap-2">
            <span role="status" className="text-[11px] text-[#5C5349]">
              {lyricsNote}
            </span>
            <button
              type="button"
              onClick={applyTextToNotes}
              className="h-7 shrink-0 rounded border border-[#8B1E24] bg-[#8B1E24] px-2.5 text-[11px] font-medium text-white hover:bg-[#7C1B1B]"
            >
              Place on notes
            </button>
          </div>
        </div>
      )}

      {/* Code Editor Area with Line Numbers & Syntax Highlighting */}
      <div className="relative flex flex-1 flex-col p-2.5 overflow-hidden">
        <div className="relative flex flex-1 overflow-hidden rounded border border-[#CFC3AE] bg-[#FAF6EE] focus-within:border-[#8B1E24]">
          {/* Line Numbers Gutter */}
          <div
            ref={gutterRef}
            aria-hidden="true"
            className="w-10 shrink-0 overflow-hidden border-r border-[#E4DBCC] bg-[#F2EBE0] py-2.5 pr-2 text-right font-[family-name:var(--font-mono)] text-[12px] leading-[19.5px] text-[#8E816E] select-none tabular-nums"
          >
            {Array.from({ length: lineCount }, (_, idx) => (
              <div key={idx}>{idx + 1}</div>
            ))}
          </div>

          {/* Highlighting Backdrop + Interactive Textarea */}
          <div className="relative flex-1 overflow-hidden">
            <pre
              ref={preRef}
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 m-0 overflow-hidden whitespace-pre p-2.5 font-[family-name:var(--font-mono)] text-[12px] leading-[19.5px] text-[#1D1915]"
            >
              {highlightedLines}
            </pre>

            <textarea
              ref={textareaRef}
              value={draft}
              onChange={handleChange}
              onScroll={syncScroll}
              onBlur={() => {
                if (debounceTimerRef.current !== null) {
                  flushLiveParse();
                }
                const { nextDraft } = controllerRef.current.onEditorBlur();
                if (nextDraft !== null) {
                  applyDraftPreservingScroll(nextDraft);
                }
              }}
              onClick={(e) => {
                onCursorOffsetChange(
                  e.currentTarget.selectionStart ?? 0,
                  draft,
                  isDirtyForCursorSync
                );
              }}
              onKeyUp={(e) => {
                if (
                  e.key === 'ArrowLeft' ||
                  e.key === 'ArrowRight' ||
                  e.key === 'ArrowUp' ||
                  e.key === 'ArrowDown'
                ) {
                  onCursorOffsetChange(
                    e.currentTarget.selectionStart ?? 0,
                    draft,
                    isDirtyForCursorSync
                  );
                }
              }}
              onKeyDown={(e) => {
                if (autocompleteItems.length > 0) {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setAutocompleteIdx((i) => (i + 1) % autocompleteItems.length);
                    return;
                  }
                  if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setAutocompleteIdx(
                      (i) => (i - 1 + autocompleteItems.length) % autocompleteItems.length
                    );
                    return;
                  }
                  if (e.key === 'Enter' || e.key === 'Tab') {
                    e.preventDefault();
                    applyAutocompleteItem(autocompleteItems[autocompleteIdx]);
                    return;
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    setAutocompleteItems([]);
                    return;
                  }
                }

                if ((e.ctrlKey || e.metaKey) && e.key === ' ') {
                  e.preventDefault();
                  updateAutocomplete(draft, e.currentTarget.selectionStart ?? 0, true);
                  return;
                }

                if (e.key === 'Tab') {
                  e.preventDefault();
                  const el = e.currentTarget;
                  const start = el.selectionStart;
                  const end = el.selectionEnd;
                  const next = draft.slice(0, start) + '  ' + draft.slice(end);
                  setDraft(next);
                  scheduleLiveParse(next);
                  requestAnimationFrame(() => {
                    el.selectionStart = el.selectionEnd = start + 2;
                  });
                }
              }}
              spellCheck={false}
              wrap="off"
              aria-label="Direct GABC Source Editor"
              placeholder={`name: Cantus Novus;\noffice-part: Antiphona;\nmode: VIII;\n%%\n(c4) ...`}
              className="relative z-10 h-full w-full resize-none overflow-auto whitespace-pre bg-transparent p-2.5 font-[family-name:var(--font-mono)] text-[12px] leading-[19.5px] text-transparent caret-[#1D1915] selection:bg-[#8B1E24]/20 focus:outline-none"
            />

            {/* Autocomplete Popup */}
            {autocompleteItems.length > 0 && (
              <div className="absolute bottom-2 left-2 right-2 z-20 max-h-44 overflow-y-auto rounded border border-[#CFC3AE] bg-[#FAF6EE] shadow-lg">
                <div className="border-b border-[#E4DBCC] bg-[#EAE2D3] px-2.5 py-1 text-[10px] font-semibold text-[#5C5349]">
                  GABC Suggestions · Enter/Tab to insert
                </div>
                {autocompleteItems.map((item, idx) => (
                  <button
                    key={item.label}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      applyAutocompleteItem(item);
                    }}
                    className={`flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-xs ${
                      idx === autocompleteIdx
                        ? 'bg-[#8B1E24] text-[#FAF6EE]'
                        : 'text-[#1D1915] hover:bg-[#EFE7D8]'
                    }`}
                  >
                    <span className="font-[family-name:var(--font-mono)] font-semibold">
                      {item.label}
                    </span>
                    <span
                      className={`text-[10.5px] truncate ${
                        idx === autocompleteIdx ? 'text-[#FAF6EE]/80' : 'text-[#6B6257]'
                      }`}
                    >
                      {item.desc}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Inline Diagnostics List (Errors / Warnings) */}
        {(activeErrors.length > 0 || fileError || validation.warnings.length > 0) && (
          <div className="mt-2 max-h-24 overflow-y-auto rounded border border-[#DFC9C9] bg-[#FDF4F4] px-2.5 py-1.5 text-[11px]">
            {activeErrors.length > 0 ? (
              activeErrors.map((err, idx) => (
                <button
                  key={`err_${idx}`}
                  type="button"
                  onClick={() => jumpToDiagnostic(err)}
                  className="flex w-full items-start gap-1.5 py-0.5 text-left text-[#991B1B] hover:underline"
                >
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                  <span>{formatDiagMessage(err)}</span>
                </button>
              ))
            ) : fileError ? (
              <div className="flex items-start gap-1.5 text-[#991B1B]">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                <span>{fileError}</span>
              </div>
            ) : (
              validation.warnings.map((w, idx) => (
                <button
                  key={`warn_${idx}`}
                  type="button"
                  onClick={() => jumpToDiagnostic(w)}
                  className="flex w-full items-start gap-1.5 py-0.5 text-left text-[#92400E] hover:underline"
                >
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                  <span>{formatDiagMessage(w)}</span>
                </button>
              ))
            )}
          </div>
        )}

        {/* Status Footer */}
        <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px]">
          <span
            role="status"
            className={isErrorState ? 'font-medium text-[#991B1B]' : 'text-[#5C5349]'}
          >
            {isErrorState
              ? `${activeErrors.length || 1} syntax issue${
                  (activeErrors.length || 1) > 1 ? 's' : ''
                } · Last valid score kept`
              : 'Live sync'}
          </span>
          <span className="text-[10.5px] text-[#6B6257]">
            Ctrl+Space suggest
          </span>
        </div>
      </div>
    </aside>
  );
};
