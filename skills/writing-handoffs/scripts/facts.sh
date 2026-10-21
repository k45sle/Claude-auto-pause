#!/usr/bin/env bash
# Prints the facts a handoff needs: handoff path, repo state, resume prompt.
# Usage: facts.sh [task-slug] [handoff-dir]. Creates the handoff folder and keeps it out of git. Always exits 0.
set -u
# Slug: lowercase words joined by '-', at most 40 characters so the file name stays readable.
slug=$(printf '%s' "${1:-task}" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-' | sed 's/^-*//; s/-*$//' | cut -c1-40)
[ -n "$slug" ] || slug=task
# The plugin's handoff_dir option, substituted into SKILL.md. Same rule as the mod: relative, plain
# characters, no `..`; anything else (including the unsubstituted placeholder) falls back to .handoffs.
dir_rel=$(printf '%s' "${2:-}" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//; s#^\./##; s#/*$##; s#//*#/#g')
case "$dir_rel" in ''|.|/*|*..*|*[!A-Za-z0-9._/-]*) dir_rel=.handoffs ;; esac
# Case-insensitive: on macOS .Git is .git.
case "$(printf '%s' "$dir_rel" | tr '[:upper:]' '[:lower:]')" in .git|.git/*|.claude|.claude/*) dir_rel=.handoffs ;; esac

project=$(git rev-parse --show-toplevel 2>/dev/null) && in_git=1 || { project=$PWD; in_git=0; }
dir="$project/$dir_rel"
mkdir -p "$dir" 2>/dev/null
stamp=$(date +%Y-%m-%dT%H%M)
path="$dir/$stamp-$slug.md"
# -L: a planted dangling symlink counts as taken.
n=2; while [ -e "$path" ] || [ -L "$path" ]; do path="$dir/$stamp-$slug-$n.md"; n=$((n + 1)); done

echo "project: $project"
echo "handoff path: $path"
echo "now: $(date '+%Y-%m-%d %H:%M %Z')"
if [ "$in_git" = 1 ]; then
  # Root-relative, unquoted paths; fsmonitor off so a repo's own config cannot make this run a program.
  G() { git -C "$project" -c core.quotePath=false -c core.fsmonitor=false "$@"; }
  cd "$project" || exit 0 # --git-path answers relative to the cwd
  exclude=$(git rev-parse --git-path info/exclude 2>/dev/null)
  # Excluding a folder that holds tracked files (e.g. src) would hide the user's new files there.
  tracked=$(git -C "$project" ls-files -- "$dir_rel" 2>/dev/null | head -1)
  if [ -n "$exclude" ] && [ -z "$tracked" ] && ! grep -qxF "/$dir_rel/" "$exclude" 2>/dev/null; then
    mkdir -p "$(dirname "$exclude")"
    # Start on a fresh line if the file lacks a trailing newline.
    [ -s "$exclude" ] && [ -n "$(tail -c1 "$exclude")" ] && echo >> "$exclude"
    echo "/$dir_rel/" >> "$exclude"
  fi
  branch=$(G branch --show-current 2>/dev/null); echo "branch: ${branch:-(detached)}"
  echo "HEAD: $(G log -1 --format='%h %s' 2>/dev/null || echo '(no commits)')"
  echo "uncommitted:"; G status --short 2>/dev/null | sed 's/^/  /'
  echo "stashes: $(G stash list 2>/dev/null | wc -l | tr -d ' ')"
  check='Check that `git status` and HEAD match its "Repo state" section (if not, tell the user before editing). Run the commands under "Verify" and each "check with" command under "Outside operations", and tell the user if a result differs from the recorded one, then start with Next step 1.'
else
  echo "git: not a repository"
  check='Check its "Repo state" section. Run the commands under "Verify" and each "check with" command under "Outside operations", and tell the user if a result differs from the recorded one, then start with Next step 1.'
fi
cat <<PROMPT
resume prompt:
Resume paused work in $project.
Read $path first. It is your only context from the previous session.
$check
Read only the files it points to unless you need more, and ask the user before doing anything outside its Goal.
If the user tells you something in this session that differs from the handoff, follow the user.
PROMPT
exit 0
