// C6-01 第 4 步:四张分析屏的整区转圈门换成真版式骨架。
// 断言钉的是**坐标**:骨架 .fp-shim 的高度序列,以及它顶替的那几张图的 :height 字面值。
// 谁改了图高而没同步骨架,这里就红 —— 那正是「骨架 → 真版式」位移回来的那一刻。
//
// 为什么读源码而不 mount:这四屏各自要 mock 3~6 个 api 模块才挂得起来,
// 而要钉的东西(块高)是写死在模板里的常量,不经过运行时。
// 同文件既有写法:pvMeterAnaScreen.spec.ts:887-892 也从源码读 scoped CSS 规则。
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

function parts(file: string, nextSibling: string) {
  const src = readFileSync(join(__dirname, file), 'utf8')
  const tpl = src.slice(src.indexOf('<template>'))
  const i = tpl.indexOf('ak-skel')
  expect(i, `${file} 没找到骨架(class="… ak-skel")`).toBeGreaterThan(-1)
  const j = tpl.indexOf(nextSibling, i)
  expect(j, `${file} 骨架后面没接上 ${nextSibling}`).toBeGreaterThan(i)
  const skel = tpl.slice(i, j)
  return {
    /** 骨架里 .fp-shim 的 height,按出现顺序 */
    shims: [...skel.matchAll(/class="fp-shim" style="height:\s*(\d+)px/g)].map((m) => Number(m[1])),
    /** 真版式里各 AnaEChart 的 :height 字面值,按出现顺序 */
    charts: [...tpl.slice(j).matchAll(/:height="(\d+)"/g)].map((m) => Number(m[1])),
    /** 整区转圈没了 */
    spins: (tpl.match(/page-spin/g) ?? []).length,
  }
}

describe('分析屏首进骨架 · 块高照真版式钉死(C6-01)', () => {
  it('❗园区能耗:页头 44 + 五张卡 = 300/170/250/250/170', () => {
    const p = parts('ParkEnergyView.vue', '<AnaEmpty v-else-if="failed"')
    expect(p.spins, '版式已知还在转圈').toBe(0)
    // 页头 44 · (卡头 20 + 图 300) · (20 + 170) · (20 + 250) · (20 + 250) · (20 + 170)
    expect(p.shims).toEqual([44, 20, 300, 20, 170, 20, 250, 20, 250, 20, 170])
    expect(p.charts, '图高变了,骨架没跟').toEqual([300, 170, 250, 250, 170])
  })

  it('❗出租与楼栋:TreeMap 300 + 图例 20、明细表 296 + 合计 20、面积转换右栏 278', () => {
    const p = parts('ParkView.vue', '<AnaEmpty v-else-if="failed"')
    expect(p.spins, '版式已知还在转圈').toBe(0)
    expect(p.shims).toEqual([44, 20, 300, 20, 20, 296, 20, 20, 300, 20, 300, 20, 86, 20, 278])
    // 末块 278 = 面积转换卡右栏(图 250 + .pk-legend margin 8 + 行高 20),比左栏两块指标 186 高
    expect(p.charts, '图高变了,骨架没跟').toEqual([300, 300, 300, 250])
  })

  it('❗电费成本分析:页头 44 + 结论条 20 + 三张 300', () => {
    const p = parts('ElecAnalysisView.vue', '<AnaEmpty v-else-if="failed"')
    expect(p.spins, '版式已知还在转圈').toBe(0)
    expect(p.shims).toEqual([44, 20, 20, 300, 20, 300, 20, 300])
    expect(p.charts, '图高变了,骨架没跟').toEqual([300, 300, 300])
  })

  it('❗租户异常监控:左列 34 + 560,右列 250 / 200,两张规则卡各一行 60', () => {
    const p = parts('AnomalyView.vue', '<div v-else-if="!model')
    expect(p.spins, '版式已知还在转圈').toBe(0)
    expect(p.shims).toEqual([20, 34, 560, 20, 250, 20, 200, 20, 60, 20, 60])
    expect(p.charts, '图高变了,骨架没跟').toEqual([250, 200])
  })
})

// 文本行的骨架高:行盒由 base.css 的 `line-height: var(--lh-snug)` 定,--lh-snug 是**长度** 20px
// (tokens.css),按长度继承、与 font-size 无关 —— 所以 .ana-read(12px 字)/ .ana-ref(11px 字)
// 每行都占 20,不是 15 / 14。.ak-tbl 表头同理:行盒 20 + padding-bottom 9 + 下边框 1 = 30。
// 按字号写骨架高,每张卡欠 11px,四张卡就是数据到达那一帧整页下沉 44px。
describe('分析屏首进骨架 · 文本行按行盒 20 钉,不按字号(C6-01)', () => {
  const read = (f: string) => readFileSync(join(__dirname, f), 'utf8')
  /** 骨架里所有 .fp-shim 的 height,按出现顺序 */
  const shims = (src: string) => {
    const tpl = src.slice(src.indexOf('<template>'))
    const i = tpl.indexOf('-skel')
    return [...tpl.slice(i).matchAll(/class="fp-shim" style="height:\s*(\d+)px[^"]*"/g)].map(m => Number(m[1]))
  }

  it('❗同类对标:四张卡的读数句 / 参照系小字各 20,不是 15 / 14', () => {
    const src = read('TenantPeerView.vue')
    // 真版式那一侧:四张卡都是 <p class="ana-read …"> + <p class="ana-ref">
    expect((src.match(/class="ana-read/g) ?? []).length).toBe(4)
    expect((src.match(/class="ana-ref"/g) ?? []).length).toBe(4)
    expect(src.match(/height: 1[45]px; width: [34]0%/g), '读数句骨架还按字号写(15 / 14)').toBeNull()
    expect((src.match(/height: 20px; width: 40%; margin-top: 8px/g) ?? []).length).toBe(4)
    expect((src.match(/height: 20px; width: 30%; margin-top: 2px/g) ?? []).length).toBe(4)
  })

  it('❗租户用能:趋势卡读数句 20 / 参照系 20;收缴率那行 .te2-payline 也是 20', () => {
    const src = read('TenantEnergyView.vue')
    expect(src).toContain('height: 20px; width: 55%; margin-top: 8px')
    expect(src).toContain('height: 20px; width: 38%; margin-top: 2px')
    expect(src).toContain('height: 20px; width: 45%; margin-top: 6px')
    expect(src.match(/height: 1[45]px; width: (55|38|45)%/g), '还按字号写').toBeNull()
  })

  it('❗租户构成:清单表 = 表头 30 + 12 行 ×38 = 486,不是 480', () => {
    const src = read('TenantPortfolioView.vue')
    expect(shims(src)).toContain(486)
    expect(shims(src), '表头按 24 算少了 6px').not.toContain(480)
    expect(src, '真版式那一侧还是 .ak-tbl').toContain('<table class="ak-tbl">')
  })
})
