import { PageHeader } from "../components/PageHeader/PageHeader";
import { Card, CardHeader } from "../components/Card/Card";
import { StatusPill } from "../components/StatusPill/StatusPill";
import { EmptyState } from "../components/EmptyState/EmptyState";
import { LoadingState } from "../components/LoadingState/LoadingState";
import { ErrorState } from "../components/ErrorState/ErrorState";
import { useResource } from "../hooks/useResource";
import { api } from "../lib/apiClient";
import { formatDate } from "../lib/format";
import { jobOrderStatusMeta } from "../types/statusMeta";
import type { JobOrder, JobOrderStatus } from "../types/domain";
import "./ProductionPage.css";

const BOARD_COLUMNS: JobOrderStatus[] = ["queued", "printing", "quality_check", "ready", "on_hold"];

export function ProductionPage() {
  const { data, state, error, reload } = useResource(() => api.get<JobOrder[]>("/job-orders"));

  const grouped: Record<string, JobOrder[]> = {};
  if (data) {
    for (const status of BOARD_COLUMNS) grouped[status] = [];
    for (const order of data) {
      if (BOARD_COLUMNS.includes(order.status)) grouped[order.status].push(order);
    }
  }

  const hasAny = data && data.some((o) => BOARD_COLUMNS.includes(o.status));

  return (
    <>
      <PageHeader
        eyebrow="PRODUCTION"
        title="Production"
        description="Where work sits right now across the shop floor, from queued to ready-for-release."
      />

      {state === "loading" && <LoadingState label="Loading production board…" />}
      {state === "error" && <ErrorState description={error ?? undefined} onRetry={reload} />}

      {state === "ready" && !hasAny && (
        <EmptyState
          title="Nothing in production"
          description="Jobs will appear here once job orders exist and move past payment — see Job Orders."
        />
      )}

      {state === "ready" && hasAny && (
        <div className="production-board">
          {BOARD_COLUMNS.map((status) => (
            <div className="production-column" key={status}>
              <div className="production-column__head">
                <StatusPill label={jobOrderStatusMeta[status].label} tone={jobOrderStatusMeta[status].tone} />
                <span className="numeric">{grouped[status].length}</span>
              </div>
              <div className="production-column__body">
                {grouped[status].length === 0 && <p className="production-column__empty">—</p>}
                {grouped[status].map((order) => (
                  <div className="production-card" key={order.id}>
                    <span className="production-card__number numeric">{order.number}</span>
                    <span className="production-card__customer">{order.customerName || "Walk-in"}</span>
                    <span className="production-card__due">Due {formatDate(order.dueDate)}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <Card>
        <CardHeader title="Status-event timeline" />
        <EmptyState
          title="Timeline not wired up yet"
          description="Every status transition is recorded (see the status_events table), but the per-job timeline view is planned for a later phase."
        />
      </Card>
    </>
  );
}
