---
description: Run a Kimi code review against local git state
argument-hint: '[--wait|--background] [--base <ref>]'
allowed-tools: Read, Glob, Grep, Bash(node:*), Bash(git:*), AskUserQuestion
---

# Kimi Code Review

Run a code review using Kimi CLI on your current work.

## Execution

Run the review via the companion script:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/kimi-companion.mjs" review $ARGUMENTS
```

## Behavior

1. Collects the current git diff (unstaged + staged changes, or branch diff if `--base` is given)
2. Sends the diff to Kimi for a structured code review
3. Returns findings with severity levels (critical/high/medium/low)

## Options

- `--base <ref>` — Compare against a base branch (e.g., `--base main`)
- `--background` — Run the review in the background; check with `/kimi:status`
- `--wait` — Wait for the review to complete (default behavior)
- `--model <model>` — Override the default Kimi model

## Examples

- `/kimi:review` — Review current uncommitted changes
- `/kimi:review --base main` — Review all changes on this branch vs main
- `/kimi:review --background` — Start review in background
