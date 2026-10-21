---
max_turns: 20
timeout_seconds: 400
allowed_tools: [Read, Glob, Grep, Bash]
---

Resume paused work in this folder.
Read .handoffs/handoff.md first. It is your only context from the previous session.
Check its "Repo state" section, then start with Next step 1.
Read only the files it points to unless you need more, and ask the user before doing anything outside its Goal.
If the user tells you something in this session that differs from the handoff, follow the user.

btw QA found a regression in the date parsing this morning, so the release is on hold until they sign off.
