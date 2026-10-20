# Handoff: move parse_date into invoices/dates.py

## Goal
Move `parse_date` out of `src/invoices/utils.py` into the new `src/invoices/dates.py`. It must accept both ISO dates (`YYYY-MM-DD`) and the bank export's `DD/MM/YYYY`. Switch all three call sites (`cli.py`, `report.py`, `importer.py`) to the new module, then delete the old function from `utils.py`.

**Done when:** `PYTHONPATH=src python3 -m pytest -q` passes and `utils.py` no longer defines `parse_date`.

## Status (nothing committed yet)
- [x] `src/invoices/dates.py`: new `parse_date`. If the string contains `/` it uses `%d/%m/%Y`, otherwise `%Y-%m-%d`. It strips whitespace and returns `datetime.date`.
- [x] `tests/test_dates.py`: covers both formats. Passes.
- [x] `src/invoices/cli.py`: now imports from `invoices.dates`.
- [ ] `src/invoices/report.py` line 1: `from invoices.utils import parse_date, format_money`. Move only `parse_date` to `invoices.dates`. **`format_money` stays in utils.**
- [ ] `src/invoices/importer.py`: switch the import to `invoices.dates`, and delete the manual DD/MM/YYYY flip on lines 8–10 (the `if "/" in d:` block). After that the loop body is just `d, cents = line.split(",")` followed by `out.append({"date": parse_date(d), ...})`.
- [ ] `src/invoices/utils.py`: delete `parse_date`. The `from datetime import date, datetime` import is then unused, so remove it (`date` was already unused).
- [ ] Run the full suite (`tests/test_report.py` + `tests/test_dates.py`). Also check that nothing else imports `parse_date` from utils: `grep -rn "utils import" src tests`.

## Decisions already made (don't revisit)
- **Return `datetime.date`, not `datetime`.** `report.build` sorts by it, and rows elsewhere hold plain dates. Mixing the two types breaks comparisons.
- **No `dateutil`.** We tried `dateutil.parser` and dropped it. It isn't a dependency, and it read `"03/04/2026"` as 4 March (month-first), which is wrong for the bank export. Explicit `strptime` formats are deliberate.

## Notes
- Test command: `PYTHONPATH=src python3 -m pytest -q`
- Optional: an importer test with a `DD/MM/YYYY` line (e.g. `"03/04/2026,100"` → `date(2026, 4, 3)`) would confirm the flip removal didn't change behavior.
- Delete this file before committing.
