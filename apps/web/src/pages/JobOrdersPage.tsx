import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "../components/Button/Button";
import { PageHeader } from "../components/PageHeader/PageHeader";
import { DataTable, DataTableColumn } from "../components/DataTable/DataTable";
import { StatusPill } from "../components/StatusPill/StatusPill";
import { EmptyState } from "../components/EmptyState/EmptyState";
import { LoadingState } from "../components/LoadingState/LoadingState";
import { ErrorState } from "../components/ErrorState/ErrorState";
import { useResource } from "../hooks/useResource";
import { api } from "../lib/apiClient";
import { formatCurrency, formatDate } from "../lib/format";
import { jobOrderStatusMeta } from "../types/statusMeta";
import type { Customer, InventoryItem, JobOrder, Product } from "../types/domain";
import { JobOrderCreateModal } from "./jobOrders/JobOrderCreateModal";

export function JobOrdersPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [createOpen, setCreateOpen] = useState(searchParams.get("create") === "1");
  const { data, state, error, reload } = useResource(async () => {
    const [orders, customers, products, inventoryItems] = await Promise.all([
      api.get<JobOrder[]>("/job-orders"),
      api.get<Customer[]>("/customers"),
      api.get<Product[]>("/products"),
      api.get<InventoryItem[]>("/inventory-items"),
    ]);
    return { orders, customers, products, inventoryItems };
  });

  useEffect(() => {
    if (searchParams.get("create") === "1") setCreateOpen(true);
  }, [searchParams]);

  function closeCreate() {
    setCreateOpen(false);
    if (searchParams.has("create")) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete("create");
      setSearchParams(nextParams, { replace: true });
    }
  }

  const columns: DataTableColumn<JobOrder>[] = [
    { key: "number", header: "Order #", render: (r) => r.number, width: "10rem" },
    { key: "customer", header: "Customer", render: (r) => r.customerName || "Walk-in" },
    {
      key: "status",
      header: "Status",
      render: (r) => <StatusPill label={jobOrderStatusMeta[r.status].label} tone={jobOrderStatusMeta[r.status].tone} />,
    },
    { key: "total", header: "Total", numeric: true, align: "right", render: (r) => formatCurrency(r.total) },
    {
      key: "paid",
      header: "Paid",
      numeric: true,
      align: "right",
      render: (r) => formatCurrency(r.amountPaid),
    },
    { key: "due", header: "Due", render: (r) => formatDate(r.dueDate) },
  ];

  return (
    <>
      <PageHeader
        eyebrow="JOB ORDERS"
        title="Job Orders"
        description="Create, plan, and audit every customer order from one production record."
        actions={<Button variant="primary" onClick={() => setCreateOpen(true)}>New job order</Button>}
      />

      {state === "loading" && <LoadingState label="Loading job orders…" />}
      {state === "error" && <ErrorState description={error ?? undefined} onRetry={reload} />}

      {state === "ready" && data && data.orders.length === 0 && (
        <EmptyState
          title="No job orders yet"
          description="Create the first order, choose its products, and plan the materials the work will use."
          action={<Button variant="primary" onClick={() => setCreateOpen(true)}>New job order</Button>}
        />
      )}

      {state === "ready" && data && data.orders.length > 0 && (
        <DataTable columns={columns} rows={data.orders} onRowClick={(row) => navigate(`/job-orders/${row.id}`)} />
      )}

      {data && (
        <JobOrderCreateModal
          open={createOpen}
          customers={data.customers}
          products={data.products}
          inventoryItems={data.inventoryItems}
          onClose={closeCreate}
          onCreated={(order) => {
            setCreateOpen(false);
            reload();
            navigate(`/job-orders/${encodeURIComponent(order.id)}`);
          }}
        />
      )}
    </>
  );
}
