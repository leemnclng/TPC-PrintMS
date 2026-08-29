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
  inspectScanners: () => Promise<{
    status: "ready" | "unavailable" | "error";
    message?: string;
    devices: Array<{
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
    }>;
  }>;
  acquireScannerPage: (deviceId: string, settings: {
    source: "auto" | "flatbed" | "feeder";
    contentType: "color" | "grayscale" | "text";
    resolutionDpi: 150 | 300 | 600;
    pageSize: "auto" | "a4" | "letter" | "legal" | "4x6" | "5x7" | "8x10";
    placementConfirmed: boolean;
  }) => Promise<{
    status: "acquired" | "cancelled" | "not_ready" | "error";
    code?: string;
    message?: string;
    deviceName?: string;
    source?: "auto" | "flatbed" | "feeder";
    settings?: {
      contentType: "color" | "grayscale" | "text";
      resolutionDpi: 150 | 300 | 600;
      pageSize: "auto" | "a4" | "letter" | "legal" | "4x6" | "5x7" | "8x10";
    };
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
