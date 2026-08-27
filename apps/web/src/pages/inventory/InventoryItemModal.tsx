import { FormEvent, useEffect, useState } from "react";
import { Button } from "../../components/Button/Button";
import { Modal } from "../../components/Modal/Modal";
import { ApiError, api } from "../../lib/apiClient";
import type { InventoryItem, InventoryPaperSize } from "../../types/domain";
import "../workspaceForm.css";
import "./InventoryModals.css";

interface InventoryItemForm {
  name: string;
  category: string;
  unit: string;
  openingQuantity: string;
  reorderLevel: string;
  notes: string;
  paperSize: InventoryPaperSize | "";
  isActive: boolean;
}

function formFor(item: InventoryItem | null): InventoryItemForm {
  return {
    name: item?.name ?? "",
    category: item?.category ?? "",
    unit: item?.unit ?? "",
    openingQuantity: "0",
    reorderLevel: String(item?.reorderLevel ?? 0),
    notes: item?.notes ?? "",
    paperSize: item?.paperSize ?? "",
    isActive: item?.isActive ?? true,
  };
}

interface InventoryItemModalProps {
  open: boolean;
  item: InventoryItem | null;
  onClose: () => void;
  onSaved: (item: InventoryItem) => void;
}

export function InventoryItemModal({ open, item, onClose, onSaved }: InventoryItemModalProps) {
  const [form, setForm] = useState(() => formFor(item));
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setForm(formFor(item));
    setTouched({});
    setSubmitted(false);
    setSaveError(null);
  }, [open, item]);

  const showError = (field: string) => touched[field] || submitted;
  const nameError = showError("name") && !form.name.trim() ? "Enter a material name." : null;
  const categoryError = showError("category") && !form.category.trim() ? "Enter a material category." : null;
  const unitError = showError("unit") && !form.unit.trim() ? "Enter the unit used to count this material." : null;
  const openingNumber = Number(form.openingQuantity);
  const openingError = !item && submitted && (!Number.isFinite(openingNumber) || openingNumber < 0)
    ? "Enter an opening stock of zero or more."
    : null;
  const reorderNumber = Number(form.reorderLevel);
  const reorderError = submitted && (!Number.isFinite(reorderNumber) || reorderNumber < 0)
    ? "Enter a reorder level of zero or more."
    : null;

  function markTouched(field: string) {
    setTouched((current) => ({ ...current, [field]: true }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setSubmitted(true);
    setSaveError(null);
    if (
      !form.name.trim() ||
      !form.category.trim() ||
      !form.unit.trim() ||
      !Number.isFinite(reorderNumber) ||
      reorderNumber < 0 ||
      (!item && (!Number.isFinite(openingNumber) || openingNumber < 0))
    ) {
      window.requestAnimationFrame(() => {
        formElement.querySelector<HTMLElement>("[aria-invalid='true']")?.focus();
      });
      return;
    }

    const payload = {
      name: form.name.trim(),
      category: form.category.trim(),
      unit: form.unit.trim(),
      reorderLevel: reorderNumber,
      notes: form.notes.trim() || null,
      paperSize: form.paperSize || null,
      isActive: form.isActive,
    };

    setSaving(true);
    try {
      const saved = item
        ? await api.put<InventoryItem>(`/inventory-items/${item.id}`, payload)
        : await api.post<InventoryItem>("/inventory-items", { ...payload, openingQuantity: openingNumber });
      onSaved(saved);
    } catch (error) {
      setSaveError(
        error instanceof ApiError
          ? error.message
          : `The material wasn’t ${item ? "updated" : "registered"}. Review the fields and try again.`,
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      title={item ? "Edit material" : "Register material"}
      description={item ? "Update how this material is identified and monitored." : "Add a consumable used in day-to-day production."}
      busy={saving}
      status={saveError ? "error" : saving ? "loading" : "idle"}
      onClose={onClose}
      className="inventory-modal"
    >
      <form className="inventory-modal__form" onSubmit={handleSubmit} noValidate>
        <div className="inventory-modal__fields">
          <label className={`form-field${nameError ? " form-field--error" : ""}`}>
            <span>Material name</span>
            <input
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              onBlur={() => markTouched("name")}
              placeholder="Short paper"
              aria-invalid={Boolean(nameError)}
              aria-describedby="inventory-name-message"
              autoFocus
            />
            <span id="inventory-name-message" className={`form-field__message${nameError ? " form-field__message--error" : ""}`}>
              {nameError ?? "Use the material name staff recognize."}
            </span>
          </label>

          <div className="inventory-modal__row">
            <label className={`form-field${categoryError ? " form-field--error" : ""}`}>
              <span>Category</span>
              <input
                list="inventory-category-options"
                value={form.category}
                onChange={(event) => setForm({ ...form, category: event.target.value })}
                onBlur={() => markTouched("category")}
                placeholder="Paper"
                aria-invalid={Boolean(categoryError)}
                aria-describedby="inventory-category-message"
              />
              <datalist id="inventory-category-options">
                <option value="Paper" />
                <option value="Ink" />
                <option value="Toner" />
                <option value="Lamination" />
                <option value="Binding" />
                <option value="Packaging" />
              </datalist>
              <span id="inventory-category-message" className={`form-field__message${categoryError ? " form-field__message--error" : ""}`}>
                {categoryError ?? "Group similar materials for easier scanning."}
              </span>
            </label>

            <label className={`form-field${unitError ? " form-field--error" : ""}`}>
              <span>Unit of measure</span>
              <input
                list="inventory-unit-options"
                value={form.unit}
                onChange={(event) => setForm({ ...form, unit: event.target.value })}
                onBlur={() => markTouched("unit")}
                placeholder="sheet"
                aria-invalid={Boolean(unitError)}
                aria-describedby="inventory-unit-message"
              />
              <datalist id="inventory-unit-options">
                <option value="sheet" />
                <option value="ream" />
                <option value="piece" />
                <option value="milliliter" />
                <option value="bottle" />
                <option value="roll" />
                <option value="pack" />
                <option value="meter" />
              </datalist>
              <span id="inventory-unit-message" className={`form-field__message${unitError ? " form-field__message--error" : ""}`}>
                {unitError ?? "This unit is used in product assignments and stock history."}
              </span>
            </label>
          </div>

          <div className="inventory-modal__row">
            {!item ? (
              <label className={`form-field${openingError ? " form-field--error" : ""}`}>
                <span>Opening stock</span>
                <input
                  className="numeric"
                  type="number"
                  min="0"
                  step="any"
                  value={form.openingQuantity}
                  onChange={(event) => setForm({ ...form, openingQuantity: event.target.value })}
                  aria-invalid={Boolean(openingError)}
                  aria-describedby="inventory-opening-message"
                />
                <span id="inventory-opening-message" className={`form-field__message${openingError ? " form-field__message--error" : ""}`}>
                  {openingError ?? "The first recorded balance for this material."}
                </span>
              </label>
            ) : null}
            <label className={`form-field${reorderError ? " form-field--error" : ""}`}>
              <span>Reorder level</span>
              <input
                className="numeric"
                type="number"
                min="0"
                step="any"
                value={form.reorderLevel}
                onChange={(event) => setForm({ ...form, reorderLevel: event.target.value })}
                aria-invalid={Boolean(reorderError)}
                aria-describedby="inventory-reorder-message"
              />
              <span id="inventory-reorder-message" className={`form-field__message${reorderError ? " form-field__message--error" : ""}`}>
                {reorderError ?? "Stock at or below this level needs attention."}
              </span>
            </label>
          </div>

          <label className="form-field">
            <span>Paper size <small>(optional)</small></span>
            <select
              value={form.paperSize}
              onChange={(event) => setForm({ ...form, paperSize: event.target.value as InventoryPaperSize | "" })}
            >
              <option value="">Not a paper stock</option>
              <option value="A4">A4</option>
              <option value="Letter">Letter</option>
              <option value="Legal">Legal</option>
            </select>
            <span className="form-field__message">
              Tag this item as A4, Letter, or Legal to price the Document Analyzer and product rates by size.
            </span>
          </label>

          <label className="form-field">
            <span>Notes</span>
            <textarea
              rows={3}
              value={form.notes}
              onChange={(event) => setForm({ ...form, notes: event.target.value })}
              placeholder="Brand, color, storage location, or supplier details"
            />
            <span className="form-field__message">Optional operational details.</span>
          </label>

          <label className="inventory-modal__check">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(event) => setForm({ ...form, isActive: event.target.checked })}
            />
            <span>Active material</span>
          </label>

          {saveError ? <p className="workspace-form__error" role="alert">{saveError}</p> : null}
        </div>

        <footer className="inventory-modal__actions">
          <Button type="button" variant="ghost" disabled={saving} onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={saving}>{item ? "Save changes" : "Register material"}</Button>
        </footer>
      </form>
    </Modal>
  );
}
