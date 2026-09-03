import { useEffect, useMemo, useState } from "react";
import { Button } from "../components/Button/Button";
import { EmptyState } from "../components/EmptyState/EmptyState";
import { ErrorState } from "../components/ErrorState/ErrorState";
import { LoadingState } from "../components/LoadingState/LoadingState";
import { StatusPill } from "../components/StatusPill/StatusPill";
import { useResource } from "../hooks/useResource";
import { api } from "../lib/apiClient";
import { formatCurrency } from "../lib/format";
import { resolveProductPricePoints } from "../lib/pricingView";
import type { ProductPricePoint } from "../lib/pricingView";
import type { DocumentPricingRule, Product, ScanPricingTier, Service } from "../types/domain";
import "./PricingOverviewWindow.css";

function operationLabel(product: Product): string {
  if (product.operationKind === "scan") return "Scan";
  if (product.operationKind === "photocopy") return "Photocopy";
  if (product.operationKind === "adhoc") return "Ad Hoc";
  return "Printing";
}

function workflowLabel(service: Service): string {
  if (service.category === "printing") return "Printing";
  if (service.category === "photocopy") return "Scan or Photocopy";
  return "Custom";
}

function rateLabel(product: Product, label: string): string {
  if (product.operationKind === "scan") return label;
  return `${label} · ${product.operationKind === "adhoc" ? "per unit" : "per page"}`;
}

function overviewPricePoints(product: Product, rules: DocumentPricingRule[], scanTiers: ScanPricingTier[]): ProductPricePoint[] {
  if (product.operationKind !== "scan" || product.standalonePricePerPage != null) {
    return resolveProductPricePoints(product, rules, scanTiers);
  }
  return scanTiers
    .filter((tier) => tier.isActive)
    .sort((left, right) => left.minPages - right.minPages)
    .map((tier) => ({
      key: tier.id,
      label: tier.maxPages === null
        ? `${tier.minPages}+ scanned pages`
        : tier.minPages === tier.maxPages
          ? `${tier.minPages} scanned ${tier.minPages === 1 ? "page" : "pages"}`
          : `${tier.minPages}–${tier.maxPages} scanned pages`,
      amount: tier.pricePerPage,
      custom: false,
    }));
}

export function PricingOverviewWindow() {
  const [query, setQuery] = useState("");
  const [serviceId, setServiceId] = useState("all");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState(() => new Date());
  const { data, state, error, reload } = useResource(async () => {
    const [products, services, rules, scanTiers] = await Promise.all([
      api.get<Product[]>("/products"),
      api.get<Service[]>("/services"),
      api.get<DocumentPricingRule[]>("/document-analyzer/pricing-rules"),
      api.get<ScanPricingTier[]>("/document-analyzer/scan-pricing-tiers"),
    ]);
    setRefreshedAt(new Date());
    return { products, services, rules, scanTiers };
  });

  useEffect(() => {
    document.title = "Price Overview — Printing-MS";
  }, []);

  const visibleProducts = useMemo(() => {
    if (!data) return [];
    const normalizedQuery = query.trim().toLowerCase();
    return data.products.filter((product) => {
      const service = data.services.find((candidate) => candidate.id === product.serviceId);
      const active = product.isActive && Boolean(service?.isActive);
      return (includeInactive || active)
        && (serviceId === "all" || product.serviceId === serviceId)
        && (!normalizedQuery || `${product.name} ${product.serviceName} ${product.printTypeLabel} ${operationLabel(product)}`.toLowerCase().includes(normalizedQuery));
    });
  }, [data, includeInactive, query, serviceId]);

  const serviceGroups = useMemo(() => {
    if (!data) return [];
    return data.services
      .map((service) => ({ service, products: visibleProducts.filter((product) => product.serviceId === service.id) }))
      .filter(({ products }) => products.length > 0);
  }, [data, visibleProducts]);

  const configuredCount = data?.products.filter((product) => overviewPricePoints(product, data.rules, data.scanTiers).length > 0).length ?? 0;

  return (
    <main className="price-book">
      <header className="price-book__masthead">
        <div>
          <span className="numeric">THE PAPER CLUB / LIVE REFERENCE</span>
          <h1>Product price overview</h1>
          <p>Effective customer-facing rates across every configured service and product.</p>
        </div>
        <div className="price-book__window-actions">
          <Button type="button" variant="secondary" size="sm" onClick={reload}>Refresh</Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => window.close()}>Close window</Button>
        </div>
      </header>

      {state === "loading" ? <LoadingState label="Preparing the current price book…" /> : null}
      {state === "error" ? <ErrorState title="The price book could not be loaded" description={error ?? undefined} onRetry={reload} /> : null}
      {state === "ready" && data ? (
        <>
          <section className="price-book__summary" aria-label="Price book summary">
            <div><span>Visible products</span><strong className="numeric">{visibleProducts.length}</strong></div>
            <div><span>Services</span><strong className="numeric">{data.services.length}</strong></div>
            <div><span>Priced products</span><strong className="numeric">{configuredCount}/{data.products.length}</strong></div>
            <small>Updated {refreshedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small>
          </section>

          <section className="price-book__toolbar" aria-label="Filter product pricing">
            <label><span>Find a product or rate</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search product, service, or output…" autoFocus /></label>
            <label><span>Service</span><select value={serviceId} onChange={(event) => setServiceId(event.target.value)}><option value="all">All services</option>{data.services.map((service) => <option value={service.id} key={service.id}>{service.name}</option>)}</select></label>
            <label className="price-book__toggle"><input type="checkbox" checked={includeInactive} onChange={(event) => setIncludeInactive(event.target.checked)} /><span>Include inactive</span></label>
          </section>

          {serviceGroups.length ? (
            <div className="price-book__services">
              {serviceGroups.map(({ service, products }) => (
                <section className="price-book__service" key={service.id}>
                  <header>
                    <div><span className="numeric">SERVICE</span><h2>{service.name}</h2></div>
                    <StatusPill label={workflowLabel(service)} tone={service.category === "custom" ? "neutral" : "info"} />
                    <small>{products.length} {products.length === 1 ? "product" : "products"}</small>
                  </header>
                  <div className="price-book__table" role="region" aria-label={`${service.name} prices`} tabIndex={0}>
                    <table>
                      <thead><tr><th>Product</th><th>Output</th><th>Effective rates</th><th>Adjustments</th><th>Status</th></tr></thead>
                      <tbody>{products.map((product) => {
                        const points = overviewPricePoints(product, data.rules, data.scanTiers);
                        return (
                          <tr key={product.id}>
                            <th scope="row"><strong>{product.name}</strong>{product.description ? <small>{product.description}</small> : null}</th>
                            <td><strong>{operationLabel(product)}</strong><small>{product.printTypeLabel}</small></td>
                            <td>{points.length ? <div className="price-book__rates">{points.map((point) => <span key={point.key}><strong>{formatCurrency(point.amount)}</strong><small>{rateLabel(product, point.label)}</small>{point.custom ? <b>Product rate</b> : null}</span>)}</div> : <span className="price-book__missing">Rate not configured</span>}</td>
                            <td>{product.variants.length ? <div className="price-book__adjustments">{product.variants.map((variant) => <span key={variant.id}><strong>{variant.label}</strong><small>{variant.priceAdjustment >= 0 ? "+" : ""}{formatCurrency(variant.priceAdjustment)} / page</small></span>)}</div> : <span className="price-book__muted">No adjustments</span>}</td>
                            <td><StatusPill label={service.isActive && product.isActive ? "Active" : "Inactive"} tone={service.isActive && product.isActive ? "success" : "neutral"} /></td>
                          </tr>
                        );
                      })}</tbody>
                    </table>
                  </div>
                </section>
              ))}
            </div>
          ) : <EmptyState title="No products match" description="Clear the search or select another service." />}

          <footer className="price-book__footer">
            <p>Read-only reference · Prices reflect the current product override or its configured global rate.</p>
          </footer>
        </>
      ) : null}
    </main>
  );
}
