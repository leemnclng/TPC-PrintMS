/** A print registration mark, hand-drawn in SVG — used in place of a stock
 *  icon-library glyph for empty states. It's the one recurring illustrative
 *  motif in the app, and it means something here: it's the mark a print shop
 *  actually uses to align plates, not decoration borrowed from a generic
 *  icon set. */
export function RegistrationMark({ size = 40 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      aria-hidden="true"
      className="registration-mark"
    >
      <circle cx="20" cy="20" r="13" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="20" cy="20" r="4" stroke="currentColor" strokeWidth="1.4" />
      <path d="M20 1V13M20 27V39M1 20H13M27 20H39" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}
