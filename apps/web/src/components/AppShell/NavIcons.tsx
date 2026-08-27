/**
 * A small, hand-drawn icon set for the primary navigation, one stroke
 * weight, one viewBox, built for this app's actual sections rather than
 * dropped in from a generic icon library. Each icon means something
 * specific: the printer is a printer, the ticket is a job ticket, the
 * cycle arrow is work-in-progress.
 */
import type { SVGProps } from "react";

const base: SVGProps<SVGSVGElement> = {
  viewBox: "0 0 20 20",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
};

export function OverviewIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <rect x="2.6" y="2.6" width="6" height="6" rx="1.3" />
      <rect x="11.4" y="2.6" width="6" height="6" rx="1.3" />
      <rect x="2.6" y="11.4" width="6" height="6" rx="1.3" />
      <rect x="11.4" y="11.4" width="6" height="6" rx="1.3" />
    </svg>
  );
}

export function JobOrdersIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <rect x="4" y="3.6" width="12" height="14" rx="1.5" />
      <rect x="7.5" y="2.2" width="5" height="2.8" rx="0.9" />
      <path d="M7 9.2h6M7 12.6h6" />
    </svg>
  );
}

export function QuotationsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M5 2.6h6.5l3.5 3.5v11.3a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V3.6a1 1 0 0 1 1-1z" />
      <path d="M11.5 2.6v3.5H15" />
      <path d="M6.6 11h6.8M6.6 14h5" />
    </svg>
  );
}

export function ProductionIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M16.2 10.2a6.2 6.2 0 1 1-2.1-4.6" />
      <path d="M16.2 3v4.2h-4.2" />
    </svg>
  );
}

export function PrintCenterIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M5.6 8V3.6h8.8V8" />
      <rect x="2.6" y="8" width="14.8" height="7" rx="1.4" />
      <rect x="6.2" y="12.2" width="7.6" height="5.2" rx="0.8" />
      <circle cx="14.2" cy="10.6" r="0.15" fill="currentColor" />
    </svg>
  );
}

export function InventoryIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M3 5.2h14v11.4H3zM3 8.4h14" />
      <path d="M7 2.8h6l1 2.4H6zM7.4 12.3h5.2" />
    </svg>
  );
}

export function DocumentAnalyzerIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M5 2.8h6.2l3.8 3.8v10.6H5z" />
      <path d="M11.2 2.8v3.8H15M7.3 10h3.2M7.3 12.8h2" />
      <circle cx="13.2" cy="13.4" r="2.3" />
      <path d="m14.9 15.1 2 2" />
    </svg>
  );
}

export function CatalogIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M10 2.4 17 6.2v7.6L10 17.6 3 13.8V6.2L10 2.4Z" />
      <path d="M3 6.2 10 10l7-3.8M10 10v7.6" />
    </svg>
  );
}

export function CustomersIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <circle cx="10" cy="6.4" r="3" />
      <path d="M4 17c0-3.6 3-6.2 6-6.2s6 2.6 6 6.2" />
    </svg>
  );
}

export function ReportsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M3.6 17V11M8.2 17V6.6M12.8 17V13M17 17V3.6" />
    </svg>
  );
}

export function SettingsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <line x1="3" y1="5.2" x2="17" y2="5.2" />
      <circle cx="11.5" cy="5.2" r="1.7" fill="currentColor" stroke="none" />
      <line x1="3" y1="10" x2="17" y2="10" />
      <circle cx="7" cy="10" r="1.7" fill="currentColor" stroke="none" />
      <line x1="3" y1="14.8" x2="17" y2="14.8" />
      <circle cx="13.5" cy="14.8" r="1.7" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function ConfigurationIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <rect x="3" y="3" width="14" height="14" rx="1.4" />
      <path d="M3 8.6h14M8.4 3v14" />
    </svg>
  );
}

export const navIcons = {
  overview: OverviewIcon,
  jobOrders: JobOrdersIcon,
  quotations: QuotationsIcon,
  production: ProductionIcon,
  printCenter: PrintCenterIcon,
  documentAnalyzer: DocumentAnalyzerIcon,
  inventory: InventoryIcon,
  catalog: CatalogIcon,
  customers: CustomersIcon,
  reports: ReportsIcon,
  configuration: ConfigurationIcon,
  settings: SettingsIcon,
} as const;

export type NavIconKey = keyof typeof navIcons;
