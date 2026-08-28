import { FormEvent, useEffect, useState } from "react";
import { Button } from "../../components/Button/Button";
import { Modal } from "../../components/Modal/Modal";
import { ApiError, api } from "../../lib/apiClient";
import type { PrintTypeDefinition } from "../../types/domain";
import "./PrintTypeCreateModal.css";

interface PrintTypeCreateModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (printType: PrintTypeDefinition) => void;
}

export function PrintTypeCreateModal({ open, onClose, onCreated }: PrintTypeCreateModalProps) {
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [colorMode, setColorMode] = useState<"color" | "grayscale">("color");
  const [appliesInkCoverage, setAppliesInkCoverage] = useState(true);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const labelError = touched && label.trim().length < 2 ? "Enter at least two characters." : null;

  useEffect(() => {
    if (!open) return;
    setLabel("");
    setDescription("");
    setColorMode("color");
    setAppliesInkCoverage(true);
    setTouched(false);
    setSaveError(null);
  }, [open]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched(true);
    setSaveError(null);
    if (label.trim().length < 2 || saving) return;
    setSaving(true);
    try {
      const created = await api.post<PrintTypeDefinition>("/print-types", {
        label: label.trim(),
        description: description.trim() || null,
        colorMode,
        appliesInkCoverage,
      });
      onCreated(created);
    } catch (error) {
      setSaveError(error instanceof ApiError ? error.message : "The print type couldn’t be created.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      title="New print type"
      description="Add an output type once; its pricing column and product option are created automatically."
      busy={saving}
      status={saveError ? "error" : saving ? "loading" : "idle"}
      onClose={onClose}
      className="print-type-modal"
    >
      <form className="print-type-form" onSubmit={handleSubmit} noValidate>
        <div className="print-type-form__fields">
          <label className={["form-field", labelError ? "form-field--error" : ""].filter(Boolean).join(" ")}>
            <span>Type name</span>
            <input
              autoFocus
              disabled={saving}
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              onBlur={() => setTouched(true)}
              aria-invalid={Boolean(labelError)}
              aria-describedby="print-type-name-message"
            />
            <span id="print-type-name-message" className={labelError ? "form-field__message form-field__message--error" : "form-field__message"}>
              {labelError ?? "Example: Photo color or Draft grayscale."}
            </span>
          </label>

          <label className="form-field">
            <span>Description</span>
            <textarea disabled={saving} rows={2} value={description} onChange={(event) => setDescription(event.target.value)} />
            <span className="form-field__message">Optional guidance for owners configuring products.</span>
          </label>

          <label className="form-field">
            <span>Printer output</span>
            <select
              disabled={saving}
              value={colorMode}
              onChange={(event) => {
                const nextMode = event.target.value as "color" | "grayscale";
                setColorMode(nextMode);
                if (nextMode === "grayscale") setAppliesInkCoverage(false);
              }}
            >
              <option value="color">Color output</option>
              <option value="grayscale">Grayscale output</option>
            </select>
            <span className="form-field__message">Used automatically when the job reaches Print Center.</span>
          </label>

          <label className="print-type-form__coverage">
            <input
              type="checkbox"
              disabled={saving}
              checked={appliesInkCoverage}
              aria-describedby="print-type-coverage-description"
              onChange={(event) => setAppliesInkCoverage(event.target.checked)}
            />
            <span>
              <strong>Price measured ink coverage</strong>
              <small id="print-type-coverage-description">Add the analyzer’s ink-load adjustment to the configured base rate.</small>
            </span>
          </label>

          {saveError ? <p className="settings-form__error" role="alert">{saveError}</p> : null}
        </div>
        <footer className="print-type-form__actions">
          <Button type="button" variant="ghost" disabled={saving} onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={saving}>Create print type</Button>
        </footer>
      </form>
    </Modal>
  );
}
