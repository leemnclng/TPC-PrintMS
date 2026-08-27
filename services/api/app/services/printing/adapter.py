"""Vendor-neutral printer adapter.

Per docs/context/decisions.md, Printing-MS must not couple to the Canon
PIXMA G4770 (the first validation target) or any Canon-specific API. This
module reads whatever printers the operating system already has installed
and queued — CUPS on macOS/Linux, the Windows print spooler on Windows — and
never talks to a printer driver directly. Canon PRINT and other vendor apps
can therefore remain setup/maintenance companions without becoming required
runtime dependencies of Printing-MS.
"""

from __future__ import annotations

import json
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
    """Enumerate Windows print queues through the built-in CIM provider.

    PowerShell and Win32_Printer ship with supported Windows versions, so the
    desktop build does not need a compiled pywin32 dependency just to discover
    a queue created by Canon PRINT, a vendor driver, or Windows IPP.
    """

    def list_printers(self) -> list[DetectedPrinter]:
        command = (
            "Get-CimInstance Win32_Printer | "
            "Select-Object Name,Default,WorkOffline,PrinterStatus | "
            "ConvertTo-Json -Compress"
        )
        try:
            result = subprocess.run(
                ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", command],
                capture_output=True,
                text=True,
                timeout=5,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
        except (FileNotFoundError, subprocess.TimeoutExpired):
            return []

        if result.returncode != 0 or not result.stdout.strip():
            return []

        try:
            payload = json.loads(result.stdout)
        except json.JSONDecodeError:
            return []

        rows = payload if isinstance(payload, list) else [payload]
        printers: list[DetectedPrinter] = []
        for row in rows:
            if not isinstance(row, dict) or not row.get("Name"):
                continue
            raw_status = row.get("PrinterStatus")
            if row.get("WorkOffline") is True or raw_status == 7:
                state = "offline"
            elif raw_status == 4:
                state = "printing"
            elif raw_status == 3:
                state = "idle"
            elif raw_status == 6:
                state = "error"
            else:
                state = "unknown"

            name = str(row["Name"])
            printers.append(
                DetectedPrinter(
                    system_name=name,
                    display_name=name,
                    is_default=row.get("Default") is True,
                    state=state,
                )
            )
        return printers


def get_printer_adapter(platform_name: str | None = None) -> PrinterAdapter:
    resolved_platform = platform_name
    if resolved_platform is None:
        resolved_platform = "windows" if sys.platform == "win32" else "macos" if sys.platform == "darwin" else "linux"
    if resolved_platform == "windows":
        return WindowsPrinterAdapter()
    return CupsPrinterAdapter()
