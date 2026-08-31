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

const STARTUP_TIMEOUT_MS = 15_000;

export const KNOWN_STAGES = ["development", "test", "production"] as const;
export type EnvironmentStage = (typeof KNOWN_STAGES)[number];

export class BackendManager {
  private child: ChildProcessWithoutNullStreams | null = null;
  private config: BackendConfig | null = null;
  private shuttingDown = false;
  private stage: EnvironmentStage | null = null;

  async start(stage?: EnvironmentStage): Promise<BackendConfig> {
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
    return this.startFromSource(stage);
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
    return this.start(stage);
  }

  getStage(): EnvironmentStage | null {
    return this.stage;
  }

  private startFromSource(stage?: EnvironmentStage): Promise<BackendConfig> {
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

      const timeout = setTimeout(() => {
        reject(new Error(`Backend did not report readiness within ${STARTUP_TIMEOUT_MS}ms.`));
      }, STARTUP_TIMEOUT_MS);

      let port: number | null = null;
      let token: string | null = null;

      const stdoutLines = readline.createInterface({ input: child.stdout });
      stdoutLines.on("line", (line) => {
        const portMatch = line.match(/^PRINT_MS_PORT=(\d+)/);
        const tokenMatch = line.match(/^PRINT_MS_TOKEN=(\S+)/);
        if (portMatch) port = Number(portMatch[1]);
        if (tokenMatch) token = tokenMatch[1];

        if (port !== null && token !== null && !this.config) {
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
        if (!this.shuttingDown) {
          console.error(`[backend] exited unexpectedly (code=${code}, signal=${signal}).`);
        }
        this.child = null;
      });

      child.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
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
