import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface Props {
  from: string;
  through: string;
  invalid?: boolean;
  onFromChange: (value: string) => void;
  onThroughChange: (value: string) => void;
}

export function DateRangeFilter({ from, through, invalid, onFromChange, onThroughChange }: Props) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const active = Boolean(from || through);
  const label = from && through ? `${from} – ${through}` : from ? `From ${from}` : through ? `Through ${through}` : "All dates";

  function toggle() {
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const panelWidth = Math.min(292, window.innerWidth - 24);
      const panelHeight = 174;
      const top = rect.bottom + panelHeight + 12 > window.innerHeight
        ? Math.max(12, rect.top - panelHeight - 6)
        : rect.bottom + 6;
      setPosition({ top, left: Math.max(12, Math.min(rect.left, window.innerWidth - panelWidth - 12)) });
    }
    setOpen((current) => !current);
  }

  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector<HTMLInputElement>("input")?.focus();
    function dismiss(event: MouseEvent) {
      if (!panelRef.current?.contains(event.target as Node) && !triggerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function keydown(event: KeyboardEvent) {
      if (event.key === "Escape") { setOpen(false); triggerRef.current?.focus(); }
    }
    function closeOnViewportChange() { setOpen(false); }
    document.addEventListener("mousedown", dismiss);
    document.addEventListener("keydown", keydown);
    window.addEventListener("resize", closeOnViewportChange);
    window.addEventListener("scroll", closeOnViewportChange, true);
    return () => {
      document.removeEventListener("mousedown", dismiss);
      document.removeEventListener("keydown", keydown);
      window.removeEventListener("resize", closeOnViewportChange);
      window.removeEventListener("scroll", closeOnViewportChange, true);
    };
  }, [open]);

  return <>
    <button ref={triggerRef} type="button" className={`date-range-filter__trigger${active ? " is-active" : ""}`} aria-expanded={open} aria-controls={panelId} onClick={toggle}>
      <span aria-hidden="true">▣</span><span>{label}</span><span aria-hidden="true">⌄</span>
    </button>
    {open && createPortal(
      <div ref={panelRef} id={panelId} className="date-range-filter__panel" style={position} role="group" aria-label="Creation date range">
        <label>From<input type="date" value={from} max={through || undefined} aria-invalid={invalid} onChange={(event) => onFromChange(event.target.value)} /></label>
        <label>Through<input type="date" value={through} min={from || undefined} aria-invalid={invalid} onChange={(event) => onThroughChange(event.target.value)} /></label>
        {invalid && <small role="alert">End date must be on or after start date.</small>}
        <div><button type="button" disabled={!active} onClick={() => { onFromChange(""); onThroughChange(""); }}>Clear dates</button><button type="button" onClick={() => { setOpen(false); triggerRef.current?.focus(); }}>Done</button></div>
      </div>, document.body,
    )}
  </>;
}
