# Decisions

Track product and technical decisions that affect future development.

## 2026-06-06

### Add App Context Documentation

- Decision: Maintain progress, changes, issues, functionality, and decisions in Markdown files under `docs/context`.
- Rationale: Keeps project context easy to inspect and update without requiring a separate tracking tool.
- Impact: Future work should update these docs when meaningful app behavior or implementation context changes.

## 2026-08-15

### Define the Printing-MS Product Boundary

- Decision: Printing-MS is the central printing-management application. Its initial scope comprises Product Catalog, AI-assisted Quotation Management with owner approval, Job Order Management, Real-time Tracking, Document Import/Export, and Reports and Analytics.
- Rationale: The surrounding business workflow provides operational context, while these modules define the software to be built.
- Alternatives considered: Treating the entire left-side communication and payment flow as the application itself.
- Impact: Design and implementation should center on a shared job-order lifecycle and connect each initial module to it.

### Keep External Intake Separate Until Integration Is Defined

- Decision: Messenger, Gmail, and form-based intake are business input channels, but direct integrations are not yet assumed.
- Rationale: The required automation and integration details have not been specified.
- Alternatives considered: Building direct Messenger and Gmail integrations into the first implementation automatically.
- Impact: The initial data model must support source-channel metadata while allowing manual order entry.

### Design Printer Integration to Be Vendor-Neutral

- Decision: Use the Canon PIXMA G4770 as the first supported printer without coupling Printing-MS to that model or Canon-specific APIs.
- Rationale: The system must be able to add other printers later.
- Alternatives considered: Implementing a G4770-only integration.
- Impact: Printer capabilities and connection methods must be modeled separately, with standard network printing or operating-system print queues used where possible.

### Deliver Printing-MS as a Cross-Platform Desktop Application

- Decision: Build an installable Windows and macOS desktop application using Electron, with printing performed through operating-system printer queues. Customer machines will not require Docker or a separate print-agent installation.
- Rationale: The owner needs to operate local printers directly while keeping installation simple and supporting multiple printer brands.
- Alternatives considered: A browser-only application with a separate local print agent, or running the application in Docker on each customer machine.
- Impact: Native printing feasibility, desktop packaging, code signing, and macOS notarization must be validated early.

### Start Local-First While Preserving a Sync Boundary

- Decision: The initial application will use local persistence on one printing workstation, with storage access isolated so a shared backend can be added later.
- Rationale: This minimizes initial deployment complexity while avoiding unnecessary coupling to a permanently single-machine design.
- Alternatives considered: Requiring a shared cloud backend in the first release.
- Impact: Multi-device access and synchronization are deferred, but domain and persistence boundaries must remain suitable for future extraction.

### Use FastAPI as the Local Application Backend

- Decision: Use Python and FastAPI for business logic, SQLite persistence, AI-assisted quotation processing, documents, and reports. Use `uv` with a project `.venv` during development, then bundle the backend into a platform-specific executable for distribution.
- Rationale: Python supports the planned AI and document-processing work and gives the domain a clean API boundary that can later move to a shared backend.
- Alternatives considered: Implementing all business logic inside the Electron main process.
- Impact: Electron must manage the backend lifecycle and secure local communication. Windows and macOS backend executables must be built and tested separately; customers will not manage Python or `.venv`.

### Organize the Initial Application Around the Operational Workflow

- Decision: Use Overview, Job Orders, Quotations, Production, Print Center, Product Catalog, Customers, Reports, and Settings as the initial primary pages. Use nested workspaces for individual orders, quotations, products, and customers.
- Rationale: This covers every initial system capability while keeping navigation task-oriented and avoiding a separate top-level page for every granular action.
- Alternatives considered: Organizing navigation directly by database entity or creating many single-purpose pages.
- Impact: The first application scaffold must create all primary routes and workspaces, even when some deeper controls remain placeholders for later phases.

## 2026-08-15 (initial application scaffold)

### The Paper Club Is the Business Brand; Printing-MS Stays the System Name

- Decision: The user identified their business as "The Paper Club" ("Printing & Digital Services") and supplied its actual logo. The application now seeds the real business profile with that name/tagline and uses the real logo in the sidebar brand lockup, while "Printing-MS" remains the internal system/product name shown as a small subtitle beneath it.
- Rationale: The docs already named the software "Printing-MS"; the owner's actual storefront brand is a separate, real fact that should appear wherever the app addresses the business (Settings, sidebar), not be replaced or invented.
- Alternatives considered: Renaming the whole product to "The Paper Club" throughout the codebase; ignoring the brand and using a generic placeholder business name.
- Impact: `services/api/app/seed.py` seeds Business Profile with the real name/tagline instead of a fabricated placeholder. Two real logo assets live under `apps/web/src/assets/brand/` (mirrored at `docs/assets/brand/`): `the-paper-club-logo.jpg`, the full lockup on its original paper-texture background, kept for future document/letterhead use; and `the-paper-club-mark.png`, a transparent PNG cropped tightly to the wordmark, which is what the sidebar's top-left brand icon actually renders — true transparency meant it could sit directly on the sidebar surface with no background frame, unlike the JPEG.

### Build a Custom Brand-Derived Visual System Instead of a Generic Dashboard Theme

- Decision: Sample the actual ink-red and paper tones from The Paper Club's logo (`oklch(35% 0.145 28)` accent, warm off-white paper surfaces) and pair Bodoni Moda (echoes the logo's high-contrast serif caps) with IBM Plex Sans/Mono for a dense operational UI, rather than reusing a generic catalog theme or default shadcn/Tailwind dashboard look.
- Rationale: The user explicitly asked for a UI aligned to this specific business, not a generic AI-dashboard template; a print shop's own brand ink and paper stock is a stronger, more honest source of identity than an invented palette.
- Alternatives considered: A generic neutral admin-dashboard theme (blue/purple gradient cards, default Inter font); picking an unrelated named theme from a design-system catalog.
- Impact: All colors/fonts/spacing live as named tokens in `apps/web/src/styles/tokens.css`; every component consumes tokens by name, never inline values. Chosen tone: "workshop-precise" (dense, functional, sparing use of paper/ink motifs — e.g., the registration-mark empty-state icon).

### API Wire Format Is camelCase; Internals Stay Idiomatic Per Language

- Decision: FastAPI schemas use a shared `CamelModel` base (Pydantic `alias_generator=to_camel`) so JSON request/response bodies are camelCase, while SQLAlchemy models, Python fields, and the database stay snake_case, and the TypeScript domain types stay camelCase.
- Rationale: Avoids a manual field-mapping layer on either side while keeping each language's own convention idiomatic.
- Alternatives considered: snake_case over the wire with manual camelCase mapping in the renderer; camelCase database columns.
- Impact: Every new backend schema should extend `CamelModel` (`services/api/app/schemas/common.py`); renderer code should never need to convert casing.

### Renderer Uses HashRouter; Backend Is Spawned From Source in Dev

- Decision: The React renderer uses `HashRouter` (not path-based routing) so deep links resolve when the production build is loaded from `file://` inside Electron. The Electron main process currently starts the backend only via `uv run` from `services/api` source; packaged-build backend startup is an explicit unimplemented error rather than a silent failure.
- Rationale: Path-based routing needs a server to resolve arbitrary deep-link paths, which a `file://`-loaded production build doesn't have. Bundling the backend into a signed executable is genuinely Phase 7 scope (code signing, notarization, per-OS executable builds) and shouldn't be faked in Phase 2.
- Alternatives considered: Path-based routing with a custom Electron protocol handler; silently falling back to some other backend-start strategy in packaged builds.
- Impact: All internal navigation must use `react-router-dom` (`Link`/`useNavigate`), never raw `<a href>`. `apps/desktop/src/backendManager.ts` throws a clear, documented error if launched from a packaged build until Phase 7 lands.

## 2026-08-21

### Organize the Catalog Around Services

- Decision: Services are the catalog’s primary level, and every product belongs to one service. For example, a Printing Service can contain business cards, flyers, and other print products.
- Rationale: The owner needs to choose from a structured service/product catalog when creating quotations and job orders; a free-text product category does not provide that hierarchy.
- Alternatives considered: Keeping categories as free-text product metadata; treating services and products as the same entity.
- Impact: The UI navigation now says Services, service workspaces contain product lists, products require a service, and the migration converts existing product categories into services without losing products.

### Separate Service Inventory From Service Settings

- Decision: Opening a service is an inventory-first view containing its products; editing the service name, description, status, or removal is handled on a dedicated Settings route.
- Rationale: Owners enter a service primarily to manage products used in quotations and job orders, while service configuration is a less frequent administrative task.
- Alternatives considered: Keeping the service form above the product list; opening settings in an inline expandable panel.
- Impact: `/product-catalog/:serviceId` is read-only at the service level, and `/product-catalog/:serviceId/settings` owns service edits and removal.

### Keep Focused Creation in Context

- Decision: Focused create actions launched from a list or detail view should use a modal when the form fits comfortably in one responsive overlay. Successful creation closes the modal and visibly updates the originating view; complex editing remains in a dedicated workspace.
- Rationale: Owners can add records without losing their place, while larger tasks still get enough space and a durable URL.
- Alternatives considered: Navigating every create action to a full page; using inline forms inside tables.
- Impact: Product creation opens from the service inventory in a native dialog, while product editing continues to use the Product Workspace. Future features follow `ux-development-standard.md`.

### Separate Product Material Assignments From Actual Stock Movements

- Decision: Inventory materials hold current stock and an immutable movement ledger. Products define only which materials they may use; quantities and actual consumption belong to job orders and their job-linked inventory movements.
- Rationale: A product assignment is an eligibility rule, while page-based job usage is historical evidence. Keeping them separate prevents a generic product quantity from producing incorrect deductions.
- Alternatives considered: Storing only a current quantity; decrementing stock without movement history; copying inventory quantities directly onto products.
- Impact: Inventory adjustments are auditable, Product Workspaces own allowed material choices, and Job Order Workspaces can list actual usage. The writable job-order flow must calculate or capture quantities from its page details before creating movements.

### Require a Material Assignment When Creating a Product

- Decision: Every newly created product must select at least one active inventory material, without assigning a product-level quantity.
- Rationale: Products feed future job orders, so their allowed material choices must exist from the start; consumption depends on each job order’s page count.
- Alternatives considered: Allowing products without material assignments; storing a generic per-product quantity.
- Impact: Both product creation interfaces validate the assignment list, and owners must register inventory materials before creating a product. Existing products remain editable for backward compatibility.

## 2026-08-23

### Treat Product Materials as an Allowed Set Only

- Decision: Product material assignments represent only the complete set of materials a product may use. A job order will let the owner choose the actual subset and calculate or enter quantities from its page details.
- Rationale: Printing products can use different paper, ink, or finishing materials per job. The product should constrain valid choices without incorrectly claiming every assigned option was consumed every time.
- Alternatives considered: Treating every product material as automatically consumed for every job order; allowing job orders to choose any inventory material regardless of the product.
- Impact: Product forms use a quantity-free checkbox multi-select. Product material requirements were renamed to assignments and their quantity column was removed with a data-preserving migration. Future job-order creation must filter materials by the selected product and own all deduction quantities.

### Separate Job Planning From Inventory Deduction

- Status: Refined on 2026-08-27 by “Remove Print Sides From Job Creation.”

- Decision: Owners can create manual job orders with one or more product lines, page/copy/side details, and planned material quantities. Creating the order does not change inventory; stock is deducted only after explicit owner confirmation through Record usage.
- Rationale: Planned work may change before production, while the inventory ledger must represent materials actually issued to a specific job.
- Alternatives considered: Deducting planned quantities immediately on creation; waiting for quotation acceptance before allowing any manual order.
- Impact: Job-order materials are limited to the selected product's assignments, usage is committed atomically, and every deduction is linked to both the job order and product. Quotation conversion can be added later without blocking walk-in/manual orders.

### Keep Customers Optional for Manual Job Orders

- Decision: A manually created job order may optionally link a saved customer; orders without one are identified as walk-in orders.
- Rationale: Day-to-day production should not require creating a customer record for anonymous or one-time work.
- Alternatives considered: Requiring every order to own a customer record; automatically creating a shared placeholder customer.
- Impact: `job_orders.customer_id` is nullable, while quotations continue to require customers. Lists and workspaces use a clear Walk-in fallback instead of fabricating a customer.

### Prioritize Production Inputs in Job Creation

- Status: Refined on 2026-08-27 by “Remove Print Sides From Job Creation.”

- Decision: The New Job Order modal starts with product, output quantity, print-side setup, and material selection. Optional customer, deadline, total, and notes follow at the bottom.
- Rationale: The owner’s primary task is defining what the shop must produce; administrative and commercial context should not delay that work.
- Impact: Initial focus and keyboard order begin on the first product selector, and secondary order details remain available before submission.

### Use Visible Product Cards for Job Selection

- Decision: Products in the New Job Order modal are selected from a responsive card pane instead of a dropdown.
- Rationale: Product identity, parent service, material options, and variants are easier to scan before configuring production.
- Impact: Cards retain native radio-group keyboard behavior, a clear selected state, and focused validation while collapsing to one column on narrow screens. Each order line has a compact single-row search control for product, service, or variant without clearing or hiding its current selection.

### Calculate and Snapshot Job-Order Prices in Philippine Pesos

- Decision: A product has a base price per billable page/unit, and each optional named variant contributes a positive or negative per-unit adjustment. The server calculates each job line as `(base price + variant adjustment) × pages per copy × copies`, rounds the result to two decimals, and stores the unit price and line total used at creation. All commercial values display as Philippine pesos.
- Rationale: Owners need fast pricing for options such as Back-to-back, while completed orders must retain the price originally charged even after catalog pricing changes.
- Alternatives considered: Owner-entered order totals; recalculating historical orders from current product prices; percentage-only variants.
- Impact: New job orders show live line and order totals, clients no longer submit authoritative totals, and catalog edits do not rewrite historical order pricing. Quotation-specific approval and pricing rules remain separate work.

### Manage Reusable Variants at the Service Level

- Status: Superseded on 2026-08-23 by “Use One Global Variant Library Across Services.”

- Decision: Variant identity and description belong to the parent service, while each product chooses which service variants it supports and owns the corresponding price adjustment.
- Rationale: Options such as Back-to-back should be named once and reused consistently across related products, but their additional cost can differ by product.
- Alternatives considered: Re-entering free-text variants on every product; applying one service-wide price adjustment to every product.
- Impact: Services have a dedicated Variants workspace, product forms use reusable checkbox assignments, and job orders continue to snapshot the selected variant label and calculated price. Existing product variants are converted into service variants by migration.

### Use One Global Variant Library Across Services

- Decision: Variant identity and description belong to one catalog-wide library under the main Services page. Products in any service may assign a global variant and retain their own price adjustment.
- Rationale: Options such as Back-to-back can apply consistently across several services, while product costs can still differ.
- Alternatives considered: Duplicating the same variant within every service; keeping variants embedded as free text on products.
- Impact: `/product-catalog/variants` manages the library, service workspaces remain product-only, and migration merges same-named service variants case-insensitively while preserving product links and adjustments.

### Constrain Products to Two Print Types

- Decision: Every product has one required print type: `colored` or `black_and_white`, displayed as Colored and B&W (Black and white).
- Rationale: Staff need an explicit, consistent production distinction when browsing a service or choosing a job-order product.
- Alternatives considered: Free-text product types; treating color as a pricing variant.
- Impact: Product create/edit forms enforce the two choices, service lists and job-order cards display the type, and existing products migrate to B&W for safe manual review.

## 2026-08-24

### Start Document Analysis With Deterministic Local Processing

- Decision: Phase 1 analyzes PDF, PNG/JPEG/TIFF/BMP/WebP, DOCX, XLSX, and PPTX files locally in memory, with a 25 MB limit and no file retention. It normalizes print metadata and applies owner-configurable per-page rates for A3, A4, Letter, Legal, and fallback paper sizes split by B&W or color.
- Rationale: The owner needs fast, auditable preflight and pricing without depending on an AI service or introducing document-storage risk before job-order attachment rules exist.
- Alternatives considered: Uploading documents to an AI provider immediately; persisting every upload; hard-coding prices in the analyzer.
- Impact: Operations has a standalone Document Analyzer, Settings owns the rate matrix, and analyzer/pricing boundaries can later support OCR, AI recommendations, job-order attachment, and export without replacing the deterministic core.

### Let Products Override Document-Analyzer Rates Like Global Variants

- Status: Partially superseded the same day by "Tie Document Pricing to Real Paper Stock" (paper sizes) and "Tie Product Document Overrides to the Product's Own Print Type" (the print-type axis below).
- Decision: `DocumentPricingRule` stays the global default per-page rate matrix (paper size × print type). A new `ProductDocumentRate` join lets a product override specific combinations, mirroring how `Variant`/`ProductVariant` already work: one global reusable definition, an optional per-product override. The Document Analyzer gained an optional product picker; analyzing against a product resolves each rate as product override → exact paper-size global rate → `Unknown` fallback rate, and the response echoes which product priced the result.
- Rationale: The owner wants document pricing to vary by the product an order references, using the same pattern already proven for variants, without giving up the existing paper-size-based rate matrix.
- Alternatives considered: A single flat override price per product (loses the paper-size dimension the owner explicitly wanted kept); restricting overrides to only the product's own declared print type (rejected at the time — the analyzer measures actual page color content, which can include the opposite type even on a nominally single-type product; reversed below once the product's price itself became derived from this mechanism).
- Impact: `services/api/app/db/models.py` (`ProductDocumentRate`), product schemas/router accept `documentRates` the same way they accept `variants`, and `PricingEngine`/`PricingBreakdownItem` track a `rateSource` (`product`/`paperSize`/`fallback`) instead of a single fallback flag.

### Consolidate Catalog Configuration Under a New Configuration Page

- Decision: Added a Configuration page, pinned in the nav next to Settings, that owns Global variants (moved from `/product-catalog/variants` to `/configuration/variants`) and Document analyzer pricing (moved out of Settings). The old variants route redirects; Settings keeps a short pointer card instead of embedding the pricing grid.
- Rationale: Both were catalog-wide configuration the owner reaches for while managing products and pricing, not day-to-day service management or business-profile administration — grouping them stops configuration from being split across two unrelated pages.
- Alternatives considered: Leaving variants under Services and pricing under Settings; duplicating the controls in both old and new locations instead of moving them.
- Impact: `apps/web/src/pages/ConfigurationPage.tsx` is the new hub; `ServiceVariantsWorkspace` and `DocumentPricingSettings` are unchanged components, only their route and entry points moved.

### Tie Document Pricing to Real Paper Stock

- Decision: `DocumentPricingRule` no longer stores a free `paper_size` string. It now has a required `inventory_item_id` FK, and the paper size it represents is read live from that `InventoryItem`'s new `paper_size` tag — a closed three-value enum (A4, Letter, Legal). `Unknown`/fallback pricing and A3 are removed outright: the shop doesn't stock A3, and "Unknown" was never a real size. Rules are no longer seeded from a fixed list; `ensure_defaults` creates a rule per print type for every active, paper-tagged inventory item, starting at ₱0 for the owner to configure. At most one active item may hold a given size at a time.
- Rationale: The owner wants paper sizes in document pricing to mean something concrete — an actual stocked material — rather than an arbitrary label untethered from Inventory, and wants the configurable set limited to what the shop actually stocks.
- Alternatives considered: Keeping the fixed five-size list and just hiding A3/Unknown in the UI (rejected — the owner asked for the sizes themselves to be tied to inventory, not merely display-filtered); auto-seeding "A4"/"Letter"/"Legal" inventory items automatically (rejected — this app never invents business/inventory data on the owner's behalf; the owner tags their own items).
- Impact: `InventoryItem.paper_size`, `DocumentPricingRule.inventory_item_id`, migration `e2c7a1f4b6d8`. The Document Analyzer's rate resolution drops its fallback tier entirely (`rateSource` is now `product`/`paperSize` only). The pricing grid in Configuration is empty until the owner tags an inventory item, with an explicit empty state linking to Inventory.

### Tie Product Document Overrides to the Product's Own Print Type

- Decision: A product's document-pricing override list only ever shows and accepts rates matching its own required Print Type (Colored or B&W) — never both. The API rejects (422) an override whose rule print type doesn't match the product's.
- Rationale: Every product already declares one Print Type; asking it to also configure both a Colored and a B&W rate was redundant information the product itself can't act on.
- Alternatives considered: Keeping both print-type columns per product (the original 2026-08-24 decision, reversed here) — rejected once the product's own price became derived from this override list, at which point a mismatched-type override would be meaningless.
- Impact: `ProductDocumentRateSelector` takes a `printType` prop and renders one column (up to three paper-size rows) instead of a two-column grid; `_clean_document_rates` validates the match server-side.

### Replace Product Base Price With a Computed Reference Price

- Status: Superseded on 2026-08-27 by “Price Products and Job Lines From Their Paper Materials.”

- Decision: `Product.base_price` is removed. A product's price is now computed as the Letter-size document-pricing rate for its own print type (its own override if set, else the global rate, else ₱0), plus any variant adjustment. Letter is the assumed default document size — there is no per-order paper-size picker anywhere yet. This one computed number (`pricePerPage`) replaces every prior use of `basePrice`: job-order line pricing, the product catalog list, and job-order product cards/variant options.
- Rationale: The owner wants a product's price to come entirely from its configured document-pricing rate rather than a separate, disconnected manually-typed number, now that document pricing is itself tied to real paper stock and print type.
- Alternatives considered: Requiring every product to pick one paper size explicitly (rejected — Letter-as-default plus the existing override list already gives every product a well-defined price without a new required field); adding a paper-size picker to Job Order line items so any of a product's configured sizes could apply per order (deferred — no such picker exists yet anywhere in the app; can be added later without changing this computation's shape).
- Impact: New `services/api/app/services/product_pricing.py::reference_price_per_page`, used by both `routers/products.py` (`ProductRead.price_per_page`, and the create/update negative-price guard) and `routers/job_orders.py` (line pricing). No job orders existed yet in practice, so there was no historical pricing data to preserve.

### Let a Material Be Deleted Even With Stock Movement History

- Status: Refines the same-day decision below — mere movement history (e.g. a stray opening balance or test adjustment) no longer blocks deletion, only real independent records still do.
- Decision: Deleting an inventory item is blocked (409) only when it's assigned to a product, used in a job order's material plan, or referenced by a document-pricing rule. Its own stock-movement log is no longer a blocker — it's deleted along with the item.
- Rationale: The owner hit this in practice on a test material that had no product/job-order/pricing dependency, only some adjustment history from trying out the stock-adjustment flow — forcing deactivation in that case protects nothing real. The remaining three guards are the ones that would actually corrupt another record (a product's material list, a job order's material plan, a pricing rule) if the item vanished out from under them.
- Alternatives considered: Keeping the original movement-history guard (rejected — the owner explicitly asked for materials like this to be deletable, and a lone item's own movement log isn't a record anything else depends on, unlike the three guards that remain).
- Impact: `services/api/app/routers/inventory.py::delete_inventory_item` drops the `item.movements` check; `InventoryItem.movements`'s existing `cascade="all, delete-orphan"` now actually fires. `DeleteInventoryItemModal` copy now warns that the item's movement history is deleted with it.

## 2026-08-27

### Treat Canon PRINT as a Companion, Not the Printing API

- Decision: On the owner's Windows workstation, Canon PRINT remains available for Canon setup, scanning, ink information, and maintenance. Printing-MS connects through the Windows printer queue created for that device, using the same queue adapter for Canon and other manufacturers.
- Rationale: Canon PRINT exposes a user-facing desktop workflow, while the Windows spooler is the stable system boundary for applications that print. This preserves Canon functionality without coupling Printing-MS to an undocumented app-to-app API.
- Alternatives considered: Automating the Canon PRINT desktop UI; building directly against a Canon-only SDK; requiring a different integration per printer manufacturer.
- Impact: Print Center opens Windows Printers & scanners, explains the three-step Canon setup flow, and discovers queues through `Win32_Printer`. macOS/Linux continue through CUPS. Actual print submission and capability negotiation remain separate work.

### Auto-Detect the Printer Host Platform With an Explicit Override

- Decision: Printer integration resolves the host as Windows, macOS, or Linux from the backend runtime by default. `PRINT_MS_PRINTER_PLATFORM` may explicitly select `windows`, `macos`, or `linux`; `auto` remains the recommended value.
- Rationale: Normal installations should require no OS configuration, while packaging tests and controlled deployments still need a deterministic adapter override.
- Impact: `/printers/platform` exposes the resolved platform, configured value, detection source, and adapter. Print Center displays this state and derives platform-specific guidance from it.

### Price Products and Job Lines From Their Paper Materials

- Decision: A product's catalog reference is the lowest active rate among its assigned paper materials for its print type. During job creation, the exact selected paper material determines the line rate; a line may select only one priced paper material, and a second paper size requires a second line. Product overrides continue to take precedence over global rates.
- Rationale: The prior Letter-only assumption ignored configured A4 and Legal prices and could show or snapshot an incorrect amount even when the job explicitly selected a different material.
- Alternatives considered: Continue using Letter as an implicit default; silently choose the first or cheapest material selected on a multi-paper job line.
- Impact: Product forms, catalog reads, job-order previews, and authoritative server calculations resolve through material-linked pricing rules. Existing completed job-order snapshots remain unchanged.

### Configure Paper Assignment and Pricing Together

- Decision: Product forms use one paper-material row to assign the linked Inventory item and choose either its global rate or a product-specific override. The separate Assigned materials editor is replaced by a read-only summary on the right. Non-paper supplies remain editable under Other materials because they have no document-pricing relationship.
- Rationale: `DocumentPricingRule.inventory_item_id` already identifies the real paper material, so selecting the same paper again in a generic material list was redundant and made inconsistent setup possible.
- Alternatives considered: Infer every globally priced paper as assigned to every product; remove non-paper product assignments entirely.
- Impact: The existing API and database relationships remain unchanged. Product creation/editing now keeps paper assignments and overrides synchronized in one interaction, while job orders still receive the complete allowed material set.

### Select Configured Paper Size During Job Creation

- Decision: After choosing a product, the owner selects exactly one of that product's configured paper sizes. The linked Inventory material is added to the plan automatically, while only non-paper supplies remain separately selectable.
- Rationale: Paper identity, availability, and pricing are already one configured relationship; asking the owner to select the same paper again as a generic material is redundant and can produce a mismatched price.
- Alternatives considered: Keep paper checkboxes in Materials to use; silently choose the product's lowest-priced paper.
- Impact: Changing the size immediately changes the live product/variant price. The API requires a configured paper selection when the product has paper options and snapshots the same authoritative rate.

### Remove Print Sides From Job Creation

- Decision: The owner no longer selects Print sides when creating a job. Paper planning uses pages × copies, while production options such as Back-to-back remain product variants.
- Rationale: Print sides duplicated an existing variant choice and added a production input the owner does not need in this flow.
- Alternatives considered: Infer sides from a variant label; remove the database field and migrate historical records.
- Impact: New-job requests omit `printSides` and use the API's existing single-sided default internally for compatibility. Historical records and API clients remain valid.

### Keep Document Preview Local and Beside Analysis

- Status: Refined on 2026-08-27 by “Render PDFs With a Dedicated Local Viewer.”

- Decision: The analyzed source appears in a left preview pane and the complete analysis appears in a right pane. PDF and browser-supported images use a temporary local object URL; unsupported document formats show a clear fallback instead of uploading or fabricating a rendering.
- Rationale: Operators need to compare the source and results without switching context, while the analyzer's in-memory privacy boundary must remain intact.
- Alternatives considered: Put the preview above the results; send Office files to an external preview service; imply a visual preview when the runtime cannot render one.
- Impact: Desktop results use two balanced, independently contained panes and stack preview-first on narrower screens. Object URLs are revoked when the source changes or the result closes.

### Render PDFs With a Dedicated Local Viewer

- Status: Refined on 2026-08-27 by “Use a Full-Pane Continuous PDF Workspace.”

- Decision: Use a lazy-loaded PDF.js worker and high-DPI canvas renderer for PDF previews instead of delegating rendering to a browser iframe.
- Rationale: The iframe could be blank in the Electron/browser runtime and provided inconsistent controls. The operator needs predictable local navigation and viewing tools.
- Alternatives considered: Keep the native iframe/embed; open PDFs in a separate system viewer; upload them to a hosted preview service.
- Impact: PDF previews now support page navigation, direct page entry, zoom, fit-to-width, rotation, download, keyboard shortcuts, retry, and actionable load/render failures. The viewer bundle loads only when a PDF result is open.

### Use a Full-Pane Continuous PDF Workspace

- Decision: Once analysis succeeds, remove the standard page header, let the preview/results split fill the entire available app content pane, and show every PDF page in one vertically scrollable document instead of paginating it.
- Rationale: Operators need the source to be larger and should be able to scan page boundaries naturally without repeatedly using previous/next controls.
- Alternatives considered: Keep the centered content-width limit; add a separate fullscreen mode; retain page-at-a-time navigation.
- Impact: The preview and results panes independently fill and scroll on desktop, while narrow layouts still stack. PDF pages are labeled and rendered ahead of the scroll position to balance continuous reading with memory and rendering cost.

### Align Product-Selected Analysis With Product Pricing

- Status: Refined on 2026-08-29 by “Keep Detected Paper Size Advisory in Transactions.”

- Decision: When a product is selected in Document Analyzer, price every page using the product's configured print type and only an active pricing rule tied to one of its assigned paper materials. Resolve product override first, then the global rate for the detected size. Generic analysis continues to price detected color and B&W pages separately.
- Rationale: Product and job-order pricing already define the requested output mode; using detected source color as the billing mode could ignore a valid product configuration and return ₱0.
- Impact: Analyzer estimates now match catalog and job-order pricing while still reporting detected color separation as analysis metadata.

### Configure Runtime Stage and SQLite Path Through Environment

- Decision: `PRINT_MS_STAGE` selects one of three independently configured paths: `PRINT_MS_DEVELOPMENT_DATABASE_PATH`, `PRINT_MS_TEST_DATABASE_PATH`, or `PRINT_MS_PRODUCTION_DATABASE_PATH`. Relative paths resolve from `services/api`; the older `PRINT_MS_DATABASE_PATH` remains an active-stage compatibility override. Settings exposes every resolved path but does not switch a live database.
- Rationale: Development and production must never share an implicit database, while test runs need a third disposable data boundary. Applying the stage only at startup avoids changing SQLAlchemy connections while the application is running.
- Impact: `services/api/.env.example` scaffolds all stages. Operators change `PRINT_MS_STAGE` and restart, and Settings marks the active database plus the source of every path.

### Remove the Separate Production Page

- Decision: Remove Production from primary navigation and routing. Production status remains part of Job Orders, individual job workspaces, and Overview rather than a duplicate board.
- Rationale: The separate page duplicated operational status already carried by the job-order workflow.
- Impact: `/production` now follows the catch-all redirect to Overview, and the page implementation is removed.

### Price Analysis From Measured Coverage and Product Options

Status: Refined on 2026-08-29 by “Treat the Configured B&W Rate as an All-Inclusive Per-Page Price.” Coverage-based adjustments now apply only to colored products.

- Decision: Document Analyzer requires a selected product in the UI and optionally accepts one of that product's variants. The estimate is the exact paper-size product rate × pages, plus ink load as the same percentage of the base subtotal, plus a color premium proportional to measured color coverage using the configured colored-rate difference, plus the variant adjustment × pages.
- Rationale: A flat per-page total ignored how much printable content was actually present and could not represent configured finishing/production variants.
- Alternatives considered: Fixed undocumented coverage bands; treating every page containing any color as a full-color page; inferring variants from their labels.
- Impact: PDF pages are rasterized locally with PyMuPDF so text, vectors, and images all contribute to color/ink coverage. Images use direct pixel analysis; Office formats retain conservative, clearly warned estimates because they are not natively rendered.

### Remove Quotations From the Active UI

- Decision: Remove Quotations navigation, list/detail routes, status surfaces, overview metric, customer counts, and Settings controls. Document Analyzer provides the operator's suggested price before a Job Order is created.
- Rationale: The owner does not use a separate quotation workflow and identified it as redundant with document analysis.
- Impact: Legacy quotation database models and APIs remain untouched to avoid destructive data loss, but `/quotations` now redirects through the renderer catch-all.

## Template

### Decision Title

- Date:
- Decision:
- Rationale:
- Alternatives considered:
- Impact:
## 2026-08-28

### Gate Printing Behind Verified Payment and Explicit Production Transitions

- Decision: Use the owner-controlled lifecycle Pending Payment → Paid → Queued → Printing → Quality Check → Ready → Completed. Full verified payment unlocks queueing; a successful OS queue handoff unlocks Printing; physical completion and quality outcomes remain explicit owner confirmations.
- Rationale: Financial approval, OS submission, and physical print completion are different facts and must not be inferred from one another. Failed OS attempts need an audit record without incorrectly advancing production.
- Impact: Job workspaces record payments and expose only the valid next action. Print Center submits staged files through the selected OS queue and retains successful/failed attempts. Windows renders through `PrintDocument`; CUPS uses `lp`. Advanced capability discovery and OS completion polling remain future work.

### Persist Only Owner-Confirmed Analyzed Transactions

- Decision: New transaction analysis is temporary. The system creates the job order and retains its uploaded file only when the owner explicitly proceeds after choosing the engine recommendation or a custom final price.
- Rationale: Cancelling a recommendation should not create abandoned job orders or orphan customer files, while confirmed pricing needs an auditable engine suggestion and final value.
- Impact: The creation wizard handles one uploaded file and one product per transaction, the server re-analyzes on confirmation, stores both suggested and final totals, automatically plans the owner-selected paper, and routes the saved job to Print Center.

### Render Windows Print Files Inside Printing-MS

- Decision: Replace Windows shell `PrintTo` submission with local 300-DPI PDF/image rendering and `System.Drawing.Printing.PrintDocument` output to the selected installed queue. Canon PRINT remains available for device setup, scanning, ink checks, and maintenance; Printing-MS does not automate its UI.
- Rationale: The shell verb requires another desktop application to own the file type and implement `PrintTo`, which caused valid PDFs to fail before reaching the Canon queue. Windows `PrintDocument` accepts page graphics, printer name, copies, color, and supported paper size without that file association.
- Impact: PDF and image jobs use the Canon or other Windows driver directly, selected options are applied by Printing-MS, temporary page renders are deleted after submission, Office files require export to PDF until a local Office conversion layer exists, and physical Canon output still requires workstation validation.

### Persist the Analyzer Print Profile and Deduct Plans on Queue Acceptance

- Status: Refined on 2026-08-29 by “Apply Standard Job Settings Through the Installed Printer Driver” and “Separate Commercial Print Type From Physical Output.”

- Decision: Persist page count, detected best-fit paper, orientation, color/B&W pages, coverage, print-time estimate, and confidence on each confirmed print-ready file. Print Center displays an automatic read-only profile; the API derives authoritative copies and product output mode, while printer media comes from the owner-selected paper plan. After a printer accepts the file, deduct every remaining planned material and create job-linked inventory movements in the same database commit.
- Rationale: Re-entering detected settings can make printing disagree with pricing and paper planning. Queue acceptance is the first reliable application event indicating production has started, while job creation and failed print attempts have not used stock.
- Alternatives considered: Deduct at job creation; deduct only at completion; continue requiring a separate manual usage modal.
- Impact: Insufficient stock blocks submission before the printer is called, failures do not change inventory, retries cannot double-deduct because only each plan's remainder is consumed, and legacy/manual remaining usage stays available as a recovery path. Physical printer failures after queue acceptance may require a normal stock adjustment.

## 2026-08-29

### Treat the Configured B&W Rate as an All-Inclusive Per-Page Price

- Decision: For a selected B&W product at A4, Letter, or Legal size, calculate `configured rate × detected pages`. Do not add measured ink-load or detected-color premiums; add only a variant the owner explicitly selected. Copies continue multiplying the resulting per-copy total in the transaction workflow.
- Rationale: The owner configures each B&W rate to already cover both paper and ink. Charging coverage again duplicates those costs, and source color is irrelevant to this commercial price calculation even though physical printing may preserve detected source color.
- Impact: Analyzer coverage remains visible for production and physical-output decisions, but it cannot change a B&W recommendation. Colored-product coverage pricing remains unchanged, and historical job-order price snapshots are not rewritten.

### Store Print Types as App-Managed Pricing Definitions

- Status: Refined on 2026-08-29 by “Separate Commercial Print Type From Physical Output”; the catalog's color-mode field remains compatibility metadata and no longer drives print rendering.

- Decision: Replace the fixed product/pricing enums with a `print_types` catalog. Each type owns an immutable key, operator label, printer color mode, active state, ordering, and whether measured ink coverage adjusts its base rate. Seed B&W, Semi-colored, and Colored; allow owners to add more from Configuration.
- Rationale: A third enum value would solve Semi-colored once but repeat backend, migration, and renderer work for every future type. One shared definition keeps pricing columns, product choices, analyzer behavior, and printer output aligned.
- Impact: Semi-colored uses color output and coverage-based ink pricing by default. Active catalog entries automatically receive a rate for every stocked paper material and appear in product forms. Existing B&W/Colored keys and historical product references are preserved by migration.

### Keep Detected Paper Size Advisory in Transactions

- Decision: Treat analyzed paper size as a best-fit recommendation only. Require the owner to choose one active paper material configured for the product, and use that selection for pricing, material planning, inventory deduction, and printer media.
- Rationale: Source dimensions help the owner make a decision but cannot know the intended output stock, scaling, or customer request. Blocking on an exact detected-size match prevents valid work.
- Impact: A size mismatch is shown as non-blocking awareness. The detected size remains durable file evidence, while the selected paper is authoritative for the transaction and print submission.

### Apply Standard Job Settings Through the Installed Printer Driver

- Status: Refined on 2026-08-29 by “Separate Commercial Print Type From Physical Output.”

- Decision: Keep paper, copies, and color mode aligned with the approved transaction, while allowing the owner to choose orientation, scaling, quality, borderless behavior, and collation for each print attempt. Apply those settings through Windows `PrintDocument` or standard CUPS options and retain them in Print History. Open the selected Windows driver's native preferences for Canon-specific media type, tray, and advanced controls.
- Rationale: Canon and other vendors expose private driver settings that cannot be safely duplicated as fixed app values. The installed OS driver is the supported boundary, while common print-job controls can be applied consistently and audited by Printing-MS.
- Impact: Canon PRINT remains the setup/maintenance companion. A borderless request fails clearly when the active driver/paper does not expose borderless output, and future capability discovery can narrow options without changing the print-attempt contract.

### Keep the Entire Transaction Lifecycle on the Job Order Page

- Decision: After analysis confirmation, open the created job order rather than Print Center. Keep payment, queue confirmation, printer/output setup, quality review, ready, and completion actions in focused modals over one compact job workspace.
- Rationale: Sending the owner between Job Orders and Print Center obscured the next step and duplicated job details across operational pages. One command page keeps the transaction context stable while modals isolate each short decision.
- Impact: The job workspace shows only the lifecycle command panel, transaction essentials, production proof, and a collapsed audit section. Print Center remains available for device discovery and standalone queue administration, but it is no longer required to complete a job.

### Default Physical Output From the Product but Allow an Owner Override

- Status: Superseded by “Separate Commercial Print Type From Physical Output.”

- Decision: Color/grayscale starts from the selected product's print type, but the owner may deliberately change it for a single print attempt. Paper and copies remain locked to the approved transaction. Canon-specific media, source, and color-correction settings are delegated to the installed Windows Canon driver; Printing-MS does not automate the Canon PRINT/Inkjet Smart Connect UI because it has no documented direct job-handoff API.
- Rationale: Product configuration should provide the safe default, while an owner must still be able to correct the physical output before printing. Sending RGB or grayscale data explicitly prevents an accidental B&W render from becoming irreversible before the driver receives it.
- Impact: Print setup shows the configured default and an audited output selector. An override changes only the physical attempt and does not silently recalculate the approved transaction price.

### Separate Commercial Print Type From Physical Output

- Decision: B&W, Semi-colored, Colored, and owner-added print types affect pricing and workflow only. At submission, derive physical color mode from the retained document analysis: preserve RGB if any color was detected or analysis is unknown, and render grayscale only for a confidently monochrome file. Default orientation follows each page, fitting respects the selected driver's printable area, and quality remains driver-managed. Borderless is never inferred silently because it depends on supported paper/media and enlarges/crops the source.
- Rationale: A B&W price category must not destroy real color in an uploaded file. The analyzer has the evidence required to preserve source intent, while device-specific ink selection, color correction, hard margins, and supported media belong to the installed driver/printer.
- Impact: Print setup displays a read-only automatic document profile instead of a product-based color selector. Owners may still explicitly override orientation, scaling, quality, or force borderless output when production intent requires it; pricing snapshots remain unchanged.

### Preserve Source Geometry Within the Driver Printable Area

- Decision: Default print scaling to automatic: retain the rendered document's physical dimensions and margins when they fit, and only shrink proportionally when the selected driver's printable area requires it. On Windows, treat the `PrintPage` graphics origin as the printable-area origin and do not add `HardMarginX/Y` again.
- Rationale: The Windows GDI surface already accounts for the device's non-printable origin. Applying that offset a second time made Printing-MS output smaller and more inset than the same document printed through Canon PRINT.
- Impact: Existing explicit Fit, Fill, and Actual size choices remain available. New print attempts use Automatic, and physical Canon validation remains required because printable bounds vary by driver, paper type, and printer model.

### Treat the Windows Spooler as the External Print Audit Boundary

- Decision: While Printing-MS is running on Windows, observe `Win32_PrintJob`, persist jobs submitted by any Windows application, and show non-Printing-MS records in a separate External / Unlinked Print Center pane. Tag Printing-MS document names with the internal attempt ID so their spooler identifier can be reconciled without creating a duplicate external record. Treat a job disappearing from the spooler as released, not physically completed.
- Rationale: Canon PRINT exposes no shared event SDK, but both it and ordinary Windows applications use the OS queue for computer-submitted jobs. The spooler does not expose the originating application or prove that paper exited the printer, so stronger attribution would be misleading.
- Impact: Canon PRINT jobs are retained when they pass through Windows while the app is open. Direct printer-panel, USB-host, and mobile/cloud jobs remain outside this boundary; device telemetry may detect anonymous activity but cannot reconstruct their document or owner.

### Require Owner Confirmation and Source Re-upload for External Print Intake

- Decision: Surface each unreviewed external Windows spooler record through a non-blocking app prompt. Allow dismissal or job creation, but require the original source file to be uploaded and analyzed before linking the observation to a newly approved job order.
- Rationale: `Win32_PrintJob` provides transient metadata, not a trustworthy reusable source file. Creating a complete commercial transaction directly from spooler metadata would fabricate preview, pricing, and material evidence.
- Impact: The owner gets timely intake awareness without being interrupted. Dismissed observations remain visible in Print Center, approved jobs gain a durable one-to-one link, and cancelled creation leaves the observation unlinked.

### Model Back-to-Back as a Supervised Variant Behavior

- Decision: Add an explicit `requires_manual_duplex` behavior to reusable variants and snapshot it on each job item. On Windows, submit odd front pages first, pause for owner-confirmed Canon-style reinsertion, then submit reverse even pages. Keep the job queued and inventory untouched between passes; only the successful back pass advances production and deducts planned materials.
- Rationale: Inferring production behavior from the text “Back-to-Back” is fragile, while one opaque printer submission cannot tell Printing-MS whether the owner actually reloaded the stack correctly. Durable pass records allow cancellation, reopening, retry, and audit without losing the physical checkpoint.
- Impact: Existing Back-to-Back, Double-sided, and Manual duplex labels are marked during migration. New variants opt in through Configuration. Paper planning uses physical sheets, both passes must use the same printer/file/profile, and Print Center delegates these jobs to the supervised job modal. The current stack sequence is Windows-only pending equivalent CUPS validation.

### Separate Durable Job Identity From the Owner-Facing Sequence

- Decision: Keep UUIDs as database and route identities, while allocating owner-facing job references from an atomic, non-reusing 10-digit sequence (`JOB-0000000001`). Preserve the configurable prefix.
- Rationale: Counting existing rows can reuse a number after deletion and race during simultaneous creation. A transactional sequence safely covers billions of transactions without exposing implementation identities.
- Impact: Existing references remain unchanged; only newly created jobs use the wider format. Prefix changes do not reset the global sequence.

### Treat Spooler Release as a Global Attention Event

- Decision: Track all queued and printing orders globally. Persist the Windows spooler's internal attempt state and page counts, then change a released, paused, or failed attempt into an owner-attention item that links to the job. Remove it when the owner advances the job beyond printing.
- Rationale: The OS queue supports concurrent submissions, but route-local status hides active work. Spooler disappearance confirms handoff only, so automatic physical completion or quality approval would be inaccurate.
- Impact: Owners can create and submit more work while another job prints, inspect the queue from any page, and return directly to the required reinsertion, recovery, or quality-check step.

### Use a Human Job Name Without Replacing the Durable Reference

- Decision: Require a short owner-friendly name on every new job, prefilled from the uploaded filename and editable before analysis. Show it as the primary operational label while keeping the `JOB-…` number visible as secondary metadata.
- Rationale: Staff recognize “Reyes thesis copies” faster than a long numeric sequence, but accounting, audit history, links, and integrations still need a stable non-ambiguous reference.
- Impact: Names may repeat and can describe the work naturally. Job numbers remain unique, non-reusing, and unchanged; internal routes continue using UUIDs. Existing rows receive their retained filename as the initial name when possible.

### Route Job Intake by Service Category

- Decision: Persist a service workflow category: Printing, Photocopy, or Custom. Choose the service before opening job creation. Printing retains file analysis; Photocopy records device-side page/copy inputs without a file; Custom has no implied workflow until one is implemented.
- Rationale: Requirements differ by how work is physically produced. Asking for a document during photocopy creates false evidence, while treating arbitrary custom services as printing would silently impose the wrong process.
- Impact: Existing services migrate as Printing. Photocopy B&W pricing is product-specific per paper, color may use global pricing, paper deducts when the completed device-side transaction is recorded, and the job begins Ready for payment.

### Model Scan and Photocopy as Product Operations in One Service

- Decision: Present the built-in category as Scan or Photocopy, then persist the specific operation on products and snapshot it on job lines. Photocopy retains paper-based configuration; Scan uses one standalone per-page rate, no inventory, and a retained scanner output.
- Rationale: Both operations originate at the multifunction printer, but their inputs, costs, and deliverables differ. Treating scanning as printing would fabricate paper/ink usage, while relying on the current product value would let later catalog edits rewrite historical workflow meaning.
- Impact: Existing photocopy products and jobs migrate as Photocopy. Owners add Scan products in the same service, acquire or recover a scanner output during job creation, and can view or download the retained softcopy from the job workspace.

### Acquire Scans Through the Installed Windows WIA Driver

- Status: Refined on 2026-08-30 by “Keep Standard Scan Configuration Inside Printing-MS.”

- Decision: Start scanning from a narrowly scoped Electron IPC operation backed by Windows Image Acquisition. Let Printing-MS configure standard source, content, resolution, and capture-area properties, invoke WIA's transfer path, and return only captured page bytes to the renderer. Repeat acquisition for more pages, combine them server-side, and keep manual file import as recovery.
- Rationale: Canon documents the printer as usable from WIA-compliant Windows applications, while Canon PRINT does not expose a supported app-to-app acquisition handoff. WIA keeps Printing-MS vendor-neutral and makes the captured document available for preview, automatic page pricing, retention, and delivery.
- Impact: Direct acquisition is Windows-only and requires the installed scanner/MP driver. Scanner discovery and known WIA errors are structured, automatic source selection is retained, and sources without reliable original sensing require owner confirmation. Cancelling creates no page or job, multiple captures become one retained PDF, and physical Canon validation remains required.

### Keep Vendor Scanner Drivers as an Explicit Windows Prerequisite

- Decision: Distribute Printing-MS separately from vendor drivers. Document and check for WIA availability during setup; for the validated Canon workstation, the model-specific IJPAT/full MP/WIA package is required even when Canon PRINT can already scan.
- Rationale: Canon PRINT may use Canon-specific discovery while Printing-MS uses the Windows WIA boundary. Printer connectivity or success in Canon PRINT therefore does not prove that Windows has registered a scanner available to third-party applications.
- Impact: The Windows installer should provide a non-blocking prerequisite check and link to model-specific setup guidance, but must not silently redistribute or install Canon software. Release acceptance includes successful acquisition in Windows Scan and Printing-MS.

## 2026-08-30

### Normalize WIA Captures and Prefer Automatic Source Selection

- Status: Refined on 2026-08-30 by “Keep Standard Scan Configuration Inside Printing-MS.”

- Decision: Convert every WIA-acquired page to validated PNG before returning it to the renderer. In Automatic mode, select a WIA 2.0 feeder item when paper is reported and prefer the feeder when the driver cannot sense placement; expose explicit Feeder and Flatbed overrides. Require placement confirmation only when WIA cannot prove an original is loaded.
- Rationale: WIA 2.0 represents feeder and flatbed as separate item categories, so transferring the first item can silently choose the flatbed. Feeder readiness can report loaded paper, but flatbeds and some multifunction drivers cannot reliably sense an original; the application must not present connectivity as proof of placement.
- Impact: New captures preview consistently and usually choose a loaded feeder automatically. Operators can correct incomplete driver sensing without reopening Windows settings. Offline, jam, open-cover, unsupported source, and detected empty-feeder states block scanning with specific recovery guidance.

### Keep Standard Scan Configuration Inside Printing-MS

- Decision: Do not open WIA's `ShowSelectItems`/settings window for normal acquisition. Expose source, content type, 150/300/600 DPI, and standard document/photo capture areas in the Scan job modal, apply them through WIA item properties, and use `CommonDialog.ShowTransfer` only for hardware transfer/progress. If a driver rejects B&W text intent, retry acquisition in grayscale and disclose the applied mode.
- Rationale: The external dialog duplicated context already owned by the job workflow and interrupted the single-page transaction experience. WIA exposes the required standard controls programmatically, while the retained in-app result provides a better review/retry loop than a separate preview window.
- Impact: Automatic/Feeder/Flatbed source, Color/Grayscale/B&W text, 150/300/600 DPI, Automatic, A4, Letter, Legal, 4×6, 5×7, and 8×10 are configured inside Printing-MS. The settings selector stays closed, while standard transfer progress and durable in-app outcomes remain visible. Vendor-private controls remain outside the standard flow, and physical Canon validation is required before release.

### Keep Centralized Pricing Read-Only and Source-Linked

- Decision: Aggregate global document rates, product paper overrides, standalone scan rates, and variant adjustments in one Pricing Center, but edit each value only in its owning Configuration or Product workspace.
- Rationale: A second editable pricing surface would duplicate validation and make it unclear which value is authoritative. A read-only ledger provides complete commercial visibility while retaining one source of truth.
- Impact: Owners can search and filter all current pricing, identify custom or missing values, and navigate directly to the correct editor. Services remain workflow containers and do not gain a separate price field.

### Separate Transaction Checkout from Product Production

- Decision: A job order is one customer transaction containing product lines from any active service. The initially selected service scopes only the first line. Each line snapshots its operation and owns Queued/Printing/Ready status, files, printer attempts, materials, and rework; the parent owns the combined total, payment, and completion.
- Rationale: Customers commonly purchase printing, scanning, and photocopying together, but combining their device processes would erase required validation and progress. Conversely, separate orders would fragment a single counter payment.
- Impact: All product lines must be Ready before payment is accepted. Printing, Scan, and Photocopy retain their existing specialized modals/actions, while the workspace presents one payment breakdown and one final completion action.

### Preserve Consumption Across Quality Reprocessing and Cancellation

- Decision: Treat each failed-quality retry as a new product-level production cycle. Keep prior print attempts, scan history, status events, and consumed inventory; add one equivalent material allowance for a physical replacement and deduct it when that replacement is produced. Allow products to be appended only before the parent is Paid. Cancellation is transaction-level, requires a reason, and is allowed only before a verified payment or completion.
- Rationale: Rejected output still consumed paper and supplies, while only the affected product needs to run again. Reversing stock would understate real usage, and changing a paid transaction would make its combined receipt unreliable.
- Impact: Reprocess counts appear in the list and workspace. Cancelled transactions become immutable inside Printing-MS, but an already-submitted operating-system print may still require separate queue cancellation. Refund handling remains a prerequisite before cancelling a paid transaction.

### Scope Global Paper Pricing by Fixed Workflow

- Decision: Store global rates by `paper material × print type × workflow`, with fixed Printing and Photocopy scopes. Printing products resolve only from Printing; Photocopy products resolve only from the Scan or Photocopy table. Product-specific overrides remain attached to one rule in the matching scope. Scan pricing stays on the product and outside the material matrix.
- Rationale: Printing and photocopy may use the same stocked paper and print-type vocabulary while having different operating prices. One shared matrix allowed unrelated products to inherit the wrong commercial default. Scan has no paper/ink relationship, so placing it in either physical-output matrix would fabricate a material dependency.
- Impact: Existing global rates are copied into the new Photocopy scope during migration to preserve behavior; existing photocopy overrides are remapped to those copies. Owners may then change either workflow independently. New stocked paper and new print types receive entries in both physical-output tables.

### Use Production Panes as Process Launchers

- Decision: Let the owner open any product pane to reveal its current operation and controls, while requiring a separate explicit button for every status or inventory mutation.
- Rationale: The production board should behave like an operational workflow rather than a passive report, but a broad card click must not accidentally submit printing, deduct stock, or start reprocessing.
- Impact: Pointer users may open the whole pane, keyboard users receive a visible 44-pixel step control, only one pane stays open at a time, and paid, completed, or cancelled lines expose retained records without production controls.
