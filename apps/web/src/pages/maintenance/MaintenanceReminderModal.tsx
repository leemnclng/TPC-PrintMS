import { FormEvent, useEffect, useState } from "react";
import { Button } from "../../components/Button/Button";
import { Modal } from "../../components/Modal/Modal";
import { api, ApiError } from "../../lib/apiClient";
import type { MaintenanceReminder } from "../../types/domain";

interface Props {
  open: boolean;
  reminder: MaintenanceReminder | null;
  onClose: () => void;
  onSaved: () => void;
}

export function MaintenanceReminderModal({ open, reminder, onClose, onSaved }: Props) {
  const [message, setMessage] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const normalized = message.trim().replace(/\s+/g, " ");
  const messageError = touched && normalized.length < 3 ? "Enter at least 3 characters." : null;

  useEffect(() => {
    if (!open) return;
    setMessage(reminder?.message ?? "");
    setIsActive(reminder?.isActive ?? true);
    setTouched(false);
    setSubmitting(false);
    setError(null);
  }, [open, reminder]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (normalized.length < 3 || normalized.length > 240) return;
    setSubmitting(true);
    setError(null);
    try {
      const payload = { message: normalized, isActive };
      if (reminder) await api.put(`/maintenance-reminders/${reminder.id}`, payload);
      else await api.post("/maintenance-reminders", payload);
      window.dispatchEvent(new CustomEvent("maintenance-reminders:updated"));
      onSaved();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "The reminder could not be saved.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} title={reminder ? "Edit reminder" : "Add maintenance reminder"} description="Keep it short enough to read during a transaction." onClose={onClose} busy={submitting} status={error ? "error" : submitting ? "loading" : "idle"} className="maintenance-reminder-modal">
      <form onSubmit={submit} className="maintenance-reminder-form">
        <div className="maintenance-reminder-form__fields">
          <label className={`form-field${messageError ? " form-field--error" : ""}`}>
            <span>Reminder</span>
            <textarea autoFocus rows={4} maxLength={240} value={message} onBlur={() => setTouched(true)} onChange={(event) => setMessage(event.target.value)} aria-invalid={Boolean(messageError)} aria-describedby="maintenance-reminder-help" placeholder="Example: Print a small full-color page if the printer has been idle all week." />
            <small id="maintenance-reminder-help" className={`form-field__message${messageError ? " form-field__message--error" : ""}`}>{messageError ?? `${message.length}/240 characters`}</small>
          </label>
          <label className="maintenance-reminder-active"><input type="checkbox" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} /><span><strong>Show this reminder</strong><small>Active reminders rotate in the top-right care prompt.</small></span></label>
          {error && <p className="maintenance-reminder-form__error" role="alert">{error}</p>}
        </div>
        <footer><Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>Cancel</Button><Button type="submit" variant="primary" loading={submitting}>{reminder ? "Save changes" : "Add reminder"}</Button></footer>
      </form>
    </Modal>
  );
}

export function MaintenanceReminderDeleteModal({ reminder, onClose, onDeleted }: { reminder: MaintenanceReminder | null; onClose: () => void; onDeleted: () => void }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (reminder) { setSubmitting(false); setError(null); } }, [reminder]);

  async function remove() {
    if (!reminder) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.del(`/maintenance-reminders/${reminder.id}`);
      window.dispatchEvent(new CustomEvent("maintenance-reminders:updated"));
      onDeleted();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "The reminder could not be removed.");
    } finally {
      setSubmitting(false);
    }
  }

  return <Modal open={Boolean(reminder)} title="Remove reminder?" description="This removes it from the rotation permanently." onClose={onClose} busy={submitting} status={error ? "error" : submitting ? "loading" : "idle"} className="maintenance-reminder-delete-modal"><div className="maintenance-reminder-delete"><p>{reminder?.message}</p>{error && <p className="maintenance-reminder-form__error" role="alert">{error}</p>}<footer><Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>Cancel</Button><Button type="button" variant="danger" loading={submitting} onClick={remove}>Remove reminder</Button></footer></div></Modal>;
}
