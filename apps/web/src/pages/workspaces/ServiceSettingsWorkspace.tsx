import { FormEvent, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "../../components/Button/Button";
import { Card, CardHeader } from "../../components/Card/Card";
import { ErrorState } from "../../components/ErrorState/ErrorState";
import { LoadingState } from "../../components/LoadingState/LoadingState";
import { PageHeader } from "../../components/PageHeader/PageHeader";
import { useResource } from "../../hooks/useResource";
import { ApiError, api } from "../../lib/apiClient";
import type { Service, ServiceCategory } from "../../types/domain";
import "../workspaceForm.css";
import "./ServiceSettingsWorkspace.css";

export function ServiceSettingsWorkspace() {
  const navigate = useNavigate();
  const { serviceId } = useParams<{ serviceId: string }>();
  const isNew = !serviceId;
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<ServiceCategory>("custom");
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const { data, state, error, reload } = useResource<Service | null>(
    () => (serviceId ? api.get<Service>(`/services/${serviceId}`) : Promise.resolve(null)),
    [serviceId],
  );

  useEffect(() => {
    if (!data) return;
    setName(data.name);
    setDescription(data.description ?? "");
    setCategory(data.category);
    setIsActive(data.isActive);
  }, [data]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitError(null);
    setSaving(true);

    try {
      const payload = { name: name.trim(), description: description.trim() || undefined, category, isActive };
      const service = serviceId
        ? await api.put<Service>(`/services/${serviceId}`, payload)
        : await api.post<Service>("/services", payload);

      navigate(`/product-catalog/${service.id}`, { replace: true });
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Unable to save the service.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!serviceId || !window.confirm("Remove this service? This cannot be undone.")) return;
    setSubmitError(null);
    setDeleting(true);

    try {
      await api.del(`/services/${serviceId}`);
      navigate("/product-catalog", { replace: true });
    } catch (error) {
      setSubmitError(
        error instanceof ApiError && error.status === 409
          ? error.message
          : error instanceof Error
            ? error.message
            : "Unable to remove the service.",
      );
    } finally {
      setDeleting(false);
    }
  }

  if (state === "loading") return <LoadingState label="Loading service settings..." />;
  if (state === "error") return <ErrorState description={error ?? undefined} onRetry={reload} />;

  return (
    <>
      <PageHeader
        eyebrow="Services"
        title={isNew ? "New service" : "Service settings"}
        description={
          isNew
            ? "Create a service, then add the products customers can order inside it."
            : `Update the details for ${data?.name ?? "this service"}.`
        }
      />

      <Card className="service-settings">
        <CardHeader title={isNew ? "Service details" : data?.name ?? "Service details"} />
        <form className="workspace-form" onSubmit={handleSubmit}>
          <label className="form-field">
            <span>Service name</span>
            <input value={name} onChange={(event) => setName(event.target.value)} required />
          </label>

          <label className="form-field">
            <span>Description</span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={4}
            />
          </label>

          <label className="form-field">
            <span>Workflow category</span>
            <select
              value={category}
              disabled={!isNew && Boolean(data?.productCount)}
              onChange={(event) => setCategory(event.target.value as ServiceCategory)}
            >
              <option value="printing">Printing</option>
              <option value="photocopy">Scan or Photocopy</option>
              <option value="custom">Custom</option>
            </select>
            <small className="form-field__message">
              {category === "printing"
                ? "Uses document upload, analysis, pricing, and computer printing."
                : category === "photocopy"
                  ? "Supports device-side photocopies and scanner-generated softcopies."
                  : "Catalog category for services whose job workflow will be configured later."}
            </small>
            {!isNew && Boolean(data?.productCount) ? <small className="form-field__message">Remove this service's products before changing its workflow.</small> : null}
          </label>

          <label className="form-field">
            <span>Status</span>
            <select value={isActive ? "active" : "inactive"} onChange={(event) => setIsActive(event.target.value === "active")}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>

          {submitError ? <p className="workspace-form__error">{submitError}</p> : null}

          <div className="workspace-form__actions">
            <Button type="submit" variant="primary" loading={saving} disabled={deleting}>
              {saving ? "Saving..." : isNew ? "Create service" : "Save changes"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => navigate(isNew ? "/product-catalog" : `/product-catalog/${serviceId}`)}
            >
              Cancel
            </Button>
            {!isNew ? (
              <Button type="button" variant="danger" disabled={saving || deleting} onClick={handleDelete}>
                {deleting ? "Removing..." : "Remove service"}
              </Button>
            ) : null}
          </div>
        </form>
      </Card>
    </>
  );
}
