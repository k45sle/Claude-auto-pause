# Phase 3 results: end-to-end evals and calibration

Run 2026-10-19 with Claude Code 2.1.303, `claude plugin eval`, 3 runs per arm, default model (Opus 5.5). Raw JSON is in `evals/results/` (gitignored). Steps 1 and 2 are done; steps 3 and 4 (a week of real use, then retuning `pause_at_percent_left`) are still open.

| Check | Result |
|---|---|
| E2r real mod, pause lands after 6 tool calls (`evals/e2r-real-mod`) | 2/3 runs pass all graders, score 0.92. Every run used the skill, wrote one handoff at the mod's path, stayed in the grace budget, and ended with the absolute-path resume prompt. The one miss was the LLM judge on handoff content. 12–13 turns, $0.17–0.20 per run (the whole task, not only the handoff). |
| E2r rerun with revised graders | v2: 0/3, score 0.73. Every run failed handoff-quality. A `--keep-temp` rerun showed the handoffs were fine. The rubric required Next step 1 to be a file edit, which fails a run that finished every edit before pausing and whose next step is the pytest command. The rubric now also accepts the exact command when no edit is left. v3: 2/3 pass, score 0.93, handoff-quality 3/3, 11–13 turns, $0.17–0.21. The one failure is real: Claude made new-file edits after the pause and went past the 5-call grace (stopped-in-grace). |
| E6 baseline: same case, no plugin | 0/3, so the delta is +0.92. Without the mod nothing pauses and no handoff is written. |
| E4 subagent running when the pause hits (`evals/e4-subagent-pause`) | 2/3 pass, score 0.92. In every run the mod denied the subagent's next call, the parent got the partial result, spawned nothing new, and wrote the handoff. The failing run's handoff did record what the subagent read and that report.py/importer.py were untouched, so that miss looks like judge noise. After review, the "no second subagent" check moved from the LLM grader to a deterministic `tool_used Agent max 1`, and the LLM graders no longer depend on the notice, which the trace does not show. 5 turns, about $0.18 per run. Rerun with the revised graders: 3/3 pass, score 1.0. |
| E5 triggering | Not rerun. The skill did not change since Phase 1 (10/10, 0/5 false triggers). |
| Skill vs. template inlined in the notice | Inline variant: a scratch copy whose notice said "write the handoff in one Write call (no skill needed)" and listed the template's headings in one line, scored without the `skill-fired` grader. 1/3 pass, 10–11 turns, $0.17–0.20. The skill arm took 1–2 more turns but cost the same (mean $0.181 vs. $0.185, inside run-to-run noise). Cost is what the pause margin pays for, and inlining saved none, so **the skill stays**. The quality gap (2/3 vs. 1/3) is one run and not evidence on its own. |
| `claude plugin test .` | 29/29 pass |
| `claude plugin validate .` | passes |

Eval cost for this phase: about $3.40, including runs lost to the harness problems below.

## Changes made in this phase

- New dev-only `AUTO_PAUSE_SIMULATE_AFTER_CALLS=N`: the simulated reading lands once N tool calls have run (main thread or subagent), so a case can hit the pause mid-task or while a subagent works. Without it, behavior is unchanged.
- The mod also reads `EVAL_AUTO_PAUSE_SIMULATE_PERCENT_LEFT` and `EVAL_AUTO_PAUSE_SIMULATE_AFTER_CALLS`. `claude plugin eval` passes only allowlisted variables to a case (`EVAL_*`, `CLAUDE_CODE_*`, `ANTHROPIC_*` …), and a case file may set only `EVAL_*` ones. The cases set them in `prompt.md` front matter.
- Bug fix (found by the reviewer): the simulated reading kept the real `resetsAt`, or none when no real reading had arrived yet. The next real `session.measure` then changed the window key, which looked like a reset: the pause restarted, the grace counter went back to 0, and a session that had already written its handoff was paused again. The simulated reading now never has `resetsAt`, so its key is stable. A regression test covers it.

## Harness findings (for future eval work)

- The simulated notice says "reset time unknown" (the simulated reading has no `resetsAt`), so the evals do not cover the reset time in the final reply. Unit tests do.
- The eval trace is stream-json. It does not include the `context` a mod adds to tool results, so a grader cannot see the AUTO-PAUSE notice or the "handoff OK" message. The cases grade the effects instead: a Write to the `<stamp>-auto-pause.md` path, the resume prompt in the reply, and the skill call.
- `$.env.get` needs a literal name; a helper that builds the name fails module load.
- `context.history_file` turns off the baseline arm. The cases use `AFTER_CALLS` to land mid-task instead, which keeps E6 in the same run.

## Calibration (steps 3 and 4, open)

- Real readings come in whole percents (`utilization: 0.77` in the stream). A single handoff costs about $0.03–0.06 after the notice, so on Max it will usually register as 0 or 1 point. The p95 rule (p95 + 2) therefore needs a few real pauses, ideally on the smallest plan you use, before it means anything.
- `pause_at_percent_left` default is 8 (pause at 92% used), set by the owner on 2026-10-20. Steps 3–4 (a week of real use, retune to p95 + 2) are dropped: users adjust the value themselves. `/auto-pause-status` still prints a suggested value from the calibration log.

## Commands

```bash
claude plugin eval . --case e2r-real-mod --scaffold --trust-plugin --no-publish --threshold 0 -j 3 --json evals/results/e2r.json --allow-tools Write Edit
claude plugin eval . --case e4-subagent-pause --ablation none --scaffold --trust-plugin --no-publish --threshold 0 -j 3 --json evals/results/e4.json --allow-tools Write Edit
```
