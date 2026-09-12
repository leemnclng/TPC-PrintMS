import type { DocumentPricingRule, GlobalPricingVariable, InventoryPaperSize, PricingDiscount, Product, ScanPricingTier } from "../types/domain";

export interface ProductPricePoint {
  key: string;
  label: string;
  materialName?: string;
  amount: number;
  custom: boolean;
  paperSize?: InventoryPaperSize;
}

export interface ProductPriceRange {
  minimum: number;
  maximum: number;
  hasAddOns: boolean;
}

/** Mirrors suggested-price behavior: all percentages share the unadjusted
 * basis, fixed charges are added once, and the result rounds upward. */
export function applyGlobalPricingVariables(amount: number, variables: GlobalPricingVariable[]): number {
  const basis = Math.max(0, amount);
  const adjustment = variables.filter((item) => item.isActive).reduce(
    (total, item) => total + (item.calculationType === "percentage" ? basis * item.value / 100 : item.value),
    0,
  );
  return Math.ceil(Math.max(0, basis + adjustment));
}

export function applyEffectivePricing(
  amount: number,
  productId: string,
  variables: GlobalPricingVariable[],
  discounts: PricingDiscount[],
): number {
  const basis = Math.max(0, amount);
  const globalTotal = variables.filter((item) => item.isActive).reduce(
    (total, item) => total + (item.calculationType === "percentage" ? basis * item.value / 100 : item.value),
    0,
  );
  const withGlobals = basis + globalTotal;
  const discountTotal = discounts.filter((item) => item.isActive && item.productIds.includes(productId)).reduce(
    (total, item) => total + (item.calculationType === "percentage" ? withGlobals * item.value / 100 : item.value),
    0,
  );
  return Math.ceil(Math.max(0, withGlobals - discountTotal));
}

export function resolveProductPriceRange(
  product: Product,
  rules: DocumentPricingRule[],
  scanTiers: ScanPricingTier[],
  variables: GlobalPricingVariable[],
  discounts: PricingDiscount[] = [],
): ProductPriceRange | null {
  const points = product.operationKind === "scan" && product.standalonePricePerPage == null
    ? scanTiers.filter((tier) => tier.isActive).map((tier) => ({ amount: tier.pricePerPage }))
    : resolveProductPricePoints(product, rules, scanTiers);
  if (!points.length) return null;
  const addOns = [0, ...product.variants.map((variant) => variant.priceAdjustment)];
  const prices = points.flatMap((point) => addOns.map((addOn) => applyEffectivePricing(point.amount + addOn, product.id, variables, discounts)));
  return { minimum: Math.min(...prices), maximum: Math.max(...prices), hasAddOns: product.variants.length > 0 };
}

export function formatProductPriceRange(range: ProductPriceRange | null, format: (amount: number) => string): string {
  if (!range) return "Not configured";
  return range.minimum === range.maximum ? format(range.minimum) : `${format(range.minimum)}–${format(range.maximum)}`;
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
