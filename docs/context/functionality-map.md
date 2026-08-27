# Functionality Map

Track app features and expected behavior.

## Current Functionality

| Area | Functionality | Status | Notes |
| --- | --- | --- | --- |
| Documentation | Context tracking docs | Active | Added under `docs/context`. |
| Application shell | Electron-managed FastAPI lifecycle, secure loopback IPC bridge, full primary navigation + nested workspace routing | Active | See `apps/desktop`, `apps/web/src/App.tsx`. |
| Customers | Full create/read/update/delete, linked quotation/job-order counts | Active | `services/api/app/routers/customers.py`, Customer Workspace. |
| Service Catalog | Full service create/read/update/delete with nested product CRUD, constrained print types, global reusable variants, a computed reference price, per-product document-pricing overrides, and required material assignments | Active | Every product is explicitly Colored or B&W and has no manually-entered base price. Paper availability and pricing are configured together because each pricing rule already references its Inventory material; non-priced supplies remain selectable separately. A read-only summary shows the resulting assigned materials. The displayed starting price is the lowest assigned paper rate (product override first, then global rate), plus any variant adjustment. |
| Inventory | Material registration/editing/deletion (with confirmation), current stock, reorder monitoring, audited stock adjustments, product material assignments, and optional paper-size tagging (A4/Letter/Legal) | Active | Inventory is under Operations. New products require at least one active assigned material. At most one active item may hold a given paper size at a time; tagging an item drives the document-pricing rate matrix (see Document Analyzer, Configuration). Deleting a material is blocked (409) while it's assigned to a product, used in a job order, or used in document-analyzer pricing — a modal confirms the action, and the guarded cases are pointed at deactivating instead. The item's own stock-movement history is not a blocker; it's deleted along with the item. |
| Document Analyzer | In-memory analysis of PDF, image, DOCX, XLSX, and PPTX files with normalized print metadata, interactive source preview, and product-aware PHP page pricing | Active | After analysis, the normal page header steps out and a full-width, full-height two-pane workspace fills the app content area. PDFs render locally through a lazy-loaded PDF.js canvas engine as one continuous scroll of all pages, with nearby pages pre-rendered for smoothness plus zoom, fit-to-width, rotation, download, and keyboard controls. Browser-supported images render from a temporary object URL; unsupported Office/TIFF formats show an honest fallback. Files are limited to 25 MB and are not retained. |
| Printer Integration | Real installed-printer detection via CUPS (`lpstat`) on macOS/Linux | Active (macOS/Linux) | Windows (`win32print`) adapter is stubbed, not implemented — see issues-log.md. |
| Overview | Live counts (job orders by status, quotations awaiting approval, payments awaiting verification, upcoming deadlines, print queue depth) | Active | Reads real data; honestly shows zero until records exist — no invented metrics. |
| Configuration | Global variants library and global document-analyzer per-page pricing, plus per-product rate overrides | Active | `/configuration` hosts Global variants (`/configuration/variants`, moved from Services) and the document analyzer's paper-size/print-type rate matrix (moved from Settings), keyed to real inventory items. Empty until the owner tags at least one paper item in Inventory. Product forms assign a per-product override, limited to the product's own print type. |
| Settings | Business profile read/update and backend diagnostics | Active | Numbering prefixes are editable; document-analysis pricing rules moved to Configuration. Document templates and backup/restore are planned. |
| Job Orders | Owner-created orders with optional customers, calculated pricing, multiple product lines, page/copy details, constrained material plans, and audited material usage | Active | After selecting a product, the owner chooses one of its configured paper sizes; this switches the live rate (product override first, then global rate) and automatically adds the linked Inventory paper plan at pages × copies. Print sides is not requested; options such as Back-to-back belong to the product's pricing variants. The server enforces the same size/rate relationship and snapshots unit/line prices in PHP. Non-paper supplies remain optional. Stock changes only through explicit Record usage confirmation. |
| Quotations, Production, Reports | Read-only list/detail views wired to real data | Scaffolded | Creation/approval/print-submission actions remain planned — see build-plan.md. |

## Planned Functionality

| Area | Functionality | Priority | Notes |
| --- | --- | --- | --- |
| Quotation Management | AI-assisted quotation generation with owner approval | Initial | Data model and read views exist; creation is blocked on pricing rules (issues-log.md). |
| Job Order Management | Convert accepted quotations, record payments, and automate page-based material estimates | Initial | Manual owner creation and explicit material-usage recording are active. Quotation conversion, payment recording, and finalized automatic quantity rules remain. |
| Real-time Tracking | Per-job status-event timeline, scheduling notifications | Initial | Production board groups real job orders by status today; the event-level timeline view is not built yet. |
| Document Management | Retain analyzed customer files, attach analysis to job orders, and export ready-to-print documents | Initial | Standalone in-memory analysis supports PDF, PNG/JPEG/TIFF/BMP/WebP, DOCX, XLSX, and PPTX up to 25 MB. Durable storage, job-order attachment, and print preparation/export remain to be defined. |
| Printer Integration | Submit print jobs (not just detect printers), record attempts/results | Initial | Detection is real (see Current Functionality); submission is Phase 5. |
| Reports and Analytics | Sales, performance, and customer reporting | Initial | Report pages exist with honest empty states; populate once job orders and payments exist. |

## Initial Page Coverage

The application structure consists of Overview, Job Orders, Quotations, Production, Print Center, Inventory, Document Analyzer, Services, Customers, Reports, Configuration, and Settings. Job orders, quotations, services/products, and customers open focused nested workspaces instead of adding more top-level navigation. Detailed contents and module coverage are defined in [initial-pages.md](initial-pages.md).

## Business Workflow Context

The external business flow explains why Printing-MS exists; it is not itself the application boundary:

1. Gather customer requirements through Messenger, Gmail, or a form.
2. Generate a quotation and obtain owner approval.
3. Return the quotation to the customer and record acceptance.
4. Record and verify online or cash payment.
5. Create and fulfill the job order while tracking production and delivery.

Printing-MS is the central application supporting this flow through the initial modules listed above. Whether Messenger and Gmail are directly integrated or handled through manual data entry is not yet decided.

## Template

### Feature Name

- Area:
- Status:
- User flow:
- Expected behavior:
- Related files:
- Notes:
