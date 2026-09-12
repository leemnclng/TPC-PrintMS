import { useState } from "react";
import { Button } from "../../components/Button/Button";
import { PriceBreakdown } from "../../components/PriceBreakdown/PriceBreakdown";
import { api } from "../../lib/apiClient";
import { formatCurrency, formatDateTime } from "../../lib/format";
import { printMediaLabel } from "../../lib/printProfiles";
import type { JobFile, JobOrder, JobOrderItem, PrintJob } from "../../types/domain";

const label = (value: string) => value.replace(/_/g, " ");
const quantity = (value: number) => new Intl.NumberFormat(undefined, { maximumFractionDigits: 6 }).format(value);

function Attempt({ attempt }: { attempt: PrintJob }) {
  const dimensions = attempt.mediaWidthMm && attempt.mediaHeightMm
    ? ` · ${quantity(attempt.mediaWidthMm)} × ${quantity(attempt.mediaHeightMm)} mm`
    : "";
  return <article className="job-product-config__attempt">
    <header><strong>{attempt.printerName}</strong><time dateTime={attempt.submittedAt}>{formatDateTime(attempt.submittedAt)}</time></header>
    <dl>
      <div><dt>File</dt><dd>{attempt.filename || "No retained filename"}</dd></div>
      <div><dt>Submission</dt><dd>{label(attempt.result)} · spooler {label(attempt.spoolerStatus)}</dd></div>
      <div><dt>Output</dt><dd>{attempt.copies} {attempt.copies === 1 ? "copy" : "copies"} · {label(attempt.colorMode)}</dd></div>
      <div><dt>Paper</dt><dd>{attempt.mediaSize}{dimensions}</dd></div>
      <div><dt>Media type</dt><dd>{printMediaLabel(attempt.mediaType)}</dd></div>
      <div><dt>Orientation</dt><dd>{label(attempt.orientation)}</dd></div>
      <div><dt>Scaling</dt><dd>{label(attempt.scaling)}</dd></div>
      <div><dt>Quality</dt><dd>{label(attempt.quality)}</dd></div>
      <div><dt>Edges</dt><dd>{attempt.borderless ? "Borderless requested" : "Standard printable margins"}</dd></div>
      <div><dt>Collation</dt><dd>{attempt.collate ? "Collated" : "Not collated"}</dd></div>
      <div><dt>Duplex pass</dt><dd>{label(attempt.duplexPass)}</dd></div>
      <div><dt>Operator / OS job</dt><dd>{attempt.operator || "Owner"}{attempt.externalJobId ? ` · ${attempt.externalJobId}` : " · No OS job ID"}</dd></div>
    </dl>
    {attempt.errorMessage ? <p role="alert">{attempt.errorMessage}</p> : null}
  </article>;
}

export function JobProductConfiguration({ order, item, files, attempts, onCorrect, onEditPrice, onCancel }: { order: JobOrder; item: JobOrderItem; files: JobFile[]; attempts: PrintJob[]; onCorrect: () => void; onEditPrice: () => void; onCancel: () => void }) {
  const [fileError, setFileError] = useState<string | null>(null);
  const [openingFileId, setOpeningFileId] = useState<string | null>(null);
  const orderedAttempts = [...attempts].sort((left, right) => new Date(right.submittedAt).getTime() - new Date(left.submittedAt).getTime());
  const output = item.operationKind === "scan" ? "Digital scan" : item.operationKind === "adhoc" ? "External work" : item.printSides === "double_sided" ? "Back-to-back" : "Single-sided";
  const editable = !["paid", "completed", "cancelled"].includes(order.status) && item.status !== "cancelled";
  async function openFile(file: JobFile) {
    setOpeningFileId(file.id); setFileError(null);
    const preview = window.open("", "_blank");
    try {
      const blob = await api.download(`/job-orders/${order.id}/files/${file.id}`);
      const url = URL.createObjectURL(blob);
      if (!preview) throw new Error("The file is available, but the preview window was blocked.");
      preview.location.replace(url);
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (caught) { preview?.close(); setFileError(caught instanceof Error ? caught.message : "The retained file does not exist anymore."); }
    finally { setOpeningFileId(null); }
  }
  return <details className="job-product-config" onClick={(event) => event.stopPropagation()}>
    <summary><span><small>PRODUCT TRANSACTION</small><strong>Configuration and output records</strong></span><b>{orderedAttempts.length ? `${orderedAttempts.length} print ${orderedAttempts.length === 1 ? "attempt" : "attempts"}` : "View details"}<i aria-hidden="true">+</i></b></summary>
    <div className="job-product-config__body">
      <nav className="job-product-config__actions" aria-label={`${item.productName} management`}><span>{item.status === "cancelled" ? "This product was cancelled." : "Product-level controls"}</span>{editable ? <div>{order.status === "ready" ? <Button size="sm" variant="secondary" onClick={onCorrect}>Correct product</Button> : null}<Button size="sm" variant="secondary" onClick={onEditPrice}>Change price</Button><Button size="sm" variant="danger" onClick={onCancel}>Cancel product</Button></div> : null}</nav>
      <section><h4>Transaction configuration</h4><dl>
        <div><dt>Service</dt><dd>{item.serviceName}</dd></div>
        <div><dt>Operation</dt><dd>{label(item.operationKind)}</dd></div>
        <div><dt>Print type</dt><dd>{item.printTypeLabel} · {label(item.printColorMode)}</dd></div>
        <div><dt>Variant</dt><dd>{item.variantLabel || "None"}</dd></div>
        <div><dt>Output</dt><dd>{output}{item.requiresManualDuplex ? " · supervised manual duplex" : ""}</dd></div>
        <div><dt>Quantity</dt><dd>{item.pagesPerCopy} {item.operationKind === "adhoc" ? "units" : "pages"} × {item.copies}</dd></div>
        <div><dt>Unit price</dt><dd>{formatCurrency(item.unitPrice)}</dd></div>
        <div><dt>Line total</dt><dd>{formatCurrency(item.lineTotal)}{order.priceOverridden ? " · transaction contains owner pricing" : ""}</dd></div>
      </dl></section>
      <section><h4>Price breakdown</h4><PriceBreakdown entries={item.pricingBreakdown} total={item.lineTotal} compact /></section>
      <section><h4>Materials</h4>{item.materials.length ? <dl>{item.materials.map((material) => <div key={material.id}><dt>{material.inventoryItemName}</dt><dd>{quantity(material.consumedQuantity)} consumed / {quantity(material.plannedQuantity)} planned {material.inventoryItemUnit}{material.paperSize ? ` · ${material.paperSize}${material.paperWidthMm && material.paperHeightMm ? ` (${quantity(material.paperWidthMm)} × ${quantity(material.paperHeightMm)} mm)` : ""}` : ""}</dd></div>)}</dl> : <p>No material was assigned to this product line.</p>}</section>
      <section><h4>Files and analysis</h4>{files.length ? <dl>{files.map((file) => <div key={file.id}><dt>{file.originalFilename}</dt><dd>{label(file.kind)} · {file.detectedPageCount ?? "unknown"} pages{file.detectedPaperSize ? ` · detected ${file.detectedPaperSize}` : ""}{file.detectedOrientation ? ` · ${file.detectedOrientation}` : ""}{file.detectedColorPages != null && file.detectedBwPages != null ? ` · ${file.detectedColorPages} color / ${file.detectedBwPages} B&W` : ""}{file.estimatedInkCoveragePercent != null ? ` · ${quantity(file.estimatedInkCoveragePercent)}% ink coverage` : ""}{file.isAvailable ? <Button size="sm" variant="ghost" loading={openingFileId === file.id} onClick={() => void openFile(file)}>Open file</Button> : <strong className="job-product-config__missing-file">File does not exist anymore</strong>}</dd></div>)}</dl> : <p>No retained file is associated with this product line.</p>}{fileError ? <p className="job-product-config__file-error" role="alert">{fileError.includes("unavailable") || fileError.includes("not found") ? "The retained file does not exist anymore." : fileError}</p> : null}</section>
      <section className="job-product-config__attempts"><h4>Printer and driver submissions</h4><p>These are the exact settings OMS requested. The installed driver retains final authority over device-specific processing.</p>{orderedAttempts.length ? orderedAttempts.map((attempt) => <Attempt key={attempt.id} attempt={attempt} />) : <p>No printer submission has been recorded yet.</p>}</section>
    </div>
  </details>;
}
