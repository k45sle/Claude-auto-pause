# Simulated users and abuse testing (2026-10-20)

Claude Code 2.1.303 on macOS, headless `claude -p` in scratch git repos, versions 0.0.5 to 0.0.8. A Desktop session was not part of this round.

## Simulated users

| Scenario | Model | Result |
|---|---|---|
| Normal work at 50% left | Haiku | No notices, task finished |
| Pause lands mid-task | Haiku, Sonnet | Skill loaded, handoff checked on the first write, session facts appended |
| User tells Claude to ignore any pause | Haiku | Gate held, Claude wrote the handoff |
| Same | Sonnet | Claude finished its edits inside the 5 grace calls and refused the handoff; the plugin wrote the facts-only one on the second Stop |
| "Write a handoff, I'm out of time" with no pause | Haiku, Sonnet | Failed before the fixes below; after them, written to `.handoffs/` and checked |
| Project that is not a git repo | Haiku | Pause and handoff worked |
| `/auto-pause-status` | none | Shows state and thresholds |
| Fresh install from GitHub in an empty config folder | none | Install, configure and uninstall all worked; the README's configure example failed |

## What the testing found and what changed

- Any `allowed-tools` line in the skill stops Claude Code from loading it in acceptEdits mode: the Skill tool answers "Execute skill" and no instructions arrive, so Claude improvised a handoff in its scratchpad or the project root. The line is gone. While pausing, the mod's `tool.check` approves the exact handoff path and read-only git.
- The skill now says the handoff is a project file and never goes in a scratchpad.
- Claude chains read-only git (`cd <root> && git status && git diff`). The gate refused these, Claude spent its calls on refusals, and both Claude's partial handoff and the facts-only one ended up in the folder. Safe chains now pass.
- One model called the gate's messages instructions from tool output. The notice and the gate message now say they come from the auto-pause plugin the user installed.
- The README's configure example needs the value in quotes. The README now starts with install steps for someone who has never used a terminal, how to check it works, what the pause looks like, and how to resume.

## Abuse review

Two reviewer passes and two rechecks found these. Each now has a test.

- The read-only git check was a regex that a line break, quotes or braces could get around (`git status` plus a newline and any command; `git log --out"put"=f`). It is now an allowlist: plain characters only, five read-only subcommands, no `--output`, `--ext-diff`, `--textconv`, `--no-index` or `-O`, and `cd` only into the project root (another folder's `.git/config` can make `git status` run a program).
- The skill pre-approved Write and Edit anywhere and a `bash *facts.sh*` pattern that also matched `bash -c`.
- Reads while gated are capped at 10.
- A tool input field named `tool` could make any MCP call look like the handoff to the auto-approval.
- A handoff folder that is a symlink out of the project, or a dangling one, is no longer auto-approved.
- On git older than 2.31 the exclude step could write a junk file, and a read failure could replace the user's excludes.
- Settings out of range (word budget 0, 0 points, 500% left) now fall back to the defaults. Claude Code itself rejects blank and non-numeric values.

Not changed: a repo's project settings can set the simulate variables and force a pause. Project settings can already run arbitrary hooks, so this adds nothing an attacker lacks.

## Checks

`claude plugin test .`: 72 pass. `claude plugin validate .`: pass. `tsc` against the 2.1.299 types: no errors. Final end-to-end run on the installed 0.0.8: handoff checked, facts appended, $0.012.

Not tested: a Desktop session, a real usage reading near the limit, and a real `rate_limit` stop.

# Round 2: simulated users and abuse testing (2026-10-20, 0.1.3 to 0.1.4)

Claude Code 2.1.303 on macOS. Four agents ran in parallel, one per persona: a newcomer following the README word for word, a messy real user, an attacker targeting users, and a read-only audit of what the publisher exposes. Personas 1 to 3 installed the plugin from a local clone of HEAD into a scratch `CLAUDE_CONFIG_DIR` and drove headless Haiku runs, with the pause forced by `AUTO_PAUSE_SIMULATE_PERCENT_LEFT`. Their Haiku runs cost $0.17 in total. Round 1's scenarios were not repeated; `claude plugin test .` covers them.

A fresh `CLAUDE_CONFIG_DIR` is not logged in, so model runs used the real login with `--plugin-dir <installed copy> --setting-sources project,local --no-session-persistence --strict-mcp-config`. That loads only the test copy, but the mod's store still lands in `~/.claude/plugins/store/auto-pause_inline-*.json`.

## Simulated users

| Scenario | Model | Result |
|---|---|---|
| Install, `/auto-pause-status`, the README's configure command, update to a bumped version, uninstall | none | All worked. The README did not explain the "8 userConfig options not yet set" message, had no Update section, and did not say what uninstall leaves behind |
| Pause after 2 tool calls in a git project, then the resume prompt in a new session | Haiku | Handoff checked and facts appended; the new session confirmed git state and did the next steps |
| Manual handoff with two uncommitted files | Haiku | Usage and word budget arrived on the facts.sh call and went into the handoff |
| Pause in a folder that is not a git repo | Haiku | Worked, no exclude line written |
| Two sessions in one project pausing in the same minute | Haiku | Failed: both got the same handoff path and one overwrote the other |
| Monorepo subfolder; folder and file names with spaces and non-ASCII letters | Haiku | Worked, but names showed octal-escaped and `cd "<root>" && git status` lost auto-approval |
| Pause while a subagent runs | Haiku | The subagent stopped and returned; the parent then used its grace calls to redo the subagent's remaining writes |
| No usage data (API key, Team) | none | Stays idle; the status line read as if data would arrive later |
| Pause above warn, 0 grace calls, 100-word budget, nested `handoff_dir` | Haiku | Worked; a warn at or below pause never warns and nothing says so |
| Resume after a new commit, and after a file changed under the same status line | Haiku | Both differences reported to the user before any edit |
| 40 changed files | none (offline) | As designed: 12 listed plus "+28 more", no per-file check above 15 |
| Planted handoff with an injected extra step, opened through its resume prompt | Haiku | Claude did the real task, refused the injected step and told the user |

## What the testing found and what changed (0.1.4)

Against users, most harmful first:

- `git diff .env /dev/null` and `git diff ~/.aws/credentials x` printed the whole file, and the gate approved them without asking. Git switches to a no-index diff when a path is outside the repo, so blocking the `--no-index` flag was not enough. The allowlist now refuses absolute paths, `~` and `..` path segments; ranges like `HEAD~1..HEAD` still pass.
- A repo whose own `.git/config` sets `core.fsmonitor` or `diff.external` ran a program through the "read-only" `git status` and `git diff`. The mod's own git calls now pass `-c core.fsmonitor=false`. While pausing it approves no Bash git in a repo whose local config sets fsmonitor to a program, diff drivers, filters, gpg or includes.
- A dangling symlink planted at the handoff file name was picked as the path, and the facts-only fallback wrote through it to a file outside the project. File names are now checked without following links (mod and facts.sh). The fallback never writes through a link or into a folder that leads outside, and a handoff whose real path is outside the project is neither checked nor extended.
- Two sessions pausing in one project in the same minute shared a path. Auto-pause file names now end in six characters of the session id.
- Redaction missed `https://user:pass@` URLs, GitLab and Stripe keys, JWTs, npm `_authToken`, JSON `"password"` fields and `DB_PASS=` lines. All are caught now. The env-line pattern took quadratic time on long runs of newlines; it is linear now.
- A file name containing a quote could never be named the way validation wanted, so after three tries the gate opened with an unverified handoff. Git's C-style quoting is decoded, and every status call uses `core.quotePath=false`.

Found by the user personas:

- A second handoff after a finished or released pause was checked against the old pause's resume prompt and could never pass. The notice's prompt now applies only while the pause is active.
- 0.1.3's tag stripping removed a user's own leading tags, so `<task>Fix the parser</task> and rerun` became "and rerun", and a request made only of tag blocks disappeared from the facts. Only harness tags are stripped now.
- `cd "<root>" && git status` lost auto-approval when the folder name had non-ASCII letters, an apostrophe or parentheses. The check now follows bash quoting.
- `handoff_dir` of `a//b` wrote an exclude line git ignores, `.git/...` and `.claude/...` (in any letter case) were accepted, and `src` hid the user's new source files from git status. Slashes collapse, `.git` and `.claude` fall back to `.handoffs`, and a folder that holds tracked files gets no exclude line.
- facts.sh printed paths relative to a subfolder and octal-escaped names. It now runs git at the repo root with quotePath and fsmonitor off.
- `/auto-pause-status` printed "auto-pause: auto-pause:" because the CLI adds the plugin name. It now starts with `State:`, lists every value in use, names any value it ignored, warns when warn is not above pause, and explains plans with no usage data.
- README: what to do when `claude` is not found, the "options not set" message, an Update section, what uninstall leaves behind, and a Security section.

Each fix has a test in hooks/register.test.ts (77 tests before, 123 now). The facts.sh fixes are checked by `hooks/facts.selfcheck.sh`, which runs real git in temp repos; the plugin test runner cannot spawn processes, so run it by hand. A reviewer pass on the full diff found three more bugs (the mod and facts.sh normalised `.//x` differently, `.Git` slipped past the check on macOS, and the tracked-folder check ran from a subfolder); each is fixed and tested.

## Publisher audit (read-only)

- Every human commit is by `RK <rk@m2.local>`, which links the k45sle handle to a machine name. Nothing else personal is in the history: no home paths, emails, tokens, transcripts or handoffs (`.handoffs/` and `evals/results/` were never committed). Changing the identity needs a history rewrite and force-push before the repo goes public; not done.
- register.ts credits handoff-now for the redaction list and the read-only git rule, with no license recorded. It is talal-ai/handoff-now, Apache 2.0, and our env-variable pattern is nearly its own. 0.1.5 adds a NOTICE file and the Apache 2.0 text in `licenses/`; the git allowlist is separate code that follows the same idea.
- The install copies the whole repo, including docs/ and evals/, which are not needed at runtime. PLAN.md, the internal plan, has since been taken out of the repo.
- A malicious update runs as the user. The mod API has process.run and spawn, file read and write on any absolute path, http.fetch, env get and set, the session transcript, and tool.check approval of tool calls. The marketplace entry points at the default branch with no pinned commit or tag, so anyone who can push controls every user's next update. What limits it: Claude Code leaves auto-update off by default for third-party marketplaces, so users get new code only when they run the update command, and only the owner account has push access (checked with the GitHub API on 2026-10-20). The rest depends on that account's security; it has two-factor authentication on (confirmed by the owner, 2026-10-20). The README says how to install from a reviewed clone.
- README claims with no test: the weekly warn default, the organization-managed Stop hooks, the Desktop notification, and the prompt-cache cost argument. The no-data toast now has one.

Not changed:

- A repo with a hostile `.git/config` can still make the mod's own `git status` run a filter driver. Claude Code and the user's shell already run `git status` there, so the plugin adds no exposure, and `git clone` cannot set `.git/config`.
- Two manual handoffs with the same slug in the same minute, in two sessions, still share a facts.sh path. Both sessions would have to be asked for a handoff of the same task in the same minute; reserving the name by creating the file would make Claude Code refuse the later Write (the two-session run showed it: "File has not been read yet").
- After a subagent is stopped, the parent may redo its remaining work inside the grace calls. That is what the grace calls are for (finish the step in progress), and they stay capped at 5 calls or 3 points.
- Any Bash command that mentions the facts.sh path gets the usage line appended, even `cat` or `grep`. Harmless: the line is only usage figures, and only commands that name the script get it.

Fixed in 0.1.5: a file name alone counted as naming a changed file, so `src/index.ts` and `test/index.ts` passed with one mention of `index.ts`. When two changed files share a name, each now needs its path.

## Checks

`claude plugin test .`: 123 pass. `bash hooks/facts.selfcheck.sh`: all passed. `claude plugin validate .`: pass. `tsc` against the 2.1.299 types: no errors. End to end on the installed 0.1.4, in a folder named `Café work` with a non-ASCII file: the pause landed after 2 tool calls, the handoff at `.handoffs/<stamp>-auto-pause-<id>.md` passed on the first write and named both changed files, the session facts were appended, and `/auto-pause-status` showed the new layout; $0.008.

Live, in the session that ran this round (the installed 0.1.3, real usage): the weekly warning arrived on a tool result at 90% used.

Not tested: a Desktop session (`/auto-pause-status` as the first message of a new chat, notifications, `/reload-plugins` mid-pause), a real pause at the limit and a real `rate_limit` stop, an install on a second user account, Sonnet and Opus, an API-key account, git worktrees and submodules, Windows.
