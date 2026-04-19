import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, "..");
const SCRIPT = path.join(ROOT_DIR, "plugins", "kimi", "scripts", "kimi-companion.mjs");
const LIB_DIR = path.join(ROOT_DIR, "plugins", "kimi", "scripts", "lib");

const processModule = await import(path.join(LIB_DIR, "process.mjs"));
const gitModule = await import(path.join(LIB_DIR, "git.mjs"));
const stateModule = await import(path.join(LIB_DIR, "state.mjs"));
const promptsModule = await import(path.join(LIB_DIR, "prompts.mjs"));
const renderModule = await import(path.join(LIB_DIR, "render.mjs"));
const jcModule = await import(path.join(LIB_DIR, "job-control.mjs"));
const kimiModule = await import(path.join(LIB_DIR, "kimi.mjs"));

describe("lib/process.mjs", () => {
  it("should detect node binary", () => {
    const result = processModule.binaryAvailable("node", ["--version"]);
    assert.equal(result.available, true);
  });

  it("should report unavailable for nonexistent binary", () => {
    const result = processModule.binaryAvailable("nonexistent_binary_xyz_123");
    assert.equal(result.available, false);
  });

  it("should terminate invalid PID gracefully", () => {
    const result = processModule.terminateProcessTree(Number.NaN);
    assert.equal(result.attempted, false);
  });

  it("should format command failure", () => {
    const result = processModule.formatCommandFailure({ command: "git", args: ["status"], status: 1, signal: null, stderr: "not a repo", stdout: "" });
    assert.ok(result.includes("exit=1"));
  });
});

describe("lib/git.mjs", () => {
  it("should detect git repo", () => {
    assert.equal(gitModule.isInGitRepo(process.cwd()), true);
  });

  it("should resolve workspace root", () => {
    const root = gitModule.resolveWorkspaceRoot(process.cwd());
    assert.ok(fs.existsSync(path.join(root, ".git")));
  });

  it("should get current branch", () => {
    const branch = gitModule.getCurrentBranch(process.cwd());
    assert.ok(branch);
  });

  it("should collect review context", () => {
    const ctx = gitModule.collectReviewContext(process.cwd());
    assert.equal(ctx.inGit, true);
    assert.ok(ctx.branch);
  });

  it("should get diff stats with correct file count", () => {
    const stats = gitModule.getDiffStats(process.cwd());
    assert.ok(typeof stats.files === "number");
    assert.ok(typeof stats.lines === "number");
    assert.ok(stats.files >= 0);
  });

  it("should reject invalid git refs", () => {
    assert.throws(() => gitModule.resolveReviewTarget(process.cwd(), { base: "; rm -rf /" }), /Invalid git ref/);
  });

  it("should resolve review target", () => {
    const target = gitModule.resolveReviewTarget(process.cwd());
    assert.ok(target.mode);
    assert.ok(target.label);
  });
});

describe("lib/state.mjs", () => {
  const testDir = path.join(process.cwd(), `.test-state-${Date.now()}`);

  it("should create state dir", () => {
    fs.mkdirSync(testDir, { recursive: true });
    assert.ok(fs.existsSync(testDir));
  });

  it("should upsert and retrieve a job", () => {
    stateModule.upsertJob(testDir, { id: "test-job-1", type: "review", status: "running", model: "kimi-for-coding" });
    const jobs = stateModule.listJobs(testDir);
    assert.ok(jobs.some((j) => j.id === "test-job-1"));
  });

  it("should list jobs", () => {
    const jobs = stateModule.listJobs(testDir);
    assert.ok(jobs.length >= 1);
  });

  it("should manage config", () => {
    stateModule.setConfig(testDir, "stopReviewGate", true);
    const config = stateModule.getConfig(testDir);
    assert.equal(config.stopReviewGate, true);
  });

  it("should write and read job file", () => {
    stateModule.writeJobFile(testDir, "test-job-1", { id: "test-job-1", status: "running", output: "test" });
    const stored = stateModule.readStoredJob(testDir, "test-job-1");
    assert.ok(stored);
    assert.equal(stored.output, "test");
  });

  it("should clean up test state", () => {
    fs.rmSync(testDir, { recursive: true, force: true });
    assert.ok(!fs.existsSync(testDir));
  });
});

describe("lib/prompts.mjs", () => {
  it("should interpolate template variables", () => {
    const result = promptsModule.interpolateTemplate("Hello {{NAME}}, value is {{VALUE}}", { NAME: "World", VALUE: "42" });
    assert.equal(result, "Hello World, value is 42");
  });

  it("should leave unknown placeholders unchanged", () => {
    const result = promptsModule.interpolateTemplate("{{UNKNOWN}}", {});
    assert.equal(result, "{{UNKNOWN}}");
  });

  it("should load prompt template", () => {
    const template = promptsModule.loadPromptTemplate(ROOT_DIR, "adversarial-review");
    assert.ok(template === null || typeof template === "string");
  });
});

describe("lib/render.mjs", () => {
  it("should render setup report", () => {
    const report = { node: { available: true, detail: "v20" }, codex: { available: true, detail: "v1" }, auth: { loggedIn: true }, reviewGateEnabled: false, actionsTaken: [], nextSteps: [] };
    const rendered = renderModule.renderSetupReport(report);
    assert.ok(rendered.includes("Kimi Setup"));
  });

  it("should render status with no jobs", () => {
    const rendered = renderModule.renderStatusReport({ running: [], latestFinished: null, recent: [] });
    assert.ok(rendered.includes("No Kimi jobs"));
  });

  it("should render cancel report", () => {
    const rendered = renderModule.renderCancelReport({ id: "job-1" });
    assert.ok(rendered.includes("cancelled"));
  });
});

describe("lib/job-control.mjs", () => {
  it("should sort jobs newest first", () => {
    const jobs = [
      { id: "a", updatedAt: "2025-01-01" },
      { id: "b", updatedAt: "2025-06-01" },
    ];
    const sorted = jcModule.sortJobsNewestFirst(jobs);
    assert.equal(sorted[0].id, "b");
  });
});

describe("kimi-companion.mjs CLI", () => {
  it("should show help", () => {
    const result = spawnSync("node", [SCRIPT, "help"], { encoding: "utf8", timeout: 10_000 });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /kimi-companion/);
  });

  it("should run setup command", () => {
    const result = spawnSync("node", [SCRIPT, "setup"], { encoding: "utf8", timeout: 10_000 });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /Kimi/);
  });

  it("should show empty status when no jobs exist", () => {
    const result = spawnSync("node", [SCRIPT, "status"], {
      encoding: "utf8",
      timeout: 10_000,
      env: { ...process.env, KIMI_PLUGIN_DATA_DIR: `/tmp/kimi-test-${Date.now()}` },
    });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /No Kimi jobs|Found/);
  });
});

const SKIP_LIVE = process.env.KIMI_SKIP_LIVE_TESTS === "1";

describe("Kimi CLI review (live)", { skip: SKIP_LIVE }, () => {
  it("should detect Kimi CLI availability", () => {
    const avail = kimiModule.getKimiAvailability(process.cwd());
    assert.equal(avail.available, true, "Kimi CLI should be available");
    assert.ok(avail.kimiPath, "Should return kimi path");
  });

  it("should run a simple prompt and get output", { timeout: 60_000 }, () => {
    const result = kimiModule.runKimiPrompt("Reply with exactly one word: YES", {
      cwd: process.cwd(),
      timeout: 30_000,
    });
    assert.equal(result.ok, true, `Prompt should succeed: ${result.error || ""}`);
    assert.ok(result.stdout);
    assert.match(result.stdout, /YES/i);
  });

  it("should parse ALLOW output", () => {
    const result = kimiModule.parseStopReviewOutput("ALLOW: no issues found\nSome detail");
    assert.equal(result.ok, true);
    assert.equal(result.reason, "no issues found");
  });

  it("should parse BLOCK output", () => {
    const result = kimiModule.parseStopReviewOutput("BLOCK: critical bug found\nDetails here");
    assert.equal(result.ok, false);
    assert.ok(result.reason.includes("critical bug found"));
  });

  it("should handle no marker as fail-closed", () => {
    const result = kimiModule.parseStopReviewOutput("Some random output without markers");
    assert.equal(result.ok, false);
  });

  it("should read default model from config", () => {
    const model = kimiModule.getDefaultModel();
    assert.ok(model);
    assert.equal(typeof model, "string");
  });

  it("should perform a real code review", { timeout: 120_000 }, () => {
    const tmpDir = path.join(process.cwd(), `.kimi-test-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    spawnSync("git", ["init"], { cwd: tmpDir });
    spawnSync("git", ["config", "user.email", "test@test.com"], { cwd: tmpDir });
    spawnSync("git", ["config", "user.name", "Test"], { cwd: tmpDir });

    const badCode = `
function getUser(id) {
  const query = "SELECT * FROM users WHERE id = " + id;
  db.execute(query);
}
`;
    fs.writeFileSync(path.join(tmpDir, "user.js"), badCode);
    spawnSync("git", ["add", "."], { cwd: tmpDir });
    spawnSync("git", ["commit", "-m", "add user module"], { cwd: tmpDir });

    const worseCode = badCode + `
function deleteUser(id) {
  db.execute("DELETE FROM users WHERE id = " + id);
}
`;
    fs.writeFileSync(path.join(tmpDir, "user.js"), worseCode);

    const result = spawnSync("node", [SCRIPT, "review"], {
      cwd: tmpDir,
      encoding: "utf8",
      timeout: 120_000,
    });

    fs.rmSync(tmpDir, { recursive: true, force: true });

    assert.equal(result.status, 0, `Review failed: ${result.stderr || result.stdout}`);
    assert.ok(result.stdout.length > 50);
  });
});
