// 附表12 工资的固定列与表格高度(LIST-PAGE-SPEC §9;计划 W5,画布 07-C 附表12 行)。
// 钉什么:姓名(名称列)→ 序号 按表格可见宽度退;姓名的 left 取序号列实际宽(编辑态带勾选框,不再写死 48);
// 编辑态勾选框在序号格里,跟名称列绑在一起永远不退(实现规范 §1.8);姓名超 1/5 省略、悬停看全称;
// 高度按 28/38/37/44 分级。断言钉渲染出来的 width / left 像素,不钉配置对象。
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reactive } from 'vue'
import { mount } from '@vue/test-utils'
import SalaryTable from '../SalaryTable.vue'
import { rowsNotEndingInFill, stubWideTable } from '@/composables/__tests__/wideTableStub'
import type { SalaryRecordDTO, SalaryTotal } from '@/types/salary'

function row(over: Partial<SalaryRecordDTO>): SalaryRecordDTO {
  return {
    id: 1, acctMonth: '2026-03', empIdx: 1, name: '张三', role: '运维工程师',
    base: 4200, post: 1800, perf: 900, attend: 300, skill: 500, edu: 200, other: 100,
    lunch: 300, heat: 200, commission: 0,
    shouldDays: 22, leaveDays: 0,
    social: 980.25, tax: 120, otherDeduct: 1600,
    sign: false,
    wageTotal: 8000, gross: 8500, deduct: 2700.25, net: 5799.75,
    actualDays: 22, fullAttend: true, note: null, source: 'seed',
    ...over,
  }
}

// 三行:短名种子行 / 八个字的长名(估宽 124,超 400 宽的 1/5=80)/ 手动行(名字 + 手动签)
const LONG = '欧阳子轩慕容云海'
const ROWS: SalaryRecordDTO[] = [
  row({}),
  row({ id: 2, empIdx: 2, name: LONG, gross: 9100, net: 7000 }),
  row({ id: 3, empIdx: 3, name: '李四', source: 'manual', gross: 800, net: -200.5 }),
]
const TOTAL: SalaryTotal = {
  base: 12600, post: 5400, perf: 2700, attend: 900, skill: 1500, edu: 600, other: 300,
  lunch: 900, heat: 600, commission: 0,
  wageTotal: 24000, gross: 18400, social: 2940.75, tax: 360, otherDeduct: 4800,
  deduct: 8100.75, net: 12599.25,
}
const props = { year: 2026, month: 3, rows: ROWS, total: TOTAL, edit: false }

let ro: ReturnType<typeof stubWideTable>
const fire = (w: number, h: number) => ro.fire(w, h)
const css = () => ro.injectCss('views/salary/SalaryTable.vue')
// 挂到 document 上:getComputedStyle 只认文档里的元素
let mounted: Array<ReturnType<typeof mount>> = []
const mnt = (p: typeof props) => {
  const w = mount(SalaryTable, { props: p, attachTo: document.body })
  mounted.push(w)
  return w
}

beforeEach(() => { ro = stubWideTable('s12-tablewrap') })
afterEach(() => {
  mounted.forEach(w => w.unmount())
  mounted = []
  ro.restore()
})

const st = (w: ReturnType<typeof mount>, sel: string) => (w.get(sel).element as HTMLElement).style
type TipEl = HTMLElement & { _tip?: { text: string } }

describe('附表12 · 固定列', () => {
  // 序号、姓名两根在表头(跨两行)、表体、合计行各有一格,三格的宽和 left 必须一致,不然横滚时表头 / 合计和表体错位
  it('编辑态宽屏:姓名 left = 序号列实际宽 66px(含勾选框),不是写死的 48;表头、表体、合计行三格对齐', async () => {
    const w = mnt({ ...props, edit: true })
    await fire(1400, 800)
    for (const part of ['thead th', 'tbody td', 'tfoot th']) {
      expect([st(w, `${part}.s12-sticky1`).width, st(w, `${part}.s12-sticky1`).left,
        st(w, `${part}.s12-sticky2`).left], part).toEqual(['66px', '0px', '66px'])
    }
  })

  it('浏览态可见 200:序号 46 + 姓名 40 > 80,序号退成普通列、姓名贴 0(类上也不残留横向 sticky)', async () => {
    css()
    const w = mnt(props)
    await fire(200, 800)
    expect(st(w, 'tbody td.s12-sticky1').position).toBe('')
    expect(getComputedStyle(w.get('tbody td.s12-sticky1').element).position).not.toBe('sticky')
    expect(st(w, 'tbody td.s12-sticky2').left).toBe('0px')
  })

  it('编辑态可见 200:勾选框在序号格里,序号跟姓名绑着不退', async () => {
    const w = mnt({ ...props, edit: true })
    await fire(200, 800)
    expect(st(w, 'tbody td.s12-sticky1').left).toBe('0px')
    expect(st(w, 'tbody td.s12-sticky2').left).toBe('66px')
  })

  // 张三 49 放得下不挂;长名 124、李四 49 + 手动签 35 = 84 都超 80 → 挂全称
  it('可见 400:姓名列封顶 80px,放不下的名字悬停看全称(v-tip),放得下的不挂', async () => {
    const w = mnt(props)
    await fire(400, 800)
    expect(st(w, 'tbody td.s12-sticky2').width).toBe('80px')
    const tips = w.findAll<HTMLElement>('tbody .s12-nm-t').map(e => (e.element as TipEl)._tip?.text)
    expect(tips).toEqual([undefined, LONG, '李四'])
  })

  it('名字超了省略:.s12-nm-t 是 overflow hidden + ellipsis + min-width 0', async () => {
    css()
    const w = mnt(props)
    await fire(400, 800)
    const cs = getComputedStyle(w.get('tbody .s12-nm-t').element)
    expect([cs.overflow, cs.textOverflow, parseFloat(cs.minWidth)]).toEqual(['hidden', 'ellipsis', 0])
  })

  it('进编辑态再退出(不重新拉数据):序号列缩回 46,姓名 left 跟着回 46', async () => {
    const w = mnt({ ...props, edit: true })
    await fire(1400, 800)
    expect(st(w, 'tbody td.s12-sticky1').width).toBe('66px')
    await w.setProps({ edit: false })
    expect(st(w, 'tbody td.s12-sticky1').width).toBe('46px')
    expect(st(w, 'tbody td.s12-sticky2').left).toBe('46px')
  })

  it('同一份数据原地改短:姓名列不缩;换一份 rows:按新数据变窄', async () => {
    const rows = reactive(ROWS.map(r => ({ ...r })))
    const w = mnt({ ...props, rows })
    await fire(3000, 800)
    expect(st(w, 'tbody td.s12-sticky2').width).toBe('124px')   // 长名 8 字
    rows[1].name = '王五'
    await w.vm.$nextTick()
    expect(w.findAll('tbody .s12-nm-t')[1].text()).toBe('王五')
    expect(st(w, 'tbody td.s12-sticky2').width).toBe('124px')
    await w.setProps({ rows: [ROWS[0]] })
    expect(st(w, 'tbody td.s12-sticky2').width).toBe('102px')   // 最长的成了「合计 · 1 人」
  })
})

// 最右空列(LIST-PAGE §4 列宽铁律,2026-10-02 用户拍板):表格区比各列合计宽时,余宽全落在每行末尾那一格空列,
// 不再按比例摊进 20 多根金额列
describe('附表12 · 最右空列', () => {
  // 破坏验证:表头那格(跨两行)fp-fill 删掉 → 红(表头两行列出来)
  it('可见 3000:表头(跨两行)、每一行、合计行的最右一格都是空列;姓名列 = 最长名字估宽 124,不吃余宽', async () => {
    const w = mnt(props)
    await fire(3000, 800)
    expect(rowsNotEndingInFill(w.get('table.s12-table').element)).toEqual([])
    expect(st(w, 'tbody td.s12-sticky2').width).toBe('124px')
  })

  // 有了空列,auto 布局只给不定宽的列「最窄能放下」的宽:base.css 给 svg 的 max-width:100%、width:100% 的输入框
  // 在这一步都按 0 算,签收列会窄一个图标宽,编辑态备注列缩回表头的保底 150。
  // 破坏验证:删掉 .s12-sign svg { max-width:none } → 第一条红;删掉 .s12-c-note :deep(.lc-note-in) 那条 → 第二条红
  it('签收列的图标、编辑态备注框按自身宽撑列', async () => {
    ro.injectCss('styles/base.css')
    ro.injectCss('components/sched/SchedNoteCell.vue')
    css()
    const w = mnt({ ...props, edit: true })
    await fire(3000, 800)
    expect(getComputedStyle(w.get('.s12-sign svg').element).maxWidth).toBe('none')
    const note = getComputedStyle(w.get('td.s12-c-note input.lc-note-in').element)
    expect([note.width, note.minWidth]).toEqual(['auto', '100%'])
  })
})

describe('附表12 · 表格高度(28/38/37/44)', () => {
  // 0 级 ≥ 28+38+44+8×37 = 406;1 级 ≥ 378;2 级 ≥ 334;再矮 3 级给表格区 334 的底
  it.each([
    [406, false, false, ''],
    [378, true, false, ''],
    [377, true, true, ''],
    [333, true, true, '334px'],
  ] as const)('表格区 %i:分组带滚走 %s、合计不贴底 %s、min-height「%s」', async (h, grp, foot, minH) => {
    css()
    const w = mnt(props)
    await fire(1400, h)
    const cls = w.get('table.s12-table').classes()
    expect([cls.includes('hs-grp'), cls.includes('hs-foot')]).toEqual([grp, foot])
    const cs = (sel: string) => getComputedStyle(w.get(sel).element)
    // 让了第 2 步:分组带贴在 -28 滚出去、列名行贴 0;跨两行的姓名格字挪到下半格
    expect(cs('thead tr.g th.s12-grp-wage').top).toBe(grp ? '-28px' : '0px')
    expect(cs('thead tr.s th').top).toBe(grp ? '0px' : '28px')
    expect(cs('thead th.s12-sticky2').verticalAlign).toBe(grp ? 'bottom' : 'middle')
    // 让了第 3 步:合计行跟在最后一行后面
    expect(cs('tfoot th.s12-c-num').bottom).toBe(foot ? 'auto' : '0px')
    expect(st(w, '.s12-tablewrap').minHeight).toBe(minH)
  })
})
