import { useState } from "react";
import { Button } from "../../components/Button/Button";
import { Card, CardHeader } from "../../components/Card/Card";
import { ErrorState } from "../../components/ErrorState/ErrorState";
import { LoadingState } from "../../components/LoadingState/LoadingState";
import { Modal } from "../../components/Modal/Modal";
import { useResource } from "../../hooks/useResource";
import { api, ApiError } from "../../lib/apiClient";
import { formatDateTime, formatFileSize } from "../../lib/format";
import type { EnvironmentSummary } from "../../types/domain";

const STAGE_LABELS: Record<EnvironmentSummary["stage"], string> = {
  development: "Development",
  test: "Test",
  production: "Production",
};

/** Each stage owns a complete folder under the managed app-data directory
 *  (database, managed files, backups, config snapshot) — see
 *  services/api/app/core/config.py. Switching restarts the local backend
 *  bound to a different one; it never copies or deletes data. */
export function EnvironmentSwitcherPanel() {
  const { data, state, error, reload } = useResource(() => api.get<EnvironmentSummary[]>("/settings/environments"));
  const [target, setTarget] = useState<EnvironmentSummary | null>(null);
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const desktopBridge = window.paperClub;

  function requestSwitch(environment: EnvironmentSummary) {
    setSwitchError(null);
    setTarget(environment);
  }

  function closeModal() {
    if (switching) return;
    setTarget(null);
    setSwitchError(null);
  }

  async function confirmSwitch() {
    if (!target || !desktopBridge) return;
    setSwitching(true);
    setSwitchError(null);
    try {
      await desktopBridge.switchEnvironment(target.stage);
      // A full reload re-runs every module's startup state (including the
      // memoized backend config in lib/apiClient.ts) against the freshly
      // switched backend, instead of trying to hand-patch state everywhere
      // a baseUrl/token might be cached.
      window.location.reload();
    } catch (err) {
      setSwitchError(err instanceof ApiError || err instanceof Error ? err.message : "The environment could not be switched.");
      setSwitching(false);
    }
  }

  return (
    <>
      <Card className="settings-environments">
        <CardHeader title="Runtime environments" meta="SWITCHING RESTARTS THE APP" />
        <p className="settings-placeholder-text">
          Each stage keeps its own database, managed files, backups, and configuration snapshot under the app's managed data folder.
          {!desktopBridge && " Switching is available in the desktop app."}
        </p>

        {state === "loading" && <LoadingState label="Reading environments…" />}
        {state === "error" && <ErrorState description={error ?? undefined} onRetry={reload} />}
        {data && (
          <div className="environment-grid">
            {data.map((environment, index) => (
              <article className={`environment-card${environment.isActive ? " is-active" : ""}`} key={environment.stage}>
                <header>
                  <span className="numeric">0{index + 1}</span>
                  {environment.isActive && <strong>ACTIVE</strong>}
                </header>
                <h3>{STAGE_LABELS[environment.stage]}</h3>
                <dl>
                  <div><dt>SQLite path</dt><dd className="numeric">{environment.databasePath}</dd></div>
                  <div><dt>Managed files</dt><dd>{environment.hasDatabase ? `${environment.managedFileCount} · ${formatFileSize(environment.managedFileBytes)}` : "Not created yet"}</dd></div>
                  <div><dt>Backups</dt><dd>{environment.backupCount} {environment.lastBackupAt ? `· last ${formatDateTime(environment.lastBackupAt)}` : ""}</dd></div>
                </dl>
                {!environment.isActive && (
                  <div className="environment-card__actions">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={!desktopBridge}
                      onClick={() => requestSwitch(environment)}
                    >
                      Switch to {STAGE_LABELS[environment.stage]}
                    </Button>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
        <p className="environment-note">
          Switching never copies or deletes data — it restarts the local backend against the chosen stage's folder and reloads the app.
        </p>
      </Card>

      <Modal
        open={Boolean(target)}
        title={target ? `Switch to ${STAGE_LABELS[target.stage]}?` : ""}
        description="The local backend restarts against this stage's folder and the app reloads. Nothing in the current environment is copied or deleted."
        onClose={closeModal}
        busy={switching}
        status={switching ? "loading" : switchError ? "error" : "idle"}
      >
        <div className="environment-switch-modal">
          {switchError && <p className="workspace-form__error" role="alert">{switchError}</p>}
          <div className="environment-switch-modal__actions">
            <Button type="button" variant="ghost" disabled={switching} onClick={closeModal}>Stay on this environment</Button>
            <Button type="button" variant="primary" loading={switching} onClick={confirmSwitch}>
              {target ? `Switch to ${STAGE_LABELS[target.stage]}` : "Switch"}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
