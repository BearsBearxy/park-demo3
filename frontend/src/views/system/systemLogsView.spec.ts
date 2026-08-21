// 操作日志屏。钉三条会真出事的契约:
// ① 三路来源(计费参数/导入/账号与角色)必须各自渲染出可区分的徽标 —— 归一只发生在展示层,
//    三路语义完全不同,糊成一个样子这屏就白做了;
// ② authorizer 有值时「由 XXX 授权」必须出现在那一行里 —— 代他人执行的动作要记两个人,
//    只显示操作人的话「谁批准的」就白记了;
// ③ 改筛选 / 翻页都要**重新发请求并带上参数** —— 这屏是服务端分页,不是前端切片。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import Select from '@/components/ds/Select.vue'
import FPPager from '@/components/fp/FPPager.vue'

const ROWS = [
  { source: 'param', ts: '2026-08-20T10:12:00', actor: 'zhang.kj', action: 'set',
    target: 'p1 · price_flat · 2025-06', detail: '0.83 → 0.91  按物业通知调价', authorizer: null },
  { source: 'import', ts: '2026-08-19T16:40:00', actor: 'li.cw', action: 'complete',
    target: '附表10 销售收入 · 2025-06 · 一泽', detail: 'xxx.xlsx  120/125 行 · 5 警告', authorizer: null },
  // 代他人执行:接管别人手上的编辑锁,主管授权
  { source: 'auth', ts: '2026-08-18T09:05:00', actor: 'wang.zg', action: 'lock.takeover',
    target: 'user:zhangsan', detail: '接管计费参数编辑锁', authorizer: '李主管' },
]

const logs = vi.fn()
vi.mock('@/api/system', () => ({ systemApi: { logs: (...a: unknown[]) => logs(...a) } }))

import SystemLogsView from './SystemLogsView.vue'

const page = (over: Record<string, unknown> = {}) =>
  Promise.resolve({ rows: ROWS, total: 3, page: 1, size: 10, actors: ['li.cw', 'wang.zg', 'zhang.kj'], ...over })

function mountView() {
  setActivePinia(createPinia())
  return mount(SystemLogsView)
}

beforeEach(() => {
  logs.mockReset()
  logs.mockImplementation(() => page())
})

describe('SystemLogsView', () => {
  it('三路来源各自渲染出可区分的徽标', async () => {
    const w = mountView()
    await flushPromises()

    // 每路一行,来源标在行上(不是三行长一个样)
    expect(w.findAll('[data-src="param"]')).toHaveLength(1)
    expect(w.findAll('[data-src="import"]')).toHaveLength(1)
    expect(w.findAll('[data-src="auth"]')).toHaveLength(1)

    // 徽标文案是人话,不是 param/import/auth 三个英文码
    const paramRow = w.get('[data-src="param"]')
    const importRow = w.get('[data-src="import"]')
    const authRow = w.get('[data-src="auth"]')
    expect(paramRow.text()).toContain('计费参数')
    expect(importRow.text()).toContain('导入')
    expect(authRow.text()).toContain('账号与角色')

    // 三种语义色确实不同(时间线左侧圆点):同色就等于没区分
    const colors = [paramRow, importRow, authRow].map(r => r.get('.lg-dot').attributes('style'))
    expect(new Set(colors).size).toBe(3)

    // 一行读起来像一句话:谁 · 什么时候 · 对什么 · 做了什么(动作码翻成人话)
    expect(paramRow.text()).toContain('zhang.kj')
    expect(paramRow.text()).toContain('2026-08-20 10:12')
    expect(paramRow.text()).toContain('设置')
    expect(paramRow.text()).toContain('p1 · price_flat · 2025-06')
    expect(paramRow.text()).toContain('0.83 → 0.91')
  })

  it('authorizer 有值时「由 XXX 授权」必须出现在那一行里', async () => {
    const w = mountView()
    await flushPromises()

    // 就在接管编辑锁那一行上,不是页脚某处的泛泛说明
    const authRow = w.get('[data-src="auth"]')
    expect(authRow.text()).toContain('由 李主管 授权')
    expect(authRow.text()).toContain('wang.zg')       // 操作人与授权人两个都在
    expect(authRow.text()).toContain('接管编辑锁')

    // 没有授权人的行不许凭空长出「授权」字样
    expect(w.get('[data-src="param"]').text()).not.toContain('授权')
  })

  it('服务端分页:改筛选与翻页都重新发请求并带上参数', async () => {
    const w = mountView()
    await flushPromises()
    expect(logs).toHaveBeenCalledTimes(1)
    expect(logs.mock.calls[0][0]).toMatchObject({ page: 1 })

    // 改「来源」筛选 → 回第一页 + 重新请求(前端切片的话这里不会有第二次调用)
    await w.findAllComponents(Select)[0].setValue('auth')
    await flushPromises()
    expect(logs).toHaveBeenCalledTimes(2)
    expect(logs.mock.calls[1][0]).toMatchObject({ src: 'auth', page: 1 })

    // 翻页 → 再请求一次,且把筛选条件一起带上(否则第 2 页会退回全部来源)
    w.findComponent(FPPager).vm.$emit('page', 2)
    await flushPromises()
    expect(logs).toHaveBeenCalledTimes(3)
    expect(logs.mock.calls[2][0]).toMatchObject({ src: 'auth', page: 2 })
  })
})
