#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_DIR = __dirname;
const PROMPTS_DIR = path.join(SCRIPT_DIR, "..", "prompts");

const { getKimiAvailability, runKimiPrompt, parseStopReviewOutput, getDefaultModel } = await import("./lib/kimi.mjs");
const { collectReviewContext } = await import("./lib/git.mjs");
const { resolveStateDir, getConfig } = await import("./lib/state.mjs");

const STOP_REVIEW_TIMEOUT_MS = 900_000; // 15 minutes

function readHookInput() {
  try {
    const raw = fs.readFileSync(0, "utf8").trim();
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function logNote(note) {
  process.stderr.write(`[kimi-stop-hook] ${note}\n`);
}

function readPromptTemplate(name) {
  const fp = path.join(PROMPTS_DIR, `${name}.md`);
  if (!fs.existsSync(fp)) return null;
  return fs.readFileSync(fp, "utf8");
}

function main() {
  const input = readHookInput();
  const cwd = input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const stateDir = resolveStateDir(cwd);
  const config = getConfig(stateDir);

  // Check if review gate is enabled
  if (!config.stopReviewGate) {
    logNote("Review gate is disabled. Skipping stop-time review.");
    return;
  }

  // Check Kimi availability
  const avail = getKimiAvailability(cwd);
  if (!avail.available) {
    logNote(`Kimi not available: ${avail.reason}`);
    return;
  }

  // Build review context
  const reviewContext = collectReviewContext(cwd);
  if (!reviewContext.diff && !reviewContext.status) {
    logNote("No code changes detected. Skipping stop-time review.");
    return;
  }

  // Read prompt template
  const template = readPromptTemplate("stop-review-gate");
  if (!template) {
    logNote("Stop review prompt template not found. Skipping.");
    return;
  }

  // Build full prompt
  const claudeResponse = input.claude_response || "";
  let fullPrompt = template;
  if (claudeResponse) {
    fullPrompt = fullPrompt.replace("{{CLAUDE_RESPONSE_BLOCK}}", claudeResponse);
  }
  fullPrompt += `\n\n## Git Status\n${reviewContext.status || "(clean)"}\n\n## Diff\n${reviewContext.diff || "(no changes)"}`;

  // Run Kimi review
  logNote("Running stop-time Kimi review...");
  const result = runKimiPrompt(fullPrompt, {
    cwd,
    model: getDefaultModel(),
    timeout: STOP_REVIEW_TIMEOUT_MS,
  });

  if (!result.ok) {
    logNote(`Stop review failed: ${result.error}. Allowing stop.`);
    return;
  }

  // Parse output
  const decision = parseStopReviewOutput(result.stdout);

  if (decision.ok) {
    logNote(`ALLOW: ${decision.reason}`);
    return;
  }

  // Block the stop
  const output = JSON.stringify({
    decision: "block",
    reason: decision.reason,
  });
  process.stdout.write(output);
}

main();
