import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { removeFileIfExists } from "./fs.mjs";
import { resolveWorkspaceRoot } from "./workspace.mjs";

const STATE_VERSION = 1;
const PLUGIN_DATA_ENV = "CLAUDE_PLUGIN_DATA";
const FALLBACK_STATE_ROOT_DIR = path.join(os.tmpdir(), "kimi-companion");
const STATE_FILE_NAME = "state.json";
const JOBS_DIR_NAME = "jobs";
const LOGS_DIR_NAME = "logs";
const MAX_JOBS = 50;

function nowIso() {
  return new Date().toISOString();
}

function defaultState() {
  return {
    version: STATE_VERSION,
    config: { stopReviewGate: false },
    jobs: [],
  };
}

function resolveStateRoot() {
  const pluginDataDir = process.env[PLUGIN_DATA_ENV] || process.env.KIMI_PLUGIN_DATA_DIR;
  return pluginDataDir ? path.join(pluginDataDir, "state") : FALLBACK_STATE_ROOT_DIR;
}

export function resolveStateDir(cwd) {
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  let canonical = workspaceRoot;
  try {
    canonical = fs.realpathSync.native(workspaceRoot);
  } catch {
    canonical = workspaceRoot;
  }

  const slug = path.basename(workspaceRoot).replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "workspace";
  const hash = createHash("sha256").update(canonical).digest("hex").slice(0, 16);
  const stateDir = path.join(resolveStateRoot(), `${slug}-${hash}`);

  ensureStateDir(stateDir);
  return stateDir;
}

export function resolveStateFile(stateDir) {
  return path.join(stateDir, STATE_FILE_NAME);
}

export function resolveJobsDir(stateDir) {
  return path.join(stateDir, JOBS_DIR_NAME);
}

export function resolveJobFile(stateDir, jobId) {
  return path.join(resolveJobsDir(stateDir), `${jobId}.json`);
}

export function resolveJobLogFile(stateDir, jobId) {
  return path.join(stateDir, LOGS_DIR_NAME, `${jobId}.log`);
}

export function ensureStateDir(stateDir) {
  fs.mkdirSync(resolveJobsDir(stateDir), { recursive: true });
}

export function loadState(stateDir) {
  const stateFile = resolveStateFile(stateDir);
  if (!fs.existsSync(stateFile)) {
    return defaultState();
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    return {
      ...defaultState(),
      ...parsed,
      config: { ...defaultState().config, ...(parsed.config ?? {}) },
      jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [],
    };
  } catch {
    return defaultState();
  }
}

export function saveState(stateDir, state) {
  const previousState = loadState(stateDir);
  const previousJobs = previousState.jobs;
  ensureStateDir(stateDir);

  const nextJobs = pruneJobs(state.jobs ?? []);
  const nextState = {
    version: STATE_VERSION,
    config: { ...defaultState().config, ...(state.config ?? {}) },
    jobs: nextJobs,
  };

  const retainedIds = new Set(nextJobs.map((j) => j.id));
  for (const job of previousJobs) {
    if (retainedIds.has(job.id)) continue;
    removeFileIfExists(resolveJobFile(stateDir, job.id));
    removeFileIfExists(job.logFile);
  }

  fs.writeFileSync(resolveStateFile(stateDir), `${JSON.stringify(nextState, null, 2)}\n`, "utf8");
  return nextState;
}

export function updateState(stateDir, mutator) {
  const state = loadState(stateDir);
  mutator(state);
  return saveState(stateDir, state);
}

function pruneJobs(jobs) {
  return [...jobs]
    .sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")))
    .slice(0, MAX_JOBS);
}

export function generateJobId(prefix = "job") {
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}

export function upsertJob(stateDir, jobPatch) {
  const now = nowIso();
  return updateState(stateDir, (state) => {
    const idx = state.jobs.findIndex((j) => j.id === jobPatch.id);
    if (idx === -1) {
      state.jobs.unshift({ createdAt: now, updatedAt: now, ...jobPatch });
    } else {
      state.jobs[idx] = { ...state.jobs[idx], ...jobPatch, updatedAt: now };
    }
  });
}

export function listJobs(stateDir) {
  return loadState(stateDir).jobs;
}

export function getJob(stateDir, jobId) {
  return loadState(stateDir).jobs.find((j) => j.id === jobId) || null;
}

export function getLatestJob(stateDir) {
  return loadState(stateDir).jobs[0] || null;
}

export function removeJob(stateDir, jobId) {
  const jobs = loadState(stateDir).jobs;
  const filtered = jobs.filter((j) => j.id !== jobId);
  if (filtered.length === jobs.length) return false;
  saveState(stateDir, { ...loadState(stateDir), jobs: filtered });
  removeFileIfExists(resolveJobFile(stateDir, jobId));
  return true;
}

export function getConfig(stateDir) {
  return loadState(stateDir).config;
}

export function setConfig(stateDir, key, value) {
  return updateState(stateDir, (state) => {
    state.config = { ...state.config, [key]: value };
  });
}

export function writeJobFile(stateDir, jobId, payload) {
  ensureStateDir(stateDir);
  const jobFile = resolveJobFile(stateDir, jobId);
  fs.writeFileSync(jobFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return jobFile;
}

export function readJobFile(jobFile) {
  try {
    return JSON.parse(fs.readFileSync(jobFile, "utf8"));
  } catch {
    return null;
  }
}

export function readStoredJob(stateDir, jobId) {
  const jobFile = resolveJobFile(stateDir, jobId);
  if (!fs.existsSync(jobFile)) return null;
  return readJobFile(jobFile);
}
