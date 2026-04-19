import { runCommand } from "./process.mjs";

export function resolveWorkspaceRoot(cwd) {
  const result = runCommand("git", ["rev-parse", "--show-toplevel"], { cwd });
  if (result.status !== 0) return cwd;
  return result.stdout.trim();
}

export function isInGitRepo(cwd) {
  const result = runCommand("git", ["rev-parse", "--is-inside-work-tree"], { cwd });
  return result.status === 0 && result.stdout.trim() === "true";
}

export function ensureGitRepository(cwd) {
  if (!isInGitRepo(cwd)) {
    throw new Error("Not inside a git repository. Run this command from a git project.");
  }
}

export function getGitStatus(cwd) {
  const result = runCommand("git", ["status", "--porcelain"], { cwd });
  return result.status === 0 ? result.stdout.trim() : "";
}

export function getGitDiff(cwd, baseRef) {
  if (baseRef) {
    validateGitRef(baseRef);
    const result = runCommand("git", ["diff", `${baseRef}...HEAD`], { cwd });
    return result.status === 0 ? result.stdout.trim() : "";
  }

  return runCommand("git", ["diff", "HEAD"], { cwd }).stdout.trim();
}

export function getRecentCommits(cwd, count = 5) {
  const result = runCommand("git", ["log", `--max-count=${count}`, "--oneline"], { cwd });
  return result.status === 0 ? result.stdout.trim() : "";
}

export function getCurrentBranch(cwd) {
  const result = runCommand("git", ["branch", "--show-current"], { cwd });
  return result.status === 0 ? result.stdout.trim() : "HEAD";
}

export function collectReviewContext(cwd, baseRef) {
  if (!isInGitRepo(cwd)) {
    return { inGit: false, status: "", diff: "", branch: "", commits: "", baseRef: null };
  }

  return {
    inGit: true,
    status: getGitStatus(cwd),
    diff: getGitDiff(cwd, baseRef),
    branch: getCurrentBranch(cwd),
    commits: getRecentCommits(cwd),
    baseRef: baseRef || null,
  };
}

export function getDiffStats(cwd, baseRef) {
  const diff = getGitDiff(cwd, baseRef);
  if (!diff) return { files: 0, lines: 0 };

  const files = new Set();
  let lines = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ") || line.startsWith("--- ")) {
      const stripped = line.replace(/^[+-]+\s+/, "").replace(/^(a|b)\//, "").trim();
      if (stripped && stripped !== "/dev/null") files.add(stripped);
    }
    if (line.startsWith("+") && !line.startsWith("+++")) lines++;
    if (line.startsWith("-") && !line.startsWith("---")) lines++;
  }

  return { files: files.size, lines };
}

export function resolveReviewTarget(cwd, options = {}) {
  const scope = options.scope || "auto";
  const base = options.base || null;

  ensureGitRepository(cwd);

  if (scope === "working-tree" || (!base && scope === "auto")) {
    const diff = getGitDiff(cwd);
    if (diff) {
      return { mode: "working-tree", label: "working tree", baseRef: null };
    }
  }

  if (base) {
    validateGitRef(base);
    return { mode: "branch", label: `${base}...HEAD`, baseRef: base };
  }

  const detectedBase = detectDefaultBranch(cwd);
  if (detectedBase) {
    return { mode: "branch", label: `${detectedBase}...HEAD`, baseRef: detectedBase };
  }

  return { mode: "working-tree", label: "working tree", baseRef: null };
}

function validateGitRef(ref) {
  if (!/^[a-zA-Z0-9._\/-]+$/.test(ref)) {
    throw new Error(`Invalid git ref: "${ref}". Only alphanumeric, dots, dashes, slashes, and underscores allowed.`);
  }
}

function detectDefaultBranch(cwd) {
  const result = runCommand("git", ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], { cwd });
  if (result.status === 0) {
    const name = result.stdout.trim().replace(/^origin\//, "");
    if (name) return name;
  }

  for (const candidate of ["main", "master", "trunk"]) {
    const r = runCommand("git", ["rev-parse", "--verify", `origin/${candidate}`], { cwd });
    if (r.status === 0) return candidate;
  }

  return null;
}
