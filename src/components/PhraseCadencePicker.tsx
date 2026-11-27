import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronRight } from 'lucide-react';
import type { ReadingCadenceKind } from '@/src/lib/tones/tone';
import {
  CADENCE_CHOICE_META,
  cadenceKindToLabel,
  getValidPhraseCadenceChoices,
  PhraseCadenceChoice,
} from '@/src/lib/tones/phraseCadenceUtils';

export const CADENCE_BADGE_CLASS: Record<PhraseCadenceChoice, string> = {
  none: 'border-[#D6CBB8] bg-[#F5EFE4] text-[#6B6257] hover:bg-white hover:text-[#1D1915]',
  metrum: 'border-[#C8B898] bg-[#EFE5D1] text-[#6B4E16] hover:bg-[#F7F0DF]',
  long: 'border-[#C89C9E] bg-[#FBF2F2] text-[#8B1E24] hover:bg-white',
  final: 'border-[#8B1E24] bg-[#8B1E24] text-[#FAF6EE] hover:bg-[#70161B]',
  question: 'border-[#A89A82] bg-[#EAE2D3] text-[#3F3830] hover:bg-white',
  flex: 'border-[#D6CBB8] bg-[#F5EFE4] text-[#4F473E] hover:bg-white',
  prefinal: 'border-[#C8B898] bg-[#EFE5D1] text-[#6B4E16] hover:bg-[#F7F0DF]',
};

export interface PhraseCadencePickerProps {
  phraseIndex: number;
  currentChoice: PhraseCadenceChoice;
  defaultKind: ReadingCadenceKind | null;
  overridden: boolean;
  isEnglishPreface: boolean;
  hasQuestionCadence: boolean;
  onSelectChoice: (
    phraseIndex: number,
    choice: PhraseCadenceChoice,
    defaultKind: ReadingCadenceKind | null
  ) => void;
}

export const PhraseCadencePicker: React.FC<PhraseCadencePickerProps> = ({
  phraseIndex,
  currentChoice,
  defaultKind,
  overridden,
  isEnglishPreface,
  hasQuestionCadence,
  onSelectChoice,
}) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const baseChoices = getValidPhraseCadenceChoices({
    isEnglishPreface,
    hasQuestion: hasQuestionCadence,
  });
  const defaultChoice = cadenceKindToLabel(defaultKind, undefined);
  const choices = baseChoices.includes(defaultChoice)
    ? baseChoices
    : [...baseChoices, defaultChoice];
  const currentMeta = CADENCE_CHOICE_META[currentChoice];
  const defaultMeta = CADENCE_CHOICE_META[defaultChoice];

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const activeIdx = Math.max(0, choices.indexOf(currentChoice));
    const timer = window.setTimeout(() => {
      itemRefs.current[activeIdx]?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  const handleSelect = (choice: PhraseCadenceChoice) => {
    onSelectChoice(phraseIndex, choice, defaultKind);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const handleTriggerKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      setOpen(false);
    }
  };

  const handleMenuKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const activeIdx = itemRefs.current.findIndex((el) => el === document.activeElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = (activeIdx + 1) % choices.length;
      itemRefs.current[next]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = (activeIdx - 1 + choices.length) % choices.length;
      itemRefs.current[prev]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      itemRefs.current[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      itemRefs.current[choices.length - 1]?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  return (
    <div ref={rootRef} className="relative inline-block">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Phrase ${phraseIndex + 1} cadence: ${currentMeta.label} (${currentMeta.technicalName}). Default: ${defaultMeta.label}. Choose cadence.`}
        title={`Phrase ${phraseIndex + 1} · ${currentMeta.technicalName}${
          overridden ? ` (overridden; default: ${defaultMeta.label})` : ''
        } — click to choose cadence`}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={handleTriggerKeyDown}
        className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10.5px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#8B1E24] ${
          CADENCE_BADGE_CLASS[currentChoice]
        }${overridden ? ' ring-1 ring-[#B48327]' : ''}`}
      >
        <span>{currentMeta.label}</span>
        <ChevronDown className="h-2.5 w-2.5 opacity-75" aria-hidden="true" />
      </button>

      {open && (
        <div
          role="menu"
          aria-label={`Phrase ${phraseIndex + 1} cadence options`}
          onKeyDown={handleMenuKeyDown}
          className="absolute right-0 z-30 mt-1 w-72 rounded border border-[#CFC3AE] bg-[#FAF6EE] p-1 shadow-md"
        >
          {choices.map((choice, idx) => {
            const meta = CADENCE_CHOICE_META[choice];
            const isSelected = choice === currentChoice;
            return (
              <button
                key={choice}
                ref={(el) => {
                  itemRefs.current[idx] = el;
                }}
                type="button"
                role="menuitemradio"
                aria-checked={isSelected}
                title={meta.technicalName}
                onClick={() => handleSelect(choice)}
                className={`flex w-full items-start gap-2 rounded px-2 py-1.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-[#8B1E24] ${
                  isSelected
                    ? 'bg-[#EFE8DA] text-[#1D1915]'
                    : 'text-[#2A241E] hover:bg-[#F5EFE4]'
                }`}
              >
                <span className="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center text-[#8B1E24]">
                  {isSelected && <Check className="h-3 w-3" aria-hidden="true" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span
                      className={`inline-block rounded border px-1.5 py-0 text-[10px] font-semibold ${CADENCE_BADGE_CLASS[choice]}`}
                    >
                      {meta.label}
                    </span>
                    <span className="text-[10px] text-[#7C7060]">{meta.technicalName}</span>
                    {choice === defaultChoice && (
                      <span className="rounded bg-[#E6DEC8] px-1 py-0 text-[9px] font-semibold text-[#5C5349]">
                        Default
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-[10.5px] leading-snug text-[#5C5349]">
                    {meta.description}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export const CadenceColorLegend: React.FC = () => {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-[#5C5349]">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
        className="inline-flex items-center gap-0.5 font-semibold text-[#4F473E] hover:text-[#1D1915] focus-visible:outline-2 focus-visible:outline-[#8B1E24] rounded"
      >
        {expanded ? (
          <ChevronDown className="h-2.5 w-2.5 text-[#8B1E24]" aria-hidden="true" />
        ) : (
          <ChevronRight className="h-2.5 w-2.5 text-[#8B1E24]" aria-hidden="true" />
        )}
        <span>Colour key</span>
      </button>

      {expanded && (
        <span className="flex flex-wrap items-center gap-1.5">
          <span className={`rounded border px-1 py-0 text-[9.5px] font-semibold ${CADENCE_BADGE_CLASS.none}`}>
            Keep reciting / Light pause
          </span>
          <span className={`rounded border px-1 py-0 text-[9.5px] font-semibold ${CADENCE_BADGE_CLASS.metrum}`}>
            Pause / Near end
          </span>
          <span className={`rounded border px-1 py-0 text-[9.5px] font-semibold ${CADENCE_BADGE_CLASS.long}`}>
            Full stop
          </span>
          <span className={`rounded border px-1 py-0 text-[9.5px] font-semibold ${CADENCE_BADGE_CLASS.final}`}>
            Ending
          </span>
          <span className="rounded border border-[#D6CBB8] bg-[#FAF6EE] px-1 py-0 text-[9.5px] ring-1 ring-[#B48327]">
            Gold ring = changed
          </span>
        </span>
      )}
    </div>
  );
};
