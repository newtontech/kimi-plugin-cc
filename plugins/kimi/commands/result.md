---
description: Show the result of a completed Kimi job
argument-hint: '[job-id]'
allowed-tools: Bash
---

# Kimi Job Result

Show the output of a completed Kimi job.

## Execution

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/kimi-companion.mjs" result $ARGUMENTS
```

## Usage

- `/kimi:result` — Show the latest job's result
- `/kimi:result task-abc123` — Show a specific job's result

## Output

Displays the full Kimi output for the job, including:
- Review findings (for review jobs)
- Task output (for rescue jobs)
- Error details (for failed jobs)
