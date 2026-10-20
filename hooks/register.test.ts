import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const ROOT = '/Users/me/My Projects/app'
const RESETS = '2026-10-19T22:00:00.000Z'
const NEXT_RESETS = '2026-10-20T03:00:00.000Z'

type World = { files: Map<string, string>; calls: string[] }

// The engine beneath the plugin: git in a repo with one change, files in memory,
// every tool answering ok (Write/Edit store their text so validation can read it).
function world(on: On, env: Record<string, string> = {}, git = true): World {
  const files = new Map<string, string>([[`${ROOT}/.git/info/exclude`, '# git ls-files --others --exclude-from=.git/info/exclude\n']])
  const calls: string[] = []
  mock.clock(on, { now: Date.parse('2026-10-19T15:02:00Z') })
  mock.store(on)
  mock.env(on, env)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('session.cwd', () => ({ value: ROOT }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('process.run', ($, e) => {
    const a = e.argv.slice(1).join(' ')
    const out = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (!git) return { value: { ...out('').value, exitCode: 128 } }
    if (a === 'rev-parse --show-toplevel') return out(`${ROOT}\n`)
    if (a === 'branch --show-current') return out('main\n')
    if (a === 'status --porcelain') return out(' M src/a.ts\n M src/c.ts\n?? src/b.ts\n')
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
  return { files, calls }
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
main · uncommitted: src/a.ts
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
    expect(notice).toContain('Repo state: branch main · uncommitted: M src/a.ts, M src/c.ts, ?? src/b.ts')
    expect(prompt).toContain(`Resume paused work in ${ROOT}.`)
    expect(prompt).toContain(`Read ${path} first.`)
    expect(prompt).toContain('Check that `git status` matches')
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
    await pauseNotice($)
    expect((await $.tool.check(write as never)).decision).toBe('allow')
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
    expect(status).toContain('Calibration: 1 pause(s); handoff cost p95 2 points. Suggested pause_at_percent_left: 4.')
  })

  test('an invalid handoff gets a fix list and keeps the gate', async ($, on) => {
    world(on); await start($)
    const { path, prompt } = await pauseNotice($)
    const big = '```ts\n' + 'x\n'.repeat(20) + '```\nsk-ant-abc123'
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
