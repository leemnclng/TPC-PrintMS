import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { execFile } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { BackendConfig, BackendManager, KNOWN_STAGES } from "./backendManager";
import { acquireScannerPage, inspectScannerDevices } from "./scannerAcquisition";

const backend = new BackendManager((level, event, details) => logDesktopEvent(level, event, details));
const useSoftwareRendering = process.platform === "win32" && process.env.PRINTING_MS_ENABLE_HARDWARE_ACCELERATION !== "1";
if (useSoftwareRendering) app.disableHardwareAcceleration();

let backendReady: Promise<BackendConfig> | null = null;
let backendFailure: { error: Error; retryAfter: number } | null = null;
let mainWindow: BrowserWindow | null = null;
let shutdownPromise: Promise<void> | null = null;
const appIconPath = path.join(__dirname, "..", "build", "icon.png");
const BACKEND_RETRY_DELAY_MS = 15_000;
const RENDERER_RECOVERY_WINDOW_MS = 60_000;
let desktopLogPath: string | null = null;
let lastRendererRecoveryAt = 0;
let rendererFailureDialogOpen = false;

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

function loadRenderer(window: BrowserWindow): Promise<void> {
  if (!app.isPackaged) return window.loadURL("http://localhost:5173");
  return window.loadFile(path.join(__dirname, "..", "..", "web", "dist", "index.html"));
}

async function showRendererFailure(window: BrowserWindow, detail: string): Promise<void> {
  if (rendererFailureDialogOpen || window.isDestroyed()) return;
  rendererFailureDialogOpen = true;
  try {
    const result = await dialog.showMessageBox(window, {
      type: "error",
      title: "Printing-MS display recovery",
      message: "The application screen stopped rendering.",
      detail: `${detail}\n\nSoftware rendering is enabled on Windows. Diagnostics were saved to ${desktopLogPath ?? "the Electron log folder"}.`,
      buttons: ["Try again", "Close app"],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (result.response === 0 && !window.isDestroyed()) {
      lastRendererRecoveryAt = Date.now();
      void loadRenderer(window).catch((error) => recoverRenderer(window, `Reload failed: ${String(error)}`));
    } else if (!window.isDestroyed()) {
      window.close();
    }
  } finally {
    rendererFailureDialogOpen = false;
  }
}

function recoverRenderer(window: BrowserWindow, detail: string): void {
  if (window.isDestroyed() || shutdownPromise) return;
  logDesktopEvent("ERROR", "renderer.failure", { detail });
  const now = Date.now();
  if (now - lastRendererRecoveryAt > RENDERER_RECOVERY_WINDOW_MS) {
    lastRendererRecoveryAt = now;
    setTimeout(() => {
      if (!window.isDestroyed()) {
        void loadRenderer(window).catch((error) => recoverRenderer(window, `Automatic reload failed: ${String(error)}`));
      }
    }, 500);
    return;
  }
  void showRendererFailure(window, detail);
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
    title: "Printing-MS — The Paper Club",
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
  return trackBackendStart(backend.switchStage(stage as (typeof KNOWN_STAGES)[number]));
});

ipcMain.handle("paper-club:inspect-scanners", async () => inspectScannerDevices());
ipcMain.handle("paper-club:acquire-scanner-page", async (_event, deviceId: unknown, settings: unknown) => acquireScannerPage(deviceId, settings));

app.whenReady().then(async () => {
  initializeDesktopLogging();
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
