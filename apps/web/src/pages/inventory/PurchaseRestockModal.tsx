import { useEffect, useMemo, useState } from "react";
import { Button } from "../../components/Button/Button";
import { Modal } from "../../components/Modal/Modal";
import { ApiError, api } from "../../lib/apiClient";
import { formatCurrency, formatDate } from "../../lib/format";
import type { InventoryItem, InventoryMovement, InventoryStockPurchase } from "../../types/domain";
import "../workspaceForm.css";
import "./InventoryModals.css";
import "./StockPurchasesPage.css";

interface Props {
  item: InventoryItem | null;
  onClose: () => void;
  onApplied: (movement: InventoryMovement) => void;
}

const quantity = (value: number) => new Intl.NumberFormat(undefined, { maximumFractionDigits: 6 }).format(value);

export function PurchaseRestockModal({ item, onClose, onApplied }: Props) {
  const [purchases, setPurchases] = useState<InventoryStockPurchase[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!item) return;
    let active = true;
    setLoading(true);
    setError(null);
    setSelectedId("");
    api.get<InventoryStockPurchase[]>(`/inventory-stock-purchases?inventory_item_id=${encodeURIComponent(item.id)}`)
      .then((rows) => {
        if (!active) return;
        const available = rows.filter((purchase) => !purchase.appliedAt && purchase.stockQuantity != null);
        setPurchases(available);
        setSelectedId(available[0]?.id ?? "");
      })
      .catch((caught) => {
        if (active) setError(caught instanceof ApiError ? caught.message : "Available purchases could not be loaded.");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [item]);

  const selected = useMemo(() => purchases.find((purchase) => purchase.id === selectedId) ?? null, [purchases, selectedId]);

  async function applyPurchase() {
    if (!selected || saving) return;
    setSaving(true);
    setError(null);
    try {
      const movement = await api.post<InventoryMovement>(`/inventory-stock-purchases/${selected.id}/apply`, {});
      onApplied(movement);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "The purchase could not be applied. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return <Modal open={Boolean(item)} title={item ? `Restock ${item.name}` : "Restock material"} description="Choose one recorded purchase to add to usable inventory. A purchase can be applied only once." onClose={onClose} busy={saving} status={error ? "error" : loading || saving ? "loading" : "idle"} className="inventory-modal purchase-restock-modal">
    {item ? <div className="purchase-restock">
      <div className="purchase-restock__balance"><span>Current inventory</span><strong className="numeric">{quantity(item.quantityOnHand)} {item.unit}</strong></div>
      {loading ? <p role="status">Loading available purchases…</p> : null}
      {!loading && purchases.length === 0 && !error ? <p className="purchase-restock__empty">No unapplied purchases are available for this material. Record a purchase in the stock ledger first.</p> : null}
      {!loading && purchases.length ? <fieldset className="purchase-restock__options">
        <legend>Stock purchase</legend>
        {purchases.map((purchase) => <label key={purchase.id} className={purchase.id === selectedId ? "purchase-restock__option purchase-restock__option--selected" : "purchase-restock__option"}>
          <input type="radio" name="stock-purchase" value={purchase.id} checked={purchase.id === selectedId} onChange={() => setSelectedId(purchase.id)} />
          <span><strong>{formatDate(purchase.purchasedOn)} · {quantity(purchase.quantityPurchased)} {purchase.purchaseUnit}</strong><small>ID {purchase.id}</small><small>{purchase.sheetsPerReam ? `${purchase.sheetsPerReam} sheets/ream · ` : ""}{formatCurrency(purchase.totalCost)}{purchase.supplier ? ` · ${purchase.supplier}` : ""}</small></span>
          <b className="numeric">+{quantity(purchase.stockQuantity ?? 0)} {item.unit}</b>
        </label>)}
      </fieldset> : null}
      {selected ? <div className="purchase-restock__result"><span>Inventory after restock</span><strong className="numeric">{quantity(item.quantityOnHand + (selected.stockQuantity ?? 0))} {item.unit}</strong></div> : null}
      {error ? <p className="workspace-form__error" role="alert">{error}</p> : null}
      <footer className="inventory-modal__actions"><Button type="button" variant="ghost" disabled={saving} onClick={onClose}>Cancel</Button><Button type="button" variant="primary" loading={saving} disabled={!selected || loading} onClick={applyPurchase}>Apply purchase</Button></footer>
    </div> : null}
  </Modal>;
}
