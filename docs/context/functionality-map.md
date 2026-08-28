# Functionality Map

Track app features and expected behavior.

## Current Functionality

| Area | Functionality | Status | Notes |
| --- | --- | --- | --- |
| Documentation | Context tracking docs | Active | Added under `docs/context`. |
| Application shell | Electron-managed FastAPI lifecycle, secure loopback IPC bridge, branded native/window icons, full primary navigation + nested workspace routing | Active | The Paper Club mark is used for the browser tab, development dock/window icon, and packaged Windows/macOS application icon. See `apps/desktop`, `apps/web/src/App.tsx`. |
| Customers | Full create/read/update/delete with linked job-order counts | Active | `services/api/app/routers/customers.py`, Customer Workspace. |
| Service Catalog | Full service create/read/update/delete with nested product CRUD, constrained print types, global reusable variants, a computed reference price, per-product document-pricing overrides, and required material assignments | Active | Every product is explicitly Colored or B&W and has no manually-entered base price. Paper availability and pricing are configured together because each pricing rule already references its Inventory material; non-priced supplies remain selectable separately. A read-only summary shows the resulting assigned materials. The displayed starting price is the lowest assigned paper rate (product override first, then global rate), plus any variant adjustment. |
| Inventory | Material registration/editing/deletion (with confirmation), current stock, reorder monitoring, audited stock adjustments, product material assignments, optional paper-size tagging, and job-linked automatic deductions | Active | Inventory is under Operations. New products require at least one active assigned material. The analyzer plans detected paper as pages × copies; owner-selected additional supplies retain their planned quantities. A successful printer-queue handoff deducts every remaining plan once and creates immutable `job_usage` ledger rows; insufficient stock blocks submission and failed attempts deduct nothing. Manual remaining-usage entry is retained only as a legacy/recovery fallback. |
| Document Analyzer | In-memory analysis of PDF, image, DOCX, XLSX, and PPTX files with normalized print metadata, pixel-based coverage measurement, interactive source preview, and product-aware PHP pricing | Active | A product is required in the UI and an assigned variant is optional. The engine auto-discovers page count, paper size, orientation, color/B&W separation, ink/color coverage, and estimated print time. Confirmed transactions persist this file-level print profile so Print Center can reuse it without manual re-entry. Suggested price is the exact detected-size product base subtotal plus measured ink load, proportional color premium, and selected variant adjustment per page. |
| Printer Integration | Vendor-neutral discovery and confirmed file submission through Windows and macOS/Linux queues | Active | Print Center selects an available queue while pages, copies, paper, output mode, orientation, and source separation are filled from the confirmed analyzer/product profile and shown read-only. The server derives the same authoritative settings instead of trusting client hints. Windows renders PDF/image pages locally through `PrintDocument`; CUPS uses `lp`. Queue acceptance advances the job and atomically records planned inventory usage. |
| Overview | Top-of-page quick actions plus live counts for job status, payments, deadlines, and print queue depth | Active | New Job Order is the highlighted primary action and opens the analyzed transaction modal in one click; New Customer and New Service remain secondary shortcuts. Metrics read real data and honestly show zero until records exist. |
| Configuration | Global variants library and global document-analyzer per-page pricing, plus per-product rate overrides | Active | `/configuration` hosts Global variants (`/configuration/variants`, moved from Services) and the document analyzer's paper-size/print-type rate matrix (moved from Settings), keyed to real inventory items. Empty until the owner tags at least one paper item in Inventory. Product forms assign a per-product override, limited to the product's own print type. |
| Settings | Business profile read/update, stage-separated database paths, and backend diagnostics | Active | Owner name and the job-order numbering prefix are editable. Runtime Environments shows independent development, test, and production SQLite paths, their configuration sources, and the active stage. `PRINT_MS_STAGE` selects the database on restart; live database switching is intentionally disabled. Document templates and backup/restore are planned. |
| Job Orders | Confirmed analyzed transactions with payment verification, guarded production states, durable analyzed files, print attempts, status history, and automatic audited material usage | Active | Full payment unlocks Paid → Queued. A successful OS submission sets Printing and deducts every remaining planned material; then explicit controls advance Quality Check → Ready → Completed. File-level analysis, every transition, print attempt, and resulting inventory movement remain visible on the job. |
| Reports | Read-only reporting view wired to real data | Scaffolded | Export and populated report calculations remain planned — see build-plan.md. |

## Planned Functionality

| Area | Functionality | Priority | Notes |
| --- | --- | --- | --- |
| Job Order Management | Automate additional material estimates | Initial | Planned paper and owner-entered supply quantities now deduct automatically after print submission. Analyzer-derived ink/toner/finishing quantity formulas remain undefined; those supplies still require an owner-entered planned quantity. |
| Real-time Tracking | Per-job status-event timeline and scheduling notifications | Initial | A separate Production page was removed; tracking should remain in Job Orders, the job workspace, and Overview. |
| Document Management | Add ready-to-print conversion/export and retention administration | Initial | Confirmed transaction files are now stored under the configured managed data directory and attached to their job order; cancelling after analysis persists nothing. Conversion/export, retention cleanup, and backup/restore coverage remain. |
| Printer Integration | Inspect capabilities and add queue cancellation/reconciliation | Initial | Confirmed submission and attempt history are active. Capability-driven quality/borderless options, OS completion reconciliation, and cancellation/retry controls remain. |
| Reports and Analytics | Sales, performance, and customer reporting | Initial | Report pages exist with honest empty states; populate once job orders and payments exist. |

## Initial Page Coverage

The application structure consists of Overview, Job Orders, Print Center, Inventory, Document Analyzer, Services, Customers, Reports, Configuration, and Settings. Job orders, services/products, and customers open focused nested workspaces instead of adding more top-level navigation. Detailed contents and module coverage are defined in [initial-pages.md](initial-pages.md).

## Business Workflow Context

The external business flow explains why Printing-MS exists; it is not itself the application boundary:

1. Gather customer requirements through Messenger, Gmail, or a form.
2. Start a transaction by uploading the customer document and selecting its configured product and optional variant.
3. Analyze without saving, then accept the suggested price or enter an owner override.
4. Confirm to create the job and stage its file in Print Center, or discard it without creating a record.
5. Record payment, print, and track production and delivery.

Printing-MS is the central application supporting this flow through the initial modules listed above. Whether Messenger and Gmail are directly integrated or handled through manual data entry is not yet decided.

## Template

### Feature Name

- Area:
- Status:
- User flow:
- Expected behavior:
- Related files:
- Notes:
