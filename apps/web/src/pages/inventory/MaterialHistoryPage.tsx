import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Button } from "../../components/Button/Button";
import { PageHeader } from "../../components/PageHeader/PageHeader";
import { Pagination } from "../../components/Pagination/Pagination";
import { DataTable, type DataTableColumn } from "../../components/DataTable/DataTable";
import { LoadingState } from "../../components/LoadingState/LoadingState";
import { ErrorState } from "../../components/ErrorState/ErrorState";
import { EmptyState } from "../../components/EmptyState/EmptyState";
import { useResource } from "../../hooks/useResource";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { usePaginatedResource } from "../../hooks/usePaginatedResource";
import { api } from "../../lib/apiClient";
import { formatDateTime } from "../../lib/format";
import type { InventoryItem, InventoryMovement, InventoryMovementPage } from "../../types/domain";
import "./InventoryPage.css";
import "../JobOrdersPage.css";

type Movement = InventoryMovement;
const quantity = (value: number) => new Intl.NumberFormat(undefined, { maximumFractionDigits: 6 }).format(value);
const timestamp = (value: string) => /[zZ]|[+-]\d{2}:\d{2}$/.test(value) ? value : `${value}Z`;

export function MaterialHistoryPage() {
  const { materialId } = useParams();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("");
  const debouncedQuery = useDebouncedValue(query, 250);
  const movementQuery = new URLSearchParams({ inventory_item_id: materialId ?? "", search: debouncedQuery, kind }).toString();
  const { data: item, state: itemState, error: itemError, reload: reloadItem } = useResource(() => api.get<InventoryItem>(`/inventory-items/${materialId}`), [materialId]);
  const { data, state, error, reload, setPage, pageSize, setPageSize, pageLoading } = usePaginatedResource<Movement, InventoryMovementPage>(
    (page, size) => api.get<InventoryMovementPage>(`/inventory-movements/page?${movementQuery}&page=${page}&page_size=${size}`), movementQuery,
  );
  const movements = data?.items ?? [];
  const transactions = new Map<string, { id: string; name: string; number: string; status: string; deducted: number; returned: number; products: Set<string> }>();
  for (const row of movements) {
    if (!row.jobOrderId) continue;
    const job = transactions.get(row.jobOrderId) ?? { id: row.jobOrderId, name: row.jobOrderName || row.jobOrderNumber || row.jobOrderId, number: row.jobOrderNumber || "", status: row.jobOrderStatus || "unknown", deducted: 0, returned: 0, products: new Set<string>() };
    job.deducted += Math.max(-row.quantityDelta, 0);
    job.returned += Math.max(row.quantityDelta, 0);
    if (row.productName) job.products.add(row.productName);
    transactions.set(job.id, job);
  }
  const columns: DataTableColumn<Movement>[] = [
    { key: "date", header: "Date", render: (row) => formatDateTime(timestamp(row.occurredAt)) },
    { key: "job", header: "Job order", render: (row) => row.jobOrderId ? <Link to={`/job-orders/${row.jobOrderId}`}>{row.jobOrderName || row.jobOrderNumber || row.jobOrderId}<small className="material-history-detail">{row.jobOrderNumber} · {row.jobOrderStatus?.replace(/_/g, " ")}</small></Link> : "No linked job" },
    { key: "product", header: "Product", render: (row) => row.productName || "—" },
    { key: "kind", header: "Movement", render: (row) => row.kind.replace(/_/g, " ") },
    { key: "delta", header: "Stock change", numeric: true, render: (row) => `${row.quantityDelta > 0 ? "+" : ""}${quantity(row.quantityDelta)}` },
    { key: "balance", header: "Balance after", numeric: true, render: (row) => quantity(row.balanceAfter) },
    { key: "note", header: "Audit note", render: (row) => <>{row.note || "—"}{row.stockPurchaseId ? <small className="material-history-detail">Purchase ID {row.stockPurchaseId}</small> : null}</> },
  ];
  columns.find((column) => column.key === "job")!.filter = <input type="search" aria-label="Search job, product or note" placeholder="Search history…" value={query} onChange={(event) => setQuery(event.target.value)} />;
  columns.find((column) => column.key === "kind")!.filter = <select aria-label="Filter movement type" value={kind} onChange={(event) => setKind(event.target.value)}><option value="">All movements</option><option value="jobs">Linked to a job</option>{["opening_balance", "stock_in", "stock_out", "job_usage", "adjustment"].map((value) => <option key={value} value={value}>{value.replace(/_/g, " ")}</option>)}</select>;
  return <>
    <Link to="/inventory">← Back to inventory</Link>
    <PageHeader eyebrow="MATERIAL AUDIT" title={item?.name || "Material history"} description="Trace stock changes to their job orders and products. Quantities include failed output, reprints, and owner-confirmed adjustments." actions={<Button variant="secondary" disabled={state === "loading" || itemState === "loading"} onClick={() => { reload(); reloadItem(); }}>Refresh</Button>} />
    {(state === "loading" || itemState === "loading") && <LoadingState label="Loading material history…" />}
    {(state === "error" || itemState === "error") && <ErrorState description={error ?? itemError ?? undefined} onRetry={() => { reload(); reloadItem(); }} />}
    {state === "ready" && itemState === "ready" && data && item && <>
      <div className="inventory-workbench__summary">
        <div><strong>{quantity(item.quantityOnHand)}</strong><span>On hand · {item.unit}</span></div>
        <div><strong>{quantity(data.netJobConsumption)}</strong><span>Net job consumption · {item.unit}</span></div>
        <div><strong>{data.linkedTransactionCount}</strong><span>Linked transactions</span></div>
      </div>
      <p role="status">Lifetime ledger balance: {quantity(data.ledgerBalance)} {item.unit}. {Math.abs(data.ledgerBalance - item.quantityOnHand) < 0.000001 ? "Matches current inventory." : `Difference from current stock: ${quantity(item.quantityOnHand - data.ledgerBalance)}. Review adjustments before reconciling.`}</p>
      <h2>Transactions on this page</h2>
      <p>These job totals reflect the currently visible ledger page. Lifetime consumption and transaction counts remain in the summary above.</p>
      {transactions.size ? <DataTable columns={[
        { key: "job", header: "Job", render: (row) => <Link to={`/job-orders/${row.id}`}>{row.name}<small className="material-history-detail">{row.number}</small></Link> },
        { key: "status", header: "Current status", render: (row) => row.status.replace(/_/g, " ") },
        { key: "products", header: "Products", render: (row) => [...row.products].join(", ") || "—" },
        { key: "deducted", header: "Deducted", numeric: true, render: (row) => quantity(row.deducted) },
        { key: "returned", header: "Returned", numeric: true, render: (row) => quantity(row.returned) },
        { key: "net", header: "Net used", numeric: true, render: (row) => quantity(row.deducted - row.returned) },
      ]} rows={[...transactions.values()]} /> : <EmptyState title="No linked transactions" description="Job-linked material usage will appear here when recorded." />}
      <h2>Stock movement ledger</h2>
      <div className="job-orders-filters__summary"><span role="status">{data.total} matching movements · {item.unit}</span><Button variant="ghost" onClick={() => { setQuery(""); setKind(""); }}>Clear filters</Button></div>
      <DataTable columns={columns} rows={movements} />
      <Pagination page={data.page} pageSize={pageSize} total={data.total} totalPages={data.totalPages} loading={pageLoading} onPageChange={setPage} onPageSizeChange={setPageSize} itemLabel="movements" />
    </>}
  </>;
}
