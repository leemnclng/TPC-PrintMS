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
import { computeReferencePrice } from "../../lib/productPricing";
import type {
  DocumentPricingRule,
  InventoryItem,
  Product,
  ProductPrintType,
  Service,
  Variant,
} from "../../types/domain";
import "../workspaceForm.css";
import "./ProductCreateModal.css";

interface ProductFormState {
  name: string;
  description: string;
  printType: ProductPrintType;
  isActive: boolean;
  variants: ProductVariantSelection[];
  materialAssignments: MaterialSelection[];
  documentRates: ProductDocumentRateSelection[];
}

function blankProduct(): ProductFormState {
  return {
    name: "",
    description: "",
    printType: "black_and_white",
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
  onClose: () => void;
  onCreated: (product: Product) => void;
}

export function ProductCreateModal({
  open,
  service,
  inventoryItems,
  variants,
  pricingRules,
  onClose,
  onCreated,
}: ProductCreateModalProps) {
  const activeInventoryItems = inventoryItems.filter((item) => item.isActive);
  const activeOtherMaterials = activeInventoryItems.filter((item) => !item.paperSize);
  const activeVariants = variants.filter((variant) => variant.isActive);
  const [form, setForm] = useState<ProductFormState>(blankProduct);
  const [nameTouched, setNameTouched] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const materialsRef = useRef<HTMLDivElement>(null);
  const referencePrice = computeReferencePrice(
    form.printType,
    form.documentRates,
    pricingRules,
    form.materialAssignments,
  );

  const nameError =
    (nameTouched || submitted) && !form.name.trim() ? "Enter a product name before creating the product." : null;
  const materialsError = submitted && form.materialAssignments.length === 0
    ? activeInventoryItems.length === 0
      ? "Register an active inventory material before creating this product."
      : "Add at least one material needed to produce this product."
    : null;
  useEffect(() => {
    if (!open) return;
    setForm(blankProduct());
    setNameTouched(false);
    setSubmitted(false);
    setSaveError(null);
  }, [open]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setNameTouched(true);
    setSubmitted(true);
    setSaveError(null);

    const hasInvalidVariant = form.variants.some((variant) => referencePrice + variant.priceAdjustment < 0);
    const materialIds = form.materialAssignments.map((assignment) => assignment.inventoryItemId);
    const hasInvalidMaterial =
      form.materialAssignments.length === 0 ||
      form.materialAssignments.some((assignment) => !assignment.inventoryItemId) ||
      new Set(materialIds).size !== materialIds.length;
    if (!form.name.trim() || hasInvalidVariant || hasInvalidMaterial) {
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
                <option value="black_and_white">B&amp;W (Black and white)</option>
                <option value="colored">Colored</option>
              </select>
              <span className="form-field__message">Choose the output this product is designed to produce.</span>
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
            <span>Reference price / page</span>
            <strong className="numeric">{formatCurrency(referencePrice)}</strong>
            <small>
              Computed from the assigned paper material's {formatProductPrintType(form.printType)} rate below —
              override it, or adjust the global rate in Configuration.
            </small>
          </div>

          <div
            ref={materialsRef}
            className="product-setup-grid"
            aria-invalid={Boolean(materialsError)}
            aria-describedby="product-materials-message"
            tabIndex={-1}
          >
            <div className="product-setup-grid__configuration">
              <section className="product-setup-section">
                <div className="product-setup-section__heading">
                  <h3>Paper materials &amp; pricing</h3>
                  <p>Select the paper this product can use, then keep its global price or set a custom rate.</p>
                </div>
                {pricingRules.length ? (
                  <ProductDocumentRateSelector
                    idPrefix="product-create-document-rate"
                    printType={form.printType}
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
              pricingRules={pricingRules}
              documentRates={form.documentRates}
              error={materialsError}
            />
            <span id="product-materials-message" className="visually-hidden">
              {materialsError ?? "Assigned materials update from the paper and additional-material controls."}
            </span>
          </div>

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
