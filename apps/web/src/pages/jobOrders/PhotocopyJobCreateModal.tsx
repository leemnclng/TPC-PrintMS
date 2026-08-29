import { ChangeEvent, FormEvent, useEffect, useId, useMemo, useState } from "react";
import { Button } from "../../components/Button/Button";
import { Modal } from "../../components/Modal/Modal";
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

export function PhotocopyJobCreateModal({ open, service, customers, products, inventoryItems, pricingRules, onClose, onCreated }: Props) {
  const scanFileInputId = useId();
  const [form, setForm] = useState(BLANK);
  const [scanFile, setScanFile] = useState<File | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
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
  const totalPages = Math.max(0, form.pagesPerCopy) * (isScan ? 1 : Math.max(0, form.copies));
  const sheets = (form.backToBack ? Math.ceil(Math.max(0, form.pagesPerCopy) / 2) : Math.max(0, form.pagesPerCopy)) * Math.max(0, form.copies);
  const total = unitPrice === null ? null : Math.round(unitPrice * totalPages * 100) / 100;
  const valid = Boolean(form.name.trim() && selectedProduct && form.pagesPerCopy >= 1 && unitPrice !== null && (
    isScan
      ? scanFile
      : selectedPaper && form.copies >= 1 && (!form.backToBack || duplexVariant) && sheets <= selectedPaper.quantityOnHand
  ));

  useEffect(() => {
    if (!open) return;
    setForm(BLANK);
    setScanFile(null);
    setSubmitted(false);
    setSaving(false);
    setError(null);
  }, [open, service.id]);

  function selectProduct(productId: string) {
    const product = availableProducts.find((candidate) => candidate.id === productId);
    setForm((current) => ({
      ...current,
      productId,
      paperInventoryItemId: "",
      backToBack: false,
      name: current.name.trim() ? current.name : product ? `${product.name} ${product.operationKind === "scan" ? "scan" : "photocopy"}` : "",
    }));
    setScanFile(null);
    setError(null);
  }

  function selectScanFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setError(null);
    if (!file) {
      setScanFile(null);
      return;
    }
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (!extension || !["pdf", "png", "jpg", "jpeg", "tif", "tiff", "bmp", "webp"].includes(extension)) {
      setScanFile(null);
      setError("Attach the PDF or image produced by the scanner.");
      return;
    }
    if (!file.size || file.size > 25 * 1024 * 1024) {
      setScanFile(null);
      setError(file.size ? "Scan outputs must be 25 MB or smaller." : "Attach a non-empty scan output.");
      return;
    }
    setScanFile(file);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
    setError(null);
    if (!valid || saving) {
      window.requestAnimationFrame(() => document.querySelector<HTMLElement>(".photocopy-job-modal [aria-invalid='true']")?.focus());
      return;
    }
    setSaving(true);
    try {
      if (isScan && scanFile) {
        const body = new FormData();
        body.append("file", scanFile);
        body.append("transaction", JSON.stringify({
          name: form.name.trim(), serviceId: service.id, productId: form.productId,
          pages: form.pagesPerCopy, customerId: form.customerId || null,
          dueDate: form.dueDate ? `${form.dueDate}T17:00:00` : null,
          notes: form.notes.trim() || null,
        }));
        onCreated(await api.upload<JobOrder>("/job-orders/from-scan", body));
        return;
      }
      onCreated(await api.post<JobOrder>("/job-orders/from-photocopy", {
        name: form.name.trim(),
        serviceId: service.id,
        productId: form.productId,
        paperInventoryItemId: form.paperInventoryItemId,
        pagesPerCopy: form.pagesPerCopy,
        copies: form.copies,
        backToBack: form.backToBack,
        customerId: form.customerId || null,
        dueDate: form.dueDate ? `${form.dueDate}T17:00:00` : null,
        notes: form.notes.trim() || null,
      }));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "The scan or photocopy transaction could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      title={`New ${service.name} job`}
      description="Choose Scan or Photocopy. The selected product reveals only the information that operation needs."
      onClose={onClose}
      busy={saving}
      status={error ? "error" : saving ? "loading" : "idle"}
      className="photocopy-job-modal"
    >
      <form className="photocopy-job-form" onSubmit={submit} noValidate>
        <div className="photocopy-job-form__content">
          {availableProducts.length === 0 ? (
            <div className="photocopy-job-form__empty"><strong>This service has no active products.</strong><p>Add a Scan or Photocopy product and configure its custom rate first.</p></div>
          ) : (
            <>
              <section className="photocopy-job-form__fields">
                <div className="photocopy-job-form__section-heading"><span className="numeric">01 / SERVICE SETUP</span><h3>{isScan ? "Attach the scanner output" : "Record the photocopy work"}</h3></div>
                <label className="form-field"><span>Product</span><select value={form.productId} onChange={(event) => selectProduct(event.target.value)} aria-invalid={submitted && !selectedProduct} autoFocus><option value="">Select product</option>{availableProducts.map((product) => <option key={product.id} value={product.id}>{product.operationKind === "scan" ? "Scan" : "Photocopy"} · {product.name}{product.operationKind === "scan" ? "" : ` · ${product.printTypeLabel || formatProductPrintType(product.printType)}`}</option>)}</select></label>
                {isScan ? (
                  <>
                    <input id={scanFileInputId} className="scan-output-input" type="file" accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff,.bmp,.webp" onChange={selectScanFile} />
                    <label className={`scan-output-dropzone${submitted && !scanFile ? " is-invalid" : ""}`} htmlFor={scanFileInputId} aria-invalid={submitted && !scanFile}>
                      <span className="numeric" aria-hidden="true">FILE</span>
                      <span><strong>{scanFile?.name ?? "Choose the generated softcopy"}</strong><small>{scanFile ? `${formatFileSize(scanFile.size)} · ready to retain` : "Scan with the Canon device/app, then attach one PDF or image output."}</small></span>
                      <b>{scanFile ? "Change" : "Browse"}</b>
                    </label>
                    <label className="form-field"><span>Scanned pages</span><input type="number" min="1" max="100000" value={form.pagesPerCopy} onChange={(event) => setForm((current) => ({ ...current, pagesPerCopy: Number(event.target.value) }))} aria-invalid={submitted && form.pagesPerCopy < 1} /><small>The attached output is checked against this billable page count.</small></label>
                  </>
                ) : selectedProduct ? (
                  <>
                    <label className="form-field"><span>Paper used</span><select value={form.paperInventoryItemId} onChange={(event) => setForm((current) => ({ ...current, paperInventoryItemId: event.target.value }))} aria-invalid={submitted && !selectedPaper}><option value="">Select paper</option>{papers.map((paper) => <option key={paper.id} value={paper.id}>{paper.paperSize} · {paper.name} · {paper.quantityOnHand} {paper.unit} available</option>)}</select></label>
                    {papers.length === 0 ? <p className="workspace-form__error">This product has no active paper configured.</p> : null}
                    {selectedPaper && baseRate === null ? <p className="workspace-form__error">Set a custom B&amp;W photocopy rate for {selectedPaper.name} on this product.</p> : null}
                    <div className="photocopy-job-form__numbers">
                      <label className="form-field"><span>Pages per copy</span><input type="number" min="1" max="100000" value={form.pagesPerCopy} onChange={(event) => setForm((current) => ({ ...current, pagesPerCopy: Number(event.target.value) }))} aria-invalid={submitted && form.pagesPerCopy < 1} /></label>
                      <label className="form-field"><span>Copies</span><input type="number" min="1" max="10000" value={form.copies} onChange={(event) => setForm((current) => ({ ...current, copies: Number(event.target.value) }))} aria-invalid={submitted && form.copies < 1} /></label>
                    </div>
                    <label className={`photocopy-duplex${form.backToBack ? " is-selected" : ""}`}><input type="checkbox" checked={form.backToBack} disabled={!duplexVariant} onChange={(event) => setForm((current) => ({ ...current, backToBack: event.target.checked }))} /><span><strong>Back-to-back</strong><small>{duplexVariant ? `${duplexVariant.priceAdjustment >= 0 ? "+" : ""}${formatCurrency(duplexVariant.priceAdjustment)} per page · ${Math.ceil(form.pagesPerCopy / 2)} sheets per copy` : "Assign a manual-duplex variant to enable this option."}</small></span></label>
                  </>
                ) : null}

                <div className="photocopy-job-form__section-heading"><span className="numeric">02 / TRANSACTION</span><h3>Identify the job</h3></div>
                <label className="form-field"><span>Job name</span><input maxLength={100} value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} aria-invalid={submitted && !form.name.trim()} /><small>Shown throughout the job workflow instead of relying on the job ID.</small></label>
                <div className="photocopy-job-form__numbers">
                  <label className="form-field"><span>Customer</span><select value={form.customerId} onChange={(event) => setForm((current) => ({ ...current, customerId: event.target.value }))}><option value="">Walk-in / no customer</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.displayName}</option>)}</select></label>
                  <label className="form-field"><span>Due date</span><input type="date" value={form.dueDate} onChange={(event) => setForm((current) => ({ ...current, dueDate: event.target.value }))} /></label>
                </div>
                <label className="form-field"><span>Notes</span><textarea rows={2} value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} /></label>
              </section>

              <aside className="photocopy-quote" aria-live="polite">
                <span className="numeric">COMPUTED TRANSACTION</span>
                <strong>{total === null ? "—" : formatCurrency(total)}</strong>
                <small>{unitPrice === null ? (isScan ? "Select a configured Scan product" : "Select configured paper") : `${formatCurrency(unitPrice)} per page × ${totalPages.toLocaleString()} ${isScan ? "scanned pages" : "page impressions"}`}</small>
                {isScan ? (
                  <dl><div><dt>Scanned pages</dt><dd>{form.pagesPerCopy.toLocaleString()}</dd></div><div><dt>Output</dt><dd>{scanFile?.name.split(".").pop()?.toUpperCase() ?? "—"}</dd></div><div><dt>Inventory used</dt><dd>None</dd></div><div><dt>Deliverable</dt><dd>Retained softcopy</dd></div></dl>
                ) : (
                  <dl><div><dt>Document pages</dt><dd>{form.pagesPerCopy.toLocaleString()}</dd></div><div><dt>Copies</dt><dd>{form.copies.toLocaleString()}</dd></div><div><dt>Page impressions</dt><dd>{totalPages.toLocaleString()}</dd></div><div><dt>Paper deducted</dt><dd>{sheets.toLocaleString()} sheets</dd></div><div><dt>Sides</dt><dd>{form.backToBack ? "Back-to-back" : "Single-sided"}</dd></div></dl>
                )}
                {!isScan && selectedPaper && sheets > selectedPaper.quantityOnHand ? <p className="workspace-form__error" aria-invalid="true" tabIndex={-1}>Only {selectedPaper.quantityOnHand} {selectedPaper.unit} are available.</p> : null}
                <p>{isScan ? "The softcopy is retained with the job and opens Ready for payment and customer delivery." : "The photocopy is recorded as produced, paper is deducted immediately, and the job opens Ready for payment."}</p>
              </aside>
            </>
          )}
          {error ? <p className="workspace-form__error photocopy-job-form__error" role="alert">{error}</p> : null}
        </div>
        <footer className="photocopy-job-form__actions"><Button type="button" variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button><Button type="submit" variant="primary" loading={saving} disabled={!availableProducts.length || (submitted && !valid)}>Create {isScan ? "scan" : "photocopy"} job</Button></footer>
      </form>
    </Modal>
  );
}
