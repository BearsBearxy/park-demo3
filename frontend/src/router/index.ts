import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { fpBuildRoutes } from '@/nav/fpNav'
import { useAuthStore } from '@/stores/auth'
import { useTabsStore } from '@/stores/tabs'
import { useUiStore } from '@/stores/ui'

const PlaceholderView = () => import('@/views/PlaceholderView.vue')
const Gallery = () => import('@/views/Gallery.vue')
const LoginView = () => import('@/views/LoginView.vue')
// 充电桩两屏(汽车/电动车)共用同一参数化 View
const ChargingView = () => import('@/views/charging/ChargingView.vue')
// 损益附表 1–5:5 条路由共用同一参数化 View(P2-D spec D4)
const PnlScheduleView = () => import('@/views/reports/pnl/PnlScheduleView.vue')

// 导航 value → 屏组件。加新屏只需在这里补一行;漏配会被下面的 DEV 护栏点名(否则静默降级成占位页,没人发现)。
const VIEWS: Record<string, RouteRecordRaw['component']> = {
  // 数据中心
  'data-home': () => import('@/views/data-home/DataHomeView.vue'),
  'buildings': () => import('@/views/buildings/BuildingsView.vue'),
  'tenants': () => import('@/views/tenants/TenantsView.vue'),
  'contracts': () => import('@/views/contracts/ContractsView.vue'),
  'price-cfg': () => import('@/views/price-cfg/PriceCfgView.vue'),
  'meters': () => import('@/views/meters/MeterView.vue'),
  'alloc': () => import('@/views/alloc/PoolLedgerView.vue'),
  'alloc-loss': () => import('@/views/alloc/LossLedgerView.vue'),
  'bill-notices': () => import('@/views/bills/BillNoticesView.vue'),
  'ledger': () => import('@/views/ledger/LedgerView.vue'),
  'bills': () => import('@/views/bills/BillsView.vue'),
  'pv-income': () => import('@/views/pv/PvView.vue'),
  'car-charging': ChargingView,
  'ebike-charging': ChargingView,
  'sales-income': () => import('@/views/sales-income/S10View.vue'),
  'elec-cost': () => import('@/views/elec/ElecView.vue'),
  'salary': () => import('@/views/salary/SalaryView.vue'),
  'utilities': () => import('@/views/utilities/UtilitiesView.vue'),
  // 已知死链:后端也没有这块数据(见审计),显式落占位页 —— 不显式列出的话护栏会天天报它,报多了就没人看了
  'bank-flow': PlaceholderView,
  'import': () => import('@/views/import-center/ImportCenterView.vue'),
  // 账簿与报表
  'reports-home': () => import('@/views/reports/home/ReportsHomeView.vue'),
  'income-statement': () => import('@/views/reports/income-statement/IncomeStatementView.vue'),
  'balance-sheet': () => import('@/views/reports/balance-sheet/BalanceSheetView.vue'),
  'trial-balance': () => import('@/views/reports/trial-balance/TrialBalanceView.vue'),
  'rent-pnl': PnlScheduleView,
  'elec-pnl': PnlScheduleView,
  'water-pnl': PnlScheduleView,
  'ops-pnl': PnlScheduleView,
  'expense-pnl': PnlScheduleView,
  'reconciliation': () => import('@/views/reports/recon/ReconView.vue'),
  // P3 经营分析(骨架见 views/analysis/)
  'cockpit': () => import('@/views/analysis/CockpitView.vue'),
  'park': () => import('@/views/analysis/ParkView.vue'),
  'park-energy': () => import('@/views/analysis/ParkEnergyView.vue'),
  'tenant-energy': () => import('@/views/analysis/TenantEnergyView.vue'),
  'tenant-portfolio': () => import('@/views/analysis/TenantPortfolioView.vue'),
  'fin-pnl': () => import('@/views/analysis/FinPnlView.vue'),
  'fin-balance': () => import('@/views/analysis/FinBalanceView.vue'),
  'fin-cashflow': () => import('@/views/analysis/FinCashflowView.vue'),
  'fin-expense': () => import('@/views/analysis/ExpenseView.vue'),
  'churn': () => import('@/views/analysis/ChurnView.vue'),
  'expiry': () => import('@/views/analysis/ExpiryView.vue'),
  'breakeven': () => import('@/views/analysis/BreakevenView.vue'),
  'pnl-analysis': () => import('@/views/analysis/PnlAnalysisView.vue'),
  'budget': () => import('@/views/analysis/BudgetView.vue'),
  'pv-roi': () => import('@/views/analysis/PvRoiView.vue'),
  'anomaly': () => import('@/views/analysis/AnomalyView.vue'),
  'elec-analysis': () => import('@/views/analysis/ElecAnalysisView.vue'),
  'charging-analysis': () => import('@/views/analysis/ChargingAnalysisView.vue'),
}

const navRoutes = fpBuildRoutes()

if (import.meta.env.DEV) {
  // 两侧差集都要报:少配 = 该屏静默变占位页;多配 = 导航删了屏但表里没删,是块死代码
  const missing = Object.keys(navRoutes).filter((v) => !(v in VIEWS))
  const orphan = Object.keys(VIEWS).filter((v) => !(v in navRoutes))
  if (missing.length || orphan.length) console.warn('[router] 路由表与导航不同步', { 导航有但没配组件: missing, 配了组件但导航里没有: orphan })
}

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/data-home' },
    { path: '/login', component: LoginView },
    { path: '/_gallery', component: Gallery },
    ...Object.values(navRoutes).map((meta): RouteRecordRaw => ({
      path: `/${meta.value}`,
      component: VIEWS[meta.value] ?? PlaceholderView,
      // 展开成新鲜字面量:fpNav.RouteMeta 是具名接口,无隐式索引签名,直接赋给 vue-router 的 meta 会报 TS2322
      meta: { ...meta },
    })),
  ],
})

router.beforeEach((to) => {
  // ponytail: useAuthStore() called inside guard so pinia is already active
  const auth = useAuthStore()
  // 置位要在鉴权分支之前:返回重定向对象时本次导航仍会被最终导航的 afterEach 复位,不会漏关
  useUiStore().startNav()
  if (!auth.isAuthed && to.path !== '/login') {
    return { path: '/login', query: { redirect: to.path } }
  }
  if (auth.isAuthed && to.path === '/login') {
    return { path: '/data-home' }
  }
})

router.afterEach((to) => {
  useUiStore().endNav()
  const v = (to.meta as Record<string, unknown>).value as string | undefined
  if (v) {
    // ponytail: useTabsStore() called lazily — pinia is active by afterEach time
    useTabsStore().open(v)
  }
})

// chunk 加载失败(发版后旧 hash 404 是常见场景)走 onError 而不走 afterEach,
// 这里不复位进度条就会永远卡在页顶。
router.onError(() => { useUiStore().endNav() })

// ponytail: 纯预热 —— 空闲时把各屏 chunk 提前拉进浏览器缓存,第二次点击起零等待。
// 失败一律静默:预取不成功只是没热到,不该影响任何可见行为(旧 chunk 404 尤其常见)。
// 必须错峰:45 屏一口气并发会占满浏览器连接数,抢走当前屏取数的带宽 —— 每轮只拉 4 个,拉完再排下一轮。
function onIdle(cb: () => void) {
  // Safari 老版本没有 requestIdleCallback,退化成延时(预热而已,不值得引 polyfill)
  if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(() => cb())
  else window.setTimeout(cb, 2000)
}

function prefetchRouteChunks() {
  const loaders = router.getRoutes()
    .map((r) => r.components?.default)
    .filter((c): c is () => unknown => typeof c === 'function')
  const nextBatch = () => {
    const batch = loaders.splice(0, 4)
    if (!batch.length) return
    // Promise.resolve().then(load) 兜住同步抛错与非 Promise 返回值
    Promise.all(batch.map((load) => Promise.resolve().then(load).catch(() => {})))
      .then(() => onIdle(nextBatch))
  }
  onIdle(nextBatch)
}

// 等首次导航解析完再开始,别和首屏关键请求抢带宽;首次导航就失败时不预热也不再多抛一次未捕获拒绝
void router.isReady().then(prefetchRouteChunks, () => {})

export default router
