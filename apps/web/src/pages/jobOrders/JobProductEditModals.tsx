import { FormEvent, useEffect, useState } from "react";
import { Button } from "../../components/Button/Button";
import { Modal } from "../../components/Modal/Modal";
import { ApiError, api } from "../../lib/apiClient";
import { formatCurrency } from "../../lib/format";
import type { JobOrder, JobOrderItem, Product } from "../../types/domain";
import "../workspaceForm.css";
import "./JobOrderModals.css";

export function JobProductPriceModal({ open, order, item, onClose, onUpdated }: { open: boolean; order: JobOrder; item: JobOrderItem; onClose: () => void; onUpdated: (order: JobOrder) => void }) {
  const [price, setPrice] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setPrice(String(item.lineTotal)); setReason(""); setSaving(false); setError(null); } }, [item.id, item.lineTotal, open]);
  const amount = Number(price);
  const valid = Number.isFinite(amount) && amount >= 0 && reason.trim().length >= 3;
  async function save() {
    if (!valid || saving) return;
    setSaving(true); setError(null);
    try { onUpdated(await api.put<JobOrder>(`/job-orders/${order.id}/items/${item.id}/price`, { lineTotal: amount, reason: reason.trim() })); }
    catch (caught) { setError(caught instanceof ApiError ? caught.message : "The product price could not be changed."); }
    finally { setSaving(false); }
  }
  return <Modal open={open} title="Change product price" description={`${item.productName} · currently ${formatCurrency(item.lineTotal)}`} onClose={onClose} busy={saving} status={error ? "error" : saving ? "loading" : "idle"}>
    <div className="job-cancel-confirmation"><label className="form-field"><span>New line total</span><input autoFocus type="number" min="0" step="0.01" value={price} onChange={(event) => setPrice(event.target.value)} /><small>This replaces this product's total without changing its production configuration.</small></label><label className="form-field"><span>Reason</span><textarea rows={3} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why is the price changing?" /><small>Saved in the product audit history.</small></label>{error ? <p className="workspace-form__error" role="alert">{error}</p> : null}</div>
    <footer className="job-order-form__actions"><Button variant="ghost" disabled={saving} onClick={onClose}>Keep current price</Button><Button variant="primary" loading={saving} disabled={!valid} onClick={save}>Save product price</Button></footer>
  </Modal>;
}

export function JobProductCancelModal({ open, order, item, onClose, onUpdated }: { open: boolean; order: JobOrder; item: JobOrderItem; onClose: () => void; onUpdated: (order: JobOrder) => void }) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setReason(""); setSaving(false); setError(null); } }, [item.id, open]);
  async function cancel() {
    if (reason.trim().length < 3 || saving) return;
    setSaving(true); setError(null);
    try { onUpdated(await api.post<JobOrder>(`/job-orders/${order.id}/items/${item.id}/cancel`, { reason: reason.trim() })); }
    catch (caught) { setError(caught instanceof ApiError ? caught.message : "The product could not be cancelled."); }
    finally { setSaving(false); }
  }
  return <Modal open={open} title="Cancel product" description={`${item.productName} · ${formatCurrency(item.lineTotal)} will be removed`} onClose={onClose} busy={saving} status={error ? "error" : saving ? "loading" : "idle"}>
    <div className="job-cancel-confirmation"><p><strong>This cancels only this product.</strong> Its files, attempts, status history, and already-consumed inventory remain available for audit.</p><label className="form-field"><span>Cancellation reason</span><textarea autoFocus rows={3} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why is this product being cancelled?" /><small>Required for the audit history.</small></label>{error ? <p className="workspace-form__error" role="alert">{error}</p> : null}</div>
    <footer className="job-order-form__actions"><Button variant="ghost" disabled={saving} onClick={onClose}>Keep product</Button><Button variant="danger" loading={saving} disabled={reason.trim().length < 3} onClick={cancel}>Cancel product</Button></footer>
  </Modal>;
}

export function JobProductCorrectionModal({ open, order, item, products, onClose, onUpdated }: { open: boolean; order: JobOrder; item: JobOrderItem; products: Product[]; onClose: () => void; onUpdated: (order: JobOrder) => void }) {
  const compatibleProducts = products.filter((product) => product.isActive && product.operationKind === item.operationKind);
  const [productId, setProductId] = useState(item.productId);
  const [price, setPrice] = useState(String(item.lineTotal));
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setProductId(compatibleProducts.some((product) => product.id === item.productId) ? item.productId : compatibleProducts[0]?.id ?? "");
    setPrice(String(item.lineTotal));
    setReason("");
    setSaving(false);
    setSubmitted(false);
    setError(null);
  }, [item.id, item.lineTotal, item.productId, open]); // eslint-disable-line react-hooks/exhaustive-deps
  const amount = Number(price);
  const priceInvalid = price.trim() === "" || !Number.isFinite(amount) || amount < 0;
  const reasonInvalid = reason.trim().length < 3;
  async function save() {
    setSubmitted(true);
    if (!productId || priceInvalid || reasonInvalid || saving) return;
    setSaving(true);
    setError(null);
    try {
      onUpdated(await api.put<JobOrder>(`/job-orders/${order.id}/items/${item.id}/correction`, { productId, lineTotal: amount, reason: reason.trim() }));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "The product correction could not be saved.");
    } finally {
      setSaving(false);
    }
  }
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void save(); }
  return <Modal open={open} title="Correct product record" description="Update the recorded product and price without repeating production or changing consumed materials." onClose={onClose} busy={saving} status={error ? "error" : saving ? "loading" : "idle"}>
    <form onSubmit={submit} noValidate>
    <div className="job-cancel-confirmation">
      <p><strong>This is a record correction.</strong> Existing files, print attempts, quantities, and material consumption stay unchanged.</p>
      <label className={`form-field${submitted && !productId ? " form-field--error" : ""}`}><span>Correct product</span><select autoFocus value={productId} onChange={(event) => setProductId(event.target.value)} aria-invalid={submitted && !productId}><option value="">Select a product</option>{compatibleProducts.map((product) => <option value={product.id} key={product.id}>{product.serviceName} · {product.name}</option>)}</select><small>{submitted && !productId ? "Select a compatible product." : "Only products using the same production workflow are available."}</small></label>
      <label className={`form-field${submitted && priceInvalid ? " form-field--error" : ""}`}><span>Correct line total</span><input type="number" min="0" step="0.01" value={price} onChange={(event) => setPrice(event.target.value)} aria-invalid={submitted && priceInvalid} /><small>{submitted && priceInvalid ? "Enter zero or a positive amount." : `Currently ${formatCurrency(item.lineTotal)}.`}</small></label>
      <label className={`form-field${submitted && reasonInvalid ? " form-field--error" : ""}`}><span>Correction reason</span><textarea rows={3} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="What was recorded incorrectly?" aria-invalid={submitted && reasonInvalid} /><small>{submitted && reasonInvalid ? "Enter at least three characters." : "Saved permanently in the audit history."}</small></label>
      {error ? <p className="workspace-form__error" role="alert">{error}</p> : null}
    </div>
    <footer className="job-order-form__actions"><Button type="button" variant="ghost" disabled={saving} onClick={onClose}>Keep current record</Button><Button type="submit" variant="primary" loading={saving}>Save correction</Button></footer>
    </form>
  </Modal>;
}

export function JobVoidModal({ open, order, onClose, onUpdated }: { open: boolean; order: JobOrder; onClose: () => void; onUpdated: (order: JobOrder) => void }) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setReason(""); setSaving(false); setSubmitted(false); setError(null); } }, [open, order.id]);
  const invalid = reason.trim().length < 3;
  async function voidOrder() {
    setSubmitted(true);
    if (invalid || saving) return;
    setSaving(true);
    setError(null);
    try { onUpdated(await api.post<JobOrder>(`/job-orders/${order.id}/void`, { reason: reason.trim() })); }
    catch (caught) { setError(caught instanceof ApiError ? caught.message : "The transaction could not be reopened."); }
    finally { setSaving(false); }
  }
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void voidOrder(); }
  return <Modal open={open} title="Void and correct transaction" description={`${order.number} will return to the Ready payment step.`} onClose={onClose} busy={saving} status={error ? "error" : saving ? "loading" : "idle"}>
    <form onSubmit={submit} noValidate>
    <div className="job-cancel-confirmation">
      <p><strong>{formatCurrency(order.amountPaid)} in verified payments will be voided.</strong> Payment records remain visible for audit but are removed from sales totals. Production, files, and consumed inventory stay unchanged. OMS records the correction but does not issue a cash or bank refund.</p>
      <label className={`form-field${submitted && invalid ? " form-field--error" : ""}`}><span>Void reason</span><textarea autoFocus rows={3} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why does this transaction need correction?" aria-invalid={submitted && invalid} /><small>{submitted && invalid ? "Enter at least three characters." : "Required and saved in the transaction timeline."}</small></label>
      {error ? <p className="workspace-form__error" role="alert">{error}</p> : null}
    </div>
    <footer className="job-order-form__actions"><Button type="button" variant="ghost" disabled={saving} onClick={onClose}>Keep transaction closed</Button><Button type="submit" variant="danger" loading={saving}>Void payments and reopen</Button></footer>
    </form>
  </Modal>;
}
