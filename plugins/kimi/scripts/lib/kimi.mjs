import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

const KIMI_BIN = process.env.KIMI_BIN || "kimi";

export function getKimiAvailability(cwd) {
  const whichResult = spawnSync("which", [KIMI_BIN], {
    encoding: "utf8",
    timeout: 5000,
  });

  if (whichResult.status !== 0) {
    return {
      available: false,
      reason: "Kimi CLI not found. Install with: pip install kimi-cli or see https://github.com/MoonshotAI/kimi-cli",
      kimiPath: null,
    };
  }

  const kimiPath = whichResult.stdout.trim();

  const versionResult = spawnSync(KIMI_BIN, ["--version"], {
    encoding: "utf8",
    timeout: 5000,
  });

  const version = versionResult.stdout?.trim() || "unknown";

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
  const args = [
    "--print",
    "--final-message-only",
  ];

  if (options.outputFormat) {
    args.push("--output-format", options.outputFormat);
  }

  if (options.model) {
    args.push("--model", options.model);
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
    return {
      ok: false,
      error: `Kimi exited with code ${result.status}`,
      stdout: result.stdout || "",
      stderr: result.stderr || "",
    };
  }

  return { ok: true, stdout: result.stdout || "", stderr: result.stderr || "" };
}

export function runKimiPromptAsync(prompt, options = {}) {
  const args = [
    "--print",
    "--final-message-only",
  ];

  if (options.outputFormat) {
    args.push("--output-format", options.outputFormat);
  }

  if (options.model) {
    args.push("--model", options.model);
  }

  args.push("--prompt", prompt);

  const child = spawn(KIMI_BIN, args, {
    cwd: options.cwd || process.cwd(),
    env: { ...process.env, ...options.env },
    stdio: ["pipe", "pipe", "pipe"],
  });

  return child;
}

export function parseKimiOutput(rawOutput) {
  const text = (rawOutput || "").trim();
  if (!text) return { ok: true, parsed: null, text: "" };

  try {
    const lines = text.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed.content || parsed.message || parsed.type) {
          return { ok: true, parsed, text };
        }
      } catch { /* not JSON, try next line */ }
    }
  } catch { /* fallback */ }

  return { ok: true, parsed: null, text };
}

export function parseStopReviewOutput(rawOutput) {
  const text = String(rawOutput ?? "").trim();
  const firstLine = text.split(/\r?\n/, 1)[0].trim();

  if (firstLine.startsWith("ALLOW:")) {
    return { ok: true, reason: firstLine.slice("ALLOW:".length).trim() || "No issues found" };
  }
  if (firstLine.startsWith("BLOCK:")) {
    const reason = firstLine.slice("BLOCK:".length).trim() || text;
    return { ok: false, reason: `Kimi stop-time review found issues: ${reason}` };
  }

  // If no clear marker, treat as ALLOW (fail open)
  return { ok: true, reason: "Review completed (no explicit BLOCK)" };
}

export function getDefaultModel() {
  const configPath = path.join(process.env.HOME || "/tmp", ".kimi", "config.toml");
  try {
    const content = fs.readFileSync(configPath, "utf8");
    const match = content.match(/default_model\s*=\s*"([^"]+)"/);
    return match ? match[1] : "kimi-for-coding";
  } catch {
    return "kimi-for-coding";
  }
}
