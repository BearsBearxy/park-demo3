import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { fpBuildRoutes, ANA_MOBILE_HOME } from '@/nav/fpNav'
import { useAuthStore } from '@/stores/auth'
import { useTabsStore } from '@/stores/tabs'
import { useUiStore } from '@/stores/ui'
import { useUpdateStore } from '@/stores/update'

const PlaceholderView = () => import('@/views/PlaceholderView.vue')
const Gallery = () => import('@/views/Gallery.vue')
const LoginView = () => import('@/views/LoginView.vue')
const ChangePasswordView = () => import('@/views/ChangePasswordView.vue')
// 首页与新标签页:同一个组件,按 route.meta.value 分两种点击规则(TAB-BAR-SPEC §5.5)
const HomeView = () => import('@/views/home/HomeView.vue')
// 分析层手机落地页:不在导航里(桌面进分析层仍落 cockpit),只有底栏/抽屉的 goLayer 在 S 档落它
const AnaHomeView = () => import('@/views/analysis/AnaHomeView.vue')
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
  'params': () => import('@/views/params/ParamCenterView.vue'),   // S21:取代 price-cfg 价目管理(旧地址见下方 redirect)
  'meters': () => import('@/views/meters/MeterView.vue'),
  'alloc': () => import('@/views/alloc/PoolLedgerView.vue'),
  'alloc-loss': () => import('@/views/alloc/LossLedgerView.vue'),
  'bill-notices': () => import('@/views/bills/BillNoticesView.vue'),
  'ledger': () => import('@/views/ledger/LedgerView.vue'),
  'pv-income': () => import('@/views/pv/PvView.vue'),
  'car-charging': ChargingView,
  'ebike-charging': ChargingView,
  'sales-income': () => import('@/views/sales-income/S10View.vue'),
  'elec-cost': () => import('@/views/elec/ElecView.vue'),
  'salary': () => import('@/views/salary/SalaryView.vue'),
  'utilities': () => import('@/views/utilities/UtilitiesView.vue'),
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
  'tenant-peer': () => import('@/views/analysis/TenantPeerView.vue'),
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
  'pv-meter-analysis': () => import('@/views/analysis/PvMeterAnaView.vue'),
  'anomaly': () => import('@/views/analysis/AnomalyView.vue'),
  'elec-analysis': () => import('@/views/analysis/ElecAnalysisView.vue'),
  'charging-analysis': () => import('@/views/analysis/ChargingAnalysisView.vue'),
  // 系统管理(整层按 system:view 显隐,见 nav/navAccess.ts)
  'sys-users': () => import('@/views/system/SystemUsersView.vue'),
  'sys-roles': () => import('@/views/system/SystemRolesView.vue'),
  'sys-logs': () => import('@/views/system/SystemLogsView.vue'),
}

const navRoutes = fpBuildRoutes()

if (import.meta.env.DEV) {
  // 两侧差集都要报:少配 = 该屏静默变占位页;多配 = 导航删了屏但表里没删,是块死代码
  const missing = Object.keys(navRoutes).filter((v) => !(v in VIEWS))
  const orphan = Object.keys(VIEWS).filter((v) => !(v in navRoutes))
  if (missing.length || orphan.length) console.warn('[router] 路由表与导航不同步', { 导航有但没配组件: missing, 配了组件但导航里没有: orphan })
}

// 浏览器后退 / 前进:后退到一个已经关掉的屏时开在右边的新页签,不把正看着的那一格换掉(TAB-BAR-SPEC §2)。
// ⚠ 必须在 createRouter(createWebHistory)**之前**注册:浏览器派发 popstate 时每个监听跑完就清一次微任务,
//   router 的监听若在前,它的导航守卫(beforeEach)会在这里置位之前就跑完(2026-09-18 浏览器实测)。
let popNav = false
if (typeof window !== 'undefined') window.addEventListener('popstate', () => { popNav = true })

const router = createRouter({
  history: createWebHistory(),
  routes: [
    // 登录后一律落首页(TAB-BAR-SPEC §2);判据全在 auth.landing 一处。
    // pinia 先于 router 安装,守卫期取 store 安全。
    { path: '/', redirect: () => useAuthStore().landing },
    // 首页与新标签页:不在导航里,但都是页签(stores/tabs.ts 的 HOME / NEWTAB)
    { path: '/home', component: HomeView, meta: { value: 'home', page: '首页' } },
    { path: '/newtab', component: HomeView, meta: { value: 'newtab', page: '新标签页' } },
    // 分析层手机落地页(响应式稿 JourneyEntry):不进导航,否则桌面侧栏会多出一条谁也点不开的屏。
    // 顶栏标题写**层名**「分析」不是屏名 —— 它是这一层在手机上的门厅,不是第 21 屏。
    { path: '/' + ANA_MOBILE_HOME, component: AnaHomeView, meta: { value: ANA_MOBILE_HOME, page: '分析' } },
    // S21:价目管理退役,旧地址(书签 / 最近访问)落到计费参数页
    { path: '/price-cfg', redirect: '/params' },
    // 2026-09-03(SIDEBAR-UX-REDESIGN D4):银行流水条目删除,旧地址(书签 / 最近访问)落首页。
    // 后端从没有这块数据,占位页常驻两个月是死 UI;PlaceholderView 只留作下方 component 的漏配兜底。
    { path: '/bank-flow', redirect: '/data-home' },
    { path: '/login', component: LoginView },
    // 不进导航:首次登录强制改密的落点,也可自行访问改密
    { path: '/change-password', component: ChangePasswordView },
    { path: '/_gallery', component: Gallery },
    ...Object.values(navRoutes).map((meta): RouteRecordRaw => ({
      path: `/${meta.value}`,
      component: VIEWS[meta.value] ?? PlaceholderView,
      // 展开成新鲜字面量:fpNav.RouteMeta 是具名接口,无隐式索引签名,直接赋给 vue-router 的 meta 会报 TS2322
      meta: { ...meta },
    })),
    // 撤下的屏(如 2026-08-13 的 /bills 账单管理)与手打错的地址都落这里。
    // 没有兜底时 vue-router 匹配不到会渲染空 router-view —— 外壳在、内容区全白,像页面崩了。
    // 标签页/最近访问的残留项由 tabs store 的 ROUTES 过滤自动丢弃,不必在此处理。
    { path: '/:pathMatch(.*)*', redirect: () => useAuthStore().landing },
  ],
})

router.beforeEach((to) => {
  // ponytail: useAuthStore() called inside guard so pinia is already active
  const auth = useAuthStore()
  // 置位要在鉴权分支之前:返回重定向对象时本次导航仍会被最终导航的 afterEach 复位,不会漏关
  useUiStore().startNav()
  // 这一跳想开在哪:没人登记过就按「页面里点出来的 / 后退前进」补默认(TAB-BAR-SPEC §2)
  const tv = (to.meta as Record<string, unknown>).value
  if (typeof tv === 'string') useTabsStore().beforeNav(tv, popNav)
  popNav = false
  if (!auth.isAuthed && to.path !== '/login') {
    return { path: '/login', query: { redirect: to.path } }
  }
  // 首次登录强制改密:除改密页与登录页外一律拦回改密页。
  // 目标本就是 /change-password 时必须放行,否则守卫自己把自己拦成死循环
  if (auth.isAuthed && auth.mustChangePassword && to.path !== '/change-password' && to.path !== '/login') {
    return { path: '/change-password' }
  }
  if (auth.isAuthed && to.path === '/login') {
    return { path: auth.landing }
  }
  // 系统管理层是**全站唯一读也管的一段**(RBAC-SPEC §4/§5.1):无 system:view 一律兜回首页。
  // 其余 47 屏刻意不拦 —— 读全开,无权也进得去、数据照显,只是没有写入口。
  // 不拦的话手打地址能进到一个「后端 403、页面只剩报错」的屏,看着像系统坏了。
  if (auth.isAuthed && (to.meta as Record<string, unknown>).layer === 'system' && !auth.can('system:view')) {
    return { path: auth.landing }
  }
})

router.afterEach((to, _from, failure) => {
  useUiStore().endNav()
  const v = (to.meta as Record<string, unknown>).value as string | undefined
  // 被取消 / 重复的导航也会走到这里,那时路由根本没动 —— 不能把 active 记成没到达的目标
  if (v && !failure) {
    // ponytail: useTabsStore() called lazily — pinia is active by afterEach time
    // 先 commit 再 setActive:commit 按「导航之前那一格」决定换哪一格。导航落定这一刻才动页签条,
    // 取消 / 失败 / 被守卫踢走的导航不留痕(stores/tabs.ts 顶部注释)。
    const tabs = useTabsStore()
    tabs.commit(v)
    tabs.setActive(v)
  } else if (failure) {
    useTabsStore().clearIntent()
  }
})

// chunk 加载失败(发版后旧 hash 404 是常见场景)走 onError 而不走 afterEach,
// 这里不复位进度条就会永远卡在页顶。
// 而「加载失败」这件事本身已经能确定原因:这一页的文件随发版换掉了 —— 底部提示条
// 请他刷新(VERSION-UPDATE-SPEC §6),不必等下一次轮询。只认这一类错误:
// 守卫里 return 出去的重定向不会走到这里,但别的运行时异常会,那些不该说成「有新版」。
const CHUNK_FAIL = /dynamically imported module|Importing a module script failed|Loading chunk|CSS chunk/i
router.onError((err: unknown) => {
  useUiStore().endNav()
  useTabsStore().clearIntent()
  if (CHUNK_FAIL.test(String((err as Error)?.message ?? err))) useUpdateStore().reportBlocked()
})

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
