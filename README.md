# Kimi Plugin for Claude Code

Use [Kimi CLI](https://github.com/MoonshotAI/kimi-cli) from inside Claude Code for code reviews or to delegate tasks.

This plugin is for Claude Code users who want an easy way to start using Kimi from the workflow they already have.

## What You Get

- `/kimi:review` for a normal read-only Kimi code review
- `/kimi:adversarial-review` for a steerable challenge review
- `/kimi:rescue`, `/kimi:status`, `/kimi:result`, and `/kimi:cancel` to delegate work and manage background jobs
- `/kimi:setup` to check setup or enable/disable the review gate

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

After install, you should see:

- the slash commands listed below
- the `kimi:kimi-rescue` subagent in `/agents`

One simple first run is:

```bash
/kimi:review --background
/kimi:status
/kimi:result
```

## Usage

### `/kimi:review`

Runs a normal Kimi review on your current work.

> [!NOTE]
> Code review especially for multi-file changes might take a while. It's generally recommended to run it in the background.

Use it when you want:

- a review of your current uncommitted changes
- a review of your branch compared to a base branch like `main`

Use `--base <ref>` for branch review. It also supports `--wait` and `--background`. It is not steerable and does not take custom focus text. Use [`/kimi:adversarial-review`](#kimiadversarial-review) when you want to challenge a specific decision or risk area.

Examples:

```bash
/kimi:review
/kimi:review --base main
/kimi:review --background
```

This command is read-only and will not perform any changes. When run in the background you can use [`/kimi:status`](#kimistatus) to check on the progress and [`/kimi:cancel`](#kimicancel) to cancel the ongoing task.

### `/kimi:adversarial-review`

Runs a **steerable** review that questions the chosen implementation and design.

It can be used to pressure-test assumptions, tradeoffs, failure modes, and whether a different approach would have been safer or simpler.

It uses the same review target selection as `/kimi:review`, including `--base <ref>` for branch review. It also supports `--wait` and `--background`. Unlike `/kimi:review`, it can take extra focus text after the flags.

Use it when you want:

- a review before shipping that challenges the direction, not just the code details
- review focused on design choices, tradeoffs, hidden assumptions, and alternative approaches
- pressure-testing around specific risk areas like auth, data loss, rollback, race conditions, or reliability

Examples:

```bash
/kimi:adversarial-review
/kimi:adversarial-review --base main challenge whether this was the right caching and retry design
/kimi:adversarial-review --background look for race conditions and question the chosen approach
```

This command is read-only. It does not fix code.

### `/kimi:rescue`

Hands a task to Kimi through the `kimi:kimi-rescue` subagent.

Use it when you want Kimi to:

- investigate a bug
- try a fix
- continue a previous Kimi task
- take a faster pass with a smaller model

> [!NOTE]
> Depending on the task and the model you choose these tasks might take a long time and it's generally recommended to force the task to be in the background or move the agent to the background.

It supports `--background`, `--wait`, and `--model`. If you omit `--model`, the plugin uses your default Kimi model.

Examples:

```bash
/kimi:rescue investigate why the tests started failing
/kimi:rescue fix the failing test with the smallest safe patch
/kimi:rescue --model kimi-k2-thinking analyze the race condition
/kimi:rescue --background fix the flaky integration test
```

You can also just ask for a task to be delegated to Kimi:

```text
Ask Kimi to redesign the database connection to be more resilient.
```

**Notes:**

- if you do not pass `--model`, Kimi uses your default model from `~/.kimi/config.toml`.
- follow-up rescue requests can continue the latest Kimi task in the repo

### `/kimi:status`

Shows running and recent Kimi jobs for the current repository.

Examples:

```bash
/kimi:status
/kimi:status task-abc123
```

Use it to:

- check progress on background work
- see the latest completed job
- confirm whether a task is still running

### `/kimi:result`

Shows the final stored Kimi output for a finished job.

Examples:

```bash
/kimi:result
/kimi:result task-abc123
```

### `/kimi:cancel`

Cancels an active background Kimi job.

Examples:

```bash
/kimi:cancel
/kimi:cancel task-abc123
```

### `/kimi:setup`

Checks whether Kimi is installed and authenticated.

You can also use `/kimi:setup` to manage the optional review gate.

#### Enabling review gate

```bash
/kimi:setup --enable-review-gate
/kimi:setup --disable-review-gate
```

When the review gate is enabled, the plugin uses a `Stop` hook to run a targeted Kimi review based on Claude's response. If that review finds issues, the stop is blocked so Claude can address them first.

> [!WARNING]
> The review gate can create a long-running Claude/Kimi loop and may consume API quota quickly. Only enable it when you plan to actively monitor the session.

## Typical Flows

### Review Before Shipping

```bash
/kimi:review
```

### Hand A Problem To Kimi

```bash
/kimi:rescue investigate why the build is failing in CI
```

### Start Something Long-Running

```bash
/kimi:adversarial-review --background
/kimi:rescue --background investigate the flaky test
```

Then check in with:

```bash
/kimi:status
/kimi:result
```

## Kimi Integration

The Kimi plugin wraps the Kimi CLI using non-interactive mode:

```bash
kimi --print --final-message-only --prompt "review this code"
```

It uses your local `kimi` binary and shares the same authentication and configuration (`~/.kimi/config.toml`).

### Common Configurations

If you want to change the default model that gets used by the plugin, you can define that inside your user-level `~/.kimi/config.toml`. For example to always use `kimi-k2-thinking` you can add:

```toml
model = "kimi-k2-thinking"
```

Your configuration will be picked up based on:

- user-level config in `~/.kimi/config.toml`

Check out the Kimi CLI docs for more configuration options.

### Model Selection

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

## FAQ

### Do I need a separate Kimi account for this plugin?

If you are already signed into Kimi CLI on this machine, that account should work immediately here too. This plugin uses your local Kimi CLI authentication.

If you only use Claude Code today and have not used Kimi CLI yet, you will also need to sign in. Run `/kimi:setup` to check whether Kimi is ready, and use `!kimi login` if it is not.

### Does the plugin use a separate Kimi runtime?

No. This plugin delegates through your local [Kimi CLI](https://github.com/MoonshotAI/kimi-cli) on the same machine.

That means:

- it uses the same Kimi install you would use directly
- it uses the same local authentication state
- it uses the same repository checkout and machine-local environment

### Will it use the same Kimi config I already have?

Yes. If you already use Kimi CLI, the plugin picks up the same [configuration](#common-configurations).

### Can I keep using my current API key or base URL setup?

Yes. Because the plugin uses your local Kimi CLI, your existing sign-in method and config still apply.

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
