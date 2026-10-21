# Example handoff

````markdown
# Handoff: rate-limit retry in API client

Paused 2026-10-19 15:02 · 5h 94% used, resets 17:00 · reason: AUTO-PAUSE

Resume prompt (paste into a new Code session):

```text
Resume paused work in /Users/sam/code/billing.
Read /Users/sam/code/billing/.handoffs/2026-10-19T1502-api-retry.md first. It is your only context from the previous session.
Check that `git status` and HEAD match its "Repo state" section (if not, tell the user before editing). Run the commands under "Verify" and tell the user if a result differs from the recorded one, then start with Next step 1.
Read only the files it points to unless you need more, and ask the user before doing anything outside its Goal.
If the user tells you something in this session that differs from the handoff, follow the user.
```

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
````
