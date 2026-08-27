import { NavLink } from "react-router-dom";
import { navGroups } from "./navItems";
import { navIcons } from "./NavIcons";
import { useHealth } from "../../hooks/useHealth";
import brandMark from "../../assets/brand/the-paper-club-mark.png";
import "./Sidebar.css";

export function Sidebar() {
  const { state } = useHealth();

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
          O
          <span className={`sidebar__avatar-dot sidebar__avatar-dot--${state}`} />
        </span>
        <span className="sidebar__footer-text">
          <span className="sidebar__footer-role">Owner</span>
          <span className="sidebar__footer-status">
            {state === "checking" && "Connecting…"}
            {state === "online" && "Backend connected"}
            {state === "offline" && "Backend offline"}
          </span>
        </span>
      </div>
    </aside>
  );
}
