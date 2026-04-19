#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { parseArgs } from "./lib/args.mjs";
import { getKimiAvailability, runKimiPrompt, getDefaultModel, parseKimiOutput } from "./lib/kimi.mjs";
import { collectReviewContext, getDiffStats, resolveReviewTarget, ensureGitRepository } from "./lib/git.mjs";
import { resolveStateDir, upsertJob, listJobs, getConfig, setConfig, generateJobId, writeJobFile, readStoredJob } from "./lib/state.mjs";
import { runTrackedJob, readJobLog, SESSION_ID_ENV } from "./lib/tracked-jobs.mjs";
import { terminateProcessTree, binaryAvailable } from "./lib/process.mjs";
import { loadPromptTemplate, interpolateTemplate } from "./lib/prompts.mjs";
import {
  renderSetupReport, renderStatusReport, renderJobStatusReport,
  renderReviewResult, renderCancelReport, renderStoredJobResult, renderTaskResult
} from "./lib/render.mjs";
import {
  buildStatusSnapshot, buildSingleJobSnapshot,
  resolveResultJob, resolveCancelableJob
} from "./lib/job-control.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const MAX_PROMPT_BYTES = 512 * 1024;

const argv = process.argv.slice(2);
const args = parseArgs(argv);

function log(msg) { process.stdout.write(`${msg}\n`); }
function logError(msg) { process.stderr.write(`${msg}\n`); }

function outputResult(value, asJson) {
  if (asJson) {
    log(JSON.stringify(value, null, 2));
  } else {
    process.stdout.write(value);
  }
}

function handleSetup(args) {
  const cwd = args._[0] || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const stateDir = resolveStateDir(cwd);
  const actionsTaken = [];

  if (args["enable-review-gate"]) {
    setConfig(stateDir, "stopReviewGate", true);
    actionsTaken.push("Enabled the stop-time review gate.");
  } else if (args["disable-review-gate"]) {
    setConfig(stateDir, "stopReviewGate", false);
    actionsTaken.push("Disabled the stop-time review gate.");
  }

  const codexStatus = getKimiAvailability(cwd);
  const nodeStatus = binaryAvailable("node", ["--version"], { cwd });
  const config = getConfig(stateDir);
  const nextSteps = [];

  if (!codexStatus.available) {
    nextSteps.push("Install Kimi CLI: pip install kimi-cli");
  }
  if (codexStatus.available && codexStatus.reason?.includes("not authenticated")) {
    nextSteps.push("Run: kimi login");
  }
  if (!config.stopReviewGate) {
    nextSteps.push("Optional: /kimi:setup --enable-review-gate");
  }

  const report = {
    ready: nodeStatus.available && codexStatus.available,
    node: nodeStatus,
    codex: codexStatus,
    reviewGateEnabled: config.stopReviewGate,
    actionsTaken,
    nextSteps,
  };

  outputResult(args.json ? report : renderSetupReport(report), args.json);
}

async function handleReview(args) {
  try {
  const cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const model = args.model || getDefaultModel();
  const baseRef = args.base || null;

  const avail = getKimiAvailability(cwd);
  if (!avail.available) { logError(`Kimi not available: ${avail.reason}`); process.exit(1); }

  ensureGitRepository(cwd);
  const target = resolveReviewTarget(cwd, { base: baseRef, scope: args.scope });
  const context = collectReviewContext(cwd, target.baseRef);

  if (!context.diff && !context.status) { log("No changes to review."); return; }

  const stats = getDiffStats(cwd, target.baseRef);
  log(`Reviewing ${stats.files} files, ~${stats.lines} lines changed...`);

  const template = loadPromptTemplate(ROOT_DIR, "review");
  const reviewPrompt = template || buildDefaultReviewPrompt();
  const fullPrompt = buildReviewPrompt(reviewPrompt, context, target);

  if (Buffer.byteLength(fullPrompt, "utf8") > MAX_PROMPT_BYTES) {
    logError(`Diff too large (${Math.round(Buffer.byteLength(fullPrompt, "utf8") / 1024)}KB). Max is ${MAX_PROMPT_BYTES / 1024}KB. Use --base to narrow scope.`);
    process.exit(1);
  }

  if (args.background) {
    const stateDir = resolveStateDir(cwd);
    const { jobId, promise } = runTrackedJob(cwd, {
      prompt: fullPrompt,
      model,
      kimiBin: avail.kimiPath,
      title: "Review",
    });

    upsertJob(stateDir, { id: jobId, type: "review", status: "running", model, stats, kind: "review", sessionId: process.env[SESSION_ID_ENV] || null });
    promise.catch((err) => { upsertJob(stateDir, { id: jobId, status: "failed", error: err.message }); });

    log(`Review started in background. Job ID: ${jobId}`);
    log("Check progress with: /kimi:status");
    return;
  }

  const result = runKimiPrompt(fullPrompt, { cwd, model, timeout: 180_000 });
  if (!result.ok) { logError(`Review failed: ${result.error}`); if (result.stderr) logError(result.stderr); process.exit(1); }

  const parsed = parseKimiOutput(result.stdout);
  outputResult(
    args.json ? { review: "Review", target, result: parsed.parsed, rawOutput: parsed.rawOutput } : renderReviewResult(parsed, { reviewLabel: "Review", targetLabel: target.label }),
    args.json
  );
  } catch (err) { logError(err.message); process.exit(1); }
}

async function handleAdversarialReview(args) {
  try {
  const cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const model = args.model || getDefaultModel();
  const baseRef = args.base || null;
  const focusText = args._.join(" ").trim();

  const avail = getKimiAvailability(cwd);
  if (!avail.available) { logError(`Kimi not available: ${avail.reason}`); process.exit(1); }

  ensureGitRepository(cwd);
  const target = resolveReviewTarget(cwd, { base: baseRef, scope: args.scope });
  const context = collectReviewContext(cwd, target.baseRef);
  const template = loadPromptTemplate(ROOT_DIR, "adversarial-review") || "";

  let fullPrompt = buildReviewPrompt(template, context, target);
  if (focusText) fullPrompt += `\n\n## Specific Focus\n${focusText}`;

  if (Buffer.byteLength(fullPrompt, "utf8") > MAX_PROMPT_BYTES) {
    logError(`Diff too large (${Math.round(Buffer.byteLength(fullPrompt, "utf8") / 1024)}KB). Use --base to narrow scope.`);
    process.exit(1);
  }

  if (args.background) {
    const stateDir = resolveStateDir(cwd);
    const { jobId, promise } = runTrackedJob(cwd, {
      prompt: fullPrompt,
      model,
      kimiBin: avail.kimiPath,
      title: "Adversarial Review",
    });

    upsertJob(stateDir, { id: jobId, type: "adversarial-review", status: "running", model, kind: "adversarial-review", sessionId: process.env[SESSION_ID_ENV] || null });
    promise.catch((err) => { upsertJob(stateDir, { id: jobId, status: "failed", error: err.message }); });

    log(`Adversarial review started in background. Job ID: ${jobId}`);
    return;
  }

  const result = runKimiPrompt(fullPrompt, { cwd, model, timeout: 180_000 });
  if (!result.ok) { logError(`Adversarial review failed: ${result.error}`); process.exit(1); }

  const parsed = parseKimiOutput(result.stdout);
  outputResult(
    args.json ? { review: "Adversarial Review", target, result: parsed.parsed, rawOutput: parsed.rawOutput } : renderReviewResult(parsed, { reviewLabel: "Adversarial Review", targetLabel: target.label }),
    args.json
  );
  } catch (err) { logError(err.message); process.exit(1); }
}

async function handleTask(args) {
  const cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const prompt = args._.join(" ").trim();
  const model = args.model || getDefaultModel();

  if (!prompt) { logError("No task prompt provided."); process.exit(1); }

  const avail = getKimiAvailability(cwd);
  if (!avail.available) { logError(`Kimi not available: ${avail.reason}`); process.exit(1); }

  const result = runKimiPrompt(prompt, { cwd, model, timeout: 300_000 });
  if (!result.ok) { logError(`Task failed: ${result.error}`); process.exit(1); }
  outputResult(args.json ? { task: prompt.slice(0, 80), output: result.stdout } : result.stdout, args.json);
}

function handleStatus(args) {
  const cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const jobId = args._[0];

  if (jobId) {
    try {
      const snapshot = buildSingleJobSnapshot(cwd, jobId);
      outputResult(args.json ? snapshot.job : renderJobStatusReport(snapshot.job), args.json);
    } catch (err) {
      logError(err.message);
      process.exit(1);
    }
    return;
  }

  const snapshot = buildStatusSnapshot(cwd, { all: args.all });
  outputResult(args.json ? snapshot : renderStatusReport(snapshot), args.json);
}

function handleResult(args) {
  const cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const reference = args._[0] || "";

  try {
    const { stateDir, job } = resolveResultJob(cwd, reference);
    const stored = readStoredJob(stateDir, job.id);

    if (args.json) {
      log(JSON.stringify({ job, stored }, null, 2));
    } else {
      process.stdout.write(renderStoredJobResult(job, stored));
    }
  } catch (err) {
    logError(err.message);
    process.exit(1);
  }
}

async function handleCancel(args) {
  const cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const reference = args._[0] || "";

  try {
    const { stateDir, job } = resolveCancelableJob(cwd, reference);

    // Kill the process tree FIRST
    if (Number.isFinite(job.pid)) {
      try {
        terminateProcessTree(job.pid);
      } catch { /* process may have exited */ }
    }

    // THEN update state
    const completedAt = new Date().toISOString();
    upsertJob(stateDir, {
      id: job.id,
      status: "cancelled",
      pid: null,
      completedAt,
      errorMessage: "Cancelled by user.",
    });

    writeJobFile(stateDir, job.id, {
      ...(readStoredJob(stateDir, job.id) || {}),
      status: "cancelled",
      pid: null,
      completedAt,
      errorMessage: "Cancelled by user.",
    });

    outputResult(
      args.json ? { jobId: job.id, status: "cancelled" } : renderCancelReport(job),
      args.json
    );
  } catch (err) {
    logError(err.message);
    process.exit(1);
  }
}

function buildDefaultReviewPrompt() {
  return `You are an expert code reviewer. Review the following code changes and provide a thorough analysis.

Focus on:
1. Bugs and logic errors
2. Security vulnerabilities
3. Performance issues
4. Code style and maintainability
5. Missing error handling

Output your review as structured findings with severity levels (critical/high/medium/low).`;
}

function buildReviewPrompt(template, context, target) {
  const parts = [];
  if (template) parts.push(template);
  parts.push("\n## Git Status\n");
  parts.push(context.status || "(clean)");
  parts.push("\n## Diff\n");
  parts.push(context.diff || "(no changes)");
  if (context.branch) parts.push(`\n## Branch: ${context.branch}\n`);
  if (target?.baseRef) parts.push(`\n## Base ref: ${target.baseRef}\n`);
  return parts.join("\n");
}

function handleHelp() {
  log("kimi-companion — Kimi CLI integration for Claude Code");
  log("");
  log("Commands:");
  log("  setup [--enable-review-gate|--disable-review-gate] [--json]  Check/configure Kimi setup");
  log("  review [--base <ref>] [--background] [--model <m>] [--json]   Run code review");
  log("  adversarial-review [--base <ref>] [--background] [--json]     Run adversarial review");
  log("  task <prompt> [--model <m>]                                   Run a Kimi task");
  log("  status [job-id] [--all] [--json]                              Check job status");
  log("  result [job-id] [--json]                                      Get job result");
  log("  cancel [job-id] [--json]                                      Cancel a job");
}

switch (args.subcommand) {
  case "setup": handleSetup(args); break;
  case "review": await handleReview(args); break;
  case "adversarial-review": await handleAdversarialReview(args); break;
  case "task": await handleTask(args); break;
  case "status": handleStatus(args); break;
  case "result": handleResult(args); break;
  case "cancel": await handleCancel(args); break;
  default:
    logError(`Unknown command: "${args.subcommand}". Run without arguments for help.`);
    process.exit(1);
    break;
}
