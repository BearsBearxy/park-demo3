/**
 * 平板档(M,601–960)列表页排布门禁 —— 响应式稿 TabletContent 板 §①。
 *
 * 平板 = 小桌面(2026-09-20 用户拍板②):M 档保留表格、**一列都不删**,
 * 只收工具行与列宽。所以这里每条都成对断言 M 与 XL 两档 ——
 * 只断一档等于没断:把档位判定写成恒真(永远 10px / 永远「可租 ㎡」)时,
 * 单档断言照样全绿,桌面 1440 却被改掉了(RESPONSIVE-LAYOUT-SPEC §9 零差异)。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mediaBlock } from '@/test-utils/mediaBlock'

import FPSortableTable from '@/components/fp/FPSortableTable.vue'
import BuildingsView from '@/views/buildings/BuildingsView.vue'
import { buildingApi } from '@/api/building'
import { _resetViewportForTest } from '@/composables/useViewport'

vi.mock('@/api/building', () => ({
  buildingApi: { list: vi.fn(), summary: vi.fn(), detail: vi.fn(() => Promise.resolve(null)) },
}))
vi.mock('vue-router', () => ({
  useRoute: () => ({ query: {}, fullPath: '/x' }),
  useRouter: () => ({ push: vi.fn() }),
  RouterLink: { name: 'RouterLink', template: '<a><slot /></a>' },
}))

// 夹具:两栋,出租率一满一不满(100 / 62),证明条宽不是写死的
const BUILDINGS = [
  { id: 1, name: '2 号厂房', kind: '标准厂房', phase: 1, phaseName: '一期', floorCount: 3,
    unitCount: 8, occupiedCount: 8, totalArea: 9000, rentableArea: 8000, tenantBuildingArea: 7000,
    occRate: 100, monthlyRent: 162000, status: 1 },
  { id: 2, name: '5 号厂房', kind: '标准厂房', phase: 2, phaseName: '二期', floorCount: 2,
    unitCount: 8, occupiedCount: 5, totalArea: 6000, rentableArea: 5000, tenantBuildingArea: 4000,
    occRate: 62, monthlyRent: 92000, status: 0 },
]
const B_SUMMARY = { buildingCount: 2, unitCount: 16, rentableArea: 13000, occRate: 81, vacantCount: 3 }

/** M 档桩:960/1280 命中、600 不命中 → useViewport 判 tier='m'(平板)。 */
function asM() {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: q.includes('max-width: 960px') || q.includes('max-width: 1280px'),
    media: q, addEventListener() {}, removeEventListener() {},
  }))
  _resetViewportForTest()
}

const opts = { global: { stubs: { Teleport: true, RouterLink: true, 'router-link': true } } }

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  vi.clearAllMocks()
  vi.mocked(buildingApi.list).mockResolvedValue(BUILDINGS as never)
  vi.mocked(buildingApi.summary).mockResolvedValue(B_SUMMARY as never)
  // 楼栋屏默认视图是卡片墙(localStorage 记忆);表格只在台账列表里
  localStorage.setItem('fp-bd-layout', '台账列表')
})
afterEach(() => { vi.unstubAllGlobals(); _resetViewportForTest() })

async function mountBuildings(m: boolean) {
  if (m) asM()                       // 不打桩 → jsdom matchMedia 恒 false → tier='xl'
  const w = mount(BuildingsView as never, opts)
  await flushPromises()
  return w
}

// ── §① delta 行4:工具行两行,且行组成静态确定 ─────────────────────────
describe('工具行 M 档两行(稿 §① delta 行4)', () => {
  // 注释一起读进来的话,下面「不许出现 grid-template-rows」会被注释里引用它的那句话命中 ——
  // 注释不产生任何规则,先剥掉(同 finStickyS.spec 的 STYLE 取法)。
  const css = readFileSync(join(__dirname, '../../styles/mx-list.css'), 'utf8')
    .replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '')
  const mBlock = mediaBlock(css, '@media (max-width: 960px)')

  it('❗M 档 .mx-toolbar 是 grid 两行,不是靠 flex-wrap 撞出来的', () => {
    expect(mBlock, 'mx-list.css 缺 ≤960 块').not.toBe('')
    expect(mBlock).toMatch(/\.mx-toolbar \{[^}]*display: grid/)
    // 单列:行数由子节点个数定死,内容长短改不了它
    expect(mBlock).toMatch(/\.mx-toolbar \{[^}]*grid-template-columns: 1fr/)
    // 反向:M 块里不许再出现 flex-wrap —— 一旦回到 wrap,行数又跟着胶囊计数位数跳
    expect(mBlock).not.toMatch(/flex-wrap/)
    // ⚠ 也不许写死 grid-template-rows:显式第二轨在只有一个子节点时照样生成,
    //   白吃一份 12px row-gap(SystemLogs / SystemUsers / ElecCost 三屏实测工具行高 23 → 35)。
    expect(mBlock, '显式两轨会给单子节点的工具行凭空加一条 12px 缝').not.toMatch(/grid-template-rows/)

    // grid 项默认 justify-self:stretch,而 flex 项 hug 内容。这三条缺一条就出实测过的版式坏:
    //   缺 justify-items:start  → .fp-phasetabs 那条 999px 圆角灰底铺满整行(实测 91 → 642)
    //   缺 .mx-toolbar-right 贴右 → 右组从贴右变贴左(实测 left 557 → 0),撞 LIST-PAGE-SPEC §2
    //   缺 :empty 那条         → 三屏靠「空占位 + space-between」的写法凭空多一行 + 12px 缝
    expect(mBlock).toMatch(/\.mx-toolbar \{[^}]*justify-items: start/)
    expect(mBlock).toMatch(/\.mx-toolbar-right \{[^}]*justify-self: end/)
    expect(mBlock).toMatch(/\.mx-toolbar > :empty \{[^}]*display: none/)
  })

  it('❗960 块与两个 1100 存量豁免块零选择器重叠(它写在它们前面,重叠就会被盖)', () => {
    // mx-list.css 里 960 块(:23)排在两个 1100 块(:99/:133)**之前** —— 与「宽档在前窄档在后」
    // 相反。今天不出事只因为两边选择器不沾边。这条把那个前提钉住:谁往两边加了同一个选择器,
    // 960 的那份会被 1100 静默盖掉(1100 在 601–960 同样命中)。
    const sels = (blk: string) =>
      new Set(blk.split('}').map(part => {
        const at = part.indexOf('{')
        return at < 0 ? '' : part.slice(0, at).trim()
      }).filter(Boolean))
    const m = sels(mBlock)
    const wide = [...sels(mediaBlock(css, '@media (max-width: 1100px)'))]
    // 文件里有两个 1100 块,mediaBlock 只取第一个 —— 第二个单独再取一次
    const rest = css.slice(css.indexOf('@media (max-width: 1100px)') + 10)
    const wide2 = [...sels(mediaBlock(rest, '@media (max-width: 1100px)'))]
    const dup = [...wide, ...wide2].filter(x => m.has(x))
    expect(dup, `960 与 1100 块共用了选择器,960 那份会被静默盖掉:${dup.join(' / ')}`).toEqual([])
    expect(m.size, '960 块空了?').toBeGreaterThan(0)
    expect(wide.length + wide2.length, '1100 块空了?').toBeGreaterThan(0)
  })

  it('❗XL 档仍是单行 flex(§9 桌面零差异):基线规则一个字没动', () => {
    expect(css).toMatch(
      /\.mx-toolbar \{ display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; \}/,
    )
  })
})

// ── §① delta 行5:td padding 16 → 10(共用组件,两档都断) ───────────────
describe('FPSortableTable td padding(稿 §① delta 行5)', () => {
  const COLS = [
    { key: 'a', header: '甲' },
    { key: 'b', header: '乙', align: 'right' as const },
  ]
  const ROWS = [{ id: 1, a: 'x', b: 'y' }]

  function mountTable(m: boolean) {
    if (m) asM()
    return mount(FPSortableTable, { props: { columns: COLS, rows: ROWS, skeletonRows: 1 }, ...opts })
  }

  it('❗M 档 td/th 收到 10px,表头与表体同档(不同档会错列)', () => {
    const w = mountTable(true)
    expect(w.find('table').exists(), 'M 档是平板=小桌面,必须仍然是表格').toBe(true)
    for (const td of w.findAll('tbody td')) {
      expect((td.element as HTMLElement).style.padding).toBe('0px 10px')
    }
    for (const th of w.findAll('thead th')) {
      expect((th.element as HTMLElement).style.padding).toBe('0px 10px 10px')
    }
  })

  it('❗XL 档仍是 16px —— 档位判定不是恒真表达式', () => {
    const w = mountTable(false)
    for (const td of w.findAll('tbody td')) {
      expect((td.element as HTMLElement).style.padding).toBe('0px 16px')
    }
    for (const th of w.findAll('thead th')) {
      expect((th.element as HTMLElement).style.padding).toBe('0px 16px 10px')
    }
  })

  it('❗骨架行与数据行同 padding(两档各自对齐,精确占位口径)', () => {
    for (const [m, px] of [[true, '0px 10px'], [false, '0px 16px']] as const) {
      const w = mountTable(m)
      const tds = w.findAll('tbody td')
      // skeletonRows:1 + ROWS:1 → 骨架 2 格 + 数据 2 格
      expect(tds).toHaveLength(4)
      expect(tds.every(td => (td.element as HTMLElement).style.padding === px)).toBe(true)
      vi.unstubAllGlobals(); _resetViewportForTest()
    }
  })
})

// ── §① delta 行6/行7 + 黄框:表头写法、条宽、列数 ────────────────────
describe('楼栋管理 M 档列宽压缩(稿 §① delta 行6 / 行7 / 黄框)', () => {
  const headers = (w: ReturnType<typeof mount>) => w.findAll('thead th').map(th => th.text().replace(/[↑↓↕]/g, '').trim())
  // 出租率格:render 里第一段 span 带 min-width(条),第二段是 40px 的数
  const barStyle = (w: ReturnType<typeof mount>) => {
    const td = w.findAll('tbody tr:last-child td')[7]
    const bar = td.findAll('span').find(s => (s.attributes('style') ?? '').includes('min-width'))
    return bar?.attributes('style') ?? ''
  }

  it('❗M 档表头是「可租 ㎡」、条 36;数字列 40 与百分数不动', async () => {
    const w = await mountBuildings(true)
    expect(headers(w)).toContain('可租 ㎡')
    expect(headers(w)).not.toContain('可租面积 ㎡')
    expect(barStyle(w)).toContain('min-width: 36px')
    const td = w.findAll('tbody tr:last-child td')[7]
    // 右侧数字列:宽 40 不变,百分数照旧(夹具第二行 62%)
    expect(td.text()).toBe('62%')
    expect(td.html()).toContain('width: 40px')
  })

  it('❗XL 档表头仍是「可租面积 ㎡」、条仍 54(桌面 1440 零差异)', async () => {
    const w = await mountBuildings(false)
    expect(headers(w)).toContain('可租面积 ㎡')
    expect(headers(w)).not.toContain('可租 ㎡')
    expect(barStyle(w)).toContain('min-width: 54px')
    expect(w.findAll('tbody tr:last-child td')[7].text()).toBe('62%')
  })

  it('❗反向:两档列数相同,一列都不删(稿 §① 黄框)', async () => {
    const wm = await mountBuildings(true)
    const mHeaders = headers(wm)
    vi.unstubAllGlobals(); _resetViewportForTest()
    const wx = await mountBuildings(false)
    const xHeaders = headers(wx)
    expect(mHeaders).toHaveLength(10)          // TABLE_COLUMNS 现有 10 列
    expect(mHeaders.length).toBe(xHeaders.length)
    // 换写法的只有「可租」那一列,其余九个表头逐字相同
    const diff = xHeaders.filter((h, i) => h !== mHeaders[i])
    expect(diff).toEqual(['可租面积 ㎡'])
    // 列数 = 每行格子数:M 档行里的 td 也是 10 个(没有靠隐藏列省宽)
    expect(wm.findAll('tbody tr:last-child td')).toHaveLength(10)
  })
})

// ── §① delta 行3:期区胶囊 34 → 32(只 M 档) ─────────────────────────
describe('FPPhaseTabs 胶囊高(稿 §① delta 行3)', () => {
  const sfc = readFileSync(join(__dirname, '../../components/fp/FPPhaseTabs.vue'), 'utf8').replace(/\r\n/g, '\n')

  it('❗基线 34、M 档 32、S 档退回 34', () => {
    expect(sfc).toMatch(/\.fp-phasetab \{[^}]*height: 34px/)                      // XL/L 不变
    expect(mediaBlock(sfc, '@media (max-width: 960px)')).toMatch(/\.fp-phasetab \{ height: 32px; \}/)
    expect(mediaBlock(sfc, '@media (max-width: 600px)')).toMatch(/\.fp-phasetab \{ height: 34px; \}/)
  })

  it('❗整组触达 40 = 32 + 外框 padding 4×2(稿的算法)', () => {
    expect(sfc).toMatch(/\.fp-phasetabs \{[^}]*padding: 4px/)
  })
})
