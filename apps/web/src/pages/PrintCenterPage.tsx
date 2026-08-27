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
import { formatCurrency, formatDate, formatFileSize } from "../lib/format";
import { jobOrderStatusMeta, printerStateMeta } from "../types/statusMeta";
import type { JobOrder, Printer, PrinterPlatformInfo } from "../types/domain";
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
  const [discovering, setDiscovering] = useState(false);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [openingSettings, setOpeningSettings] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [selectedPrinterId, setSelectedPrinterId] = useState("");
  const [selectedFileId, setSelectedFileId] = useState("");
  const [copies, setCopies] = useState(1);
  const [colorMode, setColorMode] = useState<"color" | "grayscale">("color");
  const [mediaSize, setMediaSize] = useState<"A4" | "Letter" | "Legal">("A4");
  const [submittingPrint, setSubmittingPrint] = useState(false);
  const [submissionError, setSubmissionError] = useState<string | null>(null);

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

  useEffect(() => {
    if (!stagedOrder) return;
    const item = stagedOrder.items[0];
    const printFile = stagedOrder.files.find((file) => file.kind === "print_ready");
    const paper = item?.materials.find((material) => material.paperSize)?.paperSize;
    setSelectedFileId(printFile?.id ?? "");
    setCopies(item?.copies ?? 1);
    setColorMode(item?.printType === "black_and_white" ? "grayscale" : "color");
    setMediaSize(paper ?? "A4");
    setSubmissionError(null);
  }, [stagedOrder]);

  useEffect(() => {
    if (!data?.length || selectedPrinterId) return;
    const available = data.find((printer) => printer.isDefault && !["offline", "error"].includes(printer.lastSeenState))
      ?? data.find((printer) => !["offline", "error"].includes(printer.lastSeenState));
    setSelectedPrinterId(available?.id ?? "");
  }, [data, selectedPrinterId]);

  async function handlePrintSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!stagedOrder || stagedOrder.status !== "queued" || !selectedPrinterId || !selectedFileId || submittingPrint) return;
    setSubmittingPrint(true);
    setSubmissionError(null);
    try {
      await api.post<JobOrder>(`/job-orders/${stagedOrder.id}/print-attempts`, {
        printerId: selectedPrinterId,
        jobFileId: selectedFileId,
        copies,
        colorMode,
        mediaSize,
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
              <h2 id="staged-print-title">{stagedOrder.number} is confirmed and staged</h2>
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
            Canon PRINT can set up the printer, check ink, and keep its connection healthy.
            Printing-MS reads the {platformLabel} queue it creates, which is also how Epson, Brother,
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
            <div><strong>Set up in Canon PRINT</strong><small>Connect the Canon printer to the same network as this Windows computer.</small></div>
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
        <div className="printer-grid">
          {data.map((printer) => {
            const unavailable = ["offline", "error"].includes(printer.lastSeenState);
            const card = <Card className={selectedPrinterId === printer.id ? "is-selected" : undefined}>
              <CardHeader title={printer.displayName} meta={printer.isDefault ? "Default" : undefined} />
              <StatusPill
                label={printerStateMeta[printer.lastSeenState].label}
                tone={printerStateMeta[printer.lastSeenState].tone}
              />
              <p className="printer-card__queue numeric">{queueLabel} · {printer.systemName}</p>
              <p className="printer-card__meta">Last seen {formatDate(printer.lastSeenAt)}</p>
              {stagedOrder?.status === "queued" && <strong className="printer-card__selection">{unavailable ? "Unavailable" : selectedPrinterId === printer.id ? "Selected" : "Select printer"}</strong>}
            </Card>;
            return stagedOrder?.status === "queued" ? (
              <label className={`printer-choice${unavailable ? " is-disabled" : ""}`} key={printer.id}>
                <input type="radio" name="printer" value={printer.id} checked={selectedPrinterId === printer.id} disabled={unavailable} onChange={() => setSelectedPrinterId(printer.id)} />
                {card}
              </label>
            ) : <div key={printer.id}>{card}</div>;
          })}
        </div>
      )}

      {stagedOrder && (
        <section className="print-submission" aria-labelledby="print-submission-title">
          <header>
            <div><span className="numeric">OS PRINT SUBMISSION</span><h2 id="print-submission-title">Send {stagedOrder.number} to the selected queue</h2></div>
            <StatusPill label={jobOrderStatusMeta[stagedOrder.status].label} tone={jobOrderStatusMeta[stagedOrder.status].tone} />
          </header>
          {stagedOrder.status === "queued" ? (
            <form onSubmit={handlePrintSubmit}>
              <div className="print-submission__fields">
                <label className="form-field"><span>Print-ready file</span><select value={selectedFileId} onChange={(event) => setSelectedFileId(event.target.value)}>{stagedOrder.files.filter((file) => file.kind === "print_ready").map((file) => <option key={file.id} value={file.id}>{file.originalFilename}</option>)}</select></label>
                <label className="form-field"><span>Copies</span><input type="number" min="1" max="99" value={copies} onChange={(event) => setCopies(Number(event.target.value))} /></label>
                <label className="form-field"><span>Color mode</span><select value={colorMode} onChange={(event) => setColorMode(event.target.value as "color" | "grayscale")}><option value="color">Color</option><option value="grayscale">Grayscale</option></select></label>
                <label className="form-field"><span>Paper size</span><select value={mediaSize} onChange={(event) => setMediaSize(event.target.value as "A4" | "Letter" | "Legal")}><option value="A4">A4</option><option value="Letter">Letter</option><option value="Legal">Legal</option></select></label>
              </div>
              <div className="print-submission__confirm">
                <p><strong>This immediately sends the staged file to the operating-system queue.</strong><span>Windows uses the selected printer driver's profile; CUPS receives the selected media and color mode directly.</span></p>
                <Button variant="primary" type="submit" loading={submittingPrint} disabled={!selectedPrinterId || !selectedFileId || copies < 1 || copies > 99}>Submit to printer</Button>
              </div>
              {submissionError && <p className="print-submission__error" role="alert">{submissionError}</p>}
            </form>
          ) : (
            <div className="print-submission__gate">
              <div>
                <strong>{stagedOrder.status === "pending_payment" ? "Payment is required before printing." : stagedOrder.status === "paid" ? "Queue this paid job before printing." : stagedOrder.status === "printing" ? "The file was submitted. Return to the job when physical printing finishes." : "This job has already moved beyond print submission."}</strong>
                <span>Production status changes remain deliberate owner confirmations.</span>
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
                  <div><strong>{file.originalFilename}</strong><small>{formatFileSize(file.sizeBytes)} · staged {formatDate(file.uploadedAt)}</small></div>
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
                  <div><strong>{attempt.printerName}</strong><span>{attempt.filename || "Print-ready file"} · {attempt.copies} {attempt.copies === 1 ? "copy" : "copies"}</span><small>{attempt.errorMessage || `Submitted ${formatDate(attempt.submittedAt)}`}</small></div>
                  <StatusPill label={attempt.result === "succeeded" ? "Submitted" : attempt.result} tone={attempt.result === "succeeded" ? "success" : attempt.result === "failed" ? "danger" : "info"} />
                </div>
              ))}
            </div>
          ) : <EmptyState title="No print attempts recorded" description="Queue a paid job and submit its staged file to record the first attempt." />}
        </Card>
      </div>
    </>
  );
}
