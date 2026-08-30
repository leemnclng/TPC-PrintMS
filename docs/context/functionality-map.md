# Functionality Map

Track app features and expected behavior.

## Current Functionality

| Area | Functionality | Status | Notes |
| --- | --- | --- | --- |
| Documentation | Context tracking docs | Active | Added under `docs/context`. |
| Application shell | Electron-managed FastAPI lifecycle, secure loopback IPC bridge, branded native/window icons, full primary navigation + nested workspace routing, and global print activity | Active | The Paper Club mark is used for the browser tab, development dock/window icon, and packaged Windows/macOS application icon. A floating, keyboard-accessible tracker follows every queued/printing job across routes and opens a job-linked activity modal. |
| Customers | Full create/read/update/delete with linked job-order counts | Active | `services/api/app/routers/customers.py`, Customer Workspace. |
| Service Catalog | Full service create/read/update/delete with Printing, Scan or Photocopy, and Custom workflow categories | Active | Printing Services remains the focused service directory. Its service and product records feed the separate Pricing page. The combined service contains Photocopy products with paper pricing and Scan products with a standalone per-page rate. |
| Inventory | Material registration/editing/deletion, stock monitoring, audited adjustments, product assignments, paper-size tagging, and job-linked automatic deductions | Active | Printing deducts planned materials after successful queue submission. Photocopy deducts physical sheets when device-side work is recorded. Failed-quality reprocessing adds and deducts a fresh cycle without reversing the consumed original output. |
| Document Analyzer | In-memory analysis of PDF, image, DOCX, XLSX, and PPTX files with normalized print metadata, pixel-based coverage measurement, interactive source preview, and product-aware PHP pricing | Active | Printing analysis resolves the selected product override, then the Printing workflow's material-linked global rate. The engine auto-discovers pages, best-fit paper, orientation, color/B&W separation, coverage, and print time. Best-fit paper is advisory. B&W includes paper/ink; coverage-aware types add measured ink coverage. |
| Printer Integration | Vendor-neutral discovery, concurrent submission, supervised manual duplex, and Windows spooler observation | Active | Print Center highlights the OS default printer and separates selectable alternatives under Others. Multiple job orders may be submitted while the OS printer queue processes earlier work. Internal Windows attempts retain queued/spooling/printing/released state and page progress. Release requests owner review rather than claiming physical completion. Supervised duplex retains its front/reinsert/back checkpoint and deducts inventory only after both submissions. |
| Overview | Top-of-page quick actions plus live counts for job status, payments, deadlines, and print queue depth | Active | New Job Order is the highlighted primary action and opens the analyzed transaction modal in one click; New Customer and New Service remain secondary shortcuts. Metrics read real data and honestly show zero until records exist. |
| Configuration | App-managed print-type catalog, global variants, workflow-scoped paper pricing, per-product rate overrides, and a centralized read-only Pricing Center | Active | Configuration provides separate Printing and Scan or Photocopy global matrices. Each matrix retains one column per active print type and one row per real stocked paper material. Photocopy products inherit the Scan or Photocopy table; Printing products inherit Printing; Scan remains per-product because it uses no paper or ink. Pricing Center mirrors both scopes and every product override. |
| Settings | Business profile read/update, stage-separated database paths, and backend diagnostics | Active | Owner name and the job-order numbering prefix are editable. Runtime Environments shows independent development, test, and production SQLite paths, their configuration sources, and the active stage. `PRINT_MS_STAGE` selects the database on restart; live database switching is intentionally disabled. Document templates and backup/restore are planned. |
| Job Orders | Multi-service transaction intake with independent product operations, combined payment/completion, quality reprocessing, cancellation, deliverables, and audit history | Active | Products may be appended from any active service while a transaction is unpaid, including after all existing lines are Ready; new lines return only the transaction to Production. Each production pane opens state-specific print, scan, photocopy, output-confirmation, quality, or file actions without mutating data on pane open. A failed Ready line can be reprocessed with its own cycle count and fresh inventory allowance. Unpaid active transactions may be cancelled with a required audit reason; consumed stock/history remain and all further production mutations are locked. |
| Reports | Read-only reporting view wired to real data | Scaffolded | Export and populated report calculations remain planned — see build-plan.md. |

## Planned Functionality

| Area | Functionality | Priority | Notes |
| --- | --- | --- | --- |
| Job Order Management | Automate additional material estimates | Initial | Planned paper and owner-entered supply quantities now deduct automatically after print submission. Analyzer-derived ink/toner/finishing quantity formulas remain undefined; those supplies still require an owner-entered planned quantity. |
| Real-time Tracking | Per-job status-event timeline and scheduling notifications | Initial | A separate Production page was removed; tracking should remain in Job Orders, the job workspace, and Overview. |
| Document Management | Add ready-to-print conversion/export and retention administration | Initial | Confirmed transaction files are now stored under the configured managed data directory and attached to their job order; cancelling after analysis persists nothing. Conversion/export, retention cleanup, and backup/restore coverage remain. |
| Printer Integration | Inspect capabilities and add queue cancellation/reconciliation | Initial | Standard quality and borderless requests are active and reject unsupported Windows driver behavior clearly. Automatic per-printer capability discovery, OS completion reconciliation, and cancellation/retry controls remain. |
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
