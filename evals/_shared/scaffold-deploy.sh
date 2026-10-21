# Sourced by a case scaffold.sh that sets $here (case dir) and optionally $src (dir holding handoff.md and deploy.sh).
src="${src:-$here}"
source "$here/../_shared/date-repo.sh"
install -m 755 "$src/deploy.sh" deploy.sh && git add deploy.sh && git commit -qm "Add deploy script"
mkdir -p .handoffs && sed "s#__WORKSPACE__#$PWD#g" "$src/handoff.md" > .handoffs/handoff.md
echo "/.handoffs/" >> .git/info/exclude
