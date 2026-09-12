import { useEffect, useState } from "react";
import { Button } from "../../components/Button/Button";
import { Modal } from "../../components/Modal/Modal";
import { ApiError, api } from "../../lib/apiClient";
import { formatCurrency, formatDate } from "../../lib/format";
import type { InventoryStockPurchase } from "../../types/domain";
import "../workspaceForm.css";
import "./StockPurchasesPage.css";

interface Props {
  purchase: InventoryStockPurchase | null;
  onClose: () => void;
  onDeleted: (purchaseId: string) => void;
}

export function StockPurchaseDeleteModal({ purchase, onClose, onDeleted }: Props) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (purchase) {
      setDeleting(false);
      setError(null);
    }
  }, [purchase]);

  async function removePurchase() {
    if (!purchase || purchase.appliedAt || deleting) return;
    setDeleting(true);
    setError(null);
    try {
      await api.del<void>(`/inventory-stock-purchases/${purchase.id}`);
      onDeleted(purchase.id);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "The purchase could not be deleted. Try again.");
    } finally {
      setDeleting(false);
    }
  }

  return <Modal open={Boolean(purchase)} title="Delete stock purchase?" description="This permanently removes the purchase from the expenditure ledger." onClose={onClose} busy={deleting} status={error ? "error" : deleting ? "loading" : "idle"}>
    {purchase ? <>
      <div className="stock-purchase-delete-summary">
        <strong>{purchase.materialName}</strong>
        <span>{formatDate(purchase.purchasedOn)} · {purchase.quantityPurchased.toLocaleString(undefined, { maximumFractionDigits: 6 })} {purchase.purchaseUnit}</span>
        <b className="numeric">{formatCurrency(purchase.totalCost)}</b>
      </div>
      <p className="stock-purchase-delete-note">The spending totals will be recalculated. This will not change the material’s usable inventory or transaction stock history.</p>
      {error ? <p className="workspace-form__error" role="alert">{error}</p> : null}
      <footer className="inventory-modal__actions"><Button autoFocus type="button" variant="ghost" disabled={deleting} onClick={onClose}>Keep purchase</Button><Button type="button" variant="danger" loading={deleting} onClick={removePurchase}>Delete purchase</Button></footer>
    </> : null}
  </Modal>;
}
