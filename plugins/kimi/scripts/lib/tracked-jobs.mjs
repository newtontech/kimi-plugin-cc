import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { upsertJob, resolveStateDir } from "./state.mjs";

const LOG_SUFFIX = ".log";

export function runTrackedJob(cwd, options) {
  const stateDir = resolveStateDir(cwd);
  const jobId = options.jobId || `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const logPath = path.join(stateDir, `${jobId}${LOG_SUFFIX}`);

  const job = upsertJob(stateDir, {
    id: jobId,
    status: "running",
    command: options.command || "kimi",
    prompt: options.prompt?.slice(0, 200),
    model: options.model || "default",
    startedAt: new Date().toISOString(),
    logPath,
  });

  const args = [
    "--print",
    "--final-message-only",
  ];

  if (options.model) {
    args.push("--model", options.model);
  }

  args.push("--prompt", options.prompt);

  const child = spawn(options.kimiBin || "kimi", args, {
    cwd,
    env: { ...process.env, ...options.env },
    stdio: ["pipe", "pipe", "pipe"],
  });

  const logStream = fs.createWriteStream(logPath, { flags: "w" });

  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (chunk) => {
    const data = chunk.toString();
    stdout += data;
    logStream.write(data);
  });

  child.stderr.on("data", (chunk) => {
    const data = chunk.toString();
    stderr += data;
    logStream.write(data);
  });

  const promise = new Promise((resolve, reject) => {
    child.on("close", (code) => {
      logStream.end();

      const finalStatus = code === 0 ? "completed" : "failed";
      upsertJob(stateDir, {
        id: jobId,
        status: finalStatus,
        exitCode: code,
        completedAt: new Date().toISOString(),
        outputLength: stdout.length,
        errorLength: stderr.length,
      });

      resolve({
        jobId,
        status: finalStatus,
        exitCode: code,
        stdout,
        stderr,
      });
    });

    child.on("error", (err) => {
      logStream.end();
      upsertJob(stateDir, {
        id: jobId,
        status: "failed",
        error: err.message,
        completedAt: new Date().toISOString(),
      });
      reject(err);
    });
  });

  return { jobId, child, promise, logPath };
}

export function readJobLog(stateDir, jobId) {
  const logPath = path.join(stateDir, `${jobId}${LOG_SUFFIX}`);
  if (!fs.existsSync(logPath)) return null;
  return fs.readFileSync(logPath, "utf8");
}
