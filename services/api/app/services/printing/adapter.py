"""Vendor-neutral printer adapter.

Per docs/context/decisions.md, Printing-MS must not couple to the Canon
PIXMA G4770 (the first validation target) or any Canon-specific API. This
module reads whatever printers the operating system already has installed
and queued — CUPS on macOS/Linux, the Windows print spooler on Windows — and
never talks to a printer driver directly. That is Phase 1 in
docs/context/build-plan.md ("Printing Feasibility Spike"); this is a first,
read-only implementation of the detection half of that phase.
"""

from __future__ import annotations

import re
import subprocess
import sys
from dataclasses import dataclass


@dataclass
class DetectedPrinter:
    system_name: str
    display_name: str
    is_default: bool
    state: str  # idle | printing | offline | error | unknown


class PrinterAdapter:
    def list_printers(self) -> list[DetectedPrinter]:
        raise NotImplementedError


class CupsPrinterAdapter(PrinterAdapter):
    """macOS and Linux both use CUPS; `lpstat` is the standard, driver-agnostic
    way to enumerate installed queues without shelling out to any vendor SDK."""

    def list_printers(self) -> list[DetectedPrinter]:
        try:
            default_out = subprocess.run(
                ["lpstat", "-d"], capture_output=True, text=True, timeout=3
            ).stdout
        except (FileNotFoundError, subprocess.TimeoutExpired):
            return []

        default_match = re.search(r"system default destination:\s*(\S+)", default_out)
        default_name = default_match.group(1) if default_match else None

        try:
            status_out = subprocess.run(
                ["lpstat", "-p"], capture_output=True, text=True, timeout=3
            ).stdout
        except (FileNotFoundError, subprocess.TimeoutExpired):
            return []

        printers: list[DetectedPrinter] = []
        # Typical line: "printer Canon_G4700_series is idle.  enabled since ..."
        for line in status_out.splitlines():
            match = re.match(r"printer (\S+) is ([a-zA-Z ]+)[.,]", line)
            if not match:
                continue
            name, raw_state = match.group(1), match.group(2).strip().lower()
            if "idle" in raw_state:
                state = "idle"
            elif "printing" in raw_state:
                state = "printing"
            elif "disabled" in raw_state or "off" in raw_state:
                state = "offline"
            else:
                state = "unknown"

            printers.append(
                DetectedPrinter(
                    system_name=name,
                    display_name=name.replace("_", " "),
                    is_default=(name == default_name),
                    state=state,
                )
            )
        return printers


class WindowsPrinterAdapter(PrinterAdapter):
    """Placeholder for the Windows print-spooler adapter (via `win32print`).
    Not implemented in this scaffold — Phase 1 validation on Windows is
    still open per docs/context/issues-log.md — but kept as an explicit,
    honest stub rather than silently falling back to the CUPS adapter."""

    def list_printers(self) -> list[DetectedPrinter]:
        raise NotImplementedError(
            "Windows printer detection (win32print) is not yet implemented — "
            "see docs/context/issues-log.md."
        )


def get_printer_adapter() -> PrinterAdapter:
    if sys.platform == "win32":
        return WindowsPrinterAdapter()
    return CupsPrinterAdapter()
