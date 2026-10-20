# Simulated users and abuse testing (2026-10-20)

Claude Code 2.1.303 on macOS, headless `claude -p` in scratch git repos, versions 0.0.5 to 0.0.8. A Desktop session was not part of this round.

## Simulated users

| Scenario | Model | Result |
|---|---|---|
| Normal work at 50% left | Haiku | No notices, task finished |
| Pause lands mid-task | Haiku, Sonnet | Skill loaded, handoff checked on the first write, session facts appended |
| User tells Claude to ignore any pause | Haiku | Gate held, Claude wrote the handoff |
| Same | Sonnet | Claude finished its edits inside the 5 grace calls and refused the handoff; the plugin wrote the facts-only one on the second Stop |
| "Write a handoff, I'm out of time" with no pause | Haiku, Sonnet | Failed before the fixes below; after them, written to `.handoffs/` and checked |
| Project that is not a git repo | Haiku | Pause and handoff worked |
| `/auto-pause-status` | none | Shows state and thresholds |
| Fresh install from GitHub in an empty config folder | none | Install, configure and uninstall all worked; the README's configure example failed |

## What the testing found and what changed

- Any `allowed-tools` line in the skill stops Claude Code from loading it in acceptEdits mode: the Skill tool answers "Execute skill" and no instructions arrive, so Claude improvised a handoff in its scratchpad or the project root. The line is gone. While pausing, the mod's `tool.check` approves the exact handoff path and read-only git.
- The skill now says the handoff is a project file and never goes in a scratchpad.
- Claude chains read-only git (`cd <root> && git status && git diff`). The gate refused these, Claude spent its calls on refusals, and both Claude's partial handoff and the facts-only one ended up in the folder. Safe chains now pass.
- One model called the gate's messages instructions from tool output. The notice and the gate message now say they come from the auto-pause plugin the user installed.
- The README's configure example needs the value in quotes. The README now starts with install steps for someone who has never used a terminal, how to check it works, what the pause looks like, and how to resume.

## Abuse review

Two reviewer passes and two rechecks found these. Each now has a test.

- The read-only git check was a regex that a line break, quotes or braces could get around (`git status` plus a newline and any command; `git log --out"put"=f`). It is now an allowlist: plain characters only, five read-only subcommands, no `--output`, `--ext-diff`, `--textconv`, `--no-index` or `-O`, and `cd` only into the project root (another folder's `.git/config` can make `git status` run a program).
- The skill pre-approved Write and Edit anywhere and a `bash *facts.sh*` pattern that also matched `bash -c`.
- Reads while gated are capped at 10.
- A tool input field named `tool` could make any MCP call look like the handoff to the auto-approval.
- A handoff folder that is a symlink out of the project, or a dangling one, is no longer auto-approved.
- On git older than 2.31 the exclude step could write a junk file, and a read failure could replace the user's excludes.
- Settings out of range (word budget 0, 0 points, 500% left) now fall back to the defaults. Claude Code itself rejects blank and non-numeric values.

Not changed: a repo's project settings can set the simulate variables and force a pause. Project settings can already run arbitrary hooks, so this adds nothing an attacker lacks.

## Checks

`claude plugin test .`: 72 pass. `claude plugin validate .`: pass. `tsc` against the 2.1.299 types: no errors. Final end-to-end run on the installed 0.0.8: handoff checked, facts appended, $0.012.

Not tested: a Desktop session, a real usage reading near the limit, and a real `rate_limit` stop.
