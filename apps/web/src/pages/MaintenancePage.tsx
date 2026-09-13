import { useMemo, useState } from "react";
import { Button } from "../components/Button/Button";
import { EmptyState } from "../components/EmptyState/EmptyState";
import { ErrorState } from "../components/ErrorState/ErrorState";
import { LoadingState } from "../components/LoadingState/LoadingState";
import { PageHeader } from "../components/PageHeader/PageHeader";
import { useResource } from "../hooks/useResource";
import { api, ApiError } from "../lib/apiClient";
import type { MaintenanceReminder } from "../types/domain";
import { MaintenanceReminderDeleteModal, MaintenanceReminderModal } from "./maintenance/MaintenanceReminderModal";
import "./MaintenancePage.css";

type MaintenanceCategory = "All" | "Print quality" | "Paper feed" | "Scanner" | "Consumables";

interface MaintenanceAction {
  title: string;
  category: Exclude<MaintenanceCategory, "All">;
  trigger: string;
  action: string;
  caution?: string;
  level: "Diagnostic" | "Routine care" | "Uses ink" | "High ink use" | "Service threshold";
}

const categories: MaintenanceCategory[] = ["All", "Print quality", "Paper feed", "Scanner", "Consumables"];

const actions: MaintenanceAction[] = [
  {
    title: "Nozzle check",
    category: "Print quality",
    trigger: "Output is faint, streaked, or missing a color—or before a critical batch after a long idle period.",
    action: "Print the nozzle pattern first. If every line is present and unbroken, stop: cleaning is not required.",
    level: "Diagnostic",
  },
  {
    title: "Print-head cleaning",
    category: "Print quality",
    trigger: "The nozzle check has missing lines or horizontal white streaks.",
    action: "Run Cleaning, then print another nozzle check. Run no more than two normal cleaning cycles before moving to Deep Cleaning.",
    caution: "Check ink levels and maintenance-cartridge capacity first. Frequent cleaning consumes ink.",
    level: "Uses ink",
  },
  {
    title: "Deep cleaning",
    category: "Print quality",
    trigger: "Two normal cleaning cycles did not correct the nozzle pattern.",
    action: "Run one Deep Cleaning and recheck. If still blocked, power off normally, wait 24 hours, then try it once more.",
    caution: "This uses substantially more ink. Do not unplug the printer while it is shutting down.",
    level: "High ink use",
  },
  {
    title: "Replace ink in print head",
    category: "Print quality",
    trigger: "Only after the official deep-cleaning and 24-hour recovery path has failed.",
    action: "Confirm every ink is above the single-dot mark and the maintenance cartridge has enough capacity, then follow Canon's on-screen procedure—or contact Canon service.",
    caution: "Last resort. It consumes a great amount of ink; never use it as routine maintenance.",
    level: "Service threshold",
  },
  {
    title: "Print-head alignment",
    category: "Print quality",
    trigger: "Straight lines print misaligned, colors shift, or a print head was newly installed.",
    action: "Run Print Head Alignment from the printer's Maintenance menu or Canon IJ Printer Assistant Tool.",
    level: "Routine care",
  },
  {
    title: "Paper-feed roller cleaning",
    category: "Paper feed",
    trigger: "Sheets misfeed or rollers may have paper dust on them.",
    action: "Remove paper from the rear tray, start Roller Cleaning, then load three plain sheets when prompted to finish the cycle.",
    level: "Routine care",
  },
  {
    title: "Bottom-plate cleaning",
    category: "Paper feed",
    trigger: "The back of printed sheets is smudged, especially after borderless, duplex, or heavy printing.",
    action: "Run Bottom Plate Cleaning from Maintenance. Use a clean sheet as directed by the printer.",
    level: "Routine care",
  },
  {
    title: "Platen and ADF glass",
    category: "Scanner",
    trigger: "Scans or copies show black lines, spots, or streaks.",
    action: "Turn off and unplug the printer. Gently wipe the platen, document cover, and ADF scanning glass with a soft, clean, dry lint-free cloth.",
    caution: "Do not use tissue, paper towel, thinner, benzine, acetone, or other volatile cleaners.",
    level: "Routine care",
  },
  {
    title: "Maintenance cartridge MC-G04",
    category: "Consumables",
    trigger: "The printer reports that the maintenance cartridge is nearly full or full.",
    action: "Keep a replacement ready when nearly full; replace it when instructed. Bag the used cartridge immediately and keep it level.",
    caution: "Do not touch its terminal or opening, and do not tilt a removed cartridge.",
    level: "Service threshold",
  },
];

const officialSources = [
  ["Canon G4070 series maintenance guide", "https://ij.manual.canon/ij/webmanual/Manual/All/G4070%20series/EN/UG/ug-130.html"],
  ["Cleaning and deep-cleaning controls", "https://ij.manual.canon/ij/webmanual/PrinterDriver/W/G4070%20series/1.0/EN/PPG/Dg-printer_assistant.html"],
  ["G4770 product information", "https://hk.canon/en/consumer/pixma-g4770/main/brochure"],
  ["Maintenance cartridge handling", "https://ij.manual.canon/ij/webmanual/Manual/All/G4070%20series/EN/UG/ug-235.html"],
];

const communitySource = [
  "Canon Community: storing a MegaTank printer",
  "https://community.usa.canon.com/t5/Desktop-Inkjet-Printers/Storing-a-Canon-G7020-Megatank/td-p/398298",
] as const;

export function MaintenancePage() {
  const [category, setCategory] = useState<MaintenanceCategory>("All");
  const { data: reminders, state: reminderState, error: reminderLoadError, reload: reloadReminders } = useResource(
    () => api.get<MaintenanceReminder[]>("/maintenance-reminders"),
  );
  const [reminderEditorOpen, setReminderEditorOpen] = useState(false);
  const [editingReminder, setEditingReminder] = useState<MaintenanceReminder | null>(null);
  const [deletingReminder, setDeletingReminder] = useState<MaintenanceReminder | null>(null);
  const [updatingReminderId, setUpdatingReminderId] = useState<string | null>(null);
  const [reminderActionError, setReminderActionError] = useState<string | null>(null);
  const visibleActions = useMemo(
    () => (category === "All" ? actions : actions.filter((item) => item.category === category)),
    [category],
  );

  function openCreateReminder() {
    setEditingReminder(null);
    setReminderEditorOpen(true);
  }

  function openEditReminder(reminder: MaintenanceReminder) {
    setEditingReminder(reminder);
    setReminderEditorOpen(true);
  }

  async function toggleReminder(reminder: MaintenanceReminder) {
    setUpdatingReminderId(reminder.id);
    setReminderActionError(null);
    try {
      await api.put(`/maintenance-reminders/${reminder.id}`, { message: reminder.message, isActive: !reminder.isActive });
      window.dispatchEvent(new CustomEvent("maintenance-reminders:updated"));
      reloadReminders();
    } catch (caught) {
      setReminderActionError(caught instanceof ApiError ? caught.message : "The reminder could not be updated.");
    } finally {
      setUpdatingReminderId(null);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="OPERATIONS"
        title="Maintenance"
        description="Safe, condition-based printer care built from manufacturer guidance—not a calendar of ink-consuming clean cycles."
      />

      <section className="maintenance-family" aria-labelledby="maintenance-family-title">
        <div>
          <span className="maintenance-family__brand numeric">CANON</span>
          <h2 id="maintenance-family-title">PIXMA MegaTank · G4070 series</h2>
          <p>Refillable ink-tank multifunction printers. This family guidance includes the <strong>PIXMA G4770</strong>.</p>
        </div>
        <dl>
          <div><dt>Brand</dt><dd>Canon</dd></div>
          <div><dt>Model</dt><dd>G4770</dd></div>
          <div><dt>Reviewed</dt><dd>14 Sep 2026</dd></div>
        </dl>
      </section>

      <section className="maintenance-reminders" aria-labelledby="maintenance-reminders-title">
        <header>
          <div><span className="maintenance-kicker numeric">SHOP REMINDERS</span><h2 id="maintenance-reminders-title">Good habits in every transaction</h2><p>Active reminders rotate in the top-right corner. Each one closes after ten seconds and the next reminder appears after a successful job-order action.</p></div>
          <Button type="button" variant="primary" onClick={openCreateReminder}>Add reminder</Button>
        </header>
        {reminderState === "loading" && <LoadingState label="Loading maintenance reminders…" />}
        {reminderState === "error" && <ErrorState title="Couldn't load reminders" description={reminderLoadError ?? undefined} onRetry={reloadReminders} />}
        {reminderState === "ready" && reminders?.length === 0 && <EmptyState title="No reminders yet" description="Add a short printer-care habit to start the transaction reminder rotation." action={<Button type="button" size="sm" onClick={openCreateReminder}>Add first reminder</Button>} />}
        {reminderState === "ready" && reminders && reminders.length > 0 && <div className="maintenance-reminder-list">{reminders.map((reminder, index) => <article key={reminder.id} className="maintenance-reminder-row" data-active={reminder.isActive || undefined}><span className="maintenance-reminder-row__number numeric">{String(index + 1).padStart(2, "0")}</span><div><p>{reminder.message}</p><span>{reminder.isActive ? "Active · included in rotation" : "Paused · hidden from rotation"}</span></div><div className="maintenance-reminder-row__actions"><Button type="button" size="sm" variant="ghost" disabled={updatingReminderId === reminder.id} onClick={() => openEditReminder(reminder)}>Edit</Button><Button type="button" size="sm" variant="secondary" loading={updatingReminderId === reminder.id} onClick={() => void toggleReminder(reminder)}>{reminder.isActive ? "Pause" : "Activate"}</Button><Button type="button" size="sm" variant="ghost" disabled={updatingReminderId === reminder.id} onClick={() => setDeletingReminder(reminder)}>Remove</Button></div></article>)}</div>}
        {reminderActionError && <p className="maintenance-reminders__error" role="alert">{reminderActionError}</p>}
      </section>

      <section className="maintenance-routine" aria-labelledby="routine-title">
        <header>
          <span className="maintenance-kicker numeric">PREVENTIVE ROUTINE</span>
          <h2 id="routine-title">Exercise the printer; do not clean it blindly</h2>
          <p>Canon directs cleaning by nozzle-check results. The weekly print below is a conservative community practice, not a Canon-mandated schedule.</p>
        </header>
        <ol>
          <li><span className="numeric">WEEKLY IF IDLE</span><strong>Print a small full-color page</strong><p>Exercise every ink channel. If output is normal, take no cleaning action.</p></li>
          <li><span className="numeric">MONTHLY SHOP CHECK</span><strong>Inspect, wipe, and replenish</strong><p>Check ink and MC-G04 capacity, remove visible paper dust, and dry-wipe scanner glass.</p></li>
          <li><span className="numeric">BEFORE A CRITICAL RUN</span><strong>Test only when warranted</strong><p>Print a nozzle check after long inactivity or when quality is uncertain; clean only if the pattern fails.</p></li>
        </ol>
      </section>

      <section className="maintenance-path" aria-labelledby="recovery-title">
        <header>
          <span className="maintenance-kicker numeric">CANON RECOVERY ORDER</span>
          <h2 id="recovery-title">When output is faint or missing color</h2>
        </header>
        <div className="maintenance-path__steps" aria-label="Print quality recovery sequence">
          <span>Nozzle check</span><i aria-hidden="true">→</i><span>Cleaning ×2 max</span><i aria-hidden="true">→</i><span>Deep cleaning</span><i aria-hidden="true">→</i><span>Wait 24 hours</span><i aria-hidden="true">→</i><span>One deep clean</span><i aria-hidden="true">→</i><span>Service / last resort</span>
        </div>
        <p>Stop as soon as the nozzle pattern is complete. Every extra cleaning cycle sends ink to the maintenance cartridge.</p>
      </section>

      <section className="maintenance-actions" aria-labelledby="actions-title">
        <div className="maintenance-actions__heading">
          <div><span className="maintenance-kicker numeric">ACTION LIBRARY</span><h2 id="actions-title">Choose by symptom</h2></div>
          <div className="maintenance-filters" role="group" aria-label="Filter maintenance actions">
            {categories.map((item) => <button key={item} type="button" aria-pressed={category === item} onClick={() => setCategory(item)}>{item}</button>)}
          </div>
        </div>
        <div className="maintenance-action-grid">
          {visibleActions.map((item) => (
            <article key={item.title} className="maintenance-action-card">
              <div><span className={`maintenance-level maintenance-level--${item.level.toLowerCase().replace(/ /g, "-")}`}>{item.level}</span><span>{item.category}</span></div>
              <h3>{item.title}</h3>
              <dl><div><dt>When</dt><dd>{item.trigger}</dd></div><div><dt>Do</dt><dd>{item.action}</dd></div>{item.caution && <div className="maintenance-action-card__caution"><dt>Caution</dt><dd>{item.caution}</dd></div>}</dl>
            </article>
          ))}
        </div>
      </section>

      <section className="maintenance-safety" aria-labelledby="safety-title">
        <div><span className="maintenance-kicker numeric">SAFE PRACTICE</span><h2 id="safety-title">Protect the print head</h2></div>
        <ul>
          <li>Keep all ink colors above the lower limit before cleaning.</li>
          <li>Shut down with the power button; do not pull the plug during shutdown.</li>
          <li>Avoid manual flushing, syringes, solvents, and print-head disassembly unless performed by an authorized technician.</li>
          <li>Run printer functions from the device Maintenance menu, Canon IJ Printer Assistant Tool, or Remote UI.</li>
        </ul>
        <p className="maintenance-safety__note"><strong>Guidance only:</strong> OMS does not directly start printer maintenance operations.</p>
      </section>

      <footer className="maintenance-sources">
        <div><span className="maintenance-kicker numeric">SOURCES</span><h2>Verified references</h2></div>
        <p>Manufacturer instructions take priority over community practice and this in-app summary.</p>
        <ul>{officialSources.map(([label, url]) => <li key={url}><a href={url} target="_blank" rel="noreferrer">{label}<span aria-hidden="true"> ↗</span></a></li>)}</ul>
        <p className="maintenance-sources__community">Preventive idle-print practice was cross-checked against <a href={communitySource[1]} target="_blank" rel="noreferrer">{communitySource[0]}<span aria-hidden="true"> ↗</span></a> and owner discussions; manual cleaning hacks were intentionally excluded.</p>
      </footer>

      <MaintenanceReminderModal open={reminderEditorOpen} reminder={editingReminder} onClose={() => setReminderEditorOpen(false)} onSaved={() => { setReminderEditorOpen(false); reloadReminders(); }} />
      <MaintenanceReminderDeleteModal reminder={deletingReminder} onClose={() => setDeletingReminder(null)} onDeleted={() => { setDeletingReminder(null); reloadReminders(); }} />
    </>
  );
}
