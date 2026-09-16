// fin-balance v2 纯函数(spec §二.8):资产/负债双环 + 比率仪表(gauge ≤2,勿仪表盘泛滥)。
// option 为纯 JSON(canvas 无法用 CSS 变量 → fpAnaTheme 字面色板)。单测 finBalance.logic.spec.ts。
import { FP_ANA_THEME } from '@/components/ana/anaTheme'
import { fint } from '@/components/ana/anaFmt'

export interface DonutSlice { label: string; value: number }

// 环图色板 = fpAnaTheme 主题色(HTML 图例与 canvas 同源取色)
export const DONUT_PAL: string[] = FP_ANA_THEME.color
export const sliceColor = (i: number): string => DONUT_PAL[i % DONUT_PAL.length]

/** 双环之一:donut option(中心值文本 + 白描边;金额 元,tooltip 折万)。 */
export function donutOption(slices: DonutSlice[], centerValue: string, centerLabel: string): object {
  return {
    tooltip: {
      trigger: 'item',
      formatter: (p: { name: string; value: number; percent: number }) =>
        `${p.name}<br/>¥${fint(p.value / 1e4)}万 · ${p.percent}%`,
    },
    title: {
      text: centerValue, subtext: centerLabel, left: 'center', top: '38%',
      textStyle: { fontSize: 20, fontWeight: 600, color: 'rgba(28,28,28,.92)' },
      subtextStyle: { fontSize: 11, color: 'rgba(28,28,28,.62)' },
      itemGap: 2,
    },
    series: [{
      type: 'pie', radius: ['60%', '84%'], center: ['50%', '50%'],
      label: { show: false }, labelLine: { show: false },
      itemStyle: { borderRadius: 6, borderColor: '#fff', borderWidth: 1.5 },
      data: slices.map((s, i) => ({ name: s.label, value: s.value, itemStyle: { color: sliceColor(i) } })),
    }],
  }
}

// gauge 语义色(与屏内 RatioArc tone 同口径:好=蓝/关注=橙/风险=红)
const TONE = { good: '#378ADD', warn: '#EF9F27', risk: '#E24B4A' } as const
// 负数出现在总资产或总负债为负的期间(录错或科目缺行),不是「负债很低」,不给好色。
export function debtTone(debtRatio: number): keyof typeof TONE {
  if (debtRatio < 0) return 'risk'
  return debtRatio < 60 ? 'good' : debtRatio < 85 ? 'warn' : 'risk'
}
export function currentTone(current: number): keyof typeof TONE {
  return current >= 1 ? 'good' : 'warn'
}

/**
 * 比率仪表 option:资产负债率(0~100%)+ 流动比率(0~2),单 canvas 双 gauge(spec ≤2 个)。
 * 超出量程(资不抵债 → 负债率 >100 或为负)时环会被引擎夹住画满(progress.clip 默认 true,
 * GaugeView.js:374),只有中间的数字是真值。此时把轨道染成同一档语义色的浅底、并露出 0 / 量程上限
 * 两个刻度 —— 让「画满」读得出是超出量程,而不是正好 100%。量程本身不跟着数据走,公司之间才可比。
 */
export function gaugesOption(debtRatio: number, current: number | null): object {
  const mk = (center: [string, string], value: number, max: number, name: string, fmt: string, color: string): object => {
    const over = value > max || value < 0
    return {
      type: 'gauge', center, radius: '82%', startAngle: 210, endAngle: -30,
      min: 0, max, splitNumber: over ? 1 : 4,
      progress: { show: true, width: 10, itemStyle: { color } },
      axisLine: { lineStyle: { width: 10, color: [[1, over ? color + '26' : 'rgba(28,28,28,.08)']] } },
      pointer: { show: false }, axisTick: { show: false }, splitLine: { show: false },
      axisLabel: over ? { show: true, distance: -1, fontSize: 10, color: 'rgba(28,28,28,.4)' } : { show: false },
      title: { offsetCenter: [0, '32%'], fontSize: 11.5, color: 'rgba(28,28,28,.62)' },
      detail: {
        offsetCenter: [0, 0], fontSize: 21, fontWeight: 600, color: 'rgba(28,28,28,.92)',
        formatter: fmt,
      },
      data: [{ value, name }],
    }
  }
  const series: object[] = [
    mk(current == null ? ['50%', '55%'] : ['26%', '55%'], +debtRatio.toFixed(1), 100, '资产负债率', '{value}%', TONE[debtTone(debtRatio)]),
  ]
  if (current != null) {
    series.push(mk(['74%', '55%'], +current.toFixed(2), 2, '流动比率', '{value}', TONE[currentTone(current)]))
  }
  return { series }
}
