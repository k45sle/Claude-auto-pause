#!/usr/bin/env bash
# Prints the facts a handoff needs: handoff path, repo state, resume prompt.
# Usage: facts.sh [task-slug]. Creates the handoff folder and keeps it out of git. Always exits 0.
set -u
slug=$(printf '%s' "${1:-task}" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-' | sed 's/^-*//; s/-*$//' | cut -c1-40)
[ -n "$slug" ] || slug=task
# shortcut: folder is fixed; read the plugin's handoff_dir option once Phase 2 adds userConfig.
dir_rel=.handoffs

project=$(git rev-parse --show-toplevel 2>/dev/null) && in_git=1 || { project=$PWD; in_git=0; }
dir="$project/$dir_rel"
mkdir -p "$dir" 2>/dev/null
stamp=$(date +%Y-%m-%dT%H%M)
path="$dir/$stamp-$slug.md"
n=2; while [ -e "$path" ]; do path="$dir/$stamp-$slug-$n.md"; n=$((n + 1)); done

echo "project: $project"
echo "handoff path: $path"
echo "now: $(date '+%Y-%m-%d %H:%M %Z')"
if [ "$in_git" = 1 ]; then
  exclude=$(git rev-parse --git-path info/exclude 2>/dev/null)
  if [ -n "$exclude" ] && ! grep -qxF "/$dir_rel/" "$exclude" 2>/dev/null; then
    mkdir -p "$(dirname "$exclude")"
    # Start on a fresh line if the file lacks a trailing newline.
    [ -s "$exclude" ] && [ -n "$(tail -c1 "$exclude")" ] && echo >> "$exclude"
    echo "/$dir_rel/" >> "$exclude"
  fi
  branch=$(git branch --show-current 2>/dev/null); echo "branch: ${branch:-(detached)}"
  echo "HEAD: $(git log -1 --format='%h %s' 2>/dev/null || echo '(no commits)')"
  echo "uncommitted:"; git status --short 2>/dev/null | sed 's/^/  /'
  echo "stashes: $(git stash list 2>/dev/null | wc -l | tr -d ' ')"
  check='Check that `git status` matches its "Repo state" section, then start with Next step 1.'
else
  echo "git: not a repository"
  check='Check its "Repo state" section, then start with Next step 1.'
fi
cat <<PROMPT
resume prompt:
Resume paused work in $project.
Read $path first. It is your only context from the previous session.
$check
Read only the files it points to unless you need more.
PROMPT
exit 0
