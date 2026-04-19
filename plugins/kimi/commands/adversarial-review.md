---
description: Run a steerable adversarial review that challenges design choices
argument-hint: '[--wait|--background] [--base <ref>] [focus text]'
allowed-tools: Read, Glob, Grep, Bash(node:*), Bash(git:*), AskUserQuestion
---

# Kimi Adversarial Review

Run an adversarial code review using Kimi CLI that actively challenges implementation and design decisions.

## Execution

Run the adversarial review via the companion script:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/kimi-companion.mjs" adversarial-review $ARGUMENTS
```

## When to Use

- Before shipping: challenge the direction, not just code details
- Review focused on design choices, tradeoffs, hidden assumptions
- Pressure-testing specific risk areas (auth, data loss, race conditions)

## Options

- `--base <ref>` — Compare against a base branch
- `--background` — Run in background
- `--model <model>` — Override default model

Any text after the flags becomes the focus area for the review.

## Examples

- `/kimi:adversarial-review` — General adversarial review
- `/kimi:adversarial-review --base main challenge whether the caching design is correct`
- `/kimi:adversarial-review --background look for race conditions`
