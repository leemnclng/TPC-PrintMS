import { FormEvent, useEffect, useState } from "react";
import { PageHeader } from "../components/PageHeader/PageHeader";
import { Card, CardHeader } from "../components/Card/Card";
import { Button } from "../components/Button/Button";
import { LinkButton } from "../components/Button/LinkButton";
import { LoadingState } from "../components/LoadingState/LoadingState";
import { ErrorState } from "../components/ErrorState/ErrorState";
import { PlannedNotice } from "../components/PlannedNotice/PlannedNotice";
import { useResource } from "../hooks/useResource";
import { useHealth } from "../hooks/useHealth";
import { api, ApiError } from "../lib/apiClient";
import type { BusinessProfile } from "../types/domain";
import { BackupRestorePanel } from "./settings/BackupRestorePanel";
import "./SettingsPage.css";

const DATABASE_STAGES = ["development", "test", "production"] as const;
const DATABASE_STAGE_LABELS: Record<(typeof DATABASE_STAGES)[number], string> = {
  development: "Development",
  test: "Test",
  production: "Production",
};

export function SettingsPage() {
  const { data, state, error, reload } = useResource(() => api.get<BusinessProfile>("/settings/business-profile"));
  const { health } = useHealth();

  const [form, setForm] = useState<BusinessProfile | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const updated = await api.put<BusinessProfile>("/settings/business-profile", form);
      setForm(updated);
      setSaved(true);
      window.dispatchEvent(new CustomEvent("business-profile-updated", { detail: updated }));
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Couldn't save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="SETTINGS"
        title="Settings"
        description="Business profile, numbering, printers, backups, and diagnostics for this installation."
      />

      {state === "loading" && <LoadingState label="Loading settings…" />}
      {state === "error" && <ErrorState description={error ?? undefined} onRetry={reload} />}

      {form && (
        <Card>
          <CardHeader title="Business profile" />
          <form className="settings-form" onSubmit={handleSubmit}>
            <label className="form-field">
              <span>Business name</span>
              <input
                value={form.businessName}
                onChange={(e) => setForm({ ...form, businessName: e.target.value })}
                required
              />
            </label>
            <label className="form-field">
              <span>Owner name</span>
              <input
                value={form.ownerName}
                onChange={(e) => setForm({ ...form, ownerName: e.target.value })}
                required
                maxLength={120}
              />
            </label>
            <label className="form-field">
              <span>Tagline</span>
              <input
                value={form.tagline ?? ""}
                onChange={(e) => setForm({ ...form, tagline: e.target.value })}
              />
            </label>
            <div className="settings-form__row">
              <label className="form-field">
                <span>Email</span>
                <input
                  type="email"
                  value={form.email ?? ""}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </label>
              <label className="form-field">
                <span>Phone</span>
                <input value={form.phone ?? ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </label>
            </div>
            <label className="form-field">
              <span>Job order number prefix</span>
              <input
                value={form.jobOrderPrefix}
                onChange={(e) => setForm({ ...form, jobOrderPrefix: e.target.value })}
              />
            </label>

            <div className="settings-form__actions">
              <Button type="submit" variant="primary" loading={saving}>
                Save changes
              </Button>
              {saved && <span className="settings-form__saved">Saved.</span>}
              {saveError && <span className="settings-form__error">{saveError}</span>}
            </div>
          </form>
        </Card>
      )}

      <Card>
        <CardHeader
          title="Document analyzer pricing"
          action={<LinkButton to="/configuration#document-pricing" variant="secondary" size="sm">Open configuration</LinkButton>}
        />
        <p className="settings-placeholder-text">
          Global paper-size rates and per-product overrides now live in Configuration, alongside global variants.
        </p>
      </Card>

      <Card>
        <CardHeader title="Document templates" />
        <p className="settings-placeholder-text">
          Job-order document layout is planned once print-ready export is defined.
        </p>
        <PlannedNotice phase="Phase 4 — Job Order & Files" />
      </Card>

      <BackupRestorePanel onRestored={reload} />

      <Card className="settings-environments">
        <CardHeader title="Runtime environments" meta="RESTART TO SWITCH" />
        <p className="settings-placeholder-text">
          Each application stage has an independent SQLite database. Set the paths in <span className="numeric">services/api/.env</span>, choose the active stage with <span className="numeric">PRINT_MS_STAGE</span>, then restart the app.
        </p>
        {health ? (
          <div className="environment-grid">
            {DATABASE_STAGES.map((stage, index) => {
              const active = health.stage === stage;
              const path = health.databasePaths?.[stage] ?? (active ? health.databasePath : "Restart to resolve this path");
              const source = health.databasePathSources?.[stage] ?? "Environment configuration";
              return (
                <article className={`environment-card${active ? " is-active" : ""}`} key={stage}>
                  <header>
                    <span className="numeric">0{index + 1}</span>
                    {active && <strong>ACTIVE</strong>}
                  </header>
                  <h3>{DATABASE_STAGE_LABELS[stage]}</h3>
                  <code>PRINT_MS_{stage.toUpperCase()}_DATABASE_PATH</code>
                  <dl>
                    <div><dt>SQLite path</dt><dd className="numeric">{path}</dd></div>
                    <div><dt>Resolved from</dt><dd>{source}</dd></div>
                  </dl>
                </article>
              );
            })}
          </div>
        ) : (
          <p className="settings-placeholder-text">Backend is not reachable — environment paths unavailable.</p>
        )}
        <p className="environment-note">
          Changing stages never copies or deletes data. The selected database is opened only during application startup.
        </p>
      </Card>

      <Card>
        <CardHeader title="Diagnostics" />
        {health ? (
          <dl className="diagnostics-list">
            <div>
              <dt>App stage</dt>
              <dd>{health.stage}</dd>
            </div>
            <div>
              <dt>Backend version</dt>
              <dd className="numeric">{health.version}</dd>
            </div>
            <div>
              <dt>Uptime</dt>
              <dd className="numeric">{Math.floor(health.uptimeSeconds)}s</dd>
            </div>
            <div>
              <dt>Database</dt>
              <dd>{health.dbOk ? "OK" : "Unreachable"}</dd>
            </div>
            <div>
              <dt>Database path</dt>
              <dd className="diagnostics-list__path numeric">{health.databasePath}</dd>
            </div>
            <div>
              <dt>Data directory</dt>
              <dd className="diagnostics-list__path numeric">{health.dataDir}</dd>
            </div>
          </dl>
        ) : (
          <p className="settings-placeholder-text">Backend is not reachable — diagnostics unavailable.</p>
        )}
      </Card>
    </>
  );
}
