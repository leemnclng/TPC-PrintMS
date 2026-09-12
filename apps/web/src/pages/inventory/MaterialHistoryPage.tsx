import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Button } from "../../components/Button/Button";
import { PageHeader } from "../../components/PageHeader/PageHeader";
import { DataTable, type DataTableColumn } from "../../components/DataTable/DataTable";
import { LoadingState } from "../../components/LoadingState/LoadingState";
import { ErrorState } from "../../components/ErrorState/ErrorState";
import { EmptyState } from "../../components/EmptyState/EmptyState";
import { useResource } from "../../hooks/useResource";
import { api } from "../../lib/apiClient";
import { formatDateTime } from "../../lib/format";
import type { InventoryItem, InventoryMovement } from "../../types/domain";
import "./InventoryPage.css";
import "../JobOrdersPage.css";

type Movement = InventoryMovement & { jobOrderName: string | null; jobOrderNumber: string | null; jobOrderStatus: string | null; productName: string | null };
const quantity = (value: number) => new Intl.NumberFormat(undefined, { maximumFractionDigits: 6 }).format(value);
const timestamp = (value: string) => /[zZ]|[+-]\d{2}:\d{2}$/.test(value) ? value : `${value}Z`;

export function MaterialHistoryPage() {
  const { materialId } = useParams();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("");
  const { data, state, error, reload } = useResource(async () => {
    const [item, movements] = await Promise.all([
      api.get<InventoryItem>(`/inventory-items/${materialId}`),
      api.get<Movement[]>(`/inventory-movements?inventory_item_id=${encodeURIComponent(materialId!)}`),
    ]);
    return { item, movements };
  }, [materialId]);
  const movements = data?.movements ?? [];
  const visible = movements.filter((row) => (!kind || (kind === "jobs" ? Boolean(row.jobOrderId) : row.kind === kind))
    && [row.jobOrderName, row.jobOrderNumber, row.productName, row.note].some((value) => (value ?? "").toLowerCase().includes(query.trim().toLowerCase())));
  const transactions = new Map<string, { id: string; name: string; number: string; status: string; deducted: number; returned: number; products: Set<string> }>();
  for (const row of movements) {
    if (!row.jobOrderId) continue;
    const job = transactions.get(row.jobOrderId) ?? { id: row.jobOrderId, name: row.jobOrderName || row.jobOrderNumber || row.jobOrderId, number: row.jobOrderNumber || "", status: row.jobOrderStatus || "unknown", deducted: 0, returned: 0, products: new Set<string>() };
    job.deducted += Math.max(-row.quantityDelta, 0);
    job.returned += Math.max(row.quantityDelta, 0);
    if (row.productName) job.products.add(row.productName);
    transactions.set(job.id, job);
  }
  const ledgerBalance = movements.reduce((sum, row) => sum + row.quantityDelta, 0);
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
    <PageHeader eyebrow="MATERIAL AUDIT" title={data?.item.name || "Material history"} description="Trace stock changes to their job orders and products. Quantities include failed output, reprints, and owner-confirmed adjustments." actions={<Button variant="secondary" disabled={state === "loading"} onClick={reload}>Refresh</Button>} />
    {state === "loading" && <LoadingState label="Loading material history…" />}
    {state === "error" && <ErrorState description={error ?? undefined} onRetry={reload} />}
    {state === "ready" && data && <>
      <div className="inventory-workbench__summary">
        <div><strong>{quantity(data.item.quantityOnHand)}</strong><span>On hand · {data.item.unit}</span></div>
        <div><strong>{quantity([...transactions.values()].reduce((sum, job) => sum + job.deducted - job.returned, 0))}</strong><span>Net job consumption · {data.item.unit}</span></div>
        <div><strong>{transactions.size}</strong><span>Linked transactions</span></div>
      </div>
      <p role="status">Lifetime ledger balance: {quantity(ledgerBalance)} {data.item.unit}. {Math.abs(ledgerBalance - data.item.quantityOnHand) < 0.000001 ? "Matches current inventory." : `Difference from current stock: ${quantity(data.item.quantityOnHand - ledgerBalance)}. Review adjustments before reconciling.`}</p>
      <h2>Transactions using this material</h2>
      <p>Lifetime totals: deducted minus returned equals net usage. Job statuses and names reflect their current values.</p>
      {transactions.size ? <DataTable columns={[
        { key: "job", header: "Job", render: (row) => <Link to={`/job-orders/${row.id}`}>{row.name}<small className="material-history-detail">{row.number}</small></Link> },
        { key: "status", header: "Current status", render: (row) => row.status.replace(/_/g, " ") },
        { key: "products", header: "Products", render: (row) => [...row.products].join(", ") || "—" },
        { key: "deducted", header: "Deducted", numeric: true, render: (row) => quantity(row.deducted) },
        { key: "returned", header: "Returned", numeric: true, render: (row) => quantity(row.returned) },
        { key: "net", header: "Net used", numeric: true, render: (row) => quantity(row.deducted - row.returned) },
      ]} rows={[...transactions.values()]} /> : <EmptyState title="No linked transactions" description="Job-linked material usage will appear here when recorded." />}
      <h2>Stock movement ledger</h2>
      <div className="job-orders-filters__summary"><span role="status">{visible.length} of {movements.length} movements · {data.item.unit}</span><Button variant="ghost" onClick={() => { setQuery(""); setKind(""); }}>Clear filters</Button></div>
      <DataTable columns={columns} rows={visible} />
    </>}
  </>;
}
