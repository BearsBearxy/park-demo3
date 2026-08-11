// 公摊分摊纯逻辑 — S3-B1 后仅保留:费项/方法字典、参数解析(月行优先回退默认)。
// 月度网格/导出(buildMonthlyGrid/buildAllocExportAoa)随 AllocView 退役(池核算屏见 poolLedgerLogic)。
import type { AllocCfgDTO, AllocFeeKey, AllocMethod } from '@/api/alloc'

// 费项列序=页面列序(消防/电梯/路灯/楼层照明/损耗;share_water 占位首版不生成)
export const ALLOC_FEE_KEYS: AllocFeeKey[] = [
  'share_elec_fire', 'share_elec_elevator', 'share_elec_light', 'share_elec_floor', 'share_elec_loss',
  'share_green_water',
]
export const ALLOC_FEE_LABEL: Record<AllocFeeKey, string> = {
  share_elec_fire: '消防用电',
  share_elec_elevator: '电梯用电',
  share_elec_light: '路灯公摊',
  share_elec_floor: '楼层照明',
  share_elec_loss: '损耗费',
  share_green_water: '绿化水公摊',
  share_water: '绿化水(占位)',
  park_loss_pool: '园区损耗公摊池',
}
export const ALLOC_METHOD_LABEL: Record<AllocMethod, string> = {
  direct: '整笔归户',
  area: '按面积',
  floor: '按层均摊',
  loss: '并入损耗',
  none: '不分摊',
  ref: '纯标准行',
  carrier: '冲减载体',
  manual: '无电表',   // V81 §H4.2e 人工指定行(与 poolSemantics 的话术一致)
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
