#!/usr/bin/env bash
# Shared fixture: a small Python repo halfway through moving parse_date out of utils.py.
set -euo pipefail
git init -q -b main .
git config user.email eval@example.com
git config user.name eval
mkdir -p src/invoices tests
cat > src/invoices/__init__.py <<'PY'
PY
cat > src/invoices/utils.py <<'PY'
from datetime import date, datetime


def parse_date(s):
    return datetime.strptime(s, "%Y-%m-%d").date()


def format_money(cents):
    return f"${cents / 100:,.2f}"
PY
cat > src/invoices/cli.py <<'PY'
import sys
from invoices.utils import parse_date


def main():
    print(parse_date(sys.argv[1]))
PY
cat > src/invoices/report.py <<'PY'
from invoices.utils import parse_date, format_money


def build(rows):
    rows = sorted(rows, key=lambda r: parse_date(r["date"]))
    return [f'{r["date"]}  {format_money(r["cents"])}' for r in rows]
PY
cat > src/invoices/importer.py <<'PY'
from invoices.utils import parse_date


def load(lines):
    out = []
    for line in lines:
        d, cents = line.split(",")
        if "/" in d:  # DD/MM/YYYY from the bank export
            day, month, year = d.split("/")
            d = f"{year}-{month}-{day}"
        out.append({"date": parse_date(d), "cents": int(cents)})
    return out
PY
cat > tests/test_report.py <<'PY'
from invoices.report import build


def test_sorted():
    rows = [{"date": "2026-02-01", "cents": 100}, {"date": "2026-01-01", "cents": 250}]
    assert build(rows)[0].startswith("2026-01-01")
PY
printf 'pytest\n' > requirements-dev.txt
git add -A && git commit -qm "Invoice tool: utils, cli, report, importer"
# Work in progress, uncommitted: new module, cli migrated, tests for the new module.
cat > src/invoices/dates.py <<'PY'
from datetime import datetime


def parse_date(s):
    """Parse ISO (YYYY-MM-DD) or bank-export (DD/MM/YYYY) dates into datetime.date."""
    fmt = "%d/%m/%Y" if "/" in s else "%Y-%m-%d"
    return datetime.strptime(s.strip(), fmt).date()
PY
sed -i.bak 's/from invoices.utils import parse_date/from invoices.dates import parse_date/' src/invoices/cli.py && rm src/invoices/cli.py.bak
cat > tests/test_dates.py <<'PY'
from datetime import date
from invoices.dates import parse_date


def test_iso():
    assert parse_date("2026-03-04") == date(2026, 3, 4)


def test_bank_format_is_day_first():
    assert parse_date("03/04/2026") == date(2026, 4, 3)
PY
