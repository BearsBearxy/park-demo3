/**
 * 园区抄表 · 宽档屏顶(画布 04-A / 04-B,计划 P4-C1 / P4-C2 / P4-C3 / T18)。
 *
 *   标题行:七个按钮收成四个 —— 浏览「导出当月 · … · 编辑模式」,编辑「导入 · 新增表 · … · 完成」;
 *          标题旁「租户表已抄 N / M」+ 期区段控 + 页面状态(编辑中 · N 处改动 / 本月还没有读数 / 本月没导册子)。
 *   第二行:六张统计卡并进状态页签(全部 / 未抄 / 待核 常驻,其余非零才出)+ 存疑入口胶囊。
 *   内容区:加载失败 / 空状态换掉表格本身,不再是表格上方的流内条。
 *
 * 表格本身(列、分组、分时)归另一位实现者(P4-C4/C5),这里桩掉 MeterLedgerGrid,只看它渲不渲、收到几行。
 * 审核簇 FPReviewActions 也桩掉:它在不同审核态画 0~2 颗按钮,不属于「四颗」。
 *
 * 夹具口径 = 画布 04-A 那一屏:78 块租户电表,76 块已抄、2 块未抄;其中 1 块待核(没挂上租户档案、原文有名字)。
 * 各表读数各不相同(100+id),不是全等的退化数据。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import MeterView from '@/views/meters/MeterView.vue'
import MeterLedgerGrid from '@/views/meters/MeterLedgerGrid.vue'
import MeterStatusDialog from '@/views/meters/MeterStatusDialog.vue'
import FPAlertChip from '@/components/fp/FPAlertChip.vue'
import {
  metersApi, type MeterDTO, type MeterReadingDTO, type MeterBindingDTO, type MeterDeleteDTO,
  type MeterStatusRow, type MeterStatusImpactDTO,
} from '@/api/meters'
import { useAuthStore } from '@/stores/auth'
import { useBillingPeriodStore } from '@/stores/billingPeriod'
import { ask } from '@/utils/ask'
import { useViewport, _resetViewportForTest } from '@/composables/useViewport'

vi.mock('@/api/meters', () => ({
  metersApi: {
    list: vi.fn(), readings: vi.fn(), binding: vi.fn(), months: vi.fn(),
    meterReadings: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(),
    createReading: vi.fn(), updateReading: vi.fn(), deleteReading: vi.fn(),
    deletePreview: vi.fn(), batchDelete: vi.fn(), autoLinkByName: vi.fn(),
    bind: vi.fn(), importRows: vi.fn(), usageSummary: vi.fn(),
    statusImpact: vi.fn(), setStatus: vi.fn(),
  },
}))
vi.mock('@/api/tenant', () => ({ tenantApi: { list: () => Promise.resolve([]) } }))
vi.mock('@/api/building', () => ({ buildingApi: { list: () => Promise.resolve([]) } }))
vi.mock('@/api/zones', () => ({
  zonesApi: { list: () => Promise.resolve([{ code: 'p1', name: '一期' }, { code: 'p2', name: '二期' }, { code: 'dorm', name: '宿舍' }]) },
}))
vi.mock('@/api/alloc', () => ({
  allocApi: { poolMonths: () => Promise.resolve([]), lossMonths: () => Promise.resolve([]) },
}))
vi.mock('@/api/billNotices', () => ({ billNoticesApi: { months: () => Promise.resolve([]) } }))
vi.mock('@/api/review', () => ({
  reviewApi: {
    closedMonths: vi.fn().mockResolvedValue([]), states: vi.fn().mockResolvedValue([]), list: vi.fn().mockResolvedValue([]),
    submit: vi.fn(), approve: vi.fn(), returnBack: vi.fn(), withdraw: vi.fn(),
  },
}))
vi.mock('@/api/params', () => ({ paramsApi: { status: () => Promise.resolve(null) } }))
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useRoute: () => ({ query: {}, fullPath: '/meters' }),
}))
vi.mock('@/api/locks', () => ({
  locksApi: {
    acquire: () => Promise.resolve({ granted: true, holder: null }),
    release: () => Promise.resolve(),
    heartbeat: () => Promise.resolve({ evicted: null }),
    takeover: () => Promise.resolve({ granted: true, holder: null }),
    releaseOnUnload: () => {},
  },
}))
vi.mock('@/utils/ask', async (orig) => ({ ...(await orig<typeof import('@/utils/ask')>()), ask: vi.fn() }))

const YM = '2025-03'

/** 一块租户电表(按 MeterDTO 声明,漏字段会被类型挡住)。id 为 1 的那块没挂租户档案 = 待核。 */
function meter(id: number, x: Partial<MeterDTO> = {}): MeterDTO {
  return {
    id, kind: 'elec', zone: 'p1', name: `电表${id}`, area: 'A座', spot: '一楼东侧',
    floorLabel: '一楼', side: '东侧', roomNo: `${100 + id}室`,
    tenantName: `租户${id}`, tenantId: id === 1 ? null : id, buildingId: 13, ownership: 'tenant',
    meterType: null, deviceType: 'three', subName: '电表①', code: `2206050${String(id).padStart(5, '0')}`, factor: 40,
    sortNo: id, readingCount: 3,
    status: 'active', statusFrom: '1900-01', statusUntil: null,
    assignFrom: '1900-01', assignUntil: null, assignSrc: 'migrate', changedThisMonth: false,
    bookSeen: true, bookFile: '2025-03 一期电.xlsx', bookAt: '2025-03-28T09:00:00',
    ...x,
  }
}
function reading(meterId: number): MeterReadingDTO {
  const prev = 100 + meterId
  const curr = prev + meterId / 4
  return {
    id: 1000 + meterId, meterId, ym: YM,
    prevTotal: prev, currTotal: curr,
    prevSharp: null, prevPeak: null, prevFlat: null, prevValley: null,
    currSharp: null, currPeak: null, currFlat: null, currValley: null,
    factorSnap: 40, usageTotal: (curr - prev) * 40,
    usageSharp: null, usagePeak: null, usageFlat: null, usageValley: null,
    note: null, source: 'import',
  }
}
const IDS = Array.from({ length: 78 }, (_, i) => i + 1)
const METERS = IDS.map(id => meter(id))
/** 76 块已抄:77、78 号没读数 → 未抄 2 */
const READINGS = IDS.filter(id => id <= 76).map(reading)
const BINDING: MeterBindingDTO = {
  summary: { pending: 1 },
  rows: IDS.map(id => ({ meterId: id, status: 'auto' as const, bucket: null, contractId: null, contractNo: null, locations: [], hasReading: id <= 76 })),
}
const DEL_PREVIEW: MeterDeleteDTO = {
  ym: YM, readings: 76, meters: 76, metersEmptied: 0, derived: 12,
  manualKept: [], meterDeleted: [], meterBlocked: [],
}

interface MeterVm {
  editMode: boolean
  status: string
  building: string
  panel: string
  suspectOnly: boolean
  delPreview: MeterDeleteDTO | null
  onCellEdit: (p: { meterId: number; field: 'currTotal'; value: string }) => void
  autoLink: () => Promise<void>
  onSaveChanges: () => Promise<void>
}
const vmOf = (w: { vm: unknown }) => w.vm as MeterVm

async function open(opts: { attach?: boolean } = {}) {
  const w = mount(MeterView, {
    attachTo: opts.attach ? document.body : undefined,
    global: { stubs: { Teleport: true, MeterLedgerGrid: true, FPReviewActions: true } },
  })
  await flushPromises()
  return w
}
/** 标题行右侧那组里自己画的按钮(「…」是一颗 button;审核簇已桩掉) */
const headBtns = (w: Awaited<ReturnType<typeof open>>) =>
  w.findAll('.mt-head .mt5-actions button').map(b => b.text().replace(/\s+/g, ''))
const gridRows = (w: Awaited<ReturnType<typeof open>>) =>
  (w.findComponent(MeterLedgerGrid).props('rows') as unknown[]).length
const tipOf = (el: Element) => (el as HTMLElement & { _tip?: { text: string } })._tip?.text

beforeEach(() => {
  setActivePinia(createPinia())
  useAuthStore().permissions = ['meter-reading:edit', 'meter-master:edit']
  useBillingPeriodStore().pick(2025, 3)
  vi.clearAllMocks()
  localStorage.clear()
  vi.mocked(metersApi.list).mockResolvedValue(METERS)
  vi.mocked(metersApi.readings).mockImplementation((ym: string) => Promise.resolve(ym === YM ? READINGS : []))
  vi.mocked(metersApi.binding).mockResolvedValue(BINDING)
  vi.mocked(metersApi.months).mockResolvedValue([YM])
  vi.mocked(metersApi.deletePreview).mockResolvedValue(DEL_PREVIEW)
  vi.mocked(ask).mockResolvedValue(true)
})

describe('P4-C1 · 标题行:七个按钮收成四个(画布 04-A / 04-B)', () => {
  it('浏览态:导出当月 · … · 编辑模式 三颗;「下载模板」「重置」不再是独立按钮', async () => {
    const w = await open()
    const btns = headBtns(w)
    expect(btns).toHaveLength(3)
    expect(btns[0]).toBe('导出当月')
    expect(btns[2]).toBe('编辑模式')
    expect(w.find('.mt-head .mt5-actions .fp-more-btn').exists(), '中间那颗是「…」').toBe(true)
    expect(btns.join('|')).not.toMatch(/下载模板|重置/)
    // 「…」里只有下载模板
    await w.find('.mt-head .fp-more-btn').trigger('click')
    expect(w.findAll('.mt-head .fp-more-item').map(i => i.text())).toEqual(['下载模板'])
  })

  it('编辑态:导入 · 新增表 · … · 完成 四颗;「…」里 导出当月 / 下载模板 / 一键挂 / 批量删除本期(红)', async () => {
    const w = await open()
    vmOf(w).editMode = true
    await flushPromises()
    const btns = headBtns(w)
    expect(btns).toHaveLength(4)
    expect([btns[0], btns[1], btns[3]]).toEqual(['导入', '新增表', '完成'])
    expect(btns, '「导出当月」编辑态收进「…」').not.toContain('导出当月')
    await w.find('.mt-head .fp-more-btn').trigger('click')
    const items = w.findAll('.mt-head .fp-more-item')
    expect(items.map(i => i.text())).toEqual(['导出当月', '下载模板', '按名精确匹配一键挂', '批量删除本期'])
    expect(items.map(i => i.classes().includes('danger'))).toEqual([false, false, false, true])
  })

  it('标题旁写「租户表已抄 76 / 78」,期区段控在标题行里', async () => {
    const w = await open()
    const head = w.find('.mt-head-l')
    expect(head.text()).toContain('租户表已抄 76 / 78')
    expect(head.findAll('[role="tab"]').map(t => t.text())).toEqual(['一期', '二期', '宿舍'])
    expect(w.find('.mt5-prog').exists(), '旧进度条').toBe(false)
  })

  it('编辑中 · N 处改动 贴在标题旁(页面状态),数跟着草稿走', async () => {
    const w = await open()
    expect(w.find('.mt-head .fp-state.edit').exists(), '浏览态不该有').toBe(false)
    vmOf(w).editMode = true
    await flushPromises()
    for (const id of [2, 3, 4]) vmOf(w).onCellEdit({ meterId: id, field: 'currTotal', value: '999' })
    await flushPromises()
    const tag = w.find('.mt-head-l .fp-state.edit')
    expect(tag.text()).toBe('编辑中 · 3 处改动')
    expect(w.find('.mt5-tag').exists(), '旧的右侧橙药丸').toBe(false)
  })
})

describe('P4-C2 · 六张统计卡并进状态页签(画布 04-A 第二行)', () => {
  it('夹具 2 未抄 · 1 待核 · 0 异常:页签 === 全部 / 未抄 2 / 待核 1;统计卡没了', async () => {
    const w = await open()
    expect(w.findAll('.mt-tabs [role="tab"]').map(t => t.text())).toEqual(['全部', '未抄 2', '待核 1'])
    expect(w.find('.mt5-cards').exists()).toBe(false)
  })

  it('点「未抄 2」→ 表格只剩那 2 块;再点「全部」回来', async () => {
    const w = await open()
    expect(gridRows(w), '前提:78 块都在表里').toBe(78)
    const tab = (t: string) => w.findAll('.mt-tabs [role="tab"]').find(x => x.text().startsWith(t))!
    await tab('未抄').trigger('click')
    await flushPromises()
    expect(gridRows(w)).toBe(2)
    await tab('全部').trigger('click')
    await flushPromises()
    expect(gridRows(w)).toBe(78)
  })

  it('异常非零才出:5 号倒走 → 多出「异常 1」', async () => {
    vi.mocked(metersApi.readings).mockImplementation((ym: string) => Promise.resolve(ym === YM
      ? READINGS.map(r => (r.meterId === 5 ? { ...r, currTotal: r.prevTotal! - 3, usageTotal: -120 } : r))
      : []))
    const w = await open()
    expect(w.findAll('.mt-tabs [role="tab"]').map(t => t.text())).toEqual(['全部', '未抄 2', '待核 1', '异常 1'])
  })

  it('存疑:0 块时胶囊不出;有 1 块时出「存疑 1」,点了只列它、实底带 ×,点 × 回到全部', async () => {
    const w0 = await open()
    expect(w0.findComponent(FPAlertChip).exists(), '存疑 0 块还出了胶囊').toBe(false)
    w0.unmount()

    vi.mocked(metersApi.list).mockResolvedValue(METERS.map(m => (m.id === 9 ? { ...m, suspect: 'incomplete' as const } : m)))
    const w = await open()
    const chip = () => w.find('.mt5-filters .fac')
    expect(chip().text()).toContain('存疑 1')
    expect(tipOf(chip().element), '原来 title 里那句挪进悬停说明').toContain('1 块表区域/位置/企业名称/编码全空')
    await chip().trigger('click')
    await flushPromises()
    expect(vmOf(w).suspectOnly).toBe(true)
    expect(gridRows(w)).toBe(1)
    expect(chip().classes()).toContain('on')
    await w.find('.mt5-filters .fac button[aria-label="清除筛选"]').trigger('click')
    await flushPromises()
    expect(vmOf(w).suspectOnly).toBe(false)
    expect(gridRows(w)).toBe(78)
  })
})

describe('P4-C3 · 空状态 / 加载失败换掉表格区', () => {
  it('本月一条读数都没有:没有 .mt-empty 流内条,表格不渲染,内容区是空状态;标题旁「本月还没有读数」', async () => {
    vi.mocked(metersApi.readings).mockResolvedValue([])
    const w = await open()
    expect(w.find('.mt-empty').exists()).toBe(false)
    expect(w.findComponent(MeterLedgerGrid).exists()).toBe(false)
    expect(w.find('.fp-empty').text()).toContain(`${YM} 还没有抄表读数`)
    expect(w.findAll('.mt-head-l .fp-state').map(t => t.text())).toEqual(['本月还没有读数'])
  })

  it('空月进了编辑态:表格回来(逐块录入就在表格里),空状态收起', async () => {
    vi.mocked(metersApi.readings).mockResolvedValue([])
    const w = await open()
    vmOf(w).editMode = true
    await flushPromises()
    expect(w.findComponent(MeterLedgerGrid).exists()).toBe(true)
    expect(w.find('.fp-empty').exists()).toBe(false)
  })

  it('读数没拉到:加载失败换掉表格(有「重试」、没有表格);重试成功表格回来', async () => {
    vi.mocked(metersApi.readings).mockRejectedValue(new Error('后端挂了'))
    const w = await open()
    const retry = w.findAll('.fp-empty.error button').find(b => b.text().includes('重试'))
    expect(retry, '失败态没给重试').toBeTruthy()
    expect(w.findComponent(MeterLedgerGrid).exists(), '失败了表格还在(流内红条那一形)').toBe(false)
    vi.mocked(metersApi.readings).mockImplementation((ym: string) => Promise.resolve(ym === YM ? READINGS : []))
    await retry!.trigger('click')
    await flushPromises()
    expect(w.find('.fp-empty.error').exists()).toBe(false)
    expect(w.findComponent(MeterLedgerGrid).exists()).toBe(true)
  })
})

describe('T18 · 流内条 / 确认 / 改动数', () => {
  it('本月没导册子:标题旁一枚标签,原句在悬停说明里;不再有 .mt-bookbar', async () => {
    vi.mocked(metersApi.list).mockResolvedValue(METERS.map(m => ({ ...m, bookSeen: false, bookFile: null, bookAt: null })))
    const w = await open()
    const tag = w.findAll('.mt-head-l .fp-state').find(t => t.text() === '本月没导册子')
    expect(tag, '标签没出').toBeTruthy()
    expect(tipOf(tag!.element)).toContain('这个月还没导入过一期的电表册子,这些表的档案都是沿用的')
    expect(w.find('.mt-bookbar').exists()).toBe(false)
  })

  it('改动数接进编辑态登记表:进编辑态 0 处 → 0(不是缺省的 1);改 2 块 → 2', async () => {
    const w = await open()
    vmOf(w).editMode = true
    await flushPromises()
    expect(useAuthStore().dirtyTotal, '没接 dirty 时缺省按 1 算,关页签会白问一句').toBe(0)
    vmOf(w).onCellEdit({ meterId: 2, field: 'currTotal', value: '999' })
    vmOf(w).onCellEdit({ meterId: 3, field: 'currTotal', value: '999' })
    await flushPromises()
    expect(useAuthStore().dirtyTotal).toBe(2)
  })

  it('一键挂先问(站内确认,主按钮写「挂 N 块」);答否一个请求都不发', async () => {
    const w = await open()
    vmOf(w).editMode = true
    await flushPromises()
    vi.mocked(ask).mockResolvedValue(false)
    await vmOf(w).autoLink()
    await flushPromises()
    expect(vi.mocked(ask).mock.calls.at(-1)?.[0].action).toMatch(/^挂 \d+ 块$/)
    expect(metersApi.autoLinkByName).not.toHaveBeenCalled()
  })

  it('批量删除本期按确认弹窗的样子:问句标题、正文给数、主按钮「删除 76 条」、焦点先落「取消」', async () => {
    const w = await open({ attach: true })
    vmOf(w).editMode = true
    await flushPromises()
    vmOf(w).delPreview = { ...DEL_PREVIEW }
    await flushPromises()
    const dlg = w.find('.mt-dlg.ask')
    expect(dlg.find('h3').text()).toBe(`删除 ${YM} 全部读数？`)
    expect(dlg.find('.mt-dlg-h p').text()).toBe('共 76 条已录读数，删除后不能撤销。')
    const btns = dlg.findAll('.mt-dlg-f button')
    expect(btns.map(b => b.text())).toEqual(['取消', '删除 76 条'])
    expect(document.activeElement, '删除类默认焦点在「取消」').toBe(btns[0].element)
    w.unmount()
  })

  it('本文件不再有原生 confirm / alert,模板里不再有原生 title=', () => {
    const src = readFileSync(join(__dirname, '../meters/MeterView.vue'), 'utf8')
    const script = src.slice(0, src.indexOf('<template>'))
    const tpl = src.slice(src.indexOf('<template>'), src.lastIndexOf('</template>'))
    expect(script.match(/\b(?:window\.)?(?:confirm|alert)\(/g), '原生弹框').toBeNull()
    // 白名单只放声明了 title prop 的组件(实现规范 §5 门禁口径):ChainMonthGate / FpImportModal
    const rest = tpl.replace(/<(?:ChainMonthGate|FpImportModal)\b[^>]*>/g, '')
    expect(rest.match(/\s:?title=/g), '原生 title').toBeNull()
  })
})

describe('T18 · 在册状态弹框:影响范围没算出来 = 加载失败(十件 ⑦)', () => {
  const ROWS: MeterStatusRow[] = [{ id: 1, meterId: 1, fromYm: '1900-01', status: 'active', src: 'migrate', batchId: null }]
  const IMPACT: MeterStatusImpactDTO = {
    from: YM, until: '2025-05', locked: [], readings: [{ ym: '2025-04', usage: 120 }], pools: [], contractNo: null,
  }

  it('失败换掉影响那一块、带「重试」,确认灰着;重试成功出影响句,不再是字段报错那一行', async () => {
    vi.mocked(metersApi.statusImpact).mockRejectedValueOnce({ message: '网络断了' }).mockResolvedValue(IMPACT)
    const w = mount(MeterStatusDialog, {
      props: { edit: true, meterId: 1, meterName: '一车间总电', ym: YM, rows: ROWS, row: null },
      global: { stubs: { teleport: true } },
    })
    await flushPromises()
    const fail = w.find('.fp-empty.error')
    expect(fail.text()).toContain('网络断了')
    expect(w.find('.fp-field-err').text(), '加载失败不走字段报错那一行').toBe('')
    const confirm = () => w.findAll('button').find(b => b.text().startsWith('确认'))!
    expect(confirm().attributes('disabled')).toBeDefined()
    await fail.findAll('button').find(b => b.text().includes('重试'))!.trigger('click')
    await flushPromises()
    expect(metersApi.statusImpact).toHaveBeenCalledTimes(2)
    expect(w.find('.fp-empty.error').exists()).toBe(false)
    expect(w.find('.fp-note.warn').text()).toContain('这 1 个月的读数将不再计费')
    expect(confirm().attributes('disabled')).toBeUndefined()
  })
})

// ── 对抗复查补的断言(2026-10-01)──────────────────────────────────────────────
const tabBtn = (w: Awaited<ReturnType<typeof open>>, t: string) =>
  w.findAll('.mt-tabs [role="tab"]').find(x => x.text().startsWith(t))!
const gridProp = <T>(w: Awaited<ReturnType<typeof open>>, k: 'touBase' | 'retiredOpen') => w.findComponent(MeterLedgerGrid).props(k) as T

describe('对抗复查 · 表格接线(regress-2 / regress-4 / asserts-1)', () => {
  // 破坏验证:MeterView 不传 :tou-base(或传 gridRows)→ 点「未抄」后 touBase 跟着变成 2 → 红
  it('尖峰平谷出列的分母按期区 × 电水全量给表格:点「未抄」只换 rows,touBase 还是 78 块', async () => {
    const w = await open()
    expect(gridProp<unknown[]>(w, 'touBase')).toHaveLength(78)
    await tabBtn(w, '未抄').trigger('click')
    await flushPromises()
    expect(gridRows(w)).toBe(2)
    expect(gridProp<unknown[]>(w, 'touBase'), '切页签分母不动').toHaveLength(78)
  })

  // 破坏验证:MeterView 不传 :retired-open → 状态「已停用」时表格还把停用表收进组尾 → 红
  it('状态是「已停用」「本月有变化」时告诉表格别把停用表收进组尾;「全部」照收', async () => {
    const w = await open()
    expect(gridProp<boolean>(w, 'retiredOpen')).toBe(false)
    for (const s of ['retired', 'changed']) {
      vmOf(w).status = s
      await flushPromises()
      expect(gridProp<boolean>(w, 'retiredOpen'), s).toBe(true)
    }
  })
})

describe('对抗复查 · 跨出窄档时清掉宽档看不见的筛选(regress-5)', () => {
  // 破坏验证:删掉 watch(isSM) → 拉宽后楼栋 / 状态还在生效 → 红
  it('M 档面板里选了楼栋和「本月有变化」,拉宽到桌面:两样都清掉,表格回到 78 块;宽档页签里有的「未抄」跨档保留', async () => {
    const vp = useViewport()
    vp.tier.value = 'm'
    try {
      const w = await open()
      vmOf(w).building = '13'
      vmOf(w).status = 'changed'
      vmOf(w).panel = 'filter'
      await flushPromises()
      expect(gridRows(w), '前提:筛选生效(本月没有变化的表)').toBe(0)
      vp.tier.value = 'xl'
      await flushPromises()
      expect([vmOf(w).building, vmOf(w).status, vmOf(w).panel]).toEqual(['all', 'all', ''])
      expect(gridRows(w)).toBe(78)
      vp.tier.value = 'm'
      await flushPromises()
      vmOf(w).status = 'missing'
      await flushPromises()
      vp.tier.value = 'xl'
      await flushPromises()
      expect(vmOf(w).status, '宽档页签里有的状态不清').toBe('missing')
      w.unmount()
    } finally { _resetViewportForTest() }
  })
})

describe('对抗复查 · 加载失败文案(spec-11,03-B / 06-D)', () => {
  // 破坏验证:readErr 改回「本月读数加载失败，请重试」→ 第一条红;sub 改回旧句 → 第二条红
  it('读数没读到:「2025 年 3 月的抄表读数没读到」+「屏上不显示上个月的数字」,句里不再说「请重试」', async () => {
    vi.mocked(metersApi.readings).mockRejectedValue(new Error('后端挂了'))
    const w = await open()
    const fail = w.find('.fp-empty.error')
    expect(fail.text()).toContain('2025 年 3 月的抄表读数没读到')
    expect(fail.text()).toContain('屏上不显示上个月的数字')
    expect(fail.text()).not.toContain('请重试')
  })
  // 破坏验证:metersErr 改回「表档案加载失败，请重试」→ 红
  it('表档案首载没读到:整页失败件写「2025 年 3 月的表档案没读到」', async () => {
    vi.mocked(metersApi.list).mockRejectedValue(new Error('后端挂了'))
    const w = await open()
    expect(w.find('.mt-gate-fail').text()).toContain('2025 年 3 月的表档案没读到')
    expect(w.find('.mt-gate-fail').text()).not.toContain('请重试')
  })
})

describe('对抗复查 · 批量删除本期:从「…」点进去、确认框的样子(asserts-11 / spec-13)', () => {
  const SRC = readFileSync(join(__dirname, '../meters/MeterView.vue'), 'utf8')
  // 破坏验证:宽档 headMore 的 key 改成 'wipe'(onMoreAction 认不出)→ 预览没拉、弹窗不出 → 第一条红;
  //   主按钮 variant 改 filled → 第二条红;遮罩上去掉 @keydown.esc → 第三条红;h3 去掉 id / aria-labelledby → 第四条红
  it('编辑态点「…」→「批量删除本期」:先拉预览再出确认框;主按钮红色;Esc 取消、不删;对话框有名字', async () => {
    const w = await open({ attach: true })
    vmOf(w).editMode = true
    await flushPromises()
    await w.find('.mt-head .fp-more-btn').trigger('click')
    await w.findAll('.mt-head .fp-more-item').find(i => i.text() === '批量删除本期')!.trigger('click')
    await flushPromises()
    expect(metersApi.deletePreview).toHaveBeenCalledWith(YM, expect.anything())
    const dlg = w.find('.mt-dlg.ask')
    expect(dlg.exists()).toBe(true)
    const main = dlg.findAll('.mt-dlg-f button').find(b => b.text() === '删除 76 条')!
    expect(main.attributes('data-variant')).toBe('danger')
    const labelled = dlg.attributes('aria-labelledby')
    expect(labelled && dlg.find(`#${labelled}`).text()).toBe(`删除 ${YM} 全部读数？`)
    await dlg.find('.mt-dlg-f button').trigger('keydown', { key: 'Escape' })
    await flushPromises()
    expect(w.find('.mt-dlg.ask').exists(), 'Esc = 取消').toBe(false)
    expect(metersApi.batchDelete).not.toHaveBeenCalled()
    w.unmount()
  })

  // 破坏验证:.mt-mask.ask 的 z-index 删掉(回到 140)/ .mt-dlg.ask 阴影改回 rgba / 正文改回 12.5px 灰 → 各自那条红
  it('遮罩与卡片引 FPConfirmHost 同一套令牌:--z-confirm、--shadow-dialog、正文 --fs-body / --text-secondary、四边 24', async () => {
    const style = document.createElement('style')
    style.textContent = [...SRC.matchAll(/^<style[^>]*>([\s\S]*?)^<\/style>/gm)].map(m => m[1]).join('\n')
    document.head.appendChild(style)
    try {
      const w = await open({ attach: true })
      vmOf(w).editMode = true
      await flushPromises()
      vmOf(w).delPreview = { ...DEL_PREVIEW }
      await flushPromises()
      const cs = (sel: string) => getComputedStyle(w.find(sel).element)
      expect(cs('.mt-mask.ask').zIndex).toBe('var(--z-confirm)')
      expect(cs('.mt-dlg.ask').boxShadow).toBe('var(--shadow-dialog)')
      expect([cs('.mt-dlg.ask .mt-dlg-h p').fontSize, cs('.mt-dlg.ask .mt-dlg-h p').color]).toEqual(['var(--fs-body)', 'var(--text-secondary)'])
      expect(cs('.mt-dlg.ask .mt-dlg-h').paddingTop).toBe('24px')
      expect(cs('.mt-dlg.ask .mt-dlg-f').padding).toBe('24px')
      w.unmount()
    } finally { style.remove() }
  })
})

describe('对抗复查 · 问着的时候(asserts-2)', () => {
  // 破坏验证:autoLink 里 ask 之后那道 `!editMode.value ||` 删掉 → 红(第一条是对照)
  it('一键挂:对照 —— 一直在编辑态,答「挂」就挂;问着的时候编辑态没了,答「挂」也不挂', async () => {
    const w = await open()
    vmOf(w).editMode = true
    await flushPromises()
    vi.mocked(metersApi.autoLinkByName).mockResolvedValue({ linked: 1, skipped: 0 } as never)
    let reply!: (ok: boolean) => void
    vi.mocked(ask).mockImplementation(() => new Promise(r => { reply = r }))
    let p = vmOf(w).autoLink()
    await flushPromises()
    reply(true)
    await p
    expect(metersApi.autoLinkByName, '对照').toHaveBeenCalledTimes(1)
    vi.mocked(metersApi.autoLinkByName).mockClear()
    p = vmOf(w).autoLink()
    await flushPromises()
    vmOf(w).editMode = false
    await flushPromises()
    reply(true)
    await p
    expect(metersApi.autoLinkByName).not.toHaveBeenCalled()
  })

  // 「仍要保存」问着的时候又点了一次保存(两张确认排着):答完只存一遍 —— 守卫里的 saving 那一条
  // (编辑态就地转假那一条观察不到:watch(editMode) 会先把草稿清空,没有东西可存)
  // 破坏验证:onSaveChanges 里 ask 之后那道 `|| saving.value` 删掉 → 同一块表 POST 两次 → 红
  it('「仍要保存」:两次保存的确认都答「仍要保存」,同一块表只写一遍', async () => {
    vi.mocked(metersApi.list).mockResolvedValue([...METERS, meter(79, { status: null })])
    const w = await open()
    vmOf(w).editMode = true
    await flushPromises()
    vmOf(w).onCellEdit({ meterId: 79, field: 'currTotal', value: '150' })
    const replies: ((ok: boolean) => void)[] = []
    vi.mocked(ask).mockImplementation(() => new Promise(r => { replies.push(r) }))
    const p1 = vmOf(w).onSaveChanges(), p2 = vmOf(w).onSaveChanges()
    await flushPromises()
    expect(vi.mocked(ask).mock.calls.map(c => c[0].action), '前提:两张「仍要保存」都排上了').toEqual(['仍要保存', '仍要保存'])
    replies.forEach(r => r(true))
    await Promise.all([p1, p2])
    await flushPromises()
    expect(metersApi.createReading).toHaveBeenCalledTimes(1)
  })
})
