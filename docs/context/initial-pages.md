# Initial Application Pages

## Purpose

Define the first visible application structure for Printing-MS. The initial creation should establish these pages, navigation, and core content areas even when deeper actions are delivered incrementally.

## Primary Navigation

| Page | Purpose | Initial content |
| --- | --- | --- |
| Overview | Give the owner an operational snapshot and direct attention to pending work. | Jobs by status, payments awaiting verification, upcoming deadlines, current print queue, recent activity, and quick actions. |
| Job Orders | Manage jobs from confirmed pricing through completion. | Searchable order list, status and deadline filters, customer, payment state, production state, assigned printer, and create-order action. |
| Print Center | Connect, prepare files, and operate installed printers. | Canon-first/vendor-neutral connection guidance, native Windows/macOS printer-settings access, installed queue status, ready-to-print files, preview, print settings, active queue, retry/cancel controls, and print history. |
| Inventory | Register and monitor materials consumed during production. | Material register, current stock, reorder levels, audited adjustments, product links, and job-order usage traceability. |
| Services | Organize sellable products by the service the business provides. | Service list and settings; each service opens its product inventory, with in-context product creation and dedicated product editing. |
| Customers | Maintain the customer information required by orders. | Contact details, source channel, order history, notes, and customer editor. |
| Reports | Review business and production performance. | Date filters, sales summary, payment summary, product performance, job throughput, customer activity, and CSV/PDF export points. |
| Settings | Configure the business, desktop application, and printers. | Business profile, order numbering, document templates, default printer, printer discovery, backup/restore, diagnostics, and application preferences. |

## Nested Workspaces

These are opened from the primary pages and should not become additional top-level navigation items:

### Job Order Workspace

- Order summary, customer, payment, deadline, notes, and current status
- Source files and approved print-ready files
- Production timeline and status updates
- Planned and actual material usage with stock-movement history
- Selected printer, print settings, print attempts, and completion record
- Primary action changes with lifecycle stage, ending in owner-confirmed printing and completion

### Service and Product Workspaces

- Product inventory as the primary service view; focused product creation opens in a modal and returns to the updated inventory
- Service identity, description, and active state managed from service settings
- Product identity, parent service, description, and active state
- Pricing basis and configurable specifications, variants, or finishing options
- Allowed inventory material assignments used to constrain job-order material choices
- Validation showing whether enough information exists to use the product in analysis and a job order

### Customer Workspace

- Contact and source-channel information
- Linked job orders
- Notes and activity history

## Functionality Coverage

| Initial functionality | Covered by |
| --- | --- |
| Product-based suggested pricing | Document Analyzer and Product Workspace |
| Import/export of ready-to-print documents | Job Order Workspace and Print Center |
| Real-time tracking and production scheduling | Overview, Job Orders, and Job Order Workspace |
| Job order management | Job Orders and Job Order Workspace |
| Reports and analytics | Overview and Reports |
| Service catalog and product pricing | Services, Service Workspace, and Product Workspace |
| Inventory and material consumption audit | Inventory, Product Workspace, and Job Order Workspace |
| Vendor-neutral printer operation | Print Center, Job Order Workspace, and Settings |

## Initial Creation Scope

The first application scaffold should include:

- Persistent application shell and primary navigation
- Every primary page and nested-workspace route
- Consistent page titles, core actions, empty states, loading states, and error states
- Representative local data or honest placeholders; do not invent business metrics
- Shared status, customer, product, order, printer, and print-job types
- Clear markers for planned controls that are not functional yet

The first scaffold does not need complete AI, reporting, external messaging, payment integration, or advanced printer controls. It must make the intended workflow and module boundaries visible and leave each page ready for incremental implementation.
