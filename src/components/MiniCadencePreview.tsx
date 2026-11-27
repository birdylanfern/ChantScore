import React, { useMemo } from 'react';
import { ClefType, NeumeGroup } from '@/src/types/chant';
import { parseGabc } from '@/src/lib/gabc/parser';
import { layoutNeumeGroup, NOTE_W, STAFF_LINE_SPACING } from '@/src/lib/notation/layoutEngine';
import {
  INK_BLACK,
  renderClefElements,
  renderGroupSvgMarkup,
  RUBRIC_RED,
  STAFF_LINE_INK,
} from '@/src/lib/notation/svgDrawing';
import { cadenceSpecToPreviewTokens } from '@/src/lib/tones/toneUi';

interface MiniCadencePreviewProps {
  clef: string;
  tenor: string;
  spec: string;
  label?: string;
}

export const MiniCadencePreview: React.FC<MiniCadencePreviewProps> = ({
  clef,
  tenor,
  spec,
  label,
}) => {
  const preview = useMemo(() => {
    const parsed = cadenceSpecToPreviewTokens(spec, tenor);
    if (!parsed) return { kind: 'invalid' as const };
    if (parsed.isNone) {
      return { kind: 'none' as const, recite: parsed.recite };
    }

    const safeClef = /^(c|f)b?[1-4]$/i.test(clef.trim()) ? clef.trim().toLowerCase() : 'c4';
    const gabcParts = [
      `(${safeClef})`,
      `(${parsed.recite})`,
      ...parsed.slots.map((s) => `(${s.gabc})`),
    ];
    const scoreRes = parseGabc(`%%\n${gabcParts.join(' ')}`);
    const clefItem = scoreRes.items.find((it) => it.kind === 'clef');
    const resolvedClef: ClefType = clefItem?.kind === 'clef' ? clefItem.clef : 'c4';
    const syllableGroups: NeumeGroup[] = [];
    for (const it of scoreRes.items) {
      if (it.kind === 'syllable') {
        syllableGroups.push(...it.groups);
      }
    }

    // syllableGroups[0] is the reciting note; the remainder correspond 1-to-1 with parsed.slots
    if (syllableGroups.length !== parsed.slots.length + 1) {
      return { kind: 'chips' as const, recite: parsed.recite, slots: parsed.slots };
    }

    const clefWidth = resolvedClef.startsWith('cb') ? 26 : 16;
    const staffTop = 14;
    let x = 8 + clefWidth + 4;
    const renderedGroups: { markup: string; dividerX?: number }[] = [];

    syllableGroups.forEach((grp, idx) => {
      const slot = idx > 0 ? parsed.slots[idx - 1] : null;
      let dividerX: number | undefined;
      if (slot?.segmentBreakBefore) {
        dividerX = x + 1;
        x += 6;
      }
      const layout = layoutNeumeGroup(grp);
      const color = idx === 0 ? '#7C7060' : slot?.accent ? RUBRIC_RED : INK_BLACK;
      const markup = renderGroupSvgMarkup(layout, x, staffTop, color);
      renderedGroups.push({ markup, dividerX });
      x += Math.max(NOTE_W, layout.width) + (idx === 0 ? 9 : 6);
    });

    const totalWidth = Math.max(88, Math.ceil(x + 4));
    const clefMarkup = renderClefElements(resolvedClef, 8, staffTop, INK_BLACK);
    return {
      kind: 'staff' as const,
      width: totalWidth,
      staffTop,
      clefMarkup,
      renderedGroups,
    };
  }, [clef, tenor, spec]);

  if (preview.kind === 'invalid') {
    return (
      <span className="inline-flex h-7 items-center rounded border border-dashed border-[#CFC3AE] bg-[#FAF6EE] px-2 text-[10px] text-[#8A7E6D]">
        —
      </span>
    );
  }

  if (preview.kind === 'none') {
    return (
      <span className="inline-flex h-7 items-center rounded border border-[#DDD3C1] bg-[#FAF6EE] px-2 text-[10px] text-[#6B6257] whitespace-nowrap">
        Recites on <code className="ml-1 font-semibold text-[#1D1915]">{preview.recite}</code>
      </span>
    );
  }

  if (preview.kind === 'chips') {
    return (
      <div
        className="inline-flex h-7 items-center gap-1 rounded border border-[#DDD3C1] bg-[#FAF6EE] px-1.5 font-[family-name:var(--font-mono)] text-[10px]"
        aria-label={label ? `${label} notes preview` : 'Cadence notes preview'}
      >
        <span className="text-[#7C7060]">{preview.recite}</span>
        {preview.slots.map((s, idx) => (
          <React.Fragment key={idx}>
            {s.segmentBreakBefore && <span className="text-[#9E917B]">/</span>}
            <span
              className={`rounded px-1 ${
                s.accent ? 'bg-[#FBF2F2] font-bold text-[#8B1E24]' : 'text-[#1D1915]'
              }`}
            >
              {s.gabc}
            </span>
          </React.Fragment>
        ))}
      </div>
    );
  }

  return (
    <svg
      width={Math.min(180, preview.width)}
      height={36}
      viewBox={`0 0 ${preview.width} 66`}
      role="img"
      aria-label={label ? `${label} staff preview` : 'Cadence staff preview'}
      className="shrink-0 rounded border border-[#DDD3C1] bg-[#FAF6EE]"
    >
      {[0, 1, 2, 3].map((i) => (
        <line
          key={i}
          x1={4}
          y1={preview.staffTop + i * STAFF_LINE_SPACING}
          x2={preview.width - 4}
          y2={preview.staffTop + i * STAFF_LINE_SPACING}
          stroke={STAFF_LINE_INK}
          strokeOpacity={0.35}
          strokeWidth={1.1}
        />
      ))}
      <g dangerouslySetInnerHTML={{ __html: preview.clefMarkup }} />
      {preview.renderedGroups.map((g, idx) => (
        <React.Fragment key={idx}>
          {g.dividerX !== undefined && (
            <line
              x1={g.dividerX}
              y1={preview.staffTop + 4}
              x2={g.dividerX}
              y2={preview.staffTop + STAFF_LINE_SPACING * 3 - 4}
              stroke="#B8AA93"
              strokeWidth={1}
              strokeDasharray="2 2"
            />
          )}
          <g dangerouslySetInnerHTML={{ __html: g.markup }} />
        </React.Fragment>
      ))}
    </svg>
  );
};
