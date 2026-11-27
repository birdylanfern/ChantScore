import { ChantScore, ColoredTextSpan, ExportSheetStyle, OrganType } from '@/src/types/chant';
import { serializeGabc } from '@/src/lib/gabc/serializer';
import { serializeProjectJson } from '@/src/lib/projectStorage';
import type { LibraryBackupEnvelope } from '@/src/lib/scoreLibrary';
import { buildShareUrl } from '@/src/lib/shareLink';
import { embedFontsInSvg } from './fontEmbed';
import {
  paginateScoreLayout,
  pitchToY,
  ScoreLayoutResult,
  ScorePage,
} from '@/src/lib/notation/layoutEngine';
import {
  getStaffLineYs,
  INK_BLACK,
  renderClefElements,
  renderCustosMarkup,
  renderDivisionElements,
  renderGroupSvgMarkup,
  RUBRIC_RED,
  STAFF_LINE_INK,
} from '@/src/lib/notation/svgDrawing';
import {
  getFontCss,
  getMissalHeaderMetrics,
  getPageDimensions,
  resolveEffectiveWordSpacing,
  resolveScoreTypography,
  splitTextIntoColoredSegments,
} from '@/src/lib/typography';
import { buildChantTimeline } from '@/src/lib/audio/chantTimeline';
import { renderTimelineOffline } from '@/src/lib/audio/organEngine';

export interface ExportSheetOptions {
  style?: ExportSheetStyle;
  transparentPng?: boolean;
}

function slugifyTitle(name: string): string {
  const clean = (name || 'chant')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  return clean || 'gregorian-chant';
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function renderColoredTspans(
  text: string,
  baseColor: string,
  spans?: ColoredTextSpan[]
): string {
  const segments = splitTextIntoColoredSegments(text, baseColor, spans);
  if (segments.length === 1) {
    return escapeXml(segments[0].text);
  }
  return segments
    .map((seg) => `<tspan fill="${escapeXml(seg.color)}">${escapeXml(seg.text)}</tspan>`)
    .join('');
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function exportAsGabc(score: ChantScore) {
  const gabcText = serializeGabc(score);
  const blob = new Blob([gabcText], { type: 'text/plain;charset=utf-8' });
  triggerDownload(blob, `${slugifyTitle(score.header.name)}.gabc`);
}

export function exportAsProjectFile(score: ChantScore) {
  const blob = new Blob([serializeProjectJson(score)], { type: 'application/json;charset=utf-8' });
  triggerDownload(blob, `${slugifyTitle(score.header.name)}.chantscore.json`);
}

export function exportAsLibraryBackup(envelope: LibraryBackupEnvelope) {
  const dateSlug = envelope.exportedAt.slice(0, 10);
  const blob = new Blob([JSON.stringify(envelope, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
  triggerDownload(blob, `chantscore-library-${dateSlug}.chantscore-library.json`);
}

/** Copies a link that re-opens the score. Returns false when the score is too large for a URL. */
export async function copyShareLink(score: ChantScore): Promise<'copied' | 'too-large' | 'failed'> {
  const url = buildShareUrl(serializeGabc(score), window.location.href);
  if (!url) return 'too-large';
  try {
    await navigator.clipboard.writeText(url);
    return 'copied';
  } catch {
    return copyTextBestEffort(url) ? 'copied' : 'failed';
  }
}

export const SOURCE_AND_SUMMIT_EDITOR_URL = 'https://www.sourceandsummit.com/editor/alpha/';

function copyTextBestEffort(text: string): boolean {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(text).catch(() => {});
    return true;
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.className = 'sr-only';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export function exportToSourceAndSummit(score: ChantScore): {
  copied: boolean;
  hashIncluded: boolean;
} {
  const gabcText = serializeGabc(score);
  const copied = copyTextBestEffort(gabcText);
  const encodedHash = encodeURIComponent(gabcText);
  const hashIncluded = encodedHash.length <= 64000;
  const targetUrl = hashIncluded
    ? `${SOURCE_AND_SUMMIT_EDITOR_URL}#${encodedHash}`
    : SOURCE_AND_SUMMIT_EDITOR_URL;

  const a = document.createElement('a');
  a.href = targetUrl;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  return { copied, hashIncluded };
}

function renderPageSystemsSvg(
  score: ChantScore,
  page: ScorePage,
  layout: ScoreLayoutResult,
  opts: {
    firstSylIdx: number;
    dropCapChar: string;
    lyricFontCss: string;
    titleFontCss: string;
    lyricFontSize: number;
    inkColor: string;
    staffInkColor: string;
    staffOpacity: number;
    staffWidth: number;
    divisionLyricFallbackColor: string;
    dropCapFallbackColor: string;
    rubricSymbolsRed?: boolean;
    officeLabelAboveDropCap?: string;
    officeLabelColor?: string;
    officeLabelSpans?: ColoredTextSpan[];
    modeLabelAboveDropCap?: string;
    officePartFontSize?: number;
    modeFontSize?: number;
    modeLabelColor?: string;
  }
): string[] {
  const parts: string[] = [];

  for (const ps of page.systems) {
    const sys = ps.system;
    const yTop = ps.pageYTop;
    const lineYs = getStaffLineYs(yTop);
    const staffStartX =
      sys.systemIndex === 0 && opts.dropCapChar
        ? layout.staffStartXFirstSystem
        : layout.staffLeftX;

    for (const ly of lineYs) {
      parts.push(
        `<line x1="${staffStartX}" y1="${ly}" x2="${layout.staffRightX}" y2="${ly}" stroke="${opts.staffInkColor}" stroke-opacity="${opts.staffOpacity}" stroke-width="${opts.staffWidth}" />`
      );
    }

    if (sys.systemIndex === 0 && opts.dropCapChar) {
      const dropCapTopBaseY = Math.min(
        yTop - 7,
        yTop + layout.lyricYOffset - layout.dropCapFontSize * 0.72 - 7
      );
      const hasOfficeAbove = Boolean(opts.officeLabelAboveDropCap);
      const hasModeAbove = Boolean(opts.modeLabelAboveDropCap);

      if (hasOfficeAbove && opts.officeLabelAboveDropCap) {
        const officeY = hasModeAbove ? dropCapTopBaseY - 14 : dropCapTopBaseY;
        const maxCenteredW = Math.max(40, (layout.dropCapCenterX - 24) * 2);
        const estW = opts.officeLabelAboveDropCap.length * 5.8;
        const alignStart = estW > maxCenteredW;
        const officeX = alignStart ? 24 : layout.dropCapCenterX;
        const anchor = alignStart ? 'start' : 'middle';
        const officeBaseColor = opts.officeLabelColor || opts.inkColor;
        parts.push(
          `<text x="${officeX}" y="${officeY}" text-anchor="${anchor}" font-family="${escapeXml(opts.lyricFontCss)}" font-size="${opts.officePartFontSize ?? 11.5}" font-style="italic" fill="${escapeXml(officeBaseColor)}">${renderColoredTspans(opts.officeLabelAboveDropCap, officeBaseColor, opts.officeLabelSpans)}</text>`
        );
      }

      if (hasModeAbove && opts.modeLabelAboveDropCap) {
        const maxCenteredW = Math.max(40, (layout.dropCapCenterX - 24) * 2);
        const estW = opts.modeLabelAboveDropCap.length * 6.4;
        const alignStart = estW > maxCenteredW;
        const modeX = alignStart ? 24 : layout.dropCapCenterX;
        const anchor = alignStart ? 'start' : 'middle';
        parts.push(
          `<text x="${modeX}" y="${dropCapTopBaseY}" text-anchor="${anchor}" font-family="${escapeXml(opts.titleFontCss)}" font-size="${opts.modeFontSize ?? 11}" font-weight="600" letter-spacing="0.8" fill="${escapeXml(opts.modeLabelColor || opts.inkColor)}">${escapeXml(opts.modeLabelAboveDropCap)}</text>`
        );
      }
      parts.push(
        `<text x="${layout.dropCapCenterX}" y="${yTop + layout.lyricYOffset}" text-anchor="middle" font-family="${escapeXml(opts.titleFontCss)}" font-size="${layout.dropCapFontSize}" font-weight="600" fill="${escapeXml(score.header.dropCapColor || opts.dropCapFallbackColor)}">${escapeXml(opts.dropCapChar)}</text>`
      );
    }

    if (sys.showOpeningClef) {
      const clefStartX = layout.staffLeftX + 4;
      parts.push(renderClefElements(sys.openingClef, clefStartX, yTop, opts.inkColor));
    }

    for (const placed of sys.items) {
      const item = placed.item;
      if (item.kind === 'clef') {
        parts.push(renderClefElements(item.clef, placed.neumeStartX, yTop, opts.inkColor));
      } else if (item.kind === 'division') {
        parts.push(renderDivisionElements(item.division, placed.neumeStartX, yTop, opts.inkColor));
        if (item.lyric) {
          parts.push(
            `<text x="${placed.lyricX}" y="${yTop + layout.lyricYOffset}" text-anchor="middle" font-family="${escapeXml(opts.lyricFontCss)}" font-size="${opts.lyricFontSize}" font-style="italic" fill="${escapeXml(item.lyricColor || opts.divisionLyricFallbackColor)}">${escapeXml(item.lyric)}</text>`
          );
        }
      } else if (item.kind === 'syllable') {
        if (placed.groups) {
          for (const pg of placed.groups) {
            parts.push(renderGroupSvgMarkup(pg.groupLayout, pg.x, yTop, opts.inkColor));
          }
        }
        const isFirstTextSyl =
          placed.indexInScore === opts.firstSylIdx && opts.dropCapChar.length > 0;
        const textToShow = isFirstTextSyl ? item.lyric.slice(1) : item.lyric;
        const display = textToShow + (!item.wordEnd && textToShow ? '-' : '');
        const defaultColor =
          opts.rubricSymbolsRed && (display === '*' || display === '†')
            ? RUBRIC_RED
            : opts.inkColor;
        const baseColor = item.lyricColor || defaultColor;
        const shiftedSpans =
          isFirstTextSyl && item.lyricSpans
            ? item.lyricSpans
                .map((sp) => ({ ...sp, start: sp.start - 1, end: sp.end - 1 }))
                .filter((sp) => sp.end > 0)
            : item.lyricSpans;

        if (display) {
          parts.push(
            `<text x="${placed.lyricX}" y="${yTop + layout.lyricYOffset}" text-anchor="middle" font-family="${escapeXml(opts.lyricFontCss)}" font-size="${opts.lyricFontSize}" fill="${escapeXml(baseColor)}">${renderColoredTspans(display, baseColor, shiftedSpans)}</text>`
          );
        }
      }
    }

    if (sys.custosPitch !== null) {
      const cy = pitchToY(sys.custosPitch, yTop);
      parts.push(renderCustosMarkup(layout.staffRightX - 9, cy, sys.custosPitch, opts.inkColor));
    }
  }

  return parts;
}

function buildMissalPageSvgs(
  score: ChantScore,
  transparent = false,
  forPrint = false
): {
  pageSvgs: string[];
  width: number;
  height: number;
} {
  const pageDims = getPageDimensions(score.pageSetup);
  const typo = resolveScoreTypography(score.typography);
  const effectiveWordSpacing = resolveEffectiveWordSpacing(
    typo.wordSpacing,
    typo.lyricFontSize,
    forPrint
  );
  const lyricFontCss = getFontCss(typo.lyricFont, 'eb-garamond');
  const titleFontCss = getFontCss(typo.titleFont, 'cinzel');

  const pageWidth = pageDims.svgWidth;
  const pageHeight = pageDims.svgHeight;
  const { titleY, ruleY, firstPageHeaderHeight } = getMissalHeaderMetrics(typo.titleFontSize);

  const { layout, pages } = paginateScoreLayout(
    score,
    pageWidth,
    pageHeight,
    true,
    {
      lyricFontCss,
      lyricFontSize: typo.lyricFontSize,
      dropCapFontCss: titleFontCss,
      lineSpacing: typo.lineSpacing,
      wordSpacing: effectiveWordSpacing,
    },
    {
      firstPageHeaderHeight,
      contPageHeaderHeight: 36,
      firstSystemTopPad: 24,
      bottomMargin: 52,
    }
  );

  const firstSylIdx = score.items.findIndex(
    (s) => s.kind === 'syllable' && s.lyric.trim().length > 0
  );
  const firstSyl = firstSylIdx >= 0 ? score.items[firstSylIdx] : null;
  const dropCapChar =
    score.header.initialStyle !== '0' &&
    firstSyl &&
    firstSyl.kind === 'syllable' &&
    firstSyl.lyric.trim().length > 0
      ? firstSyl.lyric.trim()[0].toUpperCase()
      : '';

  const officeText = score.header.officePart?.trim() || '';
  const rawModeText = score.header.mode?.trim() || '';
  const modeDisplayTop = rawModeText ? `Mode ${rawModeText}` : '';
  const annotationText = score.header.annotation?.trim() || '';
  const modeAboveDropCap = (rawModeText || annotationText).trim();
  const topRightAnnotation =
    annotationText &&
    annotationText !== rawModeText &&
    annotationText !== officeText
      ? annotationText
      : '';
  const metaSize = Math.min(18, Math.max(10, Math.round(typo.titleFontSize * 0.42)));

  const pageSvgs = pages.map((page) => {
    const parts: string[] = [];
    parts.push(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${pageWidth}" height="${pageHeight}" viewBox="0 0 ${pageWidth} ${pageHeight}">`
    );

    if (!transparent) {
      parts.push(`<rect x="0" y="0" width="${pageWidth}" height="${pageHeight}" fill="#FAF6EE" />`);
    }
    parts.push(
      `<rect x="16" y="16" width="${pageWidth - 32}" height="${pageHeight - 32}" fill="none" stroke="#D8CFC0" stroke-width="1" />`
    );

    if (page.pageIndex === 0) {
      if (!dropCapChar && (officeText || modeDisplayTop)) {
        parts.push(
          `<text x="48" y="54" font-family="${escapeXml(titleFontCss)}" font-size="${typo.officePartFontSize}" letter-spacing="1.6" fill="${escapeXml(score.header.officePartColor || RUBRIC_RED)}">`
        );
        if (officeText) {
          parts.push(
            renderColoredTspans(
              officeText.toUpperCase(),
              score.header.officePartColor || RUBRIC_RED,
              score.header.officePartSpans
            )
          );
        }
        if (officeText && modeDisplayTop) {
          parts.push(`<tspan fill="${RUBRIC_RED}">  ·  </tspan>`);
        }
        if (modeDisplayTop) {
          parts.push(
            `<tspan fill="${escapeXml(score.header.modeColor || RUBRIC_RED)}">${escapeXml(modeDisplayTop.toUpperCase())}</tspan>`
          );
        }
        parts.push(`</text>`);
      }

      if (topRightAnnotation || (!dropCapChar && annotationText && annotationText !== rawModeText)) {
        const rightText = dropCapChar ? topRightAnnotation : annotationText;
        if (rightText) {
          parts.push(
            `<text x="${pageWidth - 48}" y="54" text-anchor="end" font-family="${escapeXml(titleFontCss)}" font-size="${metaSize}" letter-spacing="1.4" fill="${escapeXml(score.header.annotationColor || RUBRIC_RED)}">${escapeXml(rightText.toUpperCase())}</text>`
          );
        }
      }

      const titleText = score.header.name || 'Cantus Novus';
      parts.push(
        `<text x="${pageWidth / 2}" y="${titleY}" text-anchor="middle" font-family="${escapeXml(titleFontCss)}" font-size="${typo.titleFontSize}" font-weight="600" fill="${escapeXml(score.header.titleColor || INK_BLACK)}">${renderColoredTspans(titleText, score.header.titleColor || INK_BLACK, score.header.titleSpans)}</text>`
      );

      const rulePad = Math.min(120, Math.round(pageWidth * 0.14));
      parts.push(
        `<line x1="${rulePad}" y1="${ruleY}" x2="${pageWidth - rulePad}" y2="${ruleY}" stroke="${RUBRIC_RED}" stroke-opacity="0.38" stroke-width="1" />`
      );
    }

    parts.push(
      ...renderPageSystemsSvg(score, page, layout, {
        firstSylIdx,
        dropCapChar,
        lyricFontCss,
        titleFontCss,
        lyricFontSize: typo.lyricFontSize,
        inkColor: INK_BLACK,
        staffInkColor: STAFF_LINE_INK,
        staffOpacity: 0.78,
        staffWidth: 0.9,
        divisionLyricFallbackColor: RUBRIC_RED,
        dropCapFallbackColor: RUBRIC_RED,
        rubricSymbolsRed: true,
        officeLabelAboveDropCap: page.pageIndex === 0 && dropCapChar ? officeText : undefined,
        officeLabelColor: score.header.officePartColor || RUBRIC_RED,
        officeLabelSpans: score.header.officePartSpans,
        officePartFontSize: typo.officePartFontSize,
        modeFontSize: typo.modeFontSize,
        modeLabelAboveDropCap: page.pageIndex === 0 && dropCapChar ? modeAboveDropCap : undefined,
        modeLabelColor: score.header.modeColor || score.header.annotationColor || RUBRIC_RED,
      })
    );

    if (pages.length > 1) {
      parts.push(
        `<text x="${pageWidth / 2}" y="${pageHeight - 28}" text-anchor="middle" font-family="${escapeXml(titleFontCss)}" font-size="11" letter-spacing="1.2" fill="#6B6257">— ${page.pageIndex + 1} —</text>`
      );
    }

    parts.push('</svg>');
    return parts.join('');
  });

  return { pageSvgs, width: pageWidth, height: pageHeight };
}

function buildChantSheetPageSvgs(
  score: ChantScore,
  transparent = false,
  redInk = false,
  forPrint = false
): {
  pageSvgs: string[];
  width: number;
  height: number;
} {
  const pageDims = getPageDimensions(score.pageSetup);
  const typo = resolveScoreTypography(score.typography);
  const effectiveWordSpacing = resolveEffectiveWordSpacing(
    typo.wordSpacing,
    typo.lyricFontSize,
    forPrint
  );
  const lyricFontCss = getFontCss(typo.lyricFont, 'eb-garamond');
  const titleFontCss = getFontCss(typo.titleFont, 'eb-garamond');

  const pageWidth = pageDims.svgWidth;
  const pageHeight = pageDims.svgHeight;

  const hasTitle = Boolean(score.header.name && score.header.name.trim());
  const officeText = score.header.officePart?.trim() || '';
  const rawModeText = score.header.mode?.trim() || '';
  const annotationText = score.header.annotation?.trim() || '';
  const modeLabel = (rawModeText || annotationText).trim();
  const topRightAnnotation =
    annotationText && annotationText !== rawModeText && annotationText !== officeText
      ? annotationText
      : '';
  const hasOffice = officeText.length > 0;
  const titleHeightExtra = Math.max(0, typo.titleFontSize - 24);
  const firstPageHeaderHeight =
    (hasTitle ? 92 : hasOffice || modeLabel ? 52 : 24) + Math.round(titleHeightExtra * 1.15);

  const { layout, pages } = paginateScoreLayout(
    score,
    pageWidth,
    pageHeight,
    true,
    {
      lyricFontCss,
      lyricFontSize: typo.lyricFontSize,
      dropCapFontCss: titleFontCss,
      lineSpacing: typo.lineSpacing,
      wordSpacing: effectiveWordSpacing,
    },
    {
      firstPageHeaderHeight,
      contPageHeaderHeight: 36,
      firstSystemTopPad: 24,
      bottomMargin: 48,
    }
  );

  const sheetInk = '#111111';
  const sheetStaffInk = redInk ? RUBRIC_RED : '#2B2B2B';
  const sheetMetaInk = '#3A3A3A';
  const rubricOrBlack = redInk ? RUBRIC_RED : sheetInk;
  const metaFallback = redInk ? RUBRIC_RED : sheetMetaInk;

  const firstSylIdx = score.items.findIndex(
    (s) => s.kind === 'syllable' && s.lyric.trim().length > 0
  );
  const firstSyl = firstSylIdx >= 0 ? score.items[firstSylIdx] : null;
  const dropCapChar =
    score.header.initialStyle !== '0' &&
    firstSyl &&
    firstSyl.kind === 'syllable' &&
    firstSyl.lyric.trim().length > 0
      ? firstSyl.lyric.trim()[0].toUpperCase()
      : '';

  const pageSvgs = pages.map((page) => {
    const parts: string[] = [];
    parts.push(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${pageWidth}" height="${pageHeight}" viewBox="0 0 ${pageWidth} ${pageHeight}">`
    );

    if (!transparent) {
      parts.push(`<rect x="0" y="0" width="${pageWidth}" height="${pageHeight}" fill="#FFFFFF" />`);
    }

    if (page.pageIndex === 0) {
      if (hasOffice && !dropCapChar) {
        const officeColor = score.header.officePartColor || metaFallback;
        parts.push(
          `<text x="${layout.staffLeftX}" y="38" font-family="${escapeXml(lyricFontCss)}" font-size="${typo.officePartFontSize}" font-style="italic" fill="${escapeXml(officeColor)}">${renderColoredTspans(officeText, officeColor, score.header.officePartSpans)}</text>`
        );
      }

      if ((modeLabel && !dropCapChar) || (dropCapChar && topRightAnnotation)) {
        const rightText = dropCapChar
          ? topRightAnnotation
          : rawModeText
          ? `Mode ${rawModeText}`
          : modeLabel;
        const modeColor = score.header.modeColor || score.header.annotationColor || metaFallback;
        parts.push(
          `<text x="${layout.staffRightX}" y="38" text-anchor="end" font-family="${escapeXml(lyricFontCss)}" font-size="${typo.modeFontSize}" fill="${escapeXml(modeColor)}">${escapeXml(rightText)}</text>`
        );
      }

      if (hasTitle) {
        const titleColor = score.header.titleColor || sheetInk;
        const titleY = 58 + Math.round(titleHeightExtra * 0.92);
        parts.push(
          `<text x="${pageWidth / 2}" y="${titleY}" text-anchor="middle" font-family="${escapeXml(titleFontCss)}" font-size="${typo.titleFontSize}" font-weight="600" letter-spacing="0.4" fill="${escapeXml(titleColor)}">${renderColoredTspans(score.header.name.trim(), titleColor, score.header.titleSpans)}</text>`
        );
      }
    }

    parts.push(
      ...renderPageSystemsSvg(score, page, layout, {
        firstSylIdx,
        dropCapChar,
        lyricFontCss,
        titleFontCss,
        lyricFontSize: typo.lyricFontSize,
        inkColor: sheetInk,
        staffInkColor: sheetStaffInk,
        staffOpacity: redInk ? 0.8 : 0.88,
        staffWidth: 0.85,
        divisionLyricFallbackColor: rubricOrBlack,
        dropCapFallbackColor: rubricOrBlack,
        rubricSymbolsRed: redInk,
        officeLabelAboveDropCap: page.pageIndex === 0 && dropCapChar ? officeText : undefined,
        officeLabelColor: score.header.officePartColor || rubricOrBlack,
        officeLabelSpans: score.header.officePartSpans,
        officePartFontSize: typo.officePartFontSize,
        modeFontSize: typo.modeFontSize,
        modeLabelAboveDropCap: page.pageIndex === 0 && dropCapChar ? modeLabel : undefined,
        modeLabelColor: score.header.modeColor || score.header.annotationColor || rubricOrBlack,
      })
    );

    if (pages.length > 1) {
      parts.push(
        `<text x="${pageWidth / 2}" y="${pageHeight - 24}" text-anchor="middle" font-family="${escapeXml(lyricFontCss)}" font-size="11" fill="${sheetMetaInk}">${page.pageIndex + 1}</text>`
      );
    }

    parts.push('</svg>');
    return parts.join('');
  });

  return { pageSvgs, width: pageWidth, height: pageHeight };
}

async function svgToCanvas(
  svgString: string,
  width: number,
  height: number,
  scale = 3,
  bgFill: string | null = '#FAF6EE'
): Promise<HTMLCanvasElement> {
  const svgBlob = new Blob([await embedFontsInSvg(svgString)], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = (err) => reject(err);
      image.src = url;
    });

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    ctx.scale(scale, scale);
    if (bgFill) {
      ctx.fillStyle = bgFill;
      ctx.fillRect(0, 0, width, height);
    }
    ctx.drawImage(img, 0, 0, width, height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function exportAsPng(
  score: ChantScore,
  options: ExportSheetOptions = {}
): Promise<{ pageCount: number; pixelWidth: number; pixelHeight: number; isZip: boolean }> {
  const style = options.style ?? 'missal';
  const transparent = Boolean(options.transparentPng);
  const isSheet = style === 'sheet' || style === 'sheet-red';
  const { pageSvgs, width, height } = isSheet
    ? buildChantSheetPageSvgs(score, transparent, style === 'sheet-red')
    : buildMissalPageSvgs(score, transparent);

  // 300 DPI exact pixel resolution relative to 100 SVG units/inch
  const scale = 3;
  const bgFill = transparent ? null : isSheet ? '#FFFFFF' : '#FAF6EE';
  const baseSlug = slugifyTitle(score.header.name);
  const suffix =
    style === 'sheet-red' ? '-sheet-red' : style === 'sheet' ? '-sheet' : '';

  if (pageSvgs.length === 1) {
    const canvas = await svgToCanvas(pageSvgs[0], width, height, scale, bgFill);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG export failed'))), 'image/png');
    });
    triggerDownload(blob, `${baseSlug}${suffix}.png`);
    return {
      pageCount: 1,
      pixelWidth: Math.round(width * scale),
      pixelHeight: Math.round(height * scale),
      isZip: false,
    };
  }

  // Loaded on demand so these large libraries are not part of the initial bundle.
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const padWidth = pageSvgs.length >= 10 ? 2 : 1;
  for (let i = 0; i < pageSvgs.length; i++) {
    const canvas = await svgToCanvas(pageSvgs[i], width, height, scale, bgFill);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG export failed'))), 'image/png');
    });
    const pageNum = String(i + 1).padStart(padWidth, '0');
    zip.file(`${baseSlug}${suffix}-page-${pageNum}.png`, blob);
  }

  const zipBlob = await zip.generateAsync({ type: 'blob' });
  triggerDownload(zipBlob, `${baseSlug}${suffix}-pages.zip`);

  return {
    pageCount: pageSvgs.length,
    pixelWidth: Math.round(width * scale),
    pixelHeight: Math.round(height * scale),
    isZip: true,
  };
}

export async function exportAsPdf(
  score: ChantScore,
  options: ExportSheetOptions = {}
): Promise<{ pageCount: number }> {
  const style = options.style ?? 'missal';
  const isSheet = style === 'sheet' || style === 'sheet-red';
  const pageDims = getPageDimensions(score.pageSetup);
  const pageBg = isSheet ? '#FFFFFF' : '#FAF6EE';
  const { pageSvgs, width, height } = isSheet
    ? buildChantSheetPageSvgs(score, false, style === 'sheet-red', true)
    : buildMissalPageSvgs(score, false, true);

  const scale = 2.5;
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({
    orientation: pageDims.orientation,
    unit: 'pt',
    format: [pageDims.spec.widthPt, pageDims.spec.heightPt],
  });

  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();

  for (let i = 0; i < pageSvgs.length; i++) {
    if (i > 0) pdf.addPage();
    pdf.setFillColor(pageBg);
    pdf.rect(0, 0, pageW, pageH, 'F');
    const canvas = await svgToCanvas(pageSvgs[i], width, height, scale, pageBg);
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, pageW, pageH);
  }

  const suffix =
    style === 'sheet-red' ? '-sheet-red' : style === 'sheet' ? '-sheet' : '';
  pdf.save(`${slugifyTitle(score.header.name)}${suffix}.pdf`);
  return { pageCount: pageSvgs.length };
}

function floatToInt16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

export async function exportAsMp3(
  score: ChantScore,
  organ: OrganType,
  tempoBpm: number,
  transposeSemitones: number
) {
  const timeline = buildChantTimeline(score, tempoBpm, transposeSemitones);
  const sampleRate = 44100;
  const audioBuffer = await renderTimelineOffline(timeline, organ, sampleRate);

  const left = floatToInt16(audioBuffer.getChannelData(0));
  const right = floatToInt16(
    audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : audioBuffer.getChannelData(0)
  );

  const { Mp3Encoder } = await import('@breezystack/lamejs');
  const encoder = new Mp3Encoder(2, sampleRate, 192);
  const chunkSize = 1152;
  const mp3Parts: Uint8Array[] = [];

  for (let i = 0; i < left.length; i += chunkSize) {
    const lChunk = left.subarray(i, i + chunkSize);
    const rChunk = right.subarray(i, i + chunkSize);
    const encoded = encoder.encodeBuffer(lChunk, rChunk);
    if (encoded.length > 0) {
      mp3Parts.push(new Uint8Array(encoded));
    }
  }

  const flushed = encoder.flush();
  if (flushed.length > 0) {
    mp3Parts.push(new Uint8Array(flushed));
  }

  const blob = new Blob(mp3Parts as BlobPart[], { type: 'audio/mpeg' });
  triggerDownload(blob, `${slugifyTitle(score.header.name)}.mp3`);
}
