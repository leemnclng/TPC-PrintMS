import { FormEvent, useEffect, useState } from "react";
import { Button } from "../../components/Button/Button";
import { LinkButton } from "../../components/Button/LinkButton";
import { Modal } from "../../components/Modal/Modal";
import { ApiError, api } from "../../lib/apiClient";
import { formatCurrency, formatProductPrintType } from "../../lib/format";
import { computeSelectedMaterialPrice } from "../../lib/productPricing";
import type { Customer, DocumentPricingRule, InventoryItem, JobOrder, Product } from "../../types/domain";
import "../workspaceForm.css";
import "./JobOrderModals.css";

type MaterialLine = { inventoryItemId: string; plannedQuantity: number };
type ProductLine = {
  productId: string;
  productSearch: string;
  paperMaterialId: string;
  variantLabel: string;
  pagesPerCopy: number;
  copies: number;
  materials: MaterialLine[];
};

interface JobOrderForm {
  customerId: string;
  dueDate: string;
  notes: string;
  items: ProductLine[];
}

const blankLine = (): ProductLine => ({
  productId: "",
  productSearch: "",
  paperMaterialId: "",
  variantLabel: "",
  pagesPerCopy: 1,
  copies: 1,
  materials: [],
});

const blankForm = (): JobOrderForm => ({
  customerId: "",
  dueDate: "",
  notes: "",
  items: [blankLine()],
});

interface Props {
  open: boolean;
  customers: Customer[];
  products: Product[];
  inventoryItems: InventoryItem[];
  pricingRules: DocumentPricingRule[];
  onClose: () => void;
  onCreated: (order: JobOrder) => void;
}

export function JobOrderCreateModal({
  open,
  customers,
  products,
  inventoryItems,
  pricingRules,
  onClose,
  onCreated,
}: Props) {
  const [form, setForm] = useState<JobOrderForm>(blankForm);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const activeProducts = products.filter((product) => product.isActive);
  const inventoryById = new Map(inventoryItems.map((item) => [item.id, item]));

  useEffect(() => {
    if (!open) return;
    setForm(blankForm());
    setSubmitted(false);
    setSaveError(null);
  }, [open]);

  function updateLine(index: number, patch: Partial<ProductLine>) {
    setForm((current) => ({
      ...current,
      items: current.items.map((line, lineIndex) => (lineIndex === index ? { ...line, ...patch } : line)),
    }));
  }

  function selectProduct(index: number, productId: string) {
    updateLine(index, { productId, paperMaterialId: "", variantLabel: "", materials: [] });
  }

  function getPaperOptions(product: Product) {
    return product.materialAssignments
      .map((assignment) => inventoryById.get(assignment.inventoryItemId))
      .filter((item): item is InventoryItem => Boolean(item?.isActive && item.paperSize))
      .map((item) => ({
        item,
        price: computeSelectedMaterialPrice(product.printType, product.documentRates, pricingRules, item.id),
      }))
      .filter((option): option is { item: InventoryItem; price: number } => option.price !== null);
  }

  function plannedPaperQuantity(line: ProductLine) {
    const item = inventoryById.get(line.paperMaterialId);
    if (!item) return 0;
    const sheetCount = line.pagesPerCopy * line.copies;
    return item.unit.toLowerCase().includes("sheet") ? sheetCount : 1;
  }

  function toggleMaterial(lineIndex: number, inventoryItemId: string, selected: boolean) {
    const line = form.items[lineIndex];
    const inventoryItem = inventoryById.get(inventoryItemId);
    const suggestedSheets = line.pagesPerCopy * line.copies;
    const plannedQuantity = inventoryItem?.unit.toLowerCase().includes("sheet") ? suggestedSheets : 1;
    updateLine(lineIndex, {
      materials: selected
        ? [...line.materials, { inventoryItemId, plannedQuantity }]
        : line.materials.filter((material) => material.inventoryItemId !== inventoryItemId),
    });
  }

  function updateMaterial(lineIndex: number, inventoryItemId: string, plannedQuantity: number) {
    updateLine(lineIndex, {
      materials: form.items[lineIndex].materials.map((material) =>
        material.inventoryItemId === inventoryItemId ? { ...material, plannedQuantity } : material,
      ),
    });
  }

  function lineHasError(line: ProductLine) {
    const product = activeProducts.find((candidate) => candidate.id === line.productId);
    const paperOptions = product ? getPaperOptions(product) : [];
    const hasAssignedPaper = product?.materialAssignments.some((assignment) => {
      const item = inventoryById.get(assignment.inventoryItemId);
      return Boolean(item?.isActive && item.paperSize);
    }) ?? false;
    const selectedPaperIsValid = paperOptions.some((option) => option.item.id === line.paperMaterialId);
    const hasMaterialPlan = selectedPaperIsValid || line.materials.length > 0;
    return !line.productId || line.pagesPerCopy < 1 || line.copies < 1 ||
      (hasAssignedPaper && paperOptions.length === 0) ||
      (paperOptions.length > 0 && !selectedPaperIsValid) || !hasMaterialPlan ||
      line.materials.some((material) => material.plannedQuantity <= 0);
  }

  function calculateLinePrice(line: ProductLine) {
    const product = activeProducts.find((candidate) => candidate.id === line.productId);
    const variant = product?.variants.find((candidate) => candidate.label === line.variantLabel);
    const paperOptions = product ? getPaperOptions(product) : [];
    const materialPrice = product && line.paperMaterialId
      ? computeSelectedMaterialPrice(product.printType, product.documentRates, pricingRules, line.paperMaterialId)
      : null;
    const priceReady = paperOptions.length === 0 || materialPrice !== null;
    const basePrice = materialPrice ?? (paperOptions.length === 0 ? (product?.pricePerPage ?? 0) : 0);
    const unitPrice = product ? basePrice + (variant?.priceAdjustment ?? 0) : 0;
    const billableQuantity = Math.max(line.pagesPerCopy, 0) * Math.max(line.copies, 0);
    return { basePrice, unitPrice, billableQuantity, lineTotal: priceReady ? unitPrice * billableQuantity : 0, priceReady };
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setSubmitted(true);
    setSaveError(null);
    if (form.items.some(lineHasError)) {
      window.requestAnimationFrame(() => {
        formElement.querySelector<HTMLElement>("[aria-invalid='true']")?.focus();
      });
      return;
    }

    setSaving(true);
    try {
      const order = await api.post<JobOrder>("/job-orders", {
        ...form,
        customerId: form.customerId || null,
        dueDate: form.dueDate ? `${form.dueDate}T17:00:00` : null,
        notes: form.notes.trim() || null,
        items: form.items.map((line) => {
          const paperPlan = line.paperMaterialId
            ? [{ inventoryItemId: line.paperMaterialId, plannedQuantity: plannedPaperQuantity(line) }]
            : [];
          return {
            productId: line.productId,
            variantLabel: line.variantLabel || null,
            pagesPerCopy: line.pagesPerCopy,
            copies: line.copies,
            materials: [...paperPlan, ...line.materials],
          };
        }),
      });
      onCreated(order);
    } catch (error) {
      setSaveError(error instanceof ApiError ? error.message : "The job order wasn’t created. Try again.");
    } finally {
      setSaving(false);
    }
  }

  const prerequisitesMissing = activeProducts.length === 0;
  const calculatedTotal = form.items.reduce((total, line) => total + calculateLinePrice(line).lineTotal, 0);

  return (
    <Modal
      open={open}
      title="New job order"
      description="Define the work and reserve a material plan. Stock changes only when usage is recorded."
      onClose={onClose}
      busy={saving}
      status={saveError ? "error" : saving ? "loading" : "idle"}
      className="job-order-modal"
    >
      <form className="job-order-form" onSubmit={handleSubmit} noValidate>
        <div className="job-order-form__body">
          {prerequisitesMissing ? (
            <div className="job-order-prerequisites">
              <strong>Set up the order inputs first</strong>
              {activeProducts.length === 0 && <LinkButton to="/product-catalog" onClick={onClose}>Add a product</LinkButton>}
            </div>
          ) : (
            <>
              <section className="job-order-form__section">
                <div className="job-order-form__section-heading">
                  <div><h3>Production details</h3><p>Choose a product and one of its configured paper sizes, then set the output.</p></div>
                  <Button type="button" size="sm" onClick={() => setForm({ ...form, items: [...form.items, blankLine()] })}>
                    Add product
                  </Button>
                </div>
                <div className="job-order-lines">
                  {form.items.map((line, lineIndex) => {
                    const product = activeProducts.find((candidate) => candidate.id === line.productId);
                    const normalizedSearch = line.productSearch.trim().toLocaleLowerCase();
                    const filteredProducts = activeProducts.filter((candidate) => {
                      if (candidate.id === line.productId || !normalizedSearch) return true;
                      return [
                        candidate.name,
                        candidate.serviceName,
                        formatProductPrintType(candidate.printType),
                        ...candidate.variants.map((variant) => variant.label),
                      ].some((value) => value.toLocaleLowerCase().includes(normalizedSearch));
                    });
                    const assignments = product?.materialAssignments
                      .map((assignment) => inventoryById.get(assignment.inventoryItemId))
                      .filter((item): item is InventoryItem => Boolean(item?.isActive)) ?? [];
                    const assignedPaperMaterials = assignments.filter((item) => Boolean(item.paperSize));
                    const paperOptions = product ? getPaperOptions(product) : [];
                    const otherAssignments = assignments.filter((item) => !item.paperSize);
                    const selectedPaper = paperOptions.find((option) => option.item.id === line.paperMaterialId);
                    const pricing = calculateLinePrice(line);
                    const hasMaterialPlan = Boolean(selectedPaper) || line.materials.length > 0;
                    return (
                      <article className="job-order-line" key={lineIndex}>
                        <div className="job-order-line__heading">
                          <strong>Product {lineIndex + 1}</strong>
                          {form.items.length > 1 && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => setForm({ ...form, items: form.items.filter((_, index) => index !== lineIndex) })}
                            >Remove</Button>
                          )}
                        </div>
                        <fieldset
                          className="job-order-product-picker"
                          aria-invalid={submitted && !line.productId}
                          aria-describedby={`job-product-message-${lineIndex}`}
                          tabIndex={-1}
                        >
                          <legend>Choose product</legend>
                          <p id={`job-product-message-${lineIndex}`}>
                            {submitted && !line.productId
                              ? "Select one product for this order line."
                              : "Select a product to load its configured paper sizes, variants, and materials."}
                          </p>
                          <label className="job-order-product-search">
                            <span className="job-order-product-search__label">
                              <svg viewBox="0 0 20 20" aria-hidden="true">
                                <circle cx="8.5" cy="8.5" r="5.5" />
                                <path d="m12.5 12.5 4 4" />
                              </svg>
                              <span>Search</span>
                            </span>
                            <input
                              type="search"
                              value={line.productSearch}
                              onChange={(event) => updateLine(lineIndex, { productSearch: event.target.value })}
                              placeholder="Product, service, or variant"
                              autoFocus={lineIndex === 0}
                            />
                            <small>{filteredProducts.length} shown</small>
                          </label>
                          <div className="job-order-product-pane">
                            {filteredProducts.map((candidate) => {
                              const selected = line.productId === candidate.id;
                              return (
                                <label
                                  className={[
                                    "job-order-product-card",
                                    selected ? "job-order-product-card--selected" : "",
                                  ].filter(Boolean).join(" ")}
                                  key={candidate.id}
                                >
                                  <input
                                    type="radio"
                                    name={`job-product-${lineIndex}`}
                                    value={candidate.id}
                                    checked={selected}
                                    onChange={() => selectProduct(lineIndex, candidate.id)}
                                  />
                                  <span className="job-order-product-card__mark" aria-hidden="true" />
                                  <span className="job-order-product-card__body">
                                    <small>{candidate.serviceName} · {formatProductPrintType(candidate.printType)}</small>
                                    <strong>{candidate.name}</strong>
                                    <span>
                                      {candidate.materialAssignments.length} material {candidate.materialAssignments.length === 1 ? "option" : "options"}
                                      {candidate.variants.length > 0 ? ` · ${candidate.variants.length} variants` : ""}
                                    </span>
                                    <b>From {formatCurrency(candidate.pricePerPage)} / unit</b>
                                  </span>
                                </label>
                              );
                            })}
                            {filteredProducts.length === 0 && (
                              <div className="job-order-product-empty">
                                <span>No products match “{line.productSearch.trim()}”.</span>
                                <Button type="button" variant="ghost" size="sm" onClick={() => updateLine(lineIndex, { productSearch: "" })}>
                                  Clear search
                                </Button>
                              </div>
                            )}
                          </div>
                        </fieldset>
                        <div className="job-order-form__grid">
                          {product && paperOptions.length > 0 && (
                            <label className="form-field">
                              <span>Paper size</span>
                              <select
                                value={line.paperMaterialId}
                                onChange={(event) => updateLine(lineIndex, { paperMaterialId: event.target.value })}
                                aria-invalid={submitted && !selectedPaper}
                                aria-describedby={`job-paper-message-${lineIndex}`}
                              >
                                <option value="">Select a configured size</option>
                                {paperOptions.map(({ item, price }) => (
                                  <option key={item.id} value={item.id}>
                                    {item.paperSize} — {item.name} · {formatCurrency(price)} / page
                                  </option>
                                ))}
                              </select>
                              <span
                                id={`job-paper-message-${lineIndex}`}
                                className={submitted && !selectedPaper ? "workspace-form__error" : "form-field__message"}
                              >
                                {submitted && !selectedPaper
                                  ? "Select one of this product’s configured paper sizes."
                                  : selectedPaper
                                    ? `${selectedPaper.item.name} will be planned automatically (${plannedPaperQuantity(line).toLocaleString()} ${selectedPaper.item.unit}).`
                                    : "The selected size sets both the inventory material and price."}
                              </span>
                            </label>
                          )}
                          {product && product.variants.length > 0 && (
                            <label className="form-field">
                              <span>Variant</span>
                              <select value={line.variantLabel} onChange={(event) => updateLine(lineIndex, { variantLabel: event.target.value })}>
                                <option value="">No variant · {pricing.priceReady ? formatCurrency(pricing.basePrice) : "select size"}</option>
                                {product.variants.map((variant) => (
                                  <option key={variant.id} value={variant.label}>
                                    {variant.label} · {pricing.priceReady ? formatCurrency(pricing.basePrice + variant.priceAdjustment) : "select size"}
                                  </option>
                                ))}
                              </select>
                            </label>
                          )}
                          <label className="form-field">
                            <span>Pages per copy</span>
                            <input type="number" min={1} value={line.pagesPerCopy} onChange={(event) => updateLine(lineIndex, { pagesPerCopy: Number(event.target.value) })} aria-invalid={submitted && line.pagesPerCopy < 1} />
                          </label>
                          <label className="form-field">
                            <span>Copies</span>
                            <input type="number" min={1} value={line.copies} onChange={(event) => updateLine(lineIndex, { copies: Number(event.target.value) })} aria-invalid={submitted && line.copies < 1} />
                          </label>
                        </div>
                        {product && (
                          <div className="job-order-line-price" aria-live="polite">
                            {pricing.priceReady ? (
                              <>
                                <span>
                                  {pricing.billableQuantity.toLocaleString()} billable pages/units × {formatCurrency(pricing.unitPrice)}
                                </span>
                                <strong>{formatCurrency(pricing.lineTotal)}</strong>
                              </>
                            ) : (
                              <span>Select a paper size to calculate this line.</span>
                            )}
                          </div>
                        )}
                        {product && assignedPaperMaterials.length > 0 && paperOptions.length === 0 && (
                          <p className="workspace-form__error" role="alert" aria-invalid="true" tabIndex={-1}>
                            This product has no active configured paper price. Update its paper materials and pricing before creating a job.
                          </p>
                        )}
                        {product && otherAssignments.length > 0 && (
                          <fieldset
                            className="job-order-materials"
                            aria-invalid={submitted && !hasMaterialPlan}
                            tabIndex={-1}
                          >
                            <legend>Other materials <small>(optional when paper is selected)</small></legend>
                            <p>Add ink, finishing, or other supplies this job will use.</p>
                            {otherAssignments.map((item) => {
                              const selected = line.materials.find((material) => material.inventoryItemId === item.id);
                              return (
                                <div className="job-order-material" key={item.id}>
                                  <label>
                                    <input type="checkbox" checked={Boolean(selected)} onChange={(event) => toggleMaterial(lineIndex, item.id, event.target.checked)} />
                                    <span>
                                      <strong>{item.name}</strong>
                                      <small>
                                        {item.quantityOnHand.toLocaleString()} {item.unit} in stock
                                      </small>
                                    </span>
                                  </label>
                                  {selected && (
                                    <label className="job-order-material__quantity">
                                      <span>Planned</span>
                                      <input type="number" min="0.01" step="0.01" value={selected.plannedQuantity} onChange={(event) => updateMaterial(lineIndex, item.id, Number(event.target.value))} aria-invalid={submitted && selected.plannedQuantity <= 0} />
                                      <span>{item.unit}</span>
                                    </label>
                                  )}
                                </div>
                              );
                            })}
                            {submitted && !hasMaterialPlan && <span className="workspace-form__error">Select at least one material.</span>}
                          </fieldset>
                        )}
                        {product && assignments.length === 0 && (
                          <span className="workspace-form__error">This product has no active assigned materials.</span>
                        )}
                      </article>
                    );
                  })}
                </div>
              </section>

              <section className="job-order-form__section job-order-form__section--secondary">
                <div className="job-order-form__section-heading">
                  <div><h3>Order details</h3><p>Add customer, deadline, pricing, or notes only when they apply.</p></div>
                </div>
                <div className="job-order-form__grid job-order-form__grid--summary">
                  <label className="form-field">
                    <span>Customer <small>(optional)</small></span>
                    <select
                      value={form.customerId}
                      onChange={(event) => setForm({ ...form, customerId: event.target.value })}
                    >
                      <option value="">Walk-in / no customer</option>
                      {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.displayName}</option>)}
                    </select>
                    <span className="form-field__message">Link a saved customer only when needed.</span>
                  </label>
                  <label className="form-field">
                    <span>Due date <small>(optional)</small></span>
                    <input type="date" value={form.dueDate} onChange={(event) => setForm({ ...form, dueDate: event.target.value })} />
                    <span className="form-field__message">Add a production deadline when needed.</span>
                  </label>
                  <div className="job-order-total">
                    <span>Calculated total</span>
                    <output className="numeric">{formatCurrency(calculatedTotal)}</output>
                    <small>Based on pages, copies, the selected configured paper size, and variants.</small>
                  </div>
                </div>
                <label className="form-field">
                  <span>Additional notes <small>(optional)</small></span>
                  <textarea rows={2} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
                </label>
              </section>
            </>
          )}
          {saveError && <p className="workspace-form__error" role="alert">{saveError}</p>}
        </div>
        <footer className="job-order-form__actions">
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" variant="primary" loading={saving} disabled={prerequisitesMissing}>Create job order</Button>
        </footer>
      </form>
    </Modal>
  );
}
