import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { execFile } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { cp, mkdir, readdir, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { BackendConfig, BackendManager, KNOWN_STAGES } from "./backendManager";
import { acquireScannerPage, inspectScannerDevices } from "./scannerAcquisition";
import { matchPrintSource } from "./printSourceFolder";

app.setName("OMS");

const backend = new BackendManager((level, event, details) => logDesktopEvent(level, event, details));
const useSoftwareRendering = process.platform === "win32" && process.env.PRINTING_MS_ENABLE_HARDWARE_ACCELERATION !== "1";
if (useSoftwareRendering) app.disableHardwareAcceleration();

let backendReady: Promise<BackendConfig> | null = null;
let backendFailure: { error: Error; retryAfter: number } | null = null;
let mainWindow: BrowserWindow | null = null;
let pricingOverviewWindow: BrowserWindow | null = null;
let shutdownPromise: Promise<void> | null = null;
const appIconPath = path.join(__dirname, "..", "build", "icon.png");
const BACKEND_RETRY_DELAY_MS = 15_000;
const RENDERER_RECOVERY_WINDOW_MS = 60_000;
let desktopLogPath: string | null = null;
let lastRendererRecoveryAt = 0;
let rendererFailureDialogOpen = false;
let approvedStorageDestination: string | null = null;
const STORAGE_LOCATION_FILE = "storage-location.json";
const PRINT_SOURCE_FOLDER_FILE = "print-source-folder.json";

interface StorageLocationConfig {
  dataRoot: string;
}

interface PrintSourceFolderConfig {
  folderPath: string;
}

function defaultDataRoot(): string {
  if (process.env.PRINT_MS_DATA_DIR) return path.resolve(process.env.PRINT_MS_DATA_DIR);
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "PrintingMS");
  if (process.platform === "win32") return path.join(process.env.APPDATA ?? os.homedir(), "PrintingMS");
  return path.join(process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share"), "PrintingMS");
}

function storageLocationConfigPath(): string {
  return path.join(app.getPath("userData"), STORAGE_LOCATION_FILE);
}

function readStoredDataRoot(): string | null {
  try {
    const parsed = JSON.parse(readFileSync(storageLocationConfigPath(), "utf8")) as Partial<StorageLocationConfig>;
    return typeof parsed.dataRoot === "string" && path.isAbsolute(parsed.dataRoot) ? path.normalize(parsed.dataRoot) : null;
  } catch {
    return null;
  }
}

async function writeStoredDataRoot(dataRoot: string): Promise<void> {
  const configPath = storageLocationConfigPath();
  const temporaryPath = `${configPath}.tmp`;
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(temporaryPath, `${JSON.stringify({ dataRoot }, null, 2)}\n`, "utf8");
  try {
    await rename(temporaryPath, configPath);
  } catch (error) {
    await unlink(configPath).catch(() => undefined);
    await rename(temporaryPath, configPath).catch(async () => {
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    });
  }
}

function printSourceFolderConfigPath(): string {
  return path.join(app.getPath("userData"), PRINT_SOURCE_FOLDER_FILE);
}

function readPrintSourceFolder(): string | null {
  try {
    const parsed = JSON.parse(readFileSync(printSourceFolderConfigPath(), "utf8")) as Partial<PrintSourceFolderConfig>;
    return typeof parsed.folderPath === "string" && path.isAbsolute(parsed.folderPath) ? path.normalize(parsed.folderPath) : null;
  } catch {
    return null;
  }
}

async function writePrintSourceFolder(folderPath: string): Promise<void> {
  await mkdir(path.dirname(printSourceFolderConfigPath()), { recursive: true });
  await writeFile(printSourceFolderConfigPath(), `${JSON.stringify({ folderPath }, null, 2)}\n`, "utf8");
}

function currentDataRoot(): string {
  return path.resolve(backend.getDataRoot() ?? defaultDataRoot());
}

function isNestedPath(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function copyStorageRoot(source: string, destination: string): Promise<void> {
  if (isNestedPath(source, destination) || isNestedPath(destination, source)) {
    throw new Error("Choose a folder outside the current data folder.");
  }
  await mkdir(destination, { recursive: true });
  const destinationEntries = (await readdir(destination)).filter((entry) => ![".DS_Store", "desktop.ini", "Thumbs.db"].includes(entry));
  if (destinationEntries.length > 0) {
    throw new Error("Choose an empty folder so existing app data cannot be overwritten.");
  }
  const sourceEntries = await readdir(source).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const copiedEntries: string[] = [];
  try {
    for (const entry of sourceEntries) {
      copiedEntries.push(entry);
      await cp(path.join(source, entry), path.join(destination, entry), {
        recursive: true,
        errorOnExist: true,
        force: false,
        preserveTimestamps: true,
      });
    }
  } catch (error) {
    await Promise.all(copiedEntries.map((entry) => rm(path.join(destination, entry), { recursive: true, force: true })));
    throw error;
  }
}

function logDesktopEvent(level: "INFO" | "WARN" | "ERROR", event: string, details?: unknown): void {
  const serializedDetails = details === undefined ? "" : ` ${JSON.stringify(details)}`;
  const line = `${new Date().toISOString()} ${level} ${event}${serializedDetails}`;
  if (level === "ERROR") console.error(`[desktop] ${event}`, details ?? "");
  else if (level === "WARN") console.warn(`[desktop] ${event}`, details ?? "");
  else console.log(`[desktop] ${event}`, details ?? "");
  if (!desktopLogPath) return;
  try {
    appendFileSync(desktopLogPath, `${line}\n`, "utf8");
  } catch (error) {
    console.error("[desktop] could not write the desktop diagnostic log:", error);
  }
}

function initializeDesktopLogging(): void {
  const logDirectory = app.getPath("logs");
  mkdirSync(logDirectory, { recursive: true });
  desktopLogPath = path.join(logDirectory, "desktop.log");
  logDesktopEvent("INFO", "desktop.start", {
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    softwareRendering: useSoftwareRendering,
    logPath: desktopLogPath,
  });
}

function loadRenderer(window: BrowserWindow, route = "/"): Promise<void> {
  const hash = route === "/" ? "" : `#${route}`;
  if (!app.isPackaged) return window.loadURL(`http://localhost:5173/${hash}`);
  return window.loadFile(
    path.join(__dirname, "..", "..", "web", "dist", "index.html"),
    route === "/" ? undefined : { hash: route },
  );
}

async function showRendererFailure(window: BrowserWindow, detail: string, route = "/"): Promise<void> {
  if (rendererFailureDialogOpen || window.isDestroyed()) return;
  rendererFailureDialogOpen = true;
  try {
    const result = await dialog.showMessageBox(window, {
      type: "error",
      title: "OMS display recovery",
      message: "The application screen stopped rendering.",
      detail: `${detail}\n\nSoftware rendering is enabled on Windows. Diagnostics were saved to ${desktopLogPath ?? "the Electron log folder"}.`,
      buttons: ["Try again", "Close app"],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (result.response === 0 && !window.isDestroyed()) {
      lastRendererRecoveryAt = Date.now();
      void loadRenderer(window, route).catch((error) => recoverRenderer(window, `Reload failed: ${String(error)}`, route));
    } else if (!window.isDestroyed()) {
      window.close();
    }
  } finally {
    rendererFailureDialogOpen = false;
  }
}

function recoverRenderer(window: BrowserWindow, detail: string, route = "/"): void {
  if (window.isDestroyed() || shutdownPromise) return;
  logDesktopEvent("ERROR", "renderer.failure", { detail });
  const now = Date.now();
  if (now - lastRendererRecoveryAt > RENDERER_RECOVERY_WINDOW_MS) {
    lastRendererRecoveryAt = now;
    setTimeout(() => {
      if (!window.isDestroyed()) {
        void loadRenderer(window, route).catch((error) => recoverRenderer(window, `Automatic reload failed: ${String(error)}`, route));
      }
    }, 500);
    return;
  }
  void showRendererFailure(window, detail, route);
}

function shutdownAndExit(exitCode = 0): Promise<void> {
  if (shutdownPromise) return shutdownPromise;

  shutdownPromise = (async () => {
    try {
      await backend.stop();
    } catch (error) {
      console.error("[main] failed to stop the backend cleanly:", error);
    } finally {
      app.exit(exitCode);
    }
  })();
  return shutdownPromise;
}

function trackBackendStart(startup: Promise<BackendConfig>): Promise<BackendConfig> {
  backendReady = startup;
  backendFailure = null;
  void startup.catch((error) => {
    if (backendReady === startup) backendReady = null;
    const normalizedError = error instanceof Error ? error : new Error(String(error));
    backendFailure = { error: normalizedError, retryAfter: Date.now() + BACKEND_RETRY_DELAY_MS };
    logDesktopEvent("ERROR", "backend.start.failed", {
      message: normalizedError.message,
      retryAfter: backendFailure.retryAfter,
    });
    console.error("[main] backend failed to start:", normalizedError);
  });
  return startup;
}

async function ensureBackendReady(): Promise<BackendConfig> {
  if (backendReady) {
    const config = await backendReady;
    if (backend.isReady()) return config;
    backendReady = null;
  }
  if (backendFailure && Date.now() < backendFailure.retryAfter) {
    throw backendFailure.error;
  }
  return trackBackendStart(backend.start());
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1040,
    minHeight: 680,
    backgroundColor: "#faf9f6", // matches --color-paper — avoids a white/black flash before CSS loads
    title: "OMS — The Paper Club",
    icon: appIconPath,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow = window;

  if (!app.isPackaged) {
    if (process.env.PRINTING_MS_OPEN_DEVTOOLS === "1") {
      window.webContents.openDevTools({ mode: "detach" });
    }
  }
  void loadRenderer(window).catch((error) => recoverRenderer(window, `Initial load failed: ${String(error)}`));

  window.webContents.on("did-finish-load", () => {
    logDesktopEvent("INFO", "renderer.ready", { url: window.webContents.getURL() });
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    if (details.reason === "clean-exit") return;
    recoverRenderer(window, `Renderer exited (${details.reason}, code ${details.exitCode}).`);
  });
  window.on("unresponsive", () => {
    logDesktopEvent("WARN", "renderer.unresponsive");
  });
  window.on("responsive", () => {
    logDesktopEvent("INFO", "renderer.responsive");
  });

  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });
}

function openPricingOverviewWindow(): void {
  if (pricingOverviewWindow && !pricingOverviewWindow.isDestroyed()) {
    if (pricingOverviewWindow.isMinimized()) pricingOverviewWindow.restore();
    pricingOverviewWindow.show();
    pricingOverviewWindow.focus();
    return;
  }

  const window = new BrowserWindow({
    width: 1260,
    height: 820,
    minWidth: 820,
    minHeight: 560,
    backgroundColor: "#faf9f6",
    title: "Price Overview — OMS",
    icon: appIconPath,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  pricingOverviewWindow = window;
  void loadRenderer(window, "/pricing-overview")
    .catch((error) => recoverRenderer(window, `Price overview load failed: ${String(error)}`, "/pricing-overview"));
  window.webContents.on("did-finish-load", () => {
    logDesktopEvent("INFO", "pricing-overview.ready", { url: window.webContents.getURL() });
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    if (details.reason === "clean-exit") return;
    recoverRenderer(window, `Price overview renderer exited (${details.reason}, code ${details.exitCode}).`, "/pricing-overview");
  });
  window.on("closed", () => {
    if (pricingOverviewWindow === window) pricingOverviewWindow = null;
  });
}

ipcMain.handle("paper-club:get-api-config", async () => {
  return ensureBackendReady();
});

ipcMain.handle("paper-club:open-printer-settings", async () => {
  if (process.platform === "win32") {
    await shell.openExternal("ms-settings:printers");
    return;
  }
  if (process.platform === "darwin") {
    await shell.openExternal("x-apple.systempreferences:com.apple.Print-Scan-Settings.extension");
    return;
  }
  throw new Error("Open your operating system's printer settings to add a printer.");
});

ipcMain.handle("paper-club:open-pricing-overview", () => {
  openPricingOverviewWindow();
});

ipcMain.handle("paper-club:open-printer-preferences", async (_event, printerName: unknown) => {
  if (process.platform !== "win32") {
    throw new Error("Per-printer preferences are available through Windows printer drivers.");
  }
  if (typeof printerName !== "string" || !printerName.trim() || printerName.length > 260) {
    throw new Error("A valid Windows printer name is required.");
  }
  await new Promise<void>((resolve, reject) => {
    execFile(
      "rundll32.exe",
      ["printui.dll,PrintUIEntry", "/e", "/n", printerName],
      { windowsHide: false },
      (error) => error ? reject(error) : resolve(),
    );
  });
});

ipcMain.handle("paper-club:switch-environment", async (_event, stage: unknown) => {
  if (typeof stage !== "string" || !KNOWN_STAGES.includes(stage as (typeof KNOWN_STAGES)[number])) {
    throw new Error("Unknown environment.");
  }
  // Reassign backendReady itself (not just await the old one) so a request
  // that arrives mid-switch — namely the renderer's post-reload
  // getApiConfig() call — waits on this restart instead of the prior one.
  const config = await trackBackendStart(backend.switchStage(stage as (typeof KNOWN_STAGES)[number]));
  const overviewWindow = pricingOverviewWindow;
  if (overviewWindow && !overviewWindow.isDestroyed()) {
    void loadRenderer(overviewWindow, "/pricing-overview")
      .catch((error) => recoverRenderer(overviewWindow, `Price overview reload failed: ${String(error)}`, "/pricing-overview"));
  }
  return config;
});

ipcMain.handle("paper-club:get-storage-location", () => {
  const defaultPath = defaultDataRoot();
  const currentPath = currentDataRoot();
  return { currentPath, defaultPath, isCustom: path.normalize(currentPath) !== path.normalize(defaultPath) };
});

ipcMain.handle("paper-club:choose-storage-location", async () => {
  const options: Electron.OpenDialogOptions = {
    title: "Choose OMS data folder",
    defaultPath: path.dirname(currentDataRoot()),
    buttonLabel: "Choose folder",
    properties: ["openDirectory", "createDirectory"],
  };
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options);
  approvedStorageDestination = result.canceled ? null : result.filePaths[0] ?? null;
  return approvedStorageDestination;
});

ipcMain.handle("paper-club:move-storage-location", async (_event, destinationValue: unknown) => {
  if (
    typeof destinationValue !== "string"
    || !path.isAbsolute(destinationValue)
    || path.normalize(destinationValue) !== path.normalize(approvedStorageDestination ?? "")
  ) {
    throw new Error("Choose the destination with the folder picker first.");
  }
  approvedStorageDestination = null;
  const source = currentDataRoot();
  const destination = path.resolve(destinationValue);
  if (path.normalize(source) === path.normalize(destination)) return backend.getConfig();

  const stage = backend.getStage() ?? "development";
  await backend.stop();
  try {
    await copyStorageRoot(source, destination);
    await writeStoredDataRoot(destination);
    backend.setDataRoot(destination);
    return await trackBackendStart(backend.switchStage(stage));
  } catch (error) {
    backend.setDataRoot(source);
    try {
      await writeStoredDataRoot(source);
      await trackBackendStart(backend.switchStage(stage));
    } catch (recoveryError) {
      logDesktopEvent("ERROR", "storage.move.recovery.failed", { recoveryError: String(recoveryError) });
    }
    throw error;
  }
});

ipcMain.handle("paper-club:get-print-source-folder", async () => {
  const folderPath = readPrintSourceFolder();
  if (!folderPath) return { folderPath: null, available: false };
  const available = await stat(folderPath).then((entry) => entry.isDirectory()).catch(() => false);
  return { folderPath, available };
});

ipcMain.handle("paper-club:choose-print-source-folder", async () => {
  const current = readPrintSourceFolder();
  const options: Electron.OpenDialogOptions = {
    title: "Choose trusted print-source folder",
    defaultPath: current ?? app.getPath("documents"),
    buttonLabel: "Use this folder",
    properties: ["openDirectory", "createDirectory"],
  };
  const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
  if (result.canceled || !result.filePaths[0]) return null;
  const folderPath = path.normalize(result.filePaths[0]);
  await writePrintSourceFolder(folderPath);
  return { folderPath, available: true };
});

ipcMain.handle("paper-club:clear-print-source-folder", async () => {
  await unlink(printSourceFolderConfigPath()).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
  return { folderPath: null, available: false };
});

ipcMain.handle("paper-club:match-print-source", async (_event, documentNameValue: unknown) => {
  if (typeof documentNameValue !== "string" || !documentNameValue.trim()) {
    return { status: "not_found", message: "Windows did not provide a usable document name." };
  }
  const root = readPrintSourceFolder();
  if (!root) return { status: "not_configured", message: "Choose a trusted print-source folder in Settings first." };
  const available = await stat(root).then((entry) => entry.isDirectory()).catch(() => false);
  if (!available) return { status: "unavailable", message: "The configured print-source folder is unavailable." };
  return matchPrintSource(root, documentNameValue);
});

ipcMain.handle("paper-club:inspect-scanners", async () => inspectScannerDevices());
ipcMain.handle("paper-club:acquire-scanner-page", async (_event, deviceId: unknown, settings: unknown) => acquireScannerPage(deviceId, settings));

app.whenReady().then(async () => {
  initializeDesktopLogging();
  backend.setDataRoot(readStoredDataRoot());
  if (process.platform === "darwin" && !app.isPackaged) {
    app.dock.setIcon(appIconPath);
  }

  // Start immediately, while retaining the rejected promise so renderer
  // requests receive the real launch error. A later request may retry after
  // the failed child has been cleared by trackBackendStart().
  void trackBackendStart(backend.start());

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("child-process-gone", (_event, details) => {
  const level = details.type === "GPU" ? "ERROR" : "WARN";
  logDesktopEvent(level, "child-process.gone", details);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") void shutdownAndExit();
});

app.on("before-quit", (event) => {
  if (shutdownPromise) return;
  event.preventDefault();
  void shutdownAndExit();
});

process.once("SIGINT", () => void shutdownAndExit(130));
process.once("SIGTERM", () => void shutdownAndExit(143));
