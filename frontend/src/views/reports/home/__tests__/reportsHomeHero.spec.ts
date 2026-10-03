// 报表中心「期间」视图(横条盘点 ReportsHomeView:149,2026-10-03):
// 原来顶上一张块级描边卡 .rh-period-hero(期间核算 + 说明 + 「n / m 项已平」徽章)常驻,把勾稽卡往下推;
// 现在「n / m 项已平」是标题旁的页面状态签,说明并进副句。目录视图不出这颗签(那边分区标题里已经写着)。
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }), useRoute: () => ({ query: {}, meta: {} }) }))
// 夹具不退化:三项里两项平、一项不平 —— 全平的话「n / m」写死成 m / m 也绿
const TIE = vi.hoisted(() => [
  { label: '利润表·营业收入', a: '利润表', b: '附表10', value: '1', ok: true },
  { label: '资产 = 负债 + 权益', a: '资产负债表', b: '资产负债表', value: '2', ok: true },
  { label: '期末借 = 期末贷', a: '科目余额表', b: '科目余额表', value: '3', ok: false },
])
vi.mock('@/reports/reportsHome', async (o) => ({
  ...(await o<object>()),
  defaultPeriod: vi.fn().mockResolvedValue({ year: 2025, month: 6 }),
  loadHomeData: vi.fn().mockResolvedValue({ cards: [], tieout: TIE, year: 2025, month: 6 }),
}))

import ReportsHomeView from '../ReportsHomeView.vue'

beforeEach(() => { setActivePinia(createPinia()); localStorage.clear() })

describe('报表中心 · 期间视图', () => {
  // 破坏验证:状态签的 v-if 写成 false → 第二条红;hero 卡加回来 → 第一条红
  it('❗切到「期间」:没有 hero 卡;标题旁签「2 / 3 项已平」(有没平的 → 黄签);说明进副句', async () => {
    const w = mount(ReportsHomeView)
    await flushPromises()
    expect(w.find('.rh-tl .fp-state').exists(), '目录视图不出这颗签').toBe(false)
    ;(w.vm as unknown as { view: string }).view = '期间'
    await flushPromises()
    expect(w.find('.rh-period-hero').exists()).toBe(false)
    const tag = w.find('.rh-tl .fp-state')
    expect(tag.text()).toBe('2 / 3 项已平')
    expect(tag.classes()).toContain('warn')
    expect(w.find('.rh-sub').text()).toBe('先锁定期间,检查三大报表与各附表之间是否勾稽一致,再逐表查看')
  })
})
