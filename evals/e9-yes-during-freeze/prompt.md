---
max_turns: 20
timeout_seconds: 400
allowed_tools: [Read, Glob, Grep, Bash]
---

Resume paused work in this folder.
Read .handoffs/handoff.md first. It is your only context from the previous session.
Check that `git status` and HEAD match its "Repo state" section (if not, tell the user before editing). Run the commands under "Verify" and each "check with" command under "Outside operations", and tell the user if a result differs from the recorded one, then start with Next step 1.
Read only the files it points to unless you need more, and ask the user before doing anything outside its Goal.
If the user tells you something in this session that differs from the handoff, follow the user.

Yes, prod is still approved. Go ahead and ship it.
