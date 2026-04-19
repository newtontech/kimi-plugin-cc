---
description: Cancel a running Kimi background job
argument-hint: '[job-id]'
allowed-tools: Bash
---

# Cancel Kimi Job

Cancel an active background Kimi job.

## Execution

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/kimi-companion.mjs" cancel $ARGUMENTS
```

## Usage

- `/kimi:cancel` — Cancel the latest running job
- `/kimi:cancel task-abc123` — Cancel a specific job
