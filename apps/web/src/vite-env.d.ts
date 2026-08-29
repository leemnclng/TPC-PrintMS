/// <reference types="vite/client" />

declare module "*.jpg" {
  const src: string;
  export default src;
}
declare module "*.jpeg" {
  const src: string;
  export default src;
}
declare module "*.png" {
  const src: string;
  export default src;
}
declare module "*.svg" {
  const src: string;
  export default src;
}

/** Config the Electron main process hands the renderer at startup: the
 *  loopback FastAPI base URL and the per-launch auth token. Never persisted,
 *  never sent anywhere but the local backend. See apps/desktop/src/preload.ts. */
export interface PaperClubApiConfig {
  baseUrl: string;
  token: string;
}

export interface PaperClubBridge {
  getApiConfig: () => Promise<PaperClubApiConfig>;
  openPrinterSettings: () => Promise<void>;
  openPrinterPreferences: (printerName: string) => Promise<void>;
  acquireScannerPage: () => Promise<{
    status: "acquired" | "cancelled";
    file?: {
      filename: string;
      mimeType: string;
      sizeBytes: number;
      base64: string;
    };
  }>;
  platform: NodeJS.Platform | "web";
}

declare global {
  interface Window {
    paperClub?: PaperClubBridge;
  }
}
