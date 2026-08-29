import { useEffect, useState } from "react";
import { Button } from "../../components/Button/Button";
import { Modal } from "../../components/Modal/Modal";
import { ApiError, api } from "../../lib/apiClient";
import type { JobOrder } from "../../types/domain";
import "../workspaceForm.css";
import "./JobOrderModals.css";

type TargetStatus = "queued" | "ready" | "paid" | "completed";

const TRANSITION_COPY: Record<TargetStatus, { title: string; description: string; action: string; note: string }> = {
  ready: {
    title: "Finish printing",
    description: "Confirm that physical printing has finished and begin output inspection.",
    action: "Start quality review",
    note: "Check page order, orientation, color, clarity, and physical defects here in the Ready step before reprinting or marking the job ready.",
  },
  queued: {
    title: "Send back for a re-print",
    description: "The printed output did not pass quality review.",
    action: "Requeue for re-print",
    note: "The job returns to the print queue. Choose the printer and settings again for a clean re-print.",
  },
  paid: {
    title: "Mark ready — no payment due",
    description: "This job has no outstanding balance, so it can be marked ready without recording a payment.",
    action: "Mark ready",
    note: "The job moves to Paid and is ready for customer handoff.",
  },
  completed: {
    title: "Complete job order",
    description: "Confirm that production and customer handoff are finished.",
    action: "Complete job",
    note: "This closes the active workflow. Payment, print, material, and status history remain available for audit.",
  },
};

interface Props {
  open: boolean;
  order: JobOrder;
  targetStatus: TargetStatus;
  onClose: () => void;
  onTransitioned: (order: JobOrder) => void;
}

export function JobTransitionModal({ open, order, targetStatus, onClose, onTransitioned }: Props) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copy = TRANSITION_COPY[targetStatus];

  useEffect(() => {
    if (open) setError(null);
  }, [open, targetStatus]);

  async function handleConfirm() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      onTransitioned(await api.post<JobOrder>(`/job-orders/${order.id}/transitions`, { toStatus: targetStatus }));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "The job status could not be updated.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} title={copy.title} description={`${order.name} · ${order.number} · ${copy.description}`} onClose={onClose} busy={saving} status={error ? "error" : saving ? "loading" : "idle"} className="job-transition-modal">
      <div className="job-transition-confirmation">
        <span className="job-transition-confirmation__mark numeric" aria-hidden="true">NEXT</span>
        <p>{copy.note}</p>
      </div>
      {error && <p className="workspace-form__error job-transition-error" role="alert">{error}</p>}
      <footer className="job-order-form__actions">
        <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button autoFocus type="button" variant="primary" onClick={handleConfirm} loading={saving}>{copy.action}</Button>
      </footer>
    </Modal>
  );
}
