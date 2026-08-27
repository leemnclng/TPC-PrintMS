import { contextBridge, ipcRenderer } from "electron";

/**
 * The only surface the renderer ever sees. Per docs/context/decisions.md
 * ("Electron exposes only the required operations to the renderer"), this
 * is deliberately narrow: one call to fetch the resolved local API config.
 * There is no generic `ipcRenderer.invoke` passthrough here on purpose.
 */
contextBridge.exposeInMainWorld("paperClub", {
  getApiConfig: () => ipcRenderer.invoke("paper-club:get-api-config"),
  platform: process.platform,
});
