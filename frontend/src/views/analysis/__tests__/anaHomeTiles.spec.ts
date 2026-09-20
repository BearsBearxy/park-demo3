// src/views/analysis/__tests__/anaHomeTiles.spec.ts
// 分析层手机落地页「查一个数」的门禁(响应式稿 JourneyEntry 板)。
//
// 这一组要钉住三件,每一件都对应一个会静默坏掉的东西:
//  ① 三枚瓦的**值来自各屏已有的那个数**,不是这里另算一遍 —— 稿自己写死「不新算指标」。
//     所以断言不比「有个数字」,而是拿同一组纯函数在测里独立算一遍,两边逐字相等。
//  ② 落地页**只在 S 档当层首页** —— 桌面进分析层仍落 cockpit(稿 §1 不做③)。
//     判据落在 fpMobileHomeOf 上,两个手机组件共用它;`layer.home` 与登录落点一个字没动。
//  ③ 驾驶舱那边仍走**同一组**纯函数。这页的取值链是抄 CockpitView 的,
//     哪天驾驶舱换了公式而这里没跟,两个屏会对同一个月印出两个营收 —— 源码断言把它钉住。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { anchorMonth, atPnlPeriod, colPick, momOf, pnlYearMonths } from '../cockpit.logic'
import { buildRentRoll } from '../expiry.logic'
import { anaSettings, ANA_SETTINGS_DEFAULT } from '@/analysis/anaSettings'
import { FP_NAV, fpMobileHomeOf, ANA_MOBILE_HOME } from '@/nav/fpNav'
import type { ContractDTO } from '@/types/contract'

const push = vi.fn()
vi.mock('vue-router', () => ({
  useRouter: () => ({ push }),
  useRoute: () => ({ query: {}, meta: { value: ANA_MOBILE_HOME }, fullPath: '/ana-home' }),
}))

// ⚠ 夹具不许退化:
//  · revenue 12 个月两两不等,且 **usedMi 那一月必须不是最后一月** —— 否则「月锚取的是哪一月」
//    写死成 `length-1` 也绿;
//  · 9 月无数(null)→ 月锚要回落到 8 月,这正是 anchorMonth 存在的理由;
//  · 收缴率两个月不同,且都不等于目标 96,否则「距目标」写死也绿;
//  · 合同一份已到期、一份视界内到期,月租不同 —— expiringCount/RentSum 写死都会红。
// ⚠ 覆盖月**不从 1 月开始**(3–8 月)。从 1 开始的话 `months.length - 1` 恰好等于月锚算出的下标,
//   「月锚写死成最后一月」这种退步照样全绿 —— 2026-09-21 破坏验证实测到的退化夹具。
const REVENUE = [null, null, 98, 152, 141, 163, 149, -636, null, null, null, null].map(v => (v == null ? null : v * 10000))
const PNL = {
  year: 2026,
  months: [3, 4, 5, 6, 7, 8],
  revenue: REVENUE,
  // ⚠ cost/profit **不许按比例从 revenue 派生**:等比序列的环比与 revenue 逐位相等,
  //   「环比接成成本序列」这种接错线照样全绿(2026-09-21 破坏验证实测)。给一条自己的形状。
  cost: [null, null, 61, 70, 118, 96, 131, 88].concat([null, null, null, null]).map(v => (v == null ? null : v * 10000)),
  profit: [null, null, 37, 82, 23, 67, 18, -724].concat([null, null, null, null]).map(v => (v == null ? null : v * 10000)),
  bySchedule: {},
}
const COLLECTS = [
  { ym: '2026-07', receivable: 1000, collected: 900, rate: 90 },
  { ym: '2026-08', receivable: 1000, collected: 813, rate: 81.3 },
]

const today = new Date()
const iso = (d: Date) => d.toLocaleDateString('sv')
let seq = 0
function ct(p: Partial<ContractDTO>): ContractDTO {
  seq++
  return {
    id: seq, contractNo: 'HT' + seq, tenantId: seq, tenantName: '租户' + seq,
    buildingId: 1, buildingName: 'A栋', unitId: seq, floorInfo: '1F',
    rentArea: 0, monthlyRent: 1000, deposit: 0,
    startDate: iso(new Date(today.getFullYear() - 2, 0, 1)), endDate: null, signDate: null,
    status: 'active', termMonths: 0, daysToEnd: null, remark: null, ...p,
  }
}
const CONTRACTS: ContractDTO[] = [
  ct({ endDate: iso(new Date(today.getFullYear() - 1, today.getMonth(), 1)), monthlyRent: 5000 }),  // 已到期,不进视界
  ct({ endDate: iso(new Date(today.getFullYear(), today.getMonth() + 3, 1)), monthlyRent: 8000 }),  // 视界内
  ct({ endDate: iso(new Date(today.getFullYear(), today.getMonth() + 9, 1)), monthlyRent: 12000 }), // 视界内
]

vi.mock('@/analysis/anaData', () => ({
  fetchAvailableMonths: vi.fn(async () => ({
    months: ['2026-06', '2026-07', '2026-08'],
    sources: { pnl: ['2026-06', '2026-07', '2026-08'] },
  })),
  fetchPnlSummary: vi.fn(async () => PNL),
  fetchCollectRates: vi.fn(async () => COLLECTS),
  fetchContracts: vi.fn(async () => CONTRACTS),
  invalidateAnaCache: vi.fn(),
}))

import AnaHomeView from '../AnaHomeView.vue'
import { usePeriod, providePeriodMonths } from '@/analysis/usePeriod'

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  push.mockReset()
})
afterEach(() => { localStorage.clear() })

async function open() {
  const w = mount(AnaHomeView)
  await flushPromises(); await flushPromises()
  return w
}

const tileTexts = (w: Awaited<ReturnType<typeof open>>) =>
  w.findAll('.ah-tile').map(t => [t.find('.lb').text(), t.find('.vl').text(), t.find('.sb').text()])

describe('分析层落地页 · 三枚瓦的值来自各屏已有的那个数', () => {
  it('❗三枚瓦,逐枚与「拿同一组纯函数独立算一遍」的结果逐字相等', async () => {
    const w = await open()
    const p = usePeriod()
    // 期间单例落到有损益的最新月(2026-08);落地页读的就是这一期,不自己选
    expect(p.sel.value.gran).toBe('month')
    expect(p.ym.value).toBe('2026-08')

    const isMonth = true
    const usedMi = anchorMonth(PNL.months, p.sel.value.month) - 1
    // 8 月有损益 → 月锚就是 8 月,下标 7;而 PNL.months 只有 6 项(3–8 月),
    // `months.length - 1` 是 5 —— 两个数必须不等,否则「月锚写死成最后一月」这种退步不会红
    expect(usedMi).toBe(7)
    expect(usedMi).not.toBe(PNL.months.length - 1)
    const rev = atPnlPeriod(PNL.revenue, isMonth, usedMi, pnlYearMonths(PNL))
    const mom = momOf(PNL.revenue, isMonth, usedMi)
    const cp = colPick(COLLECTS, isMonth, p.sel.value.year, p.ym.value)
    const roll = buildRentRoll(CONTRACTS, iso(today), 12)

    expect(rev).not.toBeNull()
    expect(mom).not.toBeNull()
    expect(cp).not.toBeNull()

    const wan = (v: number) => (v < 0 ? '−¥' : '¥') + (Math.abs(v) / 10000).toFixed(1) + '万'
    const sgn = (v: number) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1) + '%'
    expect(tileTexts(w)).toEqual([
      ['本月营业收入', wan(rev!), `8 月 · 环比 ${sgn(mom!)}`],
      ['收缴率', cp!.rate.toFixed(1) + '%', `距目标 ${anaSettings.collectTarget}%`],
      ['未来12月到期', roll.expiringCount + ' 份', `涉及 ${wan(roll.expiringRentSum)}/月`],
    ])
    // 夹具不退化的自证:三枚瓦的值两两不同型,且到期那枚真的筛掉了已到期那份
    expect(roll.expiringCount).toBe(2)
    expect(roll.expiringRentSum).toBe(20000)
  })

  it('❗「距目标」读的是可改的那个设置,不是默认常量', async () => {
    // 那个目标在 AnaShell 设置弹层里可改、落 localStorage(anaSettings.ts:36 是 reactive 单例)。
    // 读 ANA_SETTINGS_DEFAULT 的话:用户调成 90 之后,落地页写「距目标 96%」而驾驶舱写 90
    // (CockpitView.vue:394)—— 同一个数两个屏两种说法。2026-09-21 破坏验证抓到的。
    const orig = anaSettings.collectTarget
    try {
      anaSettings.collectTarget = 90
      expect(anaSettings.collectTarget).not.toBe(ANA_SETTINGS_DEFAULT.collectTarget)
      const w = await open()
      expect(w.findAll('.ah-tile')[1].find('.sb').text()).toBe('距目标 90%')
    } finally { anaSettings.collectTarget = orig }
  })

  it('❗首版只有三枚 —— 取不到数的那三枚一枚都没硬凑出来', async () => {
    const w = await open()
    expect(w.findAll('.ah-tile')).toHaveLength(3)
    const txt = w.text()
    // 稿画的六枚里,这三枚的值在库里取不到(见组件头注释);屏上一个字都不该出现
    for (const ghost of ['在租租户', '本月发电', '本年电费', '自发自用']) {
      expect(txt, `${ghost} 取不到数,不许凭空出现在屏上`).not.toContain(ghost)
    }
    expect(txt).not.toMatch(/NaN|Infinity|undefined|null/)
  })

  it('❗骨架瓦与真瓦同一个定高类,数据落进来零位移', () => {
    const w = mount(AnaHomeView)       // 不 flush:停在未加载那一帧
    const skel = w.findAll('.ah-tile')
    expect(skel).toHaveLength(3)
    expect(skel.every(t => t.classes().includes('is-skel'))).toBe(true)
    const src = readFileSync(join(__dirname, '../AnaHomeView.vue'), 'utf8')
    expect(src).toMatch(/\.ah-tile \{[^}]*height: 88px/)
    expect(src.match(/\.ah-tile \{[^}]*min-height/), '定高改成 min-height 就不再零位移').toBeNull()
  })

  it('❗整枚瓦一个点击目标,点了 push 到那个屏(不带锚点 —— 卡级锚点全仓不存在)', async () => {
    const w = await open()
    const tiles = w.findAll('.ah-tile')
    expect(tiles.every(t => t.element.tagName === 'BUTTON')).toBe(true)
    expect(w.findAll('.ah-tile button, .ah-tile a')).toHaveLength(0)
    await tiles[2].trigger('click')
    expect(push).toHaveBeenCalledWith('/expiry')
    await tiles[1].trigger('click')
    expect(push).toHaveBeenLastCalledWith('/cockpit')
    // 副行写口径与方向,不写「点击查看」(稿 §1 蓝框第 2 条)
    expect(w.text()).not.toContain('点击')
  })

  it('❗搜索框 48 高 / 16px 字,且 placeholder 只写它真能搜的', async () => {
    const w = await open()
    const src = readFileSync(join(__dirname, '../AnaHomeView.vue'), 'utf8')
    const rule = src.match(/\.ah-search \{[^}]*\}/)![0]
    expect(rule).toMatch(/height: 48px/)
    expect(rule).toMatch(/font-size: 16px/)
    // 命令面板索引的是屏名与分组名(CommandPalette.vue:77),没有楼栋 / 租户 ——
    // 写「搜楼栋 / 租户」就是屏上说谎(稿那句要给面板加数据源,是另一件活)
    const ph = w.find('.ah-search span').text()
    expect(ph).toContain('搜一个数')
    expect(ph, '命令面板搜不了楼栋 / 租户,别在 placeholder 里许这个愿').not.toMatch(/楼栋|租户/)
  })
})

describe('分析层落地页 · 只在 S 档当层首页(桌面不动)', () => {
  const ANA = FP_NAV.find(L => L.id === 'analysis')!

  it('❗手机进分析层落 ana-home,其余层照旧落各自的 layer.home', () => {
    expect(fpMobileHomeOf(ANA)).toBe(ANA_MOBILE_HOME)
    for (const L of FP_NAV.filter(x => x.id !== 'analysis')) {
      expect(fpMobileHomeOf(L), `${L.id} 层不该被改落点`).toBe(L.home)
    }
  })

  it('❗桌面口径一个字没动:analysis 层的 home 仍是 cockpit', () => {
    expect(ANA.home).toBe('cockpit')
    // 登录落点(navAccess)也不许被顺手改
    const acc = readFileSync(join(__dirname, '../../../nav/navAccess.ts'), 'utf8')
    expect(acc).not.toContain(ANA_MOBILE_HOME)
  })

  it('❗两个手机组件都走 fpMobileHomeOf,不各判各的', () => {
    for (const rel of ['../../../components/shell/mobile/MobileBottomNav.vue',
      '../../../components/shell/mobile/MobileNavDrawer.vue']) {
      const src = readFileSync(join(__dirname, rel), 'utf8')
      expect(src, `${rel} 没走 fpMobileHomeOf`).toContain('fpMobileHomeOf(layer)')
      // 反向:别在这两个文件里留着旧的 layer.home 跳转(两条路会漂)
      expect(src.match(/router\.push\('\/' \+ layer\.home\)/), `${rel} 还留着 layer.home 那条老路`).toBeNull()
    }
  })

  it('❗落地页不进导航 —— 进了桌面侧栏就会多一条谁也点不开的屏', () => {
    const inNav = FP_NAV.some(L => L.sections.some(s => s.items.some(i => i.value === ANA_MOBILE_HOME)))
    expect(inNav, 'ana-home 不该出现在 FP_NAV 里').toBe(false)
  })
})

describe('分析层落地页 · 取值链与驾驶舱同源', () => {
  const HOME_SRC = readFileSync(join(__dirname, '../AnaHomeView.vue'), 'utf8')
  const CP_SRC = readFileSync(join(__dirname, '../CockpitView.vue'), 'utf8')

  it('❗营收与收缴率的公式两边是同一组纯函数(驾驶舱改了公式,这条会红)', () => {
    // 这页的取值链是抄 CockpitView 的。没有这条断言,驾驶舱换了公式而这里没跟时,
    // 两个屏会对同一个月印出两个不同的营收 —— 而两边各自的断言都还是绿的。
    for (const fn of ['anchorMonth', 'atPnlPeriod', 'momOf', 'pnlYearMonths', 'colPick']) {
      expect(HOME_SRC, `落地页没用 ${fn}`).toContain(fn)
      expect(CP_SRC, `驾驶舱不再用 ${fn} —— 公式换了,落地页要跟着换`).toContain(fn)
    }
    // 驾驶舱的营收/收缴率仍是这两行的形状(换了入参顺序或换了数组,这里会红)
    expect(CP_SRC).toMatch(/atPnlPeriod\(pnl\.value\?\.revenue, isMonth\.value, usedMi\.value/)
    expect(CP_SRC).toMatch(/colPick\(collects\.value, isMonth\.value, year\.value, period\.ym\.value\)/)
  })

  it('❗落地页自己不算指标:除那五个纯函数外没有第二套算式', () => {
    // 稿硬约束:「值全部取自各屏已有的 KPI 瓦 / 结论条,不新算指标」。
    // 判据取「没有 reduce / 没有 Math.round 在取值链上」—— 真要新算一个指标,绕不开它们。
    const script = HOME_SRC.slice(0, HOME_SRC.indexOf('</script>'))
    expect(script, '出现了 reduce:那多半是在这页现算一个指标').not.toMatch(/\.reduce\(/)
  })
})
