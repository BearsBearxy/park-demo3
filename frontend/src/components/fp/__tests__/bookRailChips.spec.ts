import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import BookRailShell from '../BookRailShell.vue'
import BookRail from '../BookRail.vue'
import PvView from '@/views/pv/PvView.vue'
import ElecView from '@/views/elec/ElecView.vue'
import { pvApi } from '@/api/pv'
import { pvMeterApi } from '@/api/pvMeter'
import { elecApi } from '@/api/elec'
import { useAuthStore } from '@/stores/auth'

/**
 * BookRailShell 的 ≤960 左轨收 chips(RESPONSIVE-LAYOUT-SPEC §5.6 第 1 类)。
 *
 * 这是**共用件**:一个组件喂 4 个屏(附表6 光伏 / 附表7·8 充电桩 / 附表11 电费),
 * 改坏一处四屏同坏 —— 所以下面既挂空壳,也挂两个真实调用点。
 *
 * ⚠ jsdom 不跑媒体查询、也不跑 scoped 样式:**档位差异只能读 CSS 字面量断**,
 *   DOM 侧两档同构(轨与 chips 都在 DOM 里,谁显谁隐由 CSS 定)。
 *   把「S 档 chips 出来」写成 DOM 断言的话,它在 XL 档也绿 —— 那是恒真,不是判据。
 */

const SRC = readFileSync(join(__dirname, '..', 'BookRailShell.vue'), 'utf8')

/**
 * 取 `@media (...)` 那一块的块内文本(花括号配对,不按行号切)。
 * ⚠ 找不到就返回空串,**不 throw**:模块级 throw 会让整个文件收集失败,
 *   而收集失败的 json 是 `numTotalTests:0 / numFailedTests:0` —— 只看 numFailedTests 的管道判它绿。
 *   (删掉媒体块跑一遍就是这个下场,实测过。)空串让下面每条断言各自红。
 */
function mediaBlock(src: string, header: string): string {
  const at = src.indexOf(header)
  if (at < 0) return ''
  let i = src.indexOf('{', at), depth = 0
  const from = i
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}' && --depth === 0) return src.slice(from + 1, i)
  }
  return ''
}

const M_BLOCK = mediaBlock(SRC, '@media (max-width: 960px)')

describe('BookRailShell · 档位几何(读 CSS 字面量)', () => {
  it('❗XL 档一个像素不动 —— .brs-rail 仍是 flex:0 0 176px,且这条在任何 @media 之外', () => {
    const rail = SRC.slice(SRC.indexOf('.brs-rail {'))
    expect(rail.slice(0, rail.indexOf('}')), '宽档轨宽被改了 = 桌面 1440 出现差异')
      .toContain('flex: 0 0 176px')
    // 宽档那条必须在第一个 @media 之前:挪进媒体块里就不是「桌面原样」了
    expect(SRC.indexOf('flex: 0 0 176px')).toBeLessThan(SRC.indexOf('@media'))
    // 宽档 chips 不存在(display:none),且这条写在窄档块之前 —— CSS 顺序铁律,写反是静默失效
    expect(SRC.indexOf('.brs-chips { display: none; }')).toBeLessThan(SRC.indexOf('@media'))
  })

  it('❗M/S 档(≤960):轨收掉、chips 出来 —— 两条都在同一个媒体块里', () => {
    expect(M_BLOCK, '轨没收掉:390 上主区只剩 166px 就是这条没写').toMatch(/\.brs-rail\s*\{\s*display:\s*none;?\s*\}/)
    expect(M_BLOCK, 'chips 没显出来 = 窄档一个选择器都没有').toMatch(/\.brs-chips\s*\{[^}]*display:\s*flex/)
    expect(M_BLOCK, 'chips 排不下要能横滚').toMatch(/\.brs-chips\s*\{[^}]*overflow-x:\s*auto/)
    expect(M_BLOCK, '外层没转成竖排,chips 会和主区并排挤在一行').toMatch(/\.brs\s*\{[^}]*flex-direction:\s*column/)
  })

  it('chip 的几何钉死:定高 36px、圆角胶囊、不换行', () => {
    const chip = M_BLOCK.slice(M_BLOCK.indexOf('.brs-chip {'))
    const decl = chip.slice(0, chip.indexOf('}'))
    expect(decl).toContain('height: 36px')
    expect(decl).toContain('border-radius: var(--radius-full)')
    expect(decl).toContain('white-space: nowrap')
    // 选中态只换色不改尺寸(LAYOUT-STABILITY 铁律):.on 里不许出现任何改尺寸的声明。
    // ⚠ 不许写 `slice(indexOf('.brs-chip.on'))`:规则被整条删掉时 indexOf 返回 -1,
    //   slice(-1) 取到最后一个字符、indexOf('}') 又是 -1,最后 not.toMatch 在空串上恒真 ——
    //   也就是「窄档选中态静默消失(手机上看不出点了哪一本账)」这条拦不住
    //   (2026-09-21 对抗复查实跑:整条 .brs-chip.on 删掉,12 条全绿)。
    //   先断规则真的匹配到,再判它的声明串。
    const on = M_BLOCK.match(/\.brs-chip\.on\s*\{([^}]*)\}/)
    expect(on, '窄档 chips 的选中态规则不见了 —— 手机上看不出选的是哪一本账').not.toBeNull()
    expect(on![1], '选中态改了尺寸 = 点一下整行位移')
      .not.toMatch(/height|padding|border-width|font-size/)
    // 正向:它必须真的换了色(只有「不改尺寸」是空规则也满足)
    expect(on![1]).toMatch(/color|background|border-color/)
  })

  it('❗断点只许 600/960/1280 —— 本文件实际只用了 960', () => {
    const widths = [...SRC.matchAll(/max-width:\s*(\d+)px/g)].map(m => m[1])
    expect(widths.length, '一条 @media 都没有 = 这轮改动没落地').toBeGreaterThan(0)
    expect([...new Set(widths)]).toEqual(['960'])
  })
})

describe('BookRailShell · chips 接线', () => {
  const BOOKS = [
    { id: 'summary', name: '报送台账', desc: '按期 · 按月' },
    { id: 'meter', name: '分栋运营账', desc: '按栋 · 按日' },
  ] as const
  const shell = (activeId: string) =>
    mount(BookRailShell, { props: { title: '光伏发电', books: BOOKS, activeId } })

  it('每本账一颗 chip,文案就是轨上那个名字', () => {
    const chips = shell('summary').findAll('.brs-chip')
    expect(chips).toHaveLength(2)
    expect(chips.map(c => c.text())).toEqual(['报送台账', '分栋运营账'])
  })

  it('❗点 chip 和点轨发的是同一个 select 事件(宿主只有一条处理路径)', async () => {
    const w = shell('summary')
    await w.findAll('.brs-chip')[1].trigger('click')
    expect(w.emitted('select')?.[0]).toEqual(['meter'])
    // 轨上点同一本,事件载荷逐字相同 —— 两条入口分叉的话下面这条会不一样
    const r = shell('summary')
    await r.findAll('.br-item')[1].trigger('click')
    expect(r.emitted('select')?.[0]).toEqual(['meter'])
  })

  it('选中的那颗带 .on 与 aria-pressed(读屏器也要知道在哪本)', () => {
    const chips = shell('meter').findAll('.brs-chip')
    expect(chips[0].classes()).not.toContain('on')
    expect(chips[1].classes()).toContain('on')
    expect(chips.map(c => c.attributes('aria-pressed'))).toEqual(['false', 'true'])
  })
})

describe('BookRailShell · can-manage 两面都断', () => {
  const BOOKS = [{ id: 1, name: 'A' }, { id: 2, name: 'B' }] as const

  it('❗canManage=false:轨上没有管理钮,chips 也不画那颗虚线 chip', () => {
    const w = mount(BookRailShell, { props: { title: 'T', books: BOOKS, activeId: 1 } })
    // 先证明选择器真的选得到东西 —— 选错了的话下面三条 filter 恒为空,整条恒真
    expect(w.findAll('.brs-chip'), 'chips 一颗都没渲染,下面的「没有管理 chip」就成了恒真').toHaveLength(2)
    expect(w.findAll('.br-item'), '轨一项都没渲染,下面的「没有管理钮」就成了恒真').toHaveLength(2)
    expect(w.findAll('.brs-chip.mng')).toHaveLength(0)
    expect(w.find('.br-create').exists(), 'canManage=false 却画出了新增钮').toBe(false)
    expect(w.find('.br-delete').exists(), 'canManage=false 却画出了删除钮').toBe(false)
    // 不画虚线 chip 的理由钉在源码里:本壳写死 can-manage=false。哪天它变成可传的,这条会红,
    // 提醒一起补 chips 侧的管理入口(否则窄档下管理功能会凭空消失)。
    // ⚠ 不能只 toContain(':can-manage="false"') —— 上面的注释里也有这一串,binding 改了照样绿。
    //   钉的是 <BookRail 标签本身那条绑定。
    expect(SRC.slice(SRC.indexOf('<BookRail ')), '本壳的轨不再写死 can-manage=false')
      .toMatch(/^<BookRail [^>]*:can-manage="false"/)
  })

  it('❗canManage=true 时管理钮确实出得来 —— 上一条的「没有」不是选择器写错', () => {
    const w = mount(BookRail, { props: { books: BOOKS, activeId: 1, canManage: true } })
    expect(w.find('.br-create').exists()).toBe(true)
    expect(w.find('.br-delete').exists()).toBe(true)
  })
})

// ── 真实调用点:共用件改一处,四个屏(附表6 / 7·8 / 11)同变 ───────────────
vi.mock('@/api/pv', () => ({
  pvApi: {
    overview: vi.fn(), records: vi.fn(), phases: vi.fn(),
    create: vi.fn(), remove: vi.fn(), batchDelete: vi.fn(),
    clearImported: vi.fn(), updateNote: vi.fn(),
  },
}))
vi.mock('@/api/pvMeter', () => ({
  pvMeterApi: {
    stations: vi.fn(), readings: vi.fn(), months: vi.fn(), years: vi.fn(),
    createReading: vi.fn(), updateReading: vi.fn(), deleteReading: vi.fn(),
    createStation: vi.fn(), updateStation: vi.fn(), deleteStation: vi.fn(), simulate: vi.fn(),
  },
}))
vi.mock('@/api/elec', () => ({
  elecApi: {
    overview: vi.fn(), records: vi.fn(), phases: vi.fn(),
    create: vi.fn(), remove: vi.fn(), batchDelete: vi.fn(),
    clearImported: vi.fn(), updateNote: vi.fn(), importRows: vi.fn(),
  },
}))
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useRoute: () => ({ query: {}, fullPath: '/' }),
}))

beforeEach(() => {
  setActivePinia(createPinia())
  useAuthStore().permissions = ['entry:edit', 'meter-master:edit', 'meter-reading:edit']
  vi.clearAllMocks()
  localStorage.clear()
  vi.mocked(pvApi.overview).mockResolvedValue({ currentYear: 2025, years: [] } as never)
  vi.mocked(pvApi.phases).mockResolvedValue([] as never)
  vi.mocked(pvMeterApi.stations).mockResolvedValue([] as never)
  vi.mocked(pvMeterApi.readings).mockResolvedValue([] as never)
  vi.mocked(pvMeterApi.months).mockResolvedValue([])
  vi.mocked(elecApi.overview).mockResolvedValue({ currentYear: 2025, years: [] } as never)
  vi.mocked(elecApi.phases).mockResolvedValue([] as never)
})

describe('真实调用点没被改坏', () => {
  it.each([
    [PvView, ['报送台账', '分栋运营账']],
    [ElecView, ['报送台账', '园区电费模型']],
  ])('%# 号屏:轨与 chips 同时在 DOM 里,文案同源、选中同步', async (View, names) => {
    const w = mount(View, { global: { stubs: { Teleport: true } } })
    await flushPromises()
    expect(w.findAll('.br-item').map(i => i.find('.br-name').text()), '轨没了').toEqual(names)
    expect(w.findAll('.brs-chip').map(c => c.text()), 'chips 没落到这屏').toEqual(names)
    // 默认落在第一本:两条入口的选中态必须同步,分叉了就是「点轨改了、点 chip 没改」
    expect(w.findAll('.br-item')[0].classes()).toContain('on')
    expect(w.findAll('.brs-chip')[0].classes()).toContain('on')
    expect(w.findAll('.brs-chip')[1].classes()).not.toContain('on')
  })

  it('❗点 chip 真的换了本账(光伏:换到分栋运营账,月卡画出来 12 张)', async () => {
    const w = mount(PvView, { global: { stubs: { Teleport: true } } })
    await flushPromises()
    await w.findAll('.brs-chip')[1].trigger('click')
    await flushPromises()
    // 判据用真画出来的月卡,不用容器 div —— 容器在转圈那一支也在(twoBooksRail.spec:98 的教训)
    expect(w.findAll('.bmm-card').length, '零数据也该给出当前年一行 12 张空月卡').toBe(12)
    expect(w.findAll('.brs-chip')[1].classes()).toContain('on')
    expect(w.findAll('.br-item')[1].classes(), '轨的选中态也要跟上').toContain('on')
  })
})
