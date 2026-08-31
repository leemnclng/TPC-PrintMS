import { FormEvent, useEffect, useState } from "react";
import { Button } from "../../components/Button/Button";
import { LinkButton } from "../../components/Button/LinkButton";
import { Card, CardHeader } from "../../components/Card/Card";
import { EmptyState } from "../../components/EmptyState/EmptyState";
import { ErrorState } from "../../components/ErrorState/ErrorState";
import { LoadingState } from "../../components/LoadingState/LoadingState";
import { Modal } from "../../components/Modal/Modal";
import { useResource } from "../../hooks/useResource";
import { ApiError, api } from "../../lib/apiClient";
import { formatProductPrintType } from "../../lib/format";
import { comparePaperSizes, paperSizeDisplay } from "../../lib/paperSizes";
import type { DocumentPricingRule, InventoryPaperSize, PrintTypeDefinition, ScanPricingTier } from "../../types/domain";
import "../SettingsPage.css";
import { PrintTypeCreateModal } from "./PrintTypeCreateModal";

interface MaterialSummary {
  id: string;
  name: string;
  paperSize: InventoryPaperSize;
  paperWidthMm?: number | null;
  paperHeightMm?: number | null;
}

function sortMaterials(materials: MaterialSummary[]): MaterialSummary[] {
  return materials.sort((left, right) =>
    comparePaperSizes(left.paperSize, right.paperSize) || left.name.localeCompare(right.name));
}

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
    description: "Default paper and print-type rates for Photocopy products. Scan has its own table below, since it consumes no print material.",
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
  const [editingMaterial, setEditingMaterial] = useState<{ scope: (typeof PRICING_SCOPES)[number]; material: MaterialSummary } | null>(null);
  const [removingTypeKey, setRemovingTypeKey] = useState<string | null>(null);
  const [printTypeError, setPrintTypeError] = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;
    setRules(data.rules);
  }, [data]);

  const printTypes = data?.printTypes.filter((printType) => printType.isActive) ?? [];

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

  async function removePrintType(printType: PrintTypeDefinition) {
    if (!window.confirm(`Remove "${printType.label}"? If it's still used by a product or a rate, it will be deactivated instead of deleted.`)) return;
    setRemovingTypeKey(printType.key);
    setPrintTypeError(null);
    try {
      await api.del(`/print-types/${printType.key}`);
      reload();
    } catch (caught) {
      setPrintTypeError(caught instanceof ApiError ? caught.message : `"${printType.label}" couldn't be removed.`);
    } finally {
      setRemovingTypeKey(null);
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
          Configure a separate global table for each built-in workflow. Printing and Photocopy rates stay tied to
          real paper inventory; Scan has no paper, so its rate instead depends on how many pages were scanned.
          Every value may still be overridden by an individual product.
        </p>

        {data?.printTypes.length ? (
          <div className="print-type-manager" aria-label="Configured print types">
            {data.printTypes.map((printType) => (
              <span className={`print-type-chip${printType.isActive ? "" : " is-inactive"}`} key={printType.key}>
                {printType.label}
                <button
                  type="button"
                  aria-label={`Remove ${printType.label}`}
                  disabled={removingTypeKey === printType.key}
                  onClick={() => removePrintType(printType)}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : null}
        {printTypeError ? <p className="workspace-form__error" role="alert">{printTypeError}</p> : null}

        {state === "loading" ? <LoadingState label="Loading pricing rules…" /> : null}
        {state === "error" ? <ErrorState description={error ?? undefined} onRetry={reload} /> : null}

        {state === "ready" && rules.length === 0 ? (
          <EmptyState
            title="No paper sizes configured yet"
            description="Tag an inventory material with a supported Canon paper size to start pricing by size."
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
                    <div className="pricing-materials" role="list" aria-label={`${scope.label} per-page pricing rules`}>
                      {sortMaterials(Array.from(new Map(scopedRules.map((rule) => [rule.inventoryItemId, {
                        id: rule.inventoryItemId,
                        name: rule.inventoryItemName,
                        paperSize: rule.paperSize,
                        paperWidthMm: rule.paperWidthMm,
                        paperHeightMm: rule.paperHeightMm,
                      }])).values())).map((material) => {
                        const materialRules = scopedRules.filter((rule) => rule.inventoryItemId === material.id);
                        const activeCount = materialRules.filter((rule) => rule.isActive).length;
                        return (
                          <button
                            type="button"
                            className="pricing-material"
                            role="listitem"
                            key={material.id}
                            onClick={() => setEditingMaterial({ scope, material })}
                          >
                            <span className="pricing-material__label"><strong>{material.name}</strong><small>{paperSizeDisplay(material.paperSize, material.paperWidthMm, material.paperHeightMm)}</small></span>
                            <span className="pricing-material__chips">
                              {printTypes.map((printType) => {
                                const rule = materialRules.find((candidate) => candidate.printType === printType.key);
                                if (!rule) return null;
                                return (
                                  <span className={`pricing-chip${rule.isActive ? "" : " is-inactive"}`} key={printType.key}>
                                    {printType.label || formatProductPrintType(printType.key)}
                                    <b className="numeric">₱{rule.pricePerPage.toFixed(2)}</b>
                                  </span>
                                );
                              })}
                            </span>
                            <span className="pricing-material__meta">
                              <b>{activeCount}</b> of {materialRules.length} active
                              <em aria-hidden="true">Edit →</em>
                            </span>
                          </button>
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

      <Card>
        <ScanPricingTiersSection />
      </Card>

      <MaterialRatesModal
        open={editingMaterial !== null}
        scopeLabel={editingMaterial?.scope.label ?? ""}
        material={editingMaterial?.material ?? null}
        materialRules={editingMaterial ? rules.filter((rule) => rule.pricingScope === editingMaterial.scope.key && rule.inventoryItemId === editingMaterial.material.id) : []}
        printTypes={printTypes}
        onChangeRule={updateRule}
        onClose={() => setEditingMaterial(null)}
      />
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

function MaterialRatesModal({
  open,
  scopeLabel,
  material,
  materialRules,
  printTypes,
  onChangeRule,
  onClose,
}: {
  open: boolean;
  scopeLabel: string;
  material: MaterialSummary | null;
  materialRules: DocumentPricingRule[];
  printTypes: PrintTypeDefinition[];
  onChangeRule: (id: string, patch: Partial<DocumentPricingRule>) => void;
  onClose: () => void;
}) {
  return (
    <Modal
      open={open}
      title={material ? `${material.name} · ${scopeLabel}` : "Material rates"}
      description={material ? `${paperSizeDisplay(material.paperSize, material.paperWidthMm, material.paperHeightMm)} · edits apply once you save pricing rules below.` : undefined}
      onClose={onClose}
      className="material-rates-modal"
    >
      <div className="settings-modal-body">
        <div className="material-rates-list">
          {printTypes.map((printType) => {
            const rule = materialRules.find((candidate) => candidate.printType === printType.key);
            return (
              <div className="material-rates-row" key={printType.key}>
                <div className="material-rates-row__label">
                  <strong>{printType.label || formatProductPrintType(printType.key)}</strong>
                  <small>{printType.appliesInkCoverage ? "Base + ink coverage" : "Paper and ink included"}</small>
                </div>
                {rule ? (
                  <div className="material-rates-row__controls">
                    <label className="settings-pricing-table__toggle">
                      <input type="checkbox" checked={rule.isActive} onChange={(event) => onChangeRule(rule.id, { isActive: event.target.checked })} />
                      <span>Use</span>
                    </label>
                    <label className="material-rates-row__money">
                      <span>₱</span>
                      <input
                        className="numeric"
                        type="number"
                        min="0"
                        step="0.01"
                        value={rule.pricePerPage}
                        aria-label={`${printType.label} rate for ${material?.name ?? "this material"}`}
                        onChange={(event) => onChangeRule(rule.id, { pricePerPage: Number(event.target.value) })}
                      />
                    </label>
                  </div>
                ) : <span className="material-rates-row__unset">Not configured for this paper</span>}
              </div>
            );
          })}
        </div>
        <footer className="settings-modal-actions">
          <Button type="button" variant="primary" onClick={onClose}>Done</Button>
        </footer>
      </div>
    </Modal>
  );
}

interface NewTierDraft {
  minPages: string;
  maxPages: string;
  pricePerPage: string;
}

const BLANK_TIER_DRAFT: NewTierDraft = { minPages: "", maxPages: "", pricePerPage: "" };

function ScanPricingTiersSection() {
  const { data, state, error, reload } = useResource(
    async () => api.get<ScanPricingTier[]>("/document-analyzer/scan-pricing-tiers"),
  );
  const [tiers, setTiers] = useState<ScanPricingTier[]>([]);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState<NewTierDraft>(BLANK_TIER_DRAFT);
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (data) setTiers(data);
  }, [data]);

  function updateLocalTier(id: string, patch: Partial<ScanPricingTier>) {
    setTiers((current) => current.map((tier) => tier.id === id ? { ...tier, ...patch } : tier));
  }

  async function saveTier(tier: ScanPricingTier) {
    setSavingIds((current) => new Set(current).add(tier.id));
    setRowErrors((current) => ({ ...current, [tier.id]: "" }));
    try {
      const updated = await api.put<ScanPricingTier>(`/document-analyzer/scan-pricing-tiers/${tier.id}`, {
        minPages: tier.minPages,
        maxPages: tier.maxPages,
        pricePerPage: tier.pricePerPage,
        isActive: tier.isActive,
      });
      setTiers((current) => current.map((candidate) => candidate.id === tier.id ? updated : candidate));
    } catch (caught) {
      setRowErrors((current) => ({ ...current, [tier.id]: caught instanceof ApiError ? caught.message : "This tier couldn’t be saved." }));
    } finally {
      setSavingIds((current) => {
        const next = new Set(current);
        next.delete(tier.id);
        return next;
      });
    }
  }

  async function removeTier(id: string) {
    if (!window.confirm("Remove this scan pricing tier? This can't be undone.")) return;
    setRemovingIds((current) => new Set(current).add(id));
    setRowErrors((current) => ({ ...current, [id]: "" }));
    try {
      await api.del(`/document-analyzer/scan-pricing-tiers/${id}`);
      setTiers((current) => current.filter((tier) => tier.id !== id));
    } catch (caught) {
      setRowErrors((current) => ({ ...current, [id]: caught instanceof ApiError ? caught.message : "This tier couldn’t be removed." }));
      setRemovingIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  }

  async function addTier(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAddError(null);
    const minPages = Number(draft.minPages);
    const maxPages = draft.maxPages.trim() ? Number(draft.maxPages) : null;
    const pricePerPage = Number(draft.pricePerPage);
    if (!draft.minPages.trim() || !Number.isFinite(minPages) || minPages < 1) {
      setAddError("Enter a starting page count of at least 1.");
      return;
    }
    if (maxPages !== null && (!Number.isFinite(maxPages) || maxPages < minPages)) {
      setAddError("The upper page count must be at or above the lower one — leave it blank for \"and up\".");
      return;
    }
    if (!draft.pricePerPage.trim() || !Number.isFinite(pricePerPage) || pricePerPage < 0) {
      setAddError("Enter a price of ₱0 or more.");
      return;
    }
    setAdding(true);
    try {
      const created = await api.post<ScanPricingTier>("/document-analyzer/scan-pricing-tiers", {
        minPages,
        maxPages,
        pricePerPage,
        isActive: true,
      });
      setTiers((current) => [...current, created]);
      setDraft(BLANK_TIER_DRAFT);
    } catch (caught) {
      setAddError(caught instanceof ApiError ? caught.message : "This tier couldn’t be added.");
    } finally {
      setAdding(false);
    }
  }

  const sortedTiers = [...tiers].sort((left, right) => left.minPages - right.minPages);

  return (
    <>
      <CardHeader
        title="Scan to softcopy"
        meta={`${tiers.filter((tier) => tier.isActive).length} active tiers`}
      />
      <p className="settings-placeholder-text">
        A scan's rate depends on how many pages it turns out to be, not on paper size or color. Configure page-count
        bands here — for example, "1–5 pages" at one rate and "6 and up" at another. A Scan product can still set
        its own flat price to skip these tiers entirely.
      </p>
      {state === "loading" ? <LoadingState label="Loading scan pricing tiers…" /> : null}
      {state === "error" ? <ErrorState description={error ?? undefined} onRetry={reload} /> : null}
      {state === "ready" ? (
        <div className="scan-tiers">
          {sortedTiers.length === 0 ? <p className="settings-placeholder-text">No page-count tiers yet — add one below.</p> : null}
          {sortedTiers.map((tier) => (
            <div className="scan-tier-row" key={tier.id}>
              <label className="form-field"><span>From page</span><input type="number" min={1} value={tier.minPages} disabled={savingIds.has(tier.id) || removingIds.has(tier.id)} onChange={(event) => updateLocalTier(tier.id, { minPages: Number(event.target.value) })} /></label>
              <label className="form-field"><span>To page</span><input type="number" min={1} placeholder="No limit" value={tier.maxPages ?? ""} disabled={savingIds.has(tier.id) || removingIds.has(tier.id)} onChange={(event) => updateLocalTier(tier.id, { maxPages: event.target.value === "" ? null : Number(event.target.value) })} /></label>
              <label className="form-field"><span>₱ / page</span><input className="numeric" type="number" min={0} step="0.01" value={tier.pricePerPage} disabled={savingIds.has(tier.id) || removingIds.has(tier.id)} onChange={(event) => updateLocalTier(tier.id, { pricePerPage: Number(event.target.value) })} /></label>
              <label className="settings-pricing-table__toggle">
                <input type="checkbox" checked={tier.isActive} disabled={savingIds.has(tier.id) || removingIds.has(tier.id)} onChange={(event) => updateLocalTier(tier.id, { isActive: event.target.checked })} />
                <span>Use</span>
              </label>
              <div className="scan-tier-row__actions">
                <Button type="button" variant="secondary" size="sm" loading={savingIds.has(tier.id)} disabled={removingIds.has(tier.id)} onClick={() => saveTier(tier)}>Save</Button>
                <Button type="button" variant="ghost" size="sm" loading={removingIds.has(tier.id)} disabled={savingIds.has(tier.id)} onClick={() => removeTier(tier.id)}>Remove</Button>
              </div>
              {rowErrors[tier.id] ? <p className="workspace-form__error scan-tier-row__error" role="alert">{rowErrors[tier.id]}</p> : null}
            </div>
          ))}
          <form className="scan-tier-row scan-tier-row--add" onSubmit={addTier}>
            <label className="form-field"><span>From page</span><input type="number" min={1} value={draft.minPages} onChange={(event) => setDraft((current) => ({ ...current, minPages: event.target.value }))} /></label>
            <label className="form-field"><span>To page</span><input type="number" min={1} placeholder="No limit" value={draft.maxPages} onChange={(event) => setDraft((current) => ({ ...current, maxPages: event.target.value }))} /></label>
            <label className="form-field"><span>₱ / page</span><input className="numeric" type="number" min={0} step="0.01" value={draft.pricePerPage} onChange={(event) => setDraft((current) => ({ ...current, pricePerPage: event.target.value }))} /></label>
            <Button type="submit" variant="primary" size="sm" loading={adding}>Add tier</Button>
            {addError ? <p className="workspace-form__error scan-tier-row__error" role="alert">{addError}</p> : null}
          </form>
        </div>
      ) : null}
    </>
  );
}
