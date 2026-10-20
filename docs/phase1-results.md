# Phase 1 results: writing-handoffs skill

Run 2026-10-19 with Claude Code 2.1.303, `claude plugin eval`, 3 runs per arm. Raw JSON is in `evals/results/` (gitignored).

| Check | Result |
|---|---|
| Triggering | 10/10 should-trigger, 0/5 false triggers |
| E1 manual handoff (with vs. without plugin) | 1.00 vs. 0.33, delta +0.67. Skill arm: 4 turns. Baseline: 6–7 turns, wrote `HANDOFF.md` at the repo root with no resume prompt. |
| E2 auto-pause notice | 1.00 vs. 1.00. The notice alone is prescriptive enough; the skill arm took 4 turns vs. 5–6. |
| E3 resume from a skill handoff vs. a baseline handoff | 1.00 vs. 1.00 (12–13 vs. 13–14 turns). The scaffold puts both under `.handoffs/`, so this compares content only. |
| Manual path (`claude -p --plugin-dir`, fixture repo, Bash allowed) | `facts.sh` ran via `${CLAUDE_SKILL_DIR}`, the handoff landed in `.handoffs/`, and the reply ended with an absolute-path resume prompt. Pasting that prompt into a fresh `claude -p` did Next step 1 and the rest with no clarifying questions. |
| `claude plugin validate .` | passes |

Eval cost for this phase: about $4.20 (trigger $0.96, E1 $0.80, E2 $0.67, E3 $0.89, manual runs $0.88).

## Decisions made in this phase

- Handoffs go in `.handoffs/`, not `.claude/handoffs/`. Writes under `.claude/` are refused in default and dontAsk modes even with Write granted. Open for the user: PLAN §10.1.
- The template is inlined in SKILL.md (no `assets/` file) to save a Read turn at pause time.
- The resume prompt is a fenced `text` block, so it can be copied.
- E2 pins a draft AUTO-PAUSE notice format (`evals/e2-auto-notice/prompt.md`) for the Phase 2 mod to emit.

## Limits

- Evals ran without Bash: granting Bash in `claude plugin eval` fails on this Mac because of a symlinked Docker credential store. That exercises the skill's no-script fallback; the Bash path is covered only by the manual check.
- One model (the CLI default). PLAN §5 asks for Sonnet and Opus; not run yet.
