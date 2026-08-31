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
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

import pymupdf
from PIL import Image, ImageOps, UnidentifiedImageError

from ..paper_sizes import cups_media_size, paper_size_definition


@dataclass
class DetectedPrinter:
    system_name: str
    display_name: str
    is_default: bool
    state: str  # idle | printing | offline | error | unknown


@dataclass
class PrintSubmission:
    external_job_id: str | None = None


class PrintSubmissionError(RuntimeError):
    pass


IPP_MEDIA_TYPES = {
    "plain": "stationery",
    "photo_plus_glossy_ii": "photographic-high-gloss",
    "photo_pro_luster": "photographic-satin",
    "photo_plus_semi_gloss": "photographic-semi-gloss",
    "glossy_photo": "photographic-glossy",
    "matte_photo": "photographic-matte",
    "envelope": "envelope",
    "ink_jet_hagaki_a": "stationery-coated",
    "ink_jet_hagaki": "stationery-coated",
    "hagaki_k_a": "stationery-coated",
    "hagaki_k": "stationery-coated",
    "hagaki_a": "stationery-coated",
    "hagaki": "stationery-coated",
    "inkjet_greeting_card": "stationery-coated",
    "card_stock": "cardstock",
}


class PrinterAdapter:
    def list_printers(self) -> list[DetectedPrinter]:
        raise NotImplementedError

    def submit_file(
        self,
        printer_name: str,
        file_path: Path,
        copies: int,
        color_mode: str,
        media_size: str,
        media_type: str = "auto",
        media_width_mm: float | None = None,
        media_height_mm: float | None = None,
        orientation: str = "auto",
        scaling: str = "auto",
        quality: str = "auto",
        borderless: bool = False,
        collate: bool = True,
        tracking_id: str | None = None,
        duplex_pass: str = "simplex",
    ) -> PrintSubmission:
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

    def submit_file(
        self,
        printer_name: str,
        file_path: Path,
        copies: int,
        color_mode: str,
        media_size: str,
        media_type: str = "auto",
        media_width_mm: float | None = None,
        media_height_mm: float | None = None,
        orientation: str = "auto",
        scaling: str = "auto",
        quality: str = "auto",
        borderless: bool = False,
        collate: bool = True,
        tracking_id: str | None = None,
        duplex_pass: str = "simplex",
    ) -> PrintSubmission:
        definition = paper_size_definition(media_size)
        width_mm = media_width_mm or definition.width_mm
        height_mm = media_height_mm or definition.height_mm
        if width_mm is None or height_mm is None:
            raise PrintSubmissionError("The selected paper size has no usable dimensions.")
        cups_size = cups_media_size(media_size, width_mm, height_mm)
        media_option = f"{cups_size}.Borderless" if borderless else cups_size
        command = [
            "lp",
            "-d",
            printer_name,
            "-n",
            str(copies),
            "-o",
            f"media={media_option}",
            "-o",
            f"ColorModel={'Gray' if color_mode == 'grayscale' else 'RGB'}",
            "-o",
            f"print-scaling={'none' if scaling == 'actual_size' else scaling}",
            "-o",
            f"multiple-document-handling={'separate-documents-collated-copies' if collate else 'separate-documents-uncollated-copies'}",
        ]
        if quality != "auto":
            command.extend(["-o", f"print-quality={3 if quality == 'draft' else 5 if quality == 'high' else 4}"])
        if media_type in IPP_MEDIA_TYPES:
            command.extend(["-o", f"media-type={IPP_MEDIA_TYPES[media_type]}"])
        if duplex_pass == "front":
            command.extend(["-o", "page-set=odd"])
        elif duplex_pass == "back":
            command.extend(["-o", "page-set=even", "-o", "outputorder=reverse"])
        command.append(str(file_path))
        if orientation != "auto":
            command[1:1] = ["-o", f"orientation-requested={3 if orientation == 'portrait' else 4}"]
        try:
            result = subprocess.run(command, capture_output=True, text=True, timeout=30)
        except FileNotFoundError as error:
            raise PrintSubmissionError("The operating-system print command is unavailable.") from error
        except subprocess.TimeoutExpired as error:
            raise PrintSubmissionError("The operating-system print queue did not respond in time.") from error
        if result.returncode != 0:
            detail = result.stderr.strip() or result.stdout.strip() or "The print queue rejected the file."
            raise PrintSubmissionError(detail)
        match = re.search(r"request id is (\S+)", result.stdout)
        return PrintSubmission(external_job_id=match.group(1) if match else None)


class WindowsPrinterAdapter(PrinterAdapter):
    """Enumerate Windows print queues through the built-in CIM provider.

    PowerShell and Win32_Printer ship with supported Windows versions, so the
    desktop build does not need a compiled pywin32 dependency. PDF and image
    pages are rasterized locally and drawn through Windows PrintDocument; this
    avoids the fragile shell ``PrintTo`` verb while still using the installed
    Canon, IPP, or other vendor printer driver.
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

    def submit_file(
        self,
        printer_name: str,
        file_path: Path,
        copies: int,
        color_mode: str,
        media_size: str,
        media_type: str = "auto",
        media_width_mm: float | None = None,
        media_height_mm: float | None = None,
        orientation: str = "auto",
        scaling: str = "auto",
        quality: str = "auto",
        borderless: bool = False,
        collate: bool = True,
        tracking_id: str | None = None,
        duplex_pass: str = "simplex",
    ) -> PrintSubmission:
        definition = paper_size_definition(media_size)
        width_mm = media_width_mm or definition.width_mm
        height_mm = media_height_mm or definition.height_mm
        if width_mm is None or height_mm is None:
            raise PrintSubmissionError("The selected paper size has no usable dimensions.")
        script_path = Path(__file__).with_name("windows_print.ps1")
        with tempfile.TemporaryDirectory(prefix="printing-ms-pages-") as temporary_directory:
            page_count = _render_windows_print_pages(
                file_path,
                Path(temporary_directory),
                grayscale=color_mode == "grayscale",
            )
            print_directory, selected_page_count = _prepare_windows_print_pass(
                Path(temporary_directory), page_count, duplex_pass
            )
            command = [
                "powershell.exe",
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                str(script_path),
                "-ImageDirectory",
                str(print_directory),
                "-DocumentName",
                file_path.name,
                "-TrackingId",
                tracking_id or "",
                "-PrinterName",
                printer_name,
                "-Copies",
                str(copies),
                "-ColorMode",
                color_mode,
                "-MediaSize",
                media_size,
                "-MediaWidthMm",
                str(width_mm),
                "-MediaHeightMm",
                str(height_mm),
                "-MediaType",
                media_type,
                "-Orientation",
                orientation,
                "-Scaling",
                scaling,
                "-Quality",
                quality,
                "-Borderless",
                str(borderless).lower(),
                "-Collate",
                str(collate).lower(),
            ]
            try:
                result = subprocess.run(
                    command,
                    capture_output=True,
                    text=True,
                    timeout=max(60, selected_page_count * copies * 15),
                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                )
            except FileNotFoundError as error:
                raise PrintSubmissionError("Windows PowerShell is unavailable.") from error
            except subprocess.TimeoutExpired as error:
                raise PrintSubmissionError("Windows did not accept the print request in time.") from error
            if result.returncode != 0:
                detail = _windows_print_error(result.stderr, result.stdout)
                raise PrintSubmissionError(detail)
        return PrintSubmission()


def _prepare_windows_print_pass(
    rendered_directory: Path,
    page_count: int,
    duplex_pass: str,
) -> tuple[Path, int]:
    """Build the exact physical feed order for a supervised duplex pass.

    Fronts print odd pages in document order. After the Canon-style
    printed-side-down, 180-degree stack rotation, backs print even pages in
    reverse order. An odd final page needs a blank feed before the remaining
    backs so sheet alignment is preserved.
    """

    if duplex_pass == "simplex":
        return rendered_directory, page_count
    if duplex_pass not in {"front", "back"}:
        raise PrintSubmissionError("The requested manual-duplex pass is invalid.")

    pages = sorted(rendered_directory.glob("page-*.png"))
    selected = pages[::2] if duplex_pass == "front" else list(reversed(pages[1::2]))
    pass_directory = rendered_directory / f"{duplex_pass}-pass"
    pass_directory.mkdir()
    sequence = 1

    if duplex_pass == "back" and page_count % 2 == 1:
        with Image.open(pages[-1]) as source:
            blank = Image.new("RGB", source.size, "white")
            try:
                blank.save(pass_directory / f"page-{sequence:05d}.png", dpi=(300, 300))
            finally:
                blank.close()
        sequence += 1

    for source_path in selected:
        shutil.copy2(source_path, pass_directory / f"page-{sequence:05d}.png")
        sequence += 1
    return pass_directory, sequence - 1


_WINDOWS_IMAGE_SUFFIXES = {".bmp", ".gif", ".jpeg", ".jpg", ".png", ".tif", ".tiff", ".webp"}


def _windows_print_error(stderr: str, stdout: str) -> str:
    output = stderr.strip() or stdout.strip()
    if not output:
        return "Windows rejected the print request."
    first_line = next((line.strip() for line in output.splitlines() if line.strip()), output)
    first_line = re.sub(r"^.*?windows_print\.ps1\s*:\s*", "", first_line, flags=re.IGNORECASE)
    return first_line[:500]


def _render_windows_print_pages(file_path: Path, output_directory: Path, grayscale: bool) -> int:
    """Create the page images consumed by the Windows GDI print helper.

    Rendering inside Printing-MS means submission does not depend on whichever
    desktop application happens to own the PDF ``PrintTo`` file association.
    """

    suffix = file_path.suffix.lower()
    if suffix == ".pdf":
        return _render_pdf_pages(file_path, output_directory, grayscale)
    if suffix in _WINDOWS_IMAGE_SUFFIXES:
        return _render_image_pages(file_path, output_directory, grayscale)
    raise PrintSubmissionError(
        "Direct Windows printing supports PDF and image files. Export this document to PDF, attach it to the job, and try again."
    )


def _render_pdf_pages(file_path: Path, output_directory: Path, grayscale: bool) -> int:
    try:
        document = pymupdf.open(file_path)
    except Exception as error:
        raise PrintSubmissionError("The PDF could not be opened for printing.") from error

    try:
        if document.needs_pass:
            raise PrintSubmissionError("Password-protected PDFs cannot be printed directly.")
        if document.page_count < 1:
            raise PrintSubmissionError("The PDF has no printable pages.")
        colorspace = pymupdf.csGRAY if grayscale else pymupdf.csRGB
        for page_number, page in enumerate(document, start=1):
            pixmap = page.get_pixmap(dpi=300, colorspace=colorspace, alpha=False, annots=True)
            pixmap.save(output_directory / f"page-{page_number:05d}.png")
        return document.page_count
    except PrintSubmissionError:
        raise
    except Exception as error:
        raise PrintSubmissionError("The PDF could not be rendered for Windows printing.") from error
    finally:
        document.close()


def _render_image_pages(file_path: Path, output_directory: Path, grayscale: bool) -> int:
    try:
        source = Image.open(file_path)
        frame_count = getattr(source, "n_frames", 1)
        if frame_count < 1:
            raise PrintSubmissionError("The image has no printable pages.")
        for page_index in range(frame_count):
            source.seek(page_index)
            prepared = _prepare_print_image(source.copy(), grayscale)
            try:
                prepared.save(output_directory / f"page-{page_index + 1:05d}.png", dpi=(300, 300))
            finally:
                prepared.close()
        return frame_count
    except PrintSubmissionError:
        raise
    except (UnidentifiedImageError, OSError, ValueError) as error:
        raise PrintSubmissionError("The image could not be opened for printing.") from error
    finally:
        if "source" in locals():
            source.close()


def _prepare_print_image(image: Image.Image, grayscale: bool) -> Image.Image:
    oriented = ImageOps.exif_transpose(image)
    if oriented is not image:
        image.close()
    if grayscale:
        result = ImageOps.grayscale(oriented)
        oriented.close()
        return result
    if oriented.mode in {"RGBA", "LA"} or "transparency" in oriented.info:
        rgba = oriented.convert("RGBA")
        result = Image.new("RGB", rgba.size, "white")
        result.paste(rgba, mask=rgba.getchannel("A"))
        rgba.close()
        oriented.close()
        return result
    result = oriented.convert("RGB")
    oriented.close()
    return result


def get_printer_adapter(platform_name: str | None = None) -> PrinterAdapter:
    resolved_platform = platform_name
    if resolved_platform is None:
        resolved_platform = "windows" if sys.platform == "win32" else "macos" if sys.platform == "darwin" else "linux"
    if resolved_platform == "windows":
        return WindowsPrinterAdapter()
    return CupsPrinterAdapter()
