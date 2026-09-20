# Functionality Map

Track app features and expected behavior.

## Current Functionality

| Area | Functionality | Status | Notes |
| --- | --- | --- | --- |
| Documentation | Context tracking docs | Active | Added under `docs/context`. |
| Application shell | OMS-branded Electron-managed FastAPI lifecycle, secure loopback IPC bridge, native/window icons, full primary navigation + nested workspace routing, and global print activity | Active | Health monitoring is shared across consumers, backs off after failures, and pauses with other renderer polling while the window is hidden. The user-facing product name is OMS; stable internal package, environment, database, and backup identifiers retain their existing names for upgrade compatibility. Windows defaults to software rendering with bounded recovery and diagnostics. Final-window close and terminal signals stop the backend process tree before Electron exits. |
| Customers | Full create/read/update/delete with linked job-order counts | Active | The customer register uses server paging and prefetch; `services/api/app/routers/customers.py`, Customer Workspace. |
| Service Catalog | Full service create/read/update/delete with Printing, Scan or Photocopy, and Custom workflow categories | Active | Product browsing shows an effective one-unit price range across configured materials and available add-ons, including active global additions and assigned discounts. Deleting a product hides it immediately and exposes Undo in that service for five days. Expired unused products are physically purged; historically referenced products retain only a hidden non-restorable audit identity. The combined service contains Photocopy products with paper pricing and Scan products with a standalone per-page rate. Custom services may contain Ad Hoc products for work completed outside the app. |
| Inventory | Material registration/editing/deletion, stock-purchase and expenditure history, purchase-backed restocking, printing-focused units, word-based material search, unit- or ream-based purchase costs, stock monitoring, audited adjustments, product assignments, measured paper profiles, and job-linked automatic deductions | Active | Material, purchase, and movement ledgers use server filtering, 25/50/100-row paging, complete-result summaries, and next-page prefetch. Recording a purchase remains financial-only until explicitly applied once to usable stock. |
| Document Analyzer | In-memory analysis of PDF, image, DOCX, XLSX, and PPTX files with normalized print metadata, pixel-based coverage measurement, interactive source preview, and product-aware PHP pricing | Active | Printing analysis resolves the selected product override, then the Printing workflow's material-linked global rate. The engine auto-discovers pages, best-fit paper, orientation, color/B&W separation, coverage, and print time. Best-fit paper is advisory. B&W includes paper/ink; coverage-aware types add measured ink coverage. Suggested prices always round upward to the next whole peso with a visible breakdown adjustment. Continuous PDF preview renders only nearby pages, caps each raster buffer, and releases distant canvases. An uploaded DOCX auto-converts to PDF right after analysis, so the retained print-ready file is always printable; XLSX and PPTX still require the owner to export to PDF before printing. |
| Printer Integration | Vendor-neutral discovery, concurrent submission, supervised manual duplex, color-adjusted output proofs, photo-media profiles, custom output geometry, and Windows spooler observation | Active | Tracked Windows prints can resolve one exact supported filename from a configured read-only source folder and pre-attach it for explicit analysis; missing or ambiguous matches require manual selection. Spooler observation backs off while idle, and renderer polling pauses while hidden. |
| Templates | Business-card sheet imposition with bounded front/back artwork canvases | Active | Templates opens a dedicated Business Card workspace. Owners can select A4 or Letter orientation, finished size, margin, gap, bleed, crop marks, and ±10 mm reverse-side calibration. The same editable master can be inspected as a full sheet, focused 1:1 card, or side-by-side front/back comparison; artwork stays draggable, keyboard-nudgeable, resizable, and aligned within the safe area in every view. The canvas supports 50–250% zoom and scrolling. Front and back share one grid and upright page orientation; generation opens both pages in a continuous PDF preview before an explicit download. |
| Maintenance | Manufacturer-grounded printer-care guidance plus owner-managed transaction reminders | Active | Canon PIXMA MegaTank G4070-series guidance currently covers the G4770. Owners can add, edit, pause, reactivate, and remove short care reminders. Active reminders rotate through a dismissible top-right prompt, auto-hide after ten seconds, and surface after every successful job-order mutation. OMS does not issue printer maintenance commands. |
| Expenses | Unified operating-expense and stock-purchase cost ledger | Active | The filtered ledger uses 25/50/100-row paging and next-page prefetch while interval totals and category breakdowns continue to cover the complete result. Stock-purchase costs remain read-only linked entries governed by Inventory. |
| Overview | Top-of-page quick actions plus live counts for job status, payments, deadlines, and print queue depth | Active | New Job Order is the highlighted primary action and opens the analyzed transaction modal in one click; New Customer and New Service remain secondary shortcuts. Metrics read real data and honestly show zero until records exist. |
| Pricing | App-managed global additions, product discounts, product-aware rate matrices, searchable category material assignments, and a centralized read-only price book | Active | Pricing categories may assign any active inventory material. For Printing and Scan or Photocopy, only paper-tagged assignments create per-page rate rows; other assignments (ink, toner, binding, laminate…) define additional supplies available to new products in that category. Ad Hoc categories are the exception: since Ad Hoc has no physical paper to feed, every assigned material gets a priceable rate row, not only paper-tagged ones — a lamination pouch or film is priced the same way a paper size is for Printing/Photocopy. Material assignment includes search by name, category, unit, or paper size. Printing and Scan or Photocopy remain seeded categories, and owners may create additional compatible categories. |
| Settings | Business profile, configurable managed-data and tracked-print source locations, live environment switching, verified backup/restore, safe leftover cleanup, stage-separated database paths, and backend diagnostics | Active | The trusted source folder is a machine-local, read-only setting outside backups. Changing the data root still copies every stage to a validated empty folder, retains the old root as a safety copy, and restarts the backend. |
| Job Orders | Multi-service transaction intake with independent product operations, combined payment/completion, audited void-and-correction, product repricing/cancellation, quality reprocessing, deliverables, and audit history | Active | Each new product line can own one unreviewed tracked Windows print; the same event is disabled on other lines, its trusted-folder file is attached automatically when unique, and an owner-selected file is preserved. The register and attachment picker use server paging/prefetch. |
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

The application structure consists of Overview, Printing Job Orders, Print Center, Inventory, Maintenance, Expenses, Document Analyzer, Printing Services, Customers, Reports, Pricing, Configuration, and Settings. Job orders, services/products, and customers open focused nested workspaces instead of adding more top-level navigation. Detailed contents and module coverage are defined in [initial-pages.md](initial-pages.md).

## Business Workflow Context

Job Orders and material-history ledger filters are embedded beneath column headings. Job Orders exposes direction-toggle sorting on Job, Date created, Total, and Due; its creation-date range uses one compact trigger with an anchored From/Through panel. Filters remain available in empty results.

Inventory's per-material History page shows lifetime transaction deductions, returns, net consumption, linked current job status/product names, and the full stock ledger with running balances and audit notes. A ledger-total comparison flags differences against current stock. Job links support backtracking; movement quantities remain historical while names/status reflect current records.

Inventory's Stock purchases sub-page records purchase quantities and actual supplier spend before they enter usable transaction stock. Its purchase form searches active materials by name, category, or unit. The ledger shows UUIDs, per-purchase package sizes, application state, current-month and all-time expenditure, searchable history, per-unit cost, supplier/reference context, repeat-purchase shortcuts, protected applied records, confirmed deletion of unapplied entries, and retained material snapshots. The material register's Restock action selects a specific available purchase, previews the converted quantity and resulting balance, and applies it once.

The Printing Job Orders list displays creation dates in local time and supports search by job name/number, customer, or product; status/reprocess and inclusive creation-date filters; and newest/oldest, name, total, or due-date sorting. The same controls apply to eligible orders when attaching a tracked print.

The external business flow explains why OMS exists; it is not itself the application boundary:

1. Gather customer requirements through Messenger, Gmail, or a form.
2. Choose the initial service, then add one or more products from any active service to the same transaction.
3. Complete each product's own requirements: analyze Printing documents, enter Photocopy quantities, defer Scan acquisition to the saved job, or record quantities/materials for externally completed Ad Hoc work.
4. Review the per-product price breakdown and confirm one combined transaction, or cancel without saving it.
5. Work each product independently in the job workspace. When all lines are Ready, collect one payment and complete the transaction as a whole.

OMS is the central application supporting this flow through the initial modules listed above. Whether Messenger and Gmail are directly integrated or handled through manual data entry is not yet decided.

Discount configuration supports automatic product-specific reductions and reusable whole-job templates. During transaction creation or before payment in the job workspace, the owner can select a whole-job template or enter a custom percentage/fixed discount. The payable total is the product-line subtotal less the capped discount; the saved snapshot feeds the paginated Reports → Discounted job orders ledger.

## Template

### Feature Name

- Area:
- Status:
- User flow:
- Expected behavior:
- Related files:
- Notes:
- Job-order product lines preserve and display a signed pricing breakdown (base, variants, analyzer adjustments, global variables, discounts, rounding, owner override, and cancellation) for historical reconciliation.
