import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "../../components/Button/Button";
import { ComboBox } from "../../components/ComboBox/ComboBox";
import { ErrorState } from "../../components/ErrorState/ErrorState";
import { LoadingState } from "../../components/LoadingState/LoadingState";
import { useResource } from "../../hooks/useResource";
import { ApiError, api } from "../../lib/apiClient";
import { formatCurrency, formatDate } from "../../lib/format";
import type { Product } from "../../types/domain";
import "./QuotationToolPage.css";

type QuoteLine = { key: string; productId: string; variantLabel: string; quantity: number; unitPrice: string };
let lineId = 0;
const blankLine = (): QuoteLine => ({ key: `quote-line-${++lineId}`, productId: "", variantLabel: "", quantity: 1, unitPrice: "" });
const futureDate = (days: number) => { const value = new Date(); value.setDate(value.getDate() + days); return value.toISOString().slice(0, 10); };

export function QuotationToolPage() {
  const { data: products, state, error, reload } = useResource(async () => {
    const catalog = await api.get<Product[]>("/products");
    return catalog.filter((product) => product.isActive);
  }, []);
  const [customerName, setCustomerName] = useState("");
  const [customerContact, setCustomerContact] = useState("");
  const [validUntil, setValidUntil] = useState(futureDate(14));
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<QuoteLine[]>([blankLine()]);
  const [generating, setGenerating] = useState<"pdf" | "png" | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const total = lines.reduce((sum, line) => sum + line.quantity * (Number(line.unitPrice) || 0), 0);

  function updateLine(key: string, patch: Partial<QuoteLine>) {
    setLines((current) => current.map((line) => line.key === key ? { ...line, ...patch } : line));
  }

  function selectProduct(line: QuoteLine, productId: string) {
    const product = products?.find((candidate) => candidate.id === productId);
    updateLine(line.key, { productId, variantLabel: "", unitPrice: product ? String(product.standalonePricePerPage ?? product.pricePerPage ?? 0) : "" });
  }

  async function generate(format: "pdf" | "png") {
    setGenerateError(null);
    if (!customerName.trim() || lines.some((line) => !line.productId || line.quantity < 1 || line.unitPrice === "" || Number(line.unitPrice) < 0)) {
      setGenerateError("Enter the customer name and complete every quotation line.");
      return;
    }
    setGenerating(format);
    try {
      const blob = await api.postDownload(`/quotations/document?format=${format}`, {
        customerName: customerName.trim(),
        customerContact: customerContact.trim() || null,
        validUntil: validUntil || null,
        notes: notes.trim() || null,
        items: lines.map((line) => ({ productId: line.productId, variantLabel: line.variantLabel || null, quantity: line.quantity, unitPrice: Number(line.unitPrice) })),
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `quotation-${new Date().toISOString().slice(0, 10)}.${format}`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (caught) {
      setGenerateError(caught instanceof ApiError ? caught.message : "The quotation could not be generated.");
    } finally {
      setGenerating(null);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void generate("pdf");
  }

  if (state === "loading") return <LoadingState label="Opening quotation builder…" />;
  if (state === "error" || !products) return <ErrorState description={error ?? undefined} onRetry={reload} />;

  return <div className="quotation-tool">
    <header className="quotation-tool__hero"><div><Link to="/tools">← Tools</Link><span className="numeric">SALES DOCUMENT / 02</span><h1>Quotation Builder</h1><p>Prepare a customer estimate and export it immediately. Nothing is saved to the customer list or quotation history.</p></div><strong>{formatCurrency(total)}</strong></header>
    <div className="quotation-tool__layout">
      <form className="quotation-editor" onSubmit={submit}>
        <section>
          <header><span className="numeric">01</span><h2>Customer and quote details</h2></header>
          <div className="quotation-fields">
            <label><span>Customer name</span><input required maxLength={200} value={customerName} onChange={(event) => setCustomerName(event.target.value)} placeholder="Type the customer's name" /></label>
            <label><span>Valid until</span><input type="date" min={new Date().toISOString().slice(0,10)} value={validUntil} onChange={(event) => setValidUntil(event.target.value)} /></label>
            <label className="is-wide"><span>Contact details <small>Optional</small></span><input maxLength={500} value={customerContact} onChange={(event) => setCustomerContact(event.target.value)} placeholder="Phone, email, or address" /></label>
            <label className="quotation-notes is-wide"><span>Notes or terms <small>Optional</small></span><textarea rows={3} maxLength={2000} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Payment terms, turnaround time, exclusions, or customer instructions" /></label>
          </div>
          <p className="quotation-hint">If the customer proceeds, register them when creating the job order.</p>
        </section>
        <section>
          <header><span className="numeric">02</span><h2>Quoted products</h2><Button type="button" size="sm" variant="secondary" onClick={() => setLines((current) => [...current, blankLine()])}>Add line</Button></header>
          <div className="quotation-lines">{lines.map((line, index) => {
            const product = products.find((candidate) => candidate.id === line.productId);
            return <article key={line.key}>
              <span className="numeric">{String(index + 1).padStart(2,"0")}</span>
              <label><span>Product</span><ComboBox value={line.productId} onChange={(productId) => selectProduct(line, productId)} placeholder="Search products" emptyMessage="No matching products" options={products.map((candidate) => ({ value: candidate.id, label: candidate.name, meta: candidate.serviceName, keywords: `${candidate.serviceName} ${candidate.operationKind} ${candidate.printTypeLabel ?? ""}` }))} /></label>
              {product?.variants.length ? <label><span>Variant</span><select value={line.variantLabel} onChange={(event) => updateLine(line.key,{variantLabel:event.target.value})}><option value="">No variant</option>{product.variants.map((variant) => <option key={variant.variantId} value={variant.label}>{variant.label}</option>)}</select></label> : null}
              <label className="is-small"><span>Quantity</span><input type="number" min={1} value={line.quantity} onChange={(event) => updateLine(line.key,{quantity:Number(event.target.value)})} /></label>
              <label className="is-price"><span>Unit price</span><input type="number" min={0} step="0.01" value={line.unitPrice} onChange={(event) => updateLine(line.key,{unitPrice:event.target.value})} /></label>
              <output>{formatCurrency(line.quantity*(Number(line.unitPrice)||0))}</output>
              {lines.length>1 ? <button type="button" onClick={() => setLines((current) => current.filter((candidate) => candidate.key!==line.key))}>Remove</button> : null}
            </article>;
          })}</div>
          {generateError ? <p className="quotation-error" role="alert">{generateError}</p> : null}
          <footer><div><span>Quotation total</span><strong>{formatCurrency(total)}</strong></div><div className="quotation-actions"><Button type="button" variant="secondary" loading={generating === "png"} disabled={generating !== null} onClick={() => void generate("png")}>Download image</Button><Button type="submit" variant="primary" loading={generating === "pdf"} disabled={generating !== null}>Download PDF</Button></div></footer>
        </section>
      </form>
      <aside className="quotation-side">
        <section className="quotation-proof"><header><span>QUOTATION</span><b>GENERATE ONLY</b></header><div><small>BILL TO</small><strong>{customerName.trim() || "Enter a customer name"}</strong>{customerContact.trim() ? <p>{customerContact}</p> : null}<p>Valid until {validUntil ? formatDate(validUntil) : "not specified"}</p></div><ul>{lines.map((line) => <li key={line.key}><span>{products.find((product) => product.id===line.productId)?.name ?? "Unselected product"}<small>{line.quantity} × {formatCurrency(Number(line.unitPrice)||0)}</small></span><b>{formatCurrency(line.quantity*(Number(line.unitPrice)||0))}</b></li>)}</ul><footer><span>TOTAL</span><strong>{formatCurrency(total)}</strong></footer></section>
        <section className="quotation-privacy"><span className="numeric">TEMPORARY DRAFT</span><h2>Generated, not registered.</h2><p>This tool creates the file only. Customer and quotation details are discarded when you leave or refresh this page.</p></section>
      </aside>
    </div>
  </div>;
}
