import { useParams } from "react-router-dom";
import { PageHeader } from "../../components/PageHeader/PageHeader";
import { Card, CardHeader } from "../../components/Card/Card";
import { DataTable, DataTableColumn } from "../../components/DataTable/DataTable";
import { StatusPill } from "../../components/StatusPill/StatusPill";
import { EmptyState } from "../../components/EmptyState/EmptyState";
import { LoadingState } from "../../components/LoadingState/LoadingState";
import { ErrorState } from "../../components/ErrorState/ErrorState";
import { PlannedNotice } from "../../components/PlannedNotice/PlannedNotice";
import { useResource } from "../../hooks/useResource";
import { api } from "../../lib/apiClient";
import { formatCurrency } from "../../lib/format";
import { quotationStatusMeta } from "../../types/statusMeta";
import type { Quotation, QuotationItem } from "../../types/domain";
import "./Workspace.css";

export function QuotationWorkspace() {
  const { quotationId } = useParams();
  const { data, state, error } = useResource(() => api.get<Quotation>(`/quotations/${quotationId}`), [quotationId]);

  if (state === "loading") return <LoadingState label="Loading quotation…" />;
  if (state === "error") return <ErrorState description={error ?? undefined} />;
  if (!data) return <EmptyState title="Quotation not found" description="It may have been removed." />;

  const columns: DataTableColumn<QuotationItem>[] = [
    { key: "product", header: "Product", render: (r) => r.productName },
    { key: "variant", header: "Variant", render: (r) => r.variantLabel ?? "—" },
    { key: "qty", header: "Qty", numeric: true, align: "right", render: (r) => r.quantity },
    { key: "unit", header: "Unit price", numeric: true, align: "right", render: (r) => formatCurrency(r.unitPrice) },
    {
      key: "source",
      header: "Source",
      render: (r) => (r.aiSuggested ? <StatusPill label="AI suggested" tone="info" /> : "Owner entered"),
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="QUOTATIONS"
        title={data.number}
        description={`For ${data.customerName}`}
        actions={<StatusPill label={quotationStatusMeta[data.status].label} tone={quotationStatusMeta[data.status].tone} />}
      />

      <Card>
        <CardHeader title="Line items" meta={formatCurrency(data.total)} />
        {data.items.length === 0 ? (
          <EmptyState title="No line items" description="Items will list here once added." />
        ) : (
          <DataTable columns={columns} rows={data.items} />
        )}
      </Card>

      <div className="workspace-grid">
        <Card>
          <CardHeader title="Owner review" />
          <EmptyState
            title="Approve / revise / send actions are planned"
            description="AI suggestions must be reviewed and confirmed by the owner before a quotation is sent."
          />
          <PlannedNotice phase="Phase 3 — Commercial Workflow" />
        </Card>
        <Card>
          <CardHeader title="Revision history" />
          <EmptyState title="No revisions yet" />
        </Card>
      </div>
    </>
  );
}
