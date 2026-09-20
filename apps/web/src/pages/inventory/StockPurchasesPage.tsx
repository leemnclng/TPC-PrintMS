import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "../../components/Button/Button";
import { LinkButton } from "../../components/Button/LinkButton";
import { EmptyState } from "../../components/EmptyState/EmptyState";
import { ErrorState } from "../../components/ErrorState/ErrorState";
import { LoadingState } from "../../components/LoadingState/LoadingState";
import { PageHeader } from "../../components/PageHeader/PageHeader";
import { Pagination } from "../../components/Pagination/Pagination";
import { StatusPill } from "../../components/StatusPill/StatusPill";
import { useResource } from "../../hooks/useResource";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { usePaginatedResource } from "../../hooks/usePaginatedResource";
import { api } from "../../lib/apiClient";
import { formatCurrency, formatDate } from "../../lib/format";
import type { InventoryItem, InventoryStockPurchase, InventoryStockPurchasePage } from "../../types/domain";
import { StockPurchaseDeleteModal } from "./StockPurchaseDeleteModal";
import { StockPurchaseModal } from "./StockPurchaseModal";
import "./StockPurchasesPage.css";

export function StockPurchasesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: itemsData, state: itemsState, error: itemsError, reload: reloadItems } = useResource(() => api.get<InventoryItem[]>("/inventory-items"), []);
  const [modalOpen, setModalOpen] = useState(false);
  const [initialItemId, setInitialItemId] = useState<string | null>(null);
  const [templatePurchase, setTemplatePurchase] = useState<InventoryStockPurchase | null>(null);
  const [deletingPurchase, setDeletingPurchase] = useState<InventoryStockPurchase | null>(null);
  const [query, setQuery] = useState("");
  const [materialId, setMaterialId] = useState("");
  const debouncedQuery = useDebouncedValue(query, 250);
  const purchaseQuery = useMemo(() => new URLSearchParams({ search: debouncedQuery, inventory_item_id: materialId }).toString(), [debouncedQuery, materialId]);
  const { data, state, error, reload, setPage, pageSize, setPageSize, pageLoading } = usePaginatedResource<InventoryStockPurchase, InventoryStockPurchasePage>(
    (nextPage, nextPageSize) => api.get(`/inventory-stock-purchases/page?${purchaseQuery}&page=${nextPage}&page_size=${nextPageSize}`), purchaseQuery,
  );
  const rows = data?.items ?? [];
  const items = useMemo(() => itemsData ?? [], [itemsData]);
  const activeItems = useMemo(() => items.filter((item) => item.isActive), [items]);

  useEffect(() => {
    const requestedItemId = searchParams.get("restock");
    if (itemsState !== "ready" || !requestedItemId || !activeItems.some((item) => item.id === requestedItemId)) return;
    setInitialItemId(requestedItemId);
    setTemplatePurchase(null);
    setModalOpen(true);
    const next = new URLSearchParams(searchParams);
    next.delete("restock");
    setSearchParams(next, { replace: true });
  }, [activeItems, itemsState, searchParams, setSearchParams]);

  function openPurchase(itemId: string | null = null, template: InventoryStockPurchase | null = null) {
    setInitialItemId(itemId);
    setTemplatePurchase(template);
    setModalOpen(true);
  }

  function handleSaved(_purchase: InventoryStockPurchase) {
    setModalOpen(false);
    reload();
    reloadItems();
  }

  function handleDeleted(_purchaseId: string) {
    setDeletingPurchase(null);
    reload();
  }

  return (
    <>
      <PageHeader eyebrow="INVENTORY / STOCKS" title="Stock purchases" description="Track material purchases and spending, then apply a specific available purchase from Inventory when its stock is ready for use." actions={<><LinkButton to="/inventory" variant="secondary">Back to inventory</LinkButton><Button type="button" variant="primary" disabled={!activeItems.length} onClick={() => openPurchase()}>Record purchase</Button></>} />
      {state === "loading" || itemsState === "loading" ? <LoadingState label="Loading stock purchases…" /> : null}
      {state === "error" || itemsState === "error" ? <ErrorState description={error ?? itemsError ?? undefined} onRetry={() => { reload(); reloadItems(); }} /> : null}
      {state === "ready" && itemsState === "ready" && data ? (
        <section className="stock-purchases" aria-labelledby="stock-purchase-ledger-title">
          <div className="stock-purchases__summary" aria-label="Purchase spending summary">
            <div><span>This month</span><strong className="numeric">{formatCurrency(data.monthSpend)}</strong></div>
            <div><span>Matching spend</span><strong className="numeric">{formatCurrency(data.totalSpend)}</strong></div>
            <div><span>Purchase entries</span><strong className="numeric">{data.total.toLocaleString()}</strong></div>
          </div>
          {!activeItems.length ? <EmptyState title="No active materials" description="Register or reactivate an inventory material before recording a stock purchase." action={<LinkButton to="/inventory" variant="secondary">Open inventory</LinkButton>} /> : null}
          {data.total ? (
            <>
              <div className="stock-purchases__heading"><div><h2 id="stock-purchase-ledger-title">Purchase ledger</h2><p>Available entries can be applied once to their material’s usable inventory.</p></div><div className="stock-purchases__filters"><label><span>Search purchases</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ID, material, supplier, receipt…" /></label><label><span>Material</span><select value={materialId} onChange={(event) => setMaterialId(event.target.value)}><option value="">All materials</option>{items.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label></div></div>
              {rows.length ? <div className="stock-purchase-ledger"><table>
                <thead><tr><th>Date</th><th>Material / ID</th><th>Supplier / reference</th><th className="numeric">Quantity</th><th className="numeric">Unit cost</th><th className="numeric">Total spend</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>{rows.map((purchase) => <tr key={purchase.id}>
                  <td data-label="Date">{formatDate(purchase.purchasedOn)}</td>
                  <td data-label="Material / ID"><strong>{purchase.materialName}</strong><small className="stock-purchase-ledger__id">ID {purchase.id}</small>{purchase.inventoryItemId ? null : <small>Material removed</small>}</td>
                  <td data-label="Supplier / reference"><strong>{purchase.supplier || "Not recorded"}</strong><small>{purchase.reference || purchase.notes || "No reference"}</small></td>
                  <td data-label="Quantity" className="numeric">{purchase.quantityPurchased.toLocaleString(undefined, { maximumFractionDigits: 6 })} {purchase.purchaseUnit}{purchase.sheetsPerReam ? <small>{purchase.sheetsPerReam} sheets / ream</small> : null}</td>
                  <td data-label="Unit cost" className="numeric">{formatCurrency(purchase.unitCost)} / {purchase.purchaseUnit}</td>
                  <td data-label="Total spend" className="numeric stock-purchase-ledger__total">{formatCurrency(purchase.totalCost)}</td>
                  <td data-label="Status"><StatusPill label={purchase.appliedAt ? "Applied" : "Available"} tone={purchase.appliedAt ? "neutral" : "success"} /></td>
                  <td data-label="Actions"><div className="stock-purchase-ledger__actions">{purchase.inventoryItemId && activeItems.some((item) => item.id === purchase.inventoryItemId) ? <Button type="button" variant="secondary" size="sm" onClick={() => openPurchase(purchase.inventoryItemId ?? null, purchase)}>Buy again</Button> : null}<Button type="button" variant="danger" size="sm" disabled={Boolean(purchase.appliedAt)} title={purchase.appliedAt ? "Applied purchases are retained for inventory audit history." : undefined} onClick={() => setDeletingPurchase(purchase)}>Delete</Button></div></td>
                </tr>)}</tbody>
              </table></div> : null}
              <Pagination page={data.page} pageSize={pageSize} total={data.total} totalPages={data.totalPages} loading={pageLoading} onPageChange={setPage} onPageSizeChange={setPageSize} itemLabel="purchases" />
            </>
          ) : activeItems.length ? (query || materialId ? <EmptyState title="No purchases match" description="Change the search or material filter to view other purchase entries." /> : <EmptyState title="No stock purchases recorded" description="Record the next material purchase to begin tracking spending." action={<Button type="button" variant="secondary" onClick={() => openPurchase()}>Record first purchase</Button>} />) : null}
        </section>
      ) : null}
      <StockPurchaseModal open={modalOpen} items={items} initialItemId={initialItemId} templatePurchase={templatePurchase} onClose={() => setModalOpen(false)} onSaved={handleSaved} />
      <StockPurchaseDeleteModal purchase={deletingPurchase} onClose={() => setDeletingPurchase(null)} onDeleted={handleDeleted} />
    </>
  );
}
