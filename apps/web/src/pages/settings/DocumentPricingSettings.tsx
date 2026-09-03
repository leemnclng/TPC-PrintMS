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
import type { DocumentPricingRule, InventoryItem, InventoryPaperSize, PricingCategory, PrintTypeDefinition, ScanPricingTier } from "../../types/domain";
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

export function DocumentPricingSettings() {
  const { data, state, error, reload } = useResource(
    async () => {
      const [rules, printTypes, categories, inventoryItems] = await Promise.all([
        api.get<DocumentPricingRule[]>("/document-analyzer/pricing-rules"),
        api.get<PrintTypeDefinition[]>("/print-types"),
        api.get<PricingCategory[]>("/document-analyzer/pricing-categories"),
        api.get<InventoryItem[]>("/inventory-items"),
      ]);
      return { rules, printTypes, categories, inventoryItems };
    },
  );
  const [rules, setRules] = useState<DocumentPricingRule[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [createTypeOpen, setCreateTypeOpen] = useState(false);
  const [editingMaterial, setEditingMaterial] = useState<{ scope: PricingCategory; material: MaterialSummary } | null>(null);
  const [editingCategory, setEditingCategory] = useState<PricingCategory | "new" | null>(null);
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
              <Button type="button" variant="secondary" size="sm" onClick={() => setEditingCategory("new")}>Add pricing category</Button>
              <LinkButton to="/document-analyzer" variant="secondary" size="sm">Open analyzer</LinkButton>
            </div>
          )}
        />
        <p className="settings-placeholder-text">
          Create pricing categories for each physical workflow, then choose exactly which paper materials belong
          to each one. Products use one compatible category and may still override its rates.
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

        {state === "ready" && (data?.categories.length ?? 0) === 0 ? (
          <EmptyState
            title="No paper sizes configured yet"
            description="Tag an inventory material with a supported Canon paper size to start pricing by size."
            action={<LinkButton to="/inventory" variant="secondary" size="sm">Open inventory</LinkButton>}
          />
        ) : null}

        {state === "ready" && data?.categories.length ? (
          <form className="settings-pricing-form" onSubmit={handleSubmit}>
            <div className="settings-pricing-scopes">
              {data.categories.map((scope, scopeIndex) => {
                const scopedRules = rules.filter((rule) => rule.pricingScope === scope.key);
                return (
                  <section className="settings-pricing-scope" key={scope.key} aria-labelledby={`pricing-scope-${scope.key}`}>
                    <header className="settings-pricing-scope__header">
                      <span className="numeric">{String(scopeIndex + 1).padStart(2, "0")} / {scope.operationKind === "printing" ? "FILE-BASED OUTPUT" : scope.operationKind === "photocopy" ? "DEVICE-SIDE OUTPUT" : "EXTERNAL TRACKING"}</span>
                      <div><h3 id={`pricing-scope-${scope.key}`}>{scope.name}</h3><p>{scope.description || "Owner-managed pricing category."}</p></div>
                      <Button type="button" variant="ghost" size="sm" onClick={() => setEditingCategory(scope)}>Manage materials</Button>
                      <output>{scope.materialIds.length}<small>materials</small></output>
                    </header>
                    <div className="pricing-materials" role="list" aria-label={`${scope.name} per-page pricing rules`}>
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
                      {scope.materialIds.length === 0 ? (
                        <div className="pricing-material pricing-material--empty" role="listitem">
                          <span className="pricing-material__label"><strong>No materials assigned</strong><small>Choose paper stock before setting rates.</small></span>
                          <Button type="button" variant="secondary" size="sm" onClick={() => setEditingCategory(scope)}>Choose materials</Button>
                        </div>
                      ) : null}
                    </div>
                  </section>
                );
              })}
            </div>
            <div className="settings-form__actions">
              <Button type="submit" variant="primary" loading={saving} disabled={rules.length === 0}>Save pricing rules</Button>
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
        scopeLabel={editingMaterial?.scope.name ?? ""}
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
      <PricingCategoryModal
        open={editingCategory !== null}
        category={editingCategory === "new" ? null : editingCategory}
        inventoryItems={data?.inventoryItems ?? []}
        onClose={() => setEditingCategory(null)}
        onSaved={() => {
          setEditingCategory(null);
          reload();
        }}
      />
    </section>
  );
}

function PricingCategoryModal({
  open,
  category,
  inventoryItems,
  onClose,
  onSaved,
}: {
  open: boolean;
  category: PricingCategory | null;
  inventoryItems: InventoryItem[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [operationKind, setOperationKind] = useState<"printing" | "photocopy" | "adhoc">("printing");
  const [materialIds, setMaterialIds] = useState<string[]>([]);
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(category?.name ?? "");
    setDescription(category?.description ?? "");
    setOperationKind(category?.operationKind ?? "printing");
    setMaterialIds(category?.materialIds ?? []);
    setIsActive(category?.isActive ?? true);
    setSubmitted(false);
    setSaveError(null);
  }, [open, category]);

  const paperMaterials = inventoryItems
    .filter((item) => item.paperSize && (item.isActive || materialIds.includes(item.id)))
    .sort((left, right) => left.name.localeCompare(right.name));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
    setSaveError(null);
    if (!name.trim()) return;
    setSaving(true);
    const payload = {
      name: name.trim(),
      description: description.trim() || null,
      operationKind,
      materialIds,
      isActive,
    };
    try {
      if (category) await api.put(`/document-analyzer/pricing-categories/${category.key}`, payload);
      else await api.post("/document-analyzer/pricing-categories", payload);
      onSaved();
    } catch (caught) {
      setSaveError(caught instanceof ApiError ? caught.message : "The pricing category couldn’t be saved.");
    } finally {
      setSaving(false);
    }
  }

  function toggleMaterial(id: string, selected: boolean) {
    setMaterialIds((current) => selected ? [...current, id] : current.filter((value) => value !== id));
  }

  return (
    <Modal
      open={open}
      title={category ? `Manage ${category.name}` : "New pricing category"}
      description="Choose the workflow and only the paper materials this pricing table may use."
      busy={saving}
      status={saveError ? "error" : saving ? "loading" : "idle"}
      onClose={onClose}
      className="material-rates-modal"
    >
      <form className="settings-modal-body pricing-category-form" onSubmit={submit} noValidate>
        <label className={`form-field${submitted && !name.trim() ? " form-field--error" : ""}`}>
          <span>Category name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} aria-invalid={submitted && !name.trim()} autoFocus required />
          {submitted && !name.trim() ? <small className="workspace-form__error">Enter a category name.</small> : null}
        </label>
        <label className="form-field">
          <span>Compatible workflow</span>
          <select value={operationKind} disabled={Boolean(category?.isBuiltin)} onChange={(event) => setOperationKind(event.target.value as "printing" | "photocopy" | "adhoc")}>
            <option value="printing">Printing</option>
            <option value="photocopy">Photocopy</option>
            <option value="adhoc">Ad Hoc</option>
          </select>
          <small>Ad Hoc records work completed outside the app without printer or scanner control.</small>
        </label>
        <label className="form-field">
          <span>Description</span>
          <textarea rows={2} value={description} onChange={(event) => setDescription(event.target.value)} />
        </label>
        {category ? (
          <label className="settings-pricing-table__toggle pricing-category-form__active">
            <input type="checkbox" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} />
            <span>Available to products</span>
          </label>
        ) : null}
        <fieldset className="pricing-category-materials">
          <legend>Paper materials</legend>
          <p>Select only the stock that belongs in this category. A price row is created for every active print type.</p>
          {paperMaterials.length ? paperMaterials.map((item) => (
            <label key={item.id}>
              <input type="checkbox" checked={materialIds.includes(item.id)} disabled={!item.isActive && !materialIds.includes(item.id)} onChange={(event) => toggleMaterial(item.id, event.target.checked)} />
              <span><strong>{item.name}</strong><small>{paperSizeDisplay(item.paperSize!, item.paperWidthMm, item.paperHeightMm)}{item.isActive ? "" : " · inactive"}</small></span>
            </label>
          )) : <p>No active paper materials. Add a paper-sized item in Inventory first.</p>}
        </fieldset>
        {saveError ? <p className="workspace-form__error" role="alert">{saveError}</p> : null}
        <footer className="settings-modal-actions">
          <Button type="button" variant="ghost" disabled={saving} onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={saving}>{category ? "Save category" : "Create category"}</Button>
        </footer>
      </form>
    </Modal>
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
