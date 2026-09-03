import type { DocumentPricingRule, ProductPrintType, ScanPricingTier } from "../types/domain";

/** Mirrors the backend's product-pricing resolver. The catalog reference is
 * the lowest active rate among the product's assigned paper materials. */
export function computeReferencePrice(
  printType: ProductPrintType,
  pricingCategoryKey: string,
  documentRates: { pricingRuleId: string; pricePerPage: number }[],
  pricingRules: DocumentPricingRule[],
  materialAssignments: { inventoryItemId: string }[],
  requireCustomRate = false,
): number {
  const materialIds = new Set(materialAssignments.map((assignment) => assignment.inventoryItemId));
  const prices = pricingRules
    .filter((rule) => rule.isActive && rule.printType === printType && rule.pricingScope === pricingCategoryKey && materialIds.has(rule.inventoryItemId))
    .flatMap((rule) => {
      const customRate = documentRates.find((rate) => rate.pricingRuleId === rule.id);
      if (requireCustomRate && !customRate) return [];
      return [customRate?.pricePerPage ?? rule.pricePerPage];
    });
  return prices.length ? Math.min(...prices) : 0;
}

export function computeSelectedMaterialPrice(
  printType: ProductPrintType,
  pricingCategoryKey: string,
  documentRates: { pricingRuleId: string; pricePerPage: number }[],
  pricingRules: DocumentPricingRule[],
  inventoryItemId: string,
  requireCustomRate = false,
): number | null {
  const rule = pricingRules.find(
    (candidate) => candidate.isActive && candidate.printType === printType && candidate.pricingScope === pricingCategoryKey && candidate.inventoryItemId === inventoryItemId,
  );
  if (!rule) return null;
  const customRate = documentRates.find((rate) => rate.pricingRuleId === rule.id);
  if (requireCustomRate && !customRate) return null;
  return customRate?.pricePerPage ?? rule.pricePerPage;
}

/** Mirrors the backend's resolve_scan_price_per_page: a Scan product's own
 * standalone price when set, otherwise the active global tier whose
 * page-count range covers `pages`. `null` when neither exists. */
export function resolveScanPricePerPage(
  standalonePricePerPage: number | null | undefined,
  pages: number,
  scanPricingTiers: ScanPricingTier[],
): number | null {
  if (standalonePricePerPage !== null && standalonePricePerPage !== undefined) return standalonePricePerPage;
  const tier = scanPricingTiers.find(
    (candidate) => candidate.isActive && candidate.minPages <= pages && (candidate.maxPages === null || pages <= candidate.maxPages),
  );
  return tier ? tier.pricePerPage : null;
}

/** Mirrors the backend's has_scan_pricing_configured: whether a Scan product
 * could ever be priced, before the real page count (and therefore the exact
 * rate) is known. */
export function hasScanPricingConfigured(
  standalonePricePerPage: number | null | undefined,
  scanPricingTiers: ScanPricingTier[],
): boolean {
  if (standalonePricePerPage !== null && standalonePricePerPage !== undefined) return true;
  return scanPricingTiers.some((tier) => tier.isActive);
}
