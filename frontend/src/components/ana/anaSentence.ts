/**
 * 一句话结论的七条模板(FORECAST-BAND-AND-PLAIN-SENTENCE §3.3/§3.4)。
 *
 * 三条规矩,写在这里免得每条函数各写一遍:
 *  ① 句子只负责读数,不负责解释画法。画法能自己说的,句子闭嘴。
 *  ② 能直接读出来的写事实;要过模型的写事实 + 样本量。样本量印不出来的,不许写百分比。
 *  ③ 该闭嘴时返回 null,**不是**返回「无异常」「暂无偏离」这类占位句 ——
 *    那等于用一句废话占住屏上最贵的一行。
 *
 * 为什么是七条不是稿里的六条:模板①「预测区间」的闭嘴出口写着「换频次句」,
 * 而六行里没有这条;又因为 §0/§2.1 判定月度外推一律不许写百分比,
 * 模板①对本项目**所有**月度序列都不可用,唯一出口恰好是这条没定义的模板。
 * 补为 sFreq(D4 待拍板)。sForecast 因此只在有真实样本外回测覆盖率时才出句。
 */

/** 全角逗号统一,金额千分位,与 anaFmt 的 fint 同形但不引它(避免 logic 层反向依赖)。 */
const money = (n: number): string => '¥' + Math.round(n).toLocaleString('en-US')
const pct1 = (n: number): string => n.toFixed(1).replace(/\.0$/, '') + '%'

/** ① 预测区间 —— ≤30 字。只在有样本外回测覆盖率时才出句;否则调用方改用 sFreq。 */
export function sForecast(a: {
  period: string; label: string; value: number; p: number; lo: number; hi: number; backtests: number
}): string | null {
  if (a.backtests < 5) return null
  return `${a.period}${a.label}预计 ${money(a.value)}，${pct1(a.p)} 落在 ${money(a.lo)} ~ ${money(a.hi)}`
}

/** ② 同类对标 —— ≤34 字。三档(D3):<20 只报样本量 / 20-99 不出百分数 / ≥100 才准写百分数。 */
export function sPeer(a: {
  name: string; value: number; pct: number; lo: number; hi: number; n: number
}): string {
  if (a.n < 20) return `${a.name} ${money(a.value)}，同类样本 ${a.n} 户，不给区间`
  if (a.n < 100) return `${a.name} ${money(a.value)}，高于同类中位数`
  // ⚠「中间一半」不是「80%」:带画的是 P25~P75。写 80% 就是把 50% 说成 80%。
  // 这一档量已经画在带的端点上(见任务说明「①量」槽),句子不重复,才压得进 34 字预算。
  return `${a.name}比 ${pct1(a.pct * 100)} 的同类高，中间一半在 ${money(a.lo)} ~ ${money(a.hi)}`
}

/** ③ 达成偏离 —— ≤22 字。偏离在阈值内 → 闭嘴。 */
export function sAchieve(a: {
  label: string; value: number; target: string; gapPct: number; th: number
}): string | null {
  if (Math.abs(a.gapPct) < a.th) return null
  return `${a.label} ${pct1(a.value)}，离${a.target} ${pct1(a.gapPct)}`
}

/** ④ 结构占比 —— ≤16 字。最大项 < 30% → 闭嘴。 */
export function sShare(a: { n: number; pct: number; maxPct: number }): string | null {
  if (a.maxPct < 30) return null
  return `前 ${a.n} 项占 ${pct1(a.pct)}`
}

/** ⑤ 风险 —— ≤24 字。无命中 → 闭嘴,且**不许**写「无异常」。 */
export function sRisk(a: { n: number; amount: number; k: number; pct: number }): string | null {
  if (!a.n) return null
  return `${a.n} 户欠 ${money(a.amount)}，前 ${a.k} 户占 ${pct1(a.pct)}`
}

/** ⑥ 数据不足 —— ≤20 字。**永不省略**。 */
export function sThin(a: { label: string; n: number; cannot: string }): string {
  return `${a.label}只有 ${a.n} 期，${a.cannot}`
}

/** ⑦ 频次句(D4) —— ≤30 字。回测 < 5 次 → 闭嘴,不画带只出点。**不写百分比**。 */
export function sFreq(a: {
  label: string; lo: number; hi: number; backtests: number; hits: number
}): string | null {
  if (a.backtests < 5) return null
  return `${a.label}拟合区间 ${a.lo}~${a.hi}，过去 ${a.backtests} 次中 ${a.hits} 次`
}
