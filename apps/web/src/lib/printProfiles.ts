export type PrintMediaType =
  | "auto"
  | "plain"
  | "photo_plus_glossy_ii"
  | "photo_pro_luster"
  | "photo_plus_semi_gloss"
  | "glossy_photo"
  | "matte_photo"
  | "envelope"
  | "ink_jet_hagaki_a"
  | "ink_jet_hagaki"
  | "hagaki_k_a"
  | "hagaki_k"
  | "hagaki_a"
  | "hagaki"
  | "inkjet_greeting_card"
  | "card_stock";

export const PRINT_MEDIA_OPTIONS: ReadonlyArray<{ value: PrintMediaType; label: string }> = [
  { value: "auto", label: "Automatic · driver default" },
  { value: "plain", label: "Plain Paper" },
  { value: "photo_plus_glossy_ii", label: "Photo Paper Plus Glossy II" },
  { value: "photo_pro_luster", label: "Photo Paper Pro Luster" },
  { value: "photo_plus_semi_gloss", label: "Photo Paper Plus Semi-gloss" },
  { value: "glossy_photo", label: "Glossy Photo Paper" },
  { value: "matte_photo", label: "Matte Photo Paper" },
  { value: "envelope", label: "Envelope" },
  { value: "ink_jet_hagaki_a", label: "Ink Jet Hagaki (A)" },
  { value: "ink_jet_hagaki", label: "Ink Jet Hagaki" },
  { value: "hagaki_k_a", label: "Hagaki K (A)" },
  { value: "hagaki_k", label: "Hagaki K" },
  { value: "hagaki_a", label: "Hagaki (A)" },
  { value: "hagaki", label: "Hagaki" },
  { value: "inkjet_greeting_card", label: "Inkjet Greeting Card" },
  { value: "card_stock", label: "Card Stock" },
];

export function printMediaLabel(value: string): string {
  return PRINT_MEDIA_OPTIONS.find((option) => option.value === value)?.label ?? value;
}
