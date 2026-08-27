# Issues Log

Track known issues, blockers, risks, and follow-up work.

## Open Issues

| Date | Area | Issue | Status | Owner/Notes |
| --- | --- | --- | --- | --- |
| 2026-08-15 | Product | User roles and permissions are not yet defined. | Open | Clarify owner/admin, sales, cashier, production staff, and customer access. |
| 2026-08-15 | Integrations | Messenger, Gmail, form intake, and online-payment integration levels are undecided. | Open | Initial implementation can support manual entry and payment verification. |
| 2026-08-15 | Documents | File retention, conversion/export, and backup behavior remain incomplete. | Open | Confirmed analyzed transactions now retain the approved upload under the configured managed data directory and attach it to the job; standalone/cancelled analysis remains temporary. Define cleanup, print-ready conversion, and backup/restore coverage. |
| 2026-08-15 | Printing | Advanced printer capabilities and cross-platform completion/cancellation behavior remain undefined. | Open | Printer, file, copies, media, and colour are active. Define quality, borderless mode, capability discovery, OS completion polling, and cancellation semantics. |
| 2026-08-15 | Deployment | Supported Windows and macOS versions are not yet defined. | Open | Required for packaging, hardware validation, and release support. |
| 2026-08-15 | Backend | Bundled FastAPI lifecycle and local communication need validation. | Open | Test loopback authentication, port allocation, startup recovery, shutdown, logging, and platform-specific executable packaging. |
| 2026-08-15 | UX | Exact dashboard metrics, report definitions, and page-level permissions are deferred. | Open | Initial pages will expose honest placeholders and shared workflow states until business rules and roles are confirmed. |
| 2026-08-27 | Printing | Windows queue discovery has not yet been exercised against the owner's physical Canon printer. | Open | Run the desktop app on the Windows workstation after Canon PRINT/Printers & scanners creates the queue; verify discovery, default state, offline state, and model name before adding submission. |
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
| 2026-08-27 | Pricing | Product-selected document analysis could return ₱0 because it priced detected page color instead of the product's configured print type and assigned paper. | Analyzer pricing now resolves through the selected product's active assigned paper rule and prices all pages using that product's print type, matching product and job-order pricing. |
| 2026-08-27 | Quotation | The unused Quotations workspace duplicated the Document Analyzer's pricing role. | Removed Quotations from the renderer navigation/routes and related customer/overview/settings surfaces; legacy backend records remain intact for compatibility. |
| 2026-08-27 | Printing | Windows printer discovery was an explicit unimplemented stub. | Implemented vendor-neutral Windows spooler discovery through the built-in `Win32_Printer` CIM provider, including default and queue-state mapping; no Canon SDK or `pywin32` dependency is required. |
| 2026-08-28 | Workflow | Canonical job-order statuses and transition rules were not defined. | Adopted the guarded owner workflow Pending Payment → Paid → Queued → Printing → Quality Check → Ready → Completed. Full verified payment, print-ready files, and successful OS submission enforce the production gates. |

## Template

- Date:
- Area:
- Issue:
- Impact:
- Status:
- Notes:
