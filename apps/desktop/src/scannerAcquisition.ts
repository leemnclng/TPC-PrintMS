import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { app } from "electron";

const MAX_SCAN_PAGE_BYTES = 25 * 1024 * 1024;

export interface ScannerAcquisitionSettings {
  source: "auto" | "flatbed" | "feeder";
  contentType: "color" | "grayscale" | "text";
  resolutionDpi: 150 | 300 | 600;
  pageSize: "auto" | "a4" | "letter" | "legal" | "4x6" | "5x7" | "8x10";
  placementConfirmed: boolean;
}

export interface ScannerDeviceState {
  id: string;
  name: string;
  isOnline: boolean;
  supportsFlatbed: boolean;
  supportsFeeder: boolean;
  supportsDuplex: boolean;
  detectsFlatbed: boolean;
  detectsFeeder: boolean;
  flatbedReady: boolean | null;
  feederReady: boolean | null;
  coverOpen: boolean;
  paperJam: boolean;
  issue: string | null;
}

interface ScriptResult {
  status: "ready" | "unavailable" | "acquired" | "cancelled" | "not_ready" | "error";
  code?: string;
  message?: string;
  devices?: ScannerDeviceState[];
  // A feeder acquisition transfers every loaded sheet in one call, so this is
  // always a list — one entry for a flatbed page, one-or-more for a feeder.
  files?: Array<{ path: string; filename: string }>;
  deviceName?: string;
  source?: "auto" | "flatbed" | "feeder";
  contentType?: "color" | "grayscale" | "text";
  resolutionDpi?: 150 | 300 | 600;
  pageSize?: ScannerAcquisitionSettings["pageSize"];
}

export interface NativeScanResult {
  status: "acquired" | "cancelled" | "not_ready" | "error";
  code?: string;
  message?: string;
  deviceName?: string;
  source?: "auto" | "flatbed" | "feeder";
  settings?: Omit<ScannerAcquisitionSettings, "source" | "placementConfirmed">;
  files?: Array<{
    filename: string;
    mimeType: string;
    sizeBytes: number;
    base64: string;
  }>;
}

export interface ScannerInspection {
  status: "ready" | "unavailable" | "error";
  message?: string;
  devices: ScannerDeviceState[];
}

function scannerScriptPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "scanner", "windows_scan.ps1")
    : path.join(__dirname, "..", "resources", "windows_scan.ps1");
}

function executeScannerScript(args: string[]): Promise<ScriptResult> {
  return new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-STA",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        scannerScriptPath(),
        ...args,
      ],
      { windowsHide: false, maxBuffer: 1024 * 1024 },
      (error, stdout, _stderr) => {
        if (error) {
          reject(new Error("Windows could not initialize scanner support. Restart the app and repair the Canon MP/WIA driver if this continues."));
          return;
        }
        try {
          const resultLine = stdout.trim().split(/\r?\n/).at(-1);
          if (!resultLine) throw new Error("The scanner returned no result.");
          resolve(JSON.parse(resultLine) as ScriptResult);
        } catch {
          reject(new Error("The scanner completed, but its output could not be read."));
        }
      },
    );
  });
}

export async function inspectScannerDevices(): Promise<ScannerInspection> {
  if (process.platform !== "win32") {
    return { status: "unavailable", message: "Direct scanner acquisition is currently available on Windows only.", devices: [] };
  }
  try {
    const result = await executeScannerScript(["-Mode", "Inspect"]);
    return {
      status: result.status === "ready" ? "ready" : result.status === "unavailable" ? "unavailable" : "error",
      message: result.message,
      devices: result.devices ?? [],
    };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "Scanner discovery failed.", devices: [] };
  }
}

function mimeTypeFor(filename: string): string {
  const extension = path.extname(filename).toLowerCase();
  return {
    ".bmp": "image/bmp",
    ".gif": "image/gif",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".png": "image/png",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
  }[extension] ?? "application/octet-stream";
}

export async function acquireScannerPage(deviceId: unknown, settings: unknown): Promise<NativeScanResult> {
  if (process.platform !== "win32") {
    throw new Error("Direct scanner acquisition is currently available on Windows only.");
  }
  if (typeof deviceId !== "string" || !deviceId.trim() || deviceId.length > 1000) {
    return { status: "error", code: "invalid_request", message: "Select an available scanner before starting." };
  }
  if (!settings || typeof settings !== "object") {
    return { status: "error", code: "invalid_request", message: "The scanner settings are missing." };
  }
  const candidate = settings as Partial<ScannerAcquisitionSettings>;
  if (candidate.source !== "auto" && candidate.source !== "flatbed" && candidate.source !== "feeder") {
    return { status: "error", code: "invalid_request", message: "The scanner source selection is invalid." };
  }
  if (candidate.contentType !== "color" && candidate.contentType !== "grayscale" && candidate.contentType !== "text") {
    return { status: "error", code: "invalid_request", message: "The scanner content type is invalid." };
  }
  if (candidate.resolutionDpi !== 150 && candidate.resolutionDpi !== 300 && candidate.resolutionDpi !== 600) {
    return { status: "error", code: "invalid_request", message: "The scanner resolution is invalid." };
  }
  if (!candidate.pageSize || !["auto", "a4", "letter", "legal", "4x6", "5x7", "8x10"].includes(candidate.pageSize)) {
    return { status: "error", code: "invalid_request", message: "The scanner page size is invalid." };
  }
  if (candidate.placementConfirmed !== true) {
    return { status: "not_ready", code: "paper_unconfirmed", message: "Confirm that the document is loaded before starting the scanner." };
  }
  const validatedSettings = candidate as ScannerAcquisitionSettings;

  const outputDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "printing-ms-scan-"));
  try {
    const result = await executeScannerScript([
      "-Mode", "Acquire",
      "-OutputDirectory", outputDirectory,
      "-DeviceId", deviceId,
      "-Source", validatedSettings.source,
      "-ContentType", validatedSettings.contentType,
      "-ResolutionDpi", String(validatedSettings.resolutionDpi),
      "-PageSize", validatedSettings.pageSize,
    ]);
    if (result.status === "cancelled") return { status: "cancelled" };
    if (result.status === "not_ready" || result.status === "error") {
      return { status: result.status, code: result.code, message: result.message };
    }
    if (result.status !== "acquired") {
      return { status: "error", code: "scanner_bridge_error", message: "The scanner returned an unexpected response." };
    }
    if (!result.files?.length) throw new Error("The scanner did not return an output file.");

    const resolvedDirectory = await fs.realpath(outputDirectory);
    const files: NonNullable<NativeScanResult["files"]> = [];
    for (const entry of result.files) {
      if (!entry.path || !entry.filename) throw new Error("The scanner did not return an output file.");
      const resolvedFile = await fs.realpath(entry.path);
      const relativeFile = path.relative(resolvedDirectory, resolvedFile);
      if (relativeFile.startsWith("..") || path.isAbsolute(relativeFile)) {
        throw new Error("The scanner returned an unsafe output path.");
      }

      const data = await fs.readFile(resolvedFile);
      if (!data.length) throw new Error("The scanner returned an empty page.");
      if (data.length > MAX_SCAN_PAGE_BYTES) throw new Error("A scanned page is larger than 25 MB.");
      if (path.extname(entry.filename).toLowerCase() === ".png" && !data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
        throw new Error("Windows acquired a page, but could not prepare a valid preview image.");
      }
      files.push({
        filename: path.basename(entry.filename),
        mimeType: mimeTypeFor(entry.filename),
        sizeBytes: data.length,
        base64: data.toString("base64"),
      });
    }
    return {
      status: "acquired",
      message: result.message,
      deviceName: result.deviceName,
      source: result.source,
      settings: {
        contentType: result.contentType ?? validatedSettings.contentType,
        resolutionDpi: result.resolutionDpi ?? validatedSettings.resolutionDpi,
        pageSize: result.pageSize ?? validatedSettings.pageSize,
      },
      files,
    };
  } finally {
    await fs.rm(outputDirectory, { recursive: true, force: true });
  }
}
