import { FormEvent, useEffect, useState } from "react";
import { Button } from "../../components/Button/Button";
import { Modal } from "../../components/Modal/Modal";
import { api, ApiError } from "../../lib/apiClient";
import type { ExpenseLedgerEntry } from "../../types/domain";

const suggestedCategories = ["Utilities", "Rent", "Equipment", "Repairs", "Delivery", "Marketing", "Labor", "Software", "Transport", "Other"];

function todayValue(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

interface EditorProps {
  open: boolean;
  expense: ExpenseLedgerEntry | null;
  categories: string[];
  onClose: () => void;
  onSaved: () => void;
}

export function ExpenseEditorModal({ open, expense, categories, onClose, onSaved }: EditorProps) {
  const [form, setForm] = useState({ category: "", description: "", amount: "", paidTo: "", reference: "", notes: "", spentOn: todayValue() });
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const amount = Number(form.amount);
  const hasInvalidAmount = !Number.isFinite(amount) || amount <= 0 || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.000001;
  const categoryInvalid = submitted && !form.category.trim();
  const descriptionInvalid = submitted && !form.description.trim();
  const amountInvalid = submitted && hasInvalidAmount;
  const dateInvalid = submitted && (!form.spentOn || form.spentOn > todayValue());

  useEffect(() => {
    if (!open) return;
    setForm(expense ? {
      category: expense.category,
      description: expense.description,
      amount: String(expense.amount),
      paidTo: expense.paidTo ?? "",
      reference: expense.reference ?? "",
      notes: expense.notes ?? "",
      spentOn: expense.spentOn,
    } : { category: "", description: "", amount: "", paidTo: "", reference: "", notes: "", spentOn: todayValue() });
    setSubmitted(false);
    setSaving(false);
    setError(null);
  }, [open, expense]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    if (!form.category.trim() || !form.description.trim() || hasInvalidAmount || !form.spentOn || form.spentOn > todayValue()) return;
    setSaving(true);
    setError(null);
    const payload = { ...form, category: form.category.trim(), description: form.description.trim(), amount, paidTo: form.paidTo.trim() || null, reference: form.reference.trim() || null, notes: form.notes.trim() || null };
    try {
      if (expense) await api.put(`/expenses/${expense.id}`, payload);
      else await api.post("/expenses", payload);
      onSaved();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "The expense could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  const categoryOptions = Array.from(new Set([...suggestedCategories, ...categories.filter((item) => item !== "Stock purchase")])).sort();
  return (
    <Modal open={open} title={expense ? "Edit expense" : "Record expense"} description="Record operating costs here. Material purchases remain in the stock-purchase ledger." onClose={onClose} busy={saving} status={error ? "error" : saving ? "loading" : "idle"} className="expense-modal">
      <form className="expense-form" onSubmit={submit} noValidate>
        <div className="expense-form__fields">
          <div className="expense-form__row">
            <label className={`form-field${categoryInvalid ? " form-field--error" : ""}`}><span>Category</span><input autoFocus list="expense-category-options" maxLength={100} value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} aria-invalid={categoryInvalid} aria-describedby={categoryInvalid ? "expense-category-error" : undefined} placeholder="Utilities, rent, repairs…" /><datalist id="expense-category-options">{categoryOptions.map((item) => <option key={item} value={item} />)}</datalist><small id="expense-category-error" className={`form-field__message${categoryInvalid ? " form-field__message--error" : ""}`}>{categoryInvalid ? "Enter an expense category." : "Choose a suggestion or type a new category."}</small></label>
            <label className={`form-field${dateInvalid ? " form-field--error" : ""}`}><span>Date paid</span><input type="date" max={todayValue()} value={form.spentOn} onChange={(event) => setForm({ ...form, spentOn: event.target.value })} aria-invalid={dateInvalid} aria-describedby={dateInvalid ? "expense-date-error" : undefined} /><small id="expense-date-error" className={`form-field__message${dateInvalid ? " form-field__message--error" : ""}`}>{dateInvalid ? "Choose today or an earlier date." : "The date the money was spent."}</small></label>
          </div>
          <label className={`form-field${descriptionInvalid ? " form-field--error" : ""}`}><span>Description</span><input maxLength={240} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} aria-invalid={descriptionInvalid} aria-describedby={descriptionInvalid ? "expense-description-error" : undefined} placeholder="Monthly electricity bill" /><small id="expense-description-error" className={`form-field__message${descriptionInvalid ? " form-field__message--error" : ""}`}>{descriptionInvalid ? "Describe what the expense was for." : "A clear description for later review."}</small></label>
          <div className="expense-form__row">
            <label className={`form-field${amountInvalid ? " form-field--error" : ""}`}><span>Amount paid</span><input type="number" min="0.01" step="0.01" inputMode="decimal" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} aria-invalid={amountInvalid} aria-describedby={amountInvalid ? "expense-amount-error" : undefined} placeholder="0.00" /><small id="expense-amount-error" className={`form-field__message${amountInvalid ? " form-field__message--error" : ""}`}>{amountInvalid ? "Enter an amount above zero with up to two decimals." : "Philippine peso amount."}</small></label>
            <label className="form-field"><span>Paid to</span><input maxLength={200} value={form.paidTo} onChange={(event) => setForm({ ...form, paidTo: event.target.value })} placeholder="Supplier or payee" /><small className="form-field__message">Optional</small></label>
          </div>
          <label className="form-field"><span>Receipt or reference</span><input maxLength={200} value={form.reference} onChange={(event) => setForm({ ...form, reference: event.target.value })} placeholder="OR number, invoice, transfer ID…" /><small className="form-field__message">Optional</small></label>
          <label className="form-field"><span>Notes</span><textarea rows={3} maxLength={1000} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /><small className="form-field__message">Optional context for reconciliation.</small></label>
          {error && <p className="expense-form__error" role="alert">{error}</p>}
        </div>
        <footer><Button type="button" variant="ghost" disabled={saving} onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" loading={saving}>{expense ? "Save changes" : "Record expense"}</Button></footer>
      </form>
    </Modal>
  );
}

export function ExpenseDeleteModal({ expense, onClose, onDeleted }: { expense: ExpenseLedgerEntry | null; onClose: () => void; onDeleted: () => void }) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (expense) { setDeleting(false); setError(null); } }, [expense]);
  async function remove() {
    if (!expense) return;
    setDeleting(true);
    setError(null);
    try { await api.del(`/expenses/${expense.id}`); onDeleted(); }
    catch (caught) { setError(caught instanceof ApiError ? caught.message : "The expense could not be removed."); }
    finally { setDeleting(false); }
  }
  return <Modal open={Boolean(expense)} title="Remove expense?" description="This permanently removes the operating-expense record." onClose={onClose} busy={deleting} status={error ? "error" : deleting ? "loading" : "idle"} className="expense-delete-modal"><div className="expense-delete"><p>{expense?.description}</p>{error && <p className="expense-form__error" role="alert">{error}</p>}<footer><Button type="button" variant="ghost" disabled={deleting} onClick={onClose}>Cancel</Button><Button type="button" variant="danger" loading={deleting} onClick={remove}>Remove expense</Button></footer></div></Modal>;
}
