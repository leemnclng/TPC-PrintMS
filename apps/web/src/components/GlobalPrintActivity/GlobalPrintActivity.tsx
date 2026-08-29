import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../lib/apiClient";
import { formatDateTime } from "../../lib/format";
import type { PrintActivityInfo, PrintActivityJob, PrintActivityState } from "../../types/domain";
import { Modal } from "../Modal/Modal";
import "./GlobalPrintActivity.css";

const stateCopy: Record<PrintActivityState, string> = {
  ready: "Ready to print",
  submitted: "Submitted to printer",
  queued: "Waiting in printer queue",
  spooling: "Preparing pages",
  printing: "Printing",
  paused: "Printer paused",
  error: "Print needs attention",
  released: "Check the finished print",
  awaiting_reinsert: "Reinsert paper for back sides",
};

function progressFor(job: PrintActivityJob) {
  if (!job.totalPages || job.pagesPrinted == null) return null;
  return Math.min(100, Math.max(0, Math.round((job.pagesPrinted / job.totalPages) * 100)));
}

export function GlobalPrintActivity() {
  const navigate = useNavigate();
  const [jobs, setJobs] = useState<PrintActivityJob[]>([]);
  const [open, setOpen] = useState(false);
  const fetching = useRef(false);

  useEffect(() => {
    let disposed = false;
    async function refresh() {
      if (fetching.current) return;
      fetching.current = true;
      try {
        const result = await api.get<PrintActivityInfo>("/printers/print-activity");
        if (!disposed) setJobs(result.jobs);
      } catch {
        // The shell health indicator already reports backend connectivity.
      } finally {
        fetching.current = false;
      }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2500);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, []);

  const attentionCount = useMemo(() => jobs.filter((job) => job.attentionRequired).length, [jobs]);
  const featured = jobs.find((job) => job.attentionRequired) ?? jobs[0];
  if (!featured) return null;
  const progress = progressFor(featured);

  function openJob(job: PrintActivityJob) {
    setOpen(false);
    navigate(`/job-orders/${encodeURIComponent(job.jobOrderId)}`);
  }

  return (
    <aside className="global-print-activity" data-attention={attentionCount > 0 || undefined}>
      <div className="global-print-activity__peek" aria-hidden="true">
        {jobs.slice(0, 3).map((job) => (
          <span key={job.jobOrderId}><b>{job.jobName}</b>{stateCopy[job.state]}</span>
        ))}
        {jobs.length > 3 && <small>+{jobs.length - 3} more queued jobs</small>}
      </div>
      <button
        className="global-print-activity__bar"
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`${attentionCount ? `${attentionCount} print jobs need attention` : `${jobs.length} active print jobs`}. Open print activity.`}
      >
        <span className="global-print-activity__mark" aria-hidden="true"><i /></span>
        <span className="global-print-activity__summary">
          <strong>{attentionCount ? `${attentionCount} need${attentionCount === 1 ? "s" : ""} attention` : `${jobs.length} print job${jobs.length === 1 ? "" : "s"}`}</strong>
          <small><b>{featured.jobName}</b> · {stateCopy[featured.state]}</small>
        </span>
        <span className="global-print-activity__open" aria-hidden="true">View</span>
        {progress != null && <span className="global-print-activity__progress" style={{ "--print-progress": `${progress}%` } as React.CSSProperties} />}
      </button>

      <Modal
        open={open}
        title="Print activity"
        description="Queued work and jobs currently moving through the printer."
        onClose={() => setOpen(false)}
        className="global-print-activity__modal"
      >
        <div className="global-print-activity__list" aria-live="polite">
          {jobs.map((job) => {
            const jobProgress = progressFor(job);
            return (
              <button
                className="global-print-activity__job"
                data-attention={job.attentionRequired || undefined}
                key={job.jobOrderId}
                type="button"
                onClick={() => openJob(job)}
              >
                <span className="global-print-activity__job-heading">
                  <span><strong>{job.jobName}</strong><small className="numeric">{job.jobNumber}</small></span>
                  <b>{stateCopy[job.state]}</b>
                </span>
                <span className="global-print-activity__job-detail">
                  {job.filename ?? "No file submitted yet"}
                  {job.printerName ? ` · ${job.printerName}` : ""}
                </span>
                <span className="global-print-activity__job-meta">
                  {jobProgress != null ? `${job.pagesPrinted} of ${job.totalPages} pages · ` : ""}
                  {job.submittedAt ? formatDateTime(job.submittedAt) : "Waiting for print setup"}
                  <em>Open job →</em>
                </span>
                {jobProgress != null && <span className="global-print-activity__job-progress"><i style={{ width: `${jobProgress}%` }} /></span>}
              </button>
            );
          })}
        </div>
      </Modal>
    </aside>
  );
}
