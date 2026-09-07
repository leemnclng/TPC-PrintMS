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

// Backend timestamps without an offset are stored in UTC.
function createdDate(value: string) {
  return new Date(/[zZ]|[+-]\d{2}:\d{2}$/.test(value) ? value : `${value}Z`);
}

function localDay(value: string) {
  const date = createdDate(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
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

  function cancelAttach() {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("attachSpoolerJobId");
    setSearchParams(nextParams, { replace: true });
  }

  function createInsteadOfAttach() {
    if (!attachSpoolerJobId) return;
    navigate(`/job-orders?create=1&spoolerJobId=${encodeURIComponent(attachSpoolerJobId)}`, { replace: true });
  }

  const invalidInterval = Boolean(fromDate && toDate && fromDate > toDate);
  const eligibleOrders = (data?.orders ?? []).filter((order) => !attaching || ["queued", "printing", "ready"].includes(order.status));
  const filteredOrders = eligibleOrders.filter((order) => {
    const search = query.trim().toLowerCase();
    const day = localDay(order.createdAt);
    const retried = order.items.some((item) => item.reprocessCount > 0);
    return !invalidInterval && (!status || order.status === status)
      && (!reprocess || (reprocess === "yes" ? retried : !retried))
      && (!fromDate || day >= fromDate) && (!toDate || day <= toDate)
      && (!search || [order.name, order.number, order.customerName || "Walk-in", ...order.items.map((item) => item.productName)].some((value) => value.toLowerCase().includes(search)));
  }).sort((a, b) => {
    const dateDifference = createdDate(b.createdAt).getTime() - createdDate(a.createdAt).getTime();
    if (sort === "oldest") return -dateDifference || a.number.localeCompare(b.number);
    if (sort === "name") return a.name.localeCompare(b.name) || dateDifference;
    if (sort === "total-high") return b.total - a.total || dateDifference;
    if (sort === "total-low") return a.total - b.total || dateDifference;
    if (sort === "due") return (a.dueDate || "9999").localeCompare(b.dueDate || "9999") || dateDifference;
    return dateDifference || b.number.localeCompare(a.number);
  });

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

      {state === "ready" && data && data.orders.length > 0 && <section className="job-orders-filters" aria-label="Filter and sort job orders">
        <label className="job-orders-filters__search">Search orders<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Job name, ID, customer or product" /></label>
        <label>Status<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">All statuses</option>{Object.entries(jobOrderStatusMeta).filter(([key]) => !attaching || ["queued", "printing", "ready"].includes(key)).map(([key, meta]) => <option key={key} value={key}>{meta.label}</option>)}</select></label>
        <label>Reprocess<select value={reprocess} onChange={(event) => setReprocess(event.target.value)}><option value="">All orders</option><option value="yes">Reprocessed</option><option value="no">No reprocess</option></select></label>
        <label>Created from<input type="date" value={fromDate} max={toDate || undefined} aria-invalid={invalidInterval} aria-describedby={invalidInterval ? "job-date-error" : undefined} onChange={(event) => setFromDate(event.target.value)} /></label>
        <label>Created through<input type="date" value={toDate} min={fromDate || undefined} aria-invalid={invalidInterval} aria-describedby={invalidInterval ? "job-date-error" : undefined} onChange={(event) => setToDate(event.target.value)} /></label>
        <label>Sort by<select value={sort} onChange={(event) => setSort(event.target.value)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="name">Job name A–Z</option><option value="total-high">Total: high to low</option><option value="total-low">Total: low to high</option><option value="due">Due date: earliest</option></select></label>
        <div className="job-orders-filters__summary"><span role="status">{filteredOrders.length} of {eligibleOrders.length} orders · dates in local time</span><Button variant="ghost" onClick={clearFilters}>Clear filters</Button></div>
        {invalidInterval && <p id="job-date-error" role="alert">The end date must be on or after the start date.</p>}
      </section>}

      {state === "ready" && data && attaching && (() => {
        const attachJob = data.spoolerMonitor?.jobs.find((job) => job.id === attachSpoolerJobId && job.reviewStatus === "unreviewed") ?? null;
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
            {eligibleOrders.length === 0 ? (
              <EmptyState
                title="No open orders to add this print to"
                description="Every existing order is already paid, completed, or cancelled."
                action={<Button variant="primary" onClick={createInsteadOfAttach}>Create a new order instead</Button>}
              />
            ) : filteredOrders.length === 0 ? (
              <EmptyState title="No matching orders" description="Change the filters to find an open order." action={<Button variant="secondary" onClick={clearFilters}>Clear filters</Button>} />
            ) : (
              <DataTable
                columns={columns}
                rows={filteredOrders}
                onRowClick={(row) => navigate(`/job-orders/${row.id}?attachSpoolerJobId=${encodeURIComponent(attachSpoolerJobId!)}`)}
              />
            )}
          </>
        );
      })()}

      {state === "ready" && data && !attaching && data.orders.length === 0 && (
        <EmptyState
          title="No job orders yet"
          description="Create the first order, choose its products, and plan the materials the work will use."
          action={<Button variant="primary" onClick={() => setChooserOpen(true)}>New job order</Button>}
        />
      )}

      {state === "ready" && data && !attaching && data.orders.length > 0 && (
        filteredOrders.length > 0 ? <DataTable columns={columns} rows={filteredOrders} onRowClick={(row) => navigate(`/job-orders/${row.id}`)} /> : <EmptyState title="No matching orders" description="Try another search, status, or date interval." action={<Button variant="secondary" onClick={clearFilters}>Clear filters</Button>} />
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
              otherObservedPrintJobs={(data.spoolerMonitor?.jobs ?? []).filter(
                (job) => job.reviewStatus === "unreviewed" && job.id !== sourceSpoolerJobId,
              )}
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
