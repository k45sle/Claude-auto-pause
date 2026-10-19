# Claude Auto-Pause: triage, design, and implementation plan

**Date:** 2026-10-19
**Target:** Claude Code (terminal, Desktop Code tab, VS Code) on a claude.ai Pro or Max plan, macOS first
**Status:** Plan only. The core mechanism was spike-tested offline (see §2); nothing is built yet.

---

## TL;DR

1. **The idea is sound and worth building.** The one change that matters: a *skill alone cannot do this*. A skill is instructions Claude loads. It cannot see usage, run on a timer, or stop Claude. You need **deterministic code that watches usage and enforces the pause**, plus a **skill that writes the handoff**. Ship both as one Claude Code **plugin**.
2. **No third-party monitor, credentials, or polling needed.** Claude Code already passes the server-reported 5-hour and 7-day usage (`percentUsed`, `resetsAt`) to plugins on every API response, through the **mods** API (`session.measure`). The menu-bar apps in the research doc are for human eyes. Don't build on them.
3. **The problem is real and documented.** Claude Code's built-in `autoContinueAtUsageLimit` already waits at the limit and continues **the same session** after reset. By then the 1-hour prompt cache has expired, so the first turn re-sends the whole stale conversation uncached. A `/compact` at that moment is the most expensive compaction there is. *Handoff while the cache is warm, then resume in a fresh context* is the cheaper path.
4. **Refinements:** two-stage thresholds (warn, then pause) in "% left" terms; a short grace window, then a tool gate so Claude actually stops; validation of the handoff in code, at zero extra turns; a one-keystroke fresh-context resume at reset; and a calibration log that tunes the threshold from real handoff costs.
5. **Build workflow:** 6 phases. Riskiest unknowns come first (a 30–45 min on-machine spike). The skill is built evals-first. Mod logic is tested offline with `claude plugin test`, which is free. `claude plugin eval` is kept small because it spends quota. Each phase is one fresh session that starts from this file plus the previous phase's handoff, so you dogfood the skill while building it.

---

## 1. Triage of the original idea

### Keep

| Element of the idea | Verdict |
|---|---|
| Watch live 5-hour usage and alert at a set % | ✅ Core. Data is first-party and pushed. No polling needed. |
| Claude pauses at the next *safe* stopping point | ✅ Core. This beats the built-in hard stop, which can cut Claude off mid-edit. |
| Produce a handoff doc for a fresh session | ✅ Core. It is also useful on its own (manual "write a handoff"). |
| Avoid spending the fresh window on stale context | ✅ Confirmed by Claude Code's prompt-caching docs (§2). |

### Change

| Original assumption | Refinement | Why |
|---|---|---|
| "Build a Claude skill" | **Plugin = mod (monitor + gate) + skill (handoff) + commands** | Skills are model-invoked text. Only code can watch usage and enforce a pause. Anthropic's guide says the same: *"For critical validations, consider bundling a script… Code is deterministic; language interpretation isn't."* |
| Use a menu-bar app (Usage4Claude, CodexBar, ClaudeBar…) as the data source | **Use Claude Code's own `rateLimits` feed** | No session keys, no Keychain, no undocumented endpoints, no 1–15 min polling lag. Updates on every API response. Usage4Claude's single-threshold limit stops mattering. |
| One threshold ("6% left") | **Warn at 15% left, pause at 6% left, gate shortly after** (all configurable) | A warning lets Claude steer toward a natural break before the hard pause. |
| "Notify Claude" | **Notice appended to the next tool result, or a one-time Stop block** | Claude can't be interrupted mid-generation. Tool boundaries are the natural checkpoints, and usage only changes on API responses anyway. |
| Claude "pauses" | **Grace window (≈5 tool calls or +3 points), then non-handoff tools are refused** | Instructions alone are best-effort. The gate makes the stop reliable without leaving files half-edited. |
| Resume in a new session | **At reset: one keystroke runs `/auto-pause:resume`** (`/clear`, then a prompt pointing at the handoff). Opt-in fully automatic mode. | You get fresh context without opening a new terminal. The session-start check covers the case where you closed the terminal. |
| Fixed threshold | **Calibration log**: record how many % each handoff actually cost, and suggest a threshold | Pro windows are small. 6% may be too little or too much depending on context size. |

### Out of scope / not worth building

- **claude.ai chat or the mobile app.** Skills there can't observe usage or stop Claude. Claude Code only.
- **Counting tokens locally to estimate quota** (ccusage-style). Subscription % can't be derived from token counts, as the research doc already notes. Use the server-reported %.
- **Team/Enterprise seats.** The status line docs say `rate_limits` is populated only for Pro/Max (and gateway spend limits). The mod should degrade gracefully, show a one-time notice, and verify on the target account.
- **Model-specific weekly caps.** These aren't in the feed (only `five_hour`, `seven_day`, `spend_limit`).

---

## 2. Verified facts this design rests on

| Fact | Source | Confidence |
|---|---|---|
| Plugins (mods) receive `session.measure` with `rateLimits: [{ kind: 'five_hour' \| 'seven_day' \| 'spend_limit', percentUsed, resetsAt }]` after each main-thread turn and whenever a window moves a whole point. `$.session.usage()` returns the same data on demand. | Claude Code mods types (`claude-code.d.ts`), mods reference | Docs. **Live behavior to verify in Phase 0.** |
| A mod's `tool.call` hook can append text Claude reads after a tool result (`{ result, context: [...] }`) or refuse the call (`{ deny }`). | Mods types. **Spike-tested** with `claude plugin test` on Claude Code 2.1.304: 3/3 pass, offline. | High |
| `claude plugin test` can fire simulated `session.measure` readings (with a one-line stub). The pause logic is unit-testable with **zero quota**. | **Spike-tested** | High |
| Mods can block Stop (`classic.Stop`), auto-allow specific tools (`tool.check`), run slash commands (`$.command.run`, e.g. `/clear`), submit or pre-fill prompts (`$.prompt.submit`, `$.prompt.fill`), run timers (`$.clock.after`), show toasts (`$.ui.toast`), and run processes (`$.process.run`). | Mods reference and types | Docs. `/clear` + submit from a timer is **to verify in Phase 0.** |
| Mods run in the CLI, the Desktop Code tab, VS Code, `claude -p`, and cloud sessions. Drawing only happens in the first three. Not in WSL. | Mods overview, "Where mods run" | Docs |
| Plugins **cannot** set the main `statusLine`. Only `agent` and `subagentStatusLine` take effect from a plugin's `settings.json`. | Plugin components docs | Docs. This is why Plan B needs one manual settings edit. |
| The status line JSON has `rate_limits.five_hour.used_percentage` and `resets_at` for Pro/Max, after the first API response. | Status line docs | Docs |
| Built-in `autoContinueAtUsageLimit` (default on, v2.1.234+) waits at the limit and continues **the same session** after reset. It re-arms at most twice. | Interactive-mode docs | Docs |
| On a subscription, the main conversation uses a **1-hour** cache TTL. After a longer gap, a resume re-sends the full conversation uncached. *"This is why `/compact` costs the most when you resume an old session."* | Prompt-caching docs | Docs |
| On `--resume`, a SessionStart hook receives `context_tokens`, `prompt_cache_likely_expired`, and `estimated_cache_write_usd`. | Hooks docs | Docs |
| Skill frontmatter: `name` ≤ 64 chars, lowercase/digits/hyphens, no "anthropic"/"claude". `description` ≤ 1,024 chars, third person, what + when, no `< >`. SKILL.md < 500 lines (guide: < 5,000 words). References one level deep. No README.md inside the skill folder. | Best-practices doc, Complete Guide (ch. 3, 6, 7) | Docs |

---

## 3. Refined product spec

**Name:** plugin `auto-pause`, skill `writing-handoffs`, commands `/auto-pause:resume` and `/auto-pause:status`.

### Runtime flow (what you experience)

```
used%   0 ───────────── 85 ──────────── 94 ───── 97 ─────────── 100
state   NORMAL          WARNED          PAUSING   GATED          (limit)
        │               │               │         │
        │               │               │         └─ non-handoff tools refused
        │               │               └─ notice: finish/revert current step, then write handoff
        │               └─ notice: prefer finishing the current step; keep tasks current
        └─ nothing injected (zero tokens)

 handoff written → mod validates it (no extra turn) → Claude ends turn with 3-line summary
 → toast: "Paused at 94%. Handoff: .claude/handoffs/…md. Resets 15:45."
 at resetsAt → toast + prompt pre-filled with /auto-pause:resume (press Enter)
 /auto-pause:resume → /clear → "Read <handoff>; verify repo state; do Next step 1" → handoff marked consumed
```

- **Thresholds are stated as "% left"** in config and UI copy, which matches how you think about it ("6% left"). Internally: `used = 100 − left`. This avoids the used/remaining confusion the research doc warns about.
- **Each threshold fires once per window per session.** The window identity is `kind + resetsAt`. A reset returns the session to NORMAL.
- **The 7-day window uses the same machinery** with its own thresholds. When it binds, the handoff and toast show the weekly reset date.
- **Subagents:** while PAUSING, subagent tool calls are refused with "return to the parent now with what you have". New `Agent` spawns are refused.
- **The user's own messages are never blocked.** The gate only affects Claude's tool calls.

### Configuration (`userConfig` in `plugin.json`)

| Key | Default | Rationale |
|---|---|---|
| `warn_at_percent_left` | `15` | Matches the research doc's "85% used" suggestion. Enough room to steer to a break. |
| `pause_at_percent_left` | `6` | Your stated target. Retune after calibration. |
| `gate_after_tool_calls` | `5` | Enough to finish or revert one edit and run one check. |
| `gate_after_points` | `3` | Hard backstop if a few calls are huge. |
| `weekly_warn_at_percent_left` / `weekly_pause_at_percent_left` | `10` / `3` | The weekly window is long. Pause later, but still before a hard stop. |
| `on_reset` | `notify` | `notify` pre-fills the resume command, `auto` clears and resumes unattended (opt-in: it spends the fresh window while you're away), `off` does nothing. |
| `handoff_dir` | `.claude/handoffs` | In-project, so a new session or you can find it. Added to `.git/info/exclude` (local-only, tracked files untouched). |
| `handoff_word_budget` | `600` | ≈ 800–1,000 tokens. Enough for a full resume without rebuilding stale context. |

Dev-only override for tests and evals: `AUTO_PAUSE_SIMULATE_PERCENT_LEFT`. Never set it outside tests.

---

## 4. Architecture

### Components

| Component | Path | Job | Why this form |
|---|---|---|---|
| Manifest | `.claude-plugin/plugin.json` | Metadata and `userConfig` | Install-time config dialog. No settings edits. |
| **Monitor/gate mod** | `hooks/hooks.json` → `hooks/register.ts` | Reads `session.measure`, runs the state machine, injects notices, gates tools, blocks Stop once, validates handoffs on write, shows toasts, handles reset, writes the calibration log, registers the two commands | Deterministic. Pushed data. One file. Unit-testable offline. |
| **Handoff skill** | `skills/writing-handoffs/SKILL.md` | How to reach a safe point and write a resumable handoff | Judgment work belongs in a skill. It is also usable manually ("write a handoff"). |
| Template | `skills/writing-handoffs/assets/handoff-template.md` | The section structure | One level deep (best practice) |
| Facts script | `skills/writing-handoffs/scripts/facts.sh` | Git state and paths for the *manual* path. Always exits 0. | "Solve, don't punt". On the auto path the mod puts the facts in the notice. |
| Tests | `hooks/*.test.ts` | State machine, gate, Stop, validation, reset | `claude plugin test`. Free. Under a second. |
| Evals | `evals/` | Skill triggering, handoff quality, resume quality | `claude plugin eval`. Costs quota, so keep it small. |
| Marketplace | `.claude-plugin/marketplace.json` | Install from this repo | `/plugin marketplace add k45sle/Claude-auto-pause` |
| Repo README | `README.md` (repo root, *not* in the skill folder) | Install, config, uninstall, limitations | Guide ch. 5 |

### Turn budget at pause time (the part that must be cheap)

Each turn re-reads the (cached) context, so minimize turns after the pause notice:

1. The notice arrives on a tool result. It is ≤ ~150 tokens and already carries the handoff path, usage, reset time, and git state.
2. Claude finishes or reverts the in-flight step (grace: ≤ 5 calls).
3. Claude invokes the `writing-handoffs` skill (1 turn).
4. Claude writes the handoff (1 turn). The mod validates it inside that same tool call and appends "OK, end your turn" or a specific fix list.
5. Claude ends the turn with a 3-line message (1 turn).

**Target: ≤ 3 turns after the safe point.** Phase 4 compares "invoke skill" against "template inlined in the notice" (saves 1 turn) and picks the cheaper one by measured %.

Rules: never switch model for the handoff (a model switch re-reads the whole history uncached). Effort changes keep the cache on 5.5-family models. Skill `allowed-tools` pre-approves writes to the handoff dir, so nothing stalls on a permission prompt while you're away. If that rule syntax doesn't cover it, a narrow `tool.check` allow in the mod is the fallback.

### Handoff validation (in the mod, on Write/Edit under `handoff_dir`)

- Required headings present. "Next steps" has ≥ 1 item.
- Word count ≤ budget × 1.2.
- No pasted code blocks over 15 lines.
- No secret-looking strings (`sk-ant-`, `ghp_`, `AKIA`, `-----BEGIN`).
- If all checks pass: mark the session PAUSED, release the gate and Stop block, log calibration `{pct_at_notice, pct_at_done, turns, context_tokens, model}`.

### Handoff template (sketch)

```markdown
# Handoff: <task>
Paused <ISO time> · 5h <94>% used · resets <time> · session <name>

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

### Resume

- `/auto-pause:resume`: find the newest unconsumed handoff for this directory, run `/clear`, then submit: *"Read `<path>`. It is your only context. Check that `git status` matches 'Repo state', then do Next step 1. Read only the files it points to unless you need more."* Then mark the handoff consumed.
- **New terminal:** on `session.start`, if a pending handoff exists for this directory, show a toast and pre-fill `/auto-pause:resume`. Nothing is injected into Claude's context, so it costs zero tokens unless you accept.
- **`--resume` of a stale session:** if `prompt_cache_likely_expired` is set and a handoff exists, toast: "This resume re-caches N tokens; `/auto-pause:resume` starts fresh from the handoff."
- **Built-in auto-continue:** the normal path pauses *before* the limit, so the built-in wait never arms. If the limit is hit mid-handoff, let the built-in continue finish the handoff in the old session, then offer resume.

### Repo layout

```
.claude-plugin/plugin.json
.claude-plugin/marketplace.json
hooks/hooks.json
hooks/register.ts
hooks/register.test.ts
skills/writing-handoffs/SKILL.md
skills/writing-handoffs/assets/handoff-template.md
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
description: Writes a compact handoff document that lets a fresh Claude Code session resume the current task without the old conversation. Use when an AUTO-PAUSE notice says the usage-limit pause threshold was reached, or when the user asks to write a handoff, wrap up for a new session, save progress before the usage limit, pause here, or hand off to a fresh session. Do not use for summarizing finished work, changelogs, commit messages, or PR descriptions.
allowed-tools: Read Write Edit Bash(git status:*) Bash(git diff:*) Bash(git log:*)
metadata:
  version: 0.1.0
---
```

(Phase 0 tightens `allowed-tools` to paths under the handoff dir if the rule syntax supports it.)

**Body outline** (target ≤ 120 lines, well under both limits):

1. `## Critical`: as few turns as possible; no exploration; no new work; no model switch.
2. `## Workflow` as a copyable checklist:
   1. Reach a safe point.
   2. Take the facts from the notice, or run `scripts/facts.sh` on the manual path.
   3. Write to the given path using `assets/handoff-template.md`.
   4. If the monitor reports problems, fix them in one Edit.
   5. End with 3 lines: path, reset time, `/auto-pause:resume`.
3. `## Writing rules`: write for a zero-context reader; Next step 1 must be executable as-is; point to files by `path:line` and don't paste them; give each decision its reason; list dead ends; no secrets.
4. `## Example`: one short, filled-in handoff (examples beat descriptions).

**Checklist mapping:**

| Guidance | How it's met |
|---|---|
| Concise; assume Claude is smart | Only the rules Claude lacks (turn budget, resumability bar). No explanation of git or markdown. |
| Degrees of freedom | Low freedom for the safe-point and turn-budget rules. Medium freedom for the template. High freedom for wording. |
| Progressive disclosure, one level deep | SKILL.md → `assets/handoff-template.md`, `scripts/facts.sh` |
| Scripts solve, don't punt; no voodoo constants | `facts.sh` always exits 0 and degrades outside git. Every default in §3 has a stated reason. |
| Feedback loop | Validation runs in the mod on Write: validate → fix → done |
| Consistent terminology | Always "handoff", "pause threshold", "safe point", "resume" |
| No time-sensitive info | Version minimums go in README, not SKILL.md |
| Evals first, ≥ 3 scenarios, test across models | §7. Run the handoff eval on Sonnet and Opus (and Haiku if you use it). |
| Triggering ≥ 90% on relevant queries | 10 should-trigger and 5 should-not queries (§7) |
| Use skill-creator to draft and review | Phase 1 step 2 |

---

## 6. Implementation workflow

**Working method (applies to every phase):**

- One phase per fresh Claude Code session. Start with: *"Read PLAN.md and the latest file in .claude/handoffs/; do Phase N."* From Phase 1 on, end each session by asking for a handoff, which dogfoods the skill.
- Load the plugin from the working copy with `claude --plugin-dir .`. Run `/reload-plugins` after edits.
- Use `claude plugin validate .` and `claude plugin test` (offline, free) after every change to the mod. Run `claude plugin eval` (costs quota) only at the phase gates, and when the 5-hour window has headroom.

| Phase | Goal | Steps | Exit criteria | Size |
|---|---|---|---|---|
| **0. On-machine spike** | Kill the remaining unknowns before building | 1. `claude --version` (mods need ≈ v2.1.290+; the spike used 2.1.304). 2. Throwaway mod: log every `session.measure` to a file; compare with `/usage`. 3. Confirm a `tool.call` `context` notice reaches Claude (ask it to echo a marker). 4. Confirm `classic.Stop` block, `{deny}` for a subagent call, and `tool.check` allow. 5. From a 60 s timer, run `$.command.run({command:'clear'})` then `$.prompt.submit(...)`. Does it survive `/clear`? 6. Check whether skill `allowed-tools` path rules prevent the Write permission prompt. | A written yes/no for each item. **If 2 fails** (old version, org policy `allowManagedModsOnly`, or empty `rateLimits` on your plan), switch to Plan B (§9). | 30–45 min, 1 session |
| **1. Handoff skill (evals first)** | A handoff a fresh session can resume from cold | 1. Write 3 eval scenarios (§7 E1–E3) *before* the skill. Get a baseline with no skill. 2. Draft SKILL.md, template, and `facts.sh` with the **skill-creator** skill. Review against §5. 3. Claude A/B loop: a fresh session resumes from each handoff. Fix what it trips on. | E1–E3 beat baseline. The resuming session does Next step 1 with no clarifying questions. Triggering ≥ 9/10, false triggers 0/5. | 1 session |
| **2. Monitor/gate mod** | Reliable warn → pause → gate → paused | State machine, notices, grace counter, gate allowlist, subagent handling, Stop-once, handoff validation, toasts, calibration log, `.catch` on gating hooks (fail open: a mod bug must never brick a session). Unit tests per transition, including multi-window, reset, and simulated values. | All state-transition tests green. `claude plugin validate` shows no warnings. | 1–2 sessions |
| **3. Resume and reset** | Fresh-context resume in one keystroke | `/auto-pause:resume`, `/auto-pause:status` (readings plus calibration summary), reset timer with `notify`/`auto`/`off`, session-start pending-handoff check, stale-resume toast, `.git/info/exclude` entry, consumed marking. Use `mock.clock` tests for reset timing and sleep-past-reset. | Tests green. Manual run: simulated pause → handoff → `/auto-pause:resume` ends in a cleared session working on Next step 1. | 1 session |
| **4. End-to-end evals and calibration** | Prove it on real behavior; tune defaults | 1. `claude plugin eval` with the simulate env var and `context.history_file` mid-task transcripts (E4–E6). 2. Compare skill-invoke vs. inlined-template turn cost. Keep the cheaper one. 3. Dogfood for a week of normal work. 4. Set `pause_at_percent_left` = p95(handoff cost) + 2 points. | Evals pass at ≥ 2/3 runs per case. ≥ 3 real pauses logged. Defaults updated with the measured numbers. | 1 session + a week of normal use |
| **5. Package and ship** | Installable by others | `marketplace.json`, README (install, config table, limitations, uninstall), version 0.1.0. Install fresh: `/plugin marketplace add k45sle/Claude-auto-pause`, then `/plugin install auto-pause@<marketplace-name>`. | Clean install on a second machine or user works. | < 1 session |
| *(v1.1 option)* | Same flow for context-window exhaustion | Trigger the same handoff when `context.percent` ≥ ~85%, instead of losing detail to auto-compact | — | small |

---

## 7. Testing and eval strategy (no deliberate quota burning)

**Offline unit tests (`claude plugin test`, free).** Fire `$.session.measure(...)` with simulated readings, then `$.tool.call(...)` / `$.classic.Stop(...)` / `$.command.run(...)`, and assert on `context`, `deny`, `block`, and toasts. This pattern is already proven by the spike. Use `mock.clock` for reset timing and `mock.env` for config. Cover: below warn; warn once; pause once; grace countdown; gate; subagent deny; Stop blocks once then releases; valid and invalid handoff; window reset; weekly-only binding; empty `rateLimits` (API key, Team).

**Evals (`claude plugin eval`, cost quota, so keep ~6 cases × 3 runs):**

| ID | Scenario | Graders (free ones first) |
|---|---|---|
| E1 | Manual: "write a handoff, I'm stopping" mid-task (history_file) | `file_exists`, `regex` (headings), `llm` (resumability) |
| E2 | Auto: simulate 6% left during a multi-file edit | `tool_order` (no new edits after grace; skill → Write), turns after notice ≤ 4, `file_exists` |
| E3 | Resume: fresh session given only the handoff | `llm`: did Next step 1 without questions; `regex`: no re-reading of unlisted files |
| E4 | Subagent running when the pause hits | parent receives partial result; handoff mentions it |
| E5 | Should-trigger set (10 paraphrases) / should-not set (5: changelog, PR description, summary of finished work…) | skill loaded / not loaded |
| E6 | Baseline arm (no plugin, same prompts) | `--ablation with-without` delta |

**Real-world check (Phase 4):** don't consume quota on purpose. Let pauses happen during normal work and read the calibration log.

---

## 8. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Mods API is new and moves fast | Pin the minimum version in README. Use the generated types from your installed build. Run `claude plugin validate` and `claude plugin test` in CI. |
| `rateLimits` empty (API key, Team/Enterprise, before first response) | Degrade silently after a one-time "auto-pause inactive: no usage data" toast |
| Figures lag usage from claude.ai chat in parallel | They refresh on this session's next API response, which is when the check runs anyway. The warn margin absorbs the lag. |
| The handoff costs more than the margin on Pro with huge context | Turn budget ≤ 3, gate, calibration log, retune threshold |
| Gate leaves code half-edited | Edits stay allowed during grace. The skill rule "record exact file:line state if you can't finish". The gate never touches the user's prompts. |
| Permission prompt stalls the handoff while you're away | Skill `allowed-tools`, or a narrow `tool.check` allow for the handoff dir only |
| Stop-block loop burns usage | Block at most once per pause (check `stop_hook_active`). Claude Code's own 8-continuation cap is a backstop. |
| `auto` resume spends the fresh window unattended | Opt-in only. Default `notify`. |
| Handoff files end up in commits | `.git/info/exclude`, configurable dir |
| A mod bug blocks all tools | Gating hooks get `.catch` → fail open. Unit tests on every gate path. |

---

## 9. Plan B (only if Phase 0 rules out mods)

Use classic plugin hooks (`hooks/hooks.json` command hooks) and a **status-line tap**:

- **Data:** you add a one-time `statusLine` entry to `~/.claude/settings.json` (plugins can't set it). It runs a tiny wrapper that writes `rate_limits` to a state file, then hands the same stdin to your existing status line command, so your current status line keeps working.
- **Notices:** a PostToolUse hook returns `hookSpecificOutput.additionalContext`.
- **Gate:** a PreToolUse hook returns `permissionDecision: "deny"`.
- **Stop:** a Stop hook returns `decision: "block"` once.
- **Resume pointer:** a SessionStart hook returns `additionalContext`.

What you lose: automatic `/clear` + resume (you run `claude` and paste the resume prompt), toasts (`systemMessage` instead), auto-allow. The skill is unchanged.

---

## 10. Decisions for you (defaults chosen; change any)

1. **On reset:** `notify` (recommended) or `auto`?
2. **Handoff location:** project `.claude/handoffs/`, git-excluded (recommended), or the plugin's data dir outside the repo?
3. **Context-window trigger:** v1.1 (recommended) or v1?

---

## Appendix A: spike-verified mod pattern (Claude Code 2.1.304)

```js
// hooks/register.js (minimal; the real one adds state, grace, Stop, validation)
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
- Claude Code skills: https://code.claude.com/docs/en/skills
- Status line (`rate_limits`): https://code.claude.com/docs/en/statusline
- Hooks reference: https://code.claude.com/docs/en/hooks
- Plugin components (settings keys, monitors, userConfig): https://code.claude.com/docs/en/plugins/components
- Mods overview, reference, testing: https://code.claude.com/docs/en/plugins/mods/overview, https://code.claude.com/docs/en/plugins/mods/reference, https://code.claude.com/docs/en/plugins/mods/test
- Mods types: https://github.com/anthropics/claude-code/blob/main/mods/types/claude-code.d.ts
- Usage-limit auto-continue: https://code.claude.com/docs/en/interactive-mode#wait-for-a-usage-limit-to-reset
- Prompt caching (TTL, resume and compact costs): https://code.claude.com/docs/en/prompt-caching
- Plugin evals: https://code.claude.com/docs/en/plugin-evals
- Background research: `CLAUDE_USAGE_MONITORING_AND_THRESHOLD_ALERTS_HANDOFF_2026-10-19.md` (menu-bar monitors; superseded as a data source by the native feed)
