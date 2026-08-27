import { useLocation } from "react-router-dom";
import { navItems } from "./navItems";
import { useClock } from "../../hooks/useClock";
import type { HealthStatus } from "../../types/domain";
import "./Topbar.css";

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
});
const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
});

export function Topbar({ stage }: { stage?: HealthStatus["stage"] }) {
  const location = useLocation();
  const now = useClock();

  const current =
    [...navItems].reverse().find((item) => location.pathname.startsWith(item.matchPrefix) && item.path !== "/") ??
    navItems[0];

  return (
    <header className="topbar">
      <span className="topbar__crumb">{current.label}</span>
      <div className="topbar__spacer" />
      {stage && stage !== "production" && (
        <span className="topbar__badge">{stage === "development" ? "DEV" : stage.toUpperCase()}</span>
      )}
      <span className="topbar__clock numeric">
        {dateFormatter.format(now)} · {timeFormatter.format(now)}
      </span>
    </header>
  );
}
