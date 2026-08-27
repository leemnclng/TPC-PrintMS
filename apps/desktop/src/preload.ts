import { contextBridge, ipcRenderer } from "electron";

/**
 * The only surface the renderer ever sees. Per docs/context/decisions.md
 * ("Electron exposes only the required operations to the renderer"), this
 * is deliberately narrow: resolved API configuration and one native settings
 * action. There is no generic `ipcRenderer.invoke` passthrough here on purpose.
 */
contextBridge.exposeInMainWorld("paperClub", {
  getApiConfig: () => ipcRenderer.invoke("paper-club:get-api-config"),
  openPrinterSettings: () => ipcRenderer.invoke("paper-club:open-printer-settings"),
  platform: process.platform,
});
