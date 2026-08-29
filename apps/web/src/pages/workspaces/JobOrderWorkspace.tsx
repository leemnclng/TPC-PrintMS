import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Button } from "../../components/Button/Button";
import { LinkButton } from "../../components/Button/LinkButton";
import { PageHeader } from "../../components/PageHeader/PageHeader";
import { Card, CardHeader } from "../../components/Card/Card";
import { StatusPill } from "../../components/StatusPill/StatusPill";
import { Modal } from "../../components/Modal/Modal";
import { PdfViewer } from "../../components/PdfViewer/PdfViewer";
import { EmptyState } from "../../components/EmptyState/EmptyState";
import { LoadingState } from "../../components/LoadingState/LoadingState";
import { ErrorState } from "../../components/ErrorState/ErrorState";
import { useResource } from "../../hooks/useResource";
import { api } from "../../lib/apiClient";
import { formatCurrency, formatDate, formatDateTime, formatFileSize } from "../../lib/format";
import { jobOrderStatusMeta } from "../../types/statusMeta";
import type { InventoryMovement, JobFile, JobOrder, JobOrderStatus } from "../../types/domain";
import { JobMaterialUsageModal } from "../jobOrders/JobMaterialUsageModal";
import { JobPaymentModal } from "../jobOrders/JobPaymentModal";
import { JobPrintSetupModal } from "../jobOrders/JobPrintSetupModal";
import { JobScanSetupModal } from "../jobOrders/JobScanSetupModal";
import { JobTransitionModal } from "../jobOrders/JobTransitionModal";
import "./Workspace.css";

const PRODUCTION_STEPS = ["queued", "printing", "ready", "paid", "completed"] as const;
type TransitionTarget = "queued" | "ready" | "paid" | "completed";
const PAYMENT_METHOD_LABELS = {
  cash: "Cash",
  online: "Online payment",
  bank_transfer: "Bank transfer",
  other: "Other",
};

// "queued" is overridden per operation kind at the call site below — a scan
// job never touches a printer, so it must not carry this print-queue copy.
const NEXT_STEP_COPY: Record<string, string> = {
  queued: "Check for ongoing printing, then proceed to print.",
  printing: "Confirm physical printing before quality review.",
  ready: "Inspect the output. Re-print if it isn't right, or mark it ready to collect payment.",
  paid: "Complete the job after customer handoff.",
  completed: "Workflow complete. Audit details remain available below.",
};

export function JobOrderWorkspace() {
  const { jobOrderId } = useParams();
  const [usageOpen, setUsageOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [transitionTarget, setTransitionTarget] = useState<TransitionTarget | null>(null);
  const [scanPreviewOpen, setScanPreviewOpen] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const { data, state, error, reload } = useResource(async () => {
    const [order, materialMovements] = await Promise.all([
      api.get<JobOrder>(`/job-orders/${jobOrderId}`),
      api.get<InventoryMovement[]>(`/inventory-movements?job_order_id=${encodeURIComponent(jobOrderId ?? "")}`),
    ]);
    return { order, materialMovements };
  }, [jobOrderId]);

  if (state === "loading") return <LoadingState label="Loading job order…" />;
  if (state === "error") return <ErrorState description={error ?? undefined} onRetry={reload} />;
  if (!data) return <EmptyState title="Job order not found" description="It may have been removed." />;

  const { order, materialMovements } = data;
  const operationKind = order.items[0]?.operationKind ?? "printing";
  const isScan = operationKind === "scan";
  const isPhotocopy = operationKind === "photocopy";
  // Photocopy is produced entirely on the device, so it has no queue step.
  // Scan does: the acquisition happens inside this job after creation, so it
  // waits in Queued just like a print job does before Ready.
  const productionSteps: readonly JobOrderStatus[] = isPhotocopy
    ? ["ready", "paid", "completed"]
    : isScan
      ? ["queued", "ready", "paid", "completed"]
      : PRODUCTION_STEPS;
  const activeStepIndex = productionSteps.indexOf(order.status);
  const outstanding = Math.max(order.total - order.amountPaid, 0);
  const printFile = order.files.find((file) => file.kind === "print_ready");
  const scanOutput = order.files.find((file) => file.kind === "scan_output");
  const paperPlan = order.items.flatMap((item) => item.materials).find((material) => material.paperSize);
  const plannedMaterials = order.items.flatMap((item) => item.materials);
  const usedMaterials = plannedMaterials.filter((material) => material.consumedQuantity + 1e-9 >= material.plannedQuantity).length;
  const hasRemainingMaterials = plannedMaterials.some((material) => material.consumedQuantity + 1e-9 < material.plannedQuantity);
  const canRecordFallbackUsage = hasRemainingMaterials && ["printing", "ready", "paid", "completed"].includes(order.status);
  function workflowAction() {
    if (order.status === "queued") {
      if (isScan) return <Button variant="primary" onClick={() => setScanOpen(true)}>Proceed to scan</Button>;
      return <Button variant="primary" onClick={() => setPrintOpen(true)}>Proceed to print</Button>;
    }
    if (order.status === "printing") return <Button variant="primary" onClick={() => setTransitionTarget("ready")}>Printing finished</Button>;
    if (order.status === "ready") {
      if (isPhotocopy) {
        return <Button variant="primary" onClick={() => (outstanding > 0 ? setPaymentOpen(true) : setTransitionTarget("paid"))}>Record payment</Button>;
      }
      return (
        <div className="job-command__quality-actions">
          <Button variant="secondary" onClick={() => setTransitionTarget("queued")}>{isScan ? "Needs re-scan" : "Needs re-print"}</Button>
          <Button variant="primary" onClick={() => (outstanding > 0 ? setPaymentOpen(true) : setTransitionTarget("paid"))}>Mark ready</Button>
        </div>
      );
    }
    if (order.status === "paid") return <Button variant="primary" onClick={() => setTransitionTarget("completed")}>Complete job order</Button>;
    return null;
  }

  function handleUpdated() {
    setPaymentOpen(false);
    setPrintOpen(false);
    setScanOpen(false);
    setTransitionTarget(null);
    reload();
  }

  async function downloadScanOutput() {
    if (!scanOutput) return;
    setDownloadError(null);
    try {
      const blob = await api.download(`/job-orders/${order.id}/files/${scanOutput.id}`);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = scanOutput.originalFilename;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (caught) {
      setDownloadError(caught instanceof Error ? caught.message : "The scan output could not be downloaded.");
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="JOB ORDER WORKFLOW"
        title={order.name}
        description={`${order.number} · ${order.customerName ? order.customerName : "Walk-in order"} · complete every production step here`}
        actions={<><LinkButton to="/job-orders" variant="secondary">All job orders</LinkButton><StatusPill label={jobOrderStatusMeta[order.status].label} tone={jobOrderStatusMeta[order.status].tone} /></>}
      />

      <section className="job-command" aria-labelledby="job-command-title">
        <div className="job-command__heading">
          <div><span className="numeric">CURRENT STEP</span><h2 id="job-command-title">{(isScan || isPhotocopy) && order.status === "ready" ? (isScan ? "Softcopy ready" : "Photocopy recorded") : jobOrderStatusMeta[order.status].label}</h2><p>{isPhotocopy && order.status === "ready" ? "Device-side work is recorded and materials are deducted. Collect payment to continue." : isScan && order.status === "ready" ? "The scanner output is retained. Inspect it, then collect payment or send it back for a re-scan." : isScan && order.status === "queued" ? "Proceed to scan when you're ready; the job stays queued until a softcopy is submitted." : NEXT_STEP_COPY[order.status] ?? "This job has no active production action."}</p></div>
          {workflowAction()}
        </div>
        <ol className="job-workflow-steps">
          {productionSteps.map((status, index) => (
            <li className={index < activeStepIndex ? "is-complete" : index === activeStepIndex ? "is-active" : ""} key={status} aria-current={index === activeStepIndex ? "step" : undefined}>
              <span className="numeric">{String(index + 1).padStart(2, "0")}</span>
              <strong>{(isScan || isPhotocopy) && status === "ready" ? (isScan ? "Softcopy ready" : "Photocopy recorded") : jobOrderStatusMeta[status].label}</strong>
            </li>
          ))}
        </ol>
      </section>

      <div className="job-command-grid">
        <Card>
          <CardHeader title="Transaction" meta={order.customerName || "Walk-in"} />
          <dl className="job-essential-facts">
            <div className="is-primary"><dt>Final price</dt><dd>{formatCurrency(order.total)}</dd></div>
            <div><dt>Paid</dt><dd>{formatCurrency(order.amountPaid)}</dd></div>
            <div><dt>Balance</dt><dd>{formatCurrency(outstanding)}</dd></div>
            <div><dt>Due</dt><dd>{formatDate(order.dueDate)}</dd></div>
          </dl>
          {order.priceOverridden && <p className="job-compact-note">Owner price · engine suggested {formatCurrency(order.suggestedTotal)}</p>}
          {order.notes && <p className="job-compact-note"><strong>Note:</strong> {order.notes}</p>}
        </Card>

        <Card>
          <CardHeader title="Production brief" meta={isScan ? "Digital deliverable" : `${usedMaterials}/${plannedMaterials.length} materials used`} action={isScan && scanOutput ? <div className="job-softcopy-actions"><Button size="sm" variant="secondary" onClick={() => setScanPreviewOpen(true)}>View softcopy</Button><Button size="sm" variant="ghost" onClick={downloadScanOutput}>Download</Button></div> : undefined} />
          <div className="job-production-brief">
            {order.items.map((item) => (
              <div key={item.id}><strong>{item.productName}</strong><span>{item.variantLabel ? `${item.variantLabel} · ` : ""}{item.pagesPerCopy} pages × {item.copies} copies</span></div>
            ))}
            <dl>
              <div><dt>{isScan ? "Softcopy" : operationKind === "photocopy" ? "Production" : "Print file"}</dt><dd>{isScan ? scanOutput?.originalFilename ?? "No scan output" : operationKind === "photocopy" ? "Completed on photocopier · no file required" : printFile?.originalFilename ?? "No print-ready file"}</dd></div>
              <div><dt>{isScan ? "Inventory" : "Paper"}</dt><dd>{isScan ? "No paper or ink used" : paperPlan ? `${paperPlan.paperSize} · ${paperPlan.inventoryItemName}` : "Not configured"}</dd></div>
              <div><dt>{isScan ? "Scanned pages" : operationKind === "photocopy" ? "Sides" : "Detected fit"}</dt><dd>{isScan ? scanOutput?.detectedPageCount ?? order.items[0]?.pagesPerCopy : operationKind === "photocopy" ? (order.items[0]?.printSides === "double_sided" ? "Back-to-back" : "Single-sided") : printFile?.detectedPaperSize ?? "—"}</dd></div>
              <div><dt>{isScan ? "File size" : operationKind === "photocopy" ? "Paper used" : "File size"}</dt><dd>{isScan ? scanOutput ? formatFileSize(scanOutput.sizeBytes) : "—" : operationKind === "photocopy" ? `${paperPlan?.plannedQuantity ?? 0} ${paperPlan?.inventoryItemUnit ?? "sheets"}` : printFile ? formatFileSize(printFile.sizeBytes) : "—"}</dd></div>
            </dl>
            {downloadError ? <p className="workspace-form__error" role="alert">{downloadError}</p> : null}
          </div>
        </Card>
      </div>

      <details className="job-audit-panel">
        <summary><span><strong>History and audit</strong><small>Payments, printing, materials, and status events</small></span><b className="numeric">{order.payments.length + order.printAttempts.length + materialMovements.length + order.statusEvents.length} records</b></summary>
        <div className="job-audit-grid">
          <section>
            <header><h3>Payments</h3></header>
            {order.payments.length ? order.payments.map((payment) => <div className="job-audit-row" key={payment.id}><span><strong>{PAYMENT_METHOD_LABELS[payment.method]}</strong><small>{formatDateTime(payment.recordedAt)}</small></span><b>{formatCurrency(payment.amount)}</b></div>) : <p>No payments recorded.</p>}
          </section>
          <section>
            <header><h3>Print attempts</h3></header>
            {order.printAttempts.length ? order.printAttempts.map((attempt) => <div className="job-audit-row" key={attempt.id}><span><strong>{attempt.printerName}</strong><small>{attempt.duplexPass === "front" ? "Front-side pass · " : attempt.duplexPass === "back" ? "Back-side pass · " : ""}{attempt.mediaSize} · {attempt.orientation} · {attempt.quality}{attempt.errorMessage ? ` · ${attempt.errorMessage}` : ""}</small></span><StatusPill label={attempt.result === "succeeded" ? "Submitted" : attempt.result} tone={attempt.result === "succeeded" ? "success" : attempt.result === "failed" ? "danger" : "info"} /></div>) : <p>No print attempts recorded.</p>}
          </section>
          <section>
            <header><h3>Materials</h3>{canRecordFallbackUsage && <Button size="sm" variant="secondary" onClick={() => setUsageOpen(true)}>Record remaining</Button>}</header>
            {materialMovements.length ? materialMovements.map((movement) => <div className="job-audit-row" key={movement.id}><span><strong>{movement.inventoryItemName}</strong><small>{formatDateTime(movement.occurredAt)} · balance {movement.balanceAfter}</small></span><b>{Math.abs(movement.quantityDelta)} {movement.inventoryItemUnit}</b></div>) : <p>{isScan ? "Scanning uses no tracked inventory materials." : "Materials deduct automatically after printer acceptance."}</p>}
          </section>
          <section>
            <header><h3>Status timeline</h3></header>
            {order.statusEvents.length ? order.statusEvents.map((event) => <div className="job-audit-row" key={event.id}><span><strong>{jobOrderStatusMeta[event.toStatus as keyof typeof jobOrderStatusMeta]?.label ?? event.toStatus}</strong><small>{event.note || "Status updated"}</small></span><time dateTime={event.occurredAt}>{formatDateTime(event.occurredAt)}</time></div>) : <p>No status events recorded.</p>}
          </section>
        </div>
      </details>

      <JobPaymentModal open={paymentOpen} order={order} onClose={() => setPaymentOpen(false)} onRecorded={handleUpdated} />
      <JobTransitionModal open={transitionTarget !== null} order={order} targetStatus={transitionTarget ?? "queued"} onClose={() => setTransitionTarget(null)} onTransitioned={handleUpdated} />
      <JobPrintSetupModal open={printOpen} order={order} onClose={() => { setPrintOpen(false); reload(); }} onPrinted={handleUpdated} />
      <JobScanSetupModal open={scanOpen} order={order} onClose={() => { setScanOpen(false); reload(); }} onScanned={handleUpdated} />
      <JobMaterialUsageModal open={usageOpen} order={order} onClose={() => setUsageOpen(false)} onRecorded={() => { setUsageOpen(false); reload(); }} />
      {scanOutput ? <ScanOutputPreviewModal open={scanPreviewOpen} orderId={order.id} jobFile={scanOutput} onClose={() => setScanPreviewOpen(false)} /> : null}
    </>
  );
}

function ScanOutputPreviewModal({ open, orderId, jobFile, onClose }: { open: boolean; orderId: string; jobFile: JobFile; onClose: () => void }) {
  const [previewFile, setPreviewFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadVersion, setLoadVersion] = useState(0);

  useEffect(() => {
    if (!open) return;
    let disposed = false;
    let objectUrl: string | null = null;
    setLoading(true);
    setError(null);
    setPreviewFile(null);
    setPreviewUrl(null);
    api.download(`/job-orders/${orderId}/files/${jobFile.id}`)
      .then((blob) => {
        if (disposed) return;
        const file = new File([blob], jobFile.originalFilename, { type: blob.type });
        objectUrl = URL.createObjectURL(file);
        setPreviewFile(file);
        setPreviewUrl(objectUrl);
      })
      .catch((caught) => {
        if (!disposed) setError(caught instanceof Error ? caught.message : "The scan preview could not be loaded.");
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [jobFile.id, jobFile.originalFilename, loadVersion, open, orderId]);

  const isPdf = previewFile?.type === "application/pdf" || jobFile.originalFilename.toLowerCase().endsWith(".pdf");
  const imageCanRender = previewFile?.type.startsWith("image/") && !previewFile.type.includes("tiff");
  return (
    <Modal open={open} title="Scanned document" description={`${jobFile.originalFilename} · ${jobFile.detectedPageCount ?? 1} scanned pages`} onClose={onClose} busy={loading} status={error ? "error" : loading ? "loading" : "idle"} className="scan-softcopy-modal">
      <div className="scan-softcopy-preview">
        {loading ? <div className="scan-softcopy-preview__status" role="status">Loading retained softcopy…</div> : null}
        {error ? <div className="scan-softcopy-preview__status" role="alert"><strong>Preview unavailable</strong><p>{error}</p><Button type="button" variant="secondary" onClick={() => setLoadVersion((current) => current + 1)}>Retry</Button></div> : null}
        {previewFile && previewUrl && isPdf ? <PdfViewer file={previewFile} filename={jobFile.originalFilename} downloadUrl={previewUrl} /> : null}
        {previewFile && previewUrl && imageCanRender ? <div className="scan-softcopy-preview__image"><img src={previewUrl} alt={`Scanned document ${jobFile.originalFilename}`} /></div> : null}
        {previewFile && previewUrl && !isPdf && !imageCanRender ? <div className="scan-softcopy-preview__status"><strong>Preview is not available for this image format.</strong><a href={previewUrl} download={jobFile.originalFilename}>Download softcopy</a></div> : null}
      </div>
    </Modal>
  );
}
