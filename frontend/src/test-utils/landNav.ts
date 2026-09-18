// 测试用:模拟 router 的 beforeEach(beforeNav 补默认)+ afterEach(导航落定,commit 兑现登记)。
// 页签条只在导航落定后才动;组件测试里 router 是桩,push 不会走到 afterEach,用它顶上。
import { useTabsStore } from '@/stores/tabs'

export function landNav(to: unknown): Promise<void> {
  const path = typeof to === 'string' ? to : (to as { path: string }).path
  const v = path.split(/[?#]/)[0].slice(1)
  const t = useTabsStore()
  t.beforeNav(v)
  t.commit(v)
  t.setActive(v)
  return Promise.resolve()
}
