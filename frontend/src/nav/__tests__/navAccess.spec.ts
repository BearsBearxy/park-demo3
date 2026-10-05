import { describe, it, expect } from 'vitest'
import {
  isLayerVisible, visibleLayers, visibleSections, layerEntry, landingPath, canReach,
  viewPermsOf, canViewPage, viewLack, type Can,
} from '../navAccess'
import { buildAllPages } from '@/components/shell/paletteFilter'
import { FP_NAV, fpAllPages } from '../fpNav'

/** 给一组权限点,造一个 auth.can。 */
const has = (...ps: string[]): Can => (p) => ps.includes(p)
const BIZ_VIEWS = ['master:view', 'contract:view', 'param:view', 'meter:view', 'billing:view', 'entry:view', 'salary:view', 'report:view', 'analysis:view']
const ALL_BIZ = has(...BIZ_VIEWS)
const WITH_SYS = has(...BIZ_VIEWS, 'system:view')
const ALL = ['data', 'reports', 'analysis']
const DATA = FP_NAV.find(L => L.id === 'data')!

describe('导航层可见性', () => {
  it('只给 analysis 的角色只剩经营分析层,命令面板同步只剩该层的屏', () => {
    expect(visibleLayers(['analysis'], ALL_BIZ).map(L => L.id)).toEqual(['analysis'])
    const layers = new Set(buildAllPages(['analysis'], ALL_BIZ).map(p => p.layer))
    expect([...layers]).toEqual(['analysis'])
  })

  it("'system' 层不看 navLayers,按 system:view 判", () => {
    expect(isLayerVisible('system', ALL, ALL_BIZ)).toBe(false)
    expect(isLayerVisible('system', [], has('system:view'))).toBe(true)
  })

  it('无 system:view:图标栏没有系统层,命令面板搜不到那两屏', () => {
    expect(visibleLayers(ALL, ALL_BIZ).map(L => L.id)).not.toContain('system')
    expect(buildAllPages(ALL, ALL_BIZ).map(p => p.value)).not.toContain('sys-users')
    // 有权限时两屏都在
    expect(visibleLayers(ALL, WITH_SYS).map(L => L.id)).toContain('system')
    expect(buildAllPages(ALL, WITH_SYS).map(p => p.value)).toEqual(expect.arrayContaining(['sys-users', 'sys-roles']))
  })

  it('落地页底三档:无 data 层落驾驶舱,其余落数据中心首页', () => {
    expect(landingPath(['reports', 'analysis'])).toBe('/cockpit')
    expect(landingPath(['data', 'reports', 'analysis'])).toBe('/data-home')
    // 客户自建的「纯管理员」(不勾任何业务层、只给系统管理)不能落到一个侧边栏没入口的屏上
    expect(landingPath([], true)).toBe('/sys-users')
    expect(landingPath([], false)).toBe('/cockpit')   // 连 system 都没有 → 兜底,不能返回空
  })

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


// ══════════ RBAC v3:读写分开(用户 2026-10-04 拍板) ══════════
// 每一屏都有查看权限;没有就不在导航、搜索里出现,打开落「无权查看」页。
describe('每一屏的查看权限(viewPermsOf)', () => {
  // ❗漏配一屏 = 那一屏谁都能进(viewPermsOf 返回 null 是「不设门」)。新加的屏必须在这里有一项。
  //   破坏验证:从 DATA_VIEW 删掉 meters 那一项 → 红并点名 meters。
  it('❗导航里的每一屏都有查看权限,一屏都不许漏', () => {
    const open = fpAllPages().filter(p => !viewPermsOf(p.value)?.length).map(p => p.value)
    expect(open).toEqual([])
  })

  it('按契约逐模块对得上(抽查每个模块各一屏)', () => {
    expect(viewPermsOf('buildings')).toEqual(['master:view'])
    expect(viewPermsOf('/tenants')).toEqual(['master:view'])
    expect(viewPermsOf('contracts')).toEqual(['contract:view'])
    expect(viewPermsOf('params')).toEqual(['param:view'])
    expect(viewPermsOf('meters')).toEqual(['meter:view'])
    expect(viewPermsOf('bill-notices')).toEqual(['billing:view'])
    expect(viewPermsOf('ledger')).toEqual(['entry:view'])
    expect(viewPermsOf('salary')).toEqual(['salary:view'])
    expect(viewPermsOf('rent-pnl')).toEqual(['report:view'])
    expect(viewPermsOf('cockpit')).toEqual(['analysis:view'])
    expect(viewPermsOf('sys-roles')).toEqual(['system:view'])
    // 本月出账:数据层任一查看权(工资也算);导入中心再加报表
    expect(viewPermsOf('data-home')).toHaveLength(7)
    expect(viewPermsOf('import')).toContain('report:view')
  })

  // 破坏验证:把 MODE_VIEW 那一行删掉 → 红(?mode=meter 落回两者任一,只有台账权的人也能进抄表那本)
  it('❗光伏 / 充电桩一屏两本账:带 ?mode= 的只认那一本的权限,不带的两者任一', () => {
    expect(viewPermsOf('/pv-income')).toEqual(['entry:view', 'meter:view'])
    expect(viewPermsOf('/pv-income?mode=meter')).toEqual(['meter:view'])
    expect(viewPermsOf('/car-charging?mode=summary&p=2025')).toEqual(['entry:view'])
    expect(canViewPage('/ebike-charging?mode=meter', has('entry:view'))).toBe(false)
    expect(canViewPage('/ebike-charging', has('entry:view'))).toBe(true)
    // elec-cost 也有 mode,但两本都归台账与附表,不吃这条
    expect(viewPermsOf('/elec-cost?mode=summary')).toEqual(['entry:view'])
  })

  it('首页、新标签页、不认识的地址不设门', () => {
    expect(viewPermsOf('home')).toBeNull()
    expect(viewPermsOf('/newtab')).toBeNull()
    expect(viewPermsOf('/not-a-screen')).toBeNull()
    expect(canViewPage('/home', has())).toBe(true)
  })

  it('viewLack:看得了返回 null,看不了返回补任一项就行的那几项', () => {
    expect(viewLack('/ledger', has('entry:view'))).toBeNull()
    expect(viewLack('/ledger', has('analysis:view'))).toEqual(['entry:view'])
    expect(viewLack(undefined, has())).toBeNull()
  })
})

describe('导航按查看权隐藏', () => {
  const SHAREHOLDER = has('analysis:view', 'report:view')   // V134:股东只给这两项,导航层 analysis + reports

  // ❗破坏验证:把 isLayerVisible 里的 some(canViewPage) 改成 true → 红(只有分析查看权的人看见空的数据层)
  it('❗一屏都看不了的层,就算勾在 navLayers 里也不出', () => {
    expect(visibleLayers(ALL, has('analysis:view')).map(L => L.id)).toEqual(['analysis'])
  })

  it('❗股东(导航层 analysis + reports):报表与分析照出,数据层的屏一个都搜不到', () => {
    expect(visibleLayers(['analysis', 'reports'], SHAREHOLDER).map(L => L.id)).toEqual(['reports', 'analysis'])
    const pages = buildAllPages(['analysis', 'reports'], SHAREHOLDER).map(p => p.value)
    expect(pages).toContain('cockpit')
    expect(pages).toContain('income-statement')
    expect(pages).not.toContain('ledger')
    expect(pages).not.toContain('data-home')
    // 要是给他勾上数据层:那一层只剩导入中心(报表导入在那里,report:view 进得去)
    expect(visibleSections(DATA, SHAREHOLDER).flatMap(s => s.items.map(it => it.value))).toEqual(['import'])
  })

  // ❗破坏验证:把 visibleSections 的 filter 去掉 → 红
  it('❗只有台账查看权:数据层里只剩本月出账、台账与附表那几屏、导入中心;工资、楼栋、合同都不列', () => {
    const can = has('entry:view')
    const items = visibleSections(DATA, can).flatMap(s => s.items.map(it => it.value))
    expect(items).toEqual(expect.arrayContaining(['data-home', 'ledger', 'sales-income', 'pv-income', 'elec-cost', 'import']))
    for (const v of ['buildings', 'tenants', 'contracts', 'params', 'meters', 'alloc', 'bill-notices', 'salary']) expect(items).not.toContain(v)
    // 「档案」「出账」两个带标题的组整组没了,不留空标题
    expect(visibleSections(DATA, can).map(s => s.title)).not.toContain('档案')
    expect(visibleSections(DATA, can).map(s => s.title)).not.toContain('出账 · 每月工序')
  })

  it('工资单独一项:有全部数据层查看权但没有 salary:view,工资那一屏不出', () => {
    const can = has(...BIZ_VIEWS.filter(p => p !== 'salary:view'))
    expect(buildAllPages(ALL, can).map(p => p.value)).not.toContain('salary')
    expect(buildAllPages(ALL, ALL_BIZ).map(p => p.value)).toContain('salary')
  })

  // 破坏验证:layerEntry 直接 return L.home → 红
  it('点层图标:层首页看不了就落这一层第一块看得了的屏', () => {
    expect(layerEntry(DATA, ALL_BIZ)).toBe('data-home')
    expect(layerEntry(DATA, has('report:view'))).toBe('import')
  })
})


// ══════════ 跨层链接可达性(2026-09-08) ══════════
//
// 有查看权、只是所在层不在 navLayers 里的屏照样打得开。所以这里判的不是「打不开」,
// 是「回不来」—— 侧栏里没有那一层的入口,人落在那屏上没有返回路径。
describe('canReach:这条链接把人送去的地方,他回得来吗', () => {
  const SH = ['analysis']                      // 只有一层的角色

  // 破坏验证:把 canReach 改成 `return true` → 前两条红
  it('❗看不见目标屏所在层就不给链接;看得见才给', () => {
    expect(canReach('/tenants', SH, ALL_BIZ), '租户管理在数据层,回不来').toBe(false)
    expect(canReach('/rent-pnl', SH, ALL_BIZ), '损益附表在报表层,同理').toBe(false)
    expect(canReach('/churn', SH, ALL_BIZ), '流失分析就在他自己那一层').toBe(true)
    expect(canReach('/tenants', ALL, ALL_BIZ), '三层全在的人照给').toBe(true)
  })

  // 破坏验证:把 `.split(/[?#]/)` 去掉 → 红(带 query 的目标查不到,会被当成"不认识"放行)
  it('❗带 query / hash 的深链也要认出目标屏 —— 认不出会当成不认识而放行', () => {
    expect(canReach('/tenants?p=2025-06', SH, ALL_BIZ)).toBe(false)
    expect(canReach('/tenants#top', SH, ALL_BIZ)).toBe(false)
    expect(canReach('/tenants?p=2025-06', ALL, ALL_BIZ)).toBe(true)
  })

  // 破坏验证:把 `.replace(/^\//, '')` 去掉 → 红(全部变成"不认识"→ 恒真)
  it('❗前导斜杠要剥掉 —— 不剥的话导航表一个都查不到,这道门等于没有', () => {
    expect(canReach('/tenants', SH, ALL_BIZ)).toBe(false)
  })

  // ❗放行不是漏判:导航表里没有的目标(外链、还没登记的屏)一律给。
  //   破坏验证:把 `!meta ||` 去掉 → 红。少一条链接没人看得出是 bug,只会以为界面坏了。
  it('❗导航表里不认识的目标一律放行,不许静默吞掉链接', () => {
    expect(canReach('/not-a-screen', SH, ALL_BIZ)).toBe(true)
    expect(canReach('/', SH, ALL_BIZ)).toBe(true)
  })

  it('没给 to 就没有链接可判', () => {
    expect(canReach(undefined, ALL, ALL_BIZ)).toBe(false)
    expect(canReach(null, ALL, ALL_BIZ)).toBe(false)
    expect(canReach('', ALL, ALL_BIZ)).toBe(false)
  })

  // 系统层不进 navLayers,跟着 system:view 走(与 isLayerVisible 同一条口径)
  it('系统管理层按 system:view 判,不按 navLayers', () => {
    expect(canReach('/sys-users', ALL, ALL_BIZ)).toBe(false)
    expect(canReach('/sys-users', ALL, WITH_SYS)).toBe(true)
  })

  // v3:层在、但没有目标屏的查看权 → 也不给链接(调用点另拿 viewLack 置灰写原因)
  //   破坏验证:把 canReach 里的 canViewPage 去掉 → 红
  it('❗三层都在、但没有台账查看权:去台账的链接不给', () => {
    expect(canReach('/ledger', ALL, has('analysis:view', 'report:view'))).toBe(false)
    expect(canReach('/ledger', ALL, has('analysis:view', 'entry:view'))).toBe(true)
  })
})
