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
import { api } from "../../lib/apiClient";
import { formatCurrency, formatProductPrintType } from "../../lib/format";
import type { DocumentPricingRule, InventoryItem, PrintTypeDefinition, Product, Service, Variant } from "../../types/domain";
import { ProductCreateModal } from "./ProductCreateModal";
import "./ServiceWorkspace.css";

interface WorkspaceData {
  service: Service;
  products: Product[];
  inventoryItems: InventoryItem[];
  variants: Variant[];
  pricingRules: DocumentPricingRule[];
  printTypes: PrintTypeDefinition[];
}

export function ServiceWorkspace() {
  const navigate = useNavigate();
  const { serviceId } = useParams<{ serviceId: string }>();
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createdProducts, setCreatedProducts] = useState<Product[]>([]);
  const { data, state, error, reload } = useResource<WorkspaceData>(
    async () => {
      if (!serviceId) throw new Error("Service not found.");

      const [service, products, inventoryItems, variants, pricingRules, printTypes] = await Promise.all([
        api.get<Service>(`/services/${serviceId}`),
        api.get<Product[]>(`/products?service_id=${encodeURIComponent(serviceId)}`),
        api.get<InventoryItem[]>("/inventory-items"),
        api.get<Variant[]>("/variants"),
        api.get<DocumentPricingRule[]>("/document-analyzer/pricing-rules"),
        api.get<PrintTypeDefinition[]>("/print-types"),
      ]);

      return { service, products, inventoryItems, variants, pricingRules, printTypes };
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
              label={`${service.category === "printing" ? "Printing" : service.category === "photocopy" ? "Photocopy" : "Custom"} · ${service.isActive ? "Active" : "Inactive"}`}
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

      <ProductCreateModal
        open={createModalOpen}
        service={service}
        inventoryItems={data.inventoryItems}
        variants={data.variants}
        pricingRules={data.pricingRules}
        printTypes={data.printTypes}
        onClose={() => setCreateModalOpen(false)}
        onCreated={(product) => {
          setCreatedProducts((current) => [...current, product]);
          setCreateModalOpen(false);
        }}
      />
    </>
  );
}
