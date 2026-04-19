#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { getKimiAvailability, runKimiPrompt, parseStopReviewOutput, getDefaultModel } from "./lib/kimi.mjs";
import { collectReviewContext } from "./lib/git.mjs";
import { resolveStateDir, getConfig } from "./lib/state.mjs";
import { loadPromptTemplate, interpolateTemplate } from "./lib/prompts.mjs";
import { SESSION_ID_ENV } from "./lib/tracked-jobs.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_DIR = __dirname;
const ROOT_DIR = path.resolve(SCRIPT_DIR, "..");
const STOP_REVIEW_TIMEOUT_MS = 600_000; // 10 minutes

function readHookInput() {
  try {
    const raw = fs.readFileSync(0, "utf8").trim();
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function emitDecision(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function logNote(note) {
  if (note) process.stderr.write(`[kimi-stop-hook] ${note}\n`);
}

function buildStopReviewPrompt(input, reviewContext) {
  const lastAssistantMessage = String(input.last_assistant_message ?? "").trim();
  const template = loadPromptTemplate(ROOT_DIR, "stop-review-gate");
  if (!template) return null;

  const claudeResponseBlock = lastAssistantMessage
    ? ["Previous Claude response:", lastAssistantMessage].join("\n")
    : "";

  let prompt = interpolateTemplate(template, { CLAUDE_RESPONSE_BLOCK: claudeResponseBlock });
  prompt += `\n\n## Git Status\n${reviewContext.status || "(clean)"}\n\n## Diff\n${reviewContext.diff || "(no changes)"}`;
  return prompt;
}

function main() {
  const input = readHookInput();
  const cwd = input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const stateDir = resolveStateDir(cwd);
  const config = getConfig(stateDir);

  if (!config.stopReviewGate) {
    logNote("Review gate is disabled. Skipping.");
    return;
  }

  const avail = getKimiAvailability(cwd);
  if (!avail.available) {
    logNote(`Kimi not available: ${avail.reason}. Skipping gate.`);
    return;
  }

  const reviewContext = collectReviewContext(cwd);
  if (!reviewContext.diff && !reviewContext.status) {
    logNote("No code changes detected. Skipping.");
    return;
  }

  const prompt = buildStopReviewPrompt(input, reviewContext);
  if (!prompt) {
    logNote("Stop review prompt template not found. Skipping.");
    return;
  }

  logNote("Running stop-time Kimi review...");
  const result = runKimiPrompt(prompt, {
    cwd,
    model: getDefaultModel(),
    timeout: STOP_REVIEW_TIMEOUT_MS,
  });

  if (!result.ok) {
    if (result.error?.includes("ETIMEDOUT") || result.error?.includes("timed out")) {
      logNote("Stop review timed out. Allowing stop (run /kimi:review manually if needed).");
      return;
    }
    logNote(`Stop review failed: ${result.error}. Allowing stop.`);
    return;
  }

  const decision = parseStopReviewOutput(result.stdout);
  if (decision.ok) {
    logNote(`ALLOW: ${decision.reason}`);
    return;
  }

  emitDecision({ decision: "block", reason: decision.reason });
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[kimi-stop-hook] Internal error: ${message}. Allowing stop.\n`);
  process.exitCode = 0;
}
