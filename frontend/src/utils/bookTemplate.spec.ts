import { describe, it, expect } from 'vitest'
import { lgColumns, FEE_KEYS } from './ledgerColumns'
import { lgRecalc } from './lgRecalc'
import { toLedgerColumns, toS10Layout, extraColIds, mergeExtras, extractExtras } from './bookTemplate'
import type { BookCol, BookDef, BookSlot } from '../types/book'
import type { LedgerRowDTO } from '../types/ledger'

// ---------- 构造器 ----------

const col = (over: Partial<BookCol> & Pick<BookCol, 'id' | 'label' | 'slot'>): BookCol => ({
  std: true, aliases: [], hidden: false, w: null, ...over,
})

// 标准 21 列模板:按 lgColumns(7) 逆向构造(月份组名回写 MON 占位)。
const GROUP_SLOTS: BookSlot[] = ['rent', 'infra', 'misc', 'misc', 'elec', 'water']
function stdDef(): BookDef {
  const m = lgColumns(7)
  return {
    groups: m.groups.map((g, i) => ({
      id: 'g' + i,
      label: g.name.replace('7月', 'MON'),
      cols: g.cols.map(c => col({ id: c.key, label: c.label, slot: GROUP_SLOTS[i], w: c.w })),
    })),
  }
}

function blankRow(over: Partial<LedgerRowDTO> = {}): LedgerRowDTO {
  return {
    id: 1, tenantId: 1, tenantName: 'T', balancePrev: 0, totalCollected: 0, note: null,
    totalReceivable: 0, balanceEnd: 0,
    factoryRent: 0, factoryMgmtFee: 0, shopRent: 0, dormRent: 0, dormFacilitiesFee: 0, shopMgmtFee: 0,
    factoryInfraMaint: 0, shopInfraMaint: 0, dormInfraMaint: 0,
    elevatorMaint: 0, transformerMaint: 0, landUseTax: 0, networkFee: 0, accessCtrlMaint: 0, officeOtherFee: 0,
    dormOtherFee: 0, basicElectricity: 0, standardElectricity: 0, electricityMaint: 0,
    standardWater: 0, waterMaint: 0,
    ...over,
  }
}

// ---------- toLedgerColumns ----------

describe('toLedgerColumns', () => {
  it('标准 21 列模板映射结果与 lgColumns 逐项全等(含 MON→7月、fixedLeft/fixedRight 照抄)', () => {
    expect(toLedgerColumns(stdDef(), 7)).toEqual(lgColumns(7))
  })

  it('费用列 key 序与 FEE_KEYS 一致', () => {
    const keys = toLedgerColumns(stdDef(), 7).groups.flatMap(g => g.cols.map(c => c.key))
    expect(keys).toEqual(FEE_KEYS)
  })

  it('hidden 列跳过;整组隐藏则丢组', () => {
    const def = stdDef()
    def.groups[0].cols[1].hidden = true            // factoryMgmtFee
    def.groups[3].cols.forEach(c => { c.hidden = true }) // 宿舍费用整组(dormOtherFee)
    const m = toLedgerColumns(def, 7)
    const keys = m.groups.flatMap(g => g.cols.map(c => c.key))
    expect(keys).not.toContain('factoryMgmtFee')
    expect(keys).not.toContain('dormOtherFee')
    expect(m.groups.map(g => g.name)).not.toContain('宿舍费用')
    expect(m.groups).toHaveLength(5)
  })

  // spec §2:hidden 只往显示侧修——该月有钱的列一律显示且只读,否则屏上合计永远对不上明细
  it('归档列追加成只读的「已归档」组', () => {
    const m = toLedgerColumns(stdDef(), 12, [{ id: 'c_arch', label: '待归档费' }])
    const g = m.groups.find(x => x.name === '已归档')
    expect(g).toBeTruthy()
    expect(g!.cols[0]).toMatchObject({ key: 'c_arch', label: '待归档费', readonly: true })
  })

  it('没有归档列时不出现「已归档」组', () => {
    const m = toLedgerColumns(stdDef(), 12, [])
    expect(m.groups.find(x => x.name === '已归档')).toBeUndefined()
  })

  it('自定义列出现在所属分组,w 缺省 96,label 来自模板', () => {
    const def = stdDef()
    def.groups[0].cols.push(col({ id: 'c_parking', std: false, label: '停车费', slot: 'misc' }))
    const grp = toLedgerColumns(def, 7).groups[0]
    expect(grp.cols.at(-1)).toEqual({ key: 'c_parking', label: '停车费', w: 96 })
  })
})

// ---------- toS10Layout ----------

describe('toS10Layout', () => {
  const def: BookDef = {
    groups: [
      { id: 'g1', label: '租金', cols: [
        col({ id: 'factoryRent', label: '厂房租金', slot: 'rent', w: 96 }),
        col({ id: 'c_park', std: false, label: '停车费', slot: 'misc', aliases: ['车位费'] }),
      ] },
      { id: 'g2', label: null, cols: [col({ id: 'otherFee', label: '其他费用', slot: 'other' })] },
      { id: 'g3', label: 'MON电费', cols: [
        col({ id: 'elecBasic', label: '基本用电费', slot: 'elec' }),
        col({ id: 'elecStd', label: '基准电费', slot: 'elec' }),
        col({ id: 'elecMaint', label: '电维护费', slot: 'elec', hidden: true }),
      ] },
      { id: 'g4', label: 'MON水费', cols: [
        col({ id: 'waterStd', label: '基准水费', slot: 'water', hidden: true }),
      ] },
    ],
  }

  it('形状/直通列/别名/hidden 跳过/整组隐藏丢组', () => {
    const out = toS10Layout(def)
    expect(out).toHaveLength(3) // g4 整组隐藏被丢
    // g1:混合槽不标 elec/water,别名带出
    expect(out[0].label).toBe('租金')
    expect(out[0].elec).toBeUndefined()
    expect(out[0].leaves).toEqual([
      { colId: 'factoryRent', label: '厂房租金' },
      { colId: 'c_park', label: '停车费', aliases: ['车位费'] },
    ])
    // g2:label null → 不带 label 键(无一级表头直通列)
    expect('label' in out[1]).toBe(false)
    expect(out[1].leaves).toEqual([{ colId: 'otherFee', label: '其他费用' }])
    // g3:整组 elec 槽 → elec 标记;MON 保留原样;hidden 叶子跳过
    expect(out[2]).toEqual({
      label: 'MON电费', elec: true,
      leaves: [{ colId: 'elecBasic', label: '基本用电费' }, { colId: 'elecStd', label: '基准电费' }],
    })
  })

  // spec §2 两屏同做:附表10 走同一个 ExtraFees.sum,归档列也必须显示且只读
  it('归档列追加成只读的「已归档」组', () => {
    const out = toS10Layout(def, [{ id: 'c_arch', label: '待归档费' }])
    const g = out.find(x => x.label === '已归档')
    expect(g).toBeTruthy()
    expect(g!.leaves[0]).toMatchObject({ colId: 'c_arch', label: '待归档费', readonly: true })
  })

  it('没有归档列时不出现「已归档」组', () => {
    expect(toS10Layout(def, []).find(x => x.label === '已归档')).toBeUndefined()
  })
})

// ---------- extraColIds / mergeExtras / extractExtras ----------

describe('口袋列', () => {
  it('extraColIds 含 hidden 自定义列,不含标准列', () => {
    const def: BookDef = { groups: [{ id: 'g', label: null, cols: [
      col({ id: 'factoryRent', label: '厂房租金', slot: 'rent' }),
      col({ id: 'c_a', std: false, label: 'A', slot: 'misc' }),
      col({ id: 'c_b', std: false, label: 'B', slot: 'misc', hidden: true }),
    ] }] }
    expect(extraColIds(def)).toEqual(['c_a', 'c_b'])
  })

  // 归档列可能已被从模板里删掉(P5 删列守卫已废),它不在 def 里 ——
  // 保存走 extraFees 整包替换,漏掉它这笔历史钱会被清成 null(spec §2 要防的正是这类事故);
  // 同时在 def 与归档清单里的 hidden 列只能出现一次,重复会让 lgRecalc 把它双算
  it('extraColIds 并入本月归档列并去重', () => {
    const def: BookDef = { groups: [{ id: 'g', label: null, cols: [
      col({ id: 'factoryRent', label: '厂房租金', slot: 'rent' }),
      col({ id: 'c_a', std: false, label: 'A', slot: 'misc' }),
      col({ id: 'c_b', std: false, label: 'B', slot: 'misc', hidden: true }),
    ] }] }
    expect(extraColIds(def, [{ id: 'c_b', label: 'B' }, { id: 'c_gone', label: '已删列' }]))
      .toEqual(['c_a', 'c_b', 'c_gone'])
  })

  it('mergeExtras 平铺 c_xxx 且返回新对象;无口袋时为浅拷贝', () => {
    const row = { tenantName: 'T', factoryRent: 10, extraFees: { c_a: 5.5, c_b: null } }
    const flat = mergeExtras(row) as Record<string, unknown>
    expect(flat).not.toBe(row)
    expect(flat.c_a).toBe(5.5)
    expect(flat.c_b).toBeNull()
    expect(flat.factoryRent).toBe(10)
    const bare = { tenantName: 'T' }
    expect(mergeExtras(bare)).toEqual(bare)
    expect(mergeExtras(bare)).not.toBe(bare)
  })

  it('mergeExtras → extractExtras 往返;缺失/空串 → null', () => {
    const flat = mergeExtras({ id: 1, extraFees: { c_a: 5.5, c_b: null } }) as Record<string, unknown>
    flat.c_c = ''
    expect(extractExtras(flat, ['c_a', 'c_b', 'c_c', 'c_missing']))
      .toEqual({ c_a: 5.5, c_b: null, c_c: null, c_missing: null })
  })
})

// ---------- lgRecalc + customIds ----------

describe('lgRecalc customIds', () => {
  it('Σ 追加口袋列;null/缺失口袋值按 0', () => {
    const row = blankRow({ factoryRent: 100, balancePrev: 50, totalCollected: 30 })
    Object.assign(row, { c_a: 100.25, c_b: null })
    lgRecalc(row, ['c_a', 'c_b', 'c_missing'])
    expect(row.totalReceivable).toBe(200.25)
    expect(row.balanceEnd).toBe(220.25) // 50 + 200.25 − 30
  })

  it('默认调用(不传 customIds)行为不变,忽略平铺的 c_xxx', () => {
    const row = blankRow({ factoryRent: 100 })
    Object.assign(row, { c_a: 999 })
    lgRecalc(row)
    expect(row.totalReceivable).toBe(100)
  })
})
