import type { ChantScore } from '../types/chant';

const STORAGE_KEY = 'chantscore.project.v2';
const LEGACY_STORAGE_KEY = 'chantscore.project.v1';

/** Bump when the saved score shape changes, and add a migration in unwrapProject. */
export const PROJECT_SCHEMA_VERSION = 2;

const CLEFS = new Set(['c1','c2','c3','c4','f1','f2','f3','f4','cb3','cb4']);

export interface ProjectEnvelope {
  app: 'chantscore';
  schema: number;
  savedAt: string;
  score: ChantScore;
}

export function isChantScore(value: unknown): value is ChantScore {
  if (!value || typeof value !== 'object') return false;
  const score = value as Partial<ChantScore>;
  return !!score.header && typeof score.header.name === 'string' &&
    Array.isArray(score.items) && score.items.length < 100000 &&
    score.items.every((item) => {
      if (!item || typeof item !== 'object' || typeof item.id !== 'string') return false;
      if (item.kind === 'clef') return CLEFS.has(item.clef);
      if (item.kind === 'division') return [',',';',':','::'].includes(item.division);
      if (item.kind === 'linebreak') return typeof item.justified === 'boolean';
      if (item.kind === 'syllable') return typeof item.lyric === 'string' && Array.isArray(item.groups) &&
        item.groups.every((group) => Array.isArray(group.notes) && group.notes.every((note) =>
          typeof note.id === 'string' && Number.isInteger(note.pitch) && note.pitch >= 0 && note.pitch <= 12));
      return false;
    });
}

export function wrapProject(score: ChantScore, now: Date = new Date()): ProjectEnvelope {
  return { app: 'chantscore', schema: PROJECT_SCHEMA_VERSION, savedAt: now.toISOString(), score };
}

/**
 * Accepts a current envelope, an older envelope, or a bare v1 score, and returns
 * a validated score (migrated to the current shape) or null.
 */
export function unwrapProject(data: unknown): ChantScore | null {
  if (!data || typeof data !== 'object') return null;
  const maybeEnvelope = data as Partial<ProjectEnvelope>;
  if (maybeEnvelope.app === 'chantscore' && typeof maybeEnvelope.schema === 'number') {
    // Refuse files from a newer version rather than silently mangling them.
    if (maybeEnvelope.schema > PROJECT_SCHEMA_VERSION) return null;
    return isChantScore(maybeEnvelope.score) ? maybeEnvelope.score : null;
  }
  // v1 stored the bare score.
  return isChantScore(data) ? data : null;
}

export function parseProjectJson(text: string): ChantScore | null {
  try {
    return unwrapProject(JSON.parse(text));
  } catch {
    return null;
  }
}

export function serializeProjectJson(score: ChantScore): string {
  return JSON.stringify(wrapProject(score), null, 2);
}

export function loadSavedScore(): ChantScore | null {
  for (const key of [STORAGE_KEY, LEGACY_STORAGE_KEY]) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const score = unwrapProject(JSON.parse(raw));
      if (score) return score;
    } catch {
      /* try the next key */
    }
  }
  return null;
}

export function hasSavedScore(): boolean {
  try {
    return !!(localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY));
  } catch {
    return false;
  }
}

export function saveScore(score: ChantScore): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(wrapProject(score)));
    // The v2 copy is now authoritative; drop the legacy copy to free quota.
    try { localStorage.removeItem(LEGACY_STORAGE_KEY); } catch { /* ignore */ }
    return true;
  } catch { return false; }
}
