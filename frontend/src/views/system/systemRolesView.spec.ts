// 角色权限矩阵屏。钉三条会真出事的契约:
// ① 权限点行数跟后端走(后端加第 14 个,前端自动多一行 —— 不许硬编码 13);
// ② 读全开:无 system:edit 时矩阵照常显示当前配置,只是全部 disabled、没有保存/新建/删除;
// ③ 删除只对自定义角色出现,且 userCount>0 时禁用(预置角色一律无删除按钮)。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'

const PERMS = {
  perms: [
    { key: 'master:edit', label: '主数据', hint: '楼栋、单元、租户' },
    { key: 'entry:edit', label: '月度录入', hint: '台账与附表' },
    { key: 'system:view', label: '系统管理·查看', hint: '用户列表与角色配置' },
    { key: 'system:edit', label: '系统管理·编辑', hint: '用户、角色、日志的管理' },
    { key: 'lock:takeover', label: '授权接管编辑锁', hint: '授权别人接管' },
  ],
  navLayers: [
    { id: 'data', label: '数据中心' },
    { id: 'reports', label: '账簿与报表' },
    { id: 'analysis', label: '经营分析' },
  ],
}
const ROLES = [
  { id: 1, code: 'admin', name: '系统管理员', builtin: true, navLayers: ['data', 'reports', 'analysis'], perms: ['master:edit', 'system:view', 'system:edit'], userCount: 2, remark: null },
  { id: 7, code: 'auditor', name: '外部审计', builtin: false, navLayers: ['reports'], perms: ['entry:edit'], userCount: 0, remark: null },
  { id: 8, code: 'clerk2', name: '兼职文员', builtin: false, navLayers: ['data'], perms: [], userCount: 3, remark: null },
]

vi.mock('@/api/system', () => ({
  systemApi: {
    perms: () => Promise.resolve(PERMS),
    roles: () => Promise.resolve(ROLES),
  },
}))

import SystemRolesView from './SystemRolesView.vue'

function mountWith(perms: string[]) {
  setActivePinia(createPinia())
  useAuthStore().permissions = perms
  return mount(SystemRolesView)
}

beforeEach(() => { localStorage.clear() })

describe('SystemRolesView', () => {
  it('权限点行数跟后端返回走,不硬编码', async () => {
    const w = mountWith(['system:view', 'system:edit'])
    await flushPromises()
    // 5 个权限点 + 3 个导航层 = 8 个复选框
    expect(w.findAll('.sr-row input[type="checkbox"]').length).toBe(8)
    // 分组标题三段齐全(system:* 与 lock:* 各自成组)
    expect(w.text()).toContain('业务写权限')
    expect(w.text()).toContain('系统管理')
    expect(w.text()).toContain('编辑锁')
    // 默认选中第一个角色,其已有权限勾上
    const boxes = w.findAll('.sr-row input[type="checkbox"]')
    expect((boxes[0].element as HTMLInputElement).checked).toBe(true)   // master:edit
    expect((boxes[1].element as HTMLInputElement).checked).toBe(false)  // entry:edit
  })

  it('无 system:edit:矩阵照显当前配置,但全部禁用且无写入口', async () => {
    const w = mountWith(['system:view'])
    await flushPromises()
    const boxes = w.findAll('.sr-row input[type="checkbox"]')
    expect(boxes.length).toBe(8)
    expect(boxes.every(b => (b.element as HTMLInputElement).disabled)).toBe(true)
    expect((boxes[0].element as HTMLInputElement).checked).toBe(true)   // 读全开:配置照样看得见
    expect(w.find('.sr-act').exists()).toBe(false)                      // 没有保存/取消
    expect(w.find('.sr-item.add').exists()).toBe(false)                 // 没有新建角色
    expect(w.text()).toContain('只读')
  })

  it('删除按钮:预置角色没有;自定义角色有,userCount>0 时禁用', async () => {
    const w = mountWith(['system:view', 'system:edit'])
    await flushPromises()
    const delBtn = () => w.findAll('button').find(b => b.text().includes('删除角色'))
    expect(delBtn()).toBeUndefined()                                     // 预置(admin)

    const items = w.findAll('.sr-item')
    await items[1].trigger('click')                                      // auditor:自定义 + 0 账号
    expect(delBtn()?.attributes('disabled')).toBeUndefined()

    await items[2].trigger('click')                                      // clerk2:自定义 + 3 账号
    expect(delBtn()?.attributes('disabled')).toBeDefined()
    expect(delBtn()?.attributes('title')).toContain('3 个账号')
  })
})
