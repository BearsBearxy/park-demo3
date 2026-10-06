// 分析屏跳到模块屏的深链:没有目标屏的查看权时置灰、写明缺哪一项(RBAC v3,用户 2026-10-04 拍板第 8 条)。
// 「❗」开头的做过破坏验证。
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { useAuthStore } from '@/stores/auth'
import { receipts } from '@/utils/receipt'
import { ALL_VIEWS } from '@/test-utils/perms'
import { useViewGate } from '@/composables/useViewGate'
import AnaEmpty from '../AnaEmpty.vue'

// 人话名来自后端 Perm.META(/auth/perms),这里只给用到的一个
vi.mock('@/api/perms', () => ({
  loadPermDict: () => Promise.resolve(),
  permLabel: (k: string) => ({ 'entry:view': '台账与附表 · 查看' } as Record<string, string>)[k] ?? k,
}))

const card = () => mount(AnaEmpty, {
  props: { label: '台账数据未录入', hint: '收缴率 = 台账 Σ实收 / Σ应收', to: '/ledger', toText: '去台账录入' },
  global: { stubs: { RouterLink: { template: '<a class="go"><slot /></a>' } } },
})
const NO_ENTRY = ALL_VIEWS.filter((p) => p !== 'entry:view')

beforeEach(() => {
  setActivePinia(createPinia())
  receipts.splice(0)
})

describe('AnaEmpty 的「去录入」按查看权', () => {
  // 破坏验证:AnaEmpty 里 v-else-if="why" 那一段删掉 → 红(没有权限就整个不见了,人不知道本来有路)
  it('❗没有目标屏的查看权:按钮置灰、不是链接,下面一行写明缺哪一项、去找系统管理员', () => {
    useAuthStore().permissions = NO_ENTRY
    const w = card()
    expect(w.find('a').exists()).toBe(false)
    const off = w.find('.go.off')
    expect(off.text()).toBe('去台账录入 →')
    expect(off.attributes('aria-disabled')).toBe('true')
    expect(w.find('.why').text()).toBe('需要「台账与附表 · 查看」权限，请找系统管理员开通')
    expect(w.text(), '缺什么数照说').toContain('台账数据未录入')
  })

  it('有查看权:正常链接,不出原因', () => {
    useAuthStore().permissions = [...ALL_VIEWS]
    const w = card()
    expect(w.find('a.go').text()).toBe('去台账录入 →')
    expect(w.find('.why').exists()).toBe(false)
  })

  it('有查看权但那一层不在导航里:照旧不画(人落过去回不来),也不出原因', () => {
    const auth = useAuthStore()
    auth.permissions = [...ALL_VIEWS]
    auth.navLayers = ['analysis']
    const w = card()
    expect(w.find('.go').exists()).toBe(false)
    expect(w.find('.why').exists()).toBe(false)
  })
})

describe('useViewGate', () => {
  // 破坏验证:blocked 里不发回执(只 return)→ 红;lack 恒返回 '' → 红
  it('❗图上的点 / 整行点击:缺权限说一句原因并拦下;看得了的放行、不出声', () => {
    useAuthStore().permissions = ['analysis:view']
    const { lack, blocked } = useViewGate()
    expect(lack('/ledger?p=2025-06')).toBe('需要「台账与附表 · 查看」权限')
    expect(blocked('/ledger')).toBe(true)
    expect(receipts.map((r) => r.text)).toEqual(['需要「台账与附表 · 查看」权限，请找系统管理员开通'])
    expect(lack('/churn')).toBe('')
    expect(blocked('/churn')).toBe(false)
    expect(receipts).toHaveLength(1)
  })
})

// 契约 deepLinks 里函数式深链的落点逐处钉住:按钮走 :disabled + v-tip 的 lack,图上的点 / 整行点击走 blocked。
// AnaEmpty 的 to= 由上面那一组统一管,不在这张表里。
describe('分析屏深链接线', () => {
  const A = join(__dirname, '../../../views/analysis')
  it.each([
    ['AnomalyView.vue', "lack('/ledger')"], ['AnomalyView.vue', "lack('/sales-income')"],
    // 2026-10-06 改稿:规则行挂在选中户卡里(r.a),底部加光伏规则卡(落光伏分栋分析)
    ['AnomalyView.vue', ':disabled="!!lack(r.a.link)"'], ['AnomalyView.vue', ":disabled=\"!!lack('/pv-meter-analysis')\""],
    ['CockpitView.vue', "if (blocked('/sales-income')) return"], ['CockpitView.vue', ':disabled="!!lack(r.a.link)"'],
    ['CockpitView.vue', ":disabled=\"!!lack('/ledger')\""],
    ['ChurnView.vue', "if (blocked('/ledger')) return"], ['ChurnView.vue', ":disabled=\"!!lack('/ledger')\""],
    // 2026-10-06 改稿:查台账 / 查附表10 两张单户图挪到异常提醒中心,这屏只剩「去异常提醒中心」「去现金流量」两个入口
    ['TenantEnergyView.vue', "!!lack('/anomaly')"], ['TenantEnergyView.vue', "!!lack('/fin-cashflow')"],
    ['FinCashflowView.vue', ":disabled=\"!!lack('/ledger')\""],
    ['ExpiryView.vue', "if (blocked('/contracts')) return"],
    ['BudgetView.vue', "if (blocked('/' + nav)) return"],
    ['PnlAnalysisView.vue', "if (blocked('/' + nav)) return"], ['PnlAnalysisView.vue', ":disabled=\"!!lack('/' + c.nav)\""],
    ['ElecAnalysisView.vue', "if (blocked('/elec-cost')) return"], ['ElecAnalysisView.vue', ":disabled=\"!!lack('/elec-cost')\""],
    ['ChargingAnalysisView.vue', 'if (blocked(detailTo.value)) return'], ['ChargingAnalysisView.vue', ':disabled="!!lack(detailTo)"'],
    ['PvMeterAnaView.vue', "if (blocked('/pv-income?mode=meter')) return"], ['PvMeterAnaView.vue', ":disabled=\"!!lack('/params')\""],
    ['ParkView.vue', "v-tip=\"lack('/buildings')\""],
  ])('%s:%s', (f, s) => {
    expect(readFileSync(join(A, f), 'utf8')).toContain(s)
  })
})
