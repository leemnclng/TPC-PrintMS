import type { JobOrderStatus, PrinterState } from "./domain";

export type StatusTone = "neutral" | "warning" | "info" | "success" | "danger";

export const jobOrderStatusMeta: Record<JobOrderStatus, { label: string; tone: StatusTone }> = {
  pending_payment: { label: "Pending payment", tone: "warning" },
  paid: { label: "Paid", tone: "info" },
  queued: { label: "Queued", tone: "info" },
  printing: { label: "Printing", tone: "info" },
  quality_check: { label: "Quality check", tone: "warning" },
  ready: { label: "Ready", tone: "success" },
  released: { label: "Released", tone: "success" },
  delivered: { label: "Delivered", tone: "success" },
  completed: { label: "Completed", tone: "success" },
  on_hold: { label: "On hold", tone: "warning" },
  cancelled: { label: "Cancelled", tone: "danger" },
};

export const printerStateMeta: Record<PrinterState, { label: string; tone: StatusTone }> = {
  idle: { label: "Idle", tone: "success" },
  printing: { label: "Printing", tone: "info" },
  offline: { label: "Offline", tone: "neutral" },
  error: { label: "Error", tone: "danger" },
  unknown: { label: "Unknown", tone: "neutral" },
};
