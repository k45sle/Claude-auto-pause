# Competitor review (2026-10-20)

Source-level comparison of the plugins named in the October 2026 originality research. The repos were cloned and read; none of their code was run. Line references are to each repo's default branch on 2026-10-20.

## Verdict

None of the reviewed plugins does all of this together: plan-usage trigger, a tool gate that stays shut until a checked handoff exists, a manual resume in a fresh session, and the official `session.measure` feed that works in the Desktop Code tab. Each piece exists somewhere. auto-pause should be described as an enforced, checked handoff before the usage limit, not as the first usage guard or the first handoff plugin.

Claude Code itself has three nearby features: `autoContinueAtUsageLimit` (waits and continues the same session), a warning since 2.1.304 when resuming an inactive conversation would use a noticeable share of the 5-hour limit, and a Desktop handoff to a nested session that starts when the context fills and you click a button. None of them is triggered by plan usage or writes a handoff. If Desktop's handoff gets a usage trigger, most of this plugin becomes redundant.

## Closest plugins

| Plugin | Usage source | Gate | Handoff | Overlap |
|---|---|---|---|---|
| talal-ai/handoff-now | status line (5-hour only) | PreToolUse deny at 90%, Stop block | model summary checked for sections and secrets, deterministic package | closest workflow |
| rbartoli/agent-usage-guard | `session.measure` (same as ours) | `tool.call` deny, agent gating | none | same mechanism |
| MohammadMD1383 usage-guard | status line | new subagents denied at 95%, Stop block | skill-written, checked by mtime only; snapshot on StopFailure | similar workflow |
| agent-layer-mcp/usage-guard | status line; undocumented cache in Desktop | PreToolUse deny at reserve | quota JSON from code | medium |
| alexknowshtml/claude-auto-handoff | context tokens, not plan usage | deny when context would overflow | Haiku brief plus code facts, auto `/clear` | low-medium |

Lower overlap: redline (status-line budget pacer, no handoff), claude-usage-guard (deny or sleep), claude-limit-guard and agent-limit-retry (one Stop reminder, no gate), claude-handoff-guard, claude-cache-guard, claude-pro-kit. marathon-mode returned 404.

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
