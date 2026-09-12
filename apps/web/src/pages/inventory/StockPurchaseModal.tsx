import { FormEvent, useEffect, useMemo, useState } from "react";
import { Button } from "../../components/Button/Button";
import { Modal } from "../../components/Modal/Modal";
import { ApiError, api } from "../../lib/apiClient";
import { formatCurrency } from "../../lib/format";
import type { InventoryItem, InventoryStockPurchase } from "../../types/domain";
import "../workspaceForm.css";
import "./InventoryModals.css";
import "./StockPurchasesPage.css";

interface Props {
  open: boolean;
  items: InventoryItem[];
  initialItemId?: string | null;
  templatePurchase?: InventoryStockPurchase | null;
  onClose: () => void;
  onSaved: (purchase: InventoryStockPurchase) => void;
}

function localToday() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

export function StockPurchaseModal({ open, items, initialItemId, templatePurchase, onClose, onSaved }: Props) {
  const activeItems = useMemo(() => items.filter((item) => item.isActive), [items]);
  const [itemId, setItemId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [sheetsPerReam, setSheetsPerReam] = useState("");
  const [totalCost, setTotalCost] = useState("");
  const [purchasedOn, setPurchasedOn] = useState(localToday());
  const [supplier, setSupplier] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const requestedItemId = templatePurchase?.inventoryItemId ?? initialItemId;
    setItemId(activeItems.some((item) => item.id === requestedItemId) ? requestedItemId ?? "" : activeItems[0]?.id ?? "");
    setQuantity(templatePurchase ? String(templatePurchase.quantityPurchased) : "");
    const requestedItem = activeItems.find((item) => item.id === requestedItemId);
    setSheetsPerReam(String(templatePurchase?.sheetsPerReam ?? requestedItem?.sheetsPerReam ?? ""));
    setTotalCost(templatePurchase ? templatePurchase.totalCost.toFixed(2) : "");
    setPurchasedOn(localToday());
    setSupplier(templatePurchase?.supplier ?? "");
    setReference("");
    setNotes("");
    setTouched({});
    setSubmitted(false);
    setSaveError(null);
  }, [activeItems, initialItemId, open, templatePurchase]);

  const selectedItem = activeItems.find((item) => item.id === itemId);
  const purchaseUnit = selectedItem?.purchasePriceBasis === "ream" ? "ream" : selectedItem?.unit ?? "unit";
  const numericQuantity = Number(quantity);
  const numericCost = Number(totalCost);
  const numericSheetsPerReam = Number(sheetsPerReam);
  const quantityHasTooManyDecimals = Number.isFinite(numericQuantity) && Math.abs(numericQuantity * 1_000_000 - Math.round(numericQuantity * 1_000_000)) > 0.000001;
  const costHasFractionalCent = Number.isFinite(numericCost) && Math.abs(numericCost * 100 - Math.round(numericCost * 100)) > 0.000001;
  const quantityInvalid = quantity.trim() === "" || !Number.isFinite(numericQuantity) || numericQuantity <= 0 || quantityHasTooManyDecimals;
  const costInvalid = totalCost.trim() === "" || !Number.isFinite(numericCost) || numericCost < 0 || costHasFractionalCent;
  const sheetsPerReamInvalid = purchaseUnit === "ream" && (sheetsPerReam.trim() === "" || !Number.isInteger(numericSheetsPerReam) || numericSheetsPerReam <= 0);
  const dateInvalid = !purchasedOn || purchasedOn > localToday();
  const showError = (field: string) => submitted || touched[field];
  const unitCost = quantityInvalid || costInvalid ? 0 : numericCost / numericQuantity;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
    setSaveError(null);
    if (!itemId || quantityInvalid || sheetsPerReamInvalid || costInvalid || dateInvalid || saving) return;
    setSaving(true);
    try {
      const purchase = await api.post<InventoryStockPurchase>("/inventory-stock-purchases", {
        inventoryItemId: itemId,
        quantityPurchased: numericQuantity,
        sheetsPerReam: purchaseUnit === "ream" ? numericSheetsPerReam : null,
        totalCost: numericCost,
        purchasedOn,
        supplier: supplier.trim() || null,
        reference: reference.trim() || null,
        notes: notes.trim() || null,
      });
      onSaved(purchase);
    } catch (caught) {
      setSaveError(caught instanceof ApiError ? caught.message : "The stock purchase could not be recorded. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} title={initialItemId && selectedItem ? `Restock ${selectedItem.name}` : "Record stock purchase"} description="Log a material purchase for expenditure tracking. Production inventory remains unchanged." onClose={onClose} busy={saving} status={saveError ? "error" : saving ? "loading" : "idle"} className="inventory-modal stock-purchase-modal">
      <form className="inventory-modal__form" onSubmit={handleSubmit} noValidate>
        <div className="inventory-modal__fields">
          <label className={`form-field${showError("material") && !itemId ? " form-field--error" : ""}`}>
            <span>Material</span>
            <select autoFocus value={itemId} onChange={(event) => { const nextId = event.target.value; setItemId(nextId); setSheetsPerReam(String(activeItems.find((item) => item.id === nextId)?.sheetsPerReam ?? "")); }} onBlur={() => setTouched((current) => ({ ...current, material: true }))} aria-invalid={showError("material") && !itemId} aria-describedby="stock-purchase-material-message">
              <option value="">Select a material</option>
              {activeItems.map((item) => <option value={item.id} key={item.id}>{item.name} · purchases tracked by {item.purchasePriceBasis === "ream" ? "ream" : item.unit}</option>)}
            </select>
            <span id="stock-purchase-material-message" className={`form-field__message${showError("material") && !itemId ? " form-field__message--error" : ""}`}>{showError("material") && !itemId ? "Select the purchased material." : "The material link categorizes spending; it does not change usable stock."}</span>
          </label>

          {purchaseUnit === "ream" ? <label className={`form-field${showError("sheetsPerReam") && sheetsPerReamInvalid ? " form-field--error" : ""}`}>
            <span>Sheets per purchased ream</span>
            <input className="numeric" type="number" min="1" step="1" inputMode="numeric" value={sheetsPerReam} onChange={(event) => setSheetsPerReam(event.target.value)} onBlur={() => setTouched((current) => ({ ...current, sheetsPerReam: true }))} aria-invalid={showError("sheetsPerReam") && sheetsPerReamInvalid} aria-describedby="stock-purchase-ream-message" />
            <span id="stock-purchase-ream-message" className={`form-field__message${showError("sheetsPerReam") && sheetsPerReamInvalid ? " form-field__message--error" : ""}`}>{showError("sheetsPerReam") && sheetsPerReamInvalid ? "Enter a whole number greater than zero." : "Saved on this purchase, so it can differ from the material’s usual ream size."}</span>
          </label> : null}

          <div className="inventory-modal__row">
            <label className={`form-field${showError("quantity") && quantityInvalid ? " form-field--error" : ""}`}>
              <span>Purchase quantity ({purchaseUnit})</span>
              <input className="numeric" type="number" min="0.000001" step="any" inputMode="decimal" value={quantity} onChange={(event) => setQuantity(event.target.value)} onBlur={() => setTouched((current) => ({ ...current, quantity: true }))} aria-invalid={showError("quantity") && quantityInvalid} aria-describedby="stock-purchase-quantity-message" />
              <span id="stock-purchase-quantity-message" className={`form-field__message${showError("quantity") && quantityInvalid ? " form-field__message--error" : ""}`}>{showError("quantity") && quantityInvalid ? "Enter a quantity greater than zero with up to six decimal places." : "Track how many purchase units were bought; this does not change production inventory."}</span>
            </label>
            <label className={`form-field${showError("cost") && costInvalid ? " form-field--error" : ""}`}>
              <span>Total purchase cost</span>
              <span className="inventory-modal__money-input"><span>₱</span><input className="numeric" type="number" min="0" step="0.01" inputMode="decimal" value={totalCost} onChange={(event) => setTotalCost(event.target.value)} onBlur={() => setTouched((current) => ({ ...current, cost: true }))} aria-invalid={showError("cost") && costInvalid} aria-describedby="stock-purchase-cost-message" /></span>
              <span id="stock-purchase-cost-message" className={`form-field__message${showError("cost") && costInvalid ? " form-field__message--error" : ""}`}>{showError("cost") && costInvalid ? "Enter zero or a positive amount with up to two decimal places." : "Use the full amount paid for this purchase."}</span>
            </label>
          </div>

          <div className="inventory-modal__row">
            <label className={`form-field${showError("date") && dateInvalid ? " form-field--error" : ""}`}><span>Purchase date</span><input type="date" max={localToday()} value={purchasedOn} onChange={(event) => setPurchasedOn(event.target.value)} onBlur={() => setTouched((current) => ({ ...current, date: true }))} aria-invalid={showError("date") && dateInvalid} aria-describedby="stock-purchase-date-message" /><span id="stock-purchase-date-message" className={`form-field__message${showError("date") && dateInvalid ? " form-field__message--error" : ""}`}>{showError("date") && dateInvalid ? "Choose today or an earlier date." : "Use the supplier receipt or delivery date."}</span></label>
            <label className="form-field"><span>Supplier</span><input value={supplier} maxLength={200} onChange={(event) => setSupplier(event.target.value)} placeholder="Optional supplier name" /><span className="form-field__message">Helps group repeat purchases.</span></label>
          </div>

          <label className="form-field"><span>Receipt or reference</span><input value={reference} maxLength={200} onChange={(event) => setReference(event.target.value)} placeholder="Receipt number, invoice, or order reference" /><span className="form-field__message">Optional reference for later reconciliation.</span></label>
          <label className="form-field"><span>Notes</span><textarea rows={3} value={notes} maxLength={1000} onChange={(event) => setNotes(event.target.value)} placeholder="Delivery details, pack size, payment notes…" /><span className="form-field__message">Optional operational context for this purchase.</span></label>

          <div className="stock-purchase-preview" aria-live="polite">
            <div><span>Cost per {purchaseUnit}</span><strong className="numeric">{formatCurrency(unitCost)}</strong></div>
            <div><span>Purchase being logged</span><strong className="numeric">{quantityInvalid ? "0" : numericQuantity.toLocaleString(undefined, { maximumFractionDigits: 6 })} {purchaseUnit}</strong></div>
            {purchaseUnit === "ream" ? <div><span>Usable stock when applied</span><strong className="numeric">{quantityInvalid || sheetsPerReamInvalid ? "0" : (numericQuantity * numericSheetsPerReam).toLocaleString(undefined, { maximumFractionDigits: 6 })} sheets</strong></div> : null}
          </div>
          {saveError ? <p className="workspace-form__error" role="alert">{saveError}</p> : null}
        </div>
        <footer className="inventory-modal__actions"><Button type="button" variant="ghost" disabled={saving} onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" loading={saving}>Record purchase</Button></footer>
      </form>
    </Modal>
  );
}
