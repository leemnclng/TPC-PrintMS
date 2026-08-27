import { useNavigate } from "react-router-dom";
import { PageHeader } from "../components/PageHeader/PageHeader";
import { DataTable, DataTableColumn } from "../components/DataTable/DataTable";
import { StatusPill } from "../components/StatusPill/StatusPill";
import { EmptyState } from "../components/EmptyState/EmptyState";
import { LoadingState } from "../components/LoadingState/LoadingState";
import { ErrorState } from "../components/ErrorState/ErrorState";
import { PlannedNotice } from "../components/PlannedNotice/PlannedNotice";
import { useResource } from "../hooks/useResource";
import { api } from "../lib/apiClient";
import { formatCurrency, formatDate } from "../lib/format";
import { quotationStatusMeta } from "../types/statusMeta";
import type { Quotation } from "../types/domain";

export function QuotationsPage() {
  const navigate = useNavigate();
  const { data, state, error, reload } = useResource(() => api.get<Quotation[]>("/quotations"));

  const columns: DataTableColumn<Quotation>[] = [
    { key: "number", header: "Quote #", render: (r) => r.number, width: "10rem" },
    { key: "customer", header: "Customer", render: (r) => r.customerName },
    {
      key: "status",
      header: "Status",
      render: (r) => <StatusPill label={quotationStatusMeta[r.status].label} tone={quotationStatusMeta[r.status].tone} />,
    },
    { key: "items", header: "Items", numeric: true, align: "right", render: (r) => r.items.length },
    { key: "total", header: "Total", numeric: true, align: "right", render: (r) => formatCurrency(r.total) },
    { key: "updated", header: "Updated", render: (r) => formatDate(r.updatedAt) },
  ];

  return (
    <>
      <PageHeader
        eyebrow="QUOTATIONS"
        title="Quotations"
        description="AI may suggest line items from customer requirements, but every quotation still needs the owner's review and approval before it goes out."
        actions={<PlannedNotice phase="Phase 3 — Commercial Workflow" />}
      />

      {state === "loading" && <LoadingState label="Loading quotations…" />}
      {state === "error" && <ErrorState description={error ?? undefined} onRetry={reload} />}

      {state === "ready" && data && data.length === 0 && (
        <EmptyState
          title="No quotations yet"
          description="Quotation drafting and AI-assisted line items are a later phase — see docs/context/build-plan.md."
        />
      )}

      {state === "ready" && data && data.length > 0 && (
        <DataTable columns={columns} rows={data} onRowClick={(row) => navigate(`/quotations/${row.id}`)} />
      )}
    </>
  );
}
