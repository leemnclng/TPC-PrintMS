import { useEffect, useState } from "react";
import { Button } from "../../components/Button/Button";
import { Modal } from "../../components/Modal/Modal";
import { ApiError, api } from "../../lib/apiClient";
import type { JobOrder } from "../../types/domain";
import "../workspaceForm.css";
import "./JobOrderModals.css";

interface Props {
  open: boolean;
  order: JobOrder;
  onClose: () => void;
  onCancelled: (order: JobOrder) => void;
}

export function JobCancelModal({ open, order, onClose, onCancelled }: Props) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setReason("");
    setSaving(false);
    setError(null);
  }, [open]);

  async function confirm() {
    if (reason.trim().length < 3 || saving) return;
    setSaving(true);
    setError(null);
    try {
      onCancelled(await api.post<JobOrder>(`/job-orders/${order.id}/cancel`, { reason: reason.trim() }));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "The transaction could not be cancelled.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} title="Cancel transaction" description={`${order.name} · ${order.number}`} onClose={onClose} busy={saving} status={error ? "error" : saving ? "loading" : "idle"} className="job-cancel-modal">
      <div className="job-cancel-confirmation">
        <p><strong>This stops the transaction inside Printing-MS.</strong> Consumed materials and audit records remain unchanged. An already-submitted operating-system print job may still need to be stopped from the printer queue.</p>
        <label className="form-field"><span>Cancellation reason</span><textarea autoFocus rows={3} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} aria-invalid={Boolean(reason) && reason.trim().length < 3} placeholder="Why is this transaction being cancelled?" /><small>Required for the audit history.</small></label>
        {error ? <p className="workspace-form__error" role="alert">{error}</p> : null}
      </div>
      <footer className="job-order-form__actions"><Button type="button" variant="ghost" disabled={saving} onClick={onClose}>Keep transaction</Button><Button type="button" variant="danger" disabled={reason.trim().length < 3} loading={saving} onClick={confirm}>Cancel transaction</Button></footer>
    </Modal>
  );
}
