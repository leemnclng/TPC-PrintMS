import { FormEvent, useEffect, useState } from "react";
import { Button } from "../../components/Button/Button";
import { Modal } from "../../components/Modal/Modal";
import { ApiError, api } from "../../lib/apiClient";
import { formatCurrency } from "../../lib/format";
import {
  PAPER_SIZE_DEFINITIONS,
  PAPER_SIZE_GROUPS,
  paperSizeDefinition,
  paperSizeDimensions,
} from "../../lib/paperSizes";
import type { InventoryItem, InventoryPaperSize } from "../../types/domain";
import "../workspaceForm.css";
import "./InventoryModals.css";

interface InventoryItemForm {
  name: string;
  category: string;
  unit: string;
  openingQuantity: string;
  reorderLevel: string;
  purchasePrice: string;
  purchasePriceBasis: "unit" | "ream";
  sheetsPerReam: string;
  notes: string;
  paperSize: InventoryPaperSize | "";
  paperWidthMm: string;
  paperHeightMm: string;
  isActive: boolean;
}

const INVENTORY_UNIT_OPTIONS = [
  { value: "sheet", label: "Sheet" },
  { value: "ream", label: "Ream" },
  { value: "bottle", label: "Bottle" },
  { value: "cartridge", label: "Cartridge" },
  { value: "roll", label: "Roll" },
  { value: "pack", label: "Pack" },
  { value: "piece", label: "Piece" },
] as const;

function isSupportedUnit(unit: string) {
  return INVENTORY_UNIT_OPTIONS.some((option) => option.value === unit.trim().toLowerCase());
}

function isSheetUnit(unit: string) {
  return ["sheet", "sheets"].includes(unit.trim().toLowerCase());
}

function formFor(item: InventoryItem | null): InventoryItemForm {
  const storedUnit = item?.unit ?? "";
  return {
    name: item?.name ?? "",
    category: item?.category ?? "",
    unit: isSupportedUnit(storedUnit) ? storedUnit.trim().toLowerCase() : storedUnit,
    openingQuantity: "0",
    reorderLevel: String(item?.reorderLevel ?? 0),
    purchasePrice: item?.purchasePrice == null ? "" : String(item.purchasePrice),
    purchasePriceBasis: item?.purchasePriceBasis ?? "unit",
    sheetsPerReam: String(item?.sheetsPerReam ?? 500),
    notes: item?.notes ?? "",
    paperSize: item?.paperSize ?? "",
    paperWidthMm: item?.paperWidthMm == null ? "" : String(item.paperWidthMm),
    paperHeightMm: item?.paperHeightMm == null ? "" : String(item.paperHeightMm),
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
  const unitError = showError("unit")
    ? !form.unit.trim()
      ? "Select the unit used to count this material."
      : !isSupportedUnit(form.unit)
        ? "Choose one of the supported printing-material units."
        : null
    : null;
  const openingNumber = Number(form.openingQuantity);
  const openingError = !item && submitted && (!Number.isFinite(openingNumber) || openingNumber < 0)
    ? "Enter an opening stock of zero or more."
    : null;
  const reorderNumber = Number(form.reorderLevel);
  const reorderError = submitted && (!Number.isFinite(reorderNumber) || reorderNumber < 0)
    ? "Enter a reorder level of zero or more."
    : null;
  const supportsReamCost = isSheetUnit(form.unit);
  const purchasePriceNumber = form.purchasePrice.trim() === "" ? null : Number(form.purchasePrice);
  const purchasePriceError = showError("purchasePrice")
    && purchasePriceNumber !== null
    && (!Number.isFinite(purchasePriceNumber) || purchasePriceNumber < 0)
    ? "Enter a purchase price of zero or more, or leave it blank."
    : null;
  const sheetsPerReamNumber = Number(form.sheetsPerReam);
  const sheetsPerReamError = form.purchasePriceBasis === "ream"
    && showError("sheetsPerReam")
    && (!Number.isInteger(sheetsPerReamNumber) || sheetsPerReamNumber <= 0)
    ? "Enter the positive whole number of sheets supplied in one ream."
    : null;
  const perSheetCost = form.purchasePriceBasis === "ream"
    && purchasePriceNumber !== null
    && Number.isFinite(purchasePriceNumber)
    && purchasePriceNumber >= 0
    && Number.isInteger(sheetsPerReamNumber)
    && sheetsPerReamNumber > 0
    ? purchasePriceNumber / sheetsPerReamNumber
    : null;
  const selectedPaperDefinition = paperSizeDefinition(form.paperSize);
  const customPaperWidth = Number(form.paperWidthMm);
  const customPaperHeight = Number(form.paperHeightMm);
  const customShortEdge = Math.min(customPaperWidth, customPaperHeight);
  const customLongEdge = Math.max(customPaperWidth, customPaperHeight);
  const paperSizeError = form.paperSize === "Custom" && (submitted || showError("paperDimensions"))
    ? !Number.isFinite(customPaperWidth) || !Number.isFinite(customPaperHeight) || customPaperWidth <= 0 || customPaperHeight <= 0
      ? "Enter both custom dimensions."
      : customShortEdge < 55 || customShortEdge > 216 || customLongEdge < 89 || customLongEdge > 1200
        ? "Custom paper must be 55–216 mm on its short edge and 89–1200 mm on its long edge."
        : null
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
      !isSupportedUnit(form.unit) ||
      !Number.isFinite(reorderNumber) ||
      reorderNumber < 0 ||
      (purchasePriceNumber !== null && (!Number.isFinite(purchasePriceNumber) || purchasePriceNumber < 0)) ||
      (form.purchasePriceBasis === "ream" && (!supportsReamCost || !Number.isInteger(sheetsPerReamNumber) || sheetsPerReamNumber <= 0)) ||
      Boolean(paperSizeError) ||
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
      purchasePrice: purchasePriceNumber,
      purchasePriceBasis: supportsReamCost ? form.purchasePriceBasis : "unit",
      sheetsPerReam: supportsReamCost && form.purchasePriceBasis === "ream" ? sheetsPerReamNumber : null,
      notes: form.notes.trim() || null,
      paperSize: form.paperSize || null,
      paperWidthMm: form.paperSize === "Custom" ? customShortEdge : selectedPaperDefinition?.widthMm ?? null,
      paperHeightMm: form.paperSize === "Custom" ? customLongEdge : selectedPaperDefinition?.heightMm ?? null,
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
              <select
                value={form.unit}
                onChange={(event) => {
                  const unit = event.target.value;
                  setForm({
                    ...form,
                    unit,
                    purchasePriceBasis: isSheetUnit(unit) ? form.purchasePriceBasis : "unit",
                  });
                }}
                onBlur={() => markTouched("unit")}
                aria-invalid={Boolean(unitError)}
                aria-describedby="inventory-unit-message"
              >
                <option value="" disabled>Select a unit</option>
                {form.unit && !isSupportedUnit(form.unit) ? (
                  <option value={form.unit} disabled>{form.unit} · choose a replacement</option>
                ) : null}
                {INVENTORY_UNIT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <span id="inventory-unit-message" className={`form-field__message${unitError ? " form-field__message--error" : ""}`}>
                {unitError ?? "Use Sheet or Ream for paper; use the closest packaged unit for other print supplies."}
              </span>
            </label>
          </div>

          <section className="inventory-modal__cost" aria-labelledby="inventory-cost-title">
            <div>
              <span id="inventory-cost-title" className="numeric">COST REFERENCE</span>
              <p>Track what the business currently pays without changing customer-facing product prices.</p>
            </div>
            <div className="inventory-modal__cost-fields">
              {supportsReamCost ? (
                <label className="form-field">
                  <span>Cost applies to</span>
                  <select
                    value={form.purchasePriceBasis}
                    onChange={(event) => setForm({ ...form, purchasePriceBasis: event.target.value as "unit" | "ream" })}
                  >
                    <option value="unit">Per sheet</option>
                    <option value="ream">Whole ream</option>
                  </select>
                  <span className="form-field__message">Choose how the supplier price was quoted.</span>
                </label>
              ) : null}

              <label className={`form-field${purchasePriceError ? " form-field--error" : ""}`}>
                <span>
                  Purchase price per {form.purchasePriceBasis === "ream" ? "ream" : form.unit.trim() || "unit"} <small>(optional)</small>
                </span>
                <div className="inventory-modal__money-input">
                  <span aria-hidden="true">₱</span>
                  <input
                    className="numeric"
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    value={form.purchasePrice}
                    onChange={(event) => setForm({ ...form, purchasePrice: event.target.value })}
                    onBlur={() => markTouched("purchasePrice")}
                    placeholder="0.00"
                    aria-invalid={Boolean(purchasePriceError)}
                    aria-describedby="inventory-purchase-price-message"
                  />
                </div>
                <span id="inventory-purchase-price-message" className={`form-field__message${purchasePriceError ? " form-field__message--error" : ""}`}>
                  {purchasePriceError
                    ?? (perSheetCost === null
                      ? "Leave blank when the current purchase cost is unknown."
                      : `${formatCurrency(perSheetCost)} effective cost per sheet.`)}
                </span>
              </label>

              {supportsReamCost && form.purchasePriceBasis === "ream" ? (
                <label className={`form-field inventory-modal__ream-size${sheetsPerReamError ? " form-field--error" : ""}`}>
                  <span>Sheets per ream</span>
                  <input
                    className="numeric"
                    type="number"
                    min="1"
                    step="1"
                    inputMode="numeric"
                    value={form.sheetsPerReam}
                    onChange={(event) => setForm({ ...form, sheetsPerReam: event.target.value })}
                    onBlur={() => markTouched("sheetsPerReam")}
                    aria-invalid={Boolean(sheetsPerReamError)}
                    aria-describedby="inventory-ream-size-message"
                  />
                  <span id="inventory-ream-size-message" className={`form-field__message${sheetsPerReamError ? " form-field__message--error" : ""}`}>
                    {sheetsPerReamError ?? "Usually 500 sheets; use the actual package count."}
                  </span>
                </label>
              ) : null}
            </div>
          </section>

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

          <section className={`inventory-modal__paper${paperSizeError ? " form-field--error" : ""}`} aria-labelledby="inventory-paper-size-title">
            <label className="form-field">
            <span id="inventory-paper-size-title">Paper size <small>(optional)</small></span>
            <select
              value={form.paperSize}
              onChange={(event) => {
                const paperSize = event.target.value as InventoryPaperSize | "";
                const definition = paperSizeDefinition(paperSize);
                setForm({
                  ...form,
                  paperSize,
                  paperWidthMm: paperSize === "Custom" ? form.paperWidthMm : definition?.widthMm?.toString() ?? "",
                  paperHeightMm: paperSize === "Custom" ? form.paperHeightMm : definition?.heightMm?.toString() ?? "",
                });
              }}
              aria-invalid={Boolean(paperSizeError)}
              aria-describedby="inventory-paper-size-message"
            >
              <option value="">Not a paper stock</option>
              {PAPER_SIZE_GROUPS.map((group) => (
                <optgroup key={group.key} label={group.label}>
                  {PAPER_SIZE_DEFINITIONS.filter((definition) => definition.group === group.key).map((definition) => (
                    <option key={definition.key} value={definition.key}>
                      {definition.label}{definition.widthMm == null ? "" : ` — ${paperSizeDimensions(definition.key)}`}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <span id="inventory-paper-size-message" className={`form-field__message${paperSizeError ? " form-field__message--error" : ""}`}>
              {paperSizeError ?? "Canon G4070 media catalogue; the selected measurement also drives pricing, analysis, and printing."}
            </span>
            </label>

            {form.paperSize === "Custom" ? (
              <div className="inventory-modal__paper-measurements" onBlur={() => markTouched("paperDimensions")}>
                <label className="form-field">
                  <span>Width</span>
                  <div className="inventory-modal__dimension-input">
                    <input type="number" min="55" max="216" step="0.1" inputMode="decimal" value={form.paperWidthMm} onChange={(event) => setForm({ ...form, paperWidthMm: event.target.value })} aria-invalid={Boolean(paperSizeError)} aria-label="Custom paper width in millimeters" />
                    <span>mm</span>
                  </div>
                </label>
                <label className="form-field">
                  <span>Height</span>
                  <div className="inventory-modal__dimension-input">
                    <input type="number" min="89" max="1200" step="0.1" inputMode="decimal" value={form.paperHeightMm} onChange={(event) => setForm({ ...form, paperHeightMm: event.target.value })} aria-invalid={Boolean(paperSizeError)} aria-label="Custom paper height in millimeters" />
                    <span>mm</span>
                  </div>
                </label>
              </div>
            ) : selectedPaperDefinition ? (
              <div className="inventory-modal__paper-measurement" aria-label="Canonical paper measurement">
                <span className="numeric">MEASUREMENT</span>
                <strong>{paperSizeDimensions(selectedPaperDefinition.key)}</strong>
                <small>Locked to the selected Canon media profile.</small>
              </div>
            ) : null}
          </section>

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
