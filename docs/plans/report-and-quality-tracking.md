# Print Reports & Quality Failure Tracking

> **Status:** Implemented. The recommendations and resolved defaults below were approved for implementation on 2026-09-26.
> **Date:** 2026-09-26

## Vision

Bring what OMS *billed* and what the printers *actually output* into one picture. Every failure (bad output, spooler error, rejected submission) should leave a structured record, so reports can answer three questions: where money leaks, what waste costs, and which printers or settings fail.

---

# Current State

### Two print sources

| Source | Table | How it gets there | Link to an order |
|---|---|---|---|
| In-app print | `print_jobs` (`PrintJob`, `models.py:884`) | `POST /job-orders/{id}/print-attempts` (`job_orders.py:2077`) | Direct (`job_order_id`, `job_order_item_id`) |
| Tracked print from the spooler | `observed_print_jobs` (`ObservedPrintJob`, `models.py:848`) | `windows_spooler_monitor.ps1` → `spooler_monitor.py` | Manual: the owner links or dismisses it (`review_status`) |

- In-app attempts are tagged `OMS|<attempt id>|<name>` in the spooler document name (`windows_print.ps1:92`). The monitor uses that tag to write `spooler_*` fields back onto the `PrintJob`.
- Spooler monitoring is **Windows-only**. On CUPS, `tracking_id` is ignored and there is no monitor.
- Observed jobs carry no error or reason detail beyond `raw_status`.

### Quality failures

- A failure is a ready → queued transition (job level `job_orders.py:1816`, item level `:1893`). `_plan_item_reprocess` increments `reprocess_count`.
- The reason is optional free text (≤500 chars), stored only in the status-event `note` ("Quality failed: …") by `JobQualityFailureModal.tsx`.
- Not captured: reason categories, spoiled sheet count, the `PrintJob` that produced the bad output, and the failure cost.
- Waste shows up only indirectly, as the paper-usage confirmation at completion (`_reconcile_paper_usage`, `:2439`).

### Reports (`GET /reports`, `reports.py:98`)

- **Sales:** verified payments by method.
- **Re-attempts:** count of ready → queued item events per product.
- **Inventory:** live snapshot.
- **Discount ledger:** paginated.
- No report reads `print_jobs` or `observed_print_jobs`. There is no export and there are no scheduled reports.

### Known gaps found during review

1. `/from-analysis` (`job_orders.py:1461`) sets `linked_job_order_id` but never `linked_job_order_item_id`.
2. A job-level quality failure on a multi-item job writes no item events, so re-attempts are **undercounted**.
3. Voiding a payment flips `verified=False`, so it silently disappears from past-period sales instead of showing as a reversal.
4. The discount report filters by `created_at`, while sales filter by payment `recorded_at`.
5. `AuditEntry` is defined but never written.

---

# Goals

- A single **Print Failure** ledger covering every way a print can fail.
- Structured quality-failure capture: reason category, spoiled sheets, and the linked print attempt.
- A **Reconciliation** report comparing in-app prints with spooler output (leakage and page mismatches).
- A **Waste & Quality** report covering spoiled sheets, cost, and breakdowns by product, printer and reason.
- **Printer reliability** breakdowns.
- CSV export per report section.

## Non-goals (this iteration)

- A CUPS/macOS spooler monitor.
- Multi-user attribution or departments (the owner is the only operator).
- Scheduled or emailed reports.
- XLSX/PDF export.

---

# Proposed Design

## 1. Print Failure ledger

New table `print_failures`:

| Column | Notes |
|---|---|
| `id` | |
| `source` | `quality_rejected` · `spooler_error` · `submit_failed` · `cancelled_mid_print` |
| `job_order_id`, `job_order_item_id` | nullable for unlinked spooler errors |
| `print_job_id` | nullable FK → `print_jobs` |
| `observed_print_job_id` | nullable FK → `observed_print_jobs` |
| `printer_name` | denormalized for reporting |
| `reason_code` | FK/enum → failure reason catalog (see below) |
| `reason_note` | optional free text (keeps today's behaviour) |
| `spoiled_sheets` | int, nullable (owner-entered for `quality_rejected`; inferred from spooler pages otherwise) |
| `material_cost_snapshot` | cost of spoiled sheets at the time of failure |
| `occurred_at`, `recorded_at` | |

What writes a row:

- **`quality_rejected`**: the existing ready → queued action, at both job and item level. For job-level failures, write one row per affected item, which also fixes gap #2. The existing reprocess flow is unchanged.
- **`submit_failed`**: the print-attempts endpoint whenever `result=failed`.
- **`spooler_error`**: the spooler monitor, when a job's normalized status is `error`/`paused` and the job is then released with `pages_printed < total_pages`. Written for both internal and observed jobs.
- **`cancelled_mid_print`**: the monitor, when a job is released while `printing` with `0 < pages_printed < total_pages` and no error was seen.

Only `quality_rejected` triggers reprocessing. The machine-side sources are recorded for reporting only.

## 2. Failure reason catalog

A seeded, owner-editable list, e.g.:

- Streaks / banding
- Faded / low toner
- Wrong color
- Misalignment / skew
- Wrong paper / size
- Paper jam
- Smudge / wet ink
- Duplex back side wrong
- Wrong file / version
- Customer changed request
- Other

Each reason is tagged `machine` · `material` · `operator` · `customer`, so reports can separate fault types. For machine-side sources the reason is pre-filled (e.g. `spooler_error` → "Printer error").

## 3. Quality failure modal changes (`JobQualityFailureModal.tsx`)

- Reason category: required, chosen from the catalog.
- Note: optional, as today.
- Spoiled sheets: pre-filled from the last successful `PrintJob`'s sheet count, editable.
- Print attempt: pre-selected to the latest attempt for the item. Only shown when there is more than one.

## 4. Reconciliation logic

Page-count truth, per the proposal:

- **Spooler** is the truth for physical output.
- **In-app** is the truth for billing.
- The report shows the gap.

Per period, the report computes:

- **Billed prints**: `PrintJob` with `result=succeeded`.
- **Spooler-confirmed**: of those, the ones with a matching `spooler_key` and a release.
- **Unconfirmed**: billed prints the spooler never saw. They may be driver issues or bypassed monitoring.
- **Page mismatches**: `pages_printed ≠ expected pages`. Only counted when the spooler count is non-zero, because many drivers report 0.
- **Leakage**: `ObservedPrintJob` rows that are `unreviewed`, or `dismissed`, with their page totals. The leakage estimate prices unlinked pages at the default per-page rate.
- **Linked external prints**: observed jobs later linked to orders, i.e. recovered revenue.

External reprints are reconciled per product line: one observed print is the
successful output and any earlier rejected attempts link to the same item. The
rejected attempts create `quality_rejected` ledger rows, count their material
as a new production cycle, and no longer remain in leakage as unreviewed work.

## 5. Reports API & UI

Extend `GET /reports` (or add sibling endpoints to keep payloads lean):

| Section | Endpoint | Key metrics |
|---|---|---|
| Reconciliation | `GET /reports/reconciliation` | billed vs confirmed vs unconfirmed, mismatches, leakage count/pages/estimate |
| Waste & Quality | `GET /reports/failures` | failures by source / reason / fault type / product / printer, spoiled sheets, cost, failure rate |
| Printer reliability | `GET /reports/printers` | per printer: jobs, pages, failures by source, error rate, color/duplex split |
| Existing | `GET /reports` | sales, re-attempts (now sourced from `print_failures`), inventory |

- Every section supports `?format=csv`.
- UI: add **Reconciliation** and **Waste & Quality** tabs to `ReportsPage.tsx`. Leakage rows deep-link to the existing spooler review flow.
- On non-Windows hosts, spooler-derived sections show "Spooler data unavailable on this platform" instead of zeros.

## 6. Adjacent fixes

- Gap #1: `/from-analysis` must set `linked_job_order_item_id`. Required for reconciliation.
- Gap #2: fixed by writing per-item failures (above).
- Gaps #3, #4 and #5 are tracked separately.

## 7. Data migration / backfill

- Alembic migration for `print_failures` and `failure_reasons`.
- Backfill `quality_rejected` rows from existing ready → queued `JobOrderItemStatusEvent`s: `reason_code = Other`, `reason_note` parsed from "Quality failed: …", `spoiled_sheets = NULL`.
- Backfill `submit_failed` rows from `print_jobs.result = failed`.
- No backfill for spooler errors, because historical per-poll status is not retained.

---

# Phasing

1. **Ledger & capture.** Add the migration, the reason catalog, the modal changes, and failure writes from quality/submit, then the backfill. Fix gap #1.
2. **Spooler-side failures.** Add monitor detection for `spooler_error` / `cancelled_mid_print`.
3. **Reports.** Build the reconciliation, failures and printer endpoints, then the UI tabs.
4. **Export.** CSV per section.

---

# Testing

- `test_reports.py`: reconciliation counts (confirmed / unconfirmed / mismatch / zero-count driver skip), leakage, failure aggregation by reason and printer, CSV output.
- `test_job_orders.py`: a job-level failure on a multi-item job writes one failure per item; the modal payload requires a reason code.
- `test_printers.py`: the monitor writes `spooler_error` and `cancelled_mid_print` from sequences of seen/released events; clean releases write nothing.
- Migration test: the backfill converts existing events and failed attempts.

---

# Resolved implementation decisions

The owner still needs to answer these. Each shows its recommendation.

### Round 1 (asked)

| # | Decision | Recommendation |
|---|---|---|
| Q1 | Primary goal of the reports: leakage, waste cost, printer reliability, or volume | Leakage + waste cost as the core; reliability as a breakdown |
| Q2 | What counts as a "failed quality" | Unified Print Failure ledger with `source`; only `quality_rejected` reprocesses |
| Q3 | Which page count is the truth | Spooler for physical output, in-app for billing; flag the gap only when the spooler count is non-zero |
| Q4 | Platform scope | Windows-only; other platforms show "unavailable" |
| Q5 | Fix known gaps in this effort | Fix #1 and #2 now; #3 and #4 separately |
| Q6 | Export format | CSV now |

### Later-round defaults used

- Owner-editable catalog; a reason is required for quality rejection.
- Spoiled sheets may be deferred; a value entered at failure time is the ledger snapshot.
- Waste cost is material-only.
- Leakage uses the first active default mono per-page rate.
- Dismissed observed jobs are treated as non-billable and excluded from leakage.
- Unconfirmed attempts remain report-only.
- Paused/error jobs count only when released incomplete; a resumed clean release does not.
- Existing quality events and failed submissions are backfilled.
- Failure periods use `occurred_at`.
