import { describe, expect, it } from 'vitest'
import { PARAM_DEFS, paramDef, writePlan, type ParamDef } from './paramRegistry'
import fixture from './__fixtures__/param-registry.json'

// 后端 ParamRegistryTest.exportJson 导出的镜像(字段名对齐 ParamDef;null=无)
interface FixtureDef {
  key: string; table: string; label: string; unit: string; group: string; scopes: string[]
  defaultMode: string; monthlyCheck: boolean; valueKind: string
  enumOptions: Record<string, string> | null; formula: string | null; hint: string | null
  tenantEditable: boolean; pairedWith: string | null
}
const FIX = fixture as FixtureDef[]

// 与 Java ParamRegistryTest.FORBIDDEN 同一条:人话文案不含下划线与内部标识
const FORBIDDEN = /(building:|rule:|meter:|tenant:|默认·所有月份|_)/

const RETIRED = ['loss_g_adj', 'price_flat', 'price_loss', 'price_norm', 'price_sharp', 'price_peak', 'price_valley',
  'green_rate_live', 'lamp_rate_live', 'loss_rate', 'no_such_key', 'lamp_sqm']

describe('paramRegistry 与后端注册表镜像一致(fixture = ParamRegistryTest 导出)', () => {
  it('键集合与顺序逐一相同', () => {
    expect(PARAM_DEFS.map(d => d.key)).toEqual(FIX.map(f => f.key))
    expect(new Set(PARAM_DEFS.map(d => d.key)).size).toBe(PARAM_DEFS.length)
    expect(PARAM_DEFS.length).toBe(44)   // 43 + elec_grid_avg(M1 拍板 2026-08-16)
  })
  it('逐键 label/unit/group/defaultMode/monthlyCheck/valueKind/enumOptions/formula/hint/tenantEditable/pairedWith/monthOnly 相同', () => {
    for (const f of FIX) {
      const d = paramDef(f.key)!
      expect(d, f.key).toBeDefined()
      const norm: Partial<ParamDef> = {
        key: f.key, label: f.label, unit: f.unit, group: f.group as ParamDef['group'],
        defaultMode: f.defaultMode as ParamDef['defaultMode'], monthlyCheck: f.monthlyCheck,
        valueKind: f.valueKind as ParamDef['valueKind'],
      }
      if (f.enumOptions) norm.enumOptions = Object.fromEntries(Object.entries(f.enumOptions).map(([k, v]) => [Number(k), v]))
      if (f.formula) norm.formula = f.formula
      if (f.hint) norm.hint = f.hint
      if (f.tenantEditable) norm.tenantEditable = true
      if (f.pairedWith) norm.pairedWith = f.pairedWith
      // 后端 ParamService.write:价目表 && MONTHLY_KEYS(默认 month) 的键 mode≠month → 400「只能按月生效」;前端弹窗/新增例外据此藏 from
      if (f.table === 'price' && f.defaultMode === 'month') norm.monthOnly = true
      expect(d, f.key).toEqual(norm)
    }
  })
  it('只能按月生效的键 = 电价 6 键 + 供电局综合电价 + 照抄金额(8 键);损耗月参(alloc 表)不受限', () => {
    expect(PARAM_DEFS.filter(d => d.monthOnly).map(d => d.key)).toEqual([
      'elec_commercial', 'elec_peak', 'elec_sharp', 'elec_flat', 'elec_valley', 'elec_resident', 'elec_grid_avg', 'loss_base_park_amount'])
    expect(paramDef('loss_adj_qty')?.monthOnly).toBeUndefined()
    expect(paramDef('extra_qty')?.monthOnly).toBeUndefined()
  })
})

describe('paramDef 查询', () => {
  it('前缀键 loss_base_form_b{bid} 按前缀命中模板;非数字后缀不命中', () => {
    expect(paramDef('loss_base_form_b13')?.key).toBe('loss_base_form_b{bid}')
    expect(paramDef('loss_base_form_b32')?.label).toBe('损耗费计费基数（按栋）')
    expect(paramDef('loss_base_form_bx')).toBeUndefined()
    expect(paramDef('loss_base_form')?.key).toBe('loss_base_form')
  })
  it('退役键不注册', () => {
    for (const k of RETIRED) expect(paramDef(k), k).toBeUndefined()
  })
  it('默认生效方式:电价 month / 常数与口径 from / 月参 month', () => {
    expect(paramDef('elec_peak')?.defaultMode).toBe('month')
    expect(paramDef('coefficient')?.defaultMode).toBe('from')
    expect(paramDef('extra_qty')?.defaultMode).toBe('month')
    expect(paramDef('loss_adj_qty')?.defaultMode).toBe('month')
    expect(paramDef('loss_base_park_amount')?.defaultMode).toBe('month')
    expect(paramDef('elevator_area_base')?.defaultMode).toBe('from')
    expect(paramDef('loss_variant')?.defaultMode).toBe('from')
  })
})

describe('人话铁律(spec §5.2)', () => {
  it('label/formula/hint/枚举字典 不含下划线与内部标识;枚举键必有字典;配套键已注册', () => {
    for (const d of PARAM_DEFS) {
      expect(d.label.trim().length, d.key).toBeGreaterThan(0)
      expect(FORBIDDEN.test(d.label), `${d.key} label: ${d.label}`).toBe(false)
      if (d.formula) expect(FORBIDDEN.test(d.formula), `${d.key} formula`).toBe(false)
      if (d.hint) expect(FORBIDDEN.test(d.hint), `${d.key} hint`).toBe(false)
      if (d.valueKind === 'enum') expect(d.enumOptions, `${d.key} 枚举缺字典`).toBeDefined()
      for (const t of Object.values(d.enumOptions ?? {})) expect(FORBIDDEN.test(t), `${d.key} enum: ${t}`).toBe(false)
      if (d.pairedWith) expect(paramDef(d.pairedWith), `${d.key} 配套键`).toBeDefined()
    }
  })
  it('户级可编辑键 = 允许 tenant 作用域的 16 键(④ 区新增例外 / 系数簿键源)', () => {
    expect(PARAM_DEFS.filter(d => d.tenantEditable).map(d => d.key)).toEqual([
      'sharp_as_peak_ratio', 'loss_base_park_amount', 'mgmt_fee', 'mgmt_fee_commercial', 'capacity_fee', 'water',
      'water_pipe', 'elec_package', 'share_elec_fixed', 'share_water_fixed', 'green_rate', 'lamp_rate',
      'fire_amount_fixed', 'loss_base_form', 'loss_base_form_b{bid}', 'loss_base_park_meter'])
    expect(paramDef('mgmt_fee')?.pairedWith).toBe('mgmt_fee_commercial')
  })
})

describe('writePlan 户级例外配套写计划(spec §3.4;参数页 ④ 与系数簿共用)', () => {
  it('管理费双键同值 / 水价配 管网费=0 / 包干电价配 双 mgmt=0;其余只写自身', () => {
    expect(writePlan('mgmt_fee')).toEqual([{ key: 'mgmt_fee' }, { key: 'mgmt_fee_commercial' }])
    expect(writePlan('water')).toEqual([{ key: 'water' }, { key: 'water_pipe', fixed: 0 }])
    expect(writePlan('elec_package')).toEqual([{ key: 'elec_package' }, { key: 'mgmt_fee', fixed: 0 }, { key: 'mgmt_fee_commercial', fixed: 0 }])
    expect(writePlan('capacity_fee')).toEqual([{ key: 'capacity_fee' }])
    expect(writePlan('loss_base_form_b32')).toEqual([{ key: 'loss_base_form_b32' }])
  })
  it('计划首键=主键;配套键皆已注册且允许户级;pairedWith 一定在计划里', () => {
    for (const d of PARAM_DEFS.filter(x => x.tenantEditable)) {
      const plan = writePlan(d.key)
      expect(plan[0]).toEqual({ key: d.key })
      for (const w of plan) expect(paramDef(w.key)?.tenantEditable, `${d.key} → ${w.key}`).toBe(true)
      if (d.pairedWith) expect(plan.map(w => w.key)).toContain(d.pairedWith)
    }
  })
})
