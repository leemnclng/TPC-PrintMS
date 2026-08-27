import { useEffect, useState } from "react";
import { Button } from "../../components/Button/Button";
import { Modal } from "../../components/Modal/Modal";
import { ApiError, api } from "../../lib/apiClient";
import type { InventoryItem } from "../../types/domain";
import "../workspaceForm.css";
import "./InventoryModals.css";

interface DeleteInventoryItemModalProps {
  open: boolean;
  item: InventoryItem | null;
  onClose: () => void;
  onDeleted: (item: InventoryItem) => void;
}

export function DeleteInventoryItemModal({ open, item, onClose, onDeleted }: DeleteInventoryItemModalProps) {
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDeleting(false);
    setDeleteError(null);
  }, [open, item]);

  async function handleDelete() {
    if (!item) return;
    const currentItem = item;
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.del(`/inventory-items/${currentItem.id}`);
      onDeleted(currentItem);
    } catch (error) {
      setDeleteError(error instanceof ApiError ? error.message : "The material wasn’t deleted. Try again.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Modal
      open={open}
      title="Delete material"
      description={item ? `Remove ${item.name} from inventory? This can't be undone.` : undefined}
      busy={deleting}
      status={deleteError ? "error" : deleting ? "loading" : "idle"}
      onClose={onClose}
      className="inventory-modal inventory-modal--compact"
    >
      <div className="inventory-modal__form">
        <div className="inventory-modal__fields">
          {item ? (
            <p className="workspace-form__hint">
              {item.quantityOnHand.toLocaleString()} {item.unit} on hand and its full stock-movement history will be
              deleted permanently. Materials linked to a product, a job order, or document-analyzer pricing can't be
              deleted — deactivate them instead.
            </p>
          ) : null}
          {deleteError ? <p className="workspace-form__error" role="alert">{deleteError}</p> : null}
        </div>
        <footer className="inventory-modal__actions">
          <Button type="button" variant="ghost" disabled={deleting} onClick={onClose}>Cancel</Button>
          <Button type="button" variant="danger" loading={deleting} onClick={handleDelete}>Delete material</Button>
        </footer>
      </div>
    </Modal>
  );
}
