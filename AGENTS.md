# Agent Development Guide — kimi-plugin-cc

> How to develop, modify, and maintain this Claude Code plugin.
> Principles: **YAGNI** · **KISS** · **SOLID** · **DRY**

---

## 1. Project Overview

This is a **Claude Code plugin** that bridges Kimi CLI into Claude Code slash commands, hooks, and agents.

- **Language**: Node.js 18+ (ES Modules, no transpile step)
- **Test framework**: `node:test` (built-in, zero deps)
- **Plugin system**: Anthropic Claude Code plugin manifest v1
- **Runtime**: Wraps local `kimi` binary via `child_process.spawn`

---

## 2. Architecture

```
.claude-plugin/marketplace.json     → Marketplace manifest (plugin catalog entry)
plugins/kimi/.claude-plugin/        → Plugin manifest
plugins/kimi/commands/              → Slash command definitions (*.md)
plugins/kimi/agents/                → Subagent prompts (*.md)
plugins/kimi/hooks/                 → Hook definitions (SessionStart, SessionEnd, Stop)
plugins/kimi/prompts/               → Prompt templates (*.md)
plugins/kimi/schemas/               → JSON schemas for structured output
plugins/kimi/scripts/               → Executable Node.js scripts
  ├── kimi-companion.mjs            → Main CLI entry (review, rescue, status, etc.)
  ├── stop-review-gate-hook.mjs     → Stop hook runner
  ├── session-lifecycle-hook.mjs    → Session start/end hooks
  └── lib/                          → Pure modules (no side effects)
      ├── kimi.mjs                  → Kimi CLI spawning, config parsing
      ├── git.mjs                   → Git diff/status collection
      ├── state.mjs                 → Job persistence (JSON files)
      ├── args.mjs                  → CLI argument parsing
      └── tracked-jobs.mjs          → Background process tracking
tests/                              → Integration tests (*.test.mjs)
scripts/                            → Repo maintenance scripts
  └── bump-version.mjs              → Sync version across all manifests
```

### Design Rules

| Principle | Rule |
|-----------|------|
| **YAGNI** | Do not add CLI flags, config options, or hooks "just in case". Wait for a real user request. |
| **KISS** | Prefer `spawnSync` over async orchestration. Prefer string templates over templating engines. One file = one responsibility. |
| **SOLID** | `lib/*.mjs` modules are pure. `kimi-companion.mjs` is the only coordinator. Hooks are thin wrappers. |
| **DRY** | Version lives in `package.json` only. `bump-version.mjs` propagates it. Prompt templates are reused across commands and hooks. |

---

## 3. File Conventions

### Scripts (`*.mjs`)

- Use **ES Modules** (`"type": "module"`).
- Prefer `node:fs`, `node:path`, `node:child_process` over third-party packages.
- Top-level `await` is allowed in scripts, **not** in `lib/*.mjs` (keep lib synchronous where possible).
- Exit codes: `0` = success, `1` = user error / CLI failure. Do not crash on expected errors (e.g., Kimi not installed).

### Commands (`commands/*.md`)

- Front matter is required:
  ```yaml
  ---
  description: Short text shown in /help
  argument-hint: '[--flag] <arg>'
  allowed-tools: Read, Bash(node:*), Bash(git:*)
  ---
  ```
- Body must contain an `## Execution` section with the exact Bash snippet.
- Use `"${CLAUDE_PLUGIN_ROOT}/scripts/..."` for script paths.

### Prompts (`prompts/*.md`)

- Keep prompts in plain Markdown. No YAML front matter.
- Use `{{PLACEHOLDER}}` for runtime substitution (replaced in scripts via `String.replace`).
- One prompt = one file. Do not concatenate prompts in code.

---

## 4. Making Changes

### Adding a new slash command

1. Create `plugins/kimi/commands/<name>.md` with front matter + execution section.
2. Add handler in `kimi-companion.mjs` switch statement.
3. If it needs a prompt, add `plugins/kimi/prompts/<name>.md`.
4. Add test in `tests/integration.test.mjs` (at minimum: invoke without crash).
5. Run `npm test` locally.
6. Run `npm run check-version`.

### Adding a hook

1. Edit `plugins/kimi/hooks/hooks.json`. Keep timeout conservative (Stop hooks ≤ 10 min, lifecycle hooks ≤ 5 sec).
2. Create/modify the hook script in `plugins/kimi/scripts/`.
3. Hooks must be **fail-open**: if Kimi is unavailable, log a note and return `0`. Never block Claude on plugin errors.

### Modifying the marketplace or plugin manifest

1. Edit `.claude-plugin/marketplace.json` or `plugins/kimi/.claude-plugin/plugin.json`.
2. Run `claude plugin validate .` to verify schema compliance.
3. Run `claude plugin validate plugins/kimi` to verify plugin manifest.
4. If version changed, run `node scripts/bump-version.mjs <version>` to sync all files.

---

## 5. Testing

```bash
# Run all tests (skips live Kimi CLI test unless env var is unset)
npm test

# Run with live Kimi review (slow, requires `kimi login`)
unset KIMI_SKIP_LIVE_TESTS && npm test

# Validate manifests
claude plugin validate .
claude plugin validate plugins/kimi
```

### Test Guidelines

- **DRY**: Reuse `SCRIPT` and `LIB_DIR` constants from `integration.test.mjs`.
- **Isolation**: Tests write to temp dirs (`/tmp/kimi-test-*`) or use `KIMI_PLUGIN_DATA_DIR`.
- **No network mocks**: Unit tests exercise real `git` and `node:fs`. Live tests exercise real `kimi` CLI.
- **Assertions must actually assert**: Never use `|| true` in `assert.ok()`. Each assertion must test a real condition.

---

## 6. Version & Release

```bash
# Bump version across all manifests
npm run bump-version 0.0.2

# Verify sync
npm run check-version

# Commit, tag, push
git add -A && git commit -m "chore: bump version to 0.0.2"
git tag -a v0.0.2 -m "Release v0.0.2"
git push origin main --follow-tags

# Create GitHub Release
gh release create v0.0.2 --title "v0.0.2" --notes "..."
```

### Version Sync Targets

- `package.json`
- `package-lock.json`
- `plugins/kimi/.claude-plugin/plugin.json`
- `.claude-plugin/marketplace.json` (`metadata.version` + `plugins[kimi].version`)

---

## 7. CI / CD

GitHub Actions runs on every PR:

1. `npm ci`
2. `pip install kimi-cli`
3. `KIMI_SKIP_LIVE_TESTS=1 npm test`
4. `npm run check-version`

Do not add steps that require secrets (API keys, tokens) unless there is a dedicated `workflow_dispatch` job.

---

## 8. Common Pitfalls

| Pitfall | Why | Fix |
|---------|-----|-----|
| Adding `"any"` types | Loses TypeScript safety in Claude Code context | Use explicit types; avoid `any` |
| Forgetting `env: KIMI_SKIP_LIVE_TESTS` in CI | PR CI fails on live test | Already set in workflow; don't remove |
| Editing version in one file only | Marketplace / plugin desync | Always use `bump-version.mjs` |
| Blocking hooks on plugin errors | Breaks Claude Code stop flow | Fail-open: log + return `0` |
| Long Stop hook timeouts | Blocks Claude indefinitely | Max 10 min (`600_000` ms) |
| Child process leaks | `handleCancel` doesn't kill `child` | Use `child.kill()` when cancelling |

---

## 9. Dependency Policy

- **Zero runtime dependencies**. This project has no `dependencies` in `package.json`.
- Node.js built-ins only: `fs`, `path`, `child_process`, `crypto`, `util`.
- If you think you need a package, you probably don't. Write 10 lines of native code instead.

---

## License

MIT
