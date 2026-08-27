import { Link } from "react-router-dom";
import { PageHeader } from "../components/PageHeader/PageHeader";
import { Card, CardHeader } from "../components/Card/Card";
import { StatCard } from "../components/StatCard/StatCard";
import { StatusPill } from "../components/StatusPill/StatusPill";
import { EmptyState } from "../components/EmptyState/EmptyState";
import { LoadingState } from "../components/LoadingState/LoadingState";
import { ErrorState } from "../components/ErrorState/ErrorState";
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

      <section className="overview-quick-actions" aria-labelledby="quick-actions-title">
        <header>
          <span className="numeric">QUICK ACTIONS</span>
          <div>
            <h2 id="quick-actions-title">Start at the counter</h2>
            <p>Open the most common shop workflows without leaving the overview.</p>
          </div>
        </header>
        <div className="overview-quick-actions__grid">
          <Link className="overview-quick-action overview-quick-action--primary" to="/job-orders?create=1">
            <span className="overview-quick-action__number numeric">01</span>
            <span className="overview-quick-action__body">
              <small>PRIMARY WORKFLOW</small>
              <strong>New job order</strong>
              <span>Upload a customer file, analyze it, approve the price, and continue to print setup.</span>
            </span>
            <span className="overview-quick-action__arrow" aria-hidden="true">→</span>
          </Link>
          <Link className="overview-quick-action" to="/customers/new">
            <span className="overview-quick-action__number numeric">02</span>
            <span className="overview-quick-action__body"><strong>New customer</strong><span>Add customer and contact details.</span></span>
            <span className="overview-quick-action__arrow" aria-hidden="true">→</span>
          </Link>
          <Link className="overview-quick-action" to="/product-catalog/new">
            <span className="overview-quick-action__number numeric">03</span>
            <span className="overview-quick-action__body"><strong>New service</strong><span>Configure a new shop offering.</span></span>
            <span className="overview-quick-action__arrow" aria-hidden="true">→</span>
          </Link>
        </div>
      </section>

      {state === "loading" && <LoadingState label="Reading local data…" />}
      {state === "error" && <ErrorState description={error ?? undefined} onRetry={reload} />}

      {state === "ready" && data && (
        <>
          <div className="overview-stats">
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
        </>
      )}
    </>
  );
}
