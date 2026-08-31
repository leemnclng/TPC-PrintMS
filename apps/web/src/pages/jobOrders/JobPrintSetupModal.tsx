import { FormEvent, useEffect, useState } from "react";
import { Button } from "../../components/Button/Button";
import { ErrorState } from "../../components/ErrorState/ErrorState";
import { LoadingState } from "../../components/LoadingState/LoadingState";
import { Modal } from "../../components/Modal/Modal";
import { PrinterOutputPreview } from "../../components/PrinterOutputPreview/PrinterOutputPreview";
import { StatusPill } from "../../components/StatusPill/StatusPill";
import { useResource } from "../../hooks/useResource";
import { ApiError, api } from "../../lib/apiClient";
import { formatDate } from "../../lib/format";
import { PRINT_MEDIA_OPTIONS, type PrintMediaType } from "../../lib/printProfiles";
import { paperSizeDefinition, paperSizeDisplay } from "../../lib/paperSizes";
import { printerStateMeta } from "../../types/statusMeta";
import type { JobOrder, JobOrderItem, Printer } from "../../types/domain";
import "../workspaceForm.css";
import "./JobOrderModals.css";

interface Props {
  open: boolean;
  order: JobOrder;
  item: JobOrderItem;
  onClose: () => void;
  onPrinted: (order: JobOrder) => void;
}

export function JobPrintSetupModal({ open, order, item, onClose, onPrinted }: Props) {
  const { data: printers, state, error: printerError, reload } = useResource(
    () => open ? api.get<Printer[]>("/printers") : Promise.resolve([]),
    [open],
  );
  const [selectedPrinterId, setSelectedPrinterId] = useState("");
  const [selectedFileId, setSelectedFileId] = useState("");
  const [orientation, setOrientation] = useState<"auto" | "portrait" | "landscape">("auto");
  const [scaling, setScaling] = useState<"auto" | "fit" | "fill" | "actual_size">("auto");
  const [quality, setQuality] = useState<"auto" | "draft" | "standard" | "high">("auto");
  const [mediaType, setMediaType] = useState<PrintMediaType>("auto");
  const [borderless, setBorderless] = useState(false);
  const [collate, setCollate] = useState(true);
  const [customSizeEnabled, setCustomSizeEnabled] = useState(false);
  const [customWidthMm, setCustomWidthMm] = useState("");
  const [customHeightMm, setCustomHeightMm] = useState("");
  const [workingOrder, setWorkingOrder] = useState(order);
  const [paperReinserted, setPaperReinserted] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [openingPreferences, setOpeningPreferences] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const printItem = workingOrder.items.find((candidate) => candidate.id === item.id) ?? item;
  const isPhotoPrint = printItem.printType === "photo_print";
  const initialPaperSize = item.materials.find((material) => material.paperSize)?.paperSize;
  const selectedFile = workingOrder.files.find((file) => file.id === selectedFileId);
  const paperPlan = printItem?.materials.find((material) => material.paperSize);
  const mediaSize = paperPlan?.paperSize ?? selectedFile?.detectedPaperSize ?? "A4";
  const approvedMediaSizeLabel = paperSizeDisplay(mediaSize, paperPlan?.paperWidthMm, paperPlan?.paperHeightMm);
  const mediaDefinition = paperSizeDefinition(mediaSize);
  const mediaWidthMm = paperPlan?.paperWidthMm ?? mediaDefinition?.widthMm ?? 210;
  const mediaHeightMm = paperPlan?.paperHeightMm ?? mediaDefinition?.heightMm ?? 297;
  const enteredCustomWidth = Number(customWidthMm);
  const enteredCustomHeight = Number(customHeightMm);
  const customShortEdge = enteredCustomWidth;
  const customLongEdge = enteredCustomHeight;
  const customSizeError = !customSizeEnabled
    ? null
    : !Number.isFinite(enteredCustomWidth) || !Number.isFinite(enteredCustomHeight) || !customWidthMm || !customHeightMm
      ? "Enter both paper dimensions."
      : customShortEdge < 55 || customShortEdge > 216 || customLongEdge < 89 || customLongEdge > 1200
        ? "Use a short edge of 55–216 mm and a long edge of 89–1200 mm."
        : null;
  const outputWidthMm = customSizeEnabled && !customSizeError ? customShortEdge : mediaWidthMm;
  const outputHeightMm = customSizeEnabled && !customSizeError ? customLongEdge : mediaHeightMm;
  const outputMediaSizeLabel = customSizeEnabled
    ? paperSizeDisplay("Custom", outputWidthMm, outputHeightMm)
    : approvedMediaSizeLabel;
  const printReadyFiles = workingOrder.files.filter((file) => file.kind === "print_ready" && (!file.jobOrderItemId || file.jobOrderItemId === item.id));
  const copies = printItem?.copies ?? 1;
  const pages = selectedFile?.detectedPageCount ?? printItem?.pagesPerCopy ?? 1;
  const completedFrontPass = workingOrder.printAttempts.find(
    (attempt) => attempt.jobOrderItemId === item.id && attempt.result === "succeeded" && attempt.duplexPass === "front",
  );
  const manualDuplex = Boolean(printItem?.requiresManualDuplex && pages > 1);
  const duplexPass: "simplex" | "front" | "back" = manualDuplex
    ? completedFrontPass ? "back" : "front"
    : "simplex";
  const sheetsPerCopy = manualDuplex ? Math.ceil(pages / 2) : pages;
  const frontPages = Math.ceil(pages / 2);
  const backPages = Math.floor(pages / 2);
  const automaticColorMode = selectedFile?.detectedColorPages === 0 && (selectedFile.detectedBwPages ?? 0) > 0
    ? "B&W document"
    : selectedFile?.detectedColorPages != null
      ? "Color content detected"
      : "Preserve source color";
  const selectedPrinter = printers?.find((printer) => printer.id === selectedPrinterId);
  const defaultPrinters = printers?.filter((printer) => printer.isDefault) ?? [];
  const otherPrinters = printers?.filter((printer) => !printer.isDefault) ?? [];
  const firstAvailablePrinterId = printers?.find((printer) => !["offline", "error"].includes(printer.lastSeenState))?.id;

  useEffect(() => {
    if (!open) return;
    setWorkingOrder(order);
    setSelectedPrinterId("");
    setSelectedFileId(order.files.find((file) => file.kind === "print_ready" && (!file.jobOrderItemId || file.jobOrderItemId === item.id))?.id ?? "");
    setOrientation("auto");
    setScaling(item.printType === "photo_print" ? "fill" : "auto");
    setQuality(item.printType === "photo_print" ? "high" : "auto");
    setMediaType(item.printType === "photo_print" ? "photo_plus_glossy_ii" : "auto");
    setBorderless(item.printType === "photo_print" && initialPaperSize !== "Legal");
    setCollate(true);
    setCustomSizeEnabled(initialPaperSize === "Custom");
    setCustomWidthMm(String(paperPlan?.paperWidthMm ?? mediaWidthMm));
    setCustomHeightMm(String(paperPlan?.paperHeightMm ?? mediaHeightMm));
    setPaperReinserted(false);
    setActionError(null);
    const priorFront = order.printAttempts.find(
      (attempt) => attempt.jobOrderItemId === item.id && attempt.result === "succeeded" && attempt.duplexPass === "front",
    );
    if (priorFront) {
      setSelectedPrinterId(priorFront.printerId);
      setSelectedFileId(priorFront.jobFileId ?? order.files.find((file) => file.kind === "print_ready" && (!file.jobOrderItemId || file.jobOrderItemId === item.id))?.id ?? "");
      setOrientation(priorFront.orientation);
      setMediaType(priorFront.mediaType as PrintMediaType);
      setScaling(priorFront.scaling);
      setQuality(priorFront.quality);
      setBorderless(priorFront.borderless);
      setCollate(priorFront.collate);
      setCustomSizeEnabled(priorFront.mediaSize === "Custom");
      setCustomWidthMm(String(priorFront.mediaWidthMm ?? mediaWidthMm));
      setCustomHeightMm(String(priorFront.mediaHeightMm ?? mediaHeightMm));
    }
  }, [initialPaperSize, mediaHeightMm, mediaWidthMm, open, order, item.id, item.printType, paperPlan?.paperHeightMm, paperPlan?.paperWidthMm]);

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
    if (!selectedPrinterId || !selectedFileId || saving || customSizeError) return;
    setSaving(true);
    setActionError(null);
    try {
      const updated = await api.post<JobOrder>(`/job-orders/${order.id}/print-attempts`, {
        printerId: selectedPrinterId,
        jobFileId: selectedFileId,
        jobOrderItemId: item.id,
        orientation,
        mediaType,
        scaling,
        quality,
        borderless,
        collate,
        duplexPass,
        ...(customSizeEnabled ? {
          mediaSize: "Custom",
          mediaWidthMm: customShortEdge,
          mediaHeightMm: customLongEdge,
        } : {}),
      });
      if (updated.status === "queued" && duplexPass === "front") {
        setWorkingOrder(updated);
        setPaperReinserted(false);
      } else {
        onPrinted(updated);
      }
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
    <Modal open={open} title={manualDuplex ? "Supervised back-to-back printing" : isPhotoPrint ? "Photo Print studio" : "Print setup"} description={`${order.name} · ${order.number} · ${manualDuplex ? "Complete both physical passes without losing the job context." : isPhotoPrint ? "Proof the image against the selected physical paper before handing it to the driver." : "Choose the printer and output settings without leaving this job order."}`} onClose={onClose} busy={saving} status={actionError ? "error" : saving ? "loading" : "idle"} className={`job-print-modal${isPhotoPrint ? " job-print-modal--photo" : ""}`}>
      {state === "loading" ? <LoadingState label="Reading printers…" /> : state === "error" ? <ErrorState title="Printers unavailable" description={printerError ?? undefined} onRetry={reload} /> : (
        <form className="job-print-form" onSubmit={handleSubmit}>
          {manualDuplex && (
            <nav className="duplex-progress" aria-label="Manual duplex progress">
              <ol>
                <li className={duplexPass === "front" ? "is-active" : "is-complete"}><span>01</span><strong>Front sides</strong></li>
                <li className={duplexPass === "back" ? paperReinserted ? "is-complete" : "is-active" : ""}><span>02</span><strong>Reload stack</strong></li>
                <li className={duplexPass === "back" && paperReinserted ? "is-active" : ""}><span>03</span><strong>Back sides</strong></li>
              </ol>
            </nav>
          )}
          <div className="job-print-body">
            {duplexPass === "back" ? (
              <ManualDuplexReload
                printer={selectedPrinter}
                filename={selectedFile?.originalFilename ?? "Print-ready file"}
                paperSize={outputMediaSizeLabel}
                copies={copies}
                sheetsPerCopy={sheetsPerCopy}
                backPages={backPages}
                paperReinserted={paperReinserted}
                onPaperReinserted={setPaperReinserted}
              />
            ) : (
            <>
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
              <header><div><span className="numeric">02 / OUTPUT</span><h3>Confirm file and settings</h3></div>{window.paperClub?.platform === "win32" && selectedPrinter && <Button type="button" size="sm" variant="secondary" onClick={handleOpenPreferences} loading={openingPreferences}>{/canon/i.test(selectedPrinter.displayName) ? "Canon print settings" : "Printer settings"}</Button>}</header>
              {isPhotoPrint ? (
                <div className="photo-print-studio">
                  <PrinterOutputPreview
                    orderId={order.id}
                    file={selectedFile}
                    paperLabel={outputMediaSizeLabel}
                    paperWidthMm={outputWidthMm}
                    paperHeightMm={outputHeightMm}
                    orientation={orientation}
                    scaling={scaling}
                    borderless={borderless}
                  />
                  <aside className="photo-print-controls" aria-label="Photo Print output controls">
                    <div className="photo-print-controls__device">
                      <span className="numeric">SELECTED DEVICE</span>
                      <strong>{selectedPrinter?.displayName ?? "Choose a printer above"}</strong>
                      <small>{selectedPrinter ? `${selectedPrinter.systemName} · ${printerStateMeta[selectedPrinter.lastSeenState].label}` : "A printer is required before submission."}</small>
                    </div>

                    <label className="form-field"><span>Print-ready file</span><select value={selectedFileId} onChange={(event) => setSelectedFileId(event.target.value)}>{printReadyFiles.map((file) => <option key={file.id} value={file.id}>{file.originalFilename}</option>)}</select><small>{pages} {pages === 1 ? "page" : "pages"} · {automaticColorMode}</small></label>

                    <div className="photo-print-paper">
                      <div className="photo-print-paper__heading"><span>Paper size</span><Button type="button" size="sm" variant="secondary" onClick={() => setCustomSizeEnabled((current) => !current)}>{customSizeEnabled ? "Use job size" : "Custom size"}</Button></div>
                      <strong>{outputMediaSizeLabel}</strong>
                      {customSizeEnabled && (
                        <div className="photo-print-custom-size" role="group" aria-label="Custom output paper dimensions">
                          <label><span>Short edge</span><span><input type="number" min="55" max="216" step="0.1" inputMode="decimal" value={customWidthMm} onChange={(event) => setCustomWidthMm(event.target.value)} aria-invalid={Boolean(customSizeError)} aria-describedby="photo-custom-size-help" /> mm</span></label>
                          <span aria-hidden="true">×</span>
                          <label><span>Long edge</span><span><input type="number" min="89" max="1200" step="0.1" inputMode="decimal" value={customHeightMm} onChange={(event) => setCustomHeightMm(event.target.value)} aria-invalid={Boolean(customSizeError)} aria-describedby="photo-custom-size-help" /> mm</span></label>
                        </div>
                      )}
                      <small id="photo-custom-size-help" className={customSizeError ? "is-error" : undefined}>{customSizeError ?? (customSizeEnabled ? `Driver override only. Pricing and inventory remain ${approvedMediaSizeLabel}.` : "Selected by the approved job; pricing and inventory use this material.")}</small>
                    </div>

                    <fieldset className="photo-print-orientation">
                      <legend>Orientation</legend>
                      {(["auto", "portrait", "landscape"] as const).map((value) => (
                        <label className={orientation === value ? "is-selected" : ""} key={value}>
                          <input type="radio" name="photo-orientation" value={value} checked={orientation === value} onChange={() => setOrientation(value)} />
                          <span aria-hidden="true" className={`photo-print-orientation__sheet is-${value}`} />
                          <strong>{value === "auto" ? "Auto" : value === "portrait" ? "Portrait" : "Landscape"}</strong>
                        </label>
                      ))}
                    </fieldset>

                    <label className="form-field"><span>Media type</span><select value={mediaType} onChange={(event) => setMediaType(event.target.value as PrintMediaType)}>{PRINT_MEDIA_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><small>Match this to the stock loaded in the printer.</small></label>
                    <label className="form-field"><span>Layout on paper</span><select value={scaling} onChange={(event) => setScaling(event.target.value as typeof scaling)}><option value="fill">Fill paper · crop edges</option><option value="fit">Fit · preserve entire image</option><option value="auto">Automatic · preserve source</option><option value="actual_size">Actual size · allow clipping</option></select><small>The output proof updates immediately.</small></label>
                    <label className="form-field"><span>Quality</span><select value={quality} onChange={(event) => setQuality(event.target.value as typeof quality)}><option value="high">High</option><option value="auto">Automatic · driver default</option><option value="standard">Standard</option><option value="draft">Draft</option></select></label>
                    <div className="photo-print-toggles">
                      <label className="job-print-check"><input type="checkbox" checked={borderless} onChange={(event) => setBorderless(event.target.checked)} /><span><strong>Borderless</strong><small>Fill the sheet edge to edge</small></span></label>
                      <label className="job-print-check"><input type="checkbox" checked={collate} onChange={(event) => setCollate(event.target.checked)} disabled={copies < 2} /><span><strong>Collate</strong><small>{copies} {copies === 1 ? "copy" : "copies"}</small></span></label>
                    </div>
                    <p className="job-print-photo-note" role="status"><span className="numeric">PHOTO OUTPUT</span><strong>{quality === "high" ? "High quality" : quality} · {scaling === "fill" ? "fill and crop" : scaling} · {borderless ? "borderless" : "driver margins"}</strong><small>The proof predicts geometry. The installed driver retains final authority over physical margins, tray support, and color correction.</small></p>
                  </aside>
                </div>
              ) : (
                <>
                  <PrinterOutputPreview
                    orderId={order.id}
                    file={selectedFile}
                    paperLabel={approvedMediaSizeLabel}
                    paperWidthMm={mediaWidthMm}
                    paperHeightMm={mediaHeightMm}
                    orientation={orientation}
                    scaling={scaling}
                    borderless={borderless}
                  />
                  <div className="job-print-proof">
                    <label className="form-field"><span>Print-ready file</span><select value={selectedFileId} onChange={(event) => setSelectedFileId(event.target.value)}>{printReadyFiles.map((file) => <option key={file.id} value={file.id}>{file.originalFilename}</option>)}</select></label>
                    <dl><div><dt>Pages</dt><dd>{pages}</dd></div><div><dt>Copies</dt><dd>{copies}</dd></div><div><dt>Paper</dt><dd>{approvedMediaSizeLabel}</dd></div><div><dt>Output</dt><dd>Auto · {automaticColorMode}</dd></div></dl>
                  </div>
                  <div className="job-print-settings">
                    <label className="form-field"><span>Media type</span><select value={mediaType} onChange={(event) => setMediaType(event.target.value as PrintMediaType)}>{PRINT_MEDIA_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><small>Automatic keeps the installed driver's current media profile.</small></label>
                    <label className="form-field"><span>Orientation</span><select value={orientation} onChange={(event) => setOrientation(event.target.value as typeof orientation)}><option value="auto">Auto per page</option><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select></label>
                    <label className="form-field"><span>Scaling</span><select value={scaling} onChange={(event) => setScaling(event.target.value as typeof scaling)}><option value="auto">Automatic · preserve size</option><option value="fit">Fit printable area</option><option value="actual_size">Actual size · allow clipping</option><option value="fill">Fill paper · crop edges</option></select></label>
                    <label className="form-field"><span>Quality</span><select value={quality} onChange={(event) => setQuality(event.target.value as typeof quality)}><option value="auto">Automatic · driver default</option><option value="draft">Draft</option><option value="standard">Standard</option><option value="high">High</option></select></label>
                    <label className="job-print-check"><input type="checkbox" checked={borderless} onChange={(event) => setBorderless(event.target.checked)} /><span><strong>Force borderless</strong><small>Off uses printer margins automatically</small></span></label>
                    <label className="job-print-check"><input type="checkbox" checked={collate} onChange={(event) => setCollate(event.target.checked)} disabled={copies < 2} /><span><strong>Collate copies</strong><small>Complete sets in order</small></span></label>
                  </div>
                  <p className="job-print-auto-note" role="status"><strong>Automatic document profile:</strong> product print type remains pricing-only. Source analysis controls color and orientation; original dimensions and document margins are preserved, shrinking only when the printer's physical area requires it.</p>
                  {window.paperClub?.platform === "win32" && selectedPrinter && <p className="job-print-driver-note"><strong>{/canon/i.test(selectedPrinter.displayName) ? "Canon driver controls" : "Installed driver controls"}:</strong> the driver keeps its media, paper-source, color-correction, and quality defaults unless you explicitly override them here.</p>}
                </>
              )}
            </section>
            {manualDuplex && <div className="duplex-supervision-note"><span className="numeric">SUPERVISED OUTPUT</span><strong>This submission prints front sides only.</strong><p>{frontPages} front-side {frontPages === 1 ? "page" : "pages"} per copy will print first. Keep the output stack together; this modal will then pause for reinsertion before any back side is sent.</p></div>}
            </>
            )}
            {actionError && <p className="workspace-form__error" role="alert">{actionError}</p>}
          </div>
          <footer className="job-order-form__actions">
            <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button type="submit" variant="primary" loading={saving} disabled={!selectedPrinterId || !selectedFileId || Boolean(customSizeError) || (duplexPass === "back" && !paperReinserted)}>{duplexPass === "front" ? "Print front sides" : duplexPass === "back" ? "Print back sides and deduct materials" : "Print and deduct materials"}</Button>
          </footer>
        </form>
      )}
    </Modal>
  );
}

function ManualDuplexReload({
  printer,
  filename,
  paperSize,
  copies,
  sheetsPerCopy,
  backPages,
  paperReinserted,
  onPaperReinserted,
}: {
  printer?: Printer;
  filename: string;
  paperSize: string;
  copies: number;
  sheetsPerCopy: number;
  backPages: number;
  paperReinserted: boolean;
  onPaperReinserted: (value: boolean) => void;
}) {
  const canon = /canon/i.test(printer?.displayName ?? "");
  return (
    <section className="duplex-reload" aria-labelledby="duplex-reload-title">
      <header>
        <span className="duplex-reload__status" aria-hidden="true">1/2</span>
        <div><span className="numeric">FRONT PASS SUBMITTED</span><h3 id="duplex-reload-title">Wait, then reload the complete stack</h3><p>Do not continue until every front side has finished printing.</p></div>
      </header>
      <dl>
        <div><dt>Document</dt><dd>{filename}</dd></div>
        <div><dt>Printer</dt><dd>{printer?.displayName ?? "Selected printer"}</dd></div>
        <div><dt>Stack</dt><dd>{sheetsPerCopy * copies} {paperSize} sheets</dd></div>
        <div><dt>Back pass</dt><dd>{backPages} pages × {copies} copies</dd></div>
      </dl>
      <ol className="duplex-reload__instructions">
        <li><span>01</span><div><strong>Collect the full output stack</strong><p>Keep every sheet in the order it leaves the printer. Do not shuffle or reverse individual sheets.</p></div></li>
        <li><span>02</span><div><strong>Rotate the stack 180 degrees</strong><p>Turn the complete stack end-for-end while keeping its page order intact.</p></div></li>
        <li><span>03</span><div><strong>Reload printed side facing down</strong><p>{canon ? "Place it in the Canon rear tray, align both paper guides, and confirm the paper setting on the printer." : "Use the same input tray. If its loading diagram differs, follow the installed printer driver's manual-duplex direction."}</p></div></li>
      </ol>
      <label className="duplex-reload__confirm"><input type="checkbox" checked={paperReinserted} onChange={(event) => onPaperReinserted(event.target.checked)} /><span><strong>The front pass is physically finished and the stack is reinserted correctly.</strong><small>The back-side button stays locked until this is confirmed.</small></span></label>
      <p className="duplex-reload__warning"><strong>Stay near the printer.</strong> The back pass is intentionally a separate submission. Inventory is deducted only after it is accepted.</p>
    </section>
  );
}
