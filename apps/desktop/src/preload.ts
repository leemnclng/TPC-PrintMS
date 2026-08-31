import { contextBridge, ipcRenderer } from "electron";

/**
 * The only surface the renderer ever sees. Per docs/context/decisions.md
 * ("Electron exposes only the required operations to the renderer"), this
 * is deliberately narrow: resolved API configuration and one native settings
 * action. There is no generic `ipcRenderer.invoke` passthrough here on purpose.
 */
contextBridge.exposeInMainWorld("paperClub", {
  getApiConfig: () => ipcRenderer.invoke("paper-club:get-api-config"),
  switchEnvironment: (stage: string) => ipcRenderer.invoke("paper-club:switch-environment", stage),
  openPrinterSettings: () => ipcRenderer.invoke("paper-club:open-printer-settings"),
  openPrinterPreferences: (printerName: string) => ipcRenderer.invoke("paper-club:open-printer-preferences", printerName),
  inspectScanners: () => ipcRenderer.invoke("paper-club:inspect-scanners"),
  acquireScannerPage: (deviceId: string, settings: { source: "auto" | "flatbed" | "feeder"; contentType: "color"; resolutionDpi: 150 | 300 | 600; pageSize: "auto" | "a4" | "letter" | "legal" | "4x6" | "5x7" | "8x10"; placementConfirmed: boolean }) => ipcRenderer.invoke("paper-club:acquire-scanner-page", deviceId, settings),
  platform: process.platform,
});
