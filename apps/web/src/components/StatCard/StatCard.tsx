import type { ReactNode } from "react";
import "./StatCard.css";

export function StatCard({
  label,
  value,
  tone = "neutral",
  hint,
}: {
  label: string;
  value: ReactNode;
  tone?: "neutral" | "warning" | "danger";
  hint?: string;
}) {
  return (
    <div className={`stat-card stat-card--${tone}`}>
      <span className="stat-card__label">{label}</span>
      <span className="stat-card__value numeric">{value}</span>
      {hint && <span className="stat-card__hint">{hint}</span>}
    </div>
  );
}
