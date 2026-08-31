import type { InventoryPaperSize } from "../types/domain";

export type PaperSizeGroup = "document" | "photo" | "envelope" | "card" | "custom";

export interface PaperSizeDefinition {
  key: InventoryPaperSize;
  label: string;
  widthMm: number | null;
  heightMm: number | null;
  group: PaperSizeGroup;
}

export const PAPER_SIZE_DEFINITIONS: readonly PaperSizeDefinition[] = [
  { key: "Letter", label: "Letter", widthMm: 215.9, heightMm: 279.4, group: "document" },
  { key: "Legal", label: "Legal", widthMm: 215.9, heightMm: 355.6, group: "document" },
  { key: "Executive", label: "Executive", widthMm: 184.2, heightMm: 266.7, group: "document" },
  { key: "A6", label: "A6", widthMm: 105, heightMm: 148, group: "document" },
  { key: "A5", label: "A5", widthMm: 148, heightMm: 210, group: "document" },
  { key: "A4", label: "A4", widthMm: 210, heightMm: 297, group: "document" },
  { key: "B5", label: "B5", widthMm: 182, heightMm: 257, group: "document" },
  { key: "B-Oficio", label: "B-Oficio", widthMm: 216, heightMm: 355, group: "document" },
  { key: "M-Oficio", label: "M-Oficio", widthMm: 216, heightMm: 341, group: "document" },
  { key: "Foolscap/F4/Oficio2", label: "Foolscap/F4/Oficio2", widthMm: 215.9, heightMm: 330.2, group: "document" },
  { key: "Legal (India)", label: "Legal (India)", widthMm: 215, heightMm: 345, group: "document" },
  { key: '4"x6"', label: '4" × 6"', widthMm: 101.6, heightMm: 152.4, group: "photo" },
  { key: '5"x7"', label: '5" × 7"', widthMm: 127, heightMm: 177.8, group: "photo" },
  { key: '7"x10"', label: '7" × 10"', widthMm: 177.8, heightMm: 254, group: "photo" },
  { key: '8"x10"', label: '8" × 10"', widthMm: 203.2, heightMm: 254, group: "photo" },
  { key: "L", label: "L", widthMm: 89, heightMm: 127, group: "photo" },
  { key: "2L", label: "2L", widthMm: 127, heightMm: 178, group: "photo" },
  { key: 'Square 3.5"x3.5"', label: 'Square 3.5"', widthMm: 88.9, heightMm: 88.9, group: "photo" },
  { key: 'Square 5"x5"', label: 'Square 5"', widthMm: 127, heightMm: 127, group: "photo" },
  { key: "Hagaki", label: "Hagaki", widthMm: 100, heightMm: 148, group: "card" },
  { key: "Hagaki 2", label: "Hagaki 2", widthMm: 148, heightMm: 200, group: "card" },
  { key: "Envelope #10", label: "Envelope #10", widthMm: 104.8, heightMm: 241.3, group: "envelope" },
  { key: "Envelope DL", label: "Envelope DL", widthMm: 110, heightMm: 220, group: "envelope" },
  { key: "Nagagata 3", label: "Nagagata 3", widthMm: 120, heightMm: 235, group: "envelope" },
  { key: "Nagagata 4", label: "Nagagata 4", widthMm: 90, heightMm: 205, group: "envelope" },
  { key: "Yougata 4", label: "Yougata 4", widthMm: 105, heightMm: 235, group: "envelope" },
  { key: "Yougata 6", label: "Yougata 6", widthMm: 98, heightMm: 190, group: "envelope" },
  { key: "Envelope C5", label: "Envelope C5", widthMm: 162, heightMm: 229, group: "envelope" },
  { key: "Envelope Monarch", label: "Envelope Monarch", widthMm: 98.4, heightMm: 190.5, group: "envelope" },
  { key: "Card 55x91mm", label: "Card", widthMm: 55, heightMm: 91, group: "card" },
  { key: "Custom", label: "Custom size", widthMm: null, heightMm: null, group: "custom" },
] as const;

export const PAPER_SIZE_GROUPS: ReadonlyArray<{ key: PaperSizeGroup; label: string }> = [
  { key: "document", label: "Documents" },
  { key: "photo", label: "Photo & square" },
  { key: "envelope", label: "Envelopes" },
  { key: "card", label: "Cards & Hagaki" },
  { key: "custom", label: "Custom" },
];

export function paperSizeDefinition(key?: string | null): PaperSizeDefinition | undefined {
  return PAPER_SIZE_DEFINITIONS.find((definition) => definition.key === key);
}

export function paperSizeDimensions(
  key?: string | null,
  widthMm?: number | null,
  heightMm?: number | null,
): string {
  const definition = paperSizeDefinition(key);
  const width = definition?.widthMm ?? widthMm;
  const height = definition?.heightMm ?? heightMm;
  if (width == null || height == null) return "Dimensions required";
  return `${width.toLocaleString(undefined, { maximumFractionDigits: 1 })} × ${height.toLocaleString(undefined, { maximumFractionDigits: 1 })} mm`;
}

export function paperSizeDisplay(
  key?: string | null,
  widthMm?: number | null,
  heightMm?: number | null,
): string {
  const label = paperSizeDefinition(key)?.label ?? key ?? "Not a paper stock";
  return key ? `${label} · ${paperSizeDimensions(key, widthMm, heightMm)}` : label;
}

export function comparePaperSizes(left: string, right: string): number {
  const leftIndex = PAPER_SIZE_DEFINITIONS.findIndex((definition) => definition.key === left);
  const rightIndex = PAPER_SIZE_DEFINITIONS.findIndex((definition) => definition.key === right);
  return (leftIndex < 0 ? Number.MAX_SAFE_INTEGER : leftIndex)
    - (rightIndex < 0 ? Number.MAX_SAFE_INTEGER : rightIndex);
}
