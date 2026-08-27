import { useState } from "react";
import { PageHeader } from "../components/PageHeader/PageHeader";
import { Card, CardHeader } from "../components/Card/Card";
import { Button } from "../components/Button/Button";
import { StatusPill } from "../components/StatusPill/StatusPill";
import { EmptyState } from "../components/EmptyState/EmptyState";
import { LoadingState } from "../components/LoadingState/LoadingState";
import { ErrorState } from "../components/ErrorState/ErrorState";
import { useResource } from "../hooks/useResource";
import { api, ApiError } from "../lib/apiClient";
import { formatDate } from "../lib/format";
import { printerStateMeta } from "../types/statusMeta";
import type { Printer } from "../types/domain";
import "./PrintCenterPage.css";

export function PrintCenterPage() {
  const { data, state, error, reload } = useResource(() => api.get<Printer[]>("/printers"));
  const [discovering, setDiscovering] = useState(false);
  const [discoverError, setDiscoverError] = useState<string | null>(null);

  async function handleDiscover() {
    setDiscovering(true);
    setDiscoverError(null);
    try {
      await api.post<Printer[]>("/printers/discover");
      reload();
    } catch (err) {
      setDiscoverError(err instanceof ApiError ? err.message : "Couldn't reach the printer subsystem.");
    } finally {
      setDiscovering(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="PRINT CENTER"
        title="Print Center"
        description="Installed printers, read directly from the operating system's print queue — no Canon-specific integration, so any OS-installed printer shows up here."
        actions={
          <Button variant="primary" onClick={handleDiscover} loading={discovering}>
            Discover printers
          </Button>
        }
      />

      {discoverError && <ErrorState title="Discovery failed" description={discoverError} />}

      {state === "loading" && <LoadingState label="Reading printer list…" />}
      {state === "error" && <ErrorState description={error ?? undefined} onRetry={reload} />}

      {state === "ready" && data && data.length === 0 && (
        <EmptyState
          title="No printers detected"
          description="Install a printer in your operating system, then select “Discover printers” to read it from the OS print queue (CUPS on macOS/Linux)."
          action={
            <Button variant="secondary" onClick={handleDiscover} loading={discovering}>
              Discover printers
            </Button>
          }
        />
      )}

      {state === "ready" && data && data.length > 0 && (
        <div className="printer-grid">
          {data.map((printer) => (
            <Card key={printer.id}>
              <CardHeader title={printer.displayName} meta={printer.isDefault ? "Default" : undefined} />
              <StatusPill
                label={printerStateMeta[printer.lastSeenState].label}
                tone={printerStateMeta[printer.lastSeenState].tone}
              />
              <p className="printer-card__meta">Last seen {formatDate(printer.lastSeenAt)}</p>
            </Card>
          ))}
        </div>
      )}

      <div className="print-center-columns">
        <Card>
          <CardHeader title="Ready-to-print files" />
          <EmptyState
            title="No files staged"
            description="File import, preview, and print-ready export are planned for Phase 4 & 5 — see docs/context/build-plan.md."
          />
        </Card>
        <Card>
          <CardHeader title="Print history" />
          <EmptyState
            title="No print attempts recorded"
            description="Submitting a job to a printer and recording the result is Phase 5 — Production Printing."
          />
        </Card>
      </div>
    </>
  );
}
