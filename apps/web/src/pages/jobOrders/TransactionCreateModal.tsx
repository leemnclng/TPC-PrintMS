import { ChangeEvent, FormEvent, useEffect, useState } from "react";
import { Button } from "../../components/Button/Button";
import { Modal } from "../../components/Modal/Modal";
import { ApiError, api } from "../../lib/apiClient";
import { formatCurrency } from "../../lib/format";
import { hasScanPricingConfigured, resolveScanPricePerPage } from "../../lib/productPricing";
import type {
  Customer,
  DocumentAnalysisResponse,
  DocumentPricingRule,
  InventoryItem,
  JobOrder,
  Product,
  ScanPricingTier,
  Service,
} from "../../types/domain";
import "./TransactionCreateModal.css";

type PriceMode = "suggested" | "custom";

interface TransactionLine {
  key: string;
  serviceId: string;
  productId: string;
  paperId: string;
  variantId: string;
  file: File | null;
  pages: number;
  copies: number;
  backToBack: boolean;
  analysis: DocumentAnalysisResponse | null;
  analyzing: boolean;
  priceMode: PriceMode;
  customPrice: string;
}

interface Props {
  open: boolean;
  initialService: Service;
  services: Service[];
  products: Product[];
  inventoryItems: InventoryItem[];
  pricingRules: DocumentPricingRule[];
  scanPricingTiers: ScanPricingTier[];
  customers: Customer[];
  sourceSpoolerJobId?: string | null;
  order?: JobOrder;
  onClose: () => void;
  onCreated: (order: JobOrder) => void;
}

let lineSequence = 0;
const newLine = (serviceId: string): TransactionLine => ({
  key: `line-${Date.now()}-${lineSequence++}`,
  serviceId,
  productId: "",
  paperId: "",
  variantId: "",
  file: null,
  pages: 1,
  copies: 1,
  backToBack: false,
  analysis: null,
  analyzing: false,
  priceMode: "suggested",
  customPrice: "",
});

export function TransactionCreateModal({
  open,
  initialService,
  services,
  products,
  inventoryItems,
  pricingRules,
  scanPricingTiers,
  customers,
  sourceSpoolerJobId,
  order,
  onClose,
  onCreated,
}: Props) {
  const [lines, setLines] = useState<TransactionLine[]>([]);
  const [name, setName] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeServices = services.filter((service) => service.isActive && service.productCount > 0);
  const inventoryById = new Map(inventoryItems.map((item) => [item.id, item]));

  useEffect(() => {
    if (!open) return;
    setLines([newLine(initialService.id)]);
    setName(order?.name ?? "");
    setCustomerId(order?.customerId ?? "");
    setDueDate("");
    setNotes("");
    setSubmitted(false);
    setSaving(false);
    setError(null);
  }, [open, initialService.id, order?.customerId, order?.name]);

  function updateLine(key: string, patch: Partial<TransactionLine>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  function chooseService(line: TransactionLine, serviceId: string) {
    updateLine(line.key, { ...newLine(serviceId), key: line.key });
  }

  function chooseProduct(line: TransactionLine, productId: string) {
    const product = products.find((candidate) => candidate.id === productId);
    updateLine(line.key, {
      productId,
      paperId: "",
      variantId: "",
      file: null,
      pages: 1,
      copies: 1,
      backToBack: false,
      analysis: null,
      priceMode: "suggested",
      customPrice: "",
    });
    if (!order && !name.trim() && lines.length === 1 && product) setName(product.name);
  }

  function lineContext(line: TransactionLine) {
    const product = products.find((candidate) => candidate.id === line.productId);
    const papers = product?.materialAssignments
      .map((assignment) => inventoryById.get(assignment.inventoryItemId))
      .filter((item): item is InventoryItem => Boolean(item?.isActive && item.paperSize)) ?? [];
    const variant = product?.variants.find((candidate) => candidate.variantId === line.variantId);
    let suggested = 0;
    // The real page count (and therefore the exact rate) is only known once
    // the job is scanned — `scanConfigured` gates whether the line can be
    // created at all, while `scanPrice` is a 1-page provisional estimate.
    const scanConfigured = product?.operationKind === "scan"
      ? hasScanPricingConfigured(product.standalonePricePerPage, scanPricingTiers)
      : true;
    const scanPrice = product?.operationKind === "scan"
      ? resolveScanPricePerPage(product.standalonePricePerPage, 1, scanPricingTiers)
      : null;
    if (product?.operationKind === "printing") {
      suggested = (line.analysis?.pricing.suggestedPrice ?? 0) * line.copies;
    } else if (product?.operationKind === "scan") {
      suggested = scanPrice ?? 0;
    } else if (product?.operationKind === "photocopy") {
      const customRate = product.documentRates.find((candidate) =>
        pricingRules.some((rule) => rule.id === candidate.pricingRuleId && rule.inventoryItemId === line.paperId && rule.pricingScope === product.operationKind),
      )?.pricePerPage;
      const globalRate = pricingRules.find((rule) =>
        rule.isActive && rule.inventoryItemId === line.paperId && rule.printType === product.printType && rule.pricingScope === product.operationKind,
      )?.pricePerPage;
      const rate = customRate ?? globalRate ?? product.pricePerPage;
      suggested = (rate + (variant?.priceAdjustment ?? 0)) * line.pages * line.copies;
    }
    const parsedCustom = Number(line.customPrice);
    const total = line.priceMode === "custom" && line.customPrice.trim() && Number.isFinite(parsedCustom)
      ? parsedCustom
      : suggested;
    return { product, papers, variant, scanPrice, scanConfigured, suggested: Math.round(suggested * 100) / 100, total: Math.round(total * 100) / 100 };
  }

  async function analyzeLine(line: TransactionLine) {
    const { product } = lineContext(line);
    if (!product || !line.file || !line.paperId) {
      setSubmitted(true);
      setError("Choose the printing product, document, and paper before analyzing it.");
      return;
    }
    updateLine(line.key, { analyzing: true });
    setError(null);
    const body = new FormData();
    body.append("file", line.file);
    body.append("product_id", product.id);
    body.append("paper_inventory_item_id", line.paperId);
    if (line.variantId) body.append("variant_id", line.variantId);
    try {
      const analysis = await api.upload<DocumentAnalysisResponse>("/document-analyzer/analyze", body);
      updateLine(line.key, { analysis, analyzing: false });
    } catch (caught) {
      updateLine(line.key, { analyzing: false });
      setError(caught instanceof ApiError ? caught.message : "The document could not be analyzed.");
    }
  }

  function selectFile(line: TransactionLine, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    updateLine(line.key, { file, analysis: null });
    if (!order && !name.trim() && lines.length === 1 && file) {
      setName(file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").slice(0, 100));
    }
  }

  function validate() {
    if (!name.trim() || lines.length === 0) return false;
    return lines.every((line) => {
      const { product, papers, scanConfigured } = lineContext(line);
      if (!product) return false;
      if (product.operationKind === "printing" && (!line.file || !line.analysis || !line.paperId)) return false;
      if (product.operationKind === "photocopy" && (!line.paperId || line.pages < 1 || line.copies < 1)) return false;
      if (product.operationKind === "scan" && line.priceMode !== "custom" && !scanConfigured) return false;
      if (product.operationKind !== "scan" && papers.length === 0) return false;
      if (line.priceMode === "custom" && (!line.customPrice.trim() || Number(line.customPrice) < 0)) return false;
      return true;
    });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    setError(null);
    if (!validate()) {
      setError("Complete every product line. Printing products must be analyzed before checkout, and a Scan product needs a price — set one on the product or a global page-count tier.");
      return;
    }
    setSaving(true);
    const body = new FormData();
    body.append("transaction", JSON.stringify({
      name: name.trim(),
      initialServiceId: lines[0].serviceId,
      customerId: customerId || null,
      dueDate: dueDate ? new Date(`${dueDate}T23:59:59`).toISOString() : null,
      notes: notes.trim() || null,
      observedPrintJobId: sourceSpoolerJobId || null,
      items: lines.map((line) => ({
        clientKey: line.key,
        productId: line.productId,
        paperInventoryItemId: line.paperId || null,
        variantId: line.variantId || null,
        pagesPerCopy: line.pages,
        copies: line.copies,
        backToBack: line.backToBack,
        priceMode: line.priceMode,
        customPrice: line.priceMode === "custom" ? Number(line.customPrice) : null,
        otherMaterials: [],
      })),
    }));
    lines.forEach((line) => {
      if (!line.file) return;
      body.append("file_keys", line.key);
      body.append("files", line.file);
    });
    try {
      onCreated(await api.upload<JobOrder>(order ? `/job-orders/${order.id}/items` : "/job-orders/transactions", body));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "The transaction could not be created.");
      setSaving(false);
    }
  }

  const combinedTotal = lines.reduce((sum, line) => sum + lineContext(line).total, 0);

  return (
    <Modal
      open={open}
      title={order ? "Add products" : "New transaction"}
      description={order ? `Add more work to ${order.name}. Existing completed lines stay intact.` : `Started with ${initialService.name}. Add products from any service; each keeps its own workflow.`}
      onClose={onClose}
      busy={saving}
      status={error ? "error" : saving ? "loading" : "idle"}
      className="transaction-create-modal"
    >
      <form className="transaction-create" onSubmit={submit} noValidate>
        <div className="transaction-create__body">
          {!order ? <section className="transaction-create__identity">
            <label className="form-field"><span>Transaction name</span><input value={name} maxLength={100} onChange={(event) => setName(event.target.value)} aria-invalid={submitted && !name.trim()} placeholder="e.g. Santos thesis package" /></label>
            <label className="form-field"><span>Customer</span><select value={customerId} onChange={(event) => setCustomerId(event.target.value)}><option value="">Walk-in / no customer</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.displayName}</option>)}</select></label>
            <label className="form-field"><span>Due date</span><input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label>
          </section> : <div className="transaction-create__existing"><span>Current transaction</span><strong>{order.name}</strong><small>{order.number} · {formatCurrency(order.total)} before additions</small></div>}

          <section className="transaction-create__lines" aria-label="Products in this transaction">
            <header><div><span className="numeric">01 / WORK</span><h3>Products and operations</h3><p>Each product moves independently until every line is ready.</p></div><Button type="button" variant="secondary" onClick={() => setLines((current) => [...current, newLine(initialService.id)])}>Add product</Button></header>
            {lines.map((line, index) => {
              const { product, papers, scanConfigured, suggested, total } = lineContext(line);
              const lineProducts = products.filter((candidate) => candidate.isActive && candidate.serviceId === line.serviceId);
              return (
                <article className="transaction-line" key={line.key}>
                  <header><div><span className="numeric">LINE {String(index + 1).padStart(2, "0")}</span><strong>{product?.name || "Choose a product"}</strong>{product ? <small>{product.operationKind} workflow · {product.serviceName}</small> : null}</div>{lines.length > 1 ? <Button type="button" variant="ghost" size="sm" onClick={() => setLines((current) => current.filter((candidate) => candidate.key !== line.key))}>Remove</Button> : null}</header>
                  <div className="transaction-line__fields">
                    <label className="form-field"><span>Service</span><select value={line.serviceId} disabled={!order && index === 0} onChange={(event) => chooseService(line, event.target.value)}>{activeServices.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}</select>{!order && index === 0 ? <small>Initial service</small> : null}</label>
                    <label className="form-field"><span>Product</span><select value={line.productId} onChange={(event) => chooseProduct(line, event.target.value)} aria-invalid={submitted && !product}><option value="">Select product</option>{lineProducts.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></label>
                    {product && product.operationKind !== "scan" ? <label className="form-field"><span>Paper</span><select value={line.paperId} onChange={(event) => updateLine(line.key, { paperId: event.target.value, analysis: null })} aria-invalid={submitted && !line.paperId}><option value="">Select configured paper</option>{papers.map((paper) => <option key={paper.id} value={paper.id}>{paper.paperSize} · {paper.name}</option>)}</select></label> : null}
                    {product?.operationKind === "printing" ? <label className="form-field transaction-line__file"><span>Customer document</span><input type="file" accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff,.bmp,.webp,.docx,.xlsx,.pptx" onChange={(event) => selectFile(line, event)} aria-invalid={submitted && !line.file} /><small>{line.analysis ? `${line.analysis.analysis.pageCount} pages · best fit ${line.analysis.analysis.paperSize}` : "Analyze after choosing the file and paper."}</small></label> : null}
                    {product?.operationKind === "photocopy" ? <label className="form-field"><span>Pages</span><input type="number" min={1} value={line.pages} onChange={(event) => updateLine(line.key, { pages: Number(event.target.value) })} /></label> : null}
                    {product && product.operationKind !== "scan" ? <label className="form-field"><span>Copies</span><input type="number" min={1} value={line.copies} onChange={(event) => updateLine(line.key, { copies: Number(event.target.value) })} /></label> : null}
                    {product && product.operationKind !== "scan" && product.variants.length ? <label className="form-field"><span>Variant</span><select value={line.variantId} onChange={(event) => { const variant = product.variants.find((candidate) => candidate.variantId === event.target.value); updateLine(line.key, { variantId: event.target.value, backToBack: Boolean(variant?.requiresManualDuplex), analysis: null }); }}><option value="">No variant</option>{product.variants.map((variant) => <option key={variant.variantId} value={variant.variantId}>{variant.label}</option>)}</select></label> : null}
                  </div>
                  {product?.operationKind === "printing" ? <div className="transaction-line__analysis"><Button type="button" variant="secondary" disabled={line.analyzing || !line.file || !line.paperId} onClick={() => analyzeLine(line)}>{line.analyzing ? "Analyzing…" : line.analysis ? "Analyze again" : "Analyze document"}</Button><p>{line.analysis ? "Analysis complete. The detected size is guidance; your selected paper controls production." : "Pricing is calculated only after analysis."}</p></div> : null}
                  {product?.operationKind === "scan" ? <p className="transaction-line__notice">Create the job now. Scanning and page detection happen later inside this product line.</p> : null}
                  {product?.operationKind === "scan" && !scanConfigured ? <p className="workspace-form__error" role="alert">Set a price for {product.name} — either on the product itself or a global page-count tier in Settings.</p> : null}
                  {product?.operationKind === "photocopy" ? <p className="transaction-line__notice">Complete the physical copies on the printer, then record this line as ready.</p> : null}
                  {product ? <footer><div><span>{product.operationKind === "scan" ? "Estimated (1 page)" : "Suggested"}</span><strong>{formatCurrency(suggested)}</strong></div><label><span>Pricing</span><select value={line.priceMode} onChange={(event) => updateLine(line.key, { priceMode: event.target.value as PriceMode })}><option value="suggested">Use suggested</option><option value="custom">Owner price</option></select></label>{line.priceMode === "custom" ? <label><span>Final line price</span><input type="number" min={0} step="0.01" value={line.customPrice} onChange={(event) => updateLine(line.key, { customPrice: event.target.value })} /></label> : null}<output>{formatCurrency(total)}</output></footer> : null}
                </article>
              );
            })}
          </section>

          {!order ? <section className="transaction-create__notes"><label className="form-field"><span>Transaction notes</span><textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Shared instructions, customer requests, or pickup details" /></label></section> : null}
          {error ? <p className="workspace-form__error" role="alert">{error}</p> : null}
        </div>
        <footer className="transaction-create__checkout"><div><span>{order ? "Updated transaction total" : "Combined transaction total"}</span><strong>{formatCurrency((order?.total ?? 0) + combinedTotal)}</strong><small>{order ? `${formatCurrency(combinedTotal)} being added · transaction returns to production` : `${lines.length} product ${lines.length === 1 ? "line" : "lines"} · paid together after all work is ready`}</small></div><Button type="button" variant="ghost" disabled={saving} onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" disabled={saving}>{saving ? "Saving…" : order ? "Add to transaction" : "Create transaction"}</Button></footer>
      </form>
    </Modal>
  );
}
