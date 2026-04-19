import path from "node:path";
import fs from "node:fs";
import { spawnSync, spawn } from "node:child_process";
import { binaryAvailable } from "./process.mjs";

const KIMI_BIN = process.env.KIMI_BIN || "kimi";

export function getKimiAvailability(cwd) {
  const status = binaryAvailable(KIMI_BIN, ["--version"], { cwd });
  if (!status.available) {
    return {
      available: false,
      reason: `Kimi CLI not found. Install with: pip install kimi-cli`,
      kimiPath: null,
      version: null,
    };
  }

  const kimiPath = status.path || KIMI_BIN;
  const version = status.detail;

  const credDir = path.join(process.env.HOME || "/tmp", ".kimi", "credentials");
  const hasCredentials = fs.existsSync(credDir) &&
    fs.readdirSync(credDir).some((f) => f.endsWith(".json"));

  if (!hasCredentials) {
    return {
      available: false,
      reason: "Kimi CLI found but not authenticated. Run: kimi login",
      kimiPath,
      version,
    };
  }

  return { available: true, reason: null, kimiPath, version };
}

export function runKimiPrompt(prompt, options = {}) {
  const args = ["--print", "--final-message-only"];

  if (options.model) {
    args.push("--model", options.model);
  }
  if (options.outputFormat) {
    args.push("--output-format", options.outputFormat);
  }
  if (options.noThinking) {
    args.push("--no-thinking");
  }

  args.push("--prompt", prompt);

  const result = spawnSync(KIMI_BIN, args, {
    cwd: options.cwd || process.cwd(),
    encoding: "utf8",
    timeout: options.timeout || 120_000,
    maxBuffer: 10 * 1024 * 1024,
    env: { ...process.env, ...options.env },
  });

  if (result.error) {
    return { ok: false, error: result.error.message, stdout: "", stderr: result.stderr || "" };
  }
  if (result.status !== 0) {
    return { ok: false, error: `Kimi exited with code ${result.status}`, stdout: result.stdout || "", stderr: result.stderr || "" };
  }

  return { ok: true, stdout: result.stdout || "", stderr: result.stderr || "" };
}

export function runKimiPromptAsync(prompt, options = {}) {
  const args = ["--print", "--final-message-only"];

  if (options.model) {
    args.push("--model", options.model);
  }

  args.push("--prompt", prompt);

  return spawn(KIMI_BIN, args, {
    cwd: options.cwd || process.cwd(),
    env: { ...process.env, ...options.env },
    stdio: ["pipe", "pipe", "pipe"],
  });
}

export function parseKimiOutput(rawOutput) {
  const text = (rawOutput || "").trim();
  if (!text) return { ok: true, parsed: null, rawOutput: "" };

  try {
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed.content || parsed.message || parsed.type) {
          return { ok: true, parsed, rawOutput: text };
        }
      } catch { /* not JSON */ }
    }
  } catch { /* fallback */ }

  return { ok: true, parsed: null, rawOutput: text };
}

export function parseStopReviewOutput(rawOutput) {
  const text = String(rawOutput ?? "").trim();
  if (!text) {
    return { ok: false, reason: "Review returned no output. Run /kimi:review manually or bypass the gate." };
  }

  const firstLine = text.split(/\r?\n/, 1)[0].trim();
  if (firstLine.startsWith("ALLOW:")) {
    return { ok: true, reason: firstLine.slice("ALLOW:".length).trim() || "No issues found" };
  }
  if (firstLine.startsWith("BLOCK:")) {
    const reason = firstLine.slice("BLOCK:".length).trim() || text;
    return { ok: false, reason: `Kimi stop-time review found issues: ${reason}` };
  }

  return { ok: false, reason: "Review returned unexpected output. Run /kimi:review manually." };
}

export function getDefaultModel() {
  const configPath = path.join(process.env.HOME || "/tmp", ".kimi", "config.toml");
  try {
    const content = fs.readFileSync(configPath, "utf8");
    const match = content.match(/^(default_model|model)\s*=\s*"([^"]+)"/m);
    return match ? match[2] : "kimi-for-coding";
  } catch {
    return "kimi-for-coding";
  }
}
