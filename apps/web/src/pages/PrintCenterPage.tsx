import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "../components/PageHeader/PageHeader";
import { Card, CardHeader } from "../components/Card/Card";
import { Button } from "../components/Button/Button";
import { LinkButton } from "../components/Button/LinkButton";
import { StatusPill } from "../components/StatusPill/StatusPill";
import { EmptyState } from "../components/EmptyState/EmptyState";
import { LoadingState } from "../components/LoadingState/LoadingState";
import { ErrorState } from "../components/ErrorState/ErrorState";
import { useResource } from "../hooks/useResource";
import { api, ApiError } from "../lib/apiClient";
import { formatCurrency, formatDate, formatFileSize } from "../lib/format";
import { printerStateMeta } from "../types/statusMeta";
import type { JobOrder, Printer, PrinterPlatformInfo } from "../types/domain";
import "./PrintCenterPage.css";

export function PrintCenterPage() {
  const [searchParams] = useSearchParams();
  const jobOrderId = searchParams.get("jobOrderId");
  const { data, state, error, reload } = useResource(() => api.get<Printer[]>("/printers"));
  const {
    data: stagedOrder,
    state: stagedState,
    error: stagedError,
    reload: reloadStagedOrder,
  } = useResource<JobOrder | null>(
    () => jobOrderId ? api.get<JobOrder>(`/job-orders/${encodeURIComponent(jobOrderId)}`) : Promise.resolve(null),
    [jobOrderId],
  );
  const {
    data: platformInfo,
    state: platformState,
    error: platformError,
    reload: reloadPlatform,
  } = useResource(() => api.get<PrinterPlatformInfo>("/printers/platform"));
  const [discovering, setDiscovering] = useState(false);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [openingSettings, setOpeningSettings] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  const nativePlatform = window.paperClub?.platform;
  const resolvedPlatform = platformInfo?.platform
    ?? (nativePlatform === "win32" ? "windows" : nativePlatform === "darwin" ? "macos" : undefined);
  const platformLabel = resolvedPlatform === "windows"
    ? "Windows"
    : resolvedPlatform === "macos"
      ? "macOS"
      : resolvedPlatform === "linux"
        ? "Linux"
        : "operating system";
  const printerSettingsLabel = nativePlatform === "win32"
    ? "Open Windows printer settings"
    : nativePlatform === "darwin"
      ? "Open macOS printer settings"
      : "Open printer settings";
  const queueLabel = resolvedPlatform === "windows"
    ? "WINDOWS QUEUE"
    : resolvedPlatform === "macos"
      ? "MACOS QUEUE"
      : resolvedPlatform === "linux"
        ? "LINUX QUEUE"
        : "OS QUEUE";

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

  async function handleOpenPrinterSettings() {
    setSettingsError(null);
    if (!window.paperClub) {
      setSettingsError("Printer settings can only be opened from the Printing-MS desktop app.");
      return;
    }
    setOpeningSettings(true);
    try {
      await window.paperClub.openPrinterSettings();
    } catch {
      setSettingsError("Windows printer settings couldn't be opened. Open Settings → Bluetooth & devices → Printers & scanners manually.");
    } finally {
      setOpeningSettings(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="PRINT CENTER"
        title="Print Center"
        description={`Connect Canon or any other brand through the ${platformLabel} print queue, then manage it here without depending on one manufacturer's app.`}
        actions={
          <>
            <Button variant="secondary" onClick={handleOpenPrinterSettings} loading={openingSettings}>
              {printerSettingsLabel}
            </Button>
            <Button variant="primary" onClick={handleDiscover} loading={discovering}>
              Refresh printers
            </Button>
          </>
        }
      />

      {jobOrderId && stagedState === "loading" && <LoadingState label="Staging confirmed transaction…" />}
      {jobOrderId && stagedState === "error" && (
        <ErrorState title="Confirmed transaction unavailable" description={stagedError ?? undefined} onRetry={reloadStagedOrder} />
      )}
      {jobOrderId && stagedState === "ready" && stagedOrder && (
        <section className="staged-print" aria-labelledby="staged-print-title">
          <div className="staged-print__status">
            <span className="staged-print__check" aria-hidden="true">✓</span>
            <div>
              <span className="numeric">03 / PRINT SETUP</span>
              <h2 id="staged-print-title">{stagedOrder.number} is confirmed and staged</h2>
              <p>Select an available operating-system printer below. Direct queue submission remains a separate confirmation step.</p>
            </div>
            <LinkButton to={`/job-orders/${stagedOrder.id}`} variant="secondary" size="sm">View job order</LinkButton>
          </div>
          <dl>
            <div><dt>Product</dt><dd>{stagedOrder.items[0]?.productName ?? "—"}</dd></div>
            <div><dt>Pages × copies</dt><dd>{stagedOrder.items[0] ? `${stagedOrder.items[0].pagesPerCopy} × ${stagedOrder.items[0].copies}` : "—"}</dd></div>
            <div><dt>Final price</dt><dd>{formatCurrency(stagedOrder.total)}</dd></div>
            <div><dt>Pricing</dt><dd>{stagedOrder.priceOverridden ? `Owner override · suggested ${formatCurrency(stagedOrder.suggestedTotal)}` : "Engine recommendation"}</dd></div>
          </dl>
        </section>
      )}

      <section className="printer-connection" aria-labelledby="printer-connection-title">
        <div className="printer-connection__intro">
          <span className="printer-connection__kicker numeric">CANON FIRST · ANY BRAND NEXT</span>
          <h2 id="printer-connection-title">Connect through {platformLabel} once</h2>
          <p>
            Canon PRINT can set up the printer, check ink, and keep its connection healthy.
            Printing-MS reads the {platformLabel} queue it creates, which is also how Epson, Brother,
            HP, AirPrint, and IPP printers remain compatible.
          </p>
          <div className="printer-platform" aria-live="polite">
            <span className={`printer-platform__indicator is-${platformState}`} aria-hidden="true" />
            <div>
              <small className="numeric">HOST OPERATING SYSTEM</small>
              {platformState === "loading" && <strong>Detecting…</strong>}
              {platformState === "ready" && platformInfo && (
                <>
                  <strong>{platformLabel}</strong>
                  <span>{platformInfo.detectionSource === "automatic" ? "Auto-detected" : "Environment override"}</span>
                </>
              )}
              {platformState === "error" && (
                <>
                  <strong>Detection unavailable</strong>
                  <button type="button" onClick={reloadPlatform} title={platformError ?? undefined}>Retry detection</button>
                </>
              )}
            </div>
          </div>
        </div>
        <ol className="printer-connection__steps">
          <li>
            <span className="printer-connection__number numeric">01</span>
            <div><strong>Set up in Canon PRINT</strong><small>Connect the Canon printer to the same network as this Windows computer.</small></div>
          </li>
          <li>
            <span className="printer-connection__number numeric">02</span>
            <div><strong>Add the {platformLabel} queue</strong><small>Open printer settings and add the Canon printer if it is not already listed.</small></div>
          </li>
          <li>
            <span className="printer-connection__number numeric">03</span>
            <div><strong>Refresh Printing-MS</strong><small>The installed queue appears below and stays vendor-neutral.</small></div>
          </li>
        </ol>
      </section>

      {settingsError && <ErrorState title="Couldn't open printer settings" description={settingsError} />}
      {discoverError && <ErrorState title="Discovery failed" description={discoverError} />}

      {state === "loading" && <LoadingState label="Reading printer list…" />}
      {state === "error" && <ErrorState description={error ?? undefined} onRetry={reload} />}

      {state === "ready" && data && data.length === 0 && (
        <EmptyState
          title="No printers detected"
          description={`Finish setup in Canon PRINT, add the printer under ${platformLabel} printer settings, then refresh this list.`}
          action={
            <Button variant="secondary" onClick={handleDiscover} loading={discovering}>
              Refresh printers
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
              <p className="printer-card__queue numeric">{queueLabel} · {printer.systemName}</p>
              <p className="printer-card__meta">Last seen {formatDate(printer.lastSeenAt)}</p>
            </Card>
          ))}
        </div>
      )}

      <div className="print-center-columns">
        <Card>
          <CardHeader title="Ready-to-print files" />
          {stagedOrder?.files.length ? (
            <div className="staged-file-list">
              {stagedOrder.files.map((file) => (
                <div key={file.id}>
                  <span className="staged-file-list__mark numeric">{file.kind === "print_ready" ? "READY" : "SOURCE"}</span>
                  <div><strong>{file.originalFilename}</strong><small>{formatFileSize(file.sizeBytes)} · staged {formatDate(file.uploadedAt)}</small></div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No files staged" description="Confirm an analyzed transaction to stage its customer file here." />
          )}
        </Card>
        <Card>
          <CardHeader title="Print history" />
          <EmptyState
            title="No print attempts recorded"
            description="Printer connection is now active; direct job submission and audited results are the next Print Center step."
          />
        </Card>
      </div>
    </>
  );
}
