# Functionality Map

Track app features and expected behavior.

## Current Functionality

| Area | Functionality | Status | Notes |
| --- | --- | --- | --- |
| Documentation | Context tracking docs | Active | Added under `docs/context`. |
| Application shell | OMS-branded Electron-managed FastAPI lifecycle, secure loopback IPC bridge, native/window icons, full primary navigation + nested workspace routing, and global print activity | Active | The user-facing product name is OMS; stable internal package, environment, database, and backup identifiers retain their existing names for upgrade compatibility. Windows source builds preflight critical `.venv` imports and repair the locked environment once when required, including a forced PyMuPDF wheel reinstall. Windows defaults to software rendering, records GPU/renderer failures, performs one bounded renderer recovery, and offers retry/close instead of remaining white. Startup failures retain their cause and use a retry cooldown. The validated Desktop shortcut supports spaced paths; final-window close and terminal signals stop the backend process tree before Electron exits. |
| Customers | Full create/read/update/delete with linked job-order counts | Active | `services/api/app/routers/customers.py`, Customer Workspace. |
| Service Catalog | Full service create/read/update/delete with Printing, Scan or Photocopy, and Custom workflow categories | Active | Product browsing shows an effective one-unit price range across configured materials and available add-ons, including active global additions and assigned discounts. Deleting a product hides it immediately and exposes Undo in that service for five days. Expired unused products are physically purged; historically referenced products retain only a hidden non-restorable audit identity. The combined service contains Photocopy products with paper pricing and Scan products with a standalone per-page rate. Custom services may contain Ad Hoc products for work completed outside the app. |
| Inventory | Material registration/editing/deletion, stock-purchase and expenditure history, purchase-backed restocking, printing-focused units, word-based material search, unit- or ream-based purchase costs, stock monitoring, audited adjustments, product assignments, measured paper profiles, and job-linked automatic deductions | Active | Recording a purchase captures its UUID, material, quantity/unit, per-purchase sheets per ream, cost, date, supplier, reference, and notes without immediately changing usable inventory. Inventory can explicitly apply one available purchase once; the converted quantity becomes an audited stock-in movement linked to that purchase ID. Applied purchases cannot be deleted. Unapplied purchase deletion affects only expenditure totals, and purchase snapshots remain after material removal. |
| Document Analyzer | In-memory analysis of PDF, image, DOCX, XLSX, and PPTX files with normalized print metadata, pixel-based coverage measurement, interactive source preview, and product-aware PHP pricing | Active | Printing analysis resolves the selected product override, then the Printing workflow's material-linked global rate. The engine auto-discovers pages, best-fit paper, orientation, color/B&W separation, coverage, and print time. Best-fit paper is advisory. B&W includes paper/ink; coverage-aware types add measured ink coverage. Suggested prices always round upward to the next whole peso with a visible breakdown adjustment. Continuous PDF preview renders only nearby pages, caps each raster buffer, and releases distant canvases. |
| Printer Integration | Vendor-neutral discovery, concurrent submission, supervised manual duplex, photo-media profiles, custom output geometry, and Windows spooler observation | Active | Print Center highlights the OS default printer and separates selectable alternatives under Others. Every unreviewed external spooler row can create a job or open the existing-job picker; choosing Not now hides only its notification and leaves those actions available in Print Center. Linked rows open their job and explicitly dismissed rows remain audit-only. Photo Print may send validated per-attempt custom dimensions with a live proof; this driver override does not rewrite approved material, pricing, or inventory. A back-to-back Photo Print accepts ordered one-side PDF/images and combines them into one retained print-ready PDF; ordinary document duplex continues to use consecutive pages from its single uploaded file. Multiple jobs may queue while earlier work prints, with spooler progress and supervised duplex checkpoints retained. Development alone exposes a guarded simulated-completion action that skips OS submission, deducts planned materials, and records an explicit bypass audit note. |
| Overview | Top-of-page quick actions plus live counts for job status, payments, deadlines, and print queue depth | Active | New Job Order is the highlighted primary action and opens the analyzed transaction modal in one click; New Customer and New Service remain secondary shortcuts. Metrics read real data and honestly show zero until records exist. |
| Pricing | App-managed global additions, product discounts, product-aware rate matrices, and a centralized read-only price book | Active | Pricing owns global percentage/fixed additions and reusable percentage/fixed discounts assigned to explicit products. Active additions are calculated first, then assigned discounts; suggested prices never fall below zero. Effective tables, catalog ranges, analyzer recommendations, and transaction estimates include both while raw matrices remain visibly separate. Printing and Scan or Photocopy remain seeded pricing categories, and owners may create additional compatible categories in Configuration. |
| Settings | Business profile, live environment switching, verified backup/restore, stage-separated database paths, and backend diagnostics | Active | Each stage owns its SQLite database, managed files, backups, non-secret `config.json`, and rotating backend log. Startup phases, slow requests, shutdown, and complete crash tracebacks are timestamped. Switching restarts the backend with a 120-second readiness window. Backup uses a Windows-safe publication fallback; matching-stage restore creates a safety backup and reloads all renderer state. |
| Job Orders | Multi-service transaction intake with independent product operations, combined payment/completion, audited void-and-correction, product repricing/cancellation, quality reprocessing, deliverables, and audit history | Active | Paid or completed transactions can be voided back to Ready: verified payments are retained as voided audit records and removed from sales totals. The owner can then correct a line to another compatible product and price without changing production files, attempts, quantities, or consumed inventory, before recording payment again. Before payment, each active product can also be repriced or cancelled with an audit reason. Payment unlocks when all non-cancelled lines are Ready; customer tender is entered explicitly, an Exact amount shortcut fills the balance, and any change is shown before confirmation. Completion details scroll within the viewport while the dialog actions remain visible. |
| Reports | Interval-based sales, quality re-attempt, and live inventory reports | Active | Owners select explicit From/To dates. Daily, Weekly, and Monthly are quick filters for today, the complete Monday-Sunday week, and the complete calendar month using the workstation's local calendar; choosing one immediately regenerates the report and displays its exact selected interval. Sales total verified payments recorded in-interval; re-attempts count product lines moved from Ready back to Queued by failed quality. Inventory is a current active-material snapshot classified as Healthy, Low, or Out of stock. Validation, loading, retry, and honest empty states are active. |

## Planned Functionality

| Area | Functionality | Priority | Notes |
| --- | --- | --- | --- |
| Job Order Management | Automate additional material estimates | Initial | Planned paper and owner-entered supply quantities now deduct automatically after print submission. Analyzer-derived ink/toner/finishing quantity formulas remain undefined; those supplies still require an owner-entered planned quantity. |
| Real-time Tracking | Per-job status-event timeline and scheduling notifications | Initial | A separate Production page was removed; tracking should remain in Job Orders, the job workspace, and Overview. |
| Document Management | Add ready-to-print conversion/export and retention administration | Initial | Confirmed transaction files are stored with their job order, scanned output shares the same environment-managed file tree, and both are covered by verified backup/restore. Conversion/export and retention cleanup remain. |
| Printer Integration | Inspect capabilities and add queue cancellation/reconciliation | Initial | Standard quality and borderless requests are active. Windows passes borderless intent to the installed driver because public .NET margins cannot reliably reveal Canon-private support. Automatic per-printer capability discovery, physical profile validation, OS completion reconciliation, and cancellation/retry controls remain. |
| Reports and Analytics | Expand operational reports with product/customer performance and export | Initial | Daily/weekly/monthly verified sales, re-attempts, and current inventory are active. Product margin, customer analysis, CSV/PDF export, refund accounting, and longer-range comparisons remain planned. |

## Initial Page Coverage

The application structure consists of Overview, Printing Job Orders, Print Center, Inventory, Document Analyzer, Printing Services, Customers, Reports, Pricing, Configuration, and Settings. Job orders, services/products, and customers open focused nested workspaces instead of adding more top-level navigation. Detailed contents and module coverage are defined in [initial-pages.md](initial-pages.md).

## Business Workflow Context

Job Orders and material-history ledger filters are embedded beneath column headings. Job Orders exposes direction-toggle sorting on Job, Date created, Total, and Due; its creation-date range uses one compact trigger with an anchored From/Through panel. Filters remain available in empty results.

Inventory's per-material History page shows lifetime transaction deductions, returns, net consumption, linked current job status/product names, and the full stock ledger with running balances and audit notes. A ledger-total comparison flags differences against current stock. Job links support backtracking; movement quantities remain historical while names/status reflect current records.

Inventory's Stock purchases sub-page records purchase quantities and actual supplier spend before they enter usable transaction stock. It shows UUIDs, per-purchase package sizes, application state, current-month and all-time expenditure, searchable history, per-unit cost, supplier/reference context, repeat-purchase shortcuts, protected applied records, confirmed deletion of unapplied entries, and retained material snapshots. The material register's Restock action selects a specific available purchase, previews the converted quantity and resulting balance, and applies it once.

The Printing Job Orders list displays creation dates in local time and supports search by job name/number, customer, or product; status/reprocess and inclusive creation-date filters; and newest/oldest, name, total, or due-date sorting. The same controls apply to eligible orders when attaching a tracked print.

The external business flow explains why OMS exists; it is not itself the application boundary:

1. Gather customer requirements through Messenger, Gmail, or a form.
2. Choose the initial service, then add one or more products from any active service to the same transaction.
3. Complete each product's own requirements: analyze Printing documents, enter Photocopy quantities, defer Scan acquisition to the saved job, or record quantities/materials for externally completed Ad Hoc work.
4. Review the per-product price breakdown and confirm one combined transaction, or cancel without saving it.
5. Work each product independently in the job workspace. When all lines are Ready, collect one payment and complete the transaction as a whole.

OMS is the central application supporting this flow through the initial modules listed above. Whether Messenger and Gmail are directly integrated or handled through manual data entry is not yet decided.

## Template

### Feature Name

- Area:
- Status:
- User flow:
- Expected behavior:
- Related files:
- Notes:
- Job-order product lines preserve and display a signed pricing breakdown (base, variants, analyzer adjustments, global variables, discounts, rounding, owner override, and cancellation) for historical reconciliation.
