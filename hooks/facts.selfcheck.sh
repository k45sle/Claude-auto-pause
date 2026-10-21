#!/usr/bin/env bash
# Self-check for facts.sh (the plugin test runner cannot spawn processes). Exits non-zero on failure.
set -u
S="$(cd "$(dirname "$0")/../skills/writing-handoffs/scripts" && pwd)/facts.sh"
fail=0
ok() { [ "$1" = 1 ] || { echo "FAIL: $2"; fail=1; }; }
has() { case "$1" in *"$2"*) echo 1 ;; *) echo 0 ;; esac; }
mk() { d=$(mktemp -d "${TMPDIR:-/tmp}/facts.XXXXXX") && d=$(cd "$d" && pwd -P)
  if [ "${1:-git}" = git ]; then (cd "$d" && git init -q && mkdir src && echo x > src/a.ts && git add . &&
    git -c user.name=t -c user.email=t@t commit -qm init); fi; echo "$d"; }
pathof() { printf '%s\n' "$1" | sed -n 's/^handoff path: //p'; }
excl() { cat "$1/.git/info/exclude"; }

d=$(mk); mkdir "$d/.handoffs"
# Plant at this and the next minute so a minute boundary cannot dodge the link.
for t in "$(date +%Y-%m-%dT%H%M)" "$(date -v+1M +%Y-%m-%dT%H%M 2>/dev/null || date -d '+1 min' +%Y-%m-%dT%H%M)"; do
  ln -s "$d/nowhere" "$d/.handoffs/$t-job.md"; done
out=$(cd "$d" && bash "$S" job .handoffs); ok "$(has "$(pathof "$out")" -job-2.md)" "dangling symlink skipped"

d=$(mk); (cd "$d" && bash "$S" job a//b >/dev/null)
ok "$(has "$(excl "$d")" /a/b/)" "a//b gives /a/b/"; ok "$([ "$(has "$(excl "$d")" /a//b/)" = 0 ] && echo 1)" "no /a//b/ line"

for bad in .git/hooks .claude/x .git .Git/hooks .CLAUDE/x .//x ../up /abs; do
  d=$(mk); out=$(cd "$d" && bash "$S" job "$bad"); ok "$(has "$(pathof "$out")" "$d/.handoffs/")" "$bad falls back"; done
d=$(mk); out=$(cd "$d" && bash "$S" job .github/h); ok "$(has "$(pathof "$out")" "$d/.github/h/")" ".github/h kept"

d=$(mk); (cd "$d" && bash "$S" job src >/dev/null); ok "$([ "$(has "$(excl "$d")" /src/)" = 0 ] && echo 1)" "tracked src not excluded"

d=$(mk); mkdir "$d/web"; echo x > "$d/web/a"; (cd "$d" && git add web && git -c user.name=t -c user.email=t@t commit -qm w); echo x > "$d/web/résumé.md"; out=$(cd "$d/web" && bash "$S" job .handoffs)
ok "$(has "$out" '  ?? web/résumé.md')" "repo-root unescaped path"; ok "$([ "$(has "$out" ../)" = 0 ] && echo 1)" "no ../ paths"

d=$(mk none); out=$(cd "$d" && bash "$S" job .handoffs)
ok "$(has "$(pathof "$out")" "$d/.handoffs/")" "non-git path"; ok "$(has "$out" 'git: not a repository')" "non-git line"
chk=$(grep -F 'Check that `git status` and HEAD match' "$S" | sed -n "s/^ *check='\(.*\)'\$/\1/p")
for f in "$(dirname "$0")/register.ts" "$(dirname "$0")/../skills/writing-handoffs/references/fallback.md"; do
  ok "$([ -n "$chk" ] && grep -qF -- "$chk" "$f" && echo 1)" "resume check sentence matches $(basename "$f")"; done
[ "$fail" = 0 ] && echo "facts.selfcheck: all passed"; exit "$fail"
