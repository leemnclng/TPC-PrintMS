# Change Log

Track notable app changes by date.

## 2026-08-30 (colored-only scanner acquisition)

- Changed: Scan setup now shows Document content as a fixed Colored value instead of offering unreliable grayscale and B&W choices.
- Changed: The Electron scanner bridge and Windows WIA script reject non-color requests, keeping UI behavior aligned with the validated Canon acquisition path.

## 2026-08-30 (environment backup and restore)

- Added: Settings can create and download a complete backup of the active environment and restore a matching-stage ZIP.
- Added: Every archive contains a consistent SQLite snapshot, retained print/scan files, non-secret JSON configuration, a manifest, and integrity checksums.
- Added: Restore validates archive safety and database integrity, then creates a pre-restore safety backup before replacing current data.
- Changed: Development, test, and production now keep databases, managed files, backups, and config snapshots in separate environment folders; legacy data is copied forward without deleting its source.

## 2026-08-30 (safe product removal)

- Fixed: removing a product no longer fails when completed or active records reference it.
- Changed: unused products are deleted permanently, while historically used products become Inactive and remain available to job, quotation, pricing, and inventory audit history.
- Added: removal loading and error states in the product workspace, with confirmation copy explaining archival behavior.

## 2026-08-30 (product-aware pricing matrices)

- Added: a centralized product pricing matrix in Configuration. Owners select a Printing or Photocopy product and choose whether its assigned material/output cell inherits the global rate or uses a product-specific amount.
- Changed: global matrices now show individual inventory materials as rows instead of collapsing materials that share A4, Letter, or Legal sizing.
- Changed: Pricing Center now presents compact material × print-type base matrices and denser service-grouped product comparisons.
- Clarified: Scan-only products remain standalone per-page prices because they consume no paper or ink.

## 2026-08-30 (interactive production panes)

- Changed: Production-line cards now open a contextual process panel when the owner clicks the pane or its keyboard-accessible step control.
- Added: Each state explains and exposes its correct next action: print setup, scanning, photocopy completion, print confirmation, quality reprocessing, softcopy access, or a locked audit record.
- Changed: Status and inventory mutations remain behind explicit action buttons; opening a pane never changes production data.

## 2026-08-30 (multi-service transactions)

- Changed: New Job Order starts from an initial service but now accepts additional products from any active service in the same transaction.
- Added: Every product line follows its own Printing, Scan, or Photocopy requirements and tracks Queued, Printing, Ready, files, device attempts, materials, and rework independently.
- Added: The job workspace shows product-level operation cards and a combined payment breakdown.
- Changed: Payment is recorded once for the full transaction and is blocked until every product is Ready; final completion remains transaction-wide.

## 2026-08-30 (centralized pricing)

- Added: a top-level Pricing view for all global paper rates, product overrides, standalone scan rates, and per-product variant adjustments.
- Added: custom/global source labels, search and source filters, missing-rate warnings, summary counts, and direct edit links.
- Added: Pricing now mirrors all services from Printing Services in a service-grouped product table comparing A4, Letter, Legal, standalone scan, print-type, material-source, and variant pricing.
- Changed: Configuration now links to the centralized pricing view while remaining the source of truth for global pricing edits.

## 2026-06-06

- Added context documentation for tracking progress, changes, issues, functionality, and decisions.

## 2026-08-15

- Added the agreed Printing-MS scope, initial modules, supporting business workflow, and open product questions to project context.
- Added vendor-neutral printer integration, with Canon PIXMA G4770 as the first supported model.
- Added the initial application build plan and recorded the Windows/macOS desktop delivery architecture.
- Updated the architecture plan to use a bundled FastAPI backend without requiring customer-managed Python or `.venv`.
- Added the initial page map covering Overview, Job Orders, Quotations, Production, Print Center, Product Catalog, Customers, Reports, and Settings.

## 2026-08-15 (initial application scaffold)

- Added: the first installable-shape build of Printing-MS — Electron + React/TypeScript renderer, FastAPI + SQLite backend, all 9 primary pages and 4 nested workspaces, full customer and product-catalog CRUD, real OS printer detection (CUPS), and a business-profile settings form seeded with The Paper Club's actual name and tagline.
- Added: a custom visual identity ("Press") built from The Paper Club's own logo — sampled ink-red and paper tones, Bodoni Moda + IBM Plex Sans/Mono type system — rather than a generic dashboard template.
- Changed: nothing (first scaffold).
- Fixed: n/a.
- Removed: n/a.

## 2026-08-16

- Changed: the sidebar's top-left brand icon now uses a transparent PNG crop of The Paper Club's logo (`the-paper-club-mark.png`) instead of the textured JPEG lockup — it sits flush on the sidebar surface with no background frame. The original JPEG is kept for future document/letterhead use.
- Changed: redesigned the primary navigation to read as an enterprise management console rather than a numbered list — grouped into Sales / Operations / Directory / Insights (Overview and Settings stay pinned), each item now has a hand-drawn icon instead of a "01–09" index, the active item is a filled accent pill instead of a left border bar, and the footer is now an account-style block (avatar + "Owner" + connection status) instead of a bare status dot. The numbered index was also removed from the top bar breadcrumb and every page's eyebrow label. No routes, pages, or information architecture changed — same nine destinations, same order.

## 2026-08-21

- Changed: Product Catalog is now Services. Owners create a service first, open it, then create and manage products inside it.
- Changed: Opening a service now shows only its product inventory; service details, status, and removal are managed from a separate Settings page.
- Added: service CRUD, service-level product counts, nested product workspaces, and migration of existing product categories into services.
- Added: a Settings action on each service workspace and a dedicated `/product-catalog/:serviceId/settings` route.
- Fixed: services with products cannot be removed until their products are moved or removed, preventing accidental catalog loss.
- Fixed: development startup no longer automatically opens DevTools and emits unsupported Autofill protocol warnings; DevTools remains available through `PRINTING_MS_OPEN_DEVTOOLS=1`.
- Fixed: opening a service no longer returns 404 while loading its products.
- Changed: New product now opens as a focused modal from the service inventory; successful creation closes it and immediately shows the new product row.
- Added: a shared accessible modal component and a documented UX development standard that future user-facing features must follow.
- Added: an Inventory page under Operations for registering paper, ink, toner, and other production materials with current stock and reorder levels.
- Added: focused modals for material registration/editing and audited stock adjustments; successful actions update the visible register immediately.
- Added: per-product material recipes in the Product Workspace and job-order material movement history in the Job Order Workspace.
- Added: inventory APIs, immutable stock movements, product material requirements, and the database migration supporting them.
- Changed: Creating a product now requires selecting at least one active inventory material and entering the quantity consumed per finished product; duplicate materials and zero/negative quantities are rejected.
- Added: The New Product modal links directly to Inventory when no active materials are available.

## 2026-08-23

- Changed: Product material assignment now uses a checkbox multi-select instead of repeated single-material dropdown rows.
- Removed: the expected per-product material quantity; products now store eligible material choices only.
- Changed: Product assignments now define the material choices that the owner will be allowed to select from for a future job order.
- Changed: product material requirements are now named material assignments in the API and database; existing links are preserved by migration.
- Added: Job Orders can now be created manually from a focused modal with a customer, multiple products, due date, order total, production notes, page/copy/side details, and planned materials.
- Added: Product selection limits each job line to that product's assigned materials and records the owner-confirmed planned quantity per material.
- Added: Job Order Workspace now shows product and material-plan details and provides a Record usage action that deducts stock and creates job-linked inventory movements.
- Changed: Creating a job order does not reserve or deduct inventory; only the explicit usage confirmation changes stock.
- Changed: Selecting a customer is now optional when creating a job order; customer-less orders are shown as Walk-in throughout Job Orders and Production.
- Changed: The New Job Order modal now opens on production details first; customer, deadline, total, and notes are grouped at the bottom.
- Changed: Product selection in New Job Order now uses responsive selectable product boxes instead of a dropdown.
- Added: Each job-order product pane now includes search by product name, service, or variant with a visible result count and clear-search state.
- Changed: Product search now uses a compact single-row control with an integrated search icon and result count instead of a separate label row.
- Changed: All commercial values now display in Philippine pesos instead of US dollars.
- Added: Products now support named pricing variants such as Back-to-back, with per-page/unit adjustments and final-price previews.
- Added: New Job Order now calculates each line and the complete order from product price, selected variant, pages, and copies.
- Added: Job-order items snapshot their unit price and line total so later product-price changes do not alter historical orders.
- Fixed: Existing products can update pricing variants without unchanged material assignments causing a uniqueness error.
- Added: Each service now has a dedicated Variants page for creating and maintaining reusable production/pricing options.
- Changed: Product forms now select variants from their service library and set only the product-specific price adjustment.
- Added: Variant usage counts and guarded deletion prevent removing an option while products still use it.
- Changed: Existing product variants are migrated into their parent service’s reusable library without losing price adjustments.
- Changed: Variants now live in one Global variants library under the main Services page and can be assigned to products in any service.
- Changed: Service-level variants are merged by name during migration while product-specific price adjustments remain intact.
- Added: Every product now has a required print type limited to Colored or B&W (Black and white).
- Added: Product type is visible in service product lists and job-order product selection, and it participates in product search.

## 2026-08-24

- Added: Document Analyzer under Operations with drag/drop or file selection for PDF, image, DOCX, XLSX, and PPTX files up to 25 MB.
- Added: Results for page count, paper size, orientation, color/B&W pages, text/images, coverage, estimated processing time, warnings, confidence, and PHP price breakdown.
- Added: Configurable document-analysis rates in Settings for A3, A4, Letter, Legal, and fallback paper sizes.
- Added: Secure analyzer and pricing-rule APIs plus a database migration for persisted rates.
- Changed: Analyzer uploads are processed locally in memory and are not retained.

## 2026-08-24 (product-aware document pricing + Configuration page)

- Added: Products can now override the document analyzer's per-page rate for specific paper sizes and print types; the Document Analyzer page can reference a product so its own rates (falling back to the global rate) are used.
- Added: A new Configuration page (pinned next to Settings) for catalog-wide configuration.
- Changed: Global variants moved from Services (`/product-catalog/variants`) to Configuration (`/configuration/variants`); the old link now redirects.
- Changed: Document analyzer pricing moved out of Settings into Configuration; Settings now just links there.
- Changed: The analyzer's pricing breakdown now labels each rate as a product override, a paper-size match, or the Unknown-size fallback instead of only flagging fallback use.

## 2026-08-24 (paper stock, print type, and reference pricing)

- Added: Inventory items can be tagged as A4, Letter, or Legal paper stock; document pricing is now configured per tagged item instead of a free-standing size list.
- Removed: A3 and the Unknown-size fallback rate from document pricing — only A4, Letter, and Legal are priced.
- Removed: The "Base price per page / unit" field on products.
- Added: A product's price is now computed automatically from the Letter-size document-pricing rate for its own Print Type (its own override, else the global rate), shown live as "Reference price / page" while editing.
- Changed: A product's document-pricing override list now only shows rates for its own Print Type instead of both Colored and B&W.
- Changed: Job-order line pricing, the product catalog list, and job-order product cards now use this computed price instead of the removed base price.

## 2026-08-24 (inventory material deletion)

- Added: A Delete button and confirmation modal for inventory materials.
- Added: Deleting a material is blocked while it's assigned to a product, used in a job order, or used in document-analyzer pricing — deactivate it instead. Its own recorded stock movements no longer block deletion; they're removed with it.

## 2026-08-27

- Fixed: Product prices now reflect configured A4, Letter, or Legal rates for the paper materials assigned to the product instead of always looking for Letter.
- Fixed: New job orders now preview and save the rate for the paper material selected on each line, including product overrides and variants.
- Added: Clear validation prevents one job line from selecting multiple priced paper sizes; use another line when a job needs a second size.
- Changed: Product forms now assign a paper material directly from its pricing row and choose global or custom pricing there, removing the duplicate paper checkbox from Assigned materials.
- Changed: Assigned materials is now a read-only responsive summary; ink, toner, binding, laminate, and other non-priced supplies remain selectable under Other materials.
- Changed: New Job Order now asks for one configured paper size after product selection; changing it immediately switches the applicable global or product-specific rate.
- Changed: The selected paper's Inventory material and planned sheet quantity are added automatically, leaving only non-paper supplies as optional material choices.
- Fixed: The API now prevents creating a priced-paper product line without a configured size or with a paper material that has no active rate.
- Removed: Print sides from New Job Order; options such as Back-to-back remain available through product variants.
- Changed: Automatic paper quantity now uses pages per copy × copies.
- Changed: Document Analyzer results now use a left document-preview pane and a right analysis pane, stacking vertically on smaller screens.
- Added: Local PDF and browser-supported image previews with revoked temporary object URLs; Office and TIFF files show a clear non-renderable preview state.
- Changed: Pricing, document metrics, warnings, privacy status, and result actions now live together in the analysis pane.
- Fixed: Replaced the blank/unreliable PDF iframe preview with a local PDF.js canvas renderer.
- Added: PDF page navigation, direct page entry, zoom, fit-to-width, rotation, keyboard shortcuts, download, and retryable error states.
- Changed: Analyzed documents now occupy the full available app content pane instead of the centered page width.
- Changed: PDF preview now shows every page in one continuous vertical scroll; previous/next pagination controls were removed.
- Fixed: Product-selected document analysis now uses the product's configured print type, assigned paper material, and override/global rate instead of returning ₱0 when source-page color differs.
- Fixed: PDF analysis now handles encrypted/invalid files consistently and warns when text extraction fails on individual pages.
- Added: `PRINT_MS_STAGE` and `PRINT_MS_DATABASE_PATH` `.env` configuration, with resolved stage/database diagnostics in Settings.
- Added: Owner name configuration in Settings; the saved name and initials now appear in the sidebar.
- Removed: The redundant Production page, route, navigation item, and icon.
- Changed: The sidebar connection status now reads “Connected” instead of “Backend connected.”
- Added: PDF page raster analysis now measures ink and color coverage across text, vectors, and images; image files use the same pixel engine and Office formats expose conservative estimated coverage.
- Changed: Document Analyzer pricing now shows product base subtotal, measured ink surcharge, configured color-coverage premium, and optional per-page variant adjustment as separate lines.
- Changed: Product selection is required for Analyzer pricing, with only that product's configured variants available.
- Removed: Quotations navigation, routes, pages, overview metric, customer counts, and Settings controls; legacy backend records remain untouched.
- Changed: The Paper Club mark now appears in the browser tab and as the Electron window, dock/taskbar, and packaged application icon.
- Added: Print Center can open native Windows/macOS printer settings and now guides Canon PRINT users from device setup to OS queue discovery.
- Added: Windows printer discovery through the built-in spooler provider, covering Canon and other installed printer brands without a vendor SDK.
- Fixed: A printer queue removed from the operating system is marked offline after discovery instead of retaining a stale healthy state.
- Added: Print Center auto-detects and displays the printer host operating system and whether it was automatic or selected through `PRINT_MS_PRINTER_PLATFORM`.

## Template

### YYYY-MM-DD

- Changed:
- Added:
- Fixed:
- Removed:
## 2026-08-28

- Added: Owners can record verified partial or full payments; a fully paid job automatically advances to Paid.
- Added: Job orders now enforce Paid → Queued → Printing → Quality Check → Ready → Completed with one clear next action and a durable status timeline.
- Added: Print Center now selects an available printer, staged file, copies, color mode, and paper size before explicit operating-system submission.
- Added: Successful and failed print attempts retain printer, file, settings, operator, timestamps, result, OS job identifier when available, and failure detail.
- Added: Separate `PRINT_MS_DEVELOPMENT_DATABASE_PATH`, `PRINT_MS_TEST_DATABASE_PATH`, and `PRINT_MS_PRODUCTION_DATABASE_PATH` configuration with distinct defaults.
- Added: Settings now shows all environment database paths, their source, and which stage is active; changing `PRINT_MS_STAGE` takes effect after restart.
- Fixed: Windows PDF/image printing no longer depends on a default application supporting the `PrintTo` file verb; Printing-MS renders pages and submits them directly through the selected Canon or other installed printer driver.
- Changed: Windows print submission now applies the chosen copies, color/grayscale mode, paper size, and page orientation; unsupported Office files ask for PDF export instead of emitting a PowerShell stack trace.
- Fixed: Print History result badges stay readable on one line and operating-system failures are reduced to a concise actionable message.
- Added: Confirmed files now retain the analyzer's page count, paper size, orientation, color/B&W split, coverage, print-time estimate, and confidence for downstream printing.
- Changed: Print Center shows an automatic read-only print profile; copies and output mode come from the approved product transaction, while paper and page details come from analysis.
- Added: Successful print submission automatically deducts all remaining planned materials and creates job-linked inventory ledger entries.
- Added: Low stock blocks printing with the required and available quantities; failed printer submissions do not deduct inventory, and retries cannot double-deduct completed plans.

## 2026-08-29

- Documented: Windows Canon scanning requires the model-specific IJPAT/full MP/WIA package so the device is registered with WIA; Canon PRINT connectivity alone is not sufficient.
- Added: A Windows deployment checklist for Canon network selection, test printing/scanning, troubleshooting, and future installer prerequisite checks.
- Fixed: The New print type modal now keeps fields away from its edges, separates actions into a stable footer, and remains usable on narrow windows.
- Added: Semi-colored is available as a product and paper-pricing type, with color printer output and measured ink-coverage pricing.
- Added: Configuration can create future print types in-app and automatically exposes a pricing column for each one.
- Changed: Product forms, analyzer pricing, and Print Center now use shared print-type definitions instead of hardcoded B&W/Colored options.
- Fixed: B&W document analysis no longer adds ink-load or detected-color surcharges on top of the configured rate.
- Changed: B&W recommendations now equal the configured paper-size rate × pages × copies, plus only an explicitly selected variant.
- Changed: Analyzer and transaction breakdowns state that the B&W base already includes paper and ink.
- Changed: New Job Order now asks the owner which configured paper to print on before analysis; that choice drives the rate, stock plan, deduction, and Print Center media.
- Changed: Detected document size is labeled “Best fit” and shown as non-blocking guidance even when it differs from the selected print paper.
- Added: Print Center now offers per-attempt orientation, fit/fill/actual-size scaling, draft/standard/high quality, borderless behavior, and copy collation, with every choice retained in Print History.
- Added: Windows users can open the selected printer driver's native preferences for Canon-specific paper type, tray, and advanced settings.
- Changed: The OS default printer is the single prominent device; all other installed queues appear in a subtle, separately labeled Others pane and remain selectable.
- Changed: Creating a job order now opens that job’s workflow page instead of navigating to Print Center.
- Changed: Payment, queueing, printer setup, quality check, ready, and completion now open as modals without leaving the job order.
- Changed: The job-order workspace now shows only the current lifecycle, transaction essentials, production brief, and a collapsed history/audit pane.
- Changed: Quick Actions now appears directly below the Overview heading, with New Job Order highlighted as the primary counter workflow.
- Fixed: B&W product pricing no longer converts a color-containing imported document to grayscale before printing.
- Changed: Physical color mode now comes from document analysis, with RGB preserved for mixed/color files and grayscale used only for confirmed monochrome files.
- Changed: Print setup defaults to per-page orientation, fit-to-printable-area scaling, installed-driver quality, and normal driver margins; borderless remains a deliberate supported-media override.
- Changed: Print types and new-type creation are described as pricing/workflow categories instead of automatic printer color modes.
- Fixed: Windows printing no longer applies the Canon driver's hard margin twice, removing the extra software inset that made output smaller and shifted.
- Changed: New print attempts default to Automatic scaling, which preserves source dimensions and document margins and shrinks only when the driver's printable area requires it.
- Added: Printing-MS now monitors and persists Canon PRINT and other application jobs that pass through the Windows spooler while the desktop app is open.
- Added: Print Center shows external Windows activity in a separate External / Unlinked pane with printer, document, owner, page progress, spooler job ID, and live status.
- Added: A new unlinked Windows print raises a non-blocking owner prompt with Create job and Not now actions; Print Center retains later Create/View job actions.
- Changed: New Job Order now progresses through Customer file, Print setup, and Preview & price, with smoother in-place transitions and no intermediate navigation.
- Added: The transaction review embeds the same continuous, zoomable, rotatable PDF preview used by Document Analyzer alongside analysis and pricing.
- Changed: A spooler observation is linked to its job order only after the owner re-uploads the source file and approves the analyzed transaction.
- Added: Variants may enable Supervised back-to-back printing; the existing Back-to-Back variant is migrated automatically.
- Added: Back-to-Back job printing now runs as durable front and back attempts with an in-modal reload checkpoint and explicit Canon rear-tray instructions.
- Changed: Back-to-Back paper planning uses `ceil(pages ÷ 2) × copies`, while pricing remains page-based.
- Changed: Planned inventory remains untouched after the front pass and deducts only after the back-side queue submission succeeds.
- Changed: Print Center redirects supervised duplex jobs to their job-order modal to prevent an unsafe unsupervised second submission.
- Changed: Spooler disappearance is recorded as Released rather than Completed because Windows cannot confirm physical output; printer-panel and direct mobile/cloud work is clearly identified as outside Windows tracking.
- Changed: New job references now use a non-reusing 10-digit sequence such as `JOB-0000000001`, supporting nearly ten billion owner-facing transaction numbers while retaining UUID database identities.
- Added: A floating global print tracker shows all queued and printing jobs, Windows spooler status and page progress, and a hover summary from every app page.
- Added: Released, paused, or failed prints raise an owner-attention state; its global activity modal opens the relevant job so the owner can continue reinsertion, quality check, or recovery.
- Fixed: Primary and secondary job-workflow button labels remain legible instead of inheriting the command panel's red eyebrow color.
- Fixed: A currently printing job no longer disables another job's Proceed to print action; the installed OS queue remains responsible for ordering submissions.
- Added: Every new job order has a required owner-friendly name, automatically suggested from the uploaded filename and editable before analysis.
- Changed: Job lists, job workspaces, print setup, workflow dialogs, and global print activity now show the job name first and the permanent `JOB-…` reference second.
- Changed: Existing job names are initialized from their retained source filename where available, without changing job numbers or route identities.
- Added: Services can be categorized as Printing, Photocopy, or Custom; existing services retain the Printing workflow during migration.
- Changed: New Job Order now asks for the service first and opens only the requirements for that workflow.
- Added: Photocopy jobs require no uploaded document and compute from product, paper, pages, copies, and optional back-to-back pricing.
- Added: Recording a photocopy job deducts the physical paper used immediately and opens it Ready for payment.
- Changed: B&W photocopy products use independent per-paper prices; colored photocopy products may use global paper pricing.
- Changed: The built-in Photocopy service is now presented as Scan or Photocopy and supports separate product operations.
- Added: Scan products use a standalone custom price per page and cannot assign paper, ink, variants, or printing rates.
- Changed: Scan job creation now starts the installed Windows scanner through WIA, previews acquired pages, and derives its billable page count without manual entry.
- Added: Multiple scanner captures are combined into one retained PDF; saved scan outputs can be viewed and downloaded inside the job workspace.
- Changed: Importing an existing scanner PDF/image remains available only as a recovery option when direct acquisition is unavailable.
- Fixed: Direct Scan no longer exposes PowerShell/COM stack traces when Windows cannot find or use a scanner; the modal now gives specific device, driver, connection, paper, jam, cover, busy, and warm-up guidance.
- Added: Scan intake now discovers Windows scanners, separates flatbed and document-feeder placement, checks hardware readiness when reported by the driver, and requires owner placement confirmation before acquisition.
- Changed: Scan jobs consume no inventory and open Ready for payment and delivery immediately after the output is retained.
- Added: The Overview shortcut opens the complete upload-and-analysis job-order modal in one click.
- Changed: New Job Order is now a guided transaction flow for customer file upload, configured product/variant selection, analysis, price review, and Print Center handoff.
- Added: Owners can accept the engine recommendation or set a transaction-only final price while preserving the original suggestion for audit.
- Added: Confirmed transactions retain their approved file and automatically plan the detected configured paper at pages × copies.
- Changed: Cancelling before final confirmation creates no job order and retains no file.
- Added: Print Center opens with the confirmed job, pricing decision, product/page details, and ready-to-print file visibly staged.

## 2026-08-30

- Fixed: Automatic scanning now selects the WIA feeder item when loaded instead of always transferring the first, commonly flatbed, item.
- Added: Scan Source offers Automatic (feeder first), Document feeder, and Flatbed glass, limited to sources exposed by the installed driver.
- Fixed: B&W text scans retry as grayscale when the Canon WIA driver rejects its text intent, and the applied fallback is shown to the owner.
- Added: Scanner refresh and acquisition now retain informative checking, progress, success, cancellation, fallback, and error results inside the job modal.
- Changed: The main navigation and matching page headings now use Printing Job Orders and Printing Services.
- Changed: Normal Scan acquisition no longer opens the Windows WIA settings window; content, resolution, and page-size choices now remain inside the job modal.
- Added: Color document, grayscale, B&W text, 150/300/600 DPI, and Automatic/A4/Letter/Legal/4×6/5×7/8×10 scan profiles with inline unsupported-setting recovery.
- Fixed: Windows scanner pages are normalized to validated PNG before preview, preventing driver-native BMP/TIFF output from appearing as a broken image.
- Changed: Scan intake keeps automatic flatbed/feeder selection. Detected feeder paper proceeds automatically; flatbed or non-sensing drivers require owner confirmation because WIA cannot reliably prove an original is present.
- Preserved: Real offline, paper-jam, open-cover, busy, and acquisition errors remain visible and recoverable.
- Fixed: Canon acquisition now starts through WIA's transfer/progress path while the redundant Windows source/settings window remains disabled.
- Added: Products can be added to an existing Queued, Printing, or Ready transaction until it is paid.
- Added: Failed quality now opens a focused reprint/re-scan/reprocess confirmation with an optional audit reason and the next cycle's material impact.
- Changed: Every physical reprocess receives a fresh material allowance; successful replacement printing or photocopy completion deducts it again without restoring the rejected output's consumption.
- Added: Job lists and production cards show reprocess cycle counts for quick identification.
- Added: Active unpaid transactions can be cancelled with a required reason; cancelled orders retain history and consumed inventory while blocking further production.
- Added: Separate global paper-rate tables for Printing and Scan or Photocopy, each segmented by stocked material and active print type.
- Changed: Product and transaction pricing now inherit only from the global table matching the product workflow, then apply any product override.
- Changed: B&W photocopy products may use the Scan or Photocopy global rate instead of requiring a custom price for every paper.
- Preserved: Scan products keep a product-specific per-page softcopy rate because scanning consumes no paper or printing ink.
- Changed: Delete product now removes the product from catalogues and new transactions immediately instead of showing it as Inactive.
- Added: Each service shows its Recently deleted products with an expiry date and Undo delete action for five days.
- Changed: Expired unused products are permanently purged; historically referenced products become hidden, non-restorable audit identities so completed job and inventory history remains readable.

## 2026-08-31

- Fixed: Analyzed Printing products in multi-product job intake once again show their uploaded document beneath the analysis controls.
- Added: PDF previews retain continuous scrolling, zoom, rotation, retry, and download; supported images render in the same per-product pane.
- Added: Required job-order inputs and the analysis step are visibly labeled and highlighted only while they still need owner input.
- Added: Inventory materials can store an optional purchase price in Philippine pesos using their configured stock unit; sheet-based paper may instead record the supplier's whole-ream amount.
- Added: The Inventory register shows the saved cost basis, its per-sheet equivalent for reams, or Not set when no current cost is known.
- Preserved: Purchase costs do not automatically change product, analyzer, or transaction selling prices.
- Changed: Inventory unit entry is now limited to Sheet, Ream, Bottle, Cartridge, Roll, Pack, and Piece instead of accepting arbitrary measurements such as milliliter.
- Added: Photo Print is available as a built-in print type in product configuration and material-linked pricing.
- Added: Photo jobs start with high quality, fill-and-crop, borderless output and expose Canon-style media choices including Glossy II, Pro Luster, Semi-gloss, Glossy, Matte, Hagaki, greeting card, and card stock.
- Added: Selected media is retained in job audit and Print History and is sent to the installed print system with the closest standard driver media hint.
- Changed: Inventory paper size now uses the Canon G4070 catalogue instead of only A4, Letter, and Legal; every choice includes its canonical width and height.
- Added: Custom paper accepts measured dimensions within 55 × 89 mm and 216 × 1200 mm, with inline validation and normalized short/long edges.
- Changed: Analyzer guidance, product pricing, job paper choices, and print history display the same measured media profile selected in Inventory.
- Changed: More than one material may use the same paper size, allowing separate bond, glossy, matte, and specialty stocks with independent pricing.
