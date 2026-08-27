import { ChangeEvent, DragEvent, FormEvent, lazy, Suspense, useEffect, useId, useState } from "react";
import { Button } from "../components/Button/Button";
import { LinkButton } from "../components/Button/LinkButton";
import { PageHeader } from "../components/PageHeader/PageHeader";
import { useResource } from "../hooks/useResource";
import { ApiError, api } from "../lib/apiClient";
import {
  formatCurrency,
  formatDuration,
  formatFileSize,
  formatProductPrintType,
} from "../lib/format";
import type { DocumentAnalysisResponse, DocumentPricingBreakdown, Product } from "../types/domain";
import "./DocumentAnalyzerPage.css";

const MAX_FILE_SIZE = 25 * 1024 * 1024;
const ACCEPTED_EXTENSIONS = ["pdf", "png", "jpg", "jpeg", "tif", "tiff", "bmp", "webp", "docx", "xlsx", "pptx"];
const ACCEPT = ACCEPTED_EXTENSIONS.map((extension) => `.${extension}`).join(",");
const PdfViewer = lazy(() => import("../components/PdfViewer/PdfViewer").then((module) => ({ default: module.PdfViewer })));

export function DocumentAnalyzerPage() {
  const inputId = useId();
  const [inputKey, setInputKey] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [productId, setProductId] = useState("");
  const [variantId, setVariantId] = useState("");
  const [dragging, setDragging] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DocumentAnalysisResponse | null>(null);
  const {
    data: products,
    state: productsState,
    error: productsError,
    reload: reloadProducts,
  } = useResource(() => api.get<Product[]>("/products"));
  const activeProducts = (products ?? []).filter((product) => product.isActive);
  const selectedProduct = activeProducts.find((product) => product.id === productId);

  function chooseFile(candidate: File | null) {
    setError(null);
    setResult(null);
    if (!candidate) {
      setFile(null);
      return;
    }
    const extension = candidate.name.split(".").pop()?.toLowerCase() ?? "";
    if (!ACCEPTED_EXTENSIONS.includes(extension)) {
      setFile(null);
      setError("Choose a PDF, image, DOCX, XLSX, or PPTX file.");
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
  }

  function handleFileInput(event: ChangeEvent<HTMLInputElement>) {
    chooseFile(event.target.files?.[0] ?? null);
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    chooseFile(event.dataTransfer.files?.[0] ?? null);
  }

  async function handleAnalyze(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || !selectedProduct || analyzing) return;
    setAnalyzing(true);
    setError(null);
    const formData = new FormData();
    formData.append("file", file);
    formData.append("product_id", productId);
    if (variantId) formData.append("variant_id", variantId);
    try {
      setResult(await api.upload<DocumentAnalysisResponse>("/document-analyzer/analyze", formData));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "The document could not be analyzed. Try again.");
    } finally {
      setAnalyzing(false);
    }
  }

  function resetAnalyzer() {
    setFile(null);
    setResult(null);
    setError(null);
    setInputKey((current) => current + 1);
  }

  return (
    <div className={`document-analyzer-page${result ? " document-analyzer-page--result" : ""}`}>
      {!result ? (
        <PageHeader
          eyebrow="OPERATIONS"
          title="Document Analyzer"
          description="Preflight customer files, separate color from black-and-white pages, and calculate a rule-based printing estimate."
          actions={
            <LinkButton to="/configuration#document-pricing" variant="secondary">
              Pricing rules
            </LinkButton>
          }
        />
      ) : null}

      {!result ? (
        <form className="analyzer-intake" onSubmit={handleAnalyze}>
          <div className="analyzer-intake__heading">
            <div>
              <span className="numeric">01 / PREFLIGHT</span>
              <h2>Place one document on the analysis desk</h2>
            </div>
            <p>Pricing starts from the product rate, then adds measured ink, color coverage, and the selected variant. Files stay local and are not retained.</p>
          </div>

          <div className="analyzer-intake__pricing-context">
            <label className="form-field">
              <span>Product</span>
              <select
                value={productId}
                disabled={analyzing || productsState !== "ready"}
                required
                onChange={(event) => {
                  setProductId(event.target.value);
                  setVariantId("");
                }}
              >
                <option value="">
                  {productsState === "loading" ? "Loading products…" : "Select a product"}
                </option>
                {groupProductsByService(activeProducts).map(([serviceName, serviceProducts]) => (
                  <optgroup label={serviceName} key={serviceName}>
                    {serviceProducts.map((product) => (
                      <option value={product.id} key={product.id}>{product.name}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <span className="form-field__message">
                Sets the base page price for the detected paper size.
              </span>
            </label>

            <label className="form-field">
              <span>Variant</span>
              <select
                value={variantId}
                disabled={analyzing || !selectedProduct || selectedProduct.variants.length === 0}
                onChange={(event) => setVariantId(event.target.value)}
              >
                <option value="">No variant</option>
                {(selectedProduct?.variants ?? []).map((variant) => (
                  <option value={variant.variantId} key={variant.variantId}>
                    {variant.label} · {variant.priceAdjustment >= 0 ? "+" : ""}{formatCurrency(variant.priceAdjustment)} / page
                  </option>
                ))}
              </select>
              <span className="form-field__message">
                Optional configured adjustment applied once per page.
              </span>
            </label>
          </div>

          {productsState === "error" ? (
            <div className="analyzer-intake__resource-error" role="alert">
              <span>{productsError ?? "Products could not be loaded."}</span>
              <Button type="button" variant="ghost" size="sm" onClick={reloadProducts}>Retry</Button>
            </div>
          ) : null}
          {productsState === "ready" && activeProducts.length === 0 ? (
            <div className="analyzer-intake__resource-error">
              <span>Add an active priced product before analyzing a document.</span>
              <LinkButton to="/product-catalog" variant="ghost" size="sm">Open services</LinkButton>
            </div>
          ) : null}

          <input
            key={inputKey}
            id={inputId}
            className="analyzer-file-input"
            type="file"
            accept={ACCEPT}
            onChange={handleFileInput}
            disabled={analyzing}
          />
          <label
            className={["analyzer-dropzone", dragging ? "analyzer-dropzone--dragging" : ""].filter(Boolean).join(" ")}
            htmlFor={inputId}
            onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
          >
            <span className="analyzer-dropzone__scan" aria-hidden="true">
              <span />
            </span>
            <strong>{file ? file.name : "Choose a file or drop it here"}</strong>
            <span>
              {file
                ? `${formatFileSize(file.size)} · Ready for local analysis`
                : "PDF · images · Word · Excel · PowerPoint"}
            </span>
            <small>Maximum file size: 25 MB</small>
          </label>

          {error ? <p className="analyzer-intake__error" role="alert">{error}</p> : null}

          <footer className="analyzer-intake__actions">
            {file ? <Button type="button" variant="ghost" disabled={analyzing} onClick={resetAnalyzer}>Clear</Button> : null}
            <Button type="submit" variant="primary" loading={analyzing} disabled={!file || !selectedProduct}>
              Analyze document
            </Button>
          </footer>
        </form>
      ) : (
        <AnalysisResult response={result} sourceFile={file} onReset={resetAnalyzer} />
      )}
    </div>
  );
}

function AnalysisResult({
  response,
  sourceFile,
  onReset,
}: {
  response: DocumentAnalysisResponse;
  sourceFile: File | null;
  onReset: () => void;
}) {
  const { analysis, pricing, pricingContext } = response;
  const totalPages = Math.max(analysis.pageCount, 1);
  const colorShare = analysis.colorPages / totalPages * 100;
  const allWarnings = [...analysis.warnings, ...pricing.warnings];
  const dimensions = analysis.widthMm && analysis.heightMm
    ? `${analysis.widthMm.toFixed(1)} × ${analysis.heightMm.toFixed(1)} mm`
    : "Not available";

  return (
    <div className="analyzer-result" aria-live="polite">
      <DocumentPreview file={sourceFile} response={response} />

      <article className="analyzer-result__sheet">
        <header className="analyzer-result__masthead">
          <div>
            <span className="numeric">02 / ANALYSIS</span>
            <h2>Result analysis</h2>
            <p>{formatFileSize(analysis.fileSizeBytes)} · {(analysis.confidence * 100).toFixed(0)}% confidence</p>
          </div>
          <div className="analyzer-result__estimate">
            <span>Suggested print price</span>
            <strong className="numeric">{formatCurrency(pricing.suggestedPrice)}</strong>
            <small>
              {pricingContext
                ? `Priced for ${pricingContext.productName}${pricingContext.variantName ? ` · ${pricingContext.variantName}` : ""}`
                : "Analysis only — no product referenced"}
            </small>
          </div>
        </header>

        <section className="analyzer-result__headline-metrics" aria-label="Primary document metrics">
          <Metric label="Pages" value={analysis.pageCount.toLocaleString()} />
          <Metric label="Paper" value={analysis.paperSize} />
          <Metric label="Orientation" value={capitalize(analysis.orientation)} />
          <Metric label="Print time" value={formatDuration(analysis.estimatedPrintTimeSeconds)} />
        </section>

        <section className="analyzer-color-ledger" aria-labelledby="color-ledger-title">
          <div className="analyzer-section-heading">
            <div><span>PRINT SEPARATION</span><h3 id="color-ledger-title">Color ledger</h3></div>
            <p>{analysis.colorPages} colored · {analysis.estimatedColorCoveragePercent.toFixed(1)}% color coverage</p>
          </div>
          <div className="analyzer-color-ledger__bar" aria-label={`${analysis.colorPages} colored and ${analysis.bwPages} black-and-white pages`}>
            <span style={{ width: `${colorShare}%` }} />
          </div>
          <div className="analyzer-color-ledger__legend">
            <span><i className="analyzer-color-ledger__swatch analyzer-color-ledger__swatch--color" />Colored <b className="numeric">{analysis.colorPages}</b></span>
            <span><i className="analyzer-color-ledger__swatch" />B&amp;W <b className="numeric">{analysis.bwPages}</b></span>
          </div>
        </section>

        <section className="analyzer-detail-grid">
          <DetailGroup title="Document">
            <Detail label="Dimensions" value={dimensions} />
            <Detail label="DPI" value={analysis.dpi ? analysis.dpi.toLocaleString() : "Not available"} />
            <Detail label="Duplex" value={analysis.duplexCompatible ? "Compatible" : "Not recommended"} />
            <Detail label="OCR" value={analysis.ocrRequired ? "Required" : "Not required"} />
          </DetailGroup>
          <DetailGroup title="Content">
            <Detail label="Words" value={analysis.wordCount.toLocaleString()} />
            <Detail label="Characters" value={analysis.characterCount.toLocaleString()} />
            <Detail label="Images" value={analysis.imageCount.toLocaleString()} />
            <Detail label="Tables / graphics" value={`${analysis.tableCount} / ${analysis.graphicCount}`} />
          </DetailGroup>
          <DetailGroup title="Coverage">
            <Detail label="Image coverage" value={`${analysis.imageCoveragePercent.toFixed(1)}%`} />
            <Detail label="Color coverage" value={`${analysis.estimatedColorCoveragePercent.toFixed(1)}%`} />
            <Detail label="Estimated ink" value={`${analysis.estimatedInkCoveragePercent.toFixed(1)}%`} />
            <Detail label="Margins" value={analysis.margins ? formatMargins(analysis.margins) : "Not available"} />
            <Detail label="File type" value={analysis.fileType.toUpperCase()} />
          </DetailGroup>
        </section>

        <section className="analyzer-pricing" aria-labelledby="pricing-breakdown-title">
          <div className="analyzer-section-heading">
            <div><span>RULE ENGINE</span><h3 id="pricing-breakdown-title">Pricing breakdown</h3></div>
            <strong className="numeric">{formatCurrency(pricing.suggestedPrice)}</strong>
          </div>
          {pricing.breakdown.length ? (
            <div className="analyzer-pricing__table">
              {pricing.breakdown.map((item) => (
                <div key={item.printType}>
                  <span>{pricingContext ? `${pricingContext.productName} base` : formatProductPrintType(item.printType)}{formatRateSourceTag(item.rateSource)}</span>
                  <span className="numeric">{item.pages} × {formatCurrency(item.ratePerPage)}</span>
                  <strong className="numeric">{formatCurrency(item.subtotal)}</strong>
                </div>
              ))}
              {pricing.adjustments.map((item) => (
                <div className="analyzer-pricing__adjustment" key={`${item.kind}-${item.label}`}>
                  <span>{item.label}<small>{item.basis}</small></span>
                  <span className="numeric">Adjustment</span>
                  <strong className="numeric">{formatSignedCurrency(item.amount)}</strong>
                </div>
              ))}
            </div>
          ) : <p className="analyzer-pricing__empty">No active rule produced a price.</p>}
        </section>

        <section className="analyzer-review" aria-labelledby="analyzer-review-title">
          <div className="analyzer-section-heading">
            <div><span>OPERATOR REVIEW</span><h3 id="analyzer-review-title">Notes and warnings</h3></div>
          </div>
          {allWarnings.length ? (
            <ul>{allWarnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
          ) : <p className="analyzer-review__clear">No analysis warnings were raised.</p>}
          <div className="analyzer-result__privacy">
            <strong>Local processing</strong>
            <span>This analysis was not saved and the source file was not retained.</span>
          </div>
        </section>

        <footer className="analyzer-result__actions">
          <LinkButton to="/configuration#document-pricing" variant="secondary">Adjust pricing rules</LinkButton>
          <Button type="button" variant="primary" onClick={onReset}>Analyze another</Button>
        </footer>
      </article>
    </div>
  );
}

function DocumentPreview({
  file,
  response,
}: {
  file: File | null;
  response: DocumentAnalysisResponse;
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const { analysis } = response;
  const extension = getFileExtension(analysis.filename);
  const isPdf = analysis.fileType === "pdf";
  const canPreviewImage = analysis.fileType === "image" && !["tif", "tiff"].includes(extension);

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const nextUrl = URL.createObjectURL(file);
    setPreviewUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [file]);

  return (
    <section className="analyzer-preview" aria-labelledby="analyzer-preview-title">
      <header className="analyzer-preview__header">
        <div>
          <span className="numeric">01 / PREVIEW</span>
          <h2 id="analyzer-preview-title">Document preview</h2>
        </div>
        <span className="analyzer-preview__type numeric">{extension || analysis.fileType}</span>
      </header>

      <div className={`analyzer-preview__viewport${isPdf ? " analyzer-preview__viewport--pdf" : ""}`}>
        {file && isPdf ? (
          <Suspense fallback={<div className="analyzer-preview__engine-loading" role="status">Loading PDF viewer</div>}>
            <PdfViewer file={file} filename={analysis.filename} downloadUrl={previewUrl} />
          </Suspense>
        ) : null}
        {previewUrl && canPreviewImage ? (
          <img src={previewUrl} alt={`Preview of ${analysis.filename}`} />
        ) : null}
        {(!file || (!isPdf && !canPreviewImage) || (canPreviewImage && !previewUrl)) ? (
          <div className="analyzer-preview__fallback">
            <div className="analyzer-preview__file" aria-hidden="true">
              <span>{extension || analysis.fileType}</span>
              <i /><i /><i /><i />
            </div>
            <strong>{previewUrl ? "Visual preview unavailable" : "Preparing document preview"}</strong>
            <p>
              {previewUrl
                ? `${analysis.fileType.toUpperCase()} files are analyzed locally, but this format cannot be rendered by the built-in preview.`
                : "The source file is being prepared locally."}
            </p>
          </div>
        ) : null}
      </div>

      <footer className="analyzer-preview__caption">
        <strong>{analysis.filename}</strong>
        <span>{analysis.pageCount.toLocaleString()} {analysis.pageCount === 1 ? "page" : "pages"}</span>
        <span>{analysis.paperSize} · {capitalize(analysis.orientation)}</span>
      </footer>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><strong className="numeric">{value}</strong></div>;
}

function DetailGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return <section><h3>{title}</h3><dl>{children}</dl></section>;
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function getFileExtension(filename: string) {
  return filename.split(".").pop()?.toLowerCase() ?? "";
}

function formatMargins(margins: { topMm: number; rightMm: number; bottomMm: number; leftMm: number }) {
  return `${margins.topMm}/${margins.rightMm}/${margins.bottomMm}/${margins.leftMm} mm`;
}

function formatRateSourceTag(rateSource: DocumentPricingBreakdown["rateSource"]) {
  return rateSource === "product" ? " · product rate" : "";
}

function formatSignedCurrency(value: number) {
  if (value === 0) return formatCurrency(0);
  return `${value > 0 ? "+" : "−"}${formatCurrency(Math.abs(value))}`;
}

function groupProductsByService(products: Product[]): [string, Product[]][] {
  const groups = new Map<string, Product[]>();
  for (const product of products) {
    const group = groups.get(product.serviceName);
    if (group) group.push(product);
    else groups.set(product.serviceName, [product]);
  }
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right));
}
