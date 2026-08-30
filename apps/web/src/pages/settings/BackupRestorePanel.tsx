import { ChangeEvent, useRef, useState } from "react";
import { Button } from "../../components/Button/Button";
import { Card, CardHeader } from "../../components/Card/Card";
import { ErrorState } from "../../components/ErrorState/ErrorState";
import { LoadingState } from "../../components/LoadingState/LoadingState";
import { Modal } from "../../components/Modal/Modal";
import { useResource } from "../../hooks/useResource";
import { api, ApiError } from "../../lib/apiClient";
import { formatDateTime, formatFileSize } from "../../lib/format";
import type { RestoreResult, StorageStatus } from "../../types/domain";

interface BackupRestorePanelProps {
  onRestored: () => void;
}

export function BackupRestorePanel({ onRestored }: BackupRestorePanelProps) {
  const { data, state, error, reload } = useResource(() => api.get<StorageStatus>("/settings/storage"));
  const inputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [creating, setCreating] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  async function createBackup() {
    setCreating(true);
    setMessage(null);
    try {
      const blob = await api.download("/settings/backup");
      const timestamp = new Date().toISOString().replace(/:/g, "-").replace(".000Z", "Z");
      const link = document.createElement("a");
      const downloadUrl = URL.createObjectURL(blob);
      link.href = downloadUrl;
      link.download = `printing-ms-${data?.stage ?? "environment"}-${timestamp}.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 0);
      setMessage({ tone: "success", text: "Backup created and downloaded. A local copy is also retained in this environment." });
      reload();
    } catch (err) {
      setMessage({ tone: "error", text: err instanceof ApiError ? err.message : "The backup could not be created." });
    } finally {
      setCreating(false);
    }
  }

  function closeRestore() {
    if (restoring) return;
    setSelectedFile(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  function chooseRestoreFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setMessage(null);
    if (file && !file.name.toLowerCase().endsWith(".zip")) {
      setMessage({ tone: "error", text: "Choose a Printing-MS ZIP backup." });
      event.target.value = "";
      return;
    }
    setSelectedFile(file);
  }

  async function restore() {
    if (!selectedFile) return;
    setRestoring(true);
    setMessage(null);
    const formData = new FormData();
    formData.append("file", selectedFile);
    try {
      const result = await api.upload<RestoreResult>("/settings/restore", formData);
      setMessage({
        tone: "success",
        text: `${result.message} Safety backup: ${result.safetyBackupFilename}`,
      });
      setSelectedFile(null);
      if (inputRef.current) inputRef.current.value = "";
      reload();
      onRestored();
    } catch (err) {
      setMessage({ tone: "error", text: err instanceof ApiError ? err.message : "The backup could not be restored." });
    } finally {
      setRestoring(false);
    }
  }

  return (
    <>
      <Card className="backup-card">
        <CardHeader title="Backup & restore" meta={data ? data.stage.toUpperCase() : undefined} />
        <p className="settings-placeholder-text">
          Back up this environment’s database, retained job files, scanned documents, and non-secret configuration as one verified ZIP.
        </p>

        {state === "loading" && <LoadingState label="Reading environment storage…" />}
        {state === "error" && <ErrorState description={error ?? undefined} onRetry={reload} />}
        {data && (
          <>
            <dl className="backup-summary">
              <div><dt>Environment folder</dt><dd className="numeric">{data.environmentDirectory}</dd></div>
              <div><dt>Managed files</dt><dd>{data.managedFileCount} · {formatFileSize(data.managedFileBytes)}</dd></div>
              <div><dt>Saved backups</dt><dd>{data.backupCount}</dd></div>
              <div><dt>Last backup</dt><dd>{data.lastBackupAt ? formatDateTime(data.lastBackupAt) : "Not backed up yet"}</dd></div>
              <div><dt>Config snapshot</dt><dd className="numeric">{data.configPath}</dd></div>
            </dl>
            <div className="backup-actions">
              <Button type="button" variant="primary" loading={creating} disabled={restoring} onClick={createBackup}>
                Create backup
              </Button>
              <input
                ref={inputRef}
                className="backup-file-input"
                type="file"
                accept=".zip,application/zip"
                onChange={chooseRestoreFile}
                disabled={creating || restoring}
              />
            </div>
            <p className="backup-note">
              Restore accepts backups from <strong>{data.stage}</strong> only. Production, development, and test data never overwrite one another.
            </p>
          </>
        )}
        {message && <p className={`backup-message is-${message.tone}`} role="status">{message.text}</p>}
      </Card>

      <Modal
        open={Boolean(selectedFile)}
        title="Restore this environment?"
        description="This replaces the current database, managed files, and JSON configuration snapshot."
        onClose={closeRestore}
        busy={restoring}
        status={restoring ? "loading" : "idle"}
      >
        <div className="backup-restore-modal">
          <div className="backup-restore-warning">
            <span className="numeric">SELECTED BACKUP</span>
            <strong>{selectedFile?.name}</strong>
            <p>A safety backup of the current environment will be created automatically before restore begins.</p>
          </div>
          <div className="backup-restore-modal__actions">
            <Button type="button" variant="ghost" disabled={restoring} onClick={closeRestore}>Keep current data</Button>
            <Button type="button" variant="danger" loading={restoring} onClick={restore}>Restore backup</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
