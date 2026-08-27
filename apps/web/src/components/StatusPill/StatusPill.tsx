import type { StatusTone } from "../../types/statusMeta";
import "./StatusPill.css";

export function StatusPill({ label, tone }: { label: string; tone: StatusTone }) {
  return <span className={`status-pill status-pill--${tone}`}>{label}</span>;
}
