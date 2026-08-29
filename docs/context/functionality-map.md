# Functionality Map

Track app features and expected behavior.

## Current Functionality

| Area | Functionality | Status | Notes |
| --- | --- | --- | --- |
| Documentation | Context tracking docs | Active | Added under `docs/context`. |
| Application shell | Electron-managed FastAPI lifecycle, secure loopback IPC bridge, branded native/window icons, full primary navigation + nested workspace routing, and global print activity | Active | The Paper Club mark is used for the browser tab, development dock/window icon, and packaged Windows/macOS application icon. A floating, keyboard-accessible tracker follows every queued/printing job across routes and opens a job-linked activity modal. |
| Customers | Full create/read/update/delete with linked job-order counts | Active | `services/api/app/routers/customers.py`, Customer Workspace. |
| Service Catalog | Full service create/read/update/delete with Printing, Scan or Photocopy, and Custom workflow categories plus operation-specific product pricing | Active | The combined service contains Photocopy products with paper pricing and Scan products with a standalone per-page rate. Scan products cannot use paper, ink, print variants, or document-pricing rules. |
| Inventory | Material registration/editing/deletion, stock monitoring, audited adjustments, product assignments, paper-size tagging, and job-linked automatic deductions | Active | Printing deducts planned materials after successful queue submission. Photocopy deducts physical sheets immediately when device-side work is recorded, using `ceil(pages ÷ 2) × copies` for back-to-back work. |
| Document Analyzer | In-memory analysis of PDF, image, DOCX, XLSX, and PPTX files with normalized print metadata, pixel-based coverage measurement, interactive source preview, and product-aware PHP pricing | Active | A product and one of its configured paper materials are required in transaction creation; a variant is optional. The engine auto-discovers pages, best-fit paper, orientation, color/B&W separation, coverage, and print time. Best-fit paper is advisory and never blocks a different owner selection. B&W is `selected-paper rate × pages` with paper/ink included; coverage-aware types use their own selected-paper rates plus measured ink coverage. |
| Printer Integration | Vendor-neutral discovery, concurrent submission, supervised manual duplex, and Windows spooler observation | Active | Print Center highlights the OS default printer and separates selectable alternatives under Others. Multiple job orders may be submitted while the OS printer queue processes earlier work. Internal Windows attempts retain queued/spooling/printing/released state and page progress. Release requests owner review rather than claiming physical completion. Supervised duplex retains its front/reinsert/back checkpoint and deducts inventory only after both submissions. |
| Overview | Top-of-page quick actions plus live counts for job status, payments, deadlines, and print queue depth | Active | New Job Order is the highlighted primary action and opens the analyzed transaction modal in one click; New Customer and New Service remain secondary shortcuts. Metrics read real data and honestly show zero until records exist. |
| Configuration | App-managed print-type catalog, global variants, global document-analyzer per-page pricing, and per-product rate overrides | Active | The pricing matrix gets one column per active print type and one row per stocked paper size. “Add print type” defines its label and whether measured ink coverage affects pricing; its paper rates and product option then appear automatically. Product types are commercial/workflow categories and do not force physical color output. |
| Settings | Business profile read/update, stage-separated database paths, and backend diagnostics | Active | Owner name and the job-order numbering prefix are editable. Runtime Environments shows independent development, test, and production SQLite paths, their configuration sources, and the active stage. `PRINT_MS_STAGE` selects the database on restart; live database switching is intentionally disabled. Document templates and backup/restore are planned. |
| Job Orders | Service-first modal intake with Printing, Photocopy, and Scan requirements, human-readable names, payment, completion, deliverables, and audit history | Active | On Windows, Scan jobs configure source, content mode, 150/300/600 DPI, and Automatic/A4/Letter/Legal/photo capture sizes in-app, then acquire through WIA without opening its redundant settings dialog. Automatic source selects the WIA 2.0 feeder item first when loaded or sensing is unavailable; owners can explicitly select Feeder or Flatbed. B&W text falls back visibly to grayscale when unsupported. Every check/acquisition reports progress, success, cancellation, or recovery guidance. |
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

The application structure consists of Overview, Printing Job Orders, Print Center, Inventory, Document Analyzer, Printing Services, Customers, Reports, Configuration, and Settings. Job orders, services/products, and customers open focused nested workspaces instead of adding more top-level navigation. Detailed contents and module coverage are defined in [initial-pages.md](initial-pages.md).

## Business Workflow Context

The external business flow explains why Printing-MS exists; it is not itself the application boundary:

1. Gather customer requirements through Messenger, Gmail, or a form.
2. Start a transaction by uploading the customer document and selecting its configured product, print paper, and optional variant.
3. Analyze without saving, review the advisory best-fit paper, then accept the selected-paper price or enter an owner override.
4. Confirm to create the job and open its single workflow page, or discard it without creating a record.
5. Use in-page modals to record payment, queue, configure printing, inspect quality, and complete the job.

Printing-MS is the central application supporting this flow through the initial modules listed above. Whether Messenger and Gmail are directly integrated or handled through manual data entry is not yet decided.

## Template

### Feature Name

- Area:
- Status:
- User flow:
- Expected behavior:
- Related files:
- Notes:
