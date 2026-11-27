export interface GabcDiagnostic {
  severity: 'error' | 'warning';
  line: number;
  column: number;
  start: number;
  end: number;
  message: string;
}

export interface GabcValidationResult {
  valid: boolean;
  errors: GabcDiagnostic[];
  warnings: GabcDiagnostic[];
}

import { parseGabcWithDiagnostics } from './parser';

const VALID_CLEFS = new Set(['c1', 'c2', 'c3', 'c4', 'f1', 'f2', 'f3', 'f4', 'cb3', 'cb4', 'cb1', 'cb2', 'fb1', 'fb2', 'fb3', 'fb4']);
const VALID_NEUME_CHARS = /^[a-mA-M0-9vVwWoOsSrRqQxXyY#._'~<>+\-/{}[\]!`\s,:;zZ?]+$/;

function offsetToLineCol(text: string, offset: number): { line: number; column: number } {
  const slice = text.slice(0, Math.max(0, offset));
  const lines = slice.split('\n');
  return {
    line: lines.length,
    column: lines[lines.length - 1].length + 1,
  };
}

export function validateGabc(raw: string): GabcValidationResult {
  const errors: GabcDiagnostic[] = [];
  const warnings: GabcDiagnostic[] = [];
  const normalized = raw.replace(/\r\n/g, '\n');

  if (!normalized.trim()) {
    errors.push({
      severity: 'error',
      line: 1,
      column: 1,
      start: 0,
      end: 0,
      message: 'GABC source is empty. Add headers, a %% separator, and notation such as (c4) Al(f)le(g)lu(h)ia.(g.)',
    });
    return { valid: false, errors, warnings };
  }

  const sepIdx = normalized.indexOf('%%');
  if (sepIdx < 0) {
    errors.push({
      severity: 'error',
      line: 1,
      column: 1,
      start: 0,
      end: Math.min(normalized.length, 40),
      message: 'Missing "%%" separator between GABC metadata headers and chant body.',
    });
    return { valid: false, errors, warnings };
  }

  // Validate header lines
  const headerPart = normalized.slice(0, sepIdx);
  const headerLines = headerPart.split('\n');
  let headerOffset = 0;
  let inMultiline = false;

  for (let i = 0; i < headerLines.length; i++) {
    const lineText = headerLines[i];
    const trimmed = lineText.trim();
    if (trimmed && !trimmed.startsWith('%')) {
      if (inMultiline) {
        if (trimmed.endsWith(';')) inMultiline = false;
      } else {
        const colonIdx = lineText.indexOf(':');
        if (colonIdx <= 0) {
          warnings.push({
            severity: 'warning',
            line: i + 1,
            column: 1,
            start: headerOffset,
            end: headerOffset + lineText.length,
            message: `Line ${i + 1}: Header entry should use "key: value;" syntax.`,
          });
        } else if (!trimmed.endsWith(';')) {
          inMultiline = true;
        }
      }
    }
    headerOffset += lineText.length + 1;
  }

  // Scan body for parenthesis pairing and valid neume/clef tokens
  const bodyStart = sepIdx + 2;
  const body = normalized.slice(bodyStart);

  let inComment = false;
  let openParenOffset: number | null = null;
  let tokenCount = 0;
  let hasClef = false;

  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    const absIdx = bodyStart + i;

    if (ch === '\n') {
      inComment = false;
      continue;
    }
    if (inComment) continue;
    if (ch === '%' && (i === 0 || body[i - 1] === '\n')) {
      inComment = true;
      continue;
    }

    if (ch === '(') {
      if (openParenOffset !== null) {
        const pos = offsetToLineCol(normalized, absIdx);
        errors.push({
          severity: 'error',
          line: pos.line,
          column: pos.column,
          start: absIdx,
          end: absIdx + 1,
          message: `Line ${pos.line}, Col ${pos.column}: Nested "(" inside unclosed neume parenthesis.`,
        });
      } else {
        openParenOffset = absIdx;
      }
    } else if (ch === ')') {
      if (openParenOffset === null) {
        const pos = offsetToLineCol(normalized, absIdx);
        errors.push({
          severity: 'error',
          line: pos.line,
          column: pos.column,
          start: absIdx,
          end: absIdx + 1,
          message: `Line ${pos.line}, Col ${pos.column}: Unmatched closing ")" without opening "(".`,
        });
      } else {
        const inner = normalized.slice(openParenOffset + 1, absIdx).trim();
        const innerNoTags = inner.replace(/\[[^\]]*\]/g, '').trim();
        const startPos = offsetToLineCol(normalized, openParenOffset);
        tokenCount += 1;

        if (!innerNoTags) {
          // Empty () is allowed in GABC for unnoted text, but warn gently
          warnings.push({
            severity: 'warning',
            line: startPos.line,
            column: startPos.column,
            start: openParenOffset,
            end: absIdx + 1,
            message: `Line ${startPos.line}, Col ${startPos.column}: Empty "()" neume token.`,
          });
        } else {
          if (VALID_CLEFS.has(innerNoTags.toLowerCase())) {
            hasClef = true;
          } else if (/^(c|f|cb|fb)[0-9]+$/i.test(innerNoTags)) {
            errors.push({
              severity: 'error',
              line: startPos.line,
              column: startPos.column,
              start: openParenOffset,
              end: absIdx + 1,
              message: `Line ${startPos.line}, Col ${startPos.column}: Invalid clef "(${innerNoTags})" — valid staff lines are 1–4 (e.g. c4, c3, f3, cb4).`,
            });
          } else if (!VALID_NEUME_CHARS.test(innerNoTags)) {
            errors.push({
              severity: 'error',
              line: startPos.line,
              column: startPos.column,
              start: openParenOffset,
              end: absIdx + 1,
              message: `Line ${startPos.line}, Col ${startPos.column}: Unsupported character in "(${innerNoTags})". Pitch letters are a–m.`,
            });
          }
        }
        openParenOffset = null;
      }
    }
  }

  if (openParenOffset !== null) {
    const pos = offsetToLineCol(normalized, openParenOffset);
    errors.push({
      severity: 'error',
      line: pos.line,
      column: pos.column,
      start: openParenOffset,
      end: openParenOffset + 1,
      message: `Line ${pos.line}, Col ${pos.column}: Unclosed "(" — add a matching ")" to finish the neume.`,
    });
  }

  if (tokenCount === 0 && errors.length === 0) {
    errors.push({
      severity: 'error',
      line: offsetToLineCol(normalized, bodyStart).line,
      column: 1,
      start: bodyStart,
      end: normalized.length,
      message: 'No parenthesized GABC notation found after "%%". Example: (c4) Al(f)le(g)lu(h)ia.(g.)',
    });
  } else if (!hasClef && errors.length === 0) {
    warnings.push({
      severity: 'warning',
      line: offsetToLineCol(normalized, bodyStart).line,
      column: 1,
      start: bodyStart,
      end: Math.min(normalized.length, bodyStart + 16),
      message: 'No opening clef specified (defaults to c4). Consider starting with (c4) or (f3).',
    });
  }

  // Surface what the visual model cannot represent (kept in the text, but not shown on the staff).
  if (errors.length === 0) {
    try {
      let searchFrom = 0;
      for (const w of parseGabcWithDiagnostics(normalized).warnings) {
        let start = w.token ? normalized.indexOf(w.token, searchFrom) : -1;
        if (start < 0 && w.token) start = normalized.indexOf(w.token);
        if (start < 0) start = bodyStart;
        else searchFrom = start + 1;
        const pos = offsetToLineCol(normalized, start);
        warnings.push({
          severity: 'warning',
          line: pos.line,
          column: pos.column,
          start,
          end: start + (w.token?.length ?? 1),
          message: `Line ${pos.line}: ${w.message}`,
        });
      }
    } catch {
      /* diagnostics are best-effort */
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
