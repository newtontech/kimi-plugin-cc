import { spawnSync } from "node:child_process";

export function resolveWorkspaceRoot(cwd) {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    encoding: "utf8",
    timeout: 5000,
  });
  if (result.status !== 0) return cwd;
  return result.stdout.trim();
}
