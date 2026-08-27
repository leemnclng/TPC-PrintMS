# Functionality Map

Track app features and expected behavior.

## Current Functionality

| Area | Functionality | Status | Notes |
| --- | --- | --- | --- |
| Documentation | Context tracking docs | Active | Added under `docs/context`. |
| Application shell | Electron-managed FastAPI lifecycle, secure loopback IPC bridge, branded native/window icons, full primary navigation + nested workspace routing | Active | The Paper Club mark is used for the browser tab, development dock/window icon, and packaged Windows/macOS application icon. See `apps/desktop`, `apps/web/src/App.tsx`. |
| Customers | Full create/read/update/delete with linked job-order counts | Active | `services/api/app/routers/customers.py`, Customer Workspace. |
| Service Catalog | Full service create/read/update/delete with nested product CRUD, constrained print types, global reusable variants, a computed reference price, per-product document-pricing overrides, and required material assignments | Active | Every product is explicitly Colored or B&W and has no manually-entered base price. Paper availability and pricing are configured together because each pricing rule already references its Inventory material; non-priced supplies remain selectable separately. A read-only summary shows the resulting assigned materials. The displayed starting price is the lowest assigned paper rate (product override first, then global rate), plus any variant adjustment. |
| Inventory | Material registration/editing/deletion (with confirmation), current stock, reorder monitoring, audited stock adjustments, product material assignments, and optional paper-size tagging (A4/Letter/Legal) | Active | Inventory is under Operations. New products require at least one active assigned material. At most one active item may hold a given paper size at a time; tagging an item drives the document-pricing rate matrix (see Document Analyzer, Configuration). Deleting a material is blocked (409) while it's assigned to a product, used in a job order, or used in document-analyzer pricing — a modal confirms the action, and the guarded cases are pointed at deactivating instead. The item's own stock-movement history is not a blocker; it's deleted along with the item. |
| Document Analyzer | In-memory analysis of PDF, image, DOCX, XLSX, and PPTX files with normalized print metadata, pixel-based coverage measurement, interactive source preview, and product-aware PHP pricing | Active | A product is required in the UI and an assigned variant is optional. Suggested price is the exact detected-size product base subtotal plus measured ink load, a proportional color premium derived from the configured colored-vs-base rate, and the selected variant adjustment per page. PDF pages are rasterized locally with PyMuPDF so text, vectors, and images contribute to ink/color coverage; Office coverage uses explicit density/image estimates. Standalone analysis remains temporary; the transaction wizard reuses the same engine and retains the file only after owner confirmation. |
| Printer Integration | Vendor-neutral discovery and confirmed file submission through Windows and macOS/Linux queues | Active | Print Center detects the host OS, selects an available queue, file, copies, color mode, and paper size, and submits only a paid/queued job after explicit owner confirmation. Windows invokes the selected queue through the registered document application's PrintTo handler; CUPS uses `lp`. Successful and failed attempts retain printer, file, settings, operator, result, OS job ID when available, and error detail. Physical Canon validation remains open. |
| Overview | Top-of-page quick actions plus live counts for job status, payments, deadlines, and print queue depth | Active | New Job Order is the highlighted primary action and opens the analyzed transaction modal in one click; New Customer and New Service remain secondary shortcuts. Metrics read real data and honestly show zero until records exist. |
| Configuration | Global variants library and global document-analyzer per-page pricing, plus per-product rate overrides | Active | `/configuration` hosts Global variants (`/configuration/variants`, moved from Services) and the document analyzer's paper-size/print-type rate matrix (moved from Settings), keyed to real inventory items. Empty until the owner tags at least one paper item in Inventory. Product forms assign a per-product override, limited to the product's own print type. |
| Settings | Business profile read/update, stage-separated database paths, and backend diagnostics | Active | Owner name and the job-order numbering prefix are editable. Runtime Environments shows independent development, test, and production SQLite paths, their configuration sources, and the active stage. `PRINT_MS_STAGE` selects the database on restart; live database switching is intentionally disabled. Document templates and backup/restore are planned. |
| Job Orders | Confirmed analyzed transactions with payment verification, guarded production states, durable files, print attempts, status history, and audited material usage | Active | The owner records full or partial payments; full payment unlocks Paid → Queued. A successful OS submission sets Printing, then explicit controls advance Quality Check → Ready → Completed. Every transition and print attempt is retained. New transaction analysis/pricing and automatic detected-paper planning remain the entry flow. |
| Reports | Read-only reporting view wired to real data | Scaffolded | Export and populated report calculations remain planned — see build-plan.md. |

## Planned Functionality

| Area | Functionality | Priority | Notes |
| --- | --- | --- | --- |
| Job Order Management | Automate additional material estimates | Initial | Owner-verified payment recording and explicit material-usage recording are active. Finalized ink/finishing quantity rules remain. |
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
