import { ChangeEvent, DragEvent, FormEvent, lazy, Suspense, useEffect, useId, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { Button } from "../../components/Button/Button";
import { LinkButton } from "../../components/Button/LinkButton";
import { Modal } from "../../components/Modal/Modal";
import { ApiError, api } from "../../lib/apiClient";
import { formatCurrency, formatFileSize, formatProductPrintType } from "../../lib/format";
import type {
  Customer,
  DocumentAnalysisResponse,
  InventoryItem,
  JobOrder,
  ObservedPrintJob,
  Product,
} from "../../types/domain";
import "../workspaceForm.css";
import "./JobOrderModals.css";

const MAX_FILE_SIZE = 25 * 1024 * 1024;
const ACCEPTED_EXTENSIONS = ["pdf", "png", "jpg", "jpeg", "tif", "tiff", "bmp", "webp", "docx", "xlsx", "pptx"];
const ACCEPT = ACCEPTED_EXTENSIONS.map((extension) => `.${extension}`).join(",");
const PdfViewer = lazy(() => import("../../components/PdfViewer/PdfViewer").then((module) => ({ default: module.PdfViewer })));

type MaterialLine = { inventoryItemId: string; plannedQuantity: number };
type Step = "file" | "configure" | "review";

interface TransactionForm {
  name: string;
  serviceName: string;
  productId: string;
  productSearch: string;
  variantId: string;
  paperInventoryItemId: string;
  copies: number;
  customerId: string;
  dueDate: string;
  notes: string;
  materials: MaterialLine[];
}

const blankForm = (): TransactionForm => ({
  name: "",
  serviceName: "",
  productId: "",
  productSearch: "",
  variantId: "",
  paperInventoryItemId: "",
  copies: 1,
  customerId: "",
  dueDate: "",
  notes: "",
  materials: [],
});

interface Props {
  open: boolean;
  customers: Customer[];
  products: Product[];
  inventoryItems: InventoryItem[];
  sourceSpoolerJobId?: string | null;
  sourceSpoolerJob?: ObservedPrintJob | null;
  onClose: () => void;
  onCreated: (order: JobOrder) => void;
}

export function JobOrderCreateModal({ open, customers, products, inventoryItems, sourceSpoolerJobId, sourceSpoolerJob, onClose, onCreated }: Props) {
  const fileInputId = useId();
  const [fileInputKey, setFileInputKey] = useState(0);
  const [step, setStep] = useState<Step>("file");
  const [form, setForm] = useState<TransactionForm>(blankForm);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<DocumentAnalysisResponse | null>(null);
  const [priceMode, setPriceMode] = useState<"suggested" | "custom">("suggested");
  const [customPrice, setCustomPrice] = useState("");

  const activeProducts = products.filter((product) => product.isActive);
  const services = [...new Set(activeProducts.map((product) => product.serviceName))].sort();
  const inventoryById = new Map(inventoryItems.map((item) => [item.id, item]));
  const selectedProduct = activeProducts.find((product) => product.id === form.productId);
  const assignments = selectedProduct?.materialAssignments
    .map((assignment) => inventoryById.get(assignment.inventoryItemId))
    .filter((item): item is InventoryItem => Boolean(item?.isActive)) ?? [];
  const paperAssignments = assignments.filter((item) => Boolean(item.paperSize));
  const otherAssignments = assignments.filter((item) => !item.paperSize);
  const selectedPaper = paperAssignments.find((item) => item.id === form.paperInventoryItemId);
  const recommendedTotal = analysis ? Math.round(analysis.pricing.suggestedPrice * form.copies * 100) / 100 : 0;
  const parsedCustomPrice = customPrice.trim() === "" ? null : Number(customPrice);
  const finalPrice = priceMode === "suggested" ? recommendedTotal : parsedCustomPrice;

  useEffect(() => {
    if (!open) return;
    setStep("file");
    setForm(blankForm());
    setFile(null);
    setSubmitted(false);
    setError(null);
    setAnalysis(null);
    setPriceMode("suggested");
    setCustomPrice("");
    setFileInputKey((current) => current + 1);
  }, [open]);

  function invalidateAnalysis(nextStep: Step = "configure") {
    setAnalysis(null);
    setStep(nextStep);
    setPriceMode("suggested");
    setCustomPrice("");
  }

  function chooseFile(candidate: File | null) {
    setError(null);
    invalidateAnalysis("file");
    if (!candidate) {
      setFile(null);
      return;
    }
    const extension = candidate.name.split(".").pop()?.toLowerCase() ?? "";
    if (!ACCEPTED_EXTENSIONS.includes(extension)) {
      setFile(null);
      setError("Choose a PDF, image, Word, Excel, or PowerPoint document.");
      return;
    }
    if (candidate.size === 0) {
      setFile(null);
      setError("Choose a non-empty document.");
      return;
    }
    if (candidate.size > MAX_FILE_SIZE) {
      setFile(null);
      setError("Documents must be 25 MB or smaller.");
      return;
    }
    setFile(candidate);
    setForm((current) => ({
      ...current,
      name: current.name.trim()
        ? current.name
        : (candidate.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim() || "Print job").slice(0, 100),
    }));
  }

  function handleFileInput(event: ChangeEvent<HTMLInputElement>) {
    chooseFile(event.target.files?.[0] ?? null);
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    chooseFile(event.dataTransfer.files?.[0] ?? null);
  }

  function selectProduct(productId: string) {
    setForm((current) => ({ ...current, productId, variantId: "", paperInventoryItemId: "", materials: [] }));
    invalidateAnalysis();
  }

  function toggleMaterial(item: InventoryItem, checked: boolean) {
    setForm((current) => ({
      ...current,
      materials: checked
        ? [...current.materials, { inventoryItemId: item.id, plannedQuantity: 1 }]
        : current.materials.filter((material) => material.inventoryItemId !== item.id),
    }));
  }

  function updateMaterial(inventoryItemId: string, plannedQuantity: number) {
    setForm((current) => ({
      ...current,
      materials: current.materials.map((material) =>
        material.inventoryItemId === inventoryItemId ? { ...material, plannedQuantity } : material,
      ),
    }));
  }

  async function handleAnalyze(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
    setError(null);
    if (!file || !form.name.trim() || !selectedProduct || !selectedPaper || form.copies < 1 ||
      form.materials.some((material) => material.plannedQuantity <= 0)) {
      window.requestAnimationFrame(() => {
        document.querySelector<HTMLElement>(".job-transaction-modal [aria-invalid='true']")?.focus();
      });
      return;
    }

    setAnalyzing(true);
    const body = new FormData();
    body.append("file", file);
    body.append("product_id", selectedProduct.id);
    body.append("paper_inventory_item_id", selectedPaper.id);
    if (form.variantId) body.append("variant_id", form.variantId);
    try {
      const result = await api.upload<DocumentAnalysisResponse>("/document-analyzer/analyze", body);
      setAnalysis(result);
      setPriceMode("suggested");
      setCustomPrice("");
      setStep("review");
      setSubmitted(false);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "The document could not be analyzed. Try again.");
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleConfirm() {
    if (!file || !selectedProduct || !analysis || !selectedPaper || saving) return;
    if (priceMode === "custom" && (parsedCustomPrice === null || !Number.isFinite(parsedCustomPrice) || parsedCustomPrice < 0)) {
      setError("Enter a valid final price of zero or more.");
      return;
    }
    setSaving(true);
    setError(null);
    const body = new FormData();
    body.append("file", file);
    body.append("transaction", JSON.stringify({
      name: form.name.trim(),
      productId: selectedProduct.id,
      paperInventoryItemId: selectedPaper.id,
      variantId: form.variantId || null,
      customerId: form.customerId || null,
      copies: form.copies,
      dueDate: form.dueDate ? `${form.dueDate}T17:00:00` : null,
      notes: form.notes.trim() || null,
      priceMode,
      customPrice: priceMode === "custom" ? parsedCustomPrice : null,
      observedPrintJobId: sourceSpoolerJobId ?? null,
      otherMaterials: form.materials,
    }));
    try {
      onCreated(await api.upload<JobOrder>("/job-orders/from-analysis", body));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "The transaction could not be saved. Try again.");
    } finally {
      setSaving(false);
    }
  }

  const normalizedSearch = form.productSearch.trim().toLocaleLowerCase();
  const filteredProducts = activeProducts.filter((product) => {
    if (form.serviceName && product.serviceName !== form.serviceName) return false;
    if (!normalizedSearch || product.id === form.productId) return true;
    return [product.name, product.serviceName, product.printTypeLabel || formatProductPrintType(product.printType)]
      .some((value) => value.toLocaleLowerCase().includes(normalizedSearch));
  });
  const prerequisitesMissing = activeProducts.length === 0;

  return (
    <Modal
      open={open}
      title="New job order"
      description="Nothing is saved until you approve the analyzed price. The new job then opens in its complete workflow."
      onClose={onClose}
      busy={analyzing || saving}
      status={error ? "error" : analyzing || saving ? "loading" : "idle"}
      className={`job-order-modal job-transaction-modal${step === "review" ? " job-order-modal--review" : ""}`}
    >
      <form className="job-order-form" onSubmit={handleAnalyze} noValidate>
        <nav className="transaction-steps" aria-label="Transaction progress">
          <ol>
            <li className={step === "file" ? "is-active" : "is-complete"} aria-current={step === "file" ? "step" : undefined}><span>01</span><strong>Customer file</strong></li>
            <li className={step === "configure" ? "is-active" : step === "review" ? "is-complete" : ""} aria-current={step === "configure" ? "step" : undefined}><span>02</span><strong>Print setup</strong></li>
            <li className={step === "review" ? "is-active" : ""} aria-current={step === "review" ? "step" : undefined}><span>03</span><strong>Preview & price</strong></li>
          </ol>
        </nav>

        <div className={`job-order-form__body${step === "review" ? " job-order-form__body--review" : ""}`}>
          {prerequisitesMissing ? (
            <div className="job-order-prerequisites">
              <strong>Add an active product before creating a transaction.</strong>
              <LinkButton to="/product-catalog" onClick={onClose}>Open services</LinkButton>
            </div>
          ) : step === "file" ? (
            <div className="transaction-step-panel" key="file">
              <FileStep
                fileInputId={fileInputId}
                fileInputKey={fileInputKey}
                file={file}
                dragging={dragging}
                submitted={submitted}
                analyzing={analyzing}
                sourceSpoolerJob={sourceSpoolerJob}
                setDragging={setDragging}
                handleFileInput={handleFileInput}
                handleDrop={handleDrop}
              />
            </div>
          ) : step === "configure" ? (
            <div className="transaction-step-panel" key="configure">
            <ConfigureStep
              submitted={submitted}
              form={form}
              services={services}
              filteredProducts={filteredProducts}
              selectedProduct={selectedProduct}
              paperAssignments={paperAssignments}
              otherAssignments={otherAssignments}
              customers={customers}
              setForm={setForm}
              selectProduct={selectProduct}
              toggleMaterial={toggleMaterial}
              updateMaterial={updateMaterial}
              invalidateAnalysis={invalidateAnalysis}
            />
            </div>
          ) : analysis && selectedProduct ? (
            <div className="transaction-step-panel transaction-step-panel--review" key="review">
            <ReviewStep
              file={file!}
              analysis={analysis}
              product={selectedProduct}
              jobName={form.name.trim()}
              copies={form.copies}
              selectedPaper={selectedPaper}
              recommendedTotal={recommendedTotal}
              priceMode={priceMode}
              customPrice={customPrice}
              parsedCustomPrice={parsedCustomPrice}
              finalPrice={finalPrice}
              setStep={setStep}
              setPriceMode={setPriceMode}
              setCustomPrice={setCustomPrice}
              setError={setError}
            />
            </div>
          ) : null}

          {error && <p className="workspace-form__error transaction-error" role="alert">{error}</p>}
        </div>

        <footer className="job-order-form__actions transaction-actions">
          {step === "file" ? (
            <>
              <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
              <Button type="button" variant="primary" onClick={() => { setSubmitted(true); if (file) { setSubmitted(false); setStep("configure"); } }} disabled={prerequisitesMissing}>Continue to print setup</Button>
            </>
          ) : step === "configure" ? (
            <>
              <Button type="button" variant="ghost" onClick={() => { setSubmitted(false); setStep("file"); }} disabled={analyzing}>Back</Button>
              <Button type="submit" variant="primary" loading={analyzing} disabled={prerequisitesMissing}>Analyze and price</Button>
            </>
          ) : (
            <>
              <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>Do not proceed</Button>
              <Button type="button" variant="secondary" onClick={() => setStep("configure")} disabled={saving}>Edit print setup</Button>
              <Button type="button" variant="primary" onClick={handleConfirm} loading={saving} disabled={!selectedPaper || finalPrice === null || !Number.isFinite(finalPrice) || finalPrice < 0}>Create job order</Button>
            </>
          )}
        </footer>
      </form>
    </Modal>
  );
}

interface FileStepProps {
  fileInputId: string;
  fileInputKey: number;
  file: File | null;
  dragging: boolean;
  submitted: boolean;
  analyzing: boolean;
  sourceSpoolerJob?: ObservedPrintJob | null;
  setDragging: (value: boolean) => void;
  handleFileInput: (event: ChangeEvent<HTMLInputElement>) => void;
  handleDrop: (event: DragEvent<HTMLLabelElement>) => void;
}

function FileStep({ fileInputId, fileInputKey, file, dragging, submitted, analyzing, sourceSpoolerJob, setDragging, handleFileInput, handleDrop }: FileStepProps) {
  return (
    <section className="transaction-file-step">
      {sourceSpoolerJob && (
        <div className="transaction-spooler-context">
          <span className="transaction-spooler-context__mark" aria-hidden="true">OS</span>
          <div>
            <span className="numeric">WINDOWS PRINT RECEIVED</span>
            <strong>{sourceSpoolerJob.documentName}</strong>
            <small>{sourceSpoolerJob.printerName} · spooler job {sourceSpoolerJob.osJobId}</small>
            <p>Upload the original file so this event can become a priced, traceable job order.</p>
          </div>
        </div>
      )}
      <div className="transaction-file-step__intro">
        <span className="numeric">01 / CUSTOMER FILE</span>
        <h3>Start with the document</h3>
        <p>It remains temporary until you review the analysis and approve the transaction.</p>
      </div>
      <input key={fileInputKey} id={fileInputId} className="transaction-file-input" type="file" accept={ACCEPT} onChange={handleFileInput} disabled={analyzing} />
      <label className={["transaction-dropzone", "transaction-dropzone--primary", dragging ? "is-dragging" : "", submitted && !file ? "is-invalid" : ""].filter(Boolean).join(" ")} htmlFor={fileInputId} aria-invalid={submitted && !file} onDragEnter={(event) => { event.preventDefault(); setDragging(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={() => setDragging(false)} onDrop={handleDrop}>
        <span className="transaction-dropzone__mark" aria-hidden="true">DOC</span>
        <span><strong>{file ? file.name : "Choose a document or drop it here"}</strong><small>{file ? `${formatFileSize(file.size)} · Ready for print setup` : "PDF · images · Word · Excel · PowerPoint · up to 25 MB"}</small></span>
        <b>{file ? "Change file" : "Browse"}</b>
      </label>
      {submitted && !file && <p className="workspace-form__error" role="alert">Upload the customer's file.</p>}
      <div className="transaction-file-step__promise" aria-label="What happens next">
        <span><b>1</b> Choose product and paper</span>
        <span><b>2</b> Review document and price</span>
        <span><b>3</b> Approve the job order</span>
      </div>
    </section>
  );
}

interface ConfigureStepProps {
  submitted: boolean;
  form: TransactionForm;
  services: string[];
  filteredProducts: Product[];
  selectedProduct?: Product;
  paperAssignments: InventoryItem[];
  otherAssignments: InventoryItem[];
  customers: Customer[];
  setForm: Dispatch<SetStateAction<TransactionForm>>;
  selectProduct: (productId: string) => void;
  toggleMaterial: (item: InventoryItem, checked: boolean) => void;
  updateMaterial: (inventoryItemId: string, plannedQuantity: number) => void;
  invalidateAnalysis: () => void;
}

function ConfigureStep(props: ConfigureStepProps) {
  const {
    submitted, form, services, filteredProducts,
    selectedProduct, paperAssignments, otherAssignments, customers,
    setForm, selectProduct, toggleMaterial,
    updateMaterial, invalidateAnalysis,
  } = props;
  return (
    <>
      <section className="transaction-section">
        <div className="transaction-section__heading"><span className="numeric">01 / PRODUCT & PAPER</span><div><h3>Choose the work to perform</h3><p>Select the product, print paper, and any variant. The owner’s paper choice drives pricing and printing.</p></div></div>
        <div className="transaction-catalog-controls">
          <label className="form-field"><span>Service</span><select value={form.serviceName} onChange={(event) => { setForm((current) => ({ ...current, serviceName: event.target.value, productId: "", variantId: "", paperInventoryItemId: "", materials: [] })); invalidateAnalysis(); }}><option value="">All services</option>{services.map((service) => <option key={service} value={service}>{service}</option>)}</select></label>
          <label className="form-field"><span>Find product</span><input type="search" value={form.productSearch} onChange={(event) => setForm((current) => ({ ...current, productSearch: event.target.value }))} placeholder="Search products" /></label>
        </div>
        <fieldset className="transaction-product-picker" aria-invalid={submitted && !selectedProduct} tabIndex={-1}>
          <legend>Product</legend>
          <div className="transaction-product-grid">
            {filteredProducts.map((product) => (
              <label className={`transaction-product-card${product.id === form.productId ? " is-selected" : ""}`} key={product.id}>
                <input type="radio" name="transaction-product" checked={product.id === form.productId} onChange={() => selectProduct(product.id)} />
                <span className="transaction-product-card__check" aria-hidden="true" />
                <span><small>{product.serviceName} · {product.printTypeLabel || formatProductPrintType(product.printType)}</small><strong>{product.name}</strong><b>From {formatCurrency(product.pricePerPage)} / page</b></span>
              </label>
            ))}
            {filteredProducts.length === 0 && <p className="transaction-product-empty">No products match this service and search.</p>}
          </div>
          {submitted && !selectedProduct && <p className="workspace-form__error">Select one product.</p>}
        </fieldset>

        {selectedProduct && (
          <div className="transaction-options">
            <label className="form-field"><span>Print paper</span><select value={form.paperInventoryItemId} onChange={(event) => { setForm((current) => ({ ...current, paperInventoryItemId: event.target.value })); invalidateAnalysis(); }} aria-invalid={submitted && !form.paperInventoryItemId}><option value="">Select paper</option>{paperAssignments.map((item) => <option key={item.id} value={item.id}>{item.paperSize} · {item.name}</option>)}</select><small>This controls pricing, inventory deduction, and printer setup.</small></label>
            <label className="form-field"><span>Variant <small>(optional)</small></span><select value={form.variantId} onChange={(event) => { setForm((current) => ({ ...current, variantId: event.target.value })); invalidateAnalysis(); }} disabled={selectedProduct.variants.length === 0}><option value="">No variant</option>{selectedProduct.variants.map((variant) => <option key={variant.variantId} value={variant.variantId}>{variant.label}{variant.requiresManualDuplex ? " · supervised duplex" : ""} · {variant.priceAdjustment >= 0 ? "+" : ""}{formatCurrency(variant.priceAdjustment)} / page</option>)}</select></label>
            <label className="form-field"><span>Copies</span><input type="number" min={1} value={form.copies} onChange={(event) => { setForm((current) => ({ ...current, copies: Number(event.target.value) })); invalidateAnalysis(); }} aria-invalid={submitted && form.copies < 1} /></label>
          </div>
        )}
        {selectedProduct && paperAssignments.length === 0 && <p className="workspace-form__error" aria-invalid="true" tabIndex={-1}>This product has no active configured paper material.</p>}
        {submitted && selectedProduct && paperAssignments.length > 0 && !form.paperInventoryItemId && <p className="workspace-form__error">Select the paper the owner will print on.</p>}
      </section>

      {selectedProduct && otherAssignments.length > 0 && (
        <section className="transaction-section">
          <div className="transaction-section__heading"><span className="numeric">02 / MATERIALS</span><div><h3>Plan optional supplies</h3><p>The chosen paper is planned from the page count and copies. Selected supplies are deducted after successful print submission.</p></div></div>
          <div className="transaction-materials">
            {otherAssignments.map((item) => {
              const selected = form.materials.find((material) => material.inventoryItemId === item.id);
              return <div className="transaction-material" key={item.id}><label><input type="checkbox" checked={Boolean(selected)} onChange={(event) => toggleMaterial(item, event.target.checked)} /><span><strong>{item.name}</strong><small>{item.quantityOnHand.toLocaleString()} {item.unit} available</small></span></label>{selected && <label><span>Planned</span><input type="number" min="0.01" step="0.01" value={selected.plannedQuantity} onChange={(event) => updateMaterial(item.id, Number(event.target.value))} aria-invalid={submitted && selected.plannedQuantity <= 0} /><span>{item.unit}</span></label>}</div>;
            })}
          </div>
        </section>
      )}

      <section className="transaction-section transaction-section--secondary">
        <div className="transaction-section__heading"><span className="numeric">03 / DETAILS</span><div><h3>Name this job</h3><p>The name identifies the work throughout the app; customer, deadline, and notes remain optional.</p></div></div>
        <div className="transaction-details-grid">
          <label className="form-field transaction-job-name"><span>Job name</span><input type="text" maxLength={100} value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} aria-invalid={submitted && !form.name.trim()} /><small>Use a customer-friendly label such as “Reyes thesis copies”. The permanent job reference remains available for audit.</small></label>
          <label className="form-field"><span>Customer</span><select value={form.customerId} onChange={(event) => setForm((current) => ({ ...current, customerId: event.target.value }))}><option value="">Walk-in / no customer</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.displayName}</option>)}</select></label>
          <label className="form-field"><span>Due date</span><input type="date" value={form.dueDate} onChange={(event) => setForm((current) => ({ ...current, dueDate: event.target.value }))} /></label>
        </div>
        {submitted && !form.name.trim() && <p className="workspace-form__error">Enter a name for this job order.</p>}
        <label className="form-field"><span>Notes</span><textarea rows={2} value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} /></label>
      </section>
    </>
  );
}

interface ReviewStepProps {
  file: File;
  analysis: DocumentAnalysisResponse;
  product: Product;
  jobName: string;
  copies: number;
  selectedPaper?: InventoryItem;
  recommendedTotal: number;
  priceMode: "suggested" | "custom";
  customPrice: string;
  parsedCustomPrice: number | null;
  finalPrice: number | null;
  setStep: (step: Step) => void;
  setPriceMode: (mode: "suggested" | "custom") => void;
  setCustomPrice: (price: string) => void;
  setError: (error: string | null) => void;
}

function ReviewStep(props: ReviewStepProps) {
  const { file, analysis, product, jobName, copies, selectedPaper, recommendedTotal, priceMode, customPrice, parsedCustomPrice, finalPrice, setStep, setPriceMode, setCustomPrice, setError } = props;
  const detectedMatchesSelection = analysis.analysis.paperSize === selectedPaper?.paperSize;
  return (
    <div className="transaction-review">
      <TransactionDocumentPreview file={file} />
      <div className="transaction-review__details">
      <section className="transaction-analysis-card">
        <header><div><span className="numeric">ANALYSIS COMPLETE</span><h3>{jobName}</h3><small>{analysis.analysis.filename}</small></div><Button type="button" variant="ghost" size="sm" onClick={() => setStep("configure")}>Edit setup</Button></header>
        <dl>
          <div><dt>Pages</dt><dd>{analysis.analysis.pageCount}</dd></div><div><dt>Best fit</dt><dd>{analysis.analysis.paperSize}</dd></div><div><dt>Print paper</dt><dd>{selectedPaper?.paperSize ?? "—"}</dd></div><div><dt>Orientation</dt><dd>{analysis.analysis.orientation}</dd></div><div><dt>Copies</dt><dd>{copies}</dd></div><div><dt>Sheets</dt><dd>{analysis.analysis.pageCount * copies}</dd></div><div><dt>Source pages</dt><dd>{analysis.analysis.colorPages} color · {analysis.analysis.bwPages} B&W</dd></div><div><dt>Ink load</dt><dd>{analysis.analysis.estimatedInkCoveragePercent.toFixed(1)}%</dd></div><div><dt>Print time</dt><dd>~{analysis.analysis.estimatedPrintTimeSeconds * copies}s</dd></div>
        </dl>
        <div className={`transaction-review__fit${detectedMatchesSelection ? " is-matched" : ""}`}><strong>{detectedMatchesSelection ? "Selected paper matches the document’s best fit." : `Document best fits ${analysis.analysis.paperSize}; owner selected ${selectedPaper?.paperSize}.`}</strong><span>{detectedMatchesSelection ? `Printing will use ${selectedPaper?.name}.` : "This is advisory only. Pricing, inventory, and Print Center will use the owner-selected paper."}</span></div>
      </section>
      <section className="transaction-price-card">
        <div className="transaction-price-card__recommendation"><span className="numeric">ENGINE RECOMMENDATION</span><strong>{formatCurrency(recommendedTotal)}</strong><small>{formatCurrency(analysis.pricing.suggestedPrice)} per copy × {copies} {copies === 1 ? "copy" : "copies"}</small></div>
        <div className="transaction-price-breakdown"><div><span>{product.printType === "black_and_white" ? "B&W base · paper and ink included" : product.printAppliesInkCoverage ? `${product.printTypeLabel} base` : `${product.printTypeLabel} base · configured rate only`}</span><strong>{formatCurrency(analysis.pricing.baseSubtotal * copies)}</strong></div>{analysis.pricing.adjustments.map((adjustment) => <div key={`${adjustment.kind}-${adjustment.label}`}><span>{adjustment.label}<small>{adjustment.basis}</small></span><strong>{formatCurrency(adjustment.amount * copies)}</strong></div>)}</div>
      </section>
      <fieldset className="transaction-price-choice">
        <legend>Choose the transaction price</legend>
        <label className={priceMode === "suggested" ? "is-selected" : ""}><input type="radio" name="price-mode" checked={priceMode === "suggested"} onChange={() => { setPriceMode("suggested"); setError(null); }} /><span><strong>Use recommended price</strong><small>Keep the engine's measured computation.</small></span><b>{formatCurrency(recommendedTotal)}</b></label>
        <label className={priceMode === "custom" ? "is-selected" : ""}><input type="radio" name="price-mode" checked={priceMode === "custom"} onChange={() => { setPriceMode("custom"); setCustomPrice(String(recommendedTotal)); setError(null); }} /><span><strong>Set owner price</strong><small>Override the recommendation for this transaction only.</small></span><span className="transaction-custom-price"><i>₱</i><input type="number" min="0" step="0.01" value={customPrice} disabled={priceMode !== "custom"} onChange={(event) => setCustomPrice(event.target.value)} aria-invalid={priceMode === "custom" && (parsedCustomPrice === null || parsedCustomPrice < 0)} /></span></label>
      </fieldset>
      <div className="transaction-final-total"><span>Final transaction price</span><output className="numeric">{finalPrice === null || !Number.isFinite(finalPrice) ? "—" : formatCurrency(finalPrice)}</output><small>{priceMode === "custom" ? `Engine recommendation: ${formatCurrency(recommendedTotal)}` : "Using the engine recommendation"}</small></div>
      <p className="transaction-persistence-note">The job order and customer file still have not been saved. Choose “Do not proceed” to discard this transaction.</p>
      </div>
    </div>
  );
}

function TransactionDocumentPreview({ file }: { file: File }) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const isPdf = extension === "pdf" || file.type === "application/pdf";
  const isImage = ["png", "jpg", "jpeg", "bmp", "webp"].includes(extension) || file.type.startsWith("image/");

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  return (
    <section className="transaction-document-preview" aria-label="Analyzed document preview">
      <header>
        <div><span className="numeric">DOCUMENT PREVIEW</span><strong>{file.name}</strong></div>
        <small>{formatFileSize(file.size)}</small>
      </header>
      <div className="transaction-document-preview__canvas">
        {isPdf ? (
          <Suspense fallback={<div className="transaction-preview-status" role="status">Loading interactive preview…</div>}>
            <PdfViewer file={file} filename={file.name} downloadUrl={previewUrl} />
          </Suspense>
        ) : isImage && previewUrl ? (
          <div className="transaction-image-preview"><img src={previewUrl} alt={`Preview of ${file.name}`} /></div>
        ) : (
          <div className="transaction-preview-status">
            <span aria-hidden="true">DOC</span>
            <strong>Visual preview unavailable</strong>
            <p>The document was analyzed successfully. Office and TIFF files require conversion to PDF for an interactive preview.</p>
          </div>
        )}
      </div>
    </section>
  );
}
