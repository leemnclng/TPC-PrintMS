import { FormEvent, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "../components/PageHeader/PageHeader";
import { Card, CardHeader } from "../components/Card/Card";
import { Button } from "../components/Button/Button";
import { LinkButton } from "../components/Button/LinkButton";
import { StatusPill } from "../components/StatusPill/StatusPill";
import { EmptyState } from "../components/EmptyState/EmptyState";
import { LoadingState } from "../components/LoadingState/LoadingState";
import { ErrorState } from "../components/ErrorState/ErrorState";
import { useResource } from "../hooks/useResource";
import { api, ApiError } from "../lib/apiClient";
import { formatCurrency, formatDate, formatDateTime, formatFileSize } from "../lib/format";
import { PRINT_MEDIA_OPTIONS, printMediaLabel, type PrintMediaType } from "../lib/printProfiles";
import { paperSizeDefinition, paperSizeDisplay } from "../lib/paperSizes";
import { jobOrderStatusMeta, printerStateMeta } from "../types/statusMeta";
import type { JobOrder, Printer, PrinterPlatformInfo, SpoolerMonitorInfo } from "../types/domain";
import "./PrintCenterPage.css";

export function PrintCenterPage() {
  const [searchParams] = useSearchParams();
  const jobOrderId = searchParams.get("jobOrderId");
  const { data, state, error, reload } = useResource(() => api.get<Printer[]>("/printers"));
  const {
    data: stagedOrder,
    state: stagedState,
    error: stagedError,
    reload: reloadStagedOrder,
  } = useResource<JobOrder | null>(
    () => jobOrderId ? api.get<JobOrder>(`/job-orders/${encodeURIComponent(jobOrderId)}`) : Promise.resolve(null),
    [jobOrderId],
  );
  const {
    data: platformInfo,
    state: platformState,
    error: platformError,
    reload: reloadPlatform,
  } = useResource(() => api.get<PrinterPlatformInfo>("/printers/platform"));
  const {
    data: spoolerInfo,
    state: spoolerState,
    error: spoolerError,
    reload: reloadSpooler,
  } = useResource(() => api.get<SpoolerMonitorInfo>("/printers/spooler-jobs"));
  const [discovering, setDiscovering] = useState(false);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [openingSettings, setOpeningSettings] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [selectedPrinterId, setSelectedPrinterId] = useState("");
  const [selectedFileId, setSelectedFileId] = useState("");
  const [submittingPrint, setSubmittingPrint] = useState(false);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [orientation, setOrientation] = useState<"auto" | "portrait" | "landscape">("auto");
  const [scaling, setScaling] = useState<"auto" | "fit" | "fill" | "actual_size">("auto");
  const [quality, setQuality] = useState<"auto" | "draft" | "standard" | "high">("auto");
  const [mediaType, setMediaType] = useState<PrintMediaType>("auto");
  const [borderless, setBorderless] = useState(false);
  const [collate, setCollate] = useState(true);

  const nativePlatform = window.paperClub?.platform;
  const resolvedPlatform = platformInfo?.platform
    ?? (nativePlatform === "win32" ? "windows" : nativePlatform === "darwin" ? "macos" : undefined);
  const platformLabel = resolvedPlatform === "windows"
    ? "Windows"
    : resolvedPlatform === "macos"
      ? "macOS"
      : resolvedPlatform === "linux"
        ? "Linux"
        : "operating system";
  const printerSettingsLabel = nativePlatform === "win32"
    ? "Open Windows printer settings"
    : nativePlatform === "darwin"
      ? "Open macOS printer settings"
      : "Open printer settings";
  const queueLabel = resolvedPlatform === "windows"
    ? "WINDOWS QUEUE"
    : resolvedPlatform === "macos"
      ? "MACOS QUEUE"
      : resolvedPlatform === "linux"
        ? "LINUX QUEUE"
        : "OS QUEUE";
  const printItem = stagedOrder?.items[0];
  const isPhotoPrint = printItem?.printType === "photo_print";
  const selectedFile = stagedOrder?.files.find((file) => file.id === selectedFileId);
  const paperPlan = printItem?.materials.find((material) => material.paperSize);
  const configuredPaper = paperPlan?.paperSize;
  const detectedPaper = selectedFile?.detectedPaperSize;
  const mediaSize = configuredPaper ?? (paperSizeDefinition(detectedPaper) ? detectedPaper : "A4");
  const mediaSizeLabel = paperSizeDisplay(mediaSize, paperPlan?.paperWidthMm, paperPlan?.paperHeightMm);
  const copies = printItem?.copies ?? 1;
  const pageCount = selectedFile?.detectedPageCount ?? printItem?.pagesPerCopy ?? 1;
  const automaticColorMode = selectedFile?.detectedColorPages === 0 && (selectedFile.detectedBwPages ?? 0) > 0
    ? "B&W document"
    : selectedFile?.detectedColorPages != null
      ? "Color content detected"
      : "Preserve source color";
  const totalSheets = pageCount * copies;
  const paperDeduction = Math.max((paperPlan?.plannedQuantity ?? totalSheets) - (paperPlan?.consumedQuantity ?? 0), 0);
  const defaultPrinters = data?.filter((printer) => printer.isDefault) ?? [];
  const otherPrinters = data?.filter((printer) => !printer.isDefault) ?? [];
  const selectedPrinter = data?.find((printer) => printer.id === selectedPrinterId);

  useEffect(() => {
    if (!stagedOrder) return;
    const printFile = stagedOrder.files.find((file) => file.kind === "print_ready");
    setSelectedFileId(printFile?.id ?? "");
    setSubmissionError(null);
  }, [stagedOrder]);

  useEffect(() => {
    setOrientation("auto");
    setScaling(isPhotoPrint ? "fill" : "auto");
    setQuality(isPhotoPrint ? "high" : "auto");
    setMediaType(isPhotoPrint ? "photo_plus_glossy_ii" : "auto");
    setBorderless(Boolean(isPhotoPrint && configuredPaper !== "Legal"));
    setCollate(true);
  }, [configuredPaper, isPhotoPrint, jobOrderId]);

  useEffect(() => {
    if (!data?.length || selectedPrinterId) return;
    const available = data.find((printer) => printer.isDefault && !["offline", "error"].includes(printer.lastSeenState))
      ?? data.find((printer) => !["offline", "error"].includes(printer.lastSeenState));
    setSelectedPrinterId(available?.id ?? "");
  }, [data, selectedPrinterId]);

  useEffect(() => {
    if (resolvedPlatform !== "windows") return;
    const timer = window.setInterval(reloadSpooler, 3000);
    return () => window.clearInterval(timer);
  }, [reloadSpooler, resolvedPlatform]);

  async function handlePrintSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!stagedOrder || stagedOrder.status !== "queued" || !selectedPrinterId || !selectedFileId || submittingPrint) return;
    setSubmittingPrint(true);
    setSubmissionError(null);
    try {
      await api.post<JobOrder>(`/job-orders/${stagedOrder.id}/print-attempts`, {
        printerId: selectedPrinterId,
        jobFileId: selectedFileId,
        orientation,
        mediaType,
        scaling,
        quality,
        borderless,
        collate,
      });
      reloadStagedOrder();
      reload();
    } catch (caught) {
      setSubmissionError(caught instanceof ApiError ? caught.message : "The print job could not be submitted.");
      reloadStagedOrder();
    } finally {
      setSubmittingPrint(false);
    }
  }

  async function handleDiscover() {
    setDiscovering(true);
    setDiscoverError(null);
    try {
      await api.post<Printer[]>("/printers/discover");
      reload();
    } catch (err) {
      setDiscoverError(err instanceof ApiError ? err.message : "Couldn't reach the printer subsystem.");
    } finally {
      setDiscovering(false);
    }
  }

  async function handleOpenPrinterSettings() {
    setSettingsError(null);
    if (!window.paperClub) {
      setSettingsError("Printer settings can only be opened from the Printing-MS desktop app.");
      return;
    }
    setOpeningSettings(true);
    try {
      await window.paperClub.openPrinterSettings();
    } catch {
      setSettingsError("Windows printer settings couldn't be opened. Open Settings → Bluetooth & devices → Printers & scanners manually.");
    } finally {
      setOpeningSettings(false);
    }
  }

  async function handleOpenPrinterPreferences() {
    setSettingsError(null);
    if (!window.paperClub || !selectedPrinter) {
      setSettingsError("Select a printer in the Printing-MS desktop app first.");
      return;
    }
    setOpeningSettings(true);
    try {
      await window.paperClub.openPrinterPreferences(selectedPrinter.systemName);
    } catch {
      setSettingsError(`Windows printing preferences for ${selectedPrinter.displayName} couldn't be opened.`);
    } finally {
      setOpeningSettings(false);
    }
  }

  function renderPrinterChoice(printer: Printer, featured = false) {
    const unavailable = ["offline", "error"].includes(printer.lastSeenState);
    const selected = selectedPrinterId === printer.id;
    const card = (
      <Card className={[featured ? "printer-card--featured" : "printer-card--other", selected ? "is-selected" : ""].filter(Boolean).join(" ")}>
        <CardHeader title={printer.displayName} meta={featured ? "Default printer" : undefined} />
        <StatusPill
          label={printerStateMeta[printer.lastSeenState].label}
          tone={printerStateMeta[printer.lastSeenState].tone}
        />
        <p className="printer-card__queue numeric">{queueLabel} · {printer.systemName}</p>
        <p className="printer-card__meta">Last seen {formatDate(printer.lastSeenAt)}</p>
        <strong className="printer-card__selection">{unavailable ? "Unavailable" : selected ? stagedOrder?.status === "queued" ? "Selected for this job" : "Selected printer" : "Select printer"}</strong>
      </Card>
    );
    return (
      <label className={`printer-choice${unavailable ? " is-disabled" : ""}`} key={printer.id}>
        <input type="radio" name="printer" value={printer.id} checked={selected} disabled={unavailable} onChange={() => setSelectedPrinterId(printer.id)} />
        {card}
      </label>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="PRINT CENTER"
        title="Print Center"
        description={`Connect Canon or any other brand through the ${platformLabel} print queue, then manage it here without depending on one manufacturer's app.`}
        actions={
          <>
            <Button variant="secondary" onClick={handleOpenPrinterSettings} loading={openingSettings}>
              {printerSettingsLabel}
            </Button>
            <Button variant="primary" onClick={handleDiscover} loading={discovering}>
              Refresh printers
            </Button>
          </>
        }
      />

      {jobOrderId && stagedState === "loading" && <LoadingState label="Staging confirmed transaction…" />}
      {jobOrderId && stagedState === "error" && (
        <ErrorState title="Confirmed transaction unavailable" description={stagedError ?? undefined} onRetry={reloadStagedOrder} />
      )}
      {jobOrderId && stagedState === "ready" && stagedOrder && (
        <section className="staged-print" aria-labelledby="staged-print-title">
          <div className="staged-print__status">
            <span className="staged-print__check" aria-hidden="true">✓</span>
            <div>
              <span className="numeric">03 / PRINT SETUP</span>
              <h2 id="staged-print-title">{stagedOrder.name} is confirmed and staged</h2>
              <p>Select an available operating-system printer below. Direct queue submission remains a separate confirmation step.</p>
            </div>
            <LinkButton to={`/job-orders/${stagedOrder.id}`} variant="secondary" size="sm">View job order</LinkButton>
          </div>
          <dl>
            <div><dt>Product</dt><dd>{stagedOrder.items[0]?.productName ?? "—"}</dd></div>
            <div><dt>Pages × copies</dt><dd>{stagedOrder.items[0] ? `${stagedOrder.items[0].pagesPerCopy} × ${stagedOrder.items[0].copies}` : "—"}</dd></div>
            <div><dt>Final price</dt><dd>{formatCurrency(stagedOrder.total)}</dd></div>
            <div><dt>Pricing</dt><dd>{stagedOrder.priceOverridden ? `Owner override · suggested ${formatCurrency(stagedOrder.suggestedTotal)}` : "Engine recommendation"}</dd></div>
          </dl>
        </section>
      )}

      <section className="printer-connection" aria-labelledby="printer-connection-title">
        <div className="printer-connection__intro">
          <span className="printer-connection__kicker numeric">CANON FIRST · ANY BRAND NEXT</span>
          <h2 id="printer-connection-title">Connect through {platformLabel} once</h2>
          <p>
            Canon PRINT remains available for setup, ink checks, scanning, and maintenance.
            Printing-MS uses the installed {platformLabel} queue, which is also how Epson, Brother,
            HP, AirPrint, and IPP printers remain compatible.
          </p>
          <div className="printer-platform" aria-live="polite">
            <span className={`printer-platform__indicator is-${platformState}`} aria-hidden="true" />
            <div>
              <small className="numeric">HOST OPERATING SYSTEM</small>
              {platformState === "loading" && <strong>Detecting…</strong>}
              {platformState === "ready" && platformInfo && (
                <>
                  <strong>{platformLabel}</strong>
                  <span>{platformInfo.detectionSource === "automatic" ? "Auto-detected" : "Environment override"}</span>
                </>
              )}
              {platformState === "error" && (
                <>
                  <strong>Detection unavailable</strong>
                  <button type="button" onClick={reloadPlatform} title={platformError ?? undefined}>Retry detection</button>
                </>
              )}
            </div>
          </div>
        </div>
        <ol className="printer-connection__steps">
          <li>
            <span className="printer-connection__number numeric">01</span>
            <div><strong>Set up in Canon PRINT</strong><small>Connect the Canon printer by network or USB and install its Windows driver.</small></div>
          </li>
          <li>
            <span className="printer-connection__number numeric">02</span>
            <div><strong>Add the {platformLabel} queue</strong><small>Open printer settings and add the Canon printer if it is not already listed.</small></div>
          </li>
          <li>
            <span className="printer-connection__number numeric">03</span>
            <div><strong>Refresh Printing-MS</strong><small>The installed queue appears below and stays vendor-neutral.</small></div>
          </li>
        </ol>
      </section>

      {settingsError && <ErrorState title="Couldn't open printer settings" description={settingsError} />}
      {discoverError && <ErrorState title="Discovery failed" description={discoverError} />}

      {state === "loading" && <LoadingState label="Reading printer list…" />}
      {state === "error" && <ErrorState description={error ?? undefined} onRetry={reload} />}

      {state === "ready" && data && data.length === 0 && (
        <EmptyState
          title="No printers detected"
          description={`Finish setup in Canon PRINT, add the printer under ${platformLabel} printer settings, then refresh this list.`}
          action={
            <Button variant="secondary" onClick={handleDiscover} loading={discovering}>
              Refresh printers
            </Button>
          }
        />
      )}

      {state === "ready" && data && data.length > 0 && (
        <section className="printer-roster" aria-labelledby="printer-roster-title">
          <header className="printer-roster__heading">
            <div><span className="numeric">AVAILABLE DEVICES</span><h2 id="printer-roster-title">Choose a print queue</h2></div>
            <div className="printer-roster__aside">
              <p>The Windows default stays prominent; alternatives remain available without competing for attention.</p>
              {nativePlatform === "win32" && selectedPrinter && <Button type="button" variant="secondary" size="sm" onClick={handleOpenPrinterPreferences} loading={openingSettings}>{/canon/i.test(selectedPrinter.displayName) ? "Canon print settings" : "Selected printer settings"}</Button>}
            </div>
          </header>
          <div className="printer-default-pane">
            <div className="printer-pane-heading"><span className="numeric">DEFAULT</span><strong>Primary printer</strong></div>
            {defaultPrinters.length > 0 ? (
              <div className="printer-default-grid">{defaultPrinters.map((printer) => renderPrinterChoice(printer, true))}</div>
            ) : (
              <p className="printer-pane-empty">Windows has no default printer. Set one in printer settings; available queues remain under Others.</p>
            )}
          </div>
          {otherPrinters.length > 0 && (
            <div className="printer-others-pane">
              <div className="printer-pane-heading"><span className="numeric">OTHERS</span><strong>Alternative queues</strong><small>Still selectable for this job</small></div>
              <div className="printer-others-grid">{otherPrinters.map((printer) => renderPrinterChoice(printer))}</div>
            </div>
          )}
        </section>
      )}

      {stagedOrder && (
        <section className="print-submission" aria-labelledby="print-submission-title">
          <header>
            <div><span className="numeric">OS PRINT SUBMISSION · {stagedOrder.number}</span><h2 id="print-submission-title">Send {stagedOrder.name} to the selected queue</h2></div>
            <StatusPill label={jobOrderStatusMeta[stagedOrder.status].label} tone={jobOrderStatusMeta[stagedOrder.status].tone} />
          </header>
          {stagedOrder.status === "queued" && printItem?.requiresManualDuplex ? (
            <div className="print-submission__gate">
              <div>
                <strong>This Back-to-Back job requires supervised printing.</strong>
                <span>Open the job order to print front sides, pause for stack reinsertion, and then submit the back sides safely.</span>
              </div>
              <LinkButton to={`/job-orders/${stagedOrder.id}`} variant="primary">Open supervised print modal</LinkButton>
            </div>
          ) : stagedOrder.status === "queued" ? (
            <form onSubmit={handlePrintSubmit}>
              <div className="print-auto-profile">
                <div className="print-auto-profile__heading">
                  <span className="numeric">DOCUMENT & PRODUCT PROFILE</span>
                  <strong>Ready from the approved transaction</strong>
                  <small>Paper and copies stay aligned with pricing and inventory; physical output follows the analyzed source.</small>
                </div>
                <label className="form-field"><span>Print-ready file</span><select value={selectedFileId} onChange={(event) => setSelectedFileId(event.target.value)}>{stagedOrder.files.filter((file) => file.kind === "print_ready").map((file) => <option key={file.id} value={file.id}>{file.originalFilename}</option>)}</select></label>
                <dl>
                  <div><dt>Pages</dt><dd>{pageCount.toLocaleString()}</dd></div>
                  <div><dt>Copies</dt><dd>{copies.toLocaleString()}</dd></div>
                  <div><dt>Paper deduction</dt><dd>{paperDeduction.toLocaleString()} {paperPlan?.inventoryItemUnit ?? "sheets"}</dd></div>
                  <div><dt>Paper</dt><dd>{mediaSizeLabel}</dd></div>
                  <div><dt>Output</dt><dd>Auto · {automaticColorMode}</dd></div>
                  <div><dt>Detected layout</dt><dd>{selectedFile?.detectedOrientation ?? "Mixed / unknown"}</dd></div>
                  <div><dt>Source pages</dt><dd>{selectedFile?.detectedColorPages ?? 0} color · {selectedFile?.detectedBwPages ?? pageCount} B&W</dd></div>
                  <div><dt>Ink load</dt><dd>{selectedFile?.estimatedInkCoveragePercent != null ? `${selectedFile.estimatedInkCoveragePercent.toFixed(1)}%` : "—"}</dd></div>
                </dl>
              </div>
              <fieldset className="print-controls">
                <legend>Print settings</legend>
                <div className="print-controls__intro">
                  <div><span className="numeric">WINDOWS-STYLE CONTROLS</span><strong>Adjust output for this attempt</strong><small>These choices are saved in Print History and sent to the selected driver.</small></div>
                  {nativePlatform === "win32" && selectedPrinter && (
                    <Button type="button" variant="secondary" size="sm" onClick={handleOpenPrinterPreferences} loading={openingSettings}>{/canon/i.test(selectedPrinter.displayName) ? "Open Canon print settings" : "Open driver settings"}</Button>
                  )}
                </div>
                <div className="print-controls__grid">
                  <label className={`form-field${isPhotoPrint ? " print-media-field" : ""}`}><span>Media type</span><select value={mediaType} onChange={(event) => setMediaType(event.target.value as PrintMediaType)}>{PRINT_MEDIA_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><small>{isPhotoPrint ? "Match this to the paper loaded in the printer." : "Automatic keeps the installed driver's current media profile."}</small></label>
                  <label className="form-field"><span>Orientation</span><select value={orientation} onChange={(event) => setOrientation(event.target.value as typeof orientation)}><option value="auto">Auto per page</option><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select><small>Auto follows each analyzed page.</small></label>
                  <label className="form-field"><span>Scaling</span><select value={scaling} onChange={(event) => setScaling(event.target.value as typeof scaling)}><option value="auto">Automatic · preserve size</option><option value="fit">Fit printable area</option><option value="actual_size">Actual size · allow clipping</option><option value="fill">Fill paper · crop edges</option></select><small>Automatic keeps original dimensions and only shrinks when required.</small></label>
                  <label className="form-field"><span>Print quality</span><select value={quality} onChange={(event) => setQuality(event.target.value as typeof quality)}><option value="auto">Automatic · driver default</option><option value="draft">Draft</option><option value="standard">Standard</option><option value="high">High</option></select><small>Automatic leaves the installed driver's quality unchanged.</small></label>
                  <label className="print-toggle"><input type="checkbox" checked={borderless} onChange={(event) => setBorderless(event.target.checked)} /><span><strong>Force borderless output</strong><small>Off fits within printer margins; on requires supported media for {mediaSizeLabel}.</small></span></label>
                  <label className="print-toggle"><input type="checkbox" checked={collate} onChange={(event) => setCollate(event.target.checked)} disabled={copies < 2} /><span><strong>Collate copies</strong><small>{copies < 2 ? "Available when printing multiple copies." : "Print one complete document before the next copy."}</small></span></label>
                </div>
                {isPhotoPrint && <p className="print-controls__photo-profile"><span className="numeric">PHOTO PRINT PROFILE</span><strong>High quality · fill and crop · borderless</strong><small>Photo-safe defaults are active. Use Fit to retain the full image or disable borderless when the loaded size does not support it.</small></p>}
                <p className="print-controls__driver-note"><strong>Automatic document profile:</strong> analysis preserves source color and orientation. Original dimensions and document margins stay intact; the page shrinks only when the driver's physical printable area requires it.</p>
                <p className="print-controls__driver-note"><strong>Canon-specific paper type, tray, and color correction:</strong> use Canon print settings. Automatic quality preserves the installed driver's configured default.</p>
              </fieldset>
              <div className="print-submission__confirm">
                <p><strong>Submitting also deducts every remaining planned material from Inventory.</strong><span>The request is blocked before printing when stock is insufficient. Failed printer submissions do not deduct anything.</span></p>
                <Button variant="primary" type="submit" loading={submittingPrint} disabled={!selectedPrinterId || !selectedFileId}>Proceed to print</Button>
              </div>
              {submissionError && <p className="print-submission__error" role="alert">{submissionError}</p>}
            </form>
          ) : (
            <div className="print-submission__gate">
              <div>
                <strong>{stagedOrder.status === "printing" ? "The file was submitted and planned materials were deducted." : stagedOrder.status === "ready" ? "Printing is done. Continue in the job order to run the quality check and mark it ready." : "This job has already moved beyond print submission."}</strong>
                <span>Production status changes remain deliberate owner confirmations; inventory usage is recorded in the job ledger.</span>
              </div>
              <LinkButton to={`/job-orders/${stagedOrder.id}`} variant="primary">Continue in job order</LinkButton>
            </div>
          )}
        </section>
      )}

      <div className="print-center-columns">
        <Card>
          <CardHeader title="Ready-to-print files" />
          {stagedOrder?.files.length ? (
            <div className="staged-file-list">
              {stagedOrder.files.map((file) => (
                <div key={file.id}>
                  <span className="staged-file-list__mark numeric">{file.kind === "print_ready" ? "READY" : "SOURCE"}</span>
                  <div><strong>{file.originalFilename}</strong><small>{file.detectedPageCount ? `${file.detectedPageCount} pages · ${file.detectedPaperSize ?? "unknown paper"} · ` : ""}{formatFileSize(file.sizeBytes)} · staged {formatDate(file.uploadedAt)}</small></div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No files staged" description="Confirm an analyzed transaction to stage its customer file here." />
          )}
        </Card>
        <Card>
          <CardHeader title="Print history" />
          {stagedOrder?.printAttempts.length ? (
            <div className="print-history-list">
              {stagedOrder.printAttempts.map((attempt) => (
                <div key={attempt.id}>
                  <div><strong>{attempt.printerName}</strong><span>{attempt.duplexPass === "front" ? "Front-side pass · " : attempt.duplexPass === "back" ? "Back-side pass · " : ""}{attempt.filename || "Print-ready file"} · {attempt.copies} {attempt.copies === 1 ? "copy" : "copies"} · {paperSizeDisplay(attempt.mediaSize, attempt.mediaWidthMm, attempt.mediaHeightMm)} · {printMediaLabel(attempt.mediaType)} · {attempt.orientation === "auto" ? "auto orientation" : attempt.orientation} · {attempt.quality}</span><small>{attempt.errorMessage || `Submitted ${formatDate(attempt.submittedAt)}`}</small></div>
                  <StatusPill label={attempt.result === "succeeded" ? "Submitted" : attempt.result} tone={attempt.result === "succeeded" ? "success" : attempt.result === "failed" ? "danger" : "info"} />
                </div>
              ))}
            </div>
          ) : <EmptyState title="No print attempts recorded" description="Queue a paid job and submit its staged file to record the first attempt." />}
        </Card>
      </div>

      <section className="spooler-activity" aria-labelledby="spooler-activity-title">
        <header className="spooler-activity__header">
          <div>
            <span className="numeric">EXTERNAL WINDOWS ACTIVITY</span>
            <h2 id="spooler-activity-title">Windows spooler jobs</h2>
            <p>Captures jobs sent through Windows by Canon PRINT and other desktop applications while Printing-MS is open.</p>
          </div>
          <div className={`spooler-monitor-state${spoolerInfo?.active ? " is-active" : ""}`} role="status" aria-live="polite">
            <span aria-hidden="true" />
            <div><strong>{spoolerInfo?.active ? "Monitoring" : spoolerInfo?.supported === false ? "Windows only" : "Not monitoring"}</strong><small>{spoolerInfo?.message ?? "Checking the Windows spooler…"}</small></div>
          </div>
        </header>

        {spoolerState === "loading" && !spoolerInfo && <LoadingState label="Reading Windows print activity…" />}
        {spoolerState === "error" && !spoolerInfo && <ErrorState title="Spooler activity unavailable" description={spoolerError ?? undefined} onRetry={reloadSpooler} />}
        {spoolerInfo && spoolerInfo.jobs.length > 0 ? (
          <div className="spooler-job-list">
            {spoolerInfo.jobs.map((job) => {
              const tone = job.status === "error" ? "danger" : job.status === "paused" ? "warning" : job.status === "released" ? "neutral" : "info";
              const pageSummary = job.totalPages ? `${job.pagesPrinted ?? 0} / ${job.totalPages} pages` : "Page count unavailable";
              const reviewLabel = job.reviewStatus === "linked" ? "EXTERNAL · JOB CREATED" : job.reviewStatus === "dismissed" ? "EXTERNAL · REVIEWED" : "EXTERNAL · UNLINKED";
              return (
                <article key={job.id}>
                  <span className="spooler-job-list__origin numeric">{reviewLabel}</span>
                  <div className="spooler-job-list__body">
                    <strong>{job.documentName}</strong>
                    <span>{job.printerName} · Windows job {job.osJobId} · {pageSummary}</span>
                    <small>{job.owner ? `${job.owner} · ` : ""}{job.submittedAt ? `submitted ${formatDateTime(job.submittedAt)}` : `first seen ${formatDateTime(job.firstSeenAt)}`}</small>
                  </div>
                  <div className="spooler-job-list__actions">
                    <StatusPill label={job.status === "released" ? "Released by spooler" : job.status} tone={tone} />
                    {job.linkedJobOrderId ? (
                      <LinkButton to={`/job-orders/${encodeURIComponent(job.linkedJobOrderId)}`} variant="ghost" size="sm">View job</LinkButton>
                    ) : (
                      <LinkButton to={`/job-orders?create=1&spoolerJobId=${encodeURIComponent(job.id)}`} variant="ghost" size="sm">Create job</LinkButton>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        ) : spoolerInfo?.supported ? (
          <EmptyState title="No external Windows jobs observed" description="Keep Printing-MS open, then print through Canon PRINT or another Windows application. New spooler jobs will appear here automatically." />
        ) : (
          <EmptyState title="Windows spooler monitoring is unavailable" description="This computer is not using the Windows printer host. Printing-MS does not fabricate external activity on macOS or Linux." />
        )}

        <p className="spooler-activity__boundary"><strong>Direct printer actions are outside the Windows queue.</strong> Copies, scans, USB-host prints, and mobile/cloud jobs started on the printer may expose device activity, but Windows cannot provide their document name, owner, or reliable job completion.</p>
      </section>
    </>
  );
}
