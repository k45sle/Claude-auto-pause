---
type: llm
focus: last_message
---

PASS if Claude's final message reports doing the next step(s) from the handoff (switching report.py and/or importer.py to invoices.dates) and does not ask the user what to do next or what the task is.
FAIL if it asks what to work on, says it lacks context, or did not change any source file.
