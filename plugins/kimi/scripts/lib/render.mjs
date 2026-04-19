import fs from "node:fs";
import path from "node:path";

export function formatElapsed(startValue, endValue = null) {
  const start = Date.parse(startValue ?? "");
  if (!Number.isFinite(start)) return null;
  const end = endValue ? Date.parse(endValue) : Date.now();
  if (!Number.isFinite(end) || end < start) return null;

  const totalSec = Math.max(0, Math.round((end - start) / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function statusIcon(status) {
  switch (status) {
    case "completed": return "[done]";
    case "running": return "[running]";
    case "queued": return "[queued]";
    case "failed": return "[failed]";
    case "cancelled": return "[cancelled]";
    default: return `[${status}]`;
  }
}

export function renderSetupReport(report) {
  const lines = [];
  lines.push("=== Kimi Setup ===\n");
  lines.push(`Node: ${report.node.available ? report.node.detail : "NOT FOUND"}`);
  lines.push(`Kimi CLI: ${report.codex.available ? report.codex.detail : "NOT FOUND"}`);
  lines.push(`Review gate: ${report.reviewGateEnabled ? "ENABLED" : "DISABLED"}`);

  if (report.actionsTaken?.length) {
    lines.push("\nActions taken:");
    for (const action of report.actionsTaken) lines.push(`  - ${action}`);
  }
  if (report.nextSteps?.length) {
    lines.push("\nNext steps:");
    for (const step of report.nextSteps) lines.push(`  - ${step}`);
  }
  return lines.join("\n") + "\n";
}

export function renderStatusReport(snapshot) {
  const lines = [];
  const { running, latestFinished, recent } = snapshot;

  if (running.length === 0 && !latestFinished && recent.length === 0) {
    return "No Kimi jobs found for this project.\n";
  }

  if (running.length > 0) {
    lines.push("Active jobs:");
    for (const job of running) {
      const elapsed = formatElapsed(job.startedAt ?? job.createdAt);
      lines.push(`  ${statusIcon(job.status)} ${job.id} (${job.kindLabel || job.type || "task"}, ${job.model || "default"}) ${elapsed ? elapsed : ""}`);
    }
  }

  if (latestFinished) {
    lines.push(`\nLatest: ${statusIcon(latestFinished.status)} ${latestFinished.id} (${latestFinished.kindLabel || latestFinished.type || "task"})`);
  }

  if (recent.length > 0) {
    lines.push(`\nRecent (${recent.length}):`);
    for (const job of recent.slice(0, 8)) {
      lines.push(`  ${statusIcon(job.status)} ${job.id} - ${job.updatedAt || ""}`);
    }
  }

  return lines.join("\n") + "\n";
}

export function renderJobStatusReport(job) {
  const lines = [];
  lines.push(`Job: ${job.id}`);
  lines.push(`Status: ${job.status}`);
  lines.push(`Type: ${job.kindLabel || job.type || "task"}`);
  if (job.model) lines.push(`Model: ${job.model}`);
  lines.push(`Created: ${job.createdAt || "unknown"}`);
  if (job.startedAt) lines.push(`Started: ${job.startedAt}`);
  if (job.completedAt) lines.push(`Completed: ${job.completedAt}`);
  const elapsed = formatElapsed(job.startedAt ?? job.createdAt, job.completedAt);
  if (elapsed) lines.push(`Duration: ${elapsed}`);
  if (job.errorMessage) lines.push(`Error: ${job.errorMessage}`);
  return lines.join("\n") + "\n";
}

export function renderReviewResult(parsed, meta = {}) {
  const label = meta.reviewLabel || "Review";
  const target = meta.targetLabel || "";

  const lines = [];
  lines.push(`=== ${label}${target ? `: ${target}` : ""} ===\n`);

  if (parsed.ok && !parsed.parsed && parsed.rawOutput) {
    lines.push("(No structured output — showing raw response)\n");
  }

  const result = parsed.parsed;
  if (result) {
    if (result.summary) lines.push(`Summary: ${result.summary}\n`);
    if (result.verdict) lines.push(`Verdict: ${result.verdict}\n`);
    if (result.findings?.length) {
      lines.push("Findings:");
      for (const f of result.findings) {
        const sev = f.severity || "info";
        lines.push(`  [${sev.toUpperCase()}] ${f.title || f.message || "Untitled"}`);
        if (f.description) lines.push(`    ${f.description}`);
      }
    }
    if (result.next_steps?.length) {
      lines.push("\nNext steps:");
      for (const step of result.next_steps) lines.push(`  - ${step}`);
    }
  } else {
    lines.push(parsed.rawOutput || "(no structured output)");
  }

  return lines.join("\n") + "\n";
}

export function renderCancelReport(job) {
  return `Job ${job.id} cancelled.\n`;
}

export function renderStoredJobResult(job, storedJob) {
  const lines = [];
  lines.push(`=== Result for ${job.id} (${job.status}) ===\n`);

  if (storedJob?.rendered) {
    lines.push(storedJob.rendered);
  } else if (storedJob?.result) {
    lines.push(JSON.stringify(storedJob.result, null, 2));
  } else {
    lines.push("(no output available)");
  }

  return lines.join("\n") + "\n";
}

export function renderTaskResult(output, meta = {}) {
  const lines = [];
  const title = meta.title || "Task";
  if (meta.jobId) lines.push(`[${meta.jobId}] `);
  lines.push(`${title} completed.\n`);
  if (output) lines.push(output);
  return lines.join("") + "\n";
}
