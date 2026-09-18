// 页签模型的接线(TAB-BAR-SPEC §2):外壳内容区登记「页面里的点击」;路由按「落定才动页签条」接 store。
// 行为本身在 stores/__tests__/tabs.spec.ts 里测;这里只钉住线没被拆掉。「❗」开头的做过破坏验证。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const src = (rel: string) => readFileSync(join(__dirname, '..', '..', '..', rel), 'utf8')

describe('页签模型接线', () => {
  it('❗内容区上 capture 登记页面里的点击', () => {
    expect(src('components/shell/AppShell.vue')).toContain('<main class="fp-content" @click.capture="tabs.markInPage()">')
  })

  it('❗路由:beforeEach 补默认(带后退标记),afterEach 落定才 commit,失败与出错丢掉登记', () => {
    const r = src('router/index.ts')
    expect(r).toContain("window.addEventListener('popstate', () => { popNav = true })")
    // 后退标记必须在 createRouter 之前注册:popstate 每个监听跑完就清一次微任务,晚了 beforeEach 已经跑完
    expect(r.indexOf("addEventListener('popstate'")).toBeLessThan(r.indexOf('createRouter({'))
    expect(r).toContain('useTabsStore().beforeNav(tv, popNav)')
    expect(r).toMatch(/if \(v && !failure\) \{[\s\S]*tabs\.commit\(v\)\s*\n\s*tabs\.setActive\(v\)/)
    expect(r).toMatch(/\} else if \(failure\) \{\s*\n\s*useTabsStore\(\)\.clearIntent\(\)/)
    expect(r).toMatch(/router\.onError\([\s\S]*useTabsStore\(\)\.clearIntent\(\)/)
  })

  it('❗App.vue 的 KeepAlive 按纪元卸载过期实例', () => {
    const a = src('App.vue')
    expect(a).toContain(':exclude="staleShells"')
    expect(a).toContain("shellOf(routeValue + ':' + tabs.epochOf(routeValue), Component)")
  })

  // 页签条判「这一屏我是不是正在编辑」查 auth.editingOn(屏名):登记时漏带屏名,那一处就又认不出来了
  it.each([
    'composables/useEditMode.ts',
    'components/sched/SchedHeader.vue',
    'views/bills/CoefBookWindow.vue',
    'views/bills/PayBookWindow.vue',
    'views/system/SystemRolesView.vue',
    'views/contracts/ContractNewDialog.vue',
    'views/bills/CompanyBookWindow.vue',
  ])('❗编辑态登记带上屏名:%s', (f) => {
    const s = src(f)
    expect(s).toContain('const screen = useScreen()')
    expect(s).toContain('auth.openEditor(meId, screen)')
    expect(s).not.toMatch(/openEditor\(meId\)/)
  })
})
