import { useEffect, useState } from "react";
import { Button } from "../../components/Button/Button";
import { Modal } from "../../components/Modal/Modal";
import { ApiError, api } from "../../lib/apiClient";
import type { JobOrder, JobOrderItem } from "../../types/domain";
import "../workspaceForm.css";
import "./JobOrderModals.css";

interface Props {
  open: boolean;
  order: JobOrder;
  item: JobOrderItem;
  onClose: () => void;
  onReprocessed: (order: JobOrder) => void;
}

export function JobQualityFailureModal({ open, order, item, onClose, onReprocessed }: Props) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const action = item.operationKind === "scan" ? "Start re-scan" : item.operationKind === "photocopy" ? "Reprocess photocopy" : item.operationKind === "adhoc" ? "Start external rework" : "Queue reprint";

  useEffect(() => {
    if (!open) return;
    setReason("");
    setSaving(false);
    setError(null);
  }, [open, item.id]);

  async function confirm() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      onReprocessed(await api.post<JobOrder>(`/job-orders/${order.id}/items/${item.id}/transitions`, {
        toStatus: "queued",
        note: reason.trim() ? `Quality failed: ${reason.trim()}` : undefined,
      }));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "The reprocess cycle could not be started.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} title="Quality check failed" description={`${item.productName} · ${order.number}`} onClose={onClose} busy={saving} status={error ? "error" : saving ? "loading" : "idle"} className="job-quality-modal">
      <div className="job-quality-failure">
        <div className="job-quality-failure__impact">
          <span className="numeric">REPROCESS {String(item.reprocessCount + 1).padStart(2, "0")}</span>
          <strong>{action}</strong>
          <p>The completed output remains in history. This product returns to its queue as a fresh production cycle.</p>
        </div>
        {item.materials.length ? <div className="job-quality-failure__materials"><strong>Fresh material allowance</strong>{item.materials.map((material) => <span key={material.id}><b>{material.inventoryItemName}</b><small>Another {material.plannedQuantity / (item.reprocessCount + 1)} {material.inventoryItemUnit} will be deducted when the reprocess is completed.</small></span>)}</div> : <p className="job-quality-failure__digital">No inventory is used. The existing scan output will be replaced after the re-scan.</p>}
        <label className="form-field"><span>Failure reason <small>(optional)</small></span><textarea rows={3} value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} placeholder="e.g. streaking on page 2, wrong orientation, blurred scan" /><small>This appears in the product and transaction audit history.</small></label>
        {error ? <p className="workspace-form__error" role="alert">{error}</p> : null}
      </div>
      <footer className="job-order-form__actions"><Button type="button" variant="ghost" disabled={saving} onClick={onClose}>Keep current output</Button><Button type="button" variant="danger" loading={saving} onClick={confirm}>{action}</Button></footer>
    </Modal>
  );
}
