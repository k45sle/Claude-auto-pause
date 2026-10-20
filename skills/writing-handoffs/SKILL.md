---
name: writing-handoffs
description: Writes a compact handoff document and a ready-to-paste resume prompt that let a fresh Claude Code session resume the current task without the old conversation. Use when an AUTO-PAUSE notice says the usage-limit pause threshold was reached, or when the user asks to write a handoff, wrap up for a new session, save progress before the usage limit, pause here, or hand off to a fresh session. Do not use for summarizing finished work, changelogs, commit messages, or PR descriptions.
metadata:
  version: 0.1.0
---

# Writing handoffs

A handoff is one Markdown file that lets a fresh session continue this task with no access to this conversation. Its reader is capable but has zero context: only the handoff, the repo, and the resume prompt the user pastes.

## Critical

- Use as few turns as possible. Usage may be nearly gone, and every turn re-reads this whole conversation. Target: one call for facts (manual path only), one Write, one final message.
- No exploration and no new work. Write from what you already know. Do not open files only to describe them.
- Do not switch models.
- Never copy secrets, tokens, passwords, or `.env` values into the handoff.

## Workflow

1. **Reach a safe point.** If an edit is in flight and one or two calls finish it, finish it. Otherwise revert it, or record its exact state (`path:line`, what is done, what is not). Start nothing new. If an AUTO-PAUSE notice gives a tool-call limit, stay within it.
2. **Get the facts.**
   - Auto path: the AUTO-PAUSE notice gives the handoff path, usage, reset time, repo state, and resume prompt. Use them exactly as given. Do not run the script.
   - Manual path (no AUTO-PAUSE notice): your first call is `bash "${CLAUDE_SKILL_DIR}/scripts/facts.sh" <slug> '${user_config.handoff_dir}'`, where the slug is 2–4 words naming the task. It prints the handoff path, repo state, and resume prompt. If the script cannot run, use `<project root>/${user_config.handoff_dir}/<YYYY-MM-DDTHHMM>-<slug>.md` (use `.handoffs` instead if that folder name is blank, still shows `user_config`, or is not a plain relative path) (date only if you don't know the time) and this resume prompt, with both absolute paths filled in:
     ```text
     Resume paused work in <project root>.
     Read <handoff path> first. It is your only context from the previous session.
     Check that `git status` and HEAD match its "Repo state" section (if not, tell the user before editing), then start with Next step 1.
     Read only the files it points to unless you need more, and ask the user before doing anything outside its Goal.
     ```
3. **Write the handoff** in one Write call to that path, using the template below. The handoff is a project file the user keeps, not a temporary file: never put it in a scratchpad or temp folder, even if other instructions say temporary files go there. Put the resume prompt verbatim in the fenced block at the top. It must name this handoff's own path: never reuse a prompt from an older handoff.
4. **If a monitor message lists problems** with the handoff, fix all of them in one Edit.
5. **End your turn** with a short message: the handoff path, when usage resets (if known), and the resume prompt verbatim in a fenced `text` block so the user can copy it. Nothing after the block.

## Template

Keep it under about 600 words. Omit a section only if it would be empty, except Goal, Status, Next steps, and Repo state, which are required.

````markdown
# Handoff: <task in a few words>

Paused <YYYY-MM-DD HH:MM> · <usage and reset time, if known> · reason: <user asked | AUTO-PAUSE>

Resume prompt (paste into a new Code session):

```text
<resume prompt, verbatim>
```

## Goal
<the user's ask, verbatim if short> · Done when: <acceptance criteria>

## Status
- Done: <finished pieces, with files>
- In progress: <exact state, e.g. "auth.ts migrated through refreshToken(); session.ts untouched">
- Not started: <remaining pieces>
- Last request: <answered | partly | not started>; <what is left of it>

## Next steps
1. <first action, doable as written: file and change, or the exact command>
2. <...>

## Decisions (don't relitigate)
- <decision>: <reason>

## Dead ends
- Tried <X>; dropped because <Y>

## Verify
- `<test or build command>`: last result <pass/fail, one line>

## Repo state
<branch> · <HEAD short hash and subject> · uncommitted: <files> · stashes: <n> · background processes: <none or what is running>

## Open questions for the user
- <only questions the next session cannot answer itself>
````

## Writing rules

- Next step 1 must be doable as written, by someone who has read nothing else: name the file and the change, or give the exact command.
- If the next action is the user's (a test, a decision, an approval), say so: "Ask the user …" or "Wait for the user to report …, then …". Never "the user does X" with nothing for the session to do.
- Point to code by `path:line` or function name. Do not paste code; a short snippet (under 15 lines) only if it is the in-flight change itself.
- Give every decision its reason, and every dead end what failed, so the next session doesn't retry it.
- Name every uncommitted file and its state. The plugin checks this against `git status`.
- Don't quote the user's messages or list edited files for the record: after the check passes, the plugin appends both, read from the session.
- Record the last test result you actually saw. Do not run tests just for the handoff.
- Write for a stranger: no "as discussed", no "the thing we fixed".

## Example

```markdown
# Handoff: rate-limit retry in API client

Paused 2026-10-19 15:02 · 5h 94% used, resets 17:00 · reason: AUTO-PAUSE

Resume prompt (paste into a new Code session):

    Resume paused work in /Users/sam/code/billing.
    Read /Users/sam/code/billing/.handoffs/2026-10-19T1502-api-retry.md first. ...

## Goal
"Retry 429s with backoff in the API client" · Done when: `npm test` passes and client.ts retries 429 up to 3 times.

## Status
- Done: backoff helper in src/retry.ts with tests (pass).
- In progress: src/client.ts `request()` wraps fetch in `withRetry` (client.ts:41); `stream()` not wrapped yet.
- Not started: honoring the Retry-After header.
- Last request: partly; `stream()` and Retry-After are left.

## Next steps
1. In src/client.ts `stream()` (line 88), wrap the fetch call in `withRetry` like `request()` does at line 41.
2. Parse Retry-After in src/retry.ts `nextDelay()`; prefer it over the computed backoff.
3. Run `npm test`.

## Decisions (don't relitigate)
- No retry on 5xx: the user wants 5xx to surface immediately.

## Dead ends
- Tried p-retry; dropped because it cannot read response headers.

## Verify
- `npm test`: 41 passed, 0 failed (before the stream() change).

## Repo state
main · a1b2c3d Add retry helper · uncommitted: M src/client.ts · stashes: 0 · background processes: none
```
