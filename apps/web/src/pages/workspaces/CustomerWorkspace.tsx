import { FormEvent, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { PageHeader } from "../../components/PageHeader/PageHeader";
import { Card, CardHeader } from "../../components/Card/Card";
import { Button } from "../../components/Button/Button";
import { LoadingState } from "../../components/LoadingState/LoadingState";
import { ErrorState } from "../../components/ErrorState/ErrorState";
import { EmptyState } from "../../components/EmptyState/EmptyState";
import { useResource } from "../../hooks/useResource";
import { api, ApiError } from "../../lib/apiClient";
import type { Customer, SourceChannel } from "../../types/domain";
import "../workspaceForm.css";

const CHANNELS: { value: SourceChannel; label: string }[] = [
  { value: "walk_in", label: "Walk-in" },
  { value: "messenger", label: "Messenger" },
  { value: "gmail", label: "Gmail" },
  { value: "form", label: "Form" },
  { value: "phone", label: "Phone" },
  { value: "other", label: "Other" },
];

type FormState = {
  displayName: string;
  contactName: string;
  email: string;
  phone: string;
  sourceChannel: SourceChannel;
  notes: string;
};

const BLANK: FormState = {
  displayName: "",
  contactName: "",
  email: "",
  phone: "",
  sourceChannel: "walk_in",
  notes: "",
};

export function CustomerWorkspace() {
  const { customerId } = useParams();
  const isNew = !customerId;
  const navigate = useNavigate();

  const { data, state, error } = useResource(
    () => (isNew ? Promise.resolve(null) : api.get<Customer>(`/customers/${customerId}`)),
    [customerId],
  );

  const [form, setForm] = useState<FormState>(BLANK);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (data) {
      setForm({
        displayName: data.displayName,
        contactName: data.contactName ?? "",
        email: data.email ?? "",
        phone: data.phone ?? "",
        sourceChannel: data.sourceChannel,
        notes: data.notes ?? "",
      });
    }
  }, [data]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    try {
      if (isNew) {
        const created = await api.post<Customer>("/customers", form);
        navigate(`/customers/${created.id}`, { replace: true });
      } else {
        await api.put<Customer>(`/customers/${customerId}`, form);
        navigate("/customers");
      }
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Couldn't save.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!customerId) return;
    if (!window.confirm(`Remove ${form.displayName || "this customer"}? This can't be undone.`)) return;
    await api.del(`/customers/${customerId}`);
    navigate("/customers");
  }

  if (!isNew && state === "loading") return <LoadingState label="Loading customer…" />;
  if (!isNew && state === "error") return <ErrorState description={error ?? undefined} />;
  if (!isNew && state === "ready" && !data) {
    return <EmptyState title="Customer not found" description="It may have been removed." />;
  }

  return (
    <>
      <PageHeader
        eyebrow="CUSTOMERS"
        title={isNew ? "New customer" : data?.displayName ?? "Customer"}
        description={isNew ? "Add contact details for a new customer." : "Contact details and history."}
      />

      <Card>
        <CardHeader title="Contact" />
        <form className="workspace-form" onSubmit={handleSubmit}>
          <label className="form-field">
            <span>Display name</span>
            <input
              value={form.displayName}
              onChange={(e) => setForm({ ...form, displayName: e.target.value })}
              required
              autoFocus
            />
          </label>
          <div className="workspace-form__row">
            <label className="form-field">
              <span>Contact person</span>
              <input value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} />
            </label>
            <label className="form-field">
              <span>Source channel</span>
              <select
                value={form.sourceChannel}
                onChange={(e) => setForm({ ...form, sourceChannel: e.target.value as SourceChannel })}
              >
                {CHANNELS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="workspace-form__row">
            <label className="form-field">
              <span>Email</span>
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </label>
            <label className="form-field">
              <span>Phone</span>
              <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </label>
          </div>
          <label className="form-field">
            <span>Notes</span>
            <textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </label>

          <div className="workspace-form__actions">
            <Button type="submit" variant="primary" loading={saving}>
              {isNew ? "Create customer" : "Save changes"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => navigate("/customers")}>
              Cancel
            </Button>
            {!isNew && (
              <Button type="button" variant="danger" onClick={handleDelete}>
                Remove customer
              </Button>
            )}
            {saveError && <span className="workspace-form__error">{saveError}</span>}
          </div>
        </form>
      </Card>

      {!isNew && data && (
        <Card>
          <CardHeader title="Linked history" />
          <div className="workspace-linked-stats">
            <span>
              <strong className="numeric">{data.quotationCount}</strong> quotations
            </span>
            <span>
              <strong className="numeric">{data.jobOrderCount}</strong> job orders
            </span>
          </div>
        </Card>
      )}
    </>
  );
}
