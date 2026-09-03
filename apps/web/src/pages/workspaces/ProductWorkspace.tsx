import { FormEvent, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { PageHeader } from "../../components/PageHeader/PageHeader";
import { Card, CardHeader } from "../../components/Card/Card";
import { AssignedMaterialsSummary } from "../../components/AssignedMaterialsSummary/AssignedMaterialsSummary";
import { Button } from "../../components/Button/Button";
import { LinkButton } from "../../components/Button/LinkButton";
import { LoadingState } from "../../components/LoadingState/LoadingState";
import { ErrorState } from "../../components/ErrorState/ErrorState";
import { EmptyState } from "../../components/EmptyState/EmptyState";
import { MaterialMultiSelect, type MaterialSelection } from "../../components/MaterialMultiSelect/MaterialMultiSelect";
import {
  ProductDocumentRateSelector,
  type ProductDocumentRateSelection,
} from "../../components/ProductDocumentRateSelector/ProductDocumentRateSelector";
import {
  ProductVariantSelector,
  type ProductVariantSelection,
} from "../../components/ProductVariantSelector/ProductVariantSelector";
import { useResource } from "../../hooks/useResource";
import { api, ApiError } from "../../lib/apiClient";
import { formatCurrency, formatProductPrintType } from "../../lib/format";
import { computeReferencePrice, resolveScanPricePerPage } from "../../lib/productPricing";
import type {
  DocumentPricingRule,
  InventoryItem,
  PricingCategory,
  PrintTypeDefinition,
  Product,
  ProductOperationKind,
  ProductPrintType,
  ScanPricingTier,
  Service,
  Variant,
} from "../../types/domain";
import "../workspaceForm.css";

type FormState = {
  name: string;
  description: string;
  printType: ProductPrintType;
  operationKind: ProductOperationKind;
  pricingCategoryKey: string | null;
  standalonePricePerPage: number | null;
  isActive: boolean;
  variants: ProductVariantSelection[];
  materialAssignments: MaterialSelection[];
  documentRates: ProductDocumentRateSelection[];
};

const BLANK: FormState = {
  name: "",
  description: "",
  printType: "black_and_white",
  operationKind: "printing",
  pricingCategoryKey: "printing",
  standalonePricePerPage: null,
  isActive: true,
  variants: [],
  materialAssignments: [],
  documentRates: [],
};

export function ProductWorkspace() {
  const { serviceId, productId } = useParams();
  const isNew = !productId;
  const navigate = useNavigate();

  const { data, state, error } = useResource(
    async () => {
      if (!serviceId) throw new Error("Service is required.");
      const [service, product, inventoryItems, variants, pricingRules, scanPricingTiers, printTypes, pricingCategories] = await Promise.all([
        api.get<Service>(`/services/${serviceId}`),
        isNew ? Promise.resolve(null) : api.get<Product>(`/products/${productId}`),
        api.get<InventoryItem[]>("/inventory-items"),
        api.get<Variant[]>("/variants"),
        api.get<DocumentPricingRule[]>("/document-analyzer/pricing-rules"),
        api.get<ScanPricingTier[]>("/document-analyzer/scan-pricing-tiers"),
        api.get<PrintTypeDefinition[]>("/print-types"),
        api.get<PricingCategory[]>("/document-analyzer/pricing-categories"),
      ]);
      return { service, product, inventoryItems, variants, pricingRules, scanPricingTiers, printTypes, pricingCategories };
    },
    [serviceId, productId],
  );

  const [form, setForm] = useState<FormState>(BLANK);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setSaveError(null);
    if (data?.product) {
      setForm({
        name: data.product.name,
        description: data.product.description ?? "",
        printType: data.product.printType,
        operationKind: data.product.operationKind,
        pricingCategoryKey: data.product.pricingCategoryKey ?? (data.product.operationKind === "scan" ? null : data.product.operationKind),
        standalonePricePerPage: data.product.standalonePricePerPage ?? null,
        isActive: data.product.isActive,
        variants: data.product.variants.map((variant) => ({
          variantId: variant.variantId,
          priceAdjustment: variant.priceAdjustment,
        })),
        materialAssignments: data.product.materialAssignments.map((assignment) => ({
          inventoryItemId: assignment.inventoryItemId,
        })),
        documentRates: data.product.documentRates.map((rate) => ({
          pricingRuleId: rate.pricingRuleId,
          pricePerPage: rate.pricePerPage,
        })),
      });
    } else if (data) {
      const defaultPrintType = data.printTypes.find((printType) => printType.isActive && printType.key === "black_and_white")
        ?? data.printTypes.find((printType) => printType.isActive);
      const operationKind = data.service.category === "photocopy" ? "photocopy" : "printing";
      setForm({ ...BLANK, printType: defaultPrintType?.key ?? BLANK.printType, operationKind, pricingCategoryKey: data.pricingCategories.find((category) => category.isActive && category.operationKind === operationKind)?.key ?? operationKind });
    }
  }, [data]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaveError(null);
    try {
      if (!serviceId) throw new Error("Service is required.");
      const isScan = form.operationKind === "scan";
      if (!isScan && !form.pricingCategoryKey) {
        setSaveError("Select a pricing category for this product.");
        return;
      }
      if (!isScan && isNew && form.materialAssignments.length === 0) {
        setSaveError("Assign at least one material this product may use.");
        return;
      }
      if (form.materialAssignments.some((assignment) => !assignment.inventoryItemId)) {
        setSaveError("Every material assignment must reference an inventory item.");
        return;
      }
      if (form.operationKind === "photocopy") {
        const hasPaperAssignment = (data?.pricingRules ?? []).some((rule) =>
          rule.printType === form.printType && rule.pricingScope === (form.pricingCategoryKey ?? form.operationKind) && form.materialAssignments.some((entry) => entry.inventoryItemId === rule.inventoryItemId));
        if (!hasPaperAssignment) {
          setSaveError("Select at least one paper material for this photocopy product.");
          return;
        }
      }
      if (isScan && form.standalonePricePerPage !== null && form.standalonePricePerPage < 0) {
        setSaveError("The scan price can't be negative.");
        return;
      }
      const variantIds = form.variants.map((variant) => variant.variantId);
      if (new Set(variantIds).size !== variantIds.length) {
        setSaveError("Each global variant can be selected only once.");
        return;
      }
      const referencePrice = isScan ? resolveScanPricePerPage(form.standalonePricePerPage, 1, data?.scanPricingTiers ?? []) ?? 0 : computeReferencePrice(
        form.printType,
        form.pricingCategoryKey ?? form.operationKind,
        form.documentRates,
        data?.pricingRules ?? [],
        form.materialAssignments,
      );
      if (form.variants.some((variant) => referencePrice + variant.priceAdjustment < 0)) {
        setSaveError("A pricing variant cannot produce a negative final unit price.");
        return;
      }
      setSaving(true);
      const payload = {
        ...form,
        serviceId,
      };
      if (isNew) {
        const created = await api.post<Product>("/products", payload);
        navigate(`/product-catalog/${serviceId}/products/${created.id}`, { replace: true });
      } else {
        await api.put<Product>(`/products/${productId}`, payload);
        navigate(`/product-catalog/${serviceId}`);
      }
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Couldn't save.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!productId) return;
    if (!window.confirm(`Delete ${form.name || "this product"}? It will disappear from the catalog now. You can restore it from this service for 5 days before deletion becomes permanent.`)) return;
    setDeleting(true);
    setSaveError(null);
    try {
      await api.del(`/products/${productId}`);
      navigate(`/product-catalog/${serviceId}`);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Couldn't remove this product.");
    } finally {
      setDeleting(false);
    }
  }

  if (state === "loading") return <LoadingState label={isNew ? "Loading service…" : "Loading product…"} />;
  if (state === "error") return <ErrorState description={error ?? undefined} />;
  if (!isNew && state === "ready" && !data?.product) {
    return <EmptyState title="Product not found" description="It may have been removed." />;
  }
  if (!isNew && data?.product && data.product.serviceId !== serviceId) {
    return <ErrorState description="This product does not belong to the selected service." />;
  }

  const assignableInventoryItems = data?.inventoryItems.filter(
    (item) =>
      item.isActive ||
      (!isNew && form.materialAssignments.some((assignment) => assignment.inventoryItemId === item.id)),
  ) ?? [];
  const assignableOtherMaterials = assignableInventoryItems.filter((item) => !item.paperSize);
  const assignableVariants = data?.variants.filter(
    (variant) => variant.isActive || form.variants.some((selection) => selection.variantId === variant.id),
  ) ?? [];
  const pricingRules = data?.pricingRules ?? [];
  const assignablePrintTypes = data?.printTypes.filter(
    (printType) => printType.isActive || printType.key === form.printType,
  ) ?? [];
  const selectedPrintType = data?.printTypes.find((printType) => printType.key === form.printType);
  const isScan = form.operationKind === "scan";
  const compatibleCategories = data?.pricingCategories.filter((category) => (category.isActive || category.key === form.pricingCategoryKey) && category.operationKind === form.operationKind) ?? [];
  const selectedPricingCategory = data?.pricingCategories.find((category) => category.key === form.pricingCategoryKey);
  const scanPricingTiers = [...(data?.scanPricingTiers ?? [])].sort((left, right) => left.minPages - right.minPages);
  const activeScanTiers = scanPricingTiers.filter((tier) => tier.isActive);
  const referencePrice = isScan ? resolveScanPricePerPage(form.standalonePricePerPage, 1, scanPricingTiers) ?? 0 : computeReferencePrice(
    form.printType,
    form.pricingCategoryKey ?? form.operationKind,
    form.documentRates,
    pricingRules,
    form.materialAssignments,
  );

  return (
    <>
      <PageHeader
        eyebrow={data?.service.name.toUpperCase() ?? "SERVICES"}
        title={isNew ? "New product" : data?.product?.name ?? "Product"}
        description={
          isNew
            ? `Add a product to ${data?.service.name ?? "this service"}, including its pricing and allowed materials.`
            : `Pricing, variants, and allowed material choices for this product in ${data?.service.name ?? "the service"}.`
        }
      />

      <Card>
        <CardHeader title="Product details" />
        <form className="workspace-form workspace-form--product" onSubmit={handleSubmit}>
          <label className="form-field">
            <span>Product name</span>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoFocus />
          </label>
          <label className="form-field">
            <span>Description</span>
            <textarea
              rows={3}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </label>
          {data?.service.category === "photocopy" ? (
            <label className="form-field">
              <span>Operation</span>
              <select
                value={form.operationKind}
                onChange={(event) => setForm((current) => ({
                  ...current,
                  operationKind: event.target.value as ProductOperationKind,
                  pricingCategoryKey: event.target.value === "scan" ? null : data?.pricingCategories.find((category) => category.isActive && category.operationKind === event.target.value)?.key ?? null,
                  standalonePricePerPage: null,
                  variants: [],
                  materialAssignments: [],
                  documentRates: [],
                }))}
              >
                <option value="photocopy">Photocopy</option>
                <option value="scan">Scan to softcopy</option>
              </select>
              <span className="form-field__message">Changing operation clears incompatible printing configuration.</span>
            </label>
          ) : null}
          {!isScan ? (
            <label className="form-field">
              <span>Pricing category</span>
              <select value={form.pricingCategoryKey ?? ""} onChange={(event) => setForm((current) => ({ ...current, pricingCategoryKey: event.target.value || null, materialAssignments: [], documentRates: [] }))} required>
                <option value="">Select pricing category</option>
                {compatibleCategories.map((category) => <option key={category.key} value={category.key}>{category.name}</option>)}
              </select>
              <span className="form-field__message">Controls the available paper stock and global rates.</span>
            </label>
          ) : null}
          <div className="workspace-form__row">
            <label className="form-field">
              <span>Print type</span>
              <select
                value={form.printType}
                onChange={(e) => setForm({
                  ...form,
                  printType: e.target.value as ProductPrintType,
                  documentRates: [],
                })}
              >
                {assignablePrintTypes.map((printType) => (
                  <option key={printType.key} value={printType.key}>{printType.label}</option>
                ))}
              </select>
              <span className="form-field__message">
                {isScan ? "Classifies this scan product; it does not change the flat per-page rate below." : "The output type staff should use for this product."}
              </span>
            </label>
            <label className="form-field">
              <span>Status</span>
              <select
                value={form.isActive ? "active" : "inactive"}
                onChange={(e) => setForm({ ...form, isActive: e.target.value === "active" })}
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
                  ? "This product's own flat price, regardless of page count. No paper, ink, or inventory usage."
                  : "Following the global page-count tiers below (shown here for a 1-page scan). No paper, ink, or inventory usage."
                : `Computed from the ${selectedPricingCategory?.name ?? "selected"} global table for the assigned paper's ${selectedPrintType?.label ?? formatProductPrintType(form.printType)} rate.`}
            </small>
          </div>

          {isScan ? (
            <section className="product-setup-section product-scan-pricing">
              <div className="product-setup-section__heading"><h3>Softcopy pricing</h3><p>Charge for each page produced by the scanner. The retained output becomes the customer deliverable.</p></div>
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
                  <input className="numeric" type="number" min="0" step="0.01" value={form.standalonePricePerPage} onChange={(event) => setForm((current) => ({ ...current, standalonePricePerPage: event.target.value === "" ? 0 : Number(event.target.value) }))} />
                </label>
              ) : null}
            </section>
          ) : <div className="product-setup-grid">
            <div className="product-setup-grid__configuration">
              <section className="product-setup-section">
                <div className="product-setup-section__heading">
                  <h3>Paper materials &amp; pricing</h3>
                  <p>Select the paper this product can use, then keep its workflow's global price or set a custom product rate.</p>
                </div>
                {pricingRules.length ? (
                  <ProductDocumentRateSelector
                    idPrefix="product-workspace-document-rate"
                    printType={form.printType}
                    operationKind={form.operationKind}
                    pricingCategoryKey={form.pricingCategoryKey}
                    pricingCategoryName={selectedPricingCategory?.name}
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
                  <div className="workspace-materials__empty">
                    <span>Tag an inventory material with a supported Canon paper size before pricing by size.</span>
                    <LinkButton to="/inventory" variant="secondary" size="sm">Open inventory</LinkButton>
                  </div>
                )}
              </section>

              <section className="product-setup-section">
                <div className="product-setup-section__heading">
                  <h3>Pricing variants</h3>
                  <p>Select global options and set how each one changes the per-page price.</p>
                </div>
                {assignableVariants.length === 0 ? (
                  <div className="workspace-materials__empty">
                    <span>Create a reusable global variant before assigning one to this product.</span>
                    <LinkButton to="/configuration/variants" variant="secondary" size="sm">Manage variants</LinkButton>
                  </div>
                ) : (
                  <ProductVariantSelector
                    idPrefix="product-workspace-variant"
                    variants={assignableVariants}
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
                {assignableOtherMaterials.length ? (
                  <MaterialMultiSelect
                    idPrefix="product-workspace-material"
                    items={assignableOtherMaterials}
                    value={form.materialAssignments.filter((assignment) =>
                      assignableOtherMaterials.some((item) => item.id === assignment.inventoryItemId))}
                    onChange={(otherMaterials) => setForm((current) => ({
                      ...current,
                      materialAssignments: [
                        ...current.materialAssignments.filter((assignment) =>
                          !assignableOtherMaterials.some((item) => item.id === assignment.inventoryItemId)),
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
              items={data?.inventoryItems ?? []}
              value={form.materialAssignments}
              printType={form.printType}
              operationKind={form.operationKind}
              pricingCategoryKey={form.pricingCategoryKey}
              pricingRules={pricingRules}
              documentRates={form.documentRates}
            />
          </div>}

          <div className="workspace-form__actions">
            <Button type="button" variant="ghost" disabled={saving || deleting} onClick={() => navigate(`/product-catalog/${serviceId}`)}>
              Cancel
            </Button>
            {!isNew && (
              <Button type="button" variant="danger" loading={deleting} disabled={saving} onClick={handleDelete}>
                Delete product
              </Button>
            )}
            {saveError && <span className="workspace-form__error">{saveError}</span>}
            <Button type="submit" variant="primary" loading={saving} disabled={deleting}>
              {isNew ? "Create product" : "Save changes"}
            </Button>
          </div>
        </form>
      </Card>
    </>
  );
}
