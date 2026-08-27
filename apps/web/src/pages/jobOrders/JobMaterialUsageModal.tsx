import { FormEvent, useEffect, useState } from "react";
import { Button } from "../../components/Button/Button";
import { Modal } from "../../components/Modal/Modal";
import { ApiError, api } from "../../lib/apiClient";
import type { JobOrder, JobOrderMaterialPlan } from "../../types/domain";
import "../workspaceForm.css";
import "./JobOrderModals.css";

type UsageEntry = { materialPlanId: string; quantityUsed: number };

interface Props {
  open: boolean;
  order: JobOrder;
  onClose: () => void;
  onRecorded: () => void;
}

export function JobMaterialUsageModal({ open, order, onClose, onRecorded }: Props) {
  const plans = order.items.flatMap((item) => item.materials.map((plan) => ({ ...plan, productName: item.productName })));
  const [entries, setEntries] = useState<UsageEntry[]>([]);
  const [note, setNote] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setEntries([]);
    setNote("");
    setSubmitted(false);
    setSaveError(null);
  }, [open]);

  function toggle(plan: JobOrderMaterialPlan, selected: boolean) {
    const remaining = Math.max(plan.plannedQuantity - plan.consumedQuantity, 0);
    setEntries((current) => selected
      ? [...current, { materialPlanId: plan.id, quantityUsed: remaining || 1 }]
      : current.filter((entry) => entry.materialPlanId !== plan.id));
  }

  function updateQuantity(materialPlanId: string, quantityUsed: number) {
    setEntries((current) => current.map((entry) => entry.materialPlanId === materialPlanId
      ? { ...entry, quantityUsed }
      : entry));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
    setSaveError(null);
    if (entries.length === 0 || entries.some((entry) => entry.quantityUsed <= 0)) return;
    setSaving(true);
    try {
      await api.post(`/job-orders/${order.id}/material-usage`, {
        entries,
        note: note.trim() || null,
      });
      onRecorded();
    } catch (error) {
      setSaveError(error instanceof ApiError ? error.message : "Material usage wasn’t recorded. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      title="Record material usage"
      description={`Confirm what was actually used for ${order.number}. Saving deducts these quantities from inventory.`}
      onClose={onClose}
      busy={saving}
      status={saveError ? "error" : saving ? "loading" : "idle"}
      className="job-usage-modal"
    >
      <form className="job-order-form" onSubmit={handleSubmit} noValidate>
        <div className="job-order-form__body">
          <div className="job-usage-list">
            {plans.map((plan) => {
              const entry = entries.find((candidate) => candidate.materialPlanId === plan.id);
              return (
                <div className="job-usage-row" key={plan.id}>
                  <label>
                    <input type="checkbox" checked={Boolean(entry)} onChange={(event) => toggle(plan, event.target.checked)} />
                    <span>
                      <strong>{plan.inventoryItemName}</strong>
                      <small>{plan.productName} · planned {plan.plannedQuantity.toLocaleString()} · used {plan.consumedQuantity.toLocaleString()}</small>
                    </span>
                  </label>
                  {entry && (
                    <label className="job-order-material__quantity">
                      <span>Use</span>
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={entry.quantityUsed}
                        onChange={(event) => updateQuantity(plan.id, Number(event.target.value))}
                        aria-invalid={submitted && entry.quantityUsed <= 0}
                      />
                      <span>{plan.inventoryItemUnit}</span>
                    </label>
                  )}
                  <span className="job-usage-row__stock">Stock: {plan.quantityOnHand.toLocaleString()} {plan.inventoryItemUnit}</span>
                </div>
              );
            })}
          </div>
          {submitted && entries.length === 0 && <p className="workspace-form__error">Select at least one material to record.</p>}
          <label className="form-field">
            <span>Usage note</span>
            <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional batch or production note" />
          </label>
          {saveError && <p className="workspace-form__error" role="alert">{saveError}</p>}
        </div>
        <footer className="job-order-form__actions">
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" variant="primary" loading={saving}>Record and deduct stock</Button>
        </footer>
      </form>
    </Modal>
  );
}
