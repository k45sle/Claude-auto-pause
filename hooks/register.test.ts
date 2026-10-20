import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const ROOT = '/Users/me/My Projects/app'
const RESETS = '2026-10-19T22:00:00.000Z'
const NEXT_RESETS = '2026-10-20T03:00:00.000Z'

type World = { files: Map<string, string>; calls: string[]; notes: string[]; store: Map<string, unknown>; head: { value: string }; ask: { value: string }; id: { value: string }; status: { value: string } }

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
    const a = e.argv.slice(1).join(' ').replace('-c core.quotePath=false ', '')
    const out = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (!git) return { value: { ...out('').value, exitCode: 128 } }
    if (a === 'rev-parse --show-toplevel') return out(`${ROOT}\n`)
    if (a === 'branch --show-current') return out('main\n')
    if (a === 'rev-parse --short HEAD') return out(`${head.value}\n`)
    if (a === 'status --porcelain') return out(status.value)
    if (a === 'rev-parse --path-format=absolute --git-path info/exclude') return out(`${ROOT}/.git/info/exclude\n`)
    return out('')
  })
  on('fs.exists', ($, e) => ({ value: files.has(e.path) }))
  on('fs.read', ($, e) => {
    const t = files.get(e.path)
    if (t === undefined) throw new Error(`missing ${e.path}`)
    return { value: t }
  })
  on('fs.write', ($, e) => (files.set(e.path, e.text), { value: undefined }))
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
  return { files, calls, notes, store: kv, head, ask, id, status }
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

  test('custom thresholds from userConfig', { options: { pause_at_percent_left: 20, warn_at_percent_left: 30 } }, async ($, on) => {
    world(on); await start($)
    await $.session.measure(reading(81))
    expect(ctx(await $.tool.call(bash))).toContain('pause threshold reached')
  })

  test('status shows the pending prompt while pausing', async ($, on) => {
    world(on); await start($)
    const { prompt } = await pauseNotice($)
    expect((await $.command.run({ command: 'auto-pause-status', args: '' })).text).toContain('pausing now, not written yet')
    expect((await $.command.run({ command: 'auto-pause-status', args: '' })).text).toContain(prompt)
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
    expect((await $.command.run({ command: 'auto-pause-status', args: '' })).text).toContain('No usage data yet')
  })

  test('simulate env var pauses from session start', async ($, on) => {
    world(on, { AUTO_PAUSE_SIMULATE_PERCENT_LEFT: '6' }); await start($)
    expect((await $.command.run({ command: 'auto-pause-status', args: '' })).text).toContain('5-hour usage 94% used (6% left), reset time unknown')
    const { path, prompt } = await pauseNotice($)
    expect(path).toContain('/.handoffs/')
    expect(ctx(await $.tool.call({ tool: 'Write', file_path: path, content: handoff(prompt) } as never))).toContain('handoff OK')
    const status = (await $.command.run({ command: 'auto-pause-status', args: '' })).text!
    expect(status).toContain('auto-pause: paused (simulated 6% left)')
    expect(status).not.toContain('Calibration')
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
    const status = (await $.command.run({ command: 'auto-pause-status', args: '' })).text!
    expect(status).toContain('auto-pause: paused')
    expect(status).toContain(prompt)
    expect(status).toContain('Calibration: 1 pause(s): 1 verified, 0 facts-only, 0 released, 0 reset before a handoff.')
    expect(status).toContain('Handoff cost p95 2 points. Suggested pause_at_percent_left: 4.')
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

  test('over the word budget is flagged', { options: { handoff_word_budget: 20 } }, async ($, on) => {
    world(on); await start($)
    const { path, prompt } = await pauseNotice($)
    expect(ctx(await $.tool.call({ tool: 'Write', file_path: path, content: handoff(prompt) } as never))).toContain('Cut it to about 20 words')
  })

  test('manual handoffs are validated without a pause', async ($, on) => {
    world(on); await start($)
    const path = `${ROOT}/.handoffs/2026-10-19T1502-x.md`
    const r = await $.tool.call({ tool: 'Write', file_path: path, content: handoff(`Resume paused work in ${ROOT}.`) } as never)
    expect(ctx(r)).toContain('handoff OK')
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
    expect((await $.command.run({ command: 'auto-pause-status', args: '' })).text).toContain('auto-pause: normal')
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
    expect((await $.command.run({ command: 'auto-pause-status', args: '' })).text).toContain('auto-pause: gated')
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
    expect((await $.command.run({ command: 'auto-pause-status', args: '' })).text).toContain('1 released')
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
    expect((await $.command.run({ command: 'auto-pause-status', args: '' })).text).toContain('1 facts-only')
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
    const status = (await $.command.run({ command: 'auto-pause-status', args: '' })).text!
    expect(status).toContain(facts)
    expect(status).not.toContain(prompt)
  })

  test('hitting the limit before any pause writes a facts-only handoff', async ($, on) => {
    const w = world(on); await start($)
    await $.session.measure(reading(86))
    await $.classic.StopFailure({ error: 'rate_limit' } as never)
    const written = [...w.files.keys()].find(k => k.includes('/.handoffs/'))!
    expect(w.files.get(written)).toContain('The usage limit was hit before the handoff was written.')
    expect((await $.command.run({ command: 'auto-pause-status', args: '' })).text).toContain('auto-pause: paused')
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
    expect(r).toBeDefined()
    expect(ctx(await $.tool.call(bash))).toBe('')
  })

  test('release opens the gate and is logged as an override', async ($, on) => {
    world(on); await start($)
    await pauseNotice($)
    await $.session.measure(reading(98))
    expect((await $.tool.call(bash)).deny).toContain('AUTO-PAUSE gate')
    expect((await $.command.run({ command: 'auto-pause-status', args: 'release' })).text).toContain('gate released by you')
    expect((await $.tool.call(bash)).deny).toBeUndefined()
    expect((await $.command.run({ command: 'auto-pause-status', args: 'release' })).text).toBe('auto-pause: nothing to release.')
    expect((await $.command.run({ command: 'auto-pause-status', args: '' })).text).toContain('1 released')
  })

  test('a reset during a pause is logged as an outcome', async ($, on) => {
    world(on); await start($)
    await pauseNotice($)
    await $.session.measure(reading(10, 'five_hour', NEXT_RESETS))
    expect((await $.command.run({ command: 'auto-pause-status', args: '' })).text).toContain('1 reset before a handoff')
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
    await $.command.run({ command: 'auto-pause-status', args: 'release' })
    expect((await $.command.run({ command: 'auto-pause-status', args: '' })).text).not.toContain('Resume prompt:')
  })

  test('a new session id starts from a clean state', async ($, on) => {
    const w = world(on); await start($)
    await pauseNotice($)
    w.id.value = 'second-session'
    await start($)
    expect((await $.tool.call(bash)).deny).toBeUndefined()
    expect((await $.command.run({ command: 'auto-pause-status', args: '' })).text).toContain('auto-pause: normal')
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

  test('the resume prompt says what to do when the repo differs and to stay within the Goal', async ($, on) => {
    world(on); await start($)
    const { prompt } = await pauseNotice($)
    expect(prompt).toContain('(if not, tell the user before editing)')
    expect(prompt).toContain('ask the user before doing anything outside its Goal')
  })
})
