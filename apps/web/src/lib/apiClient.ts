import type { PaperClubApiConfig } from "../vite-env";

/**
 * Thin fetch wrapper for the local FastAPI backend.
 *
 * Per docs/context/decisions.md, FastAPI binds to loopback only and the
 * renderer never talks to it with a hardcoded address: Electron's main
 * process resolves the actual port + per-launch token and hands them to the
 * renderer once via the `paperClub` preload bridge. When the renderer runs
 * outside Electron (plain `vite dev`, for quick UI iteration), we fall back
 * to a documented dev default so the app shell still renders.
 */

let configPromise: Promise<PaperClubApiConfig> | null = null;

function resolveConfig(): Promise<PaperClubApiConfig> {
  if (!configPromise) {
    configPromise = (
      window.paperClub
        ? window.paperClub.getApiConfig()
        : Promise.resolve({
            baseUrl: import.meta.env.VITE_DEV_API_BASE_URL ?? "http://127.0.0.1:8420",
            token: import.meta.env.VITE_DEV_API_TOKEN ?? "",
          })
    ).catch((err) => {
      // Don't memoize a failed startup forever — if the backend was still
      // launching (or crashed and hasn't been retried), the next call
      // should ask the main process again rather than replaying the same
      // rejection until the app is restarted.
      configPromise = null;
      throw err;
    });
  }
  return configPromise;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const { baseUrl, token } = await resolveConfig();
  const headers = new Headers(init?.headers);
  headers.set("X-Print-MS-Token", token);
  if (!(init?.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers,
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      message = body?.detail ?? message;
    } catch {
      // response had no JSON body — keep statusText
    }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PUT", body: body ? JSON.stringify(body) : undefined }),
  upload: <T>(path: string, body: FormData) =>
    request<T>(path, { method: "POST", body }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
