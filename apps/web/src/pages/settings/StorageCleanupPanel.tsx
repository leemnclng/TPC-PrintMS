import { useState } from "react";
import { Button } from "../../components/Button/Button";
import { Card, CardHeader } from "../../components/Card/Card";
import { ErrorState } from "../../components/ErrorState/ErrorState";
import { LoadingState } from "../../components/LoadingState/LoadingState";
import { Modal } from "../../components/Modal/Modal";
import { useResource } from "../../hooks/useResource";
import { api, ApiError } from "../../lib/apiClient";
import { formatFileSize } from "../../lib/format";
import type { StorageCleanupCandidate, StorageCleanupResult } from "../../types/domain";

/** Only ever offers two kinds of thing: pre-environment-folder-redesign
 *  leftovers (once every stage that used them has finished migrating away —
 *  verified server-side, not guessed at here) and temp folders orphaned by a
 *  backup/restore that never finished. The active database, anything a real
 *  job/scan file points to, and backup archives are never candidates. */
export function StorageCleanupPanel() {
  const { data, state, error, reload } = useResource(() => api.get<StorageCleanupCandidate[]>("/settings/storage-cleanup"));
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const totalBytes = data?.reduce((sum, candidate) => sum + candidate.sizeBytes, 0) ?? 0;
  const totalItems = data?.reduce((sum, candidate) => sum + candidate.itemCount, 0) ?? 0;

  async function cleanUp() {
    setCleaning(true);
    setMessage(null);
    try {
      const result = await api.post<StorageCleanupResult>("/settings/storage-cleanup");
      setConfirmOpen(false);
      setMessage({ tone: "success", text: describeResult(result) });
      reload();
    } catch (err) {
      setMessage({ tone: "error", text: err instanceof ApiError ? err.message : "The cleanup could not be completed." });
    } finally {
      setCleaning(false);
    }
  }

  return (
    <>
      <Card className="storage-cleanup-card">
        <CardHeader title="Storage cleanup" meta="NEVER TOUCHES YOUR DATA" />
        <p className="settings-placeholder-text">
          Clears leftovers the app itself created — old pre-redesign folders and abandoned temp files from an interrupted backup. Your database, job files, and backups are never touched.
        </p>

        {state === "loading" && <LoadingState label="Checking for leftovers…" />}
        {state === "error" && <ErrorState description={error ?? undefined} onRetry={reload} />}
        {data && data.length === 0 && (
          <p className="settings-placeholder-text">Nothing to clean up right now.</p>
        )}
        {data && data.length > 0 && (
          <>
            <ul className="storage-cleanup-list">
              {data.map((candidate) => (
                <li className="storage-cleanup-list__item" key={candidate.key}>
                  <div>
                    <strong>{candidate.label}</strong>
                    <small>{candidate.description}</small>
                  </div>
                  <span className="numeric">{formatFileSize(candidate.sizeBytes)} · {candidate.itemCount} {candidate.itemCount === 1 ? "item" : "items"}</span>
                </li>
              ))}
            </ul>
            <div className="storage-cleanup-actions">
              <Button type="button" variant="primary" onClick={() => setConfirmOpen(true)}>
                Clean up {formatFileSize(totalBytes)}
              </Button>
            </div>
          </>
        )}
        {message && <p className={`backup-message is-${message.tone}`} role="status">{message.text}</p>}
      </Card>

      <Modal
        open={confirmOpen}
        title="Clean up storage?"
        description={`This permanently removes ${totalItems} ${totalItems === 1 ? "item" : "items"} (${formatFileSize(totalBytes)}) — leftovers only, never your database, job files, or backups.`}
        onClose={() => { if (!cleaning) setConfirmOpen(false); }}
        busy={cleaning}
        status={cleaning ? "loading" : "idle"}
      >
        <div className="environment-switch-modal">
          <div className="environment-switch-modal__actions">
            <Button type="button" variant="ghost" disabled={cleaning} onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button type="button" variant="primary" loading={cleaning} onClick={cleanUp}>Clean up</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

function describeResult(result: StorageCleanupResult): string {
  if (result.removed.length === 0) return "Nothing needed cleaning up.";
  return `Freed ${formatFileSize(result.freedBytes)} — ${result.removed.map((item) => item.label).join(", ")}.`;
}
