// 公摊分摊纯逻辑(PB-ALLOCATION-SPEC §3 页面流):费项/方法字典、参数解析(月行优先回退默认)、
// 月度分摊网格(结果行 → 租户×费项列)、导出 AOA。allocLogic.spec.ts 锁定。
import type { AllocCfgDTO, AllocFeeKey, AllocMethod, AllocResultDTO } from '@/api/alloc'

// 费项列序=页面列序(消防/电梯/路灯/楼层照明/损耗;share_water 占位首版不生成)
export const ALLOC_FEE_KEYS: AllocFeeKey[] = [
  'share_elec_fire', 'share_elec_elevator', 'share_elec_light', 'share_elec_floor', 'share_elec_loss',
]
export const ALLOC_FEE_LABEL: Record<AllocFeeKey, string> = {
  share_elec_fire: '消防用电',
  share_elec_elevator: '电梯用电',
  share_elec_light: '路灯公摊',
  share_elec_floor: '楼层照明',
  share_elec_loss: '损耗费',
  share_water: '绿化水(占位)',
}
export const ALLOC_METHOD_LABEL: Record<AllocMethod, string> = {
  direct: '整笔归户',
  area: '按面积',
  floor: '按层均摊',
  loss: '并入损耗',
}

// 参数解析:月行(acctMonth=ym)优先,回退默认行('');两级都缺=null(同后端 resolveCfg 规则)
export function resolveCfg(rows: AllocCfgDTO[], scope: string, cfgKey: string): number | null {
  let def: number | null = null
  for (const r of rows) {
    if (r.scope !== scope || r.cfgKey !== cfgKey) continue
    if (r.acctMonth !== '') return r.value          // selectEffective 只含 ''∪当月行
    def = r.value
  }
  return def
}

// 月度分摊网格:结果行 → 一行一户(费项列+合计);排序=楼栋名→租户名
export interface AllocGridRow {
  tenantId: number
  tenantName: string
  buildingName: string | null
  fees: Partial<Record<AllocFeeKey, AllocResultDTO>>
  total: number
  hasManual: boolean
}

export function buildMonthlyGrid(results: AllocResultDTO[]): AllocGridRow[] {
  const byTenant = new Map<number, AllocGridRow>()
  for (const r of results) {
    let row = byTenant.get(r.tenantId)
    if (!row) {
      row = {
        tenantId: r.tenantId, tenantName: r.tenantName ?? `#${r.tenantId}`,
        buildingName: r.buildingName, fees: {}, total: 0, hasManual: false,
      }
      byTenant.set(r.tenantId, row)
    }
    row.fees[r.feeKey] = r
    row.total = Math.round((row.total + r.amount) * 100) / 100
    if (r.source === 'manual') row.hasManual = true
  }
  return [...byTenant.values()].sort((a, b) =>
    (a.buildingName ?? '').localeCompare(b.buildingName ?? '', 'zh')
    || a.tenantName.localeCompare(b.tenantName, 'zh'))
}

// 导出 AOA(催缴清单同款平表):表头+一行一户+合计行
export function buildAllocExportAoa(rows: AllocGridRow[], ym: string): (string | number)[][] {
  const head = ['租户', '楼栋', ...ALLOC_FEE_KEYS.map(k => ALLOC_FEE_LABEL[k]), '合计(元)', '备注']
  const aoa: (string | number)[][] = [[`公摊分摊 ${ym}`], head]
  const sums = new Array<number>(ALLOC_FEE_KEYS.length).fill(0)
  let total = 0
  for (const r of rows) {
    const cells = ALLOC_FEE_KEYS.map((k, i) => {
      const v = r.fees[k]?.amount
      if (v != null) sums[i] = Math.round((sums[i] + v) * 100) / 100
      return v ?? ''
    })
    total = Math.round((total + r.total) * 100) / 100
    const notes = ALLOC_FEE_KEYS.map(k => r.fees[k]?.note).filter(Boolean).join(';')
    aoa.push([r.tenantName, r.buildingName ?? '', ...cells, r.total, notes])
  }
  aoa.push(['合计', '', ...sums, total, ''])
  return aoa
}
