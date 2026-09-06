import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, KeepAlive, ref } from 'vue'
import { setActivePinia, createPinia } from 'pinia'

/**
 * 纯读屏切回重读(P3 §4.1 Step 6b):侧栏点击自本期起是「恢复现场」(open,不再 openFresh),
 * 名单里这些屏因此失去了唯一的刷新入口 —— 切走再切回,KeepAlive 命中缓存实例,`onMounted`
 * 不会再跑一次。它们都只在 `onMounted` 取数、屏内没有草稿态,补一条 `onReactivated(reload)`
 * 补回「切回重读」。
 *
 * 两条判据(缺一条就不补,不在这张表里):
 *   1. 取数函数只换数据,不清用户的筛选 / 分页 / 展开 / 抽屉;
 *   2. 屏内没有草稿态(没有 dirty / draft / 编辑锁)。
 *
 * 挂载测只挑 TenantsView 一屏验证行为(照 elecCostFlow.spec.ts:652 的 KeepAlive 開關写法);
 * 其余屏用下面的源码门禁兜——抓的是「有没有接上」,接没接对由挂载测那一份负责。
 */

vi.mock('@/api/tenant', () => ({
  tenantApi: {
    list: vi.fn(() => Promise.resolve([])),
    summary: vi.fn(() => Promise.resolve({ tenantActive: 0, occRate: 0, monthlyRent: 0, expiringTenants: 0 })),
    categories: vi.fn(() => Promise.resolve([])),
    detail: vi.fn(() => Promise.resolve(null)),
  },
}))

import TenantsView from '@/views/tenants/TenantsView.vue'
import { tenantApi } from '@/api/tenant'

beforeEach(() => {
  setActivePinia(createPinia())
  vi.mocked(tenantApi.list).mockClear()
  vi.mocked(tenantApi.summary).mockClear()
})

/** 把屏包进 KeepAlive,alive 开关模拟切走 / 切回(照 elecCostFlow.spec.ts:100)。 */
async function keptAlive() {
  const alive = ref(true)
  const w = mount(defineComponent({
    setup: () => () => h(KeepAlive, null, { default: () => (alive.value ? h(TenantsView) : null) }),
  }))
  await flushPromises()
  return { w, alive }
}

describe('纯读屏切回重读(P3 §4.1 Step6b) · 挂载测', () => {
  it('TenantsView:mount 取数一次;切走再切回 → 取数第二次', async () => {
    const { alive } = await keptAlive()
    expect(tenantApi.list).toHaveBeenCalledTimes(1)
    alive.value = false; await flushPromises()
    alive.value = true; await flushPromises()
    expect(tenantApi.list).toHaveBeenCalledTimes(2)
  })
})

const VIEWS = join(__dirname, '..')
const src = (rel: string) => readFileSync(join(VIEWS, rel), 'utf8')

/** 名单里补了 onReactivated 的屏(路径相对 src/views)。SystemRolesView(草稿态)/PvRoiView(reload
 *  会重置选中期)/PvMeterAnaView(屏内明文铁律「只有换年才重新取数」)三屏因判据不满足,不在表里
 *  ——理由见 task-2-report.md §Step6b。 */
const REACTIVATED_SCREENS = [
  '/data-home/DataHomeView.vue',
  '/tenants/TenantsView.vue',
  '/buildings/BuildingsView.vue',
  '/system/SystemUsersView.vue',
  '/system/SystemLogsView.vue',
  '/analysis/BudgetView.vue',
  '/analysis/ChargingAnalysisView.vue',
  '/analysis/FinCashflowView.vue',
  '/analysis/ParkView.vue',
  '/analysis/TenantEnergyView.vue',
  '/analysis/TenantPortfolioView.vue',
  '/analysis/BreakevenView.vue',
  '/analysis/ExpiryView.vue',
  '/analysis/CockpitView.vue',
]

describe('纯读屏切回重读(P3 §4.1 Step6b) · 源码门禁', () => {
  it.each(REACTIVATED_SCREENS)('%s 含 onReactivated(', (rel) => {
    expect(src(rel)).toContain('onReactivated(')
  })

  // 取数函数从「一次性」变成「可重入」之后新出的一类陈旧态:失败标志不清,
  // 重试成功了屏上还挂着上一次的失败卡(2026-09-06 T2 评审坐实)。
  it.each([
    ['/analysis/ParkView.vue', 'failed.value = false'],
    ['/analysis/TenantEnergyView.vue', "err.value = ''"],
    ['/analysis/TenantPortfolioView.vue', "err.value = ''"],
  ])('%s 的重读先清掉上一次的失败标志', (rel, reset) => {
    const body = src(rel).split('async function reload()')[1] ?? ''
    expect(body.slice(0, 400)).toContain(reset)
  })

  // KeepAlive 深度是「恢复现场」的实际收益所在:排在第 17 的屏切回就是空白重来。
  // 本期唯一没有门禁的改动点(评审把它改回 10,全量照样全绿)。
  it('App.vue 的 KeepAlive 深度是 16(D9;侧栏不再重建实例之后,这个数字决定切回去还在不在)', () => {
    expect(readFileSync(join(__dirname, '..', '..', 'App.vue'), 'utf8')).toContain(':max="16"')
  })
})
