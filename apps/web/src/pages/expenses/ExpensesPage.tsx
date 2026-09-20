import { FormEvent, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { Link } from "react-router-dom";
import { Button } from "../../components/Button/Button";
import { EmptyState } from "../../components/EmptyState/EmptyState";
import { ErrorState } from "../../components/ErrorState/ErrorState";
import { LoadingState } from "../../components/LoadingState/LoadingState";
import { PageHeader } from "../../components/PageHeader/PageHeader";
import { Pagination } from "../../components/Pagination/Pagination";
import { usePaginatedResource } from "../../hooks/usePaginatedResource";
import { api } from "../../lib/apiClient";
import { formatCurrency } from "../../lib/format";
import type { ExpenseLedgerEntry, ExpenseLedgerPage, ExpenseSource, ReportPeriod } from "../../types/domain";
import { ExpenseDeleteModal, ExpenseEditorModal } from "./ExpenseModals";
import "./ExpensesPage.css";

type QuickPeriod = Exclude<ReportPeriod, "custom">;
interface Interval { period: ReportPeriod; startDate: string; endDate: string }
interface LedgerFilters { query: string; source: "" | ExpenseSource; category: string }

function localDateValue(value = new Date()): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function currentInterval(period: QuickPeriod): Interval {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start);
  if (period === "daily") return { period, startDate: localDateValue(start), endDate: localDateValue(end) };
  if (period === "weekly") {
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    end.setTime(start.getTime());
    end.setDate(end.getDate() + 6);
  } else {
    start.setDate(1);
    end.setMonth(end.getMonth() + 1, 0);
  }
  return { period, startDate: localDateValue(start), endDate: localDateValue(end) };
}

function displayDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" }).format(new Date(year, month - 1, day));
}

export function ExpensesPage() {
  const initialInterval = currentInterval("monthly");
  const [interval, setInterval] = useState<Interval>(initialInterval);
  const [activeQuickPeriod, setActiveQuickPeriod] = useState<QuickPeriod | null>("monthly");
  const [draftStart, setDraftStart] = useState(initialInterval.startDate);
  const [draftEnd, setDraftEnd] = useState(initialInterval.endDate);
  const [draftFilters, setDraftFilters] = useState<LedgerFilters>({ query: "", source: "", category: "" });
  const [filters, setFilters] = useState<LedgerFilters>(draftFilters);
  const [dateError, setDateError] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<ExpenseLedgerEntry | null>(null);
  const [deletingExpense, setDeletingExpense] = useState<ExpenseLedgerEntry | null>(null);

  const queryString = useMemo(() => {
    const params = new URLSearchParams({ start_date: interval.startDate, end_date: interval.endDate });
    if (filters.query.trim()) params.set("q", filters.query.trim());
    if (filters.source) params.set("source", filters.source);
    if (filters.category) params.set("category", filters.category);
    return params.toString();
  }, [interval, filters]);
  const { data, state, error, reload, setPage, pageSize, setPageSize, pageLoading } = usePaginatedResource<ExpenseLedgerEntry, ExpenseLedgerPage>(
    (page, size) => api.get<ExpenseLedgerPage>(`/expenses/page?${queryString}&page=${page}&page_size=${size}`), queryString,
  );

  function applyQuickPeriod(period: QuickPeriod) {
    const next = currentInterval(period);
    setActiveQuickPeriod(period);
    setDraftStart(next.startDate);
    setDraftEnd(next.endDate);
    setDateError(null);
    setInterval(next);
  }

  function applyFilters(event: FormEvent) {
    event.preventDefault();
    if (!draftStart || !draftEnd) { setDateError("Choose both start and end dates."); return; }
    if (draftEnd < draftStart) { setDateError("The end date must be on or after the start date."); return; }
    setDateError(null);
    setActiveQuickPeriod(null);
    setInterval({ period: "custom", startDate: draftStart, endDate: draftEnd });
    setFilters(draftFilters);
  }

  function clearFilters() {
    const blank = { query: "", source: "", category: "" } as const;
    setDraftFilters(blank);
    setFilters(blank);
  }

  function openNewExpense() { setEditingExpense(null); setEditorOpen(true); }
  function openEditExpense(expense: ExpenseLedgerEntry) { setEditingExpense(expense); setEditorOpen(true); }
  const maxCategoryAmount = Math.max(0, ...(data?.categoryTotals.map((item) => item.amount) ?? []));

  return (
    <>
      <PageHeader eyebrow="OPERATIONS / COST LEDGER" title="Expenses" description="Track operating costs and material purchases together without duplicating the Inventory ledger." actions={<Button variant="primary" onClick={openNewExpense}>Record expense</Button>} />

      <form className="expense-filters" onSubmit={applyFilters} noValidate>
        <fieldset><legend>Quick interval</legend><div>{(["daily", "weekly", "monthly"] as QuickPeriod[]).map((period) => <button key={period} type="button" aria-pressed={activeQuickPeriod === period} onClick={() => applyQuickPeriod(period)}><strong>{period}</strong><small>{period === "daily" ? "Today" : period === "weekly" ? "This week" : "This month"}</small></button>)}</div></fieldset>
        <div className={`expense-filters__dates${dateError ? " is-invalid" : ""}`}><span>Date interval</span><div><label><span>From</span><input type="date" value={draftStart} max={draftEnd || undefined} onChange={(event) => { setDraftStart(event.target.value); setActiveQuickPeriod(null); setDateError(null); }} aria-invalid={Boolean(dateError)} aria-describedby={dateError ? "expense-date-filter-error" : undefined} /></label><i aria-hidden="true">→</i><label><span>To</span><input type="date" value={draftEnd} min={draftStart || undefined} onChange={(event) => { setDraftEnd(event.target.value); setActiveQuickPeriod(null); setDateError(null); }} aria-invalid={Boolean(dateError)} aria-describedby={dateError ? "expense-date-filter-error" : undefined} /></label></div></div>
        <label><span>Search</span><input type="search" value={draftFilters.query} onChange={(event) => setDraftFilters({ ...draftFilters, query: event.target.value })} placeholder="Expense, payee, receipt…" /></label>
        <label><span>Source</span><select value={draftFilters.source} onChange={(event) => setDraftFilters({ ...draftFilters, source: event.target.value as LedgerFilters["source"] })}><option value="">All sources</option><option value="manual">Operating expenses</option><option value="stock_purchase">Stock purchases</option></select></label>
        <label><span>Category</span><select value={draftFilters.category} onChange={(event) => setDraftFilters({ ...draftFilters, category: event.target.value })}><option value="">All categories</option>{data?.availableCategories.map((category) => <option key={category}>{category}</option>)}</select></label>
        <Button type="submit" loading={state === "loading"}>Apply filters</Button>
        {dateError && <small id="expense-date-filter-error" className="expense-filters__error" role="alert">{dateError}</small>}
      </form>

      {state === "loading" && <LoadingState label="Calculating expenses…" />}
      {state === "error" && <ErrorState title="Couldn't load expenses" description={error ?? undefined} onRetry={reload} />}
      {state === "ready" && data && <>
        <section className="expense-summary" aria-label="Expense totals for selected interval">
          <article className="expense-summary__total"><span>Total expenses</span><strong>{formatCurrency(data.totalAmount)}</strong><small>{displayDate(interval.startDate)} – {displayDate(interval.endDate)}</small></article>
          <article><span>Operating expenses</span><strong>{formatCurrency(data.manualExpenseTotal)}</strong><small>Recorded directly in Expenses</small></article>
          <article><span>Stock purchases</span><strong>{formatCurrency(data.stockPurchaseTotal)}</strong><small>Linked from Inventory</small></article>
          <article><span>Ledger entries</span><strong className="numeric">{data.entryCount}</strong><small>Inside the selected interval</small></article>
        </section>

        <div className="expense-layout">
          <section className="expense-ledger" aria-labelledby="expense-ledger-title"><header><div><span className="numeric">UNIFIED LEDGER</span><h2 id="expense-ledger-title">Money out</h2></div>{(filters.query || filters.source || filters.category) && <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>Clear filters</Button>}</header>
            {data.items.length ? <><div className="expense-table" role="region" aria-label="Expense ledger" tabIndex={0}><table><thead><tr><th>Date</th><th>Expense</th><th>Category</th><th>Paid to / reference</th><th>Amount</th><th><span className="visually-hidden">Actions</span></th></tr></thead><tbody>{data.items.map((entry) => <tr key={`${entry.source}-${entry.id}`}><td className="numeric">{displayDate(entry.spentOn)}</td><th scope="row"><strong>{entry.description}</strong><small>{entry.source === "stock_purchase" ? "Inventory stock purchase" : "Operating expense"}{entry.notes ? ` · ${entry.notes}` : ""}</small></th><td><span className={`expense-source expense-source--${entry.source}`}>{entry.category}</span></td><td><strong>{entry.paidTo ?? "—"}</strong><small>{entry.reference ?? "No reference"}</small></td><td className="numeric expense-table__amount">{formatCurrency(entry.amount)}</td><td>{entry.source === "manual" ? <div className="expense-table__actions"><Button size="sm" variant="ghost" onClick={() => openEditExpense(entry)}>Edit</Button><Button size="sm" variant="ghost" onClick={() => setDeletingExpense(entry)}>Remove</Button></div> : <Link to="/inventory/stocks" className="expense-table__link">View purchase</Link>}</td></tr>)}</tbody></table></div><Pagination page={data.page} pageSize={pageSize} total={data.total} totalPages={data.totalPages} loading={pageLoading} onPageChange={setPage} onPageSizeChange={setPageSize} itemLabel="expenses" /></> : <EmptyState title="No expenses found" description="No operating expense or stock purchase matches this period and filters." action={(filters.query || filters.source || filters.category) ? <Button type="button" size="sm" onClick={clearFilters}>Clear filters</Button> : <Button type="button" size="sm" onClick={openNewExpense}>Record first expense</Button>} />}
          </section>

          <aside className="expense-categories" aria-labelledby="expense-categories-title"><header><span className="numeric">BREAKDOWN</span><h2 id="expense-categories-title">By category</h2></header>{data.categoryTotals.length ? <ol>{data.categoryTotals.map((item) => <li key={item.category}><div><strong>{item.category}</strong><span>{item.entryCount} {item.entryCount === 1 ? "entry" : "entries"}</span></div><b>{formatCurrency(item.amount)}</b><i style={{ "--expense-share": `${maxCategoryAmount ? (item.amount / maxCategoryAmount) * 100 : 0}%` } as CSSProperties} /></li>)}</ol> : <p>No category spending in this interval.</p>}<footer>Stock purchases are included automatically and remain controlled by the <Link to="/inventory/stocks">Inventory purchase ledger</Link>.</footer></aside>
        </div>
      </>}

      <ExpenseEditorModal open={editorOpen} expense={editingExpense} categories={data?.availableCategories ?? []} onClose={() => setEditorOpen(false)} onSaved={() => { setEditorOpen(false); reload(); }} />
      <ExpenseDeleteModal expense={deletingExpense} onClose={() => setDeletingExpense(null)} onDeleted={() => { setDeletingExpense(null); reload(); }} />
    </>
  );
}
