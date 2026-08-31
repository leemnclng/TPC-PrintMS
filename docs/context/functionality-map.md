# Functionality Map

Track app features and expected behavior.

## Current Functionality

| Area | Functionality | Status | Notes |
| --- | --- | --- | --- |
| Documentation | Context tracking docs | Active | Added under `docs/context`. |
| Application shell | Electron-managed FastAPI lifecycle, secure loopback IPC bridge, branded native/window icons, full primary navigation + nested workspace routing, and global print activity | Active | Windows source builds preflight critical `.venv` imports and repair the locked environment once when required, including a forced PyMuPDF wheel reinstall. Windows defaults to software rendering, records GPU/renderer failures, performs one bounded renderer recovery, and offers retry/close instead of remaining white. Startup failures retain their cause and use a retry cooldown. The validated Desktop shortcut supports spaced paths; final-window close and terminal signals stop the backend process tree before Electron exits. |
| Customers | Full create/read/update/delete with linked job-order counts | Active | `services/api/app/routers/customers.py`, Customer Workspace. |
| Service Catalog | Full service create/read/update/delete with Printing, Scan or Photocopy, and Custom workflow categories | Active | Deleting a product hides it immediately and exposes Undo in that service for five days. Expired unused products are physically purged; historically referenced products retain only a hidden non-restorable audit identity. The combined service contains Photocopy products with paper pricing and Scan products with a standalone per-page rate. |
| Inventory | Material registration/editing/deletion, printing-focused units, unit- or ream-based purchase costs, stock monitoring, audited adjustments, product assignments, measured paper profiles, and job-linked automatic deductions | Active | Paper materials use the measured Canon G4070 document/photo/envelope/card catalogue or a validated 55 × 89 mm to 216 × 1200 mm custom profile. Multiple stock materials may share a size. Sheet-based paper accepts per-sheet or whole-ream purchase cost. Selling prices remain independent. Printing and Photocopy deduct physical material per completed production cycle. |
| Document Analyzer | In-memory analysis of PDF, image, DOCX, XLSX, and PPTX files with normalized print metadata, pixel-based coverage measurement, interactive source preview, and product-aware PHP pricing | Active | Printing analysis resolves the selected product override, then the Printing workflow's material-linked global rate. The engine auto-discovers pages, best-fit paper, orientation, color/B&W separation, coverage, and print time. Best-fit paper is advisory. B&W includes paper/ink; coverage-aware types add measured ink coverage. |
| Printer Integration | Vendor-neutral discovery, concurrent submission, supervised manual duplex, photo-media profiles, custom output geometry, and Windows spooler observation | Active | Print Center highlights the OS default printer and separates selectable alternatives under Others. Photo Print may send validated per-attempt custom dimensions with a live proof; this driver override does not rewrite approved material, pricing, or inventory. Multiple jobs may queue while earlier work prints, with spooler progress and supervised duplex checkpoints retained. |
| Overview | Top-of-page quick actions plus live counts for job status, payments, deadlines, and print queue depth | Active | New Job Order is the highlighted primary action and opens the analyzed transaction modal in one click; New Customer and New Service remain secondary shortcuts. Metrics read real data and honestly show zero until records exist. |
| Configuration | App-managed print-type catalog, global variants, workflow-scoped paper pricing, product-aware rate matrices, and a centralized read-only Pricing Center | Active | B&W, Semi-colored, Colored, and Photo Print are seeded types; owners may add more. Configuration provides separate Printing and Scan or Photocopy base matrices with one row per stocked paper material and one column per print type. A physical product may replace its matching material/output cell, allowing products that share the same stock and print type to charge differently. Scan remains a standalone product rate because it uses no paper or ink. Pricing Center mirrors both base scopes and every effective product price in a compact comparison view. |
| Settings | Business profile, live environment switching, verified backup/restore, stage-separated database paths, and backend diagnostics | Active | Each stage owns its SQLite database, managed files, backups, non-secret `config.json`, and rotating backend log. Startup phases, slow requests, shutdown, and complete crash tracebacks are timestamped. Switching restarts the backend with a 120-second readiness window. Backup uses a Windows-safe publication fallback; matching-stage restore creates a safety backup and reloads all renderer state. |
| Job Orders | Multi-service transaction intake with independent product operations, combined payment/completion, quality reprocessing, cancellation, deliverables, and audit history | Active | Printing lines retain a continuous PDF/image preview after analysis, and dynamically required inputs are visibly marked and highlighted while incomplete. Products may be appended from any active service while a transaction is unpaid, including after all existing lines are Ready; new lines return only the transaction to Production. Each production pane opens state-specific print, scan, photocopy, output-confirmation, quality, or file actions without mutating data on pane open. Windows scan acquisition uses the single physically validated Colored content mode. A failed Ready line can be reprocessed with its own cycle count and fresh inventory allowance. Unpaid active transactions may be cancelled with a required audit reason; consumed stock/history remain and all further production mutations are locked. |
| Reports | Read-only reporting view wired to real data | Scaffolded | Export and populated report calculations remain planned — see build-plan.md. |

## Planned Functionality

| Area | Functionality | Priority | Notes |
| --- | --- | --- | --- |
| Job Order Management | Automate additional material estimates | Initial | Planned paper and owner-entered supply quantities now deduct automatically after print submission. Analyzer-derived ink/toner/finishing quantity formulas remain undefined; those supplies still require an owner-entered planned quantity. |
| Real-time Tracking | Per-job status-event timeline and scheduling notifications | Initial | A separate Production page was removed; tracking should remain in Job Orders, the job workspace, and Overview. |
| Document Management | Add ready-to-print conversion/export and retention administration | Initial | Confirmed transaction files are stored with their job order, scanned output shares the same environment-managed file tree, and both are covered by verified backup/restore. Conversion/export and retention cleanup remain. |
| Printer Integration | Inspect capabilities and add queue cancellation/reconciliation | Initial | Standard quality and borderless requests are active. Windows passes borderless intent to the installed driver because public .NET margins cannot reliably reveal Canon-private support. Automatic per-printer capability discovery, physical profile validation, OS completion reconciliation, and cancellation/retry controls remain. |
| Reports and Analytics | Sales, performance, and customer reporting | Initial | Report pages exist with honest empty states; populate once job orders and payments exist. |

## Initial Page Coverage

The application structure consists of Overview, Printing Job Orders, Print Center, Inventory, Document Analyzer, Printing Services, Customers, Reports, Pricing, Configuration, and Settings. Job orders, services/products, and customers open focused nested workspaces instead of adding more top-level navigation. Detailed contents and module coverage are defined in [initial-pages.md](initial-pages.md).

## Business Workflow Context

The external business flow explains why Printing-MS exists; it is not itself the application boundary:

1. Gather customer requirements through Messenger, Gmail, or a form.
2. Choose the initial service, then add one or more products from any active service to the same transaction.
3. Complete each product's own requirements: analyze Printing documents, enter Photocopy quantities, or defer Scan acquisition to the saved job.
4. Review the per-product price breakdown and confirm one combined transaction, or cancel without saving it.
5. Work each product independently in the job workspace. When all lines are Ready, collect one payment and complete the transaction as a whole.

Printing-MS is the central application supporting this flow through the initial modules listed above. Whether Messenger and Gmail are directly integrated or handled through manual data entry is not yet decided.

## Template

### Feature Name

- Area:
- Status:
- User flow:
- Expected behavior:
- Related files:
- Notes:
