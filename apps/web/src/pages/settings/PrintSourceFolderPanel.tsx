import { useEffect, useState } from "react";
import { Button } from "../../components/Button/Button";
import { Card, CardHeader } from "../../components/Card/Card";

type SourceFolder = { folderPath: string | null; available: boolean };

export function PrintSourceFolderPanel() {
  const bridge = window.paperClub;
  const [folder, setFolder] = useState<SourceFolder | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!bridge) return;
    void bridge.getPrintSourceFolder().then(setFolder).catch((caught: unknown) => {
      setError(caught instanceof Error ? caught.message : "The trusted source folder could not be read.");
    });
  }, [bridge]);

  async function chooseFolder() {
    if (!bridge || busy) return;
    setBusy(true);
    setError(null);
    try {
      const selected = await bridge.choosePrintSourceFolder();
      if (selected) setFolder(selected);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The folder could not be selected.");
    } finally {
      setBusy(false);
    }
  }

  async function clearFolder() {
    if (!bridge || busy) return;
    setBusy(true);
    setError(null);
    try {
      setFolder(await bridge.clearPrintSourceFolder());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The folder setting could not be cleared.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="print-source-card">
      <CardHeader title="Tracked-print source folder" meta={folder?.folderPath ? folder.available ? "READY" : "UNAVAILABLE" : "NOT CONFIGURED"} />
      <p className="settings-placeholder-text">
        OMS searches this folder and its subfolders when a Canon or other Windows print is tracked. A single exact filename match is attached automatically; uncertain matches still require manual selection.
      </p>
      <label className="form-field storage-location-field">
        <span>Trusted source folder</span>
        <div className="storage-location-field__control">
          <input className="numeric" value={folder?.folderPath ?? "No folder selected"} readOnly aria-label="Trusted tracked-print source folder" />
          <Button type="button" variant="secondary" disabled={!bridge || busy} loading={busy} onClick={chooseFolder}>{folder?.folderPath ? "Change folder" : "Choose folder"}</Button>
        </div>
      </label>
      <div className="print-source-card__footer">
        <p className="backup-note">Read-only matching supports PDF, images, Word, Excel, and PowerPoint files up to 25 MB. The folder path is a local machine setting and is not included in data backups.</p>
        {folder?.folderPath ? <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={clearFolder}>Stop using folder</Button> : null}
      </div>
      {error ? <p className="backup-message is-error" role="alert">{error}</p> : null}
    </Card>
  );
}
