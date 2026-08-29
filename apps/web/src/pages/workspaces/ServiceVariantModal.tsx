import { FormEvent, useEffect, useState } from "react";
import { Button } from "../../components/Button/Button";
import { Modal } from "../../components/Modal/Modal";
import { ApiError, api } from "../../lib/apiClient";
import type { Variant } from "../../types/domain";
import "../workspaceForm.css";
import "./ServiceVariantsWorkspace.css";

interface VariantForm {
  label: string;
  description: string;
  isActive: boolean;
  requiresManualDuplex: boolean;
}

function formFor(variant: Variant | null): VariantForm {
  return {
    label: variant?.label ?? "",
    description: variant?.description ?? "",
    isActive: variant?.isActive ?? true,
    requiresManualDuplex: variant?.requiresManualDuplex ?? false,
  };
}

interface VariantModalProps {
  open: boolean;
  variant: Variant | null;
  onClose: () => void;
  onSaved: (variant: Variant) => void;
}

export function VariantModal({
  open,
  variant,
  onClose,
  onSaved,
}: VariantModalProps) {
  const [form, setForm] = useState(() => formFor(variant));
  const [nameTouched, setNameTouched] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setForm(formFor(variant));
    setNameTouched(false);
    setSubmitted(false);
    setSaveError(null);
  }, [open, variant]);

  const labelError = (nameTouched || submitted) && !form.label.trim()
    ? "Enter a variant name."
    : null;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setSubmitted(true);
    setSaveError(null);
    if (!form.label.trim()) {
      window.requestAnimationFrame(() => {
        formElement.querySelector<HTMLElement>("[aria-invalid='true']")?.focus();
      });
      return;
    }

    const payload = {
      label: form.label.trim(),
      description: form.description.trim() || null,
      isActive: form.isActive,
      requiresManualDuplex: form.requiresManualDuplex,
    };
    setSaving(true);
    try {
      const saved = variant
        ? await api.put<Variant>(`/variants/${variant.id}`, payload)
        : await api.post<Variant>("/variants", payload);
      onSaved(saved);
    } catch (error) {
      setSaveError(
        error instanceof ApiError
          ? error.message
          : `The variant wasn’t ${variant ? "updated" : "created"}. Review the fields and try again.`,
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      title={variant ? "Edit variant" : "New variant"}
      description="Define one reusable option for products in any service. Product-specific pricing is set when assigning it."
      busy={saving}
      status={saveError ? "error" : saving ? "loading" : "idle"}
      onClose={onClose}
      className="service-variant-modal"
    >
      <form className="service-variant-modal__form" onSubmit={handleSubmit} noValidate>
        <div className="service-variant-modal__fields">
          <label className={`form-field${labelError ? " form-field--error" : ""}`}>
            <span>Variant name</span>
            <input
              value={form.label}
              onChange={(event) => setForm({ ...form, label: event.target.value })}
              onBlur={() => setNameTouched(true)}
              placeholder="Back-to-back"
              aria-invalid={Boolean(labelError)}
              aria-describedby="service-variant-name-message"
              autoFocus
            />
            <span
              id="service-variant-name-message"
              className={`form-field__message${labelError ? " form-field__message--error" : ""}`}
            >
              {labelError ?? "Use a short option name staff will recognize across products."}
            </span>
          </label>

          <label className="form-field">
            <span>Description <small>(optional)</small></span>
            <textarea
              rows={3}
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
              placeholder="Prints content on both sides of each sheet"
            />
            <span className="form-field__message">Explain when staff should choose this option.</span>
          </label>

          <label className="service-variant-modal__check">
            <input
              type="checkbox"
              checked={form.requiresManualDuplex}
              onChange={(event) => setForm({ ...form, requiresManualDuplex: event.target.checked })}
            />
            <span><strong>Supervised back-to-back printing</strong><small>Print fronts, pause for paper reinsertion, then print backs.</small></span>
          </label>

          <label className="service-variant-modal__check">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(event) => setForm({ ...form, isActive: event.target.checked })}
            />
            <span>Available for product assignment</span>
          </label>

          {saveError ? <p className="workspace-form__error" role="alert">{saveError}</p> : null}
        </div>
        <footer className="service-variant-modal__actions">
          <Button type="button" variant="ghost" disabled={saving} onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={saving}>
            {variant ? "Save changes" : "Create variant"}
          </Button>
        </footer>
      </form>
    </Modal>
  );
}
