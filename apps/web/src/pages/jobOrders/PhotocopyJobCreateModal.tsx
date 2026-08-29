import { ChangeEvent, FormEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { getDocument } from "pdfjs-dist";
import { Button } from "../../components/Button/Button";
import { Modal } from "../../components/Modal/Modal";
import { PdfViewer } from "../../components/PdfViewer/PdfViewer";
import { ApiError, api } from "../../lib/apiClient";
import { formatCurrency, formatFileSize, formatProductPrintType } from "../../lib/format";
import { computeSelectedMaterialPrice } from "../../lib/productPricing";
import type { Customer, DocumentPricingRule, InventoryItem, JobOrder, Product, Service } from "../../types/domain";
import "../workspaceForm.css";
import "./PhotocopyJobCreateModal.css";

interface Props {
  open: boolean;
  service: Service;
  customers: Customer[];
  products: Product[];
  inventoryItems: InventoryItem[];
  pricingRules: DocumentPricingRule[];
  onClose: () => void;
  onCreated: (order: JobOrder) => void;
}

interface ScanCapture {
  id: string;
  file: File;
  pageCount: number;
  previewUrl: string;
  source: "scanner" | "import";
}

const BLANK = {
  name: "",
  productId: "",
  paperInventoryItemId: "",
  pagesPerCopy: 1,
  copies: 1,
  backToBack: false,
  customerId: "",
  dueDate: "",
  notes: "",
};

const SCAN_EXTENSIONS = ["pdf", "png", "jpg", "jpeg", "tif", "tiff", "bmp", "webp"];
const MAX_SCAN_BYTES = 25 * 1024 * 1024;

export function PhotocopyJobCreateModal({ open, service, customers, products, inventoryItems, pricingRules, onClose, onCreated }: Props) {
  const scanFileInputId = useId();
  const [form, setForm] = useState(BLANK);
  const [scanCaptures, setScanCaptures] = useState<ScanCapture[]>([]);
  const scanCapturesRef = useRef<ScanCapture[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [acquiring, setAcquiring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const availableProducts = products.filter((product) => product.isActive && product.serviceId === service.id);
  const selectedProduct = availableProducts.find((product) => product.id === form.productId);
  const isScan = selectedProduct?.operationKind === "scan";
  const inventoryById = useMemo(() => new Map(inventoryItems.map((item) => [item.id, item])), [inventoryItems]);
  const papers = selectedProduct?.materialAssignments
    .map((assignment) => inventoryById.get(assignment.inventoryItemId))
    .filter((item): item is InventoryItem => Boolean(item?.isActive && item.paperSize)) ?? [];
  const selectedPaper = papers.find((paper) => paper.id === form.paperInventoryItemId);
  const duplexVariant = selectedProduct?.variants.find((variant) => variant.requiresManualDuplex);
  const requireCustomRate = selectedProduct?.printType === "black_and_white";
  const baseRate = isScan
    ? selectedProduct?.standalonePricePerPage ?? null
    : selectedProduct && selectedPaper
      ? computeSelectedMaterialPrice(selectedProduct.printType, selectedProduct.documentRates, pricingRules, selectedPaper.id, requireCustomRate)
      : null;
  const unitPrice = baseRate === null ? null : Math.max(0, baseRate + (form.backToBack ? duplexVariant?.priceAdjustment ?? 0 : 0));
  const scannedPages = scanCaptures.reduce((sum, capture) => sum + capture.pageCount, 0);
  const totalPages = isScan ? scannedPages : Math.max(0, form.pagesPerCopy) * Math.max(0, form.copies);
  const sheets = (form.backToBack ? Math.ceil(Math.max(0, form.pagesPerCopy) / 2) : Math.max(0, form.pagesPerCopy)) * Math.max(0, form.copies);
  const total = unitPrice === null ? null : Math.round(unitPrice * totalPages * 100) / 100;
  const valid = Boolean(form.name.trim() && selectedProduct && unitPrice !== null && (
    isScan
      ? scanCaptures.length > 0 && scannedPages >= 1
      : form.pagesPerCopy >= 1 && selectedPaper && form.copies >= 1 && (!form.backToBack || duplexVariant) && sheets <= selectedPaper.quantityOnHand
  ));
  const scannerAvailable = window.paperClub?.platform === "win32" && Boolean(window.paperClub.acquireScannerPage);

  useEffect(() => {
    scanCapturesRef.current = scanCaptures;
  }, [scanCaptures]);

  useEffect(() => () => {
    scanCapturesRef.current.forEach((capture) => URL.revokeObjectURL(capture.previewUrl));
  }, []);

  useEffect(() => {
    if (!open) return;
    clearScanCaptures();
    setForm(BLANK);
    setSubmitted(false);
    setSaving(false);
    setAcquiring(false);
    setError(null);
  }, [open, service.id]);

  function clearScanCaptures() {
    scanCapturesRef.current.forEach((capture) => URL.revokeObjectURL(capture.previewUrl));
    scanCapturesRef.current = [];
    setScanCaptures([]);
  }

  function selectProduct(productId: string) {
    const product = availableProducts.find((candidate) => candidate.id === productId);
    clearScanCaptures();
    setForm((current) => ({
      ...current,
      productId,
      paperInventoryItemId: "",
      backToBack: false,
      name: current.name.trim() ? current.name : product ? `${product.name} ${product.operationKind === "scan" ? "scan" : "photocopy"}` : "",
    }));
    setError(null);
  }

  async function addScanFiles(files: File[], source: ScanCapture["source"]) {
    const currentBytes = scanCapturesRef.current.reduce((sum, capture) => sum + capture.file.size, 0);
    const nextBytes = files.reduce((sum, file) => sum + file.size, currentBytes);
    if (nextBytes > MAX_SCAN_BYTES) throw new Error("The combined scan output must be 25 MB or smaller.");

    const captures: ScanCapture[] = [];
    for (const file of files) {
      const extension = file.name.split(".").pop()?.toLowerCase();
      if (!extension || !SCAN_EXTENSIONS.includes(extension)) throw new Error("Scanner outputs must be PDF or image files.");
      if (!file.size) throw new Error("The scanner returned an empty file.");
      captures.push({ id: crypto.randomUUID(), file, pageCount: await pageCountFor(file), previewUrl: URL.createObjectURL(file), source });
    }
    setScanCaptures((current) => [...current, ...captures]);
  }

  async function acquirePage() {
    if (!window.paperClub?.acquireScannerPage || !scannerAvailable || acquiring) {
      setError("Direct scanning requires the Windows desktop app and an installed WIA scanner driver.");
      return;
    }
    setAcquiring(true);
    setError(null);
    try {
      const result = await window.paperClub.acquireScannerPage();
      if (result.status === "cancelled" || !result.file) return;
      const bytes = decodeBase64(result.file.base64);
      await addScanFiles([new File([bytes], result.file.filename, { type: result.file.mimeType })], "scanner");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The scanner could not acquire this page.");
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
    setSubmitted(true);
    setError(null);
    if (!valid || saving || acquiring) {
      window.requestAnimationFrame(() => document.querySelector<HTMLElement>(".photocopy-job-modal [aria-invalid='true']")?.focus());
      return;
    }
    setSaving(true);
    try {
      if (isScan) {
        const body = new FormData();
        scanCaptures.forEach((capture) => body.append("files", capture.file));
        body.append("transaction", JSON.stringify({ name: form.name.trim(), serviceId: service.id, productId: form.productId, customerId: form.customerId || null, dueDate: form.dueDate ? `${form.dueDate}T17:00:00` : null, notes: form.notes.trim() || null }));
        onCreated(await api.upload<JobOrder>("/job-orders/from-scan", body));
        return;
      }
      onCreated(await api.post<JobOrder>("/job-orders/from-photocopy", { name: form.name.trim(), serviceId: service.id, productId: form.productId, paperInventoryItemId: form.paperInventoryItemId, pagesPerCopy: form.pagesPerCopy, copies: form.copies, backToBack: form.backToBack, customerId: form.customerId || null, dueDate: form.dueDate ? `${form.dueDate}T17:00:00` : null, notes: form.notes.trim() || null }));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "The scan or photocopy transaction could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} title={`New ${service.name} job`} description="Choose Scan or Photocopy. The selected product reveals only the information that operation needs." onClose={onClose} busy={saving || acquiring} status={error ? "error" : saving || acquiring ? "loading" : "idle"} className="photocopy-job-modal">
      <form className="photocopy-job-form" onSubmit={submit} noValidate>
        <div className="photocopy-job-form__content">
          {availableProducts.length === 0 ? <div className="photocopy-job-form__empty"><strong>This service has no active products.</strong><p>Add a Scan or Photocopy product and configure its custom rate first.</p></div> : (
            <>
              <section className="photocopy-job-form__fields">
                <div className="photocopy-job-form__section-heading"><span className="numeric">01 / SERVICE SETUP</span><h3>{isScan ? "Acquire the document" : "Record the photocopy work"}</h3></div>
                <label className="form-field"><span>Product</span><select value={form.productId} onChange={(event) => selectProduct(event.target.value)} aria-invalid={submitted && !selectedProduct} autoFocus><option value="">Select product</option>{availableProducts.map((product) => <option key={product.id} value={product.id}>{product.operationKind === "scan" ? "Scan" : "Photocopy"} · {product.name}{product.operationKind === "scan" ? "" : ` · ${product.printTypeLabel || formatProductPrintType(product.printType)}`}</option>)}</select></label>
                {isScan ? (
                  <>
                    <section className={`scan-acquisition${submitted && !scanCaptures.length ? " is-invalid" : ""}`} aria-invalid={submitted && !scanCaptures.length} tabIndex={submitted && !scanCaptures.length ? -1 : undefined}>
                      <div className="scan-acquisition__heading"><span><b className="numeric">WINDOWS SCANNER</b><strong>{scanCaptures.length ? `${scannedPages} ${scannedPages === 1 ? "page" : "pages"} acquired` : "Ready to scan"}</strong><small>{scannerAvailable ? "The installed scanner driver controls source, color, resolution, size, and cropping." : "Open this workflow in the Windows desktop app to scan directly."}</small></span><Button type="button" variant="primary" onClick={acquirePage} loading={acquiring} disabled={!scannerAvailable || saving}>{scanCaptures.length ? "Scan another page" : "Start scanning"}</Button></div>
                      {scanCaptures.length ? <ScanCaptureList captures={scanCaptures} onRemove={removeCapture} /> : <div className="scan-acquisition__empty"><span aria-hidden="true">◎</span><p>Place the original on the platen or feeder, then start scanning. The captured page will appear here before the job is created.</p></div>}
                    </section>
                    <details className="scan-import-fallback"><summary>Scanner unavailable? Import an existing output</summary><input id={scanFileInputId} className="scan-output-input" type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff,.bmp,.webp" onChange={importScanFiles} /><label className="scan-output-dropzone" htmlFor={scanFileInputId}><span className="numeric" aria-hidden="true">FILE</span><span><strong>Import PDF or image output</strong><small>Recovery option for scans produced outside Printing-MS.</small></span><b>Browse</b></label></details>
                  </>
                ) : selectedProduct ? (
                  <>
                    <label className="form-field"><span>Paper used</span><select value={form.paperInventoryItemId} onChange={(event) => setForm((current) => ({ ...current, paperInventoryItemId: event.target.value }))} aria-invalid={submitted && !selectedPaper}><option value="">Select paper</option>{papers.map((paper) => <option key={paper.id} value={paper.id}>{paper.paperSize} · {paper.name} · {paper.quantityOnHand} {paper.unit} available</option>)}</select></label>
                    {papers.length === 0 ? <p className="workspace-form__error">This product has no active paper configured.</p> : null}
                    {selectedPaper && baseRate === null ? <p className="workspace-form__error">Set a custom B&amp;W photocopy rate for {selectedPaper.name} on this product.</p> : null}
                    <div className="photocopy-job-form__numbers"><label className="form-field"><span>Pages per copy</span><input type="number" min="1" max="100000" value={form.pagesPerCopy} onChange={(event) => setForm((current) => ({ ...current, pagesPerCopy: Number(event.target.value) }))} aria-invalid={submitted && form.pagesPerCopy < 1} /></label><label className="form-field"><span>Copies</span><input type="number" min="1" max="10000" value={form.copies} onChange={(event) => setForm((current) => ({ ...current, copies: Number(event.target.value) }))} aria-invalid={submitted && form.copies < 1} /></label></div>
                    <label className={`photocopy-duplex${form.backToBack ? " is-selected" : ""}`}><input type="checkbox" checked={form.backToBack} disabled={!duplexVariant} onChange={(event) => setForm((current) => ({ ...current, backToBack: event.target.checked }))} /><span><strong>Back-to-back</strong><small>{duplexVariant ? `${duplexVariant.priceAdjustment >= 0 ? "+" : ""}${formatCurrency(duplexVariant.priceAdjustment)} per page · ${Math.ceil(form.pagesPerCopy / 2)} sheets per copy` : "Assign a manual-duplex variant to enable this option."}</small></span></label>
                  </>
                ) : null}
                <div className="photocopy-job-form__section-heading"><span className="numeric">02 / TRANSACTION</span><h3>Identify the job</h3></div>
                <label className="form-field"><span>Job name</span><input maxLength={100} value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} aria-invalid={submitted && !form.name.trim()} /><small>Shown throughout the job workflow instead of relying on the job ID.</small></label>
                <div className="photocopy-job-form__numbers"><label className="form-field"><span>Customer</span><select value={form.customerId} onChange={(event) => setForm((current) => ({ ...current, customerId: event.target.value }))}><option value="">Walk-in / no customer</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.displayName}</option>)}</select></label><label className="form-field"><span>Due date</span><input type="date" value={form.dueDate} onChange={(event) => setForm((current) => ({ ...current, dueDate: event.target.value }))} /></label></div>
                <label className="form-field"><span>Notes</span><textarea rows={2} value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} /></label>
              </section>
              <aside className={`photocopy-quote${isScan ? " photocopy-quote--scan" : ""}`} aria-live="polite">
                {isScan && scanCaptures.length ? <ScanDocumentPreview captures={scanCaptures} /> : null}
                <span className="numeric">COMPUTED TRANSACTION</span><strong>{total === null ? "—" : formatCurrency(total)}</strong><small>{unitPrice === null ? (isScan ? "Select a configured Scan product" : "Select configured paper") : `${formatCurrency(unitPrice)} per page × ${totalPages.toLocaleString()} ${isScan ? "scanner-detected pages" : "page impressions"}`}</small>
                {isScan ? <dl><div><dt>Scanned pages</dt><dd>{scannedPages || "—"}</dd></div><div><dt>Acquisitions</dt><dd>{scanCaptures.length || "—"}</dd></div><div><dt>Inventory used</dt><dd>None</dd></div><div><dt>Deliverable</dt><dd>{scanCaptures.length > 1 ? "Combined PDF" : "Retained softcopy"}</dd></div></dl> : <dl><div><dt>Document pages</dt><dd>{form.pagesPerCopy.toLocaleString()}</dd></div><div><dt>Copies</dt><dd>{form.copies.toLocaleString()}</dd></div><div><dt>Page impressions</dt><dd>{totalPages.toLocaleString()}</dd></div><div><dt>Paper deducted</dt><dd>{sheets.toLocaleString()} sheets</dd></div><div><dt>Sides</dt><dd>{form.backToBack ? "Back-to-back" : "Single-sided"}</dd></div></dl>}
                {!isScan && selectedPaper && sheets > selectedPaper.quantityOnHand ? <p className="workspace-form__error" aria-invalid="true" tabIndex={-1}>Only {selectedPaper.quantityOnHand} {selectedPaper.unit} are available.</p> : null}
                <p>{isScan ? "The acquired document is retained with the job and opens Ready for payment and delivery." : "The photocopy is recorded as produced, paper is deducted immediately, and the job opens Ready for payment."}</p>
              </aside>
            </>
          )}
          {error ? <p className="workspace-form__error photocopy-job-form__error" role="alert">{error}</p> : null}
        </div>
        <footer className="photocopy-job-form__actions"><Button type="button" variant="ghost" onClick={onClose} disabled={saving || acquiring}>Cancel</Button><Button type="submit" variant="primary" loading={saving} disabled={!availableProducts.length || acquiring || (submitted && !valid)}>Create {isScan ? "scan" : "photocopy"} job</Button></footer>
      </form>
    </Modal>
  );
}

function ScanCaptureList({ captures, onRemove }: { captures: ScanCapture[]; onRemove: (id: string) => void }) {
  return <ol className="scan-capture-list">{captures.map((capture, index) => <li key={capture.id}><span className="numeric">{String(index + 1).padStart(2, "0")}</span><span><strong>{capture.file.name}</strong><small>{capture.source === "scanner" ? "Acquired from Windows scanner" : "Imported recovery output"} · {capture.pageCount} {capture.pageCount === 1 ? "page" : "pages"} · {formatFileSize(capture.file.size)}</small></span><button type="button" onClick={() => onRemove(capture.id)} aria-label={`Remove ${capture.file.name}`}>Remove</button></li>)}</ol>;
}

function ScanDocumentPreview({ captures }: { captures: ScanCapture[] }) {
  if (captures.length === 1 && captures[0].file.type === "application/pdf") return <div className="scan-document-preview scan-document-preview--pdf"><PdfViewer file={captures[0].file} filename={captures[0].file.name} downloadUrl={captures[0].previewUrl} /></div>;
  return <div className="scan-document-preview" aria-label="Scanned document preview"><span className="numeric">DOCUMENT PREVIEW</span><div>{captures.map((capture, index) => capture.file.type.startsWith("image/") && !capture.file.type.includes("tiff") ? <figure key={capture.id}><img src={capture.previewUrl} alt={`Scanned page ${index + 1}`} /><figcaption>Page {index + 1}</figcaption></figure> : <figure className="scan-document-preview__file" key={capture.id}><span aria-hidden="true">PDF</span><figcaption>{capture.file.name} · {capture.pageCount} pages</figcaption></figure>)}</div></div>;
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
