import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { fpBuildRoutes } from '@/nav/fpNav'
import { useAuthStore } from '@/stores/auth'
import { useTabsStore } from '@/stores/tabs'

const PlaceholderView = () => import('@/views/PlaceholderView.vue')
const Gallery = () => import('@/views/Gallery.vue')
const LoginView = () => import('@/views/LoginView.vue')
const BuildingsView = () => import('@/views/buildings/BuildingsView.vue')
const TenantsView = () => import('@/views/tenants/TenantsView.vue')
const ContractsView = () => import('@/views/contracts/ContractsView.vue')
const PriceCfgView = () => import('@/views/price-cfg/PriceCfgView.vue')
const LedgerView = () => import('@/views/ledger/LedgerView.vue')
const BillsView = () => import('@/views/bills/BillsView.vue')
const MeterView = () => import('@/views/meters/MeterView.vue')
const AllocView = () => import('@/views/alloc/AllocView.vue')
const PvView = () => import('@/views/pv/PvView.vue')
const ChargingView = () => import('@/views/charging/ChargingView.vue')
const SalaryView = () => import('@/views/salary/SalaryView.vue')
const ElecView = () => import('@/views/elec/ElecView.vue')
const UtilitiesView = () => import('@/views/utilities/UtilitiesView.vue')
const S10View = () => import('@/views/sales-income/S10View.vue')
const IncomeStatementView = () => import('@/views/reports/income-statement/IncomeStatementView.vue')
const BalanceSheetView = () => import('@/views/reports/balance-sheet/BalanceSheetView.vue')
const TrialBalanceView = () => import('@/views/reports/trial-balance/TrialBalanceView.vue')
const PnlScheduleView = () => import('@/views/reports/pnl/PnlScheduleView.vue')
// 损益附表 1–5:5 条路由共用同一参数化 View(P2-D spec D4)
const PNL_ROUTES = ['rent-pnl', 'elec-pnl', 'water-pnl', 'ops-pnl', 'expense-pnl']
const ReconView = () => import('@/views/reports/recon/ReconView.vue')
const ReportsHomeView = () => import('@/views/reports/home/ReportsHomeView.vue')
const DataHomeView = () => import('@/views/data-home/DataHomeView.vue')
const ImportCenterView = () => import('@/views/import-center/ImportCenterView.vue')
// P3 经营分析 14 屏(value → view;骨架见 views/analysis/,屏组 agent 各自填充主体)
const ANA_VIEWS: Record<string, RouteRecordRaw['component']> = {
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

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/data-home' },
    { path: '/login', component: LoginView },
    { path: '/_gallery', component: Gallery },
    ...Object.values(navRoutes).map((meta): RouteRecordRaw => ({
      path: `/${meta.value}`,
      component: meta.value === 'data-home' ? DataHomeView : meta.value === 'buildings' ? BuildingsView : meta.value === 'tenants' ? TenantsView : meta.value === 'contracts' ? ContractsView : meta.value === 'price-cfg' ? PriceCfgView : meta.value === 'ledger' ? LedgerView : meta.value === 'bills' ? BillsView : meta.value === 'meters' ? MeterView : meta.value === 'alloc' ? AllocView : meta.value === 'pv-income' ? PvView : (meta.value === 'car-charging' || meta.value === 'ebike-charging') ? ChargingView : meta.value === 'salary' ? SalaryView : meta.value === 'elec-cost' ? ElecView : meta.value === 'utilities' ? UtilitiesView : meta.value === 'sales-income' ? S10View : meta.value === 'income-statement' ? IncomeStatementView : meta.value === 'balance-sheet' ? BalanceSheetView : meta.value === 'trial-balance' ? TrialBalanceView : PNL_ROUTES.includes(meta.value) ? PnlScheduleView : meta.value === 'reconciliation' ? ReconView : meta.value === 'reports-home' ? ReportsHomeView : meta.value === 'import' ? ImportCenterView : ANA_VIEWS[meta.value] ?? PlaceholderView,
      // 展开成新鲜字面量:fpNav.RouteMeta 是具名接口,无隐式索引签名,直接赋给 vue-router 的 meta 会报 TS2322
      meta: { ...meta },
    })),
  ],
})

router.beforeEach((to) => {
  // ponytail: useAuthStore() called inside guard so pinia is already active
  const auth = useAuthStore()
  if (!auth.isAuthed && to.path !== '/login') {
    return { path: '/login', query: { redirect: to.path } }
  }
  if (auth.isAuthed && to.path === '/login') {
    return { path: '/data-home' }
  }
})

router.afterEach((to) => {
  const v = (to.meta as Record<string, unknown>).value as string | undefined
  if (v) {
    // ponytail: useTabsStore() called lazily — pinia is active by afterEach time
    useTabsStore().open(v)
  }
})

export default router
