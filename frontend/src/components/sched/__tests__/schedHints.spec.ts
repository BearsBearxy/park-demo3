import { describe, it, expect, beforeEach, vi } from 'vitest'
import { defineComponent, nextTick } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

import SchedHeader from '@/components/sched/SchedHeader.vue'
import SchedYearGate from '@/components/sched/SchedYearGate.vue'
import SchedMonthPills from '@/components/sched/SchedMonthPills.vue'
import UtilitiesTable from '@/views/utilities/UtilitiesTable.vue'
import SalaryTable from '@/views/salary/SalaryTable.vue'
import { useSchedScreen, clearConfirm, type SchedRow } from '@/composables/useSchedScreen'
import { useAuthStore } from '@/stores/auth'
import { usePresenceStore, type Seat } from '@/stores/presence'
import { askQueue, answer } from '@/utils/ask'
import { receipts } from '@/utils/receipt'
import type { OfficeRecordDTO, OfficeTotal } from '@/types/utilities'
import type { SalaryTotal } from '@/types/salary'

/**
 * 附表族共用层的提示件替换(S4 T23,画布 02-B 左 / 06-B ①⑤⑦):
 * 导入确认走 ask、改动数报给 auth、清空确认 ask(danger)、报错走回执、
 * 新增年份的字段报错、空状态换 FPEmpty、悬停说明走 v-tip。
 */

vi.mock('@/api', () => ({
  default: {
    get: vi.fn(() => Promise.resolve([])),
    post: vi.fn(() => Promise.resolve({ granted: true, holder: null })),
    put: vi.fn(() => Promise.resolve({ users: [] })),
    delete: vi.fn(() => Promise.resolve()),
  },
  readToken: vi.fn(() => 'test-token'),
  bindSession: vi.fn(),
  sessionDrifted: vi.fn(() => false),
}))

type TipEl = HTMLElement & { _tip?: { text: string } }
const tipOf = (el: Element) => (el as TipEl)._tip?.text

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  vi.clearAllMocks()
  askQueue.splice(0)
  receipts.splice(0)
  useAuthStore().permissions = ['utilities:edit']
})

const hdr = (props: Record<string, unknown> = {}) => mount(SchedHeader, {
  props: {
    icon: 'wallet', title: '附表10 · 销售收入', year: 2025,
    edit: true, perm: 'utilities:edit', scope: null, showImport: true, ...props,
  },
})
const importBtn = (w: ReturnType<typeof hdr>) => w.findAll('button').find(b => b.text().includes('导入 Excel'))!

describe('SchedHeader 导入前确认(02-B 左)', () => {
  it('有草稿 → 先问「导入会整期替换本期数据」;答「取消」不导,答「仍要导入」才导', async () => {
    const w = hdr({ dirty: 3 })
    await importBtn(w).trigger('click')
    await flushPromises()
    expect(askQueue).toHaveLength(1)
    const q = askQueue[0]
    expect([q.title, q.body, q.action, !!q.danger]).toEqual([
      '导入会整期替换本期数据', '本期有 3 处改动还没保存，导入后会丢失。', '仍要导入', false,
    ])
    expect(w.emitted('import'), '答之前不导').toBeUndefined()

    answer(false)
    await flushPromises()
    expect(w.emitted('import'), '取消就不导').toBeUndefined()

    await importBtn(w).trigger('click')
    await flushPromises()
    answer(true)
    await flushPromises()
    expect(w.emitted('import')).toHaveLength(1)
  })

  // 附表10 / 工资的导入只删本期 source='import' 的行(S10Service / SalaryService.importRows),手工行不动。
  // 破坏验证:onImport 的 title 去掉 importKeepsManual 分支 → 红
  it('❗importKeepsManual → 说「只替换之前导入的行」,不说整期替换', async () => {
    const w = hdr({ dirty: 3, importKeepsManual: true })
    await importBtn(w).trigger('click')
    await flushPromises()
    expect(askQueue[0]?.title).toBe('导入会替换本期之前导入的行，手工录的行不动')
  })

  it('没草稿 → 不问,直接导', async () => {
    const w = hdr({ dirty: 0 })
    await importBtn(w).trigger('click')
    await flushPromises()
    expect(askQueue).toHaveLength(0)
    expect(w.emitted('import')).toHaveLength(1)
  })

  it('确认框开着时被接管(edit 翻假)→ 答「仍要导入」也不导', async () => {
    const w = hdr({ dirty: 2 })
    await importBtn(w).trigger('click')
    await flushPromises()
    expect(askQueue, '前置:确认框开着').toHaveLength(1)
    await w.setProps({ edit: false })
    answer(true)
    await flushPromises()
    expect(w.emitted('import')).toBeUndefined()
  })
})

describe('SchedHeader 改动数报给 auth(EDIT-MODE §6.1)', () => {
  it('页头与锁各登记一条,合计就是本屏草稿数(不按 1 算、不算两遍);草稿清零即 0', async () => {
    const w = hdr({ edit: false, scope: 'sched:s10:2025-03', dirty: 3 })
    await w.find('.lc-lockbtn').trigger('click')   // 占锁 → useEditLock 登记
    await flushPromises()
    await w.setProps({ edit: true })                // 进编辑态 → 页头登记
    await flushPromises()
    const auth = useAuthStore()
    expect(auth.editing, '前置:进了编辑态').toBe(true)
    expect(auth.dirtyTotal).toBe(3)
    await w.setProps({ dirty: 0 })
    expect(auth.dirtyTotal, '0 处改动关页签不该再问').toBe(0)
  })

  // 即时落库的 5 屏传的是「抽屉 / 导入窗开着 ? 1 : 0」。破坏验证:dirtyCount 不按 dirtyApprox 标 → 红
  it('❗dirtyApprox → 登记成数不准(离开确认不报处数);不传就是真处数', async () => {
    const auth = useAuthStore()
    const w = hdr({ edit: false, dirty: 1, dirtyApprox: true })
    await w.setProps({ edit: true })
    expect(auth.dirtyApproxOn('')).toBe(true)
    w.unmount()
    const w2 = hdr({ edit: false, dirty: 1 })
    await w2.setProps({ edit: true })
    expect(auth.dirtyApproxOn('')).toBe(false)
  })
})

// ── useSchedScreen ──
function host(rows: SchedRow[], over: Record<string, unknown> = {}) {
  let s!: ReturnType<typeof useSchedScreen>
  const call = vi.fn(async (_y: number) => {})
  const batchDelete = vi.fn(async (_ids: number[]) => {})
  mount(defineComponent({
    setup() {
      s = useSchedScreen({
        load: async () => {}, reloadOverview: async () => {}, rows: () => rows, clearData: () => {},
        batchDelete, clear: { call, confirm: clearConfirm('本月', '手动行不受影响。') }, ...over,
      })
      return () => null
    },
  }))
  return { s, call, batchDelete }
}
const IMP: SchedRow[] = [
  { id: 1, source: 'import', acctMonth: '2025-03' },
  { id: 2, source: 'import', acctMonth: '2025-03' },
  { id: 3, source: 'manual', acctMonth: '2025-03' },
]

describe('useSchedScreen 清空本期导入(删除类确认)与报错回执', () => {
  it('有导入行 → ask(danger) 问句带数,答「清空 2 条」才清', async () => {
    const { s, call } = host(IMP)
    s.year.value = 2025
    s.edit.value = true
    const p = s.onClearImported()
    await nextTick()
    expect(askQueue).toHaveLength(1)
    const q = askQueue[0]
    expect([q.title, q.body, q.action, q.danger]).toEqual(['清空本月 2 条导入数据？', '手动行不受影响。', '清空 2 条', true])
    expect(call, '答之前不清').not.toHaveBeenCalled()
    answer(true)
    await p
    expect(call).toHaveBeenCalledWith(2025)
  })

  it('确认框开着时被接管(edit 翻假)→ 答了也不清', async () => {
    const { s, call } = host(IMP)
    s.year.value = 2025
    s.edit.value = true
    const p = s.onClearImported()
    await nextTick()
    expect(askQueue, '前置:确认框开着').toHaveLength(1)
    s.edit.value = false
    answer(true)
    await p
    expect(call).not.toHaveBeenCalled()
  })

  it('没有导入行 → 回执一句,不弹确认', async () => {
    expect(await clearConfirm('本年', '手动行不受影响。')(0)).toBe(false)
    expect(askQueue).toHaveLength(0)
    expect(receipts.map(r => [r.tone, r.text])).toEqual([['warn', '本年没有导入的行']])
  })

  it('写失败 → 失败回执,后端的话优先', async () => {
    const { s, batchDelete } = host(IMP)
    batchDelete.mockRejectedValueOnce({ message: '种子行不能删' })
    s.year.value = 2025
    s.edit.value = true
    s.selectedIds.value = new Set([1])
    await s.onBatchDelete()
    expect(receipts.map(r => [r.tone, r.text])).toEqual([['fail', '种子行不能删']])
  })
})

describe('SchedYearGate 新增年份的字段报错(十件 ⑤)', () => {
  it('年份填错 → 红字贴在输入框下面的 .fp-field-err,框变红', async () => {
    const w = mount(SchedYearGate, {
      props: { icon: 'wallet', title: '附表13', sub: 's', years: [], current: 2025, storeKey: 'm4-test' },
    })
    await w.find('.sm-ynew').trigger('click')
    await w.find('.sm-yin').setValue('20')
    await w.find('.sm-yin').trigger('keydown', { key: 'Enter' })
    expect(w.find('.sm-ydlg-b .fp-field-err').text()).toBe('请输入四位年份,如 2023')
    expect(w.find('.sm-yin').classes()).toContain('err')
  })
})

// 当前年角标:有数据的最大年写「最新」;一年数据都没有(新园区空库,当前年 = 今年)写「今年」
describe('SchedYearGate 当前年角标', () => {
  const tag = (years: { year: number; hasData: boolean }[], current: number) => mount(SchedYearGate, {
    props: { icon: 'wallet', title: '附表13', sub: 's', current, storeKey: 'tag-test',
      years: years.map((y) => ({ ...y, metric: y.hasData ? '¥1万' : '', label: '' })) },
  }).find('.sm-yc-tag').text()
  it('❗有数据:最大数据年写「最新」;一年都没有:今年写「今年」', () => {
    expect(tag([{ year: 2024, hasData: false }, { year: 2025, hasData: true }, { year: 2026, hasData: false }], 2025)).toBe('最新')
    expect(tag([{ year: 2025, hasData: false }, { year: 2026, hasData: false }, { year: 2027, hasData: false }], 2026)).toBe('今年')
  })
})

describe('悬停说明换 v-tip(十件 ⑩)', () => {
  it('月胶囊:别人在编辑的月,悬停写谁在编辑', async () => {
    const seat = (p: Partial<Seat> & Pick<Seat, 'sid' | 'user' | 'editScopes' | 'self'>): Seat => ({
      displayName: p.user!, role: null, scope: 'sched:salary', label: '附表12',
      mode: 'edit', sinceMs: 1000, idleMs: 0, ...p,
    } as Seat)
    usePresenceStore().users = [seat({ sid: 's1', user: 'lisi', displayName: '李四', editScopes: ['sched:salary:2025-05'], self: false })]
    const w = mount(SchedMonthPills, { props: { value: 3, scopeOf: (m: number) => `sched:salary:2025-${String(m).padStart(2, '0')}` } })
    await nextTick()
    const pills = w.findAll('.lc-mpill')
    expect(tipOf(pills[4].element)).toBe('李四 正在编辑')
    expect(pills[4].attributes('title')).toBeUndefined()
  })

  it('水电表:锁住的月行尾锁标悬停说为什么', () => {
    const w = mount(UtilitiesTable, {
      props: { year: 2025, icon: 'zap', name: '办公水电', note: '', rows: [OFF(1, '2025-03')], total: OT,
               edit: true, lockedMonths: new Set([3]) },
    })
    expect(tipOf(w.find('.ut-actlock').element)).toBe('该月已审核 / 待审核 —— 撤销审核后才能改')
    expect(w.find('.ut-actlock').attributes('title')).toBeUndefined()
  })
})

const OT: OfficeTotal = { elecQty: 0, elecAmt: 0, waterQty: 0, waterAmt: 0, total: 0 }
const OFF = (id: number, acctMonth: string): OfficeRecordDTO => ({
  id, scheduleNo: 13, acctMonth, belongMonth: acctMonth, elecQty: 100, elecPrice: 1, elecAmt: 100,
  waterQty: 10, waterPrice: 3, waterAmt: 30, total: 130, note: null, source: 'manual',
})
const ST: SalaryTotal = {
  base: 0, post: 0, perf: 0, attend: 0, skill: 0, edu: 0, other: 0, lunch: 0, heat: 0,
  commission: 0, wageTotal: 0, gross: 0, social: 0, tax: 0, otherDeduct: 0, deduct: 0, net: 0,
}

describe('空状态换 FPEmpty(十件 ⑦)', () => {
  it('水电空年:FPEmpty 一句 + 副句;编辑态带「新增记账」,点了 emit add;浏览态无按钮', async () => {
    const w = mount(UtilitiesTable, {
      props: { year: 2025, icon: 'zap', name: '办公水电', note: '按月录入。', rows: [], total: OT, edit: true },
    })
    const e = w.find('.fp-empty')
    expect(e.find('.t').text()).toBe('2025 年暂无办公水电记录')
    expect(e.find('.sub').text()).toBe('按月录入。 进入编辑模式可手动新增;记录自动归入对应年份。')
    await e.find('button').trigger('click')
    expect(w.emitted('add')).toHaveLength(1)
    await w.setProps({ edit: false })
    expect(w.find('.fp-empty button').exists()).toBe(false)
  })

  it('工资空月:FPEmpty;编辑态「新增工资」点了 emit add', async () => {
    const w = mount(SalaryTable, { props: { year: 2025, month: 3, rows: [], total: ST, edit: true } })
    const e = w.find('.fp-empty')
    expect(e.find('.t').text()).toBe('2025年3月 暂无工资记录')
    await e.find('button').trigger('click')
    expect(w.emitted('add')).toHaveLength(1)
  })
})
