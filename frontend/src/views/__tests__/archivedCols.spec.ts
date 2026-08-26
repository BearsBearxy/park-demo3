// 归档列端到端(spec §2 / 计划 Task 5):后端月度 DTO 的 archivedCols → 各屏版面 → 只读渲染。
//
// 头一版只改了 bookTemplate.ts 与 FPLedgerTable.vue,没有任何调用方传第三参数,
// 归档列一格也到不了屏上(纯死代码);附表10 一侧更是零改动。
// 这里把两屏的那根线各钉一条:台账走 LedgerWideTable(月度 DTO 直接是它的 prop),
// 附表10 走 S10View(monthData 归它自己持有,S10Table 只收算好的版面)。
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'
import LedgerWideTable from '@/views/ledger/LedgerWideTable.vue'
import S10View from '@/views/sales-income/S10View.vue'
import S10Table from '@/views/sales-income/S10Table.vue'
import type { Book, BookDef } from '@/types/book'
import type { LedgerMonthDTO, LedgerRowDTO } from '@/types/ledger'
import type { S10MonthDTO, S10RecordDTO, S10OverviewDTO } from '@/types/s10'
import { FEE_KEYS } from '@/utils/ledgerColumns'

const zeroFees = () => Object.fromEntries(FEE_KEYS.map(k => [k, 0])) as Record<string, number>

// 只留一个标准列的最小模板:表窄,按表头下标定位单元格不必数 21 列
const ledgerDef: BookDef = {
  groups: [{ id: 'g1', label: '租金', cols: [
    { id: 'factoryRent', std: true, label: '厂房租金', aliases: [], slot: 'rent', hidden: false, w: 96 },
  ] }],
}
const ledgerBook: Book = {
  id: 1, screen: 'ledger', companyId: 9, phase: null, name: '甲公司',
  ver: 3, latestVer: 3, definition: ledgerDef,
}

// c_arch 已从模板里消失(该月钉的版本不渲染它),但这一行的钱还在 —— 后端把它列进 archivedCols
const ledgerRow = {
  ...zeroFees(), id: 5, tenantId: 5, tenantName: '归档户', balancePrev: 0, totalCollected: 0,
  note: null, totalReceivable: 30, balanceEnd: -30, c_arch: 30,
} as unknown as LedgerRowDTO

const ledgerMonth: LedgerMonthDTO = {
  companyName: '甲公司', year: 2026, month: 9, prevMonth: 8,
  rows: [ledgerRow],
  footer: { ...zeroFees(), balancePrev: 0, totalReceivable: 30, totalCollected: 0, balanceEnd: -30 } as LedgerMonthDTO['footer'],
  archivedCols: [{ id: 'c_arch', label: '待归档费' }],
}

function mountLedger(edit: boolean) {
  return mount(LedgerWideTable, {
    props: {
      month: ledgerMonth, draft: [ledgerRow], book: ledgerBook, companyName: '甲公司',
      year: 2026, monthNo: 9, edit, saving: false,
    },
  })
}

/** 叶子表头里该列的下标 → 行内 td。按尾部倒推:右侧恒是 fixedRight 四列,
 *  左侧的 fixedLeft 两列在编辑态前面还多一列勾选,数它容易错。 */
function ledgerCell(w: ReturnType<typeof mountLedger>, label: string) {
  const leaf = w.findAll('thead tr')[1].findAll('th').map(t => t.text())
  const i = leaf.indexOf(label)
  expect(i, `叶子表头里没有「${label}」列`).toBeGreaterThanOrEqual(0)
  const tds = w.findAll('tbody tr')[0].findAll('td')
  return tds[tds.length - 4 - leaf.length + i]
}

describe('归档列 · 台账', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useAuthStore().permissions = ['entry:edit']
  })

  it('月度 DTO 的 archivedCols 进「已归档」组,浏览态显示已发生的钱', () => {
    const w = mountLedger(false)
    expect(w.findAll('thead tr')[0].findAll('th').map(t => t.text())).toContain('已归档')
    expect(ledgerCell(w, '待归档费').text()).toBe('30.00')
  })

  it('编辑态归档列不给输入框(hidden = 不再接受新录入),同表的活列照常可录', () => {
    const w = mountLedger(true)
    expect(ledgerCell(w, '待归档费').find('input').exists()).toBe(false)
    expect(ledgerCell(w, '厂房租金').find('input').exists()).toBe(true)
  })
})

// ── 附表10 ───────────────────────────────────────────────
const s10Def: BookDef = {
  groups: [{ id: 'g1', label: '租金', cols: [
    { id: 'factoryRent', std: true, label: '厂房租金', aliases: [], slot: 'rent', hidden: false, w: null },
  ] }],
}
const s10Book: Book = {
  id: 7, screen: 's10', companyId: null, phase: 1, name: '一期',
  ver: 3, latestVer: 3, definition: s10Def,
}
const s10Row = {
  id: 11, tenantId: 11, tenantName: '附10归档户', phase: 1, profile: 'factory', note: null,
  source: 'manual', total: 9, extraFees: { c_s10arch: 9 },
} as unknown as S10RecordDTO
const s10Month: S10MonthDTO = {
  phase: 1, year: 2026, month: 9, recorded: true, rows: [s10Row],
  columnTotals: {}, grandTotal: 9,
  archivedCols: [{ id: 'c_s10arch', label: '附10归档费' }],
}
const overview: S10OverviewDTO = {
  years: [2026], currentYear: 2026, currentMonth: 9,
  summaries: [{ year: 2026, recordedMonths: 9, tenantCount: 1 }],
}

vi.mock('@/api/s10', () => ({
  s10Api: {
    getOverview: () => Promise.resolve(overview),
    getMonth: () => Promise.resolve(s10Month),
    batchDelete: () => Promise.resolve({ deleted: 0 }),
    clearImported: () => Promise.resolve({ deleted: 0 }),
  },
}))
vi.mock('@/api/books', () => ({ booksApi: { list: () => Promise.resolve([s10Book]) } }))
vi.mock('@/api/tenant', () => ({ tenantApi: { list: () => Promise.resolve([]) } }))
vi.mock('vue-router', () => ({
  // 深链直落表格态:绕开选期矩阵,省得在测试里点月卡
  useRoute: () => ({ query: { y: '2026', m: '9', phase: '1', tenant: '' } }),
  useRouter: () => ({ push: vi.fn() }),
}))

describe('归档列 · 附表10', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useAuthStore().permissions = ['entry:edit']
  })

  it('S10View 把本月 archivedCols 喂给版面,归档列出现在表头', async () => {
    const w = mount(S10View)
    await flushPromises()
    const heads = w.findAll('thead th').map(t => t.text())
    expect(heads).toContain('已归档')
    expect(heads).toContain('附10归档费')
  })

  it('编辑态归档叶子不给输入框,活列照常可录', () => {
    const w = mount(S10Table, {
      props: {
        groups: [
          { label: '租金', leaves: [{ colId: 'factoryRent', label: '厂房租金' }] },
          { label: '已归档', leaves: [{ colId: 'c_s10arch', label: '附10归档费', readonly: true }] },
        ],
        phaseName: '一期', year: 2026, month: 9, rows: [s10Row], edit: true,
      } as unknown as InstanceType<typeof S10Table>['$props'],
    })
    const leaf = w.findAll('thead tr')[0].findAll('th').map(t => t.text())
    // 两组都是有 label 的多级表头 → 叶子在第二行,顺序 = 组展平顺序
    const subs = w.findAll('thead tr')[1].findAll('th').map(t => t.text())
    expect(leaf).toContain('已归档')
    const tds = w.findAll('tbody tr.s10-row')[0].findAll('td')
    expect(tds[1 + subs.indexOf('厂房租金')].find('input').exists()).toBe(true)
    expect(tds[1 + subs.indexOf('附10归档费')].find('input').exists()).toBe(false)
  })
})
