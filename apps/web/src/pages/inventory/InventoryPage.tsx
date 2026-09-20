import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "../../components/Button/Button";
import { LinkButton } from "../../components/Button/LinkButton";
import { EmptyState } from "../../components/EmptyState/EmptyState";
import { ErrorState } from "../../components/ErrorState/ErrorState";
import { LoadingState } from "../../components/LoadingState/LoadingState";
import { PageHeader } from "../../components/PageHeader/PageHeader";
import { Pagination } from "../../components/Pagination/Pagination";
import { StatusPill } from "../../components/StatusPill/StatusPill";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { usePaginatedResource } from "../../hooks/usePaginatedResource";
import { api } from "../../lib/apiClient";
import { formatCurrency } from "../../lib/format";
import { paperSizeDisplay } from "../../lib/paperSizes";
import type { InventoryItem, InventoryItemPage, InventoryMovement } from "../../types/domain";
import { DeleteInventoryItemModal } from "./DeleteInventoryItemModal";
import { InventoryItemModal } from "./InventoryItemModal";
import { PurchaseRestockModal } from "./PurchaseRestockModal";
import { StockAdjustmentModal } from "./StockAdjustmentModal";
import "./InventoryPage.css";

type StockFilter = "all" | "reorder" | "inactive";

function formatQuantity(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(value);
}

function stockState(item: InventoryItem) {
  if (!item.isActive) return { label: "Inactive", tone: "neutral" as const };
  if (item.quantityOnHand <= 0) return { label: "Out of stock", tone: "danger" as const };
  if (item.quantityOnHand <= item.reorderLevel) return { label: "Reorder", tone: "warning" as const };
  return { label: "In stock", tone: "success" as const };
}

function purchaseCost(item: InventoryItem) {
  if (item.purchasePrice == null) return <div className="inventory-register__cost-detail"><span>Not set</span></div>;
  if (item.purchasePriceBasis === "ream" && item.sheetsPerReam) {
    return (
      <div className="inventory-register__cost-detail">
        <strong>{formatCurrency(item.purchasePrice)} / ream</strong>
        <span>{formatCurrency(item.purchasePrice / item.sheetsPerReam)} / sheet · {item.sheetsPerReam} sheets</span>
      </div>
    );
  }
  return <div className="inventory-register__cost-detail"><strong>{formatCurrency(item.purchasePrice)} / {item.unit}</strong></div>;
}

export function InventoryPage() {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<StockFilter>("all");
  const debouncedQuery = useDebouncedValue(query);
  const queryKey = JSON.stringify({ debouncedQuery, filter });
  const { data, state, error, reload, setPage, setPageSize, pageLoading } = usePaginatedResource<InventoryItem, InventoryItemPage>(
    (page, pageSize) => {
      const params = new URLSearchParams({ page: String(page), page_size: String(pageSize), search: debouncedQuery, stock_filter: filter });
      return api.get<InventoryItemPage>(`/inventory-items/page?${params}`);
    },
    queryKey,
  );
  const items = data?.items ?? [];
  const [itemModalOpen, setItemModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [adjustingItem, setAdjustingItem] = useState<InventoryItem | null>(null);
  const [restockingItem, setRestockingItem] = useState<InventoryItem | null>(null);
  const [deletingItem, setDeletingItem] = useState<InventoryItem | null>(null);

  function openCreate() {
    setEditingItem(null);
    setItemModalOpen(true);
  }

  function openEdit(item: InventoryItem) {
    setEditingItem(item);
    setItemModalOpen(true);
  }

  function handleSaved(_saved: InventoryItem) {
    setItemModalOpen(false);
    reload();
  }

  function handleAdjusted(_movement: InventoryMovement) {
    setAdjustingItem(null);
    reload();
  }

  function handleRestocked(_movement: InventoryMovement) {
    setRestockingItem(null);
    reload();
  }

  function handleDeleted(_deleted: InventoryItem) {
    setDeletingItem(null);
    reload();
  }

  return (
    <>
      <PageHeader
        eyebrow="OPERATIONS"
        title="Inventory"
        description="Register production materials, monitor stock, and connect consumption rules to the products that use them."
        actions={<><LinkButton to="/inventory/stocks" variant="secondary">Stock purchases</LinkButton><Button type="button" variant="primary" onClick={openCreate}>Register material</Button></>}
      />

      {state === "loading" ? <LoadingState label="Loading inventory…" /> : null}
      {state === "error" ? <ErrorState description={error ?? undefined} onRetry={reload} /> : null}

      {state === "ready" && data?.total === 0 && !query && filter === "all" ? (
        <EmptyState
          title="No materials registered"
          description="Start with paper, ink, toner, or any consumable used during production."
          action={<Button type="button" variant="secondary" onClick={openCreate}>Register material</Button>}
        />
      ) : null}

      {state === "ready" && data && (data.total > 0 || query || filter !== "all") ? (
        <section className="inventory-workbench" aria-labelledby="inventory-register-title">
          <div className="inventory-workbench__summary" aria-label="Inventory summary">
            <div>
              <strong className="numeric">{data.activeCount}</strong>
              <span>active materials</span>
            </div>
            <div data-alert={data.reorderCount > 0 ? "true" : undefined}>
              <strong className="numeric">{data.reorderCount}</strong>
              <span>need reorder</span>
            </div>
            <div>
              <strong className="numeric">{data.productLinkCount}</strong>
              <span>product links</span>
            </div>
          </div>

          <div className="inventory-workbench__heading">
            <div>
              <h2 id="inventory-register-title">Material register</h2>
              <p>Stock changes are recorded as movements; product links define expected usage per item produced.</p>
            </div>
            <div className="inventory-workbench__filters">
              <label>
                <span>Search materials</span>
                <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Try: A4 photo paper" />
              </label>
              <label>
                <span>Stock view</span>
                <select value={filter} onChange={(event) => setFilter(event.target.value as StockFilter)}>
                  <option value="all">All materials</option>
                  <option value="reorder">Needs reorder</option>
                  <option value="inactive">Inactive</option>
                </select>
              </label>
            </div>
          </div>

          {items.length === 0 ? (
            <EmptyState title="No materials match" description="Change the search or stock view to see other materials." />
          ) : (
            <div className="inventory-register">
              <table>
                <thead>
                  <tr>
                    <th>Material</th>
                    <th>Category</th>
                    <th className="numeric">On hand</th>
                    <th className="numeric">Reorder at</th>
                    <th className="numeric">Purchase cost</th>
                    <th className="numeric">Products</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => {
                    const status = stockState(item);
                    return (
                      <tr key={item.id}>
                        <td data-label="Material">
                          <div className="inventory-register__identity">
                            <strong>{item.name}</strong>
                            {item.notes ? <span>{item.notes}</span> : null}
                          </div>
                        </td>
                        <td data-label="Category">
                          {item.category}
                          {item.paperSize ? <span className="inventory-register__paper-size"> · {paperSizeDisplay(item.paperSize, item.paperWidthMm, item.paperHeightMm)}</span> : null}
                        </td>
                        <td data-label="On hand" className="numeric inventory-register__quantity">
                          <strong>{formatQuantity(item.quantityOnHand)}</strong> <span>{item.unit}</span>
                        </td>
                        <td data-label="Reorder at" className="numeric">{formatQuantity(item.reorderLevel)} {item.unit}</td>
                        <td data-label="Purchase cost" className="numeric inventory-register__cost">
                          {purchaseCost(item)}
                        </td>
                        <td data-label="Products" className="numeric">{item.linkedProductCount}</td>
                        <td data-label="Status"><StatusPill label={status.label} tone={status.tone} /></td>
                        <td className="inventory-register__actions">
                          <Link to={`/inventory/${item.id}/history`}>History</Link>
                          {item.availableStockPurchaseCount > 0 ? <Button type="button" variant="secondary" size="sm" title={`Apply one of ${item.availableStockPurchaseCount} available purchases.`} onClick={() => setRestockingItem(item)}>Restock</Button> : null}
                          <Button type="button" variant="secondary" size="sm" onClick={() => setAdjustingItem(item)}>Adjust</Button>
                          <Button type="button" variant="ghost" size="sm" onClick={() => openEdit(item)}>Edit</Button>
                          <Button
                            type="button"
                            variant="danger"
                            size="sm"
                            disabled={item.linkedProductCount > 0}
                            title={item.linkedProductCount > 0 ? "Remove this material from its linked products first." : undefined}
                            onClick={() => setDeletingItem(item)}
                          >
                            Delete
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {data.total > 0 ? (
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} totalPages={data.totalPages} loading={pageLoading} onPageChange={setPage} onPageSizeChange={setPageSize} itemLabel="materials" />
          ) : null}
        </section>
      ) : null}

      <InventoryItemModal
        open={itemModalOpen}
        item={editingItem}
        onClose={() => setItemModalOpen(false)}
        onSaved={handleSaved}
        onRestock={(item) => { setItemModalOpen(false); setRestockingItem(item); }}
      />
      <StockAdjustmentModal
        open={Boolean(adjustingItem)}
        item={adjustingItem}
        onClose={() => setAdjustingItem(null)}
        onAdjusted={handleAdjusted}
      />
      <PurchaseRestockModal
        item={restockingItem}
        onClose={() => setRestockingItem(null)}
        onApplied={handleRestocked}
      />
      <DeleteInventoryItemModal
        open={Boolean(deletingItem)}
        item={deletingItem}
        onClose={() => setDeletingItem(null)}
        onDeleted={handleDeleted}
      />
    </>
  );
}
