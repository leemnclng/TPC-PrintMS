import { Card, CardHeader } from "../components/Card/Card";
import { LinkButton } from "../components/Button/LinkButton";
import { ErrorState } from "../components/ErrorState/ErrorState";
import { LoadingState } from "../components/LoadingState/LoadingState";
import { PageHeader } from "../components/PageHeader/PageHeader";
import { useResource } from "../hooks/useResource";
import { api } from "../lib/apiClient";
import type { Variant } from "../types/domain";
import { DocumentPricingSettings } from "./settings/DocumentPricingSettings";
import "./SettingsPage.css";

export function ConfigurationPage() {
  const { data, state, error, reload } = useResource(() => api.get<Variant[]>("/variants"));
  const variants = data ?? [];
  const activeCount = variants.filter((variant) => variant.isActive).length;
  const linkedProductCount = variants.reduce((total, variant) => total + variant.linkedProductCount, 0);

  return (
    <>
      <PageHeader
        eyebrow="CONFIGURATION"
        title="Configuration"
        description="Reusable catalog options and document-analyzer pricing shared across services, products, and job orders."
      />

      <Card>
        <CardHeader
          title="Global variants"
          action={
            <LinkButton to="/configuration/variants" variant="secondary" size="sm">
              Manage variants
            </LinkButton>
          }
        />
        <p className="settings-placeholder-text">
          Reusable options such as Back-to-back or Rush, named once and assigned to products in any service with
          their own price adjustment.
        </p>
        {state === "loading" ? <LoadingState label="Loading variants…" /> : null}
        {state === "error" ? <ErrorState description={error ?? undefined} onRetry={reload} /> : null}
        {state === "ready" ? (
          <dl className="diagnostics-list">
            <div><dt>Variants</dt><dd className="numeric">{variants.length}</dd></div>
            <div><dt>Active</dt><dd className="numeric">{activeCount}</dd></div>
            <div><dt>Product links</dt><dd className="numeric">{linkedProductCount}</dd></div>
          </dl>
        ) : null}
      </Card>

      <DocumentPricingSettings />
    </>
  );
}
