import { PageHeader } from "../components/PageHeader/PageHeader";
import { Card, CardHeader } from "../components/Card/Card";
import { Button } from "../components/Button/Button";
import { EmptyState } from "../components/EmptyState/EmptyState";
import { PlannedNotice } from "../components/PlannedNotice/PlannedNotice";
import "./ReportsPage.css";

const REPORT_CARDS = [
  { title: "Sales summary", description: "Revenue by product, period, and customer." },
  { title: "Payment summary", description: "Verified vs. pending payments across job orders." },
  { title: "Product performance", description: "Volume and revenue by product and variant." },
  { title: "Job throughput", description: "Cycle time from paid to completed, by production stage." },
];

export function ReportsPage() {
  return (
    <>
      <PageHeader
        eyebrow="REPORTS"
        title="Reports"
        description="Sales, payment, product, and throughput reporting, derived from real quotation, job-order, and payment data — not invented figures."
        actions={<PlannedNotice phase="Phase 6 — Tracking & Reports" />}
      />

      <div className="reports-filter-row">
        <span className="reports-filter-row__label">Date range</span>
        <Button variant="secondary" size="sm" disabled>
          This month
        </Button>
        <Button variant="ghost" size="sm" disabled>
          Custom range…
        </Button>
        <div className="reports-filter-row__spacer" />
        <Button variant="secondary" size="sm" disabled>
          Export CSV
        </Button>
        <Button variant="secondary" size="sm" disabled>
          Export PDF
        </Button>
      </div>

      <div className="reports-grid">
        {REPORT_CARDS.map((r) => (
          <Card key={r.title}>
            <CardHeader title={r.title} />
            <EmptyState
              title="No data recorded yet"
              description={`${r.description} Populates once job orders and payments exist.`}
            />
          </Card>
        ))}
      </div>
    </>
  );
}
