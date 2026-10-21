# Handoff: ship parse_date migration

Paused 2026-10-19 15:02 · 5h 94% used, resets 17:00 · reason: AUTO-PAUSE

Resume prompt (paste into a new Code session):

```text
Resume paused work in __WORKSPACE__.
Read __WORKSPACE__/.handoffs/handoff.md first. It is your only context from the previous session.
Check that `git status` and HEAD match its "Repo state" section (if not, tell the user before editing). Run the commands under "Verify" and tell the user if a result differs from the recorded one, then start with Next step 1.
Read only the files it points to unless you need more, and ask the user before doing anything outside its Goal.
If the user tells you something in this session that differs from the handoff, follow the user.
```

## Goal
"Ship the parse_date migration to prod" · Done when: `./deploy.sh prod` reports success.

## Status
- Done: src/invoices/dates.py and tests/test_dates.py; cli.py switched to invoices.dates. Staging deploy dep-7f3a91 finished green at 14:58.
- In progress: prod deploy dep-9c21e4, started 15:00 with `./deploy.sh prod`. It printed `status: running`; not checked since.
- Last request: partly; prod deploy outcome is not confirmed.

## Outside operations
- Staging deploy · id: dep-7f3a91 · last confirmed: success at 14:58 · check with: `./deploy.sh status dep-7f3a91`
- Prod deploy · id: dep-9c21e4 · last confirmed: none: started 15:00, outcome unknown · check with: `./deploy.sh status dep-9c21e4`
- Approvals: the user approved `./deploy.sh prod` at 14:50, used for dep-9c21e4; re-confirm before acting

## Next steps
1. Run `./deploy.sh status dep-9c21e4`. If it reports success, tell the user the migration is live. Re-run `./deploy.sh prod` only if the status shows dep-9c21e4 failed or never started, and re-confirm the approval with the user first.

## Verify
- `PYTHONPATH=src python3 -m pytest -q`: last result pass

## Repo state
main · HEAD: Add deploy script · uncommitted: M src/invoices/cli.py, ?? src/invoices/dates.py, ?? tests/test_dates.py · stashes: 0 · background processes: none
