import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import {
  DEFAULT_HERMES_PORT,
  discoverHermes,
  probeHermesConnection,
  readHermesEnvFile,
} from "./hermes-connection.ts";

const execFileAsync = promisify(execFile);

export interface HermesGatewayRestartResult {
  ok: boolean;
  port: number;
  hermesCli?: string;
  gatewayReachable: boolean;
  message: string;
  error?: string;
}

export function isLocalGatewayControlAllowed(host?: string | null): boolean {
  if (
    process.env.LIFEQUEST_DESKTOP === "1" ||
    process.env.FORGE_DESKTOP === "1"
  ) {
    return true;
  }
  const normalized = (host || "").split(":")[0].toLowerCase();
  return (
    normalized === "127.0.0.1" ||
    normalized === "localhost" ||
    normalized === "::1"
  );
}

export async function resolveHermesCli(): Promise<string> {
  const finder = process.platform === "win32" ? "where" : "which";
  try {
    const { stdout } = await execFileAsync(finder, ["hermes"], {
      windowsHide: true,
    });
    const candidate = stdout
      .trim()
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    if (candidate) return candidate;
  } catch {
    // Fall through to explicit error.
  }

  throw new Error(
    "Hermes CLI not found on PATH. Install Hermes Agent, then ensure `hermes` works in your terminal.",
  );
}

function runHermesGatewayRestart(
  hermesCli: string,
): Promise<{ code: number | null; stderr: string }> {
  const command = process.platform === "win32" ? "hermes" : hermesCli;

  return new Promise((resolve, reject) => {
    const child = spawn(command, ["gateway", "restart"], {
      shell: process.platform === "win32",
      windowsHide: true,
      env: process.env,
    });

    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stderr }));
  });
}

async function waitForGatewayReady(timeoutMs = 45000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { result } = await discoverHermes();
    if (result.ok) return true;
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  return false;
}

export async function restartHermesGateway(): Promise<HermesGatewayRestartResult> {
  const env = (await readHermesEnvFile()) ?? {};
  const port = env.apiServerPort || DEFAULT_HERMES_PORT;

  try {
    const hermesCli = await resolveHermesCli();
    const { code, stderr } = await runHermesGatewayRestart(hermesCli);

    if (code !== 0) {
      return {
        ok: false,
        port,
        hermesCli,
        gatewayReachable: false,
        message: "Hermes gateway restart command failed.",
        error:
          stderr.trim() ||
          `hermes gateway restart exited with code ${code ?? "unknown"}`,
      };
    }

    const gatewayReachable = await waitForGatewayReady();

    if (!gatewayReachable) {
      const baseUrl = `http://127.0.0.1:${port}`;
      const probe = env.apiServerKey
        ? await probeHermesConnection(baseUrl, env.apiServerKey, 4000)
        : null;

      return {
        ok: false,
        port,
        hermesCli,
        gatewayReachable: false,
        message:
          "Gateway restart completed but Hermes is not responding yet. Wait a few seconds and try Connect again.",
        error: probe?.error || "Gateway health check timed out.",
      };
    }

    return {
      ok: true,
      port,
      hermesCli,
      gatewayReachable: true,
      message: "Hermes gateway restarted and is ready.",
    };
  } catch (error) {
    return {
      ok: false,
      port,
      gatewayReachable: false,
      message: "Could not restart the Hermes gateway.",
      error: error instanceof Error ? error.message : "Gateway restart failed",
    };
  }
}
