import type { DocumentPricingRule, InventoryPaperSize, Product, ScanPricingTier } from "../types/domain";

export interface ProductPricePoint {
  key: string;
  label: string;
  materialName?: string;
  amount: number;
  custom: boolean;
  paperSize?: InventoryPaperSize;
}

/** Resolve the same active per-page values used by product and transaction
 * pricing. `scanTiers` is the global page-count table Scan products fall
 * back to when they have no standalone price of their own — the 1-page tier
 * stands in as a representative rate, since a scan's real price depends on
 * how many pages it turns out to be. */
export function resolveProductPricePoints(product: Product, rules: DocumentPricingRule[], scanTiers: ScanPricingTier[] = []): ProductPricePoint[] {
  if (product.operationKind === "scan") {
    if (product.standalonePricePerPage != null) {
      return [{ key: "scan", label: "Per scanned page", amount: product.standalonePricePerPage, custom: true }];
    }
    const tier = scanTiers.find((candidate) => candidate.isActive && candidate.minPages <= 1 && (candidate.maxPages === null || candidate.maxPages >= 1));
    return tier ? [{ key: "scan", label: "Per scanned page", amount: tier.pricePerPage, custom: false }] : [];
  }

  const overrides = new Map(product.documentRates.map((rate) => [rate.pricingRuleId, rate]));
  return product.materialAssignments.flatMap((assignment) => {
    const rule = rules.find((candidate) => candidate.isActive && candidate.inventoryItemId === assignment.inventoryItemId && candidate.printType === product.printType && candidate.pricingScope === (product.pricingCategoryKey ?? product.operationKind));
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
  return rules.some((rule) => materialIds.has(rule.inventoryItemId) && rule.paperSize === paperSize && rule.pricingScope === (product.pricingCategoryKey ?? product.operationKind));
}

export function hasCustomPricing(product: Product): boolean {
  return product.standalonePricePerPage != null || product.documentRates.length > 0 || product.variants.length > 0;
}
