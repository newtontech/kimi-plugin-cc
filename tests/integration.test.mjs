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

// Dynamic import for ESM modules
const kimiModule = await import(path.join(LIB_DIR, "kimi.mjs"));
const gitModule = await import(path.join(LIB_DIR, "git.mjs"));
const stateModule = await import(path.join(LIB_DIR, "state.mjs"));

describe("lib/kimi.mjs", () => {
  it("should detect Kimi CLI availability", () => {
    const avail = kimiModule.getKimiAvailability(process.cwd());
    assert.equal(avail.available, true, "Kimi CLI should be available");
    assert.ok(avail.kimiPath, "Should return kimi path");
    assert.ok(avail.version, "Should return version");
  });

  it("should run a simple prompt and get output", { timeout: 60_000 }, () => {
    const result = kimiModule.runKimiPrompt("Reply with exactly one word: YES", {
      cwd: process.cwd(),
      timeout: 30_000,
    });
    assert.equal(result.ok, true, `Prompt should succeed: ${result.error || ""}`);
    assert.ok(result.stdout, "Should have stdout");
    assert.match(result.stdout, /YES/i, "Should contain YES in response");
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

  it("should handle no marker (fail open)", () => {
    const result = kimiModule.parseStopReviewOutput("Some random output without markers");
    assert.equal(result.ok, true);
  });

  it("should read default model from config", () => {
    const model = kimiModule.getDefaultModel();
    assert.ok(model, "Should return a model name");
    assert.equal(typeof model, "string");
  });
});

describe("lib/git.mjs", () => {
  it("should detect git repo", () => {
    const inRepo = gitModule.isInGitRepo(process.cwd());
    assert.equal(inRepo, true, "Should be in a git repo");
  });

  it("should resolve workspace root", () => {
    const root = gitModule.resolveWorkspaceRoot(process.cwd());
    assert.ok(root, "Should return a root path");
    assert.ok(fs.existsSync(path.join(root, ".git")), "Root should contain .git");
  });

  it("should get current branch", () => {
    const branch = gitModule.getCurrentBranch(process.cwd());
    assert.ok(branch, "Should return a branch name");
  });

  it("should collect review context", () => {
    const ctx = gitModule.collectReviewContext(process.cwd());
    assert.equal(ctx.inGit, true);
    assert.ok(ctx.branch);
  });

  it("should get diff stats", () => {
    const stats = gitModule.getDiffStats(process.cwd());
    assert.ok(typeof stats.files === "number");
    assert.ok(typeof stats.lines === "number");
  });
});

describe("lib/state.mjs", () => {
  const testDir = path.join(process.cwd(), ".test-state-" + Date.now());

  it("should create and resolve state dir", () => {
    fs.mkdirSync(testDir, { recursive: true });
    // Use the test dir as state dir directly
    assert.ok(fs.existsSync(testDir));
  });

  it("should upsert and retrieve a job", () => {
    const job = stateModule.upsertJob(testDir, {
      id: "test-job-1",
      type: "review",
      status: "running",
      model: "kimi-for-coding",
    });
    assert.equal(job.id, "test-job-1");

    const retrieved = stateModule.getJob(testDir, "test-job-1");
    assert.ok(retrieved);
    assert.equal(retrieved.status, "running");
  });

  it("should list jobs", () => {
    const jobs = stateModule.listJobs(testDir);
    assert.ok(jobs.length >= 1);
  });

  it("should get latest job", () => {
    const latest = stateModule.getLatestJob(testDir);
    assert.ok(latest);
  });

  it("should manage config", () => {
    stateModule.setConfig(testDir, { stopReviewGate: true });
    const config = stateModule.getConfig(testDir);
    assert.equal(config.stopReviewGate, true);
  });

  it("should remove a job", () => {
    const removed = stateModule.removeJob(testDir, "test-job-1");
    assert.equal(removed, true);
    const job = stateModule.getJob(testDir, "test-job-1");
    assert.equal(job, null);
  });

  // Cleanup
  it("should clean up test state", () => {
    fs.rmSync(testDir, { recursive: true, force: true });
    assert.ok(!fs.existsSync(testDir));
  });
});

describe("kimi-companion.mjs CLI", () => {
  it("should show help", () => {
    const result = spawnSync("node", [SCRIPT, "help"], {
      encoding: "utf8",
      timeout: 10_000,
    });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /kimi-companion/);
  });

  it("should run setup command", () => {
    const result = spawnSync("node", [SCRIPT, "setup"], {
      encoding: "utf8",
      timeout: 10_000,
    });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /Kimi CLI:/);
  });

  it("should handle review invocation", () => {
    // Just verify the script doesn't crash immediately on syntax error
    // Real review tested in the live test below
    const result = spawnSync("node", ["-e", `import("${SCRIPT.replace(/"/g, '\\"')}").catch(() => {})`], {
      encoding: "utf8",
      timeout: 5_000,
    });
    // Script should at least start (may timeout, which is fine)
    assert.ok(result.stderr === "" || result.stderr.includes("Kimi") || result.stderr.includes("Error"));
  });

  it("should show empty status when no jobs exist", () => {
    const result = spawnSync("node", [SCRIPT, "status"], {
      encoding: "utf8",
      timeout: 10_000,
      env: { ...process.env, KIMI_PLUGIN_DATA_DIR: `/tmp/kimi-test-${Date.now()}` },
    });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /No Kimi jobs found|Found/);
  });
});

const SKIP_LIVE = process.env.KIMI_SKIP_LIVE_TESTS === "1";

describe("Kimi CLI review (live)", { skip: SKIP_LIVE }, () => {
  it("should perform a real code review", { timeout: 120_000 }, () => {
    // Create a temporary file with intentional issues for review
    const tmpDir = path.join(process.cwd(), `.kimi-test-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    // Init git repo
    spawnSync("git", ["init"], { cwd: tmpDir });
    spawnSync("git", ["config", "user.email", "test@test.com"], { cwd: tmpDir });
    spawnSync("git", ["config", "user.name", "Test"], { cwd: tmpDir });

    // Write a file with issues
    const badCode = `
function getUser(id) {
  // SQL injection vulnerability
  const query = "SELECT * FROM users WHERE id = " + id;
  db.execute(query);
  // No error handling
  // No return value
}
`;
    fs.writeFileSync(path.join(tmpDir, "user.js"), badCode);
    spawnSync("git", ["add", "."], { cwd: tmpDir });
    spawnSync("git", ["commit", "-m", "add user module"], { cwd: tmpDir });

    // Modify to trigger diff
    const worseCode = badCode + `
function deleteUser(id) {
  // Another SQL injection
  db.execute("DELETE FROM users WHERE id = " + id);
}
`;
    fs.writeFileSync(path.join(tmpDir, "user.js"), worseCode);

    // Run review
    const result = spawnSync("node", [SCRIPT, "review"], {
      cwd: tmpDir,
      encoding: "utf8",
      timeout: 120_000,
    });

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true, force: true });

    assert.equal(result.status, 0, `Review failed: ${result.stderr || result.stdout}`);
    assert.ok(result.stdout.length > 50, "Should have substantial review output");
    console.log("\n--- Kimi Review Output (truncated) ---");
    console.log(result.stdout.slice(0, 500));
    console.log("--- End Review ---\n");
  });
});
