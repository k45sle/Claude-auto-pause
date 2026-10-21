#!/usr/bin/env bash
# One isolated run of a case with Bash allowed, outside `claude plugin eval`
# (its Bash grant refuses to run on a Mac whose Docker credential store has a symlink).
# usage: run-with-bash.sh <case> <with|without> <new-out-dir>; trace goes to <out-dir>/trace.jsonl
set -uo pipefail
case_dir="$(cd "$(dirname "$0")/.." && pwd)/$1"
[ -e "$3" ] && { echo "out-dir $3 already exists; use a new one" >&2; exit 1; }
mkdir -p "$3/ws" && out="$(cd "$3" && pwd)" && cd "$out/ws" && bash "$case_dir/scaffold.sh" >/dev/null || exit 1
prompt=$(awk 'f>=2{print} /^---$/{f++}' "$case_dir/prompt.md" | sed '1{/^$/d;}')
plugin=(); [ "$2" = with ] && plugin=(--plugin-dir "$(cd "$case_dir/../.." && pwd)")
# Local settings only, no CLAUDE.md, memory or MCP servers, so the user's own setup stays out.
CLAUDE_CODE_DISABLE_CLAUDE_MDS=1 CLAUDE_CODE_DISABLE_AUTO_MEMORY=1 claude -p --setting-sources local --strict-mcp-config \
  ${plugin[@]+"${plugin[@]}"} --allowedTools Read Glob Grep Bash --permission-mode dontAsk --max-turns 20 \
  --no-session-persistence --output-format stream-json --verbose "$prompt" > "$out/trace.jsonl" 2> "$out/stderr.log"
