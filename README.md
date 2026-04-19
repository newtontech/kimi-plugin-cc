# Kimi Plugin for Claude Code

Use [Kimi CLI](https://github.com/MoonshotAI/kimi-cli) from inside Claude Code for code reviews or to delegate tasks.

Inspired by [openai/codex-plugin-cc](https://github.com/openai/codex-plugin-cc), this plugin provides the same functionality powered by Kimi (Moonshot AI).

## What You Get

- `/kimi:review` — Standard code review via Kimi
- `/kimi:adversarial-review` — Steerable challenge review that questions design choices
- `/kimi:rescue` — Delegate tasks to Kimi (investigation, fixes, second opinions)
- `/kimi:status`, `/kimi:result`, `/kimi:cancel` — Manage background jobs
- `/kimi:setup` — Check setup or enable/disable the review gate

## Requirements

- **Kimi CLI** installed and authenticated ([install guide](https://github.com/MoonshotAI/kimi-cli))
- **Node.js 18.18 or later**
- A Kimi account (free tier works)

## Install

Add the marketplace in Claude Code:

```bash
/plugin marketplace add newtontech/kimi-plugin-cc
```

Install the plugin:

```bash
/plugin install kimi@newtontech-kimi-plugin-cc
```

Reload plugins:

```bash
/reload-plugins
```

Then run:

```bash
/kimi:setup
```

`/kimi:setup` will tell you whether Kimi is ready. If Kimi is missing, install it from [MoonshotAI/kimi-cli](https://github.com/MoonshotAI/kimi-cli). If not logged in:

```bash
!kimi login
```

## Usage

### Code Review

```bash
/kimi:review                    # Review uncommitted changes
/kimi:review --base main        # Review branch vs main
/kimi:review --background       # Review in background
```

### Adversarial Review

```bash
/kimi:adversarial-review                                    # General adversarial review
/kimi:adversarial-review --base main challenge the design   # Challenge specific decisions
/kimi:adversarial-review --background look for race conditions
```

### Task Delegation

```bash
/kimi:rescue investigate why the tests started failing
/kimi:rescue --model kimi-k2-thinking analyze the race condition
/kimi:rescue --background fix the flaky integration test
```

### Job Management

```bash
/kimi:status              # List recent jobs
/kimi:status task-abc123  # Check specific job
/kimi:result              # Show latest result
/kimi:cancel              # Cancel running job
```

### Review Gate (Auto-Review on Stop)

```bash
/kimi:setup --enable-review-gate   # Enable auto-review when Claude stops
/kimi:setup --disable-review-gate  # Disable
```

When the review gate is enabled, Kimi automatically reviews code changes when Claude finishes a turn. If issues are found, Claude's stop is blocked so it can address them.

> **Warning**: The review gate may consume API quota quickly. Only enable when actively monitoring.

## Kimi Integration

The plugin wraps the Kimi CLI using non-interactive mode:

```bash
kimi --print --final-message-only --prompt "review this code"
```

It uses your local `kimi` binary and shares the same authentication and configuration (`~/.kimi/config.toml`).

### Model Configuration

Default model is read from `~/.kimi/config.toml`. Override per-command with `--model`:

```bash
/kimi:review --model kimi-k2-thinking       # Deep reasoning
/kimi:rescue --model kimi-k2-thinking-turbo  # Faster deep reasoning
```

Supported models:
- `kimi-for-coding` — Default coding model (fast)
- `kimi-k2-thinking` — Deep reasoning mode
- `kimi-k2-thinking-turbo` — Faster reasoning
- `kimi-k2.6-preview` — Latest preview with multimodal support

## Comparison with codex-plugin-cc

| Feature | codex-plugin-cc | kimi-plugin-cc |
|---------|----------------|----------------|
| Code Review | Built-in `codex review` | Prompt-based via `kimi --print` |
| Adversarial Review | Yes | Yes |
| Task Delegation | Via app server | Via CLI `--print` mode |
| Stop Hook (Review Gate) | Yes | Yes |
| Background Jobs | Via app server | Via child process tracking |
| Model Selection | `--model` | `--model` |
| Config | `~/.codex/config.toml` | `~/.kimi/config.toml` |

## License

MIT
