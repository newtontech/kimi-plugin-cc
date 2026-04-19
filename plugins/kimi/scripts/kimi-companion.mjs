#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_DIR = __dirname;
const PROMPTS_DIR = path.join(SCRIPT_DIR, "..", "prompts");

const { parseArgs } = await import("./lib/args.mjs");
const { getKimiAvailability, runKimiPrompt, getDefaultModel, parseKimiOutput } = await import("./lib/kimi.mjs");
const { collectReviewContext, getDiffStats, resolveWorkspaceRoot } = await import("./lib/git.mjs");
const { resolveStateDir, upsertJob, listJobs, getJob, getLatestJob, getConfig, setConfig } = await import("./lib/state.mjs");
const { runTrackedJob, readJobLog } = await import("./lib/tracked-jobs.mjs");

const argv = process.argv.slice(2);
const args = parseArgs(argv);

function log(msg) {
  process.stdout.write(`${msg}\n`);
}

function logError(msg) {
  process.stderr.write(`${msg}\n`);
}

function readPromptTemplate(name) {
  const fp = path.join(PROMPTS_DIR, `${name}.md`);
  if (!fs.existsSync(fp)) return null;
  return fs.readFileSync(fp, "utf8");
}

function buildReviewPrompt(reviewContext, promptTemplate) {
  const parts = [];
  if (promptTemplate) parts.push(promptTemplate);
  parts.push("\n## Git Status\n");
  parts.push(reviewContext.status || "(clean)");
  parts.push("\n## Diff\n");
  parts.push(reviewContext.diff || "(no changes)");
  if (reviewContext.branch) {
    parts.push(`\n## Branch: ${reviewContext.branch}\n`);
  }
  if (reviewContext.baseRef) {
    parts.push(`\n## Base ref: ${reviewContext.baseRef}\n`);
  }
  return parts.join("\n");
}

function handleSetup(args) {
  const cwd = args._[0] || process.env.CLAUDE_PROJECT_DIR || process.cwd();

  if (args["enable-review-gate"]) {
    const stateDir = resolveStateDir(cwd);
    setConfig(stateDir, { stopReviewGate: true });
    log("Review gate ENABLED. Kimi will review code when Claude stops.");
    return;
  }

  if (args["disable-review-gate"]) {
    const stateDir = resolveStateDir(cwd);
    setConfig(stateDir, { stopReviewGate: false });
    log("Review gate DISABLED.");
    return;
  }

  const avail = getKimiAvailability(cwd);
  if (!avail.available) {
    log(`Kimi CLI: NOT READY - ${avail.reason}`);
    log("Run: kimi login");
    return;
  }

  log(`Kimi CLI: READY`);
  log(`  Path: ${avail.kimiPath}`);
  log(`  Version: ${avail.version}`);
  log(`  Default model: ${getDefaultModel()}`);

  const stateDir = resolveStateDir(cwd);
  const config = getConfig(stateDir);
  log(`  Review gate: ${config.stopReviewGate ? "ENABLED" : "DISABLED"}`);
}

async function handleReview(args) {
  const cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const baseRef = args.base || null;
  const model = args.model || getDefaultModel();

  const avail = getKimiAvailability(cwd);
  if (!avail.available) {
    logError(`Kimi not available: ${avail.reason}`);
    process.exit(1);
  }

  const reviewContext = collectReviewContext(cwd, baseRef);
  if (!reviewContext.inGit) {
    logError("Not in a git repository.");
    process.exit(1);
  }

  if (!reviewContext.diff && !reviewContext.status) {
    log("No changes to review.");
    return;
  }

  const stats = getDiffStats(cwd, baseRef);
  log(`Reviewing ${stats.files} files, ~${stats.lines} lines changed...`);

  const reviewPrompt = `You are an expert code reviewer. Review the following code changes and provide a thorough analysis.

Focus on:
1. Bugs and logic errors
2. Security vulnerabilities
3. Performance issues
4. Code style and maintainability
5. Missing error handling

Output your review as structured findings with severity levels (critical/high/medium/low).`;

  const fullPrompt = buildReviewPrompt(reviewContext, reviewPrompt);

  if (args.background) {
    const stateDir = resolveStateDir(cwd);
    const { jobId, promise } = runTrackedJob(cwd, {
      prompt: fullPrompt,
      model,
      kimiBin: avail.kimiPath,
    });

    upsertJob(stateDir, {
      id: jobId,
      type: "review",
      status: "running",
      model,
      stats,
    });

    log(`Review started in background. Job ID: ${jobId}`);
    log("Check progress with: /kimi:status");
    log("Get results with: /kimi:result");
    return;
  }

  // Foreground review
  const result = runKimiPrompt(fullPrompt, { cwd, model, timeout: 180_000 });

  if (!result.ok) {
    logError(`Review failed: ${result.error}`);
    if (result.stderr) logError(result.stderr);
    process.exit(1);
  }

  log("\n=== Kimi Review ===\n");
  log(result.stdout);
}

async function handleAdversarialReview(args) {
  const cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const baseRef = args.base || null;
  const model = args.model || getDefaultModel();
  const focusText = args._.join(" ").trim();

  const avail = getKimiAvailability(cwd);
  if (!avail.available) {
    logError(`Kimi not available: ${avail.reason}`);
    process.exit(1);
  }

  const reviewContext = collectReviewContext(cwd, baseRef);
  const template = readPromptTemplate("adversarial-review") || "";

  let fullPrompt = buildReviewPrompt(reviewContext, template);
  if (focusText) {
    fullPrompt += `\n\n## Specific Focus\n${focusText}`;
  }

  if (args.background) {
    const stateDir = resolveStateDir(cwd);
    const { jobId } = runTrackedJob(cwd, {
      prompt: fullPrompt,
      model,
      kimiBin: avail.kimiPath,
    });

    upsertJob(stateDir, {
      id: jobId,
      type: "adversarial-review",
      status: "running",
      model,
    });

    log(`Adversarial review started in background. Job ID: ${jobId}`);
    return;
  }

  const result = runKimiPrompt(fullPrompt, { cwd, model, timeout: 180_000 });

  if (!result.ok) {
    logError(`Adversarial review failed: ${result.error}`);
    process.exit(1);
  }

  log("\n=== Kimi Adversarial Review ===\n");
  log(result.stdout);
}

async function handleTask(args) {
  const cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const prompt = args._.join(" ").trim();
  const model = args.model || getDefaultModel();

  if (!prompt) {
    logError("No task prompt provided.");
    process.exit(1);
  }

  const avail = getKimiAvailability(cwd);
  if (!avail.available) {
    logError(`Kimi not available: ${avail.reason}`);
    process.exit(1);
  }

  const result = runKimiPrompt(prompt, { cwd, model, timeout: 300_000 });

  if (!result.ok) {
    logError(`Task failed: ${result.error}`);
    process.exit(1);
  }

  log(result.stdout);
}

function handleStatus(args) {
  const cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const stateDir = resolveStateDir(cwd);
  const jobId = args._[0];

  if (jobId) {
    const job = getJob(stateDir, jobId);
    if (!job) {
      log(`Job ${jobId} not found.`);
      return;
    }
    log(JSON.stringify(job, null, 2));
    return;
  }

  const jobs = listJobs(stateDir);
  if (jobs.length === 0) {
    log("No Kimi jobs found for this project.");
    return;
  }

  log(`Found ${jobs.length} recent job(s):\n`);
  for (const job of jobs.slice(0, 10)) {
    const statusIcon = job.status === "completed" ? "[done]"
      : job.status === "running" ? "[running]"
      : job.status === "failed" ? "[failed]"
      : `[${job.status}]`;
    const type = job.type || "task";
    log(`  ${statusIcon} ${job.id} (${type}, ${job.model || "default"}) - ${job.updatedAt}`);
  }
}

function handleResult(args) {
  const cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const stateDir = resolveStateDir(cwd);
  const jobId = args._[0];

  const job = jobId ? getJob(stateDir, jobId) : getLatestJob(stateDir);
  if (!job) {
    log("No job found.");
    return;
  }

  if (job.status === "running") {
    log(`Job ${job.id} is still running.`);
    return;
  }

  const logContent = readJobLog(stateDir, job.id);
  if (!logContent) {
    log(`No output available for job ${job.id}.`);
    return;
  }

  log(`=== Result for ${job.id} (${job.status}) ===\n`);
  log(logContent);
}

async function handleCancel(args) {
  const cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const stateDir = resolveStateDir(cwd);
  const jobId = args._[0];

  const job = jobId ? getJob(stateDir, jobId) : getLatestJob(stateDir);
  if (!job) {
    log("No job to cancel.");
    return;
  }

  if (job.status !== "running") {
    log(`Job ${job.id} is not running (status: ${job.status}).`);
    return;
  }

  upsertJob(stateDir, { id: job.id, status: "cancelled", completedAt: new Date().toISOString() });
  log(`Job ${job.id} cancelled.`);
}

function handleHelp() {
  log("kimi-companion — Kimi CLI integration for Claude Code");
  log("");
  log("Commands:");
  log("  setup [--enable-review-gate|--disable-review-gate]  Check/configure Kimi setup");
  log("  review [--base <ref>] [--background] [--model <m>]   Run code review");
  log("  adversarial-review [--base <ref>] [--background]     Run adversarial review");
  log("  task <prompt> [--model <m>]                          Run a Kimi task");
  log("  status [job-id]                                      Check job status");
  log("  result [job-id]                                      Get job result");
  log("  cancel [job-id]                                      Cancel a job");
}

switch (args.subcommand) {
  case "setup": handleSetup(args); break;
  case "review": await handleReview(args); break;
  case "adversarial-review": await handleAdversarialReview(args); break;
  case "task": await handleTask(args); break;
  case "status": handleStatus(args); break;
  case "result": handleResult(args); break;
  case "cancel": await handleCancel(args); break;
  default: handleHelp(); break;
}
