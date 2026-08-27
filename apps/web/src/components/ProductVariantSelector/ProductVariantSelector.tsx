import { formatCurrency } from "../../lib/format";
import type { Variant } from "../../types/domain";
import "./ProductVariantSelector.css";

export interface ProductVariantSelection {
  variantId: string;
  priceAdjustment: number;
}

interface ProductVariantSelectorProps {
  idPrefix: string;
  variants: Variant[];
  value: ProductVariantSelection[];
  referencePrice: number;
  onChange: (value: ProductVariantSelection[]) => void;
  disabled?: boolean;
}

export function ProductVariantSelector({
  idPrefix,
  variants,
  value,
  referencePrice,
  onChange,
  disabled = false,
}: ProductVariantSelectorProps) {
  function toggle(variantId: string, selected: boolean) {
    onChange(
      selected
        ? [...value, { variantId, priceAdjustment: 0 }]
        : value.filter((entry) => entry.variantId !== variantId),
    );
  }

  function updatePrice(variantId: string, priceAdjustment: number) {
    onChange(value.map((entry) => entry.variantId === variantId
      ? { ...entry, priceAdjustment }
      : entry));
  }

  return (
    <div className="product-variant-selector">
      {variants.map((variant) => {
        const selection = value.find((entry) => entry.variantId === variant.id);
        const finalPrice = referencePrice + (selection?.priceAdjustment ?? 0);
        const priceError = Boolean(selection && finalPrice < 0);
        const messageId = `${idPrefix}-${variant.id}-message`;
        return (
          <div className="product-variant-selector__row" key={variant.id} data-selected={selection ? "true" : undefined}>
            <label className="product-variant-selector__choice">
              <input
                type="checkbox"
                checked={Boolean(selection)}
                disabled={disabled}
                onChange={(event) => toggle(variant.id, event.target.checked)}
                aria-describedby={messageId}
              />
              <span>
                <strong>{variant.label}</strong>
                <small id={messageId}>
                  {variant.isActive
                    ? variant.description || "Available global variant"
                    : `Inactive${variant.description ? ` · ${variant.description}` : " · kept on this product"}`}
                </small>
              </span>
            </label>
            {selection ? (
              <label className={["product-variant-selector__price", priceError ? "form-field--error" : ""].filter(Boolean).join(" ")}>
                <span>Price adjustment</span>
                <div>
                  <input
                    className="numeric"
                    type="number"
                    step="0.01"
                    value={selection.priceAdjustment}
                    disabled={disabled}
                    onChange={(event) => updatePrice(variant.id, Number(event.target.value))}
                    aria-invalid={priceError}
                    aria-label={`${variant.label} price adjustment`}
                  />
                  <output className="numeric">{formatCurrency(finalPrice)}</output>
                </div>
                <small className={priceError ? "product-variant-selector__error" : undefined}>
                  {priceError ? "Final price cannot be negative." : "Final price per page / unit"}
                </small>
              </label>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
