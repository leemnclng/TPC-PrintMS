import "./PlannedNotice.css";

/** Explicit, honest marker for controls that are visible but not yet wired
 *  to real behavior — per docs/context/initial-pages.md, the scaffold must
 *  make deferred work visible rather than fake it as functional. */
export function PlannedNotice({ phase }: { phase: string }) {
  return <span className="planned-notice">Planned · {phase}</span>;
}
