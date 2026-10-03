import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { reactive } from 'vue'
import S10Table from './S10Table.vue'
import { rowsNotEndingInFill, stubWideTable } from '@/composables/__tests__/wideTableStub'
import { LAYOUTS, leavesOf, type Group } from './layout'
import { _resetViewportForTest } from '@/composables/useViewport'
import type { S10RecordDTO, S10ColId } from '@/types/s10'

// 版面现由账册模板驱动(props.groups = toS10Layout(book.definition));
// 旧 layout.ts 的 OFFICE/FACTORY 常量与模板种子同形,这里继续当测试夹具用。
// 构造一行:给定版面的所有列填 0,再覆盖几列。
function makeRow(layout: 'office' | 'factory', over: Partial<Record<string, number>>, extra: Partial<S10RecordDTO> = {}): S10RecordDTO {
  const zeros = Object.fromEntries(leavesOf(layout).map(l => [l.colId, 0]))
  return {
    id: 1, tenantId: 1, tenantName: 'T', phase: 1, profile: 'factory',
    note: null, source: 'seed', total: 0,
    ...zeros, ...over, ...extra,
  } as unknown as S10RecordDTO
}

describe('S10Table 两级表头 / 模板驱动版面', () => {
  it('office 版面渲染全部 25 个叶子子列 + 分组表头', () => {
    const w = mount(S10Table, {
      props: { groups: LAYOUTS.office, phaseName: '一期厂房', year: 2026, month: 6, rows: [makeRow('office', {})], edit: false },
    })
    // 叶子子列 = 多叶子组的 .s10-h-sub
    const subs = w.findAll('th.s10-h-sub').length
    // 独立叶子（leaf 组）渲染为 .s10-h-leaf（空地租金 / 其他费用 = 2 个）
    const leafCols = w.findAll('th.s10-h-leaf').length
    expect(subs + leafCols).toBe(leavesOf('office').length) // 25
    expect(leafCols).toBe(2)
    // 分组表头存在（含 MON→月份替换）
    expect(w.text()).toContain('6月电费')
    expect(w.text()).toContain('6月水费')
  })

  it('factory 版面渲染 20 个叶子（无办公室/保障房列）', () => {
    const w = mount(S10Table, {
      props: { groups: LAYOUTS.factory, phaseName: '二期厂房', year: 2026, month: 6, rows: [makeRow('factory', {})], edit: false },
    })
    const subs = w.findAll('th.s10-h-sub').length
    const leafCols = w.findAll('th.s10-h-leaf').length
    expect(subs + leafCols).toBe(leavesOf('factory').length) // 20
    // 无办公室租金列、无保障房列
    expect(w.text()).not.toContain('办公室租金')
    expect(w.text()).not.toContain('保障房')
  })

  it('模板自定义列(c_)进表头并参与本地合计', () => {
    const groups: Group[] = [...LAYOUTS.factory, { label: '自定义', leaves: [{ colId: 'c_park' as S10ColId, label: '停车费' }] }]
    const row = makeRow('factory', { factoryRent: 100 })
    ;(row as unknown as Record<string, number>).c_park = 30
    const w = mount(S10Table, {
      props: { groups, phaseName: '二期厂房', year: 2026, month: 6, rows: [row], edit: true },
    })
    expect(w.text()).toContain('停车费')
    // 编辑态本地即时算:行合计含 c_ 列 = 130
    expect(w.find('td.s10-c-total').text()).toBe('130.00')
    expect(w.find('th.s10-foot-total').text()).toBe('130.00')
  })
})

describe('S10Table 合计口径', () => {
  it('无后端派生时本地算:行合计 = 各列之和;列合计 / 总计在 tfoot', () => {
    const rows = [
      makeRow('factory', { factoryRent: 100, shopRent: 50 }, { id: 1, tenantName: 'A' }),
      makeRow('factory', { factoryRent: 30, elecStd: 20 }, { id: 2, tenantName: 'B' }),
    ]
    const w = mount(S10Table, {
      props: { groups: LAYOUTS.factory, phaseName: '二期厂房', year: 2026, month: 6, rows, edit: false },
    })
    // 行合计:A=150, B=50 → 末列 .s10-c-total
    const rowTotals = w.findAll('td.s10-c-total').map(td => td.text())
    expect(rowTotals).toContain('150.00')
    expect(rowTotals).toContain('50.00')
    // 总计 = 200
    expect(w.find('th.s10-foot-total').text()).toBe('200.00')
    // 列合计:factoryRent = 130（首叶子）
    const footNums = w.findAll('tfoot th.s10-c-num').map(th => th.text())
    expect(footNums[0]).toBe('130.00')
  })

  it('浏览态信后端派生:行 total / columnTotals / grandTotal 原样展示', () => {
    // 行 total=999 与列值故意不等:证明浏览态没有本地自算(口袋含归档列等前端看不见的值)
    const row = makeRow('factory', { factoryRent: 100 }, { total: 999 })
    const w = mount(S10Table, {
      props: {
        groups: LAYOUTS.factory, phaseName: '二期厂房', year: 2026, month: 6, rows: [row], edit: false,
        columnTotals: { factoryRent: 100 }, grandTotal: 999,
      },
    })
    expect(w.find('td.s10-c-total').text()).toBe('999.00')
    expect(w.find('th.s10-foot-total').text()).toBe('999.00')
    const footNums = w.findAll('tfoot th.s10-c-num').map(th => th.text())
    expect(footNums[0]).toBe('100.00')
  })

  it('编辑态 sumIds 含隐藏列:行合计计入版面外的值', () => {
    const row = makeRow('factory', { factoryRent: 100 })
    ;(row as unknown as Record<string, number>).c_hidden = 7   // 隐藏自定义列(平铺后在行顶层)
    const sumIds = [...leavesOf('factory').map(l => l.colId as string), 'c_hidden']
    const w = mount(S10Table, {
      props: { groups: LAYOUTS.factory, phaseName: '二期厂房', year: 2026, month: 6, rows: [row], edit: true, sumIds },
    })
    expect(w.find('td.s10-c-total').text()).toBe('107.00')
  })

  // C5-08 行定位高亮:摘类只认本行 td 的 animationend —— 不用 { once: true },
  // 否则行内先结束的子动画会把这唯一一次监听消费掉,2s 底色渐隐提前摘干净。
  it('深链高亮行:td 里子元素冒泡上来的 animationend 不摘 .row-flash,td 自己的才摘', async () => {
    Element.prototype.scrollIntoView = vi.fn()   // jsdom 没有这个方法
    const w = mount(S10Table, {
      props: {
        groups: LAYOUTS.factory, phaseName: '二期厂房', year: 2026, month: 6,
        rows: [makeRow('factory', {})], edit: false, focusTenant: 'T',
      },
    })
    await flushPromises()
    const tr = w.find('tbody tr.s10-row').element
    expect(tr.classList.contains('row-flash'), '定位到的行加了高亮类').toBe(true)
    tr.querySelector('.s10-tname')!.dispatchEvent(new Event('animationend', { bubbles: true }))
    expect(tr.classList.contains('row-flash'), '子元素的动画结束不摘类').toBe(true)
    tr.querySelector('td')!.dispatchEvent(new Event('animationend', { bubbles: true }))
    expect(tr.classList.contains('row-flash'), '本行 td 的动画结束才摘').toBe(false)
    // @ts-expect-error 恢复成 jsdom 原本没有的样子
    delete Element.prototype.scrollIntoView
  })
})

// ── S 档(≤600)卡列 —— 响应式稿 WideCardVariants §3「附表10 → 标准 88」
// 钉的是「四个字段各自从哪一列取值」:卡上的数一旦被改成别的列(比如随手拿首列金额当合计),
// 手机上看到的就不是桌面那张表的同一个数,而这种偏差没有断言就完全看不出来。
function asS() {
  // S 档桩:只让 ≤600 命中(jsdom 原生 matchMedia 一律 matches:false = 宽档)
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: q.includes('max-width: 600px'), media: q,
    addEventListener() {}, removeEventListener() {},
  }))
  _resetViewportForTest()
}

describe('S10Table · S 档卡列(FPWideCards 标准 88)', () => {
  // ⚠ 夹具不许退化:三行的 total 互不相等且都 ≠ 任何单列值(否则「amount 取的是合计」写成取首列也绿);
  // 绑定/来源三种组合各一行(已绑定种子 / 未绑定导入 / 已绑定手动),备注一有一无。
  const ROWS: S10RecordDTO[] = [
    makeRow('factory', { factoryRent: 100 }, { id: 1, tenantName: '鑫诚精密', tenantId: 7, source: 'seed', note: '按季结算', total: 12345.6 }),
    makeRow('factory', { factoryRent: 200 }, { id: 2, tenantName: '嘉华新材料', tenantId: null, source: 'import', note: null, total: 880 }),
    makeRow('factory', { factoryRent: 300 }, { id: 3, tenantName: '瑞通物流', tenantId: 9, source: 'manual', note: '补录', total: 4050.5 }),
  ]
  const baseProps = {
    groups: LAYOUTS.factory, phaseName: '二期厂房', year: 2026, month: 6,
    rows: ROWS, columnTotals: { factoryRent: 600 }, grandTotal: 17276.1,
  }

  beforeEach(asS)
  afterEach(() => { vi.unstubAllGlobals(); _resetViewportForTest() })

  it('❗浏览态不出 <table>,出 3 张 d88 卡;name=租户列, amount=合计列(不是任何单列)', () => {
    const w = mount(S10Table, { props: { ...baseProps, edit: false } })
    expect(w.find('table.s10-table').exists(), 'S 档浏览态还在渲染 25 列宽表').toBe(false)
    const cards = w.findAll('.fpwc-c')
    expect(cards).toHaveLength(3)
    expect(cards.every(c => c.classes().includes('d88')), '稿点名标准 88 档').toBe(true)

    // name ← 桌面首列『租户』
    expect(w.findAll('.fpwc-c .nm').map(e => e.text())).toEqual(['鑫诚精密', '嘉华新材料', '瑞通物流'])
    // amount ← 桌面最右『合计』列(浏览态 = 后端 r.total);600 是 factoryRent 列合计,不许出现在卡上
    expect(w.findAll('.fpwc-c > .amt').map(e => e.text()))
      .toEqual(['¥12,345.60', '¥880.00', '¥4,050.50'])
  })

  it('❗sub=备注列(无备注不画这一行);pill=行上已有的未绑定/手动两个标记,已绑定种子行不画', () => {
    const w = mount(S10Table, { props: { ...baseProps, edit: false } })
    // 备注只有 1、3 两行有 → 只画两条次级句,顺序跟着行序
    expect(w.findAll('.fpwc-c .sub').map(e => e.text())).toEqual(['按季结算', '补录'])
    // 胶囊:第 2 行 tenantId==null → 未绑定(warn);第 3 行 source!=='seed' → 手动(info);
    // 第 1 行已绑定种子 → 一个胶囊都不画(与桌面行上什么都不显示一致)
    const pills = w.findAll('.fpwc-c .pill')
    expect(pills.map(p => p.text())).toEqual(['未绑定', '手动'])
    expect(pills[0].classes()).toContain('warn')
    expect(pills[1].classes()).toContain('info')
    expect(w.findAll('.fpwc-c')[0].find('.pill').exists(), '已绑定的种子行不该有状态胶囊').toBe(false)
  })

  it('❗整卡点击 = 桌面点租户名的同一条动线:emit bindRow,载荷是那一行', async () => {
    const w = mount(S10Table, { props: { ...baseProps, edit: false } })
    await w.findAll('.fpwc-c')[1].trigger('click')
    // 载荷经 props 反应式代理,引用不同一;逐字段比,钉的是「点第二张卡拿到的是第二行」
    expect(w.emitted('bindRow')?.[0]?.[0]).toStrictEqual(ROWS[1])
  })

  it('❗S 档编辑态仍是表格:卡片没有输入框,换掉就等于手机上没法录入', () => {
    const w = mount(S10Table, { props: { ...baseProps, edit: true } })
    expect(w.findAll('.fpwc-c')).toHaveLength(0)
    expect(w.find('table.s10-table').exists()).toBe(true)
    // 每行每个非归档叶子一个输入框:20 列 × 3 行
    expect(w.findAll('tbody input.s10-input:not(.note)')).toHaveLength(leavesOf('factory').length * 3)
  })

  it('❗宽档零差异:tier=xl 时仍是 <table>,一张卡都不出', () => {
    vi.unstubAllGlobals(); _resetViewportForTest()   // jsdom 原生 matchMedia → tier='xl'
    const w = mount(S10Table, { props: { ...baseProps, edit: false } })
    expect(w.findAll('.fpwc-c')).toHaveLength(0)
    expect(w.find('table.s10-table').exists()).toBe(true)
    expect(w.findAll('tbody tr.s10-row')).toHaveLength(3)
  })
})

// ── 固定列与表格高度(LIST-PAGE-SPEC §9;计划 W3):RO 桩 + .s10-wrap 的 clientWidth / clientHeight 桩 ──
// 断言钉渲染出来的 width / left / right 像素,不钉配置对象。
describe('S10Table · 固定列按表格可见宽度退,租户封顶 1/5,高度分级', () => {
  let ro: ReturnType<typeof stubWideTable>
  const fire = (w: number, h: number) => ro.fire(w, h)
  const css = () => ro.injectCss('views/sales-income/S10Table.vue')
  beforeEach(() => { ro = stubWideTable('s10-wrap') })
  afterEach(() => {
    mounted.forEach(w => w.unmount())
    mounted = []
    ro.restore()
  })

  // 18 个字的长租户名估宽 255,远超 1/5;合计列最长的数是总计 13,225.60(9 字 → 98)
  const LONG = '佛山市南海区联塑精锢科技有限公司二厂'
  const ROWS: S10RecordDTO[] = [
    makeRow('factory', { factoryRent: 100 }, { id: 1, tenantName: LONG, total: 12345.6 }),
    makeRow('factory', { factoryRent: 200 }, { id: 2, tenantName: '瑞通物流', source: 'manual', total: 880 }),
  ]
  const props = {
    groups: LAYOUTS.factory, phaseName: '二期厂房', year: 2026, month: 6, rows: ROWS, edit: false,
    columnTotals: { factoryRent: 300 }, grandTotal: 13225.6,
  }
  const st = (w: ReturnType<typeof mount>, sel: string) => (w.get(sel).element as HTMLElement).style
  const TOTAL3 = ['th.s10-h-total', 'td.s10-c-total', 'th.s10-foot-total']
  // 挂到 document 上:getComputedStyle 只认文档里的元素(不挂的话注入的样式一条都读不到)
  let mounted: Array<ReturnType<typeof mount>> = []
  const mnt = (p: typeof props) => {
    const w = mount(S10Table, { props: p, attachTo: document.body })
    mounted.push(w)
    return w
  }

  // 1/5 = 80 比「3 个字 + 手动签」68 + 40 = 108 还窄:按 108 给(瑞通物流那行签不缩,不然名字只剩 12px)
  it('可见 400:租户列按下限 108px,合计 108+98 > 160 退成普通列(表头、表体、合计行三格都退、都摘 .s10-fix)', async () => {
    css()
    const w = mnt(props)
    await fire(400, 800)
    expect(st(w, 'th.s10-h-name').width).toBe('108px')
    expect(st(w, 'td.s10-c-name').width).toBe('108px')
    expect(st(w, 'td.s10-c-name').left).toBe('0px')
    expect(st(w, 'td.s10-c-total').position).toBe('')
    expect(st(w, 'th.s10-h-total').right).toBe('')
    // 撑高行两格跟着各自的列:名字格贴左,合计格一起退
    expect([st(w, 'tr.s10-fill td.s10-c-name').left, st(w, 'tr.s10-fill td.s10-c-total').position]).toEqual(['0px', ''])
    // 类上不许残留横向 sticky:computed 也不是 sticky(表头、合计行本来就纵向 sticky,只看表体)
    expect(getComputedStyle(w.get('td.s10-c-total').element).position).not.toBe('sticky')
    expect(TOTAL3.filter(s => w.get(s).classes().includes('s10-fix'))).toEqual([])
  })

  it('可见 1200:租户封顶 1/5 = 240 + 合计 98 ≤ 480,两根都 sticky;表头、表体、合计行三格对齐', async () => {
    const w = mnt(props)
    await fire(1200, 800)
    expect(st(w, 'td.s10-c-name').left).toBe('0px')
    expect(st(w, 'td.s10-c-total').position).toBe('sticky')
    expect(st(w, 'td.s10-c-total').right).toBe('0px')
    expect(st(w, 'th.s10-h-total').right).toBe('0px')
    expect(st(w, 'th.s10-foot-total').right).toBe('0px')
    // 撑高行两格也钉住:不然横滚时固定列在撑高那一段断开、露出后面滚过去的格
    const fill = (s: string) => st(w, 'tr.s10-fill ' + s)
    expect([fill('td.s10-c-name').left, fill('td.s10-c-total').position, fill('td.s10-c-total').right])
      .toEqual(['0px', 'sticky', '0px'])
    expect(['th.s10-h-name', 'td.s10-c-name', 'th.s10-foot-name'].map(s => [st(w, s).width, st(w, s).left]))
      .toEqual([['240px', '0px'], ['240px', '0px'], ['240px', '0px']])
    expect(TOTAL3.filter(s => !w.get(s).classes().includes('s10-fix'))).toEqual([])
  })

  // 手机档编辑态(S10View「编辑模式 · 小屏可录入」):手动行 勾选 23 + 手动签 40 + 删除钮 32 = 95 不缩,
  // 1/5 只有 71 → 按下限 3 个字 68 + 95 = 163,名字分到 163 − 28 − 95 = 40 ≥ 3 个字 37.5
  it('可见 358 编辑态 + 手动行:租户列不低于「3 个字 + 勾选 + 手动签 + 删除钮」= 163px', async () => {
    const w = mnt({ ...props, edit: true })
    await fire(358, 800)
    const manual = w.findAll('tbody tr.s10-row')[1]
    expect(manual.find('.s10-userbadge').exists()).toBe(true)
    expect((manual.get('td.s10-c-name').element as HTMLElement).style.width).toBe('163px')
    expect((manual.get('td.s10-c-name').element as HTMLElement).style.maxWidth).toBe('163px')
  })

  it('名字超了省略:.s10-tname 是 overflow hidden + ellipsis + min-width 0', async () => {
    css()
    const w = mnt(props)
    await fire(400, 800)
    const cs = getComputedStyle(w.get('td.s10-c-name .s10-tname').element)
    expect([cs.overflow, cs.textOverflow, parseFloat(cs.minWidth)]).toEqual(['hidden', 'ellipsis', 0])
  })

  // 估宽里名字以外的件都得算进去,不然名字在放得下的时候被提前截掉
  it('可见 3000 编辑态:短名手动行最长 —— 瑞通物流 80 + 勾选 23 + 手动签 40 + 删除钮 32 = 175', async () => {
    const rows = [
      makeRow('factory', {}, { id: 1, tenantName: '甲乙', tenantId: 3, source: 'seed', total: 1 }),
      makeRow('factory', {}, { id: 2, tenantName: '瑞通物流', tenantId: 9, source: 'manual', total: 2 }),
    ]
    const w = mnt({ ...props, rows, edit: true })
    await fire(3000, 800)
    expect(st(w, 'th.s10-h-name').width).toBe('175px')
  })

  it('可见 3000:未绑定的种子行最长 —— 6 个字 105 + 「● 未绑定」标记 56(间距 8 + 点 6 + 4 + 三个字 38) = 161(比「合计 · 1 户」105 长)', async () => {
    const rows = [makeRow('factory', {}, { id: 1, tenantName: '嘉华新材料厂', tenantId: null, source: 'seed', total: 1 })]
    const w = mnt({ ...props, rows })
    await fire(3000, 800)
    expect(st(w, 'th.s10-h-name').width).toBe('161px')
  })

  it('进编辑态再退出(不重新拉数据):租户列缩回浏览态的宽', async () => {
    const w = mnt({ ...props, edit: true })
    await fire(3000, 800)
    expect(st(w, 'td.s10-c-name').width).toBe('278px')   // 长名 255 + 勾选 23
    await w.setProps({ edit: false })
    expect(st(w, 'td.s10-c-name').width).toBe('255px')
  })

  it('同一份数据原地改短:列宽不缩;换一份 rows:按新数据变窄', async () => {
    const rows = reactive(ROWS.map(r => ({ ...r })))
    const w = mnt({ ...props, rows })
    await fire(3000, 800)
    expect(st(w, 'td.s10-c-name').width).toBe('255px')
    rows[0].tenantName = '甲'
    await w.vm.$nextTick()
    expect(w.get('td.s10-c-name .s10-tname').text()).toBe('甲')
    expect(st(w, 'td.s10-c-name').width).toBe('255px')
    await w.setProps({ rows: [ROWS[1]] })
    expect(st(w, 'td.s10-c-name').width).toBe('120px')   // 瑞通物流 80 + 手动签 40
  })

  // 最右空列(LIST-PAGE §4 列宽铁律,2026-10-02 用户拍板):表格区比各列合计宽时,余宽全落在每行末尾那一格空列,
  // 不再按比例摊进 20 / 25 根金额列和备注。
  // 破坏验证:tbody 行末那格 fp-fill 删掉 → 红(两行数据行)。撑高行整行 aria-hidden,不查
  it('可见 3000:表头(跨两行)、每一行、合计行的最右一格都是空列;租户列 = 长名估宽 255,不吃余宽', async () => {
    const w = mnt(props)
    await fire(3000, 800)
    expect(rowsNotEndingInFill(w.get('table.s10-table').element)).toEqual([])
    expect(st(w, 'td.s10-c-name').width).toBe('255px')
  })

  // 有了空列,auto 布局只给不定宽的列「最窄能放下」的宽:width:100% 的输入框按 0 算,编辑态金额列会缩回表头的保底 104,
  // 长数字在框里显示不全。破坏验证:.s10-input 改回 width:100% → 红
  it('编辑态金额 / 备注输入框按自身宽撑列(width:auto + min-width:100%)', async () => {
    css()
    const w = mnt({ ...props, edit: true })
    await fire(3000, 800)
    const ins = w.findAll('tbody input.s10-input')
    expect(ins.length, '前提:金额格和备注格都有输入框').toBeGreaterThan(2)
    expect(ins.map(i => { const c = getComputedStyle(i.element); return c.width + ' ' + c.minWidth }))
      .toEqual(Array(ins.length).fill('auto 100%'))
  })

  it('名字悬停看全称走 v-tip,不走 title', async () => {
    const w = mnt(props)
    await fire(400, 800)
    const nm = w.get('td.s10-c-name .s10-tname').element as HTMLElement & { _tip?: { text: string } }
    expect(nm._tip?.text).toBe(LONG)
    expect(nm.hasAttribute('title')).toBe(false)
  })

  // 34/34/38/42:0 级 ≥ 34+34+42+8×38 = 414;1 级 ≥ 380;2 级 ≥ 338;再矮 3 级给表格区 338 的底
  it.each([
    [414, false, false, ''],
    [380, true, false, ''],
    [379, true, true, ''],
    [337, true, true, '338px'],
  ] as const)('表格区 %i:分组表头滚走 %s、合计不贴底 %s、min-height「%s」', async (h, grp, foot, minH) => {
    css()
    const w = mnt(props)
    await fire(1200, h)
    const cls = w.get('table.s10-table').classes()
    expect([cls.includes('hs-grp'), cls.includes('hs-foot')]).toEqual([grp, foot])
    const cs = (sel: string) => getComputedStyle(w.get(sel).element)
    // 让了第 2 步:分组行贴在 -34 滚出去、列名行贴 0;跨两行的租户格字挪到下半格
    expect(cs('thead tr:first-child th.s10-h-grp').top).toBe(grp ? '-34px' : '0px')
    expect(cs('thead tr:nth-child(2) th').top).toBe(grp ? '0px' : '34px')
    expect(cs('thead th.s10-h-name').verticalAlign).toBe(grp ? 'bottom' : 'middle')
    // 让了第 3 步:合计行跟在最后一行后面
    expect(cs('tfoot th.s10-c-num').bottom).toBe(foot ? 'auto' : '0px')
    expect(st(w, '.s10-wrap').minHeight).toBe(minH)
  })
})
