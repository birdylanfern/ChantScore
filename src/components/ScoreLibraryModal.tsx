import React, { useEffect, useRef, useState } from 'react';
import {
  Archive,
  Check,
  Copy,
  FilePlus2,
  FolderOpen,
  Pencil,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type {
  BackupRestoreInspection,
  LibraryBackupEnvelope,
  ScoreLibraryEntry,
} from '@/src/lib/scoreLibrary';

export interface PendingBackupRestore {
  fileName: string;
  envelope: LibraryBackupEnvelope;
  inspection: BackupRestoreInspection;
}

interface ScoreLibraryModalProps {
  open: boolean;
  entries: ScoreLibraryEntry[];
  activeScoreId: string | null;
  lastBackupAt: string | null;
  pendingRestore: PendingBackupRestore | null;
  onClose: () => void;
  onOpenScore: (id: string) => void;
  onNewScore: () => void;
  onDuplicateScore: (id: string) => void;
  onRenameScore: (id: string, nextName: string) => void;
  onDeleteScore: (id: string) => void;
  onBackupAll: () => void;
  onSelectRestoreFile: (file: File) => void;
  onConfirmRestore: (mode: 'overwrite' | 'keep-both' | 'skip-existing') => void;
  onCancelRestore: () => void;
}

function formatDateTime(iso: string): string {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return '';
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(ts));
  } catch {
    return new Date(ts).toLocaleString();
  }
}

export const ScoreLibraryModal: React.FC<ScoreLibraryModalProps> = ({
  open,
  entries,
  activeScoreId,
  lastBackupAt,
  pendingRestore,
  onClose,
  onOpenScore,
  onNewScore,
  onDuplicateScore,
  onRenameScore,
  onDeleteScore,
  onBackupAll,
  onSelectRestoreFile,
  onConfirmRestore,
  onCancelRestore,
}) => {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) {
      setRenamingId(null);
      setConfirmDeleteId(null);
    }
  }, [open]);

  if (!open) return null;

  const hasConflicts = Boolean(
    pendingRestore &&
      (pendingRestore.inspection.conflictingScores.length > 0 ||
        pendingRestore.inspection.conflictingTemplateCount > 0)
  );

  return (
    <div
      className="no-print fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="score-library-title"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          if (pendingRestore) onCancelRestore();
          else if (renamingId) setRenamingId(null);
          else if (confirmDeleteId) setConfirmDeleteId(null);
          else onClose();
        }
      }}
    >
      <div className="flex max-h-[86vh] w-full max-w-2xl flex-col overflow-hidden rounded-md border border-[#CFC3AE] bg-[#FAF6EE] shadow-xl text-[#1D1915]">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-[#DDD3C1] bg-[#EAE2D3] px-4 py-3">
          <div>
            <h2
              id="score-library-title"
              className="font-[family-name:var(--font-display)] text-base font-semibold tracking-wide text-[#8B1E24]"
            >
              My scores
            </h2>
            <p className="text-[11px] text-[#6B6257]">
              {entries.length} {entries.length === 1 ? 'score' : 'scores'} stored locally
              {lastBackupAt ? ` · Last backup ${formatDateTime(lastBackupAt)}` : ' · Not backed up yet'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close My scores"
            className="inline-flex h-7 w-7 items-center justify-center rounded border border-[#CFC3AE] bg-[#FAF6EE] text-[#4F473E] hover:bg-white hover:text-[#1D1915]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Action bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E5DBC9] bg-[#F5EFE4] px-4 py-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                onNewScore();
                onClose();
              }}
              className="inline-flex h-7 items-center gap-1.5 rounded border border-[#72171B] bg-[#8B1E24] px-2.5 text-[11px] font-semibold text-[#FAF6EE] hover:bg-[#A1252B]"
            >
              <FilePlus2 className="h-3.5 w-3.5" />
              <span>New score</span>
            </button>
            <button
              type="button"
              onClick={onBackupAll}
              className="inline-flex h-7 items-center gap-1.5 rounded border border-[#CFC3AE] bg-[#FAF6EE] px-2.5 text-[11px] font-medium text-[#1D1915] hover:bg-white"
            >
              <Archive className="h-3.5 w-3.5 text-[#8B1E24]" />
              <span>Back up everything</span>
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex h-7 items-center gap-1.5 rounded border border-[#CFC3AE] bg-[#FAF6EE] px-2.5 text-[11px] font-medium text-[#1D1915] hover:bg-white"
            >
              <Upload className="h-3.5 w-3.5 text-[#8B1E24]" />
              <span>Restore backup…</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,.chantscore-library.json,application/json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onSelectRestoreFile(f);
                e.currentTarget.value = '';
              }}
            />
          </div>
        </div>

        {/* Restore Preview / Conflict Prompt */}
        {pendingRestore && (
          <div className="border-b border-[#D7CCB8] bg-[#EFE5D1] px-4 py-3 text-xs">
            <div className="font-semibold text-[#6E161B]">
              Restore from “{pendingRestore.fileName}”
            </div>
            <p className="mt-1 text-[#3D352D]">
              Found {pendingRestore.inspection.totalScores}{' '}
              {pendingRestore.inspection.totalScores === 1 ? 'score' : 'scores'}
              {pendingRestore.inspection.totalUserTemplates > 0
                ? `, ${pendingRestore.inspection.totalUserTemplates} preface ${
                    pendingRestore.inspection.totalUserTemplates === 1 ? 'template' : 'templates'
                  }`
                : ''}
              {pendingRestore.inspection.hasTones ? ', tone settings' : ''}
              {pendingRestore.inspection.hasWorkspacePrefs ? ', workspace preferences' : ''}.
            </p>
            {hasConflicts ? (
              <p className="mt-1 text-[11px] font-medium text-[#8B1E24]">
                Conflicts: {pendingRestore.inspection.conflictingScores.length} existing score
                {pendingRestore.inspection.conflictingScores.length === 1 ? '' : 's'}
                {pendingRestore.inspection.conflictingTemplateCount > 0
                  ? ` and ${pendingRestore.inspection.conflictingTemplateCount} preface template${
                      pendingRestore.inspection.conflictingTemplateCount === 1 ? '' : 's'
                    }`
                  : ''}{' '}
                match items already in this browser. Choose how to merge:
              </p>
            ) : (
              <p className="mt-1 text-[11px] text-[#4F473E]">
                No conflicts with your existing scores or templates.
              </p>
            )}
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              {hasConflicts ? (
                <>
                  <button
                    type="button"
                    onClick={() => onConfirmRestore('keep-both')}
                    className="h-7 rounded border border-[#72171B] bg-[#8B1E24] px-2.5 text-[11px] font-semibold text-[#FAF6EE] hover:bg-[#A1252B]"
                  >
                    Keep existing &amp; add copies
                  </button>
                  <button
                    type="button"
                    onClick={() => onConfirmRestore('skip-existing')}
                    className="h-7 rounded border border-[#CFC3AE] bg-[#FAF6EE] px-2.5 text-[11px] font-medium text-[#1D1915] hover:bg-white"
                  >
                    Skip conflicts
                  </button>
                  <button
                    type="button"
                    onClick={() => onConfirmRestore('overwrite')}
                    className="h-7 rounded border border-[#B91C1C] bg-[#FDF4F4] px-2.5 text-[11px] font-medium text-[#991B1B] hover:bg-white"
                  >
                    Replace conflicts
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => onConfirmRestore('overwrite')}
                  className="h-7 rounded border border-[#72171B] bg-[#8B1E24] px-2.5 text-[11px] font-semibold text-[#FAF6EE] hover:bg-[#A1252B]"
                >
                  Restore {pendingRestore.inspection.totalScores}{' '}
                  {pendingRestore.inspection.totalScores === 1 ? 'score' : 'scores'}
                  {pendingRestore.inspection.totalUserTemplates > 0
                    ? `, ${pendingRestore.inspection.totalUserTemplates} templates`
                    : ''}
                </button>
              )}
              <button
                type="button"
                onClick={onCancelRestore}
                className="h-7 rounded border border-[#CFC3AE] bg-[#F5EFE4] px-2.5 text-[11px] font-medium text-[#4F473E] hover:bg-white"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Score List */}
        <div className="flex-1 overflow-y-auto divide-y divide-[#E7DEC9] px-4 py-1">
          {entries.length === 0 ? (
            <div className="py-10 text-center text-xs text-[#6B6257]">
              No scores in the library yet.
            </div>
          ) : (
            entries.map((entry) => {
              const isActive = entry.id === activeScoreId;
              const isRenaming = renamingId === entry.id;
              const isDeleting = confirmDeleteId === entry.id;
              const header = entry.project.score.header;
              const metaBits = [header.officePart?.trim(), header.mode?.trim() ? `Mode ${header.mode.trim()}` : '']
                .filter(Boolean)
                .join(' · ');

              return (
                <div
                  key={entry.id}
                  className={`flex flex-wrap items-center justify-between gap-2 py-2.5 ${
                    isActive ? 'bg-[#8B1E24]/[0.04] -mx-2 px-2 rounded' : ''
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    {isRenaming ? (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          onRenameScore(entry.id, renameDraft);
                          setRenamingId(null);
                        }}
                        className="flex items-center gap-1.5"
                      >
                        <input
                          type="text"
                          autoFocus
                          aria-label="Rename score"
                          value={renameDraft}
                          onChange={(e) => setRenameDraft(e.target.value)}
                          className="h-7 w-full max-w-xs rounded border border-[#8B1E24] bg-white px-2 text-xs text-[#1D1915] focus:outline-none"
                        />
                        <button
                          type="submit"
                          className="inline-flex h-7 items-center gap-1 rounded border border-[#72171B] bg-[#8B1E24] px-2 text-[11px] font-medium text-[#FAF6EE]"
                        >
                          <Check className="h-3 w-3" />
                          <span>Save</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setRenamingId(null)}
                          className="h-7 rounded border border-[#CFC3AE] bg-[#FAF6EE] px-2 text-[11px] text-[#4F473E]"
                        >
                          Cancel
                        </button>
                      </form>
                    ) : (
                      <>
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="truncate font-[family-name:var(--font-serif)] text-sm font-semibold text-[#1D1915]">
                            {entry.name}
                          </span>
                          {isActive && (
                            <span className="shrink-0 rounded border border-[#8B1E24]/30 bg-[#8B1E24]/10 px-1.5 py-0 text-[10px] font-semibold text-[#8B1E24]">
                              Open
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 text-[11px] text-[#6B6257] truncate">
                          Edited {formatDateTime(entry.updatedAt)}
                          {metaBits ? ` · ${metaBits}` : ''}
                        </div>
                      </>
                    )}
                  </div>

                  {!isRenaming && (
                    <div className="flex flex-wrap items-center gap-1 shrink-0">
                      {!isActive && (
                        <button
                          type="button"
                          onClick={() => {
                            onOpenScore(entry.id);
                            onClose();
                          }}
                          className="inline-flex h-7 items-center gap-1 rounded border border-[#8B1E24] bg-[#8B1E24] px-2 text-[11px] font-medium text-[#FAF6EE] hover:bg-[#A1252B]"
                        >
                          <FolderOpen className="h-3 w-3" />
                          <span>Open</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => onDuplicateScore(entry.id)}
                        title="Duplicate score"
                        className="inline-flex h-7 items-center gap-1 rounded border border-[#CFC3AE] bg-[#FAF6EE] px-2 text-[11px] font-medium text-[#1D1915] hover:bg-white"
                      >
                        <Copy className="h-3 w-3" />
                        <span>Duplicate</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmDeleteId(null);
                          setRenamingId(entry.id);
                          setRenameDraft(entry.name);
                        }}
                        title="Rename score"
                        className="inline-flex h-7 items-center gap-1 rounded border border-[#CFC3AE] bg-[#FAF6EE] px-2 text-[11px] font-medium text-[#1D1915] hover:bg-white"
                      >
                        <Pencil className="h-3 w-3" />
                        <span>Rename</span>
                      </button>
                      {isDeleting ? (
                        <div className="inline-flex items-center gap-1 rounded border border-[#DFC9C9] bg-[#FDF4F4] px-1.5 py-0.5">
                          <span className="text-[10.5px] font-medium text-[#991B1B]">Delete?</span>
                          <button
                            type="button"
                            onClick={() => {
                              setConfirmDeleteId(null);
                              onDeleteScore(entry.id);
                            }}
                            className="rounded bg-[#991B1B] px-1.5 py-0.5 text-[10px] font-semibold text-white hover:bg-[#7F1D1D]"
                          >
                            Confirm
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            className="rounded border border-[#CFC3AE] bg-white px-1.5 py-0.5 text-[10px] text-[#4F473E]"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(entry.id)}
                          title="Delete score"
                          className="inline-flex h-7 items-center gap-1 rounded border border-[#CFC3AE] bg-[#FAF6EE] px-2 text-[11px] font-medium text-[#8B1E24] hover:bg-white"
                        >
                          <Trash2 className="h-3 w-3" />
                          <span>Delete</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
