import { describe, it, expect } from 'vitest'
import {
  isLayerVisible, visibleLayers, visibleSections, layerEntry, landingPath, canReach,
  viewPermsOf, canViewPage, viewLack, isScreenWrite, isKnownPerm, CROSS_PERMS, type Can,
} from '../navAccess'
import { buildAllPages } from '@/components/shell/paletteFilter'
import { FP_NAV, fpAllPages } from '../fpNav'
import { ALL_VIEWS, viewsOf } from '@/test-utils/perms'

/** 给一组权限点,造一个 auth.can。 */
const has = (...ps: string[]): Can => (p) => ps.includes(p)
const ALL_BIZ = has(...ALL_VIEWS)
const WITH_SYS = has(...ALL_VIEWS, ...viewsOf('system'))
const ALL = ['data', 'reports', 'analysis']
const DATA = FP_NAV.find(L => L.id === 'data')!

describe('导航层可见性', () => {
  it('只给 analysis 的角色只剩经营分析层,命令面板同步只剩该层的屏', () => {
    expect(visibleLayers(['analysis'], ALL_BIZ).map(L => L.id)).toEqual(['analysis'])
    const layers = new Set(buildAllPages(['analysis'], ALL_BIZ).map(p => p.layer))
    expect([...layers]).toEqual(['analysis'])
  })

  it("'system' 层不看 navLayers,三屏任一看得了就出", () => {
    expect(isLayerVisible('system', ALL, ALL_BIZ)).toBe(false)
    expect(isLayerVisible('system', [], has('sys-logs:view'))).toBe(true)
  })

  it('系统管理三屏一屏一项:只给操作日志查看,图标栏有系统层、命令面板只搜得到操作日志', () => {
    expect(visibleLayers(ALL, ALL_BIZ).map(L => L.id)).not.toContain('system')
    expect(buildAllPages(ALL, ALL_BIZ).map(p => p.value)).not.toContain('sys-users')
    const logsOnly = has(...ALL_VIEWS, 'sys-logs:view')
    expect(visibleLayers(ALL, logsOnly).map(L => L.id)).toContain('system')
    expect(buildAllPages(ALL, logsOnly).filter(p => p.layer === 'system').map(p => p.value)).toEqual(['sys-logs'])
    expect(buildAllPages(ALL, WITH_SYS).map(p => p.value)).toEqual(expect.arrayContaining(['sys-users', 'sys-roles', 'sys-logs']))
  })

  it('落地页底三档:无 data 层落驾驶舱,其余落数据中心首页', () => {
    expect(landingPath(['reports', 'analysis'])).toBe('/cockpit')
    expect(landingPath(['data', 'reports', 'analysis'])).toBe('/data-home')
    // 客户自建的「纯管理员」(不勾任何业务层、只给系统管理)不能落到一个侧边栏没入口的屏上:落系统层第一块看得了的屏
    expect(landingPath([], '/sys-users')).toBe('/sys-users')
    expect(landingPath([], '/sys-logs')).toBe('/sys-logs')
    expect(landingPath([], null)).toBe('/cockpit')   // 连 system 都没有 → 兜底,不能返回空
  })

  // 破坏验证:把 readonly 那一档删掉 → 红。这一条就是 P5 的独立价值「总经理直落驾驶舱」。
  it('❗零写权的人(总经理 / 只读账号)落驾驶舱,不落一屏按不动的录入清单', () => {
    expect(landingPath(ALL, null, { readonly: true })).toBe('/cockpit')
    // 同一个人,有写权限就还是本月出账 —— 差别只在 readonly 这一个位
    expect(landingPath(ALL, null, { readonly: false })).toBe('/data-home')
  })

  // ❗次序钉:审核员本身零写权(D16 录审分离),readonly 那一档排在前面会把他也送去驾驶舱,
  //   而他每天来就是为了本月出账屏上的审核队列。破坏验证:把两个 if 调换 → 红。
  it('❗审核员落本月出账 —— 他也是零写权,两档次序不能反', () => {
    expect(landingPath(ALL, null, { readonly: true, reviewer: true })).toBe('/data-home')
  })

  it('看不见的层不当落点:审核员没有 data 层就退回底三档,股东没有 analysis 层同理', () => {
    expect(landingPath(['reports'], null, { readonly: true, reviewer: true })).toBe('/cockpit')
    // 纯管理员(零业务层)是只读的话也不能被 readonly 那一档抢走 —— 他没有 analysis 层
    expect(landingPath([], '/sys-users', { readonly: true })).toBe('/sys-users')
  })
})


// ══════════ RBAC v4:权限细到菜单单项(用户 2026-10-09 拍板) ══════════
// 一屏一项 `<屏>:view`;没有就不在导航、搜索里出现,打开落「无权查看」页。
describe('每一屏的查看权限(viewPermsOf)', () => {
  // ❗漏配一屏 = 那一屏谁都能进(viewPermsOf 返回 null 是「不设门」)。
  //   破坏验证:viewPermsOf 对 meters 返回 null → 红并点名 meters;返回别的键 → 红
  it('❗导航里的 51 屏,每屏恰好要自己那一项 `<屏>:view`', () => {
    const pages = fpAllPages()
    expect(pages).toHaveLength(51)
    const wrong = pages.filter(p => JSON.stringify(viewPermsOf(p.value)) !== JSON.stringify([`${p.value}:view`])).map(p => p.value)
    expect(wrong).toEqual([])
    expect(viewPermsOf('/tenants')).toEqual(['tenants:view'])
    expect(viewPermsOf('/ledger?p=2025-06#top')).toEqual(['ledger:view'])
  })

  // 破坏验证:viewPermsOf 按 ?mode= 返回别的键 → 红
  it('❗光伏 / 充电桩一屏两本账:?mode= 不再分权,两本都只看这一屏的查看', () => {
    expect(viewPermsOf('/pv-income')).toEqual(['pv-income:view'])
    expect(viewPermsOf('/pv-income?mode=meter')).toEqual(['pv-income:view'])
    expect(viewPermsOf('/car-charging?mode=summary&p=2025')).toEqual(['car-charging:view'])
    expect(canViewPage('/ebike-charging?mode=meter', has('ebike-charging:view'))).toBe(true)
    expect(canViewPage('/ebike-charging?mode=meter', has('car-charging:view')), '汽车桩的查看不开电动车那一屏').toBe(false)
  })

  it('首页、新标签页、不认识的地址不设门', () => {
    expect(viewPermsOf('home')).toBeNull()
    expect(viewPermsOf('/newtab')).toBeNull()
    expect(viewPermsOf('/not-a-screen')).toBeNull()
    expect(canViewPage('/home', has())).toBe(true)
  })

  it('viewLack:看得了返回 null,看不了返回那一屏的查看', () => {
    expect(viewLack('/ledger', has('ledger:view'))).toBeNull()
    expect(viewLack('/ledger', has('sales-income:view'))).toEqual(['ledger:view'])
    expect(viewLack(undefined, has())).toBeNull()
  })
})

describe('isScreenWrite / isKnownPerm', () => {
  // 破坏验证:isScreenWrite 改成 `p.endsWith(':edit')` → 专有动作那几条红(签发的人会被当成只读账号)
  it('❗屏级写权:编辑和专有动作都算,查看不算,跨屏三项不算,旧键不算', () => {
    expect(['ledger:edit', 'bill-notices:issue', 'meters:archive', 'params:recalc'].map(isScreenWrite)).toEqual([true, true, true, true])
    expect(['ledger:view', 'review:approve', 'elevate:request', 'entry:edit', 'billing-run:edit'].map(isScreenWrite))
      .toEqual([false, false, false, false, false])
  })

  // 破坏验证:isKnownPerm 恒 true → 旧键那几条红(路由守卫就不会为 0.32 留下的旧快照重取 /auth/me)
  it('❗认得的键:屏级键与跨屏三项;0.32 的模块键一个都不认', () => {
    expect([...ALL_VIEWS, 'sys-roles:edit', 'bill-notices:issue', ...CROSS_PERMS].every(isKnownPerm)).toBe(true)
    expect(['master:view', 'entry:edit', 'system:view', 'company:manage', 'report:edit', 'analysis:view'].map(isKnownPerm))
      .toEqual([false, false, false, false, false, false])
  })
})

describe('导航按查看权隐藏', () => {
  // 迁移后的园区股东:报表层 10 屏 + 分析层 20 屏 + 导入中心(RBAC-SPEC §15.3),导航层 analysis + reports
  const SHAREHOLDER = has(...viewsOf('reports'), ...viewsOf('analysis'), 'import:view')

  // ❗破坏验证:把 isLayerVisible 里的 some(canViewPage) 改成 true → 红(只有分析查看权的人看见空的数据层)
  it('❗一屏都看不了的层,就算勾在 navLayers 里也不出', () => {
    expect(visibleLayers(ALL, has(...viewsOf('analysis'))).map(L => L.id)).toEqual(['analysis'])
  })

  it('❗股东(导航层 analysis + reports):报表与分析照出,数据层的屏一个都搜不到', () => {
    expect(visibleLayers(['analysis', 'reports'], SHAREHOLDER).map(L => L.id)).toEqual(['reports', 'analysis'])
    const pages = buildAllPages(['analysis', 'reports'], SHAREHOLDER).map(p => p.value)
    expect(pages).toContain('cockpit')
    expect(pages).toContain('income-statement')
    expect(pages).not.toContain('ledger')
    expect(pages).not.toContain('data-home')
    // 要是给他勾上数据层:那一层只剩导入中心
    expect(visibleSections(DATA, SHAREHOLDER).flatMap(s => s.items.map(it => it.value))).toEqual(['import'])
  })

  // ❗破坏验证:把 visibleSections 的 filter 去掉 → 红
  it('❗同一组里部分单项没授权:只列授了的那几屏,整组没授的不留空标题', () => {
    const can = has('data-home:view', 'ledger:view', 'pv-income:view', 'import:view')
    const sec = visibleSections(DATA, can)
    expect(sec.flatMap(s => s.items.map(it => it.value))).toEqual(['data-home', 'ledger', 'pv-income', 'import'])
    // 「记账 · 按月」只剩月度台账,附表10、工资都不列;「档案」「出账」两个组整组没了
    expect(sec.find(s => s.title === '记账 · 按月')!.items.map(it => it.value)).toEqual(['ledger'])
    expect(sec.map(s => s.title)).not.toContain('档案')
    expect(sec.map(s => s.title)).not.toContain('出账 · 每月工序')
  })

  it('工资单独一项:有全部别的业务屏查看但没有工资那一屏的,工资不出', () => {
    const can = has(...ALL_VIEWS.filter(p => p !== 'salary:view'))
    expect(buildAllPages(ALL, can).map(p => p.value)).not.toContain('salary')
    expect(buildAllPages(ALL, ALL_BIZ).map(p => p.value)).toContain('salary')
  })

  // 破坏验证:layerEntry 直接 return L.home → 红
  it('点层图标:层首页看不了就落这一层第一块看得了的屏', () => {
    expect(layerEntry(DATA, ALL_BIZ)).toBe('data-home')
    expect(layerEntry(DATA, has('import:view'))).toBe('import')
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

  // 系统层不进 navLayers,跟着三屏的查看走(与 isLayerVisible 同一条口径)
  it('系统管理层按那一屏的查看判,不按 navLayers', () => {
    expect(canReach('/sys-users', ALL, ALL_BIZ)).toBe(false)
    expect(canReach('/sys-users', ALL, WITH_SYS)).toBe(true)
    expect(canReach('/sys-users', ALL, has(...ALL_VIEWS, 'sys-logs:view')), '层看得见、那一屏看不了').toBe(false)
  })

  // 层在、但没有目标屏的查看权 → 也不给链接(调用点另拿 viewLack 置灰写原因)
  //   破坏验证:把 canReach 里的 canViewPage 去掉 → 红
  it('❗三层都在、但没有台账那一屏的查看权:去台账的链接不给,同组的附表10 照给', () => {
    const can = has(...viewsOf('analysis'), 'sales-income:view')
    expect(canReach('/ledger', ALL, can)).toBe(false)
    expect(canReach('/sales-income', ALL, can)).toBe(true)
  })
})
