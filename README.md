# auto-pause

A Claude Code plugin that watches your 5-hour and weekly usage. Shortly before you hit the limit, it gets Claude to stop at a safe point, write a handoff file, and give you a resume prompt to paste into a new session after the reset.

Status: 0.1.4, still being tuned on real use. [PLAN.md](PLAN.md) has the design, `docs/phase*-results.md` has what was tested in each phase, [docs/competitor-review.md](docs/competitor-review.md) compares it with similar plugins, and [docs/user-testing.md](docs/user-testing.md) has the simulated-user and abuse testing.

## Requirements

- Claude Code 2.1.299 or later: the Code tab of the Claude Desktop app (local sessions), the terminal, or VS Code. All three share one install.
- A Claude Pro or Max plan. The usage figures come from your subscription, so API keys and Team or Enterprise seats get no data and the plugin stays idle.

## Install

Type these two commands into the Terminal app (on a Mac: press Cmd+Space, type "Terminal", press Return). They do not go into a Claude chat.

```bash
claude plugin marketplace add k45sle/Claude-auto-pause
```

```bash
claude plugin install auto-pause@k45sle --scope user
```

If Terminal answers `command not found: claude`, install the Claude Code command-line tool first ([setup guide](https://code.claude.com/docs/en/setup)), open a new Terminal window, and run the two commands again. The install may report that 8 options are not set yet. You can ignore that: every setting has a default.

Then quit and reopen the Claude Desktop app (or start a new `claude` in the terminal).

To check that it works, type `/auto-pause-status` in a Code session. You should see `State: normal` and the settings in use. "No usage data yet" is normal until Claude has answered once; if it never goes away, your plan sends no usage data (see Requirements).

If `/auto-pause-status` is not offered in a chat, type `/reload-plugins` there first.

## Update

In the Terminal app:

```bash
claude plugin marketplace update k45sle
```

```bash
claude plugin update auto-pause@k45sle --scope user
```

Then quit and reopen the Desktop app. Chats that were open before the update keep the old version until you type `/reload-plugins` in them.

## What you will see

- At 15% of your 5-hour limit left, nothing visible happens. Claude gets a note to finish its current step rather than start new work.
- At 8% left, Claude stops at a safe point and writes a handoff file into a `.handoffs` folder in your project. Its last message gives the file's location, when your usage resets, and a resume prompt in a box you can copy.
- If you are in another app, the Desktop app sends its usual notification when Claude finishes.

The handoff is a short Markdown file: the goal, what is done, what is left, the next steps, and the state of your files. The plugin checks it before Claude can finish: the resume prompt must point at the right file, and every file you have changed must be listed (up to 15 of them).

## Resume after the reset

1. Open a new Code session in the same project folder.
2. Paste the resume prompt and press Return.

The new session reads the handoff, checks that your files still match it, and starts on the next step. If you lose the prompt, type `/auto-pause-status` in that project; it shows the latest one again.

## Settings

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

To change a setting, type `/plugin configure auto-pause@k45sle` in a Claude Code session. Or, in the Terminal app (the value goes in quotes):

```bash
echo '{"pause_at_percent_left": "10"}' | claude plugin configure auto-pause@k45sle --values-stdin
```

Then restart the Desktop app. `/auto-pause-status` shows the values in use.

## Recommended setting

By default, Claude Code waits at the limit and then carries on in the same session. Since you resume by hand in a new session, turn that off. Ask Claude in any session: "Set autoContinueAtUsageLimit to false in my user settings." Or add this line to `~/.claude/settings.json` yourself:

```json
{ "autoContinueAtUsageLimit": false }
```

If the limit arrives before Claude has written the handoff, the plugin writes a shorter one from what it can read on its own. After the reset you can start from that one, or go back to the old session and ask it to finish the handoff.

## How it works

1. At 15% left in the 5-hour window (10% weekly) it adds a warning to the next tool result.
2. At 8% left (3% weekly) it tells Claude to finish or revert the current step and write a handoff to an exact path in `.handoffs/`. That path and a resume prompt with absolute paths are in the notice. Subagents are told to return, and new ones are refused.
3. After 5 more tool calls, or once usage rises 3 more percent, every tool is blocked except writing the handoff and a few reads (Read, Grep, Glob, read-only git).
4. When Claude writes the handoff, the plugin checks it: the resume prompt is there verbatim, the required sections exist, the current commit and every uncommitted file are named, it fits the word budget, and nothing looks like a secret. A valid handoff unblocks the tools and Claude ends its turn with the resume prompt.
5. Once the handoff passes, the plugin adds a "Session facts" section at the end: your last few messages, word for word, and the files Claude edited. It reads these from the session, so no model call is spent, and the next session works from what you asked for rather than Claude's summary of it.
6. If Claude ends the turn twice without a valid handoff, or the limit hits first, the plugin writes a short handoff itself from what it can read without Claude (last request, edited files, branch, commit, uncommitted files) and sends a desktop notification. This needs no model call.

The resume prompt tells the new session to compare `git status` and the current commit with the handoff and tell you before editing if they differ. It also tells it to ask you before doing anything outside the handoff's Goal.

The pause is saved per session, so `/reload-plugins` or a plugin update mid-pause keeps it. After three failed checks the tools are unblocked anyway, so a session never stays locked.

`/auto-pause-status` shows the state, the latest resume prompt for this folder, and a log of past pauses (how each ended and how much usage the handoff took). `/auto-pause-status release` unblocks the tools by hand and records that you did.

## Why

With `autoContinueAtUsageLimit` on (the default), Claude Code waits at the limit and then continues the same session. By then the one-hour prompt cache has expired, so the first turn after the reset sends the whole old conversation again, uncached. Writing a handoff while the cache is still warm and starting fresh is cheaper.

## Limitations

- The plugin acts at tool calls and turn ends. It cannot interrupt a model response or a tool that is already running.
- Usage figures arrive with each API response, so an idle session sees a threshold only on its next response.
- On Claude Code installs managed by an organization, the Stop and StopFailure hooks run only if the organization lists the plugin, so the end-of-turn block and the facts-only handoff are off there.

## Uninstall

In the Terminal app:

```bash
claude plugin uninstall auto-pause@k45sle --scope user
```

```bash
claude plugin marketplace remove k45sle
```

Uninstalling leaves your handoffs where they are. In each project it paused in, delete the `.handoffs` folder if you no longer want it, and the `/.handoffs/` line in `.git/info/exclude` (open it with any text editor). Claude Code may also keep the old plugin files and a small state file (calibration and the latest resume prompts) under `~/.claude/plugins/`; they do nothing once the plugin is gone.

## Security

- While pausing, the plugin approves two things without asking you: writing the handoff file it named, and read-only git (`status`, `diff`, `log`, `show`, `rev-parse`, `branch`) on paths inside the project. It approves no git at all in a repo whose own `.git/config` sets programs for git to run, and no handoff folder that is a link out of the project.
- The handoff and its session facts are checked for common secret formats, which are refused or replaced with `[redacted]`. The check cannot catch everything, so read a handoff before you paste it anywhere outside your machine.
- Like any Claude Code plugin, this one runs with your user account's permissions, and an update replaces its code. If that matters to you, install from your own reviewed copy of this repository (`claude plugin marketplace add /path/to/your/clone`) and update it only after reading the changes.

## License

MIT
