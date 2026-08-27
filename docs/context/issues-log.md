# Issues Log

Track known issues, blockers, risks, and follow-up work.

## Open Issues

| Date | Area | Issue | Status | Owner/Notes |
| --- | --- | --- | --- | --- |
| 2026-08-15 | Product | User roles and permissions are not yet defined. | Open | Clarify owner/admin, sales, cashier, production staff, and customer access. |
| 2026-08-15 | Workflow | Canonical quotation and job-order statuses and transition rules are not yet defined. | Open | Required before implementing tracking and notifications. |
| 2026-08-15 | Integrations | Messenger, Gmail, form intake, and online-payment integration levels are undecided. | Open | Initial implementation can support manual entry and payment verification. |
| 2026-08-15 | Quotation | Pricing rules and the role of AI in quotation generation are not yet specified. | Open | AI output must remain subject to owner approval. |
| 2026-08-15 | Documents | Durable file storage, job-order attachment, and ready-to-print export behavior remain undefined. | Open | Standalone analysis now supports PDF, PNG/JPEG/TIFF/BMP/WebP, DOCX, XLSX, and PPTX up to 25 MB without retention. Define persistence and export before completing document management. |
| 2026-08-15 | Printing | Required printer controls and cross-platform capability differences are not yet defined. | Open | Confirm media, quality, borderless mode, colour, copies, and expected queue status detail. |
| 2026-08-15 | Deployment | Supported Windows and macOS versions are not yet defined. | Open | Required for packaging, hardware validation, and release support. |
| 2026-08-15 | Backend | Bundled FastAPI lifecycle and local communication need validation. | Open | Test loopback authentication, port allocation, startup recovery, shutdown, logging, and platform-specific executable packaging. |
| 2026-08-15 | UX | Exact dashboard metrics, report definitions, and page-level permissions are deferred. | Open | Initial pages will expose honest placeholders and shared workflow states until business rules and roles are confirmed. |
| 2026-08-15 | Printing | Windows printer detection (`win32print`) is not implemented. | Open | `services/api/app/services/printing/adapter.py` has an explicit `WindowsPrinterAdapter` stub that raises rather than silently degrading; macOS/Linux detection via CUPS `lpstat` is implemented and verified. |
| 2026-08-15 | Deployment | Packaged (non-dev) builds cannot start the backend yet. | Open | `apps/desktop/src/backendManager.ts` only knows how to run the backend from source via `uv run`; bundling it into a signed platform executable is Phase 7 scope and currently throws a clear error in a packaged build rather than failing silently. |
| 2026-08-21 | Inventory | Automatic page-to-material quantity rules are not finalized. | Open | Job orders automatically plan the selected paper as `pages × copies`. Rules for ink, finishing, and other supplies still need definition; stock changes only through explicit Record usage confirmation. |
| 2026-08-27 | Documents | Native visual preview is unavailable for DOCX, XLSX, PPTX, and TIFF files. | Open | The result workspace shows an explicit file-proof fallback for these formats. A future local conversion/rendering layer is required for page-accurate previews without sending customer files to an external service. |

## Resolved Issues

| Date | Area | Issue | Resolution |
| --- | --- | --- | --- |
| 2026-08-15 | Printing | Print-host operating systems and separate-agent approach were undecided. | Printing-MS will be a Windows/macOS desktop application using OS printer queues, with no separate customer-installed print agent. |
| 2026-08-21 | Desktop | Electron logged unsupported `Autofill.enable` and `Autofill.setAddresses` DevTools protocol requests on every development launch. | Detached DevTools no longer opens automatically; it is opt-in with `PRINTING_MS_OPEN_DEVTOOLS=1`. |
| 2026-08-21 | Services | Opening a service returned 404 because its workspace called a nonexistent nested products endpoint. | The workspace now uses the backend's supported `/products?service_id={id}` filter. |
| 2026-08-23 | Product | Operating currency/locale for pricing was undefined and displayed a USD placeholder. | The application now formats commercial values as Philippine pesos using the `en-PH` locale. |
| 2026-08-23 | Product | Saving an existing product with the same assigned materials could violate the product/material uniqueness constraint. | Product updates now flush removed variant and material rows before inserting their replacements. |
| 2026-08-27 | Pricing | Products with configured A4 or Legal material rates could show ₱0/wrong pricing, and job orders ignored the selected paper material. | Removed the Letter-only assumption. Product references now use assigned paper rates, and job lines use the exact selected priced paper material on both client and server. |
| 2026-08-27 | Documents | PDF previews could appear blank or behave inconsistently inside the browser-provided iframe. | Replaced the iframe with a local PDF.js canvas viewer, including explicit loading, rendering, retry, and error states. |

## Template

- Date:
- Area:
- Issue:
- Impact:
- Status:
- Notes:
