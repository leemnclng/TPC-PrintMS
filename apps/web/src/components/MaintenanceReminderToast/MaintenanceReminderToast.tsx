import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/apiClient";
import type { MaintenanceReminder } from "../../types/domain";
import "./MaintenanceReminderToast.css";

const DISPLAY_MS = 10_000;
const PERIODIC_MS = 90_000;

export function MaintenanceReminderToast() {
  const [reminders, setReminders] = useState<MaintenanceReminder[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [visible, setVisible] = useState(false);
  const [displayCycle, setDisplayCycle] = useState(0);
  const remindersRef = useRef<MaintenanceReminder[]>([]);
  const activeIndexRef = useRef(-1);
  const hideTimerRef = useRef<number>();

  const loadReminders = useCallback(async () => {
    try {
      const loaded = await api.get<MaintenanceReminder[]>("/maintenance-reminders?active_only=true");
      remindersRef.current = loaded;
      setReminders(loaded);
      if (!loaded.length) {
        activeIndexRef.current = -1;
        setActiveIndex(-1);
        setVisible(false);
      } else if (activeIndexRef.current >= loaded.length) {
        activeIndexRef.current = -1;
        setActiveIndex(-1);
      }
    } catch {
      // This is supporting guidance, so backend trouble must not cover or
      // interrupt an operational transaction. The Maintenance page exposes
      // the actionable loading/error/retry state.
    }
  }, []);

  const showNext = useCallback(() => {
    const current = remindersRef.current;
    if (!current.length) return;
    const nextIndex = (activeIndexRef.current + 1) % current.length;
    activeIndexRef.current = nextIndex;
    setActiveIndex(nextIndex);
    setVisible(true);
    setDisplayCycle((cycle) => cycle + 1);
    if (hideTimerRef.current !== undefined) window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => setVisible(false), DISPLAY_MS);
  }, []);

  useEffect(() => {
    void loadReminders();
    const refresh = () => void loadReminders();
    window.addEventListener("maintenance-reminders:updated", refresh);
    return () => window.removeEventListener("maintenance-reminders:updated", refresh);
  }, [loadReminders]);

  useEffect(() => {
    const initialTimer = window.setTimeout(showNext, 12_000);
    const periodicTimer = window.setInterval(showNext, PERIODIC_MS);
    window.addEventListener("maintenance-reminder:transaction", showNext);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(periodicTimer);
      if (hideTimerRef.current !== undefined) window.clearTimeout(hideTimerRef.current);
      window.removeEventListener("maintenance-reminder:transaction", showNext);
    };
  }, [showNext]);

  const reminder = activeIndex >= 0 ? reminders[activeIndex] : undefined;
  if (!reminder) return null;

  return (
    <aside className="maintenance-toast" data-visible={visible || undefined} aria-hidden={!visible} aria-live="polite">
      <div className="maintenance-toast__mark" aria-hidden="true"><span>CARE</span></div>
      <div className="maintenance-toast__content">
        <span className="maintenance-toast__eyebrow numeric">PRINTER CARE · {activeIndex + 1}/{reminders.length}</span>
        <p>{reminder.message}</p>
        <Link to="/maintenance">Manage reminders</Link>
      </div>
      <button type="button" aria-label="Dismiss maintenance reminder" onClick={() => setVisible(false)}>×</button>
      <i key={displayCycle} className="maintenance-toast__timer" aria-hidden="true" />
    </aside>
  );
}
