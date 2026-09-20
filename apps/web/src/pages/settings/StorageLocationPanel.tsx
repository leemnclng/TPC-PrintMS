import { useEffect, useState } from "react";
import { Button } from "../../components/Button/Button";
import { Card, CardHeader } from "../../components/Card/Card";
import { Modal } from "../../components/Modal/Modal";

interface StorageLocation {
  currentPath: string;
  defaultPath: string;
  isCustom: boolean;
}

export function StorageLocationPanel() {
  const bridge = window.paperClub;
  const [location, setLocation] = useState<StorageLocation | null>(null);
  const [candidate, setCandidate] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!bridge) return;
    void bridge.getStorageLocation().then(setLocation).catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "The storage location could not be read.");
    });
  }, [bridge]);

  async function chooseLocation() {
    if (!bridge) return;
    setError(null);
    try {
      const selected = await bridge.chooseStorageLocation();
      if (selected && selected !== location?.currentPath) setCandidate(selected);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The folder picker could not be opened.");
    }
  }

  async function confirmMove() {
    if (!bridge || !candidate) return;
    setMoving(true);
    setError(null);
    try {
      await bridge.moveStorageLocation(candidate);
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "App data could not be moved.");
      setMoving(false);
      setCandidate(null);
    }
  }

  return (
    <>
      <Card className="storage-location-card">
        <CardHeader title="App data location" meta={location?.isCustom ? "CUSTOM LOCATION" : "MANAGED DEFAULT"} />
        <p className="settings-placeholder-text">
          Controls where every environment stores its database, job files, backups, configuration, and logs.
        </p>
        <label className="form-field storage-location-field">
          <span>Data folder</span>
          <div className="storage-location-field__control">
            <input
              className="numeric"
              value={location?.currentPath ?? "Available in the desktop app"}
              readOnly
              aria-label="Current app data folder"
            />
            <Button type="button" variant="secondary" disabled={!bridge || !location} onClick={chooseLocation}>
              Choose folder
            </Button>
          </div>
        </label>
        <p className="backup-note">
          Changing this copies all environments to an empty folder, restarts the local backend, and keeps the old folder as a safety copy.
        </p>
        {error && <p className="backup-message is-error" role="alert">{error}</p>}
      </Card>

      <Modal
        open={Boolean(candidate)}
        title="Move app data?"
        description="All environment data will be copied to the selected empty folder. The app will then restart its local backend using that folder."
        onClose={() => { if (!moving) setCandidate(null); }}
        busy={moving}
        status={moving ? "loading" : "idle"}
      >
        <div className="storage-location-modal">
          <dl>
            <div><dt>From</dt><dd className="numeric">{location?.currentPath}</dd></div>
            <div><dt>To</dt><dd className="numeric">{candidate}</dd></div>
          </dl>
          <div className="environment-switch-modal__actions">
            <Button type="button" variant="ghost" disabled={moving} onClick={() => setCandidate(null)}>Cancel</Button>
            <Button type="button" variant="primary" loading={moving} onClick={confirmMove}>Copy and restart</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
