import fs from "node:fs";
import { listJobs, getConfig, readStoredJob, resolveJobLogFile, resolveStateDir } from "./state.mjs";
import { SESSION_ID_ENV } from "./tracked-jobs.mjs";
import { formatElapsed } from "./render.mjs";

const DEFAULT_MAX_STATUS_JOBS = 8;
const DEFAULT_MAX_PROGRESS_LINES = 4;

export function sortJobsNewestFirst(jobs) {
  return [...jobs].sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")));
}

function getCurrentSessionId(options = {}) {
  return options.env?.[SESSION_ID_ENV] ?? process.env[SESSION_ID_ENV] ?? null;
}

export function filterJobsForCurrentSession(jobs, options = {}) {
  const sessionId = getCurrentSessionId(options);
  if (!sessionId) return jobs;
  return jobs.filter((j) => j.sessionId === sessionId);
}

function getJobTypeLabel(job) {
  if (typeof job.kindLabel === "string" && job.kindLabel) return job.kindLabel;
  if (job.kind === "adversarial-review") return "adversarial-review";
  if (job.type === "review") return "review";
  if (job.type === "task") return "rescue";
  return job.type || "job";
}

export function readJobProgressPreview(logFile, maxLines = DEFAULT_MAX_PROGRESS_LINES) {
  if (!logFile || !fs.existsSync(logFile)) return [];
  const lines = fs.readFileSync(logFile, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter(Boolean)
    .map((l) => l.startsWith("[") ? l.replace(/^\[[^\]]+\]\s*/, "").trim() : l.trim())
    .filter(Boolean);
  return lines.slice(-maxLines);
}

export function enrichJob(job, options = {}) {
  const maxProgressLines = options.maxProgressLines ?? DEFAULT_MAX_PROGRESS_LINES;
  return {
    ...job,
    kindLabel: getJobTypeLabel(job),
    progressPreview:
      job.status === "queued" || job.status === "running" || job.status === "failed"
        ? readJobProgressPreview(job.logFile, maxProgressLines)
        : [],
    elapsed: formatElapsed(job.startedAt ?? job.createdAt, job.completedAt ?? null),
    duration:
      job.status === "completed" || job.status === "failed" || job.status === "cancelled"
        ? formatElapsed(job.startedAt ?? job.createdAt, job.completedAt ?? job.updatedAt)
        : null,
  };
}

function matchJobReference(jobs, reference, predicate = () => true) {
  const filtered = jobs.filter(predicate);
  if (!reference) return filtered[0] ?? null;

  const exact = filtered.find((j) => j.id === reference);
  if (exact) return exact;

  const prefixMatches = filtered.filter((j) => j.id.startsWith(reference));
  if (prefixMatches.length === 1) return prefixMatches[0];
  if (prefixMatches.length > 1) {
    throw new Error(`Job reference "${reference}" is ambiguous. Use a longer job id.`);
  }

  throw new Error(`No job found for "${reference}". Run /kimi:status to list jobs.`);
}

export function buildStatusSnapshot(cwd, options = {}) {
  const stateDir = resolveStateDirFromCwd(cwd);
  const config = getConfig(stateDir);
  const jobs = sortJobsNewestFirst(filterJobsForCurrentSession(listJobs(stateDir), options));
  const maxJobs = options.maxJobs ?? DEFAULT_MAX_STATUS_JOBS;

  const running = jobs
    .filter((j) => j.status === "queued" || j.status === "running")
    .map((j) => enrichJob(j));

  const latestFinishedRaw = jobs.find((j) => j.status !== "queued" && j.status !== "running") ?? null;
  const latestFinished = latestFinishedRaw ? enrichJob(latestFinishedRaw) : null;

  const recent = (options.all ? jobs : jobs.slice(0, maxJobs))
    .filter((j) => j.status !== "queued" && j.status !== "running" && j.id !== latestFinished?.id)
    .map((j) => enrichJob(j));

  return { config, running, latestFinished, recent, needsReview: Boolean(config.stopReviewGate) };
}

export function buildSingleJobSnapshot(cwd, reference) {
  const stateDir = resolveStateDirFromCwd(cwd);
  const jobs = sortJobsNewestFirst(listJobs(stateDir));
  const selected = matchJobReference(jobs, reference);
  if (!selected) throw new Error(`No job found for "${reference}".`);
  return { job: enrichJob(selected) };
}

export function resolveResultJob(cwd, reference = "") {
  const stateDir = resolveStateDirFromCwd(cwd);
  const jobs = sortJobsNewestFirst(listJobs(stateDir));
  const selected = matchJobReference(
    jobs,
    reference,
    (j) => j.status === "completed" || j.status === "failed" || j.status === "cancelled"
  );
  if (selected) return { stateDir, job: selected };

  const active = matchJobReference(jobs, reference, (j) => j.status === "queued" || j.status === "running");
  if (active) {
    throw new Error(`Job ${active.id} is still ${active.status}. Check /kimi:status.`);
  }

  throw new Error(reference
    ? `No finished job found for "${reference}".`
    : "No finished Kimi jobs found for this project.");
}

export function resolveCancelableJob(cwd, reference = "", options = {}) {
  const stateDir = resolveStateDirFromCwd(cwd);
  const jobs = sortJobsNewestFirst(listJobs(stateDir));
  const activeJobs = jobs.filter((j) => j.status === "queued" || j.status === "running");

  if (reference) {
    const selected = matchJobReference(activeJobs, reference);
    if (!selected) throw new Error(`No active job found for "${reference}".`);
    return { stateDir, job: selected };
  }

  const sessionScoped = filterJobsForCurrentSession(activeJobs, options);
  if (sessionScoped.length === 1) return { stateDir, job: sessionScoped[0] };
  if (sessionScoped.length > 1) throw new Error("Multiple active Kimi jobs. Pass a job id to /kimi:cancel.");
  if (getCurrentSessionId(options)) throw new Error("No active Kimi jobs to cancel for this session.");
  throw new Error("No active Kimi jobs to cancel.");
}

function resolveStateDirFromCwd(cwd) {
  return resolveStateDir(cwd);
}
