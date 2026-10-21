# auto-pause

> [!IMPORTANT]
> **This plugin was written entirely by AI.** All of its code, tests and documentation were written by Claude (Anthropic's AI) in Claude Code. I am not a programmer. What I did:
>
> - Came up with the idea on my own, before I knew any similar plugins existed.
> - Gathered the outside research on similar plugins that shaped the design.
> - Decided what the plugin should do, reviewed the work, and edited this README.

Claude has two usage limits: one resets every 5 hours, the other every week. When you get close to one, this plugin makes Claude stop at a good moment and save a note (Claude calls it a "handoff") about where it left off, and give you a resume prompt to copy. After the limit resets, you paste the resume prompt into a new chat session and Claude carries on.

## How this plugin helps

- You don't lose work halfway. Without it, Claude can hit the limit in the middle of a change and leave files half-edited, with no record of what it was doing.
- A fresh chat uses less of your new limit. Claude's short-term memory of a chat (the "cache") runs out after an hour, so continuing the old chat after the reset makes it re-read the whole conversation at full price. A short note is much smaller.
- The new chat starts from the right place, because the note is checked against your actual files.
- You can pick a different model for the new chat, such as a cheaper one. The note is a plain text file any model can read. Switching models in the old chat would make the new model re-read the whole conversation at full price.

The cost: Claude spends part of your last 8% writing the note, and you paste the resume prompt yourself. We haven't yet measured how much usage this saves in real use.

## How it's different

Many plugins warn you about usage, and some write a handoff note. auto-pause is the only one we found that locks Claude's tools until a checked note exists.

|  | **auto-pause** | [redline](https://github.com/sankalpgunturi/redline) | [handoff-now](https://github.com/talal-ai/handoff-now) | [claude-auto-handoff](https://github.com/alexknowshtml/claude-auto-handoff) | [agent-usage-guard](https://github.com/rbartoli/agent-usage-guard) | [Agent Layer's Usage Guard](https://github.com/agent-layer-mcp/usage-guard) | [claude-usage-guard](https://github.com/gokhanarkan/claude-usage-guard) | [MohammadMD1383's usage-guard](https://github.com/MohammadMD1383/claude-plugins) | [claude-limit-guard](https://github.com/funhunter7/claude-limit-guard) | [agent-limit-retry](https://github.com/error0702/agent-limit-retry) |
|---|---|---|---|---|---|---|---|---|---|---|
| Reads your real plan usage | Yes, 5-hour and weekly | Yes | 5-hour only | No, chat length | Yes | Yes (unofficial source in Desktop) | Yes | Yes | Yes | Yes |
| Locks Claude's tools | Yes | Yes | Risky edits only | Yes | Helpers and big requests only | Yes | Optional (default waits for the reset) | New helpers only | No | No, one reminder |
| Writes a note | Yes | Summary only | Yes | Yes | No | Usage handover and a chat summary | No | Yes | Yes | Yes |
| Checks the note before unlocking | Yes | No | No | No | No | No | No | No | No | No |
| Desktop app | Yes | Not shown | Yes | Not shown | Yes | Yes | Not shown | Not shown | Not shown | Not shown |

"Not shown" means we found no sign of it, not that it's missing. Based on each project's own description and the code we read in October 2026; they may have changed since.

auto-pause's check is strict: the note must point to the current version of your project, list every file you changed, and contain no passwords or keys. It also copies your last few messages into the note word for word, and if Claude runs out first, the plugin writes a basic note by itself.

The full comparison is in [docs/competitor-review.md](docs/competitor-review.md).

Version 0.1.6. Still being tested.

## What you need

- Claude Code 2.1.299 or newer. It works in the Code tab of the Claude Desktop app, in the Terminal, and in VS Code.
- A Claude Pro or Max plan. On other plans (API keys, Team, Enterprise) the plugin can't see your usage, so it does nothing.

## Install

1. Open the Terminal app. On a Mac: press Cmd+Space, type "Terminal", press Return.
2. Paste this and press Return:

```bash
claude plugin marketplace add k45sle/Claude-auto-pause
```

3. Then this:

```bash
claude plugin install auto-pause@k45sle --scope user
```

4. Quit and reopen the Claude Desktop app.

If Terminal says `command not found: claude`, install Claude Code first ([setup guide](https://code.claude.com/docs/en/setup)), open a new Terminal window, and try again. If it says 8 options are not set, ignore it.

To check it works, type `/auto-pause-status` in a Claude Code chat. You should see `State: normal`. "No usage data yet" goes away once Claude has replied. If it never does, your plan doesn't share usage data. If the command doesn't show up, type `/reload-plugins` first.

## Change one Claude setting

Ask Claude in any chat: "Set autoContinueAtUsageLimit to false in my user settings."

Without this, Claude waits at the limit and then keeps going in the old chat, which uses up a lot of your fresh limit at once.

## What happens

- 15% left: nothing you can see. Claude is told to finish what it's doing and not start anything new.
- 8% left: Claude stops and saves the note in a `.handoffs` folder in your project. Its last message shows when your limit resets and a message to copy (the "resume prompt").
- For the weekly limit, the same happens at 10% and 3% left.

If you're in another app, you get the usual notification when Claude stops. If the limit hits before Claude finishes its note, the plugin writes a shorter one by itself.

## Pick up where you left off

1. After the reset, open a new chat in the same project folder.
2. Paste the resume prompt and press Return.

Lost it? Type `/auto-pause-status` in that project to see it again.

## Update

In the Terminal app:

```bash
claude plugin marketplace update k45sle
```

```bash
claude plugin update auto-pause@k45sle --scope user
```

Then quit and reopen the Desktop app. Chats that were already open need `/reload-plugins` typed in them.

## Settings

Type `/plugin configure auto-pause@k45sle` in a Claude Code chat, then restart the Desktop app. The two you're most likely to change:

- `pause_at_percent_left` (default 8): when Claude stops and saves its note.
- `warn_at_percent_left` (default 15): when Claude is told to wrap up. Keep it above the pause number.

The full list is in [docs/details.md](docs/details.md#all-settings).

## Uninstall

In the Terminal app:

```bash
claude plugin uninstall auto-pause@k45sle --scope user
```

```bash
claude plugin marketplace remove k45sle
```

Your notes stay. Delete the `.handoffs` folder in a project if you don't want them.

## Good to know

- The plugin can't stop Claude in the middle of a reply. It steps in between actions.
- Notes are checked for passwords and keys, but the check can miss some. Read a note before sharing it.
- The plugin never updates itself. New versions arrive only when you run the update commands.

How it works, every setting, and the security details: [docs/details.md](docs/details.md).

## Credits

The patterns that spot passwords and keys in a note are adapted from [handoff-now](https://github.com/talal-ai/handoff-now) (Apache 2.0). That is the only code taken from another project.

Some ideas came from other plugins, written here as our own code: [handoff-now](https://github.com/talal-ai/handoff-now), [agent-usage-guard](https://github.com/rbartoli/agent-usage-guard), [claude-auto-handoff](https://github.com/alexknowshtml/claude-auto-handoff), [handoff-guard](https://github.com/angkaworn-dotcom/handoff-guard), [MohammadMD1383's usage-guard](https://github.com/MohammadMD1383/claude-plugins), [Agent Layer's Usage Guard](https://github.com/agent-layer-mcp/usage-guard) and [claude-limit-guard](https://github.com/funhunter7/claude-limit-guard). [NOTICE](NOTICE) says which idea came from where.

## License

MIT. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
