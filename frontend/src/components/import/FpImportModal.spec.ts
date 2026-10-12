/* Copyright (c) 2026 Junyang. All rights reserved. */
// 导入弹窗 · 选数据 → 核对(md-v2-pick / paste / err / flat / secs / ledger / meter;动效板 ①②)。
// 点导入之后(进度 / 结果 / 失败)在 __tests__/importRunFlow.spec.ts。
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import FpImportModal, { pickSheet, type ImportRec, type ImportPayload } from './FpImportModal.vue'
import type { ImportRunProgress } from './importRun'

const src = readFileSync(join(__dirname, 'FpImportModal.vue'), 'utf8')

// 模板列 + parseRow:租户 + 2 费用列;cells[0]=名(空跳过),cells[1..2]=数字。
const templateCols = ['租户', '厂房租金', '商铺租金']
function parseRow(c: string[]): ImportRec | null {
  const name = (c[0] || '').trim(); if (!name) return null
  const a = Number(c[1]) || 0, b = Number(c[2]) || 0
  return { tenantName: name, factoryRent: a, shopRent: b, __preview: [name, a || '', b || ''] }
}
type W = ReturnType<typeof mount>
const steps = (w: W) => w.findAll('.fpimp-s').map(s => [s.classes().find(c => c !== 'fpimp-s'), s.text()])
const foot = (w: W) => w.findAll('.fpimp-f button').map(b => b.text())
const primary = (w: W) => w.findAll('.fpimp-f button').at(-1)!
/** 「粘贴表格」→ 填字 → paste 事件(jsdom 没有剪贴板:弹窗等框里填好再读) */
async function pasteIn(w: W, text: string) {
  await w.find('.fpimp-drop').findAll('button').find(b => b.text() === '粘贴表格')!.trigger('click')
  await w.find('textarea').setValue(text)
  await w.find('textarea').trigger('paste')
  await flushPromises()
}

afterEach(() => { vi.useRealTimers() })

describe('① 选数据', () => {
  // 破坏验证:三步条 done/now 判断写反 → 红;底栏选数据时多出主按钮 → 红
  it('❗三步条第 1 步当前;底栏只有「取消」;小样表 + 规矩照传进来的写', () => {
    const w = mount(FpImportModal, { props: {
      title: '导入光伏抄表', sub: '各栋光伏每天的发电读数，导进光伏分栋抄表', templateCols: ['A'],
      sample: { head: ['期数', '楼栋', '日期', '发电总量 kWh'], rows: [['一期', '1栋', '2026-09-01', '812.4']] },
      rules: ['同一楼栋同一天再导，用新数盖掉旧数'],
    } })
    expect(w.find('.fpimp-h p').text()).toBe('各栋光伏每天的发电读数，导进光伏分栋抄表')
    expect(steps(w)).toEqual([['now', '1选数据'], ['todo', '2核对'], ['todo', '3导入']])
    expect(foot(w)).toEqual(['取消'])
    expect(w.find('.fpimp-drop .t').text()).toBe('把 Excel 文件拖到这里')
    expect(w.findAll('.fpimp-drop button').map(b => b.text())).toEqual(['选文件', '粘贴表格'])
    expect(w.find('.fpimp-drop .d').text()).toBe('.xlsx 或 .csv；旧版 .xls 先用 Excel 另存为 .xlsx')
    expect(w.find('.fpimp-st').text()).toBe('文件要长这样')
    expect(w.findAll('.sample th').map(t => t.text())).toEqual(['期数', '楼栋', '日期', '发电总量 kWh'])
    expect(w.findAll('.sample th').map(t => t.classes('r')), '数字列靠右').toEqual([false, false, false, true])
    expect(w.findAll('.fpimp-rules li').map(l => l.text())).toEqual(['同一楼栋同一天再导，用新数盖掉旧数'])
    expect(w.text(), '旧版的「模板列顺序」胶囊和「解析粘贴内容」钮都没了').not.toMatch(/模板列顺序|解析粘贴内容/)
  })

  // 动效板「减少动态效果」:转圈换成原地一闪一闪(全局 .page-spin 例外让它照转,这里和进度卡的转圈各顶回一次)
  // 破坏验证:删掉两处 @media 里的那一条 → 红
  it('减少动态效果:粘贴识别、进度卡的转圈换成原地一闪一闪', () => {
    expect(src).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.fpimp-spin \.page-spin \{ animation:fpimp-blink 1\.6s/)
    const card = readFileSync(join(__dirname, 'ImportProgressCard.vue'), 'utf8')
    expect(card).toMatch(/\.ipc-spin\.page-spin \{ animation:ipc-breathe 1\.6s ease-in-out infinite !important;/)
  })

  // 破坏验证:去掉 .fpimp-s i 的 line-height:1 → 红(圈里的数字继承行高偏下 2px)
  it('❗圈里的数字 line-height:1;弹窗 720 × 700 固定', () => {
    expect(src).toMatch(/\.fpimp-s i \{[^}]*line-height:1;/)
    expect(src).toMatch(/\.fpimp \{[^}]*width:min\(720px, 100%\);[^}]*height:min\(700px, 100%\);/)
  })

  it('拖进来描蓝边(瞬间,不过渡)', async () => {
    const w = mount(FpImportModal, { props: { title: '导入', templateCols, parseRow } })
    await w.find('.fpimp-drop').trigger('dragover')
    expect(w.find('.fpimp-drop').classes()).toContain('over')
    expect(src).not.toMatch(/\.fpimp-drop[^{]*\{[^}]*transition/)
    await w.find('.fpimp-drop').trigger('dragleave')
    expect(w.find('.fpimp-drop').classes()).not.toContain('over')
  })

  // 破坏验证:onPaste 不调 recognize(只等按钮)→ 红
  it('❗粘进来就认(paste 事件,不用点按钮):进核对页,步骤条第 2 步,主按钮写「导入 6 行」', async () => {
    const w = mount(FpImportModal, { props: { title: '导入', templateCols, parseRow } })
    // 表头 + 7 数据行(第 4 行租户名空 → 跳过) → 6 条有效
    const lines = ['租户\t厂房租金\t商铺租金']
    for (let i = 1; i <= 7; i++) lines.push(i === 4 ? `\t${i}\t${i}` : `T${i}\t${i * 10}\t${i}`)
    await pasteIn(w, lines.join('\n'))
    expect(steps(w)).toEqual([['done', '选数据'], ['now', '2核对'], ['todo', '3导入']])
    expect(w.find('.fpimp-src').text()).toBe('粘贴的 8 行换一个')
    expect(w.find('.fpimp-sum').text()).toBe('认出 6 行')
    expect(w.findAll('.fill tbody tr').length, '全部行都在表里(表内滚),不是只给前 6 行').toBe(6)
    expect(foot(w)).toEqual(['取消', '导入 6 行'])
  })

  it('点主按钮 emit 剥掉 __preview 的行;粘贴的文件名记「（粘贴）」', async () => {
    const w = mount(FpImportModal, { props: { title: '导入', templateCols, parseRow } })
    await pasteIn(w, '租户\t厂房租金\t商铺租金\nA\t100\t5')
    await primary(w).trigger('click')
    const ev = w.emitted('import')!
    expect(ev[0][0]).toEqual([{ tenantName: 'A', factoryRent: 100, shopRent: 5 }])
    expect(ev[0][1]).toBe('（粘贴）')
  })

  it('先选文件、换一个、再改用粘贴:文件名是「（粘贴）」,不是先前那个文件', async () => {
    const w = mount(FpImportModal, { props: { title: '导入', templateCols, parseRow } })
    const input = w.find('input[type="file"]')
    Object.defineProperty(input.element, 'files', {
      value: [new File(['租户,厂房租金,商铺租金\nF,1,2'], 'book-2023-08.csv', { type: 'text/csv' })],
    })
    await input.trigger('change')
    await vi.waitFor(() => expect(w.find('.fpimp-src .n').exists()).toBe(true))
    expect(w.find('.fpimp-src .n').text()).toBe('book-2023-08.csv')
    await w.findAll('.fpimp-src a').find(a => a.text() === '换一个')!.trigger('click')
    expect(steps(w)[0][0], '换一个 = 回第 1 步').toBe('now')
    await pasteIn(w, '租户\t厂房租金\t商铺租金\nA\t100\t5')
    await primary(w).trigger('click')
    expect(w.emitted('import')![0][1]).toBe('（粘贴）')
  })

  // 破坏验证:recognize 的 200 改成 0 → 「199ms 还没转圈」红;不设 recognizing → 「200ms 出转圈」红
  it('❗认了 200ms 还没完才出转圈「正在识别 N 行…」,认完进核对页', async () => {
    vi.useFakeTimers()
    let done!: () => void
    const customParse = () => new Promise<{ records: ImportRec[] }>(r => { done = () => r({ records: [{ a: 1, __preview: ['x'] }] }) })
    const w = mount(FpImportModal, { props: { title: '导入', templateCols: ['A'], customParse } })
    await w.find('.fpimp-drop').findAll('button')[1].trigger('click')
    await w.find('textarea').setValue('A\n1')
    await w.find('textarea').trigger('paste')
    await vi.advanceTimersByTimeAsync(199)
    expect(w.find('.fpimp-spin').exists()).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(w.find('.fpimp-spin').text()).toBe('正在识别 2 行…')
    done(); await flushPromises()
    expect(w.find('.fpimp-spin').exists()).toBe(false)
    expect(steps(w)[1][0]).toBe('now')
  })

  // 破坏验证:applyResult 出错时不留在第 1 步 / 不换卡 → 红
  it('❗认不出:拖放区换成认不出卡(标题 + 原因 + 重新选文件 / 粘贴表格),小样表还在,停在第 1 步', async () => {
    const w = mount(FpImportModal, { props: { title: '导入', templateCols, parseRow, sample: { head: ['租户'], rows: [] } } })
    await pasteIn(w, '租户\t厂房租金\t商铺租金\n\t1\t2')
    expect(steps(w)[0][0]).toBe('now')
    expect(w.find('.fpimp-drop').exists()).toBe(false)
    expect(w.find('.fpimp-err .t').text()).toBe('表头认不出')
    expect(w.find('.fpimp-err .d').text()).toContain('没有一行能匹配模板列')
    expect(w.findAll('.fpimp-err button').map(b => b.text())).toEqual(['重新选文件', '粘贴表格'])
    expect(w.find('.sample').exists(), '小样表留在原位').toBe(true)
    expect(foot(w)).toEqual(['取消'])
    await w.findAll('.fpimp-err button')[1].trigger('click')
    expect(w.find('.fpimp-err').exists()).toBe(false)
    expect(w.find('textarea').exists()).toBe(true)
  })

  it('.xls 旧格式:认不出卡标题「读不了这个文件」,写另存为', async () => {
    const w = mount(FpImportModal, { props: { title: '导入', templateCols, parseRow } })
    const input = w.find('input[type="file"]')
    Object.defineProperty(input.element, 'files', { value: [new File(['x'], '光伏日报0919.xls')] })
    await input.trigger('change')
    expect(w.find('.fpimp-err .t').text()).toBe('读不了这个文件')
    expect(w.find('.fpimp-err .d').text()).toContain('另存为')
  })

  // 破坏验证:拖放只挂在拖放区、认不出卡上没有(改前那样)→ 第二次拖放那几句红;errLine 不带文件名 → 第一句红
  it('❗认不出卡:改好的文件直接拖到卡上就重新认(浏览器不拿去打开);缺列那句前面带文件名(md-v2-err)', async () => {
    const customParse = vi.fn()
      .mockReturnValueOnce({ error: '没找到「楼栋」和「日期」这两列。对照下面的样子改好表头，再选一次。' })
      .mockReturnValueOnce({ records: [{ a: 1, __preview: ['x'] }] })
    const w = mount(FpImportModal, { props: { title: '导入光伏抄表', templateCols: ['A'], customParse } })
    const drop = (el: Element, name: string) => {
      const ev = new Event('drop', { bubbles: true, cancelable: true })
      Object.defineProperty(ev, 'dataTransfer', { value: { files: [new File(['楼\n1'], name)] } })
      el.dispatchEvent(ev)
      return ev
    }
    drop(w.find('.fpimp-drop').element, '光伏日报0919.csv')
    await vi.waitFor(() => expect(w.find('.fpimp-err').exists()).toBe(true))
    expect(w.find('.fpimp-err .t').text()).toBe('表头认不出')
    expect(w.find('.fpimp-err .d').text()).toBe('光伏日报0919.csv 里没找到「楼栋」和「日期」这两列。对照下面的样子改好表头，再选一次。')
    const ev = drop(w.find('.fpimp-err').element, '光伏日报0919-改好.csv')
    expect(ev.defaultPrevented, '浏览器不拿去打开 / 下载').toBe(true)
    await vi.waitFor(() => expect(steps(w)[1][0]).toBe('now'))
    expect(customParse).toHaveBeenCalledTimes(2)
    expect(w.find('.fpimp-src .n').text()).toBe('光伏日报0919-改好.csv')
  })

  it('读文件就失败(坏文件 / 改了后缀名的 .xls):不印库的英文原句,说怎么办', async () => {
    const customParse = () => { throw new Error("Can't find end of central directory : is this a zip file ?") }
    const w = mount(FpImportModal, { props: { title: '导入', templateCols: ['A'], customParse } })
    await pasteIn(w, 'x')
    expect(w.find('.fpimp-err .t').text()).toBe('读不了这个文件')
    expect(w.find('.fpimp-err .d').text()).toBe('这个文件打不开：可能坏了，或者是改了后缀名的旧版 .xls。用 Excel 打开后另存为 .xlsx，再选一次。')
  })

  it('pickSheet: 正则命中取该 sheet,未命中/未给回退第一个', () => {
    expect(pickSheet(['Sheet1', '利润表', '资产负债表'], /利润表|损益表/)).toBe('利润表')
    expect(pickSheet(['Sheet1', 'Sheet2'], /利润表/)).toBe('Sheet1')
    expect(pickSheet(['Sheet1', 'Sheet2'])).toBe('Sheet1')
  })
})

describe('② 核对 · 平铺', () => {
  const BAD = [
    { row: 10, cells: ['二期', '7栋', '9月19'], reason: '日期认不出' },
    { row: 11, cells: ['二期', '8栋', '2026/9/31'], reason: '没有 9月31日' },
  ]
  const good = (n: number) => Array.from({ length: n }, (_, i) => ({ d: i, __preview: ['一期', `${i + 1}栋`, `2026-09-1${i}`] }))

  // 破坏验证:flatRows 里 bad 放到 records 后面 → 「导不了的排最前」红;不出原因列 → 红
  it('❗导不了的行排最前、淡琥珀底、末列写原因;摘要句 + 琥珀条;主按钮只数能导的', async () => {
    const customParse = () => ({ records: good(9) as ImportRec[], bad: BAD })
    const w = mount(FpImportModal, { props: { title: '导入光伏抄表', templateCols: ['期数', '楼栋', '日期'], customParse } })
    await pasteIn(w, 'x')
    expect(w.find('.fpimp-sum').text()).toBe('认出 11 行：9 行能导，2 行导不了')
    expect(w.find('.fpimp-hint.warn').text()).toBe('这 2 行先放着：可以先导能导的 9 行，改好 Excel 再单独导这 2 行。')
    expect(w.findAll('.fill th').map(t => t.text())).toEqual(['期数', '楼栋', '日期', '导不了的原因'])
    const rows = w.findAll('.fill tbody tr')
    expect(rows.length).toBe(11)
    expect(rows.slice(0, 3).map(r => r.classes('bad'))).toEqual([true, true, false])
    expect(rows[0].findAll('td').map(t => t.text())).toEqual(['二期', '7栋', '9月19', '日期认不出'])
    expect(rows[1].find('.fpimp-why').text()).toBe('没有 9月31日')
    expect(foot(w)).toEqual(['取消', '导入 9 行'])
  })

  it('一行都导不了:照样进核对页把原因列出来,主按钮灰', async () => {
    const customParse = () => ({ records: [] as ImportRec[], bad: BAD })
    const w = mount(FpImportModal, { props: { title: '导入', templateCols: ['期数', '楼栋', '日期'], customParse } })
    await pasteIn(w, 'x')
    expect(w.find('.fpimp-sum').text()).toBe('认出 2 行：0 行能导，2 行导不了')
    expect(w.find('.fpimp-hint.warn').text(), '不写「先导能导的 0 行」').toBe('这 2 行都导不了：照下面写的原因改好 Excel，再选一次。')
    expect(primary(w).attributes('disabled')).toBeDefined()
  })

  it('解析带 warning:核对页出琥珀条,照样能导', async () => {
    const customParse = () => ({ records: [{ a: 1, __preview: ['x'] }] as ImportRec[], warning: '发生额与系统推算差 3 元' })
    const w = mount(FpImportModal, { props: { title: '导入', templateCols: ['A'], customParse } })
    await pasteIn(w, 'A\n1')
    expect(w.find('.fpimp-hint.warn').text()).toBe('发生额与系统推算差 3 元')
    expect(primary(w).attributes('disabled')).toBeUndefined()
  })

  it('核对页导不了的行数交给 runner(p.bad,记进导入记录的「要核对」)', async () => {
    let got: ImportRunProgress | undefined
    const runner = vi.fn(async (_p: ImportPayload, _f: string, p: ImportRunProgress) => { got = p; return { imported: 9, skipped: 0, errors: [] } })
    const w = mount(FpImportModal, { props: { title: '导入', templateCols: ['期数', '楼栋', '日期'], customParse: () => ({ records: good(9) as ImportRec[], bad: BAD }), runner } })
    await pasteIn(w, 'x')
    await primary(w).trigger('click'); await flushPromises()
    expect(got?.bad).toBe(2)
  })
})

describe('② 核对 · 台账(precheck)', () => {
  const recs = (n: number) => Array.from({ length: n }, (_, i) => ({ tenantName: `户${i}`, __preview: [`户${i}`] }))
  /** 屏上选的是 2026-09 水电;文件标题 2026-08;9 月已有 36 家、8 月已有 2 家 */
  const precheck = vi.fn(async (_p: { records?: ImportRec[] }, ym?: string) =>
    ({ fileYm: '2026-08', existing: ym === '2026-08' ? 2 : 36, ym: ym ?? '2026-09', company: '水电' }))
  const mountLedger = (runner?: (p: ImportPayload, f: string, x: ImportRunProgress) => Promise<null>) =>
    mount(FpImportModal, { props: { title: '导入月度台账', templateCols: ['租户'], unit: '家', customParse: () => ({ records: recs(36) }), precheck, runner } })

  // 破坏验证:canGo 去掉 needChoice → 「二选一前主按钮灰」红;choose 不重查 → 「覆盖 2 家」红
  it('❗月份对不上:两颗钮二选一,选之前主按钮灰、左边写「先选导到哪个月」;本月已有 → 写会盖掉几家', async () => {
    precheck.mockClear()
    const w = mountLedger()
    await pasteIn(w, 'x')
    expect(w.find('.fpimp-target').text()).toBe('导到 2026年9月 · 水电')
    expect(w.find('.fpimp-target a').exists(), '没给 retarget 不出「改」').toBe(false)
    const hints = w.findAll('.fpimp-hint.warn')
    expect(hints[0].text()).toMatch(/^文件标题写的是 2026年8月，和要导到的 9月不一样。导到哪个月？/)
    expect(hints[0].findAll('.fpimp-choice .o').map(b => b.text())).toEqual(['导到 9月（照现在选的）', '改成导到 8月'])
    // 36 = 文件里的租户中这个月已有台账的家数(不是这个月一共几家)
    expect(hints[1].text()).toBe('文件里有 36 家在 9月水电的台账里已经有了。导进去会用文件里的数盖掉这 36 家；文件里没有的列不动。')
    expect(w.find('.fpimp-sum').text()).toBe('认出 36 家')
    expect(w.find('.fpimp-fn').text()).toBe('先选导到哪个月')
    expect(primary(w).text()).toBe('覆盖 36 家并导入')
    expect(primary(w).attributes('disabled'), '二选一之前不能导').toBeDefined()

    await w.findAll('.fpimp-choice .o')[1].trigger('click'); await flushPromises()
    expect(precheck.mock.calls.at(-1)![1], '改成 8 月:按 8 月重查').toBe('2026-08')
    expect(w.find('.fpimp-target').text()).toBe('导到 2026年8月 · 水电')
    expect(w.find('.fpimp-fn').exists()).toBe(false)
    expect(primary(w).text()).toBe('覆盖 2 家并导入')
    expect(primary(w).attributes('disabled')).toBeUndefined()
  })

  it('选了文件里的月:runner 拿到 p.ym;选「照现在选的」不给 ym', async () => {
    const seen: (string | undefined)[] = []
    const runner = vi.fn(async (_p: ImportPayload, _f: string, x: ImportRunProgress) => { seen.push(x.ym); return null })
    const w = mountLedger(runner)
    await pasteIn(w, 'x')
    await w.findAll('.fpimp-choice .o')[1].trigger('click'); await flushPromises()
    await primary(w).trigger('click'); await flushPromises()
    await w.findAll('.fpimp-choice .o')[0].trigger('click'); await flushPromises()
    await primary(w).trigger('click'); await flushPromises()
    expect(seen).toEqual(['2026-08', undefined])
  })

  it('月份对得上、本月没有:两条琥珀条都不出,按钮「导入 N 家」', async () => {
    const w = mount(FpImportModal, { props: { title: '导入月度台账', templateCols: ['租户'], unit: '家',
      customParse: () => ({ records: recs(3) }), precheck: async () => ({ fileYm: '2026-09', existing: 0, ym: '2026-09', company: '水电' }) } })
    await pasteIn(w, 'x')
    expect(w.findAll('.fpimp-hint.warn')).toHaveLength(0)
    expect(primary(w).text()).toBe('导入 3 家')
    expect(primary(w).attributes('disabled')).toBeUndefined()
  })

  it('分段台账(多 sheet):不预检,两条都不出', async () => {
    const pc = vi.fn()
    const w = mount(FpImportModal, { props: { title: '导入月度台账', templateCols: ['租户'], unit: '家',
      customParse: () => ({ sections: [{ label: '甲 · 2026年9月', records: recs(2) }, { label: '乙 · 2026年9月', records: recs(1) }] }), precheck: pc } })
    await pasteIn(w, 'x')
    expect(pc).not.toHaveBeenCalled()
    expect(w.find('.fpimp-target').exists()).toBe(false)
    expect(primary(w).text()).toBe('导入 2 段 · 3 家')
  })
})

describe('② 核对 · 园区抄表补问', () => {
  const picker = { ym: '2026-09', zone: 'p1', kind: 'elec', zones: [{ value: 'p1', label: '一期' }, { value: 'p2', label: '二期' }], kinds: [{ value: 'elec', label: '电表' }, { value: 'water', label: '水表' }] }
  const recs = [{ a: 1, __preview: ['1栋'] }] as ImportRec[]

  // 破坏验证:补问框的 v-if 改回看 notice、不看 ask → 「不带 ask 不出」红;askLine 写死 → 红
  it('❗粘的这块没有标题(ask 三项):出蓝底问题框,三项预填;改月份按新值重认', async () => {
    const parseWorkbook = vi.fn((_s: unknown, fb?: { ym: string }) => ({ records: recs, ask: ['ym', 'zone', 'kind'], notice: `按 ${fb?.ym}` }))
    const w = mount(FpImportModal, { props: { title: '导入园区抄表', templateCols: ['楼栋'], unit: '块表', parseWorkbook, fallbackPicker: picker } })
    await pasteIn(w, 'A\t1')
    expect(parseWorkbook.mock.calls[0][0]).toEqual([{ name: '', matrix: [['A', '1']] }])
    expect(parseWorkbook.mock.calls[0][1]).toEqual({ ym: '2026-09', zone: 'p1', kind: 'elec' })
    expect(w.find('.fpimp-ask .q').text()).toBe('粘的这块没有标题，看不出是哪个月、哪个区、电表还是水表。选一下：')
    const labels = w.findAll('.fpimp-ask label')
    expect(labels.map(l => l.text().slice(0, l.text().startsWith('电表还是水表') ? 6 : l.text().startsWith('月份') ? 2 : 1))).toEqual(['月份', '区', '电表还是水表'])
    expect(labels[0].text(), '月份预填').toContain('2026')
    expect(labels.slice(1).map(l => l.find('.ds-sel-trigger').text()), '区、表类预填').toEqual(['一期', '电表'])
    expect(w.find('.fpimp-sum').text()).toBe('认出 1 块表')
    expect(primary(w).text()).toBe('导入 1 块表')
    await w.find('.fpimp-ask .dp-box').trigger('click')
    await w.find('.fpimp-ask [data-k="2026-08"]').trigger('click')
    await flushPromises()
    expect(parseWorkbook.mock.calls.at(-1)![1]).toMatchObject({ ym: '2026-08' })
  })

  it('标题只缺区:问题框只问哪个区', async () => {
    const parseWorkbook = () => ({ records: recs, ask: ['zone'] })
    const w = mount(FpImportModal, { props: { title: '导入园区抄表', templateCols: ['楼栋'], parseWorkbook, fallbackPicker: picker } })
    await pasteIn(w, 'A\t1')
    expect(w.find('.fpimp-ask .q').text()).toBe('标题里看不出是哪个区。选一下：')
  })

  it('标题齐全(不带 ask):不出问题框', async () => {
    const parseWorkbook = () => ({ records: recs })
    const w = mount(FpImportModal, { props: { title: '导入园区抄表', templateCols: ['楼栋'], parseWorkbook, fallbackPicker: picker } })
    await pasteIn(w, 'A\t1')
    expect(w.find('.fpimp-ask').exists()).toBe(false)
  })
})

describe('② 核对 · 多段', () => {
  const r = (n: number) => Array.from({ length: n }, () => ({ a: 1, __preview: ['x'] })) as ImportRec[]

  // 破坏验证:primary 不跟 summaryRef.count 走(写死段数)→ 红;ImportSummary 里留「全部导入」→ 「按钮只在底栏」红
  it('❗「导入 K 段 · M 行」随勾选变,按钮只在底栏一处;emit 带 label、剥 __preview', async () => {
    const customParse = () => ({ sections: [{ label: '一期', records: r(3) }, { label: '二期', records: r(2) }] })
    const w = mount(FpImportModal, { props: { title: '导入', templateCols: ['A'], customParse } })
    await pasteIn(w, 'x')
    expect(w.find('.fpimp-src').text()).toBe('粘贴的 1 行换一个')
    expect(w.find('.isum-sum').text()).toBe('认出 2 段 5 行')
    expect(w.findAll('.fpimp button').filter(b => /导入/.test(b.text())).map(b => b.text())).toEqual(['导入 2 段 · 5 行'])
    await w.findAll('.isum-cb')[0].trigger('change')
    expect(primary(w).text()).toBe('导入 1 段 · 2 行')
    await w.findAll('.isum-cb')[1].trigger('change')
    expect(primary(w).attributes('disabled'), '一段都没勾').toBeDefined()
    await w.findAll('.isum-cb')[1].trigger('change')
    await primary(w).trigger('click')
    const picks = w.emitted('importSections')![0][0] as { label: string; records: ImportRec[] }[]
    expect(picks).toEqual([{ label: '二期', records: [{ a: 1 }, { a: 1 }] }])
    expect(w.find('.fpimp-hint.info').exists(), '不是逐段的不出蓝条').toBe(false)
  })

  // 破坏验证:applyResult 的 sections 分支不读 res.bad(改前)→ 核对页那几句红;start() 对分段把 sentBad 清空 → p.bad / 结果卡那两句红
  it('❗多段也带导不了的行(附表6 记账月份认不出):核对页列出写原因,p.bad 记进导入记录,结果卡逐条列', async () => {
    const BAD = [{ row: 5, cells: ['补录', '2025-04-30', '1000'], reason: '记账月份认不出' }]
    let got: ImportRunProgress | undefined
    const runner = vi.fn(async (_p: ImportPayload, _f: string, p: ImportRunProgress) => { got = p; return { imported: 3, skipped: 0, errors: [] } })
    const customParse = () => ({ sections: [{ label: '一期', records: r(3) }], bad: BAD })
    const w = mount(FpImportModal, { props: { title: '导入附表6 光伏发电', templateCols: ['记账月份', '发生月份', '消纳电量'], customParse, runner } })
    await pasteIn(w, 'x')
    expect(w.find('.isum-sum').text()).toBe('认出 1 段 3 行')
    expect(w.findAll('.fpimp-hint.warn').map(h => h.text())).toEqual(['另有 1 行导不了，先放着：改好 Excel 再单独导这 1 行。'])
    expect(w.findAll('.fill th').map(t => t.text())).toEqual(['记账月份', '发生月份', '消纳电量', '导不了的原因'])
    expect(w.findAll('.fill tbody tr').map(tr => tr.findAll('td').map(t => t.text()))).toEqual([['补录', '2025-04-30', '1000', '记账月份认不出']])
    await primary(w).trigger('click'); await flushPromises()
    expect(got?.bad).toBe(1)
    expect(w.findAll('.irc-errs li').map(li => li.text())).toEqual(['第 5 行补录 2025-04-30 · 1000记账月份认不出'])
  })

  it('一段能导的都没有、只有导不了的行:照样进核对页把原因列出来,不报「没识别到」', async () => {
    const customParse = () => ({ sections: [{ label: '一期', records: [] as ImportRec[] }], bad: [{ row: 5, cells: ['补录'], reason: '记账月份认不出' }] })
    const w = mount(FpImportModal, { props: { title: '导入', templateCols: ['记账月份'], customParse } })
    await pasteIn(w, 'x')
    expect(steps(w)[1][0]).toBe('now')
    expect(w.find('.fill tbody tr .fpimp-why').text()).toBe('记账月份认不出')
    expect(primary(w).attributes('disabled')).toBeDefined()
  })

  it('逐段(segmented):表下面出蓝底「一段一段导…」', async () => {
    const customParse = () => ({ sections: [{ label: '一期', records: r(1) }] })
    const w = mount(FpImportModal, { props: { title: '导入', templateCols: ['A'], customParse, segmented: true } })
    await pasteIn(w, 'x')
    // 「接着导」只在这个窗口里成立(关窗再导是从头发):不写「下次」
    expect(w.find('.fpimp-hint.info').text()).toBe('一段一段导：中途断了，不关这个窗口就能从断的那段接着导，前面导好的不用重导。')
  })
})
