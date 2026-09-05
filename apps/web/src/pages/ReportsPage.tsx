import { FormEvent, useState } from "react";
import { Button } from "../components/Button/Button";
import { EmptyState } from "../components/EmptyState/EmptyState";
import { ErrorState } from "../components/ErrorState/ErrorState";
import { LoadingState } from "../components/LoadingState/LoadingState";
import { PageHeader } from "../components/PageHeader/PageHeader";
import { StatusPill } from "../components/StatusPill/StatusPill";
import { useResource } from "../hooks/useResource";
import { api } from "../lib/apiClient";
import { formatCurrency } from "../lib/format";
import type { OperationalReport, ReportInventoryStatus, ReportPeriod } from "../types/domain";
import "./ReportsPage.css";

const dateFormatter = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" });
const dateTimeFormatter = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const quantityFormatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
type QuickPeriod = Exclude<ReportPeriod, "custom">;
interface ReportSelection { period: ReportPeriod; startDate: string; endDate: string }

function localDateValue(value = new Date()): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseCalendarDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function periodLabel(report: OperationalReport): string {
  const start = dateFormatter.format(parseCalendarDate(report.periodStart));
  if (report.periodStart === report.periodEnd) return start;
  return `${start} – ${dateFormatter.format(parseCalendarDate(report.periodEnd))}`;
}

function currentInterval(period: QuickPeriod): ReportSelection {
  const today = new Date();
  const todayValue = localDateValue(today);
  if (period === "daily") return { period, startDate: todayValue, endDate: todayValue };
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const end = new Date(start);
  if (period === "weekly") {
    const daysFromMonday = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - daysFromMonday);
    end.setTime(start.getTime());
    end.setDate(end.getDate() + 6);
  } else {
    start.setDate(1);
    end.setMonth(end.getMonth() + 1, 0);
  }
  return { period, startDate: localDateValue(start), endDate: localDateValue(end) };
}

function methodLabel(method: string): string {
  return method.replace(/_/g, " ").replace(/\b\w/g, (letter: string) => letter.toUpperCase());
}

function inventoryStatusLabel(status: ReportInventoryStatus): string {
  if (status === "out") return "Out of stock";
  if (status === "low") return "Low stock";
  return "Healthy";
}

export function ReportsPage() {
  const initialSelection = currentInterval("daily");
  const [activeQuickFilter, setActiveQuickFilter] = useState<QuickPeriod | null>("daily");
  const [draftStartDate, setDraftStartDate] = useState(initialSelection.startDate);
  const [draftEndDate, setDraftEndDate] = useState(initialSelection.endDate);
  const [selection, setSelection] = useState<ReportSelection>(initialSelection);
  const [validationError, setValidationError] = useState<string | null>(null);
  const { data, state, error, reload } = useResource(
    () => api.get<OperationalReport>(`/reports?period=${selection.period}&start_date=${selection.startDate}&end_date=${selection.endDate}&timezone_offset_minutes=${new Date().getTimezoneOffset()}`),
    [selection.period, selection.startDate, selection.endDate],
  );

  function generateReport(event: FormEvent) {
    event.preventDefault();
    if (!draftStartDate || !draftEndDate) {
      setValidationError("Choose both the start and end dates.");
      return;
    }
    if (draftEndDate < draftStartDate) {
      setValidationError("The end date must be on or after the start date.");
      return;
    }
    setValidationError(null);
    const nextSelection: ReportSelection = { period: "custom", startDate: draftStartDate, endDate: draftEndDate };
    if (selection.period === "custom" && selection.startDate === draftStartDate && selection.endDate === draftEndDate) reload();
    else setSelection(nextSelection);
  }

  function applyQuickFilter(period: QuickPeriod) {
    const nextSelection = currentInterval(period);
    setActiveQuickFilter(period);
    setDraftStartDate(nextSelection.startDate);
    setDraftEndDate(nextSelection.endDate);
    setValidationError(null);
    if (selection.period === period && selection.startDate === nextSelection.startDate && selection.endDate === nextSelection.endDate) reload();
    else setSelection(nextSelection);
  }

  function updateStartDate(value: string) {
    setActiveQuickFilter(null);
    setDraftStartDate(value);
    setValidationError(null);
  }

  function updateEndDate(value: string) {
    setActiveQuickFilter(null);
    setDraftEndDate(value);
    setValidationError(null);
  }

  const stockAttention = data ? data.inventory.lowStockCount + data.inventory.outOfStockCount : 0;

  return (
    <>
      <PageHeader
        eyebrow="REPORTS / OPERATIONS LEDGER"
        title="Business reports"
        description="Generate an accountable sales, production re-attempt, and live inventory report for a day, week, or month."
      />

      <form className="report-generator" onSubmit={generateReport} noValidate>
        <fieldset>
          <legend>Quick interval</legend>
          <div className="report-generator__periods">
            {(["daily", "weekly", "monthly"] as QuickPeriod[]).map((period) => (
              <button type="button" aria-pressed={activeQuickFilter === period} className={activeQuickFilter === period ? "is-selected" : ""} onClick={() => applyQuickFilter(period)} key={period}><strong>{period}</strong><small>{period === "daily" ? "Today" : period === "weekly" ? "Full week" : "Full month"}</small></button>
            ))}
          </div>
        </fieldset>
        <div className={`report-generator__interval${validationError ? " is-invalid" : ""}`}>
          <span>Date interval</span>
          <div>
            <label><span>From</span><input type="date" value={draftStartDate} max={draftEndDate || undefined} onChange={(event) => updateStartDate(event.target.value)} aria-invalid={Boolean(validationError)} aria-describedby={validationError ? "report-date-error" : undefined} required /></label>
            <i aria-hidden="true">→</i>
            <label><span>To</span><input type="date" value={draftEndDate} min={draftStartDate || undefined} onChange={(event) => updateEndDate(event.target.value)} aria-invalid={Boolean(validationError)} aria-describedby={validationError ? "report-date-error" : undefined} required /></label>
          </div>
        </div>
        <Button type="submit" variant="primary" loading={state === "loading"}>Generate report</Button>
        {validationError ? <small id="report-date-error" className="report-generator__error" role="alert">{validationError}</small> : null}
      </form>

      {state === "loading" ? <LoadingState label={`Generating ${selection.period} report…`} /> : null}
      {state === "error" ? <ErrorState title="The report could not be generated" description={error ?? undefined} onRetry={reload} /> : null}
      {state === "ready" && data ? (
        <div className="report-sheet">
          <header className="report-sheet__header">
            <div><span className="numeric">{data.period.toUpperCase()} REPORT</span><h2>{periodLabel(data)}</h2><p>Generated {dateTimeFormatter.format(new Date(data.generatedAt))}</p></div>
            <span className="report-sheet__interval-note" aria-label={`Selected interval: ${periodLabel(data)}`}>Selected · {periodLabel(data)}</span>
          </header>

          <section className="report-scoreboard" aria-label="Report summary">
            <article className="report-scoreboard__sales"><span>Total sales</span><strong>{formatCurrency(data.sales.totalSales)}</strong><small>Verified payments received</small></article>
            <article><span>Paid transactions</span><strong className="numeric">{data.sales.transactionCount}</strong><small>{data.sales.verifiedPaymentCount} verified {data.sales.verifiedPaymentCount === 1 ? "payment" : "payments"}</small></article>
            <article className={data.reAttempts.totalReAttempts ? "has-attention" : ""}><span>Re-attempts</span><strong className="numeric">{data.reAttempts.totalReAttempts}</strong><small>{data.reAttempts.affectedJobCount} affected {data.reAttempts.affectedJobCount === 1 ? "job" : "jobs"}</small></article>
            <article className={stockAttention ? "has-warning" : ""}><span>Stock attention</span><strong className="numeric">{stockAttention}</strong><small>{data.inventory.outOfStockCount} out · {data.inventory.lowStockCount} low</small></article>
          </section>

          <div className="report-sheet__columns">
            <section className="report-panel report-panel--sales">
              <header><div><span className="numeric">01 / SALES</span><h3>Verified receipts</h3></div><strong>{formatCurrency(data.sales.totalSales)}</strong></header>
              {data.sales.byPaymentMethod.length ? <ul className="report-sales-methods">{data.sales.byPaymentMethod.map((method) => <li key={method.method}><span><strong>{methodLabel(method.method)}</strong><small>{method.paymentCount} {method.paymentCount === 1 ? "payment" : "payments"}</small></span><b>{formatCurrency(method.amount)}</b></li>)}</ul> : <EmptyState title="No verified sales" description="No verified payment was recorded inside this period." />}
              <p className="report-panel__note">Sales are recognized on the date a verified payment is recorded—not when an unpaid transaction is created.</p>
            </section>

            <section className="report-panel report-panel--reattempts">
              <header><div><span className="numeric">02 / QUALITY</span><h3>Production re-attempts</h3></div><strong className="numeric">{data.reAttempts.totalReAttempts}</strong></header>
              {data.reAttempts.byProduct.length ? <ul className="report-reattempt-list">{data.reAttempts.byProduct.map((product) => <li key={product.productId}><span><strong>{product.productName}</strong><small>{product.affectedJobCount} affected {product.affectedJobCount === 1 ? "job" : "jobs"}</small></span><b className="numeric">{product.reAttemptCount}</b></li>)}</ul> : <div className="report-clear-state"><span aria-hidden="true">✓</span><div><strong>No re-attempts recorded</strong><p>No product returned from Ready to Queued during this period.</p></div></div>}
              <p className="report-panel__note">A re-attempt is counted when failed quality sends a product line from Ready back to Queued.</p>
            </section>
          </div>

          <section className="report-panel report-panel--inventory">
            <header><div><span className="numeric">03 / LIVE STOCK</span><h3>Current inventory status</h3><p>Snapshot as of {dateTimeFormatter.format(new Date(data.inventory.asOf))}</p></div><div className="report-inventory-totals"><span><b className="numeric">{data.inventory.healthyCount}</b> healthy</span><span><b className="numeric">{data.inventory.lowStockCount}</b> low</span><span><b className="numeric">{data.inventory.outOfStockCount}</b> out</span></div></header>
            {data.inventory.items.length ? <div className="report-inventory-table" role="region" aria-label="Current inventory status" tabIndex={0}><table><thead><tr><th>Material</th><th>Category</th><th>Available</th><th>Reorder at</th><th>Status</th></tr></thead><tbody>{data.inventory.items.map((item) => <tr key={item.id}><th scope="row"><strong>{item.name}</strong>{item.paperSize ? <small>{item.paperSize}</small> : null}</th><td>{item.category}</td><td className="numeric">{quantityFormatter.format(item.quantityOnHand)} {item.unit}</td><td className="numeric">{quantityFormatter.format(item.reorderLevel)} {item.unit}</td><td><StatusPill label={inventoryStatusLabel(item.status)} tone={item.status === "healthy" ? "success" : item.status === "low" ? "warning" : "danger"} /></td></tr>)}</tbody></table></div> : <EmptyState title="No active inventory" description="Add or activate materials in Inventory to include a live stock snapshot." />}
            {data.inventory.inactiveItemCount ? <p className="report-panel__note">{data.inventory.inactiveItemCount} inactive {data.inventory.inactiveItemCount === 1 ? "material is" : "materials are"} excluded from operational stock status.</p> : null}
          </section>
        </div>
      ) : null}
    </>
  );
}
