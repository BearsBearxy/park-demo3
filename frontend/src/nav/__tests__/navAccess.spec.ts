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

  it('落地页:无 data 层落驾驶舱,其余落数据中心首页', () => {
    expect(landingPath(['reports', 'analysis'])).toBe('/cockpit')
    expect(landingPath(['data', 'reports', 'analysis'])).toBe('/data-home')
    // 客户自建的「纯管理员」(不勾任何业务层、只给系统管理)不能落到一个侧边栏没入口的屏上
    expect(landingPath([], true)).toBe('/sys-users')
    expect(landingPath([], false)).toBe('/cockpit')   // 连 system 都没有 → 兜底,不能返回空
  })
})
