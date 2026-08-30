import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardHeader } from "../components/Card/Card";
import { EmptyState } from "../components/EmptyState/EmptyState";
import { ErrorState } from "../components/ErrorState/ErrorState";
import { LoadingState } from "../components/LoadingState/LoadingState";
import { PageHeader } from "../components/PageHeader/PageHeader";
import { StatusPill } from "../components/StatusPill/StatusPill";
import { useResource } from "../hooks/useResource";
import { api } from "../lib/apiClient";
import { formatCurrency } from "../lib/format";
import { hasCustomPricing, productUsesPaperSize, resolveProductPricePoints } from "../lib/pricingView";
import type { DocumentPricingRule, InventoryPaperSize, PrintTypeDefinition, Product, Service } from "../types/domain";
import "./PricingCenterPage.css";

type PriceFilter = "all" | "custom" | "global" | "missing";
const PAPER_SIZES: InventoryPaperSize[] = ["A4", "Letter", "Legal"];
const GLOBAL_SCOPES = [
  { key: "printing" as const, label: "Printing" },
  { key: "photocopy" as const, label: "Scan or Photocopy" },
];

function workflowLabel(service: Service): string {
  if (service.category === "printing") return "Printing";
  if (service.category === "photocopy") return "Scan or Photocopy";
  return "Custom";
}

function PaperPriceCell({ product, paperSize, rules }: { product: Product; paperSize: InventoryPaperSize; rules: DocumentPricingRule[] }) {
  const points = resolveProductPricePoints(product, rules).filter((point) => point.paperSize === paperSize);
  const assigned = productUsesPaperSize(product, paperSize, rules);
  return (
    <td className="pricing-service-table__price">
      {points.length ? points.map((point) => (
        <span className={point.custom ? "is-custom" : "is-global"} key={point.key}>
          <strong>{formatCurrency(point.amount)}</strong>
          <small>{point.materialName}</small>
          <b>{point.custom ? "Custom" : "Global"}</b>
        </span>
      )) : <span className={assigned ? "is-missing" : "is-unavailable"}>{assigned ? "Missing rate" : "—"}</span>}
    </td>
  );
}

function AdditionalPricing({ product }: { product: Product }) {
  if (product.operationKind === "scan") {
    return product.standalonePricePerPage == null
      ? <span className="pricing-service-table__missing">Missing scan rate</span>
      : <span className="pricing-service-table__standalone"><strong>{formatCurrency(product.standalonePricePerPage)}</strong><small>per scanned page · Custom</small></span>;
  }
  if (!product.variants.length) return <span className="pricing-service-table__muted">Base rates only</span>;
  return <div className="pricing-service-table__variants">{product.variants.map((variant) => <span key={variant.id}><b>{variant.label}</b><small>{variant.priceAdjustment >= 0 ? "+" : ""}{formatCurrency(variant.priceAdjustment)} / page</small></span>)}</div>;
}

export function PricingCenterPage() {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<PriceFilter>("all");
  const { data, state, error, reload } = useResource(async () => {
    const [products, services, rules, printTypes] = await Promise.all([
      api.get<Product[]>("/products"),
      api.get<Service[]>("/services"),
      api.get<DocumentPricingRule[]>("/document-analyzer/pricing-rules"),
      api.get<PrintTypeDefinition[]>("/print-types"),
    ]);
    return { products, services, rules, printTypes };
  });

  const rows = useMemo(() => {
    if (!data) return [];
    const normalizedQuery = query.trim().toLowerCase();
    return data.products
      .map((product) => ({ product, points: resolveProductPricePoints(product, data.rules) }))
      .filter(({ product, points }) => {
        const missing = points.length === 0;
        const matchesFilter = filter === "all"
          || (filter === "custom" && hasCustomPricing(product))
          || (filter === "global" && product.operationKind !== "scan" && product.documentRates.length === 0)
          || (filter === "missing" && missing);
        const matchesQuery = !normalizedQuery || `${product.name} ${product.serviceName} ${product.printTypeLabel}`.toLowerCase().includes(normalizedQuery);
        return matchesFilter && matchesQuery;
      });
  }, [data, filter, query]);

  const customProducts = data?.products.filter(hasCustomPricing).length ?? 0;
  const customEntries = data?.products.reduce((total, product) => total + product.documentRates.length + product.variants.length + (product.standalonePricePerPage == null ? 0 : 1), 0) ?? 0;
  const missingProducts = data?.products.filter((product) => {
    const points = resolveProductPricePoints(product, data.rules);
    return points.length === 0;
  }).length ?? 0;
  const serviceGroups = data?.services
    .map((service) => ({ service, rows: rows.filter(({ product }) => product.serviceId === service.id) }))
    .filter(({ service, rows: serviceRows }) => serviceRows.length > 0 || (filter === "all" && (!query.trim() || `${service.name} ${service.description ?? ""}`.toLowerCase().includes(query.trim().toLowerCase())))) ?? [];

  return (
    <>
      <PageHeader
        eyebrow="PRICING CENTER"
        title="Pricing"
        description="Compare material and print-type defaults, then see the effective price used by every product."
      />

      {state === "loading" ? <LoadingState label="Loading all pricing…" /> : null}
      {state === "error" ? <ErrorState description={error ?? undefined} onRetry={reload} /> : null}
      {state === "ready" && data ? (
        <div className="pricing-center">
          <section className="pricing-summary" aria-label="Pricing coverage">
            <div><span>Services</span><strong className="numeric">{data.services.length}</strong><small>Workflow groups</small></div>
            <div><span>Products</span><strong className="numeric">{data.products.length}</strong><small>Chargeable offerings</small></div>
            <div className="is-custom"><span>Custom pricing</span><strong className="numeric">{customEntries}</strong><small>Across {customProducts} products</small></div>
            <div className={missingProducts ? "is-warning" : ""}><span>Needs attention</span><strong className="numeric">{missingProducts}</strong><small>Products without a usable rate</small></div>
          </section>

          <Card className="pricing-global-card">
            <CardHeader title="Material × print type matrices" action={<Link className="pricing-text-link" to="/configuration#document-pricing">Configure pricing</Link>} />
            <p className="pricing-card-copy">Rows are stocked paper materials and columns are reusable print types. These values are fallbacks; each product may replace its matching cell.</p>
            {data.rules.length ? (
              <div className="pricing-global-scopes">
                {GLOBAL_SCOPES.map((scope) => {
                  const scopedRules = data.rules.filter((rule) => rule.pricingScope === scope.key);
                  const materials = Array.from(new Map(scopedRules.map((rule) => [rule.inventoryItemId, {
                    id: rule.inventoryItemId,
                    name: rule.inventoryItemName,
                    paperSize: rule.paperSize,
                  }])).values()).sort((left, right) => PAPER_SIZES.indexOf(left.paperSize) - PAPER_SIZES.indexOf(right.paperSize) || left.name.localeCompare(right.name));
                  return <section key={scope.key}><header><span>BASE MATRIX</span><h3>{scope.label}</h3>{scope.key === "photocopy" ? <small>Photocopy output; Scan stays paper-free.</small> : <small>Uploaded documents sent to print.</small>}</header><div className="pricing-global-matrix" role="region" aria-label={`${scope.label} global price matrix`} tabIndex={0}><table><thead><tr><th>Material</th>{data.printTypes.map((type) => <th key={type.key}>{type.label}</th>)}</tr></thead><tbody>{materials.map((material) => <tr key={material.id}><th scope="row"><strong>{material.name}</strong><small>{material.paperSize}</small></th>{data.printTypes.map((type) => {
                    const rule = scopedRules.find((candidate) => candidate.inventoryItemId === material.id && candidate.printType === type.key);
                    return <td className={rule && !rule.isActive ? "is-inactive" : ""} key={type.key}>{rule ? <><strong>{formatCurrency(rule.pricePerPage)}</strong><small>{rule.isActive ? "per page" : "Inactive"}</small></> : "—"}</td>;
                  })}</tr>)}</tbody></table></div></section>;
                })}
              </div>
            ) : <p className="pricing-inline-empty">No global paper pricing has been configured.</p>}
          </Card>

          <Card className="pricing-product-card">
            <CardHeader title="Services and product pricing" meta={`${serviceGroups.length} services · ${rows.length} products`} />
            <div className="pricing-toolbar">
              <label><span>Find a product or service</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search pricing…" /></label>
              <label><span>Pricing source</span><select value={filter} onChange={(event) => setFilter(event.target.value as PriceFilter)}><option value="all">All pricing</option><option value="custom">Has custom pricing</option><option value="global">Uses global base</option><option value="missing">Needs attention</option></select></label>
            </div>

            {serviceGroups.length ? (
              <div className="pricing-service-table" role="region" aria-label="Services and product pricing" tabIndex={0}>
                <table>
                  <caption>Existing Printing Services entries with their per-product pricing</caption>
                  <thead><tr><th>Product</th><th>Process</th>{PAPER_SIZES.map((paperSize) => <th key={paperSize}>{paperSize}<small>per page</small></th>)}<th>Extras</th><th>Status</th><th aria-label="Open" /></tr></thead>
                  {serviceGroups.map(({ service, rows: serviceRows }) => {
                    return (
                      <tbody key={service.id}>
                        <tr className="pricing-service-table__group"><th colSpan={8} scope="rowgroup"><div><span><strong>{service.name}</strong><StatusPill label={workflowLabel(service)} tone={service.category === "custom" ? "neutral" : "info"} /></span><small>{serviceRows.length} {serviceRows.length === 1 ? "product" : "products"}</small><Link to={`/product-catalog/${service.id}`}>Open service</Link></div></th></tr>
                        {!serviceRows.length ? <tr><td className="pricing-service-table__empty" colSpan={8}>No products configured for this service.</td></tr> : serviceRows.map(({ product }) => (
                          <tr key={product.id}>
                            <th className="pricing-service-table__product" scope="row"><strong>{product.name}</strong>{product.description ? <small>{product.description}</small> : null}</th>
                            <td><span className="pricing-service-table__type"><strong>{product.operationKind === "scan" ? "Scan" : product.operationKind === "photocopy" ? "Photocopy" : "Print"}</strong><small>{product.printTypeLabel}</small></span></td>
                            {PAPER_SIZES.map((paperSize) => <PaperPriceCell product={product} paperSize={paperSize} rules={data.rules} key={paperSize} />)}
                            <td><AdditionalPricing product={product} /></td>
                            <td><StatusPill label={service.isActive && product.isActive ? "Active" : "Inactive"} tone={service.isActive && product.isActive ? "success" : "neutral"} /></td>
                            <td><Link className="pricing-row-link" to={`/product-catalog/${service.id}/products/${product.id}`} aria-label={`Open ${product.name}`}>Open</Link></td>
                          </tr>
                        ))}
                      </tbody>
                    );
                  })}
                </table>
              </div>
            ) : <EmptyState title="No pricing matches" description="Clear the search or choose another pricing source." />}
          </Card>

          <p className="pricing-footnote">Services do not carry a price themselves; they group products into workflows. Transaction pricing always resolves from the product values shown here.</p>
        </div>
      ) : null}
    </>
  );
}
