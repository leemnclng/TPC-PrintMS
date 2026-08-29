import type { DocumentPricingRule, ProductPrintType } from "../types/domain";

/** Mirrors the backend's product-pricing resolver. The catalog reference is
 * the lowest active rate among the product's assigned paper materials. */
export function computeReferencePrice(
  printType: ProductPrintType,
  documentRates: { pricingRuleId: string; pricePerPage: number }[],
  pricingRules: DocumentPricingRule[],
  materialAssignments: { inventoryItemId: string }[],
  requireCustomRate = false,
): number {
  const materialIds = new Set(materialAssignments.map((assignment) => assignment.inventoryItemId));
  const prices = pricingRules
    .filter((rule) => rule.isActive && rule.printType === printType && materialIds.has(rule.inventoryItemId))
    .flatMap((rule) => {
      const customRate = documentRates.find((rate) => rate.pricingRuleId === rule.id);
      if (requireCustomRate && !customRate) return [];
      return [customRate?.pricePerPage ?? rule.pricePerPage];
    });
  return prices.length ? Math.min(...prices) : 0;
}

export function computeSelectedMaterialPrice(
  printType: ProductPrintType,
  documentRates: { pricingRuleId: string; pricePerPage: number }[],
  pricingRules: DocumentPricingRule[],
  inventoryItemId: string,
  requireCustomRate = false,
): number | null {
  const rule = pricingRules.find(
    (candidate) => candidate.isActive && candidate.printType === printType && candidate.inventoryItemId === inventoryItemId,
  );
  if (!rule) return null;
  const customRate = documentRates.find((rate) => rate.pricingRuleId === rule.id);
  if (requireCustomRate && !customRate) return null;
  return customRate?.pricePerPage ?? rule.pricePerPage;
}
