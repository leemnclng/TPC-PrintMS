import { FormEvent, useEffect, useState } from "react";
import { Button } from "../../components/Button/Button";
import { LinkButton } from "../../components/Button/LinkButton";
import { Card, CardHeader } from "../../components/Card/Card";
import { EmptyState } from "../../components/EmptyState/EmptyState";
import { ErrorState } from "../../components/ErrorState/ErrorState";
import { LoadingState } from "../../components/LoadingState/LoadingState";
import { useResource } from "../../hooks/useResource";
import { ApiError, api } from "../../lib/apiClient";
import { formatProductPrintType } from "../../lib/format";
import type { CSSProperties } from "react";
import type { DocumentPricingRule, InventoryPaperSize, PrintTypeDefinition, Product } from "../../types/domain";
import "../SettingsPage.css";
import { PrintTypeCreateModal } from "./PrintTypeCreateModal";

const PAPER_ORDER: InventoryPaperSize[] = ["A4", "Letter", "Legal"];
const PRICING_SCOPES = [
  {
    key: "printing" as const,
    label: "Printing",
    eyebrow: "FILE-BASED OUTPUT",
    description: "Default paper and print-type rates for products that send an uploaded document to the printer.",
  },
  {
    key: "photocopy" as const,
    label: "Scan or Photocopy",
    eyebrow: "DEVICE-SIDE OUTPUT",
    description: "Default paper and print-type rates for Photocopy products. Scan products remain per-product because they consume no print material.",
  },
];

export function DocumentPricingSettings() {
  const { data, state, error, reload } = useResource(
    async () => {
      const [rules, printTypes, products] = await Promise.all([
        api.get<DocumentPricingRule[]>("/document-analyzer/pricing-rules"),
        api.get<PrintTypeDefinition[]>("/print-types"),
        api.get<Product[]>("/products"),
      ]);
      return { rules, printTypes, products };
    },
  );
  const [rules, setRules] = useState<DocumentPricingRule[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [createTypeOpen, setCreateTypeOpen] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedProductId, setSelectedProductId] = useState("");
  const [productSaving, setProductSaving] = useState(false);
  const [productSaved, setProductSaved] = useState(false);
  const [productSaveError, setProductSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;
    setRules(data.rules);
    setProducts(data.products);
    setSelectedProductId((current) => {
      const physicalProducts = data.products.filter((product) => product.operationKind !== "scan");
      return physicalProducts.some((product) => product.id === current) ? current : physicalProducts[0]?.id ?? "";
    });
  }, [data]);

  const printTypes = data?.printTypes.filter((printType) => printType.isActive) ?? [];
  const tableColumns = {
    gridTemplateColumns: `minmax(9rem, 0.7fr) repeat(${Math.max(printTypes.length, 1)}, minmax(9rem, 1fr))`,
  } satisfies CSSProperties;
  const physicalProducts = products.filter((product) => product.operationKind !== "scan");
  const selectedProduct = physicalProducts.find((product) => product.id === selectedProductId) ?? null;

  function updateRule(id: string, patch: Partial<DocumentPricingRule>) {
    setSaved(false);
    setRules((current) => current.map((rule) => rule.id === id ? { ...rule, ...patch } : rule));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setSaved(false);
    setSaveError(null);
    try {
      const updated = await api.put<DocumentPricingRule[]>("/document-analyzer/pricing-rules", {
        rules: rules.map((rule) => ({
          id: rule.id,
          pricePerPage: rule.pricePerPage,
          isActive: rule.isActive,
        })),
      });
      setRules(updated);
      setSaved(true);
    } catch (caught) {
      setSaveError(caught instanceof ApiError ? caught.message : "The analyzer pricing rules couldn’t be saved.");
    } finally {
      setSaving(false);
    }
  }

  function updateProductRate(rule: DocumentPricingRule, useCustomRate: boolean) {
    if (!selectedProduct) return;
    setProductSaved(false);
    setProducts((current) => current.map((product) => {
      if (product.id !== selectedProduct.id) return product;
      const remaining = product.documentRates.filter((rate) => rate.pricingRuleId !== rule.id);
      return {
        ...product,
        documentRates: useCustomRate
          ? [...remaining, {
              id: `new-${rule.id}`,
              pricingRuleId: rule.id,
              paperSize: rule.paperSize,
              printType: rule.printType,
              pricingScope: rule.pricingScope,
              pricePerPage: rule.pricePerPage,
            }]
          : remaining,
      };
    }));
  }

  function updateProductRatePrice(pricingRuleId: string, pricePerPage: number) {
    if (!selectedProduct) return;
    setProductSaved(false);
    setProducts((current) => current.map((product) => product.id === selectedProduct.id
      ? {
          ...product,
          documentRates: product.documentRates.map((rate) => rate.pricingRuleId === pricingRuleId
            ? { ...rate, pricePerPage: Math.max(0, pricePerPage) }
            : rate),
        }
      : product));
  }

  async function saveProductPricing(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedProduct) return;
    setProductSaving(true);
    setProductSaved(false);
    setProductSaveError(null);
    try {
      const updated = await api.put<Product>(`/products/${selectedProduct.id}`, {
        serviceId: selectedProduct.serviceId,
        name: selectedProduct.name,
        description: selectedProduct.description ?? null,
        printType: selectedProduct.printType,
        operationKind: selectedProduct.operationKind,
        standalonePricePerPage: selectedProduct.standalonePricePerPage ?? null,
        isActive: selectedProduct.isActive,
        variants: selectedProduct.variants.map((variant) => ({
          variantId: variant.variantId,
          priceAdjustment: variant.priceAdjustment,
        })),
        materialAssignments: selectedProduct.materialAssignments.map((assignment) => ({
          inventoryItemId: assignment.inventoryItemId,
        })),
        documentRates: selectedProduct.documentRates.map((rate) => ({
          pricingRuleId: rate.pricingRuleId,
          pricePerPage: rate.pricePerPage,
        })),
      });
      setProducts((current) => current.map((product) => product.id === updated.id ? updated : product));
      setProductSaved(true);
    } catch (caught) {
      setProductSaveError(caught instanceof ApiError ? caught.message : "The product pricing couldn’t be saved.");
    } finally {
      setProductSaving(false);
    }
  }

  return (
    <section id="document-pricing" className="settings-anchor-section">
      <Card>
        <CardHeader
          title="Document analyzer pricing"
          action={(
            <div className="settings-card-actions">
              <Button type="button" variant="secondary" size="sm" onClick={() => setCreateTypeOpen(true)}>Add print type</Button>
              <LinkButton to="/document-analyzer" variant="secondary" size="sm">Open analyzer</LinkButton>
            </div>
          )}
        />
        <p className="settings-placeholder-text">
          Configure a separate global table for each built-in workflow. Every value remains tied to real paper
          inventory and may still be overridden by an individual product.
        </p>

        {state === "loading" ? <LoadingState label="Loading pricing rules…" /> : null}
        {state === "error" ? <ErrorState description={error ?? undefined} onRetry={reload} /> : null}

        {state === "ready" && rules.length === 0 ? (
          <EmptyState
            title="No paper sizes configured yet"
            description="Tag an inventory item as A4, Letter, or Legal paper stock in Inventory to start pricing by size."
            action={<LinkButton to="/inventory" variant="secondary" size="sm">Open inventory</LinkButton>}
          />
        ) : null}

        {state === "ready" && rules.length > 0 ? (
          <form className="settings-pricing-form" onSubmit={handleSubmit}>
            <div className="settings-pricing-scopes">
              {PRICING_SCOPES.map((scope, scopeIndex) => {
                const scopedRules = rules.filter((rule) => rule.pricingScope === scope.key);
                return (
                  <section className="settings-pricing-scope" key={scope.key} aria-labelledby={`pricing-scope-${scope.key}`}>
                    <header className="settings-pricing-scope__header">
                      <span className="numeric">{String(scopeIndex + 1).padStart(2, "0")} / {scope.eyebrow}</span>
                      <div><h3 id={`pricing-scope-${scope.key}`}>{scope.label}</h3><p>{scope.description}</p></div>
                      <output>{scopedRules.filter((rule) => rule.isActive).length}<small>active rates</small></output>
                    </header>
                    <div className="settings-pricing-table" role="table" aria-label={`${scope.label} per-page pricing rules`}>
                      <div className="settings-pricing-table__header" role="row" style={tableColumns}>
                        <span role="columnheader">Paper material</span>
                        {printTypes.map((printType) => (
                          <span role="columnheader" key={printType.key}>
                            <strong>{printType.label || formatProductPrintType(printType.key)}</strong>
                            <small>{printType.appliesInkCoverage ? "Base + ink coverage" : "Paper and ink included"}</small>
                          </span>
                        ))}
                      </div>
                      {Array.from(new Map(scopedRules.map((rule) => [rule.inventoryItemId, {
                        id: rule.inventoryItemId,
                        name: rule.inventoryItemName,
                        paperSize: rule.paperSize,
                      }])).values()).sort((left, right) =>
                        PAPER_ORDER.indexOf(left.paperSize) - PAPER_ORDER.indexOf(right.paperSize)
                        || left.name.localeCompare(right.name)).map((material) => {
                        return (
                          <div className="settings-pricing-table__row" role="row" key={material.id} style={tableColumns}>
                            <strong role="rowheader"><span>{material.name}</span><small>{material.paperSize}</small></strong>
                            {printTypes.map((printType) => {
                              const rule = scopedRules.find((candidate) => candidate.inventoryItemId === material.id && candidate.printType === printType.key);
                              return rule ? (
                                <div className="settings-pricing-table__rate" role="cell" key={printType.key}>
                                  <label>
                                    <span>₱</span>
                                    <input
                                      className="numeric"
                                      type="number"
                                      min="0"
                                      step="0.01"
                                      value={rule.pricePerPage}
                                      aria-label={`${scope.label} ${printType.label} rate for ${material.name}`}
                                      onChange={(event) => updateRule(rule.id, { pricePerPage: Number(event.target.value) })}
                                    />
                                  </label>
                                  <label className="settings-pricing-table__toggle">
                                    <input type="checkbox" checked={rule.isActive} onChange={(event) => updateRule(rule.id, { isActive: event.target.checked })} />
                                    <span>Use</span>
                                  </label>
                                </div>
                              ) : <span role="cell" key={printType.key}>—</span>;
                            })}
                          </div>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>
            <div className="settings-form__actions">
              <Button type="submit" variant="primary" loading={saving}>Save pricing rules</Button>
              {saved ? <span className="settings-form__saved">Saved.</span> : null}
              {saveError ? <span className="settings-form__error" role="alert">{saveError}</span> : null}
            </div>
          </form>
        ) : null}
      </Card>

      {state === "ready" && data ? (
        <Card className="settings-product-pricing-card">
          <CardHeader title="Product pricing matrix" meta={`${physicalProducts.length} physical products`} />
          <p className="settings-placeholder-text">
            Select a product to layer its own rate over the matching global material and print type. Products that
            use the same paper and output type can therefore keep different prices.
          </p>
          {physicalProducts.length ? (
            <form className="settings-product-pricing" onSubmit={saveProductPricing}>
              <div className="settings-product-pricing__toolbar">
                <label>
                  <span>Product</span>
                  <select value={selectedProductId} onChange={(event) => { setSelectedProductId(event.target.value); setProductSaved(false); setProductSaveError(null); }}>
                    {physicalProducts.map((product) => <option value={product.id} key={product.id}>{product.serviceName} · {product.name}</option>)}
                  </select>
                </label>
                {selectedProduct ? <div><span>Configured print type</span><strong>{selectedProduct.printTypeLabel}</strong><small>{selectedProduct.operationKind === "photocopy" ? "Scan or Photocopy table" : "Printing table"}</small></div> : null}
              </div>

              {selectedProduct ? (() => {
                const assignedIds = new Set(selectedProduct.materialAssignments.map((assignment) => assignment.inventoryItemId));
                const productRules = rules.filter((rule) => rule.pricingScope === selectedProduct.operationKind && assignedIds.has(rule.inventoryItemId));
                const materials = Array.from(new Map(productRules.map((rule) => [rule.inventoryItemId, {
                  id: rule.inventoryItemId,
                  name: rule.inventoryItemName,
                  paperSize: rule.paperSize,
                }])).values()).sort((left, right) =>
                  PAPER_ORDER.indexOf(left.paperSize) - PAPER_ORDER.indexOf(right.paperSize)
                  || left.name.localeCompare(right.name));
                return materials.length ? (
                  <div className="settings-pricing-table settings-pricing-table--product" role="table" aria-label={`${selectedProduct.name} product pricing`}>
                    <div className="settings-pricing-table__header" role="row" style={tableColumns}>
                      <span role="columnheader">Assigned material</span>
                      {printTypes.map((printType) => <span role="columnheader" className={printType.key === selectedProduct.printType ? "is-selected" : ""} key={printType.key}><strong>{printType.label}</strong><small>{printType.key === selectedProduct.printType ? "Product output" : "Not configured"}</small></span>)}
                    </div>
                    {materials.map((material) => (
                      <div className="settings-pricing-table__row" role="row" style={tableColumns} key={material.id}>
                        <strong role="rowheader"><span>{material.name}</span><small>{material.paperSize}</small></strong>
                        {printTypes.map((printType) => {
                          const rule = productRules.find((candidate) => candidate.inventoryItemId === material.id && candidate.printType === printType.key);
                          if (!rule || printType.key !== selectedProduct.printType) return <span className="settings-pricing-table__not-used" role="cell" key={printType.key}>—<small>Not used</small></span>;
                          const override = selectedProduct.documentRates.find((rate) => rate.pricingRuleId === rule.id);
                          return (
                            <div className="settings-pricing-table__product-rate" role="cell" key={printType.key}>
                              <label className="settings-pricing-table__source">
                                <input type="checkbox" checked={Boolean(override)} disabled={!rule.isActive || productSaving} onChange={(event) => updateProductRate(rule, event.target.checked)} />
                                <span>{override ? "Product price" : "Use global"}</span>
                              </label>
                              {override ? <label className="settings-pricing-table__money"><span>₱</span><input className="numeric" type="number" min="0" step="0.01" value={override.pricePerPage} disabled={!rule.isActive || productSaving} aria-label={`${selectedProduct.name} ${printType.label} price for ${material.name}`} onChange={(event) => updateProductRatePrice(rule.id, Number(event.target.value))} /></label> : <strong className="numeric">₱{rule.pricePerPage.toFixed(2)}<small>{rule.isActive ? "Global rate" : "Inactive"}</small></strong>}
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                ) : <EmptyState title="No assigned paper pricing" description="Assign an active paper material to this product before configuring its product-specific rate." />;
              })() : null}

              <div className="settings-form__actions">
                <Button type="submit" variant="primary" loading={productSaving} disabled={!selectedProduct}>Save product pricing</Button>
                {productSaved ? <span className="settings-form__saved">Saved.</span> : null}
                {productSaveError ? <span className="settings-form__error" role="alert">{productSaveError}</span> : null}
              </div>
            </form>
          ) : <EmptyState title="No physical products" description="Create a Printing or Photocopy product to configure material-based product pricing." />}
          {products.some((product) => product.operationKind === "scan") ? <p className="settings-product-pricing__scan-note">Scan-only products remain priced per scanned page in their product workspace because they do not consume paper or ink.</p> : null}
        </Card>
      ) : null}
      <PrintTypeCreateModal
        open={createTypeOpen}
        onClose={() => setCreateTypeOpen(false)}
        onCreated={() => {
          setCreateTypeOpen(false);
          reload();
        }}
      />
    </section>
  );
}
