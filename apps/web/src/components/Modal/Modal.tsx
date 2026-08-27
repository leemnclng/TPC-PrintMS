import { ReactNode, useEffect, useId, useRef } from "react";
import { Button } from "../Button/Button";
import "./Modal.css";

export type ModalStatus = "idle" | "loading" | "error" | "success";

interface ModalProps {
  open: boolean;
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  busy?: boolean;
  status?: ModalStatus;
  className?: string;
}

const CLOSE_DURATION_MS = 180;

export function Modal({
  open,
  title,
  description,
  children,
  onClose,
  busy = false,
  status = "idle",
  className,
}: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    let closeTimer: number | undefined;

    if (open) {
      returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.dataset.phase = "open";
      if (!dialog.open) dialog.showModal();

      window.requestAnimationFrame(() => {
        const firstControl = dialog.querySelector<HTMLElement>(
          "[autofocus], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled])",
        );
        firstControl?.focus();
      });
    } else if (dialog.open) {
      dialog.dataset.phase = "closing";
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      closeTimer = window.setTimeout(
        () => {
          dialog.close();
          dialog.dataset.phase = "closed";
          returnFocusRef.current?.focus();
        },
        reducedMotion ? 0 : CLOSE_DURATION_MS,
      );
    }

    return () => {
      if (closeTimer !== undefined) window.clearTimeout(closeTimer);
    };
  }, [open]);

  useEffect(
    () => () => {
      if (dialogRef.current?.open) dialogRef.current.close();
    },
    [],
  );

  return (
    <dialog
      ref={dialogRef}
      className={["modal", className].filter(Boolean).join(" ")}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      aria-busy={busy || undefined}
      data-status={status}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div className="modal__surface">
        <header className="modal__header">
          <div className="modal__heading">
            <h2 id={titleId}>{title}</h2>
            {description ? <p id={descriptionId}>{description}</p> : null}
          </div>
          <Button className="modal__close" type="button" variant="ghost" size="sm" disabled={busy} onClick={onClose}>
            Close
          </Button>
        </header>
        <div className="modal__body">{children}</div>
      </div>
    </dialog>
  );
}
