import { Button } from "../../components/Button/Button";
import { Modal } from "../../components/Modal/Modal";
import type { Service } from "../../types/domain";
import "./JobServiceChooserModal.css";

interface Props {
  open: boolean;
  services: Service[];
  onClose: () => void;
  onSelect: (service: Service) => void;
}

const CATEGORY_COPY = {
  printing: { code: "DOC", label: "Printing", detail: "Upload, analyze, price, and send a document to the printer." },
  photocopy: { code: "SCAN", label: "Scan or Photocopy", detail: "Record device-side copies or acquire a softcopy from the Windows scanner." },
  custom: { code: "MIX", label: "Custom", detail: "Start with a custom service, then add any configured product." },
} as const;

export function JobServiceChooserModal({ open, services, onClose, onSelect }: Props) {
  const activeServices = services.filter((service) => service.isActive);
  return (
    <Modal
      open={open}
      title="Choose a service"
      description="The service determines what information the job order needs."
      onClose={onClose}
      className="job-service-chooser"
    >
      <div className="job-service-chooser__body">
        {activeServices.length ? (
          <div className="job-service-chooser__grid">
            {activeServices.map((service) => {
              const category = CATEGORY_COPY[service.category];
              const available = service.productCount > 0;
              return (
                <button
                  type="button"
                  className="job-service-card"
                  key={service.id}
                  disabled={!available}
                  onClick={() => onSelect(service)}
                >
                  <span className="job-service-card__mark numeric" aria-hidden="true">{category.code}</span>
                  <span className="job-service-card__content">
                    <small>{category.label} workflow</small>
                    <strong>{service.name}</strong>
                    <span>{service.description || category.detail}</span>
                  </span>
                  <b>{available ? "Continue" : "Add a product first"}</b>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="job-service-chooser__empty">
            <strong>No active services are ready.</strong>
            <p>Add an active Printing or Photocopy service with at least one product.</p>
          </div>
        )}
        <footer><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button></footer>
      </div>
    </Modal>
  );
}
