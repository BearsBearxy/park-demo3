// src/router/routeMap.spec.ts — 路由表护栏:导航里的屏必须都配到组件,别静默降级成占位页
import { describe, it, expect } from 'vitest'
import { fpBuildRoutes } from '@/nav/fpNav'
import router from '@/router'

const values = Object.keys(fpBuildRoutes())
const compOf = (v: string) => router.getRoutes().find((r) => r.path === `/${v}`)?.components?.default
// 占位页 loader 是 router 的私有常量,认它只能看函数源码文本。下面先拿一个真占位 loader 做阳性对照 ——
// 构建工具哪天改写了 import 文本,阳性对照先红,这条护栏不会静默失效。
const isPlaceholder = (c: unknown) => String(c).includes('PlaceholderView')

describe('router 路由表', () => {
  it('导航每一屏都有路由且挂到了组件', () => {
    for (const v of values) expect(compOf(v), v).toBeTypeOf('function')
  })
  it('没有任何屏落到 PlaceholderView(2026-09-03 银行流水删除后,占位页只剩漏配兜底)', () => {
    expect(isPlaceholder(() => import('@/views/PlaceholderView.vue'))).toBe(true)   // 阳性对照
    expect(values.filter((v) => isPlaceholder(compOf(v)))).toEqual([])
  })
  it('/bank-flow 旧地址重定向到首页(SIDEBAR-UX-REDESIGN D4)', () => {
    expect(values).not.toContain('bank-flow')
    expect(router.getRoutes().find((r) => r.path === '/bank-flow')?.redirect).toBe('/data-home')
  })
})
