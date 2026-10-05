// src/analysis/anaSettings.ts — 分析层目标与阈值。
// 2026-10-05 用户拍板「2按你建议，3，4一起做」第 2 条:从各人浏览器挪进库(GET / PUT /api/analysis/settings)——
// 全员看同一份;只有「账簿报表」编辑权能改(没有的人弹层只读、写一句原因);每改一项进操作日志。
// 浏览器里原来存的不搬(有权的人重填一次),旧键载入时删掉。
// AnaShell 设置弹层编辑;各屏直接 import anaSettings 读(reactive 单例,改动即时联动)。
// 进分析层的屏之前路由守卫先 await loadAnaSettings():屏上不会先按默认值画一遍、再跳成库里的数。
// pvInvestment 单位:万元(pv-roi 投资额参数);breakevenFixedRatio 为固定成本占比系数(盈亏平衡拆分)。
import { reactive } from 'vue'
import { analysisApi } from '@/api/analysis'
import { useAuthStore } from '@/stores/auth'
import { lackText } from '@/composables/useViewGate'

export interface AnaSettings {
  occTarget: number            // 出租率目标(%)
  collectTarget: number        // 收缴率目标(%)
  churnTh: number              // 风险线(分;churn 流失预警 / anomaly 监控中心共用同款 40/30/30 评分模型)
  breakevenFixedRatio: number  // 固定成本占比系数(0~1)
  pvInvestment: number         // 光伏工程总投资(万元,含税);0 = 按各期工程成本合计(pv_phase.cost)
  spikeTh: number              // 能耗环比突变阈值(%;anomaly 监控中心红点/规则,v2 追加)
}

// 默认值(库里没存过的项用它):occ/collect/churn 承 ana-period DEFAULT_SETTINGS;fixedRatio 承 breakevenAt 0.62。
// ⚠ 后端 AnalysisSettingService.Key 有同一组数,只用来给改动记录写「改前」—— 改这里两边一起改。
// pvInvestment 默认 0 = 按各期工程成本合计(PvRoiView)。2026-10-04 用户拍板产品卖给别的园区:原来写死我园三期合计
// 1478.7 万,别的园区会按我们的投资额算回收;我园库里三期成本合计就是这个数,所以我园屏上不变。
export const ANA_SETTINGS_DEFAULT: AnaSettings = {
  occTarget: 90,
  collectTarget: 96,
  churnTh: 60,
  breakevenFixedRatio: 0.62,
  pvInvestment: 0,
  spikeTh: 40,   // 承规则引擎 ② ±40% 经验值
}

// 原来各人浏览器里的那份:不搬(拍板原话),删掉免得以后有人以为它还管用
try { localStorage.removeItem('fp-ana-settings') } catch { /* 拿不到 storage(隐私模式)就算了 */ }

export const anaSettings = reactive<AnaSettings>({ ...ANA_SETTINGS_DEFAULT })
/** 库里的那一份(最后一次取到 / 存成的)。盈亏平衡滑杆拖动时只改 anaSettings,松手存不上就退回这一份。 */
const saved: AnaSettings = { ...ANA_SETTINGS_DEFAULT }
let loading: Promise<void> | null = null

/** 取库里的一份。并发只发一次、取到了不再取;取不到这次按默认值,下次进分析屏再取。 */
export function loadAnaSettings(): Promise<void> {
  return (loading ??= analysisApi.settings()
    .then((s) => { Object.assign(saved, s); Object.assign(anaSettings, saved) })
    .catch(() => { loading = null }))
}

/** 存几项。成了换成库里回来的那一份;不成退回原来那一份,错误抛给调用方去说。 */
export async function saveAnaSettings(patch: Partial<AnaSettings>): Promise<void> {
  try { Object.assign(saved, await analysisApi.saveSettings(patch)) }
  finally { Object.assign(anaSettings, saved) }
}

export function resetAnaSettings(): Promise<void> {
  return saveAnaSettings({ ...ANA_SETTINGS_DEFAULT })
}

/** 改不了时的一句原因(设置弹层、盈亏平衡滑杆共用);能改返回 ''。store 用到时再取(同 useViewGate)。 */
export function anaSettingsLock(): string {
  return useAuthStore().can('report:edit') ? '' : `全园区共用这一份目标与阈值，${lackText(['report:edit'])}才能改`
}

/** 测试用:回到没取过库的样子 */
export function __resetAnaSettingsForTest(): void {
  loading = null
  Object.assign(saved, ANA_SETTINGS_DEFAULT)
  Object.assign(anaSettings, ANA_SETTINGS_DEFAULT)
}
