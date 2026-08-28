import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "../../components/Button/Button";
import { LinkButton } from "../../components/Button/LinkButton";
import { PageHeader } from "../../components/PageHeader/PageHeader";
import { Card, CardHeader } from "../../components/Card/Card";
import { StatusPill } from "../../components/StatusPill/StatusPill";
import { EmptyState } from "../../components/EmptyState/EmptyState";
import { LoadingState } from "../../components/LoadingState/LoadingState";
import { ErrorState } from "../../components/ErrorState/ErrorState";
import { useResource } from "../../hooks/useResource";
import { ApiError, api } from "../../lib/apiClient";
import { formatCurrency, formatDate, formatDateTime, formatFileSize } from "../../lib/format";
import { jobOrderStatusMeta } from "../../types/statusMeta";
import type { InventoryMovement, JobOrder } from "../../types/domain";
import { JobMaterialUsageModal } from "../jobOrders/JobMaterialUsageModal";
import { JobPaymentModal } from "../jobOrders/JobPaymentModal";
import "./Workspace.css";

const PRODUCTION_STEPS = ["pending_payment", "paid", "queued", "printing", "quality_check", "ready", "completed"] as const;

const PAYMENT_METHOD_LABELS = {
  cash: "Cash",
  online: "Online payment",
  bank_transfer: "Bank transfer",
  other: "Other",
};

export function JobOrderWorkspace() {
  const { jobOrderId } = useParams();
  const navigate = useNavigate();
  const [usageOpen, setUsageOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const [transitionError, setTransitionError] = useState<string | null>(null);
  const { data, state, error, reload } = useResource(async () => {
    const [order, materialMovements] = await Promise.all([
      api.get<JobOrder>(`/job-orders/${jobOrderId}`),
      api.get<InventoryMovement[]>(`/inventory-movements?job_order_id=${encodeURIComponent(jobOrderId ?? "")}`),
    ]);
    return { order, materialMovements };
  }, [jobOrderId]);

  if (state === "loading") return <LoadingState label="Loading job order…" />;
  if (state === "error") return <ErrorState description={error ?? undefined} />;
  if (!data) return <EmptyState title="Job order not found" description="It may have been removed." />;
  const { order, materialMovements } = data;
  const activeStepIndex = PRODUCTION_STEPS.indexOf(order.status as (typeof PRODUCTION_STEPS)[number]);
  const hasRemainingMaterials = order.items.some((item) =>
    item.materials.some((material) => material.consumedQuantity + 1e-9 < material.plannedQuantity));
  const canRecordFallbackUsage = hasRemainingMaterials && ["printing", "quality_check", "ready", "completed"].includes(order.status);

  async function handleTransition(toStatus: "queued" | "quality_check" | "ready" | "completed") {
    setTransitioning(true);
    setTransitionError(null);
    try {
      await api.post<JobOrder>(`/job-orders/${order.id}/transitions`, { toStatus });
      if (toStatus === "queued") {
        navigate(`/print-center?jobOrderId=${encodeURIComponent(order.id)}`);
      } else {
        reload();
      }
    } catch (caught) {
      setTransitionError(caught instanceof ApiError ? caught.message : "The job status could not be updated.");
    } finally {
      setTransitioning(false);
    }
  }

  function workflowAction() {
    if (order.status === "pending_payment") return <Button variant="primary" onClick={() => setPaymentOpen(true)}>Record payment</Button>;
    if (order.status === "paid") return <Button variant="primary" loading={transitioning} onClick={() => handleTransition("queued")}>Queue for printing</Button>;
    if (order.status === "queued") return <LinkButton variant="primary" to={`/print-center?jobOrderId=${encodeURIComponent(order.id)}`}>Open print setup</LinkButton>;
    if (order.status === "printing") return <Button variant="primary" loading={transitioning} onClick={() => handleTransition("quality_check")}>Printing finished</Button>;
    if (order.status === "quality_check") return <Button variant="primary" loading={transitioning} onClick={() => handleTransition("ready")}>Pass quality check</Button>;
    if (order.status === "ready") return <Button variant="primary" loading={transitioning} onClick={() => handleTransition("completed")}>Complete job order</Button>;
    return null;
  }

  return (
    <>
      <PageHeader
        eyebrow="JOB ORDERS"
        title={order.number}
        description={order.customerName ? `For ${order.customerName}` : "Walk-in order · no customer linked"}
        actions={<StatusPill label={jobOrderStatusMeta[order.status].label} tone={jobOrderStatusMeta[order.status].tone} />}
      />

      <div className="workspace-grid">
        <Card className="workspace-card--wide job-workflow-card">
          <CardHeader title="Production workflow" action={workflowAction()} />
          <ol className="job-workflow-steps">
            {PRODUCTION_STEPS.map((status, index) => (
              <li className={index < activeStepIndex ? "is-complete" : index === activeStepIndex ? "is-active" : ""} key={status}>
                <span className="numeric">{String(index + 1).padStart(2, "0")}</span>
                <strong>{jobOrderStatusMeta[status].label}</strong>
              </li>
            ))}
          </ol>
          {transitionError && <p className="workspace-action-error" role="alert">{transitionError}</p>}
          {order.status === "completed" && <p className="job-workflow-complete">This job order is complete. Payment, print attempts, and production history remain available below.</p>}
        </Card>

        <Card>
          <CardHeader title="Order summary" />
          <dl className="workspace-fact-list">
            <div>
              <dt>Final price</dt>
              <dd className="numeric">{formatCurrency(order.total)}</dd>
            </div>
            <div>
              <dt>Engine suggestion</dt>
              <dd className="numeric">{formatCurrency(order.suggestedTotal)}{order.priceOverridden ? " · owner override" : ""}</dd>
            </div>
            <div>
              <dt>Paid</dt>
              <dd className="numeric">{formatCurrency(order.amountPaid)}</dd>
            </div>
            <div>
              <dt>Due date</dt>
              <dd>{formatDate(order.dueDate)}</dd>
            </div>
            <div>
              <dt>Linked quotation</dt>
              <dd>{order.quotationId ?? "— (created without a quotation)"}</dd>
            </div>
            <div>
              <dt>Notes</dt>
              <dd>{order.notes || "—"}</dd>
            </div>
          </dl>
        </Card>

        <Card>
          <CardHeader
            title="Payments"
            action={order.status === "pending_payment" ? <Button size="sm" onClick={() => setPaymentOpen(true)}>Record payment</Button> : undefined}
          />
          {order.payments.length === 0 ? (
            <EmptyState title="No payment recorded" description={`Outstanding balance: ${formatCurrency(Math.max(order.total - order.amountPaid, 0))}.`} />
          ) : (
            <div className="workspace-payment-list">
              {order.payments.map((payment) => (
                <div key={payment.id}>
                  <div><strong>{PAYMENT_METHOD_LABELS[payment.method]}</strong><span>{formatDateTime(payment.recordedAt)} · {payment.verified ? "Verified" : "Unverified"}</span></div>
                  <strong className="numeric">{formatCurrency(payment.amount)}</strong>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="workspace-card--wide">
          <CardHeader title="Products" meta={`${order.items.length} ${order.items.length === 1 ? "line" : "lines"}`} />
          <div className="workspace-order-lines">
            {order.items.map((item) => (
              <article key={item.id}>
                <div className="workspace-order-line__heading">
                  <div>
                    <strong>{item.productName}</strong>
                    <span>{item.serviceName}{item.variantLabel ? ` · ${item.variantLabel}` : ""}</span>
                  </div>
                  <div className="workspace-order-line__pricing">
                    <strong>{formatCurrency(item.lineTotal)}</strong>
                    <span>{item.pagesPerCopy.toLocaleString()} pages × {item.copies.toLocaleString()} copies × {formatCurrency(item.unitPrice)}</span>
                  </div>
                </div>
                <div className="workspace-order-line__materials">
                  {item.materials.map((material) => (
                    <div key={material.id}>
                      <span>{material.inventoryItemName}</span>
                      <strong>{material.consumedQuantity.toLocaleString()} / {material.plannedQuantity.toLocaleString()} {material.inventoryItemUnit} used{material.consumedQuantity + 1e-9 >= material.plannedQuantity ? " · deducted" : ""}</strong>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader title="Files" meta={`${order.files.length} ${order.files.length === 1 ? "file" : "files"}`} />
          {order.files.length === 0 ? (
            <EmptyState title="No files attached" description="Confirmed analyzed transactions attach their approved print-ready file here." />
          ) : (
            <div className="workspace-file-list">
              {order.files.map((file) => (
                <div key={file.id}>
                  <span className="numeric">{file.kind === "print_ready" ? "READY" : "SOURCE"}</span>
                  <div><strong>{file.originalFilename}</strong><small>{file.detectedPageCount ? `${file.detectedPageCount} pages · ${file.detectedPaperSize ?? "unknown paper"} · ${file.detectedOrientation ?? "unknown orientation"} · ` : ""}{formatFileSize(file.sizeBytes)} · {formatDate(file.uploadedAt)}</small></div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title="Production timeline" />
          {order.statusEvents.length === 0 ? (
            <EmptyState title="No status history yet" description="Every status change will be listed here in order." />
          ) : (
            <ol className="workspace-timeline">
              {order.statusEvents.map((event) => (
                <li key={event.id}>
                  <span className="workspace-timeline__mark" aria-hidden="true" />
                  <div><strong>{jobOrderStatusMeta[event.toStatus as keyof typeof jobOrderStatusMeta]?.label ?? event.toStatus}</strong><span>{event.note || "Status updated"}</span></div>
                  <time className="numeric" dateTime={event.occurredAt}>{formatDateTime(event.occurredAt)}</time>
                </li>
              ))}
            </ol>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Material usage"
            action={canRecordFallbackUsage
              ? <Button size="sm" onClick={() => setUsageOpen(true)}>Record remaining</Button>
              : undefined}
          />
          {materialMovements.length === 0 ? (
            <EmptyState
              title="No material usage recorded"
              description="Planned materials will be deducted automatically after the printer accepts this job. Failed print attempts leave inventory unchanged."
            />
          ) : (
            <div className="workspace-movement-list">
              {materialMovements.map((movement) => (
                <div key={movement.id}>
                  <div>
                    <strong>{movement.inventoryItemName}</strong>
                    <span>{movement.note || "Used for this job order"}</span>
                  </div>
                  <div className="workspace-movement-list__amount numeric">
                    <strong>{Math.abs(movement.quantityDelta).toLocaleString()} {movement.inventoryItemUnit}</strong>
                    <span>{formatDate(movement.occurredAt)} · balance {movement.balanceAfter.toLocaleString()}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title="Printing" action={<LinkButton to={`/print-center?jobOrderId=${encodeURIComponent(order.id)}`} size="sm">Open Print Center</LinkButton>} />
          {order.printAttempts.length === 0 ? (
            <EmptyState
              title={order.files.length ? "Ready for print setup" : "Not sent to a printer"}
              description={order.files.length ? "Pay and queue the job, then select its operating-system printer in Print Center." : "Attach an approved file before opening print setup."}
            />
          ) : (
            <div className="workspace-print-list">
              {order.printAttempts.map((attempt) => (
                <div key={attempt.id}>
                  <div><strong>{attempt.printerName}</strong><span>{attempt.filename || "Print-ready file"} · {attempt.copies} {attempt.copies === 1 ? "copy" : "copies"} · {attempt.mediaSize}</span><small>{attempt.errorMessage || `${attempt.operator || "Owner"} · ${formatDateTime(attempt.submittedAt)}`}</small></div>
                  <StatusPill label={attempt.result === "succeeded" ? "Submitted" : attempt.result} tone={attempt.result === "succeeded" ? "success" : attempt.result === "failed" ? "danger" : "info"} />
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <JobMaterialUsageModal
        open={usageOpen}
        order={order}
        onClose={() => setUsageOpen(false)}
        onRecorded={() => {
          setUsageOpen(false);
          reload();
        }}
      />
      <JobPaymentModal
        open={paymentOpen}
        order={order}
        onClose={() => setPaymentOpen(false)}
        onRecorded={() => {
          setPaymentOpen(false);
          reload();
        }}
      />
    </>
  );
}
