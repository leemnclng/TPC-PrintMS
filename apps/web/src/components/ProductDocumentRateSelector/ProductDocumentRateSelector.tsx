import { formatCurrency } from "../../lib/format";
import type { DocumentPricingRule, InventoryPaperSize, ProductPrintType } from "../../types/domain";
import type { MaterialSelection } from "../MaterialMultiSelect/MaterialMultiSelect";
import "./ProductDocumentRateSelector.css";

const PAPER_ORDER: InventoryPaperSize[] = ["A4", "Letter", "Legal"];

export interface ProductDocumentRateSelection {
  pricingRuleId: string;
  pricePerPage: number;
}

interface ProductDocumentRateSelectorProps {
  idPrefix: string;
  /** The product's own required Print Type — only rates for this type are
   *  shown; there is no separate Colored/B&W choice at the product level. */
  printType: ProductPrintType;
  pricingRules: DocumentPricingRule[];
  value: ProductDocumentRateSelection[];
  materialAssignments: MaterialSelection[];
  onChange: (value: ProductDocumentRateSelection[], materialAssignments: MaterialSelection[]) => void;
  disabled?: boolean;
}

export function ProductDocumentRateSelector({
  idPrefix,
  printType,
  pricingRules,
  value,
  materialAssignments,
  onChange,
  disabled = false,
}: ProductDocumentRateSelectorProps) {
  const relevantRules = pricingRules
    .filter((rule) =>
      rule.printType === printType && (
        rule.isActive || materialAssignments.some((entry) => entry.inventoryItemId === rule.inventoryItemId)
      ))
    .sort((left, right) =>
      PAPER_ORDER.indexOf(left.paperSize) - PAPER_ORDER.indexOf(right.paperSize) ||
      left.inventoryItemName.localeCompare(right.inventoryItemName));

  function toggleMaterial(rule: DocumentPricingRule, selected: boolean) {
    const nextMaterials = selected
      ? materialAssignments.some((entry) => entry.inventoryItemId === rule.inventoryItemId)
        ? materialAssignments
        : [...materialAssignments, { inventoryItemId: rule.inventoryItemId }]
      : materialAssignments.filter((entry) => entry.inventoryItemId !== rule.inventoryItemId);
    const nextRates = selected ? value : value.filter((entry) => entry.pricingRuleId !== rule.id);
    onChange(nextRates, nextMaterials);
  }

  function updateRateSource(rule: DocumentPricingRule, source: "global" | "custom") {
    const nextRates = source === "custom"
      ? [...value.filter((entry) => entry.pricingRuleId !== rule.id), {
          pricingRuleId: rule.id,
          pricePerPage: rule.pricePerPage,
        }]
      : value.filter((entry) => entry.pricingRuleId !== rule.id);
    onChange(nextRates, materialAssignments);
  }

  function updatePrice(pricingRuleId: string, pricePerPage: number) {
    onChange(
      value.map((entry) => entry.pricingRuleId === pricingRuleId
        ? { ...entry, pricePerPage: Math.max(0, pricePerPage) }
        : entry),
      materialAssignments,
    );
  }

  return (
    <div className="product-document-rate-selector">
      {relevantRules.map((rule) => {
        const selection = value.find((entry) => entry.pricingRuleId === rule.id);
        const usesMaterial = materialAssignments.some((entry) => entry.inventoryItemId === rule.inventoryItemId);
        const messageId = `${idPrefix}-${rule.id}-message`;
        return (
          <div className="product-document-rate-selector__row" key={rule.id} data-selected={usesMaterial ? "true" : undefined}>
            <label className="product-document-rate-selector__choice">
              <input
                type="checkbox"
                checked={usesMaterial}
                disabled={disabled || (!rule.isActive && !usesMaterial)}
                aria-describedby={messageId}
                onChange={(event) => toggleMaterial(rule, event.target.checked)}
              />
              <span>
                <strong>{rule.inventoryItemName}</strong>
                <small id={messageId}>
                  {rule.paperSize} · {rule.isActive
                    ? usesMaterial ? "Assigned to this product" : "Not used by this product"
                    : "Pricing inactive"}
                </small>
              </span>
            </label>
            {usesMaterial ? (
              <div className="product-document-rate-selector__pricing">
                <label>
                  <span>Pricing</span>
                  <select
                    value={selection ? "custom" : "global"}
                    disabled={disabled || !rule.isActive}
                    onChange={(event) => updateRateSource(rule, event.target.value as "global" | "custom")}
                  >
                    <option value="global">Global · {formatCurrency(rule.pricePerPage)}</option>
                    <option value="custom">Custom price</option>
                  </select>
                </label>
                {selection ? (
                  <label>
                    <span>Price per page</span>
                    <input
                      className="numeric"
                      type="number"
                      min="0"
                      step="0.01"
                      value={selection.pricePerPage}
                      disabled={disabled || !rule.isActive}
                      aria-label={`${rule.paperSize} price override`}
                      onChange={(event) => updatePrice(rule.id, Number(event.target.value))}
                    />
                  </label>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
