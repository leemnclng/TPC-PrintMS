import { FormEvent, useEffect, useState } from "react";
import { Button } from "../../components/Button/Button";
import { Modal } from "../../components/Modal/Modal";
import { ApiError, api } from "../../lib/apiClient";
import { formatCurrency } from "../../lib/format";
import type { JobOrder, Payment } from "../../types/domain";
import "../workspaceForm.css";
import "./JobOrderModals.css";

interface Props {
  open: boolean;
  order: JobOrder;
  onClose: () => void;
  onRecorded: (order: JobOrder) => void;
}

export function JobPaymentModal({ open, order, onClose, onRecorded }: Props) {
  const outstanding = Math.max(order.total - order.amountPaid, 0);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<Payment["method"]>("cash");
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsedAmount = Number(amount);
  const amountInvalid = !Number.isFinite(parsedAmount) || parsedAmount <= 0 || parsedAmount > outstanding;

  useEffect(() => {
    if (!open) return;
    setAmount(outstanding.toFixed(2));
    setMethod("cash");
    setSubmitted(false);
    setError(null);
  }, [open, outstanding]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
    setError(null);
    if (amountInvalid || saving) return;
    setSaving(true);
    try {
      const updated = await api.post<JobOrder>(`/job-orders/${order.id}/payments`, {
        amount: parsedAmount,
        method,
      });
      onRecorded(updated);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "The payment could not be recorded.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      title="Record and confirm payment"
      description={`Verify the payment received for ${order.name} (${order.number}). A fully paid job moves to Paid, ready for handoff.`}
      onClose={onClose}
      busy={saving}
      status={error ? "error" : saving ? "loading" : "idle"}
      className="job-payment-modal"
    >
      <form className="job-payment-form" onSubmit={handleSubmit} noValidate>
        <div className="job-payment-summary">
          <div><span>Order total</span><strong className="numeric">{formatCurrency(order.total)}</strong></div>
          <div><span>Already paid</span><strong className="numeric">{formatCurrency(order.amountPaid)}</strong></div>
          <div><span>Outstanding</span><strong className="numeric">{formatCurrency(outstanding)}</strong></div>
        </div>
        <div className="job-payment-fields">
          <label className="form-field">
            <span>Amount received</span>
            <div className="job-payment-amount"><span>₱</span><input autoFocus type="number" min="0.01" max={outstanding} step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} aria-invalid={submitted && amountInvalid} /></div>
            {submitted && amountInvalid && <small className="workspace-form__error">Enter an amount between ₱0.01 and {formatCurrency(outstanding)}.</small>}
          </label>
          <label className="form-field">
            <span>Payment method</span>
            <select value={method} onChange={(event) => setMethod(event.target.value as Payment["method"])}>
              <option value="cash">Cash</option>
              <option value="online">Online payment</option>
              <option value="bank_transfer">Bank transfer</option>
              <option value="other">Other</option>
            </select>
          </label>
        </div>
        <p className="job-payment-confirmation">Recording this payment confirms that the owner has verified it. Partial payments keep this job in Ready until the balance is fully paid.</p>
        {error && <p className="workspace-form__error" role="alert">{error}</p>}
        <footer className="job-order-form__actions">
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" variant="primary" loading={saving}>Record payment</Button>
        </footer>
      </form>
    </Modal>
  );
}
