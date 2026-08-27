# Initial Application Build Plan

## Goal

Deliver Printing-MS as an installable Windows and macOS desktop application. It should manage the printing workflow and submit jobs directly through printers installed in the operating system. Canon PIXMA G4770 is the first validation target, without model-specific coupling.

## Initial Release Assumptions

- Owner/admin is the first supported user role.
- The application is local-first and runs on one printing workstation.
- Messenger, Gmail, order forms, payments, and customer notifications are recorded manually.
- Docker is not required on the customer's machine.
- Shared multi-device access, cloud synchronization, and direct external integrations are deferred.
- PDF and common image formats are the initial print-ready inputs; final supported formats still require confirmation.

## Proposed Architecture

- Desktop shell: Electron for Windows and macOS packaging and printing support.
- User interface: React with TypeScript.
- Backend: Python and FastAPI for business rules, persistence, AI-assisted quotation work, documents, and reports.
- Development environment: `uv` manages the backend dependencies and project `.venv`.
- Desktop integration: Electron starts and monitors the local FastAPI process and owns native printer access.
- Local communication: FastAPI binds only to the loopback interface and uses a per-launch token; Electron exposes only the required operations to the renderer.
- Local persistence: FastAPI manages SQLite behind a repository layer so remote synchronization can be introduced later.
- File storage: Managed application-data directory with database metadata and integrity checks.
- Printing: Vendor-neutral adapter over operating-system printer queues and capabilities.
- Distribution: The Python backend is bundled as a platform-specific executable and included in the signed Windows installer and signed/notarized macOS package. Customers do not install Python or activate a virtual environment.

## Core Data Model

- User and application settings
- Customer
- Product and product variant
- Quotation and quotation item
- Job order
- Payment record
- Customer/print-ready file
- Printer and reported capabilities
- Print job and print settings
- Status event and audit entry

## Draft Lifecycle

Quotation:

`Draft -> Pending Approval -> Approved -> Sent -> Accepted / Rejected / Expired`

Job order:

`Pending Payment -> Paid -> Queued -> Printing -> Quality Check -> Ready -> Released/Delivered -> Completed`

`On Hold` and `Cancelled` are controlled exception states. Final statuses and transition permissions must be confirmed before implementation.

## Delivery Phases

### Phase 0: Product Baseline

- Confirm owner workflow, pricing rules, statuses, print settings, and supported file types.
- Validate the initial page map in [initial-pages.md](initial-pages.md), then produce low-fidelity screens and acceptance criteria.
- Exit: Core workflows and unresolved MVP decisions are approved.

### Phase 1: Printing Feasibility Spike

- Detect installed printers on Windows and macOS/Linux (implemented through Windows CIM and CUPS); read available capabilities next.
- Preview and print a sample PDF/image through the OS queue.
- Validate Canon G4770 on Windows and macOS where hardware is available.
- Test copies, colour mode, media size, orientation, cancellation, and error handling.
- Exit: A repeatable test print succeeds without Canon-specific application logic.

### Phase 2: Application Foundation

- Scaffold Electron, React, TypeScript, FastAPI, testing, and packaging.
- Configure `uv`, the backend `.venv`, dependency locking, and independent API tests.
- Add Electron-managed FastAPI startup, health checks, authentication, shutdown, and recovery.
- Add navigation, settings, logging, SQLite migrations, backup, and restore.
- Create the complete primary navigation and page/workspace route shells defined in [initial-pages.md](initial-pages.md), including honest empty, loading, and error states.
- Add secure renderer-to-main communication.
- Produce bundled backend executables on Windows and macOS.
- Exit: Installable development builds start the backend automatically and preserve and restore local data.

### Phase 3: Commercial Workflow

- Build customers, product catalog, and deterministic product/document pricing.
- Analyze customer documents for page geometry, color coverage, ink load, and configured product variants.
- Exit: An owner can produce a transparent suggested price before creating a job order.

### Phase 4: Job Order and Files

- Create confirmed jobs from an uploaded file, selected product/variant/copies, detected configured paper size, and an approved suggested or owner-overridden price. **Active.**
- Record owner-verified partial/full cash, online, bank-transfer, or other payments. **Active.**
- Attach the confirmed customer file as a staged print-ready job file. **Active.**
- Add deadlines, notes, and status history. **Active except general audit entries.**
- Exit: A complete job can be prepared for production without printing.

### Phase 5: Production Printing

- Extend the active native printer-setup/discovery flow with preview, capability-driven settings, retry, cancel, and OS completion reconciliation. Queue submission and history are active.
- Require explicit owner confirmation before submission. **Active.**
- Record the chosen printer, file, settings, operator, timestamps, and result. **Active.**
- Exit: An approved job can be printed and traced from job order to OS queue result.

### Phase 6: Tracking and Reports

- Add dashboard, production queue, status filters, due dates, and job timeline.
- Add initial sales, payment, product, and production reports with CSV/PDF export.
- Exit: The owner can monitor active work and review basic business performance.

### Phase 7: Release Hardening

- Test backend startup recovery, upgrades, migration rollback, backup/restore, offline use, large files, and printer failures.
- Add code signing, macOS notarization, installer verification, and release documentation.
- Build and verify the bundled Python backend independently on Windows and macOS.
- Exit: Reproducible Windows and macOS release candidates pass acceptance testing.

## MVP Acceptance Criteria

- Runs without Docker on supported Windows and macOS versions.
- Requires no customer-managed Python installation or virtual environment.
- Starts and stops the bundled FastAPI backend with the desktop application.
- Preserves local data across restarts and upgrades.
- Supports the full quotation-to-completed-job workflow.
- Prints through an OS-installed Canon G4770 and at least one non-Canon test queue.
- Prevents unapproved quotations and unconfirmed jobs from being printed.
- Records payment, files, status changes, print attempts, and operator actions.
- Can back up and restore business data and managed files.

## Deferred Scope

- Direct Messenger, Gmail, payment-gateway, and customer-portal integrations
- Multi-workstation synchronization and cloud hosting
- Automatic printer-driver installation
- Advanced inventory, accounting, and consumables telemetry
- Fully automated AI pricing or print submission
