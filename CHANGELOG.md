# Changelog

## 0.1.14

### The plugin now checks the handoff when you resume, not only when it is written

Before, the plugin checked the note once, at the pause. After that it was up to the new session to compare the note with your project. Now the plugin does that comparison itself.

- When a note passes, the plugin records the commit, the list of uncommitted files, and a fingerprint of their changes.
- When a new session opens the note, the plugin compares that record with the project and tells Claude the result: nothing moved, or what did (new commits, files committed or reverted, changed contents).
- If a newer note exists for the same project, Claude is told to ask which one you meant.
- Limit: for files git does not track yet, only the name is compared, not the contents.

### Claude's todo list is copied into the note

The note already carried your last messages word for word. It now also carries Claude's todo list as it stood at the pause, marked done, in progress or not started. The basic note the plugin writes when Claude runs out first gets the same list, and names the first unfinished item.

### Later default thresholds

| | Warn | Pause |
|---|---|---|
| 5-hour limit | 7% left (was 15%) | 4% left (was 8%) |
| Weekly limit | 3% left (was 10%) | 2% left (was 3%) |

In 24 recorded pauses on the author's machine, writing the note used between 0 and 2 points of the 5-hour limit, so pausing at 8% left more unused than needed. If you set your own values, they are kept.

### Tests

- 173 tests, up from 150.
- 11 of the new ones each break a valid note in one way (a missing section, a wrong commit, an unnamed file, a secret, a wrong resume prompt, too long, an oversized code block) and confirm the check catches it.

### Considered and dropped

Two extra checks were tried against 45 real notes and left out: "is the first next step specific enough" (42 already were, and the 3 flagged were fine) and "do the file references exist" (the flagged ones sampled were false alarms).

### Not yet tested

A full pause and resume in a live session. The new behaviour is covered by the plugin's test engine only.
