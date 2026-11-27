import { ChantScore, SelectionState } from '@/src/types/chant';
import {
  clefUsesRaw,
  divisionUsesRaw,
  headerLines,
  lyricToGabc,
  serializeGroupWithOffsets,
  syllableUsesRawBody,
} from './serializeCore';

export interface GabcSpan {
  itemId: string;
  groupId?: string;
  noteId?: string;
  start: number;
  end: number;
  tokenStart: number;
  tokenEnd: number;
}

export function serializeGabcWithMap(score: ChantScore): {
  gabc: string;
  spans: GabcSpan[];
} {
  const headerPrefix = headerLines(score).join('\n') + '\n';
  let body = '';
  const spans: GabcSpan[] = [];
  // A line break written inside the previous division token (e.g. "(:z)") is
  // already part of that token's raw text and must not be emitted twice.
  let prevDivisionRaw = false;

  const simpleSpan = (itemId: string, token: string) => {
    const tokenStart = headerPrefix.length + body.length;
    const tokenEnd = tokenStart + token.length;
    spans.push({ itemId, start: tokenStart, end: tokenEnd, tokenStart, tokenEnd });
  };

  for (let i = 0; i < score.items.length; i++) {
    const item = score.items[i];
    const wasDivisionRaw = prevDivisionRaw;
    prevDivisionRaw = false;

    if (item.kind === 'clef') {
      const token = `(${clefUsesRaw(item) ? item.raw!.body : item.clef})`;
      simpleSpan(item.id, token);
      body += `${token} `;
    } else if (item.kind === 'division') {
      const useRaw = divisionUsesRaw(item);
      const token = `${lyricToGabc(item)}(${useRaw ? item.raw!.body : item.division})`;
      simpleSpan(item.id, token);
      body += `${token} `;
      prevDivisionRaw = useRaw;
    } else if (item.kind === 'linebreak') {
      if (item.fusedWithPrev && wasDivisionRaw) {
        // Already emitted as part of the preceding division token; make the
        // preceding token's trailing space a newline instead.
        body = body.replace(/ $/, '\n');
        continue;
      }
      const token = `(${item.justified ? 'z' : 'Z'})`;
      simpleSpan(item.id, token);
      body += `${token}\n`;
    } else if (item.kind === 'syllable') {
      const tokenStart = headerPrefix.length + body.length;
      const lyricStr = lyricToGabc(item);
      const neumeStart = tokenStart + lyricStr.length + 1; // after '('
      const useRaw = syllableUsesRawBody(item);

      const localSpans: GabcSpan[] = [];
      let neumes: string;

      if (useRaw) {
        // Original text is emitted verbatim. Individual note offsets inside it
        // are unknown, so every note maps to the whole neume text.
        neumes = item.raw!.body;
        for (const grp of item.groups) {
          for (const note of grp.notes) {
            localSpans.push({
              itemId: item.id,
              groupId: grp.id,
              noteId: note.id,
              start: neumeStart,
              end: neumeStart + neumes.length,
              tokenStart,
              tokenEnd: 0,
            });
          }
        }
      } else {
        const groupParts: string[] = [];
        let localCursor = 0;
        const nonEmptyGroups = item.groups.filter((g) => g.notes.length > 0);
        for (let gIdx = 0; gIdx < nonEmptyGroups.length; gIdx++) {
          const grp = nonEmptyGroups[gIdx];
          const { text, noteRanges } = serializeGroupWithOffsets(grp);
          for (const nr of noteRanges) {
            localSpans.push({
              itemId: item.id,
              groupId: grp.id,
              noteId: nr.noteId,
              start: neumeStart + localCursor + nr.start,
              end: neumeStart + localCursor + nr.end,
              tokenStart,
              tokenEnd: 0,
            });
          }
          groupParts.push(text);
          localCursor += text.length;
          if (gIdx < nonEmptyGroups.length - 1) localCursor += 1; // '/'
        }
        neumes = groupParts.join('/');
      }

      const token = `${lyricStr}(${neumes})`;
      const tokenEnd = tokenStart + token.length;

      if (localSpans.length === 0) {
        spans.push({ itemId: item.id, start: tokenStart, end: tokenEnd, tokenStart, tokenEnd });
      } else {
        for (const ls of localSpans) {
          ls.tokenEnd = tokenEnd;
          spans.push(ls);
        }
      }

      body += item.wordEnd ? `${token} ` : token;
    }
  }

  const trimmedBody = body.replace(/[ ]+\n/g, '\n').trimEnd();
  return {
    gabc: `${headerPrefix}${trimmedBody}\n`,
    spans,
  };
}

export function findGabcRangeForSelection(
  selection: SelectionState | null,
  spans: GabcSpan[]
): { start: number; end: number } | null {
  if (!selection || spans.length === 0) return null;

  if (selection.selectedNotes && selection.selectedNotes.length > 1) {
    const idSet = new Set(selection.selectedNotes.map((r) => r.noteId));
    const matched = spans.filter((s) => s.noteId && idSet.has(s.noteId));
    if (matched.length > 0) {
      return {
        start: Math.min(...matched.map((m) => m.start)),
        end: Math.max(...matched.map((m) => m.end)),
      };
    }
  }

  if (selection.noteId) {
    const noteSpan = spans.find((s) => s.noteId === selection.noteId);
    if (noteSpan) return { start: noteSpan.start, end: noteSpan.end };
  }

  const itemSpans = spans.filter((s) => s.itemId === selection.itemId);
  if (itemSpans.length > 0) {
    return {
      start: itemSpans[0].tokenStart,
      end: itemSpans[itemSpans.length - 1].tokenEnd,
    };
  }
  return null;
}

export function findSelectionForGabcOffset(
  gabc: string,
  offset: number,
  score: ChantScore,
  spans: GabcSpan[],
  isDirty: boolean
): SelectionState | null {
  if (!isDirty && spans.length > 0) {
    // Prefer exact note span match first
    const exactNote = spans.find(
      (s) => s.noteId && offset >= s.start && offset <= s.end
    );
    if (exactNote) {
      return {
        itemId: exactNote.itemId,
        groupId: exactNote.groupId,
        noteId: exactNote.noteId,
      };
    }
    // Otherwise match anywhere within a syllable/clef/division token
    const exactToken = spans.find(
      (s) => offset >= s.tokenStart && offset <= s.tokenEnd
    );
    if (exactToken) {
      return {
        itemId: exactToken.itemId,
        groupId: exactToken.groupId,
        noteId: exactToken.noteId,
      };
    }
  }

  // Fallback by counting token index in body after %%
  const sepIdx = gabc.indexOf('%%');
  if (sepIdx < 0 || offset <= sepIdx + 2) return null;
  const bodySlice = gabc.slice(sepIdx + 2);
  const relOffset = offset - (sepIdx + 2);
  const tokenRegex = /([^(]*)\(([^)]*)\)/g;
  let match: RegExpExecArray | null;
  let tokenIdx = 0;

  while ((match = tokenRegex.exec(bodySlice)) !== null) {
    const start = match.index;
    const end = tokenRegex.lastIndex;
    if (relOffset >= start && relOffset <= end) {
      const item = score.items[tokenIdx];
      if (!item) return null;
      if (item.kind === 'syllable') {
        const firstGroup = item.groups[0];
        const firstNote = firstGroup?.notes[0];
        return {
          itemId: item.id,
          groupId: firstGroup?.id,
          noteId: firstNote?.id,
        };
      }
      return { itemId: item.id };
    }
    tokenIdx += 1;
  }

  return null;
}
