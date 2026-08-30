import type { DocumentPricingRule, InventoryPaperSize, Product } from "../types/domain";

export interface ProductPricePoint {
  key: string;
  label: string;
  materialName?: string;
  amount: number;
  custom: boolean;
  paperSize?: InventoryPaperSize;
}

/** Resolve the same active per-page values used by product and transaction pricing. */
export function resolveProductPricePoints(product: Product, rules: DocumentPricingRule[]): ProductPricePoint[] {
  if (product.operationKind === "scan") {
    return product.standalonePricePerPage == null ? [] : [{ key: "scan", label: "Per scanned page", amount: product.standalonePricePerPage, custom: true }];
  }

  const overrides = new Map(product.documentRates.map((rate) => [rate.pricingRuleId, rate]));
  return product.materialAssignments.flatMap((assignment) => {
    const rule = rules.find((candidate) => candidate.isActive && candidate.inventoryItemId === assignment.inventoryItemId && candidate.printType === product.printType);
    if (!rule) return [];
    const override = overrides.get(rule.id);
    return [{
      key: rule.id,
      label: `${rule.paperSize} · ${assignment.inventoryItemName}`,
      materialName: assignment.inventoryItemName,
      amount: override?.pricePerPage ?? rule.pricePerPage,
      custom: Boolean(override),
      paperSize: rule.paperSize,
    }];
  });
}

export function productUsesPaperSize(product: Product, paperSize: InventoryPaperSize, rules: DocumentPricingRule[]): boolean {
  const materialIds = new Set(product.materialAssignments.map((assignment) => assignment.inventoryItemId));
  return rules.some((rule) => materialIds.has(rule.inventoryItemId) && rule.paperSize === paperSize);
}

export function hasCustomPricing(product: Product): boolean {
  return product.standalonePricePerPage != null || product.documentRates.length > 0 || product.variants.length > 0;
}
