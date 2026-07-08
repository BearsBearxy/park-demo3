// src/analysis/anaSettings.ts — 分析层目标与阈值(spec:localStorage 'fp-ana-settings',不落库)。
// AnaShell 设置弹层编辑;各屏直接 import anaSettings 读(reactive 单例,改动即时联动)。
// pvInvestment 单位:万元(pv-roi 投资额参数);breakevenFixedRatio 为固定成本占比系数(盈亏平衡拆分)。
import { reactive } from 'vue'

export interface AnaSettings {
  occTarget: number            // 出租率目标(%)
  collectTarget: number        // 收缴率目标(%)
  churnTh: number              // 风险线(分;churn 流失预警 / anomaly 监控中心共用同款 40/30/30 评分模型)
  breakevenFixedRatio: number  // 固定成本占比系数(0~1)
  pvInvestment: number         // 光伏工程总投资(万元,含税)
  spikeTh: number              // 能耗环比突变阈值(%;anomaly 监控中心红点/规则,v2 追加)
}

// 默认值:occ/collect/churn 承 ana-period DEFAULT_SETTINGS;fixedRatio 承 breakevenAt 0.62;
// pvInvestment 承 schedule6 三期工程成本合计 ≈ 1478.7 万。
export const ANA_SETTINGS_DEFAULT: AnaSettings = {
  occTarget: 90,
  collectTarget: 96,
  churnTh: 60,
  breakevenFixedRatio: 0.62,
  pvInvestment: 1478.7,
  spikeTh: 40,   // 承规则引擎 ② ±40% 经验值
}

const LS_KEY = 'fp-ana-settings'

function load(): AnaSettings {
  try {
    const s = JSON.parse(localStorage.getItem(LS_KEY) || 'null')
    if (s && typeof s === 'object') return { ...ANA_SETTINGS_DEFAULT, ...s }
  } catch { /* 损坏则回默认 */ }
  return { ...ANA_SETTINGS_DEFAULT }
}

export const anaSettings = reactive<AnaSettings>(load())

export function saveAnaSettings(patch: Partial<AnaSettings>): void {
  Object.assign(anaSettings, patch)
  try { localStorage.setItem(LS_KEY, JSON.stringify(anaSettings)) } catch { /* noop */ }
}

export function resetAnaSettings(): void {
  saveAnaSettings({ ...ANA_SETTINGS_DEFAULT })
}
