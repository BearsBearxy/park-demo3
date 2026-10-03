// 角色权限矩阵屏。钉四条会真出事的契约:
// ① 权限点跟后端走(按后端给的 group / kind 排成模块行,后端加一个点前端自动多一格 —— 不许硬编码);
// ② 无 system:edit 时矩阵照常显示当前配置,只是全部 disabled、没有保存/新建/删除;
// ③ 删除只对自定义角色出现,且 userCount>0 时禁用(预置角色一律无删除按钮);
// ④ RBAC v3 编辑包含查看:勾编辑自动带上同模块的查看,取消查看连带取消这个模块的编辑。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'
import { askQueue, answer } from '@/utils/ask'

const PERMS = {
  perms: [
    { key: 'master:view', label: '主数据 · 查看', hint: '楼栋、单元、租户', group: 'master', kind: 'view' },
    { key: 'master:edit', label: '主数据', hint: '楼栋、单元、租户的档案维护', group: 'master', kind: 'edit' },
    { key: 'company:manage', label: '公司/账册管理', hint: '新增与删除记账公司', group: 'master', kind: 'edit' },
    { key: 'entry:view', label: '台账与附表 · 查看', hint: '月度台账与附表', group: 'entry', kind: 'view' },
    { key: 'entry:edit', label: '事后录入', hint: '台账与附表', group: 'entry', kind: 'edit' },
    { key: 'salary:view', label: '工资 · 查看', hint: '附表 12 工资明细', group: 'salary', kind: 'view' },
    { key: 'system:view', label: '系统管理·查看', hint: '用户列表与角色配置', group: 'system', kind: 'view' },
    { key: 'system:edit', label: '系统管理·编辑', hint: '用户、角色、日志的管理', group: 'system', kind: 'edit' },
    { key: 'lock:takeover', label: '授权接管编辑锁', hint: '授权别人接管', group: 'other', kind: 'other' },
  ],
  navLayers: [
    { id: 'data', label: '数据中心' },
    { id: 'reports', label: '账簿与报表' },
    { id: 'analysis', label: '经营分析' },
  ],
}
const ROLES = [
  { id: 1, code: 'admin', name: '系统管理员', builtin: true, navLayers: ['data', 'reports', 'analysis'], perms: ['master:view', 'master:edit', 'company:manage', 'system:view', 'system:edit'], userCount: 2, remark: null },
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
type W = ReturnType<typeof mountWith>
const box = (w: W, key: string) => w.find(`input[data-perm="${key}"]`)
const on = (w: W, key: string) => (box(w, key).element as HTMLInputElement).checked
/** 矩阵里全部复选框:模块行 + 其他 + 导航可见层 */
const allBoxes = (w: W) => w.findAll('.sr-pane input[type="checkbox"]')

describe('SystemRolesView', () => {
  it('权限点跟后端返回走,按 group / kind 排成模块行,不硬编码', async () => {
    const w = mountWith(['system:view', 'system:edit'])
    await flushPromises()
    // 9 个权限点 + 3 个导航层 = 12 个复选框,一个不少
    expect(allBoxes(w).length).toBe(12)
    // 模块行按契约顺序,只出后端给了的模块;不属于模块的进「其他」
    expect(w.findAll('.sr-mx-r[data-module]').map(r => r.attributes('data-module'))).toEqual(['master', 'entry', 'salary', 'system'])
    expect(w.findAll('.sr-mx-r[data-module="master"] .sr-mx-edits input').length, '主数据的编辑格有两项').toBe(2)
    expect(w.find('.sr-mx-r[data-module="salary"] .sr-mx-edits').text(), '工资只有查看,编辑格是空的').toBe('—')
    expect(w.text()).toContain('其他')
    expect(box(w, 'lock:takeover').exists()).toBe(true)
    // 默认选中第一个角色,其已有权限勾上
    expect(on(w, 'master:edit')).toBe(true)
    expect(on(w, 'entry:edit')).toBe(false)
  })

  // ❗破坏验证:toggleEdit 里那句 push(view) 删掉 → 红
  it('❗勾编辑自动带上同模块的查看;取消编辑不动查看', async () => {
    const w = mountWith(['system:view', 'system:edit'])
    await flushPromises()
    vi.spyOn(useAuthStore(), 'endElevation').mockResolvedValue()
    expect([on(w, 'entry:view'), on(w, 'entry:edit')]).toEqual([false, false])
    await box(w, 'entry:edit').trigger('change')
    expect([on(w, 'entry:view'), on(w, 'entry:edit')], '编辑包含查看').toEqual([true, true])
    await box(w, 'entry:edit').trigger('change')
    expect([on(w, 'entry:view'), on(w, 'entry:edit')], '取消编辑,查看留着').toEqual([true, false])
    expect(on(w, 'master:view'), '别的模块不动').toBe(true)
  })

  // ❗破坏验证:toggleView 里 drop 只放 view 一项(不带 edits)→ 红
  it('❗取消查看连带取消这个模块的全部编辑,别的模块不动;再勾上查看不会把编辑勾回来', async () => {
    const w = mountWith(['system:view', 'system:edit'])
    await flushPromises()
    vi.spyOn(useAuthStore(), 'endElevation').mockResolvedValue()
    await box(w, 'master:view').trigger('change')
    expect([on(w, 'master:view'), on(w, 'master:edit'), on(w, 'company:manage')]).toEqual([false, false, false])
    expect([on(w, 'system:view'), on(w, 'system:edit')], '系统管理那一行不受影响').toEqual([true, true])
    await box(w, 'master:view').trigger('change')
    expect([on(w, 'master:view'), on(w, 'master:edit'), on(w, 'company:manage')]).toEqual([true, false, false])
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
    const boxes = allBoxes(w)
    expect(boxes.length).toBe(12)
    expect(boxes.every(b => (b.element as HTMLInputElement).disabled)).toBe(true)
    expect(on(w, 'master:edit')).toBe(true)                              // 配置照样看得见
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
    await box(w, 'lock:takeover').trigger('change')
    expect(auth.dirtyTotal).toBe(2)
    // 勾编辑连带勾上的查看也是一处改动:屏上确实多勾了一格
    await box(w, 'entry:edit').trigger('change')
    expect(auth.dirtyTotal).toBe(4)
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
