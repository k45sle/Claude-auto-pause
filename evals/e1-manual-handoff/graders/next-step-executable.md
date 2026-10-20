---
type: llm
focus: trace
---

Look at the handoff file Claude wrote (the content of its Write call).
PASS if all of these hold: it states the goal and the done-when condition; it says report.py and importer.py still need switching and that importer.py's manual DD/MM/YYYY flipping must be removed; it records the datetime.date decision with its reason and the dateutil dead end with why it failed; it gives the pytest command; and its first next step names a specific file (report.py or importer.py) and the concrete change, so someone with no other context could do it without asking a question.
FAIL if any of those is missing, if the first next step is vague (such as "continue the migration"), or if no handoff file was written.
