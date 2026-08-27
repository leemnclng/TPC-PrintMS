import { useEffect, useState } from "react";
import { Button } from "../../components/Button/Button";
import { LinkButton } from "../../components/Button/LinkButton";
import { EmptyState } from "../../components/EmptyState/EmptyState";
import { ErrorState } from "../../components/ErrorState/ErrorState";
import { LoadingState } from "../../components/LoadingState/LoadingState";
import { PageHeader } from "../../components/PageHeader/PageHeader";
import { StatusPill } from "../../components/StatusPill/StatusPill";
import { useResource } from "../../hooks/useResource";
import { ApiError, api } from "../../lib/apiClient";
import type { Variant } from "../../types/domain";
import { VariantModal } from "./ServiceVariantModal";
import "./ServiceVariantsWorkspace.css";

export function VariantsWorkspace() {
  const { data, state, error, reload } = useResource(
    () => api.get<Variant[]>("/variants"),
    [],
  );
  const [variants, setVariants] = useState<Variant[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingVariant, setEditingVariant] = useState<Variant | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (data) setVariants(data);
  }, [data]);

  function openCreate() {
    setEditingVariant(null);
    setActionError(null);
    setModalOpen(true);
  }

  function openEdit(variant: Variant) {
    setEditingVariant(variant);
    setActionError(null);
    setModalOpen(true);
  }

  function handleSaved(saved: Variant) {
    setVariants((current) => {
      const exists = current.some((variant) => variant.id === saved.id);
      const next = exists
        ? current.map((variant) => variant.id === saved.id ? saved : variant)
        : [...current, saved];
      return next.sort((left, right) => Number(right.isActive) - Number(left.isActive) || left.label.localeCompare(right.label));
    });
    setModalOpen(false);
  }

  async function removeVariant(variant: Variant) {
    if (variant.linkedProductCount > 0) return;
    if (!window.confirm(`Remove ${variant.label}? This can't be undone.`)) return;
    setActionError(null);
    try {
      await api.del(`/variants/${variant.id}`);
      setVariants((current) => current.filter((item) => item.id !== variant.id));
    } catch (error) {
      setActionError(error instanceof ApiError ? error.message : "The variant couldn’t be removed. Try again.");
    }
  }

  if (state === "loading") return <LoadingState label="Loading global variants…" />;
  if (state === "error" || !data) {
    return <ErrorState description={error ?? "Variants could not be loaded."} onRetry={reload} />;
  }

  const activeCount = variants.filter((variant) => variant.isActive).length;
  const linkedProductCount = variants.reduce((total, variant) => total + variant.linkedProductCount, 0);

  return (
    <>
      <PageHeader
        eyebrow="CONFIGURATION"
        title="Global variants"
        description="Create reusable options once, then assign them to products in any service."
        actions={
          <>
            <LinkButton variant="secondary" to="/configuration">Back to configuration</LinkButton>
            <Button type="button" variant="primary" onClick={openCreate}>New variant</Button>
          </>
        }
      />

      <div className="service-variants-studio">
        <aside className="service-variants-studio__context">
          <span>Global library</span>
          <h2>All services</h2>
          <p>
            Names and descriptions are shared everywhere. Each product decides which variants apply and how much they change its base price.
          </p>
          <dl>
            <div><dt>Active</dt><dd className="numeric">{activeCount}</dd></div>
            <div><dt>Product links</dt><dd className="numeric">{linkedProductCount}</dd></div>
          </dl>
        </aside>

        <section className="service-variants-register" aria-labelledby="service-variants-title">
          <header>
            <div>
              <h2 id="service-variants-title">Reusable options</h2>
              <p>Use Edit to rename an option, clarify its use, or stop new product assignments.</p>
            </div>
            <span className="numeric">{variants.length} {variants.length === 1 ? "variant" : "variants"}</span>
          </header>

          {actionError ? <p className="workspace-form__error" role="alert">{actionError}</p> : null}

          {variants.length === 0 ? (
            <EmptyState
              title="No global variants"
              description="Create an option such as Back-to-back, Rush, or Premium finish, then assign it to products in any service."
              action={<Button type="button" variant="secondary" onClick={openCreate}>New variant</Button>}
            />
          ) : (
            <div className="service-variants-list">
              {variants.map((variant) => (
                <article key={variant.id}>
                  <div className="service-variants-list__identity">
                    <strong>{variant.label}</strong>
                    <span>{variant.description || "No description"}</span>
                  </div>
                  <div className="service-variants-list__usage">
                    <span className="numeric">{variant.linkedProductCount}</span>
                    <small>{variant.linkedProductCount === 1 ? "linked product" : "linked products"}</small>
                  </div>
                  <StatusPill
                    label={variant.isActive ? "Active" : "Inactive"}
                    tone={variant.isActive ? "success" : "neutral"}
                  />
                  <div className="service-variants-list__actions">
                    <Button type="button" variant="ghost" size="sm" onClick={() => openEdit(variant)}>Edit</Button>
                    <Button
                      type="button"
                      variant="danger"
                      size="sm"
                      disabled={variant.linkedProductCount > 0}
                      title={variant.linkedProductCount > 0 ? "Remove this variant from linked products first." : undefined}
                      onClick={() => removeVariant(variant)}
                    >
                      Remove
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>

      <VariantModal
        open={modalOpen}
        variant={editingVariant}
        onClose={() => setModalOpen(false)}
        onSaved={handleSaved}
      />
    </>
  );
}
