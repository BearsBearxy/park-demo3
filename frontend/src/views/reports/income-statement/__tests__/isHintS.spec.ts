// src/views/reports/income-statement/__tests__/isHintS.spec.ts
// 利润表屏 S 档「荐桌面」提示行(稿 ReportPhone §1 右栏 box4 条3)。
//
// 钉的是**常驻**这一条:行要一直在,只有里面那句话跟着编辑态出现/消失。
// 写成 v-if 整行显隐的话,一进编辑模式下面整张表就往下掉 20+16px ——
// 那正是 LAYOUT-STABILITY-SPEC §4.2 点名不许的位移,而且没有断言就没人会发现。
// 编辑按钮本身不拦不藏(§11.2:手机录入不禁止、不隐藏、不优化,只荐桌面)。
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { readFileSync } from 'node:fs'
import { mediaBlock } from '@/test-utils/mediaBlock'
import { join } from 'node:path'

import { useAuthStore } from '@/stores/auth'
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
const STYLE = SRC.slice(SRC.indexOf('<style')).replace(/\/\*[\s\S]*?\*\//g, '')

function wire() {
  vi.mocked(companyApi.list).mockResolvedValue([{ id: 1, name: '物业公司', short: '物业' }] as never)
  vi.mocked(reportApi.years).mockResolvedValue([{ year: 2025, months: 3 }] as never)
  vi.mocked(reportApi.year).mockResolvedValue({
    year: 2025,
    months: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, hasData: i < 3, netPreview: 1000 })),
  } as never)
  // 非退化:两行两列都有值,表不是空的(空表时「提示行在表前面」那条断言会退化成恒真)
  vi.mocked(reportApi.period).mockResolvedValue({
    year: 2025, month: 1, rows: [], customRows: [],
    amounts: { '1': { cur: 120000, ytd: 380000 }, '2': { cur: 41000, ytd: 96000 } },
  } as never)
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
  useAuthStore().permissions = ['master:edit', 'report:edit']
  vi.clearAllMocks()
  localStorage.clear()
  vi.setSystemTime(new Date('2025-06-15T00:00:00'))
  wire()
})

describe('利润表 · S 档荐桌面提示行', () => {
  it('❗行常驻:浏览态就在 DOM 里(空文案),进编辑只换里面那句话,不是整行出现', async () => {
    const w = await openBody()
    const hint = w.find('.is-s-hint')
    expect(hint.exists(), '提示行改成了「出错/编辑才出现」= 下面整张表会被顶下去').toBe(true)
    expect(hint.text()).toBe('')
    expect(hint.findAll('span')).toHaveLength(0)

    await w.find('button.fp-emb').trigger('click')
    await flushPromises()
    expect(w.findAll('.is-s-hint'), '编辑态多渲了一行').toHaveLength(1)
    expect(w.find('.is-s-hint').text()).toBe('编辑模式 · 小屏可录入,建议在桌面端操作')
    // 编辑按钮不拦不藏:进了编辑态,工具行上的录入格照常可用(§11.2)
    expect(w.findAll('.fin-wrap input.fin-ni').length).toBeGreaterThan(0)
  })

  it('❗位置:夹在工具行与表之间(紧挨着表,不是页脚那一行)', async () => {
    const w = await openBody()
    const hint = w.find('.is-s-hint').element
    expect(hint.previousElementSibling?.className).toContain('fin-toolbar')
    expect(hint.nextElementSibling?.querySelector('table.fin-table'), '提示行和表之间插了别的东西').not.toBeNull()
  })

  it('❗宽档零差异:桌面档整行 display:none,20px 定高只写在 ≤600 块里', async () => {
    // ⚠ 不许写 `STYLE.slice(indexOf(...))`:那是「切到文件尾」不是「块内」——
    //   600px 块在 :533 开、:536 闭,其后还有约 50 行 CSS。把 .is-s-hint 整条挪到块外
    //   (正是要防的桌面回归)三条断言照样全绿,实跑验证过。按大括号配对切。
    const sBlock = mediaBlock(STYLE, '@media (max-width: 600px)')
    const outside = STYLE.replace(sBlock, '')
    // 桌面那条 display:none 必须在**块外** —— 写在块内它就成了 S 档规则,桌面反而显出来
    expect(outside).toMatch(/\.is-s-hint\s*\{\s*display:\s*none;?\s*\}/)
    expect(sBlock).toMatch(/\.is-s-hint\s*\{[^}]*height:\s*20px/)
    expect(sBlock).toMatch(/\.is-s-hint\s*\{[^}]*flex:\s*0 0 20px/)
    // 定高不能写成 min-height:内容多一行就把表顶下去,和整行显隐一个后果
    expect(sBlock).not.toMatch(/\.is-s-hint\s*\{[^}]*min-height/)
    // 断点只许 600(breakpoints.ts 是唯一事实源)
    expect([...STYLE.matchAll(/@media\s*\(max-width:\s*(\d+)px\)/g)].map(m => m[1])).toEqual(['600'])
  })
})
