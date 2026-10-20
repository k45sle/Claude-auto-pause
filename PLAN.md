# Claude Auto-Pause: triage, design, and implementation plan

**Date:** 2026-10-19
**Target:** the **Claude Desktop app on macOS, Code tab (local sessions)**, on a claude.ai Pro or Max plan. The same plugin also works in the terminal and VS Code on the same Mac.
**Resume model:** manual. The plugin produces a handoff doc and a ready-to-paste resume prompt. You open a new session and paste it. Nothing is cleared or resumed automatically.
**Status:** plan only. The core mechanism was spike-tested offline (see §2). Nothing is built yet.

---

## TL;DR

1. **The idea is sound and worth building.** The one change that matters: a *skill alone cannot do this*. A skill is instructions Claude loads. It can't see usage or stop Claude. You need **deterministic code that watches usage and enforces the pause**, plus a **skill that writes the handoff**. They ship as one Claude Code **plugin**.
2. **No third-party monitor, credentials, or polling needed.** Claude Code already passes the server-reported 5-hour and 7-day usage (`percentUsed`, `resetsAt`) to plugins on every API response, through the **mods** API (`session.measure`). Mods run in the Desktop Code tab. The menu-bar apps in the research doc are for human eyes. Don't build on them.
3. **The problem is real and documented.** Claude Code's built-in `autoContinueAtUsageLimit` waits at the limit and continues **the same session** after reset. By then the 1-hour prompt cache has expired, so the first turn re-sends the whole stale conversation uncached. *Handoff while the cache is warm, then paste a resume prompt into a new session* is the cheaper path.
4. **Refinements:**
   - two-stage thresholds (warn, then pause), stated as "% left";
   - a short grace window, then a tool gate, so Claude actually stops;
   - handoff validation in code, at zero extra turns;
   - a ready-to-paste resume prompt, shown in Claude's final message and saved in the handoff;
   - a calibration log that tunes the threshold from real handoff costs.
5. **Build workflow:** 5 phases. The riskiest unknowns come first: a 30–45 min spike in Desktop. The skill is built evals-first. Mod logic is tested offline with `claude plugin test`, which is free. Each phase is one fresh session that starts from this file plus the previous phase's handoff, so you dogfood the skill while building it.

---

## 1. Triage of the original idea

### Keep

| Element of the idea | Verdict |
|---|---|
| Watch live 5-hour usage and alert at a set % | ✅ Core. Data is first-party and pushed. No polling needed. |
| Claude pauses at the next *safe* stopping point | ✅ Core. This beats the built-in hard stop, which can cut Claude off mid-edit. |
| Produce a handoff doc for a fresh session | ✅ Core. It is also useful on its own (manual "write a handoff"). |
| You resume manually in a new session | ✅ Kept as the only resume path. Simplest, and you stay in control of when the fresh window gets spent. |
| Avoid spending the fresh window on stale context | ✅ Confirmed by Claude Code's prompt-caching docs (§2). |

### Change

| Original assumption | Refinement | Why |
|---|---|---|
| "Build a Claude skill" | **Plugin = mod (monitor + gate) + skill (handoff) + one status command** | Skills are model-invoked text. Only code can watch usage and enforce a pause. Anthropic's guide: *"For critical validations, consider bundling a script… Code is deterministic; language interpretation isn't."* |
| Use a menu-bar app (Usage4Claude, CodexBar, ClaudeBar…) as the data source | **Use Claude Code's own `rateLimits` feed** | No session keys, no Keychain, no undocumented endpoints, no 1–15 min polling lag. Updates on every API response. Usage4Claude's single-threshold limit stops mattering. |
| One threshold ("6% left") | **Warn at 15% left, pause at 6% left, gate shortly after** (all configurable) | A warning lets Claude steer toward a natural break before the hard pause. |
| "Notify Claude" | **Notice appended to the next tool result, or a one-time Stop block** | Claude can't be interrupted mid-generation. Tool boundaries are the natural checkpoints. |
| Claude "pauses" | **Grace window (≈5 tool calls or +3 points), then non-handoff tools are refused** | Instructions alone are best-effort. The gate makes the stop reliable without leaving files half-edited. |
| "Produce a handoff doc" | **Handoff doc plus a resume prompt the mod builds**: in Claude's last message (copyable code block), at the top of the handoff, and via `/auto-pause:status` | You paste one block into a new session. The prompt carries the absolute paths, so it works no matter how you open the session. |
| Fixed threshold | **Calibration log**: record how many % each handoff actually cost, and suggest a threshold | Pro windows are small. 6% may be too little or too much depending on context size. |

### Out of scope / not worth building

- **Automatic `/clear` or resume.** Dropped by design. You resume manually.
- **The Desktop app's Chat and Cowork tabs.** Cowork takes its plugins from the claude.ai Customize config, and mods aren't listed as running there. **Code tab only.**
- **Cloud sessions.** Plugins installed from Desktop aren't available in cloud sessions, and WSL sessions have no plugins. **Use local sessions.**
- **Counting tokens locally to estimate quota** (ccusage-style). Subscription % can't be derived from token counts. Use the server-reported %.
- **Team/Enterprise seats.** The status line docs say `rate_limits` is populated only for Pro/Max (and gateway spend limits). The mod degrades gracefully with a one-time notice.
- **Model-specific weekly caps.** These aren't in the feed (only `five_hour`, `seven_day`, `spend_limit`).

---

## 2. Verified facts this design rests on

| Fact | Source | Confidence |
|---|---|---|
| Plugins (mods) receive `session.measure` with `rateLimits: [{ kind: 'five_hour' \| 'seven_day' \| 'spend_limit', percentUsed, resetsAt }]` after each main-thread turn and whenever a window moves a whole point. `$.session.usage()` returns the same data on demand. | Claude Code mods types (`claude-code.d.ts`), mods reference | Docs. **Live behavior in Desktop to verify in Phase 0.** |
| Mods run in the CLI, the **Desktop Code tab** (not WSL), and VS Code. | Mods overview, "Where mods run" | Docs |
| A mod's `tool.call` hook can append text Claude reads after a tool result (`{ result, context: [...] }`) or refuse the call (`{ deny }`). | Mods types. **Spike-tested** with `claude plugin test` on Claude Code 2.1.304: 3/3 pass, offline. | High |
| `claude plugin test` can fire simulated `session.measure` readings (with a one-line stub). The pause logic is unit-testable with **zero quota**. | **Spike-tested** | High |
| Mods can block Stop (`classic.Stop`), auto-allow specific tools (`tool.check`), show toasts (`$.ui.toast`), run processes (`$.process.run`), read and write files (`$.fs`), and register slash commands. | Mods reference and types | Docs. Toast rendering in Desktop is **to verify in Phase 0.** |
| Desktop sends a **macOS notification when a Code session finishes a task and you aren't viewing it**. This is your "handoff is ready" alert, for free. | Desktop docs | Docs |
| Plugins install from Desktop via **+ → Add plugins**, from marketplaces you've added. User-scope installs are shared by the terminal, Desktop local sessions, and VS Code on the same Mac. | Plugin install docs, Desktop docs | Docs |
| Plugins **cannot** set `statusLine`. The Desktop docs don't mention a status line at all. Treat status-line tricks as terminal-only. | Plugin components docs, Desktop docs | Docs. This limits Plan B (§9). |
| Built-in `autoContinueAtUsageLimit` (default on, v2.1.234+) waits at the limit and continues **the same session** after reset. A plugin can't change it (user/managed setting). | Interactive-mode docs, settings reference | Docs |
| On a subscription, the main conversation uses a **1-hour** cache TTL. After a longer gap, the old session's next turn re-sends the full conversation uncached. *"This is why `/compact` costs the most when you resume an old session."* | Prompt-caching docs | Docs |
| Skill frontmatter: `name` ≤ 64 chars, lowercase/digits/hyphens, no "anthropic"/"claude". `description` ≤ 1,024 chars, third person, what + when, no `< >`. SKILL.md < 500 lines (guide: < 5,000 words). References one level deep. No README.md inside the skill folder. | Best-practices doc, Complete Guide (ch. 3, 6, 7) | Docs |

---

## 3. Refined product spec

**Name:** plugin `auto-pause`, skill `writing-handoffs`, command `/auto-pause:status`.

### Runtime flow (what you experience in Desktop)

```
used%   0 ───────────── 85 ──────────── 94 ───── 97 ─────────── 100
state   NORMAL          WARNED          PAUSING   GATED          (limit)
        │               │               │         │
        │               │               │         └─ non-handoff tools refused
        │               │               └─ notice: finish/revert current step, then write handoff
        │               └─ notice: prefer finishing the current step; keep tasks current
        └─ nothing injected (zero tokens)

 handoff written → mod validates it (no extra turn) → Claude's last message:
     handoff path · when usage resets · resume prompt in a code block
 → Desktop's macOS notification tells you the session finished (if you're not viewing it)
 later, after the reset:
     new Code session in the same project folder → paste the resume prompt → Enter
```

- **Thresholds are stated as "% left"** in config and UI copy, which matches how you think about it ("6% left"). Internally: `used = 100 − left`. This avoids the used/remaining confusion the research doc warns about.
- **Each threshold fires once per window per session.** The window identity is `kind + resetsAt`. A reset returns the session to NORMAL.
- **The 7-day window uses the same machinery** with its own thresholds. When it binds, the handoff and message show the weekly reset date.
- **Subagents:** while PAUSING, subagent tool calls are refused with "return to the parent now with what you have". New `Agent` spawns are refused.
- **The user's own messages are never blocked.** The gate only affects Claude's tool calls.
- **After PAUSED, the old session stays usable.** If you type into it, Claude answers normally (the gate is released once the handoff is valid). The mod just doesn't push further notices for that window.

### Resume prompt (built by the mod, pasted by you)

```text
Resume paused work in /Users/<you>/code/<repo>.
Read /Users/<you>/code/<repo>/.handoffs/2026-10-19T1502-fix-auth.md first. It is your only context from the previous session.
Check that `git status` matches its "Repo state" section, then start with Next step 1.
Read only the files it points to unless you need more.
```

It appears in three places:
1. Claude's last message, in a fenced block, so it's copyable.
2. The top of the handoff file.
3. `/auto-pause:status`, which reprints the latest prompt for the current folder if you lost it.

### Recommended one-time setting (yours to set; a plugin can't)

```json
// ~/.claude/settings.json
{ "autoContinueAtUsageLimit": false }
```

- **Why:** you resume manually. You don't want the old session auto-continuing at reset and spending the fresh window on stale context.
- **Trade-off:** if the limit is hit *before* the handoff is written (rare once thresholds are calibrated), nothing finishes it automatically. After reset, go back to the old session and say "finish the handoff". That costs one stale turn.

### Configuration (`userConfig` in `plugin.json`)

| Key | Default | Rationale |
|---|---|---|
| `warn_at_percent_left` | `15` | Matches the research doc's "85% used" suggestion. Enough room to steer to a break. |
| `pause_at_percent_left` | `6` | Your stated target. Retune after calibration. |
| `gate_after_tool_calls` | `5` | Enough to finish or revert one edit and run one check. |
| `gate_after_points` | `3` | Hard backstop if a few calls are huge. |
| `weekly_warn_at_percent_left` / `weekly_pause_at_percent_left` | `10` / `3` | The weekly window is long. Pause later, but still before a hard stop. |
| `handoff_dir` | `.handoffs` | In-project, so you can open it in Desktop's file viewer. Added to `.git/info/exclude` (local-only, tracked files untouched). Not under `.claude/`: writes there are refused in default and dontAsk modes even with Write granted (Phase 0 and Phase 1 probes). |
| `handoff_word_budget` | `600` | ≈ 800–1,000 tokens. Enough for a full resume without rebuilding stale context. |

Dev-only override for tests, evals, and Desktop smoke tests: `AUTO_PAUSE_SIMULATE_PERCENT_LEFT`. Set it under `env` in `~/.claude/settings.json` for a Desktop smoke test. Remove it after.

---

## 4. Architecture

### Components

| Component | Path | Job | Why this form |
|---|---|---|---|
| Manifest | `.claude-plugin/plugin.json` | Metadata and `userConfig` | Install-time config dialog. No settings edits. |
| **Monitor/gate mod** | `hooks/hooks.json` → `hooks/register.ts` | Reads `session.measure`, runs the state machine, injects notices (with the handoff path and pre-built resume prompt), gates tools, blocks Stop once, validates handoffs on write, shows toasts, writes the calibration log, registers `/auto-pause:status` | Deterministic. Pushed data. One file. Unit-testable offline. |
| **Handoff skill** | `skills/writing-handoffs/SKILL.md` | How to reach a safe point and write a resumable handoff | Judgment work belongs in a skill. It is also usable manually ("write a handoff"). |
| Template | inlined in `skills/writing-handoffs/SKILL.md` | The section structure | A separate file costs one extra Read turn at pause time (Phase 1 decision) |
| Facts script | `skills/writing-handoffs/scripts/facts.sh` | Manual path only: git state, handoff path, resume prompt. Always exits 0. | "Solve, don't punt". On the auto path the mod puts all of this in the notice. |
| Tests | `hooks/*.test.ts` | State machine, gate, Stop, validation, resume-prompt builder | `claude plugin test`. Free. Under a second. |
| Evals | `evals/` | Skill triggering, handoff quality, resume quality | `claude plugin eval`. Costs quota, so keep it small. |
| Marketplace | `.claude-plugin/marketplace.json` | Install from this repo | Add the marketplace once, then install from Desktop's plugin browser |
| Repo README | `README.md` (repo root, *not* in the skill folder) | Install (Desktop steps), the recommended setting, config, uninstall, limitations | Guide ch. 5 |

### Turn budget at pause time (the part that must be cheap)

Each turn re-reads the (cached) context, so minimize turns after the pause notice:

1. The notice arrives on a tool result. It is ≤ ~150 tokens and already carries the handoff path, usage, reset time, git state, and the resume prompt.
2. Claude finishes or reverts the in-flight step (grace: ≤ 5 calls).
3. Claude invokes the `writing-handoffs` skill (1 turn).
4. Claude writes the handoff (1 turn). The mod validates it inside that same tool call and appends either "OK, end your turn with the resume prompt" or a specific fix list.
5. Claude ends the turn with the handoff path, reset time, and resume prompt in a code block (1 turn).

**Target: ≤ 3 turns after the safe point.** Phase 3 compares "invoke skill" against "template inlined in the notice" (saves 1 turn) and picks the cheaper one by measured %.

Rules: never switch model for the handoff (a model switch re-reads the whole history uncached). Skill `allowed-tools` pre-approves writes to the handoff dir, so nothing stalls on a Desktop permission prompt while you're away. If that rule syntax doesn't cover it, a narrow `tool.check` allow in the mod is the fallback.

### Handoff validation (in the mod, on Write/Edit under `handoff_dir`)

- The resume prompt is present at the top. Required headings are present. "Next steps" has ≥ 1 item.
- Word count ≤ budget × 1.2.
- No pasted code blocks over 15 lines.
- No secret-looking strings (`sk-ant-`, `ghp_`, `AKIA`, `-----BEGIN`).
- If all checks pass: mark the session PAUSED, release the gate and Stop block, toast "Handoff ready", log calibration `{pct_at_notice, pct_at_done, turns, context_tokens, model}`.

### Handoff template (sketch)

```markdown
# Handoff: <task>
Paused <ISO time> · 5h <94>% used · resets <time> · session <name>

> **Resume prompt** (paste into a new Code session):
> Resume paused work in <abs project path>. Read <abs handoff path> first …

## Goal
<user's ask, verbatim if short> · Done when: <acceptance criteria>

## Status
- Done: …
- In progress: <exact state, e.g. "auth.ts migrated through refreshToken(); session.ts untouched">
- Not started: …

## Next steps
1. <first action, executable without reading anything else: file:line or command>
2. …

## Decisions (don't relitigate)
- <decision>: <reason>

## Dead ends
- Tried <X>; failed because <Y>

## Verify
- `<test/lint command>`: last result <pass/fail + one line>

## Repo state
branch · HEAD · uncommitted files · stashes · background processes

## Open questions for the user
```

### Repo layout

```
.claude-plugin/plugin.json
.claude-plugin/marketplace.json
hooks/hooks.json
hooks/register.ts
hooks/register.test.ts
skills/writing-handoffs/SKILL.md
skills/writing-handoffs/scripts/facts.sh
evals/…
README.md
PLAN.md
```

---

## 5. Skill design, mapped to both references

**Frontmatter draft** (third person, what + when, trigger phrases, negative triggers, < 1,024 chars, no angle brackets):

```yaml
---
name: writing-handoffs
description: Writes a compact handoff document and a ready-to-paste resume prompt that let a fresh Claude Code session resume the current task without the old conversation. Use when an AUTO-PAUSE notice says the usage-limit pause threshold was reached, or when the user asks to write a handoff, wrap up for a new session, save progress before the usage limit, pause here, or hand off to a fresh session. Do not use for summarizing finished work, changelogs, commit messages, or PR descriptions.
allowed-tools: Read Write Edit Bash(git status:*) Bash(git diff:*) Bash(git log:*) Bash(bash *writing-handoffs/scripts/facts.sh*)
metadata:
  version: 0.1.0
---
```

(Phase 0 tightens `allowed-tools` to paths under the handoff dir if the rule syntax supports it.)

**Body outline** (target ≤ 120 lines, well under both limits):

1. `## Critical`: as few turns as possible; no exploration; no new work; no model switch.
2. `## Workflow` as a copyable checklist:
   1. Reach a safe point.
   2. Take the facts and resume prompt from the notice, or run `scripts/facts.sh` on the manual path.
   3. Write to the given path using the template inlined in SKILL.md, with the resume prompt verbatim at the top in a fenced `text` block (copyable, unlike a blockquote).
   4. If the monitor reports problems, fix them in one Edit.
   5. End with the handoff path, the reset time, and the resume prompt in a code block.
3. `## Writing rules`: write for a zero-context reader; Next step 1 must be executable as-is; point to files by `path:line` and don't paste them; give each decision its reason; list dead ends; no secrets.
4. `## Example`: one short, filled-in handoff (examples beat descriptions).

**Checklist mapping:**

| Guidance | How it's met |
|---|---|
| Concise; assume Claude is smart | Only the rules Claude lacks (turn budget, resumability bar). No explanation of git or markdown. |
| Degrees of freedom | Low freedom for the safe-point, turn-budget, and resume-prompt rules (verbatim). Medium freedom for the template. High freedom for wording. |
| Progressive disclosure, one level deep | SKILL.md → `scripts/facts.sh` (template inlined to save a turn) |
| Scripts solve, don't punt; no voodoo constants | `facts.sh` always exits 0 and degrades outside git. Every default in §3 has a stated reason. |
| Feedback loop | Validation runs in the mod on Write: validate → fix → done |
| Consistent terminology | Always "handoff", "resume prompt", "pause threshold", "safe point" |
| No time-sensitive info | Version minimums go in README, not SKILL.md |
| Evals first, ≥ 3 scenarios, test across models | §7. Run the handoff eval on Sonnet and Opus (and Haiku if you use it). |
| Triggering ≥ 90% on relevant queries | 10 should-trigger and 5 should-not queries (§7) |
| Use skill-creator to draft and review | Phase 1 step 2 |

---

## 6. Implementation workflow

**Working method (applies to every phase):**

- One phase per fresh session. Start with: *"Read PLAN.md and the latest file in .handoffs/; do Phase N."* From Phase 1 on, end each session by asking for a handoff, which dogfoods the skill and its resume prompt.
- **Three-speed dev loop.** Use the fastest loop that answers the question:
  1. **Logic:** `claude plugin validate .` and `claude plugin test` in Terminal. Offline, free, under a second.
  2. **Live smoke test:** `claude --plugin-dir .` in Terminal, with `AUTO_PAUSE_SIMULATE_PERCENT_LEFT` set. Same mod runtime as Desktop, and `/reload-plugins` picks up edits.
  3. **Desktop acceptance at each phase gate:**
     - Register the repo once as a local marketplace: `claude plugin marketplace add /path/to/Claude-auto-pause`.
     - Install `auto-pause` at **User** scope via **+ → Add plugins** in a Code session.
     - After changes: `/plugin marketplace update`, then `/reload-plugins`.
- Run `claude plugin eval` (costs quota) only at phase gates, and when the 5-hour window has headroom.

| Phase | Goal | Steps | Exit criteria | Size |
|---|---|---|---|---|
| **0. Desktop spike** | Kill the remaining unknowns before building | 1. Check which Claude Code version the Desktop app runs. Mods docs describe v2.1.290+; the spike used 2.1.304. 2. Install a throwaway mod that logs every `session.measure` to a file. Confirm it loads in a Desktop **local** Code session. Compare the readings with Settings > Usage. 3. Confirm a `tool.call` `context` notice reaches Claude (ask it to echo a marker). 4. Confirm `classic.Stop` blocks once, `{deny}` works on a subagent call, and skill `allowed-tools` (or `tool.check`) prevents the Write permission prompt in your usual Desktop permission mode. 5. Confirm a toast renders in Desktop. Confirm the final message's code block is copyable. Confirm the macOS notification arrives when the turn ends while you're in another app. 6. Set `autoContinueAtUsageLimit: false`. This can't be tested without hitting the limit, so don't. | A written yes/no for each item. **If 2 fails** (old version, org policy, or empty `rateLimits` on your plan), see §9. | 30–45 min, 1 session |
| **1. Handoff skill (evals first)** | A handoff plus resume prompt that a fresh session can resume from cold | 1. Write 3 eval scenarios (§7 E1–E3) *before* the skill. Get a baseline with no skill. 2. Draft SKILL.md, template, and `facts.sh` with the **skill-creator** skill. Review against §5. 3. Claude A/B loop: paste each resume prompt into a fresh session. Fix what it trips on. | E1–E3 beat baseline. The new session does Next step 1 with no clarifying questions. Triggering ≥ 9/10, false triggers 0/5. | 1 session |
| **2. Monitor/gate mod** | Reliable warn → pause → gate → paused, with resume prompt | State machine, notices, resume-prompt builder (absolute paths), grace counter, gate allowlist, subagent handling, Stop-once, handoff validation, toasts, calibration log, `/auto-pause:status`, `.git/info/exclude` entry, `.catch` on gating hooks (fail open: a mod bug must never brick a session). Unit tests per transition, including multi-window, reset, and simulated values. | All state-transition tests green. `claude plugin validate` shows no warnings. Desktop smoke test with the simulate env var produces a valid handoff and a copyable resume prompt. | 1–2 sessions |
| **3. End-to-end evals and calibration** | Prove it on real behavior; tune defaults | 1. `claude plugin eval` with the simulate env var and `context.history_file` mid-task transcripts (E4–E6). 2. Compare skill-invoke vs. inlined-template turn cost. Keep the cheaper one. 3. Use it in Desktop for a week of normal work. 4. Set `pause_at_percent_left` = p95(handoff cost) + 2 points. | Evals pass at ≥ 2/3 runs per case. ≥ 3 real pauses logged. Defaults updated with the measured numbers. | 1 session + a week of normal use |
| **4. Package and ship** | Installable on any Mac | `marketplace.json` and README. README install steps: `claude plugin marketplace add k45sle/Claude-auto-pause` in Terminal (settings are shared with Desktop), then Desktop **+ → Add plugins → auto-pause → User**. Also the recommended setting, config table, limitations, uninstall. Version 0.1.0. | Clean install on a second Mac or user account works in Desktop. | < 1 session |
| *(v1.1 option)* | Same flow for context-window exhaustion | Trigger the same handoff when `context.percent` ≥ ~85%, instead of losing detail to auto-compact | — | small |

Phase results: [Phase 0](docs/phase0-results.md), [Phase 1](docs/phase1-results.md).

---

## 7. Testing and eval strategy (no deliberate quota burning)

**Offline unit tests (`claude plugin test`, free).** Fire `$.session.measure(...)` with simulated readings, then `$.tool.call(...)` / `$.classic.Stop(...)` / `$.command.run({ command: 'auto-pause:status' })`, and assert on `context`, `deny`, `block`, the resume-prompt text, and toasts. This pattern is already proven by the spike. Use `mock.env` for config. Cover: below warn; warn once; pause once; grace countdown; gate; subagent deny; Stop blocks once then releases; valid and invalid handoff; window reset; weekly-only binding; empty `rateLimits` (API key, Team); resume prompt has absolute paths and survives spaces in folder names.

**Evals (`claude plugin eval`, cost quota, so keep ~6 cases × 3 runs):**

| ID | Scenario | Graders (free ones first) |
|---|---|---|
| E1 | Manual: "write a handoff, I'm stopping" mid-task (history_file) | `file_exists`, `regex` (headings, resume prompt), `llm` (resumability) |
| E2 | Auto: simulate 6% left during a multi-file edit | `tool_order` (no new edits after grace; skill → Write), turns after notice ≤ 4, `regex` (resume prompt in final message) |
| E3 | Resume: fresh session given only the pasted resume prompt | `llm`: did Next step 1 without questions; `regex`: no re-reading of unlisted files |
| E4 | Subagent running when the pause hits | parent receives partial result; handoff mentions it |
| E5 | Should-trigger set (10 paraphrases) / should-not set (5: changelog, PR description, summary of finished work…) | skill loaded / not loaded |
| E6 | Baseline arm (no plugin, same prompts) | `--ablation with-without` delta |

**Real-world check (Phase 3):** don't consume quota on purpose. Let pauses happen during normal Desktop work and read the calibration log (`/auto-pause:status`).

---

## 8. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Desktop runs its own Claude Code build; the mods API may differ from the terminal's | Check the version in Phase 0. Pin the minimum in README. Use the generated types from the installed build. Run `claude plugin validate` and `claude plugin test` in CI. |
| Desktop UI differs (e.g. a toast may not render) | Primary signals are Claude's last message and Desktop's own macOS notification. The toast is a bonus. |
| `rateLimits` empty (API key, Team/Enterprise, before first response) | Degrade silently after a one-time "auto-pause inactive: no usage data" toast |
| Figures lag usage from claude.ai chat in parallel | They refresh on this session's next API response, which is when the check runs anyway. The warn margin absorbs the lag. |
| The handoff costs more than the margin on Pro with huge context | Turn budget ≤ 3, gate, calibration log, retune threshold |
| Gate leaves code half-edited | Edits stay allowed during grace. The skill rule "record exact file:line state if you can't finish". The gate never touches your prompts. |
| Permission prompt stalls the handoff while you're away | Skill `allowed-tools`, or a narrow `tool.check` allow for the handoff dir only |
| Stop-block loop burns usage | Block at most once per pause (check `stop_hook_active`). Claude Code's own 8-continuation cap is a backstop. |
| Built-in auto-continue spends the fresh window on the old session | Recommended `autoContinueAtUsageLimit: false` (§3) |
| Resume prompt pasted in the wrong folder | Absolute project and handoff paths in the prompt, plus the `git status` check as its first step |
| Handoff files end up in commits | `.git/info/exclude`, configurable dir |
| A mod bug blocks all tools | Gating hooks get `.catch` → fail open. Unit tests on every gate path. |

---

## 9. Plan B (only if Phase 0 shows mods can't run in your Desktop)

1. **A version or policy problem** (Desktop's Claude Code too old, or an org setting blocking user-installed mods): update Desktop, or ask the admin. This is the expected fix.
2. **No usage data in Desktop at all:** there's no good automatic fallback.
   - Classic plugin hooks don't receive usage figures.
   - The status-line tap (a `statusLine` wrapper that saves `rate_limits` to a file for hooks to read) only works in **terminal** sessions. The Desktop docs don't mention a status line, so it likely doesn't run there.
   - In that case:
     - **In Desktop:** ship the skill alone and invoke it manually ("write a handoff") when Desktop shows its own usage warning.
     - **In the terminal:** use the status-line tap with classic hooks: PostToolUse `additionalContext`, PreToolUse `deny`, Stop `block`.

---

## 10. Decisions for you (defaults chosen; change any)

1. **Handoff location:** project `.handoffs/`, git-excluded (recommended; `.claude/` writes are refused without a permission prompt), project `.claude/handoffs/` relying on the Phase 2 mod's `tool.check` allow, or the plugin's data dir outside the repo?
2. **Context-window trigger:** v1.1 (recommended) or v1?
3. **`autoContinueAtUsageLimit: false`:** recommended for a manual-resume workflow (§3). Keep it on only if you'd rather the old session finish an interrupted handoff on its own.

---

## Appendix A: spike-verified mod pattern (Claude Code 2.1.304)

```js
// hooks/register.js (minimal; the real one adds state, grace, Stop, validation, resume prompt)
let fiveHour = null
export function register(on) {
  on('session.measure', async ($, e, next) => {
    const w = e.rateLimits.find((r) => r.kind === 'five_hour')
    if (w) fiveHour = w.percentUsed
    return next(e)
  })
  on('tool.call', async ($, e, next) => {
    if (fiveHour >= 97 && e.tool !== 'Write') return { deny: 'auto-pause gate: write the handoff first' }
    const r = await next(e)
    if (fiveHour >= 94 && r && 'result' in r) return { ...r, context: [...(r.context ?? []), `AUTO-PAUSE: 5h usage ${fiveHour}%`] }
    return r
  })
}
```

```ts
// tests: the session.measure stub is required, or the kit reports "no implementation for session.measure"
on('tool.call', () => ({ result: 'ok' }))
on('session.measure', (_$, e) => ({ changed: e.changed }))
await $.session.measure({ context: { window: 200000 }, rateLimits: [{ kind: 'five_hour', percentUsed: 94.5, resetsAt: '…' }], changed: ['rateLimits'] })
const r = await $.tool.call({ tool: 'Bash', command: 'ls' })   // r.context → ['AUTO-PAUSE: 5h usage 94.5%']
```

`claude plugin validate` also warned *"gating hook without .catch: tool.call"*. This is why the real mod adds `.catch` to every gating hook (fail open).

## Appendix B: sources

- Skill authoring best practices: https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices
- The Complete Guide to Building Skills for Claude (web edition of the PDF): https://claude.com/resources/guides/the-complete-guide-to-building-skills-for-claude
- Claude Code Desktop (plugins, notifications, sessions): https://code.claude.com/docs/en/desktop
- Install plugins (Desktop tab, marketplaces, scopes): https://code.claude.com/docs/en/plugins/install
- Claude Code skills: https://code.claude.com/docs/en/skills
- Plugin components (settings keys, userConfig): https://code.claude.com/docs/en/plugins/components
- Mods overview, reference, testing: https://code.claude.com/docs/en/plugins/mods/overview, https://code.claude.com/docs/en/plugins/mods/reference, https://code.claude.com/docs/en/plugins/mods/test
- Mods types: https://github.com/anthropics/claude-code/blob/main/mods/types/claude-code.d.ts
- Hooks reference: https://code.claude.com/docs/en/hooks
- Status line (`rate_limits`): https://code.claude.com/docs/en/statusline
- Usage-limit auto-continue: https://code.claude.com/docs/en/interactive-mode#wait-for-a-usage-limit-to-reset
- Prompt caching (TTL, resume and compact costs): https://code.claude.com/docs/en/prompt-caching
- Plugin evals: https://code.claude.com/docs/en/plugin-evals
- Background research: `CLAUDE_USAGE_MONITORING_AND_THRESHOLD_ALERTS_HANDOFF_2026-10-19.md` (menu-bar monitors; superseded as a data source by the native feed)
