import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { app } from "electron";

const MAX_SCAN_PAGE_BYTES = 25 * 1024 * 1024;

interface ScriptResult {
  status: "acquired" | "cancelled";
  path?: string;
  filename?: string;
}

export interface NativeScanResult {
  status: "acquired" | "cancelled";
  file?: {
    filename: string;
    mimeType: string;
    sizeBytes: number;
    base64: string;
  };
}

function scannerScriptPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "scanner", "windows_scan.ps1")
    : path.join(__dirname, "..", "resources", "windows_scan.ps1");
}

function executeScannerScript(outputDirectory: string): Promise<ScriptResult> {
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
        "-OutputDirectory",
        outputDirectory,
      ],
      { windowsHide: false, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr.trim() || "Windows could not start the scanner. Check that its WIA driver is installed and the device is online."));
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

export async function acquireScannerPage(): Promise<NativeScanResult> {
  if (process.platform !== "win32") {
    throw new Error("Direct scanner acquisition is currently available on Windows only.");
  }

  const outputDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "printing-ms-scan-"));
  try {
    const result = await executeScannerScript(outputDirectory);
    if (result.status === "cancelled") return { status: "cancelled" };
    if (!result.path || !result.filename) throw new Error("The scanner did not return an output file.");

    const resolvedDirectory = await fs.realpath(outputDirectory);
    const resolvedFile = await fs.realpath(result.path);
    const relativeFile = path.relative(resolvedDirectory, resolvedFile);
    if (relativeFile.startsWith("..") || path.isAbsolute(relativeFile)) {
      throw new Error("The scanner returned an unsafe output path.");
    }

    const data = await fs.readFile(resolvedFile);
    if (!data.length) throw new Error("The scanner returned an empty page.");
    if (data.length > MAX_SCAN_PAGE_BYTES) throw new Error("The scanned page is larger than 25 MB.");
    return {
      status: "acquired",
      file: {
        filename: path.basename(result.filename),
        mimeType: mimeTypeFor(result.filename),
        sizeBytes: data.length,
        base64: data.toString("base64"),
      },
    };
  } finally {
    await fs.rm(outputDirectory, { recursive: true, force: true });
  }
}
