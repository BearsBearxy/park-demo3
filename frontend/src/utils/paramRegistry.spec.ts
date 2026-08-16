import { describe, expect, it } from 'vitest'
import { PARAM_DEFS, paramDef, type ParamDef } from './paramRegistry'
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
    expect(PARAM_DEFS.length).toBe(43)
  })
  it('逐键 label/unit/group/defaultMode/monthlyCheck/valueKind/enumOptions/formula/hint/tenantEditable/pairedWith 相同', () => {
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
      expect(d, f.key).toEqual(norm)
    }
  })
})

describe('paramDef 查询', () => {
  it('前缀键 loss_base_form_b{bid} 按前缀命中模板;非数字后缀不命中', () => {
    expect(paramDef('loss_base_form_b13')?.key).toBe('loss_base_form_b{bid}')
    expect(paramDef('loss_base_form_b32')?.label).toBe('损耗费基数形态（按栋）')
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
