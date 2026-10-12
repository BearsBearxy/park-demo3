/* Copyright (c) 2026 Junyang. All rights reserved. 版权所有，未经授权禁止复制、出售、抄袭。⁠​‌​​‌​‌​​‌‌‌​‌​‌​‌‌​‌‌‌​​‌‌‌‌​​‌​‌‌​​​​‌​‌‌​‌‌‌​​‌‌​​‌‌‌⁠ */
// 导入弹窗「点下去之后」(画布 11 节 ImportSeg / ImportOne / ImportDone / ImportFail / ImportBusyClose;UI-OVERLAY-SPEC §8):
// 弹窗不关 → 进度卡(逐段真进度 / 单次不确定)→ 原地结果卡或失败卡;200ms 内结束不出进度卡;
// 逐段断在网络 / 5xx 从断的那段接着导(前面的段不重发);4xx 整单拒只给「返回修改」;导入中关不掉。
import { mount, flushPromises } from '@vue/test-utils'
import { AxiosError } from 'axios'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

vi.mock('@/api/s10', () => ({ s10Api: { importRows: vi.fn() } }))
vi.mock('@/api/importLog', () => ({ importLogApi: { record: vi.fn(() => Promise.resolve()) } }))
vi.mock('@/api/ledger', () => ({ companyApi: { list: vi.fn(), create: vi.fn() }, ledgerApi: { import: vi.fn() } }))
vi.mock('@/api/report', () => ({ reportApi: { import: vi.fn() } }))
vi.mock('@/api/salary', () => ({ salaryApi: { importRows: vi.fn() } }))
vi.mock('@/api/utilities', () => ({ utilitiesApi: { importRows: vi.fn() } }))

import FpImportModal, { type ImportRec, type ImportPayload, type SectionPick } from '../FpImportModal.vue'
import ImportResultCard from '../ImportResultCard.vue'
import { importBusy, type ImportOutcome, type ImportRunProgress } from '../importRun'
import { runImport } from '@/utils/importRegistry'
import http from '@/api/index'
import { s10Api } from '@/api/s10'
import { importLogApi } from '@/api/importLog'
import { companyApi, ledgerApi } from '@/api/ledger'
import { reportApi } from '@/api/report'
import { salaryApi } from '@/api/salary'
import { utilitiesApi } from '@/api/utilities'

type Runner = (payload: ImportPayload, fileName: string, p: ImportRunProgress) => Promise<ImportOutcome | null>
type Vm = {
  onSectionsConfirm: (picks: SectionPick[]) => void
  onLabelConfirm: (picks: { label: string; records: ImportRec[] }[]) => void
}
const recs = (n: number) => Array.from({ length: n }, (_, i) => ({ tenantName: `户${i}` }))
const OK = (imported: number, skipped = 0): ImportOutcome => ({ imported, skipped, errors: [] })
/** 三段:2 / 3 / 5 条,共 10 条 */
const PICKS: SectionPick[] = [
  { year: 2025, month: 1, phase: 1, records: recs(2) },
  { year: 2025, month: 2, phase: 2, records: recs(3) },
  { year: 2025, month: 3, phase: 4, records: recs(5) },
]
function mountModal(runner: Runner, extra: Record<string, unknown> = {}) {
  return mount(FpImportModal, { props: { title: '导入', templateCols: ['A'], runner, ...extra }, attachTo: document.body })
}
const vmOf = (w: { vm: unknown }) => w.vm as Vm
const btn = (w: ReturnType<typeof mountModal>, text: string) => w.findAll('.fpimp-f button').find(b => b.text().includes(text))
/** 一个可以从外面结算的 promise */
function deferred<T>() {
  let resolve!: (v: T) => void, reject!: (e: unknown) => void
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b })
  return { promise, resolve, reject }
}

let wrappers: { unmount: () => void }[] = []
beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); wrappers = [] })
afterEach(() => { wrappers.forEach(w => w.unmount()); vi.useRealTimers() })
const track = <T extends { unmount: () => void }>(w: T) => { wrappers.push(w); return w }

describe('200ms 门槛', () => {
  // 破坏验证:gate 的 200 改成 0 → 第一条「100ms 跑完从没出过进度卡」红
  it('❗200ms 内跑完:从不出进度卡,直接出结果卡', async () => {
    const runner = vi.fn<Runner>(() => new Promise(r => setTimeout(() => r(OK(10)), 100)))
    const w = track(mountModal(runner))
    vmOf(w).onLabelConfirm([{ label: '一期', records: recs(10) }])
    await vi.advanceTimersByTimeAsync(99)
    expect(w.find('.ipc').exists(), '还没到 200ms').toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await flushPromises()
    expect(w.find('.ipc').exists(), '100ms 就跑完了,进度卡一次都不该出').toBe(false)
    expect(w.find('.irc h4').text()).toBe('导进去 10 行')
  })

  // 破坏验证:gate 回调里不设 showCard → 「过了 200ms 还没出卡」红
  it('❗过了 200ms 还没完:出进度卡,之前那一屏收起', async () => {
    const d = deferred<ImportOutcome>()
    const w = track(mountModal(() => d.promise))
    vmOf(w).onLabelConfirm([{ label: '一期', records: recs(10) }])
    await vi.advanceTimersByTimeAsync(199)
    expect(w.find('.ipc').exists()).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(w.find('.ipc').exists()).toBe(true)
    expect((w.find('.fpimp-check').element as HTMLElement).style.display, '核对页收起').toBe('none')
    expect(w.findAll('.fpimp-s').map(s => s.classes()[1]), '步骤条走到第 3 步').toEqual(['done', 'done', 'now'])
    d.resolve(OK(10)); await flushPromises()
  })
})

describe('进度卡 · 两种模式', () => {
  // 破坏验证:ImportProgressCard 去掉 :class="{ ind: !run.seg }" → 横移条那条红;「已用」不走 mss → 0:01 那条红
  it('❗单次请求:不写百分比,不确定进度条 + 已用 m:ss + 「中途没有进度可看」+ 步骤表', async () => {
    const d = deferred<ImportOutcome>()
    const w = track(mountModal(() => d.promise))
    vmOf(w).onLabelConfirm([{ label: '一期', records: recs(1648) }])
    await vi.advanceTimersByTimeAsync(1000)
    expect(w.find('.ipc-h h4').text()).toBe('正在导入 1,648 行')
    expect(w.find('.ipc-el').text()).toBe('已用 0:01')
    expect(w.find('.ipc-bar').classes()).toContain('ind')
    expect(w.find('.ipc-bar i').attributes('style') ?? '', '不确定条不按百分比画宽').not.toContain('width')
    expect(w.find('.ipc-sub').text()).toBe('这一步一次写完，中途没有进度可看')
    expect(w.findAll('.ipc-steps li').map(li => [li.classes()[0], li.find('span:not(.st)').text()])).toEqual([
      ['done', '读取文件'], ['now', '写入 1,648 行'], ['todo', '记下这次导入'], ['todo', '刷新本页'],
    ])
    expect(w.text(), '单次不写百分比').not.toMatch(/%/)
    // 底栏只一颗灰「导入中…」,× 灰
    expect(w.findAll('.fpimp-f button').map(b => b.text())).toEqual(['导入中…'])
    expect(btn(w, '导入中…')!.attributes('disabled')).toBeDefined()
    expect(w.find('.fpimp-x').classes()).toContain('busy')
    d.resolve(OK(1648)); await flushPromises()
  })

  // 破坏验证:segDone 里 run.done = k(少 1)→ 「已写进 1 / 10」红;
  //          written 改回按发出行数(s.n)累计 → 「已写进 1」变 2 红(跳过的行不算写入,结果卡写的也是 1 导进去 1 没导);
  //          pct 改按 written 算 → 「width: 20%」变 10% 红(进度条按发出的行数走)
  it('❗逐段(md-v2-run):「正在导入 3 段 · N 行」;进度条按已发出的行数走;「已写进 a / N 行」按后端回的写入数;每段一行 已导进去 / 正在写 / 没开始', async () => {
    let prog!: ImportRunProgress
    const d = deferred<ImportOutcome>()
    const w = track(mountModal((_p, _f, p) => { prog = p; return d.promise }, { segmented: true }))
    vmOf(w).onSectionsConfirm(PICKS)
    await vi.advanceTimersByTimeAsync(200)
    const segs = () => w.findAll('.ipc-segs li').map(li => [li.classes()[0], li.text()])
    expect(w.find('.ipc-h h4').text()).toBe('正在导入 3 段 · 10 行')
    expect(w.find('.ipc-sub').text()).toBe('已写进 0 / 10 行')
    expect(segs()).toEqual([['now', '2025年1月 一期2 行正在写'], ['todo', '2025年2月 二期3 行没开始'], ['todo', '2025年3月 宿舍5 行没开始']])
    expect(w.find('.ipc-p').text()).toBe('导完之前不能关这个窗口。万一断了，不关窗口就能从断的那段接着导。')
    prog.segDone(0, OK(1, 1))   // 第 1 段 2 行:1 行写入、1 行被后端跳过
    await flushPromises()
    expect(w.find('.ipc-sub').text()).toBe('已写进 1 / 10 行')
    expect(w.find('.ipc-bar i').attributes('style')).toContain('width: 20%')
    expect(segs().map(s => s[0])).toEqual(['done', 'now', 'todo'])
    expect(segs()[0][1]).toBe('2025年1月 一期2 行已导进去')
    prog.segDone(1, OK(3)); prog.segDone(2, OK(5))
    await flushPromises()
    expect(w.find('.ipc-sub').text()).toBe('已写进 9 / 10 行')
    expect(w.find('.ipc-bar i').attributes('style')).toContain('width: 100%')
    d.resolve(OK(10)); await flushPromises()
  })

  it('同一个月的几段只写期区(「一期」),不重复年月', async () => {
    const d = deferred<ImportOutcome>()
    const w = track(mountModal(() => d.promise, { segmented: true }))
    vmOf(w).onSectionsConfirm(PICKS.map(p => ({ ...p, month: 9, year: 2026 })))
    await vi.advanceTimersByTimeAsync(200)
    expect(w.findAll('.ipc-segs .nm').map(n => n.text())).toEqual(['一期', '二期', '宿舍'])
    d.resolve(OK(10)); await flushPromises()
  })
})

describe('结果卡', () => {
  // 破坏验证:ResultCard 去掉 kind==='secs' 那组两块数 → 「1 段 / 6,907 格导进去」红;footer 去掉 v-if="go" → 「不给 go 没有去 X 看」红
  it('❗多段都导进去(md-v2-motion ③):「✓ 导进去 N」+「K 段」「N 导进去」+ 哪几段在库里了;分项明细;底栏只「完成」', async () => {
    const w = track(mountModal(async (_p, _f, p) => {
      p.refreshing()
      return { ...OK(6907), refreshed: true, detail: [['创显', '830 科目 · 2,542 格']] }
    }, { describe: () => ({ unit: '格' }) }))
    vmOf(w).onLabelConfirm([{ label: '创显', records: recs(3) }])
    await flushPromises()
    expect(w.find('.irc h4').text()).toBe('导进去 6,907 格')
    expect(w.findAll('.irc-stat').map(s => s.text())).toEqual(['1段', '6,907格导进去'])
    expect(w.find('.irc-p').text()).toBe('创显都在库里了。')
    expect(w.find('.irc-meta').text(), '刷新成了不另写').toBe('用时 0:00')
    expect(w.find('.irc-kv').text()).toBe('创显830 科目 · 2,542 格')
    expect(w.findAll('.fpimp-f button').map(b => b.text())).toEqual(['完成'])
    await btn(w, '完成')!.trigger('click')
    expect(w.emitted('close')).toHaveLength(1)
  })

  // 破坏验证:去掉 path 的 pathLength="1" 或动画的 both → 红(减少动态时勾要停在画完,不能停在起始帧)
  it('❗勾一笔画出:pathLength=1 + dashoffset,320ms(--dur-slow),both', () => {
    const card = readFileSync(join(__dirname, '..', 'ImportResultCard.vue'), 'utf8')
    expect(card).toMatch(/<path d="M20 6 9 17l-5-5" pathLength="1" \/>/)
    expect(card).toMatch(/\.irc-ok path \{[^}]*stroke-dasharray:1;[^}]*stroke-dashoffset:1;[^}]*animation:irc-draw var\(--dur-slow\) var\(--ease-out\) var\(--dur-fast\) both;/)
    expect(card).toMatch(/@keyframes irc-draw \{ from \{ stroke-dashoffset:1; \} to \{ stroke-dashoffset:0; \} \}/)
  })

  it('❗有没导的(md-v2-done):两块数(导进去 / 没导)+ 没导的行逐条列出(不折叠)+ 怎么补;导入中心来的多「去 X 看」', async () => {
    const res: ImportOutcome = {
      imported: 1646, skipped: 2, refreshed: true,
      errors: [{ rowIndex: 36, label: '', reason: '租户名称为空' }, { rowIndex: 411, label: '广联', reason: '同名已跳过' }],
      notices: [{ rowIndex: -1, label: '未绑定租户', reason: '3 个账面名未匹配租户档案' }],
    }
    const w = track(mountModal(async () => res, { go: '去光伏分栋抄表看', doneNote: '从导入中心导入' }))
    vmOf(w).onLabelConfirm([{ label: 'x', records: recs(1648) }])
    await flushPromises()
    expect(w.find('.irc h4').text()).toBe('导进去 1,646 行')
    expect(w.findAll('.irc-stat').map(s => s.text())).toEqual(['1,646行导进去', '2行没导'])
    expect(w.findAll('.irc-stat')[1].classes()).toContain('warn')
    expect(w.find('.irc-meta').text()).toContain('从导入中心导入')
    expect(w.find('.irc-st').text()).toBe('没导的 2 行')
    // 后端报的是发出去的第几条,不冒充文件行号(核对页导不了的才写「第 N 行」)
    expect(w.findAll('.irc-errs li').map(li => li.text())).toEqual(['第 37 条（空）租户名称为空', '第 412 条广联同名已跳过'])
    expect(w.find('.irc-p').text()).toBe('改好这 2 行后单独再导就行；已经导进去的 1,646 行再导也只是用新数盖掉，不会多出来。')
    expect(w.findAll('.irc-toggle').map(t => t.text()), '提示照旧可展开,默认收起').toEqual(['1 条提示（已导入，仅需知会）'])
    await w.findAll('.irc-toggle')[0].trigger('click')
    expect(w.findAll('.irc-list')[0].text(), 'rowIndex -1 的提示不写「第 0 行」').not.toContain('第 0 行')
    expect(w.findAll('.fpimp-f button').map(b => b.text())).toEqual(['去光伏分栋抄表看', '完成'])
    await btn(w, '去光伏分栋抄表看')!.trigger('click')
    expect(w.emitted('go')).toHaveLength(1)
  })

  // 破坏验证:doneNoteText 写死「本页」→ 红
  it('刷新没成:右上跟最后一步的名字走写「本期没刷新上」', async () => {
    const w = track(mountModal(async () => ({ ...OK(3), refreshed: false }), {
      describe: () => ({ unit: '格', steps: ['读取工作簿', '核对公司', '写入 3 格', '记下这次导入', '刷新本期'] }),
    }))
    vmOf(w).onLabelConfirm([{ label: 'x', records: recs(3) }])
    await flushPromises()
    expect(w.find('.irc-meta').text()).toBe('用时 0:00 · 本期没刷新上')
  })

  // 破坏验证:doneNoteText 不看 refreshed → 红
  it('刷新没成:导入照样算完成,右上照实写「本页没刷新上」', async () => {
    const w = track(mountModal(async () => ({ ...OK(3), refreshed: false })))
    vmOf(w).onLabelConfirm([{ label: 'x', records: recs(3) }])
    await flushPromises()
    expect(w.find('.irc-meta').text()).toContain('本页没刷新上')
  })
})

describe('失败 · 进度条先变红再换失败卡(动效板 ④)', () => {
  // 破坏验证:runFrom 的 catch 里去掉 failing / 200ms 等待 → 「进度条先红、失败卡还没换上」红
  it('❗进度卡在屏上时:进度条变红 200ms,再换失败卡;卡还没出来就失败的直接换', async () => {
    const d = deferred<ImportOutcome>()
    const w = track(mountModal(() => d.promise))
    vmOf(w).onLabelConfirm([{ label: 'x', records: recs(3) }])
    await vi.advanceTimersByTimeAsync(200)
    d.reject({ code: 500, message: '服务器内部错误' })
    await flushPromises()
    expect(w.find('.ipc-bar').classes()).toContain('bad')
    expect(w.find('.ipf').exists()).toBe(false)
    expect(w.findAll('.fpimp-f button').map(b => b.text()), '这 200ms 里还是导入中').toEqual(['导入中…'])
    await vi.advanceTimersByTimeAsync(200)
    expect(w.find('.ipf').exists()).toBe(true)
    expect(w.findAll('.fpimp-f button').map(b => b.text())).toEqual(['关闭', '返回修改'])
  })
})

describe('失败 · 逐段接着导(真 registry s10 run)', () => {
  const lost = () => Object.assign(new Error('Network Error'), { isAxiosError: true, response: undefined })
  // 破坏验证:registry s10 run 的循环起点改回 0(不认 _run.from)→ 请求序列变 [1,2,3,1,2,3] 红;
  //          canResume 去掉 kind !== 'reject' 判断 → 4xx 那条出「接着导」红
  // 破坏验证:failLine / h4 / 段列表不分 lost(恒写「没导进去」「都没有写」「没写」)→ 三条断言红;
  //          written 改回按发出条数累计 → 「前 1 段 1 条」变 2 条红
  it('❗网络断在第 2 段:没回应的那段不说「没写」;前面按回包写入数;「从第 2 段接着导」续发从第 2 段开始,前面不重发', async () => {
    const sent: number[] = []
    let failOnce = true
    vi.mocked(s10Api.importRows).mockImplementation(async (req) => {
      sent.push(req.phase)
      if (req.phase === 2 && failOnce) { failOnce = false; throw lost() }
      // 第 1 段 2 条里 1 条被后端跳过(同名行等)
      return req.phase === 1 ? { imported: 1, skipped: 1, errors: [] } : { imported: req.rows.length, skipped: 0, errors: [] }
    })
    const w = track(mountModal((payload, fn, p) => runImport('s10', payload, { _run: p }, fn).then(r => r.res), { segmented: true }))
    vmOf(w).onSectionsConfirm(PICKS)
    await flushPromises()
    expect(sent).toEqual([1, 2])
    expect(w.find('.ipf-h h4').text()).toBe('第 2 段（2025年2月 二期）没等到服务器的结果')
    expect(w.find('.ipf-line').text()).toBe('2025年1月 一期已经在库里了；2025年2月 二期写没写进去，以本页刷新后看到的为准；接着导只从2025年2月 二期开始，不会重复。')
    expect(w.find('.ipf-box').text()).toBe('原因请求发出后没有回应')
    expect(w.findAll('.ipf .ipc-segs li').map(li => li.text())).toEqual([
      '2025年1月 一期2 行已导进去', '2025年2月 二期3 行没等到结果', '2025年3月 宿舍5 行没开始',
    ])
    // 一段一条导入记录:断之前写进去的第 1 段照记,没回应的那段不记(不是被拒)
    const logged = () => vi.mocked(importLogApi.record).mock.calls.map(c => [c[0].zone, c[0].ok])
    expect(logged(), '断之前写进去的段照记').toEqual([['1', 1]])

    await btn(w, '从第 2 段接着导')!.trigger('click')
    await flushPromises()
    expect(sent, '续发从第 2 段开始,第 1 段不重发').toEqual([1, 2, 2, 4])
    expect(w.findAll('.irc-stat b')[0].text(), '总数含接着导之前写进去的那段').toBe('9')
    expect(logged(), '接着导只记这次写进去的段,第 1 段不重记').toEqual([['1', 1], ['2', 3], ['4', 5]])
  })

  it('❗4xx(审核闸)整单拒:不给接着导,「返回修改」回到核对页;新建的东西留下时多一句', async () => {
    const w = track(mountModal(async (_pl, _f, p) => {
      p.kept('新建的 2 家公司已留下')
      throw { code: 423, message: '2025-10 科目余额表 已审核(李审 2025-11-03),撤销审核后才能修改' }
    }, { describe: () => ({ unit: '格' }) }))
    vmOf(w).onLabelConfirm([{ label: 'x', records: recs(3) }])
    await flushPromises()
    expect(w.find('.ipf-h h4').text()).toBe('导入失败，这次一格都没写进去')
    expect(w.find('.ipf-box').text()).toBe('原因2025-10 科目余额表 已审核(李审 2025-11-03),撤销审核后才能修改')
    expect(w.findAll('.ipf-line').map(p => p.text())).toEqual(['本期还是导入前的数据。', '新建的 2 家公司已留下'])
    expect(w.findAll('.fpimp-f button').map(b => b.text())).toEqual(['关闭', '返回修改'])
    await btn(w, '返回修改')!.trigger('click')
    expect(w.find('.ipf').exists()).toBe(false)
    expect((w.find('.fpimp-check').element as HTMLElement).style.display).toBe('')
  })

  it('❗逐段里第 2 段吃了 4xx:照实写前面已写入,但不给接着导,只给「返回修改」', async () => {
    vi.mocked(s10Api.importRows).mockImplementation(async (req) => {
      if (req.phase === 2) throw { code: 423, message: '该表本月已审核或待审核，不能修改' }
      return { imported: req.rows.length, skipped: 0, errors: [] }
    })
    const w = track(mountModal((payload, fn, p) => runImport('s10', payload, { _run: p }, fn).then(r => r.res), { segmented: true }))
    vmOf(w).onSectionsConfirm(PICKS)
    await flushPromises()
    expect(w.find('.ipf-h h4').text()).toBe('第 2 段（2025年2月 二期）没导进去')
    expect(w.find('.ipf-line').text()).toBe('2025年1月 一期已经在库里了；2025年2月 二期和后面的段都没写。')
    expect(w.findAll('.fpimp-f button').map(b => b.text())).toEqual(['关闭', '返回修改'])
  })

  it('逐段 5xx 也能接着导;断在第 1 段不写「前 0 段」', async () => {
    const w = track(mountModal(async () => { throw { code: 500, message: '服务器内部错误' } }, { segmented: true }))
    vmOf(w).onSectionsConfirm(PICKS)
    await flushPromises()
    expect(w.find('.ipf-line').text()).toBe('接着导只从2025年1月 一期开始，不会重复。')
    expect(btn(w, '从第 1 段接着导')).toBeTruthy()
  })
})

describe('失败 · 一次传的数据太多(nginx 413,真 registry meter run + 真 http 拦截器)', () => {
  // 用户 2026-10-05:「抄表整册导入被拒：超过 1MB 就被服务器挡掉，没有分批导入的办法」。
  // adapter 照 nginx 的样子回 413:HTML 体、不带信封,拦截器原样抛 AxiosError。
  // 破坏验证:failReason 去掉 413 那一支 → 「原因」那句变成 4xx 那句(没有接受这次导入)红
  const adapter = http.defaults.adapter
  const urls: string[] = []
  const nginxSays = (status: number, statusText: string) => {
    http.defaults.adapter = async (config) => {
      urls.push(config.url ?? '')
      throw new AxiosError(`Request failed with status code ${status}`, AxiosError.ERR_BAD_REQUEST, config, {}, {
        status, statusText, headers: {}, config,
        data: `<html><head><title>${status} ${statusText}</title></head></html>`,
      })
    }
  }
  afterEach(() => { http.defaults.adapter = adapter; urls.length = 0 })
  const meterRun = () => {
    const w = track(mountModal((payload, fn, p) => runImport('meter', payload, { _run: p }, fn).then(r => r.res)))
    vmOf(w).onLabelConfirm([{ label: '一期电 · 2024年2月', records: recs(3) }])
    return w
  }

  it('❗抄表整册被 413 挡掉:失败卡说一次传不上去、怎么分几次导;「返回修改」回到核对页', async () => {
    nginxSays(413, 'Request Entity Too Large')
    const w = meterRun()
    await flushPromises()
    expect(urls, '走的是抄表导入那一个请求').toEqual(['/meters/import'])
    expect(w.find('.ipf-h h4').text()).toBe('导入失败，这次一行都没写进去')
    expect(w.find('.ipf-box').text()).toBe('原因数据太多，一次传不上去。请分几次导入：点「返回修改」，核对那一步能勾选的话先勾一部分导，剩下的再导一次；不能勾选就把文件拆成几份，一份一份导。')
    expect(w.findAll('.fpimp-f button').map(b => b.text())).toEqual(['关闭', '返回修改'])
    expect(importLogApi.record, '没写进去不记导入记录').not.toHaveBeenCalled()
    await btn(w, '返回修改')!.trigger('click')
    expect(w.find('.ipf').exists()).toBe(false)
    expect((w.find('.fpimp-check').element as HTMLElement).style.display).toBe('')
  })

  // 复查 F2:nginx 等后端等过了点回 504,后端那头跑完照样提交。原来按 5xx 写「这次一条都没写进去」「本期还是导入前的数据」,
  // 人信了会再导一遍、或照着错的样子做事。破坏验证:failKind 去掉 504 那一支 → 标题变回「一条都没写进去」红
  it('❗等后端等过了点(nginx 504):不说一条都没写进去,说没等到结果、以刷新后看到的为准', async () => {
    nginxSays(504, 'Gateway Time-out')
    const w = meterRun()
    // 5xx 时拦截器先动态 import ui store 报全局提示,比 flushPromises 多走几拍
    await vi.waitFor(() => expect(w.find('.ipf').exists()).toBe(true))
    expect(urls).toEqual(['/meters/import'])
    expect(w.find('.ipf-h h4').text()).toBe('导入失败，没等到服务器的结果')
    expect(w.find('.ipf').text()).toContain('这次写没写进去，以本页刷新后看到的为准。')
    expect(w.find('.ipf').text()).not.toContain('一条都没写进去')
    expect(w.find('.ipf').text()).not.toContain('导入前的数据')
    // 复查 F1:原因框原来印「服务器返回 504」。破坏验证:failReason 去掉 504 那一支 → 变成 5xx 那句红
    expect(w.find('.ipf-box').text()).toBe('原因等了很久服务器还没回话，它可能还在写入，请过几分钟刷新本页看结果')
  })

  // 复查 F2:原因框原来只印「服务器返回 502」。破坏验证:failReason 的 5xx 那支改回带状态码 → 红
  it('其余 5xx:原因框不印状态码,照 md-v2-fail 写「服务器出错，请稍后重试」', async () => {
    nginxSays(502, 'Bad Gateway')
    const w = meterRun()
    await vi.waitFor(() => expect(w.find('.ipf').exists()).toBe(true))
    expect(w.find('.ipf-h h4').text()).toBe('导入失败，这次一行都没写进去')
    expect(w.find('.ipf-box').text()).toBe('原因服务器出错，请稍后重试')
  })

  // 破坏验证:failReason 最后一支改回带状态码 → 红
  it('nginx 自己回的 4xx(不带信封):原因框不印状态码,说没有接受这次导入', async () => {
    nginxSays(404, 'Not Found')
    const w = meterRun()
    await flushPromises()
    expect(w.find('.ipf-box').text()).toBe('原因服务器没有接受这次导入，请刷新页面后再试，还不行请联系管理员')
  })
})

describe('失败 · 整单拒时新建的公司已留下(真 registry report_tb run)', () => {
  const tbRun = (): Runner => (payload, fn, p) => runImport('report_tb', payload, { year: 2025, month: 10, _run: p }, fn).then(r => r.res)
  const THREE = [{ label: '创显', records: [] }, { label: '一泽', records: [] }, { label: 'B2', records: [] }]
  beforeEach(() => {
    vi.mocked(companyApi.list).mockResolvedValue([{ id: 1, name: '创显' }] as never)
    vi.mocked(companyApi.create).mockImplementation(async (name: string) => ({ id: 9, name }) as never)
    vi.mocked(reportApi.import).mockRejectedValue({ code: 423, message: '2025-10 科目余额表 已审核' })
  })
  // 破坏验证:keptOnFail 里不调 kept → 红;made++ 删掉 → 「2 家」那条红
  it('❗开跑前新建了 2 家公司、写入被审核闸整单拒:失败卡多一句「新建的 2 家公司已留下」', async () => {
    const w = track(mountModal(tbRun(), { describe: () => ({ unit: '格' }) }))
    vmOf(w).onLabelConfirm(THREE)
    await flushPromises()
    expect(companyApi.create).toHaveBeenCalledTimes(2)
    expect(w.findAll('.ipf-line').map(p => p.text())).toEqual(['本期还是导入前的数据。', '新建的 2 家公司已留下'])
  })
  it('一家都没新建:不多那一句', async () => {
    const w = track(mountModal(tbRun()))
    vmOf(w).onLabelConfirm([{ label: '创显', records: [] }])
    await flushPromises()
    expect(w.findAll('.ipf-line').map(p => p.text())).toEqual(['本期还是导入前的数据。'])
  })
})

describe('步骤走到「记下这次导入」(真 registry runImport)', () => {
  // 破坏验证:runImport 里删掉 ctx._run?.recording() → 红(写完了还停在「写入」那步)
  it('❗写完、记导入记录那段时间,步骤停在倒数第二步(五步表也对)', async () => {
    vi.mocked(companyApi.list).mockResolvedValue([{ id: 1, name: '创显' }] as never)
    vi.mocked(reportApi.import).mockResolvedValue({ imported: 6907, skipped: 0, errors: [] } as never)
    const rec = deferred<void>()
    vi.mocked(importLogApi.record).mockImplementationOnce(() => rec.promise as never)
    const w = track(mountModal((payload, fn, p) => runImport('report_tb', payload, { year: 2025, month: 10, _run: p }, fn).then(r => r.res), {
      describe: () => ({ unit: '格', steps: ['读取工作簿', '核对公司', '写入 6,907 格', '记下这次导入', '刷新本期'] }),
    }))
    vmOf(w).onLabelConfirm([{ label: '创显', records: [] }])
    await vi.advanceTimersByTimeAsync(300)
    expect(w.findAll('.ipc-steps li').map(li => li.classes()[0])).toEqual(['done', 'done', 'done', 'now', 'todo'])
    // 破坏验证:keptOnFail 里删掉 note('核对公司', …) → 红
    expect(w.findAll('.ipc-steps li em').map(e => e.text())).toEqual(['', '新建 0 家', '', '', ''])
    rec.resolve(); await flushPromises()
  })
})

describe('导入中关不掉', () => {
  // 破坏验证:tryClose 去掉 busy 判断 → ×/遮罩两条红;watch(busy) 不挂 beforeunload → 「导入中拦浏览器关页」红;
  //          加一条不看 busy 的 window Esc → emit close → Esc 那条红
  it('❗×、遮罩、Esc 都不关;× 悬停说明「导入完成前不能关闭」;beforeunload 只在导入中拦', async () => {
    const d = deferred<ImportOutcome>()
    const w = track(mountModal(() => d.promise))
    const unload = () => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented }
    expect(unload(), '没在导入不拦').toBe(false)
    vmOf(w).onLabelConfirm([{ label: 'x', records: recs(3) }])
    await vi.advanceTimersByTimeAsync(300)
    const x = w.find('.fpimp-x')
    await x.trigger('click')
    await w.find('.fpimp-scrim').trigger('mousedown')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(w.emitted('close'), '导入中一条都不该关').toBeUndefined()
    expect((x.element as HTMLElement & { _tip?: { text: string } })._tip?.text).toBe('导入完成前不能关闭')
    expect(x.attributes('aria-disabled')).toBe('true')
    expect(unload(), '导入中关浏览器标签走浏览器确认').toBe(true)
    // 破坏验证:不挂捕获阶段的 Ctrl+K 拦截 → 红(命令面板在遮罩下面也能开、能跳页)
    const palette = vi.fn()
    window.addEventListener('keydown', palette)
    const ctrlK = () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, cancelable: true }))
    ctrlK()
    expect(palette, '导入中 Ctrl+K 不开命令面板').not.toHaveBeenCalled()

    d.resolve(OK(3)); await flushPromises()
    expect(unload(), '导完就不拦了').toBe(false)
    ctrlK()
    expect(palette, '导完 Ctrl+K 照常').toHaveBeenCalledTimes(1)
    window.removeEventListener('keydown', palette)
    expect((x.element as HTMLElement & { _tip?: { text: string } })._tip, '导完 × 不再挂说明').toBeUndefined()
    await x.trigger('click')
    expect(w.emitted('close')).toHaveLength(1)
  })
})

describe('失败 · 一次导入发多次请求,后面那次失败(真 registry run)', () => {
  // 破坏验证:registry salary run 删掉 ctx._run?.wrote(...) → h4 回到「一条都没写进去」红;
  //          ImportProgressCard 去掉 wrote > 0 那条 h4 / 行 → 红
  it('❗附表12 逐月:8 月写进去了、9 月被审核闸拒 —— 不写「一条都没写进去」「本期还是导入前的数据」', async () => {
    vi.mocked(salaryApi.importRows)
      .mockResolvedValueOnce({ imported: 2, skipped: 0, errors: [] })
      .mockRejectedValueOnce({ code: 409, message: '2025-09 工资 已审核,撤销审核后才能修改' })
    const w = track(mountModal((payload, fn, p) => runImport('salary', payload, { year: 2025, month: 8, _run: p }, fn).then(r => r.res)))
    vmOf(w).onSectionsConfirm([{ year: 2025, month: 8, records: recs(2) }, { year: 2025, month: 9, records: recs(3) }])
    await flushPromises()
    expect(salaryApi.importRows).toHaveBeenCalledTimes(2)
    expect(w.find('.ipf-h h4').text()).toBe('导入没做完，前面已写入 2 行')
    expect(w.findAll('.ipf-line').map(p => p.text())).toEqual(['已写入的留在库里，出错那一次和后面的都没写。'])
    expect(w.findAll('.fpimp-f button').map(b => b.text())).toEqual(['关闭', '返回修改'])
  })

  // 破坏验证:registry office_13 run 删掉 ctx._run?.wrote(...) → 红
  it('附表13 逐年:2024 年写进去了、2025 年被拒 —— 同样照实写', async () => {
    vi.mocked(utilitiesApi.importRows)
      .mockResolvedValueOnce({ imported: 1, skipped: 0, errors: [] })
      .mockRejectedValueOnce({ code: 409, message: '2025-01 办公水电 已审核' })
    const w = track(mountModal((payload, fn, p) => runImport('office_13', payload, { _run: p }, fn).then(r => r.res)))
    // 平铺记录走核对页的主按钮:直接喂解析结果
    ;(w.vm as unknown as { applyResult: (r: { records: unknown[] }) => void }).applyResult({ records: [   // 解析时已认出月份(registry office customParse)
      { tenantName: '2024-01', acctMonth: '2024-01', belongMonth: '2024-01' }, { tenantName: '2025-01', acctMonth: '2025-01', belongMonth: '2025-01' }] })
    await flushPromises()
    await btn(w, '导入 2 行')!.trigger('click')
    await flushPromises()
    expect(utilitiesApi.importRows).toHaveBeenCalledTimes(2)
    expect(w.find('.ipf-h h4').text()).toBe('导入没做完，前面已写入 1 行')
  })

  // 破坏验证:ledger 逐公司 run 里删掉 made++ → 「新建的 1 家」那句不出 → 红;删掉 wrote → h4 红
  it('❗台账整册逐公司:第 2 家被拒时第 1 家已写入、自动新建的公司留下,两句都照实写', async () => {
    vi.mocked(companyApi.list).mockResolvedValue([{ id: 1, name: '创显' }] as never)
    vi.mocked(companyApi.create).mockImplementation(async (name: string) => ({ id: 9, name }) as never)
    vi.mocked(ledgerApi.import)
      .mockResolvedValueOnce({ imported: 4, skipped: 0, errors: [] })
      .mockRejectedValueOnce({ code: 423, message: '2025-10 台账 已审核' })
    const w = track(mountModal((payload, fn, p) => runImport('ledger', payload, { companyId: 1, year: 2025, month: 10, _run: p }, fn).then(r => r.res)))
    vmOf(w).onLabelConfirm([
      { label: '新公司', records: [{ __company: '新公司', name: 'b' }] },
      { label: '创显', records: [{ __company: '创显', name: 'a' }] },
    ])
    await flushPromises()
    expect(companyApi.create).toHaveBeenCalledTimes(1)
    expect(w.find('.ipf-h h4').text()).toBe('导入没做完，前面已写入 4 行')
    expect(w.findAll('.ipf-line').map(p => p.text())).toEqual(['已写入的留在库里，出错那一次和后面的都没写。', '新建的 1 家公司已留下'])
  })
})

describe('点导入的那一下', () => {
  // 破坏验证:start 去掉 run / done 判断 → runner 被调两次 → 红
  it('❗连点两下:只跑一次', async () => {
    const runner = vi.fn<Runner>(async () => OK(3))
    const w = track(mountModal(runner))
    vmOf(w).onLabelConfirm([{ label: 'x', records: recs(3) }])
    vmOf(w).onLabelConfirm([{ label: 'x', records: recs(3) }])
    await flushPromises()
    expect(runner).toHaveBeenCalledTimes(1)
    expect(w.find('.irc h4').text()).toBe('导进去 3 行')
  })

  // 破坏验证:runFrom 删掉 if (!res) { phase.value = 'check'; return } → 停在 done、没有核对页 → 红
  it('❗runner 返回 null(屏写口自守,已退出编辑):弹窗回到核对页,不出结果卡', async () => {
    const w = track(mountModal(async () => null))
    vmOf(w).onLabelConfirm([{ label: 'x', records: recs(3) }])
    await flushPromises()
    expect(w.find('.irc').exists()).toBe(false)
    expect(w.find('.ipc').exists()).toBe(false)
    expect((w.find('.fpimp-check').element as HTMLElement).style.display).toBe('')
    expect(w.findAll('.fpimp-f button').map(b => b.text())).not.toContain('完成')
    expect(importBusy.value).toBe(0)
  })
})

describe('导入中屏收不走(importBusy)', () => {
  // 页签停用时屏把在跑的导入窗留在停用的页里(DOM 摘出文档):别的页签上 Ctrl+K 照常。
  // 破坏验证:onPaletteKey 去掉 isConnected 判断 → 不在文档里的那个也截 → 红
  it('❗不在文档里的导入窗(所在页签已停用)不截别处的 Ctrl+K', async () => {
    const d = deferred<ImportOutcome>()
    const w = track(mount(FpImportModal, { props: { title: '导入', templateCols: ['A'], runner: () => d.promise } }))   // 不 attachTo = 不在文档里
    vmOf(w).onLabelConfirm([{ label: 'x', records: recs(3) }])
    await flushPromises()
    expect(importBusy.value, '前置:在跑').toBe(1)
    const palette = vi.fn()
    window.addEventListener('keydown', palette)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, cancelable: true }))
    window.removeEventListener('keydown', palette)
    expect(palette).toHaveBeenCalledTimes(1)
    d.resolve(OK(3)); await flushPromises()
  })

  // 破坏验证:watch(busy) 不动 importBusy → 「导入中 1」红;onBeforeUnmount 不减 → 「中途卸载归零」红
  it('❗导入中 importBusy 为 1,跑完归 0;中途被卸载也归 0', async () => {
    const d = deferred<ImportOutcome>()
    const w = track(mountModal(() => d.promise))
    expect(importBusy.value).toBe(0)
    vmOf(w).onLabelConfirm([{ label: 'x', records: recs(3) }])
    await flushPromises()
    expect(importBusy.value, '导入中').toBe(1)
    d.resolve(OK(3)); await flushPromises()
    expect(importBusy.value, '跑完').toBe(0)

    const d2 = deferred<ImportOutcome>()
    const w2 = mountModal(() => d2.promise)
    vmOf(w2).onLabelConfirm([{ label: 'x', records: recs(3) }])
    await flushPromises()
    expect(importBusy.value).toBe(1)
    w2.unmount()
    expect(importBusy.value, '中途卸载归零').toBe(0)
    d2.resolve(OK(3)); await flushPromises()
    expect(importBusy.value, '卸载后 runner 才回来也不再动它').toBe(0)
  })
})

// 破坏验证:none 恒为 false → 标题回到「导进去 0 行」、打勾 → 红
describe('结果卡 · 一行都没导进去', () => {
  it('❗不打勾、不写「导进去 0 行」;底句不提「已经导进去的 0 行」', () => {
    const w = mount(ImportResultCard, { props: {
      result: { imported: 0, skipped: 2, errors: [{ rowIndex: 0, label: '1栋', reason: '楼栋不匹配任何电站' }, { rowIndex: 1, label: '2栋', reason: '楼栋不匹配任何电站' }] } as never,
      unit: '行', elapsed: 2, note: '', bad: [{ row: 4, cells: ['二期', '7栋', '9月19'], reason: '日期认不出' }],
    } })
    expect(w.find('.irc-h h4').text()).toBe('一行都没导进去')
    expect(w.find('.irc-ok').exists(), '不打勾').toBe(false)
    expect(w.find('.irc-no').exists()).toBe(true)
    expect(w.text()).not.toContain('已经导进去的')
    expect(w.text()).toContain('改好这 3 行后再导一次就行。')
  })
})
