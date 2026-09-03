import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "../../components/Button/Button";
import { LinkButton } from "../../components/Button/LinkButton";
import { DataTable } from "../../components/DataTable/DataTable";
import { EmptyState } from "../../components/EmptyState/EmptyState";
import { ErrorState } from "../../components/ErrorState/ErrorState";
import { LoadingState } from "../../components/LoadingState/LoadingState";
import { PageHeader } from "../../components/PageHeader/PageHeader";
import { StatusPill } from "../../components/StatusPill/StatusPill";
import { useResource } from "../../hooks/useResource";
import { api, ApiError } from "../../lib/apiClient";
import { formatCurrency, formatProductPrintType } from "../../lib/format";
import type { DeletedProduct, DocumentPricingRule, InventoryItem, PricingCategory, PrintTypeDefinition, Product, ScanPricingTier, Service, Variant } from "../../types/domain";
import { ProductCreateModal } from "./ProductCreateModal";
import "./ServiceWorkspace.css";

interface WorkspaceData {
  service: Service;
  products: Product[];
  deletedProducts: DeletedProduct[];
  inventoryItems: InventoryItem[];
  variants: Variant[];
  pricingRules: DocumentPricingRule[];
  scanPricingTiers: ScanPricingTier[];
  printTypes: PrintTypeDefinition[];
  pricingCategories: PricingCategory[];
}

export function ServiceWorkspace() {
  const navigate = useNavigate();
  const { serviceId } = useParams<{ serviceId: string; }>();
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createdProducts, setCreatedProducts] = useState<Product[]>([]);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const { data, state, error, reload } = useResource<WorkspaceData>(
    async () => {
      if (!serviceId) throw new Error("Service not found.");

      const [service, products, deletedProducts, inventoryItems, variants, pricingRules, scanPricingTiers, printTypes, pricingCategories] = await Promise.all([
        api.get<Service>(`/services/${serviceId}`),
        api.get<Product[]>(`/products?service_id=${encodeURIComponent(serviceId)}`),
        api.get<DeletedProduct[]>(`/products/deleted?service_id=${encodeURIComponent(serviceId)}`),
        api.get<InventoryItem[]>("/inventory-items"),
        api.get<Variant[]>("/variants"),
        api.get<DocumentPricingRule[]>("/document-analyzer/pricing-rules"),
        api.get<ScanPricingTier[]>("/document-analyzer/scan-pricing-tiers"),
        api.get<PrintTypeDefinition[]>("/print-types"),
        api.get<PricingCategory[]>("/document-analyzer/pricing-categories"),
      ]);

      return { service, products, deletedProducts, inventoryItems, variants, pricingRules, scanPricingTiers, printTypes, pricingCategories };
    },
    [serviceId],
  );

  useEffect(() => {
    setCreatedProducts([]);
    setCreateModalOpen(false);
  }, [serviceId]);

  if (state === "loading") return <LoadingState label="Loading service products..." />;
  if (state === "error" || !data) {
    return <ErrorState description={error ?? "Service not found."} onRetry={reload} />;
  }

  const { service } = data;
  const products = [...data.products, ...createdProducts]
    .filter((product, index, collection) => collection.findIndex((item) => item.id === product.id) === index)
    .sort((left, right) => left.name.localeCompare(right.name));
  const productCount = `${products.length} ${products.length === 1 ? "product" : "products"}`;

  async function restoreProduct(product: DeletedProduct) {
    setRestoringId(product.id);
    setRestoreError(null);
    try {
      await api.post<Product>(`/products/${product.id}/restore`);
      reload();
    } catch (err) {
      setRestoreError(err instanceof ApiError ? err.message : `Couldn't restore ${product.name}.`);
    } finally {
      setRestoringId(null);
    }
  }

  function formatPurgeDate(value: string) {
    const utcValue = /(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? value : `${value}Z`;
    return new Intl.DateTimeFormat("en-PH", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(utcValue));
  }

  return (
    <>
      <PageHeader
        eyebrow="Services"
        title={service.name}
        description={service.description || "Products available under this service."}
        actions={
          <>
            <LinkButton variant="secondary" to={`/product-catalog/${service.id}/settings`}>
              Settings
            </LinkButton>
            <Button type="button" variant="primary" onClick={() => setCreateModalOpen(true)}>
              New product
            </Button>
          </>
        }
      />

      <section className="service-workspace__products" aria-labelledby="service-products-title">
        <div className="service-workspace__section-header">
          <div className="service-workspace__section-title">
            <h2 id="service-products-title">Products</h2>
            <StatusPill
              label={`${service.category === "printing" ? "Printing" : service.category === "photocopy" ? "Scan or Photocopy" : "Custom"} · ${service.isActive ? "Active" : "Inactive"}`}
              tone={service.isActive ? "success" : "neutral"}
            />
          </div>
          <span className="service-workspace__count">{productCount}</span>
        </div>

        {products.length === 0 ? (
          <EmptyState
            title="No products in this service"
            description="Add the first product customers can order under this service."
            action={
              <Button type="button" variant="secondary" onClick={() => setCreateModalOpen(true)}>
                New product
              </Button>
            }
          />
        ) : (
          <DataTable
            columns={[
              { key: "name", header: "Product", render: (product) => product.name },
              {
                key: "operation",
                header: "Operation",
                render: (product) => product.operationKind === "scan" ? "Scan" : product.operationKind === "photocopy" ? "Photocopy" : "Printing",
              },
              {
                key: "printType",
                header: "Print type",
                render: (product) => product.printTypeLabel || formatProductPrintType(product.printType),
              },
              {
                key: "variants",
                header: "Variants",
                render: (product) =>
                  product.variants.length > 0
                    ? product.variants.map((variant) => variant.label).join(", ")
                    : "No variants",
              },
              {
                key: "price",
                header: "Price / page",
                align: "right",
                render: (product) => formatCurrency(product.pricePerPage),
              },
              {
                key: "status",
                header: "Status",
                render: (product) => (
                  <StatusPill
                    label={product.isActive ? "Active" : "Inactive"}
                    tone={product.isActive ? "success" : "neutral"}
                  />
                ),
              },
            ]}
            rows={products}
            onRowClick={(product) => navigate(`/product-catalog/${service.id}/products/${product.id}`)}
          />
        )}
      </section>

      {data.deletedProducts.length > 0 ? (
        <section className="service-workspace__recycle-bin" aria-labelledby="service-recycle-bin-title">
          <div>
            <span className="service-workspace__recycle-label">Recently deleted</span>
            <h2 id="service-recycle-bin-title">Restore within 5 days</h2>
            <p>These products are hidden from the catalog and new transactions.</p>
          </div>
          <div className="service-workspace__deleted-list">
            {data.deletedProducts.map((product) => (
              <div className="service-workspace__deleted-product" key={product.id}>
                <div>
                  <strong>{product.name}</strong>
                  <span>Permanent after {formatPurgeDate(product.purgeAfter)}</span>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  loading={restoringId === product.id}
                  disabled={restoringId !== null && restoringId !== product.id}
                  onClick={() => restoreProduct(product)}
                >
                  Undo delete
                </Button>
              </div>
            ))}
            {restoreError ? <p className="service-workspace__restore-error" role="alert">{restoreError}</p> : null}
          </div>
        </section>
      ) : null}

      <ProductCreateModal
        open={createModalOpen}
        service={service}
        inventoryItems={data.inventoryItems}
        variants={data.variants}
        pricingRules={data.pricingRules}
        scanPricingTiers={data.scanPricingTiers}
        printTypes={data.printTypes}
        pricingCategories={data.pricingCategories}
        onClose={() => setCreateModalOpen(false)}
        onCreated={(product) => {
          setCreatedProducts((current) => [...current, product]);
          setCreateModalOpen(false);
        }}
      />
    </>
  );
}
