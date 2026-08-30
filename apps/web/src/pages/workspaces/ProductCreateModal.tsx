import { FormEvent, useEffect, useRef, useState } from "react";
import { AssignedMaterialsSummary } from "../../components/AssignedMaterialsSummary/AssignedMaterialsSummary";
import { Button } from "../../components/Button/Button";
import { LinkButton } from "../../components/Button/LinkButton";
import { MaterialMultiSelect, type MaterialSelection } from "../../components/MaterialMultiSelect/MaterialMultiSelect";
import { Modal } from "../../components/Modal/Modal";
import {
  ProductDocumentRateSelector,
  type ProductDocumentRateSelection,
} from "../../components/ProductDocumentRateSelector/ProductDocumentRateSelector";
import {
  ProductVariantSelector,
  type ProductVariantSelection,
} from "../../components/ProductVariantSelector/ProductVariantSelector";
import { ApiError, api } from "../../lib/apiClient";
import { formatCurrency, formatProductPrintType } from "../../lib/format";
import { computeReferencePrice, resolveScanPricePerPage } from "../../lib/productPricing";
import type {
  DocumentPricingRule,
  InventoryItem,
  PrintTypeDefinition,
  Product,
  ProductOperationKind,
  ProductPrintType,
  ScanPricingTier,
  Service,
  Variant,
} from "../../types/domain";
import "../workspaceForm.css";
import "./ProductCreateModal.css";

interface ProductFormState {
  name: string;
  description: string;
  printType: ProductPrintType;
  operationKind: ProductOperationKind;
  standalonePricePerPage: number | null;
  isActive: boolean;
  variants: ProductVariantSelection[];
  materialAssignments: MaterialSelection[];
  documentRates: ProductDocumentRateSelection[];
}

function blankProduct(printType: ProductPrintType = "black_and_white", operationKind: ProductOperationKind = "printing"): ProductFormState {
  return {
    name: "",
    description: "",
    printType,
    operationKind,
    standalonePricePerPage: null,
    isActive: true,
    variants: [],
    materialAssignments: [],
    documentRates: [],
  };
}

interface ProductCreateModalProps {
  open: boolean;
  service: Service;
  inventoryItems: InventoryItem[];
  variants: Variant[];
  pricingRules: DocumentPricingRule[];
  scanPricingTiers: ScanPricingTier[];
  printTypes: PrintTypeDefinition[];
  onClose: () => void;
  onCreated: (product: Product) => void;
}

export function ProductCreateModal({
  open,
  service,
  inventoryItems,
  variants,
  pricingRules,
  scanPricingTiers,
  printTypes,
  onClose,
  onCreated,
}: ProductCreateModalProps) {
  const activeInventoryItems = inventoryItems.filter((item) => item.isActive);
  const activeOtherMaterials = activeInventoryItems.filter((item) => !item.paperSize);
  const activeVariants = variants.filter((variant) => variant.isActive);
  const activePrintTypes = printTypes.filter((printType) => printType.isActive);
  const defaultPrintType = activePrintTypes.find((printType) => printType.key === "black_and_white")?.key
    ?? activePrintTypes[0]?.key
    ?? "black_and_white";
  const defaultOperationKind: ProductOperationKind = service.category === "photocopy" ? "photocopy" : "printing";
  const [form, setForm] = useState<ProductFormState>(() => blankProduct(defaultPrintType, defaultOperationKind));
  const selectedPrintType = printTypes.find((printType) => printType.key === form.printType);
  const [nameTouched, setNameTouched] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const materialsRef = useRef<HTMLDivElement>(null);
  const isScan = form.operationKind === "scan";
  const sortedScanTiers = [...scanPricingTiers].sort((left, right) => left.minPages - right.minPages);
  const activeScanTiers = sortedScanTiers.filter((tier) => tier.isActive);
  const referencePrice = isScan ? resolveScanPricePerPage(form.standalonePricePerPage, 1, sortedScanTiers) ?? 0 : computeReferencePrice(
    form.printType,
    form.operationKind,
    form.documentRates,
    pricingRules,
    form.materialAssignments,
  );

  const nameError =
    (nameTouched || submitted) && !form.name.trim() ? "Enter a product name before creating the product." : null;
  const materialsError = submitted && !isScan && form.materialAssignments.length === 0
    ? activeInventoryItems.length === 0
      ? "Register an active inventory material before creating this product."
      : "Add at least one material needed to produce this product."
    : null;
  const hasPaperAssignment = pricingRules.some((rule) =>
    rule.printType === form.printType && rule.pricingScope === form.operationKind && form.materialAssignments.some((entry) => entry.inventoryItemId === rule.inventoryItemId));
  const photocopyPaperError = submitted && form.operationKind === "photocopy" && !hasPaperAssignment
    ? "Select at least one paper material for this photocopy product."
    : null;
  useEffect(() => {
    if (!open) return;
    setForm(blankProduct(defaultPrintType, defaultOperationKind));
    setNameTouched(false);
    setSubmitted(false);
    setSaveError(null);
  }, [open, defaultPrintType, defaultOperationKind]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setNameTouched(true);
    setSubmitted(true);
    setSaveError(null);

    const hasInvalidVariant = form.variants.some((variant) => referencePrice + variant.priceAdjustment < 0);
    const materialIds = form.materialAssignments.map((assignment) => assignment.inventoryItemId);
    const hasInvalidMaterial = !isScan && (
      form.materialAssignments.length === 0 ||
      form.materialAssignments.some((assignment) => !assignment.inventoryItemId) ||
      new Set(materialIds).size !== materialIds.length);
    const invalidScanPrice = isScan && form.standalonePricePerPage !== null && form.standalonePricePerPage < 0;
    if (!form.name.trim() || hasInvalidVariant || hasInvalidMaterial || (form.operationKind === "photocopy" && !hasPaperAssignment) || invalidScanPrice) {
      if (invalidScanPrice) setSaveError("The scan price can't be negative.");
      window.requestAnimationFrame(() => {
        const firstInvalid = formElement.querySelector<HTMLElement>("[aria-invalid='true']");
        (firstInvalid ?? materialsRef.current)?.focus();
      });
      return;
    }

    setSaving(true);
    try {
      const product = await api.post<Product>("/products", {
        ...form,
        name: form.name.trim(),
        description: form.description.trim() || null,
        serviceId: service.id,
      });
      onCreated(product);
    } catch (error) {
      setSaveError(error instanceof ApiError ? error.message : "The product wasn’t created. Review the fields and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      title="New product"
      description={`Add a product to ${service.name}.`}
      busy={saving}
      status={saveError ? "error" : saving ? "loading" : "idle"}
      onClose={onClose}
      className="product-create-modal"
    >
      <form className="product-create-form" onSubmit={handleSubmit} noValidate>
        <div className="product-create-form__fields">
          <label className={["form-field", nameError ? "form-field--error" : ""].filter(Boolean).join(" ")}>
            <span>Product name</span>
            <input
              ref={nameRef}
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              onBlur={() => setNameTouched(true)}
              aria-invalid={Boolean(nameError)}
              aria-describedby="product-name-message"
              autoFocus
              required
            />
            <span
              id="product-name-message"
              className={["form-field__message", nameError ? "form-field__message--error" : ""].filter(Boolean).join(" ")}
            >
              {nameError ?? "Use the name customers and staff will recognize."}
            </span>
          </label>

          <label className="form-field">
            <span>Description</span>
            <textarea
              rows={3}
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
            />
            <span className="form-field__message">Optional. Add production details that help identify the product.</span>
          </label>

          {service.category === "photocopy" ? (
            <label className="form-field">
              <span>Operation</span>
              <select
                value={form.operationKind}
                onChange={(event) => setForm((current) => ({
                  ...current,
                  operationKind: event.target.value as ProductOperationKind,
                  standalonePricePerPage: null,
                  variants: [],
                  materialAssignments: [],
                  documentRates: [],
                }))}
              >
                <option value="photocopy">Photocopy</option>
                <option value="scan">Scan to softcopy</option>
              </select>
              <span className="form-field__message">Determines the requirements collected when creating a job order.</span>
            </label>
          ) : null}

          <div className="product-create-form__row">
            <label className="form-field">
              <span>Print type</span>
              <select
                value={form.printType}
                onChange={(event) => setForm({
                  ...form,
                  printType: event.target.value as ProductPrintType,
                  documentRates: [],
                })}
              >
                {activePrintTypes.map((printType) => (
                  <option key={printType.key} value={printType.key}>{printType.label}</option>
                ))}
              </select>
              <span className="form-field__message">
                {isScan ? "Classifies this scan product; it does not change the flat per-page rate below." : "Choose the output this product is designed to produce."}
              </span>
            </label>

            <label className="form-field">
              <span>Status</span>
              <select
                value={form.isActive ? "active" : "inactive"}
                onChange={(event) => setForm({ ...form, isActive: event.target.value === "active" })}
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
              <span className="form-field__message">Inactive products stay saved but unavailable.</span>
            </label>
          </div>

          <div className="workspace-form__reference-price">
            <span>{isScan ? "Scan price / page" : "Reference price / page"}</span>
            <strong className="numeric">{formatCurrency(referencePrice)}</strong>
            <small>
              {isScan
                ? form.standalonePricePerPage !== null
                  ? "This product's own flat price, regardless of page count. No paper, ink, or printing cost."
                  : "Following the global page-count tiers below (shown here for a 1-page scan). No paper, ink, or printing cost."
                : `Computed from the ${form.operationKind === "photocopy" ? "Scan or Photocopy" : "Printing"} global table for the assigned paper's ${selectedPrintType?.label ?? formatProductPrintType(form.printType)} rate.`}
            </small>
          </div>

          {isScan ? (
            <section className="product-setup-section product-scan-pricing">
              <div className="product-setup-section__heading">
                <h3>Softcopy pricing</h3>
                <p>Charge for each page produced by the scanner. This product never plans or deducts inventory.</p>
              </div>
              <div className="product-scan-pricing__global">
                <span>Global page-count tiers</span>
                {activeScanTiers.length ? (
                  <ul className="product-scan-pricing__tiers">
                    {activeScanTiers.map((tier) => (
                      <li key={tier.id}><b>{tier.maxPages === null ? `${tier.minPages}+` : `${tier.minPages}–${tier.maxPages}`} pages</b><span>{formatCurrency(tier.pricePerPage)} / page</span></li>
                    ))}
                  </ul>
                ) : <strong className="numeric">Not configured</strong>}
                <small>Set in Settings → Document analyzer pricing. Every Scan product uses these unless overridden below.</small>
              </div>
              <label className="product-scan-pricing__toggle">
                <input
                  type="checkbox"
                  checked={form.standalonePricePerPage !== null}
                  onChange={(event) => setForm((current) => ({ ...current, standalonePricePerPage: event.target.checked ? activeScanTiers[0]?.pricePerPage ?? 0 : null }))}
                />
                <span><strong>Use a custom flat price for this product</strong><small>One rate regardless of page count, instead of following the tiers above.</small></span>
              </label>
              {form.standalonePricePerPage !== null ? (
                <label className="form-field">
                  <span>Price per scanned page</span>
                  <input
                    className="numeric"
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.standalonePricePerPage}
                    onChange={(event) => setForm((current) => ({ ...current, standalonePricePerPage: event.target.value === "" ? 0 : Number(event.target.value) }))}
                    aria-invalid={submitted && form.standalonePricePerPage < 0}
                  />
                  <span className="form-field__message">The saved scanner output becomes the job's digital deliverable.</span>
                </label>
              ) : null}
            </section>
          ) : <div
            ref={materialsRef}
            className="product-setup-grid"
            aria-invalid={Boolean(materialsError || photocopyPaperError)}
            aria-describedby="product-materials-message"
            tabIndex={-1}
          >
            <div className="product-setup-grid__configuration">
              <section className="product-setup-section">
                <div className="product-setup-section__heading">
                  <h3>Paper materials &amp; pricing</h3>
                  <p>Select the paper this product can use, then keep its workflow's global price or set a custom product rate.</p>
                </div>
                {pricingRules.length ? (
                  <ProductDocumentRateSelector
                    idPrefix="product-create-document-rate"
                    printType={form.printType}
                    operationKind={form.operationKind}
                    pricingRules={pricingRules}
                    value={form.documentRates}
                    materialAssignments={form.materialAssignments}
                    onChange={(documentRates, materialAssignments) => setForm((current) => ({
                      ...current,
                      documentRates,
                      materialAssignments,
                    }))}
                    disabled={saving}
                  />
                ) : (
                  <div className="product-create-form__variant-empty">
                    <span>Tag an inventory item as A4, Letter, or Legal paper stock before pricing by size.</span>
                    <LinkButton to="/inventory" variant="secondary" size="sm" onClick={onClose}>Open inventory</LinkButton>
                  </div>
                )}
              </section>

              <section className="product-setup-section">
                <div className="product-setup-section__heading">
                  <h3>Pricing variants</h3>
                  <p>Select global options and set how each one changes the per-page price.</p>
                </div>
                {activeVariants.length === 0 ? (
                  <div className="product-create-form__variant-empty">
                    <span>No active global variants are available.</span>
                    <LinkButton to="/configuration/variants" variant="secondary" size="sm" onClick={onClose}>Manage variants</LinkButton>
                  </div>
                ) : (
                  <ProductVariantSelector
                    idPrefix="product-create-variant"
                    variants={activeVariants}
                    value={form.variants}
                    referencePrice={referencePrice}
                    onChange={(variants) => setForm((current) => ({ ...current, variants }))}
                    disabled={saving}
                  />
                )}
              </section>

              <section className="product-setup-section">
                <div className="product-setup-section__heading">
                  <h3>Other materials</h3>
                  <p>Optional supplies without page pricing, such as ink, toner, binding, or laminate.</p>
                </div>
                {activeOtherMaterials.length ? (
                  <MaterialMultiSelect
                    idPrefix="product-create-material"
                    items={activeOtherMaterials}
                    value={form.materialAssignments.filter((assignment) =>
                      activeOtherMaterials.some((item) => item.id === assignment.inventoryItemId))}
                    onChange={(otherMaterials) => setForm((current) => ({
                      ...current,
                      materialAssignments: [
                        ...current.materialAssignments.filter((assignment) =>
                          !activeOtherMaterials.some((item) => item.id === assignment.inventoryItemId)),
                        ...otherMaterials,
                      ],
                    }))}
                    disabled={saving}
                  />
                ) : (
                  <p className="workspace-form__hint">No additional production supplies are registered.</p>
                )}
              </section>
            </div>

            <AssignedMaterialsSummary
              items={inventoryItems}
              value={form.materialAssignments}
              printType={form.printType}
              operationKind={form.operationKind}
              pricingRules={pricingRules}
              documentRates={form.documentRates}
              error={materialsError}
            />
            <span id="product-materials-message" className={photocopyPaperError ? "workspace-form__error" : "visually-hidden"}>
              {photocopyPaperError ?? materialsError ?? "Assigned materials update from the paper and additional-material controls."}
            </span>
          </div>}

          {saveError ? (
            <p className="workspace-form__error" role="alert">
              {saveError}
            </p>
          ) : null}
        </div>

        <footer className="product-create-form__actions">
          <Button type="button" variant="ghost" disabled={saving} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={saving}>
            Create product
          </Button>
        </footer>
      </form>
    </Modal>
  );
}
