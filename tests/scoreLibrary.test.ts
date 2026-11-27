import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGabc } from '@/src/lib/gabc/parser';
import { PROJECT_SCHEMA_VERSION, wrapProject } from '@/src/lib/projectStorage';
import {
  applyBackupRestore,
  createLibraryBackupEnvelope,
  createLibraryEntry,
  getBackupNudgeLabel,
  inspectBackupRestore,
  LEGACY_V1_STORAGE_KEY,
  LEGACY_V2_STORAGE_KEY,
  LIBRARY_BACKUP_SCHEMA_VERSION,
  LocalStorageFallbackScoreStore,
  MemoryScoreStore,
  migrateLegacyLocalStorageToLibrary,
  parseLibraryBackupJson,
  StorageLike,
  TONES_STORAGE_KEY,
  WORKSPACE_PREFS_STORAGE_KEY,
} from '@/src/lib/scoreLibrary';
import { PREFACE_TEMPLATES_STORAGE_KEY } from '@/src/lib/tones/prefaceTemplates';

function makeMockStorage(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data: Record<string, string> = { ...initial };
  return {
    data,
    getItem(key: string) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
    },
    setItem(key: string, value: string) {
      data[key] = String(value);
    },
    removeItem(key: string) {
      delete data[key];
    },
  };
}

const scoreA = parseGabc('name: Salve Regina;\n%%\n(c4) Sal(c)ve(d) Re(e)gi(f)na.(g)');
const scoreB = parseGabc('name: Ave Maria;\n%%\n(c4) A(f)ve(g) Ma(h)ri(g)a.(f)');

test('MemoryScoreStore CRUD, ordering by updatedAt, duplicate, and rename', async () => {
  const store = new MemoryScoreStore();
  const oldEntry = createLibraryEntry(scoreA, {
    id: 'id-a',
    now: new Date('2026-01-01T10:00:00.000Z'),
  });
  const newEntry = createLibraryEntry(scoreB, {
    id: 'id-b',
    now: new Date('2026-01-02T10:00:00.000Z'),
  });
  await store.put(oldEntry);
  await store.put(newEntry);

  const listed = await store.list();
  assert.equal(listed.length, 2);
  assert.equal(listed[0].id, 'id-b');
  assert.equal(listed[1].id, 'id-a');

  const fetched = await store.get('id-a');
  assert.ok(fetched);
  assert.equal(fetched.name, 'Salve Regina');

  const copy = await store.duplicate('id-a');
  assert.ok(copy);
  assert.notEqual(copy.id, 'id-a');
  assert.equal(copy.name, 'Salve Regina (copy)');
  assert.equal(copy.project.score.header.name, 'Salve Regina (copy)');
  const origAfterCopy = await store.get('id-a');
  assert.equal(origAfterCopy?.name, 'Salve Regina');

  const renamed = await store.rename('id-a', 'Salve Regina Solemn');
  assert.ok(renamed);
  assert.equal(renamed.name, 'Salve Regina Solemn');
  assert.equal(renamed.project.score.header.name, 'Salve Regina Solemn');

  await store.delete(copy.id);
  assert.equal(await store.get(copy.id), null);
  assert.equal((await store.list()).length, 2);
});

test('LocalStorageFallbackScoreStore persists across instances', async () => {
  const storage = makeMockStorage();
  const s1 = new LocalStorageFallbackScoreStore(storage);
  const entry = createLibraryEntry(scoreA, { id: 'ls-1' });
  await s1.put(entry);

  const s2 = new LocalStorageFallbackScoreStore(storage);
  const got = await s2.get('ls-1');
  assert.ok(got);
  assert.equal(got.name, 'Salve Regina');
});

test('migrateLegacyLocalStorageToLibrary migrates v2 and v1 non-destructively and skips non-empty store', async () => {
  const v2Raw = JSON.stringify(wrapProject(scoreA, new Date('2026-02-01T12:00:00.000Z')));
  const storageV2 = makeMockStorage({ [LEGACY_V2_STORAGE_KEY]: v2Raw });
  const storeV2 = new MemoryScoreStore();

  const resV2 = await migrateLegacyLocalStorageToLibrary(storeV2, storageV2);
  assert.equal(resV2.migrated, true);
  assert.equal(resV2.entry?.name, 'Salve Regina');
  // Legacy localStorage copy remains untouched
  assert.equal(storageV2.getItem(LEGACY_V2_STORAGE_KEY), v2Raw);

  // Subsequent migration when store already has entries is a no-op
  const resRepeat = await migrateLegacyLocalStorageToLibrary(storeV2, storageV2);
  assert.equal(resRepeat.migrated, false);
  assert.equal((await storeV2.list()).length, 1);

  // V1 bare score fallback migration
  const v1Raw = JSON.stringify(scoreB);
  const storageV1 = makeMockStorage({ [LEGACY_V1_STORAGE_KEY]: v1Raw });
  const storeV1 = new MemoryScoreStore();
  const resV1 = await migrateLegacyLocalStorageToLibrary(storeV1, storageV1);
  assert.equal(resV1.migrated, true);
  assert.equal(resV1.entry?.name, 'Ave Maria');
  assert.equal(storageV1.getItem(LEGACY_V1_STORAGE_KEY), v1Raw);
});

test('full library backup round-trips scores, tones, workspacePrefs, and prefaceTemplates', async () => {
  const srcStore = new MemoryScoreStore();
  await srcStore.put(createLibraryEntry(scoreA, { id: 's-1' }));
  await srcStore.put(createLibraryEntry(scoreB, { id: 's-2' }));

  const userTemplates = [
    {
      id: 'tpl-1',
      name: 'Custom Preface',
      language: 'en',
      tone: 'solemn',
      kind: 'body',
      text: 'It is truly right and just',
      gabc: '(c3) It(h) is(h) tru(h)ly(h) right(f)',
    },
  ];
  const srcStorage = makeMockStorage({
    [TONES_STORAGE_KEY]: JSON.stringify({ mode: 'psalm', psalmTone: '1g' }),
    [WORKSPACE_PREFS_STORAGE_KEY]: JSON.stringify({ zoom: 1.25 }),
    [PREFACE_TEMPLATES_STORAGE_KEY]: JSON.stringify(userTemplates),
  });

  const envelope = await createLibraryBackupEnvelope(srcStore, srcStorage);
  const jsonText = JSON.stringify(envelope);
  const parsed = parseLibraryBackupJson(jsonText);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.envelope.scores.length, 2);

  const dstStore = new MemoryScoreStore();
  const dstStorage = makeMockStorage();
  const inspection = await inspectBackupRestore(parsed.envelope, dstStore, dstStorage);
  assert.equal(inspection.totalScores, 2);
  assert.equal(inspection.newScores, 2);
  assert.equal(inspection.conflictingScores.length, 0);
  assert.equal(inspection.totalUserTemplates, 1);
  assert.equal(inspection.hasTones, true);
  assert.equal(inspection.hasWorkspacePrefs, true);

  const summary = await applyBackupRestore(parsed.envelope, dstStore, {
    conflictMode: 'overwrite',
    restoreSettings: true,
    storage: dstStorage,
  });
  assert.equal(summary.restoredScores, 2);
  assert.equal(summary.restoredTemplates, 1);
  assert.equal(summary.restoredTones, true);
  assert.equal(summary.restoredPrefs, true);
  assert.equal((await dstStore.list()).length, 2);
  assert.equal(dstStorage.getItem(TONES_STORAGE_KEY), srcStorage.getItem(TONES_STORAGE_KEY));
  assert.equal(
    dstStorage.getItem(WORKSPACE_PREFS_STORAGE_KEY),
    srcStorage.getItem(WORKSPACE_PREFS_STORAGE_KEY)
  );
  assert.ok(dstStorage.getItem(PREFACE_TEMPLATES_STORAGE_KEY)?.includes('Custom Preface'));
});

test('backup restore handles keep-both, skip-existing, and overwrite conflicts cleanly', async () => {
  const backupStore = new MemoryScoreStore();
  const modifiedScoreA = parseGabc('name: Salve Regina (edited);\n%%\n(c4) Sal(c)ve.(d)');
  await backupStore.put(createLibraryEntry(modifiedScoreA, { id: 'shared-1', name: 'Salve Regina (edited)' }));
  await backupStore.put(createLibraryEntry(scoreB, { id: 'new-2' }));

  const envelope = await createLibraryBackupEnvelope(backupStore, makeMockStorage());

  // keep-both
  const keepStore = new MemoryScoreStore([createLibraryEntry(scoreA, { id: 'shared-1' })]);
  const insp = await inspectBackupRestore(envelope, keepStore, makeMockStorage());
  assert.equal(insp.conflictingScores.length, 1);
  assert.equal(insp.newScores, 1);

  const keepRes = await applyBackupRestore(envelope, keepStore, {
    conflictMode: 'keep-both',
    storage: makeMockStorage(),
  });
  assert.equal(keepRes.restoredScores, 1);
  assert.equal(keepRes.copiedScores, 1);
  const keepList = await keepStore.list();
  assert.equal(keepList.length, 3);
  assert.equal((await keepStore.get('shared-1'))?.name, 'Salve Regina');
  assert.ok(keepList.some((e) => e.name.includes('(restored)')));

  // skip-existing
  const skipStore = new MemoryScoreStore([createLibraryEntry(scoreA, { id: 'shared-1' })]);
  const skipRes = await applyBackupRestore(envelope, skipStore, {
    conflictMode: 'skip-existing',
    storage: makeMockStorage(),
  });
  assert.equal(skipRes.restoredScores, 1);
  assert.equal(skipRes.skippedScores, 1);
  assert.equal((await skipStore.list()).length, 2);
  assert.equal((await skipStore.get('shared-1'))?.name, 'Salve Regina');

  // overwrite
  const overwriteStore = new MemoryScoreStore([createLibraryEntry(scoreA, { id: 'shared-1' })]);
  const overRes = await applyBackupRestore(envelope, overwriteStore, {
    conflictMode: 'overwrite',
    storage: makeMockStorage(),
  });
  assert.equal(overRes.restoredScores, 1);
  assert.equal(overRes.replacedScores, 1);
  assert.equal((await overwriteStore.list()).length, 2);
  assert.equal((await overwriteStore.get('shared-1'))?.name, 'Salve Regina (edited)');
});

test('parseLibraryBackupJson refuses newer schema versions and accepts single-score project JSON', () => {
  const newerLibrary = JSON.stringify({
    app: 'chantscore-library',
    schema: LIBRARY_BACKUP_SCHEMA_VERSION + 1,
    exportedAt: new Date().toISOString(),
    scores: [],
    localState: {},
  });
  const resNewLib = parseLibraryBackupJson(newerLibrary);
  assert.equal(resNewLib.ok, false);
  if (!resNewLib.ok) assert.equal(resNewLib.reason, 'newer-schema');

  const newerInnerProject = JSON.stringify({
    app: 'chantscore-library',
    schema: LIBRARY_BACKUP_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    scores: [
      {
        id: 'x',
        name: 'Future',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        project: {
          app: 'chantscore',
          schema: PROJECT_SCHEMA_VERSION + 1,
          savedAt: new Date().toISOString(),
          score: scoreA,
        },
      },
    ],
    localState: {},
  });
  const resNewInner = parseLibraryBackupJson(newerInnerProject);
  assert.equal(resNewInner.ok, false);
  if (!resNewInner.ok) assert.equal(resNewInner.reason, 'newer-schema');

  const singleProject = JSON.stringify(wrapProject(scoreA));
  const resSingle = parseLibraryBackupJson(singleProject);
  assert.equal(resSingle.ok, true);
  if (resSingle.ok) {
    assert.equal(resSingle.envelope.scores.length, 1);
    assert.equal(resSingle.envelope.scores[0].name, 'Salve Regina');
  }
});

test('getBackupNudgeLabel respects dirty flag, 7-day threshold, and snooze dismissal', () => {
  const now = Date.parse('2026-06-15T12:00:00.000Z');
  assert.equal(
    getBackupNudgeLabel({ lastBackupAt: null, dirtySinceBackup: false, dismissedUntil: null }, now),
    null
  );
  assert.equal(
    getBackupNudgeLabel({ lastBackupAt: null, dirtySinceBackup: true, dismissedUntil: null }, now),
    'Never backed up'
  );
  // 3 days ago -> suppressed
  assert.equal(
    getBackupNudgeLabel(
      {
        lastBackupAt: '2026-06-12T12:00:00.000Z',
        dirtySinceBackup: true,
        dismissedUntil: null,
      },
      now
    ),
    null
  );
  // 8 days ago -> shown
  assert.equal(
    getBackupNudgeLabel(
      {
        lastBackupAt: '2026-06-07T12:00:00.000Z',
        dirtySinceBackup: true,
        dismissedUntil: null,
      },
      now
    ),
    'Not backed up for 8 days'
  );
  // Dismissed until tomorrow -> suppressed
  assert.equal(
    getBackupNudgeLabel(
      {
        lastBackupAt: '2026-06-07T12:00:00.000Z',
        dirtySinceBackup: true,
        dismissedUntil: '2026-06-16T12:00:00.000Z',
      },
      now
    ),
    null
  );
});
