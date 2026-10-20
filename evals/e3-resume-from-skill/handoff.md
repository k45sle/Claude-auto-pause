# Handoff: move parse_date to dates.py

Paused 2026-10-19 · usage unknown · reason: user asked

Resume prompt (paste into a new Code session):

```text
Resume paused work in __WORKSPACE__.
Read __WORKSPACE__/.handoffs/2026-10-19-move-parse-date.md first. It is your only context from the previous session.
Check that `git status` matches its "Repo state" section, then start with Next step 1.
Read only the files it points to unless you need more.
```

## Goal
Move `parse_date` out of src/invoices/utils.py into a new src/invoices/dates.py, make it accept both ISO dates (YYYY-MM-DD) and the bank export's DD/MM/YYYY, switch the three call sites (cli.py, report.py, importer.py) to the new module, then delete the old function from utils.py.
Done when: `PYTHONPATH=src python3 -m pytest -q` passes and utils.py no longer defines `parse_date`.

## Status
- Done: src/invoices/dates.py with the new `parse_date` (ISO + DD/MM/YYYY, returns `datetime.date`); tests/test_dates.py (both tests pass); src/invoices/cli.py now imports `parse_date` from `invoices.dates`.
- Not started: src/invoices/report.py and src/invoices/importer.py still import `parse_date` from `invoices.utils`. importer.py also still has its own DD/MM/YYYY string flipping (reorders the date string before calling `parse_date`), which is now redundant.
- Not started: removing `parse_date` from src/invoices/utils.py.

## Next steps
1. In src/invoices/report.py, change the `parse_date` import from `invoices.utils` to `invoices.dates`.
2. In src/invoices/importer.py, make the same import change, then delete its hand-rolled DD/MM/YYYY → ISO string flipping so the raw bank-export string goes straight to `parse_date`.
3. Delete `parse_date` from src/invoices/utils.py. Grep `parse_date` across src/ and tests/ to confirm nothing else imports it from utils (also check any utils tests that reference it).
4. Run `PYTHONPATH=src python3 -m pytest -q` and fix any failures.
5. Nothing is committed. Ask the user before committing.

## Decisions (don't relitigate)
- `parse_date` returns `datetime.date`, not `datetime.datetime`: `report.build` sorts by it, and rows elsewhere hold plain dates. Mixing the two types breaks comparisons.
- Parse explicitly with the two formats (`%Y-%m-%d`, `%d/%m/%Y`) using the standard library.

## Dead ends
- Tried `dateutil.parser`; dropped because it is not a project dependency, and it read "03/04/2026" as 4 March (month-first) instead of 3 April.

## Verify
- `PYTHONPATH=src python3 -m pytest -q`: last seen result was tests/test_dates.py with both tests passing. No full-suite run has been recorded since cli.py was switched.

## Repo state
main · 9a4c672 Invoice tool: utils, cli, report, importer · uncommitted: M src/invoices/cli.py, ?? src/invoices/dates.py, ?? tests/test_dates.py (plus this .handoffs/ file) · stashes: unknown · background processes: none
