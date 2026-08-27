import type { NavIconKey } from "./NavIcons";

export interface NavItem {
  label: string;
  path: string;
  /** Matches this path and any of its nested workspace routes. */
  matchPrefix: string;
  icon: NavIconKey;
}

export interface NavGroup {
  /** Omitted for the pinned, ungrouped items (Overview, Settings). */
  label?: string;
  items: NavItem[];
}

// Task-oriented destinations grouped for scanability, the way an
// operations/admin console reads, rather than as one flat numbered list.
export const navGroups: NavGroup[] = [
  {
    items: [{ label: "Overview", path: "/", matchPrefix: "/", icon: "overview" }],
  },
  {
    label: "Sales",
    items: [
      { label: "Job Orders", path: "/job-orders", matchPrefix: "/job-orders", icon: "jobOrders" },
    ],
  },
  {
    label: "Operations",
    items: [
      { label: "Print Center", path: "/print-center", matchPrefix: "/print-center", icon: "printCenter" },
      { label: "Document Analyzer", path: "/document-analyzer", matchPrefix: "/document-analyzer", icon: "documentAnalyzer" },
      { label: "Inventory", path: "/inventory", matchPrefix: "/inventory", icon: "inventory" },
    ],
  },
  {
    label: "Directory",
    items: [
      { label: "Services", path: "/product-catalog", matchPrefix: "/product-catalog", icon: "catalog" },
      { label: "Customers", path: "/customers", matchPrefix: "/customers", icon: "customers" },
    ],
  },
  {
    label: "Insights",
    items: [{ label: "Reports", path: "/reports", matchPrefix: "/reports", icon: "reports" }],
  },
  {
    items: [
      { label: "Configuration", path: "/configuration", matchPrefix: "/configuration", icon: "configuration" },
      { label: "Settings", path: "/settings", matchPrefix: "/settings", icon: "settings" },
    ],
  },
];

/** Flat view, kept for code that just needs to look up the current page
 *  (e.g. the top bar's breadcrumb) without caring about grouping. */
export const navItems: NavItem[] = navGroups.flatMap((group) => group.items);
