import { FormEvent, useEffect, useState } from "react";
import { Button } from "../../components/Button/Button";
import { ErrorState } from "../../components/ErrorState/ErrorState";
import { LoadingState } from "../../components/LoadingState/LoadingState";
import { Modal } from "../../components/Modal/Modal";
import { StatusPill } from "../../components/StatusPill/StatusPill";
import { useResource } from "../../hooks/useResource";
import { ApiError, api } from "../../lib/apiClient";
import { formatDate } from "../../lib/format";
import { printerStateMeta } from "../../types/statusMeta";
import type { JobOrder, Printer } from "../../types/domain";
import "../workspaceForm.css";
import "./JobOrderModals.css";

interface Props {
  open: boolean;
  order: JobOrder;
  onClose: () => void;
  onPrinted: (order: JobOrder) => void;
}

export function JobPrintSetupModal({ open, order, onClose, onPrinted }: Props) {
  const { data: printers, state, error: printerError, reload } = useResource(
    () => open ? api.get<Printer[]>("/printers") : Promise.resolve([]),
    [open],
  );
  const [selectedPrinterId, setSelectedPrinterId] = useState("");
  const [selectedFileId, setSelectedFileId] = useState("");
  const [orientation, setOrientation] = useState<"auto" | "portrait" | "landscape">("auto");
  const [scaling, setScaling] = useState<"fit" | "fill" | "actual_size">("fit");
  const [quality, setQuality] = useState<"draft" | "standard" | "high">("standard");
  const [borderless, setBorderless] = useState(false);
  const [collate, setCollate] = useState(true);
  const [discovering, setDiscovering] = useState(false);
  const [openingPreferences, setOpeningPreferences] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const printItem = order.items[0];
  const selectedFile = order.files.find((file) => file.id === selectedFileId);
  const paperPlan = printItem?.materials.find((material) => material.paperSize);
  const mediaSize = paperPlan?.paperSize ?? selectedFile?.detectedPaperSize ?? "A4";
  const copies = printItem?.copies ?? 1;
  const pages = selectedFile?.detectedPageCount ?? printItem?.pagesPerCopy ?? 1;
  const selectedPrinter = printers?.find((printer) => printer.id === selectedPrinterId);
  const defaultPrinters = printers?.filter((printer) => printer.isDefault) ?? [];
  const otherPrinters = printers?.filter((printer) => !printer.isDefault) ?? [];
  const firstAvailablePrinterId = printers?.find((printer) => !["offline", "error"].includes(printer.lastSeenState))?.id;

  useEffect(() => {
    if (!open) return;
    setSelectedPrinterId("");
    setSelectedFileId(order.files.find((file) => file.kind === "print_ready")?.id ?? "");
    setOrientation("auto");
    setScaling("fit");
    setQuality("standard");
    setBorderless(false);
    setCollate(true);
    setActionError(null);
  }, [open, order.id, order.files]);

  useEffect(() => {
    if (!open || !printers?.length || selectedPrinterId) return;
    const available = printers.find((printer) => printer.isDefault && !["offline", "error"].includes(printer.lastSeenState))
      ?? printers.find((printer) => !["offline", "error"].includes(printer.lastSeenState));
    setSelectedPrinterId(available?.id ?? "");
  }, [open, printers, selectedPrinterId]);

  async function handleDiscover() {
    setDiscovering(true);
    setActionError(null);
    try {
      await api.post<Printer[]>("/printers/discover");
      reload();
    } catch (caught) {
      setActionError(caught instanceof ApiError ? caught.message : "Printers could not be refreshed.");
    } finally {
      setDiscovering(false);
    }
  }

  async function handleOpenPreferences() {
    if (!window.paperClub || !selectedPrinter) return;
    setOpeningPreferences(true);
    setActionError(null);
    try {
      await window.paperClub.openPrinterPreferences(selectedPrinter.systemName);
    } catch {
      setActionError(`Windows printing preferences for ${selectedPrinter.displayName} could not be opened.`);
    } finally {
      setOpeningPreferences(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedPrinterId || !selectedFileId || saving) return;
    setSaving(true);
    setActionError(null);
    try {
      onPrinted(await api.post<JobOrder>(`/job-orders/${order.id}/print-attempts`, {
        printerId: selectedPrinterId,
        jobFileId: selectedFileId,
        orientation,
        scaling,
        quality,
        borderless,
        collate,
      }));
    } catch (caught) {
      setActionError(caught instanceof ApiError ? caught.message : "The print job could not be submitted.");
    } finally {
      setSaving(false);
    }
  }

  function printerChoice(printer: Printer, featured = false) {
    const unavailable = ["offline", "error"].includes(printer.lastSeenState);
    const selected = selectedPrinterId === printer.id;
    return (
      <label className={`job-printer-choice${featured ? " is-default" : ""}${selected ? " is-selected" : ""}${unavailable ? " is-disabled" : ""}`} key={printer.id}>
        <input autoFocus={printer.id === firstAvailablePrinterId} type="radio" name="job-printer" checked={selected} disabled={unavailable} onChange={() => setSelectedPrinterId(printer.id)} />
        <span className="job-printer-choice__dot" aria-hidden="true" />
        <span><strong>{printer.displayName}</strong><small>{featured ? "Windows default · " : ""}{printer.systemName}</small><small>Last seen {formatDate(printer.lastSeenAt)}</small></span>
        <StatusPill label={printerStateMeta[printer.lastSeenState].label} tone={printerStateMeta[printer.lastSeenState].tone} />
      </label>
    );
  }

  return (
    <Modal open={open} title="Print setup" description={`${order.number} · Choose the printer and output settings without leaving this job order.`} onClose={onClose} busy={saving} status={actionError ? "error" : saving ? "loading" : "idle"} className="job-print-modal">
      {state === "loading" ? <LoadingState label="Reading printers…" /> : state === "error" ? <ErrorState title="Printers unavailable" description={printerError ?? undefined} onRetry={reload} /> : (
        <form className="job-print-form" onSubmit={handleSubmit}>
          <div className="job-print-body">
            <section className="job-print-section">
              <header><div><span className="numeric">01 / DEVICE</span><h3>Select a printer</h3></div><Button type="button" size="sm" variant="secondary" onClick={handleDiscover} loading={discovering}>Refresh</Button></header>
              {!printers?.length ? <p className="job-print-empty">No printers found. Add the Canon or another device in Windows, then refresh.</p> : (
                <div className="job-printer-groups">
                  <div className="job-printer-default"><span className="numeric">DEFAULT</span>{defaultPrinters.length ? defaultPrinters.map((printer) => printerChoice(printer, true)) : <small>No Windows default printer is configured.</small>}</div>
                  {otherPrinters.length > 0 && <div className="job-printer-others"><span className="numeric">OTHERS</span><div>{otherPrinters.map((printer) => printerChoice(printer))}</div></div>}
                </div>
              )}
            </section>

            <section className="job-print-section">
              <header><div><span className="numeric">02 / OUTPUT</span><h3>Confirm file and settings</h3></div>{window.paperClub?.platform === "win32" && selectedPrinter && <Button type="button" size="sm" variant="secondary" onClick={handleOpenPreferences} loading={openingPreferences}>Driver preferences</Button>}</header>
              <div className="job-print-proof">
                <label className="form-field"><span>Print-ready file</span><select value={selectedFileId} onChange={(event) => setSelectedFileId(event.target.value)}>{order.files.filter((file) => file.kind === "print_ready").map((file) => <option key={file.id} value={file.id}>{file.originalFilename}</option>)}</select></label>
                <dl><div><dt>Pages</dt><dd>{pages}</dd></div><div><dt>Copies</dt><dd>{copies}</dd></div><div><dt>Paper</dt><dd>{mediaSize}</dd></div><div><dt>Output</dt><dd>{printItem?.printColorMode === "grayscale" ? "B&W" : "Color"}</dd></div></dl>
              </div>
              <div className="job-print-settings">
                <label className="form-field"><span>Orientation</span><select value={orientation} onChange={(event) => setOrientation(event.target.value as typeof orientation)}><option value="auto">Auto per page</option><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select></label>
                <label className="form-field"><span>Scaling</span><select value={scaling} onChange={(event) => setScaling(event.target.value as typeof scaling)}><option value="fit">Fit printable area</option><option value="actual_size">Actual size</option><option value="fill">Fill paper</option></select></label>
                <label className="form-field"><span>Quality</span><select value={quality} onChange={(event) => setQuality(event.target.value as typeof quality)}><option value="draft">Draft</option><option value="standard">Standard</option><option value="high">High</option></select></label>
                <label className="job-print-check"><input type="checkbox" checked={borderless} onChange={(event) => setBorderless(event.target.checked)} /><span><strong>Borderless</strong><small>Driver support required</small></span></label>
                <label className="job-print-check"><input type="checkbox" checked={collate} onChange={(event) => setCollate(event.target.checked)} disabled={copies < 2} /><span><strong>Collate copies</strong><small>Complete sets in order</small></span></label>
              </div>
            </section>
            {actionError && <p className="workspace-form__error" role="alert">{actionError}</p>}
          </div>
          <footer className="job-order-form__actions">
            <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button type="submit" variant="primary" loading={saving} disabled={!selectedPrinterId || !selectedFileId}>Print and deduct materials</Button>
          </footer>
        </form>
      )}
    </Modal>
  );
}
