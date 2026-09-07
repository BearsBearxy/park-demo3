import { describe, it, expect } from 'vitest'
import { isLayerVisible, visibleLayers, landingPath } from '../navAccess'
import { buildAllPages } from '@/components/shell/paletteFilter'

describe('导航层可见性', () => {
  it('只给 analysis 的角色(园区股东)只剩经营分析层,命令面板同步只剩该层的屏', () => {
    expect(visibleLayers(['analysis']).map(L => L.id)).toEqual(['analysis'])
    const layers = new Set(buildAllPages(['analysis']).map(p => p.layer))
    expect([...layers]).toEqual(['analysis'])
  })

  it("'system' 层不看 navLayers,按 system:view 判", () => {
    expect(isLayerVisible('system', ['data', 'reports', 'analysis'])).toBe(false)
    expect(isLayerVisible('system', [], true)).toBe(true)
  })

  it('无 system:view:图标栏没有系统层,命令面板搜不到那两屏', () => {
    const all = ['data', 'reports', 'analysis']
    expect(visibleLayers(all).map(L => L.id)).not.toContain('system')
    expect(buildAllPages(all).map(p => p.value)).not.toContain('sys-users')
    // 有权限时两屏都在
    expect(visibleLayers(all, true).map(L => L.id)).toContain('system')
    expect(buildAllPages(all, true).map(p => p.value)).toEqual(expect.arrayContaining(['sys-users', 'sys-roles']))
  })

  it('落地页底三档:无 data 层落驾驶舱,其余落数据中心首页', () => {
    expect(landingPath(['reports', 'analysis'])).toBe('/cockpit')
    expect(landingPath(['data', 'reports', 'analysis'])).toBe('/data-home')
    // 客户自建的「纯管理员」(不勾任何业务层、只给系统管理)不能落到一个侧边栏没入口的屏上
    expect(landingPath([], true)).toBe('/sys-users')
    expect(landingPath([], false)).toBe('/cockpit')   // 连 system 都没有 → 兜底,不能返回空
  })

  const ALL = ['data', 'reports', 'analysis']

  // 破坏验证:把 readonly 那一档删掉 → 红。这一条就是 P5 的独立价值「总经理直落驾驶舱」。
  it('❗零 :edit 的人(总经理 / 只读账号)落驾驶舱,不落一屏按不动的录入清单', () => {
    expect(landingPath(ALL, false, { readonly: true })).toBe('/cockpit')
    // 同一个人,有写权限就还是本月出账 —— 差别只在 readonly 这一个位
    expect(landingPath(ALL, false, { readonly: false })).toBe('/data-home')
  })

  // ❗次序钉:审核员本身零 :edit(D16 录审分离),readonly 那一档排在前面会把他也送去驾驶舱,
  //   而他每天来就是为了本月出账屏上的审核队列。破坏验证:把两个 if 调换 → 红。
  it('❗审核员落本月出账 —— 他也是零 :edit,两档次序不能反', () => {
    expect(landingPath(ALL, false, { readonly: true, reviewer: true })).toBe('/data-home')
  })

  it('看不见的层不当落点:审核员没有 data 层就退回底三档,股东没有 analysis 层同理', () => {
    expect(landingPath(['reports'], false, { readonly: true, reviewer: true })).toBe('/cockpit')
    // 纯管理员(零业务层)是只读的话也不能被 readonly 那一档抢走 —— 他没有 analysis 层
    expect(landingPath([], true, { readonly: true })).toBe('/sys-users')
  })
})
