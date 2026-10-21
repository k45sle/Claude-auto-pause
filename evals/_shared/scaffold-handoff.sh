# Sourced by a case scaffold.sh that sets $here (case dir).
source "$here/../_shared/date-repo.sh"
mkdir -p .handoffs && sed "s#__WORKSPACE__#$PWD#g" "$here/handoff.md" > .handoffs/handoff.md
echo "/.handoffs/" >> .git/info/exclude
