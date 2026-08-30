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
import type { Customer, DocumentPricingRule, InventoryItem, JobOrder, Product, ScanPricingTier, Service, SpoolerMonitorInfo } from "../types/domain";
import { JobServiceChooserModal } from "./jobOrders/JobServiceChooserModal";
import { TransactionCreateModal } from "./jobOrders/TransactionCreateModal";
import "./JobOrdersPage.css";

export function JobOrdersPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [chooserOpen, setChooserOpen] = useState(searchParams.get("create") === "1");
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const sourceSpoolerJobId = searchParams.get("spoolerJobId");
  const { data, state, error, reload } = useResource(async () => {
    const [orders, customers, products, inventoryItems, services, pricingRules, scanPricingTiers, spoolerMonitor] = await Promise.all([
      api.get<JobOrder[]>("/job-orders"),
      api.get<Customer[]>("/customers"),
      api.get<Product[]>("/products"),
      api.get<InventoryItem[]>("/inventory-items"),
      api.get<Service[]>("/services"),
      api.get<DocumentPricingRule[]>("/document-analyzer/pricing-rules"),
      api.get<ScanPricingTier[]>("/document-analyzer/scan-pricing-tiers"),
      api.get<SpoolerMonitorInfo>("/printers/spooler-jobs").catch(() => null),
    ]);
    return { orders, customers, products, inventoryItems, services, pricingRules, scanPricingTiers, spoolerMonitor };
  }, [sourceSpoolerJobId]);

  useEffect(() => {
    if (searchParams.get("create") === "1") setChooserOpen(true);
  }, [searchParams]);

  useEffect(() => {
    if (!sourceSpoolerJobId || !data || selectedService) return;
    const printingService = data.services.find((service) => service.isActive && service.category === "printing" && service.productCount > 0);
    if (printingService) {
      setChooserOpen(false);
      setSelectedService(printingService);
    }
  }, [data, selectedService, sourceSpoolerJobId]);

  function closeCreate() {
    setChooserOpen(false);
    setSelectedService(null);
    if (searchParams.has("create") || searchParams.has("spoolerJobId")) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete("create");
      nextParams.delete("spoolerJobId");
      setSearchParams(nextParams, { replace: true });
    }
  }

  const columns: DataTableColumn<JobOrder>[] = [
    { key: "name", header: "Job", render: (r) => <span className="job-order-identity"><strong>{r.name}</strong><small className="numeric">{r.number}</small></span>, width: "16rem" },
    { key: "customer", header: "Customer", render: (r) => r.customerName || "Walk-in" },
    {
      key: "status",
      header: "Status",
      render: (r) => <StatusPill label={jobOrderStatusMeta[r.status].label} tone={jobOrderStatusMeta[r.status].tone} />,
    },
    {
      key: "reprocess",
      header: "Reprocess",
      render: (r) => {
        const count = r.items.reduce((sum, item) => sum + item.reprocessCount, 0);
        return count ? <StatusPill label={`${count} ${count === 1 ? "cycle" : "cycles"}`} tone="warning" /> : <span className="job-order-no-reprocess">—</span>;
      },
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
        eyebrow="PRINTING JOB ORDERS"
        title="Printing Job Orders"
        description="Create, plan, and audit every customer order from one production record."
        actions={<Button variant="primary" onClick={() => setChooserOpen(true)}>New job order</Button>}
      />

      {state === "loading" && <LoadingState label="Loading job orders…" />}
      {state === "error" && <ErrorState description={error ?? undefined} onRetry={reload} />}

      {state === "ready" && data && data.orders.length === 0 && (
        <EmptyState
          title="No job orders yet"
          description="Create the first order, choose its products, and plan the materials the work will use."
          action={<Button variant="primary" onClick={() => setChooserOpen(true)}>New job order</Button>}
        />
      )}

      {state === "ready" && data && data.orders.length > 0 && (
        <DataTable columns={columns} rows={data.orders} onRowClick={(row) => navigate(`/job-orders/${row.id}`)} />
      )}

      {data && (
        <>
          <JobServiceChooserModal
            open={chooserOpen}
            services={data.services}
            onClose={closeCreate}
            onSelect={(service) => { setChooserOpen(false); setSelectedService(service); }}
          />
          {selectedService ? (
            <TransactionCreateModal
              open
              initialService={selectedService}
              services={data.services}
              customers={data.customers}
              products={data.products}
              inventoryItems={data.inventoryItems}
              pricingRules={data.pricingRules}
              scanPricingTiers={data.scanPricingTiers}
              sourceSpoolerJobId={sourceSpoolerJobId}
              onClose={closeCreate}
              onCreated={(order) => {
                closeCreate();
                reload();
                navigate(`/job-orders/${encodeURIComponent(order.id)}`);
              }}
            />
          ) : null}
        </>
      )}
    </>
  );
}
