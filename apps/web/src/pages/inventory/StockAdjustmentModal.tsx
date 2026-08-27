import { FormEvent, useEffect, useState } from "react";
import { Button } from "../../components/Button/Button";
import { Modal } from "../../components/Modal/Modal";
import { ApiError, api } from "../../lib/apiClient";
import type { InventoryItem, InventoryMovement, InventoryMovementKind } from "../../types/domain";
import "../workspaceForm.css";
import "./InventoryModals.css";

type AdjustmentAction = "receive" | "use" | "correct_up" | "correct_down";

interface StockAdjustmentModalProps {
  open: boolean;
  item: InventoryItem | null;
  onClose: () => void;
  onAdjusted: (movement: InventoryMovement) => void;
}

export function StockAdjustmentModal({ open, item, onClose, onAdjusted }: StockAdjustmentModalProps) {
  const [action, setAction] = useState<AdjustmentAction>("receive");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setAction("receive");
    setAmount("");
    setNote("");
    setSubmitted(false);
    setSaveError(null);
  }, [open, item]);

  const numericAmount = Number(amount);
  const isDecrease = action === "use" || action === "correct_down";
  const currentBalance = item?.quantityOnHand ?? 0;
  const currentUnit = item?.unit ?? "unit";
  const amountError = submitted && (!Number.isFinite(numericAmount) || numericAmount <= 0)
    ? "Enter a quantity greater than zero."
    : submitted && isDecrease && numericAmount > currentBalance
      ? `Only ${currentBalance.toLocaleString()} ${currentUnit} are currently available.`
      : null;
  const noteError = submitted && action.startsWith("correct") && !note.trim()
    ? "Add a reason so this correction remains auditable."
    : null;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!item) return;
    const currentItem = item;
    setSubmitted(true);
    setSaveError(null);
    if (
      !Number.isFinite(numericAmount) ||
      numericAmount <= 0 ||
      (isDecrease && numericAmount > currentBalance) ||
      (action.startsWith("correct") && !note.trim())
    ) return;

    const kind: InventoryMovementKind = action === "receive" ? "stock_in" : action === "use" ? "stock_out" : "adjustment";
    const quantityDelta = isDecrease ? -numericAmount : numericAmount;
    setSaving(true);
    try {
      const movement = await api.post<InventoryMovement>(`/inventory-items/${currentItem.id}/adjustments`, {
        kind,
        quantityDelta,
        note: note.trim() || null,
      });
      onAdjusted(movement);
    } catch (error) {
      setSaveError(error instanceof ApiError ? error.message : "The stock balance wasn’t updated. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      title="Adjust stock"
      description={item ? `${item.name} currently has ${currentBalance.toLocaleString()} ${currentUnit} on hand.` : undefined}
      busy={saving}
      status={saveError ? "error" : saving ? "loading" : "idle"}
      onClose={onClose}
      className="inventory-modal inventory-modal--compact"
    >
      <form className="inventory-modal__form" onSubmit={handleSubmit} noValidate>
        <div className="inventory-modal__fields">
          <label className="form-field">
            <span>Stock action</span>
            <select value={action} onChange={(event) => setAction(event.target.value as AdjustmentAction)} autoFocus>
              <option value="receive">Stock received</option>
              <option value="use">Stock used outside a job</option>
              <option value="correct_up">Correction — increase</option>
              <option value="correct_down">Correction — decrease</option>
            </select>
            <span className="form-field__message">Job-order usage will be recorded directly from each job order.</span>
          </label>

          <label className={`form-field${amountError ? " form-field--error" : ""}`}>
            <span>Quantity ({currentUnit})</span>
            <input
              className="numeric"
              type="number"
              min="0"
              step="any"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              aria-invalid={Boolean(amountError)}
              aria-describedby="stock-adjustment-amount-message"
            />
            <span id="stock-adjustment-amount-message" className={`form-field__message${amountError ? " form-field__message--error" : ""}`}>
              {amountError ?? "Enter the amount added to or removed from stock."}
            </span>
          </label>

          <label className={`form-field${noteError ? " form-field--error" : ""}`}>
            <span>Reason or reference</span>
            <textarea
              rows={3}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Supplier delivery, spoilage, count correction…"
              aria-invalid={Boolean(noteError)}
              aria-describedby="stock-adjustment-note-message"
            />
            <span id="stock-adjustment-note-message" className={`form-field__message${noteError ? " form-field__message--error" : ""}`}>
              {noteError ?? "Required for corrections; recommended for all movements."}
            </span>
          </label>

          {saveError ? <p className="workspace-form__error" role="alert">{saveError}</p> : null}
        </div>

        <footer className="inventory-modal__actions">
          <Button type="button" variant="ghost" disabled={saving} onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={saving}>Record adjustment</Button>
        </footer>
      </form>
    </Modal>
  );
}
