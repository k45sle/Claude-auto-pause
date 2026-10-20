---
max_turns: 20
timeout_seconds: 500
allowed_tools: [Read, Glob, Grep, Skill]
env:
  EVAL_AUTO_PAUSE_SIMULATE_PERCENT_LEFT: "6"
  EVAL_AUTO_PAUSE_SIMULATE_AFTER_CALLS: "6"
---
Finish the parse_date migration in this repo: dates.py and its tests are done and cli.py is switched. Switch report.py and importer.py to invoices.dates, drop importer.py's manual DD/MM/YYYY flipping, delete parse_date from utils.py, and run `PYTHONPATH=src python3 -m pytest -q`. Keep returning datetime.date (report.build sorts on it). We already rejected dateutil: not a dependency, and it read 03/04/2026 as 4 March.
