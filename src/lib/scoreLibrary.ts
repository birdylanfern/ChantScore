import type { ChantScore } from '../types/chant';
import {
  isChantScore,
  PROJECT_SCHEMA_VERSION,
  ProjectEnvelope,
  unwrapProject,
  wrapProject,
} from './projectStorage';
import {
  importPrefaceTemplatesJson,
  loadUserPrefaceTemplates,
  PREFACE_TEMPLATES_STORAGE_KEY,
  PrefaceTemplate,
} from './tones/prefaceTemplates';

export const ACTIVE_SCORE_ID_KEY = 'chantscore.activeScoreId.v1';
export const BACKUP_STATE_KEY = 'chantscore.backupState.v1';
export const LIBRARY_FALLBACK_STORAGE_KEY = 'chantscore.library.fallback.v1';
export const LEGACY_V2_STORAGE_KEY = 'chantscore.project.v2';
export const LEGACY_V1_STORAGE_KEY = 'chantscore.project.v1';

export const TONES_STORAGE_KEY = 'chantscore.tones.v1';
export const WORKSPACE_PREFS_STORAGE_KEY = 'chantscore.workspace.prefs.v1';

export const LIBRARY_BACKUP_SCHEMA_VERSION = 1;
const IDB_NAME = 'chantscore.library.v1';
const IDB_VERSION = 1;
const IDB_STORE = 'scores';
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export interface ScoreLibraryEntry {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  project: ProjectEnvelope;
}

export interface ScoreStore {
  list(): Promise<ScoreLibraryEntry[]>;
  get(id: string): Promise<ScoreLibraryEntry | null>;
  put(entry: ScoreLibraryEntry): Promise<void>;
  delete(id: string): Promise<void>;
  duplicate(id: string, newName?: string): Promise<ScoreLibraryEntry | null>;
  rename(id: string, nextName: string): Promise<ScoreLibraryEntry | null>;
}

export interface BackupMetadata {
  lastBackupAt: string | null;
  dirtySinceBackup: boolean;
  dismissedUntil: string | null;
}

export interface LibraryBackupEnvelope {
  app: 'chantscore-library';
  schema: number;
  exportedAt: string;
  scores: ScoreLibraryEntry[];
  localState: {
    tones?: string | null;
    workspacePrefs?: string | null;
    prefaceTemplates?: string | null;
  };
}

export interface BackupRestoreInspection {
  totalScores: number;
  newScores: number;
  conflictingScores: ScoreLibraryEntry[];
  totalUserTemplates: number;
  conflictingTemplateCount: number;
  hasTones: boolean;
  hasWorkspacePrefs: boolean;
}

export interface BackupRestoreSummary {
  restoredScores: number;
  replacedScores: number;
  copiedScores: number;
  skippedScores: number;
  restoredTemplates: number;
  restoredTones: boolean;
  restoredPrefs: boolean;
}

function getDefaultStorage(): StorageLike | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

function cloneScore(score: ChantScore): ChantScore {
  return JSON.parse(JSON.stringify(score)) as ChantScore;
}

export function generateScoreId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `score-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

export function deriveScoreName(score: ChantScore, fallback = 'Untitled chant'): string {
  const title = score.header?.name?.trim();
  return title || fallback;
}

export function createLibraryEntry(
  score: ChantScore,
  opts?: { id?: string; name?: string; now?: Date }
): ScoreLibraryEntry {
  const now = opts?.now ?? new Date();
  const iso = now.toISOString();
  const cloned = cloneScore(score);
  return {
    id: opts?.id ?? generateScoreId(),
    name: opts?.name?.trim() || deriveScoreName(cloned),
    createdAt: iso,
    updatedAt: iso,
    project: wrapProject(cloned, now),
  };
}

function sortEntriesDesc(entries: ScoreLibraryEntry[]): ScoreLibraryEntry[] {
  return [...entries].sort((a, b) => {
    const ta = Date.parse(a.updatedAt) || Date.parse(a.createdAt) || 0;
    const tb = Date.parse(b.updatedAt) || Date.parse(b.createdAt) || 0;
    if (tb !== ta) return tb - ta;
    return a.id.localeCompare(b.id);
  });
}

function parseLibraryEntry(raw: unknown): ScoreLibraryEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Partial<ScoreLibraryEntry>;
  if (typeof obj.id !== 'string' || !obj.id.trim()) return null;
  if (!obj.project || typeof obj.project !== 'object') return null;
  const unwrapped = unwrapProject(obj.project);
  if (!unwrapped) return null;
  const createdAt =
    typeof obj.createdAt === 'string' && !Number.isNaN(Date.parse(obj.createdAt))
      ? obj.createdAt
      : new Date().toISOString();
  const updatedAt =
    typeof obj.updatedAt === 'string' && !Number.isNaN(Date.parse(obj.updatedAt))
      ? obj.updatedAt
      : createdAt;
  const name =
    typeof obj.name === 'string' && obj.name.trim() ? obj.name.trim() : deriveScoreName(unwrapped);
  return {
    id: obj.id,
    name,
    createdAt,
    updatedAt,
    project: {
      app: 'chantscore',
      schema: PROJECT_SCHEMA_VERSION,
      savedAt:
        typeof obj.project.savedAt === 'string' && obj.project.savedAt
          ? obj.project.savedAt
          : updatedAt,
      score: unwrapped,
    },
  };
}

export class MemoryScoreStore implements ScoreStore {
  private map = new Map<string, ScoreLibraryEntry>();

  constructor(initial: ScoreLibraryEntry[] = []) {
    for (const entry of initial) {
      const parsed = parseLibraryEntry(entry);
      if (parsed) this.map.set(parsed.id, parsed);
    }
  }

  async list(): Promise<ScoreLibraryEntry[]> {
    return sortEntriesDesc(
      Array.from(this.map.values()).map((e) => ({
        ...e,
        project: { ...e.project, score: cloneScore(e.project.score) },
      }))
    );
  }

  async get(id: string): Promise<ScoreLibraryEntry | null> {
    const entry = this.map.get(id);
    if (!entry) return null;
    return {
      ...entry,
      project: { ...entry.project, score: cloneScore(entry.project.score) },
    };
  }

  async put(entry: ScoreLibraryEntry): Promise<void> {
    const parsed = parseLibraryEntry(entry);
    if (!parsed) throw new Error('Invalid score library entry');
    this.map.set(parsed.id, {
      ...parsed,
      project: { ...parsed.project, score: cloneScore(parsed.project.score) },
    });
  }

  async delete(id: string): Promise<void> {
    this.map.delete(id);
  }

  async duplicate(id: string, newName?: string): Promise<ScoreLibraryEntry | null> {
    const existing = await this.get(id);
    if (!existing) return null;
    const baseName = newName?.trim() || `${existing.name} (copy)`;
    const clonedScore = cloneScore(existing.project.score);
    clonedScore.header = { ...clonedScore.header, name: baseName };
    const copy = createLibraryEntry(clonedScore, { name: baseName });
    await this.put(copy);
    return copy;
  }

  async rename(id: string, nextName: string): Promise<ScoreLibraryEntry | null> {
    const existing = await this.get(id);
    if (!existing) return null;
    const clean = nextName.trim() || 'Untitled chant';
    const now = new Date();
    const updatedScore = cloneScore(existing.project.score);
    updatedScore.header = { ...updatedScore.header, name: clean };
    const updated: ScoreLibraryEntry = {
      ...existing,
      name: clean,
      updatedAt: now.toISOString(),
      project: wrapProject(updatedScore, now),
    };
    await this.put(updated);
    return updated;
  }
}

export class LocalStorageFallbackScoreStore implements ScoreStore {
  private storage: StorageLike;
  private storageKey: string;

  constructor(storage: StorageLike, storageKey = LIBRARY_FALLBACK_STORAGE_KEY) {
    this.storage = storage;
    this.storageKey = storageKey;
  }

  private readAll(): Map<string, ScoreLibraryEntry> {
    const map = new Map<string, ScoreLibraryEntry>();
    try {
      const raw = this.storage.getItem(this.storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            const entry = parseLibraryEntry(item);
            if (entry) map.set(entry.id, entry);
          }
        }
      }
    } catch {
      /* ignore corrupt fallback */
    }
    return map;
  }

  private writeAll(map: Map<string, ScoreLibraryEntry>): void {
    const entries = sortEntriesDesc(Array.from(map.values()));
    try {
      this.storage.setItem(this.storageKey, JSON.stringify(entries));
    } catch {
      // Single-slot fallback if quota is tight: keep only the most recently edited score.
      const single = entries.slice(0, 1);
      this.storage.setItem(this.storageKey, JSON.stringify(single));
      if (single[0]) {
        this.storage.setItem(LEGACY_V2_STORAGE_KEY, JSON.stringify(single[0].project));
      }
    }
  }

  async list(): Promise<ScoreLibraryEntry[]> {
    return sortEntriesDesc(Array.from(this.readAll().values()));
  }

  async get(id: string): Promise<ScoreLibraryEntry | null> {
    return this.readAll().get(id) ?? null;
  }

  async put(entry: ScoreLibraryEntry): Promise<void> {
    const parsed = parseLibraryEntry(entry);
    if (!parsed) throw new Error('Invalid score library entry');
    const map = this.readAll();
    map.set(parsed.id, parsed);
    this.writeAll(map);
  }

  async delete(id: string): Promise<void> {
    const map = this.readAll();
    map.delete(id);
    this.writeAll(map);
  }

  async duplicate(id: string, newName?: string): Promise<ScoreLibraryEntry | null> {
    const existing = await this.get(id);
    if (!existing) return null;
    const baseName = newName?.trim() || `${existing.name} (copy)`;
    const clonedScore = cloneScore(existing.project.score);
    clonedScore.header = { ...clonedScore.header, name: baseName };
    const copy = createLibraryEntry(clonedScore, { name: baseName });
    await this.put(copy);
    return copy;
  }

  async rename(id: string, nextName: string): Promise<ScoreLibraryEntry | null> {
    const existing = await this.get(id);
    if (!existing) return null;
    const clean = nextName.trim() || 'Untitled chant';
    const now = new Date();
    const updatedScore = cloneScore(existing.project.score);
    updatedScore.header = { ...updatedScore.header, name: clean };
    const updated: ScoreLibraryEntry = {
      ...existing,
      name: clean,
      updatedAt: now.toISOString(),
      project: wrapProject(updatedScore, now),
    };
    await this.put(updated);
    return updated;
  }
}

export class IndexedDbScoreStore implements ScoreStore {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private persistRequested = false;

  private openDb(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB is not available'));
        return;
      }
      const req = indexedDB.open(IDB_NAME, IDB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('Failed to open IndexedDB'));
    });
    return this.dbPromise;
  }

  async list(): Promise<ScoreLibraryEntry[]> {
    const db = await this.openDb();
    return new Promise<ScoreLibraryEntry[]>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).getAll();
      req.onsuccess = () => {
        const out: ScoreLibraryEntry[] = [];
        for (const item of Array.isArray(req.result) ? req.result : []) {
          const parsed = parseLibraryEntry(item);
          if (parsed) out.push(parsed);
        }
        resolve(sortEntriesDesc(out));
      };
      req.onerror = () => reject(req.error ?? new Error('Failed to list scores'));
    });
  }

  async get(id: string): Promise<ScoreLibraryEntry | null> {
    const db = await this.openDb();
    return new Promise<ScoreLibraryEntry | null>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(id);
      req.onsuccess = () => resolve(parseLibraryEntry(req.result));
      req.onerror = () => reject(req.error ?? new Error('Failed to read score'));
    });
  }

  async put(entry: ScoreLibraryEntry): Promise<void> {
    const parsed = parseLibraryEntry(entry);
    if (!parsed) throw new Error('Invalid score library entry');
    const db = await this.openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(parsed);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Failed to write score'));
      tx.onabort = () => reject(tx.error ?? new Error('Write aborted'));
    });
    if (!this.persistRequested && typeof navigator !== 'undefined' && navigator.storage?.persist) {
      this.persistRequested = true;
      void navigator.storage.persist().catch(() => {});
    }
  }

  async delete(id: string): Promise<void> {
    const db = await this.openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Failed to delete score'));
      tx.onabort = () => reject(tx.error ?? new Error('Delete aborted'));
    });
  }

  async duplicate(id: string, newName?: string): Promise<ScoreLibraryEntry | null> {
    const existing = await this.get(id);
    if (!existing) return null;
    const baseName = newName?.trim() || `${existing.name} (copy)`;
    const clonedScore = cloneScore(existing.project.score);
    clonedScore.header = { ...clonedScore.header, name: baseName };
    const copy = createLibraryEntry(clonedScore, { name: baseName });
    await this.put(copy);
    return copy;
  }

  async rename(id: string, nextName: string): Promise<ScoreLibraryEntry | null> {
    const existing = await this.get(id);
    if (!existing) return null;
    const clean = nextName.trim() || 'Untitled chant';
    const now = new Date();
    const updatedScore = cloneScore(existing.project.score);
    updatedScore.header = { ...updatedScore.header, name: clean };
    const updated: ScoreLibraryEntry = {
      ...existing,
      name: clean,
      updatedAt: now.toISOString(),
      project: wrapProject(updatedScore, now),
    };
    await this.put(updated);
    return updated;
  }
}

export async function createScoreStore(
  storage: StorageLike | null = getDefaultStorage()
): Promise<{ store: ScoreStore; usingFallback: boolean }> {
  if (typeof indexedDB !== 'undefined') {
    const idbStore = new IndexedDbScoreStore();
    try {
      await idbStore.list();
      return { store: idbStore, usingFallback: false };
    } catch {
      /* fall through to localStorage / memory fallback */
    }
  }
  if (storage) {
    return { store: new LocalStorageFallbackScoreStore(storage), usingFallback: true };
  }
  return { store: new MemoryScoreStore(), usingFallback: true };
}

/**
 * Non-destructive migration on first run: if the library is empty and a legacy
 * score exists in localStorage (`chantscore.project.v2` or `chantscore.project.v1`),
 * import it into the store, read back to verify, and leave the old localStorage copy untouched.
 */
export async function migrateLegacyLocalStorageToLibrary(
  store: ScoreStore,
  storage: StorageLike | null = getDefaultStorage()
): Promise<{ migrated: boolean; entry: ScoreLibraryEntry | null }> {
  const existing = await store.list();
  if (existing.length > 0 || !storage) {
    return { migrated: false, entry: null };
  }
  for (const key of [LEGACY_V2_STORAGE_KEY, LEGACY_V1_STORAGE_KEY]) {
    try {
      const raw = storage.getItem(key);
      if (!raw) continue;
      const parsedJson = JSON.parse(raw) as unknown;
      const score = unwrapProject(parsedJson);
      if (!score) continue;
      const savedAtRaw =
        parsedJson &&
        typeof parsedJson === 'object' &&
        typeof (parsedJson as Partial<ProjectEnvelope>).savedAt === 'string'
          ? (parsedJson as Partial<ProjectEnvelope>).savedAt
          : undefined;
      const now = savedAtRaw && !Number.isNaN(Date.parse(savedAtRaw)) ? new Date(savedAtRaw) : new Date();
      const entry = createLibraryEntry(score, { now });
      await store.put(entry);
      const verified = await store.get(entry.id);
      if (verified) {
        return { migrated: true, entry: verified };
      }
    } catch {
      /* try next key */
    }
  }
  return { migrated: false, entry: null };
}

export function loadActiveScoreId(storage: StorageLike | null = getDefaultStorage()): string | null {
  if (!storage) return null;
  try {
    const val = storage.getItem(ACTIVE_SCORE_ID_KEY);
    return val && val.trim() ? val.trim() : null;
  } catch {
    return null;
  }
}

export function saveActiveScoreId(
  id: string | null,
  storage: StorageLike | null = getDefaultStorage()
): void {
  if (!storage) return;
  try {
    if (id) storage.setItem(ACTIVE_SCORE_ID_KEY, id);
    else storage.removeItem?.(ACTIVE_SCORE_ID_KEY);
  } catch {
    /* ignore */
  }
}

export function loadBackupMetadata(storage: StorageLike | null = getDefaultStorage()): BackupMetadata {
  const fallback: BackupMetadata = {
    lastBackupAt: null,
    dirtySinceBackup: false,
    dismissedUntil: null,
  };
  if (!storage) return fallback;
  try {
    const raw = storage.getItem(BACKUP_STATE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<BackupMetadata>;
    return {
      lastBackupAt:
        typeof parsed.lastBackupAt === 'string' && !Number.isNaN(Date.parse(parsed.lastBackupAt))
          ? parsed.lastBackupAt
          : null,
      dirtySinceBackup: Boolean(parsed.dirtySinceBackup),
      dismissedUntil:
        typeof parsed.dismissedUntil === 'string' && !Number.isNaN(Date.parse(parsed.dismissedUntil))
          ? parsed.dismissedUntil
          : null,
    };
  } catch {
    return fallback;
  }
}

export function saveBackupMetadata(
  meta: BackupMetadata,
  storage: StorageLike | null = getDefaultStorage()
): void {
  if (!storage) return;
  try {
    storage.setItem(BACKUP_STATE_KEY, JSON.stringify(meta));
  } catch {
    /* ignore */
  }
}

export function getBackupNudgeLabel(meta: BackupMetadata, nowMs = Date.now()): string | null {
  if (!meta.dirtySinceBackup) return null;
  if (meta.dismissedUntil) {
    const untilMs = Date.parse(meta.dismissedUntil);
    if (Number.isFinite(untilMs) && nowMs < untilMs) return null;
  }
  if (!meta.lastBackupAt) {
    return 'Never backed up';
  }
  const lastMs = Date.parse(meta.lastBackupAt);
  if (!Number.isFinite(lastMs)) {
    return 'Never backed up';
  }
  const elapsedMs = nowMs - lastMs;
  if (elapsedMs < SEVEN_DAYS_MS) return null;
  const days = Math.floor(elapsedMs / (24 * 60 * 60 * 1000));
  return `Not backed up for ${days} day${days === 1 ? '' : 's'}`;
}

export async function createLibraryBackupEnvelope(
  store: ScoreStore,
  storage: StorageLike | null = getDefaultStorage(),
  now: Date = new Date()
): Promise<LibraryBackupEnvelope> {
  const scores = await store.list();
  const readKey = (k: string): string | null => {
    if (!storage) return null;
    try {
      return storage.getItem(k);
    } catch {
      return null;
    }
  };
  return {
    app: 'chantscore-library',
    schema: LIBRARY_BACKUP_SCHEMA_VERSION,
    exportedAt: now.toISOString(),
    scores,
    localState: {
      tones: readKey(TONES_STORAGE_KEY),
      workspacePrefs: readKey(WORKSPACE_PREFS_STORAGE_KEY),
      prefaceTemplates: readKey(PREFACE_TEMPLATES_STORAGE_KEY),
    },
  };
}

export function parseLibraryBackupJson(
  jsonText: string
):
  | { ok: true; envelope: LibraryBackupEnvelope }
  | { ok: false; reason: 'invalid-json' | 'newer-schema' | 'invalid-format' } {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch {
    return { ok: false, reason: 'invalid-json' };
  }
  if (!raw || typeof raw !== 'object') {
    return { ok: false, reason: 'invalid-format' };
  }
  const obj = raw as Partial<LibraryBackupEnvelope> & Partial<ProjectEnvelope>;
  if (obj.app === 'chantscore' && typeof obj.schema === 'number') {
    if (obj.schema > PROJECT_SCHEMA_VERSION) {
      return { ok: false, reason: 'newer-schema' };
    }
    const unwrapped = unwrapProject(obj);
    if (!unwrapped) return { ok: false, reason: 'invalid-format' };
    return {
      ok: true,
      envelope: {
        app: 'chantscore-library',
        schema: LIBRARY_BACKUP_SCHEMA_VERSION,
        exportedAt: typeof obj.savedAt === 'string' ? obj.savedAt : new Date().toISOString(),
        scores: [createLibraryEntry(unwrapped)],
        localState: {},
      },
    };
  }
  if (obj.app !== 'chantscore-library' || typeof obj.schema !== 'number') {
    return { ok: false, reason: 'invalid-format' };
  }
  if (obj.schema > LIBRARY_BACKUP_SCHEMA_VERSION) {
    return { ok: false, reason: 'newer-schema' };
  }
  if (!Array.isArray(obj.scores)) {
    return { ok: false, reason: 'invalid-format' };
  }
  const validScores: ScoreLibraryEntry[] = [];
  for (const item of obj.scores) {
    if (item && typeof item === 'object') {
      const proj = (item as Partial<ScoreLibraryEntry>).project as Partial<ProjectEnvelope> | undefined;
      if (proj && proj.app === 'chantscore' && typeof proj.schema === 'number' && proj.schema > PROJECT_SCHEMA_VERSION) {
        return { ok: false, reason: 'newer-schema' };
      }
    }
    const entry = parseLibraryEntry(item);
    if (!entry) return { ok: false, reason: 'invalid-format' };
    validScores.push(entry);
  }
  const ls = obj.localState && typeof obj.localState === 'object' ? obj.localState : {};
  return {
    ok: true,
    envelope: {
      app: 'chantscore-library',
      schema: obj.schema,
      exportedAt: typeof obj.exportedAt === 'string' ? obj.exportedAt : new Date().toISOString(),
      scores: validScores,
      localState: {
        tones: typeof ls.tones === 'string' ? ls.tones : null,
        workspacePrefs: typeof ls.workspacePrefs === 'string' ? ls.workspacePrefs : null,
        prefaceTemplates: typeof ls.prefaceTemplates === 'string' ? ls.prefaceTemplates : null,
      },
    },
  };
}

function parseTemplateList(rawJson: string | null | undefined): PrefaceTemplate[] {
  if (!rawJson) return [];
  try {
    const parsed = JSON.parse(rawJson);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (t): t is PrefaceTemplate =>
        Boolean(t) &&
        typeof t === 'object' &&
        typeof (t as PrefaceTemplate).id === 'string' &&
        typeof (t as PrefaceTemplate).text === 'string' &&
        typeof (t as PrefaceTemplate).gabc === 'string'
    );
  } catch {
    return [];
  }
}

export async function inspectBackupRestore(
  envelope: LibraryBackupEnvelope,
  store: ScoreStore,
  storage: StorageLike | null = getDefaultStorage()
): Promise<BackupRestoreInspection> {
  const existing = await store.list();
  const existingById = new Map(existing.map((e) => [e.id, e]));
  const conflictingScores: ScoreLibraryEntry[] = [];
  let newScores = 0;
  for (const entry of envelope.scores) {
    if (existingById.has(entry.id)) {
      conflictingScores.push(entry);
    } else {
      newScores++;
    }
  }

  const incomingTemplates = parseTemplateList(envelope.localState.prefaceTemplates);
  let existingTemplates: PrefaceTemplate[] = [];
  if (storage) {
    existingTemplates = parseTemplateList(storage.getItem(PREFACE_TEMPLATES_STORAGE_KEY));
  } else {
    existingTemplates = loadUserPrefaceTemplates();
  }
  const existingTplKeys = new Set(
    existingTemplates.map((t) => `${t.language}|${t.tone}|${t.kind}|${t.text.trim().toLowerCase()}`)
  );
  let conflictingTemplateCount = 0;
  for (const t of incomingTemplates) {
    const k = `${t.language}|${t.tone}|${t.kind}|${t.text.trim().toLowerCase()}`;
    if (existingTplKeys.has(k)) conflictingTemplateCount++;
  }

  return {
    totalScores: envelope.scores.length,
    newScores,
    conflictingScores,
    totalUserTemplates: incomingTemplates.length,
    conflictingTemplateCount,
    hasTones: Boolean(envelope.localState.tones),
    hasWorkspacePrefs: Boolean(envelope.localState.workspacePrefs),
  };
}

export async function applyBackupRestore(
  envelope: LibraryBackupEnvelope,
  store: ScoreStore,
  opts: {
    conflictMode: 'overwrite' | 'keep-both' | 'skip-existing';
    restoreSettings?: boolean;
    storage?: StorageLike | null;
  }
): Promise<BackupRestoreSummary> {
  const storage = opts.storage === undefined ? getDefaultStorage() : opts.storage;
  const existing = await store.list();
  const existingIds = new Set(existing.map((e) => e.id));

  let restoredScores = 0;
  let replacedScores = 0;
  let copiedScores = 0;
  let skippedScores = 0;

  for (const entry of envelope.scores) {
    if (!isChantScore(entry.project.score)) continue;
    const exists = existingIds.has(entry.id);
    if (!exists) {
      await store.put(entry);
      existingIds.add(entry.id);
      restoredScores++;
    } else if (opts.conflictMode === 'overwrite') {
      await store.put(entry);
      replacedScores++;
    } else if (opts.conflictMode === 'keep-both') {
      const clonedScore = cloneScore(entry.project.score);
      const copyName = `${entry.name} (restored)`;
      clonedScore.header = { ...clonedScore.header, name: copyName };
      const copy = createLibraryEntry(clonedScore, { name: copyName });
      await store.put(copy);
      existingIds.add(copy.id);
      copiedScores++;
    } else {
      skippedScores++;
    }
  }

  let restoredTemplates = 0;
  if (envelope.localState.prefaceTemplates && storage) {
    const incomingTemplates = parseTemplateList(envelope.localState.prefaceTemplates);
    const existingTemplates = parseTemplateList(storage.getItem(PREFACE_TEMPLATES_STORAGE_KEY));
    const keyOf = (t: PrefaceTemplate) =>
      `${t.language}|${t.tone}|${t.kind}|${t.text.trim().toLowerCase()}`;
    const existingKeys = new Set(existingTemplates.map(keyOf));

    if (opts.conflictMode === 'overwrite') {
      if (storage === getDefaultStorage()) {
        const res = importPrefaceTemplatesJson(envelope.localState.prefaceTemplates);
        restoredTemplates = res.importedCount;
      } else {
        const merged = new Map(existingTemplates.map((t) => [keyOf(t), t]));
        for (const t of incomingTemplates) {
          merged.set(keyOf(t), t);
          restoredTemplates++;
        }
        storage.setItem(PREFACE_TEMPLATES_STORAGE_KEY, JSON.stringify([...merged.values()]));
      }
    } else {
      const nonConflicting = incomingTemplates.filter((t) => !existingKeys.has(keyOf(t)));
      if (nonConflicting.length > 0) {
        if (storage === getDefaultStorage()) {
          const res = importPrefaceTemplatesJson(JSON.stringify(nonConflicting));
          restoredTemplates = res.importedCount;
        } else {
          storage.setItem(
            PREFACE_TEMPLATES_STORAGE_KEY,
            JSON.stringify([...existingTemplates, ...nonConflicting])
          );
          restoredTemplates = nonConflicting.length;
        }
      }
    }
  }

  let restoredTones = false;
  let restoredPrefs = false;
  const shouldRestoreSettings = opts.restoreSettings ?? opts.conflictMode === 'overwrite';
  if (storage && shouldRestoreSettings) {
    if (envelope.localState.tones) {
      const existingTones = storage.getItem(TONES_STORAGE_KEY);
      if (!existingTones || opts.conflictMode === 'overwrite') {
        storage.setItem(TONES_STORAGE_KEY, envelope.localState.tones);
        restoredTones = true;
      }
    }
    if (envelope.localState.workspacePrefs) {
      const existingPrefs = storage.getItem(WORKSPACE_PREFS_STORAGE_KEY);
      if (!existingPrefs || opts.conflictMode === 'overwrite') {
        storage.setItem(WORKSPACE_PREFS_STORAGE_KEY, envelope.localState.workspacePrefs);
        restoredPrefs = true;
      }
    }
  }

  return {
    restoredScores,
    replacedScores,
    copiedScores,
    skippedScores,
    restoredTemplates,
    restoredTones,
    restoredPrefs,
  };
}
