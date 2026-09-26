import { FormEvent, useState } from "react";
import { Button } from "../components/Button/Button";
import { EmptyState } from "../components/EmptyState/EmptyState";
import { ErrorState } from "../components/ErrorState/ErrorState";
import { LoadingState } from "../components/LoadingState/LoadingState";
import { PageHeader } from "../components/PageHeader/PageHeader";
import { Pagination } from "../components/Pagination/Pagination";
import { StatusPill } from "../components/StatusPill/StatusPill";
import { useResource } from "../hooks/useResource";
import { usePaginatedResource } from "../hooks/usePaginatedResource";
import { api } from "../lib/apiClient";
import { formatCurrency } from "../lib/format";
import type { DiscountedJobOrderPage, FailureReport, OperationalReport, PrinterReliabilityReport, ReconciliationReport, ReportInventoryStatus, ReportPeriod } from "../types/domain";
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
  const [exportError, setExportError] = useState<string | null>(null);
  const [tab, setTab] = useState<"operations" | "reconciliation" | "quality" | "discounts">("operations");
  const reportQuery = `start_date=${selection.startDate}&end_date=${selection.endDate}&timezone_offset_minutes=${new Date().getTimezoneOffset()}`;
  const { data, state, error, reload } = useResource(
    () => api.get<OperationalReport>(`/reports?period=${selection.period}&start_date=${selection.startDate}&end_date=${selection.endDate}&timezone_offset_minutes=${new Date().getTimezoneOffset()}`),
    [selection.period, selection.startDate, selection.endDate],
  );
  const discountReport = usePaginatedResource(
    (page, pageSize) => api.get<DiscountedJobOrderPage>(`/reports/discounted-job-orders/page?start_date=${selection.startDate}&end_date=${selection.endDate}&timezone_offset_minutes=${new Date().getTimezoneOffset()}&page=${page}&page_size=${pageSize}`),
    `${selection.startDate}|${selection.endDate}`,
  );
  const reconciliation = useResource(
    () => api.get<ReconciliationReport>(`/reports/reconciliation?${reportQuery}`),
    [reportQuery],
  );
  const failures = useResource(
    () => api.get<FailureReport>(`/reports/failures?${reportQuery}`),
    [reportQuery],
  );
  const printerReliability = useResource(
    () => api.get<PrinterReliabilityReport>(`/reports/printers?${reportQuery}`),
    [reportQuery],
  );

  async function downloadCsv(section: "reconciliation" | "failures" | "printers") {
    setExportError(null);
    try {
      const blob = await api.download(`/reports/${section}?${reportQuery}&format=csv`);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${section}-${selection.startDate}-${selection.endDate}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (caught) {
      setExportError(caught instanceof Error ? caught.message : "The CSV could not be exported.");
    }
  }

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
        description="Compare billed and physical output, measure waste, and review sales, quality, inventory, and printer reliability."
      />

      <nav className="report-tabs" aria-label="Report type"><button type="button" className={tab === "operations" ? "is-active" : ""} onClick={() => setTab("operations")}>Operations</button><button type="button" className={tab === "reconciliation" ? "is-active" : ""} onClick={() => setTab("reconciliation")}>Reconciliation</button><button type="button" className={tab === "quality" ? "is-active" : ""} onClick={() => setTab("quality")}>Waste &amp; quality</button><button type="button" className={tab === "discounts" ? "is-active" : ""} onClick={() => setTab("discounts")}>Discounted jobs</button></nav>

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

      {tab === "operations" && state === "loading" ? <LoadingState label={`Generating ${selection.period} report…`} /> : null}
      {tab === "operations" && state === "error" ? <ErrorState title="The report could not be generated" description={error ?? undefined} onRetry={reload} /> : null}
      {tab === "operations" && state === "ready" && data ? (
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
      {tab === "reconciliation" && reconciliation.state === "loading" ? <LoadingState label="Reconciling billed and spooler output…" /> : null}
      {tab === "reconciliation" && reconciliation.state === "error" ? <ErrorState title="Reconciliation unavailable" description={reconciliation.error ?? undefined} onRetry={reconciliation.reload} /> : null}
      {tab === "reconciliation" && reconciliation.data ? <div className="report-sheet">
        <header className="report-sheet__header"><div><span className="numeric">PRINT RECONCILIATION</span><h2>{selection.startDate === selection.endDate ? dateFormatter.format(parseCalendarDate(selection.startDate)) : `${dateFormatter.format(parseCalendarDate(selection.startDate))} – ${dateFormatter.format(parseCalendarDate(selection.endDate))}`}</h2><p>Spooler output is physical truth; successful OMS attempts are billing truth.</p></div><Button type="button" variant="secondary" onClick={() => void downloadCsv("reconciliation")}>Export CSV</Button></header>
        {exportError ? <p className="report-export-error" role="alert">{exportError}</p> : null}
        {!reconciliation.data.spoolerAvailable ? <div className="report-unavailable"><strong>Spooler data unavailable on this platform</strong><p>OMS can still show billed attempts, but physical confirmation, mismatches, and leakage require the Windows monitor.</p></div> : null}
        {reconciliation.data.spoolerAvailable ? <><section className="report-scoreboard" aria-label="Reconciliation summary"><article><span>Billed prints</span><strong className="numeric">{reconciliation.data.billedPrints}</strong></article><article><span>Confirmed</span><strong className="numeric">{reconciliation.data.spoolerConfirmed}</strong></article><article className={reconciliation.data.unconfirmed ? "has-warning" : ""}><span>Unconfirmed</span><strong className="numeric">{reconciliation.data.unconfirmed}</strong></article><article className={reconciliation.data.leakageCount ? "has-attention" : ""}><span>Leakage</span><strong className="numeric">{reconciliation.data.leakagePages} pages</strong><small>{formatCurrency(reconciliation.data.leakageEstimate)} estimated</small></article></section>
        <section className="report-panel"><header><div><span className="numeric">EXCEPTIONS</span><h3>Items to review</h3></div><strong className="numeric">{reconciliation.data.rows.length}</strong></header>{reconciliation.data.rows.length ? <div className="report-inventory-table"><table><thead><tr><th>Document</th><th>Issue</th><th>Printer</th><th>Expected</th><th>Printed</th><th>Action</th></tr></thead><tbody>{reconciliation.data.rows.map((row) => <tr key={`${row.kind}-${row.id}`}><th scope="row"><strong>{row.documentName || "Untitled print"}</strong></th><td>{methodLabel(row.kind)}</td><td>{row.printerName || "Unknown"}</td><td className="numeric">{row.expectedPages ?? "—"}</td><td className="numeric">{row.pagesPrinted ?? "—"}</td><td>{row.kind === "leakage" ? <a href="#/print-center">Review print</a> : row.jobOrderId ? <a href={`#/job-orders/${row.jobOrderId}`}>Open job</a> : "—"}</td></tr>)}</tbody></table></div> : <EmptyState title="No reconciliation exceptions" description="All available print evidence agrees for this interval." />}</section></> : null}
      </div> : null}
      {tab === "quality" && (failures.state === "loading" || printerReliability.state === "loading") ? <LoadingState label="Calculating waste and printer reliability…" /> : null}
      {tab === "quality" && failures.state === "error" ? <ErrorState title="Waste report unavailable" description={failures.error ?? undefined} onRetry={failures.reload} /> : null}
      {tab === "quality" && printerReliability.state === "error" ? <ErrorState title="Printer reliability unavailable" description={printerReliability.error ?? undefined} onRetry={printerReliability.reload} /> : null}
      {tab === "quality" && failures.data && printerReliability.data ? <div className="report-sheet">
        <header className="report-sheet__header"><div><span className="numeric">WASTE &amp; QUALITY</span><h2>{selection.startDate === selection.endDate ? dateFormatter.format(parseCalendarDate(selection.startDate)) : `${dateFormatter.format(parseCalendarDate(selection.startDate))} – ${dateFormatter.format(parseCalendarDate(selection.endDate))}`}</h2><p>Structured quality rejects and machine-side failures, grouped by cause and output device.</p></div><div className="report-export-actions"><Button type="button" variant="secondary" onClick={() => void downloadCsv("failures")}>Export failures</Button><Button type="button" variant="secondary" onClick={() => void downloadCsv("printers")}>Export printers</Button></div></header>
        <section className="report-scoreboard" aria-label="Waste summary"><article className={failures.data.totalFailures ? "has-attention" : ""}><span>Failures</span><strong className="numeric">{failures.data.totalFailures}</strong></article><article><span>Spoiled sheets</span><strong className="numeric">{failures.data.spoiledSheets}</strong></article><article><span>Material waste</span><strong>{formatCurrency(failures.data.materialCost)}</strong></article><article><span>Failure rate</span><strong className="numeric">{failures.data.failureRate}%</strong></article></section>
        <div className="report-sheet__columns"><BreakdownPanel title="Failure reasons" entries={failures.data.byReason} /><BreakdownPanel title="Fault types" entries={failures.data.byFaultType} /><BreakdownPanel title="Products" entries={failures.data.byProduct} /><BreakdownPanel title="Printers" entries={failures.data.byPrinter} /></div>
        {!printerReliability.data.spoolerAvailable ? <div className="report-unavailable"><strong>Spooler data unavailable on this platform</strong><p>Printer-side page counts and machine failures require the Windows monitor.</p></div> : null}
        {exportError ? <p className="report-export-error" role="alert">{exportError}</p> : null}
        {printerReliability.data.spoolerAvailable ? <section className="report-panel"><header><div><span className="numeric">PRINTER RELIABILITY</span><h3>Output by printer</h3></div></header>{printerReliability.data.printers.length ? <div className="report-inventory-table"><table><thead><tr><th>Printer</th><th>Jobs</th><th>Pages</th><th>Failures</th><th>Error rate</th><th>Color / mono</th><th>Duplex</th></tr></thead><tbody>{printerReliability.data.printers.map((printer) => <tr key={printer.printerName}><th scope="row"><strong>{printer.printerName}</strong></th><td className="numeric">{printer.jobs}</td><td className="numeric">{printer.pages}</td><td className="numeric">{printer.failures}</td><td className="numeric">{printer.errorRate}%</td><td className="numeric">{printer.colorJobs} / {printer.grayscaleJobs}</td><td className="numeric">{printer.duplexJobs}</td></tr>)}</tbody></table></div> : <EmptyState title="No printer activity" description="No print attempt was recorded in this interval." />}</section> : null}
      </div> : null}
      {tab === "discounts" && discountReport.state === "loading" ? <LoadingState label="Loading discounted job orders…" /> : null}
      {tab === "discounts" && discountReport.state === "error" ? <ErrorState title="Discount report unavailable" description={discountReport.error ?? undefined} onRetry={discountReport.reload} /> : null}
      {tab === "discounts" && discountReport.data ? <div className="report-sheet discount-report">
        <header className="report-sheet__header"><div><span className="numeric">DISCOUNT LEDGER</span><h2>Discounted job orders</h2><p>Jobs are included by creation date. Saved discount snapshots remain unchanged if a template is edited later.</p></div></header>
        <section className="report-scoreboard" aria-label="Discount summary"><article><span>Original subtotal</span><strong>{formatCurrency(discountReport.data.subtotalAmount)}</strong></article><article className="has-attention"><span>Discounts given</span><strong>{formatCurrency(discountReport.data.totalDiscountAmount)}</strong></article><article><span>Final value</span><strong>{formatCurrency(discountReport.data.finalAmount)}</strong></article><article><span>Discounted jobs</span><strong className="numeric">{discountReport.data.total}</strong></article></section>
        {discountReport.data.items.length ? <div className="report-inventory-table"><table><thead><tr><th>Job order</th><th>Customer</th><th>Discount</th><th>Subtotal</th><th>Discount given</th><th>Final</th></tr></thead><tbody>{discountReport.data.items.map((job) => <tr key={job.id}><th scope="row"><a href={`/job-orders/${job.id}`}><strong>{job.number} · {job.name}</strong></a><small>{dateFormatter.format(new Date(job.createdAt))}</small></th><td>{job.customerName || "Walk-in"}</td><td><strong>{job.discountName}</strong><small>{job.discountCalculationType === "percentage" ? `${job.discountValue}% off` : `${formatCurrency(job.discountValue)} off`}</small></td><td>{formatCurrency(job.subtotal)}</td><td>−{formatCurrency(job.discountAmount)}</td><td><strong>{formatCurrency(job.total)}</strong></td></tr>)}</tbody></table></div> : <EmptyState title="No discounted jobs" description="No whole-order discount was recorded during this period." />}
        <Pagination page={discountReport.page} pageSize={discountReport.pageSize} total={discountReport.data.total} totalPages={discountReport.data.totalPages} loading={discountReport.pageLoading} onPageChange={discountReport.setPage} onPageSizeChange={discountReport.setPageSize} itemLabel="discounted jobs" />
      </div> : null}
    </>
  );
}

function BreakdownPanel({ title, entries }: { title: string; entries: FailureReport["byReason"] }) {
  return <section className="report-panel"><header><div><span className="numeric">BREAKDOWN</span><h3>{title}</h3></div></header>{entries.length ? <ul className="report-reattempt-list">{entries.map((entry) => <li key={entry.key}><span><strong>{entry.label}</strong><small>{entry.spoiledSheets} spoiled sheets · {formatCurrency(entry.materialCost)}</small></span><b className="numeric">{entry.count}</b></li>)}</ul> : <EmptyState title={`No ${title.toLowerCase()}`} description="Nothing was recorded in this interval." />}</section>;
}
