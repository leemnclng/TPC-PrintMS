import { useNavigate } from "react-router-dom";
import { PageHeader } from "../components/PageHeader/PageHeader";
import { DataTable, DataTableColumn } from "../components/DataTable/DataTable";
import { StatusPill } from "../components/StatusPill/StatusPill";
import { LinkButton } from "../components/Button/LinkButton";
import { EmptyState } from "../components/EmptyState/EmptyState";
import { LoadingState } from "../components/LoadingState/LoadingState";
import { ErrorState } from "../components/ErrorState/ErrorState";
import { useResource } from "../hooks/useResource";
import { api } from "../lib/apiClient";
import type { Service } from "../types/domain";
import "./ProductCatalogPage.css";

export function ProductCatalogPage() {
  const navigate = useNavigate();
  const { data, state, error, reload } = useResource(() => api.get<Service[]>("/services"));

  const columns: DataTableColumn<Service>[] = [
    {
      key: "name",
      header: "Service",
      render: (r) => (
        <div className="service-index__identity">
          <strong>{r.name}</strong>
          {r.description && <span>{r.description}</span>}
        </div>
      ),
    },
    { key: "category", header: "Workflow", render: (r) => <StatusPill label={r.category === "printing" ? "Printing" : r.category === "photocopy" ? "Photocopy" : "Custom"} tone={r.category === "custom" ? "neutral" : "info"} /> },
    { key: "products", header: "Products", numeric: true, align: "right", render: (r) => r.productCount },
    {
      key: "status",
      header: "Status",
      render: (r) => <StatusPill label={r.isActive ? "Active" : "Inactive"} tone={r.isActive ? "success" : "neutral"} />,
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="SERVICES"
        title="Service Catalog"
        description="Create a service first, then organize the products used in job orders and document analysis inside it."
        actions={
          <>
            <LinkButton variant="secondary" to="/configuration/variants">
              Global variants
            </LinkButton>
            <LinkButton variant="primary" to="/product-catalog/new">
              New service
            </LinkButton>
          </>
        }
      />

      {state === "loading" && <LoadingState label="Loading services…" />}
      {state === "error" && <ErrorState description={error ?? undefined} onRetry={reload} />}

      {state === "ready" && data && data.length === 0 && (
        <EmptyState
          title="No services yet"
          description="Create a service, then add the products you offer inside it."
          action={
            <LinkButton variant="secondary" to="/product-catalog/new">
              New service
            </LinkButton>
          }
        />
      )}

      {state === "ready" && data && data.length > 0 && (
        <div className="service-index">
          <DataTable columns={columns} rows={data} onRowClick={(row) => navigate(`/product-catalog/${row.id}`)} />
        </div>
      )}
    </>
  );
}
