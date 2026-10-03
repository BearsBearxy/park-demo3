// 角色权限矩阵屏。钉三条会真出事的契约:
// ① 权限点行数跟后端走(后端加第 14 个,前端自动多一行 —— 不许硬编码 13);
// ② 读全开:无 system:edit 时矩阵照常显示当前配置,只是全部 disabled、没有保存/新建/删除;
// ③ 删除只对自定义角色出现,且 userCount>0 时禁用(预置角色一律无删除按钮)。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'
import { askQueue, answer } from '@/utils/ask'

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

const roles = vi.fn()
const removeRole = vi.fn()
const createRole = vi.fn()
vi.mock('@/api/system', () => ({
  systemApi: {
    perms: () => Promise.resolve(PERMS),
    roles: () => roles(),
    removeRole: (...a: unknown[]) => removeRole(...a),
    createRole: (...a: unknown[]) => createRole(...a),
  },
}))

import SystemRolesView from './SystemRolesView.vue'

function mountWith(perms: string[]) {
  setActivePinia(createPinia())
  useAuthStore().permissions = perms
  return mount(SystemRolesView)
}

beforeEach(() => {
  localStorage.clear()
  askQueue.splice(0)
  roles.mockReset()
  roles.mockImplementation(() => Promise.resolve(ROLES))
  removeRole.mockReset()
  createRole.mockReset()
})
type TipEl = HTMLElement & { _tip?: { text: string } }

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

  it('❗有没保存的改动 = 在编辑:登记进 auth.editors(页签条不换掉这一格、关浏览器先问);改回去 / 卸载就撤', async () => {
    const w = mountWith(['system:view', 'system:edit'])
    await flushPromises()
    const auth = useAuthStore()
    const end = vi.spyOn(auth, 'endElevation').mockResolvedValue()
    expect(auth.editing).toBe(false)
    await w.find('.sr-name').setValue('改个名')
    expect(auth.editing).toBe(true)
    await w.find('.sr-name').setValue('系统管理员')
    expect(auth.editing).toBe(false)
    expect(end, '撤登记顺带结束授权(最后一个编辑态时)').toHaveBeenCalled()
    await w.find('.sr-name').setValue('改个名')
    w.unmount()
    expect(auth.editing).toBe(false)
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
    expect((delBtn()!.element as TipEl)._tip?.text).toContain('3 个账号')
  })

  it('❗改动数接进 openEditor:改名 + 勾一个权限 = 2 处(关页签 / 关浏览器按它问)', async () => {
    const w = mountWith(['system:view', 'system:edit'])
    await flushPromises()
    const auth = useAuthStore()
    vi.spyOn(auth, 'endElevation').mockResolvedValue()
    await w.find('.sr-name').setValue('改个名')
    await w.findAll('.sr-row input[type="checkbox"]')[1].trigger('change')   // entry:edit 勾上
    expect(auth.dirtyTotal).toBe(2)
  })

  it('❗有改动时换角色走 askLeave:答「继续编辑」留在原角色、改动还在;答放弃才换', async () => {
    const w = mountWith(['system:view', 'system:edit'])
    await flushPromises()
    vi.spyOn(useAuthStore(), 'endElevation').mockResolvedValue()
    await w.find('.sr-name').setValue('改个名')
    await w.findAll('.sr-item')[1].trigger('click')
    await flushPromises()
    expect(askQueue[0]).toMatchObject({ title: '离开「系统管理员」？', body: '这页有 1 处改动还没保存。', cancel: '继续编辑' })
    answer(false)
    await flushPromises()
    expect((w.find('.sr-name').element as HTMLInputElement).value).toBe('改个名')
    await w.findAll('.sr-item')[1].trigger('click')
    await flushPromises()
    answer(true)
    await flushPromises()
    expect((w.find('.sr-name').element as HTMLInputElement).value).toBe('外部审计')
  })

  it('❗没改动时换角色不弹', async () => {
    const w = mountWith(['system:view', 'system:edit'])
    await flushPromises()
    await w.findAll('.sr-item')[1].trigger('click')
    await flushPromises()
    expect(askQueue).toHaveLength(0)
    expect((w.find('.sr-name').element as HTMLInputElement).value).toBe('外部审计')
  })

  it('❗删除角色走 ask(danger),答「删除角色」才发请求', async () => {
    const w = mountWith(['system:view', 'system:edit'])
    await flushPromises()
    await w.findAll('.sr-item')[1].trigger('click')                      // auditor:自定义 + 0 账号
    await w.findAll('button').find(b => b.text().includes('删除角色'))!.trigger('click')
    await flushPromises()
    expect(askQueue[0]).toMatchObject({ title: '删除角色「外部审计」？', action: '删除角色', danger: true })
    answer(true)
    await flushPromises()
    expect(removeRole).toHaveBeenCalledWith(7)
  })

  it('❗加载失败换掉整块(FPLoadError,和矩阵互斥);点重试重拉,成功后矩阵回来', async () => {
    roles.mockRejectedValueOnce({ message: '网关超时' })
    const w = mountWith(['system:view'])
    await flushPromises()
    const err = w.find('.fp-empty.error')
    expect(err.text()).toContain('角色权限没读到')
    expect(err.text()).toContain('网关超时')
    expect(w.find('.sr-split').exists()).toBe(false)
    await err.find('button').trigger('click')
    await flushPromises()
    expect(w.find('.fp-empty.error').exists()).toBe(false)
    expect(w.find('.sr-split').exists()).toBe(true)
  })

  // 字段报错(十件 ⑤;02-C 脚注「表单里的字段错误不走回执,贴在字段下面」;LAYOUT-STABILITY §4.2 框变红)
  // 破坏验证:save 里必填错改回写 msg(页面 toast)→ 字段下没字 → 红;.sr-name 的 :class 去掉 → 红
  it('❗新建角色缺名称 / 标识不合规:红字贴在各自字段下面、框变红,不走页面 toast、不发请求;改对了红字当场消', async () => {
    const w = mountWith(['system:view', 'system:edit'])
    await flushPromises()
    await w.find('.sr-item.add').trigger('click')
    await flushPromises()
    const errs = () => w.findAll('.sr-panehead .fp-field-err').map(e => e.text())
    expect(errs(), '前置:新建时名称、标识两处报错位常驻,没点保存前不报').toEqual(['', ''])
    await w.find('.sr-code').setValue('9 号角色')
    await w.findAll('.sr-act button').find(b => b.text() === '新建角色')!.trigger('click')
    await flushPromises()
    expect(errs()).toEqual(['角色名必填', '标识必填,且只能用英文字母开头 + 字母/数字/下划线/短横'])
    expect([w.find('.sr-name').classes('bad'), w.find('.sr-code').classes('bad')]).toEqual([true, true])
    expect(w.text().split('角色名必填').length - 1, '只出现在字段下面一处,没进页面 toast').toBe(1)
    expect(createRole).not.toHaveBeenCalled()
    await w.find('.sr-name').setValue('外包审计')
    await w.find('.sr-code').setValue('outsource_audit')
    expect(errs()).toEqual(['', ''])
    expect(w.find('.sr-name').classes('bad')).toBe(false)
  })

  // 两趟叠着发(写后重拉 + 手点重试)只认后发的那趟
  // 破坏验证:load 成功支的 `if (my !== seq) return` 删掉 → 旧名单盖屏 → 红;catch 支的删掉 → 冒失败件 → 红
  it('❗先发的晚到:旧名单不盖新名单,失败不冒失败件', async () => {
    let lateOk!: (v: typeof ROLES) => void, lateFail!: (e: Error) => void
    roles
      .mockImplementationOnce(() => new Promise((_, rej) => { lateFail = rej }))
      .mockImplementationOnce(() => new Promise((res) => { lateOk = res }))
    const w = mountWith(['system:view'])
    await flushPromises()
    const vm = w.vm as unknown as { load: () => Promise<void> }
    void vm.load()
    await vm.load()
    await flushPromises()
    const names = () => w.findAll('.sr-item-n').map(n => n.text())
    expect(names()).toEqual(['系统管理员', '外部审计', '兼职文员'])
    lateOk([{ ...ROLES[0], name: '旧名单里的角色' }])
    await flushPromises()
    expect(names(), '先发的旧名单盖了上来').toEqual(['系统管理员', '外部审计', '兼职文员'])
    lateFail(new Error('网关超时'))
    await flushPromises()
    expect(w.find('.fp-empty.error').exists(), '先发的失败冒了出来').toBe(false)
    expect(names()).toEqual(['系统管理员', '外部审计', '兼职文员'])
  })
})
