import { ChildProcessWithoutNullStreams, execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
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

interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export type BackendDiagnosticLogger = (
  level: "INFO" | "WARN" | "ERROR",
  event: string,
  details?: Record<string, unknown>,
) => void;

const STARTUP_TIMEOUT_MS = 30_000;
const STAGE_SWITCH_TIMEOUT_MS = 120_000;
const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 3_000;
const FORCED_SHUTDOWN_TIMEOUT_MS = 2_000;
const DEPENDENCY_REPAIR_TIMEOUT_MS = 120_000;
const BACKEND_IMPORT_CHECK = [
  // Check the compiled PDF binding first so its broad internal fallback does
  // not hide the package that needs a targeted wheel reinstall.
  "import pymupdf",
  "import alembic",
  "import fastapi",
  "import openpyxl",
  "import PIL",
  "import pydantic",
  "import pypdf",
  "import sqlalchemy",
  "import uvicorn",
  "import docx",
  "import pptx",
].join("; ");

export const KNOWN_STAGES = ["development", "test", "production"] as const;
export type EnvironmentStage = (typeof KNOWN_STAGES)[number];

export class BackendManager {
  private child: ChildProcessWithoutNullStreams | null = null;
  private config: BackendConfig | null = null;
  private shuttingDown = false;
  private stage: EnvironmentStage | null = null;

  constructor(private readonly diagnosticLogger?: BackendDiagnosticLogger) {}

  private record(
    level: "INFO" | "WARN" | "ERROR",
    event: string,
    details?: Record<string, unknown>,
  ): void {
    this.diagnosticLogger?.(level, event, details);
  }

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

  private async startFromSource(
    stage?: EnvironmentStage,
    startupTimeoutMs = STARTUP_TIMEOUT_MS,
  ): Promise<BackendConfig> {
    const backendDir = path.resolve(__dirname, "..", "..", "..", "services", "api");
    const env = { ...process.env };
    if (stage) env.PRINT_MS_STAGE = stage;
    env.PYTHONUNBUFFERED = "1";
    this.stage = stage ?? (env.PRINT_MS_STAGE as EnvironmentStage | undefined) ?? "development";
    const virtualEnvironmentPython = path.join(
      backendDir,
      ".venv",
      process.platform === "win32" ? "Scripts" : "bin",
      process.platform === "win32" ? "python.exe" : "python",
    );
    const useDirectVirtualEnvironment = process.platform === "win32" && existsSync(virtualEnvironmentPython);
    const command = useDirectVirtualEnvironment ? virtualEnvironmentPython : "uv";
    const args = useDirectVirtualEnvironment ? ["-m", "app.main"] : ["run", "python", "-m", "app.main"];
    const startedAt = Date.now();
    this.record("INFO", "backend.start", {
      stage: this.stage,
      launcher: command === "uv" ? "uv" : "project-venv",
      timeoutMs: startupTimeoutMs,
    });
    console.log(`[backend] starting ${this.stage} with ${command === "uv" ? "uv fallback" : "the project virtual environment"}.`);

    if (useDirectVirtualEnvironment) {
      await this.ensureSourceDependencies(backendDir, virtualEnvironmentPython, env);
    }

    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: backendDir,
        env,
        windowsHide: true,
      });
      this.child = child;
      this.record("INFO", "backend.process.spawned", { pid: child.pid, stage: this.stage });

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
        this.record("ERROR", "backend.start.timeout", {
          stage: this.stage,
          elapsedMs: Date.now() - startedAt,
        });
        rejectStartup(new Error(`Backend did not report readiness within ${Math.round(startupTimeoutMs / 1000)} seconds.`));
      }, startupTimeoutMs);

      let port: number | null = null;
      let token: string | null = null;
      let recentStderr = "";

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
          this.record("INFO", "backend.ready", {
            stage: this.stage,
            pid: child.pid,
            elapsedMs: Date.now() - startedAt,
          });
          console.log(`[backend] ready in ${Date.now() - startedAt}ms.`);
          resolve(this.config);
        }
        console.log(`[backend] ${line}`);
      });

      child.stderr.on("data", (chunk: Buffer) => {
        const output = chunk.toString();
        recentStderr = `${recentStderr}${output}`.slice(-16_000);
        console.error(`[backend:stderr] ${output.trimEnd()}`);
      });

      child.on("exit", (code, signal) => {
        clearTimeout(timeout);
        this.record(this.shuttingDown ? "INFO" : "ERROR", "backend.process.exit", {
          stage: this.stage,
          pid: child.pid,
          code,
          signal,
          ready: settled,
          uptimeMs: Date.now() - startedAt,
          stderrTail: this.shuttingDown ? undefined : recentStderr.trim().slice(-8_000),
        });
        if (!settled && !this.shuttingDown) {
          rejectStartup(new Error(`Backend exited before it became ready (code=${code}, signal=${signal}).`));
        }
        if (!this.shuttingDown) {
          console.error(`[backend] exited unexpectedly (code=${code}, signal=${signal}).`);
        }
        if (this.child === child) {
          this.child = null;
          this.config = null;
        }
      });

      child.on("error", (err) => {
        this.record("ERROR", "backend.process.error", { message: err.message });
        rejectStartup(err);
      });
    });
  }

  getConfig(): BackendConfig {
    if (!this.config) throw new Error("Backend has not started yet.");
    return this.config;
  }

  isReady(): boolean {
    return this.child !== null && this.child.exitCode === null && this.config !== null;
  }

  async stop(): Promise<void> {
    const child = this.child;
    if (!child) return;
    this.shuttingDown = true;

    if (child.exitCode === null && child.signalCode === null) {
      if (process.platform === "win32" && child.pid) {
        // Node emulates POSIX signals on Windows by terminating only the
        // immediate process. Kill the owned tree instead so the backend's
        // PowerShell spooler observer cannot survive Electron.
        await this.terminateWindowsProcessTree(child);
        await this.waitForExit(child, FORCED_SHUTDOWN_TIMEOUT_MS);
      } else {
        child.kill("SIGTERM");
        const exitedGracefully = await this.waitForExit(child, GRACEFUL_SHUTDOWN_TIMEOUT_MS);
        if (!exitedGracefully) {
          child.kill("SIGKILL");
          await this.waitForExit(child, FORCED_SHUTDOWN_TIMEOUT_MS);
        }
      }
    }

    if (this.child === child) {
      this.child = null;
      this.config = null;
    }
  }

  private waitForExit(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<boolean> {
    if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);

    return new Promise((resolve) => {
      const onExit = () => {
        clearTimeout(timer);
        resolve(true);
      };
      const timer = setTimeout(() => {
        child.off("exit", onExit);
        resolve(false);
      }, timeoutMs);
      child.once("exit", onExit);
    });
  }

  private terminateWindowsProcessTree(child: ChildProcessWithoutNullStreams): Promise<void> {
    return new Promise((resolve) => {
      execFile(
        "taskkill.exe",
        ["/PID", String(child.pid), "/T", "/F"],
        { windowsHide: true },
        (error) => {
          if (error && child.exitCode === null && child.signalCode === null) {
            console.error(`[backend] failed to terminate process tree ${child.pid}:`, error);
          }
          resolve();
        },
      );
    });
  }

  private async ensureSourceDependencies(
    backendDir: string,
    python: string,
    env: NodeJS.ProcessEnv,
  ): Promise<void> {
    const checkedAt = Date.now();
    this.record("INFO", "backend.dependencies.check.begin", { stage: this.stage });
    const check = await this.runCommand(python, ["-c", BACKEND_IMPORT_CHECK], backendDir, env, 20_000);
    if (check.code === 0) {
      this.record("INFO", "backend.dependencies.check.complete", { elapsedMs: Date.now() - checkedAt });
      console.log(`[backend] dependency preflight passed in ${Date.now() - checkedAt}ms.`);
      return;
    }

    const diagnostic = `${check.stderr}\n${check.stdout}`.trim();
    const pymupdfFailure = /pymupdf|mupdf|_extra|_mupdf/i.test(diagnostic);
    this.record("WARN", "backend.dependencies.check.failed", {
      elapsedMs: Date.now() - checkedAt,
      pymupdfFailure,
      diagnostic: diagnostic.slice(-4000),
    });
    console.warn(
      `[backend] dependency preflight failed; repairing the locked environment.${
        pymupdfFailure ? " PyMuPDF will be reinstalled." : ""
      }`,
    );

    const syncArgs = ["sync", "--locked"];
    if (pymupdfFailure) {
      syncArgs.push("--reinstall-package", "pymupdf");
    } else {
      syncArgs.push("--reinstall");
    }
    const repairStartedAt = Date.now();
    this.record("WARN", "backend.dependencies.repair.begin", { pymupdfFailure });
    const repair = await this.runCommand("uv", syncArgs, backendDir, env, DEPENDENCY_REPAIR_TIMEOUT_MS);
    if (repair.code !== 0) {
      this.record("ERROR", "backend.dependencies.repair.failed", {
        elapsedMs: Date.now() - repairStartedAt,
        diagnostic: this.lastDiagnostic(repair),
      });
      throw new Error(
        `Backend dependency repair failed. Run "uv sync --locked${
          pymupdfFailure ? " --reinstall-package pymupdf" : ""
        }" in services\\api. ${this.lastDiagnostic(repair)}`,
      );
    }

    const repairedCheck = await this.runCommand(python, ["-c", BACKEND_IMPORT_CHECK], backendDir, env, 20_000);
    if (repairedCheck.code !== 0) {
      this.record("ERROR", "backend.dependencies.verify.failed", {
        diagnostic: this.lastDiagnostic(repairedCheck),
      });
      const guidance = pymupdfFailure
        ? " PyMuPDF still cannot load; install or repair the Microsoft Visual C++ x64 Redistributable, then retry."
        : "";
      throw new Error(`Backend dependency validation still fails after repair.${guidance} ${this.lastDiagnostic(repairedCheck)}`);
    }
    this.record("INFO", "backend.dependencies.repair.complete", {
      elapsedMs: Date.now() - repairStartedAt,
      totalElapsedMs: Date.now() - checkedAt,
    });
    console.log(`[backend] dependency repair completed in ${Date.now() - checkedAt}ms.`);
  }

  private runCommand(
    command: string,
    args: string[],
    cwd: string,
    env: NodeJS.ProcessEnv,
    timeoutMs: number,
  ): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { cwd, env, windowsHide: true });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error(`${command} did not finish within ${Math.round(timeoutMs / 1000)} seconds.`));
      }, timeoutMs);

      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once("close", (code) => {
        clearTimeout(timer);
        resolve({ code, stdout, stderr });
      });
    });
  }

  private lastDiagnostic(result: CommandResult): string {
    const lines = `${result.stderr}\n${result.stdout}`
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    return lines.slice(-4).join(" ") || `Process exited with code ${result.code}.`;
  }
}
