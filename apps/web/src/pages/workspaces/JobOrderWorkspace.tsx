import { useState } from "react";
import { useParams } from "react-router-dom";
import { Button } from "../../components/Button/Button";
import { PageHeader } from "../../components/PageHeader/PageHeader";
import { Card, CardHeader } from "../../components/Card/Card";
import { StatusPill } from "../../components/StatusPill/StatusPill";
import { EmptyState } from "../../components/EmptyState/EmptyState";
import { LoadingState } from "../../components/LoadingState/LoadingState";
import { ErrorState } from "../../components/ErrorState/ErrorState";
import { PlannedNotice } from "../../components/PlannedNotice/PlannedNotice";
import { useResource } from "../../hooks/useResource";
import { api } from "../../lib/apiClient";
import { formatCurrency, formatDate } from "../../lib/format";
import { jobOrderStatusMeta } from "../../types/statusMeta";
import type { InventoryMovement, JobOrder } from "../../types/domain";
import { JobMaterialUsageModal } from "../jobOrders/JobMaterialUsageModal";
import "./Workspace.css";

export function JobOrderWorkspace() {
  const { jobOrderId } = useParams();
  const [usageOpen, setUsageOpen] = useState(false);
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

  return (
    <>
      <PageHeader
        eyebrow="JOB ORDERS"
        title={order.number}
        description={order.customerName ? `For ${order.customerName}` : "Walk-in order · no customer linked"}
        actions={<StatusPill label={jobOrderStatusMeta[order.status].label} tone={jobOrderStatusMeta[order.status].tone} />}
      />

      <div className="workspace-grid">
        <Card>
          <CardHeader title="Order summary" />
          <dl className="workspace-fact-list">
            <div>
              <dt>Total</dt>
              <dd className="numeric">{formatCurrency(order.total)}</dd>
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
                      <strong>{material.consumedQuantity.toLocaleString()} / {material.plannedQuantity.toLocaleString()} {material.inventoryItemUnit} used</strong>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader title="Files" />
          <EmptyState
            title="No files attached"
            description="Source files and approved print-ready files attach here."
          />
          <PlannedNotice phase="Phase 4 — Job Order & Files" />
        </Card>

        <Card>
          <CardHeader title="Production timeline" />
          <EmptyState title="No status history yet" description="Every status change will be listed here in order." />
        </Card>

        <Card>
          <CardHeader
            title="Material usage"
            action={order.items.some((item) => item.materials.length > 0)
              ? <Button size="sm" onClick={() => setUsageOpen(true)}>Record usage</Button>
              : undefined}
          />
          {materialMovements.length === 0 ? (
            <EmptyState
              title="No material usage recorded"
              description="Materials issued to this job order will appear here with their quantities and resulting stock balances."
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
          <CardHeader title="Printing" />
          <EmptyState
            title="Not sent to a printer"
            description="Printer selection, print settings, and attempts happen from the Print Center once this job is ready."
          />
          <PlannedNotice phase="Phase 5 — Production Printing" />
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
    </>
  );
}
