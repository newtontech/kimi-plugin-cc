import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { upsertJob, resolveStateDir, resolveJobLogFile, writeJobFile, readStoredJob } from "./state.mjs";

export const SESSION_ID_ENV = "KIMI_COMPANION_SESSION_ID";

export function nowIso() {
  return new Date().toISOString();
}

export function appendLogLine(logFile, message) {
  const normalized = String(message ?? "").trim();
  if (!logFile || !normalized) return;
  try {
    fs.appendFileSync(logFile, `[${nowIso()}] ${normalized}\n`, "utf8");
  } catch {
    // Disk full or permission error — don't crash the job
  }
}

export function createJobLogFile(stateDir, jobId, title) {
  const logFile = resolveJobLogFile(stateDir, jobId);
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.writeFileSync(logFile, "", "utf8");
  if (title) appendLogLine(logFile, `Starting ${title}.`);
  return logFile;
}

export function createJobRecord(base, options = {}) {
  const env = options.env ?? process.env;
  const sessionId = env[SESSION_ID_ENV];
  return {
    ...base,
    createdAt: nowIso(),
    ...(sessionId ? { sessionId } : {}),
  };
}

export function runTrackedJob(cwd, options) {
  const stateDir = resolveStateDir(cwd);
  const jobId = options.jobId || `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const logFile = createJobLogFile(stateDir, jobId, options.title);

  const runningRecord = {
    id: jobId,
    status: "running",
    command: options.command || "kimi",
    model: options.model || "default",
    startedAt: nowIso(),
    logFile,
    pid: null,
    prompt: options.prompt?.slice(0, 200),
  };

  upsertJob(stateDir, runningRecord);

  const args = ["--print", "--final-message-only"];
  if (options.model) args.push("--model", options.model);
  args.push("--prompt", options.prompt);

  const child = spawn(options.kimiBin || "kimi", args, {
    cwd,
    env: { ...process.env, ...options.env },
    stdio: ["pipe", "pipe", "pipe"],
  });

  // Update PID in job record
  if (child.pid) {
    upsertJob(stateDir, { id: jobId, pid: child.pid });
    writeJobFile(stateDir, jobId, { ...runningRecord, pid: child.pid });
  }

  const logStream = fs.createWriteStream(logFile, { flags: "a" });
  logStream.on("error", () => {
    // Disk full or deleted — don't crash
  });

  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (chunk) => {
    const data = chunk.toString();
    stdout += data;
    try { logStream.write(data); } catch { /* ignore */ }
  });

  child.stderr.on("data", (chunk) => {
    const data = chunk.toString();
    stderr += data;
    try { logStream.write(data); } catch { /* ignore */ }
  });

  const promise = new Promise((resolve, reject) => {
    child.on("close", (code) => {
      try { logStream.end(); } catch { /* ignore */ }

      const finalStatus = code === 0 ? "completed" : "failed";
      const completedAt = nowIso();

      upsertJob(stateDir, {
        id: jobId,
        status: finalStatus,
        exitCode: code,
        pid: null,
        completedAt,
        outputLength: stdout.length,
      });

      writeJobFile(stateDir, jobId, {
        ...(readStoredJob(stateDir, jobId) || {}),
        ...runningRecord,
        pid: child.pid,
        status: finalStatus,
        exitCode: code,
        completedAt,
        stdout,
        stderr,
      });

      resolve({ jobId, status: finalStatus, exitCode: code, stdout, stderr });
    });

    child.on("error", (err) => {
      try { logStream.end(); } catch { /* ignore */ }
      upsertJob(stateDir, {
        id: jobId,
        status: "failed",
        pid: null,
        error: err.message,
        completedAt: nowIso(),
      });
      reject(err);
    });
  });

  return { jobId, child, promise, logFile };
}

export function readJobLog(stateDir, jobId) {
  const logFile = resolveJobLogFile(stateDir, jobId);
  if (!fs.existsSync(logFile)) return null;
  return fs.readFileSync(logFile, "utf8");
}
