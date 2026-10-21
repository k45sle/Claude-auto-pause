#!/usr/bin/env bash
here="$(cd "$(dirname "$0")" && pwd)"
source "$here/../_shared/date-repo.sh"
install -m 755 "$here/deploy.sh" deploy.sh && git add deploy.sh && git commit -qm "Add deploy script"
mkdir -p .handoffs && sed "s#__WORKSPACE__#$PWD#g" "$here/handoff.md" > .handoffs/handoff.md
echo "/.handoffs/" >> .git/info/exclude
