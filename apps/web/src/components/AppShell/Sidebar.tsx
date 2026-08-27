import { useEffect } from "react";
import { NavLink } from "react-router-dom";
import { navGroups } from "./navItems";
import { navIcons } from "./NavIcons";
import type { ConnectionState } from "../../hooks/useHealth";
import { useResource } from "../../hooks/useResource";
import { api } from "../../lib/apiClient";
import type { BusinessProfile } from "../../types/domain";
import brandMark from "../../assets/brand/the-paper-club-mark.png";
import "./Sidebar.css";

export function Sidebar({ connectionState }: { connectionState: ConnectionState }) {
  const { data: profile, reload: reloadProfile } = useResource(() =>
    api.get<BusinessProfile>("/settings/business-profile"),
  );
  const ownerName = profile?.ownerName.trim() || "Owner";
  const initials = ownerName
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  useEffect(() => {
    window.addEventListener("business-profile-updated", reloadProfile);
    return () => window.removeEventListener("business-profile-updated", reloadProfile);
  }, [reloadProfile]);

  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        <span className="sidebar__mark" aria-hidden="true">
          <img src={brandMark} alt="" />
        </span>
        <span className="sidebar__brand-text">
          <span className="sidebar__brand-name">The Paper Club</span>
          <span className="sidebar__brand-system">Printing-MS</span>
        </span>
      </div>

      <nav className="sidebar__nav" aria-label="Primary">
        {navGroups.map((group, i) => (
          <div className="sidebar__group" key={group.label ?? `pinned-${i}`}>
            {group.label && <p className="sidebar__group-label">{group.label}</p>}
            <ul>
              {group.items.map((item) => {
                const Icon = navIcons[item.icon];
                return (
                  <li key={item.path}>
                    <NavLink
                      to={item.path}
                      end={item.path === "/"}
                      className={({ isActive }) => "sidebar__link" + (isActive ? " is-active" : "")}
                    >
                      <Icon className="sidebar__link-icon" />
                      <span className="sidebar__link-label">{item.label}</span>
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="sidebar__footer">
        <span className="sidebar__avatar" aria-hidden="true">
          {initials}
          <span className={`sidebar__avatar-dot sidebar__avatar-dot--${connectionState}`} />
        </span>
        <span className="sidebar__footer-text">
          <span className="sidebar__footer-role" title={ownerName}>{ownerName}</span>
          <span className="sidebar__footer-status">
            {connectionState === "checking" && "Connecting…"}
            {connectionState === "online" && "Connected"}
            {connectionState === "offline" && "Backend offline"}
          </span>
        </span>
      </div>
    </aside>
  );
}
