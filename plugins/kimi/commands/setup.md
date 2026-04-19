---
description: Check Kimi CLI setup or enable/disable the review gate
argument-hint: '[--enable-review-gate|--disable-review-gate]'
allowed-tools: Bash
---

# Kimi Setup

Check whether Kimi CLI is installed and authenticated, or manage the review gate.

## Execution

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/kimi-companion.mjs" setup $ARGUMENTS
```

## Options

- (no flags) — Check setup status
- `--enable-review-gate` — Enable automatic Kimi review when Claude stops
- `--disable-review-gate` — Disable the automatic review gate

## First-Time Setup

1. Install Kimi CLI: follow https://github.com/MoonshotAI/kimi-cli
2. Authenticate: run `!kimi login` from Claude Code
3. Verify: run `/kimi:setup`

## Review Gate

When the review gate is enabled, Kimi will automatically review code changes
when Claude finishes a turn. If issues are found, Claude's stop is blocked
so it can address them first.

**Warning**: The review gate may consume Kimi API quota quickly. Only enable
when actively monitoring.
