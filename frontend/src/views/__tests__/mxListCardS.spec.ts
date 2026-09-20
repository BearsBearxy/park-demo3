/**
 * mx 列表页(楼栋 / 租户 / 合同)的 S 档行卡门禁 —— 响应式稿 ListPhone 板 §1 / §3。
 *
 * 钉三件事:
 *   ① 卡上到底出现了哪几个字段、值从哪来(稿 §3 分派表逐屏点名);
 *   ② 出租率是**条 + 数**,不是原来那句 12px 灰字(稿 §1「我改了两处②」);
 *   ③ 宽档(tier !== 's')仍然是那张 <table>,一个节点都没动(RESPONSIVE-LAYOUT-SPEC §9 桌面零差异)。
 *
 * 为什么钉字段而不是快照:这三屏的卡片映射是逐屏手写的 #card 插槽,
 * 谁顺手删一格(比如把月租金挪走)版式照样渲染得出来,只是手机上又回到「一个钱字都没有」。
 * 快照会把这种退步当成「预期变更」一路 -u 过去,字段断言不会。
 *
 * 夹具口径:两行数必须一个满一个不满(出租率 100 / 62、月租金跨 10 万档、合同一份有日期一份待签约),
 * 否则「条宽跟着比值走」「格式跟着金额档走」写死常量也绿。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { readFileSync } from 'node:fs'
import { mediaBlock } from '@/test-utils/mediaBlock'
import { join } from 'node:path'

import BuildingsView from '@/views/buildings/BuildingsView.vue'
import TenantsView from '@/views/tenants/TenantsView.vue'
import ContractsView from '@/views/contracts/ContractsView.vue'
import { buildingApi } from '@/api/building'
import { tenantApi } from '@/api/tenant'
import { contractApi } from '@/api/contract'
import { _resetViewportForTest } from '@/composables/useViewport'

vi.mock('@/api/building', () => ({
  buildingApi: { list: vi.fn(), summary: vi.fn(), detail: vi.fn(() => Promise.resolve(null)) },
}))
vi.mock('@/api/tenant', () => ({
  tenantApi: {
    list: vi.fn(), summary: vi.fn(),
    categories: vi.fn(() => Promise.resolve([])),
    detail: vi.fn(() => Promise.resolve(null)),
  },
}))
vi.mock('@/api/contract', () => ({
  contractApi: { list: vi.fn(), summary: vi.fn(), detail: vi.fn(() => Promise.resolve(null)) },
}))
vi.mock('vue-router', () => ({
  useRoute: () => ({ query: {}, fullPath: '/x' }),
  useRouter: () => ({ push: vi.fn() }),
  RouterLink: { name: 'RouterLink', template: '<a><slot /></a>' },
}))

// ── 夹具 ────────────────────────────────────────────────────────────────
const BUILDINGS = [
  { id: 1, name: '2 号厂房', kind: '标准厂房', phase: 1, phaseName: '一期', floorCount: 3,
    unitCount: 8, occupiedCount: 8, totalArea: 9000, rentableArea: 8000, tenantBuildingArea: 7000,
    occRate: 100, monthlyRent: 162000, status: 1 },
  { id: 2, name: '5 号厂房', kind: '标准厂房', phase: 2, phaseName: '二期', floorCount: 2,
    unitCount: 8, occupiedCount: 5, totalArea: 6000, rentableArea: 5000, tenantBuildingArea: 4000,
    occRate: 62, monthlyRent: 92000, status: 0 },
]
const B_SUMMARY = { buildingCount: 2, unitCount: 16, rentableArea: 13000, occRate: 81, vacantCount: 3 }

const TENANTS = [
  { id: 1, companyName: '创显科技', contactName: null, contactPhone: null, businessType: '电子信息',
    status: 1, categoryId: null, phase: 1, since: null, monthlyRent: 128000, leasedArea: 300,
    primaryBuilding: '2 号厂房', contractCount: 3, parentId: null, parentName: null },
  { id: 2, companyName: '嘉华新材料', contactName: null, contactPhone: null, businessType: '新材料',
    status: 2, categoryId: null, phase: 2, since: null, monthlyRent: 46500, leasedArea: 120,
    primaryBuilding: null, contractCount: 1, parentId: null, parentName: null },
]
const T_SUMMARY = { tenantActive: 2, occRate: 81, monthlyRent: 174500, expiringTenants: 0 }

const CONTRACTS = [
  { id: 1, contractNo: 'FP-C-2024-001', tenantName: '创显科技', buildingName: '2 号厂房',
    floorInfo: '3F-301', rentArea: 300, monthlyRent: 128000, startDate: '2024-01-01',
    endDate: '2026-12-31', signDate: '2023-12-20', daysToEnd: 400, status: 'active',
    kind: 'normal', parentContractId: null, billingLineCount: 1, unboundTermCount: 0 },
  { id: 2, contractNo: 'FP-C-2025-014', tenantName: '嘉华新材料', buildingName: '5 号厂房',
    floorInfo: '2F-205', rentArea: 120, monthlyRent: 46500, startDate: null,
    endDate: null, signDate: null, daysToEnd: null, status: 'draft',
    kind: 'master_lease', parentContractId: null, billingLineCount: 0, unboundTermCount: 0 },
]
const C_SUMMARY = { total: 2, active: 1, expiring: 0, terminated: 0 }

/** S 档桩:只让 ≤600 命中。不打桩时 jsdom 原生 matchMedia 一律 false → tier='xl' = 宽档。 */
function asS() {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: q.includes('max-width: 600px'), media: q,
    addEventListener() {}, removeEventListener() {},
  }))
  _resetViewportForTest()
}

const opts = { global: { stubs: { Teleport: true, RouterLink: true, 'router-link': true } } }

function wire() {
  vi.mocked(buildingApi.list).mockResolvedValue(BUILDINGS as never)
  vi.mocked(buildingApi.summary).mockResolvedValue(B_SUMMARY as never)
  vi.mocked(tenantApi.list).mockResolvedValue(TENANTS as never)
  vi.mocked(tenantApi.summary).mockResolvedValue(T_SUMMARY as never)
  vi.mocked(contractApi.list).mockResolvedValue(CONTRACTS as never)
  vi.mocked(contractApi.summary).mockResolvedValue(C_SUMMARY as never)
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  sessionStorage.clear()
  vi.clearAllMocks()
  wire()
  // 楼栋屏默认视图是卡片墙(localStorage 记忆),行卡只在台账列表里
  localStorage.setItem('fp-bd-layout', '台账列表')
})
afterEach(() => { vi.unstubAllGlobals(); _resetViewportForTest() })

async function mountS(comp: unknown) {
  asS()
  const w = mount(comp as never, opts)
  await flushPromises()
  return w
}

describe('楼栋管理 · S 档行卡(稿 §1 / §3)', () => {
  it('❗第一行 = 楼栋名 + 月租金贴右端;金额走 fpWan,不是自写一套', async () => {
    const w = await mountS(BuildingsView)
    const l1 = w.findAll('.mx-rowcard .mx-rowcard-main')
    expect(l1).toHaveLength(2)
    // 默认排序 occRate desc → 100% 那栋在前
    expect(l1[0].find('.mx-rowcard-name').text()).toBe('2 号厂房')
    // 月租金在第一行**里面**(右端那一格),不是掉到第二行去了
    expect(l1[0].find('.mx-rowcard-money').text()).toBe('¥16万')      // fpWan(162000),≥10万 不带小数
    expect(l1[1].find('.mx-rowcard-name').text()).toBe('5 号厂房')
    expect(l1[1].find('.mx-rowcard-money').text()).toBe('¥9.2万')     // fpWan(92000),<10万 带一位
  })

  it('❗出租率是条 + 数,不是灰字;条宽跟着比值走、条色走桌面表那三档阈值', async () => {
    const w = await mountS(BuildingsView)
    const bars = w.findAll('.mx-rowcard .bd-occbar')
    expect(bars).toHaveLength(2)
    // OccBar 的内条:width = 出租率%,两行必须不同(夹具 100 / 62),写死常量当场红
    const fill = (i: number) => bars[i].find('div > div').attributes('style') ?? ''
    expect(fill(0)).toContain('width: 100%')
    expect(fill(1)).toContain('width: 62%')
    // 阈值沿用桌面表:≥90 蓝 / ≥75 灰蓝 / 其余橙 —— 两行落在不同档
    expect(fill(0)).toContain('var(--hue-blue)')
    expect(fill(1)).toContain('var(--hue-orange)')
    // 数那一格仍在(条不替代数),且不再有原来那句「出租率 X%」灰字
    const pct = w.findAll('.mx-rowcard .bd-occpct')
    expect(pct.map(p => p.text())).toEqual(['100%', '62%'])
    expect(w.text()).not.toContain('出租率 100%')
  })

  it('❗卡上五个字段一个不少:楼栋名 / 月租金 / 期数·n/N / 出租率 / 状态徽标', async () => {
    const w = await mountS(BuildingsView)
    const card = w.findAll('.mx-rowcard')[0]
    expect(card.find('.mx-rowcard-name').exists()).toBe(true)
    expect(card.find('.mx-rowcard-money').exists()).toBe(true)
    // 稿改后屏样逐字是「一期 · 8/8」——「在租」两字只出现在现状屏样里(图是规格)
    expect(card.find('.mx-rowcard-sub').text()).toContain('一期 · 8/8')
    expect(card.find('.mx-rowcard-sub').text(), '「在租」两字是现状屏样的写法,改后稿收掉了').not.toContain('在租')
    expect(card.find('.bd-occbar').exists()).toBe(true)
    // 状态徽标(FPContractStatus:status 1 → 执行中 / 0 → 已终止)在第二行末端
    expect(card.find('.mx-rowcard-sub').text()).toContain('执行中')
    expect(w.findAll('.mx-rowcard')[1].find('.mx-rowcard-sub').text()).toContain('已终止')
  })
})

describe('租户管理 · S 档行卡(稿 §3)', () => {
  it('❗第一行 = 租户名 + 月租金合计;第二行 = 所在楼栋 · 合同数 · 状态', async () => {
    const w = await mountS(TenantsView)
    const cards = w.findAll('.mx-rowcard')
    expect(cards).toHaveLength(2)
    const byName = (n: string) => cards.find(c => c.find('.mx-rowcard-name').text().includes(n))!
    const cx = byName('创显科技')
    expect(cx.find('.mx-rowcard-money').text()).toBe('¥128,000')      // fpMoney,千分位
    expect(cx.find('.mx-rowcard-sub').text()).toContain('2 号厂房')
    expect(cx.find('.mx-rowcard-sub').text()).toContain('合同 3')
    // 没有楼栋的那户落「—」,不是空白;金额档不同(46,500)证明格式不是写死的
    const jh = byName('嘉华新材料')
    expect(jh.find('.mx-rowcard-money').text()).toBe('¥46,500')
    expect(jh.find('.mx-rowcard-sub').text()).toContain('—')
    expect(jh.find('.mx-rowcard-sub').text()).toContain('合同 1')
  })
})

describe('合同管理 · S 档列表项(稿 §3)', () => {
  it('❗第二行在 S 档多一格起止日期;没签约的写「待签约」不写空', async () => {
    const w = await mountS(ContractsView)
    const ranges = w.findAll('.cl-l2 .cl-range')
    expect(ranges).toHaveLength(2)
    expect(ranges[0].text()).toBe('2024-01-01 → 2026-12-31')
    expect(ranges[1].text()).toBe('待签约')
    // 合同号与状态(含整租徽标)都还在同一行上,日期是加一格不是顶掉谁
    const l2 = w.findAll('.cl-l2')
    expect(l2[0].find('.cl-no').text()).toBe('FP-C-2024-001')
    expect(l2[1].find('.cl-master').text()).toBe('整租')
  })
})

describe('宽档零差异(RESPONSIVE-LAYOUT-SPEC §9)', () => {
  it('❗楼栋 / 租户在宽档仍渲染 <table>,一张行卡都不出', async () => {
    for (const comp of [BuildingsView, TenantsView]) {
      const w = mount(comp as never, opts)          // 不打桩 → tier='xl'
      await flushPromises()
      expect(w.find('table').exists()).toBe(true)
      expect(w.findAll('.mx-rowcard')).toHaveLength(0)
      expect(w.findAll('.mx-rowcard-money')).toHaveLength(0)
    }
  })

  it('❗合同屏宽档不出起止日期那一格(桌面 DOM 逐节点不变)', async () => {
    const w = mount(ContractsView as never, opts)
    await flushPromises()
    expect(w.findAll('.cl-item')).toHaveLength(2)
    expect(w.findAll('.cl-range')).toHaveLength(0)
  })
})

describe('分页条 pill(稿 §2 触达账)', () => {
  const css = readFileSync(join(__dirname, '../../styles/mx-list.css'), 'utf8').replace(/\r\n/g, '\n')
  // ≤600 **块内**。⚠ 不许写 slice(indexOf(...)):那只验到「写在 600 块之后的任意位置」,
  // 把 pill 规则挪出块外(全站桌面分页器跟着变 36 高)十条照样全绿 —— 实跑验证过。
  const sBlock = mediaBlock(css, '@media (max-width: 600px)')

  it('❗pill 在 S 档高 36 宽 26,且作用域锁死在 .mx-pagerbar 内', () => {
    expect(sBlock).toMatch(/\.mx-pagerbar \.ds-pg-pill \{[^}]*height: 36px !important/)
    expect(sBlock).toMatch(/\.mx-pagerbar \.ds-pg-pill \{[^}]*min-width: 26px !important/)
    // 高增宽收:宽不许也跟着涨(390 上放不下 4 个 32 宽的圆)
    expect(sBlock).not.toMatch(/\.ds-pg-pill \{[^}]*min-width: 3\dpx/)
    // 全文件里碰 .ds-pg-pill 的规则只有这一条,且必须以 .mx-pagerbar 打头 ——
    // 裸的 .ds-pg-pill 会让全站每个分页器都跟着变高
    const pillRules = (css.match(/[^\n{}]*\.ds-pg-pill[^\n{}]*\{/g) ?? []).map(s => s.trim())
    expect(pillRules).toHaveLength(1)
    expect(pillRules[0].startsWith('.mx-pagerbar ')).toBe(true)
  })

  it('❗跳页钮 36 高(与 pill 同排 → 分页条 36 + 8×2 = 52)', () => {
    expect(sBlock).toMatch(/\.mx-pagerbar \.fp-pager \.fp-jump-trigger \{ height: 36px; \}/)
    expect(sBlock).toMatch(/\.mx-pagerbar \{ padding: 8px 10px; \}/)
  })

  it('❗ds/Pagination 的桌面默认仍是 32 —— S 档的 36 是压过来的,不是改了组件', () => {
    const pg = readFileSync(join(__dirname, '../../components/ds/Pagination.vue'), 'utf8')
    expect(pg).toMatch(/pillBase = \{[^}]*height: "32px"/)
  })
})
