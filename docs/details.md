# auto-pause: technical details

The [README](../README.md) covers install and everyday use. This page has the rest.

Testing write-ups: `docs/phase*-results.md` has what was tested in each phase, [competitor-review.md](competitor-review.md) compares the plugin with similar ones, and [user-testing.md](user-testing.md) has the simulated-user and abuse testing.

## How it works

1. At 15% left in the 5-hour window (10% weekly) it adds a warning to the next tool result.
2. At 8% left (3% weekly) it tells Claude to finish or revert the current step and write a handoff to an exact path in `.handoffs/`. That path and a resume prompt with absolute paths are in the notice. Subagents are told to return, and new ones are refused.
3. After 5 more tool calls, or once usage rises 3 more percent, every tool is blocked except writing the handoff and a few reads (Read, Grep, Glob, read-only git).
4. When Claude writes the handoff, the plugin checks it: the resume prompt is there verbatim, the required sections exist, the current commit and every uncommitted file are named (up to 15), it fits the word budget, and nothing looks like a secret. A valid handoff unblocks the tools and Claude ends its turn with the resume prompt.
5. Once the handoff passes, the plugin adds a "Session facts" section at the end: your last few messages, word for word, and the files Claude edited. It reads these from the session, so no model call is spent, and the next session works from what you asked for rather than Claude's summary of it.
6. If Claude ends the turn twice without a valid handoff, or the limit hits first, the plugin writes a short handoff itself from what it can read without Claude (last request, edited files, branch, commit, uncommitted files) and sends a desktop notification. This needs no model call. After the reset you can start from that one, or go back to the old session and ask it to finish the handoff.

The handoff is a short Markdown file: the goal, what is done, what is left, the next steps, and the state of your files.

The resume prompt tells the new session to compare `git status` and the current commit with the handoff and tell you before editing if they differ. It also tells it to ask you before doing anything outside the handoff's Goal.

The pause is saved per session, so `/reload-plugins` or a plugin update mid-pause keeps it. After three failed checks the tools are unblocked anyway, so a session never stays locked.

`/auto-pause-status` shows the state, the latest resume prompt for this folder, and a log of past pauses (how each ended and how much usage the handoff took). `/auto-pause-status release` unblocks the tools by hand and records that you did.

## What a handoff costs

The checks in step 4 and the session facts in step 5 are plain code in the hook and spend no usage. The cost is Claude writing the handoff, which took about three extra model turns in testing.

Measured on 2026-10-20 with Opus at xhigh effort on a Pro plan: a small task (two one-line edits, then `git status`) run three times with and three times without a simulated pause, with 0, 49 KB and 195 KB of extra notes in the prompt. Two pause runs never paused and were dropped, and one extra 0 KB pause run was added, so the medians cover 3, 2 and 3 pause runs. The pause landed after the task's last tool call, so both runs did the same work. Starting from a fresh window, the whole batch (about $10.50 at API prices, including an estimated $0.70 for the session running the tests) moved the 5-hour meter from 0% to 25% and the weekly meter from 0% to 4%, which converts the median cost difference into percent.

| Prompt size | Extra cost (API prices) | Share of 5-hour limit | Share of weekly limit |
|---|---|---|---|
| 0 KB | $0.11 | 0.25% | 0.04% |
| 49 KB | $0.09 | 0.20% | 0.03% |
| 195 KB | $0.13 | 0.30% | 0.05% |

The differences between sizes are within run-to-run noise. Only one plan and one small task were tested, and the meter shows whole percents, so the weekly figures are rough. A session with a much larger context costs more, because each extra turn re-reads it. `/auto-pause-status` logs what each real handoff took and suggests a `pause_at_percent_left` from those numbers.

## Why turn off autoContinueAtUsageLimit

With `autoContinueAtUsageLimit` on (the default), Claude Code waits at the limit and then continues the same session. By then the one-hour prompt cache has expired, so the first turn after the reset sends the whole old conversation again, uncached. Writing a handoff while the cache is still warm and starting fresh is cheaper. To turn it off by hand, add this to `~/.claude/settings.json`:

```json
{ "autoContinueAtUsageLimit": false }
```

## All settings

| Setting | Default | What it does |
|---|---|---|
| `pause_at_percent_left` | 8 | Pause and write a handoff when this much of the 5-hour limit is left (8 means at 92% used) |
| `warn_at_percent_left` | 15 | Tell Claude to wrap up its current step at this much left |
| `weekly_pause_at_percent_left` | 3 | The same pause for the 7-day limit |
| `weekly_warn_at_percent_left` | 10 | The same warning for the 7-day limit |
| `gate_after_tool_calls` | 5 | Tool calls Claude gets after the pause notice to finish or undo its current step |
| `gate_after_points` | 3 | How many more percent of usage Claude may spend after the pause notice, if it runs out before the tool calls do |
| `handoff_dir` | `.handoffs` | Folder for handoffs, inside the project, using letters, digits, `.`, `_`, `-` and `/`. Use a folder that holds nothing else: the plugin keeps it out of git. `.git` and `.claude` are not allowed |
| `handoff_word_budget` | 600 | Target handoff length in words, resume prompt included |

A value out of range (a percentage above 100, for example) is ignored and the default is used. Claude Code still says "Configuration saved", so check `/auto-pause-status`: it lists every value in use and any value it ignored. Keep each warn value above its pause value, or there is no separate warning.

To set a value from the Terminal app (the value goes in quotes), then restart the Desktop app:

```bash
echo '{"pause_at_percent_left": "10"}' | claude plugin configure auto-pause@k45sle --values-stdin
```

## Limitations

- The plugin acts at tool calls and turn ends. It cannot interrupt a model response or a tool that is already running.
- Usage figures arrive with each API response, so an idle session sees a threshold only on its next response.
- On Claude Code installs managed by an organization, the Stop and StopFailure hooks run only if the organization lists the plugin, so the end-of-turn block and the facts-only handoff are off there.

## Leftovers after uninstall

Besides the `.handoffs` folder, the plugin adds a `/.handoffs/` line to `.git/info/exclude` in each project it paused in (open it with any text editor to remove it). Claude Code may also keep the old plugin files and a small state file (calibration and the latest resume prompts) under `~/.claude/plugins/`; they do nothing once the plugin is gone.

## Security

- While pausing, the plugin approves two things without asking you: writing the handoff file it named, and read-only git (`status`, `diff`, `log`, `show`, `rev-parse`, `branch`) on paths inside the project. It approves no git at all in a repo whose own `.git/config` sets programs for git to run, and no handoff folder that is a link out of the project.
- The handoff and its session facts are checked for common secret formats, which are refused or replaced with `[redacted]`. The check cannot catch everything, so read a handoff before you paste it anywhere outside your machine.
- Like any Claude Code plugin, this one runs with your user account's permissions. Claude Code does not update plugins from marketplaces like this one on its own (auto-update is off by default for them), so new code arrives only when you run the update commands. To read every change first, install from your own copy of this repository (`claude plugin marketplace add /path/to/your/clone`) and update that copy when you are ready.
