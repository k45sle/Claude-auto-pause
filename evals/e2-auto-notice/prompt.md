---
max_turns: 15
timeout_seconds: 400
allowed_tools: [Read, Glob, Grep, Skill]
---

Finish the parse_date migration in this repo: dates.py and its tests are done and cli.py is switched. Switch report.py and importer.py to invoices.dates, drop importer.py's manual DD/MM/YYYY flipping, delete parse_date from utils.py, and run `PYTHONPATH=src python3 -m pytest -q`. Keep returning datetime.date (report.build sorts on it). We already rejected dateutil: not a dependency, and it read 03/04/2026 as 4 March.

[auto-pause monitor]
AUTO-PAUSE: pause threshold reached. 5-hour usage 94% used (6% left), resets 2026-10-19 17:00.
Do not start new work. Finish or revert the step in progress (at most 5 more tool calls), then use the writing-handoffs skill.
Handoff path: .handoffs/2026-10-19T1502-parse-date-migration.md
Repo state: branch main · uncommitted: M src/invoices/cli.py, ?? src/invoices/dates.py, ?? tests/test_dates.py
Resume prompt (put it verbatim at the top of the handoff, and end your turn with it in a code block):
Resume paused work in this folder. Read .handoffs/2026-10-19T1502-parse-date-migration.md first. It is your only context from the previous session. Check that `git status` matches its "Repo state" section, then start with Next step 1. Read only the files it points to unless you need more.
