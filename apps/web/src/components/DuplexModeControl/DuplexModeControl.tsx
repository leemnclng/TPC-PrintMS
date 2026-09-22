import "./DuplexModeControl.css";

interface DuplexModeControlProps {
  manual: boolean;
  onChange: (manual: boolean) => void;
}

/** Shared by every two-sided template so manual sheet turning remains the
 * default while duplex-capable printers can opt into a rotated back page. */
export function DuplexModeControl({ manual, onChange }: DuplexModeControlProps) {
  return <fieldset className="duplex-mode-control">
    <legend>Back-to-back mode</legend>
    <label><input type="checkbox" checked={manual} onChange={(event) => onChange(event.target.checked)} /><span><strong>Manual back-to-back</strong><small>Keep both PDF pages upright for separate printing and a physical sheet turn.</small></span></label>
    <p><b>{manual ? "MANUAL" : "AUTOMATIC"}</b>{manual ? "Reload the printed sheet yourself; the reverse page keeps the same orientation." : "For duplex-capable printers; the reverse page is rotated 180° automatically."}</p>
  </fieldset>;
}
