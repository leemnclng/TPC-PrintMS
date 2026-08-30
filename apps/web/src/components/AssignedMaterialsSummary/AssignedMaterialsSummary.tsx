import { formatCurrency } from "../../lib/format";
import type {
  DocumentPricingRule,
  InventoryItem,
  ProductOperationKind,
  ProductPrintType,
} from "../../types/domain";
import type { MaterialSelection } from "../MaterialMultiSelect/MaterialMultiSelect";
import type { ProductDocumentRateSelection } from "../ProductDocumentRateSelector/ProductDocumentRateSelector";

interface AssignedMaterialsSummaryProps {
  items: InventoryItem[];
  value: MaterialSelection[];
  printType: ProductPrintType;
  operationKind: ProductOperationKind;
  pricingRules: DocumentPricingRule[];
  documentRates: ProductDocumentRateSelection[];
  error?: string | null;
}

export function AssignedMaterialsSummary({
  items,
  value,
  printType,
  operationKind,
  pricingRules,
  documentRates,
  error,
}: AssignedMaterialsSummaryProps) {
  const itemById = new Map(items.map((item) => [item.id, item]));
  const assignedItems = value
    .map((assignment) => itemById.get(assignment.inventoryItemId))
    .filter((item): item is InventoryItem => Boolean(item));

  return (
    <aside className="assigned-materials-summary" aria-labelledby="assigned-materials-title">
      <header>
        <div>
          <span>Product output</span>
          <h3 id="assigned-materials-title">Assigned materials</h3>
        </div>
        <output aria-live="polite">{assignedItems.length}</output>
      </header>

      {assignedItems.length ? (
        <ul>
          {assignedItems.map((item) => {
            const pricingRule = item.paperSize
              ? pricingRules.find(
                  (rule) => rule.inventoryItemId === item.id && rule.printType === printType && rule.pricingScope === operationKind && rule.isActive,
                )
              : null;
            const override = pricingRule
              ? documentRates.find((rate) => rate.pricingRuleId === pricingRule.id)
              : null;
            return (
              <li key={item.id}>
                <strong>{item.name}{item.isActive ? "" : " (inactive)"}</strong>
                <span>
                  {item.paperSize
                    ? `${item.paperSize} paper · ${pricingRule ? `${formatCurrency(override?.pricePerPage ?? pricingRule.pricePerPage)} / page` : "No active price"}`
                    : `${item.category} · ${item.quantityOnHand.toLocaleString()} ${item.unit} on hand`}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p>No materials assigned yet. Select a paper material or an additional production supply.</p>
      )}

      {error ? <p className="assigned-materials-summary__error" role="alert">{error}</p> : null}
    </aside>
  );
}
