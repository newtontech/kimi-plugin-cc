---
description: Delegate a task to Kimi CLI for investigation or fixes
argument-hint: '[--background|--wait] [--model <m>] [--resume|--fresh] <task description>'
allowed-tools: Bash
---

# Kimi Rescue

Hand a task to Kimi for investigation, bug fixing, or a second opinion.

## Execution

Use the Kimi rescue subagent to delegate the task:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/kimi-companion.mjs" task -- $ARGUMENTS
```

Alternatively, the user can just ask: "Ask Kimi to investigate the failing test."

## When to Use

- Claude is stuck and wants a second pass
- Need a diagnosis or root-cause investigation
- Want a faster/cheaper pass with a smaller model
- Want to try a different approach to the same problem

## Options

- `--background` — Run in background
- `--model <model>` — Use a specific Kimi model (e.g., `kimi-k2-thinking`)
- `--resume` — Continue the latest Kimi task for this repo
- `--fresh` — Start a new task (don't resume)

## Examples

- `/kimi:rescue investigate why the tests started failing`
- `/kimi:rescue --model kimi-k2-thinking analyze the race condition in worker.js`
- `/kimi:rescue --background fix the flaky integration test`
