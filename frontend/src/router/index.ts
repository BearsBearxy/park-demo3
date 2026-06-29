import { createRouter, createWebHistory } from 'vue-router'
import { fpBuildRoutes } from '@/nav/fpNav'
import { useAuthStore } from '@/stores/auth'
import { useTabsStore } from '@/stores/tabs'

const PlaceholderView = () => import('@/views/PlaceholderView.vue')
const Gallery = () => import('@/views/Gallery.vue')
const LoginView = () => import('@/views/LoginView.vue')
const BuildingsView = () => import('@/views/buildings/BuildingsView.vue')
const TenantsView = () => import('@/views/tenants/TenantsView.vue')
const ContractsView = () => import('@/views/contracts/ContractsView.vue')
const LedgerView = () => import('@/views/ledger/LedgerView.vue')
const PvView = () => import('@/views/pv/PvView.vue')
const ChargingView = () => import('@/views/charging/ChargingView.vue')
const SalaryView = () => import('@/views/salary/SalaryView.vue')
const ElecView = () => import('@/views/elec/ElecView.vue')

const navRoutes = fpBuildRoutes()

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/data-home' },
    { path: '/login', component: LoginView },
    { path: '/_gallery', component: Gallery },
    ...Object.values(navRoutes).map(meta => ({
      path: `/${meta.value}`,
      component: meta.value === 'buildings' ? BuildingsView : meta.value === 'tenants' ? TenantsView : meta.value === 'contracts' ? ContractsView : meta.value === 'ledger' ? LedgerView : meta.value === 'pv-income' ? PvView : (meta.value === 'car-charging' || meta.value === 'ebike-charging') ? ChargingView : meta.value === 'salary' ? SalaryView : meta.value === 'elec-cost' ? ElecView : PlaceholderView,
      meta,
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
