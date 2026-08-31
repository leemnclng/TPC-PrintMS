import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError, api } from "../../lib/apiClient";
import { formatDateTime } from "../../lib/format";
import type { ObservedPrintJob, SpoolerMonitorInfo } from "../../types/domain";
import { Button } from "../Button/Button";
import "./ExternalPrintPrompt.css";

export function ExternalPrintPrompt() {
  const navigate = useNavigate();
  const [job, setJob] = useState<ObservedPrintJob | null>(null);
  const [unreviewedCount, setUnreviewedCount] = useState(0);
  const [dismissing, setDismissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const suppressed = useRef(new Set<string>());
  const fetching = useRef(false);

  useEffect(() => {
    let disposed = false;

    async function refresh() {
      if (fetching.current) return;
      fetching.current = true;
      try {
        const result = await api.get<SpoolerMonitorInfo>("/printers/spooler-jobs");
        if (disposed || !result.supported) return;
        const candidates = result.jobs.filter(
          (item) => item.reviewStatus === "unreviewed" && !suppressed.current.has(item.id),
        );
        setUnreviewedCount(candidates.length);
        setJob((current) => current && candidates.some((item) => item.id === current.id) ? current : candidates[0] ?? null);
      } catch {
        // Printer monitoring has its own retry/status UI in Print Center. A
        // global prompt should stay silent rather than interrupt unrelated work.
      } finally {
        fetching.current = false;
      }
    }

    void refresh();
    const timer = window.setInterval(() => void refresh(), 3000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, []);

  if (!job) return null;

  function startJobOrder() {
    if (!job) return;
    suppressed.current.add(job.id);
    setJob(null);
    navigate(`/job-orders?create=1&spoolerJobId=${encodeURIComponent(job.id)}`);
  }

  function attachToExistingOrder() {
    if (!job) return;
    suppressed.current.add(job.id);
    setJob(null);
    navigate(`/job-orders?attachSpoolerJobId=${encodeURIComponent(job.id)}`);
  }

  async function dismiss() {
    if (!job || dismissing) return;
    setDismissing(true);
    setError(null);
    try {
      await api.post<SpoolerMonitorInfo>(`/printers/spooler-jobs/${encodeURIComponent(job.id)}/dismiss`);
      suppressed.current.add(job.id);
      setJob(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "The print event could not be dismissed.");
    } finally {
      setDismissing(false);
    }
  }

  return (
    <aside className="external-print-prompt" aria-labelledby="external-print-prompt-title" aria-live="polite">
      <div className="external-print-prompt__signal" aria-hidden="true"><span /></div>
      <div className="external-print-prompt__body">
        <span className="numeric">WINDOWS PRINT RECEIVED{unreviewedCount > 1 ? ` · ${unreviewedCount} UNREVIEWED` : ""}</span>
        <h2 id="external-print-prompt-title">Record this print in a job order?</h2>
        <strong>{job.documentName}</strong>
        <small>{job.printerName} · job {job.osJobId} · {formatDateTime(job.firstSeenAt)}</small>
        <p>Windows provides the event metadata, but the source file must be uploaded again for preview, analysis, pricing, and inventory planning.</p>
        {error && <p className="external-print-prompt__error" role="alert">{error}</p>}
        <div className="external-print-prompt__actions">
          <Button type="button" variant="ghost" size="sm" onClick={dismiss} loading={dismissing}>Not now</Button>
          <Button type="button" variant="secondary" size="sm" onClick={attachToExistingOrder} disabled={dismissing}>Add to order</Button>
          <Button type="button" variant="primary" size="sm" onClick={startJobOrder} disabled={dismissing}>Create job</Button>
        </div>
      </div>
    </aside>
  );
}
