import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import path from "node:path";
import readline from "node:readline";
import { app } from "electron";

/**
 * Owns the FastAPI backend's lifecycle for the lifetime of the app, per
 * docs/context/decisions.md: "Electron starts and monitors the local
 * FastAPI process." The renderer never spawns or addresses the backend
 * directly — it only ever receives the resolved base URL + token through
 * the preload bridge, once this has started successfully.
 */

export interface BackendConfig {
  baseUrl: string;
  token: string;
}

const STARTUP_TIMEOUT_MS = 30_000;
const STAGE_SWITCH_TIMEOUT_MS = 120_000;

export const KNOWN_STAGES = ["development", "test", "production"] as const;
export type EnvironmentStage = (typeof KNOWN_STAGES)[number];

export class BackendManager {
  private child: ChildProcessWithoutNullStreams | null = null;
  private config: BackendConfig | null = null;
  private shuttingDown = false;
  private stage: EnvironmentStage | null = null;

  async start(stage?: EnvironmentStage, startupTimeoutMs = STARTUP_TIMEOUT_MS): Promise<BackendConfig> {
    if (app.isPackaged) {
      // Bundling the backend into a signed, platform-specific executable is
      // Phase 7 scope (see docs/context/build-plan.md). This scaffold only
      // runs the backend from source via `uv run`, which is why packaged
      // builds intentionally fail loudly here instead of silently trying
      // (and failing) to find a Python interpreter on the customer machine.
      throw new Error(
        "Packaged-build backend startup is not implemented yet — see docs/context/issues-log.md " +
          "(\"Bundled FastAPI lifecycle and local communication need validation\").",
      );
    }
    return this.startFromSource(stage, startupTimeoutMs);
  }

  /** Stops the current backend (if any) and starts a fresh one bound to a
   *  different `PRINT_MS_STAGE` — the Settings environment switcher's entry
   *  point. Switching stage requires a real process restart: the FastAPI
   *  process resolves its database engine and data paths once at import, so
   *  there is no supported way to rebind them without a new process. */
  async switchStage(stage: EnvironmentStage): Promise<BackendConfig> {
    await this.stop();
    this.shuttingDown = false;
    this.config = null;
    return this.start(stage, STAGE_SWITCH_TIMEOUT_MS);
  }

  getStage(): EnvironmentStage | null {
    return this.stage;
  }

  private startFromSource(stage?: EnvironmentStage, startupTimeoutMs = STARTUP_TIMEOUT_MS): Promise<BackendConfig> {
    const backendDir = path.resolve(__dirname, "..", "..", "..", "services", "api");
    const env = { ...process.env };
    if (stage) env.PRINT_MS_STAGE = stage;
    this.stage = stage ?? (env.PRINT_MS_STAGE as EnvironmentStage | undefined) ?? "development";

    return new Promise((resolve, reject) => {
      const child = spawn("uv", ["run", "python", "-m", "app.main"], {
        cwd: backendDir,
        env,
      });
      this.child = child;

      let settled = false;
      let timeout: ReturnType<typeof setTimeout>;
      const rejectStartup = (error: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (this.child === child) {
          child.kill("SIGTERM");
          this.child = null;
        }
        reject(error);
      };
      timeout = setTimeout(() => {
        rejectStartup(new Error(`Backend did not report readiness within ${Math.round(startupTimeoutMs / 1000)} seconds.`));
      }, startupTimeoutMs);

      let port: number | null = null;
      let token: string | null = null;

      const stdoutLines = readline.createInterface({ input: child.stdout });
      stdoutLines.on("line", (line) => {
        const portMatch = line.match(/^PRINT_MS_PORT=(\d+)/);
        const tokenMatch = line.match(/^PRINT_MS_TOKEN=(\S+)/);
        if (portMatch) port = Number(portMatch[1]);
        if (tokenMatch) token = tokenMatch[1];

        if (port !== null && token !== null && !this.config && !settled) {
          settled = true;
          clearTimeout(timeout);
          this.config = { baseUrl: `http://127.0.0.1:${port}`, token };
          resolve(this.config);
        }
        console.log(`[backend] ${line}`);
      });

      child.stderr.on("data", (chunk: Buffer) => {
        console.error(`[backend:stderr] ${chunk.toString().trimEnd()}`);
      });

      child.on("exit", (code, signal) => {
        clearTimeout(timeout);
        if (!settled && !this.shuttingDown) {
          rejectStartup(new Error(`Backend exited before it became ready (code=${code}, signal=${signal}).`));
        }
        if (!this.shuttingDown) {
          console.error(`[backend] exited unexpectedly (code=${code}, signal=${signal}).`);
        }
        this.child = null;
      });

      child.on("error", (err) => {
        rejectStartup(err);
      });
    });
  }

  getConfig(): BackendConfig {
    if (!this.config) throw new Error("Backend has not started yet.");
    return this.config;
  }

  async stop(): Promise<void> {
    if (!this.child) return;
    this.shuttingDown = true;
    this.child.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.child?.kill("SIGKILL");
        resolve();
      }, 3000);
      this.child?.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}
