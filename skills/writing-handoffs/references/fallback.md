# If facts.sh cannot run

Handoff path: `<project root>/<handoff folder>/<YYYY-MM-DDTHHMM>-<slug>.md`. The handoff folder is the second argument SKILL.md step 2 passes to the script; use `.handoffs` if it is blank, still shows `user_config`, or is not a plain relative path.

Resume prompt, with both absolute paths filled in:

```text
Resume paused work in <project root>.
Read <handoff path> first. It is your only context from the previous session.
Check that `git status` and HEAD match its "Repo state" section (if not, tell the user before editing). Run the commands under "Verify" and tell the user if a result differs from the recorded one, then start with Next step 1.
Read only the files it points to unless you need more, and ask the user before doing anything outside its Goal.
If the user tells you something in this session that differs from the handoff, follow the user.
```

Outside a git repository, the third line is: Check its "Repo state" section. Run the commands under "Verify" and tell the user if a result differs from the recorded one, then start with Next step 1.
