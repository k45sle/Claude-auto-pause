import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const ROOT = '/Users/me/My Projects/app'
const RESETS = '2026-10-19T22:00:00.000Z'
const NEXT_RESETS = '2026-10-20T03:00:00.000Z'

type World = { files: Map<string, string>; calls: string[]; notes: string[]; store: Map<string, unknown>; head: { value: string }; ask: { value: string }; id: { value: string }; status: { value: string }; exclude: { value: string }; links: Map<string, string>; top: { value: string }; config: { value: string }; tracked: { value: string }; runs: string[]; toasts: string[] }

// The engine beneath the plugin: git in a repo with one change, files in memory,
// every tool answering ok (Write/Edit store their text so validation can read it).
function world(on: On, env: Record<string, string> = {}, git = true, store: Record<string, unknown> = {}): World {
  const files = new Map<string, string>([[`${ROOT}/.git/info/exclude`, '# git ls-files --others --exclude-from=.git/info/exclude\n']])
  const calls: string[] = []
  const notes: string[] = []
  const head = { value: 'abc1234' }
  const ask = { value: 'Fix the date parser' }
  const id = { value: 'unknown' }
  const status = { value: ' M src/a.ts\n M src/c.ts\n?? src/b.ts\n' }
  const exclude = { value: `${ROOT}/.git/info/exclude\n` }
  const links = new Map<string, string>() // path -> where it really leads
  const top = { value: ROOT } // what rev-parse --show-toplevel prints
  const config = { value: '' } // git config --local --list
  const tracked = { value: '' } // git ls-files -- <handoff folder>
  const runs: string[] = [] // every git argv, as run
  const toasts: string[] = []
  const failWrite = { value: '' } // fs.write throws for this path
  mock.clock(on, { now: Date.parse('2026-10-19T15:02:00Z') })
  // A store the test can read back, so saved state can be checked.
  const kv = new Map<string, unknown>(Object.entries(store))
  on('store.get', ($, e) => ({ value: structuredClone(kv.get(e.key)) }))
  on('store.set', ($, e) => (kv.set(e.key, structuredClone(e.value)), { value: undefined }))
  on('store.delete', ($, e) => (kv.delete(e.key), { value: undefined }))
  on('store.keys', () => ({ value: [...kv.keys()] }))
  mock.env(on, env)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('session.cwd', () => ({ value: ROOT }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('process.run', ($, e) => {
    runs.push(e.argv.join(' '))
    const a = e.argv.slice(1).join(' ').replace('-c core.fsmonitor=false ', '').replace('-c core.quotePath=false ', '')
    const out = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (!git) return { value: { ...out('').value, exitCode: 128 } }
    if (a === 'rev-parse --show-toplevel') return out(`${top.value}\n`)
    if (a === 'config --local --list') return out(config.value)
    if (a.startsWith('ls-files')) return out(tracked.value)
    if (a === 'branch --show-current') return out('main\n')
    if (a === 'rev-parse --short HEAD') return out(`${head.value}\n`)
    if (a === 'status --porcelain') return out(status.value)
    if (a === 'rev-parse --path-format=absolute --git-path info/exclude') return out(exclude.value)
    return out('')
  })
  on('fs.exists', ($, e) => ({ value: files.has(e.path) }))
  on('fs.read', ($, e) => {
    const t = files.get(e.path)
    if (t === undefined) throw new Error(`missing ${e.path}`)
    return { value: t }
  })
  on('fs.write', ($, e) => {
    if (e.path === failWrite.value) throw new Error('EIO')
    return files.set(e.path, e.text), { value: undefined }
  })
  // links: path -> where it leads; '' = a dangling link, which a resolving stat rejects (as a real one would).
  // A path exists when it is a file, a link, or a folder holding a file.
  on('fs.stat', ($, e) => {
    const to = links.get(e.path)
    if (to === '' && e.resolve) throw new Error('ENOENT')
    const file = files.has(e.path)
    if (!file && to === undefined && ![...files.keys()].some(k => k.startsWith(`${e.path}/`))) throw new Error('ENOENT')
    return { value: { kind: file ? 'file' : 'dir', size: 0, mtimeMs: 0, isLink: to !== undefined, realPath: to || e.path } } as never
  })
  on('tool.call', ($, e) => {
    calls.push(e.tool)
    const x = e as unknown as { file_path?: string; content?: string; old_string?: string; new_string?: string }
    if (e.tool === 'Write' && x.file_path) files.set(x.file_path, x.content ?? '')
    if (e.tool === 'Edit' && x.file_path) files.set(x.file_path, (files.get(x.file_path) ?? '').replace(x.old_string ?? '', x.new_string ?? ''))
    return { result: 'ok' }
  })
  on('tool.check', () => ({ decision: 'ask' as const }))
  on('classic.Stop', () => ({}))
  on('classic.StopFailure', () => ({}))
  on('session.messages', () => ({ value: [
    { role: 'user', text: 'Start with the parser module', toolUses: [] },
    { role: 'user', text: ask.value, toolUses: [] },
    { role: 'user', text: '<system-reminder>harness text</system-reminder>', toolUses: [] },
    { role: 'assistant', text: '', toolUses: [{ tool_use_id: 't1', tool: 'Edit', input: { file_path: `${ROOT}/src/a.ts` } }] },
  ] }) as never)
  on('ui.notify', ($, e) => (notes.push(e.text), { value: { isSent: true, channel: 'test' } }) as never)
  on('session.id', () => ({ value: id.value }))
  on('ui.toast', ($, e) => (toasts.push(e.text), { value: undefined }) as never)
  return { files, calls, notes, store: kv, head, ask, id, status, exclude, links, top, config, tracked, runs, toasts, failWrite }
}

const reading = (used: number, kind = 'five_hour', resetsAt = RESETS) => ({
  context: { window: 200000, tokens: 90000 },
  rateLimits: [{ kind, percentUsed: used, resetsAt }],
  changed: ['rateLimits' as const],
})

const handoff = (prompt: string, extra = '') => `# Handoff: app

Paused 2026-10-19 15:02 · reason: AUTO-PAUSE

Resume prompt (paste into a new Code session):

\`\`\`text
${prompt}
\`\`\`

## Goal
Ship it · Done when: tests pass

## Status
- Done: a.ts

## Next steps
1. Edit src/b.ts line 3.

## Repo state
main · abc1234 · uncommitted: src/a.ts, src/b.ts, src/c.ts
${extra}`

const bash = { tool: 'Bash', command: 'ls' } as const
const ctx = (r: { context?: readonly string[] }) => (r.context ?? []).join('\n')

async function start($: any) {
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true })
}

async function pauseNotice($: any): Promise<{ notice: string; path: string; prompt: string }> {
  await $.session.measure(reading(94))
  const notice = ctx(await $.tool.call(bash))
  const path = /^Handoff path: (.*)$/m.exec(notice)![1]!
  const prompt = notice.split('end your turn with it in a code block):\n')[1]!
  return { notice, path, prompt }
}

const gated = async ($: any) => { const p = await pauseNotice($); await $.session.measure(reading(98)); return p }
const status = async ($: any, args = '') => (await $.command.run({ command: 'auto-pause-status', args })).text as string

describe('thresholds', () => {
  test('below warn injects nothing', async ($, on) => {
    world(on); await start($)
    await $.session.measure(reading(50))
    expect(ctx(await $.tool.call(bash))).toBe('')
  })

  test('warns once per window', async ($, on) => {
    world(on); await start($)
    await $.session.measure(reading(86))
    const first = ctx(await $.tool.call(bash))
    expect(first).toContain('AUTO-PAUSE: warning. 5-hour usage 86% used (14% left)')
    await $.session.measure(reading(88))
    expect(ctx(await $.tool.call(bash))).toBe('')
  })

  test('default pause point is 8% left (92% used)', async ($, on) => {
    world(on); await start($)
    await $.session.measure(reading(91))
    expect(ctx(await $.tool.call(bash))).toContain('AUTO-PAUSE: warning.')
    await $.session.measure(reading(92))
    expect(ctx(await $.tool.call(bash))).toContain('AUTO-PAUSE: pause threshold reached. 5-hour usage 92% used (8% left)')
  })

  test('pause notice carries absolute paths, repo state and a resume prompt, once', async ($, on) => {
    const w = world(on); await start($)
    const { notice, path, prompt } = await pauseNotice($)
    expect(notice).toContain('AUTO-PAUSE: pause threshold reached. 5-hour usage 94% used (6% left)')
    expect(notice).toContain('at most 5 more tool calls')
    expect(path.startsWith(`${ROOT}/.handoffs/`)).toBe(true)
    expect(path.endsWith('-auto-pause.md')).toBe(true)
    expect(notice).toContain('Repo state: branch main · HEAD abc1234 (copy it into "## Repo state") · uncommitted: M src/a.ts, M src/c.ts, ?? src/b.ts')
    expect(prompt).toContain(`Resume paused work in ${ROOT}.`)
    expect(prompt).toContain(`Read ${path} first.`)
    expect(prompt).toContain('Check that `git status` and HEAD match')
    expect(w.files.get(`${ROOT}/.git/info/exclude`)).toContain('\n/.handoffs/\n')
    await $.session.measure(reading(95))
    expect(ctx(await $.tool.call(bash))).toBe('')
  })

  test('outside git the prompt skips git status', async ($, on) => {
    world(on, {}, false); await start($)
    const { notice, prompt } = await pauseNotice($)
    expect(notice).toContain('Repo state: not a git repository')
    expect(prompt).not.toContain('git status')
  })

  test('weekly window binds with its own thresholds', async ($, on) => {
    world(on); await start($)
    await $.session.measure(reading(50))
    await $.session.measure({ ...reading(97, 'seven_day', NEXT_RESETS), rateLimits: [{ kind: 'five_hour', percentUsed: 50, resetsAt: RESETS }, { kind: 'seven_day', percentUsed: 97, resetsAt: NEXT_RESETS }] })
    expect(ctx(await $.tool.call(bash))).toContain('7-day usage 97% used (3% left)')
  })

  test('a custom handoff folder is used; an absolute or .. one falls back to .handoffs', { options: { handoff_dir: './notes/handoffs/' } }, async ($, on) => {
    world(on); await start($)
    expect((await pauseNotice($)).path).toContain(`${ROOT}/notes/handoffs/`)
  })

  for (const bad of ['/tmp/x', '   ', '.', '../x', "a'; touch y; '"])
    test(`handoff folder ${JSON.stringify(bad)} falls back to .handoffs`, { options: { handoff_dir: bad } }, async ($, on) => {
      world(on); await start($)
      expect((await pauseNotice($)).path).toContain(`${ROOT}/.handoffs/2`)
    })

  test('custom thresholds from userConfig', { options: { pause_at_percent_left: 20, warn_at_percent_left: 30 } }, async ($, on) => {
    world(on); await start($)
    await $.session.measure(reading(81))
    expect(ctx(await $.tool.call(bash))).toContain('pause threshold reached')
  })

  test('status shows the pending prompt while pausing', async ($, on) => {
    world(on); await start($)
    const { prompt } = await pauseNotice($)
    expect((await status($))).toContain('pausing now, not written yet')
    expect((await status($))).toContain(prompt)
  })

  test('a reset after a warning alone returns to normal and warns again', async ($, on) => {
    world(on); await start($)
    await $.session.measure(reading(86))
    expect(ctx(await $.tool.call(bash))).toContain('warning')
    await $.session.measure(reading(87, 'five_hour', NEXT_RESETS))
    expect(ctx(await $.tool.call(bash))).toContain('warning. 5-hour usage 87%')
  })

  test('a weekly pause held back by a 5-hour pause fires after the 5-hour reset', async ($, on) => {
    const w = world(on); await start($)
    const both = (five: number, resets: string) => ({ ...reading(five), rateLimits: [{ kind: 'five_hour', percentUsed: five, resetsAt: resets }, { kind: 'seven_day', percentUsed: 97, resetsAt: '2026-10-25T00:00:00.000Z' }] })
    await $.session.measure(both(94, RESETS))
    const { path, prompt } = await (async () => {
      const notice = ctx(await $.tool.call(bash))
      expect(notice).toContain('5-hour usage 94%')
      return { path: /^Handoff path: (.*)$/m.exec(notice)![1]!, prompt: notice.split('code block):\n')[1]! }
    })()
    await $.tool.call({ tool: 'Write', file_path: path, content: handoff(prompt) } as never)
    w.files.set(path, 'x') // the next handoff gets a new name
    await $.session.measure(both(2, NEXT_RESETS))
    expect(ctx(await $.tool.call(bash))).toContain('7-day usage 97% used (3% left)')
  })

  test('empty rateLimits stays inactive', async ($, on) => {
    world(on); await start($)
    await $.session.measure({ context: { window: 200000 }, rateLimits: [], changed: ['context'] })
    expect(ctx(await $.tool.call(bash))).toBe('')
    expect((await status($))).toContain('No usage data yet. It arrives with Claude\'s first reply on a Pro or Max plan')
  })

  test('the no-data toast fires once', async ($, on) => {
    const w = world(on); await start($)
    for (let i = 0; i < 3; i++) await $.session.measure({ context: { window: 200000 }, rateLimits: [], changed: ['context'] })
    expect(w.toasts.length).toBe(1)
    expect(w.toasts[0]).toContain('no usage data')
  })

  test('simulate env var pauses from session start', async ($, on) => {
    world(on, { AUTO_PAUSE_SIMULATE_PERCENT_LEFT: '6' }); await start($)
    expect((await status($))).toContain('5-hour usage 94% used (6% left), reset time unknown')
    const { path, prompt } = await pauseNotice($)
    expect(path).toContain('/.handoffs/')
    expect(ctx(await $.tool.call({ tool: 'Write', file_path: path, content: handoff(prompt) } as never))).toContain('handoff OK')
    const text = await status($)
    expect(text).toContain('State: paused (simulated 6% left)')
    expect(text).not.toContain('Calibration')
  })
  test('simulate after N calls lands mid-task, on main or subagent calls', async ($, on) => {
    world(on, { EVAL_AUTO_PAUSE_SIMULATE_PERCENT_LEFT: '6', EVAL_AUTO_PAUSE_SIMULATE_AFTER_CALLS: '2' }); await start($)
    expect(ctx(await $.tool.call(bash))).toBe('')
    expect((await $.tool.call({ tool: 'Read', file_path: `${ROOT}/a.ts`, agentId: 'sub1' } as never)).deny).toBeUndefined()
    expect((await $.tool.call({ tool: 'Read', file_path: `${ROOT}/b.ts`, agentId: 'sub1' } as never)).deny).toContain('return to the parent')
    expect(ctx(await $.tool.call(bash))).toContain('AUTO-PAUSE: pause threshold reached. 5-hour usage 94% used (6% left)')
    await $.session.measure(reading(40)) // a real reading must not restart the pause
    expect(ctx(await $.tool.call(bash))).toBe('')
  })
})

describe('gate', () => {
  test('grace calls run, then non-handoff tools are refused', async ($, on) => {
    const w = world(on); await start($)
    await pauseNotice($) // the notice rides on the first call, which counts as grace 1
    for (let i = 0; i < 4; i++) expect((await $.tool.call(bash)).deny).toBeUndefined()
    const r = await $.tool.call(bash)
    expect(r.deny).toContain('AUTO-PAUSE gate')
    expect(w.calls.filter(t => t === 'Bash').length).toBe(5)
  })

  test('gate after points even within the grace calls', async ($, on) => {
    world(on); await start($)
    await pauseNotice($)
    await $.session.measure(reading(97))
    expect((await $.tool.call(bash)).deny).toContain('AUTO-PAUSE gate')
  })

  test('handoff skill and writes pass the gate', async ($, on) => {
    world(on); await start($)
    const { path } = await pauseNotice($)
    await $.session.measure(reading(98))
    expect((await $.tool.call({ tool: 'Skill', skill: 'auto-pause:writing-handoffs' } as never)).deny).toBeUndefined()
    expect((await $.tool.call({ tool: 'Write', file_path: path, content: 'x' } as never)).deny).toBeUndefined()
    expect((await $.tool.call({ tool: 'Edit', file_path: `${ROOT}/src/a.ts`, old_string: 'a', new_string: 'b' } as never)).deny).toContain('AUTO-PAUSE gate')
  })

  test('subagent calls and new Agent spawns are refused while pausing', async ($, on) => {
    world(on); await start($)
    expect((await $.tool.call({ ...bash, agentId: 'a1' } as never)).deny).toBeUndefined()
    await pauseNotice($)
    expect((await $.tool.call({ ...bash, agentId: 'a1' } as never)).deny).toContain('return to the parent')
    expect((await $.tool.call({ tool: 'Agent', prompt: 'x', description: 'x' } as never)).deny).toContain('no new subagents')
  })

  test('tool.check allows only the handoff while pausing', async ($, on) => {
    world(on); await start($)
    const write = { tool: 'Write', input: { file_path: `${ROOT}/.handoffs/x.md`, content: '' } }
    expect((await $.tool.check(write as never)).decision).toBe('ask')
    const { path } = await pauseNotice($)
    // Only the exact file the resume prompt names is auto-allowed.
    expect((await $.tool.check(write as never)).decision).toBe('ask')
    expect((await $.tool.check({ tool: 'Write', input: { file_path: path, content: '' } } as never)).decision).toBe('allow')
    expect((await $.tool.check({ tool: 'Skill', input: { skill: 'auto-pause:writing-handoffs' } } as never)).decision).toBe('allow')
    expect((await $.tool.check({ tool: 'Bash', input: { command: 'rm -rf /' } } as never)).decision).toBe('ask')
  })
})

describe('stop', () => {
  test('blocks once while pausing, then lets the turn end', async ($, on) => {
    world(on); await start($)
    await $.session.measure(reading(94))
    const first = await $.classic.Stop({ stop_hook_active: false })
    expect(first.block).toContain('AUTO-PAUSE: pause threshold reached')
    expect((await $.classic.Stop({ stop_hook_active: true })).block).toBeUndefined()
    expect((await $.classic.Stop({ stop_hook_active: false })).block).toBeUndefined()
  })

  test('never blocks when not pausing', async ($, on) => {
    world(on); await start($)
    await $.session.measure(reading(86))
    expect((await $.classic.Stop({ stop_hook_active: false })).block).toBeUndefined()
  })
})

describe('handoff validation', () => {
  test('a valid handoff releases the gate and logs calibration', async ($, on) => {
    world(on); await start($)
    const { path, prompt } = await pauseNotice($)
    await $.session.measure(reading(96))
    const r = await $.tool.call({ tool: 'Write', file_path: path, content: handoff(prompt) } as never)
    expect(ctx(r)).toContain('AUTO-PAUSE: handoff OK')
    expect((await $.tool.call(bash)).deny).toBeUndefined()
    expect((await $.classic.Stop({ stop_hook_active: false })).block).toBeUndefined()
    const text = await status($)
    expect(text).toContain('State: paused')
    expect(text).toContain(prompt)
    expect(text).toContain('Calibration: 1 pause(s): 1 verified, 0 facts-only, 0 released, 0 reset before a handoff.')
    expect(text).toContain('Handoff cost p95 2 points. Suggested pause_at_percent_left: 4.')
  })

  test('an invalid handoff gets a fix list and keeps the gate', async ($, on) => {
    world(on); await start($)
    const { path, prompt } = await pauseNotice($)
    const big = '```ts\n' + 'x\n'.repeat(20) + '```\nsk-ant-api03-' + 'a1B2'.repeat(6)
    const bad = handoff(prompt, big).replace('## Goal', '## Aim').replace('1. Edit src/b.ts line 3.', '')
    const r = await $.tool.call({ tool: 'Write', file_path: path, content: bad } as never)
    const c = ctx(r)
    expect(c).toContain('the handoff needs fixes')
    expect(c).toContain('Add the "## Goal" section.')
    expect(c).toContain('"Next steps" needs at least one item.')
    expect(c).toContain('code blocks over 15 lines')
    expect(c).toContain('secret-looking')
    await $.session.measure(reading(98))
    expect((await $.tool.call(bash)).deny).toContain('AUTO-PAUSE gate')
    // One Edit fixes the heading; the rest still fails, so the gate stays.
    const fixed = await $.tool.call({ tool: 'Edit', file_path: path, old_string: '## Aim', new_string: '## Goal' } as never)
    expect(ctx(fixed)).not.toContain('Add the "## Goal" section.')
  })

  test('a missing resume prompt is flagged', async ($, on) => {
    world(on); await start($)
    const { path } = await pauseNotice($)
    const r = await $.tool.call({ tool: 'Write', file_path: path, content: handoff('Resume something else') } as never)
    expect(ctx(r)).toContain('resume prompt from the AUTO-PAUSE notice')
  })

  test('over the word budget is flagged', { options: { handoff_word_budget: 100 } }, async ($, on) => {
    world(on); await start($)
    const { path, prompt } = await pauseNotice($)
    expect(ctx(await $.tool.call({ tool: 'Write', file_path: path, content: handoff(prompt, 'word '.repeat(100)) } as never))).toContain('Cut it to about 100 words')
  })

  test('manual handoffs are validated without a pause', async ($, on) => {
    world(on); await start($)
    const path = `${ROOT}/.handoffs/2026-10-19T1502-x.md`
    const prompt = `Resume paused work in ${ROOT}.\nRead ${path} first. It is your only context from the previous session.\nCheck that \`git status\` and HEAD match its "Repo state" section (if not, tell the user before editing). Run the commands under "Verify" and each "check with" command under "Outside operations", and tell the user if a result differs from the recorded one, then start with Next step 1.\nRead only the files it points to unless you need more, and ask the user before doing anything outside its Goal.\nIf the user tells you something in this session that differs from the handoff, follow the user.`
    const r = await $.tool.call({ tool: 'Write', file_path: path, content: handoff(prompt) } as never)
    expect(ctx(r)).toContain('handoff OK')
  })

  test('the manual facts call gets usage, reset time and the word budget; other Bash calls do not', { options: { handoff_word_budget: 400 } }, async ($, on) => {
    world(on); await start($)
    const facts = { tool: 'Bash', command: 'bash "/x/skills/writing-handoffs/scripts/facts.sh" parser .handoffs' } as never
    expect(ctx(await $.tool.call(facts))).toBe('auto-pause: usage unknown (no current reading). Word budget: 400.')
    await $.session.measure(reading(40))
    const r = ctx(await $.tool.call(facts))
    expect(r).toContain('5-hour usage 40% used (60% left), resets ')
    expect(r).toContain('Word budget: 400.')
    expect(ctx(await $.tool.call(bash))).toBe('')
  })

  test('a manual handoff whose prompt names another file or skips the HEAD check is sent back with the right prompt', async ($, on) => {
    world(on); await start($)
    const path = `${ROOT}/.handoffs/2026-10-20T1130-status.md`
    const stale = `Resume paused work in ${ROOT}.\nRead ${ROOT}/.handoffs/2026-10-20T0926-status.md first. It is your only context from the previous session.\nCheck that \`git status\` matches its "Repo state" section, then start with Next step 1.`
    const r = ctx(await $.tool.call({ tool: 'Write', file_path: path, content: handoff(stale) } as never))
    expect(r).toContain('Put this resume prompt verbatim')
    expect(r).toContain(`Read ${path} first.`)
    expect(r).not.toContain('handoff OK')
  })

  test('an empty section is flagged', async ($, on) => {
    world(on); await start($)
    const { path, prompt } = await pauseNotice($)
    const r = ctx(await $.tool.call({ tool: 'Write', file_path: path, content: handoff(prompt, '\n## Open questions for the user\n\n') } as never))
    expect(r).toContain('empty "## Open questions for the user" section')
  })

  test('an empty last section with no trailing newline is flagged', async ($, on) => {
    world(on); await start($)
    const { path, prompt } = await pauseNotice($)
    expect(ctx(await $.tool.call({ tool: 'Write', file_path: path, content: handoff(prompt, '\n## Dead ends') } as never))).toContain('empty "## Dead ends" section')
  })

  test('a resume prompt buried below the top is flagged', async ($, on) => {
    world(on); await start($)
    const { path, prompt } = await pauseNotice($)
    const buried = handoff('see below', '\n' + 'filler line\n'.repeat(30) + prompt)
    expect(ctx(await $.tool.call({ tool: 'Write', file_path: path, content: buried } as never))).toContain('resume prompt from the AUTO-PAUSE notice')
  })

  test('.. in a handoff path neither passes the gate nor gets auto-allowed', async ($, on) => {
    world(on); await start($)
    await pauseNotice($)
    const sneaky = `${ROOT}/.handoffs/../CLAUDE.md`
    expect((await $.tool.check({ tool: 'Write', input: { file_path: sneaky, content: '' } } as never)).decision).toBe('ask')
    await $.session.measure(reading(98))
    expect((await $.tool.call({ tool: 'Write', file_path: sneaky, content: 'x' } as never)).deny).toContain('AUTO-PAUSE gate')
  })

  test('writes outside the handoff folder are not validated', async ($, on) => {
    world(on); await start($)
    expect(ctx(await $.tool.call({ tool: 'Write', file_path: `${ROOT}/notes.md`, content: 'x' } as never))).toBe('')
  })
})

describe('windows', () => {
  test('a reset returns to normal and thresholds fire again', async ($, on) => {
    world(on); await start($)
    await pauseNotice($)
    await $.session.measure(reading(3, 'five_hour', NEXT_RESETS))
    expect((await $.tool.call(bash)).deny).toBeUndefined()
    expect((await status($))).toContain('State: normal')
    await $.session.measure(reading(95, 'five_hour', NEXT_RESETS))
    expect(ctx(await $.tool.call(bash))).toContain('pause threshold reached')
  })

  test('after a valid handoff no further notices for that window', async ($, on) => {
    world(on); await start($)
    const { path, prompt } = await pauseNotice($)
    await $.tool.call({ tool: 'Write', file_path: path, content: handoff(prompt) } as never)
    await $.session.measure(reading(99))
    expect(ctx(await $.tool.call(bash))).toBe('')
  })
})

describe('refinements from the competitor review', () => {
  test('the pause survives a plugin reload: state is restored from the store', async ($, on) => {
    const path = `${ROOT}/.handoffs/2026-10-19T1002-auto-pause.md`
    const saved = {
      phase: 'gated', owner: 'five_hour', hasData: true,
      pause: { kind: 'five_hour', usedAtNotice: 94, calls: 5, root: ROOT, path, prompt: 'P', notice: 'N', stopBlocked: false, head: 'abc1234' },
      windows: [['five_hour', { key: `five_hour@${RESETS}`, used: 95, resetsAt: RESETS, fired: ['warn', 'pause'] }]],
    }
    world(on, {}, true, { 'session:unknown': saved }); await start($)
    expect((await $.tool.call(bash)).deny).toContain('AUTO-PAUSE gate')
    expect((await status($))).toContain('State: gated')
  })

  test('state is saved after each change', async ($, on) => {
    const w = world(on); await start($)
    await pauseNotice($)
    const saved = w.store.get('session:unknown') as { phase: string; pause: { path: string } }
    expect(saved.phase).toBe('pausing')
    expect(saved.pause.path).toContain('/.handoffs/')
  })

  test('the gate lets reads and read-only git through, nothing else', async ($, on) => {
    world(on); await start($)
    await pauseNotice($)
    await $.session.measure(reading(98))
    expect((await $.tool.call({ tool: 'Read', file_path: `${ROOT}/src/a.ts` } as never)).deny).toBeUndefined()
    expect((await $.tool.call({ tool: 'Bash', command: 'git status --porcelain' } as never)).deny).toBeUndefined()
    expect((await $.tool.call({ tool: 'Bash', command: 'git log --oneline -5' } as never)).deny).toBeUndefined()
    expect((await $.tool.call({ tool: 'Bash', command: 'git push' } as never)).deny).toContain('AUTO-PAUSE gate')
    expect((await $.tool.call({ tool: 'Bash', command: 'git status; rm -rf src' } as never)).deny).toContain('AUTO-PAUSE gate')
    expect((await $.tool.call({ tool: 'Edit', file_path: `${ROOT}/src/a.ts`, old_string: 'a', new_string: 'b' } as never)).deny).toContain('AUTO-PAUSE gate')
  })

  test('while pausing a handoff at another path is refused by the gate and flagged in grace', async ($, on) => {
    world(on); await start($)
    const { prompt } = await pauseNotice($)
    const other = `${ROOT}/.handoffs/my-own-name.md`
    const r = await $.tool.call({ tool: 'Write', file_path: other, content: handoff(prompt) } as never)
    expect(ctx(r)).toContain('Write the handoff to exactly that path')
    expect(ctx(r)).not.toContain('handoff OK')
    await $.session.measure(reading(98))
    expect((await $.tool.call({ tool: 'Write', file_path: other, content: '' } as never)).deny).toContain('AUTO-PAUSE gate')
  })

  test('the handoff must name the current HEAD in Repo state', async ($, on) => {
    world(on); await start($)
    const { notice, path, prompt } = await pauseNotice($)
    expect(notice).toContain('HEAD abc1234')
    const r = await $.tool.call({ tool: 'Write', file_path: path, content: handoff(prompt).replace('abc1234 · ', '') } as never)
    expect(ctx(r)).toContain('must name HEAD abc1234')
  })

  test('three failed checks open the gate instead of locking the session', async ($, on) => {
    world(on); await start($)
    const { path } = await pauseNotice($)
    await $.session.measure(reading(98))
    for (let i = 0; i < 2; i++) expect(ctx(await $.tool.call({ tool: 'Write', file_path: path, content: '# nothing' } as never))).toContain('needs fixes')
    expect(ctx(await $.tool.call({ tool: 'Write', file_path: path, content: '# nothing' } as never))).toContain('The gate is open anyway')
    expect((await $.tool.call(bash)).deny).toBeUndefined()
    expect((await status($))).toContain('1 released')
  })

  test('a second Stop without a handoff writes the facts-only one and notifies', async ($, on) => {
    const w = world(on); await start($)
    const { path } = await pauseNotice($)
    expect((await $.classic.Stop({ stop_hook_active: false })).block).toContain('AUTO-PAUSE')
    expect((await $.classic.Stop({ stop_hook_active: true })).block).toBeUndefined()
    const text = w.files.get(path)!
    expect(text).toContain('# Handoff: facts only')
    expect(text).toContain('Fix the date parser')
    expect(text).toContain('Files edited in the old session: src/a.ts')
    expect(text).toContain('HEAD abc1234')
    expect(text).toContain(`Read ${path} first.`)
    expect(w.notes[0]).toContain(path)
    expect((await $.tool.call(bash)).deny).toBeUndefined()
    expect((await status($))).toContain('1 facts-only')
  })

  test('a failed facts-only write still opens the gate', async ($, on) => {
    const w = world(on); await start($)
    const { path } = await pauseNotice($)
    w.failWrite.value = path
    await $.classic.Stop({ stop_hook_active: false })
    await $.classic.Stop({ stop_hook_active: true })
    expect((await $.tool.call(bash)).deny).toBeUndefined()
  })

  test('harmless secret-named lines pass, a real token is still flagged', async ($, on) => {
    world(on); await start($)
    const { path, prompt } = await pauseNotice($)
    const ok = 'TOKEN_PATH=/home/me/tok.json\nAPI_KEY_FILE=./secrets/key.txt\nGITHUB_TOKEN_SCOPES=repo,workflow\nPASSWORD_MIN_LENGTH=12345678'
    expect(ctx(await $.tool.call({ tool: 'Write', file_path: path, content: handoff(prompt, ok) } as never))).not.toContain('secret-looking')
    const bad = `GITHUB_TOKEN=ghp_${'a1B2'.repeat(9)}`
    expect(ctx(await $.tool.call({ tool: 'Write', file_path: path, content: handoff(prompt, bad) } as never))).toContain('secret-looking')
  })

  test('a partial handoff from Claude is kept and the facts go beside it', async ($, on) => {
    const w = world(on); await start($)
    const { path, prompt } = await pauseNotice($)
    await $.tool.call({ tool: 'Write', file_path: path, content: '# Handoff: half' } as never)
    await $.classic.Stop({ stop_hook_active: false })
    await $.classic.Stop({ stop_hook_active: true })
    const facts = path.replace(/\.md$/, '-facts.md')
    expect(w.files.get(path)).toBe('# Handoff: half')
    expect(w.files.get(facts)).toContain(`Read ${facts} first.`)
    const text = await status($)
    expect(text).toContain(facts)
    expect(text).not.toContain(prompt)
  })

  test('hitting the limit before any pause writes a facts-only handoff', async ($, on) => {
    const w = world(on); await start($)
    await $.session.measure(reading(86))
    await $.classic.StopFailure({ error: 'rate_limit' } as never)
    const written = [...w.files.keys()].find(k => k.includes('/.handoffs/'))!
    expect(w.files.get(written)).toContain('The usage limit was hit before the handoff was written.')
    expect((await status($))).toContain('State: paused')
  })

  test('other StopFailure errors do nothing', async ($, on) => {
    const w = world(on); await start($)
    await pauseNotice($)
    await $.classic.StopFailure({ error: 'overloaded' } as never)
    expect([...w.files.keys()].some(k => k.includes('/.handoffs/'))).toBe(false)
  })

  test('a reading whose reset time has passed is ignored', async ($, on) => {
    world(on); await start($)
    const r = await $.session.measure(reading(97, 'five_hour', '2026-10-19T12:00:00.000Z'))
    expect(r).toEqual({ changed: ['rateLimits'] })
    expect(ctx(await $.tool.call(bash))).toBe('')
  })

  test('release opens the gate and is logged as an override', async ($, on) => {
    world(on); await start($)
    await pauseNotice($)
    await $.session.measure(reading(98))
    expect((await $.tool.call(bash)).deny).toContain('AUTO-PAUSE gate')
    expect((await status($, 'release'))).toContain('Gate released by you')
    expect((await $.tool.call(bash)).deny).toBeUndefined()
    expect((await status($, 'release'))).toBe('Nothing to release.')
    expect((await status($))).toContain('1 released')
  })

  test('a reset during a pause is logged as an outcome', async ($, on) => {
    world(on); await start($)
    await pauseNotice($)
    await $.session.measure(reading(10, 'five_hour', NEXT_RESETS))
    expect((await status($))).toContain('1 reset before a handoff')
  })
})

describe('review fixes', () => {
  test('a 429 at low usage or with no data does not pause or write anything', async ($, on) => {
    const w = world(on); await start($)
    await $.classic.StopFailure({ error: 'rate_limit' } as never)
    await $.session.measure(reading(40))
    await $.classic.StopFailure({ error: 'rate_limit' } as never)
    expect([...w.files.keys()].some(k => k.includes('/.handoffs/'))).toBe(false)
    await $.session.measure(reading(94))
    expect(ctx(await $.tool.call(bash))).toContain('pause threshold reached')
  })

  test('mutating git subcommands and file-writing flags stay gated', async ($, on) => {
    world(on); await start($)
    await pauseNotice($)
    await $.session.measure(reading(98))
    for (const command of ['git branch -D main', 'git branch newname', 'git branch -m x', 'git diff --output=/tmp/x', 'git log --output=x', 'git show --ext-diff HEAD'])
      expect((await $.tool.call({ tool: 'Bash', command } as never)).deny).toContain('AUTO-PAUSE gate')
    for (const command of ['git branch', 'git branch --show-current', 'git branch -a', 'git diff HEAD~1 -- src/a.ts', 'git rev-parse --short HEAD'])
      expect((await $.tool.call({ tool: 'Bash', command } as never)).deny).toBeUndefined()
  })

  test('a commit during the grace calls: the new HEAD is accepted', async ($, on) => {
    const w = world(on); await start($)
    const { path, prompt } = await pauseNotice($)
    w.head.value = 'def5678'
    const r = await $.tool.call({ tool: 'Write', file_path: path, content: handoff(prompt).replace('abc1234', 'def5678') } as never)
    expect(ctx(r)).toContain('handoff OK')
  })

  test('the facts-only handoff redacts secrets from the last request', async ($, on) => {
    const w = world(on); await start($)
    w.ask.value = 'use ANTHROPIC_API_KEY=sk-ant-api03-' + 'a1B2'.repeat(6) + ' and fix it'
    const { path } = await pauseNotice($)
    await $.classic.Stop({ stop_hook_active: false })
    await $.classic.Stop({ stop_hook_active: true })
    expect(w.files.get(path)).toContain('[redacted]')
    expect(w.files.get(path)).not.toContain('sk-ant-api03')
  })

  test('the first Stop blocks even when another hook already blocked once', async ($, on) => {
    world(on); await start($)
    await pauseNotice($)
    expect((await $.classic.Stop({ stop_hook_active: true })).block).toContain('AUTO-PAUSE')
  })

  test('releasing before any handoff exists leaves no resume prompt pointing nowhere', async ($, on) => {
    world(on); await start($)
    await pauseNotice($)
    await status($, 'release')
    expect((await status($))).not.toContain('Resume prompt:')
  })

  test('a new session id starts from a clean state', async ($, on) => {
    const w = world(on); await start($)
    await pauseNotice($)
    w.id.value = 'second-session'
    await start($)
    expect((await $.tool.call(bash)).deny).toBeUndefined()
    expect((await status($))).toContain('State: normal')
  })
})

describe('snapshot accuracy', () => {
  test('a handoff that leaves out an uncommitted file is sent back with the file named', async ($, on) => {
    const w = world(on); await start($)
    const { path, prompt } = await pauseNotice($)
    // src/d.ts was changed during the grace calls, after the notice listed the repo state.
    w.status.value = ' M src/a.ts\n M src/c.ts\n?? src/b.ts\nR  old.ts -> src/d.ts\n?? .handoffs/x.md\n'
    const c = ctx(await $.tool.call({ tool: 'Write', file_path: path, content: handoff(prompt) } as never))
    expect(c).toContain('Name these uncommitted files and their state in "## Status" or "## Repo state": src/d.ts.')
    expect(c).not.toContain('.handoffs')
  })

  test('a bulk change over 15 files is not checked file by file', async ($, on) => {
    const w = world(on); await start($)
    const { path, prompt } = await pauseNotice($)
    w.status.value = Array.from({ length: 16 }, (_, i) => `?? gen/f${i}.ts`).join('\n')
    expect(ctx(await $.tool.call({ tool: 'Write', file_path: path, content: handoff(prompt) } as never))).toContain('handoff OK')
  })

  test('a checked handoff gets the user\'s own words and the edited files appended, harness text skipped', async ($, on) => {
    const w = world(on); await start($)
    w.ask.value = 'Fix the date parser, key sk-ant-api03-' + 'a1B2'.repeat(6)
    const { path, prompt } = await pauseNotice($)
    expect(ctx(await $.tool.call({ tool: 'Write', file_path: path, content: handoff(prompt) } as never))).toContain('handoff OK')
    const text = w.files.get(path)!
    expect(text).toContain('## Session facts (added by auto-pause, read from the session)')
    expect(text).toContain('- "Start with the parser module"\n- "Fix the date parser, key [redacted]"')
    expect(text).not.toContain('system-reminder')
    expect(text).toContain('Files edited in the old session: src/a.ts')
    // A later edit is checked without the appended section, and the section is not duplicated.
    expect(ctx(await $.tool.call({ tool: 'Edit', file_path: path, old_string: 'Ship it', new_string: 'Ship it now' } as never))).toContain('handoff OK')
    expect(w.files.get(path)!.split('## Session facts').length).toBe(2)
  })

  test('secrets on their own line and private-key bodies are redacted from the appended requests', async ($, on) => {
    const w = world(on); await start($)
    w.ask.value = 'use this:\nexport API_TOKEN=abcd1234efgh\n-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg\n-----END PRIVATE KEY-----\nthanks'
    const { path, prompt } = await pauseNotice($)
    await $.tool.call({ tool: 'Write', file_path: path, content: handoff(prompt) } as never)
    const text = w.files.get(path)!
    expect(text).not.toContain('abcd1234efgh')
    expect(text).not.toContain('MIIEvQIBADANBg')
    expect(text).toContain('thanks')
  })

  test('a request after an IDE tag or one that mentions AUTO-PAUSE is kept; hook feedback is not', async ($, on) => {
    const w = world(on); await start($)
    w.ask.value = '<ide_opened_file>src/a.ts</ide_opened_file> why did AUTO-PAUSE fire?'
    const { path, prompt } = await pauseNotice($)
    await $.tool.call({ tool: 'Write', file_path: path, content: handoff(prompt) } as never)
    expect(w.files.get(path)!).toContain('- "why did AUTO-PAUSE fire?"')
  })

  test('a pasted request keeps its text, even a leading tag, and loses its wrapper tags and reminders', async ($, on) => {
    const w = world(on); await start($)
    w.ask.value = '<ide_opened_file>a.ts</ide_opened_file><pasted_content id="6777">\n<b>Fix</b> the parser\n</pasted_content id="6777">\n<system-reminder>harness</system-reminder> then rerun the tests'
    const { path, prompt } = await pauseNotice($)
    await $.tool.call({ tool: 'Write', file_path: path, content: handoff(prompt) } as never)
    expect(w.files.get(path)!).toContain('- "<b>Fix</b> the parser then rerun the tests"')
    expect(w.files.get(path)!).not.toContain('harness')
    expect(w.files.get(path)!).not.toContain('pasted_content')
  })

  test('the mod\'s own feedback is not taken for a user request', async ($, on) => {
    const w = world(on); await start($)
    w.ask.value = 'Stop hook feedback:\nAUTO-PAUSE: pause threshold reached.'
    const { path, prompt } = await pauseNotice($)
    await $.tool.call({ tool: 'Write', file_path: path, content: handoff(prompt) } as never)
    expect(w.files.get(path)!).not.toContain('threshold reached')
  })

  test('a longer file name does not count as naming a dirty file', async ($, on) => {
    const w = world(on); await start($)
    const { path, prompt } = await pauseNotice($)
    w.status.value = ' M src/a.ts\n M src/c.ts\n?? src/b.ts\n M lib/x.ts\n M "caf\u00e9.ts"\n'
    const c = ctx(await $.tool.call({ tool: 'Write', file_path: path, content: handoff(prompt, 'Also touched lib/data.ts') } as never))
    expect(c).toContain('Repo state": lib/x.ts, café.ts.')
  })

  test('two changed files with the same name each need their path', async ($, on) => {
    const w = world(on); await start($)
    const { path, prompt } = await pauseNotice($)
    w.status.value = ' M src/index.ts\n M test/index.ts\n M lib/only.ts\n'
    const c = ctx(await $.tool.call({ tool: 'Write', file_path: path, content: handoff(prompt, 'Changed index.ts and only.ts') } as never))
    expect(c).toContain('Repo state": src/index.ts, test/index.ts.')
    expect(ctx(await $.tool.call({ tool: 'Write', file_path: path, content: handoff(prompt, 'Changed src/index.ts, test/index.ts and only.ts') } as never))).toContain('handoff OK')
  })

  test('a changed path inside a longer one does not name it when the file name is shared', async ($, on) => {
    const w = world(on); await start($)
    const { path, prompt } = await pauseNotice($)
    w.status.value = ' M index.ts\n M src/index.ts\n M lib/a.ts\n M xlib/a.ts\n'
    const c = ctx(await $.tool.call({ tool: 'Write', file_path: path, content: handoff(prompt, 'Changed src/index.ts and xlib/a.ts') } as never))
    expect(c).toContain('Repo state": index.ts, lib/a.ts.')
    const named = handoff(prompt, `Changed ./index.ts, src/index.ts, xlib/a.ts and ${ROOT}/lib/a.ts`)
    expect(ctx(await $.tool.call({ tool: 'Write', file_path: path, content: named } as never))).toContain('handoff OK')
  })

  test('the resume prompt says what to do when the repo differs, to rerun Verify and the outside-operation checks, and to stay within the Goal', async ($, on) => {
    world(on); await start($)
    const { prompt } = await pauseNotice($)
    expect(prompt).toContain('(if not, tell the user before editing)')
    expect(prompt).toContain('Run the commands under "Verify"')
    expect(prompt).toContain('each "check with" command under "Outside operations"')
    expect(prompt).toContain('ask the user before doing anything outside its Goal')
    expect(prompt).toContain('differs from the handoff, follow the user')
  })
})

describe('abuse and misconfiguration', () => {

  test('git commands spelled around the check stay gated', async ($, on) => {
    world(on); await start($); await gated($)
    for (const command of ['git status\ntouch /tmp/pwn', 'git log --out"put"=o1', 'git log --{output,x}=o2', "git log --output='o'",
      'git log --outp=o', 'git diff --ext-diff', 'git status; rm -rf src', 'git status && touch x', 'git log | sh', 'git branch -D main',
      'git -c core.pager=sh log', 'cd /tmp && rm x', 'git show $(id)', 'cd /tmp/evil && git status', 'cd .. && git status',
      'git diff --no-index /dev/null /Users/me/.ssh/id_rsa', 'git diff -O/etc/passwd', 'cd'])
      expect((await $.tool.call({ tool: 'Bash', command } as never)).deny).toContain('AUTO-PAUSE gate')
  })

  test('safe chains of read-only git pass the gate and skip the permission prompt', async ($, on) => {
    world(on); await start($); await gated($)
    const command = `cd "${ROOT}" && git status --short && git diff --stat; git log --oneline -3 && git rev-parse --short HEAD`
    expect((await $.tool.call({ tool: 'Bash', command } as never)).deny).toBeUndefined()
    expect((await $.tool.check({ tool: 'Bash', input: { command } } as never)).decision).toBe('allow')
  })

  test('reads while gated are capped', async ($, on) => {
    world(on); await start($); await gated($)
    for (let i = 0; i < 10; i++) expect((await $.tool.call({ tool: 'Read', file_path: `${ROOT}/src/a.ts` } as never)).deny).toBeUndefined()
    expect((await $.tool.call({ tool: 'Read', file_path: `${ROOT}/src/a.ts` } as never)).deny).toContain('AUTO-PAUSE gate')
  })

  test('a tool input field called tool cannot pass for the handoff', async ($, on) => {
    world(on); await start($); await gated($)
    const r = await $.tool.check({ tool: 'mcp__x__run', input: { tool: 'Skill', skill: 'writing-handoffs', cmd: 'rm -rf /' } } as never)
    expect(r.decision).toBe('ask')
  })

  test('a handoff folder that links outside the project is not auto-approved', async ($, on) => {
    const w = world(on); w.links.set(`${ROOT}/.handoffs`, '/tmp/elsewhere'); await start($)
    const { path } = await pauseNotice($)
    expect((await $.tool.check({ tool: 'Write', input: { file_path: path, content: 'x' } } as never)).decision).toBe('ask')
  })

  test('a dangling link as the handoff folder is not auto-approved', async ($, on) => {
    const w = world(on); w.links.set(`${ROOT}/.handoffs`, ''); await start($)
    const { path } = await pauseNotice($)
    expect((await $.tool.check({ tool: 'Write', input: { file_path: path, content: 'x' } } as never)).decision).toBe('ask')
  })

  test('old git echoing an unknown flag does not write a junk exclude file', async ($, on) => {
    const w = world(on); w.exclude.value = '--path-format=absolute\n.git/info/exclude\n'; await start($)
    await pauseNotice($)
    expect([...w.files.keys()].some(k => k.includes('--path-format'))).toBe(false)
  })

  test('session start prunes stores older than 8 days and keeps recent ones', async ($, on) => {
    const now = Date.parse('2026-10-19T15:02:00Z')
    const w = world(on, {}, true, { 'session:old': { at: now - 9 * 24 * 3600e3 }, 'session:recent': { at: now - 3600e3 } }); await start($)
    expect(w.store.has('session:old')).toBe(false)
    expect(w.store.has('session:recent')).toBe(true)
  })

  for (const bad of ['-x/info/exclude\n', 'a\nb\n'])
    test(`a git exclude path ${JSON.stringify(bad)} writes nothing`, async ($, on) => {
      const w = world(on); w.exclude.value = bad; await start($); await pauseNotice($)
      expect([...w.files.keys()].filter(k => /exclude/.test(k))).toEqual([`${ROOT}/.git/info/exclude`])
      expect(w.files.get(`${ROOT}/.git/info/exclude`)).toBe('# git ls-files --others --exclude-from=.git/info/exclude\n')
    })

  test('out-of-range settings fall back to the defaults', { options: { pause_at_percent_left: 500, warn_at_percent_left: -5, gate_after_points: 0, handoff_word_budget: 0 } }, async ($, on) => {
    world(on); await start($)
    await $.session.measure(reading(86))
    expect(ctx(await $.tool.call(bash))).toContain('AUTO-PAUSE: warning.')
    const { path, prompt } = await pauseNotice($)
    for (let i = 0; i < 4; i++) expect((await $.tool.call(bash)).deny).toBeUndefined() // the notice call plus 4: 5 grace calls, not 0 points
    expect((await $.tool.call(bash)).deny).toContain('AUTO-PAUSE gate')
    expect(ctx(await $.tool.call({ tool: 'Write', file_path: path, content: handoff(prompt) } as never))).toContain('handoff OK')
  })
})

describe('hardening', () => {
  const prompt = (path: string) => `Resume paused work in ${ROOT}.\nRead ${path} first. It is your only context from the previous session.\nCheck that \`git status\` and HEAD match its "Repo state" section (if not, tell the user before editing). Run the commands under "Verify" and each "check with" command under "Outside operations", and tell the user if a result differs from the recorded one, then start with Next step 1.\nRead only the files it points to unless you need more, and ask the user before doing anything outside its Goal.\nIf the user tells you something in this session that differs from the handoff, follow the user.`
  const p2 = (n: number) => String(n).padStart(2, '0')
  const stampNow = () => { const d = new Date(Date.parse('2026-10-19T15:02:00Z')); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}${p2(d.getMinutes())}` }
  const write = ($: any, file_path: string, content: string) => $.tool.call({ tool: 'Write', file_path, content } as never)

  test('git cannot be pointed at files outside the repo, but ranges pass', async ($, on) => {
    world(on); await start($); await gated($)
    for (const command of ['git diff x /dev/null', 'git diff ~/.aws/credentials x', 'git diff ../secret x', 'git show HEAD ..', 'git diff /etc/passwd'])
      expect((await $.tool.call({ tool: 'Bash', command } as never)).deny).toContain('AUTO-PAUSE gate')
    for (const command of ['git diff HEAD~1..HEAD', 'git log -3 --stat', 'git log main..feature --oneline']) {
      expect((await $.tool.call({ tool: 'Bash', command } as never)).deny).toBeUndefined()
      expect((await $.tool.check({ tool: 'Bash', input: { command } } as never)).decision).toBe('allow')
    }
    expect((await $.tool.check({ tool: 'Bash', input: { command: 'git diff ~/.aws/credentials x' } } as never)).decision).toBe('ask')
  })

  for (const [cfg, ok] of [['core.fsmonitor=/tmp/x.sh', false], ['core.fsmonitor=true', true], ['core.fsmonitor', true], ['diff.external=/tmp/x.sh', false],
    ['diff.foo.textconv=cat', false], ['filter.lfs.clean=x', false], ['include.path=../x', false], ['user.name=a=b', true]] as const)
    test(`repo config ${cfg} ${ok ? 'keeps' : 'withholds'} the git auto-approval`, async ($, on) => {
      const w = world(on); w.config.value = `core.bare=false\n${cfg}\n`; await start($)
      await gated($)
      expect((await $.tool.check({ tool: 'Bash', input: { command: 'git status' } } as never)).decision).toBe(ok ? 'allow' : 'ask')
      expect((await $.tool.call({ tool: 'Bash', command: 'git status' } as never)).deny).toBeUndefined() // the gate's rescue is unchanged
    })

  test('internal git calls disable fsmonitor and quoting', async ($, on) => {
    const w = world(on); await start($); await pauseNotice($)
    expect(w.runs.length).toBeGreaterThan(0)
    expect(w.runs.every(r => r.startsWith('git -c core.fsmonitor=false '))).toBe(true)
    expect(w.runs.some(r => r.includes('-c core.quotePath=false status --porcelain'))).toBe(true)
  })

  test('sessions pausing in the same minute get different paths', async ($, on) => {
    const w = world(on); w.id.value = 'aaaa-1111'; await start($)
    const a = (await pauseNotice($)).path
    w.id.value = 'bbbb-2222'; await start($)
    const b = (await pauseNotice($)).path
    expect(a.endsWith('-auto-pause-aaaa11.md')).toBe(true)
    expect(b.endsWith('-auto-pause-bbbb22.md')).toBe(true)
  })

  test('a dangling link at the would-be name is skipped', async ($, on) => {
    const w = world(on); w.links.set(`${ROOT}/.handoffs/${stampNow()}-auto-pause.md`, ''); await start($)
    expect((await pauseNotice($)).path).toBe(`${ROOT}/.handoffs/${stampNow()}-auto-pause-2.md`)
  })

  test('the facts-only handoff never writes through a link at its path', async ($, on) => {
    const w = world(on); await start($)
    const { path } = await pauseNotice($)
    const facts = path.replace(/\.md$/, '-facts')
    w.links.set(path, '/tmp/elsewhere/x.md'); w.links.set(`${facts}.md`, '')
    await $.classic.Stop({ stop_hook_active: false })
    await $.classic.Stop({ stop_hook_active: true })
    expect(w.files.has(path)).toBe(false)
    expect(w.files.has(`${facts}.md`)).toBe(false)
    expect(w.files.get(`${facts}-2.md`)).toContain(`Read ${facts}-2.md first.`)
    expect(w.files.get(`${facts}-2.md`)).not.toContain('A partial handoff')
  })

  test('a handoff folder that leads outside gets no facts-only handoff', async ($, on) => {
    const w = world(on); w.links.set(`${ROOT}/.handoffs`, '/tmp/elsewhere'); await start($)
    await pauseNotice($)
    await $.classic.Stop({ stop_hook_active: false })
    await $.classic.Stop({ stop_hook_active: true })
    expect([...w.files.keys()].some(k => k.includes('/.handoffs/'))).toBe(false)
    expect(w.notes[0]).toContain('leads outside the project, so no facts-only handoff was written')
    expect((await $.tool.call(bash)).deny).toBeUndefined()
    expect(await status($)).not.toContain('Resume prompt:')
  })

  test('a handoff file that resolves outside the project is not checked or extended', async ($, on) => {
    const w = world(on); await start($)
    const { path, prompt: pr } = await pauseNotice($)
    w.links.set(path, '/tmp/elsewhere/h.md')
    const r = ctx(await write($, path, handoff(pr)))
    expect(r).toContain('leads outside the project, so it was not checked or extended')
    expect(r).not.toContain('handoff OK')
    expect(w.files.get(path)).toBe(handoff(pr))
  })

  test('a handoff after a finished pause is checked against its own prompt', async ($, on) => {
    const w = world(on); await start($)
    const { path, prompt: pr } = await pauseNotice($)
    expect(ctx(await write($, path, handoff(pr)))).toContain('handoff OK')
    const next = `${ROOT}/.handoffs/2026-10-19T1700-more.md`
    const r = ctx(await write($, next, handoff(prompt(next))))
    expect(r).toContain('handoff OK')
    expect(r).not.toContain('when usage resets')
    expect(w.files.get(next)).toContain('## Session facts')
  })

  test('a handoff after a release is checked against its own prompt', async ($, on) => {
    world(on); await start($)
    await pauseNotice($)
    await status($, 'release')
    const next = `${ROOT}/.handoffs/2026-10-19T1700-more.md`
    expect(ctx(await write($, next, handoff(prompt(next))))).toContain('handoff OK')
  })

  for (const ask of ['<task>Fix the parser</task> and rerun', '<task>Fix the parser</task>'])
    test(`the user's own tag blocks stay in the session facts: ${ask}`, async ($, on) => {
      const w = world(on); await start($)
      w.ask.value = ask
      const { path, prompt: pr } = await pauseNotice($)
      await write($, path, handoff(pr))
      expect(w.files.get(path)).toContain(`- "${ask}"`)
    })

  for (const [name, secret] of [
    ['gitlab', 'glpat-a1B2c3D4e5F6g7H8i9J0'], ['stripe', 'sk_live_a1B2c3D4e5F6g7H8'], ['jwt', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghij1234'],
    ['npm', '//registry.npmjs.org/:_authToken=abcd1234efgh5678'], ['json', '{"password": "hunter2hunter2"}'], ['db pass', '\nDB_PASS=hunter2hunter2'],
    ['https url', 'https://deploy:hunter2pass@git.example.com'], ['passwd', '\nMYSQL_PASSWD=hunter2hunter2'],
    // From a reddit report: .mcp.json env blocks and code lines got past the start-of-line and whole-key patterns.
    ['mcp.json supabase', '"SUPABASE_SERVICE_TOKEN": "sbp_0123456789abcdefghij"'], ['mcp.json notion', '"NOTION_TOKEN": "ntn_abcdefghijklmnop123"'],
    ['ts const', 'const NOTION_SECRET = "ntn_abcdefghijklmnop123"'], ['env mid-line', 'SUPABASE_SERVICE_TOKEN=sbp_0123456789abcdefghij'],
    ['spaced password', "CLIENT_PASSWORD = 'hunter2hunter2'"], ['postgres url', 'postgres://app:hunter2pass@db.example.com:5432/app'],
    ['yaml', 'FOO_TOKEN: a1B2c3D4e5F6'], ['json suffix key', '{"github_token": "a1B2c3D4e5F6g7H8"}'],
    ['os.environ', 'os.environ["NOTION_TOKEN"] = "ntn_abcdefghijklmnop123"'], ['lowercase yaml', 'notion_token: ntn_a1B2c3D4e5F6'],
    ['camelCase', "const notionSecret = 'ntn_abcdefghijklmnop123'"], ['header key', '"x-api-key": "a1B2c3D4e5F6"'],
    ['bare TOKEN', 'TOKEN=ntn_abcdefghijklmnop123'], ['long name', `GITHUB_${'X'.repeat(300)}_TOKEN=a1B2c3D4e5F6`],
    ['query string', 'curl https://x.io/v1?api_key=a1B2c3D4e5F6'], ['aws credentials', 'aws_secret_access_key = a1B2c3D4e5F6g7H8']] as const)
    test(`${name} secrets are redacted from the appended facts`, async ($, on) => {
      const w = world(on); await start($)
      w.ask.value = `see ${secret} ok`
      const { path, prompt: pr } = await pauseNotice($)
      await write($, path, handoff(pr))
      const text = w.files.get(path)!
      expect(text).toContain('[redacted]')
      expect(text).not.toMatch(/a1B2c3D4|hunter2|abcd1234efgh|eyJzdWIi|sbp_0123|ntn_abcd/)
    })

  test('a long run of newlines redacts fast, and BYPASS_CACHE is not a secret', async ($, on) => {
    const w = world(on); await start($)
    w.ask.value = 'run\nBYPASS_CACHE=truevalue123' + '\n'.repeat(50000) + 'done'
    const { path, prompt: pr } = await pauseNotice($)
    const t = Date.now()
    await write($, path, handoff(pr))
    expect(Date.now() - t).toBeLessThan(100)
    expect(w.files.get(path)).toContain('BYPASS_CACHE=truevalue123')
  })

  test('a long identifier redacts fast, and token-ish keys without secret values stay', async ($, on) => {
    const w = world(on); await start($)
    w.ask.value = '"max_tokens": 4096, "tokenizer": "cl100k_base", GITHUB_TOKEN: ${{ secrets.GH }} GITHUB_TOKEN: expired "token": "<your-token-here>" token: 2026-10-21 const token = getToken() const apiToken = getToken2() "next_page_token": 12345678901 password: "********" GITHUB_TOKEN: 2026-10-21 ' + 'TOKEN'.repeat(10000) + ' ' + 'token'.repeat(10000) + ' ' + 'token=a'.repeat(20000) + ' ' + 'TOKEN=aaaaaaaaa'.repeat(10000)
    const { path, prompt: pr } = await pauseNotice($)
    const t = Date.now()
    await write($, path, handoff(pr))
    expect(Date.now() - t).toBeLessThan(100)
    expect(w.files.get(path)).toContain('"max_tokens": 4096, "tokenizer": "cl100k_base", GITHUB_TOKEN: ${{ secrets.GH }} GITHUB_TOKEN: expired "token": "<your-token-here>" token: 2026-10-21 const token = getToken() const apiToken = getToken2() "next_page_token": 12345678901 password: "********" GITHUB_TOKEN: 2026-10-21')
  })

  test('a file name git quotes (a double quote) can be named and pass', async ($, on) => {
    const w = world(on); await start($)
    const { path, prompt: pr } = await pauseNotice($)
    w.status.value = ' M src/a.ts\n M src/c.ts\n?? src/b.ts\n?? "q\\"uote.ts"\n'
    expect(ctx(await write($, path, handoff(pr)))).toContain('Name these uncommitted files and their state in "## Status" or "## Repo state": q"uote.ts.')
    expect(ctx(await write($, path, handoff(pr, 'Also q"uote.ts')))).toContain('handoff OK')
  })

  test('a non-ASCII file name passes', async ($, on) => {
    const w = world(on); await start($)
    const { path, prompt: pr } = await pauseNotice($)
    w.status.value = ' M src/a.ts\n M src/c.ts\n?? src/b.ts\n?? café.ts\n'
    expect(ctx(await write($, path, handoff(pr, 'Also café.ts')))).toContain('handoff OK')
  })

  for (const [root, cd, ok] of [
    ['/Users/me/Café Projects/app', "cd '/Users/me/Café Projects/app'", true],
    ["/Users/me/Dad's Projects/app", `cd "/Users/me/Dad's Projects/app"`, true],
    ['/Users/me/My Projects (old)/app', "cd '/Users/me/My Projects (old)/app'", true],
    ['/Users/me/$HOME/app', 'cd "/Users/me/$HOME/app"', false],
    ['/Users/me/$HOME/app', 'cd /Users/me/$HOME/app', false],
    ["/Users/me/Dad's/app", "cd '/Users/me/Dad's/app'", false],
  ] as const)
    test(`${cd} && git status is ${ok ? 'approved' : 'refused'}`, async ($, on) => {
      const w = world(on); w.top.value = root; await start($); await pauseNotice($)
      expect((await $.tool.check({ tool: 'Bash', input: { command: `${cd} && git status` } } as never)).decision).toBe(ok ? 'allow' : 'ask')
    })

  test('handoff_dir slashes collapse', { options: { handoff_dir: 'a//b' } }, async ($, on) => {
    world(on); await start($)
    expect((await pauseNotice($)).path).toContain(`${ROOT}/a/b/`)
  })

  for (const bad of ['.git/hooks', '.claude/x', '.git', '.Git/hooks', '.CLAUDE/x', './/x'])
    test(`handoff folder ${bad} falls back to .handoffs`, { options: { handoff_dir: bad } }, async ($, on) => {
      world(on); await start($)
      expect((await pauseNotice($)).path).toContain(`${ROOT}/.handoffs/`)
    })

  test('a handoff folder holding tracked files is not excluded, and its other changes are still named', { options: { handoff_dir: 'src' } }, async ($, on) => {
    const w = world(on); w.tracked.value = 'src/a.ts'; await start($)
    const { path, prompt: pr } = await pauseNotice($)
    expect(w.files.get(`${ROOT}/.git/info/exclude`)).not.toContain('/src/')
    expect(w.runs.some(c => c.endsWith('ls-files -- :(top)src'))).toBe(true)
    w.status.value = ' M src/x.py\n?? src/\n'
    expect(ctx(await write($, path, handoff(pr)))).toContain('"## Repo state": src/x.py.')
  })

  test('status shows the settings in use and the ones ignored', { options: { pause_at_percent_left: 150, warn_at_percent_left: 5 } }, async ($, on) => {
    world(on); await start($)
    const text = await status($)
    expect(text.startsWith('State: normal')).toBe(true)
    expect(text).toContain('Gate after 5 tool calls or 3 points. Handoff folder .handoffs. Word budget 600.')
    expect(text).toContain('pause_at_percent_left "150" is out of range; using 8.')
    expect(text).toContain('warn_at_percent_left 5 is not above pause_at_percent_left 8, so there is no separate warning.')
  })
})
