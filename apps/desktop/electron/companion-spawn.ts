import type { SpawnOptions } from "node:child_process";

export type HermesSpawnSpec = {
  file: string;
  args: string[];
  shell: boolean;
  options: SpawnOptions;
};

/**
 * Windows cannot spawn .cmd/.bat (npm/uv shims) without a shell.
 * Node throws `spawn EINVAL` if we pass windowsHide without shell for those.
 */
export function hermesSpawnSpec(
  platform: NodeJS.Platform,
  cli: string,
  args: string[],
  extraEnv: Record<string, string> = {},
): HermesSpawnSpec {
  const win = platform === "win32";
  const isExe = /\.exe$/i.test(cli);
  const shell = win && !isExe;
  return {
    file: cli,
    args,
    shell,
    options: {
      shell,
      windowsHide: win,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...extraEnv },
    },
  };
}
