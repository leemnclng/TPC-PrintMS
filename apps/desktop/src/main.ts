import { app, BrowserWindow, ipcMain, shell } from "electron";
import path from "node:path";
import { BackendManager } from "./backendManager";

const backend = new BackendManager();
let backendReady: Promise<void> | null = null;
let mainWindow: BrowserWindow | null = null;
const appIconPath = path.join(__dirname, "..", "build", "icon.png");

function createWindow(): void {
  mainWindow = new BrowserWindow({
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

  if (!app.isPackaged) {
    mainWindow.loadURL("http://localhost:5173");
    if (process.env.PRINTING_MS_OPEN_DEVTOOLS === "1") {
      mainWindow.webContents.openDevTools({ mode: "detach" });
    }
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "..", "web", "dist", "index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

ipcMain.handle("paper-club:get-api-config", async () => {
  if (backendReady) await backendReady;
  return backend.getConfig();
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

app.whenReady().then(async () => {
  if (process.platform === "darwin" && !app.isPackaged) {
    app.dock.setIcon(appIconPath);
  }

  backendReady = backend
    .start()
    .then(() => undefined)
    .catch((err) => {
      console.error("[main] backend failed to start:", err);
      // Surfaced to the renderer as a persistent "backend offline" state via
      // the sidebar's health polling rather than a native error dialog —
      // the app shell still renders so the user isn't staring at a blank
      // window.
    });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", async (event) => {
  event.preventDefault();
  await backend.stop();
  app.exit(0);
});
