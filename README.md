# auto-pause

A Claude Code plugin that watches your 5-hour and weekly usage. Shortly before you hit the limit, it gets Claude to stop at a safe point, write a handoff file, and give you a resume prompt to paste into a new session after the reset.

Status: in development. The plugin installs but does nothing yet. [PLAN.md](PLAN.md) has the design and [docs/phase0-results.md](docs/phase0-results.md) has what was verified in the Claude Desktop app so far.

## Why

With `autoContinueAtUsageLimit` on (the default), Claude Code waits at the limit and then continues the same session. By then the one-hour prompt cache has expired, so the first turn after the reset sends the whole old conversation again, uncached. Writing a handoff while the cache is still warm and starting fresh is cheaper.

## Requirements

- Claude Code 2.1.299 or later: the terminal CLI, the Code tab of the Claude Desktop app (local sessions), or VS Code
- A Claude Pro or Max plan. The usage figures come from the subscription, so API-key and Team/Enterprise seats get no data.

## Install

In a terminal:

```bash
claude plugin marketplace add k45sle/Claude-auto-pause
```

```bash
claude plugin install auto-pause@k45sle --scope user
```

In the Desktop app you can instead open **+ → Add plugins** in a Code session after adding the marketplace, and install `auto-pause` at User scope.

## Recommended setting

Since you resume by hand, turn off the built-in auto-continue in `~/.claude/settings.json`:

```json
{ "autoContinueAtUsageLimit": false }
```

The trade-off: if the limit hits before the handoff is written, nothing finishes it for you. Go back to the old session after the reset and ask it to finish the handoff.

## Uninstall

```bash
claude plugin uninstall auto-pause@k45sle --scope user
```

```bash
claude plugin marketplace remove k45sle
```

## License

MIT
