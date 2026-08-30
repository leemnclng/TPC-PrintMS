import { ChangeEvent, FormEvent, useCallback, useEffect, useId, useRef, useState } from "react";
import { getDocument } from "pdfjs-dist";
import { Button } from "../../components/Button/Button";
import { Modal } from "../../components/Modal/Modal";
import { PdfViewer } from "../../components/PdfViewer/PdfViewer";
import { ApiError, api } from "../../lib/apiClient";
import { formatCurrency, formatFileSize } from "../../lib/format";
import type { JobOrder, JobOrderItem } from "../../types/domain";
import "../workspaceForm.css";
import "./PhotocopyJobCreateModal.css";
import "./JobScanSetupModal.css";

interface Props {
  open: boolean;
  order: JobOrder;
  item: JobOrderItem;
  onClose: () => void;
  onScanned: (order: JobOrder) => void;
}

interface ScanCapture {
  id: string;
  file: File;
  pageCount: number;
  previewUrl: string;
  source: "scanner" | "import";
  settings?: ScanSettings;
}

interface ScanSettings {
  source: "auto" | "flatbed" | "feeder";
  contentType: "color" | "grayscale" | "text";
  resolutionDpi: 150 | 300 | 600;
  pageSize: "auto" | "a4" | "letter" | "legal" | "4x6" | "5x7" | "8x10";
}

interface ScanFeedback {
  tone: "info" | "progress" | "success";
  title: string;
  detail: string;
}

interface ScannerDeviceState {
  id: string;
  name: string;
  isOnline: boolean;
  supportsFlatbed: boolean;
  supportsFeeder: boolean;
  supportsDuplex: boolean;
  detectsFlatbed: boolean;
  detectsFeeder: boolean;
  flatbedReady: boolean | null;
  feederReady: boolean | null;
  coverOpen: boolean;
  paperJam: boolean;
  issue: string | null;
}

const SCAN_EXTENSIONS = ["pdf", "png", "jpg", "jpeg", "tif", "tiff", "bmp", "webp"];
const MAX_SCAN_BYTES = 25 * 1024 * 1024;
const DEFAULT_SCAN_SETTINGS: ScanSettings = { source: "auto", contentType: "color", resolutionDpi: 300, pageSize: "auto" };
const SCAN_PAGE_SIZES: Array<{ value: ScanSettings["pageSize"]; label: string; dimensions: string }> = [
  { value: "auto", label: "Automatic", dimensions: "Driver capture area" },
  { value: "a4", label: "A4", dimensions: "210 × 297 mm" },
  { value: "letter", label: "US Letter", dimensions: "216 × 279 mm" },
  { value: "legal", label: "US Legal", dimensions: "216 × 356 mm" },
  { value: "4x6", label: "4 × 6", dimensions: "102 × 152 mm" },
  { value: "5x7", label: "5 × 7", dimensions: "127 × 178 mm" },
  { value: "8x10", label: "8 × 10", dimensions: "203 × 254 mm" },
];

function scannerHasDetectedOriginal(device: ScannerDeviceState | undefined, source: ScanSettings["source"]): boolean {
  return Boolean(device?.supportsFeeder && source !== "flatbed" && device.feederReady);
}

function scannerRequiresPlacementConfirmation(device: ScannerDeviceState | undefined, source: ScanSettings["source"]): boolean {
  if (!device || scannerHasDetectedOriginal(device, source)) return false;
  // WIA can reliably report paper in a feeder. Flatbeds normally expose only
  // source/cover readiness, not whether an original is physically on the glass.
  if (source === "flatbed") return device.supportsFlatbed;
  if (source === "feeder") return device.supportsFeeder && !device.detectsFeeder;
  return device.supportsFlatbed || (device.supportsFeeder && !device.detectsFeeder);
}

function scannerReportsNoOriginal(device: ScannerDeviceState | undefined, source: ScanSettings["source"]): boolean {
  if (!device?.supportsFeeder || !device.detectsFeeder || device.feederReady) return false;
  return source === "feeder" || (source === "auto" && !device.supportsFlatbed);
}

function scanSourceLabel(source: ScanSettings["source"]): string {
  return source === "feeder" ? "document feeder" : source === "flatbed" ? "flatbed" : "automatic source";
}

export function JobScanSetupModal({ open, order, item, onClose, onScanned }: Props) {
  const scanFileInputId = useId();
  const [scanCaptures, setScanCaptures] = useState<ScanCapture[]>([]);
  const scanCapturesRef = useRef<ScanCapture[]>([]);
  const [saving, setSaving] = useState(false);
  const [acquiring, setAcquiring] = useState(false);
  const [checkingScanners, setCheckingScanners] = useState(false);
  const [scannerDevices, setScannerDevices] = useState<ScannerDeviceState[]>([]);
  const [selectedScannerId, setSelectedScannerId] = useState("");
  const [scanSettings, setScanSettings] = useState<ScanSettings>(DEFAULT_SCAN_SETTINGS);
  const [placementConfirmed, setPlacementConfirmed] = useState(false);
  const [scanFeedback, setScanFeedback] = useState<ScanFeedback | null>(null);
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const unitPrice = item.unitPrice;
  const scannedPages = scanCaptures.reduce((sum, capture) => sum + capture.pageCount, 0);
  const total = Math.round(unitPrice * scannedPages * 100) / 100;
  const valid = scanCaptures.length > 0 && scannedPages >= 1;
  const scannerAvailable = window.paperClub?.platform === "win32";
  const selectedScanner = scannerDevices.find((device) => device.id === selectedScannerId);
  const requiresPlacementConfirmation = scannerRequiresPlacementConfirmation(selectedScanner, scanSettings.source);
  const reportsNoOriginal = scannerReportsNoOriginal(selectedScanner, scanSettings.source);
  const placementReady = scannerHasDetectedOriginal(selectedScanner, scanSettings.source) || (requiresPlacementConfirmation && placementConfirmed);
  const sourceAvailable = Boolean(selectedScanner && (scanSettings.source === "auto" ? selectedScanner.supportsFlatbed || selectedScanner.supportsFeeder : scanSettings.source === "feeder" ? selectedScanner.supportsFeeder : selectedScanner.supportsFlatbed));
  const hardwareReady = Boolean(selectedScanner?.isOnline && !selectedScanner.coverOpen && !selectedScanner.paperJam && !reportsNoOriginal && sourceAvailable);
  const canAcquire = scannerAvailable && hardwareReady && placementReady && !checkingScanners && !saving && !acquiring;

  const refreshScanners = useCallback(async (announce = true) => {
    setCheckingScanners(true);
    setScannerError(null);
    setPlacementConfirmed(false);
    if (announce) setScanFeedback({ tone: "progress", title: "Checking scanner", detail: "Reading available devices, sources, and feeder status from Windows." });
    try {
      if (!window.paperClub?.inspectScanners || window.paperClub.platform !== "win32") {
        setScannerDevices([]);
        setScannerError("Direct scanning requires the Windows desktop app.");
        setScanFeedback(null);
        return;
      }
      const inspection = await window.paperClub.inspectScanners();
      setScannerDevices(inspection.devices);
      if (!inspection.devices.length) {
        setSelectedScannerId("");
        setScannerError(inspection.message ?? "No Windows scanner was found.");
        setScanFeedback(null);
        return;
      }
      const preferred = inspection.devices.find((device) => device.isOnline) ?? inspection.devices[0];
      setSelectedScannerId((current) => inspection.devices.some((device) => device.id === current) ? current : preferred.id);
      if (announce) setScanFeedback({ tone: "info", title: "Scanner check complete", detail: `${inspection.devices.length} ${inspection.devices.length === 1 ? "device" : "devices"} found. Automatic source will prefer a loaded feeder.` });
    } catch (caught) {
      setScannerDevices([]);
      setSelectedScannerId("");
      setScannerError(caught instanceof Error ? caught.message : "Scanner discovery failed.");
      setScanFeedback(null);
    } finally {
      setCheckingScanners(false);
    }
  }, []);

  useEffect(() => {
    scanCapturesRef.current = scanCaptures;
  }, [scanCaptures]);

  useEffect(() => () => {
    scanCapturesRef.current.forEach((capture) => URL.revokeObjectURL(capture.previewUrl));
  }, []);

  useEffect(() => {
    if (!open) return;
    clearScanCaptures();
    setSaving(false);
    setAcquiring(false);
    setCheckingScanners(false);
    setScannerDevices([]);
    setSelectedScannerId("");
    setScanSettings(DEFAULT_SCAN_SETTINGS);
    setPlacementConfirmed(false);
    setScanFeedback(null);
    setScannerError(null);
    setError(null);
    void refreshScanners();
  }, [open, order.id, refreshScanners]);

  function clearScanCaptures() {
    scanCapturesRef.current.forEach((capture) => URL.revokeObjectURL(capture.previewUrl));
    scanCapturesRef.current = [];
    setScanCaptures([]);
  }

  async function addScanFiles(files: File[], source: ScanCapture["source"], settings?: ScanSettings) {
    const currentBytes = scanCapturesRef.current.reduce((sum, capture) => sum + capture.file.size, 0);
    const nextBytes = files.reduce((sum, file) => sum + file.size, currentBytes);
    if (nextBytes > MAX_SCAN_BYTES) throw new Error("The combined scan output must be 25 MB or smaller.");

    const captures: ScanCapture[] = [];
    for (const file of files) {
      const extension = file.name.split(".").pop()?.toLowerCase();
      if (!extension || !SCAN_EXTENSIONS.includes(extension)) throw new Error("Scanner outputs must be PDF or image files.");
      if (!file.size) throw new Error("The scanner returned an empty file.");
      captures.push({ id: crypto.randomUUID(), file, pageCount: await pageCountFor(file), previewUrl: URL.createObjectURL(file), source, settings });
    }
    setScanCaptures((current) => [...current, ...captures]);
  }

  async function acquirePage() {
    if (!window.paperClub?.acquireScannerPage || !canAcquire || acquiring) {
      setScannerError("Select an online scanner, place the original in its feeder or on the glass, then try again.");
      return;
    }
    setAcquiring(true);
    setScannerError(null);
    setError(null);
    try {
      setScanFeedback({ tone: "progress", title: "Scanning in progress", detail: `Starting ${scanSourceLabel(scanSettings.source)} in ${scanSettings.contentType === "text" ? "B&W text" : scanSettings.contentType} at ${scanSettings.resolutionDpi} DPI. Keep the original in place.` });
      const requestedSettings = { ...scanSettings, placementConfirmed: scannerHasDetectedOriginal(selectedScanner, scanSettings.source) || placementConfirmed };
      const result = await window.paperClub.acquireScannerPage(selectedScannerId, requestedSettings);
      if (result.status === "cancelled") {
        setScanFeedback({ tone: "info", title: "Scan cancelled", detail: "No page was added. Check the source and profile, then try again." });
        return;
      }
      if (result.status === "not_ready" || result.status === "error") {
        await refreshScanners(false);
        setScannerError(result.message ?? "The scanner is not ready.");
        setScanFeedback(null);
        return;
      }
      if (!result.files?.length) {
        setScannerError("The scanner completed without returning a page.");
        setScanFeedback(null);
        return;
      }
      const appliedSettings: ScanSettings = { ...scanSettings, ...result.settings, source: result.source ?? scanSettings.source };
      // A feeder acquisition returns every loaded sheet from this one call.
      await addScanFiles(result.files.map((file) => new File([decodeBase64(file.base64)], file.filename, { type: file.mimeType })), "scanner", appliedSettings);
      setPlacementConfirmed(false);
      await refreshScanners(false);
      const pageCount = result.files.length;
      setScanFeedback({
        tone: "success",
        title: pageCount > 1 ? `${pageCount} pages scanned` : "Scan completed",
        detail: `${pageCount > 1 ? `${pageCount} pages were acquired` : `${result.files[0].filename} was acquired`} from the ${scanSourceLabel(appliedSettings.source)}. ${result.message ?? "Review the preview, then scan another page or submit the softcopy."}`,
      });
    } catch (caught) {
      setScannerError(caught instanceof Error ? caught.message : "The scanner could not acquire this page.");
      setScanFeedback(null);
    } finally {
      setAcquiring(false);
    }
  }

  async function importScanFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;
    setError(null);
    try {
      await addScanFiles(files, "import");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The scanner output could not be imported.");
    }
  }

  function removeCapture(id: string) {
    setScanCaptures((current) => {
      const removed = current.find((capture) => capture.id === id);
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return current.filter((capture) => capture.id !== id);
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!valid || saving || acquiring) return;
    setSaving(true);
    try {
      const body = new FormData();
      scanCaptures.forEach((capture) => body.append("files", capture.file));
      onScanned(await api.upload<JobOrder>(`/job-orders/${order.id}/items/${item.id}/scan-output`, body));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "The scanned document could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} title="Scan setup" description={`${order.number} · Acquire the document, then submit the softcopy without leaving this job order.`} onClose={onClose} busy={saving || acquiring} status={error ? "error" : saving || acquiring ? "loading" : "idle"} className="job-scan-setup-modal">
      <form className="photocopy-job-form" onSubmit={submit} noValidate>
        <div className="job-scan-setup-form__content">
          <section className="photocopy-job-form__fields">
            <div className="photocopy-job-form__section-heading"><span className="numeric">01 / ACQUIRE</span><h3>Scan the document</h3></div>
            <section className="scan-acquisition">
              <div className="scan-acquisition__heading"><span><b className="numeric">SCANNER PREFLIGHT</b><strong>{scanCaptures.length ? `${scannedPages} ${scannedPages === 1 ? "page" : "pages"} acquired` : checkingScanners ? "Checking Windows devices" : selectedScanner ? selectedScanner.name : "Scanner unavailable"}</strong><small>Automatic source prefers a loaded feeder and scans its whole stack in one pass. You can explicitly choose Feeder or Flatbed when the driver cannot sense placement.</small></span><Button type="button" variant="secondary" onClick={() => void refreshScanners()} loading={checkingScanners} disabled={!scannerAvailable || acquiring || saving}>Refresh</Button></div>
              <div className="scan-preflight">
                <label className="form-field"><span>Scanner device</span><select value={selectedScannerId} onChange={(event) => { setSelectedScannerId(event.target.value); setScanSettings((current) => ({ ...current, source: "auto" })); setPlacementConfirmed(false); setScannerError(null); setScanFeedback({ tone: "info", title: "Scanner changed", detail: "Source returned to Automatic and will prefer a loaded feeder." }); }} disabled={checkingScanners || acquiring || !scannerDevices.length}><option value="">{checkingScanners ? "Checking devices…" : "Select scanner"}</option>{scannerDevices.map((device) => <option key={device.id} value={device.id}>{device.name}{device.isOnline ? "" : " · Offline"}</option>)}</select></label>
                {selectedScanner ? <ScannerReadiness device={selectedScanner} source={scanSettings.source} /> : <div className="scan-readiness is-error" role="status"><span aria-hidden="true">!</span><p><strong>No usable scanner detected</strong><small>Turn on the Canon device, check USB/Wi-Fi, and install or repair Canon IJPAT/MP Drivers, then refresh.</small></p></div>}
                {requiresPlacementConfirmation ? <label className={`scan-placement-confirm${placementConfirmed ? " is-confirmed" : ""}`}><input type="checkbox" checked={placementConfirmed} onChange={(event) => { setPlacementConfirmed(event.target.checked); setScannerError(null); }} disabled={acquiring || saving} /><span><strong>Document is loaded</strong><small>{scanSettings.source === "flatbed" ? "Confirm the original is on the glass and the cover is closed." : scanSettings.source === "feeder" ? "Confirm the original is seated between the feeder guides." : "Confirm placement. Automatic source will try the feeder first; choose Flatbed explicitly for an original on the glass."}</small></span></label> : null}
                {selectedScanner ? <fieldset className="scan-profile" disabled={acquiring || saving}><legend><span className="numeric">SCAN PROFILE</span><small>Standard Windows scanner controls, kept inside Printing-MS.</small></legend><div><label className="form-field"><span>Document source</span><select value={scanSettings.source} onChange={(event) => { setScanSettings((current) => ({ ...current, source: event.target.value as ScanSettings["source"] })); setPlacementConfirmed(false); setScannerError(null); setScanFeedback({ tone: "info", title: "Source changed", detail: `The next scan will use ${scanSourceLabel(event.target.value as ScanSettings["source"])}.` }); }}><option value="auto">Automatic · feeder first</option><option value="feeder" disabled={!selectedScanner.supportsFeeder}>Document feeder · whole stack</option><option value="flatbed" disabled={!selectedScanner.supportsFlatbed}>Flatbed glass</option></select></label><label className="form-field"><span>Document content</span><select value={scanSettings.contentType} onChange={(event) => { setScanSettings((current) => ({ ...current, contentType: event.target.value as ScanSettings["contentType"] })); setScannerError(null); }}><option value="color">Color document</option><option value="grayscale">Grayscale</option><option value="text">Black &amp; white text</option></select></label><label className="form-field"><span>Resolution</span><select value={scanSettings.resolutionDpi} onChange={(event) => setScanSettings((current) => ({ ...current, resolutionDpi: Number(event.target.value) as ScanSettings["resolutionDpi"] }))}><option value={150}>150 DPI · Quick</option><option value={300}>300 DPI · Standard</option><option value={600}>600 DPI · Fine detail</option></select></label><label className="form-field"><span>Page size</span><select value={scanSettings.pageSize} onChange={(event) => setScanSettings((current) => ({ ...current, pageSize: event.target.value as ScanSettings["pageSize"] }))}>{SCAN_PAGE_SIZES.map((size) => <option key={size.value} value={size.value}>{size.label} · {size.dimensions}</option>)}</select><small>This controls the captured area, not printing paper or inventory.</small></label></div></fieldset> : null}
                {scanFeedback ? <ScanFeedbackNotice feedback={scanFeedback} /> : null}
                {scannerError ? <p className="scan-preflight__error" role="alert">{scannerError}</p> : null}
                <div className="scan-preflight__action"><Button type="button" variant="primary" onClick={acquirePage} loading={acquiring} disabled={!canAcquire}>{scanCaptures.length ? "Scan another page" : "Start scanning"}</Button><small>{canAcquire ? "Starts the scanner with this profile. Windows only shows transfer progress." : reportsNoOriginal ? "Load a document in the feeder, then refresh readiness." : requiresPlacementConfirmation && !placementConfirmed ? "Confirm document placement to continue." : "Resolve the scanner issue above to continue."}</small></div>
              </div>
              {scanCaptures.length ? <ScanCaptureList captures={scanCaptures} onRemove={removeCapture} /> : <div className="scan-acquisition__empty"><span aria-hidden="true">◎</span><p>Place the original on the platen or feeder, then start scanning. The captured page will appear here before you submit the softcopy.</p></div>}
            </section>
            <details className="scan-import-fallback"><summary>Scanner unavailable? Import an existing output</summary><input id={scanFileInputId} className="scan-output-input" type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff,.bmp,.webp" onChange={importScanFiles} /><label className="scan-output-dropzone" htmlFor={scanFileInputId}><span className="numeric" aria-hidden="true">FILE</span><span><strong>Import PDF or image output</strong><small>Recovery option for scans produced outside Printing-MS.</small></span><b>Browse</b></label></details>
            {error ? <p className="workspace-form__error photocopy-job-form__error" role="alert">{error}</p> : null}
          </section>
          <aside className="photocopy-quote photocopy-quote--scan" aria-live="polite">
            {scanCaptures.length ? <ScanDocumentPreview captures={scanCaptures} /> : null}
            <span className="numeric">COMPUTED TRANSACTION</span><strong>{formatCurrency(total)}</strong><small>{`${formatCurrency(unitPrice)} per page × ${scannedPages.toLocaleString()} scanner-detected pages`}</small>
            <dl><div><dt>Scanned pages</dt><dd>{scannedPages || "—"}</dd></div><div><dt>Acquisitions</dt><dd>{scanCaptures.length || "—"}</dd></div><div><dt>Inventory used</dt><dd>None</dd></div><div><dt>Deliverable</dt><dd>{scanCaptures.length > 1 ? "Combined PDF" : "Retained softcopy"}</dd></div></dl>
            <p>Submitting attaches the softcopy to {order.number} and opens Ready for payment and delivery.</p>
          </aside>
        </div>
        <footer className="photocopy-job-form__actions"><Button type="button" variant="ghost" onClick={onClose} disabled={saving || acquiring}>Cancel</Button><Button type="submit" variant="primary" loading={saving} disabled={acquiring || !valid}>Submit scan</Button></footer>
      </form>
    </Modal>
  );
}

function ScannerReadiness({ device, source }: { device: ScannerDeviceState; source: ScanSettings["source"] }) {
  let tone = "is-ready";
  let title = "Automatic source ready";
  let detail = "Start scanning after placing the original in the feeder or on the glass.";
  if (!device.isOnline) {
    tone = "is-error";
    title = "Scanner is offline";
    detail = device.issue ?? "Turn it on and check its USB or network connection.";
  } else if (device.paperJam) {
    tone = "is-error";
    title = "Paper jam detected";
    detail = "Clear the feeder path and refresh readiness.";
  } else if (device.coverOpen) {
    tone = "is-error";
    title = "Scanner cover is open";
    detail = "Close the platen or paper-path cover and refresh readiness.";
  } else if (!device.supportsFlatbed && !device.supportsFeeder) {
    tone = "is-error";
    title = "No scanner source available";
    detail = "Install the full scanner driver, then refresh devices.";
  } else if (scannerHasDetectedOriginal(device, source)) {
    title = "Document feeder detected";
    detail = "The loaded feeder will be used automatically.";
  } else if (scannerReportsNoOriginal(device, source)) {
    tone = "is-error";
    title = "No document detected";
    detail = "Load an original in the feeder, then refresh readiness.";
  } else if (scannerRequiresPlacementConfirmation(device, source)) {
    tone = "is-manual";
    title = "Placement confirmation required";
    detail = source === "flatbed" ? "WIA cannot verify an original on the glass. Place it, close the cover, then confirm below." : source === "feeder" ? "The driver cannot report feeder paper. Seat it between the guides, then confirm below." : `${device.name} cannot verify placement. Automatic mode will try the feeder first.`;
  } else {
    tone = "is-error";
    title = "Scanner is not ready";
    detail = "Check the device and refresh readiness.";
  }
  return <div className={`scan-readiness ${tone}`} role="status"><span aria-hidden="true">{tone === "is-ready" ? "✓" : tone === "is-manual" ? "?" : "!"}</span><p><strong>{title}</strong><small>{detail}</small></p></div>;
}

function ScanFeedbackNotice({ feedback }: { feedback: ScanFeedback }) {
  return <div className={`scan-feedback is-${feedback.tone}`} role="status" aria-live="polite"><span aria-hidden="true">{feedback.tone === "success" ? "✓" : feedback.tone === "progress" ? "…" : "i"}</span><p><strong>{feedback.title}</strong><small>{feedback.detail}</small></p></div>;
}

function ScanCaptureList({ captures, onRemove }: { captures: ScanCapture[]; onRemove: (id: string) => void }) {
  return <ol className="scan-capture-list">{captures.map((capture, index) => <li key={capture.id}><span className="numeric">{String(index + 1).padStart(2, "0")}</span><span><strong>{capture.file.name}</strong><small>{capture.source === "scanner" ? `Scanned · ${formatScanProfile(capture.settings)}` : "Imported recovery output"} · {capture.pageCount} {capture.pageCount === 1 ? "page" : "pages"} · {formatFileSize(capture.file.size)}</small></span><button type="button" onClick={() => onRemove(capture.id)} aria-label={`Remove ${capture.file.name}`}>Remove</button></li>)}</ol>;
}

function formatScanProfile(settings?: ScanSettings): string {
  if (!settings) return "Windows scanner";
  const source = settings.source === "feeder" ? "Feeder" : settings.source === "flatbed" ? "Flatbed" : "Automatic source";
  const content = settings.contentType === "color" ? "Color" : settings.contentType === "grayscale" ? "Grayscale" : "B&W text";
  const pageSize = SCAN_PAGE_SIZES.find((size) => size.value === settings.pageSize)?.label ?? "Automatic";
  return `${source} · ${content} · ${settings.resolutionDpi} DPI · ${pageSize}`;
}

function ScanDocumentPreview({ captures }: { captures: ScanCapture[] }) {
  if (captures.length === 1 && captures[0].file.type === "application/pdf") return <div className="scan-document-preview scan-document-preview--pdf"><PdfViewer file={captures[0].file} filename={captures[0].file.name} downloadUrl={captures[0].previewUrl} /></div>;
  return <div className="scan-document-preview" aria-label="Scanned document preview"><span className="numeric">DOCUMENT PREVIEW</span><div>{captures.map((capture, index) => capture.file.type.startsWith("image/") && !capture.file.type.includes("tiff") ? <ScanImagePreview key={capture.id} capture={capture} index={index} /> : <figure className="scan-document-preview__file" key={capture.id}><span aria-hidden="true">FILE</span><figcaption>{capture.file.name} · {capture.pageCount} pages</figcaption></figure>)}</div></div>;
}

function ScanImagePreview({ capture, index }: { capture: ScanCapture; index: number }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <figure className="scan-document-preview__file"><span aria-hidden="true">!</span><figcaption>Page {index + 1} preview unavailable</figcaption></figure>;
  return <figure><img src={capture.previewUrl} alt={`Scanned page ${index + 1}`} onError={() => setFailed(true)} /><figcaption>Page {index + 1}</figcaption></figure>;
}

async function pageCountFor(file: File): Promise<number> {
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) return 1;
  const task = getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  try { return (await task.promise).numPages; } finally { await task.destroy(); }
}

function decodeBase64(value: string): ArrayBuffer {
  const binary = window.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer as ArrayBuffer;
}
