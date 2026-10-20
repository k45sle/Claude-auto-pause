# Phase 2 results: monitor/gate mod

Built 2026-10-19 against Claude Code 2.1.299 types (Desktop's build); live runs used the CLI, 2.1.303.

Files: `hooks/hooks.json`, `hooks/register.ts`, `hooks/register.test.ts`, `userConfig` in `.claude-plugin/plugin.json`.

| Check | Result |
|---|---|
| `claude plugin test .` | 28/28 pass: below warn, warn again after a reset, weekly pause held back by a 5-hour pause, buried resume prompt, `..` in a handoff path, warn once, pause once, absolute paths with a space in the folder, outside git, weekly binding, userConfig thresholds, empty `rateLimits`, simulate env var, grace countdown, gate by calls and by points, handoff tools pass the gate, subagent deny, Agent spawn deny, `tool.check` allow, Stop once, valid and invalid handoff, Edit re-validation, word budget, manual handoff, window reset, no notices after PAUSED, status command. |
| `claude plugin validate .` | passes. It lists two facts, not warnings: `classic.Stop` does not run for user-installed plugins on org-managed Claude Code, and each gating hook has a `.catch`. |
| `tsc` (strict, against the 2.1.299 types) | clean |
| Live smoke test (run twice, before and after the review fixes): `claude -p --plugin-dir .` with `AUTO_PAUSE_SIMULATE_PERCENT_LEFT=6`, Sonnet, `default` permission mode, the E2 fixture repo with a space in its path | The notice arrived on the first tool call. Claude invoked `writing-handoffs` and wrote the handoff to the notice's path with no permission denials, though Write was not in `--allowedTools` (the `tool.check` allow worked). The mod validated it and logged calibration. The final message ended with the resume prompt in a `text` block. `/.handoffs/` was added to `.git/info/exclude`. Cost $0.28 and $0.17. |
| `/auto-pause-status` under `claude -p` | prints state, the simulated reading, thresholds and the pending resume prompt |
| Desktop acceptance | not run; steps below |

## Changes from the plan

- The command is `/auto-pause-status`, not `/auto-pause:status`. Mod command names must match `[A-Za-z0-9_-]` and are not namespaced; `status` alone is refused as a built-in. The test kit accepted both bad names, only a live run showed the refusal.
- No toasts in Desktop (Phase 0). The only toast left is the one-time "no usage data" notice, which shows in the terminal.
- The handoff file name is `<YYYY-MM-DDTHHMM>-auto-pause.md`: the mod does not know the task, so it cannot pick a slug.
- Simulated runs do not write the calibration log.
- The "latest handoff" for `/auto-pause-status` is stored only after a valid handoff, so it never points to a file that was not written. While pausing, the command shows the pending prompt from memory.
- Calibration logs tool calls after the notice, not turns.
- State lives in module variables, so a dev reload (`/reload-plugins`) starts the session over at NORMAL. The next `session.measure` restores it.

## Desktop acceptance (to run by hand)

1. `claude plugin marketplace update` for the local marketplace, then `/reload-plugins` in a Desktop Code session.
2. Add `"AUTO_PAUSE_SIMULATE_PERCENT_LEFT": "6"` under `env` in `~/.claude/settings.json`. This pauses every new session on this Mac until removed.
3. In a new local Code session in a scratch repo, ask for any multi-step change. Expect the notice, a handoff in `.handoffs/`, and a final message with a copyable resume prompt.
4. Remove the env entry.

## Limits

- The gate and validation are tested against the kit's stand-in engine. The kit does not check command names (see above), so other engine rules it skips may exist.
- `skills/writing-handoffs/scripts/facts.sh` still hardcodes `.handoffs` (its `shortcut:` comment). A non-default `handoff_dir` works on the auto path, where the notice gives the path, but not on the manual path.

## Review fixes

A fresh reviewer subagent found five bugs, all fixed with a test each: the `.git/info/exclude` path was wrong from a repo subfolder (now `--path-format=absolute`); a reset after a warning alone left the session at WARNED; a threshold held back by the other window's pause was marked as fired and never came back; `..` in a path passed the handoff-folder check and the gate; the resume prompt was accepted anywhere in the file, not only at the top.
