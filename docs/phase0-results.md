# Phase 0 results: Desktop spike

Date: 2026-10-19. Mac, Claude Desktop Code tab, local session, Max plan, permission mode `bypassPermissions` in the test session.
Spike: a throwaway mod (`auto-pause-spike`) installed at user scope from this repo as a local marketplace, each test switched by a flag file. Removed after the tests.

| Item | Yes/no | Evidence | Impact on the plan |
|---|---|---|---|
| Claude Code version in Desktop | Yes, 2.1.299 | `$.session.version()` on `session.start` in the Desktop session: `2.1.299`, built 2026-10-13. Terminal CLI is 2.1.303. | Mods work on 2.1.299. Pin README minimum to 2.1.299, not 2.1.304. Desktop lags the CLI by a few builds, so build against the Desktop's types. |
| Mod loads in a Desktop local session | Yes | `session.start` logged with `surface: "desktop"`. Installed via `claude plugin marketplace add <abs path>` + `claude plugin install … --scope user`, then `/reload-plugins` in the session. | Install path works. `/reload-plugins` in Desktop loads the mod into every open Desktop session at once (5 `session.start` lines from one reload), and terminal sessions pick it up too. |
| `session.measure` delivers `rateLimits` | Yes | Fired after every main-thread turn with `five_hour` and `seven_day` (`percentUsed`, `resetsAt`). `changed` lists `rateLimits` only when a window moved. | Core data source confirmed. No Plan B needed. |
| Readings match Settings > Usage | Yes | Log: 5h 82%, 7d 60%. Settings > Usage at the same time: 82% and 61%. Figures are account-wide (another session was running). | Use the feed as is. A 1-point lag is within the warn margin. |
| `$.session.usage()` at `session.start` is current | No | At reload it returned 76% while the next `session.measure` said 82%. A fresh terminal session got `rateLimits: []` until its first response. | State machine must act on `session.measure` only, never on the start-time snapshot. |
| `tool.call` `context` notice reaches Claude | Yes | The marker `SPIKE-MARKER-7f3a` reached the model as "tool.call hook additional context" on the same Bash call. | Notices on tool results work as designed. |
| `classic.Stop` blocks once | Yes | Turn end was blocked with the SPIKE-STOP reason; Claude replied, then the next stop passed (module flag + `stop_hook_active`). `plugin validate` notes classic events skip user-installed plugins under org-managed Claude Code. | Stop-once works. README limitation: on org-managed installs Stop blocking is off unless the org lists the plugin. |
| `{ deny }` on a subagent tool call | Yes | A Haiku subagent's `Bash` call returned `SPIKE-DENY: …` verbatim; main-thread calls were unaffected (`e.agentId` present only in the subagent). | Subagent gating via `e.agentId` works. |
| Skill `allowed-tools` pre-approves writes to `.claude/handoffs/` | No | Headless Haiku runs in `default` mode: `Write(.claude/handoffs/**)` in the skill was denied; the same rule for `spike-handoffs/**` (outside `.claude/`) was allowed. In bypass mode (the test session) nothing prompts either way. | `.claude/` is a protected path. Keep the mod `tool.check` allow (now the primary path), or move `handoff_dir` out of `.claude/`. |
| Mod `tool.check` allow for `.claude/handoffs/` | Yes | Same headless test with a `tool.check` hook returning `{ decision: 'allow' }`: write succeeded, no denial. | Use a narrow `tool.check` allow (Write/Edit under `handoff_dir` only, while PAUSING). |
| Invoking a plugin skill without a prompt in `default` mode | No | Headless run: the `Skill` call itself was in `permission_denials`. | The auto path stalls on the skill call when the user is away. The mod's `tool.check` must also allow `Skill(auto-pause:writing-handoffs)`, or the template goes inline in the notice (Phase 3 comparison). |
| Toast renders in Desktop | No | Mod logged the `$.ui.toast` call; the user saw nothing in Desktop. | Drop toasts as a Desktop signal (keep as terminal-only bonus). |
| Final message's code block is copyable | Yes | User copied the block; pasted text matched exactly. | Resume prompt in a fenced block works. |
| macOS notification when the turn ends while in another app | Yes | User switched apps during a 40 s background wait; notification arrived at turn end. | Primary "handoff ready" signal confirmed. |
| `autoContinueAtUsageLimit: false` set | Yes (not exercised) | Added to `~/.claude/settings.json`; file parses. Not tested at the limit by design. | Done. |

Cost of the spike: about $0.03 in Haiku runs for the permission tests and one Haiku subagent call. No quota was burned on purpose.

## Proposed PLAN.md edits

1. §2 facts table: Desktop runs 2.1.299 (mods verified). Add rows for "`$.ui.toast` does not render in Desktop", "`.claude/` writes are not pre-approved by skill `allowed-tools`", and "`$.session.usage()` at start can be stale".
2. §3 runtime flow and §4 handoff validation: remove "toast 'Handoff ready'" from Desktop behaviour; the signals are the final message plus Desktop's macOS notification.
3. §4 "Rules" paragraph and §8 permission risk: make the mod `tool.check` allow the primary mechanism (Write/Edit under `handoff_dir`, plus the `Skill` call for `writing-handoffs`, only while PAUSING). Keep `allowed-tools` for the manual path outside protected folders only.
4. §3 config `handoff_dir`: note that `.claude/handoffs` needs the `tool.check` allow; a non-`.claude` folder would work with `allowed-tools` alone.
5. §4 mod component: compute state from `session.measure` only; ignore `session.usage()` at `session.start`.
6. §6 Phase 2: the module runs once per session, so state stays per-module; dev reloads hit every open session (`/reload-plugins` reloads all of them).
7. §6 Phase 4 / README: minimum version 2.1.299; limitation that `classic.Stop` blocking is skipped for user-installed plugins on org-managed Claude Code.
8. §9 Plan B: not needed; mark as unused.
