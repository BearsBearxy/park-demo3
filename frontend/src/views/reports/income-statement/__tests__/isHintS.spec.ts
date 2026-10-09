// src/views/reports/income-statement/__tests__/isHintS.spec.ts
// 利润表屏 S 档「荐桌面」那句话(稿 ReportPhone §1 右栏 box4 条3)。
//
// 2026-10-03(横条盘点 IncomeStatementView:439,用户选推荐):原来是表上方一条 20px 常驻定高的横条,
// 编辑态才出字;现在并进标题旁的编辑签「编辑中 · N 处改动」—— S 档签上挂悬停说明,不再单占一行。
// 钉三件事:那一行没了(不占位、不顶表);编辑签只在编辑态出现、在标题行里(不在表上方插行);
// 只有 S 档挂这句,宽档签上没有悬停(桌面不荐桌面)。编辑按钮本身不拦不藏(§11.2)。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { useAuthStore } from '@/stores/auth'
import { _resetViewportForTest } from '@/composables/useViewport'
import IncomeStatementView from '../IncomeStatementView.vue'
import { companyApi } from '@/api/ledger'
import { reportApi } from '@/api/report'

vi.mock('@/api/ledger', () => ({
  companyApi: { list: vi.fn(), create: vi.fn(), rename: vi.fn(), remove: vi.fn() },
  ledgerApi: {},
}))
vi.mock('@/api/report', () => ({
  reportApi: { years: vi.fn(), year: vi.fn(), period: vi.fn(), allPeriod: vi.fn(), save: vi.fn(), addCustomRow: vi.fn(), deleteCustomRow: vi.fn() },
}))
vi.mock('@/api/review', () => ({
  reviewApi: {
    list: vi.fn(() => Promise.resolve([])), states: vi.fn(() => Promise.resolve([])),
    submit: vi.fn(), approve: vi.fn(), returnBack: vi.fn(), withdraw: vi.fn(), recall: vi.fn(),
    closedMonths: vi.fn(() => Promise.resolve([])), pending: vi.fn(() => Promise.resolve([])),
  },
}))
vi.mock('@/api/locks', () => ({
  locksApi: {
    acquire: vi.fn(() => Promise.resolve({ granted: true, holder: null, acquiredAt: 1 })),
    release: vi.fn(() => Promise.resolve()), releaseOnUnload: vi.fn(),
    heartbeat: vi.fn(() => Promise.resolve({ evicted: null })),
    takeover: vi.fn(() => Promise.resolve({ granted: true, holder: null })),
  },
}))
const query: Record<string, string> = {}
vi.mock('vue-router', () => ({
  useRoute: () => ({ query, meta: { value: 'income-statement' }, get fullPath() { return '/income-statement' } }),
  useRouter: () => ({ push: vi.fn() }),
}))

const SRC = readFileSync(join(__dirname, '../IncomeStatementView.vue'), 'utf8')
const tipOf = (el: Element) => (el as HTMLElement & { _tip?: { text: string } })._tip?.text

function wire() {
  vi.mocked(companyApi.list).mockResolvedValue([{ id: 1, name: '物业公司', short: '物业' }] as never)
  vi.mocked(reportApi.years).mockResolvedValue([{ year: 2025, months: 3 }] as never)
  vi.mocked(reportApi.year).mockResolvedValue({
    year: 2025,
    months: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, hasData: i < 3, netPreview: 1000 })),
  } as never)
  // 非退化:两行两列都有值
  vi.mocked(reportApi.period).mockResolvedValue({
    year: 2025, month: 1, rows: [], customRows: [],
    amounts: { '1': { cur: 120000, ytd: 380000 }, '2': { cur: 41000, ytd: 96000 } },
  } as never)
}

/** S 档(照 tbCardS 的 asS) */
function asS() {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: q.includes('max-width: 600px'), media: q,
    addEventListener() {}, removeEventListener() {},
  }))
  _resetViewportForTest()
}

async function openBody() {
  const w = mount(IncomeStatementView, {
    global: { stubs: { Teleport: true, RouterLink: true, 'router-link': true } },
  })
  await flushPromises()
  await w.findAll('.bmm-card')[0].trigger('click')
  await flushPromises()
  return w
}

beforeEach(() => {
  setActivePinia(createPinia())
  // v3 的 master:edit + report:edit 落到 v4:三张报表各自的编辑 + 公司新增删除(月度台账)+ 公司改名(催缴单收款公司)
  useAuthStore().permissions = ['income-statement:edit', 'balance-sheet:edit', 'trial-balance:edit', 'ledger:company', 'bill-notices:payee']
  vi.clearAllMocks()
  localStorage.clear()
  vi.setSystemTime(new Date('2025-06-15T00:00:00'))
  wire()
})
afterEach(() => { vi.unstubAllGlobals(); _resetViewportForTest() })

describe('利润表 · S 档荐桌面那句并进编辑签', () => {
  it('❗那一行横条撤了:源码和 DOM 里都没有 .is-s-hint', async () => {
    expect(SRC).not.toContain('is-s-hint')
    const w = await openBody()
    expect(w.find('.is-s-hint').exists()).toBe(false)
  })

  // 破坏验证:FinHead 的 v-tip 条件写成恒 null → 第三条断言红
  it('❗S 档编辑态:标题旁编辑签挂「小屏可录入,建议在桌面端操作」;录入格照常可用(§11.2)', async () => {
    asS()
    const w = await openBody()
    expect(w.find('.fh-l .fp-state.edit').exists(), '浏览态没有编辑签').toBe(false)
    await w.find('button.fp-emb').trigger('click')
    await flushPromises()
    const tag = w.find('.fh-l .fp-state.edit')
    expect(tag.text()).toBe('编辑中 · 0 处改动')
    expect(tipOf(tag.element)).toBe('小屏可录入,建议在桌面端操作')
    expect(w.findAll('.fin-wrap input.fin-ni').length).toBeGreaterThan(0)
  })

  it('❗宽档零差异:编辑签上没有这句悬停', async () => {
    const w = await openBody()
    await w.find('button.fp-emb').trigger('click')
    await flushPromises()
    expect(tipOf(w.find('.fh-l .fp-state.edit').element)).toBeUndefined()
  })
})
