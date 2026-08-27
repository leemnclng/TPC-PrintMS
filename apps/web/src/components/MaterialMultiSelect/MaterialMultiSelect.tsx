import type { InventoryItem } from "../../types/domain";
import "./MaterialMultiSelect.css";

export interface MaterialSelection {
  inventoryItemId: string;
}

interface MaterialMultiSelectProps {
  idPrefix: string;
  items: InventoryItem[];
  value: MaterialSelection[];
  onChange: (value: MaterialSelection[]) => void;
  disabled?: boolean;
}

export function MaterialMultiSelect({
  idPrefix,
  items,
  value,
  onChange,
  disabled = false,
}: MaterialMultiSelectProps) {
  const selectedCount = value.length;

  function toggleMaterial(item: InventoryItem, checked: boolean) {
    if (checked) {
      if (value.some((selection) => selection.inventoryItemId === item.id)) return;
      onChange([...value, { inventoryItemId: item.id }]);
      return;
    }
    onChange(value.filter((selection) => selection.inventoryItemId !== item.id));
  }

  return (
    <div className="material-multiselect">
      <div className="material-multiselect__summary" aria-live="polite">
        <span>{selectedCount} selected</span>
        <span>Select all materials this product may use.</span>
      </div>

      <div className="material-multiselect__list">
        {items.map((item) => {
          const selection = value.find((candidate) => candidate.inventoryItemId === item.id);
          const selected = Boolean(selection);
          const unavailable = !item.isActive && !selected;
          const itemMessageId = `${idPrefix}-${item.id}-meta`;

          return (
            <div
              className="material-multiselect__item"
              data-selected={selected || undefined}
              data-disabled={unavailable || undefined}
              key={item.id}
            >
              <label className="material-multiselect__choice">
                <input
                  type="checkbox"
                  checked={selected}
                  disabled={disabled || unavailable}
                  onChange={(event) => toggleMaterial(item, event.target.checked)}
                  aria-describedby={itemMessageId}
                />
                <span className="material-multiselect__identity">
                  <strong>{item.name}{item.isActive ? "" : " (inactive)"}</strong>
                  <span id={itemMessageId}>
                    {item.category} · {item.quantityOnHand.toLocaleString()} {item.unit} on hand
                  </span>
                </span>
              </label>

            </div>
          );
        })}
      </div>
    </div>
  );
}
