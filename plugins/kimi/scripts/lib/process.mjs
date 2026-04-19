import { spawnSync } from "node:child_process";
import process from "node:process";

export function runCommand(command, args = [], options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    input: options.input,
    maxBuffer: options.maxBuffer,
    timeout: options.timeout ?? 30_000,
    stdio: options.stdio ?? "pipe",
    shell: false,
    windowsHide: true,
  });

  return {
    command,
    args,
    status: result.status ?? 0,
    signal: result.signal ?? null,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error ?? null,
  };
}

export function runCommandChecked(command, args = [], options = {}) {
  const result = runCommand(command, args, options);
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(formatCommandFailure(result));
  }
  return result;
}

export function binaryAvailable(command, versionArgs = ["--version"], options = {}) {
  const result = runCommand(command, versionArgs, options);
  if (result.error && result.error.code === "ENOENT") {
    return { available: false, detail: "not found", path: null };
  }
  if (result.error) {
    return { available: false, detail: result.error.message, path: null };
  }
  if (result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit ${result.status}`;
    return { available: false, detail, path: null };
  }
  const whichResult = spawnSync(process.platform === "win32" ? "where" : "which", [command], {
    encoding: "utf8",
    timeout: 5_000,
  });
  const resolvedPath = whichResult.stdout?.trim() || command;
  return { available: true, detail: result.stdout.trim() || result.stderr.trim() || "ok", path: resolvedPath };
}

export function terminateProcessTree(pid, options = {}) {
  if (!Number.isFinite(pid) || pid <= 0) {
    return { attempted: false, delivered: false, method: null };
  }

  const platform = options.platform ?? process.platform;
  const killImpl = options.killImpl ?? process.kill.bind(process);

  if (platform === "win32") {
    const runImpl = options.runCommandImpl ?? runCommand;
    const result = runImpl("taskkill", ["/PID", String(pid), "/T", "/F"], {
      cwd: options.cwd,
      env: options.env,
    });
    if (!result.error && result.status === 0) {
      return { attempted: true, delivered: true, method: "taskkill" };
    }
    try {
      killImpl(pid);
      return { attempted: true, delivered: true, method: "kill" };
    } catch (error) {
      if (error?.code === "ESRCH") {
        return { attempted: true, delivered: false, method: "kill" };
      }
      throw error;
    }
  }

  try {
    killImpl(-pid, "SIGTERM");
    return { attempted: true, delivered: true, method: "process-group" };
  } catch (error) {
    if (error?.code !== "ESRCH") {
      try {
        killImpl(pid, "SIGTERM");
        return { attempted: true, delivered: true, method: "process" };
      } catch (innerError) {
        if (innerError?.code === "ESRCH") {
          return { attempted: true, delivered: false, method: "process" };
        }
        throw innerError;
      }
    }
    return { attempted: true, delivered: false, method: "process-group" };
  }
}

export function formatCommandFailure(result) {
  const parts = [`${result.command} ${result.args.join(" ")}`.trim()];
  if (result.signal) {
    parts.push(`signal=${result.signal}`);
  } else {
    parts.push(`exit=${result.status}`);
  }
  const stderr = (result.stderr || "").trim();
  const stdout = (result.stdout || "").trim();
  if (stderr) {
    parts.push(stderr);
  } else if (stdout) {
    parts.push(stdout);
  }
  return parts.join(": ");
}
