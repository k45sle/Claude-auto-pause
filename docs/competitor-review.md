# Competitor review (2026-10-20)

Source-level comparison of the plugins named in the October 2026 originality research. The repos were cloned and read; none of their code was run. Line references are to each repo's default branch on 2026-10-20.

## TL;DR

None of the plugins we read does everything auto-pause does, though each single feature exists somewhere. auto-pause puts them together: it reads your real plan usage (through Claude Code's official `session.measure` feed, which also works in the Desktop app), locks Claude's tools until it has written a note, checks that note, and leaves starting the new chat to you. So we call it a checked handoff before the usage limit, and never the first usage guard or the first handoff plugin.

Claude Code has three related features of its own. None of them reacts to plan usage or writes a note:

- `autoContinueAtUsageLimit` waits at the limit and then carries on in the same chat.
- Since 2.1.304, it warns you when reopening an old chat would use a big share of your 5-hour limit.
- The Desktop app can hand off to a new chat when the current one gets too long, after you click a button.

If the Desktop handoff ever starts on usage instead, most of this plugin becomes unnecessary.

## Closest plugins

| Plugin | Usage source | Gate | Handoff | Overlap |
|---|---|---|---|---|
| talal-ai/handoff-now | status line (5-hour only) | PreToolUse deny at 90%, Stop block | model summary checked for sections and secrets, deterministic package | closest workflow |
| rbartoli/agent-usage-guard | `session.measure` (same as ours) | `tool.call` deny, agent gating | none | same mechanism |
| MohammadMD1383 usage-guard | status line | new subagents denied at 95%, Stop block | skill-written, checked by mtime only; snapshot on StopFailure | similar workflow |
| agent-layer-mcp/usage-guard | status line; undocumented cache in Desktop | PreToolUse deny at reserve | quota JSON from code | medium |
| alexknowshtml/claude-auto-handoff | context tokens, not plan usage | deny when context would overflow | Haiku brief plus code facts, auto `/clear` | low-medium |

Lower overlap: redline (status-line budget pacer, no handoff), claude-usage-guard (deny or sleep), claude-limit-guard and agent-limit-retry (one Stop reminder, no gate), claude-handoff-guard, claude-cache-guard, claude-pro-kit. marathon-mode returned 404.

Added 2026-10-20: [jpwinans/usage-auto-pause](https://github.com/jpwinans/usage-auto-pause) (MIT, one commit on 2026-10-02) has a similar name but a different job. It paces weekly usage: a `PreToolUse` hook sleeps when you are 8 or more hours ahead of an even weekly pace or past 98%, then lets the same session continue. It writes no handoff, reads Claude usage from an unofficial OAuth endpoint with the Keychain login, does not mention the Desktop app, and also supports Codex. Nothing was taken from it.

## What auto-pause took from them

| Change | Taken from |
|---|---|
| Pause state saved to `$.store` per session and restored at `session.start`, so a reload mid-pause keeps the gate | claude-auto-handoff and agent-usage-guard (module variables reset on reload) |
| Gate lets Read, Glob, Grep, TodoWrite and read-only git (`status`, `diff`, `log`, `show`, `rev-parse`, and `branch` only to list; no shell operators, no `--output`, `--ext-diff` or `--textconv`) through | handoff-now's freeze allowlist (`engine.rs:368-444`) |
| Facts-only handoff written by code on the second Stop and on a `rate_limit` StopFailure, plus a desktop notification | MohammadMD1383's StopFailure snapshot, handoff-now's deterministic package |
| Secret check widened to private keys, Anthropic, OpenAI, GitHub, AWS, Slack and Google keys, auth headers, connection strings with passwords, `*_TOKEN=` style assignments | handoff-now `redact.rs:18-45` |
| Readings whose reset time has passed are ignored | agent-usage-guard, claude-limit-guard |
| `git` falls back to `/usr/bin/git` | agent-layer 0.2.0 (Desktop hook env without PATH) |
| Subagents may still call SubagentHandback or TaskStop while pausing | agent-usage-guard `core/tools.ts:15-16` |

Gaps none of them covered, added from the research's acceptance criteria:

- While pausing, only the exact path in the resume prompt counts as the handoff. Before, any `.md` in `.handoffs/` passed, and a resume prompt could point at a file that did not exist.
- The handoff must name HEAD in "Repo state" (the commit at the pause, or the current one if Claude committed during the grace calls), which ties it to this project and commit.
- A `rate_limit` StopFailure writes the facts-only handoff only when usage was already at or past the warn level, so an ordinary 429 does nothing.
- The facts-only handoff redacts secrets from the quoted user request.
- A new session id (for example after `/clear`) starts from a clean state; saved state of sessions untouched for 8 days is dropped, and state is written only when it changes.
- After three failed checks the gate opens (logged as `released`), and `/auto-pause-status release` opens it by hand (also logged), so a session cannot stay locked.
- The calibration log records each pause's outcome (`verified`, `fallback`, `released`, `reset`), and the suggested threshold uses only verified pauses.

## Checked

- `claude plugin test .`: 50/50 pass (30 before, 20 new). A reviewer subagent found 7 bugs in the first version of these changes; each has a regression test.
- `claude plugin validate .`: passes.
- `tsc` against the Claude Code 2.1.299 types (the Desktop build): no errors.
- Headless smoke test with `AUTO_PAUSE_SIMULATE_PERCENT_LEFT=5` on Haiku in a scratch git repo, run before and after the review fixes: pause notice, handoff written to the exact path naming HEAD, check passed, resume prompt printed, `.handoffs/` added to `.git/info/exclude`. $0.013 and $0.009.
- Not run: a Desktop session with a real or simulated pause after these changes, a reload mid-pause in Desktop, and a real `rate_limit` StopFailure.

## Second pass: handoff accuracy (2026-10-20)

A second read of six repos (handoff-now, claude-code-handoff, claude-auto-handoff, ormus-handoff, angkaworn handoff-guard, MohammadMD1383 usage-guard), this time looking only at how they make a handoff match the real state of the work.

| Change | Taken from |
|---|---|
| The check fails a handoff that leaves out any uncommitted file in `git status` (skipped above 15 files). This catches files changed during the grace calls, after the notice listed the repo state. | claude-auto-handoff collects edited paths from tool history (`hooks/brief.ts:46-76`); the check against `git status` is ours |
| After a handoff passes, the mod appends the user's last three messages word for word (secrets redacted) and the files edited, read from the session. Harness text sent as a user message (system reminders, command tags, hook feedback) is skipped. | claude-auto-handoff `brief.ts:38-44`, handoff-now `artifacts.rs:498-512` |
| The template's Status asks whether the last request was answered, partly done, or not started. | claude-auto-handoff `brief.ts:148-157` |
| The resume prompt says to tell the user before editing if `git status` or HEAD differ, and to ask before doing anything outside the Goal. | angkaworn handoff-guard's resume confirmation (`hooks/session-resume.mjs`) |

Not taken: a Haiku subagent writing the handoff (handoff-now): switching model re-reads the history uncached. Handoff age checks at resume (angkaworn): you paste the prompt by hand, so it is never stale by accident. A per-file hash manifest (handoff-now): nothing reads it at resume.

Checked: `claude plugin test .` 58/58 (after a reviewer found four bugs in the first version: secrets on their own line slipped past redaction, real requests starting with `<` were dropped, non-ASCII file names never matched, and `data.ts` counted as naming `a.ts`), `claude plugin validate .` passes, `tsc` against the 2.1.299 types exits 0. Two headless runs on Haiku in a scratch repo, with the pause landing after 2 and after 4 tool calls: both handoffs passed on the first write, named every changed file, and got the session facts appended ($0.009 and $0.010). Pasting the second run's resume prompt into a new session: it checked the repo state, wrote the missing test file (Next step 1) and stopped there ($0.008). Not run: a Desktop session with these changes.
