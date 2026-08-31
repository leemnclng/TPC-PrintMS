import { useEffect, useMemo, useState } from "react";
import { Button } from "../../components/Button/Button";
import { EmptyState } from "../../components/EmptyState/EmptyState";
import { ErrorState } from "../../components/ErrorState/ErrorState";
import { LoadingState } from "../../components/LoadingState/LoadingState";
import { PageHeader } from "../../components/PageHeader/PageHeader";
import { StatusPill } from "../../components/StatusPill/StatusPill";
import { useResource } from "../../hooks/useResource";
import { api } from "../../lib/apiClient";
import { formatCurrency } from "../../lib/format";
import { paperSizeDisplay } from "../../lib/paperSizes";
import type { InventoryItem, InventoryMovement } from "../../types/domain";
import { DeleteInventoryItemModal } from "./DeleteInventoryItemModal";
import { InventoryItemModal } from "./InventoryItemModal";
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
  const { data, state, error, reload } = useResource(() => api.get<InventoryItem[]>("/inventory-items"));
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<StockFilter>("all");
  const [itemModalOpen, setItemModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [adjustingItem, setAdjustingItem] = useState<InventoryItem | null>(null);
  const [deletingItem, setDeletingItem] = useState<InventoryItem | null>(null);

  useEffect(() => {
    if (data) setItems(data);
  }, [data]);

  const visibleItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return items.filter((item) => {
      const matchesQuery = !normalizedQuery || [item.name, item.category, item.notes ?? ""]
        .some((value) => value.toLowerCase().includes(normalizedQuery));
      const matchesFilter = filter === "all"
        || (filter === "reorder" && item.isActive && item.quantityOnHand <= item.reorderLevel)
        || (filter === "inactive" && !item.isActive);
      return matchesQuery && matchesFilter;
    });
  }, [items, query, filter]);

  const activeCount = items.filter((item) => item.isActive).length;
  const reorderCount = items.filter((item) => item.isActive && item.quantityOnHand <= item.reorderLevel).length;
  const productLinkCount = items.reduce((total, item) => total + item.linkedProductCount, 0);

  function openCreate() {
    setEditingItem(null);
    setItemModalOpen(true);
  }

  function openEdit(item: InventoryItem) {
    setEditingItem(item);
    setItemModalOpen(true);
  }

  function handleSaved(saved: InventoryItem) {
    setItems((current) => {
      const exists = current.some((item) => item.id === saved.id);
      const next = exists ? current.map((item) => item.id === saved.id ? saved : item) : [...current, saved];
      return next.sort((left, right) => left.category.localeCompare(right.category) || left.name.localeCompare(right.name));
    });
    setItemModalOpen(false);
  }

  function handleAdjusted(movement: InventoryMovement) {
    setItems((current) => current.map((item) => item.id === movement.inventoryItemId
      ? { ...item, quantityOnHand: movement.balanceAfter, updatedAt: movement.occurredAt }
      : item));
    setAdjustingItem(null);
  }

  function handleDeleted(deleted: InventoryItem) {
    setItems((current) => current.filter((item) => item.id !== deleted.id));
    setDeletingItem(null);
  }

  return (
    <>
      <PageHeader
        eyebrow="OPERATIONS"
        title="Inventory"
        description="Register production materials, monitor stock, and connect consumption rules to the products that use them."
        actions={<Button type="button" variant="primary" onClick={openCreate}>Register material</Button>}
      />

      {state === "loading" ? <LoadingState label="Loading inventory…" /> : null}
      {state === "error" ? <ErrorState description={error ?? undefined} onRetry={reload} /> : null}

      {state === "ready" && items.length === 0 ? (
        <EmptyState
          title="No materials registered"
          description="Start with paper, ink, toner, or any consumable used during production."
          action={<Button type="button" variant="secondary" onClick={openCreate}>Register material</Button>}
        />
      ) : null}

      {state === "ready" && items.length > 0 ? (
        <section className="inventory-workbench" aria-labelledby="inventory-register-title">
          <div className="inventory-workbench__summary" aria-label="Inventory summary">
            <div>
              <strong className="numeric">{activeCount}</strong>
              <span>active materials</span>
            </div>
            <div data-alert={reorderCount > 0 ? "true" : undefined}>
              <strong className="numeric">{reorderCount}</strong>
              <span>need reorder</span>
            </div>
            <div>
              <strong className="numeric">{productLinkCount}</strong>
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
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Paper, ink, supplier…" />
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

          {visibleItems.length === 0 ? (
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
                  {visibleItems.map((item) => {
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
        </section>
      ) : null}

      <InventoryItemModal
        open={itemModalOpen}
        item={editingItem}
        onClose={() => setItemModalOpen(false)}
        onSaved={handleSaved}
      />
      <StockAdjustmentModal
        open={Boolean(adjustingItem)}
        item={adjustingItem}
        onClose={() => setAdjustingItem(null)}
        onAdjusted={handleAdjusted}
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
