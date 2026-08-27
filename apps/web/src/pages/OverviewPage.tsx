import { Link } from "react-router-dom";
import { PageHeader } from "../components/PageHeader/PageHeader";
import { Card, CardHeader } from "../components/Card/Card";
import { StatCard } from "../components/StatCard/StatCard";
import { StatusPill } from "../components/StatusPill/StatusPill";
import { Button } from "../components/Button/Button";
import { LinkButton } from "../components/Button/LinkButton";
import { EmptyState } from "../components/EmptyState/EmptyState";
import { LoadingState } from "../components/LoadingState/LoadingState";
import { ErrorState } from "../components/ErrorState/ErrorState";
import { PlannedNotice } from "../components/PlannedNotice/PlannedNotice";
import { useResource } from "../hooks/useResource";
import { api } from "../lib/apiClient";
import { jobOrderStatusMeta } from "../types/statusMeta";
import type { JobOrderStatus, OverviewSnapshot } from "../types/domain";
import "./OverviewPage.css";

export function OverviewPage() {
  const { data, state, error, reload } = useResource(() => api.get<OverviewSnapshot>("/overview"));

  return (
    <>
      <PageHeader
        eyebrow="OVERVIEW"
        title="Overview"
        description="Where active work stands right now — pending approvals, payments, deadlines, and the print queue."
      />

      {state === "loading" && <LoadingState label="Reading local data…" />}
      {state === "error" && <ErrorState description={error ?? undefined} onRetry={reload} />}

      {state === "ready" && data && (
        <>
          <div className="overview-stats">
            <StatCard
              label="Quotations awaiting approval"
              value={data.quotationsAwaitingApproval}
              tone={data.quotationsAwaitingApproval > 0 ? "warning" : "neutral"}
            />
            <StatCard
              label="Payments awaiting verification"
              value={data.paymentsAwaitingVerification}
              tone={data.paymentsAwaitingVerification > 0 ? "warning" : "neutral"}
            />
            <StatCard
              label="Upcoming deadlines (7 days)"
              value={data.upcomingDeadlines}
              tone={data.upcomingDeadlines > 0 ? "danger" : "neutral"}
            />
            <StatCard label="Print queue depth" value={data.printQueueDepth} />
          </div>

          <div className="overview-grid">
            <Card>
              <CardHeader title="Job orders by status" />
              <ul className="overview-status-list">
                {(Object.keys(data.jobOrdersByStatus) as JobOrderStatus[]).map((status) => (
                  <li key={status}>
                    <StatusPill label={jobOrderStatusMeta[status].label} tone={jobOrderStatusMeta[status].tone} />
                    <span className="numeric">{data.jobOrdersByStatus[status]}</span>
                  </li>
                ))}
              </ul>
              <Link to="/job-orders" className="overview-link">
                View all job orders →
              </Link>
            </Card>

            <Card>
              <CardHeader title="Recent activity" />
              <EmptyState
                title="No activity recorded yet"
                description="Status changes, payments, and print attempts will appear here as jobs move through the shop."
              />
            </Card>
          </div>

          <Card>
            <CardHeader title="Quick actions" />
            <div className="overview-actions">
              <LinkButton variant="primary" to="/customers/new">
                New customer
              </LinkButton>
              <LinkButton variant="secondary" to="/product-catalog/new">
                New service
              </LinkButton>
              <div className="overview-actions__planned">
                <Button variant="secondary" disabled>
                  New quotation
                </Button>
                <PlannedNotice phase="Phase 3 — Commercial Workflow" />
              </div>
              <div className="overview-actions__planned">
                <Button variant="secondary" disabled>
                  New job order
                </Button>
                <PlannedNotice phase="Phase 4 — Job Order & Files" />
              </div>
            </div>
          </Card>
        </>
      )}
    </>
  );
}
