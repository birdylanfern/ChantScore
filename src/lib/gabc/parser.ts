import {
  AccidentalType,
  ChantHeader,
  ChantNote,
  ChantScore,
  ClefType,
  DivisionType,
  NeumeGroup,
  NoteShape,
  ScoreItem,
} from '@/src/types/chant';
import { charToPitchIndex, PITCH_LETTERS } from './pitch';
import { lyricSignature, serializeGroupsText } from './serializeCore';

export interface GabcParseWarning {
  /** Human-readable description of what the visual model could not represent. */
  message: string;
  /** The source token concerned (truncated), when available. */
  token?: string;
}

export interface GabcParseResult {
  score: ChantScore;
  warnings: GabcParseWarning[];
}

let idCounter = 1;
export function nextId(prefix = 'id'): string {
  idCounter += 1;
  return `${prefix}_${idCounter}_${Math.random().toString(36).slice(2, 6)}`;
}

export function createEmptyScore(): ChantScore {
  return {
    header: {
      name: 'Cantus Novus',
      officePart: 'Antiphona',
      mode: 'VIII',
      annotation: 'VIII',
      initialStyle: '1',
      extraHeaders: {},
    },
    items: [
      {
        id: nextId('clef'),
        kind: 'clef',
        clef: 'c4',
      },
    ],
  };
}

const VALID_CLEF_REGEX = /^(c|f|cb|fb)[1-4]$/i;

function normalizeClef(raw: string): ClefType | null {
  const clean = raw.trim().toLowerCase();
  if (!VALID_CLEF_REGEX.test(clean)) return null;
  if (clean.startsWith('fb')) return (`f${clean[clean.length - 1]}`) as ClefType;
  if (clean === 'cb1' || clean === 'cb2') return (`c${clean[clean.length - 1]}`) as ClefType;
  return clean as ClefType;
}

function parseColoredGabcText(raw: string): {
  lyric: string;
  lyricColor?: string;
  lyricSpans?: { start: number; end: number; color: string }[];
} {
  const pre = raw
    .replace(/<alt>[\s\S]*?<\/alt>/gi, '')
    .replace(/<v>\s*\\greheightstar\s*<\/v>/gi, '*')
    .replace(/<v>\s*\\greDagger\s*<\/v>/gi, '†')
    .replace(/<v>\s*\\Vbar\s*<\/v>/gi, '℣')
    .replace(/<v>\s*\\Rbar\s*<\/v>/gi, '℟')
    .replace(/<v>\s*\\Abar\s*<\/v>/gi, 'Ⱥ')
    .replace(/<sp>\s*V\/\s*<\/sp>/gi, '℣')
    .replace(/<sp>\s*R\/\s*<\/sp>/gi, '℟')
    .replace(/<sp>\s*A\/\s*<\/sp>/gi, 'Ⱥ')
    .replace(/<sp>\s*'?(ae|æ)\s*<\/sp>/gi, 'æ')
    .replace(/<sp>\s*'?(oe|œ)\s*<\/sp>/gi, 'œ')
    .replace(/<nl\s*\/?>/gi, ' ')
    .replace(/\{([^}]*)\}/g, '$1');

  const spans: { start: number; end: number; color: string }[] = [];
  let plain = '';
  let i = 0;
  let inRubric = false;
  let rubricStart = 0;

  const tagRegex = /<\/?(?:i|b|c|sc|v|sp|alt|eu|u)[^>]*>/gi;
  let match: RegExpExecArray | null;
  let lastIdx = 0;

  while ((match = tagRegex.exec(pre)) !== null) {
    const chunk = pre.slice(lastIdx, match.index);
    if (chunk) {
      plain += chunk;
    }
    const tag = match[0].toLowerCase();
    if (tag === '<c>') {
      if (!inRubric) {
        inRubric = true;
        rubricStart = plain.length;
      }
    } else if (tag === '</c>') {
      if (inRubric) {
        if (plain.length > rubricStart) {
          spans.push({ start: rubricStart, end: plain.length, color: '#8B1E24' });
        }
        inRubric = false;
      }
    }
    lastIdx = tagRegex.lastIndex;
  }
  plain += pre.slice(lastIdx);
  if (inRubric && plain.length > rubricStart) {
    spans.push({ start: rubricStart, end: plain.length, color: '#8B1E24' });
  }

  if (spans.length === 1 && spans[0].start === 0 && spans[0].end === plain.length && plain.length > 0) {
    return { lyric: plain, lyricColor: spans[0].color };
  }
  return {
    lyric: plain,
    lyricSpans: spans.length > 0 ? spans : undefined,
  };
}

interface ParsedNoteDraft {
  pitch: number;
  shape: NoteShape;
  mora?: boolean;
  episemaH?: boolean;
  episemaV?: boolean;
  accidental?: AccidentalType;
  accidentalOnly?: boolean;
  liquescent?: boolean;
  liquescentDir?: 'asc' | 'desc' | 'dim';
}

function parseNeumeGroups(neumeStr: string, unmodeled: Set<string> = new Set()): NeumeGroup[] {
  // Strip Gregorio bracketed layout tags like [ocba:1;6mm], [cs:...], [ll:0], etc.
  if (/\[[^\]]*\]/.test(neumeStr)) unmodeled.add('layout tags [...]');
  const stripped = neumeStr.replace(/\[[^\]]*\]/g, '');
  const rawGroups = stripped.split(/[/!\s`]+/).filter(Boolean);
  const groups: NeumeGroup[] = [];

  for (const raw of rawGroups) {
    const notes: ChantNote[] = [];
    let pendingAccidental: { pitch: number; type: Exclude<AccidentalType, null> } | null = null;
    let i = 0;

    const markPrecedingNotes = (
      currentPitchDrafts: ParsedNoteDraft[],
      count: number,
      apply: (n: ParsedNoteDraft | ChantNote) => void
    ) => {
      let remaining = count;
      for (let k = currentPitchDrafts.length - 1; k >= 0 && remaining > 0; k--) {
        if (!currentPitchDrafts[k].accidentalOnly) {
          apply(currentPitchDrafts[k]);
          remaining -= 1;
        }
      }
      for (let k = notes.length - 1; k >= 0 && remaining > 0; k--) {
        if (!notes[k].accidentalOnly) {
          apply(notes[k]);
          remaining -= 1;
        }
      }
    };

    while (i < raw.length) {
      const ch = raw[i];

      // Custos markers z / Z / z0 / z+
      if (ch === 'z' || ch === 'Z') {
        unmodeled.add('custos / line-break marker inside a neume');
        i += 1;
        while (i < raw.length && /[0-9+]/.test(raw[i])) i += 1;
        continue;
      }

      // Skip braces used for neume grouping
      if (ch === '{' || ch === '}') {
        i += 1;
        continue;
      }

      if (PITCH_LETTERS.includes(ch.toLowerCase())) {
        const isUpper = ch >= 'A' && ch <= 'M';
        const pitch = charToPitchIndex(ch);
        let accidentalOnlyType: Exclude<AccidentalType, null> | null = null;
        let isExplicitCustos = false;

        const drafts: ParsedNoteDraft[] = [
          {
            pitch,
            shape: isUpper ? 'diamond' : 'punctum',
          },
        ];
        let current = drafts[0];

        i += 1;
        while (i < raw.length) {
          const mod = raw[i];
          if (
            PITCH_LETTERS.includes(mod.toLowerCase()) ||
            mod === 'z' ||
            mod === 'Z' ||
            mod === '{' ||
            mod === '}'
          ) {
            break;
          }

          if (mod === '+') {
            isExplicitCustos = true;
            i += 1;
          } else if (mod === 'v') {
            if (current.shape === 'virga') {
              current = { pitch, shape: 'virga' };
              drafts.push(current);
            } else {
              current.shape = 'virga';
            }
            i += 1;
            while (i < raw.length && /[0-9]/.test(raw[i])) i += 1;
          } else if (mod === 'V') {
            current.shape = 'virgaLeft';
            i += 1;
            while (i < raw.length && /[0-9]/.test(raw[i])) i += 1;
          } else if (mod === 'w' || mod === 'W') {
            current.shape = 'quilisma';
            i += 1;
            while (i < raw.length && /[0-9]/.test(raw[i])) i += 1;
          } else if (mod === 'o' || mod === 'O') {
            current.shape = 'oriscus';
            i += 1;
            while (i < raw.length && /[0-9]/.test(raw[i])) i += 1;
          } else if (mod === 's' || mod === 'S') {
            if (current.shape === 'stropha') {
              current = { pitch, shape: 'stropha' };
              drafts.push(current);
            } else {
              current.shape = 'stropha';
            }
            i += 1;
            while (i < raw.length && /[0-9]/.test(raw[i])) i += 1;
          } else if (mod === 'r' || mod === 'R' || mod === 'q') {
            unmodeled.add(`modifier '${mod}'`);
            i += 1;
            while (i < raw.length && /[0-9]/.test(raw[i])) i += 1;
          } else if (mod === '.') {
            let dotCount = 0;
            while (i < raw.length && raw[i] === '.') {
              dotCount += 1;
              i += 1;
              while (i < raw.length && /[0-9]/.test(raw[i])) i += 1;
            }
            current.mora = true;
            if (dotCount >= 2) {
              markPrecedingNotes(drafts.slice(0, -1), dotCount - 1, (n) => {
                n.mora = true;
              });
            }
          } else if (mod === '_') {
            let underscoreCount = 0;
            while (i < raw.length && raw[i] === '_') {
              underscoreCount += 1;
              i += 1;
              while (i < raw.length && /[0-9]/.test(raw[i])) i += 1;
            }
            current.episemaH = true;
            if (underscoreCount >= 2) {
              markPrecedingNotes(drafts.slice(0, -1), underscoreCount - 1, (n) => {
                n.episemaH = true;
              });
            }
          } else if (mod === '\'') {
            current.episemaV = true;
            i += 1;
            while (i < raw.length && /[0-9]/.test(raw[i])) i += 1;
          } else if (mod === 'x' || mod === 'X') {
            accidentalOnlyType = 'flat';
            i += 1;
          } else if (mod === 'y' || mod === 'Y') {
            accidentalOnlyType = 'natural';
            i += 1;
          } else if (mod === '#') {
            accidentalOnlyType = 'sharp';
            i += 1;
          } else if (mod === '~' || mod === '<' || mod === '>') {
            current.liquescent = true;
            current.liquescentDir = mod === '<' ? 'asc' : mod === '>' ? 'desc' : 'dim';
            i += 1;
            while (i < raw.length && /[0-9]/.test(raw[i])) i += 1;
          } else {
            unmodeled.add(`character '${mod}'`);
            i += 1;
          }
        }

        // Explicit custos (e.g. f+) is not a sounding note
        if (isExplicitCustos) {
          continue;
        }

        // In GABC, ix / iy / i# is a standalone accidental glyph (no notehead)
        if (accidentalOnlyType) {
          if (pendingAccidental) {
            notes.push({
              id: nextId('note'),
              pitch: pendingAccidental.pitch,
              shape: 'punctum',
              accidental: pendingAccidental.type,
              accidentalOnly: true,
            });
          }
          pendingAccidental = { pitch, type: accidentalOnlyType };
          continue;
        }

        let attachedAccidental: AccidentalType = null;
        if (pendingAccidental) {
          if (pendingAccidental.pitch === pitch) {
            attachedAccidental = pendingAccidental.type;
          } else {
            // Accidental on a different staff line precedes this note visually & musically
            notes.push({
              id: nextId('note'),
              pitch: pendingAccidental.pitch,
              shape: 'punctum',
              accidental: pendingAccidental.type,
              accidentalOnly: true,
            });
          }
          pendingAccidental = null;
        }

        for (let dIdx = 0; dIdx < drafts.length; dIdx++) {
          const d = drafts[dIdx];
          notes.push({
            id: nextId('note'),
            pitch: d.pitch,
            shape: d.shape,
            mora: d.mora || undefined,
            episemaH: d.episemaH || undefined,
            episemaV: d.episemaV || undefined,
            accidental: dIdx === 0 ? attachedAccidental || undefined : undefined,
            liquescent: d.liquescent || undefined,
            liquescentDir: d.liquescentDir,
          });
        }
      } else {
        unmodeled.add(`character '${ch}'`);
        i += 1;
      }
    }

    if (pendingAccidental) {
      notes.push({
        id: nextId('note'),
        pitch: pendingAccidental.pitch,
        shape: 'punctum',
        accidental: pendingAccidental.type,
        accidentalOnly: true,
      });
    }

    if (notes.length > 0) {
      groups.push({
        id: nextId('grp'),
        notes,
      });
    }
  }

  return groups;
}

export function parseGabc(raw: string): ChantScore {
  return parseGabcWithDiagnostics(raw).score;
}

export function parseGabcWithDiagnostics(raw: string): GabcParseResult {
  const warnings: GabcParseWarning[] = [];
  const normalized = raw.replace(/\r\n/g, '\n');
  const sepIdx = normalized.indexOf('%%');

  let headerText = sepIdx >= 0 ? normalized.slice(0, sepIdx) : '';
  let bodyText = sepIdx >= 0 ? normalized.slice(sepIdx + 2) : normalized;

  // If %% is omitted, still detect leading "key: value;" header lines cleanly
  if (sepIdx < 0) {
    const lines = normalized.split('\n');
    let splitLine = 0;
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].trim();
      if (!t || t.startsWith('%') || /^[a-z0-9-]+:\s*.*;\s*$/i.test(t)) {
        splitLine = i + 1;
      } else {
        break;
      }
    }
    if (splitLine > 0) {
      headerText = lines.slice(0, splitLine).join('\n');
      bodyText = lines.slice(splitLine).join('\n');
    }
  }

  const header: ChantHeader = {
    name: 'Untitled Chant',
    officePart: '',
    mode: '',
    annotation: '',
    initialStyle: '1',
    extraHeaders: {},
  };

  if (headerText.trim()) {
    const lines = headerText.split('\n');
    let currentKey = '';
    let currentVal = '';

    const commitHeader = (k: string, v: string) => {
      const key = k.trim().toLowerCase();
      const val = v.trim().replace(/;$/, '').trim();
      if (!key) return;
      if (key === 'name') header.name = val || 'Untitled Chant';
      else if (key === 'office-part') header.officePart = val;
      else if (key === 'mode') header.mode = val;
      else if (key === 'annotation') {
        if (!header.annotation) header.annotation = val;
        else (header.annotationExtra ??= []).push(val);
      } else if (key === 'initial-style') {
        header.initialStyle = val === '0' ? '0' : '1';
      } else if (key !== '%' && !key.startsWith('%')) {
        header.extraHeaders[key] = val;
      }
    };

    for (const line of lines) {
      if (line.trim().startsWith('%')) {
        if (line.trim().length > 1) warnings.push({ message: 'Header comment dropped', token: line.trim().slice(0, 60) });
        continue;
      }
      if (currentKey) {
        currentVal += '\n' + line;
        if (line.trim().endsWith(';')) {
          commitHeader(currentKey, currentVal);
          currentKey = '';
          currentVal = '';
        }
      } else {
        const colonIdx = line.indexOf(':');
        if (colonIdx > 0) {
          const k = line.slice(0, colonIdx);
          const v = line.slice(colonIdx + 1);
          if (v.trim().endsWith(';')) {
            commitHeader(k, v);
          } else {
            currentKey = k;
            currentVal = v;
          }
        }
      }
    }
    if (currentKey) commitHeader(currentKey, currentVal);
  }

  // Strip % comments, and protect <alt>...</alt> annotations (which may contain
  // parentheses) behind placeholders so they survive tokenizing and can be
  // restored into the raw lyric text.
  const altStore: string[] = [];
  const bodyLines = bodyText.split('\n');
  for (const l of bodyLines) {
    if (l.trimStart().startsWith('%') && l.trim().length > 1) {
      warnings.push({ message: 'Body comment dropped', token: l.trim().slice(0, 60) });
    }
  }
  const cleanBody = bodyLines
    .filter((l) => !l.trimStart().startsWith('%'))
    .join(' ')
    .replace(/<alt>[\s\S]*?<\/alt>/gi, (m) => {
      altStore.push(m);
      return `\u0001${altStore.length - 1}\u0002`;
    })
    .trim();
  const restoreAlt = (t: string) => t.replace(/\u0001(\d+)\u0002/g, (_, n) => altStore[Number(n)] ?? '');
  const dropAlt = (t: string) => t.replace(/\u0001\d+\u0002/g, '');

  const items: ScoreItem[] = [];
  const tokenRegex = /([^(]*)\(([^)]*)\)/g;
  let match: RegExpExecArray | null;
  let lastIndex = 0;

  const markPrevSyllableWordEnd = () => {
    if (items.length > 0) {
      const prev = items[items.length - 1];
      if (prev.kind === 'syllable') {
        prev.wordEnd = true;
      }
    }
  };

  while ((match = tokenRegex.exec(cleanBody)) !== null) {
    lastIndex = tokenRegex.lastIndex;
    const rawText = match[1];
    const rawNeume = match[2].trim();
    const neumeNoTags = rawNeume.replace(/\[[^\]]*\]/g, '').trim();

    const hadLeadingSpace = /^\s/.test(rawText);
    if (hadLeadingSpace) {
      markPrevSyllableWordEnd();
    }

    const parsedText = parseColoredGabcText(dropAlt(rawText).trim());
    const lyric = parsedText.lyric;
    const rawLyric = restoreAlt(rawText.trim());

    // 1. Clef token
    const clef = normalizeClef(neumeNoTags);
    if (clef) {
      markPrevSyllableWordEnd();
      items.push({
        id: nextId('clef'),
        kind: 'clef',
        clef,
        raw: { body: rawNeume, bodySig: clef },
      });
      continue;
    }

    // 2. Division / barline token (supports trailing digits, ?, z/Z line breaks, and virgula ' / `)
    const divMatch = neumeNoTags.match(/^(::|:|;|,|'|`)([0-9?]*)(z|Z)?$/);
    if (divMatch) {
      markPrevSyllableWordEnd();
      const rawDiv = divMatch[1];
      const division: DivisionType = rawDiv === '\'' || rawDiv === '`' ? ',' : (rawDiv as DivisionType);
      items.push({
        id: nextId('div'),
        kind: 'division',
        division,
        lyric: lyric || undefined,
        lyricColor: parsedText.lyricColor,
        raw: { lyric: rawLyric, body: rawNeume, bodySig: division },
      });
      if (divMatch[3]) {
        items.push({
          id: nextId('lb'),
          kind: 'linebreak',
          justified: divMatch[3] === 'z',
          fusedWithPrev: true,
        });
      }
      continue;
    }

    // 3. Line break or auto-custos token
    if (/^(z|Z)[0-9+]*$/.test(neumeNoTags)) {
      markPrevSyllableWordEnd();
      if (neumeNoTags === 'z' || neumeNoTags === 'Z') {
        items.push({
          id: nextId('lb'),
          kind: 'linebreak',
          justified: neumeNoTags === 'z',
        });
      } else {
        warnings.push({ message: 'Custos marker dropped (recomputed automatically)', token: `(${rawNeume})` });
      }
      continue;
    }

    // 4. Standard syllable with neume groups
    const unmodeled = new Set<string>();
    const groups = parseNeumeGroups(rawNeume, unmodeled);
    if (unmodeled.size > 0) {
      warnings.push({
        message: `Not shown in the visual score (${[...unmodeled].join(', ')}); kept in the GABC text while this syllable is unedited`,
        token: `(${rawNeume})`.slice(0, 60),
      });
    }
    const prevItem = items.length > 0 ? items[items.length - 1] : null;
    if (!lyric && prevItem && prevItem.kind === 'syllable' && groups.length > 0) {
      prevItem.groups.push(...groups);
      prevItem.wordEnd = false;
      if (prevItem.raw) prevItem.raw.body += `)(${rawNeume}`;
    } else {
      items.push({
        id: nextId('syl'),
        kind: 'syllable',
        lyric,
        wordEnd: false,
        groups,
        lyricColor: parsedText.lyricColor,
        lyricSpans: parsedText.lyricSpans,
        raw: { lyric: rawLyric, body: rawNeume, bodySig: '' },
      });
    }
  }

  // Record what the editable model serializes to right now. If it still does
  // at export time, the original text is emitted untouched.
  for (const it of items) {
    if (it.kind === 'syllable' && it.raw) {
      it.raw.bodySig = serializeGroupsText(it.groups);
      it.raw.lyricSig = lyricSignature(it);
    } else if (it.kind === 'division' && it.raw) {
      it.raw.lyricSig = lyricSignature(it);
    }
  }

  // The final syllable in the score always ends a word
  markPrevSyllableWordEnd();

  const trailing = cleanBody.slice(lastIndex).trim();
  if (trailing) {
    warnings.push({ message: 'Text after the last notation group was ignored', token: trailing.slice(0, 60) });
  }
  if (trailing && items.length === 0) {
    items.push({
      id: nextId('clef'),
      kind: 'clef',
      clef: 'c4',
    });
  }

  const hasLeadingClef = items.some((it) => it.kind === 'clef');
  if (!hasLeadingClef) {
    items.unshift({
      id: nextId('clef'),
      kind: 'clef',
      clef: 'c4',
    });
  }

  return { score: { header, items }, warnings };
}
