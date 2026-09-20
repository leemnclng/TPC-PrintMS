import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_SCANNED_FILES = 10_000;
const SUPPORTED_EXTENSIONS = new Set([".pdf", ".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp", ".webp", ".docx", ".xlsx", ".pptx"]);

export type PrintSourceMatch = {
  status: "matched" | "not_found" | "ambiguous" | "unsupported" | "too_large" | "error";
  message: string;
  filename?: string;
  relativePath?: string;
  mimeType?: string;
  sizeBytes?: number;
  modifiedAt?: string;
  base64?: string;
};

function mimeType(filename: string): string {
  const extension = path.extname(filename).toLowerCase();
  return ({
    ".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".tif": "image/tiff", ".tiff": "image/tiff", ".bmp": "image/bmp", ".webp": "image/webp",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  } as Record<string, string>)[extension] ?? "application/octet-stream";
}

function possibleJobNames(documentName: string): string[] {
  const cleaned = documentName.trim().replace(/^.*?:\s*(?=[^:]+$)/, "");
  return [...new Set([path.win32.basename(documentName.trim()), path.win32.basename(cleaned)].map((value) => value.toLocaleLowerCase()).filter(Boolean))];
}

async function collectFiles(root: string): Promise<string[]> {
  const results: string[] = [];
  const pending = [root];
  while (pending.length && results.length < MAX_SCANNED_FILES) {
    const directory = pending.pop()!;
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(candidate);
      else if (entry.isFile() && SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) results.push(candidate);
      if (results.length >= MAX_SCANNED_FILES) break;
    }
  }
  return results;
}

export async function matchPrintSource(root: string, documentName: string): Promise<PrintSourceMatch> {
  const names = possibleJobNames(documentName);
  if (!names.length) return { status: "not_found", message: "Windows did not provide a usable document name." };
  try {
    const files = await collectFiles(root);
    const exact = files.filter((candidate) => names.includes(path.basename(candidate).toLocaleLowerCase()));
    const candidates = exact.length ? exact : files.filter((candidate) => {
      const stem = path.basename(candidate, path.extname(candidate)).toLocaleLowerCase();
      return names.some((name) => path.basename(name, path.extname(name)).toLocaleLowerCase() === stem);
    });
    if (!candidates.length) return { status: "not_found", message: `No supported file named “${documentName}” was found in the trusted folder.` };
    if (candidates.length > 1) return { status: "ambiguous", message: `${candidates.length} files match “${documentName}”. Choose the intended file manually.` };
    const candidate = candidates[0];
    const details = await stat(candidate);
    if (details.size > MAX_FILE_BYTES) return { status: "too_large", message: "The matched file exceeds the 25 MB analysis limit." };
    const data = await readFile(candidate);
    return {
      status: "matched",
      message: "Matched from the trusted print-source folder.",
      filename: path.basename(candidate),
      relativePath: path.relative(root, candidate),
      mimeType: mimeType(candidate),
      sizeBytes: details.size,
      modifiedAt: details.mtime.toISOString(),
      base64: data.toString("base64"),
    };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "The trusted print-source folder could not be searched." };
  }
}
