import { FormEvent, useEffect, useState } from "react";
import { Button } from "../../components/Button/Button";
import { Card, CardHeader } from "../../components/Card/Card";
import { ErrorState } from "../../components/ErrorState/ErrorState";
import { LoadingState } from "../../components/LoadingState/LoadingState";
import { Modal } from "../../components/Modal/Modal";
import { api } from "../../lib/apiClient";
import "./PricingAdjustments.css";

type PricingVariable = {
  id: string;
  name: string;
  calculationType: "percentage" | "fixed";
  value: number;
  isActive: boolean;
};

const emptyForm = { name: "", calculationType: "percentage" as const, value: "", isActive: true };

export function GlobalPricingVariables({ onChanged }: { onChanged?: () => void }) {
  const [items, setItems] = useState<PricingVariable[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<PricingVariable | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<{ name: string; calculationType: "percentage" | "fixed"; value: string; isActive: boolean }>(emptyForm);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try { setItems(await api.get<PricingVariable[]>("/document-analyzer/pricing-variables")); setError(null); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Pricing variables could not be loaded."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  function showEditor(item?: PricingVariable) {
    setEditing(item ?? null);
    setForm(item ? { name: item.name, calculationType: item.calculationType, value: String(item.value), isActive: item.isActive } : emptyForm);
    setError(null);
    setOpen(true);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const value = Number(form.value);
    if (!form.name.trim() || !Number.isFinite(value) || value < 0) return;
    setSaving(true);
    try {
      const body = { ...form, name: form.name.trim(), value };
      if (editing) await api.put(`/document-analyzer/pricing-variables/${editing.id}`, body);
      else await api.post("/document-analyzer/pricing-variables", body);
      setOpen(false);
      await load();
      onChanged?.();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The pricing variable could not be saved."); }
    finally { setSaving(false); }
  }

  async function remove(item: PricingVariable) {
    if (!window.confirm(`Remove “${item.name}”? Existing job prices will not change.`)) return;
    try { await api.del(`/document-analyzer/pricing-variables/${item.id}`); await load(); onChanged?.(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "The pricing variable could not be removed."); }
  }

  return <>
    <Card className="pricing-variable-card">
      <CardHeader title="Global pricing variables" action={<Button variant="primary" size="sm" onClick={() => showEditor()}>Add variable</Button>} />
      <p className="settings-placeholder-text">Active variables are added to every newly calculated product price. Use a percentage for tax or a fixed amount for a standard surcharge.</p>
      {loading ? <LoadingState label="Loading pricing variables…" /> : null}
      {!loading && error ? <ErrorState description={error} onRetry={load} /> : null}
      {!loading && !error && items.length === 0 ? <p className="pricing-variable-empty">No global adjustments configured. Product prices remain unchanged.</p> : null}
      {!loading && items.length ? <div className="pricing-variable-list">
        {items.map((item) => <div className="pricing-variable-row" key={item.id}>
          <div><strong>{item.name}</strong><span>{item.calculationType === "percentage" ? `${item.value}% of product subtotal` : `₱${item.value.toFixed(2)} per priced product`}</span></div>
          <span className={item.isActive ? "is-active" : "is-inactive"}>{item.isActive ? "Active" : "Inactive"}</span>
          <div><Button size="sm" onClick={() => showEditor(item)}>Edit</Button><Button size="sm" variant="ghost" onClick={() => void remove(item)}>Remove</Button></div>
        </div>)}
      </div> : null}
    </Card>
    <Modal open={open} title={editing ? "Edit pricing variable" : "New pricing variable"} description="This adjustment will appear in each newly calculated product breakdown." onClose={() => setOpen(false)} busy={saving}>
      <form className="pricing-variable-form" onSubmit={save}>
        <label><span>Name</span><input autoFocus required maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Tax" /></label>
        <div className="settings-form__row">
          <label><span>Calculation</span><select value={form.calculationType} onChange={(e) => setForm({ ...form, calculationType: e.target.value as "percentage" | "fixed" })}><option value="percentage">Percentage</option><option value="fixed">Fixed amount</option></select></label>
          <label><span>{form.calculationType === "percentage" ? "Percentage" : "Amount (PHP)"}</span><input required type="number" min="0" step="0.01" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} /></label>
        </div>
        <label className="pricing-variable-toggle"><input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /><span>Apply to new pricing calculations</span></label>
        {error ? <p className="settings-form__error" role="alert">{error}</p> : null}
        <footer><Button type="button" variant="ghost" disabled={saving} onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" variant="primary" loading={saving}>Save variable</Button></footer>
      </form>
    </Modal>
  </>;
}
