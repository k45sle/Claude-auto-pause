import type { EngineInterface, Register, SessionRateLimit } from 'claude-code'

// Watches the 5-hour and 7-day usage windows, warns, then pauses the session at a
// safe point: a notice on a tool result, a short grace, then a gate on non-handoff
// tools, one Stop block, and validation of the handoff when Claude writes it.
// State is mirrored to $.store per session, so a plugin reload mid-pause keeps the gate.

type $ = EngineInterface
type Phase = 'normal' | 'warned' | 'pausing' | 'gated' | 'paused'
type Kind = 'five_hour' | 'seven_day'
type Outcome = 'verified' | 'fallback' | 'released' | 'reset'
type Calibration = { usedAtNotice: number; usedAtDone: number; outcome?: Outcome }

const LABEL: Record<Kind, string> = { five_hour: '5-hour', seven_day: '7-day' }
const REQUIRED = ['Goal', 'Status', 'Next steps', 'Repo state']
// Adapted from handoff-now's redaction list (Apache-2.0, see NOTICE) plus common provider prefixes.
const SECRETS = [
  /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/, // through the body, so redaction takes it all
  /sk-ant-[A-Za-z0-9_-]{20,}/,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /\bAIza[0-9A-Za-z_-]{35}\b/,
  /authorization\s*[:=]\s*(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]{12,}/i,
  /\b[a-z][a-z0-9+.-]{1,20}:\/\/[^\s:@/]+:[^\s@/]+@/i, // any scheme://user:pass@
  // NAME=value, NAME: value, "NAME": "value", env["NAME"] = value anywhere on a line (env, YAML, .mcp.json, code).
  // The keyword (or SECRET_KEY, TOKEN_VALUE, PASSWORD_HASH) must end the name, so TOKEN_PATH=... passes. A `:` value must be quoted or hold a digit, so prose like
  // "GITHUB_TOKEN: expired" passes. The name is read once and the lookahead checks it, which keeps it linear. `_PASS` does not match BYPASS.
  /(?<![\w$])(?=[A-Z0-9_]*?(?:TOKEN|SECRET|PASSWORD|PASSWD|_PASS|API_KEY|PRIVATE_KEY)(?:_KEY|_VALUE|_HASH)?['"]?\]?[ \t]*[=:])[A-Z0-9_]+['"]?\]?[ \t]*(?:=[ \t]*['"]?(?!process\.env|os\.environ)(?![^\s'"]{0,200}\()|:[ \t]*['"]|:[ \t]*(?=[^\s'"]{0,200}\d)(?=[^\s'"]{0,200}[A-Za-z])(?![^\s'"]{0,200}\())[^\s'"$<{*]{8,}/,
  /glpat-[A-Za-z0-9_-]{20,}/,
  /\b[rs]k_(?:live|test)_[A-Za-z0-9]{16,}/,
  /\beyJ[\w-]{10,}\.eyJ[\w-]{10,}\.[\w-]{10,}/,
  /_authToken\s*=\s*[^\s'"]{8,}/,
  // Any case, name ending in the word: notion_token: "...", notionSecret = '...', "x-api-key": "...", ?api_key=...
  // A value must be quoted, or (when the name has more than the bare word, or follows ? or & in a URL) hold a letter and
  // a digit and no call, so prose like "token: expired" and code like `token = getToken2()` pass.
  /(?<![\w$-])(?:[\w-]+?(?:token|secret|password|passwd|_pass|api[_-]?key|secret_access_key|private_key)['"]?\]?[ \t]*[:=][ \t]*(?:['"](?![<${*])[^\s'"]{8,}|(?=[^\s'"]{0,200}\d)(?=[^\s'"]{0,200}[A-Za-z])(?![^\s'"]{0,200}\()(?!process\.env|os\.environ)[^\s'"$<{]{8,})|(?:token|secret|password|passwd|api[_-]?key|secret_access_key|private_key)['"]?\]?[ \t]*[:=][ \t]*['"](?![<${*])[^\s'"]{8,}|(?<=[?&])(?:token|secret|password|api[_-]?key)=(?=[^\s&'"]{0,200}\d)[^\s&'"$<{]{8,})/i,
]
// Read-only git: what the handoff's Repo state needs (handoff-now's rule). An allowlist, not a
// denylist: plain characters only (no quotes, braces, globs, $, pipes, redirects or line breaks),
// so a flag cannot be spelled around the check. `--output`, `--ext-diff` and `--textconv` (and their
// prefixes) would write files or run programs; `branch` only lists.
const PLAIN = /^[\w ./:=@%+,~^-]+$/
const isSafeGit = (cmd: string) => {
  if (!PLAIN.test(cmd)) return false
  const [bin, sub, ...args] = cmd.split(/\s+/)
  if (bin !== 'git') return false
  if (sub === 'branch') return args.every(a => ['--show-current', '-a', '-r', '-v', '-vv', '--list'].includes(a))
  // --no-index and -O read files outside the repo.
  // An absolute, ~ or .. path can lie outside the repo, where git silently does a no-index diff and prints any file.
  return ['status', 'diff', 'log', 'show', 'rev-parse'].includes(sub ?? '') && !args.some(a => /^--(?:out|ext|text|no-index)|^-O|^[/~]|(?:^|\/)\.\.(?:\/|$)/.test(a))
}
// Claude chains these (`cd <root> && git status && git diff`); each part must pass on its own.
// `cd` only into the project: another folder's .git/config could make `git status` run a program.
const isSafeShell = (cmd: string, root?: string) => !/[\n\r]/.test(cmd) &&
  cmd.split(/\s*(?:&&|;)\s*/).every(p => {
    const cd = /^cd\s+(?:"([^"]*)"|'([^']*)'|(\S+))$/.exec(p)
    // Bash would expand $, backticks and \ inside "..." and end '...' at a quote, so a root with those is refused for that quoting.
    const quoted = !!root && (cd?.[1] !== undefined ? !/[$`"\\]/.test(root) : cd?.[2] !== undefined ? !root.includes("'") : PLAIN.test(root))
    return cd ? quoted && (cd[1] ?? cd[2] ?? cd[3])!.replace(/\/+$/, '') === root : isSafeGit(p)
  })
const MAX_RESCUES = 10 // reads and git while gated: enough for an accurate handoff, not a way to keep working
const READ_TOOLS = new Set(['Read', 'Glob', 'Grep', 'TodoWrite'])
const MAX_FIXES = 3
const FILE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit'])
const AGENT_TOOLS = new Set(['Agent', 'Task'])
// The mod appends this section after a handoff passes; validation ignores it.
const FACTS = '## Session facts (added by auto-pause, read from the session)'
const MAX_DIRTY = 15 // more uncommitted files than this is a bulk change; don't demand each by name

const redact = (s: string) => SECRETS.reduce((t, re) => t.replace(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'), '[redacted]'), s)
const flat = (s: string) => s.replace(/\s+/g, ' ').trim()
// Paths from `git status --porcelain` (always repo-relative), handoffs and renames' old names left out.
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// A path counts as named when it appears whole, or its file name does without a longer name around it (a.ts, not data.ts).
// When another changed file has the same name (index.ts, src/index.ts, test/index.ts) only the whole path counts, and
// not inside a longer one; `text` has the project root stripped so absolute mentions count too.
const mentions = (text: string, f: string, dirty: string[] = []) => {
  const name = f.split('/').pop()!
  if (!dirty.some(o => o !== f && o.split('/').pop() === name)) return text.includes(f) || new RegExp(`(?:^|[^\\w.-])${esc(name)}(?![\\w-])`, 'm').test(text)
  return new RegExp(`(?:^|[^\\w./-])(?:\\./)?${esc(f)}(?![\\w-])`, 'm').test(text)
}
// With core.quotePath=false git quotes only names holding a quote, backslash or control character, C-style.
const unquote = (p: string) => /^".*"$/.test(p) ? p.slice(1, -1).replace(/\\(["\\tnr]|[0-7]{3})/g, (_, c: string) => ({ t: '\t', n: '\n', r: '\r' } as Record<string, string>)[c] ?? (c.length === 3 ? String.fromCharCode(parseInt(c, 8)) : c)) : p
const dirtyPaths = (porcelain: string) =>
  // git() trims output, so the first line may have lost its leading status space.
  porcelain.split('\n').map(l => l.replace(/^[ MADRCUT?!]{1,2} /, '')).filter(Boolean).map(l => unquote(l.split(' -> ').pop()!).replace(/\/$/, ''))
    .filter(f => f !== cfg.dir && !(f.startsWith(`${cfg.dir}/`) && f.endsWith('.md'))) // only handoffs: the folder may be one the user keeps files in

let cfg = config({})

function config(o: Record<string, unknown>) {
  // A value that is missing, not a number, or out of range falls back to the default.
  const notes: string[] = []
  const num = (k: string, d: number, min = 0, max = 100) => {
    const raw = typeof o[k] === 'string' ? (o[k] as string).trim() : o[k]
    const unset = raw === undefined || raw === null || raw === ''
    const v = unset ? NaN : Number(raw)
    if (Number.isFinite(v) && v >= min && v <= max) return v
    if (!unset) notes.push(`${k} "${String(raw)}" is out of range; using ${d}.`)
    return d
  }
  const warn = { five_hour: num('warn_at_percent_left', 15), seven_day: num('weekly_warn_at_percent_left', 10) }
  const pause = { five_hour: num('pause_at_percent_left', 8), seven_day: num('weekly_pause_at_percent_left', 3) }
  for (const [k, w, p] of [['', warn.five_hour, pause.five_hour], ['weekly_', warn.seven_day, pause.seven_day]] as const)
    if (w <= p) notes.push(`${k}warn_at_percent_left ${w} is not above ${k}pause_at_percent_left ${p}, so there is no separate warning.`)
  return {
    warn, pause, notes,
    gateCalls: num('gate_after_tool_calls', 5, 0, 1000),
    gatePoints: num('gate_after_points', 3, 1),
    // Relative to the project root, plain characters only, not .git or .claude; anything else falls back (facts.sh applies the same rule).
    dir: ((d: string) => (d && d !== '.' && !d.startsWith('/') && !d.includes('..') && /^[A-Za-z0-9._/-]+$/.test(d) && !/^\.(?:git|claude)(?:\/|$)/i.test(d) ? d : '.handoffs'))(String(o.handoff_dir ?? '').trim().replace(/^\.\//, '').replace(/\/+$/, '').replace(/\/{2,}/g, '/')),
    words: num('handoff_word_budget', 600, 100, 10000),
  }
}

let phase: Phase = 'normal'
let simulated: number | undefined
let simulateAfter: { calls: number; left: number } | undefined // dev-only: simulated reading lands mid-task
let hasData = false
let saidNoData = false
const windows = new Map<Kind, { key: string; used: number; resetsAt?: string; fired: Set<'warn' | 'pause'> }>()
let pending: string | undefined
let owner: Kind | undefined // the window behind the current warn or pause
let pause: { kind: Kind; usedAtNotice: number; calls: number; root: string; path: string; prompt: string; notice: string; stopBlocked: boolean; head?: string; fixes?: number; rescues?: number; outside?: boolean; gitRisk?: boolean } | undefined
let storeKey: string | undefined // `session:<id>`, set at session.start

// Saved after every change so a /reload-plugins (Desktop reloads every open session) keeps a pause.
let savedJson = ''
async function save($: $) {
  if (!storeKey) return
  const w = [...windows].map(([k, v]) => [k, { ...v, fired: [...v.fired] }])
  const json = JSON.stringify({ phase, owner, pending, pause, hasData, windows: w })
  if (json === savedJson) return // most tool calls change nothing; keep store writes rare
  savedJson = json
  await $.store.set(storeKey, { ...JSON.parse(json), at: await $.clock.now() }).catch(() => {})
}

// A new session id (a /clear, or a fresh load) starts from nothing, then from what was saved for it.
function resetState() {
  phase = 'normal'; owner = undefined; pending = undefined; pause = undefined
  hasData = false; saidNoData = false; simulated = undefined; simulateAfter = undefined
  windows.clear(); savedJson = ''
}

async function restore($: $) {
  const s = (await $.store.get(storeKey!).catch(() => undefined)) as
    | { phase: Phase; owner?: Kind; pending?: string; pause?: typeof pause; hasData: boolean; windows: [Kind, { key: string; used: number; resetsAt?: string; fired: ('warn' | 'pause')[] }][] }
    | undefined
  if (!s) return
  ;({ phase, owner, pending, pause, hasData } = s)
  for (const [k, v] of s.windows) windows.set(k, { ...v, fired: new Set(v.fired) })
}

// Desktop hooks may run without PATH (agent-layer 0.2.0), so fall back to the system git.
// fsmonitor=false: a repo's core.fsmonitor would run a program on status.
async function git($: $, ...a: string[]) {
  for (const bin of ['git', '/usr/bin/git']) {
    const r = await $.process.run([bin, '-c', 'core.fsmonitor=false', ...a], { timeoutMs: 5000 }).catch(() => undefined)
    if (r) return r.exitCode === 0 ? r.stdout.trim() : ''
  }
  return ''
}

// stat without resolve sees a link even when it leads nowhere, which exists() would call absent.
const taken = async ($: $, p: string) => (await $.fs.stat(p).catch(() => undefined)) !== undefined
// Both paths resolved, every link followed: is p inside root?
async function inside($: $, p: string, root: string) {
  const r = (await $.fs.stat(root, { resolve: true }).catch(() => undefined))?.realPath
  const x = (await $.fs.stat(p, { resolve: true }).catch(() => undefined))?.realPath
  return r !== undefined && x !== undefined && x.startsWith(`${r}/`)
}

const isHandoffFile = (p: unknown) =>
  typeof p === 'string' && p.endsWith('.md') && !p.split('/').includes('..') &&
  (p.includes(`/${cfg.dir}/`) || p.startsWith(`${cfg.dir}/`))
// While pausing only the exact path the resume prompt names counts: another file there would
// leave the prompt pointing at a file that does not exist.
const isPauseFile = (p: unknown) => isHandoffFile(p) && (!pause || p === pause.path)
const isHandoffCall = (e: { tool: string; [k: string]: unknown }) =>
  e.tool === 'Skill'
    ? String(e.skill ?? '').endsWith('writing-handoffs')
    : (FILE_TOOLS.has(e.tool) || e.tool === 'Read') && isPauseFile(e.file_path)
// What the gate lets through besides the handoff: reads and read-only git, so the handoff can be accurate.
const isRescueCall = (e: { tool: string; [k: string]: unknown }) =>
  READ_TOOLS.has(String(e.tool)) || (e.tool === 'Bash' && isSafeShell(String(e.command ?? '').trim(), pause?.root))

async function onReading($: $, rateLimits: readonly SessionRateLimit[]) {
  const now = await $.clock.now()
  // A window whose reset time has passed is a stale reading, not current usage.
  let limits = rateLimits.filter((r): r is SessionRateLimit & { kind: Kind } =>
    (r.kind === 'five_hour' || r.kind === 'seven_day') && !(r.resetsAt && Date.parse(r.resetsAt) <= now))
  if (simulated !== undefined) {
    // No resetsAt: a stable window key, so real readings never look like a reset.
    limits = [...limits.filter(r => r.kind !== 'five_hour'), { kind: 'five_hour', percentUsed: 100 - simulated }]
  }
  if (!limits.length) {
    if (!hasData && !saidNoData) {
      saidNoData = true
      $.ui.toast('auto-pause inactive: no usage data (API key, Team plan, or no response yet)')
    }
    return
  }
  hasData = true
  for (const r of limits) {
    const key = `${r.kind}@${r.resetsAt ?? ''}`
    let w = windows.get(r.kind)
    if (!w || w.key !== key) {
      // A new window (first reading or a reset): thresholds fire again.
      if (w && owner === r.kind) {
        if (pause && (phase === 'pausing' || phase === 'gated')) await logOutcome($, 'reset')
        phase = 'normal'; owner = undefined; pause = undefined; pending = undefined
      }
      w = { key, used: r.percentUsed, resetsAt: r.resetsAt, fired: new Set() }
      windows.set(r.kind, w)
    }
    w.used = r.percentUsed
    const left = 100 - r.percentUsed
    // A threshold counts as fired only when it acted, so one held back by the
    // other window's pause still fires once that window resets.
    if (left <= cfg.pause[r.kind] && !w.fired.has('pause')) {
      if (phase === 'normal' || phase === 'warned') {
        w.fired.add('pause').add('warn')
        owner = r.kind
        await startPause($, r.kind, w.used, w.resetsAt)
      }
    } else if (left <= cfg.warn[r.kind] && !w.fired.has('warn')) {
      if (phase === 'normal') {
        w.fired.add('warn')
        owner = r.kind
        phase = 'warned'
        pending = `AUTO-PAUSE: warning. ${usage(r.kind, w.used, w.resetsAt)}\nPrefer finishing the current step over starting new work, and keep your task list current. A pause notice follows at ${cfg.pause[r.kind]}% left.`
      }
    }
  }
  if (phase === 'pausing' && pause && (windows.get(pause.kind)?.used ?? 0) >= pause.usedAtNotice + cfg.gatePoints) phase = 'gated'
}

function usage(kind: Kind, used: number, resetsAt?: string) {
  return `${LABEL[kind]} usage ${used}% used (${round(100 - used)}% left), ${resetsAt ? `resets ${stamp(new Date(resetsAt))}` : 'reset time unknown'}.`
}

// Same text as skills/writing-handoffs/scripts/facts.sh prints, so manual handoffs can be checked against it.
function resumePrompt(root: string, path: string, inGit: boolean) {
  const check = inGit
    ? 'Check that `git status` and HEAD match its "Repo state" section (if not, tell the user before editing). Run the commands under "Verify" and each "check with" command under "Outside operations", and tell the user if a result differs from the recorded one, then start with Next step 1.'
    : 'Check its "Repo state" section. Run the commands under "Verify" and each "check with" command under "Outside operations", and tell the user if a result differs from the recorded one, then start with Next step 1.'
  return `Resume paused work in ${root}.\nRead ${path} first. It is your only context from the previous session.\n${check}\nRead only the files it points to unless you need more, and ask the user before doing anything outside its Goal.\nIf the user tells you something in this session that differs from the handoff, follow the user.`
}

async function startPause($: $, kind: Kind, used: number, resetsAt?: string) {
  const top = await git($, 'rev-parse', '--show-toplevel')
  const root = top || (await $.session.cwd())
  const dir = `${root}/${cfg.dir}`
  // Two sessions pausing in the same minute must not pick the same name: add a short session id.
  const id = storeKey?.slice('session:'.length)
  const sid = id && id !== 'unknown' ? id.replace(/[^A-Za-z0-9]/g, '').slice(0, 6) : ''
  const base = `${dir}/${stamp(new Date(await $.clock.now()), 'T')}-auto-pause${sid ? `-${sid}` : ''}`
  let path = `${base}.md`
  for (let n = 2; await taken($, path); n++) path = `${base}-${n}.md`
  let repo = 'not a git repository'
  let head: string | undefined
  let gitRisk = false
  if (top) {
    const branch = (await git($, 'branch', '--show-current')) || '(detached)'
    head = (await git($, 'rev-parse', '--short', 'HEAD')) || undefined
    // Repo-local config that makes read-only git run a program. Claude Code and the user's own shell already run
    // git status in such a repo, so only the auto-approval is withheld.
    gitRisk = (await git($, 'config', '--local', '--list')).split('\n').some(l => {
      const [k = '', ...v] = l.split('=')
      return /^(?:diff\.external|diff\.[^.]+\.(?:command|textconv)|filter\.|gpg\.|log\.showsignature|include\.|includeif\.)/i.test(k) ||
        (/^core\.fsmonitor$/i.test(k) && !/^(?:true|false|yes|no|on|off|1|0|)$/i.test(v.join('=').trim()))
    })
    const files = (await git($, '-c', 'core.quotePath=false', 'status', '--porcelain')).split('\n').map(l => l.trim()).filter(Boolean)
    repo = `branch ${branch}${head ? ` · HEAD ${head} (copy it into "## Repo state")` : ''} · uncommitted: ${files.length ? files.slice(0, 12).join(', ') + (files.length > 12 ? `, +${files.length - 12} more` : '') : 'none'}`
    await excludeDir($, await git($, 'rev-parse', '--path-format=absolute', '--git-path', 'info/exclude'), root)
  }
  // A handoff folder that resolves outside the project (a symlink shipped in the repo) is never auto-approved.
  // Stat without resolving sees a link even when it leads nowhere; such a folder counts as outside too.
  const outside = (await taken($, dir)) && !(await inside($, dir, root))
  const prompt = resumePrompt(root, path, !!top)
  const notice = [
    `AUTO-PAUSE: pause threshold reached. ${usage(kind, used, resetsAt)} (This comes from the auto-pause plugin the user installed to save work before the usage limit.)`,
    `Do not start new work. Finish or revert the step in progress (at most ${cfg.gateCalls} more tool calls), then use the writing-handoffs skill and write exactly the handoff path below, in under ${cfg.words} words.`,
    `Handoff path: ${path}`,
    `Repo state: ${repo}`,
    'Resume prompt (put it verbatim at the top of the handoff, and end your turn with it in a code block):',
    prompt,
  ].join('\n')
  phase = 'pausing'
  pause = { kind, usedAtNotice: used, calls: 0, root, path, prompt, notice, stopBlocked: false, head, fixes: 0, rescues: 0, outside, gitRisk }
  pending = notice
}

// Keep handoffs out of commits without touching tracked files.
async function excludeDir($: $, exclude: string, root: string) {
  // Old git echoes the unknown --path-format flag back: accept only one clean line.
  if (!exclude || exclude.includes('\n') || exclude.startsWith('-')) return
  // Excluding a folder that holds tracked files would hide the user's new files there from git status.
  if (await git($, 'ls-files', '--', `:(top)${cfg.dir}`)) return // :(top): the session may sit in a subfolder
  const file = exclude.startsWith('/') ? exclude : `${root}/${exclude}`
  const line = `/${cfg.dir}/`
  // Never rewrite a file that exists but could not be read: that would drop the user's excludes.
  const text = (await $.fs.exists(file).catch(() => false)) ? await $.fs.read(file).catch(() => undefined) : ''
  if (text === undefined || text.split('\n').includes(line)) return
  await $.fs.write(file, `${text}${text && !text.endsWith('\n') ? '\n' : ''}${line}\n`).catch(() => {})
}

// `want` is the resume prompt this file must carry: the notice's while pausing, else the one built for its own path
// (a prompt copied from an older handoff, or typed from memory, points the next session at the wrong file or skips the HEAD check).
function validate(full: string, want: string, headNow = '', dirty: string[] = [], p?: typeof pause, root = '') {
  const problems: string[] = []
  const text = full.split(FACTS)[0]!
  const top = text.split('\n').slice(0, 25).join('\n')
  if (!flat(top).includes(flat(want)))
    problems.push(p ? 'Put the resume prompt from the AUTO-PAUSE notice verbatim in a ```text block at the top.' : `Put this resume prompt verbatim in a \`\`\`text block at the top:\n${want}`)
  for (const h of REQUIRED) if (!new RegExp(`^##\\s+${h}\\b`, 'mi').test(text)) problems.push(`Add the "## ${h}" section.`)
  // An empty heading reads as "nothing here" or "forgot"; the next session can't tell which.
  for (const m of text.matchAll(/^##[ \t]+([^\n]+)(?:\n|$)(?=\s*(?:^##\s|(?![\s\S])))/gm)) {
    const h = m[1]!.trim()
    problems.push(REQUIRED.some(r => h.startsWith(r)) ? `Fill the empty "## ${h}" section.` : `Fill or remove the empty "## ${h}" section.`)
  }
  const next = /^##\s+Next steps\b[^\n]*\n([\s\S]*?)(?=^##\s|(?![\s\S]))/im.exec(text)
  if (next && !/^\s*(\d+\.|[-*])\s+\S/m.test(next[1] ?? '')) problems.push('"Next steps" needs at least one item.')
  const words = text.split(/\s+/).filter(Boolean).length
  if (words > cfg.words * 1.2) problems.push(`Cut it to about ${cfg.words} words (now ${words}).`)
  for (const block of text.matchAll(/^```[^\n]*\n([\s\S]*?)^```/gm))
    if ((block[1] ?? '').split('\n').length - 1 > 15) { problems.push('Replace code blocks over 15 lines with path:line pointers.'); break }
  const repo = /^##\s+Repo state\b[^\n]*\n([\s\S]*?)(?=^##\s|(?![\s\S]))/im.exec(text)
  // Either the commit at the pause or the current one (Claude may have committed during the grace calls).
  const heads = [p?.head, headNow].filter((h): h is string => !!h)
  if (heads.length && repo && !heads.some(h => (repo[1] ?? '').includes(h))) problems.push(`"## Repo state" must name HEAD ${headNow || heads[0]}, the commit this handoff was written at.`)
  // A file left out here is work the next session never hears about (often one edited during the grace calls).
  const missing = dirty.length <= MAX_DIRTY ? dirty.filter(f => !mentions(root ? text.split(`${root}/`).join('') : text, f, dirty)) : []
  if (missing.length) problems.push(`Name these uncommitted files and their state in "## Status" or "## Repo state": ${missing.join(', ')}.`)
  if (SECRETS.some(re => re.test(text))) problems.push('Remove the secret-looking string (key, token, password, or private key).')
  return problems
}

async function logOutcome($: $, outcome: Outcome) {
  if (!pause || simulated !== undefined) return // simulated readings would skew the calibration
  const entry: Calibration = {
    usedAtNotice: pause.usedAtNotice, usedAtDone: windows.get(pause.kind)?.used ?? pause.usedAtNotice, outcome,
  }
  const log = ((await $.store.get('calibration')) as Calibration[] | undefined) ?? []
  await $.store.set('calibration', [...log, entry].slice(-100))
}

async function finishPause($: $, outcome: Outcome = 'verified') {
  if (!pause) return
  phase = 'paused'
  pending = undefined
  // No file (a release before any handoff, a fallback that could not write) must not leave a prompt pointing at it.
  if (!(await $.fs.exists(pause.path).catch(() => false))) return logOutcome($, outcome)
  await $.store.set(`last:${pause.root}`, { path: pause.path, prompt: pause.prompt, at: new Date(await $.clock.now()).toISOString(), outcome })
  await logOutcome($, outcome)
}

// What the session itself shows, with no model call: the user's own last requests (so the next
// session works from their words, not a paraphrase) and the files edited. Harness text that arrives
// as a user message (system reminders, command tags, hook feedback) is skipped.
async function sessionFacts($: $, root: string) {
  const msgs = await $.session.messages().catch(() => [])
  // Redact before flattening: some secret patterns match only at the start of a line.
  // Pasted text is the user's own words: keep it, and drop only its wrapper tags (their ids are meant to stay hidden)
  // after the leading harness blocks (known tags only: a user's own <task> block stays).
  const asks = msgs.filter(m => m.role === 'user').map(m => m.text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/^\s*(?:<(ide_[\w-]+|command-name|command-message|command-args|command-contents|local-command-stdout|local-command-stderr|local-command-caveat|bash-input|bash-stdout|bash-stderr|user-prompt-submit-hook|task-notification)[^>]*>[\s\S]*?<\/\1>\s*)+/, '').replace(/<\/?pasted_content\b[^>]*>/g, '').trim())
    .filter(t => t && !/^(?:[\w ]{0,30}:\s*)?AUTO-PAUSE[: ]/.test(t)).slice(-3).map(t => flat(redact(t)).slice(0, 400))
  const edited = [...new Set(msgs.flatMap(m => m.toolUses ?? []).filter(u => FILE_TOOLS.has(u.tool)).map(u => String(u.input.file_path)))]
    .filter(f => !f.includes(`/${cfg.dir}/`)).map(f => (f.startsWith(`${root}/`) ? f.slice(root.length + 1) : f))
  return { asks, edited }
}

async function appendFacts($: $, file: string, text: string, root: string) {
  const { asks, edited } = await sessionFacts($, root)
  if (!asks.length && !edited.length) return
  const lines = [FACTS]
  if (asks.length) lines.push(`Last user request${asks.length > 1 ? 's, oldest first' : ''} (verbatim, trimmed):`, ...asks.map(a => `- "${a}"`))
  if (edited.length) lines.push(`Files edited in the old session: ${edited.slice(0, 30).join(', ')}${edited.length > 30 ? `, +${edited.length - 30} more` : ''}`)
  await $.fs.write(file, `${text.split(FACTS)[0]!.trimEnd()}\n\n${lines.join('\n')}\n`).catch(() => {})
}

// A facts-only handoff the mod writes itself when Claude could not write a checked one
// (MohammadMD1383's StopFailure snapshot). No model turn, so it works at the limit too.
async function writeFallback($: $, why: string) {
  if (!pause) return
  if (pause.outside) {
    // Never write through a folder that leads outside the project; end the pause so the session can stop.
    await finishPause($, 'fallback')
    await $.ui.notify(`The handoff folder ${cfg.dir} leads outside the project, so no facts-only handoff was written.`, { title: 'auto-pause' }).catch(() => undefined)
    return
  }
  const { asks, edited } = await sessionFacts($, pause.root)
  const ask = asks.at(-1)
  const here = await $.fs.stat(pause.path).catch(() => undefined)
  const partial = here?.kind === 'file' && !here.isLink
  if (here) {
    // Anything at the path (file, link, other) stays untouched; the facts go beside it.
    const orig = pause.path
    let facts = orig.replace(/\.md$/, '-facts.md')
    for (let n = 2; await taken($, facts); n++) facts = orig.replace(/\.md$/, `-facts-${n}.md`)
    pause.prompt = pause.prompt.replace(orig, facts)
    pause.path = facts
  }
  const branch = await git($, 'branch', '--show-current')
  const status = (await git($, '-c', 'core.quotePath=false', 'status', '--porcelain')).split('\n').filter(Boolean)
  const text = [
    '# Handoff: facts only (written by auto-pause)',
    '',
    `${why} This file holds only what the plugin could read without a model call.${partial ? ' A partial handoff from Claude sits beside it, without "-facts".' : ''}`,
    '',
    '```text', pause.prompt, '```',
    '',
    '## Goal', ask ? `Last user request (verbatim, first 400 characters): ${ask}` : 'Unknown: read the old session.',
    '',
    '## Status', edited.length ? `Files edited in the old session: ${edited.slice(0, 30).join(', ')}` : 'Unknown.',
    '',
    '## Next steps', '1. Run `git status` and `git diff` to see the unfinished change, then confirm the plan with the user before editing.',
    '',
    '## Repo state', pause.head ? `${branch || '(detached)'} · HEAD ${(await git($, 'rev-parse', '--short', 'HEAD')) || pause.head}` : 'not a git repository', ...status.slice(0, 40).map(l => `- ${l}`),
    '',
  ].join('\n')
  const wrote = await $.fs.write(pause.path, text).then(() => true, () => false)
  await finishPause($, 'fallback')
  // Toasts do not render in Desktop (Phase 0); a native notification does.
  await $.ui.notify(wrote ? `Facts-only handoff written: ${pause.path}. /auto-pause-status shows the resume prompt.` : `Could not write the facts-only handoff to ${pause.path}. The tools are unblocked.`, { title: 'auto-pause' }).catch(() => undefined)
}

export const register: Register = (on, options) => {
  cfg = config(options as Record<string, unknown>)

  on('session.start', async ($, e, next) => {
    const id = `session:${await $.session.id().catch(() => 'unknown')}`
    if (id !== storeKey) resetState()
    storeKey = id
    await restore($)
    // Drop state of sessions untouched for 8 days so the store stays small.
    const now = await $.clock.now()
    for (const k of await $.store.keys().catch(() => [] as string[])) {
      if (!k.startsWith('session:') || k === storeKey) continue
      const at = ((await $.store.get(k).catch(() => undefined)) as { at?: number } | undefined)?.at
      if (!at || now - at > 8 * 24 * 3600e3) await $.store.delete(k).catch(() => {})
    }
    // Dev-only. The EVAL_ copies exist because claude plugin eval passes only EVAL_* vars to a case.
    const sim = (await $.env.get('AUTO_PAUSE_SIMULATE_PERCENT_LEFT')) || (await $.env.get('EVAL_AUTO_PAUSE_SIMULATE_PERCENT_LEFT'))
    if (sim !== undefined && sim !== '' && !Number.isNaN(Number(sim))) {
      const after = Number((await $.env.get('AUTO_PAUSE_SIMULATE_AFTER_CALLS')) || (await $.env.get('EVAL_AUTO_PAUSE_SIMULATE_AFTER_CALLS')))
      if (after > 0) simulateAfter = { calls: after, left: Number(sim) }
      else { simulated = Number(sim); await onReading($, []) }
    }
    await $.command.register({ name: 'auto-pause-status', description: 'Show auto-pause state, the latest resume prompt for this folder, and calibration. "release" opens the gate.', argumentHint: '[release]' }).catch(() => {})
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    await onReading($, e.rateLimits).catch(() => {})
    await save($)
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (simulateAfter && --simulateAfter.calls < 0) {
      simulated = simulateAfter.left
      simulateAfter = undefined
      await onReading($, [])
    }
    const active = phase === 'pausing' || phase === 'gated'
    const refuse = async (deny: string) => {
      await save($)
      return { deny }
    }
    if (e.agentId !== undefined) {
      // A subagent may still hand its work back; everything else stops at this boundary.
      return active && !/^(SubagentHandback|TaskStop)$/.test(String(e.tool))
        ? refuse('AUTO-PAUSE: the session is pausing for the usage limit. Stop and return to the parent now with: what you finished, what is in progress (file:line), and what is left.')
        : next(e)
    }
    const handoff = isHandoffCall(e as never)
    if (active && AGENT_TOOLS.has(e.tool)) return refuse('AUTO-PAUSE: no new subagents while pausing. Write the handoff instead.')
    if (active && !handoff) {
      if (phase === 'pausing' && pause!.calls >= cfg.gateCalls) phase = 'gated'
      if (phase === 'gated' && (!isRescueCall(e as never) || (pause!.rescues = (pause!.rescues ?? 0) + 1) > MAX_RESCUES)) {
        // The notice already names the plugin, the skill and the path.
        return refuse(`AUTO-PAUSE gate: only the handoff is allowed now, plus a few reads (Read, Grep, Glob, read-only git without pipes or quotes; use Read, not cat).\n${pause!.notice}`)
      }
      pause!.calls++
    }
    const r = await next(e)
    if (r.deny !== undefined) return r
    const context: string[] = []
    // facts.sh can read only git and the clock, so a manual handoff gets usage and the budget from here.
    if (e.tool === 'Bash' && String((e as { command?: unknown }).command ?? '').includes('writing-handoffs/scripts/facts.sh')) {
      const now = await $.clock.now()
      const live = [...windows].filter(([, w]) => !w.resetsAt || Date.parse(w.resetsAt) > now).map(([k, w]) => usage(k, w.used, w.resetsAt))
      context.push(`auto-pause: ${live.join(' ') || 'usage unknown (no current reading).'} Word budget: ${cfg.words}.`)
    }
    const file = (e as { file_path?: unknown }).file_path
    if (FILE_TOOLS.has(e.tool) && !r.isError && active && isHandoffFile(file) && file !== pause!.path) {
      context.push(`AUTO-PAUSE: the resume prompt names ${pause!.path}. Write the handoff to exactly that path.`)
    } else if (FILE_TOOLS.has(e.tool) && !r.isError && isHandoffFile(file)) {
      const text = await $.fs.read(String(file)).catch(() => undefined)
      // The notice's prompt, message and HEAD belong to a pause in progress only; a later handoff gets its own.
      const p = active ? pause : undefined
      const root = p?.root ?? (await git($, 'rev-parse', '--show-toplevel'))
      const abs = String(file).startsWith('/') ? String(file) : `${await $.session.cwd()}/${file}`
      const want = p?.prompt ?? resumePrompt(root || (await $.session.cwd()), abs, !!root)
      const problems = text === undefined ? [] : validate(text, want, (p ? p.head : root) ? await git($, 'rev-parse', '--short', 'HEAD') : '', root ? dirtyPaths(await git($, '-c', 'core.quotePath=false', 'status', '--porcelain')) : [], p, root)
      if (text !== undefined && !(await inside($, abs, root || (await $.session.cwd())))) {
        context.push(`AUTO-PAUSE: ${file} leads outside the project, so it was not checked or extended. Write handoffs to a regular file in ${root || (await $.session.cwd())}/${cfg.dir}.`)
      } else if (text !== undefined && !problems.length) {
        await appendFacts($, String(file), text, root || (await $.session.cwd()))
        if (active) await finishPause($)
        context.push(`AUTO-PAUSE: handoff OK. End your turn now with the handoff path${active ? `, when usage resets` : ''}, and the resume prompt verbatim in a \`\`\`text block.`)
      } else if (problems.length && active && (pause!.fixes = (pause!.fixes ?? 0) + 1) >= MAX_FIXES) {
        // Never lock a session on validation: after three tries the gate opens, logged as released.
        await finishPause($, 'released')
        context.push(`AUTO-PAUSE: the handoff still has problems (${problems.join(' ')}) The gate is open anyway. End your turn now with the handoff path and the resume prompt in a \`\`\`text block.`)
      } else if (problems.length) {
        context.push(`AUTO-PAUSE: the handoff needs fixes. Make them all in one Edit:\n${problems.map(p => `- ${p}`).join('\n')}`)
      }
    }
    if (pending) { context.unshift(pending); pending = undefined }
    await save($)
    return context.length ? { ...r, context: [...(r.context ?? []), ...context] } : r
  }).catch(($, e, next) => next(e)) // fail open: a mod bug must never brick a session

  // Let the handoff and read-only git go through without a permission prompt while the user is away.
  // The real tool name goes last, so an input field called `tool` cannot pass for the handoff.
  on('tool.check', ($, e, next) => {
    const x: { tool: string; [k: string]: unknown } = { ...(e.input as Record<string, unknown>), tool: e.tool }
    return (phase === 'pausing' || phase === 'gated') && e.agentId === undefined && !pause?.outside &&
      (isHandoffCall(x) || (x.tool === 'Bash' && !pause?.gitRisk && isSafeShell(String(x.command ?? '').trim(), pause?.root)))
      ? { decision: 'allow', reason: 'auto-pause: handoff or read-only git while pausing' }
      : next(e)
  }).catch(($, e, next) => next(e))

  // If Claude ends the turn before the handoff, send it back once.
  // A second end without a valid handoff gets the facts-only one, so the turn can always end.
  on('classic.Stop', async ($, e, next) => {
    if ((phase !== 'pausing' && phase !== 'gated') || !pause) return next(e)
    if (pause.stopBlocked) {
      await writeFallback($, 'Claude ended its turn twice without a valid handoff.').catch(() => {})
      await save($)
      return next(e)
    }
    pause.stopBlocked = true
    pending = undefined
    await save($)
    return { block: `${pause.notice}\nWrite the handoff now; this turn cannot end before it is written.` }
  }).catch(($, e, next) => next(e))

  // The limit hit before a handoff was checked: start one if none was, and write the facts.
  on('classic.StopFailure', async ($, e, next) => {
    // Only a plan limit we have seen coming: a 429 at low usage or with no data is not one.
    const kind = owner ?? 'five_hour'
    const w = windows.get(kind)
    if (e.error === 'rate_limit' && phase !== 'paused' && hasData && w && 100 - w.used <= cfg.warn[kind]) {
      owner = kind
      if (!pause) await startPause($, kind, w.used, w.resetsAt).catch(() => {})
      await writeFallback($, 'The usage limit was hit before the handoff was written.').catch(() => {})
      await save($)
    }
    return next(e)
  })

  on('command.run', { command: 'auto-pause-status' }, async ($, e) => {
    if (e.args.trim() === 'release') {
      if (phase !== 'pausing' && phase !== 'gated') return { text: 'Nothing to release.' }
      await finishPause($, 'released')
      await save($)
      return { text: 'Gate released by you (logged as an override). Claude can use every tool again this window.' }
    }
    const cwd = await $.session.cwd()
    const root = pause?.root ?? ((await git($, 'rev-parse', '--show-toplevel')) || cwd)
    const last = (phase === 'pausing' || phase === 'gated') && pause
    ? { ...pause, at: 'pausing now, not written yet' }
    : ((await $.store.get(`last:${root}`)) as { path: string; prompt: string; at: string } | undefined)
    const log = ((await $.store.get('calibration')) as Calibration[] | undefined) ?? []
    const lines = [`State: ${phase}${simulated !== undefined ? ` (simulated ${simulated}% left)` : ''}`]
    for (const [kind, w] of windows) lines.push(`${usage(kind, w.used, w.resetsAt)}`)
    if (!hasData) lines.push("No usage data yet. It arrives with Claude's first reply on a Pro or Max plan; API keys and Team or Enterprise seats never send it, so the plugin stays idle.")
    lines.push(`Thresholds: warn at ${cfg.warn.five_hour}% left, pause at ${cfg.pause.five_hour}% left (weekly ${cfg.warn.seven_day}/${cfg.pause.seven_day}).`)
    lines.push(`Gate after ${cfg.gateCalls} tool calls or ${cfg.gatePoints} points. Handoff folder ${cfg.dir}. Word budget ${cfg.words}.`, ...cfg.notes)
    if (last) lines.push('', `Latest handoff for ${root} (${last.at}): ${last.path}`, 'Resume prompt:', '```text', last.prompt, '```')
    else if (phase === 'normal') lines.push('', 'Nothing to do yet. When usage reaches the pause point, Claude writes a handoff and this shows its resume prompt.')
    if (log.length) {
      // Only checked handoffs measure what a handoff costs; the rest are counted as outcomes.
      const costs = log.filter(c => (c.outcome ?? 'verified') === 'verified').map(c => c.usedAtDone - c.usedAtNotice).sort((a, b) => a - b)
      const p95 = costs[Math.min(costs.length - 1, Math.ceil(costs.length * 0.95) - 1)]
      const count = (o: Outcome) => log.filter(c => (c.outcome ?? 'verified') === o).length
      lines.push('', `Calibration: ${log.length} pause(s): ${count('verified')} verified, ${count('fallback')} facts-only, ${count('released')} released, ${count('reset')} reset before a handoff.`)
      if (p95 !== undefined) lines.push(`Handoff cost p95 ${round(p95)} points. Suggested pause_at_percent_left: ${round(p95 + 2)}.`)
    }
    return { text: lines.join('\n') }
  }).catch(() => ({ text: 'Status failed; see claude --debug.' }))
}

function round(n: number) {
  return Math.round(n * 10) / 10
}

function stamp(d: Date, sep = ' ') {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}${sep}${p(d.getHours())}${sep === 'T' ? '' : ':'}${p(d.getMinutes())}`
}
