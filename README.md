# auto-pause

A Claude Code plugin that watches your 5-hour and weekly usage. Shortly before you hit the limit, it gets Claude to stop at a safe point, write a handoff file, and give you a resume prompt to paste into a new session after the reset.

Status: in development (pre-0.1.0). [PLAN.md](PLAN.md) has the design, `docs/phase*-results.md` has what was tested in each phase, and [docs/competitor-review.md](docs/competitor-review.md) compares it with similar plugins.

## What it does

1. At 15% left in the 5-hour window (10% weekly) it adds a warning to the next tool result.
2. At 8% left (3% weekly) it tells Claude to finish or revert the current step and write a handoff to an exact path in `.handoffs/`. That path and a resume prompt with absolute paths are in the notice. Subagents are told to return, and new ones are refused.
3. After 5 more tool calls, or 3 more usage points, every tool is refused except the handoff, reads, and read-only git.
4. When Claude writes the handoff, the plugin checks it: the resume prompt is there verbatim, the required sections exist, the current commit and every uncommitted file are named, it fits the word budget, and nothing looks like a secret. A valid handoff opens the gate and Claude ends its turn with the resume prompt.
5. Once the handoff passes, the plugin adds a "Session facts" section at the end: your last few messages, word for word, and the files Claude edited. It reads these from the session, so no model call is spent, and the next session works from what you asked for rather than Claude's summary of it.
6. If Claude ends the turn twice without a valid handoff, or the limit hits first, the plugin writes a facts-only handoff itself (last request, edited files, branch, commit, uncommitted files) and sends a desktop notification. This needs no model call.

The resume prompt tells the new session to compare `git status` and the current commit with the handoff and tell you before editing if they differ. It also tells it to ask you before doing anything outside the handoff's Goal.

The pause is saved per session, so `/reload-plugins` or a plugin update mid-pause keeps it. After three failed checks the gate opens anyway, so a session never stays locked.

`/auto-pause-status` shows the state, the latest resume prompt for this folder, and the calibration log (outcome and usage cost of each pause). `/auto-pause-status release` opens the gate by hand and logs it as an override.

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

The trade-off: if the limit hits before Claude writes the handoff, you get only the facts-only handoff. Go back to the old session after the reset and ask it to finish the handoff, or start from the facts-only one.

## Limitations

- The plugin acts at tool calls and turn ends. It cannot interrupt a model response or a tool that is already running.
- Usage figures arrive with each API response, so an idle session sees a threshold only on its next response.
- On Claude Code installs managed by an organization, the Stop and StopFailure hooks run only if the organization lists the plugin, so the end-of-turn block and the facts-only handoff are off there.

## Uninstall

```bash
claude plugin uninstall auto-pause@k45sle --scope user
```

```bash
claude plugin marketplace remove k45sle
```

## License

MIT
