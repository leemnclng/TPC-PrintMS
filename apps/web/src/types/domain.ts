// Shared domain types for Printing-MS.
//
// Status literals mirror the lifecycle strings agreed in
// docs/context/build-plan.md. They are implemented as-is because they are
// the current documented working draft — see docs/context/issues-log.md for
// the open question about final transition permissions.

export type QuotationStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "sent"
  | "accepted"
  | "rejected"
  | "expired";

export type JobOrderStatus =
  | "pending_payment"
  | "paid"
  | "queued"
  | "printing"
  | "quality_check"
  | "ready"
  | "released"
  | "delivered"
  | "completed"
  | "on_hold"
  | "cancelled";

export type SourceChannel = "messenger" | "gmail" | "form" | "walk_in" | "phone" | "other";

export type PrinterState = "idle" | "printing" | "offline" | "error" | "unknown";

export interface Customer {
  id: string;
  displayName: string;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  sourceChannel: SourceChannel;
  notes?: string | null;
  quotationCount: number;
  jobOrderCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProductVariant {
  id: string;
  variantId: string;
  label: string; // e.g. "A4 · 300gsm matte"
  priceAdjustment: number;
}

export interface Variant {
  id: string;
  label: string;
  description?: string | null;
  linkedProductCount: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProductMaterialAssignment {
  id: string;
  inventoryItemId: string;
  inventoryItemName: string;
  inventoryItemUnit: string;
}

export type ProductPrintType = "colored" | "black_and_white";

/** The only paper sizes the shop stocks and prices by — a fixed subset of
 *  `DocumentPaperSize`, which stays the full detection outcome (a scanned
 *  file can still measure as A3/Custom/Unknown, it just won't price). */
export type InventoryPaperSize = "A4" | "Letter" | "Legal";

export interface ProductDocumentRate {
  id: string;
  pricingRuleId: string;
  paperSize: InventoryPaperSize;
  printType: ProductPrintType;
  pricePerPage: number;
}

export interface Service {
  id: string;
  name: string;
  description?: string | null;
  productCount: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Product {
  id: string;
  serviceId: string;
  serviceName: string;
  name: string;
  description?: string | null;
  printType: ProductPrintType;
  /** Computed, not stored — the lowest active document-pricing rate among
   *  the product's assigned paper materials for its own print type. */
  pricePerPage: number;
  variants: ProductVariant[];
  materialAssignments: ProductMaterialAssignment[];
  documentRates: ProductDocumentRate[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface InventoryItem {
  id: string;
  name: string;
  category: string;
  unit: string;
  quantityOnHand: number;
  reorderLevel: number;
  notes?: string | null;
  paperSize?: InventoryPaperSize | null;
  linkedProductCount: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export type InventoryMovementKind = "opening_balance" | "stock_in" | "stock_out" | "adjustment" | "job_usage";

export interface InventoryMovement {
  id: string;
  inventoryItemId: string;
  inventoryItemName: string;
  inventoryItemUnit: string;
  kind: InventoryMovementKind;
  quantityDelta: number;
  balanceAfter: number;
  jobOrderId?: string | null;
  productId?: string | null;
  note?: string | null;
  occurredAt: string;
}

export interface QuotationItem {
  id: string;
  productId: string;
  productName: string;
  variantLabel?: string | null;
  quantity: number;
  unitPrice: number;
  aiSuggested: boolean;
}

export interface Quotation {
  id: string;
  number: string;
  customerId: string;
  customerName: string;
  status: QuotationStatus;
  items: QuotationItem[];
  total: number;
  sourceChannel: SourceChannel;
  createdAt: string;
  updatedAt: string;
}

export interface Payment {
  id: string;
  jobOrderId: string;
  amount: number;
  method: "cash" | "online" | "bank_transfer" | "other";
  verified: boolean;
  recordedAt: string;
}

export interface JobOrder {
  id: string;
  number: string;
  customerId?: string | null;
  customerName?: string | null;
  quotationId?: string | null;
  status: JobOrderStatus;
  total: number;
  amountPaid: number;
  dueDate?: string | null;
  notes?: string | null;
  assignedPrinterId?: string | null;
  items: JobOrderItem[];
  createdAt: string;
  updatedAt: string;
}

export type PrintSides = "single_sided" | "double_sided";

export interface JobOrderMaterialPlan {
  id: string;
  inventoryItemId: string;
  inventoryItemName: string;
  inventoryItemUnit: string;
  quantityOnHand: number;
  plannedQuantity: number;
  consumedQuantity: number;
}

export interface JobOrderItem {
  id: string;
  productId: string;
  productName: string;
  serviceName: string;
  variantLabel?: string | null;
  pagesPerCopy: number;
  copies: number;
  unitPrice: number;
  lineTotal: number;
  printSides: PrintSides;
  materials: JobOrderMaterialPlan[];
}

export interface Printer {
  id: string;
  systemName: string;
  displayName: string;
  isDefault: boolean;
  lastSeenState: PrinterState;
  lastSeenAt: string;
}

export interface PrintJob {
  id: string;
  jobOrderId: string;
  printerId: string;
  copies: number;
  colorMode: "color" | "grayscale";
  mediaSize: string;
  submittedAt: string;
  result: "pending" | "succeeded" | "failed" | "cancelled";
}

export interface BusinessProfile {
  businessName: string;
  tagline?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  quotationPrefix: string;
  jobOrderPrefix: string;
}

export interface HealthStatus {
  status: "ok";
  version: string;
  uptimeSeconds: number;
  dbOk: boolean;
  dataDir: string;
}

export type DocumentFileType = "pdf" | "image" | "docx" | "xlsx" | "pptx";
export type DocumentPaperSize = "A3" | "A4" | "Letter" | "Legal" | "Custom" | "Unknown";
export type DocumentOrientation = "portrait" | "landscape" | "square" | "mixed" | "unknown";

export interface DocumentPageMargins {
  topMm: number;
  rightMm: number;
  bottomMm: number;
  leftMm: number;
}

export interface DocumentAnalysis {
  filename: string;
  fileType: DocumentFileType;
  mimeType: string;
  fileSizeBytes: number;
  pageCount: number;
  paperSize: DocumentPaperSize;
  orientation: DocumentOrientation;
  widthMm?: number | null;
  heightMm?: number | null;
  dpi?: number | null;
  characterCount: number;
  wordCount: number;
  ocrRequired: boolean;
  imageCount: number;
  containsImages: boolean;
  imageCoveragePercent: number;
  estimatedInkCoveragePercent: number;
  tableCount: number;
  graphicCount: number;
  margins?: DocumentPageMargins | null;
  colorPages: number;
  bwPages: number;
  duplexCompatible: boolean;
  estimatedPrintTimeSeconds: number;
  confidence: number;
  warnings: string[];
}

export type DocumentRateSource = "product" | "paperSize";

export interface DocumentPricingBreakdown {
  paperSize: DocumentPaperSize;
  printType: ProductPrintType;
  pages: number;
  ratePerPage: number;
  subtotal: number;
  rateSource: DocumentRateSource;
}

export interface DocumentPricingResult {
  suggestedPrice: number;
  currency: "PHP";
  breakdown: DocumentPricingBreakdown[];
  warnings: string[];
}

export interface DocumentPricingContext {
  productId: string;
  productName: string;
}

export interface DocumentAnalysisResponse {
  analysis: DocumentAnalysis;
  pricing: DocumentPricingResult;
  pricingContext?: DocumentPricingContext | null;
}

export interface DocumentPricingRule {
  id: string;
  inventoryItemId: string;
  inventoryItemName: string;
  paperSize: InventoryPaperSize;
  printType: ProductPrintType;
  pricePerPage: number;
  isActive: boolean;
}

export interface OverviewSnapshot {
  jobOrdersByStatus: Record<JobOrderStatus, number>;
  quotationsAwaitingApproval: number;
  paymentsAwaitingVerification: number;
  upcomingDeadlines: number;
  printQueueDepth: number;
}
