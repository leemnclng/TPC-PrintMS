# Change Log

Track notable app changes by date.

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
- Changed: Quick Actions now appears directly below the Overview heading, with New Job Order highlighted as the primary counter workflow.
- Added: The Overview shortcut opens the complete upload-and-analysis job-order modal in one click.
- Changed: New Job Order is now a guided transaction flow for customer file upload, configured product/variant selection, analysis, price review, and Print Center handoff.
- Added: Owners can accept the engine recommendation or set a transaction-only final price while preserving the original suggestion for audit.
- Added: Confirmed transactions retain their approved file and automatically plan the detected configured paper at pages × copies.
- Changed: Cancelling before final confirmation creates no job order and retains no file.
- Added: Print Center opens with the confirmed job, pricing decision, product/page details, and ready-to-print file visibly staged.
