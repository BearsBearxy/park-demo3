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

// 参数写回:保存成功后就地 upsert **那一条**月行(WRITE-KEEP-CONTEXT-SPEC 铁律二:改一格不重拉整月)。
// 与后端 saveCfg 同口径:value=null 即删该月行、回退默认行。新行的 id 给 0 占位 —— 屏上只按
// scope+cfgKey+月取值,不认 id(真 id 下次整月加载时自然带回来)。
export function upsertMonthCfg(rows: AllocCfgDTO[], scope: string, cfgKey: string,
                               acctMonth: string, value: number | null): void {
  const i = rows.findIndex(r => r.scope === scope && r.cfgKey === cfgKey && r.acctMonth === acctMonth)
  if (value == null) { if (i >= 0) rows.splice(i, 1) }
  // note 也要跟着清:后端 saveCfg 的 update 分支会把 note 写成 req.note,而写侧不传 note ⇒ 库里被清空。
  // 只改 value 会让内存副本的 note 比库里「新」,今天无害(月行的 note 屏上没人读),
  // 但日后给月行挂备注就会出现「屏上有、刷新后没了」。
  else if (i >= 0) { rows[i].value = value; rows[i].note = null }
  else rows.push({ id: 0, scope, cfgKey, value, acctMonth, note: null })
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
