import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { useHealth } from "../../hooks/useHealth";
import "./AppShell.css";

export function AppShell() {
  const { state, health } = useHealth();

  return (
    <div className="app-shell">
      <Sidebar connectionState={state} />
      <div className="app-shell__main">
        <Topbar stage={health?.stage} />
        <main className="app-shell__content">
          <div className="app-shell__content-inner">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
