import { formatCurrency } from "../../lib/format";
import type { PriceBreakdownEntry } from "../../types/domain";
import "./PriceBreakdown.css";

export function PriceBreakdown({ entries, total, compact = false }: { entries: PriceBreakdownEntry[]; total: number; compact?: boolean }) {
  if (!entries.length) return <p className="price-breakdown__empty">No detailed pricing snapshot is available for this product.</p>;
  return <div className={`price-breakdown${compact ? " price-breakdown--compact" : ""}`}>
    <ol>{entries.map((entry, index) => <li key={`${entry.kind}-${entry.label}-${index}`}><span><strong>{entry.label}</strong><small>{entry.basis}</small></span><output className={entry.amount < 0 ? "is-deduction" : undefined}>{entry.amount < 0 ? "−" : entry.kind === "base" ? "" : "+"}{formatCurrency(Math.abs(entry.amount))}</output></li>)}</ol>
    <footer><strong>Product total</strong><output>{formatCurrency(total)}</output></footer>
  </div>;
}
