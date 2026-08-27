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
import type { DocumentPricingRule, InventoryPaperSize, ProductPrintType } from "../../types/domain";
import "../SettingsPage.css";

const PAPER_ORDER: InventoryPaperSize[] = ["A4", "Letter", "Legal"];
const PRINT_TYPES: ProductPrintType[] = ["black_and_white", "colored"];

export function DocumentPricingSettings() {
  const { data, state, error, reload } = useResource(
    () => api.get<DocumentPricingRule[]>("/document-analyzer/pricing-rules"),
  );
  const [rules, setRules] = useState<DocumentPricingRule[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (data) setRules(data);
  }, [data]);

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
          action={<LinkButton to="/document-analyzer" variant="secondary" size="sm">Open analyzer</LinkButton>}
        />
        <p className="settings-placeholder-text">
          Global per-page rates for each stocked paper size. Products may override their own rate; job orders and
          the Document Analyzer both price from these rates when a product doesn't.
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
            <div className="settings-pricing-table" role="table" aria-label="Document analyzer per-page pricing rules">
              <div className="settings-pricing-table__header" role="row">
                <span role="columnheader">Paper</span>
                {PRINT_TYPES.map((printType) => (
                  <span role="columnheader" key={printType}>{formatProductPrintType(printType)}</span>
                ))}
              </div>
              {PAPER_ORDER.filter((paperSize) => rules.some((rule) => rule.paperSize === paperSize)).map((paperSize) => {
                const inventoryItemName = rules.find((rule) => rule.paperSize === paperSize)?.inventoryItemName;
                return (
                  <div className="settings-pricing-table__row" role="row" key={paperSize}>
                    <strong role="rowheader">
                      {paperSize}
                      {inventoryItemName ? <small> · {inventoryItemName}</small> : null}
                    </strong>
                    {PRINT_TYPES.map((printType) => {
                      const rule = rules.find((candidate) => candidate.paperSize === paperSize && candidate.printType === printType);
                      return rule ? (
                        <div className="settings-pricing-table__rate" role="cell" key={printType}>
                          <label>
                            <span>₱</span>
                            <input
                              className="numeric"
                              type="number"
                              min="0"
                              step="0.01"
                              value={rule.pricePerPage}
                              aria-label={`${formatProductPrintType(printType)} rate for ${paperSize}`}
                              onChange={(event) => updateRule(rule.id, { pricePerPage: Number(event.target.value) })}
                            />
                          </label>
                          <label className="settings-pricing-table__toggle">
                            <input
                              type="checkbox"
                              checked={rule.isActive}
                              onChange={(event) => updateRule(rule.id, { isActive: event.target.checked })}
                            />
                            <span>Use</span>
                          </label>
                        </div>
                      ) : <span role="cell" key={printType}>—</span>;
                    })}
                  </div>
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
    </section>
  );
}
