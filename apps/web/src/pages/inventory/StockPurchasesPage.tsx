import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "../../components/Button/Button";
import { LinkButton } from "../../components/Button/LinkButton";
import { EmptyState } from "../../components/EmptyState/EmptyState";
import { ErrorState } from "../../components/ErrorState/ErrorState";
import { LoadingState } from "../../components/LoadingState/LoadingState";
import { PageHeader } from "../../components/PageHeader/PageHeader";
import { useResource } from "../../hooks/useResource";
import { api } from "../../lib/apiClient";
import { formatCurrency, formatDate } from "../../lib/format";
import type { InventoryItem, InventoryStockPurchase } from "../../types/domain";
import { StockPurchaseModal } from "./StockPurchaseModal";
import "./StockPurchasesPage.css";

function isCurrentMonth(value: string) {
  const date = new Date(`${value}T00:00:00`);
  const now = new Date();
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
}

export function StockPurchasesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { data, state, error, reload } = useResource(async () => {
    const [items, purchases] = await Promise.all([
      api.get<InventoryItem[]>("/inventory-items"),
      api.get<InventoryStockPurchase[]>("/inventory-stock-purchases"),
    ]);
    return { items, purchases };
  }, []);
  const [purchases, setPurchases] = useState<InventoryStockPurchase[] | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [initialItemId, setInitialItemId] = useState<string | null>(null);
  const [templatePurchase, setTemplatePurchase] = useState<InventoryStockPurchase | null>(null);
  const [query, setQuery] = useState("");
  const [materialId, setMaterialId] = useState("");
  const rows = useMemo(() => purchases ?? data?.purchases ?? [], [data?.purchases, purchases]);
  const items = useMemo(() => data?.items ?? [], [data?.items]);
  const activeItems = useMemo(() => items.filter((item) => item.isActive), [items]);
  const visibleRows = useMemo(() => {
    const search = query.trim().toLowerCase();
    return rows.filter((purchase) => (!materialId || purchase.inventoryItemId === materialId) && (!search || [purchase.materialName, purchase.supplier, purchase.reference, purchase.notes].some((value) => (value ?? "").toLowerCase().includes(search))));
  }, [materialId, query, rows]);
  const totalSpend = rows.reduce((sum, purchase) => sum + purchase.totalCost, 0);
  const monthSpend = rows.filter((purchase) => isCurrentMonth(purchase.purchasedOn)).reduce((sum, purchase) => sum + purchase.totalCost, 0);

  useEffect(() => {
    const requestedItemId = searchParams.get("restock");
    if (state !== "ready" || !requestedItemId || !activeItems.some((item) => item.id === requestedItemId)) return;
    setInitialItemId(requestedItemId);
    setTemplatePurchase(null);
    setModalOpen(true);
    const next = new URLSearchParams(searchParams);
    next.delete("restock");
    setSearchParams(next, { replace: true });
  }, [activeItems, searchParams, setSearchParams, state]);

  function openPurchase(itemId: string | null = null, template: InventoryStockPurchase | null = null) {
    setInitialItemId(itemId);
    setTemplatePurchase(template);
    setModalOpen(true);
  }

  function handleSaved(purchase: InventoryStockPurchase) {
    setPurchases((current) => [purchase, ...(current ?? data?.purchases ?? [])]);
    setModalOpen(false);
    reload();
  }

  return (
    <>
      <PageHeader eyebrow="INVENTORY / STOCKS" title="Stock purchases" description="Track material purchases and business spending without changing the production quantities used by transactions." actions={<><LinkButton to="/inventory" variant="secondary">Back to inventory</LinkButton><Button type="button" variant="primary" disabled={!activeItems.length} onClick={() => openPurchase()}>Record purchase</Button></>} />
      {state === "loading" ? <LoadingState label="Loading stock purchases…" /> : null}
      {state === "error" ? <ErrorState description={error ?? undefined} onRetry={reload} /> : null}
      {state === "ready" ? (
        <section className="stock-purchases" aria-labelledby="stock-purchase-ledger-title">
          <div className="stock-purchases__summary" aria-label="Purchase spending summary">
            <div><span>This month</span><strong className="numeric">{formatCurrency(monthSpend)}</strong></div>
            <div><span>All-time spend</span><strong className="numeric">{formatCurrency(totalSpend)}</strong></div>
            <div><span>Purchase entries</span><strong className="numeric">{rows.length.toLocaleString()}</strong></div>
          </div>
          {!activeItems.length ? <EmptyState title="No active materials" description="Register or reactivate an inventory material before recording a stock purchase." action={<LinkButton to="/inventory" variant="secondary">Open inventory</LinkButton>} /> : null}
          {rows.length ? (
            <>
              <div className="stock-purchases__heading"><div><h2 id="stock-purchase-ledger-title">Purchase ledger</h2><p>Entries track purchase quantities and costs independently from production inventory.</p></div><div className="stock-purchases__filters"><label><span>Search purchases</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Material, supplier, receipt…" /></label><label><span>Material</span><select value={materialId} onChange={(event) => setMaterialId(event.target.value)}><option value="">All materials</option>{items.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label></div></div>
              {visibleRows.length ? <div className="stock-purchase-ledger"><table><thead><tr><th>Date</th><th>Material</th><th>Supplier / reference</th><th className="numeric">Quantity</th><th className="numeric">Unit cost</th><th className="numeric">Total spend</th><th>Action</th></tr></thead><tbody>{visibleRows.map((purchase) => <tr key={purchase.id}><td data-label="Date">{formatDate(purchase.purchasedOn)}</td><td data-label="Material"><strong>{purchase.materialName}</strong>{purchase.inventoryItemId ? null : <small>Material removed</small>}</td><td data-label="Supplier / reference"><strong>{purchase.supplier || "Not recorded"}</strong><small>{purchase.reference || purchase.notes || "No reference"}</small></td><td data-label="Quantity" className="numeric">{purchase.quantityPurchased.toLocaleString(undefined, { maximumFractionDigits: 6 })} {purchase.purchaseUnit}</td><td data-label="Unit cost" className="numeric">{formatCurrency(purchase.unitCost)} / {purchase.purchaseUnit}</td><td data-label="Total spend" className="numeric stock-purchase-ledger__total">{formatCurrency(purchase.totalCost)}</td><td data-label="Action">{purchase.inventoryItemId && activeItems.some((item) => item.id === purchase.inventoryItemId) ? <Button type="button" variant="secondary" size="sm" onClick={() => openPurchase(purchase.inventoryItemId ?? null, purchase)}>Restock</Button> : <small>Unavailable</small>}</td></tr>)}</tbody></table></div> : <EmptyState title="No purchases match" description="Change the search or material filter to view other purchase entries." />}
            </>
          ) : activeItems.length ? <EmptyState title="No stock purchases recorded" description="Record the next material purchase to begin tracking spending." action={<Button type="button" variant="secondary" onClick={() => openPurchase()}>Record first purchase</Button>} /> : null}
        </section>
      ) : null}
      <StockPurchaseModal open={modalOpen} items={items} initialItemId={initialItemId} templatePurchase={templatePurchase} onClose={() => setModalOpen(false)} onSaved={handleSaved} />
    </>
  );
}
