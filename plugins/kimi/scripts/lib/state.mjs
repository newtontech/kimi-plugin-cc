import path from "node:path";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { resolveWorkspaceRoot } from "./git.mjs";

const MAX_JOBS = 50;

const FALLBACK_STATE_ROOT_DIR = path.join(
  process.env.HOME || "/tmp",
  ".kimi-plugin-cc",
  "state"
);

const pluginDataDir = process.env.KIMI_PLUGIN_DATA_DIR || null;

export function resolveStateDir(cwd) {
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const slug = path.basename(workspaceRoot).replace(/[^a-zA-Z0-9._-]+/g, "-");
  const hash = createHash("sha256")
    .update(workspaceRoot)
    .digest("hex")
    .slice(0, 16);

  const stateRoot = pluginDataDir
    ? path.join(pluginDataDir, "state")
    : FALLBACK_STATE_ROOT_DIR;

  const stateDir = path.join(stateRoot, `${slug}-${hash}`);

  if (!fs.existsSync(stateDir)) {
    fs.mkdirSync(stateDir, { recursive: true });
  }

  return stateDir;
}

function jobsFilePath(stateDir) {
  return path.join(stateDir, "jobs.json");
}

function configFilePath(stateDir) {
  return path.join(stateDir, "config.json");
}

function loadJobs(stateDir) {
  const fp = jobsFilePath(stateDir);
  if (!fs.existsSync(fp)) return [];
  try {
    return JSON.parse(fs.readFileSync(fp, "utf8"));
  } catch {
    return [];
  }
}

function saveJobs(stateDir, jobs) {
  const trimmed = jobs.slice(0, MAX_JOBS);
  fs.writeFileSync(jobsFilePath(stateDir), JSON.stringify(trimmed, null, 2), "utf8");
}

export function upsertJob(stateDir, job) {
  const jobs = loadJobs(stateDir);
  const now = new Date().toISOString();
  const id = job.id || `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const idx = jobs.findIndex((j) => j.id === id);
  const entry = {
    ...job,
    id,
    updatedAt: now,
    createdAt: job.createdAt || now,
  };

  if (idx >= 0) {
    jobs[idx] = { ...jobs[idx], ...entry };
  } else {
    jobs.unshift(entry);
  }

  saveJobs(stateDir, jobs);
  return entry;
}

export function listJobs(stateDir, filter) {
  const jobs = loadJobs(stateDir);
  if (!filter) return jobs;
  return jobs.filter((j) => {
    if (filter.status && j.status !== filter.status) return false;
    return true;
  });
}

export function getJob(stateDir, jobId) {
  const jobs = loadJobs(stateDir);
  return jobs.find((j) => j.id === jobId) || null;
}

export function getLatestJob(stateDir) {
  const jobs = loadJobs(stateDir);
  return jobs[0] || null;
}

export function removeJob(stateDir, jobId) {
  const jobs = loadJobs(stateDir);
  const filtered = jobs.filter((j) => j.id !== jobId);
  saveJobs(stateDir, filtered);
  return filtered.length < jobs.length;
}

export function getConfig(stateDir) {
  const fp = configFilePath(stateDir);
  if (!fs.existsSync(fp)) return { stopReviewGate: false };
  try {
    return JSON.parse(fs.readFileSync(fp, "utf8"));
  } catch {
    return { stopReviewGate: false };
  }
}

export function setConfig(stateDir, updates) {
  const current = getConfig(stateDir);
  const merged = { ...current, ...updates };
  fs.writeFileSync(configFilePath(stateDir), JSON.stringify(merged, null, 2), "utf8");
  return merged;
}
