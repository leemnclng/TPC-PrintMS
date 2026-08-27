import { useState } from "react";
import { Button } from "../Button/Button";
import { Modal, ModalStatus } from "./Modal";

const previewStates: Array<{ label: string; status: ModalStatus; disabled?: boolean }> = [
  { label: "Default", status: "idle" },
  { label: "Hover", status: "idle" },
  { label: "Focus", status: "idle" },
  { label: "Active", status: "idle" },
  { label: "Disabled", status: "idle", disabled: true },
  { label: "Loading", status: "loading" },
  { label: "Error", status: "error" },
  { label: "Success", status: "success" },
];

export function ModalPreview() {
  const [activeState, setActiveState] = useState<(typeof previewStates)[number] | null>(null);

  return (
    <div>
      {previewStates.map((state) => (
        <Button key={state.label} type="button" disabled={state.disabled} onClick={() => setActiveState(state)}>
          {state.label}
        </Button>
      ))}
      <Modal
        open={activeState !== null}
        title={`${activeState?.label ?? "Default"} modal state`}
        description="Development-only preview for the shared modal component."
        status={activeState?.status}
        busy={activeState?.status === "loading"}
        onClose={() => setActiveState(null)}
      >
        <div style={{ padding: "var(--space-6)" }}>Modal content</div>
      </Modal>
    </div>
  );
}
