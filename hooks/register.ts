import type { EngineInterface, Register, SessionRateLimit } from 'claude-code'

// Watches the 5-hour and 7-day usage windows, warns, then pauses the session at a
// safe point: a notice on a tool result, a short grace, then a gate on non-handoff
// tools, one Stop block, and validation of the handoff when Claude writes it.
// State is per module, so per session (a dev reload starts over).

type $ = EngineInterface
type Phase = 'normal' | 'warned' | 'pausing' | 'gated' | 'paused'
type Kind = 'five_hour' | 'seven_day'
type Calibration = { at: string; kind: Kind; usedAtNotice: number; usedAtDone: number; toolCalls: number; contextTokens?: number; model?: string }

const LABEL: Record<Kind, string> = { five_hour: '5-hour', seven_day: '7-day' }
const REQUIRED = ['Goal', 'Status', 'Next steps', 'Repo state']
const SECRET = /sk-ant-|ghp_[A-Za-z0-9]|AKIA[0-9A-Z]{8}|-----BEGIN/
const FILE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit'])
const AGENT_TOOLS = new Set(['Agent', 'Task'])

let cfg = config({})

function config(o: Record<string, unknown>) {
  const num = (k: string, d: number) => (o[k] !== undefined && o[k] !== '' && Number.isFinite(Number(o[k])) ? Number(o[k]) : d)
  return {
    warn: { five_hour: num('warn_at_percent_left', 15), seven_day: num('weekly_warn_at_percent_left', 10) },
    pause: { five_hour: num('pause_at_percent_left', 6), seven_day: num('weekly_pause_at_percent_left', 3) },
    gateCalls: num('gate_after_tool_calls', 5),
    gatePoints: num('gate_after_points', 3),
    dir: String(o.handoff_dir || '.handoffs').replace(/^\.\//, '').replace(/\/+$/, ''),
    words: num('handoff_word_budget', 600),
  }
}

let phase: Phase = 'normal'
let simulated: number | undefined
let simulateAfter: { calls: number; left: number } | undefined // dev-only: simulated reading lands mid-task
let hasData = false
let saidNoData = false
let contextTokens: number | undefined
const windows = new Map<Kind, { key: string; used: number; resetsAt?: string; fired: Set<'warn' | 'pause'> }>()
let pending: string | undefined
let owner: Kind | undefined // the window behind the current warn or pause
let pause: { kind: Kind; usedAtNotice: number; calls: number; root: string; path: string; prompt: string; notice: string; stopBlocked: boolean } | undefined

const isHandoffFile = (p: unknown) =>
  typeof p === 'string' && p.endsWith('.md') && !p.split('/').includes('..') &&
  (p.includes(`/${cfg.dir}/`) || p.startsWith(`${cfg.dir}/`))
const isHandoffCall = (e: { tool: string; [k: string]: unknown }) =>
  e.tool === 'Skill'
    ? String(e.skill ?? '').endsWith('writing-handoffs')
    : (FILE_TOOLS.has(e.tool) || e.tool === 'Read') && isHandoffFile(e.file_path)

async function onReading($: $, rateLimits: readonly SessionRateLimit[]) {
  let limits = rateLimits.filter((r): r is SessionRateLimit & { kind: Kind } => r.kind === 'five_hour' || r.kind === 'seven_day')
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
      if (w && owner === r.kind) { phase = 'normal'; owner = undefined; pause = undefined; pending = undefined }
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

async function startPause($: $, kind: Kind, used: number, resetsAt?: string) {
  const git = (...a: string[]) => $.process.run(['git', ...a], { timeoutMs: 5000 }).then(r => (r.exitCode === 0 ? r.stdout.trim() : ''), () => '')
  const top = await git('rev-parse', '--show-toplevel')
  const root = top || (await $.session.cwd())
  const dir = `${root}/${cfg.dir}`
  const base = `${dir}/${stamp(new Date(await $.clock.now()), 'T')}-auto-pause`
  let path = `${base}.md`
  for (let n = 2; await $.fs.exists(path).catch(() => false); n++) path = `${base}-${n}.md`
  let repo = 'not a git repository'
  let check = 'Check its "Repo state" section, then start with Next step 1.'
  if (top) {
    const branch = (await git('branch', '--show-current')) || '(detached)'
    const files = (await git('status', '--porcelain')).split('\n').map(l => l.trim()).filter(Boolean)
    repo = `branch ${branch} · uncommitted: ${files.length ? files.slice(0, 12).join(', ') + (files.length > 12 ? `, +${files.length - 12} more` : '') : 'none'}`
    check = 'Check that `git status` matches its "Repo state" section, then start with Next step 1.'
    await excludeDir($, await git('rev-parse', '--path-format=absolute', '--git-path', 'info/exclude'), root)
  }
  const prompt = `Resume paused work in ${root}.\nRead ${path} first. It is your only context from the previous session.\n${check}\nRead only the files it points to unless you need more.`
  const notice = [
    `AUTO-PAUSE: pause threshold reached. ${usage(kind, used, resetsAt)}`,
    `Do not start new work. Finish or revert the step in progress (at most ${cfg.gateCalls} more tool calls), then use the writing-handoffs skill.`,
    `Handoff path: ${path}`,
    `Repo state: ${repo}`,
    'Resume prompt (put it verbatim at the top of the handoff, and end your turn with it in a code block):',
    prompt,
  ].join('\n')
  phase = 'pausing'
  pause = { kind, usedAtNotice: used, calls: 0, root, path, prompt, notice, stopBlocked: false }
  pending = notice
}

// Keep handoffs out of commits without touching tracked files.
async function excludeDir($: $, exclude: string, root: string) {
  if (!exclude) return
  const file = exclude.startsWith('/') ? exclude : `${root}/${exclude}`
  const line = `/${cfg.dir}/`
  const text = await $.fs.read(file).catch(() => '')
  if (text.split('\n').includes(line)) return
  await $.fs.write(file, `${text}${text && !text.endsWith('\n') ? '\n' : ''}${line}\n`).catch(() => {})
}

function validate(text: string) {
  const problems: string[] = []
  const top = text.split('\n').slice(0, 25).join('\n')
  const flat = (s: string) => s.replace(/\s+/g, ' ').trim()
  if (pause ? !flat(top).includes(flat(pause.prompt)) : !/Resume paused work in /.test(top))
    problems.push(pause ? 'Put the resume prompt from the AUTO-PAUSE notice verbatim in a ```text block at the top.' : 'Put the resume prompt in a ```text block at the top.')
  for (const h of REQUIRED) if (!new RegExp(`^##\\s+${h}\\b`, 'mi').test(text)) problems.push(`Add the "## ${h}" section.`)
  const next = /^##\s+Next steps\b[^\n]*\n([\s\S]*?)(?=^##\s|(?![\s\S]))/im.exec(text)
  if (next && !/^\s*(\d+\.|[-*])\s+\S/m.test(next[1] ?? '')) problems.push('"Next steps" needs at least one item.')
  const words = text.split(/\s+/).filter(Boolean).length
  if (words > cfg.words * 1.2) problems.push(`Cut it to about ${cfg.words} words (now ${words}).`)
  for (const block of text.matchAll(/^```[^\n]*\n([\s\S]*?)^```/gm))
    if ((block[1] ?? '').split('\n').length - 1 > 15) { problems.push('Replace code blocks over 15 lines with path:line pointers.'); break }
  if (SECRET.test(text)) problems.push('Remove the secret-looking string (key, token, or private key).')
  return problems
}

async function finishPause($: $) {
  if (!pause) return
  const w = windows.get(pause.kind)
  const entry: Calibration = {
    at: new Date(await $.clock.now()).toISOString(), kind: pause.kind, usedAtNotice: pause.usedAtNotice,
    usedAtDone: w?.used ?? pause.usedAtNotice, toolCalls: pause.calls, contextTokens,
    model: await $.session.model().then(m => String(m), () => undefined),
  }
  phase = 'paused'
  await $.store.set(`last:${pause.root}`, { path: pause.path, prompt: pause.prompt, at: entry.at })
  if (simulated !== undefined) return // simulated readings would skew the calibration
  const log = ((await $.store.get('calibration')) as Calibration[] | undefined) ?? []
  await $.store.set('calibration', [...log, entry].slice(-100))
}

export const register: Register = (on, options) => {
  cfg = config(options as Record<string, unknown>)

  on('session.start', async ($, e, next) => {
    // Dev-only. The EVAL_ copies exist because claude plugin eval passes only EVAL_* vars to a case.
    const sim = (await $.env.get('AUTO_PAUSE_SIMULATE_PERCENT_LEFT')) || (await $.env.get('EVAL_AUTO_PAUSE_SIMULATE_PERCENT_LEFT'))
    if (sim !== undefined && sim !== '' && !Number.isNaN(Number(sim))) {
      const after = Number((await $.env.get('AUTO_PAUSE_SIMULATE_AFTER_CALLS')) || (await $.env.get('EVAL_AUTO_PAUSE_SIMULATE_AFTER_CALLS')))
      if (after > 0) simulateAfter = { calls: after, left: Number(sim) }
      else { simulated = Number(sim); await onReading($, []) }
    }
    await $.command.register({ name: 'auto-pause-status', description: 'Show auto-pause state, the latest resume prompt for this folder, and calibration.' }).catch(() => {})
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    if (e.context.tokens !== undefined) contextTokens = e.context.tokens
    await onReading($, e.rateLimits).catch(() => {})
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (simulateAfter && --simulateAfter.calls < 0) {
      simulated = simulateAfter.left
      simulateAfter = undefined
      await onReading($, [])
    }
    const active = phase === 'pausing' || phase === 'gated'
    if (e.agentId !== undefined) {
      return active ? { deny: 'AUTO-PAUSE: the session is pausing for the usage limit. Stop and return to the parent now with what you have.' } : next(e)
    }
    const handoff = isHandoffCall(e as never)
    if (active && AGENT_TOOLS.has(e.tool)) return { deny: 'AUTO-PAUSE: no new subagents while pausing. Write the handoff instead.' }
    if (active && !handoff) {
      if (phase === 'pausing' && pause!.calls >= cfg.gateCalls) phase = 'gated'
      if (phase === 'gated') return { deny: `AUTO-PAUSE gate: only the handoff is allowed now. Use the writing-handoffs skill and write ${pause!.path}.\n${pause!.notice}` }
      pause!.calls++
    }
    const r = await next(e)
    if (r.deny !== undefined) return r
    const context: string[] = []
    const file = (e as { file_path?: unknown }).file_path
    if (FILE_TOOLS.has(e.tool) && !r.isError && isHandoffFile(file)) {
      const text = await $.fs.read(String(file)).catch(() => undefined)
      const problems = text === undefined ? [] : validate(text)
      if (text !== undefined && !problems.length) {
        if (active) await finishPause($)
        context.push(`AUTO-PAUSE: handoff OK. End your turn now with the handoff path${pause ? `, when usage resets` : ''}, and the resume prompt verbatim in a \`\`\`text block.`)
      } else if (problems.length) {
        context.push(`AUTO-PAUSE: the handoff needs fixes. Make them all in one Edit:\n${problems.map(p => `- ${p}`).join('\n')}`)
      }
    }
    if (pending) { context.unshift(pending); pending = undefined }
    return context.length ? { ...r, context: [...(r.context ?? []), ...context] } : r
  }).catch(($, e, next) => next(e)) // fail open: a mod bug must never brick a session

  // Let the handoff go through without a permission prompt while the user is away.
  on('tool.check', ($, e, next) =>
    (phase === 'pausing' || phase === 'gated') && e.agentId === undefined &&
    isHandoffCall({ tool: e.tool, ...(e.input as Record<string, unknown>) })
      ? { decision: 'allow', reason: 'auto-pause: handoff while pausing' }
      : next(e),
  ).catch(($, e, next) => next(e))

  // If Claude ends the turn before the handoff, send it back once.
  on('classic.Stop', ($, e, next) => {
    if ((phase !== 'pausing' && phase !== 'gated') || !pause || pause.stopBlocked || e.stop_hook_active) return next(e)
    pause.stopBlocked = true
    pending = undefined
    return { block: `${pause.notice}\nWrite the handoff now; this turn cannot end before it is written.` }
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'auto-pause-status' }, async $ => {
    const cwd = await $.session.cwd()
    const root = pause?.root ?? ((await $.process.run(['git', 'rev-parse', '--show-toplevel']).then(r => r.stdout.trim(), () => '')) || cwd)
    const last = (phase === 'pausing' || phase === 'gated') && pause
    ? { ...pause, at: 'pausing now, not written yet' }
    : ((await $.store.get(`last:${root}`)) as { path: string; prompt: string; at: string } | undefined)
    const log = ((await $.store.get('calibration')) as Calibration[] | undefined) ?? []
    const lines = [`auto-pause: ${phase}${simulated !== undefined ? ` (simulated ${simulated}% left)` : ''}`]
    for (const [kind, w] of windows) lines.push(`${usage(kind, w.used, w.resetsAt)}`)
    if (!hasData) lines.push('No usage data yet (it arrives after the first response; never on API keys or Team plans).')
    lines.push(`Thresholds: warn at ${cfg.warn.five_hour}% left, pause at ${cfg.pause.five_hour}% left (weekly ${cfg.warn.seven_day}/${cfg.pause.seven_day}).`)
    if (last) lines.push('', `Latest handoff for ${root} (${last.at}): ${last.path}`, 'Resume prompt:', '```text', last.prompt, '```')
    if (log.length) {
      const costs = log.map(c => c.usedAtDone - c.usedAtNotice).sort((a, b) => a - b)
      const p95 = costs[Math.min(costs.length - 1, Math.ceil(costs.length * 0.95) - 1)] ?? 0
      lines.push('', `Calibration: ${log.length} pause(s); handoff cost p95 ${round(p95)} points. Suggested pause_at_percent_left: ${round(p95 + 2)}.`)
    }
    return { text: lines.join('\n') }
  }).catch(() => ({ text: 'auto-pause: status failed; see claude --debug.' }))
}

function round(n: number) {
  return Math.round(n * 10) / 10
}

function stamp(d: Date, sep = ' ') {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}${sep}${p(d.getHours())}${sep === 'T' ? '' : ':'}${p(d.getMinutes())}`
}
