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
  const [amountTouched, setAmountTouched] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsedAmount = Number(amount);
  const receivedAmount = Math.round(parsedAmount * 100) / 100;
  const hasFractionalCent = Number.isFinite(parsedAmount) && Math.abs(parsedAmount * 100 - Math.round(parsedAmount * 100)) > 0.000001;
  const amountInvalid = amount.trim() === "" || !Number.isFinite(parsedAmount) || receivedAmount < 0.01 || hasFractionalCent;
  const amountApplied = amountInvalid ? 0 : Math.min(receivedAmount, outstanding);
  const changeDue = amountInvalid ? 0 : Math.max(receivedAmount - outstanding, 0);
  const balanceAfterPayment = Math.max(outstanding - amountApplied, 0);

  useEffect(() => {
    if (!open) return;
    setAmount("");
    setMethod("cash");
    setAmountTouched(false);
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
        amount: amountApplied,
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
          <div className="form-field">
            <label htmlFor="customer-payment-amount">Customer amount paid</label>
            <div className="job-payment-amount"><span>₱</span><input id="customer-payment-amount" autoFocus type="number" inputMode="decimal" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} onBlur={() => setAmountTouched(true)} aria-describedby="customer-payment-help" aria-invalid={(submitted || amountTouched) && amountInvalid} /><button type="button" onClick={() => { setAmount(outstanding.toFixed(2)); setAmountTouched(true); }} disabled={saving}>Exact amount</button></div>
            {(submitted || amountTouched) && amountInvalid ? <small id="customer-payment-help" className="workspace-form__error">Enter at least ₱0.01 with no more than two decimal places.</small> : <small id="customer-payment-help">Enter the cash or payment received from the customer.</small>}
          </div>
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
        <div className="job-payment-result" aria-live="polite">
          <div><span>Applied to balance</span><strong className="numeric">{formatCurrency(amountApplied)}</strong></div>
          <div className={changeDue > 0 ? "has-change" : ""}><span>Change due</span><strong className="numeric">{formatCurrency(changeDue)}</strong></div>
          <div><span>Balance after payment</span><strong className="numeric">{formatCurrency(balanceAfterPayment)}</strong></div>
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
