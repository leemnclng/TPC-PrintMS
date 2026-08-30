import { FormEvent, useEffect, useState } from "react";
import { Button } from "../../components/Button/Button";
import { LinkButton } from "../../components/Button/LinkButton";
import { Card, CardHeader } from "../../components/Card/Card";
import { EmptyState } from "../../components/EmptyState/EmptyState";
import { ErrorState } from "../../components/ErrorState/ErrorState";
import { LoadingState } from "../../components/LoadingState/LoadingState";
import { useResource } from "../../hooks/useResource";
import { ApiError, api } from "../../lib/apiClient";
import { formatProductPrintType } from "../../lib/format";
import type { CSSProperties } from "react";
import type { DocumentPricingRule, InventoryPaperSize, PrintTypeDefinition } from "../../types/domain";
import "../SettingsPage.css";
import { PrintTypeCreateModal } from "./PrintTypeCreateModal";

const PAPER_ORDER: InventoryPaperSize[] = ["A4", "Letter", "Legal"];
const PRICING_SCOPES = [
  {
    key: "printing" as const,
    label: "Printing",
    eyebrow: "FILE-BASED OUTPUT",
    description: "Default paper and print-type rates for products that send an uploaded document to the printer.",
  },
  {
    key: "photocopy" as const,
    label: "Scan or Photocopy",
    eyebrow: "DEVICE-SIDE OUTPUT",
    description: "Default paper and print-type rates for Photocopy products. Scan products remain per-product because they consume no print material.",
  },
];

export function DocumentPricingSettings() {
  const { data, state, error, reload } = useResource(
    async () => {
      const [rules, printTypes] = await Promise.all([
        api.get<DocumentPricingRule[]>("/document-analyzer/pricing-rules"),
        api.get<PrintTypeDefinition[]>("/print-types"),
      ]);
      return { rules, printTypes };
    },
  );
  const [rules, setRules] = useState<DocumentPricingRule[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [createTypeOpen, setCreateTypeOpen] = useState(false);

  useEffect(() => {
    if (data) setRules(data.rules);
  }, [data]);

  const printTypes = data?.printTypes.filter((printType) => printType.isActive) ?? [];
  const tableColumns = {
    gridTemplateColumns: `minmax(7rem, 0.55fr) repeat(${Math.max(printTypes.length, 1)}, minmax(12rem, 1fr))`,
  } satisfies CSSProperties;

  function updateRule(id: string, patch: Partial<DocumentPricingRule>) {
    setSaved(false);
    setRules((current) => current.map((rule) => rule.id === id ? { ...rule, ...patch } : rule));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setSaved(false);
    setSaveError(null);
    try {
      const updated = await api.put<DocumentPricingRule[]>("/document-analyzer/pricing-rules", {
        rules: rules.map((rule) => ({
          id: rule.id,
          pricePerPage: rule.pricePerPage,
          isActive: rule.isActive,
        })),
      });
      setRules(updated);
      setSaved(true);
    } catch (caught) {
      setSaveError(caught instanceof ApiError ? caught.message : "The analyzer pricing rules couldn’t be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section id="document-pricing" className="settings-anchor-section">
      <Card>
        <CardHeader
          title="Document analyzer pricing"
          action={(
            <div className="settings-card-actions">
              <Button type="button" variant="secondary" size="sm" onClick={() => setCreateTypeOpen(true)}>Add print type</Button>
              <LinkButton to="/document-analyzer" variant="secondary" size="sm">Open analyzer</LinkButton>
            </div>
          )}
        />
        <p className="settings-placeholder-text">
          Configure a separate global table for each built-in workflow. Every value remains tied to real paper
          inventory and may still be overridden by an individual product.
        </p>

        {state === "loading" ? <LoadingState label="Loading pricing rules…" /> : null}
        {state === "error" ? <ErrorState description={error ?? undefined} onRetry={reload} /> : null}

        {state === "ready" && rules.length === 0 ? (
          <EmptyState
            title="No paper sizes configured yet"
            description="Tag an inventory item as A4, Letter, or Legal paper stock in Inventory to start pricing by size."
            action={<LinkButton to="/inventory" variant="secondary" size="sm">Open inventory</LinkButton>}
          />
        ) : null}

        {state === "ready" && rules.length > 0 ? (
          <form className="settings-pricing-form" onSubmit={handleSubmit}>
            <div className="settings-pricing-scopes">
              {PRICING_SCOPES.map((scope, scopeIndex) => {
                const scopedRules = rules.filter((rule) => rule.pricingScope === scope.key);
                return (
                  <section className="settings-pricing-scope" key={scope.key} aria-labelledby={`pricing-scope-${scope.key}`}>
                    <header className="settings-pricing-scope__header">
                      <span className="numeric">{String(scopeIndex + 1).padStart(2, "0")} / {scope.eyebrow}</span>
                      <div><h3 id={`pricing-scope-${scope.key}`}>{scope.label}</h3><p>{scope.description}</p></div>
                      <output>{scopedRules.filter((rule) => rule.isActive).length}<small>active rates</small></output>
                    </header>
                    <div className="settings-pricing-table" role="table" aria-label={`${scope.label} per-page pricing rules`}>
                      <div className="settings-pricing-table__header" role="row" style={tableColumns}>
                        <span role="columnheader">Paper material</span>
                        {printTypes.map((printType) => (
                          <span role="columnheader" key={printType.key}>
                            <strong>{printType.label || formatProductPrintType(printType.key)}</strong>
                            <small>{printType.appliesInkCoverage ? "Base + ink coverage" : "Paper and ink included"}</small>
                          </span>
                        ))}
                      </div>
                      {PAPER_ORDER.filter((paperSize) => scopedRules.some((rule) => rule.paperSize === paperSize)).map((paperSize) => {
                        const inventoryItemName = scopedRules.find((rule) => rule.paperSize === paperSize)?.inventoryItemName;
                        return (
                          <div className="settings-pricing-table__row" role="row" key={paperSize} style={tableColumns}>
                            <strong role="rowheader"><span>{paperSize}</span>{inventoryItemName ? <small>{inventoryItemName}</small> : null}</strong>
                            {printTypes.map((printType) => {
                              const rule = scopedRules.find((candidate) => candidate.paperSize === paperSize && candidate.printType === printType.key);
                              return rule ? (
                                <div className="settings-pricing-table__rate" role="cell" key={printType.key}>
                                  <label>
                                    <span>₱</span>
                                    <input
                                      className="numeric"
                                      type="number"
                                      min="0"
                                      step="0.01"
                                      value={rule.pricePerPage}
                                      aria-label={`${scope.label} ${printType.label} rate for ${paperSize}`}
                                      onChange={(event) => updateRule(rule.id, { pricePerPage: Number(event.target.value) })}
                                    />
                                  </label>
                                  <label className="settings-pricing-table__toggle">
                                    <input type="checkbox" checked={rule.isActive} onChange={(event) => updateRule(rule.id, { isActive: event.target.checked })} />
                                    <span>Use</span>
                                  </label>
                                </div>
                              ) : <span role="cell" key={printType.key}>—</span>;
                            })}
                          </div>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>
            <div className="settings-form__actions">
              <Button type="submit" variant="primary" loading={saving}>Save pricing rules</Button>
              {saved ? <span className="settings-form__saved">Saved.</span> : null}
              {saveError ? <span className="settings-form__error" role="alert">{saveError}</span> : null}
            </div>
          </form>
        ) : null}
      </Card>
      <PrintTypeCreateModal
        open={createTypeOpen}
        onClose={() => setCreateTypeOpen(false)}
        onCreated={() => {
          setCreateTypeOpen(false);
          reload();
        }}
      />
    </section>
  );
}
