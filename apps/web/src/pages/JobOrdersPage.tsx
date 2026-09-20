import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "../components/Button/Button";
import { PageHeader } from "../components/PageHeader/PageHeader";
import { DataTable, DataTableColumn } from "../components/DataTable/DataTable";
import { DateRangeFilter } from "../components/DataTable/DateRangeFilter";
import { StatusPill } from "../components/StatusPill/StatusPill";
import { EmptyState } from "../components/EmptyState/EmptyState";
import { LoadingState } from "../components/LoadingState/LoadingState";
import { ErrorState } from "../components/ErrorState/ErrorState";
import { Pagination } from "../components/Pagination/Pagination";
import { useResource } from "../hooks/useResource";
import { usePaginatedResource } from "../hooks/usePaginatedResource";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { api } from "../lib/apiClient";
import { formatCurrency, formatDate } from "../lib/format";
import { jobOrderStatusMeta } from "../types/statusMeta";
import type { Customer, DocumentPricingRule, InventoryItem, JobOrder, PaginatedResponse, Product, ScanPricingTier, Service, SpoolerMonitorInfo } from "../types/domain";
import { JobServiceChooserModal } from "./jobOrders/JobServiceChooserModal";
import { TransactionCreateModal } from "./jobOrders/TransactionCreateModal";
import "./JobOrdersPage.css";

// Backend timestamps without an offset are stored in UTC.
function createdDate(value: string) {
  return new Date(/[zZ]|[+-]\d{2}:\d{2}$/.test(value) ? value : `${value}Z`);
}

export function JobOrdersPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [chooserOpen, setChooserOpen] = useState(searchParams.get("create") === "1");
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [reprocess, setReprocess] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [sort, setSort] = useState("newest");
  const sourceSpoolerJobId = searchParams.get("spoolerJobId");
  const attachSpoolerJobId = searchParams.get("attachSpoolerJobId");
  const attaching = Boolean(attachSpoolerJobId);
  const { data: supportData, state: supportState, error: supportError, reload: reloadSupport } = useResource(async () => {
    const [customers, products, inventoryItems, services, pricingRules, scanPricingTiers, spoolerMonitor] = await Promise.all([
      api.get<Customer[]>("/customers"),
      api.get<Product[]>("/products"),
      api.get<InventoryItem[]>("/inventory-items"),
      api.get<Service[]>("/services"),
      api.get<DocumentPricingRule[]>("/document-analyzer/pricing-rules"),
      api.get<ScanPricingTier[]>("/document-analyzer/scan-pricing-tiers"),
      api.get<SpoolerMonitorInfo>("/printers/spooler-jobs").catch(() => null),
    ]);
    return { customers, products, inventoryItems, services, pricingRules, scanPricingTiers, spoolerMonitor };
  }, [sourceSpoolerJobId]);
  const debouncedQuery = useDebouncedValue(query);
  const invalidInterval = Boolean(fromDate && toDate && fromDate > toDate);
  const orderQueryKey = JSON.stringify({ debouncedQuery, status, reprocess, fromDate, toDate, sort, attaching });
  const {
    data: orderPage,
    state: orderState,
    error: orderError,
    reload: reloadOrders,
    setPage,
    setPageSize,
    pageLoading,
  } = usePaginatedResource<JobOrder>(async (targetPage, targetPageSize) => {
    const params = new URLSearchParams({
      page: String(targetPage),
      page_size: String(targetPageSize),
      search: debouncedQuery,
      status,
      reprocess,
      sort,
      attachable_only: String(attaching),
    });
    if (fromDate) params.set("created_from", new Date(`${fromDate}T00:00:00`).toISOString());
    if (toDate) {
      const exclusive = new Date(`${toDate}T00:00:00`);
      exclusive.setDate(exclusive.getDate() + 1);
      params.set("created_to", exclusive.toISOString());
    }
    return api.get<PaginatedResponse<JobOrder>>(`/job-orders/page?${params}`);
  }, orderQueryKey);
  const orders = orderPage?.items ?? [];
  const ready = supportState === "ready" && orderState === "ready";

  useEffect(() => {
    if (searchParams.get("create") === "1") setChooserOpen(true);
  }, [searchParams]);

  useEffect(() => {
    if (!sourceSpoolerJobId || !supportData || selectedService) return;
    const printingService = supportData.services.find((service) => service.isActive && service.category === "printing" && service.productCount > 0);
    if (printingService) {
      setChooserOpen(false);
      setSelectedService(printingService);
    }
  }, [supportData, selectedService, sourceSpoolerJobId]);

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

  function cancelAttach() {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("attachSpoolerJobId");
    setSearchParams(nextParams, { replace: true });
  }

  function createInsteadOfAttach() {
    if (!attachSpoolerJobId) return;
    navigate(`/job-orders?create=1&spoolerJobId=${encodeURIComponent(attachSpoolerJobId)}`, { replace: true });
  }

  function clearFilters() {
    setQuery(""); setStatus(""); setReprocess(""); setFromDate(""); setToDate(""); setSort("newest");
  }

  const columns: DataTableColumn<JobOrder>[] = [
    { key: "name", header: "Job", render: (r) => <span className="job-order-identity"><strong>{r.name}</strong><small className="numeric">{r.number}</small></span>, width: "16rem" },
    { key: "created", header: "Date created", render: (r) => <time dateTime={createdDate(r.createdAt).toISOString()}>{formatDate(createdDate(r.createdAt).toISOString())}</time> },
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

  for (const column of columns) {
    if (column.key === "name") column.filter = <input type="search" aria-label="Search job, customer or product" placeholder="Search orders…" value={query} onChange={(event) => setQuery(event.target.value)} />;
    if (column.key === "created") column.filter = <DateRangeFilter from={fromDate} through={toDate} invalid={invalidInterval} onFromChange={setFromDate} onThroughChange={setToDate} />;
    if (column.key === "status") column.filter = <select aria-label="Filter status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">All statuses</option>{Object.entries(jobOrderStatusMeta).filter(([key]) => !attaching || ["queued", "printing", "ready"].includes(key)).map(([key, meta]) => <option key={key} value={key}>{meta.label}</option>)}</select>;
    if (column.key === "reprocess") column.filter = <select aria-label="Filter reprocess" value={reprocess} onChange={(event) => setReprocess(event.target.value)}><option value="">All orders</option><option value="yes">Reprocessed</option><option value="no">No reprocess</option></select>;
    const options = column.key === "created" ? ["newest", "oldest"] : column.key === "total" ? ["total-high", "total-low"] : column.key === "name" ? ["name", "name-desc"] : column.key === "due" ? ["due", "due-desc"] : null;
    if (options) {
      column.onSort = () => setSort(sort === options[0] ? options[1] : options[0]);
      if (options.includes(sort)) column.sortDirection = ["newest", "total-high", "name-desc", "due-desc"].includes(sort) ? "descending" : "ascending";
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="PRINTING JOB ORDERS"
        title="Printing Job Orders"
        description="Create, plan, and audit every customer order from one production record."
        actions={<Button variant="primary" onClick={() => setChooserOpen(true)}>New job order</Button>}
      />

      {(supportState === "loading" || orderState === "loading") && <LoadingState label="Loading job orders…" />}
      {(supportState === "error" || orderState === "error") && <ErrorState description={supportError ?? orderError ?? undefined} onRetry={() => { reloadSupport(); reloadOrders(); }} />}

      {ready && orderPage && <div className="job-orders-filters__summary"><span role="status">{orderPage.total} matching {orderPage.total === 1 ? "order" : "orders"}</span><Button variant="ghost" onClick={clearFilters}>Clear filters</Button></div>}

      {ready && supportData && attaching && (() => {
        const attachJob = supportData.spoolerMonitor?.jobs.find((job) => job.id === attachSpoolerJobId && job.reviewStatus === "unreviewed") ?? null;
        if (!attachJob) {
          return (
            <EmptyState
              title="This tracked print is no longer available"
              description="It may already have been added to an order, or dismissed, from somewhere else."
              action={<Button variant="secondary" onClick={cancelAttach}>Back to job orders</Button>}
            />
          );
        }
        return (
          <>
            <div className="job-orders-attach-banner" role="status">
              <div>
                <span className="numeric">ADD TRACKED PRINT</span>
                <strong>{attachJob.documentName}</strong>
                <small>{attachJob.printerName} · job {attachJob.osJobId}</small>
                <p>Pick the order below to add this print to — it's recorded as its own already-printed line, and existing lines stay untouched.</p>
              </div>
              <div className="job-orders-attach-banner__actions">
                <Button type="button" variant="ghost" size="sm" onClick={cancelAttach}>Cancel</Button>
                <Button type="button" variant="secondary" size="sm" onClick={createInsteadOfAttach}>Create new order instead</Button>
              </div>
            </div>
            {orders.length === 0 ? (
              <EmptyState
                title="No open orders to add this print to"
                description="Every existing order is already paid, completed, or cancelled."
                action={<Button variant="primary" onClick={createInsteadOfAttach}>Create a new order instead</Button>}
              />
            ) : (
              <DataTable
                columns={columns}
                rows={orders}
                onRowClick={(row) => navigate(`/job-orders/${row.id}?attachSpoolerJobId=${encodeURIComponent(attachSpoolerJobId!)}`)}
              />
            )}
          </>
        );
      })()}

      {ready && !attaching && orderPage?.total === 0 && !query && !status && !reprocess && !fromDate && !toDate && (
        <EmptyState
          title="No job orders yet"
          description="Create the first order, choose its products, and plan the materials the work will use."
          action={<Button variant="primary" onClick={() => setChooserOpen(true)}>New job order</Button>}
        />
      )}

      {ready && !attaching && orderPage?.total === 0 && (query || status || reprocess || fromDate || toDate) && (
        <EmptyState title="No job orders match" description="Change or clear the table filters to see other orders." action={<Button variant="secondary" onClick={clearFilters}>Clear filters</Button>} />
      )}

      {ready && orderPage && orderPage.total > 0 && !attaching && (
        <>
          <DataTable columns={columns} rows={orders} onRowClick={(row) => navigate(`/job-orders/${row.id}`)} />
          <Pagination page={orderPage.page} pageSize={orderPage.pageSize} total={orderPage.total} totalPages={orderPage.totalPages} loading={pageLoading} onPageChange={setPage} onPageSizeChange={setPageSize} itemLabel="orders" />
        </>
      )}

      {ready && orderPage && orderPage.total > 0 && attaching && (
        <Pagination page={orderPage.page} pageSize={orderPage.pageSize} total={orderPage.total} totalPages={orderPage.totalPages} loading={pageLoading} onPageChange={setPage} onPageSizeChange={setPageSize} itemLabel="eligible orders" />
      )}

      {supportData && (
        <>
          <JobServiceChooserModal
            open={chooserOpen}
            services={supportData.services}
            onClose={closeCreate}
            onSelect={(service) => { setChooserOpen(false); setSelectedService(service); }}
          />
          {selectedService ? (
            <TransactionCreateModal
              open
              initialService={selectedService}
              services={supportData.services}
              customers={supportData.customers}
              products={supportData.products}
              inventoryItems={supportData.inventoryItems}
              pricingRules={supportData.pricingRules}
              scanPricingTiers={supportData.scanPricingTiers}
              sourceSpoolerJobId={sourceSpoolerJobId}
              sourceObservedPrintJob={(supportData.spoolerMonitor?.jobs ?? []).find((job) => job.id === sourceSpoolerJobId) ?? null}
              otherObservedPrintJobs={(supportData.spoolerMonitor?.jobs ?? []).filter(
                (job) => job.reviewStatus === "unreviewed" && job.id !== sourceSpoolerJobId,
              )}
              onClose={closeCreate}
              onCreated={(order) => {
                closeCreate();
                reloadOrders();
                navigate(`/job-orders/${encodeURIComponent(order.id)}`);
              }}
            />
          ) : null}
        </>
      )}
    </>
  );
}
