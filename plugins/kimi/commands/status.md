---
description: Show running and recent Kimi jobs
argument-hint: '[job-id]'
allowed-tools: Bash
---

# Kimi Job Status

Check the status of Kimi background jobs for the current project.

## Execution

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/kimi-companion.mjs" status $ARGUMENTS
```

## Usage

- `/kimi:status` — List all recent jobs
- `/kimi:status task-abc123` — Get details for a specific job

## What It Shows

- Job ID and type (review, adversarial-review, task)
- Status: running, completed, failed, cancelled
- Model used
- Timestamps
