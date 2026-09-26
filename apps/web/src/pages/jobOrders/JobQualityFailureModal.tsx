import { useEffect, useState } from "react";
import { Button } from "../../components/Button/Button";
import { Modal } from "../../components/Modal/Modal";
import { ApiError, api } from "../../lib/apiClient";
import type { FailureReason, JobOrder, JobOrderItem } from "../../types/domain";
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
  const [reasons, setReasons] = useState<FailureReason[]>([]);
  const [reasonCode, setReasonCode] = useState("");
  const [reasonNote, setReasonNote] = useState("");
  const [spoiledSheets, setSpoiledSheets] = useState("");
  const [printJobId, setPrintJobId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const action = item.operationKind === "scan" ? "Start re-scan" : item.operationKind === "photocopy" ? "Reprocess photocopy" : item.operationKind === "adhoc" ? "Start external rework" : "Queue reprint";

  useEffect(() => {
    if (!open) return;
    const attempts = order.printAttempts
      .filter((attempt) => attempt.jobOrderItemId === item.id && attempt.result === "succeeded")
      .sort((left, right) => Date.parse(right.submittedAt) - Date.parse(left.submittedAt));
    const paper = item.materials.find((material) => material.paperSize);
    setReasonCode("");
    setReasonNote("");
    setSpoiledSheets(paper ? String(Math.round(paper.plannedQuantity / (item.reprocessCount + 1))) : "");
    setPrintJobId(attempts[0]?.id ?? "");
    setSaving(false);
    setError(null);
    api.get<FailureReason[]>("/reports/failure-reasons")
      .then(setReasons)
      .catch((caught) => setError(caught instanceof ApiError ? caught.message : "Failure reasons could not be loaded."));
  }, [open, item.id, item.materials, item.reprocessCount, order.printAttempts]);

  async function confirm() {
    if (saving) return;
    if (!reasonCode) {
      setError("Choose a failure reason.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      onReprocessed(await api.post<JobOrder>(`/job-orders/${order.id}/items/${item.id}/transitions`, {
        toStatus: "queued",
        failureReasonCode: reasonCode,
        reasonNote: reasonNote.trim() || undefined,
        spoiledSheets: spoiledSheets === "" ? undefined : Number(spoiledSheets),
        printJobId: printJobId || undefined,
      }));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "The reprocess cycle could not be started.");
    } finally {
      setSaving(false);
    }
  }

  const attempts = order.printAttempts
    .filter((attempt) => attempt.jobOrderItemId === item.id && attempt.result === "succeeded")
    .sort((left, right) => Date.parse(right.submittedAt) - Date.parse(left.submittedAt));

  return (
    <Modal open={open} title="Quality check failed" description={`${item.productName} · ${order.number}`} onClose={onClose} busy={saving} status={error ? "error" : saving ? "loading" : "idle"} className="job-quality-modal">
      <div className="job-quality-failure">
        <div className="job-quality-failure__impact">
          <span className="numeric">REPROCESS {String(item.reprocessCount + 1).padStart(2, "0")}</span>
          <strong>{action}</strong>
          <p>The completed output remains in history. This product returns to its queue as a fresh production cycle.</p>
        </div>
        {item.materials.length ? <div className="job-quality-failure__materials"><strong>Fresh material allowance</strong>{item.materials.map((material) => <span key={material.id}><b>{material.inventoryItemName}</b><small>Another {material.plannedQuantity / (item.reprocessCount + 1)} {material.inventoryItemUnit} will be deducted when the reprocess is completed.</small></span>)}</div> : <p className="job-quality-failure__digital">No inventory is used. The existing scan output will be replaced after the re-scan.</p>}
        <label className="form-field"><span>Failure reason</span><select value={reasonCode} onChange={(event) => { setReasonCode(event.target.value); setError(null); }} required aria-invalid={!reasonCode && Boolean(error)}><option value="">Choose a reason</option>{reasons.map((reason) => <option key={reason.code} value={reason.code}>{reason.label} · {reason.faultType}</option>)}</select><small>Required for waste and reliability reporting.</small></label>
        <label className="form-field"><span>Spoiled sheets <small>(can be deferred)</small></span><input type="number" min={0} step={1} value={spoiledSheets} onChange={(event) => setSpoiledSheets(event.target.value)} /><small>Pre-filled from this product's current paper allowance. Clear it if the count is not known yet.</small></label>
        {attempts.length > 1 ? <label className="form-field"><span>Print attempt</span><select value={printJobId} onChange={(event) => setPrintJobId(event.target.value)}><option value="">No linked attempt</option>{attempts.map((attempt) => <option key={attempt.id} value={attempt.id}>{new Date(attempt.submittedAt).toLocaleString()} · {attempt.printerName}</option>)}</select></label> : null}
        <label className="form-field"><span>Note <small>(optional)</small></span><textarea rows={3} value={reasonNote} maxLength={500} onChange={(event) => setReasonNote(event.target.value)} placeholder="e.g. streaking on page 2, wrong orientation, blurred scan" /><small>This appears in the product and transaction audit history.</small></label>
        {error ? <p className="workspace-form__error" role="alert">{error}</p> : null}
      </div>
      <footer className="job-order-form__actions"><Button type="button" variant="ghost" disabled={saving} onClick={onClose}>Keep current output</Button><Button type="button" variant="danger" loading={saving} onClick={confirm}>{action}</Button></footer>
    </Modal>
  );
}
