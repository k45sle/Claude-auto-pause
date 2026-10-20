# auto-pause

Claude has two usage limits: one resets every 5 hours, the other every week. When you get close to one, this plugin makes Claude stop at a good moment and save a note (Claude calls it a "handoff") about where it left off, and give you a resume prompt to copy. After the limit resets, you paste the resume prompt into a new chat session and Claude carries on.

Version 0.1.5. Still being tested.

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

## License

MIT. The secret patterns are adapted from [handoff-now](https://github.com/talal-ai/handoff-now) (Apache 2.0); see [NOTICE](NOTICE).
