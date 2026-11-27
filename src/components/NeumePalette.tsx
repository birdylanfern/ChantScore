import React from 'react';
import {
  ClefType,
  DivisionType,
  ModifierPresetId,
  NeumePresetId,
  PaletteDragPayload,
  SelectionState,
} from '@/src/types/chant';
import {
  layoutModifierPreview,
  layoutPresetPreview,
  NOTE_W,
  STAFF_LINE_SPACING,
} from '@/src/lib/notation/layoutEngine';
import {
  INK_BLACK,
  renderClefElements,
  renderDivisionElements,
  renderGroupSvgMarkup,
  RUBRIC_RED,
  STAFF_LINE_INK,
} from '@/src/lib/notation/svgDrawing';
import { getSelectedNoteRefs } from '@/src/lib/notation/scoreMutations';

interface NeumePaletteProps {
  activePreset: NeumePresetId | null;
  toolMode: 'select' | 'insert';
  selection: SelectionState | null;
  activeModifiers: {
    mora: boolean;
    episemaH: boolean;
    episemaV: boolean;
    flat: boolean;
    natural: boolean;
    liquescent: boolean;
  };
  onSelectPreset: (preset: NeumePresetId) => void;
  onStartDrag: (payload: PaletteDragPayload) => void;
  onEndDrag: () => void;
  onToggleModifier: (mod: ModifierPresetId) => void;
  onInsertDivision: (div: DivisionType) => void;
  onSelectClef: (clef: ClefType) => void;
  onInsertLineBreak: () => void;
}

export interface PresetDef {
  id: NeumePresetId;
  label: string;
  anchorPitch: number;
  shortcut?: string;
}

export const SINGLE_NOTES: PresetDef[] = [
  { id: 'punctum', label: 'Punctum', anchorPitch: 5, shortcut: '1' },
  { id: 'virga', label: 'Virga', anchorPitch: 7, shortcut: '2' },
  { id: 'diamond', label: 'Inclinatum', anchorPitch: 5, shortcut: '3' },
  { id: 'quilisma', label: 'Quilisma', anchorPitch: 5, shortcut: '4' },
  { id: 'oriscus', label: 'Oriscus', anchorPitch: 5, shortcut: '5' },
  { id: 'stropha', label: 'Stropha', anchorPitch: 5, shortcut: '6' },
];

export const TWO_NOTE_NEUMES: PresetDef[] = [
  { id: 'podatus', label: 'Podatus', anchorPitch: 5, shortcut: '7' },
  { id: 'clivis', label: 'Clivis', anchorPitch: 7, shortcut: '8' },
];

export const THREE_NOTE_NEUMES: PresetDef[] = [
  { id: 'torculus', label: 'Torculus', anchorPitch: 5, shortcut: '9' },
  { id: 'porrectus', label: 'Porrectus', anchorPitch: 7, shortcut: '0' },
  { id: 'scandicus', label: 'Scandicus', anchorPitch: 3 },
  { id: 'climacus', label: 'Climacus', anchorPitch: 8 },
];

export const MODIFIERS: { id: ModifierPresetId; label: string; shortcut?: string }[] = [
  { id: 'mora', label: 'Mora', shortcut: 'M' },
  { id: 'episemaH', label: 'Episema', shortcut: 'E' },
  { id: 'episemaV', label: 'Ictus', shortcut: 'I' },
  { id: 'flat', label: 'Flat', shortcut: 'B' },
  { id: 'natural', label: 'Natural', shortcut: 'H' },
  { id: 'liquescent', label: 'Liquescent', shortcut: 'L' },
];

export const DIVISIONS: { id: DivisionType; label: string }[] = [
  { id: ',', label: 'Minima' },
  { id: ';', label: 'Minor' },
  { id: ':', label: 'Major' },
  { id: '::', label: 'Final' },
];

export const CLEFS: { id: ClefType; label: string }[] = [
  { id: 'c4', label: 'Do 4' },
  { id: 'c3', label: 'Do 3' },
  { id: 'c2', label: 'Do 2' },
  { id: 'c1', label: 'Do 1' },
  { id: 'f3', label: 'Fa 3' },
  { id: 'f4', label: 'Fa 4' },
  { id: 'cb4', label: 'Do 4 ♭' },
];

function MiniStaffFrame({
  children,
  width = 48,
  height = 40,
}: {
  children: React.ReactNode;
  width?: number;
  height?: number;
}) {
  const vbW = 74;
  const vbH = 66;
  const staffTop = 14;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${vbW} ${vbH}`}
      className="pointer-events-none shrink-0"
    >
      {[0, 1, 2, 3].map((i) => (
        <line
          key={i}
          x1={6}
          y1={staffTop + i * STAFF_LINE_SPACING}
          x2={vbW - 6}
          y2={staffTop + i * STAFF_LINE_SPACING}
          stroke={STAFF_LINE_INK}
          strokeOpacity={0.35}
          strokeWidth={1.1}
        />
      ))}
      {children}
    </svg>
  );
}

export function MiniNeumePreview({
  preset,
  anchorPitch,
  color = INK_BLACK,
  width,
  height,
}: {
  preset: NeumePresetId;
  anchorPitch: number;
  color?: string;
  width?: number;
  height?: number;
}) {
  const layout = layoutPresetPreview(preset, anchorPitch);
  const vbW = 74;
  const staffTop = 14;
  const startX = Math.max(8, (vbW - Math.max(NOTE_W, layout.width)) / 2);

  return (
    <MiniStaffFrame width={width} height={height}>
      <g
        dangerouslySetInnerHTML={{
          __html: renderGroupSvgMarkup(layout, startX, staffTop, color),
        }}
      />
    </MiniStaffFrame>
  );
}

export function MiniModifierPreview({
  modifier,
  active,
  width = 48,
  height = 40,
}: {
  modifier: ModifierPresetId;
  active: boolean;
  width?: number;
  height?: number;
}) {
  const layout = layoutModifierPreview(modifier);
  const vbW = 74;
  const staffTop = 14;
  const startX = Math.max(8, (vbW - Math.max(NOTE_W, layout.width)) / 2);
  const color = active ? '#FAF6EE' : INK_BLACK;
  const markup = renderGroupSvgMarkup(layout, startX, staffTop, color);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${vbW} 66`}
      className="pointer-events-none shrink-0"
    >
      {[0, 1, 2, 3].map((i) => (
        <line
          key={i}
          x1={6}
          y1={staffTop + i * STAFF_LINE_SPACING}
          x2={vbW - 6}
          y2={staffTop + i * STAFF_LINE_SPACING}
          stroke={active ? '#FAF6EE' : STAFF_LINE_INK}
          strokeOpacity={active ? 0.35 : 0.32}
          strokeWidth={1.1}
        />
      ))}
      <g dangerouslySetInnerHTML={{ __html: markup }} />
      {!active && modifier === 'mora' && (
        <circle
          cx={startX + NOTE_W + 4.5}
          cy={staffTop + 28 - 3.2}
          r={5.2}
          fill="none"
          stroke={RUBRIC_RED}
          strokeWidth={1.1}
          strokeOpacity={0.7}
        />
      )}
      {!active && modifier === 'episemaH' && (
        <line
          x1={startX - 0.5}
          y1={staffTop + 28 - 9.55}
          x2={startX + NOTE_W + 0.5}
          y2={staffTop + 28 - 9.55}
          stroke={RUBRIC_RED}
          strokeWidth={2.2}
        />
      )}
      {!active && modifier === 'episemaV' && (
        <line
          x1={startX + NOTE_W / 2}
          y1={staffTop + 28 + 7.6}
          x2={startX + NOTE_W / 2}
          y2={staffTop + 28 + 13.5}
          stroke={RUBRIC_RED}
          strokeWidth={2.1}
        />
      )}
    </svg>
  );
}

export function MiniDivisionPreview({
  division,
  width,
  height,
}: {
  division: DivisionType;
  width?: number;
  height?: number;
}) {
  const staffTop = 14;
  return (
    <MiniStaffFrame width={width} height={height}>
      <g
        dangerouslySetInnerHTML={{
          __html: renderDivisionElements(division, 32, staffTop, INK_BLACK),
        }}
      />
    </MiniStaffFrame>
  );
}

export function MiniClefPreview({
  clef,
  width,
  height,
}: {
  clef: ClefType;
  width?: number;
  height?: number;
}) {
  const staffTop = 14;
  const startX = clef.startsWith('cb') ? 22 : 27;
  return (
    <MiniStaffFrame width={width} height={height}>
      <g
        dangerouslySetInnerHTML={{
          __html: renderClefElements(clef, startX, staffTop, INK_BLACK),
        }}
      />
    </MiniStaffFrame>
  );
}

export const NeumePalette: React.FC<NeumePaletteProps> = ({
  activePreset,
  toolMode,
  selection,
  activeModifiers,
  onSelectPreset,
  onStartDrag,
  onEndDrag,
  onToggleModifier,
  onInsertDivision,
  onSelectClef,
  onInsertLineBreak,
}) => {
  const handleDragStart = (e: React.DragEvent, payload: PaletteDragPayload) => {
    e.dataTransfer.setData('application/x-chant-item', JSON.stringify(payload));
    e.dataTransfer.effectAllowed = 'copy';
    onStartDrag(payload);
  };

  const selectedCount = getSelectedNoteRefs(selection).length;
  const hasSelectedNotes = selectedCount > 0;

  const renderPresetTile = (item: PresetDef) => {
    const isActive = toolMode === 'insert' && activePreset === item.id;
    const isReplaceMode = toolMode === 'select' && hasSelectedNotes;
    const isSingleShape = SINGLE_NOTES.some((s) => s.id === item.id);
    const shortcutLabel = item.shortcut ? ` (${item.shortcut})` : '';
    return (
      <button
        key={item.id}
        type="button"
        draggable
        onDragStart={(e) => handleDragStart(e, { kind: 'neume', preset: item.id })}
        onDragEnd={onEndDrag}
        onClick={() => onSelectPreset(item.id)}
        aria-pressed={isActive}
        title={
          isReplaceMode
            ? isSingleShape && selectedCount > 1
              ? `Convert ${selectedCount} selected notes into ${item.label}${shortcutLabel} — or drag onto staff`
              : `Convert selected note into ${item.label}${shortcutLabel} — or drag onto staff`
            : `Select ${item.label}${shortcutLabel} — click staff to stamp or drag onto staff`
        }
        className={`relative flex min-h-[58px] min-w-[60px] shrink-0 flex-col items-center justify-center rounded-md border px-2 py-1 transition-all cursor-grab active:cursor-grabbing focus-visible:outline-2 focus-visible:outline-[#8B1E24] ${
          isActive
            ? 'border-[#8B1E24] bg-[#8B1E24]/12 text-[#6E161B] shadow-[inset_0_0_0_1px_rgba(139,30,36,0.28)]'
            : 'border-[#D7CCB8] bg-[#FAF6EE] text-[#1D1915] hover:border-[#B5A58B] hover:bg-white'
        }`}
      >
        {item.shortcut && (
          <span
            className={`absolute right-1 top-0.5 font-[family-name:var(--font-mono)] text-[9px] tabular-nums ${
              isActive ? 'text-[#8B1E24] font-semibold' : 'text-[#8E816E]'
            }`}
          >
            {item.shortcut}
          </span>
        )}
        <MiniNeumePreview
          preset={item.id}
          anchorPitch={item.anchorPitch}
          color={isActive ? '#6E161B' : INK_BLACK}
        />
        <span className="mt-0.5 text-[10.5px] font-medium leading-none whitespace-nowrap">
          {item.label}
        </span>
      </button>
    );
  };

  return (
    <section
      aria-label="Gregorian Neume Palette"
      className="no-print w-full shrink-0 border-b border-[#CFC3AE] bg-[#F2EBE0] select-none"
    >
      <div className="flex items-stretch gap-3.5 overflow-x-auto px-4 py-1.5">
        {/* Group 1: Single Notes */}
        <div className="flex shrink-0 flex-col gap-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-semibold tracking-wide text-[#6E161B]">
              Single Notes
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            {SINGLE_NOTES.map(renderPresetTile)}
          </div>
        </div>

        <div className="w-px shrink-0 bg-[#CFC3AE] my-1" aria-hidden="true" />

        {/* Group 2: Compound Neumes */}
        <div className="flex shrink-0 flex-col gap-1">
          <span className="text-[10px] font-semibold tracking-wide text-[#6E161B]">
            Compound Neumes
          </span>
          <div className="flex items-center gap-1.5">
            {TWO_NOTE_NEUMES.map(renderPresetTile)}
            {THREE_NOTE_NEUMES.map(renderPresetTile)}
          </div>
        </div>

        <div className="w-px shrink-0 bg-[#CFC3AE] my-1" aria-hidden="true" />

        {/* Group 3: Rhythm & Signs */}
        <div className="flex shrink-0 flex-col gap-1">
          <span className="text-[10px] font-semibold tracking-wide text-[#6E161B]">
            Rhythm & Signs{' '}
            {!hasSelectedNotes ? (
              <span className="font-normal text-[#7B6F5F]">· Select note</span>
            ) : selectedCount > 1 ? (
              <span className="font-normal text-[#7B6F5F] tabular-nums">· {selectedCount} notes</span>
            ) : null}
          </span>
          <div className="flex items-center gap-1.5">
            {MODIFIERS.map((m) => {
              const active = activeModifiers[m.id];
              return (
                <button
                  key={m.id}
                  type="button"
                  disabled={!hasSelectedNotes}
                  onClick={() => onToggleModifier(m.id)}
                  aria-pressed={active}
                  title={
                    !hasSelectedNotes
                      ? `Select a note on the staff to toggle ${m.label}${m.shortcut ? ` (${m.shortcut})` : ''}`
                      : `Toggle ${m.label}${m.shortcut ? ` (${m.shortcut})` : ''}`
                  }
                  className={`relative flex min-h-[58px] min-w-[58px] shrink-0 flex-col items-center justify-center rounded-md border px-2 py-1 transition-all focus-visible:outline-2 focus-visible:outline-[#8B1E24] ${
                    !hasSelectedNotes
                      ? 'border-[#DFD6C7] bg-[#EAE2D4] text-[#9A8E7D] opacity-70 cursor-not-allowed'
                      : active
                      ? 'border-[#8B1E24] bg-[#8B1E24] text-[#FAF6EE] shadow-sm'
                      : 'border-[#D7CCB8] bg-[#FAF6EE] text-[#1D1915] hover:border-[#B5A58B] hover:bg-white'
                  }`}
                >
                  {m.shortcut && (
                    <span
                      className={`absolute right-1 top-0.5 font-[family-name:var(--font-mono)] text-[9px] ${
                        active
                          ? 'text-[#FAF6EE]/80'
                          : hasSelectedNotes
                          ? 'text-[#8E816E]'
                          : 'text-[#A69B8A]'
                      }`}
                    >
                      {m.shortcut}
                    </span>
                  )}
                  <MiniModifierPreview modifier={m.id} active={active} />
                  <span className="mt-0.5 text-[10.5px] font-medium leading-none whitespace-nowrap">
                    {m.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="w-px shrink-0 bg-[#CFC3AE] my-1" aria-hidden="true" />

        {/* Group 4: Divisions & Line Break */}
        <div className="flex shrink-0 flex-col gap-1">
          <span className="text-[10px] font-semibold tracking-wide text-[#6E161B]">
            Divisions
          </span>
          <div className="flex items-center gap-1.5">
            {DIVISIONS.map((d) => (
              <button
                key={d.id}
                type="button"
                draggable
                onDragStart={(e) => handleDragStart(e, { kind: 'division', division: d.id })}
                onDragEnd={onEndDrag}
                onClick={() => onInsertDivision(d.id)}
                title={`Click to insert or drag ${d.label} division onto staff`}
                className="flex min-h-[58px] min-w-[54px] shrink-0 flex-col items-center justify-center rounded-md border border-[#D7CCB8] bg-[#FAF6EE] px-2 py-1 text-[#1D1915] hover:border-[#B5A58B] hover:bg-white transition-all cursor-grab active:cursor-grabbing focus-visible:outline-2 focus-visible:outline-[#8B1E24]"
              >
                <MiniDivisionPreview division={d.id} />
                <span className="mt-0.5 text-[10.5px] font-medium leading-none whitespace-nowrap">
                  {d.label}
                </span>
              </button>
            ))}
            <button
              type="button"
              onClick={onInsertLineBreak}
              title="Insert forced line break (z)"
              className="flex min-h-[58px] min-w-[52px] shrink-0 flex-col items-center justify-center rounded-md border border-[#D7CCB8] bg-[#FAF6EE] px-2 py-1 text-[#1D1915] hover:border-[#B5A58B] hover:bg-white transition-all focus-visible:outline-2 focus-visible:outline-[#8B1E24]"
            >
              <span className="flex h-[40px] items-center font-[family-name:var(--font-mono)] text-base font-semibold text-[#8B1E24]">
                ↵
              </span>
              <span className="mt-0.5 text-[10.5px] font-medium leading-none whitespace-nowrap">
                Break
              </span>
            </button>
          </div>
        </div>

        <div className="w-px shrink-0 bg-[#CFC3AE] my-1" aria-hidden="true" />

        {/* Group 5: Clefs */}
        <div className="flex shrink-0 flex-col gap-1">
          <span className="text-[10px] font-semibold tracking-wide text-[#6E161B]">
            Clefs
          </span>
          <div className="flex items-center gap-1.5">
            {CLEFS.map((c) => (
              <button
                key={c.id}
                type="button"
                draggable
                onDragStart={(e) => handleDragStart(e, { kind: 'clef', clef: c.id })}
                onDragEnd={onEndDrag}
                onClick={() => onSelectClef(c.id)}
                title={`Click to set/insert ${c.label} clef or drag onto staff`}
                className="flex min-h-[58px] min-w-[56px] shrink-0 flex-col items-center justify-center rounded-md border border-[#D7CCB8] bg-[#FAF6EE] px-2 py-1 text-[#1D1915] hover:border-[#B5A58B] hover:bg-white transition-all cursor-grab active:cursor-grabbing focus-visible:outline-2 focus-visible:outline-[#8B1E24]"
              >
                <MiniClefPreview clef={c.id} />
                <span className="mt-0.5 text-[10.5px] font-medium leading-none whitespace-nowrap">
                  {c.label}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};
