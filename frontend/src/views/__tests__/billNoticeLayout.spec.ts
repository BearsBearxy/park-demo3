// 催缴单屏照画布 05 节落地的版式判据(2026-10-01,计划 S3 · P4-D1–D6、T15)。
//   05-A 改后:标题行「待处理 5 · 簿册 ▾ · 导出 ▾ · 编辑模式」;四张统计卡并进状态页签;表头六列;
//        警告写类别「首类 +N」;分组行兼小计可收起;本期合计列加粗浅底(03-C 同一套)。
//   05-B 本月未生成:标题旁不贴标签(图上没有)+ 卡里空状态「2023-09 的催缴单还没生成 / ▷ 生成本月」。
//   05-C 批量确认:表格卡工具条换成选择条;已确认 / 已导出勾选框禁用;分组行「7 户 · 可确认 5」。
//   06-C 问题面板:点一条跳到表里那一户并闪一下。
//
// 夹具照画布 05-A 的 A座七户(金额、状态、告警都照图),另加一户 B座 —— 收起一组时要看得出另一组还在。
// 按真实 DTO 声明,不退化:四种户级状态都有、两类告警的户与一类的户与只缺收款公司的户各一。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { useAuthStore } from '@/stores/auth'
import { useBillingPeriodStore } from '@/stores/billingPeriod'
import {
  billNoticesApi, type BillNoteOverrideDTO, type BillNoticeDTO, type BillNoticeDetailDTO, type BillNoticeLineDTO,
  type NoticeWarnDTO,
} from '@/api/billNotices'
import { lineNoteKey } from '@/utils/billNoticeLogic'
import { paramsApi, type ParamStatusDTO } from '@/api/params'
import { contractApi } from '@/api/contract'
import { buildingApi } from '@/api/building'
import { companyBookApi, billDeliveryApi } from '@/api/billDelivery'
import { billsApi } from '@/api/bills'
import { ask } from '@/utils/ask'
import { receipts } from '@/utils/receipt'
import type { ContractDTO } from '@/types/contract'
import type { BuildingDTO } from '@/types/building'
import BillNoticesView from '@/views/bills/BillNoticesView.vue'
import { useViewport, _resetViewportForTest } from '@/composables/useViewport'
import { defineComponent, h, KeepAlive, ref } from 'vue'
import { rowsNotEndingInFill, stubWideTable } from '@/composables/__tests__/wideTableStub'

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useRoute: () => ({ query: {} }),
}))
vi.mock('@/api/billNotices', () => ({
  billNoticesApi: {
    list: vi.fn(), months: vi.fn(), detail: vi.fn(),
    notes: vi.fn(), saveNote: vi.fn(), deleteNote: vi.fn(),
    generate: vi.fn(), issue: vi.fn(), void: vi.fn(),
  },
}))
vi.mock('@/api/review', () => ({
  reviewApi: {
    closedMonths: vi.fn().mockResolvedValue([]), states: vi.fn().mockResolvedValue([]),
    list: vi.fn().mockResolvedValue([]),
    submit: vi.fn(), approve: vi.fn(), returnBack: vi.fn(), withdraw: vi.fn(),
  },
}))
vi.mock('@/api/params', () => ({ paramsApi: { status: vi.fn(), list: vi.fn(), put: vi.fn() } }))
vi.mock('@/api/contract', () => ({ contractApi: { list: vi.fn() } }))
vi.mock('@/api/building', () => ({ buildingApi: { list: vi.fn() } }))
vi.mock('@/api/bills', () => ({ billsApi: { paymap: vi.fn(), setPaymap: vi.fn() } }))
vi.mock('@/api/billDelivery', async (o) => ({
  ...await o<typeof import('@/api/billDelivery')>(),
  companyBookApi: { list: vi.fn(), payees: vi.fn() },
  billDeliveryApi: { confirm: vi.fn(), markExported: vi.fn() },
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
vi.mock('@/utils/ask', async (o) => ({ ...await o<typeof import('@/utils/ask')>(), ask: vi.fn() }))

const VIEW = readFileSync(join(__dirname, '..', 'bills', 'BillNoticesView.vue'), 'utf8').replace(/\r\n/g, '\n')
const STYLE = VIEW.slice(VIEW.indexOf('<style scoped>'))
const TEMPLATE = VIEW.slice(VIEW.indexOf('<template>'), VIEW.indexOf('<style scoped>'))
const SCRIPT = VIEW.slice(0, VIEW.indexOf('<template>'))
const outsideMedia = (css: string) => css.replace(/@media[^{]*\{(?:[^{}]|\{[^{}]*\})*\}/g, '')

// ── 夹具 ──────────────────────────────────────────────────────────────────
let nid = 100
const notice = (
  tenantId: number, tenantName: string, premiseText: string, totalAmount: number,
  status: string, warns: NoticeWarnDTO[] = [], payCompanyId: number | null = 3,
): BillNoticeDTO => ({
  id: ++nid, ym: '2023-09', tenantId, tenantName, payCompanyId, payCompanyName: payCompanyId ? '甲公司' : null,
  noticeKind: 'combined', premiseText, totalAmount, prevDue: 0, status, warns, lineCount: 4,
})
const ROOM: NoticeWarnDTO = { code: 'W_ROOM_MISMATCH', payload: '547', hint: '' }
const PKG: NoticeWarnDTO = { code: 'W_PACKAGE_NO_POOL', payload: 'share_elec_floor', hint: '' }
const PRICE: NoticeWarnDTO = { code: 'W_PRICE_MISSING', payload: 'elec_sharp', hint: '' }
const mkNotices = (): BillNoticeDTO[] => {
  nid = 100
  return [
    notice(1, '旭化成', '一楼101室', 38420.16, 'confirmed'),
    notice(2, '联塑精锢', '孵化器A102室、宿舍545室', 44656.75, 'draft', [ROOM, PKG]),
    notice(3, '广联', '二楼201室', 20975.48, 'draft'),
    notice(4, '氙明', '三楼302室', 8212.3, 'exported'),
    notice(5, 'SENAN', '四楼401室', 8460, 'draft', [PRICE]),
    notice(6, '星州', '五楼502室', -312.4, 'draft'),
    // 永龙:一张确认了、一张没确认 = 部分确认;这张没落到收款公司 = 缺收款公司
    notice(7, '永龙', '六楼601室', 3000, 'confirmed'),
    notice(7, '永龙', '六楼601室', 2873.12, 'draft', [], null),
    // 宏远(B座):一类告警 + 缺收款公司 —— 缺口进「+N」
    notice(8, '宏远', 'B座101室', 22424.73, 'draft', [PRICE], null),
  ]
}
const RENT: Record<number, number> = { 1: 31560, 2: 44169.46, 3: 20075.48, 4: 7738.8, 5: 7958, 6: 5250, 7: 5250, 8: 21358.28 }
const contract = (tenantId: number, buildingId: number): ContractDTO => ({
  id: 700 + tenantId, contractNo: `S10-${tenantId}`, tenantId, tenantName: `户${tenantId}`,
  buildingId, buildingName: buildingId === 1 ? 'A座' : 'B座', unitId: null, floorInfo: '',
  rentArea: 100, monthlyRent: RENT[tenantId], deposit: 0,
  startDate: '2023-01-01', endDate: '2025-12-31', signDate: null, status: 'active',
  termMonths: 36, daysToEnd: null, remark: null,
})
const CONTRACTS: ContractDTO[] = [1, 2, 3, 4, 5, 6, 7].map(t => contract(t, 1)).concat(contract(8, 2))
const building = (id: number, name: string): BuildingDTO => ({
  id, name, phase: 1, phaseName: '一期', zone: null, kind: 'factory',
  floorCount: 6, totalArea: 1, rentableArea: 1, status: 1, unitCount: 1, occupiedCount: 1, vacantCount: 0,
  expiringCount: 0, reservedCount: 0, leasedArea: 1, occRate: null, monthlyRent: 0, tenantIds: [],
  tenantBuildingArea: 0,
})
const STATUS: ParamStatusDTO = {
  priceOk: 6, priceTotal: 6, pendingChanges: 0, lastChangeAt: null,
  poolSnapshotAt: '2023-09-16T16:37:51', billBatchAt: '2023-09-20T13:41:34',
  stale: false, otherMonthsAffected: [],
}

let w: VueWrapper | null = null
beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  localStorage.clear()
  useAuthStore().permissions = ['billing-run:edit', 'billing-issue:edit']
  vi.mocked(billNoticesApi.list).mockResolvedValue(mkNotices())
  vi.mocked(billNoticesApi.notes).mockResolvedValue([])
  vi.mocked(billNoticesApi.generate).mockResolvedValue({ generated: 9, lines: 36, warned: 3 } as never)
  vi.mocked(paramsApi.status).mockResolvedValue(STATUS)
  vi.mocked(contractApi.list).mockResolvedValue(CONTRACTS)
  vi.mocked(buildingApi.list).mockResolvedValue([building(1, 'A座'), building(2, 'B座')])
  vi.mocked(companyBookApi.list).mockResolvedValue([])
  vi.mocked(companyBookApi.payees).mockResolvedValue([])
  vi.mocked(billsApi.paymap).mockResolvedValue([])
  vi.mocked(ask).mockResolvedValue(true)
})
afterEach(() => { w?.unmount(); w = null })

async function open() {
  useBillingPeriodStore().pick(2023, 8)          // 8 月水电 → 2023-09 的单
  w = mount(BillNoticesView, { global: { stubs: { Teleport: true } } })
  await flushPromises()
  return w
}
async function enterEdit(v: VueWrapper) {
  await v.find('.bn-actions .fp-emb').trigger('click')
  await flushPromises()
}
const tenantRows = (v: VueWrapper) => v.findAll('.bn-table tbody tr[data-tid]')
const rowOf = (v: VueWrapper, name: string) => tenantRows(v).find(r => r.find('.bn-tname').text() === name)!
const bands = (v: VueWrapper) => v.findAll('.bn-table tbody tr.bn-band')

// ════════════════════════════════════════════════════════════════════════════
describe('P4-D1 标题行:八个按钮收成四个(画布 05-A)', () => {
  // 破坏验证:把「簿册 ▾」换回三颗独立 Button → 「收款公司」那条红
  it('浏览态:没有「收款公司」「导出通知单」独立钮;待处理 · 簿册 · 导出 · 编辑模式依次在右组', async () => {
    const v = await open()
    const acts = v.find('.bn-actions')
    const own = acts.findAll('.ds-btn').map(b => b.text())
    expect(own).not.toContain('收款公司')
    expect(own).not.toContain('导出通知单')
    // 右组的直接子项顺序(审核簇在编辑按钮左边,稿上没画、照旧留着)
    const kids = [...acts.element.children].map(e =>
      e.querySelector('.fac') || e.classList.contains('fac') ? '待处理'
        : e.classList.contains('fp-emb') || e.querySelector('.fp-emb') ? '编辑模式'
          : (e.textContent ?? '').trim())
    expect(kids[0], '问题入口在右组最前').toBe('待处理')
    expect(kids.indexOf('簿册')).toBe(1)
    expect(kids.indexOf('导出')).toBe(2)
    expect(kids.at(-1)).toBe('编辑模式')
    expect(v.find('.bn-head-l .fac').exists(), '桌面问题入口不在左组').toBe(false)
  })

  // 破坏验证:重新生成那颗的 `list.length` 条件去掉 → 空月页头也出生成钮 → 红
  it('编辑态:「重新生成」在「完成」左边;空月页头不出生成钮(生成本月在空状态里)', async () => {
    const v = await open()
    await enterEdit(v)
    const texts = v.find('.bn-actions').findAll('button').map(b => b.text())
    const iGen = texts.indexOf('重新生成')
    const iDone = texts.findIndex(t => t.includes('完成'))
    expect(iGen).toBeGreaterThanOrEqual(0)
    expect(iGen).toBeLessThan(iDone)
    w!.unmount()
    vi.mocked(billNoticesApi.list).mockResolvedValue([])
    const e = await open()
    await enterEdit(e)
    expect(e.find('.bn-actions').text()).not.toMatch(/生成/)
  })
})

// 用户 2026-10-04 拍板:催缴单上的收款账号,能进这一屏(出账与催缴单 · 查看)就给明文 —— 导出不再因缺主数据查看置灰。
// 破坏验证:loadCompanies 换回 companyBookApi.list → 红
describe('收款账户取催缴单那份', () => {
  it('❗进屏取 payees(账号明文),不取主数据那份 list(没有主数据查看时是掩码)', async () => {
    await open()
    expect(companyBookApi.payees).toHaveBeenCalledTimes(1)
    expect(companyBookApi.list).not.toHaveBeenCalled()
  })
})

// ════════════════════════════════════════════════════════════════════════════
describe('P4-D2 四张统计卡并进状态页签(画布 05-A)', () => {
  // 破坏验证:filtered 里去掉 `inTab(r, tab.value …)` → 点「已确认」后行数不变 → 红
  it('页签写字 + 计数,点「已确认」只剩已确认那户;桌面没有 KPI 卡', async () => {
    const v = await open()
    expect(v.find('.bn-kpis').exists()).toBe(false)
    const tabs = v.findAll('.bn-tabs .ds-seg-item')
    // A座 7 + B座 1 = 8;待核对 = 5 草稿 + 永龙部分确认;有警告 = 联塑精锢、SENAN、永龙(只缺收款公司)、宏远
    expect(tabs.map(t => t.text())).toEqual(['全部 8', '待核对 6', '已确认 1', '已导出 1', '有警告 4'])
    await tabs[2].trigger('click')
    expect(tenantRows(v).map(r => r.find('.bn-tname').text())).toEqual(['旭化成'])
    await v.findAll('.bn-tabs .ds-seg-item')[4].trigger('click')
    expect(tenantRows(v).map(r => r.find('.bn-tname').text())).toEqual(['联塑精锢', 'SENAN', '永龙', '宏远'])
  })
})

// ════════════════════════════════════════════════════════════════════════════
describe('P4-D3 表格列、警告写类别、分组行(画布 05-A)', () => {
  // 破坏验证:把「行数」那一列加回 thead → 红
  it('表头六列,无行数', async () => {
    const v = await open()
    expect(v.findAll('.bn-table thead th:not(.fp-fill)').map(t => t.text()))
      .toEqual(['租户', '位置', '本期合计（元）', '月租金参考（元）', '状态', '警告'])
  })

  // 列宽铁律(2026-10-02):位置按内容定宽,余宽落进行末空列,不再由位置列吸收。
  // 破坏验证:位置那根 <col> 改回无宽 `<col />` → 第一段红;删掉表头 / 分组行 / 户行 / 合计行任一处的 .fp-fill → 第二段红
  it('位置列按最长位置串定宽(189px),余宽归行末空列;每种行末尾都是一格空列', async () => {
    const v = await open()
    const cols = v.findAll('.bn-table colgroup col')
    expect(cols).toHaveLength(7)
    // 最长「孵化器A102室、宿舍545室」= 12.2em × 14px → 171 + 余量 2 + 内边距 16
    expect(cols[1].attributes('style')).toBe('width: 189px;')
    expect(cols[6].attributes('style'), '空列不给宽,吃余宽').toBeUndefined()
    const lastCells = [
      v.find('.bn-table thead tr'), bands(v)[0], tenantRows(v)[0], v.find('.bn-table tfoot tr'),
    ].map(tr => tr.findAll('th, td').at(-1)!)
    for (const c of lastCells) {
      expect(c.classes()).toContain('fp-fill')
      expect(c.attributes('aria-hidden')).toBe('true')
      expect(c.text()).toBe('')
    }
  })

  // 破坏验证:warnCell 的 more 不加收款缺口 / warnHead 的 more 写成 0 → 红
  it('两类告警写「首类 +1」;一类不写 +;只缺收款公司就地标记;状态列不再挂橙点', async () => {
    const v = await open()
    expect(rowOf(v, '联塑精锢').find('.bn-wcell').text()).toBe('房号两边对不上 +1')
    expect(rowOf(v, 'SENAN').find('.bn-wcell').text()).toBe('上个月缺价')
    expect(rowOf(v, '宏远').find('.bn-wcell').text(), '缺收款公司算一类,进 +N').toBe('上个月缺价 +1')
    const yl = rowOf(v, '永龙')
    expect(yl.find('.bn-wcell .fp-mark').text()).toBe('缺收款公司')
    expect(yl.find('.bn-st').text()).toBe('部分确认')
    expect(yl.find('.bn-stc').findAll('.fp-mark, .bn-gapdot').length, '缺口不在状态列').toBe(0)
    expect(rowOf(v, '广联').find('.bn-wcell').text()).toBe('')
    // 行尾 ›:每一户都有
    expect(tenantRows(v).every(r => r.find('.bn-go').exists())).toBe(true)
  })

  // 破坏验证:toggleGroup 里 `if (!s.delete(k)) s.add(k)` 改成只 add → 再点不展开 → 红;
  //   收起入口改回 tr[tabindex] + @keydown.enter(不是 <button>)→ 最后一段红
  it('分组行写户数 + 两列小计,点它收起、再点展开;另一组不受影响;收起入口是 <button aria-expanded>', async () => {
    const v = await open()
    const a = bands(v)[0]
    expect(a.find('.bn-gbtn .t').text()).toBe('A座')
    expect(a.find('.bn-gbtn .n').text()).toBe('7 户')
    // 小计 = 7 户本期合计之和 / 月租金之和(夹具金额照画布 05-A)
    expect(a.findAll('td')[1].text()).toBe('126,285.41')
    expect(a.findAll('td')[2].text()).toBe('122,001.74')
    await a.trigger('click')
    expect(tenantRows(v).map(r => r.find('.bn-tname').text()), 'A座收起,B座还在').toEqual(['宏远'])
    await bands(v)[0].trigger('click')
    expect(tenantRows(v)).toHaveLength(8)
    // 键盘:和另两屏一样是行里那颗原生 button(Enter / Space 都触发 click),点它只切一次(不和整行的 click 叠两次)
    const btn = bands(v)[0].find('button.bn-gbtn')
    expect(btn.attributes('aria-expanded')).toBe('true')
    expect(bands(v)[0].attributes('tabindex'), '行本身不再抢焦点').toBeUndefined()
    await btn.trigger('click')
    expect(tenantRows(v)).toHaveLength(1)
    expect(bands(v)[0].find('button.bn-gbtn').attributes('aria-expanded')).toBe('false')
  })

  it('合计行只写「合计」和两列数,不写户数 / 行数', async () => {
    const v = await open()
    const cells = v.findAll('.bn-table tfoot th:not(.fp-fill)').map(t => t.text())
    expect(cells).toEqual(['合计', '', '148,710.14', '143,360.02', '', ''])
  })
})

// ════════════════════════════════════════════════════════════════════════════
describe('P4-D4 本月未生成(画布 05-B)', () => {
  // 破坏验证:FPEmpty 的 #action 去掉 v-if="canRun" 的编辑态条件(写成恒出)→ 浏览态那条红;
  //          标题旁加回 <FPStateTag v-if="noRows">本月未生成</FPStateTag> → 两处「不贴标签」红
  it('编辑态:没有流内灰条、没有表;卡里空状态带「生成本月」;标题旁不贴「本月未生成」(图上没有);不出页签', async () => {
    vi.mocked(billNoticesApi.list).mockResolvedValue([])
    const v = await open()
    expect(v.find('.bn-head-l .fp-state').exists(), '浏览态标题旁不贴标签').toBe(false)
    expect(v.find('.bn-card .fp-empty').exists(), '浏览态也是空状态').toBe(true)
    expect(v.find('.bn-card .fp-empty').findAll('button'), '浏览态不给写入口').toHaveLength(0)
    await enterEdit(v)
    expect(v.find('.bn-bar').exists()).toBe(false)
    expect(v.find('.bn-table').exists()).toBe(false)
    expect(v.find('.bn-tabs').exists()).toBe(false)
    expect(v.find('.bn-head-l .fp-state').exists(), '编辑态(画布 05-B)标题旁也不贴标签').toBe(false)
    expect(v.find('.bn-card .fp-empty .t').text()).toBe('2023-09 的催缴单还没生成')
    expect(v.find('.bn-card .fp-empty .sub').text()).toContain('按 8 月读数和 9 月租金生成')
    const btns = v.find('.bn-card').findAll('button')
    expect(btns.map(b => b.text())).toEqual(['生成本月'])
  })

  // 破坏验证:onGenerate 的 `rows.value?.length &&` 去掉(空月也问)→ ask 被调 → 红
  // 破坏验证:onGenerate 的 receipt.ok 换回页底自己的 FPToast → receipts 为空 → 红
  it('空月点「生成本月」直接生成,不问(没有可覆盖的东西);摘要走底部成功回执', async () => {
    receipts.splice(0)
    vi.mocked(billNoticesApi.list).mockResolvedValue([])
    const v = await open()
    await enterEdit(v)
    await v.find('.bn-card .fp-empty button').trigger('click')
    await flushPromises()
    expect(ask).not.toHaveBeenCalled()
    expect(billNoticesApi.generate).toHaveBeenCalledWith('2023-09')
    expect(receipts.map(r => [r.tone, r.text])).toEqual([['ok', '已生成 9 单 / 36 行,3 单带警告(含已签发跳过户)']])
    expect(v.find('.fpt').exists(), '页底不再有自己那条提示').toBe(false)
  })

  // 破坏验证:loadMonth 的 list 调用加回 `.catch(() => [])` → 屏上说「还没生成」→ 红
  it('单没读到:占住内容区的加载失败 + 重试,不冒充「还没生成」,编辑模式点不进', async () => {
    vi.mocked(billNoticesApi.list).mockRejectedValueOnce(new Error('网关超时'))
    const v = await open()
    const err = v.find('.bn-card .fp-empty.error')
    expect(err.exists()).toBe(true)
    expect(err.text()).toContain('2023 年 9 月的催缴单没读到')
    expect(v.text()).not.toContain('还没生成')
    expect(v.find('.fp-state').exists(), '不贴「本月未生成」').toBe(false)
    expect(v.find('.bn-tabs').exists(), '没有行可筛,不出页签(全 0 的页签是假话)').toBe(false)
    expect(v.find('.bn-table').exists()).toBe(false)
    expect((v.find('.bn-actions .fp-emb').element as HTMLButtonElement).disabled).toBe(true)
    await err.find('button').trigger('click')                  // 重试 → 这回成了
    await flushPromises()
    expect(v.find('.fp-empty.error').exists()).toBe(false)
    expect(tenantRows(v)).toHaveLength(8)
  })
})

// ════════════════════════════════════════════════════════════════════════════
describe('P4-D5 批量确认选择条(画布 05-C)', () => {
  async function enterBulk() {
    const v = await open()
    await enterEdit(v)
    const b = v.find('.bn-tools').findAll('.ds-btn').find(x => x.text() === '批量确认')
    expect(b, '编辑态表格卡工具条上有「批量确认」').toBeTruthy()
    await b!.trigger('click')
    return v
  }

  // 破坏验证:canPick 改成恒 true → selCount 7、已确认那格不禁用 → 红
  it('A座 7 户 · 可确认 5;全选待核对只选待核对(A座 5 + B座 1);已确认 / 已导出勾选框禁用', async () => {
    const v = await enterBulk()
    expect(bands(v)[0].find('.bn-gbtn .n').text()).toBe('7 户 · 可确认 5')
    expect(v.find('.bn-selbar').exists()).toBe(true)
    expect(v.find('.bn-tools').exists(), '工具条被选择条换掉').toBe(false)
    await v.findAll('.bn-selb').find(b => b.text() === '全选待核对')!.trigger('click')
    // 全表 = A座 5 + B座 1
    expect(v.find('.bn-selc').text()).toBe('已选 6 户')
    const ck = (n: string) => rowOf(v, n).find('input[type=checkbox]').element as HTMLInputElement
    expect(ck('旭化成').disabled).toBe(true)
    expect(ck('氙明').disabled).toBe(true)
    expect(ck('旭化成').checked).toBe(false)
    expect(ck('永龙').disabled, '部分确认算待核对,能勾').toBe(false)
    expect(rowOf(v, '旭化成').classes()).toContain('off')
    // 2 户缺收款公司(永龙、宏远):选择条上说清,不阻断
    expect(v.find('.bn-selnote').text()).toBe('其中 2 户缺收款公司，不影响确认')
  })

  // 破坏验证:confirmTenants 的 picked 换成 filtered 全部 → 带上已确认的户 → 红
  it('「确认 N 户」先问,答是才发;发出去的只有勾上的待核对户', async () => {
    const v = await enterBulk()
    await v.findAll('.bn-selb').find(b => b.text() === '全选待核对')!.trigger('click')
    vi.mocked(billDeliveryApi.confirm).mockResolvedValue({ confirmed: 7, skipped: 1 } as never)
    await v.findAll('.bn-selbar .ds-btn').find(b => b.text() === '确认 6 户')!.trigger('click')
    await flushPromises()
    expect(ask).toHaveBeenCalledOnce()
    expect(vi.mocked(ask).mock.calls[0][0].action).toBe('确认 6 户')
    expect(vi.mocked(billDeliveryApi.confirm).mock.calls[0][1].sort()).toEqual([2, 3, 5, 6, 7, 8])
  })
})

// ════════════════════════════════════════════════════════════════════════════
describe('P4-D6 字距与行(03-C 同一套)', () => {
  // 破坏验证:.bn-sumc 的 color 改回 var(--hue-blue) → 红;tbody td 高改回 34 → 红
  it('钱格字不用蓝、加粗;桌面行高 40、正文 14、表头 12;钱列整列浅底、表头下蓝线;不加字距', () => {
    const css = outsideMedia(STYLE)
    const rule = (sel: string) => css.match(new RegExp(`\\n${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`))?.[1] ?? ''
    const sumc = rule('.bn-sumc')
    expect(sumc).toContain('font-weight: var(--fw-semibold)')
    expect(sumc).not.toContain('--hue-blue')
    expect(sumc).not.toContain('--brand')
    expect(rule('.bn-table tbody td')).toContain('height: 40px')
    const th = rule('.bn-table thead th')
    expect(th).toContain('height: 40px')
    expect(th).toContain('font-size: var(--fs-label)')
    expect(rule('.bn-table')).toContain('font-size: var(--fs-body)')
    expect(rule('.bn-table .bn-tname, .bn-table .bn-txt, .bn-table .bn-nv, .bn-table .bn-sumc')).toContain('font-size: var(--fs-body)')
    expect(rule('.bn-table td.bn-mc')).toContain('background: var(--money-cell)')
    expect(rule('.bn-table thead th.bn-mc')).toContain('box-shadow: inset 0 -2px 0 var(--hue-blue)')
    expect(STYLE).not.toMatch(/letter-spacing/)
  })

  it('钱那一列两位小数:8212.3 显示 8,212.30;钱列三处(表头 / 格 / 合计)都挂 bn-mc', async () => {
    const v = await open()
    const cell = rowOf(v, '氙明').find('td.bn-mc')
    expect(cell.text()).toBe('8,212.30')
    expect(v.find('.bn-table thead th.bn-mc').text()).toBe('本期合计（元）')
    expect(v.find('.bn-table tfoot th.bn-mc').exists()).toBe(true)
    expect(rowOf(v, '星州').find('.bn-sumc').classes(), '负数红').toContain('neg')
  })
})

// ════════════════════════════════════════════════════════════════════════════
describe('T15 问题面板跳行、机械替换、改动数', () => {
  // 破坏验证:noticeAlertGroups 的 items 不挂 onClick → 面板里那一条点不动 → 红;
  //          focusRow 里不重置页签 → 「已确认」页签下那一户找不到 → 红
  it('面板打开页面不变暗;点一条跳到那一户并闪;被页签筛掉的户先回到「全部」', async () => {
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    const v = await open()
    await v.findAll('.bn-tabs .ds-seg-item')[2].trigger('click')      // 已确认:联塑精锢不在表里
    expect(rowOf(v, '联塑精锢')).toBeUndefined()
    await v.find('.bn-actions button.fac').trigger('click')
    expect(v.find('.fp-sdw-mask').exists()).toBe(false)
    const item = v.findAll('.fap-item').find(b => b.text().includes('房号 547'))
    expect(item, '面板里有房号那一条').toBeTruthy()
    await item!.trigger('click')
    await flushPromises()
    const row = rowOf(v, '联塑精锢')
    expect(row.classes()).toContain('flash')
    expect(v.find('.bn-tabs .ds-seg-item[data-on]').text()).toBe('全部 8')
    expect(scroll.mock.contexts[0]).toBe(row.element)
    expect(v.find('.fap').exists(), '点完面板收起').toBe(false)
  })

  // 破坏验证:任一处 alert( / confirm( 写回去,或给原生标签 / Button 加 title= → 红
  it('本文件没有 confirm / alert,没有原生 title(prompt 这次不换,规范 §4)', () => {
    const code = SCRIPT.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
    const tpl = TEMPLATE.replace(/<!--[\s\S]*?-->/g, '')
    // billDeliveryApi.confirm( / unconfirmTenant( 不算:前面是「.」或字母
    const native = /window\.(?:confirm|alert)\(|(?<![.\w])(?:confirm|alert)\(/g
    expect(code.match(native)).toBeNull()
    expect(tpl.match(native)).toBeNull()
    expect(code.match(/(?<![.\w])prompt\(/g), '取消确认 / 作废两处 prompt 暂留').toHaveLength(2)
    expect(tpl.match(/<(?:[a-z][\w-]*|Button)\b[^>]*\s:?title=/g)).toBeNull()
  })

  // 破坏验证:useEditMode 的 dirty 去掉(缺省按 1)→ 没展开备注时也是 1 → 红
  // 明细里一行场地租金(广联),引擎备注「按天折算」;备注编辑 / 恢复两条用例共用
  const RENT_LINE: BillNoticeLineDTO = {
    lineNo: 1, feeKey: 'rent_factory', premise: '二楼201室', meterId: null, meterLabel: null, contractId: 703,
    seg: null, prevRead: null, currRead: null, factorSnap: null, qty: 100, priceSnap: 20, priceKey: null,
    priceScope: null, priceMonth: null, ruleBranch: null, poolRuleId: null, poolName: null, shareSrc: null,
    baseSnap: null, amount: 2000, note: '按天折算', feeGroup: 'rent',
  }
  function mockRentDetail() {
    const detail = (n: BillNoticeDTO): BillNoticeDetailDTO => ({
      id: n.id, ym: n.ym, tenantId: n.tenantId, tenantName: n.tenantName, payCompanyId: n.payCompanyId,
      payCompanyName: n.payCompanyName, noticeKind: n.noticeKind, premiseText: n.premiseText,
      totalAmount: n.totalAmount, prevDue: n.prevDue, status: n.status, warns: n.warns, lines: [RENT_LINE],
    })
    vi.mocked(billNoticesApi.detail).mockImplementation(async (id: number) => detail(mkNotices().find(n => n.id === id)!))
  }

  // 破坏验证:restoreNote 的 `!await ask({…})` 换成 `false` → 不问就删 → 红
  it('恢复引擎备注先问(ask 替 confirm);说不就不删', async () => {
    mockRentDetail()
    const over: BillNoteOverrideDTO = { ym: '2023-09', tenantId: 3, ...lineNoteKey(RENT_LINE), note: '手写的' }
    vi.mocked(billNoticesApi.notes).mockResolvedValue([over])
    vi.mocked(ask).mockResolvedValue(false)
    const v = await open()
    await enterEdit(v)
    await rowOf(v, '广联').trigger('click')
    await flushPromises()
    await v.find('.bn-ndot').trigger('click')
    await flushPromises()
    expect(ask).toHaveBeenCalledOnce()
    expect(vi.mocked(ask).mock.calls[0][0].body).toContain('改回「按天折算」')
    expect(billNoticesApi.deleteNote).not.toHaveBeenCalled()
  })

  it('改动数接进编辑锁:没在写备注 0,展开一行备注 1', async () => {
    mockRentDetail()
    const v = await open()
    await enterEdit(v)
    const auth = useAuthStore()
    expect(auth.dirtyTotal).toBe(0)
    await rowOf(v, '广联').trigger('click')
    await flushPromises()
    await v.find('.bn-npen').trigger('click')
    expect(auth.dirtyTotal).toBe(1)
    // 破坏验证:dirty 去掉 approxDirty 包装 → 红(离开确认会说「1 处改动」,其实只知道备注开着)
    expect(auth.dirtyApproxOn(''), '备注开着只知道在写、不知道改了几处').toBe(true)
  })

  // 破坏验证:租金页改回 <div class="bn-empty"> → 第一段红;水电页改回表里一行 <td class="bn-noro"> → 第二段红
  it('明细里一行都没有:场地租金、水电费两页都是空状态换掉表格,不是表里一行灰字', async () => {
    vi.mocked(billNoticesApi.detail).mockImplementation(async (id: number) => {
      const n = mkNotices().find(x => x.id === id)!
      return { id: n.id, ym: n.ym, tenantId: n.tenantId, tenantName: n.tenantName, payCompanyId: n.payCompanyId,
        payCompanyName: n.payCompanyName, noticeKind: n.noticeKind, premiseText: n.premiseText,
        totalAmount: n.totalAmount, prevDue: n.prevDue, status: n.status, warns: n.warns, lines: [] }
    })
    const v = await open()
    await rowOf(v, '广联').trigger('click')
    await flushPromises()
    expect(v.find('.bn-hgrid').exists(), '前置:抽屉开着').toBe(true)
    expect(v.find('.bn-dtable').exists()).toBe(false)
    expect(v.find('.fp-empty .t').text()).toBe('本月无租金行')
    await v.findAll('[role="tab"]').find(t => t.text() === '水电费')!.trigger('click')
    await flushPromises()
    expect(v.find('.bn-dtable').exists(), '空状态和表格互斥').toBe(false)
    expect(v.find('.fp-empty .t').text()).toBe('本单无水电行')
  })
})

// ── 对抗复查补的断言(2026-10-01)──────────────────────────────────────────────
interface BnVm { warnOnly: boolean; filterOpen: boolean; editMode: boolean; bulkMode: boolean }
const vmOf = (v: VueWrapper) => v.vm as unknown as BnVm
const VIEW_CSS = VIEW.slice(VIEW.indexOf('<style scoped>') + '<style scoped>'.length, VIEW.lastIndexOf('</style>'))
function withCss<T>(fn: () => Promise<T>): Promise<T> {
  const s = document.createElement('style')
  s.textContent = VIEW_CSS
  document.head.appendChild(s)
  return fn().finally(() => s.remove())
}

describe('对抗复查 · 钱那一列、分组行、合计行、批量态淡显(spec-4 / 6 / 7 / 16,画布 05-A / 05-C)', () => {
  // 破坏验证(逐条):数据格底改回裸 color-mix / 分组行改回 sunken 底 + 粗上边 / 分组钱格不混灰 / 分组小计改回加粗正文色 /
  //   合计行改回 40 高白底 / 合计钱格不设 16 / tr.off 加回 opacity → 各自那条红
  it('05-A:钱格浅蓝叠白、分组行卡片灰无粗边、分组钱格混灰、小计轻一档;合计行 44 高卡片灰、钱列合计 16', () => withCss(async () => {
    const v = await open()
    const cs = (el: Element) => getComputedStyle(el)
    const table = v.find('.bn-table').element
    expect(cs(table).getPropertyValue('--money-cell').trim()).toBe('color-mix(in srgb, var(--accent-blue) 60%, var(--surface-white))')
    expect(cs(table).getPropertyValue('--money-cell-grp').trim()).toBe('color-mix(in srgb, var(--money-cell) 40%, var(--surface-card))')
    expect(cs(rowOf(v, '氙明').find('td.bn-mc').element).background).toBe('var(--money-cell)')
    const band = bands(v)[0]
    expect(cs(band.find('td.l').element).background, '分组行底').toBe('var(--surface-card)')
    expect(VIEW_CSS.match(/\n\.bn-table tr\.bn-band td, \.bn-table tbody tr\.bn-band:hover td \{[^}]*\}/)?.[0], '分组行没有粗上边')
      .not.toMatch(/border-top/)
    expect(cs(band.find('td.bn-mc').element).background, '分组行钱格').toBe('var(--money-cell-grp)')
    const sub = cs(band.find('.bn-sumc').element)
    expect([sub.fontWeight, sub.color], '分组小计').toEqual(['var(--fw-regular)', 'var(--text-secondary)'])
    expect([cs(band.find('.bn-gbtn .t').element).fontSize, cs(band.find('.bn-gbtn .n').element).fontSize], '组名 14 / 户数 12')
      .toEqual(['var(--fs-body)', 'var(--fs-label)'])
    const foot = v.findAll('.bn-table tfoot th')
    expect([cs(foot[0].element).height, cs(foot[0].element).background], '合计行').toEqual(['44px', 'var(--surface-card)'])
    expect(cs(v.find('.bn-table tfoot th.bn-mc').element).background, '合计钱格同数据格').toBe('var(--money-cell)')
    expect(cs(v.find('.bn-table tfoot th.bn-mc .bn-foot-v').element).fontSize, '钱列合计 16').toBe('16px')
    expect(cs(foot[3].find('.bn-foot-v').element).fontSize, '月租金合计照 14').toBe('var(--fs-body)')
    expect(cs(v.find('.bn-table thead th.bn-mc').element).color, '钱列表头次要色').toBe('var(--text-secondary)')
  }))

  it('05-C:不能勾的行不整行淡化 —— 名字 / 数字压成次要灰,状态签和钱格底色照旧', () => withCss(async () => {
    const v = await open()
    await enterEdit(v)
    await v.find('.bn-tools').findAll('.ds-btn').find(x => x.text() === '批量确认')!.trigger('click')
    const off = rowOf(v, '旭化成')
    expect(off.classes(), '前提:已确认那户不能勾').toContain('off')
    const cs = (el: Element) => getComputedStyle(el)
    expect(cs(off.element).opacity, '整行不淡化').toBe('')
    expect(cs(off.find('.bn-tname').element).color).toBe('var(--text-muted)')
    expect(cs(off.find('td.bn-mc .bn-sumc').element).color).toBe('var(--text-muted)')
    expect(cs(off.find('td.bn-mc').element).background, '钱格底色照旧').toBe('var(--money-cell)')
    expect(cs(off.find('.bn-st').element).background, '「已确认」绿签照旧').toBe('var(--ok-soft)')
  }))
})

describe('对抗复查 · 拖宽拖窄窗口互相清掉对方的筛选(asserts-5)', () => {
  // 破坏验证:删掉 watch(narrow) 里变窄那一支(tab='all')→ 窄档还按「已确认」筛、屏上却没有页签 → 红
  it('桌面点「已确认」再拖到 M 档:页签没了,筛选跟着清掉,表里回到全部 8 户', async () => {
    const vp = useViewport()
    try {
      const v = await open()
      await v.findAll('.bn-tabs .ds-seg-item')[2].trigger('click')
      expect(tenantRows(v), '前提:只剩已确认那户').toHaveLength(1)
      vp.tier.value = 'm'
      await flushPromises()
      expect(v.find('.bn-tabs').exists(), '前提:窄档没有页签').toBe(false)
      expect(tenantRows(v)).toHaveLength(8)
    } finally { _resetViewportForTest() }
  })
  // 破坏验证:删掉变宽那一支(filterOpen / warnOnly 清掉)→ 桌面还按「仅看有警告」筛 → 红
  it('S 档勾上「仅看有警告」再拉宽:桌面行数不受它影响,筛选面板收起', async () => {
    const vp = useViewport()
    vp.tier.value = 's'
    try {
      const v = await open()
      vmOf(v).warnOnly = true
      vmOf(v).filterOpen = true
      await flushPromises()
      expect(tenantRows(v), '前提:窄档只剩有告警的 3 户(联塑精锢 / SENAN / 宏远)').toHaveLength(3)
      vp.tier.value = 'xl'
      await flushPromises()
      expect(tenantRows(v)).toHaveLength(8)
      expect(vmOf(v).filterOpen).toBe(false)
    } finally { _resetViewportForTest() }
  })
})

describe('对抗复查 · 问题面板跳行的另两支(asserts-12,06-C)', () => {
  async function jump(v: VueWrapper) {
    Element.prototype.scrollIntoView = vi.fn()
    await v.find('.bn-actions button.fac').trigger('click')
    await v.findAll('.fap-item').find(b => b.text().includes('房号 547'))!.trigger('click')
    await flushPromises()
  }
  // 破坏验证:focusRow 里去掉「收着的组先展开」那一句 → 红
  it('那一户在收起的组里:先展开再闪', async () => {
    const v = await open()
    await bands(v)[0].trigger('click')
    expect(rowOf(v, '联塑精锢'), '前提:A座收着').toBeUndefined()
    await jump(v)
    expect(rowOf(v, '联塑精锢').classes()).toContain('flash')
  })
  // 破坏验证:focusRow 里去掉 `q.value = ''` → 搜索词还在、那一户出不来 → 红
  it('那一户被搜索筛掉:清掉搜索词再闪', async () => {
    const v = await open()
    await v.find('.bn-search').setValue('宏远')
    expect(tenantRows(v).map(r => r.find('.bn-tname').text()), '前提:只剩宏远').toEqual(['宏远'])
    await jump(v)
    expect((v.find('.bn-search').element as HTMLInputElement).value).toBe('')
    expect(rowOf(v, '联塑精锢').classes()).toContain('flash')
  })
})

describe('对抗复查 · 跳行闪一下的类一定会被摘掉(asserts-3)', () => {
  async function flash(v: VueWrapper) {
    Element.prototype.scrollIntoView = vi.fn()
    await v.find('.bn-actions button.fac').trigger('click')
    await v.findAll('.fap-item').find(b => b.text().includes('房号 547'))!.trigger('click')
    await flushPromises()
    expect(rowOf(v, '联塑精锢').classes(), '前提:闪着').toContain('flash')
  }
  // 破坏验证:tr 上去掉 @animationcancel → 红
  it('动画被取消(KeepAlive 停用 / 行被摘时浏览器只发 cancel):类跟着摘', async () => {
    const v = await open()
    await flash(v)
    await rowOf(v, '联塑精锢').find('td').trigger('animationcancel')
    expect(rowOf(v, '联塑精锢').classes()).not.toContain('flash')
  })
  // 破坏验证:toggleGroup 里不清 flashTid → 红
  it('闪着的时候把那一组收起再展开:不再无端闪一次', async () => {
    const v = await open()
    await flash(v)
    await bands(v)[0].trigger('click')
    await bands(v)[0].trigger('click')
    expect(rowOf(v, '联塑精锢').classes()).not.toContain('flash')
  })
  // 破坏验证:onDeactivated 里不清 flashTid → 红
  it('闪着的时候切走页签再切回:那一户不闪', async () => {
    useBillingPeriodStore().pick(2023, 8)
    const alive = ref(true)
    const k = mount(defineComponent({
      setup: () => () => h(KeepAlive, null, { default: () => (alive.value ? h(BillNoticesView) : null) }),
    }), { global: { stubs: { Teleport: true } } })
    try {
      await flushPromises()
      await flash(k)
      alive.value = false
      await flushPromises()
      alive.value = true
      await flushPromises()
      expect(rowOf(k, '联塑精锢').classes()).not.toContain('flash')
    } finally { k.unmount() }
  })
})

describe('对抗复查 · 问着的时候编辑权没了,答「是」也不写(asserts-2)', () => {
  let reply!: (ok: boolean) => void
  const pend = () => vi.mocked(ask).mockImplementation(() => new Promise(r => { reply = r }))
  // 破坏验证:confirmTenants 里 ask 之后那道 `if (!canIssue.value || confirming.value) return` 删掉 → 红
  it('批量确认 6 户', async () => {
    const v = await open()
    await enterEdit(v)
    await v.find('.bn-tools').findAll('.ds-btn').find(x => x.text() === '批量确认')!.trigger('click')
    await v.findAll('.bn-selb').find(b => b.text() === '全选待核对')!.trigger('click')
    pend()
    await v.findAll('.bn-selbar .ds-btn').find(b => b.text() === '确认 6 户')!.trigger('click')
    await flushPromises()
    expect(vi.mocked(ask).mock.calls.at(-1)?.[0].action).toBe('确认 6 户')
    vmOf(v).editMode = false
    await flushPromises()
    reply(true)
    await flushPromises()
    expect(billDeliveryApi.confirm).not.toHaveBeenCalled()
  })
  // 破坏验证:onGenerate 里 ask 之后那道 `if (!canRun.value || generating.value) return` 删掉 → 红
  it('重新生成', async () => {
    const v = await open()
    await enterEdit(v)
    pend()
    await v.find('.bn-actions').findAll('button').find(b => b.text() === '重新生成')!.trigger('click')
    await flushPromises()
    expect(vi.mocked(ask).mock.calls.at(-1)?.[0].action).toBe('重新生成')
    vmOf(v).editMode = false
    await flushPromises()
    reply(true)
    await flushPromises()
    expect(billNoticesApi.generate).not.toHaveBeenCalled()
  })
  // 破坏验证:restoreNote 里 ask 之后那道 `if (!canRun.value || …) return` 删掉 → 红
  it('恢复引擎备注', async () => {
    const RENT_LINE: BillNoticeLineDTO = {
      lineNo: 1, feeKey: 'rent_factory', premise: '二楼201室', meterId: null, meterLabel: null, contractId: 703,
      seg: null, prevRead: null, currRead: null, factorSnap: null, qty: 100, priceSnap: 20, priceKey: null,
      priceScope: null, priceMonth: null, ruleBranch: null, poolRuleId: null, poolName: null, shareSrc: null,
      baseSnap: null, amount: 2000, note: '按天折算', feeGroup: 'rent',
    }
    vi.mocked(billNoticesApi.detail).mockImplementation(async (id: number) => {
      const n = mkNotices().find(x => x.id === id)!
      return { id: n.id, ym: n.ym, tenantId: n.tenantId, tenantName: n.tenantName, payCompanyId: n.payCompanyId,
        payCompanyName: n.payCompanyName, noticeKind: n.noticeKind, premiseText: n.premiseText,
        totalAmount: n.totalAmount, prevDue: n.prevDue, status: n.status, warns: n.warns, lines: [RENT_LINE] }
    })
    vi.mocked(billNoticesApi.notes).mockResolvedValue([{ ym: '2023-09', tenantId: 3, ...lineNoteKey(RENT_LINE), note: '手写的' }])
    const v = await open()
    await enterEdit(v)
    await rowOf(v, '广联').trigger('click')
    await flushPromises()
    pend()
    await v.find('.bn-ndot').trigger('click')
    await flushPromises()
    expect(vi.mocked(ask).mock.calls.at(-1)?.[0].action).toBe('恢复引擎备注')
    vmOf(v).editMode = false
    await flushPromises()
    reply(true)
    await flushPromises()
    expect(billNoticesApi.deleteNote).not.toHaveBeenCalled()
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 列宽铁律(LIST-PAGE §4 / §7,2026-10-02):主表位置列放得下 / 放不下两档;明细水电费的备注列不随交互变宽
describe('列宽:位置列两档、水电费备注列不随交互变', () => {
  let ro: ReturnType<typeof stubWideTable> | null = null
  afterEach(() => { ro?.restore(); ro = null })

  // 定宽列合计 820(租户 220 + 三列 130 + 警告 210),最长位置串 189
  // 破坏验证:locTight 改成恒假 → 第二段位置列仍 189px,红;table 上的 'bn-tight' 绑定删掉 → 第二段红
  //   (M↓ 的 980 保底只挂 .bn-tight:放得下时也挂的话,保底宽多出来的全落进空列,横滚看到空白)
  it('❗放得下 → 位置 189px、空列吃余宽、不挂 .bn-tight;放不下 → 位置吃剩余、空列 0 宽、挂 .bn-tight', async () => {
    ro = stubWideTable('bn-wrap')
    const v = await open()
    await ro.fire(1200, 600)            // 1200 − 820 = 380 ≥ 189
    let cols = v.findAll('.bn-table colgroup col')
    expect(cols[1].attributes('style')).toBe('width: 189px;')
    expect(cols[6].attributes('style')).toBeUndefined()
    expect(v.find('.bn-table').classes()).not.toContain('bn-tight')
    await ro.fire(1000, 600)            // 1000 − 820 = 180 < 189
    cols = v.findAll('.bn-table colgroup col')
    expect(cols[1].attributes('style')).toBeUndefined()
    expect(cols[6].attributes('style')).toBe('width: 0px;')
    expect(v.find('.bn-table').classes()).toContain('bn-tight')
  })

  // 备注后面紧跟 30 宽的取价审计列:备注宽一变,审计列跟着跳。编辑钮与编辑行按「有没有权限」预留。
  // 破坏验证:utilNoteW 的编辑行改回 `if (noteEditKey.value)` → 浏览态 / 编辑态窄、点铅笔变 304,红;
  //   铅笔位改回 canRun 同时编辑行也改回 → 浏览态比编辑态窄,红
  it('❗水电费明细的备注列:浏览态、编辑态、点铅笔展开编辑行,都是同一个宽(编辑行 16 + 240 + 2×24 = 304)', async () => {
    const LINE: BillNoticeLineDTO = {
      lineNo: 1, feeKey: 'elec', premise: '二楼201室', meterId: 9, meterLabel: '广联电', contractId: 703, seg: 'flat',
      prevRead: 0, currRead: 100, factorSnap: 1, qty: 100, priceSnap: 0.6, priceKey: null, priceScope: null,
      priceMonth: null, ruleBranch: null, poolRuleId: null, poolName: null, shareSrc: null, baseSnap: null,
      amount: 60, note: '抄表日顺延', feeGroup: 'elec',
    }
    vi.mocked(billNoticesApi.detail).mockImplementation(async (id: number) => {
      const n = mkNotices().find(x => x.id === id)!
      return { id: n.id, ym: n.ym, tenantId: n.tenantId, tenantName: n.tenantName, payCompanyId: n.payCompanyId,
        payCompanyName: n.payCompanyName, noticeKind: n.noticeKind, premiseText: n.premiseText,
        totalAmount: n.totalAmount, prevDue: n.prevDue, status: n.status, warns: n.warns, lines: [LINE] }
    })
    const v = await open()
    await rowOf(v, '广联').trigger('click')
    await flushPromises()
    await v.findAll('[role="tab"]').find(t => t.text() === '水电费')!.trigger('click')
    await flushPromises()
    // colgroup 末三根 = 备注 / 取价审计 30 / 行末空列
    const noteCol = () => v.find('.bn-dtable colgroup').findAll('col').at(-3)!.attributes('style')
    expect(noteCol()).toBe('width: 304px;')
    await enterEdit(v)
    expect(noteCol()).toBe('width: 304px;')
    await v.find('.bn-dtable .bn-npen').trigger('click')
    await flushPromises()
    expect(v.find('.bn-dtable .bn-nin').exists(), '前置:编辑行已展开').toBe(true)
    expect(noteCol()).toBe('width: 304px;')
    expect(rowsNotEndingInFill(v.get('.bn-dtable').element), '水电费明细每一行末尾都是空列').toEqual([])
  })
})
