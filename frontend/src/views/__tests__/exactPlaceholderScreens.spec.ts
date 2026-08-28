import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import type { Component } from 'vue'

import TenantsView from '@/views/tenants/TenantsView.vue'
import BuildingsView from '@/views/buildings/BuildingsView.vue'
import ContractsView from '@/views/contracts/ContractsView.vue'
import SystemUsersView from '@/views/system/SystemUsersView.vue'

import { tenantApi } from '@/api/tenant'
import { buildingApi } from '@/api/building'
import { contractApi } from '@/api/contract'
import { systemApi } from '@/api/system'

/**
 * 「精确占位」的结构证明 —— 四屏一份（加载态设计稿 §07）。
 *
 * jsdom 没有布局，量不了像素。所以这里不测「位移是 0」，测的是**保证位移为 0 的那个不变量**：
 * 外壳（KPI 轨 / 工具条 / 定高卡片 / 列表容器）在数据到达前后是**同一批 DOM 节点**，
 * 从没被卸载重建过。只要这条成立，几何就不可能变。
 *
 * 反过来，谁把整屏重新裹回 `<template v-if="summary">`，这里当场红 ——
 * 那正是原来跳 183px 的写法（像素层面在浏览器里量过：134px → 317px vs 317px → 317px）。
 *
 * ⚠ 做成表驱动是有理由的：这四屏改法一模一样，各写一份必然长歪。
 *   以后再有屏接进来，加一行就够。
 */

vi.mock('@/api/tenant', () => ({
  tenantApi: {
    list: vi.fn(), summary: vi.fn(),
    categories: vi.fn(() => Promise.resolve([])),
    detail: vi.fn(() => Promise.resolve(null)),
  },
}))
vi.mock('@/api/building', () => ({
  buildingApi: { list: vi.fn(), summary: vi.fn(), detail: vi.fn(() => Promise.resolve(null)) },
}))
vi.mock('@/api/contract', () => ({
  contractApi: { list: vi.fn(), summary: vi.fn(), detail: vi.fn(() => Promise.resolve(null)) },
}))
vi.mock('@/api/system', () => ({
  systemApi: { users: vi.fn(), roles: vi.fn(), auditPage: vi.fn(() => Promise.resolve({ rows: [], total: 0 })) },
}))
vi.mock('@/api/ana', () => ({ invalidateAnaCache: vi.fn() }))

/** 让两个首载接口都停在「在途」，好在数据到达前观察 DOM。 */
function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}

interface Screen {
  name: string
  comp: Component
  /** 首载那两个接口（顺序无关，都会被 Promise.all 等到） */
  wire: (a: Promise<unknown>, b: Promise<unknown>) => void
  /** a 通道给的数据（列表），b 通道给的数据（概览） */
  rows: unknown
  summary: unknown
  /** 外壳选择器：这些节点在加载前后必须是同一个 */
  shell: string[]
  /** 真空态文案 —— 加载期不许出现 */
  emptyText: string
}

const SCREENS: Screen[] = [
  {
    name: '租户管理',
    comp: TenantsView,
    wire: (a, b) => {
      vi.mocked(tenantApi.list).mockReturnValue(a as never)
      vi.mocked(tenantApi.summary).mockReturnValue(b as never)
    },
    rows: [{
      id: 1, companyName: '创显科技', contactName: null, contactPhone: null, businessType: '电子',
      status: 1, categoryId: null, phase: 2, since: null, monthlyRent: 12000, leasedArea: 300,
      primaryBuilding: 'A 座', contractCount: 1, parentId: null, parentName: null,
    }],
    summary: { tenantActive: 128, occRate: 0.87, monthlyRent: 1234567, expiringTenants: 11 },
    shell: ['.mx-kpirail', '.mx-listcard', '.mx-tablewrap'],
    emptyText: '没有匹配的租户',
  },
  {
    name: '楼栋管理',
    comp: BuildingsView,
    wire: (a, b) => {
      vi.mocked(buildingApi.list).mockReturnValue(a as never)
      vi.mocked(buildingApi.summary).mockReturnValue(b as never)
    },
    rows: [],
    summary: { buildingCount: 9, rentableArea: 88000, occRate: 0.9, vacantCount: 4 },
    // ⚠ 默认视图是**卡片墙**（localStorage 没存过就是它），此时没有 .mx-listcard；
    //    表格视图那条路由 :skeleton-rows 覆盖，卡片墙这条由 BuildingCard 的 loading 覆盖。
    shell: ['.mx-kpirail', '.mx-toolbar'],
    emptyText: '没有匹配的楼栋',
  },
  {
    name: '合同管理',
    comp: ContractsView,
    wire: (a, b) => {
      vi.mocked(contractApi.list).mockReturnValue(a as never)
      vi.mocked(contractApi.summary).mockReturnValue(b as never)
    },
    rows: [],
    // 合同屏的 KPI 顶条已按用户要求撤掉，概览只喂计数
    summary: { total: 12, active: 9, expiring: 2, terminated: 1 },
    shell: ['.mx-toolbar', '.cl-scroll'],
    emptyText: '没有匹配的合同',
  },
  {
    name: '系统用户',
    comp: SystemUsersView,
    wire: (a, b) => {
      vi.mocked(systemApi.users).mockReturnValue(a as never)
      vi.mocked(systemApi.roles).mockReturnValue(b as never)
    },
    rows: [],
    summary: [],
    shell: ['.mx-kpirail', '.mx-listcard', '.mx-tablewrap'],
    emptyText: '没有匹配的账号',
  },
]

const opts = { global: { stubs: { Teleport: true, RouterLink: true, 'router-link': true } } }

describe.each(SCREENS)('$name · 精确占位', (sc) => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    sessionStorage.clear()
    vi.clearAllMocks()
  })

  it('外壳在数据到达前就在，到达后还是同一批节点', async () => {
    const a = deferred<unknown>()
    const b = deferred<unknown>()
    sc.wire(a.promise, b.promise)

    const w = mount(sc.comp, opts)
    await flushPromises()

    // ── 加载中 ──
    const before = sc.shell.map((s) => {
      const el = w.find(s)
      expect(el.exists(), `${s} 在加载期就必须存在 —— 它是零位移的锚点`).toBe(true)
      return el.element
    })
    expect(w.find('.page-loading').exists(), '不许再有整屏居中转圈').toBe(false)
    expect(w.findAll('.fp-shim').length, '叶子上要有骨架').toBeGreaterThan(0)

    // ── 数据到达 ──
    a.resolve(sc.rows)
    b.resolve(sc.summary)
    await flushPromises()

    sc.shell.forEach((s, i) => {
      expect(w.find(s).element,
             `${s} 被重建了 —— 外壳一旦卸载重挂，零位移就断了`).toBe(before[i])
    })
    expect(w.findAll('.fp-shim').length, '数据到了就不该再有骨架').toBe(0)
  })

  it('加载期不许闪空态 —— 那是「假空」', async () => {
    // 数据没到时列表也是空的。不挡住的话，用户会先看到一句「没有匹配的 X」
    // 再被真数据替换掉。base.css 里 .page-loading 的注释当初就是为这件事写的。
    const a = deferred<unknown>()
    const b = deferred<unknown>()
    sc.wire(a.promise, b.promise)

    const w = mount(sc.comp, opts)
    await flushPromises()
    expect(w.text()).not.toContain(sc.emptyText)

    a.resolve([])
    b.resolve(sc.summary)
    await flushPromises()
    expect(w.text(), '真的空了才该说空').toContain(sc.emptyText)
  })
})
