---
type: llm
focus: trace
---

Look at the handoff file Claude wrote (the content of its Write to .handoffs/).
PASS if: the resume prompt is at the top; it states the goal; Status says which of report.py, importer.py and utils.py are done or not; it records, in any section, why parse_date must keep returning datetime.date and why dateutil was rejected; it gives the pytest command; and Next step 1 is concrete: a specific file and the change to make, or, if every edit is already done, the exact command to run.
FAIL if any of those is missing or Next step 1 is vague.
