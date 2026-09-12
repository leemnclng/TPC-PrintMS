import { FormEvent, useEffect, useMemo, useState } from "react";
import { Button } from "../../components/Button/Button";
import { Card, CardHeader } from "../../components/Card/Card";
import { ErrorState } from "../../components/ErrorState/ErrorState";
import { LoadingState } from "../../components/LoadingState/LoadingState";
import { Modal } from "../../components/Modal/Modal";
import { api } from "../../lib/apiClient";
import type { PricingDiscount, Product } from "../../types/domain";
import "./PricingAdjustments.css";

const blank = { name: "", calculationType: "percentage" as const, value: "", productIds: [] as string[], isActive: true };

export function PricingDiscounts({ products, onChanged }: { products: Product[]; onChanged?: () => void }) {
  const [items, setItems] = useState<PricingDiscount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PricingDiscount | null>(null);
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<{ name: string; calculationType: "percentage" | "fixed"; value: string; productIds: string[]; isActive: boolean }>(blank);

  async function load() {
    setLoading(true);
    try { setItems(await api.get<PricingDiscount[]>("/document-analyzer/pricing-discounts")); setError(null); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Discounts could not be loaded."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  const visibleProducts = useMemo(() => {
    const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    return products.filter((product) => words.every((word) => `${product.name} ${product.serviceName}`.toLowerCase().includes(word)));
  }, [products, query]);

  function showEditor(item?: PricingDiscount) {
    setEditing(item ?? null);
    setForm(item ? { name: item.name, calculationType: item.calculationType, value: String(item.value), productIds: item.productIds, isActive: item.isActive } : blank);
    setQuery(""); setError(null); setOpen(true);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const value = Number(form.value);
    if (!form.name.trim() || !Number.isFinite(value) || value < 0 || !form.productIds.length) return;
    setSaving(true);
    try {
      const body = { ...form, name: form.name.trim(), value };
      if (editing) await api.put(`/document-analyzer/pricing-discounts/${editing.id}`, body);
      else await api.post("/document-analyzer/pricing-discounts", body);
      setOpen(false); await load(); onChanged?.();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The discount could not be saved."); }
    finally { setSaving(false); }
  }

  async function remove(item: PricingDiscount) {
    if (!window.confirm(`Remove “${item.name}”? Existing job totals will not change.`)) return;
    try { await api.del(`/document-analyzer/pricing-discounts/${item.id}`); await load(); onChanged?.(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "The discount could not be removed."); }
  }

  return <>
    <Card className="pricing-variable-card">
      <CardHeader title="Product discounts" action={<Button variant="primary" size="sm" onClick={() => showEditor()}>Add discount</Button>} />
      <p className="settings-placeholder-text">Create reusable reductions and assign them only to the products that qualify. Active discounts are included automatically in new estimates.</p>
      {loading ? <LoadingState label="Loading discounts…" /> : null}
      {!loading && error ? <ErrorState description={error} onRetry={load} /> : null}
      {!loading && !error && !items.length ? <p className="pricing-variable-empty">No discounts configured.</p> : null}
      {!loading && items.length ? <div className="pricing-variable-list">{items.map((item) => <div className="pricing-variable-row" key={item.id}>
        <div><strong>{item.name}</strong><span>{item.calculationType === "percentage" ? `${item.value}% off` : `₱${item.value.toFixed(2)} off`} · {item.productIds.length} {item.productIds.length === 1 ? "product" : "products"}</span></div>
        <span className={item.isActive ? "is-active" : "is-inactive"}>{item.isActive ? "Active" : "Inactive"}</span>
        <div><Button size="sm" onClick={() => showEditor(item)}>Edit</Button><Button size="sm" variant="ghost" onClick={() => void remove(item)}>Remove</Button></div>
      </div>)}</div> : null}
    </Card>
    <Modal open={open} title={editing ? "Edit discount" : "New product discount"} description="The reduction applies automatically to each selected product's new calculated price." onClose={() => setOpen(false)} busy={saving} className="pricing-discount-modal">
      <form className="pricing-variable-form" onSubmit={save}>
        <label><span>Name</span><input autoFocus required maxLength={120} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Senior discount" /></label>
        <div className="settings-form__row">
          <label><span>Calculation</span><select value={form.calculationType} onChange={(event) => setForm({ ...form, calculationType: event.target.value as "percentage" | "fixed" })}><option value="percentage">Percentage</option><option value="fixed">Fixed amount</option></select></label>
          <label><span>{form.calculationType === "percentage" ? "Percentage off" : "Amount off (PHP)"}</span><input required type="number" min="0" step="0.01" value={form.value} onChange={(event) => setForm({ ...form, value: event.target.value })} /></label>
        </div>
        <fieldset className="pricing-discount-products"><legend>Applied products <small>{form.productIds.length} selected</small></legend><input type="search" aria-label="Find products" placeholder="Find product or service…" value={query} onChange={(event) => setQuery(event.target.value)} /><div>{visibleProducts.map((product) => <label key={product.id}><input type="checkbox" checked={form.productIds.includes(product.id)} onChange={(event) => setForm((current) => ({ ...current, productIds: event.target.checked ? [...current.productIds, product.id] : current.productIds.filter((id) => id !== product.id) }))} /><span><strong>{product.name}</strong><small>{product.serviceName}</small></span></label>)}{!visibleProducts.length ? <p>No matching products.</p> : null}</div>{!form.productIds.length ? <p className="settings-form__error">Select at least one product.</p> : null}</fieldset>
        <label className="pricing-variable-toggle"><input type="checkbox" checked={form.isActive} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} /><span>Apply this discount to new calculations</span></label>
        {error ? <p className="settings-form__error" role="alert">{error}</p> : null}
        <footer><Button type="button" variant="ghost" disabled={saving} onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" variant="primary" loading={saving} disabled={!form.productIds.length}>Save discount</Button></footer>
      </form>
    </Modal>
  </>;
}
