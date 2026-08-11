// src/router/routeMap.spec.ts — 路由表护栏:导航里的屏必须都配到组件,别静默降级成占位页
import { describe, it, expect } from 'vitest'
import { fpBuildRoutes } from '@/nav/fpNav'
import router from '@/router'

const values = Object.keys(fpBuildRoutes())
const compOf = (v: string) => router.getRoutes().find((r) => r.path === `/${v}`)?.components?.default

describe('router 路由表', () => {
  it('导航每一屏都有路由且挂到了组件', () => {
    for (const v of values) expect(compOf(v), v).toBeTypeOf('function')
  })
  it('只有 bank-flow 落到 PlaceholderView(已知死链,后端也没这块)', () => {
    const placeholder = compOf('bank-flow')
    expect(values.filter((v) => compOf(v) === placeholder)).toEqual(['bank-flow'])
  })
})
