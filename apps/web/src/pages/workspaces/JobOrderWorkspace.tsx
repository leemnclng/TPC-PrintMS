import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
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
import { formatCurrency, formatDate, formatDateTime } from "../../lib/format";
import { printMediaLabel } from "../../lib/printProfiles";
import { jobOrderStatusMeta } from "../../types/statusMeta";
import type { DocumentPricingRule, InventoryItem, InventoryMovement, JobFile, JobOrder, JobOrderItem, Product, ScanPricingTier, Service, SpoolerMonitorInfo } from "../../types/domain";
import { JobMaterialUsageModal } from "../jobOrders/JobMaterialUsageModal";
import { JobPaymentModal } from "../jobOrders/JobPaymentModal";
import { JobPrintSetupModal } from "../jobOrders/JobPrintSetupModal";
import { JobScanSetupModal } from "../jobOrders/JobScanSetupModal";
import { JobTransitionModal } from "../jobOrders/JobTransitionModal";
import { TransactionCreateModal } from "../jobOrders/TransactionCreateModal";
import { JobQualityFailureModal } from "../jobOrders/JobQualityFailureModal";
import { JobCancelModal } from "../jobOrders/JobCancelModal";
import "./Workspace.css";

type TransitionTarget = "queued" | "ready" | "paid" | "completed";
const PAYMENT_METHOD_LABELS = {
  cash: "Cash",
  online: "Online payment",
  bank_transfer: "Bank transfer",
  other: "Other",
};

// Mirrors GlobalPrintActivity's wording for the same underlying spooler
// states, minus the states that only apply to the global cross-job view
// (ready/awaiting_reinsert/awaiting_scan) — this is scoped to one item's own
// print attempts.
const SPOOLER_STATUS_COPY: Record<string, string> = {
  submitted: "Submitted to printer",
  queued: "Waiting in printer queue",
  spooling: "Preparing pages",
  printing: "Still printing",
  paused: "Printer paused",
  error: "Print needs attention",
  released: "Finished — the job left the printer queue",
};

const NEXT_STEP_COPY: Record<string, string> = {
  queued: "Work through each product below. Every line keeps its own operation and progress.",
  printing: "One or more products are in production. Other lines can continue independently.",
  ready: "Every product is ready. Review the breakdown and collect one combined payment.",
  paid: "Complete the job after customer handoff.",
  completed: "Workflow complete. Audit details remain available below.",
};

export function JobOrderWorkspace() {
  const { jobOrderId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const attachSpoolerJobId = searchParams.get("attachSpoolerJobId");
  const [usageOpen, setUsageOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [printItem, setPrintItem] = useState<JobOrderItem | null>(null);
  const [scanItem, setScanItem] = useState<JobOrderItem | null>(null);
  const [transitionTarget, setTransitionTarget] = useState<TransitionTarget | null>(null);
  const [previewFile, setPreviewFile] = useState<JobFile | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [itemActionError, setItemActionError] = useState<string | null>(null);
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const [addProductsOpen, setAddProductsOpen] = useState(false);
  const [attachedSpoolerJobId, setAttachedSpoolerJobId] = useState<string | null>(null);
  const [qualityFailureItem, setQualityFailureItem] = useState<JobOrderItem | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const { data, state, error, reload } = useResource(async () => {
    const [order, materialMovements, services, products, inventoryItems, pricingRules, scanPricingTiers, spoolerMonitor] = await Promise.all([
      api.get<JobOrder>(`/job-orders/${jobOrderId}`),
      api.get<InventoryMovement[]>(`/inventory-movements?job_order_id=${encodeURIComponent(jobOrderId ?? "")}`),
      api.get<Service[]>("/services"),
      api.get<Product[]>("/products"),
      api.get<InventoryItem[]>("/inventory-items"),
      api.get<DocumentPricingRule[]>("/document-analyzer/pricing-rules"),
      api.get<ScanPricingTier[]>("/document-analyzer/scan-pricing-tiers"),
      api.get<SpoolerMonitorInfo>("/printers/spooler-jobs").catch(() => null),
    ]);
    return { order, materialMovements, services, products, inventoryItems, pricingRules, scanPricingTiers, spoolerMonitor };
  }, [jobOrderId]);

  // Arriving here from the "Add to order" picker (ExternalPrintPrompt →
  // JobOrdersPage's order picker) carries the tracked print's id in the URL.
  // Consume it once data is in hand: open "Add products" pre-attached to
  // that print, then strip the param so a reload/back doesn't repeat this.
  useEffect(() => {
    if (!data || !attachSpoolerJobId) return;
    const eligible = ["queued", "printing", "ready"].includes(data.order.status);
    const stillAvailable = (data.spoolerMonitor?.jobs ?? []).some(
      (job) => job.id === attachSpoolerJobId && job.reviewStatus === "unreviewed",
    );
    if (eligible && stillAvailable) {
      setAttachedSpoolerJobId(attachSpoolerJobId);
      setAddProductsOpen(true);
    } else {
      setItemActionError(
        !eligible
          ? "This order can no longer accept new products, so the tracked print could not be added automatically."
          : "That tracked print is no longer available — it may already have been recorded elsewhere.",
      );
    }
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("attachSpoolerJobId");
    setSearchParams(nextParams, { replace: true });
    // Only the arrival of attachSpoolerJobId (and data becoming available)
    // should trigger this — searchParams/setSearchParams are stable setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, attachSpoolerJobId]);

  if (state === "loading") return <LoadingState label="Loading job order…" />;
  if (state === "error") return <ErrorState description={error ?? undefined} onRetry={reload} />;
  if (!data) return <EmptyState title="Job order not found" description="It may have been removed." />;

  const { order, materialMovements, services, products, inventoryItems, pricingRules, scanPricingTiers, spoolerMonitor } = data;
  const otherObservedPrintJobs = (spoolerMonitor?.jobs ?? []).filter(
    (job) => job.reviewStatus === "unreviewed" && job.id !== attachedSpoolerJobId,
  );
  const firstProduct = products.find((product) => product.id === order.items[0]?.productId);
  const initialService = services.find((service) => service.id === firstProduct?.serviceId)
    ?? services.find((service) => service.isActive && service.productCount > 0);
  const outstanding = Math.max(order.total - order.amountPaid, 0);
  const plannedMaterials = order.items.flatMap((item) => item.materials);
  const hasRemainingMaterials = plannedMaterials.some((material) => material.consumedQuantity + 1e-9 < material.plannedQuantity);
  const canRecordFallbackUsage = hasRemainingMaterials && ["printing", "ready", "paid", "completed"].includes(order.status);
  function workflowAction() {
    if (order.status === "ready") {
      return <Button variant="primary" onClick={() => (outstanding > 0 ? setPaymentOpen(true) : setTransitionTarget("paid"))}>Record combined payment</Button>;
    }
    if (order.status === "paid") return <Button variant="primary" onClick={() => setTransitionTarget("completed")}>Complete job order</Button>;
    return null;
  }

  function handleUpdated() {
    setPaymentOpen(false);
    setPrintItem(null);
    setScanItem(null);
    setTransitionTarget(null);
    setQualityFailureItem(null);
    setCancelOpen(false);
    reload();
  }

  async function downloadJobFile(jobFile: JobFile) {
    setDownloadError(null);
    try {
      const blob = await api.download(`/job-orders/${order.id}/files/${jobFile.id}`);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = jobFile.originalFilename;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (caught) {
      setDownloadError(caught instanceof Error ? caught.message : "The scan output could not be downloaded.");
    }
  }

  async function transitionItem(item: JobOrderItem, toStatus: "queued" | "ready") {
    setBusyItemId(item.id);
    setItemActionError(null);
    try {
      await api.post<JobOrder>(`/job-orders/${order.id}/items/${item.id}/transitions`, { toStatus });
      reload();
    } catch (caught) {
      setItemActionError(caught instanceof Error ? caught.message : "The product progress could not be updated.");
    } finally {
      setBusyItemId(null);
    }
  }

  function toggleItemProcess(itemId: string) {
    const opening = expandedItemId !== itemId;
    // Refresh on open so a "still printing" line shows the freshest spooler
    // snapshot rather than whatever was last fetched, possibly minutes ago.
    if (opening && order.items.find((candidate) => candidate.id === itemId)?.status === "printing") reload();
    setExpandedItemId(opening ? itemId : null);
  }

  return (
    <>
      <PageHeader
        eyebrow="JOB ORDER WORKFLOW"
        title={order.name}
        description={`${order.number} · ${order.customerName ? order.customerName : "Walk-in order"} · complete every production step here`}
        actions={<><LinkButton to="/job-orders" variant="secondary">All job orders</LinkButton>{["queued", "printing", "ready"].includes(order.status) && order.amountPaid === 0 ? <Button variant="danger" onClick={() => setCancelOpen(true)}>Cancel order</Button> : null}<StatusPill label={jobOrderStatusMeta[order.status].label} tone={jobOrderStatusMeta[order.status].tone} /></>}
      />

      <section className="job-command" aria-labelledby="job-command-title">
        <div className="job-command__heading">
          <div><span className="numeric">TRANSACTION STATUS</span><h2 id="job-command-title">{jobOrderStatusMeta[order.status].label}</h2><p>{NEXT_STEP_COPY[order.status] ?? "This transaction has no active production action."}</p></div>
          {workflowAction()}
        </div>
        <ol className="job-workflow-steps">
          {order.status === "cancelled" ? <li className="is-cancelled"><span className="numeric">×</span><strong>Transaction cancelled</strong></li> : <><li className={order.status === "queued" || order.status === "printing" ? "is-active" : "is-complete"}><span className="numeric">01</span><strong>Production</strong></li>
          <li className={order.status === "ready" ? "is-active" : ["paid", "completed"].includes(order.status) ? "is-complete" : ""}><span className="numeric">02</span><strong>Ready together</strong></li>
          <li className={order.status === "paid" ? "is-active" : order.status === "completed" ? "is-complete" : ""}><span className="numeric">03</span><strong>Paid</strong></li>
          <li className={order.status === "completed" ? "is-active" : ""}><span className="numeric">04</span><strong>Completed</strong></li></>}
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
          <CardHeader title="Payment breakdown" meta={`${order.items.length} product ${order.items.length === 1 ? "line" : "lines"}`} />
          <div className="job-line-breakdown">
            {order.items.map((item) => <div key={item.id}><span><strong>{item.productName}</strong><small>{item.serviceName} · {item.pagesPerCopy} pages × {item.copies}</small></span><b>{formatCurrency(item.lineTotal)}</b></div>)}
          </div>
        </Card>
      </div>

      <section className="job-operation-board" aria-labelledby="job-operation-title">
        <header><div><span className="numeric">PRODUCTION LINES</span><h2 id="job-operation-title">Independent work progress</h2><p>Device interaction and quality review stay with each product. Payment unlocks only when all lines are ready.</p></div><div className="job-operation-board__actions"><b>{order.items.filter((item) => item.status === "ready").length}/{order.items.length} ready</b>{initialService && ["queued", "printing", "ready"].includes(order.status) ? <Button variant="secondary" onClick={() => setAddProductsOpen(true)}>Add products</Button> : null}</div></header>
        <div className="job-operation-grid">
          {order.items.map((item, index) => {
            const itemFiles = order.files.filter((file) => file.jobOrderItemId === item.id || (!file.jobOrderItemId && order.items.length === 1));
            const sourceFile = itemFiles.find((file) => file.kind === "print_ready");
            const scanOutput = itemFiles.find((file) => file.kind === "scan_output");
            const paper = item.materials.find((material) => material.paperSize);
            const latestPrintAttempt = order.printAttempts
              .filter((attempt) => attempt.jobOrderItemId === item.id && attempt.result === "succeeded")
              .sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime())[0];
            const statusLabel = item.status === "printing" ? "Printing" : item.status === "ready" ? "Ready" : "Queued";
            const tone = item.status === "ready" ? "success" : item.status === "printing" ? "info" : "warning";
            const isExpanded = expandedItemId === item.id;
            const processRegionId = `job-line-process-${item.id}`;
            const productionLocked = ["paid", "completed", "cancelled"].includes(order.status);
            const processMeta = order.status === "cancelled"
              ? { label: "Cancelled record", title: "Production stopped", description: "This line is locked with its existing attempts, files, and material history retained." }
              : order.status === "completed"
                ? { label: "Completed record", title: "Production complete", description: "This line is complete. Its output and production history remain available for reference." }
                : order.status === "paid"
                  ? { label: "Handoff record", title: "Ready for handoff", description: "Production is locked after payment. Complete the transaction from the status panel after customer handoff." }
                  : item.status === "ready"
                    ? { label: "Quality review", title: "Review the finished output", description: "If the output is accepted, no line action is needed. If it failed inspection, start a reprocess for this product only." }
                    : item.status === "printing"
                      ? { label: "Output confirmation", title: "Confirm the printed output", description: "Check the printer and physical pages, then record that this product finished printing." }
                      : item.operationKind === "scan"
                        ? { label: "Scanner step", title: "Acquire the document", description: "Open the scanner controls, capture every page, and review the retained softcopy." }
                        : item.operationKind === "photocopy"
                          ? { label: "Device step", title: "Record the photocopy", description: "Complete the copies at the printer, inspect them, then record completion and material use." }
                          : { label: "Print step", title: "Prepare and print", description: "Open print setup to select the device, verify output settings, and submit this product." };
            return (
              <article
                className={`job-operation-card${isExpanded ? " is-expanded" : ""}`}
                key={item.id}
                onClick={(event) => {
                  const target = event.target;
                  if (target instanceof Element && target.closest("button, a, input, select, textarea, .job-operation-card__process")) return;
                  toggleItemProcess(item.id);
                }}
              >
                <header><span className="numeric">LINE {String(index + 1).padStart(2, "0")}</span><span className="job-operation-card__status">{item.reprocessCount > 0 ? <b>Reprocess × {item.reprocessCount}</b> : null}<StatusPill label={statusLabel} tone={tone} /></span></header>
                <div className="job-operation-card__title"><div><h3>{item.productName}</h3><p>{item.serviceName} · {item.operationKind} workflow</p></div><strong>{formatCurrency(item.lineTotal)}</strong></div>
                <dl>
                  <div><dt>Quantity</dt><dd>{item.operationKind === "scan" && !scanOutput ? "Detected after scan" : `${item.pagesPerCopy} pages × ${item.copies}`}</dd></div>
                  <div><dt>{item.operationKind === "scan" ? "Softcopy" : item.operationKind === "photocopy" ? "Paper" : "Source"}</dt><dd>{item.operationKind === "scan" ? scanOutput?.originalFilename ?? "Not acquired" : item.operationKind === "photocopy" ? paper ? `${paper.paperSize} · ${paper.inventoryItemName}` : "Not configured" : sourceFile?.originalFilename ?? "Unavailable"}</dd></div>
                  <div><dt>Output</dt><dd>{item.operationKind === "scan" ? "Digital file" : item.printSides === "double_sided" ? "Back-to-back" : "Single-sided"}</dd></div>
                  <div><dt>Progress records</dt><dd>{item.statusEvents.length} status · {order.printAttempts.filter((attempt) => attempt.jobOrderItemId === item.id).length} attempts</dd></div>
                </dl>
                <button
                  type="button"
                  className="job-operation-card__step-toggle"
                  aria-expanded={isExpanded}
                  aria-controls={processRegionId}
                  onClick={() => toggleItemProcess(item.id)}
                >
                  <span><small>LINE PROCESS</small><strong>{processMeta.label}</strong></span>
                  <b>{isExpanded ? "Close step" : "Open step"}<i aria-hidden="true">{isExpanded ? "−" : "+"}</i></b>
                </button>
                {isExpanded ? (
                  <section className="job-operation-card__process" id={processRegionId} aria-label={`${item.productName} process actions`}>
                    <div>
                      <span className="numeric">ACTIVE STEP</span><h4>{processMeta.title}</h4><p>{processMeta.description}</p>
                      {item.status === "printing" && latestPrintAttempt ? (
                        <p className={`job-print-spooler-hint${latestPrintAttempt.spoolerStatus === "released" ? " is-released" : latestPrintAttempt.spoolerStatus === "error" ? " is-attention" : " is-active"}`}>
                          <strong>Windows spooler:</strong> {SPOOLER_STATUS_COPY[latestPrintAttempt.spoolerStatus]}
                          {latestPrintAttempt.spoolerTotalPages ? ` · ${latestPrintAttempt.spoolerPagesPrinted ?? 0} of ${latestPrintAttempt.spoolerTotalPages} pages` : ""}
                          {latestPrintAttempt.spoolerStatus === "released" ? "" : " — reopen this step to refresh before confirming if you're not sure it's actually done."}
                        </p>
                      ) : null}
                    </div>
                    <footer>
                      {!productionLocked && item.status === "queued" && item.operationKind === "printing" ? <Button variant="primary" onClick={() => setPrintItem(item)}>Open print setup</Button> : null}
                      {!productionLocked && item.status === "queued" && item.operationKind === "scan" ? <Button variant="primary" onClick={() => setScanItem(item)}>Start scanning</Button> : null}
                      {!productionLocked && item.status === "queued" && item.operationKind === "photocopy" ? <Button variant="primary" loading={busyItemId === item.id} onClick={() => transitionItem(item, "ready")}>Record photocopy complete</Button> : null}
                      {!productionLocked && item.status === "printing" ? <Button variant="primary" loading={busyItemId === item.id} onClick={() => transitionItem(item, "ready")}>Printing finished</Button> : null}
                      {!productionLocked && item.status === "ready" ? <Button variant="danger" onClick={() => setQualityFailureItem(item)}>Failed quality</Button> : null}
                      {scanOutput ? <><Button variant="secondary" onClick={() => setPreviewFile(scanOutput)}>View softcopy</Button><Button variant="ghost" onClick={() => downloadJobFile(scanOutput)}>Download</Button></> : null}
                    </footer>
                  </section>
                ) : null}
              </article>
            );
          })}
        </div>
        {itemActionError || downloadError ? <p className="workspace-form__error" role="alert">{itemActionError || downloadError}</p> : null}
      </section>

      <details className="job-audit-panel">
        <summary><span><strong>History and audit</strong><small>Payments, printing, materials, and status events</small></span><b className="numeric">{order.payments.length + order.printAttempts.length + materialMovements.length + order.statusEvents.length} records</b></summary>
        <div className="job-audit-grid">
          <section>
            <header><h3>Payments</h3></header>
            {order.payments.length ? order.payments.map((payment) => <div className="job-audit-row" key={payment.id}><span><strong>{PAYMENT_METHOD_LABELS[payment.method]}</strong><small>{formatDateTime(payment.recordedAt)}</small></span><b>{formatCurrency(payment.amount)}</b></div>) : <p>No payments recorded.</p>}
          </section>
          <section>
            <header><h3>Print attempts</h3></header>
            {order.printAttempts.length ? order.printAttempts.map((attempt) => <div className="job-audit-row" key={attempt.id}><span><strong>{attempt.printerName}</strong><small>{attempt.duplexPass === "front" ? "Front-side pass · " : attempt.duplexPass === "back" ? "Back-side pass · " : ""}{attempt.mediaSize} · {printMediaLabel(attempt.mediaType)} · {attempt.orientation} · {attempt.quality}{attempt.errorMessage ? ` · ${attempt.errorMessage}` : ""}</small></span><StatusPill label={attempt.result === "succeeded" ? "Submitted" : attempt.result} tone={attempt.result === "succeeded" ? "success" : attempt.result === "failed" ? "danger" : "info"} /></div>) : <p>No print attempts recorded.</p>}
          </section>
          <section>
            <header><h3>Materials</h3>{canRecordFallbackUsage && <Button size="sm" variant="secondary" onClick={() => setUsageOpen(true)}>Record remaining</Button>}</header>
            {materialMovements.length ? materialMovements.map((movement) => <div className="job-audit-row" key={movement.id}><span><strong>{movement.inventoryItemName}</strong><small>{formatDateTime(movement.occurredAt)} · balance {movement.balanceAfter}</small></span><b>{Math.abs(movement.quantityDelta)} {movement.inventoryItemUnit}</b></div>) : <p>No inventory usage has been recorded yet.</p>}
          </section>
          <section>
            <header><h3>Status timeline</h3></header>
            {order.statusEvents.length ? order.statusEvents.map((event) => <div className="job-audit-row" key={event.id}><span><strong>{jobOrderStatusMeta[event.toStatus as keyof typeof jobOrderStatusMeta]?.label ?? event.toStatus}</strong><small>{event.note || "Status updated"}</small></span><time dateTime={event.occurredAt}>{formatDateTime(event.occurredAt)}</time></div>) : <p>No status events recorded.</p>}
          </section>
        </div>
      </details>

      <JobPaymentModal open={paymentOpen} order={order} onClose={() => setPaymentOpen(false)} onRecorded={handleUpdated} />
      <JobTransitionModal open={transitionTarget !== null} order={order} targetStatus={transitionTarget ?? "queued"} onClose={() => setTransitionTarget(null)} onTransitioned={handleUpdated} />
      {printItem ? <JobPrintSetupModal open order={order} item={printItem} onClose={() => { setPrintItem(null); reload(); }} onPrinted={handleUpdated} /> : null}
      {scanItem ? <JobScanSetupModal open order={order} item={scanItem} onClose={() => { setScanItem(null); reload(); }} onScanned={handleUpdated} /> : null}
      <JobMaterialUsageModal open={usageOpen} order={order} onClose={() => setUsageOpen(false)} onRecorded={() => { setUsageOpen(false); reload(); }} />
      {previewFile ? <ScanOutputPreviewModal open orderId={order.id} jobFile={previewFile} onClose={() => setPreviewFile(null)} /> : null}
      {initialService ? <TransactionCreateModal open={addProductsOpen} order={order} initialService={initialService} services={services} products={products} inventoryItems={inventoryItems} pricingRules={pricingRules} scanPricingTiers={scanPricingTiers} sourceSpoolerJobId={attachedSpoolerJobId} otherObservedPrintJobs={otherObservedPrintJobs} customers={[]} onClose={() => { setAddProductsOpen(false); setAttachedSpoolerJobId(null); }} onCreated={() => { setAddProductsOpen(false); setAttachedSpoolerJobId(null); reload(); }} /> : null}
      {qualityFailureItem ? <JobQualityFailureModal open order={order} item={qualityFailureItem} onClose={() => setQualityFailureItem(null)} onReprocessed={handleUpdated} /> : null}
      <JobCancelModal open={cancelOpen} order={order} onClose={() => setCancelOpen(false)} onCancelled={handleUpdated} />
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
