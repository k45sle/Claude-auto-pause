# Phase 4 results: package and ship

Run 2026-10-20 in the Desktop app (Code tab) on this Mac, auto-pause 0.1.2 installed at user scope from the `k45sle` marketplace. The clean install on a second Mac or user account is still open, so Phase 4 is not done.

| Check | Result |
|---|---|
| Clean install from an empty `CLAUDE_CONFIG_DIR` (same Mac) | 0.1.0 installed and enabled via `marketplace add k45sle/Claude-auto-pause` + `install --scope user`. |
| Manual handoff gets usage | A headless Haiku run and a Desktop run both got the mod's line on the `facts.sh` call ("5-hour usage 86% used (14% left), resets … Word budget: 600.") and wrote it into the handoff. Before 0.1.2 a manual handoff said "usage unknown". |
| `live-check` handoff in Desktop | Accepted ("handoff OK", session facts appended). After its resume prompt was edited to name another handoff, the mod sent it back with "Put this resume prompt verbatim…" and the correct prompt. |
| `/auto-pause-status` in Desktop | Prints state and "pause at 8% left", but in a new chat it appeared only after `/reload-plugins`. |
| Second Mac or user account | Not run. |

## Findings

- After `claude plugin update`, open Desktop chats keep the old copy until `/reload-plugins` or an app restart. A likely reason new chats can too: the app starts chat processes ahead of time (`~/.claude/spares/`). Not confirmed. The README now says to run `/reload-plugins` when the command is missing.
- Not yet known: whether `/auto-pause-status` is missing in a new chat only from the slash menu before the first message (the mod registers it in `session.start`), or is not registered at all until a reload. To tell: in a new chat, send `/auto-pause-status` as the first message without reloading.
- The appended session facts quoted a pasted message with its `<pasted_content id=…>` wrapper tags. Fixed in 0.1.3: the tags are dropped and the pasted text kept.
