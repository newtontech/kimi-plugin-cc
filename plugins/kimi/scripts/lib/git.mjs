import { spawnSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

export function resolveWorkspaceRoot(cwd) {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    encoding: "utf8",
    timeout: 5000,
  });
  if (result.status !== 0) return cwd;
  return result.stdout.trim();
}

export function isInGitRepo(cwd) {
  const result = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd,
    encoding: "utf8",
    timeout: 5000,
  });
  return result.status === 0 && result.stdout.trim() === "true";
}

export function getGitStatus(cwd) {
  const result = spawnSync("git", ["status", "--porcelain"], {
    cwd,
    encoding: "utf8",
    timeout: 10000,
  });
  return result.status === 0 ? result.stdout.trim() : "";
}

export function getGitDiff(cwd, baseRef) {
  if (baseRef) {
    const result = spawnSync("git", ["diff", `${baseRef}...HEAD`], {
      cwd,
      encoding: "utf8",
      timeout: 30000,
    });
    return result.status === 0 ? result.stdout.trim() : "";
  }

  const staged = spawnSync("git", ["diff", "--cached"], {
    cwd,
    encoding: "utf8",
    timeout: 30000,
  });

  const unstaged = spawnSync("git", ["diff"], {
    cwd,
    encoding: "utf8",
    timeout: 30000,
  });

  const stagedOut = staged.status === 0 ? staged.stdout.trim() : "";
  const unstagedOut = unstaged.status === 0 ? unstaged.stdout.trim() : "";

  return [stagedOut, unstagedOut].filter(Boolean).join("\n");
}

export function getRecentCommits(cwd, count = 5) {
  const result = spawnSync("git", ["log", `--max-count=${count}`, "--oneline"], {
    cwd,
    encoding: "utf8",
    timeout: 10000,
  });
  return result.status === 0 ? result.stdout.trim() : "";
}

export function getCurrentBranch(cwd) {
  const result = spawnSync("git", ["branch", "--show-current"], {
    cwd,
    encoding: "utf8",
    timeout: 5000,
  });
  return result.status === 0 ? result.stdout.trim() : "HEAD";
}

export function collectReviewContext(cwd, baseRef) {
  if (!isInGitRepo(cwd)) {
    return { inGit: false, status: "", diff: "", branch: "", commits: "" };
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
      const filePath = line.replace(/^[+-]+\s+(a\/)?/, "").trim();
      if (filePath !== "/dev/null") files.add(filePath);
    }
    if (line.startsWith("+") && !line.startsWith("+++")) lines++;
    if (line.startsWith("-") && !line.startsWith("---")) lines++;
  }

  return { files: files.size, lines };
}
