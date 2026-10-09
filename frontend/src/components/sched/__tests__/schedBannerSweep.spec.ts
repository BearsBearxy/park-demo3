// 横条收尾(2026-10-03,实现规范 §2「横条盘点」T4 行 + 第二类):附表族 / 损益附表 / 工资 / 台账的
// 满宽说明行撤掉后,原话去了哪儿。每条钉两件事:横条不在 + 新去处在且文案逐字。
//   · 手机档「编辑模式 · 小屏可录入,建议在桌面端操作」行 → SchedHeader 编辑签「编辑模式 · 建议桌面」(≤600 才出后半)
//   · SchedYearGate 页底 ⓘ 说明 → 并进副标题(footer prop 不变,5 个调用方不动)
//   · 损益附表页底 ⓘ「单位:元 · 口径」→ 单位本在副标题;口径挂「本年合计」表头与合计类行名称的悬停说明
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import SchedHeader from '@/components/sched/SchedHeader.vue'
import SchedYearGate from '@/components/sched/SchedYearGate.vue'
import PnlTable from '@/views/reports/pnl/PnlTable.vue'
import { stubWideTable } from '@/composables/__tests__/wideTableStub'
import { useAuthStore } from '@/stores/auth'
import type { PnlRowDTO } from '@/types/pnl'

vi.mock('@/api', () => ({
  default: {
    get: vi.fn(() => Promise.resolve([])),
    post: vi.fn(() => Promise.resolve({ granted: true, holder: null })),
    put: vi.fn(() => Promise.resolve({ users: [] })),
    delete: vi.fn(() => Promise.resolve()),
  },
  readToken: vi.fn(() => 't'),
  bindSession: vi.fn(),
  sessionDrifted: vi.fn(() => false),
}))

const tipOf = (el: Element) => (el as HTMLElement & { _tip?: { text: string; sub?: string } })._tip
const SRC = join(__dirname, '../../..')
const read = (f: string) => readFileSync(join(SRC, f), 'utf8')
/** 组件 <template> 段(注释去掉):只看渲染出来的东西,注释里提到旧类名不算 */
const tpl = (f: string) => (read(f).match(/<template>([\s\S]*)<\/template>/)?.[1] ?? '').replace(/<!--[\s\S]*?-->/g, '')
const css = (f: string) => [...read(f).matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n')

beforeEach(() => {
  setActivePinia(createPinia())
  useAuthStore().permissions = ['rent-pnl:edit', 'pv-income:edit']
})

describe('手机档荐桌面:并进编辑签,不另占一行', () => {
  // 破坏验证:.lc-edit-s 那个 span 删掉 → 红
  it('❗SchedHeader 编辑态的签写「编辑模式 · 建议桌面」,后半只在 ≤600 出', () => {
    const w = mount(SchedHeader, {
      props: { icon: 'wallet', title: '损益附表1', year: 2025, edit: true, perm: 'rent-pnl:edit', scope: null, deskHint: true },
    })
    expect(w.find('.lc-editbadge').text()).toBe('编辑模式 · 建议桌面')
    expect(w.find('.lc-editbadge .lc-edit-s').text()).toBe('· 建议桌面')
    const c = css('components/sched/SchedHeader.vue')
    const outside = c.replace(/@media[^{]*\{[^{}]*(\{[^{}]*\}[^{}]*)*\}/g, '')
    expect(outside, '宽档藏起后半').toMatch(/\.lc-edit-s\s*\{[^}]*display:\s*none/)
    expect(c, '≤600 才露出来').toMatch(/@media \(max-width: 600px\)\s*\{\s*\.lc-edit-s\s*\{\s*display:\s*inline/)
  })

  // 破坏验证:v-if="deskHint" 去掉 → 红(其余年表屏 —— 充电桩 / 电费 / 光伏 / 水电 / 附表10 —— 不传,签照旧)
  it('❗不传 deskHint 的屏:编辑签只写「编辑模式」;损益附表与工资两屏传了', () => {
    const w = mount(SchedHeader, {
      props: { icon: 'wallet', title: '附表6', year: 2025, edit: true, perm: 'pv-income:edit', scope: null },
    })
    expect(w.find('.lc-editbadge').text()).toBe('编辑模式')
    expect(w.find('.lc-edit-s').exists()).toBe(false)
    for (const f of ['views/reports/pnl/PnlScheduleView.vue', 'views/salary/SalaryView.vue']) {
      expect(tpl(f).match(/<SchedHeader[^>]*>/)![0], f).toMatch(/\sdesk-hint\s/)
    }
  })

  it('浏览态没有这枚签', () => {
    const w = mount(SchedHeader, {
      props: { icon: 'wallet', title: '损益附表1', year: 2025, edit: false, perm: 'rent-pnl:edit', scope: null },
    })
    expect(w.find('.lc-editbadge').exists()).toBe(false)
  })

  // 破坏验证:把任一屏的 s-hint 行加回来 → 红
  it.each([
    ['views/reports/pnl/PnlScheduleView.vue', 'pnl-s-hint'],
    ['views/salary/SalaryView.vue', 's12-s-hint'],
    ['views/ledger/LedgerView.vue', 'lgw-s-hint'],
  ])('❗%s 不再渲染那一行提示', (f, cls) => {
    expect(tpl(f)).not.toContain(cls)
    expect(tpl(f)).not.toContain('建议在桌面端操作')
    expect(css(f)).not.toContain(cls)
  })
})

describe('年份门:页底 ⓘ 说明并进副标题', () => {
  const FOOTER = '每个年份是一份独立的年度矩阵;小计/损益/合计行存文件原值,编辑明细不自动重算。'
  const gate = (footer?: string) => mount(SchedYearGate, {
    props: { icon: 'wallet', title: '损益附表1', sub: '园区全局年度矩阵 · 先选择年份,再进入对应年度的明细矩阵',
             years: [], current: 2025, storeKey: 'sweep-test', footer },
  })

  // 破坏验证:.sm-foot 那行加回来 / 副标题不并 footer → 红
  it('❗传了 footer:副标题 = sub。footer;年卡下面不再有 ⓘ 说明行', () => {
    const w = gate(FOOTER)
    expect(w.find('.sm-gate-sub').text())
      .toBe('园区全局年度矩阵 · 先选择年份,再进入对应年度的明细矩阵。' + FOOTER)
    expect(w.find('.sm-foot').exists()).toBe(false)
    expect(w.text().split(FOOTER)).toHaveLength(2)   // 原话只出现一次
  })

  it('没传 footer:副标题就是 sub,不多一个句号', () => {
    expect(gate().find('.sm-gate-sub').text()).toBe('园区全局年度矩阵 · 先选择年份,再进入对应年度的明细矩阵')
  })
})

describe('损益附表:页底 ⓘ「单位 · 口径」行删掉,口径挂悬停', () => {
  const ROWS: PnlRowDTO[] = [
    { rowKey: 'r1', groupLabel: '一期厂房', label: '租金收入', kind: 'detail', note: null, sortOrder: 0,
      m: [12000, 12000, 12000, null, 9000, 9000, 9000, 9000, 9000, 9000, 9000, 9000] },
    { rowKey: 'r2', groupLabel: '一期厂房', label: '租金损益小计', kind: 'subtotal', note: null, sortOrder: 1,
      m: [9000, 9000, 9000, null, 6000, 6000, 6000, 6000, 6000, 6000, 6000, 6000] },
    { rowKey: 'r3', groupLabel: '合计', label: '本年损益合计', kind: 'total', note: null, sortOrder: 2,
      m: Array(12).fill(1000) },
  ]
  let ro: ReturnType<typeof stubWideTable>
  beforeEach(() => { ro = stubWideTable('pt-wrap') })
  afterEach(() => { ro.restore(); document.body.innerHTML = '' })

  async function table() {
    const w = mount(PnlTable, {
      props: { year: 2025, rows: ROWS, groupCol: '区域', edit: false, derive: {}, selected: new Set<string>() },
      attachTo: document.body,
    })
    await ro.fire(1400, 600)
    return w
  }

  // 破坏验证:ANN_TIP 的 v-tip 删掉 → 红
  it('❗「本年合计」表头悬停写它怎么来的(含「–」不当 0)', async () => {
    const w = await table()
    expect(tipOf(w.get('thead th.pt-c-ann span').element)?.text)
      .toBe('本年合计 = 1–12 月相加(「–」是没录,不当 0),只在页面上算,不存库')
  })

  // 破坏验证:subTips 里合计类行那支改成 null → 红
  it('❗小计 / 合计行的名称悬停写「存文件原值」;明细行名字没被截就不出气泡', async () => {
    const w = await table()
    const names = w.findAll('tbody .pt-sub-t')
    expect(tipOf(names[0].element), '明细行').toBeUndefined()
    expect(tipOf(names[1].element)?.text).toBe('这一行存的是文件原值,改明细不会自动重算')
    expect(tipOf(names[2].element)?.text).toBe('这一行存的是文件原值,改明细不会自动重算')
  })

  it('❗PnlScheduleView 不再渲染页底说明行;单位仍在副标题里', () => {
    const t = tpl('views/reports/pnl/PnlScheduleView.vue')
    expect(t).not.toContain('pnl-foot')
    expect(t).not.toContain('本年合计为客户端派生不落库')
    expect(read('views/reports/pnl/PnlScheduleView.vue')).toMatch(/const sub = `[^`]*· 单位:元`/)
  })
})
