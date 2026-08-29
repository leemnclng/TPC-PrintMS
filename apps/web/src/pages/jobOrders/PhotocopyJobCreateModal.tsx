import { FormEvent, useEffect, useMemo, useState } from "react";
import { Button } from "../../components/Button/Button";
import { Modal } from "../../components/Modal/Modal";
import { ApiError, api } from "../../lib/apiClient";
import { formatCurrency, formatProductPrintType } from "../../lib/format";
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
  const [form, setForm] = useState(BLANK);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const availableProducts = products.filter((product) => product.isActive && product.serviceId === service.id);
  const selectedProduct = availableProducts.find((product) => product.id === form.productId);
  const inventoryById = useMemo(() => new Map(inventoryItems.map((item) => [item.id, item])), [inventoryItems]);
  const papers = selectedProduct?.materialAssignments
    .map((assignment) => inventoryById.get(assignment.inventoryItemId))
    .filter((item): item is InventoryItem => Boolean(item?.isActive && item.paperSize)) ?? [];
  const selectedPaper = papers.find((paper) => paper.id === form.paperInventoryItemId);
  const duplexVariant = selectedProduct?.variants.find((variant) => variant.requiresManualDuplex);
  const requireCustomRate = selectedProduct?.printType === "black_and_white";
  const baseRate = selectedProduct && selectedPaper
    ? computeSelectedMaterialPrice(selectedProduct.printType, selectedProduct.documentRates, pricingRules, selectedPaper.id, requireCustomRate)
    : null;
  const unitPrice = baseRate === null ? null : Math.max(0, baseRate + (form.backToBack ? duplexVariant?.priceAdjustment ?? 0 : 0));
  const totalPages = Math.max(0, form.pagesPerCopy) * Math.max(0, form.copies);
  const sheets = (form.backToBack ? Math.ceil(Math.max(0, form.pagesPerCopy) / 2) : Math.max(0, form.pagesPerCopy)) * Math.max(0, form.copies);
  const total = unitPrice === null ? null : Math.round(unitPrice * totalPages * 100) / 100;
  const valid = Boolean(form.name.trim() && selectedProduct && selectedPaper && form.pagesPerCopy >= 1 && form.copies >= 1 && unitPrice !== null && (!form.backToBack || duplexVariant) && (!selectedPaper || sheets <= selectedPaper.quantityOnHand));

  useEffect(() => {
    if (!open) return;
    setForm(BLANK);
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
      name: current.name.trim() ? current.name : product ? `${product.name} photocopy` : "",
    }));
    setError(null);
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
      setError(caught instanceof ApiError ? caught.message : "The photocopy transaction could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      title={`New ${service.name} job`}
      description="No file is needed. Enter the work completed on the photocopier and review the computed price."
      onClose={onClose}
      busy={saving}
      status={error ? "error" : saving ? "loading" : "idle"}
      className="photocopy-job-modal"
    >
      <form className="photocopy-job-form" onSubmit={submit} noValidate>
        <div className="photocopy-job-form__content">
          {availableProducts.length === 0 ? (
            <div className="photocopy-job-form__empty"><strong>This service has no active products.</strong><p>Add a photocopy product and configure its paper rates first.</p></div>
          ) : (
            <>
              <section className="photocopy-job-form__fields">
                <div className="photocopy-job-form__section-heading"><span className="numeric">01 / SERVICE SETUP</span><h3>What was photocopied?</h3></div>
                <label className="form-field"><span>Photocopy product</span><select value={form.productId} onChange={(event) => selectProduct(event.target.value)} aria-invalid={submitted && !selectedProduct} autoFocus><option value="">Select product</option>{availableProducts.map((product) => <option key={product.id} value={product.id}>{product.name} · {product.printTypeLabel || formatProductPrintType(product.printType)}</option>)}</select></label>
                <label className="form-field"><span>Paper used</span><select value={form.paperInventoryItemId} disabled={!selectedProduct} onChange={(event) => setForm((current) => ({ ...current, paperInventoryItemId: event.target.value }))} aria-invalid={submitted && !selectedPaper}><option value="">Select paper</option>{papers.map((paper) => <option key={paper.id} value={paper.id}>{paper.paperSize} · {paper.name} · {paper.quantityOnHand} {paper.unit} available</option>)}</select></label>
                {selectedProduct && papers.length === 0 ? <p className="workspace-form__error">This product has no active paper configured.</p> : null}
                {selectedPaper && baseRate === null ? <p className="workspace-form__error">Set a custom B&amp;W photocopy rate for {selectedPaper.name} on this product.</p> : null}
                <div className="photocopy-job-form__numbers">
                  <label className="form-field"><span>Pages per copy</span><input type="number" min="1" max="100000" value={form.pagesPerCopy} onChange={(event) => setForm((current) => ({ ...current, pagesPerCopy: Number(event.target.value) }))} aria-invalid={submitted && form.pagesPerCopy < 1} /></label>
                  <label className="form-field"><span>Copies</span><input type="number" min="1" max="10000" value={form.copies} onChange={(event) => setForm((current) => ({ ...current, copies: Number(event.target.value) }))} aria-invalid={submitted && form.copies < 1} /></label>
                </div>
                <label className={`photocopy-duplex${form.backToBack ? " is-selected" : ""}`}><input type="checkbox" checked={form.backToBack} disabled={!duplexVariant} onChange={(event) => setForm((current) => ({ ...current, backToBack: event.target.checked }))} /><span><strong>Back-to-back</strong><small>{duplexVariant ? `${duplexVariant.priceAdjustment >= 0 ? "+" : ""}${formatCurrency(duplexVariant.priceAdjustment)} per page · ${Math.ceil(form.pagesPerCopy / 2)} sheets per copy` : "Assign a manual-duplex variant to enable this option."}</small></span></label>

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
                <small>{unitPrice === null ? "Select configured paper" : `${formatCurrency(unitPrice)} per page × ${totalPages.toLocaleString()} page impressions`}</small>
                <dl><div><dt>Document pages</dt><dd>{form.pagesPerCopy.toLocaleString()}</dd></div><div><dt>Copies</dt><dd>{form.copies.toLocaleString()}</dd></div><div><dt>Page impressions</dt><dd>{totalPages.toLocaleString()}</dd></div><div><dt>Paper deducted</dt><dd>{sheets.toLocaleString()} sheets</dd></div><div><dt>Sides</dt><dd>{form.backToBack ? "Back-to-back" : "Single-sided"}</dd></div></dl>
                {selectedPaper && sheets > selectedPaper.quantityOnHand ? <p className="workspace-form__error" aria-invalid="true" tabIndex={-1}>Only {selectedPaper.quantityOnHand} {selectedPaper.unit} are available.</p> : null}
                <p>The photocopy is recorded as produced, paper is deducted immediately, and the job opens Ready for payment.</p>
              </aside>
            </>
          )}
          {error ? <p className="workspace-form__error photocopy-job-form__error" role="alert">{error}</p> : null}
        </div>
        <footer className="photocopy-job-form__actions"><Button type="button" variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button><Button type="submit" variant="primary" loading={saving} disabled={!availableProducts.length || (submitted && !valid)}>Create photocopy job</Button></footer>
      </form>
    </Modal>
  );
}
