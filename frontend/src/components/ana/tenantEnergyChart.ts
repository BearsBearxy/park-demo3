// 单户两张图：异常提醒中心「{户} · 电费和水费」「{户} · 应收和实收」，用能与缴费按年选中户的大图和右栏共用这一份
// （规范 S-08：本职要看的图原样复用 —— 同一份数据、同一套参照、同一套句子，不许两屏各画一个版本）。
// 画布改稿 cockpit-v2/tenantEnergyChart.mjs 的移植：option 交给 AnaEChart 画，气泡走 calloutMark（AnaEChart 叠层摆放）。
// 宽是参数；窄了只做一件事：横轴月份从末格往前隔几格标一次（S-34），图例、轴、句子一字不改。
import * as S from './anaSentence'
import { anaPalette, bandSeries, calloutMark } from './anaTheme'

const textW = (t: string) => [...t].reduce((a, ch) => a + (/[一-鿿]/.test(ch) ? 11 : 6.7), 0)   // ponytail: 估字宽，11 号中文 11px、数字约 6.7px
const GRID = { left: 64, right: 56, top: 34, bottom: 26 }

// 横轴隔 step 格标一次：相邻两个露出的标签中心距 ≥ 两者半宽之和 + 6；露出的第一个标签和跨年后第一个露出的标签带年份。
// 从末格（本期，读数句常说的那个月）往前数 step 格标一次：末格一定有字，步长恒定（S-35）
// step0：从几格起试（应收实收图传「每 56px 至多一个字」的格数）
export function axisLabels(xs: string[], plotW: number, step0 = 1): { labels: string[]; interval: number | ((i: number) => boolean) } {
  const cell = plotW / xs.length, last = xs.length - 1
  const lab = (on: number[]) => xs.map((ym, i) => {
    const prev = on.filter((j) => j < i)
    const p = prev.length ? prev[prev.length - 1] : null
    return S.axisYm(ym, on.includes(i) && (p == null || ym.slice(0, 4) !== xs[p].slice(0, 4)) ? 0 : i)
  })
  for (let step = step0; ; step++) {
    const on = xs.map((_, i) => i).filter((i) => (last - i) % step === 0), ws = lab(on).map(textW)
    if (step < xs.length && !on.every((i, k) => k === 0 || (ws[i] + ws[on[k - 1]]) / 2 + 6 <= (i - on[k - 1]) * cell)) continue
    return { labels: lab(on), interval: step === 1 ? 0 : (i: number) => on.includes(i) }
  }
}

// ECharts 数值轴默认的上沿（splitNumber 5、取整到「好看的数」）：灰带太矮的判据要跟图上真的轴比
// ponytail: 照 echarts numberUtil.nice + intervalScale 的取整抄的近似，只给 10% 判据用，不拿去画图
function niceMax(max: number): number {
  if (!(max > 0)) return 0
  const raw = max / 5, e = Math.floor(Math.log10(raw)), f = raw / 10 ** e
  const nf = f < 1.5 ? 1 : f < 2.5 ? 2 : f < 4 ? 3 : f < 7 ? 5 : 10
  const step = nf * 10 ** e
  return Math.ceil(max / step) * step
}

export interface EnergySpike { series: 'elec' | 'water'; ym: string; cur: number; chg?: number }
export interface BandByYm { [ym: string]: { p25: number; p75: number } | undefined }

// xs：横轴连续月份；months/elec/water：这户有数的月和值（同序）；spikes：monitor.logic.detectSpikes 出的突变（换成月份）；
// pick：读数句点到的那次突变（S.jump 的 pick，没有给 null）；markText：气泡字；band：{ ym: { p25, p75 } }；width：图宽（像素）
export function tenantEnergyOption(a: {
  xs: string[]; months: string[]; elec: number[]; water: number[]; spikes: EnergySpike[]
  pick?: (S.Spike & { series: 'elec' | 'water' }) | null; markText?: string; band: BandByYm; width: number
}): { option: object; bandRef: string | null } {
  const { xs, months, elec, water, spikes, pick = null, markText = '', band, width } = a
  const p = anaPalette()
  const deep = p.cat[5], mid = p.cat[0]
  const at = (arr: number[]) => xs.map((ym) => { const i = months.indexOf(ym); return i < 0 ? null : Math.round(arr[i]) })
  const isPick = (s: EnergySpike) => !!pick && s.ym === pick.ym && s.series === pick.series
  const rings = (series: 'elec' | 'water') => spikes.filter((s) => s.series === series && !isPick(s) && xs.includes(s.ym))
    .map((s) => ({ coord: [xs.indexOf(s.ym), Math.round(s.cur)], symbolSize: 9, itemStyle: { color: p.calloutCore, borderColor: series === 'elec' ? deep : mid, borderWidth: 2 } }))
  const mark = (series: 'elec' | 'water') => {
    const base = { silent: true, symbol: 'circle', label: { show: false }, data: rings(series) as object[] }
    if (pick && pick.series === series && xs.includes(pick.ym)) {
      const cm = calloutMark(deep, series === 'elec' ? deep : mid, [{ coord: [xs.indexOf(pick.ym), Math.round(pick.cur)], lines: [markText] }], pick.chg > 0 ? 'top' : 'bottom') as { data: object[] }
      base.data = [...base.data, ...cm.data]   // 涨放上、跌放下，避开进来的那段线
    }
    return base
  }
  const lo = xs.map((ym) => (band[ym] ? Math.round(band[ym]!.p25) : null))
  const hi = xs.map((ym) => (band[ym] ? Math.round(band[ym]!.p25) + Math.round(band[ym]!.p75 - band[ym]!.p25) : null))
  const { labels, interval } = axisLabels(xs, width - GRID.left - GRID.right)
  const E = S.TE.metric.elec
  const option = {
    legend: { top: 0, data: [E, S.MON.waterAxis, S.MON.bandLegend] },
    grid: GRID,
    tooltip: { trigger: 'axis', valueFormatter: (v: unknown) => (typeof v === 'number' ? S.yi(v) : '–') },
    xAxis: { type: 'category', data: labels, axisLabel: { interval } },
    yAxis: [{ type: 'value', axisLabel: { formatter: (v: number) => S.yi(v) } }, { type: 'value', splitLine: { show: false }, axisLabel: { formatter: (v: number) => S.yi(v) } }],   // 水费小两个数量级，放右轴才看得出起伏
    series: [
      ...bandSeries(lo, hi, { name: S.MON.bandLegend, color: p.band, series: { z: 1, itemStyle: { color: 'rgba(28,28,28,.18)' } } }),
      { name: E, type: 'line', symbol: 'circle', symbolSize: 5, itemStyle: { color: deep }, lineStyle: { width: 2, color: deep }, data: at(elec), z: 3, markPoint: mark('elec') },
      { name: S.MON.waterAxis, yAxisIndex: 1, type: 'line', symbol: 'circle', symbolSize: 5, itemStyle: { color: mid }, lineStyle: { width: 2, color: mid, type: 'dashed' }, data: at(water), z: 3, markPoint: mark('water') },
    ],
  }
  // 灰带太矮：图上各月带的上沿（p75）最高的那个都不到左轴最大值的 10% —— 大户的左轴把带压成贴着 ¥0 的细条，看不出全园一般在哪。
  // 这时在参照位写出范围：下限 = 图上各月 p25 最低的那个，上限 = 图上各月 p75 最高的那个。带不矮不出句
  const tops = hi.filter((v): v is number => v != null)
  const yMax = niceMax(Math.max(0, ...at(elec).filter((v): v is number => v != null), ...tops))
  const bandRef = tops.length && Math.max(...tops) < yMax * 0.1 ? S.bandSpan(Math.min(...lo.filter((v): v is number => v != null)), Math.max(...tops)) : null
  return { option, bandRef }
}

// 这张图的读数句和参照，两屏同一套（S-08）：电费、水费两个系列的突变挑最大那次（S.jump），没有突变才退回最后一个有数的月的电费在全园的位置（S.band）；
// 图上有空月就在参照位写这户缺了哪几个月。raw = monitor.logic.detectSpikes 出的 [{ series, idx, chg }]（idx 按 months）
// tableMonths：整张销售收入表有数的月 —— 给了就把缺月分成「整张表没有」和「这户另缺」两种说（te2-ask 14）；不给按 own 整句说
// crossedOnlyPick：「隔着比」只看读数句点到的那次
export function tenantEnergyReads(a: {
  xs: string[]; months: string[]; elec: number[]; water: number[]; raw: { series: 'elec' | 'water'; idx: number; chg: number }[]
  band: BandByYm; table: string; own?: boolean; crossedOnlyPick?: boolean; tableMonths?: Iterable<string>
}) {
  const { xs, months, elec, water, raw, band, table, own = true, crossedOnlyPick = false } = a
  const spikes = raw.map((s) => {
    const arr = s.series === 'elec' ? elec : water
    return { what: S.TE.metric[s.series], series: s.series, ym: months[s.idx], prevYm: months[s.idx - 1], cur: arr[s.idx], chg: s.chg }
  })
  const lastYm = months[months.length - 1]
  const read = elec.every((v) => v === 0) && water.every((v) => v === 0) ? S.thin({ allZero: `${S.TE.metric.elec}、${S.TE.metric.water}`, n: months.length })
    : S.jump({ spikes }) || S.band({ ym: lastYm, value: elec[elec.length - 1], band: band[lastYm] })
  const pk = read && read.type === 'jump' ? (read as ReturnType<typeof S.jump> & object).pick as (typeof spikes)[number] : null
  const crossed = (crossedOnlyPick ? (pk ? [pk] : []) : spikes).some((s) => S.nextYm(s.prevYm) !== s.ym)
  const gaps = S.gapsText(months, xs[0], xs[xs.length - 1])
  const nIn = months.filter((m) => m >= xs[0] && m <= xs[xs.length - 1]).length
  return { spikes, read, pick: pk, ref: gaps ? S.thin({ ...splitGaps(xs, months, a.tableMonths, gaps, own), nGap: xs.length - nIn, table, crossed }) : null }
}

// 缺月分两种：整张表都没有的月（gaps）和表里别的户有数、只有这户缺的月（ownGaps）。不给表的月 → 按 own 整句说
export function splitGaps(xs: string[], have: string[], tableMonths: Iterable<string> | undefined, all: string, own: boolean): { gaps?: string; ownGaps?: string; own?: boolean } {
  if (!tableMonths) return { gaps: all, own }
  const tbl = new Set(tableMonths), mine = new Set(have), from = xs[0], to = xs[xs.length - 1]
  const tableGaps = S.gapsText(xs.filter((ym) => tbl.has(ym)), from, to)
  const ownGaps = S.gapsText(xs.filter((ym) => !tbl.has(ym) || mine.has(ym)), from, to)
  return { gaps: tableGaps || undefined, ownGaps: ownGaps || undefined }
}

// 单户应收和实收图。rows：这户的台账行 [{ ym, co, recv, coll }]，几家公司相加；横轴连续月份、缺期留空。读数句 collect（最后一期收齐时闭嘴，图照画）；
// 参照：台账缺了哪几期（thin），allFees 时再加「台账含租金」（用能与缴费：KPI 收缴率、期末欠费也是台账的数，同屏要交代一次）。
// end：台账期末结余（同一行），最后一期收齐但期末仍欠时读数句照说（collect 的 balEnd）
// tableYms：整张台账有数的月。给了就只在「这户缺的月里有台账别的户有数的月」时写「这户」（te2-ask 14，同电费水费图）；
// 整张台账都没有的月不算这户缺。不给 = 一律写「这户」（旧行为）
export function tenantLedger(a: { rows: { ym: string; co: string; recv: number; coll: number; end?: number }[]; width: number; allFees?: boolean; tableYms?: Iterable<string> }) {
  const { rows, width, allFees = false } = a
  const p = anaPalette()
  const byYm = new Map<string, { ym: string; recv: number; coll: number; end: number }>(), cos = new Set<string>()
  for (const r of rows) { const x = byYm.get(r.ym) ?? { ym: r.ym, recv: 0, coll: 0, end: 0 }; x.recv += r.recv; x.coll += r.coll; x.end += r.end ?? 0; byYm.set(r.ym, x); cos.add(r.co) }
  const periods = [...byYm.values()].sort((x, y) => x.ym.localeCompare(y.ym))
  const lx: string[] = []
  if (periods.length) for (let m = periods[0].ym; m <= periods[periods.length - 1].ym; m = S.nextYm(m)) lx.push(m)
  const tbl = S.MON.tbl.ledger
  const read = periods.length ? S.collect({ periods, balEnd: periods[periods.length - 1].end }) : S.thin({ noRows: tbl })
  // S-45：读数句点到的月（collect 只点最后一期）两根柱标数；字往右伸进右边留白，不压前几个月的柱
  const lMark = read && periods.length && read.text.startsWith(S.ymMonth(periods[periods.length - 1].ym)) ? lx.length - 1 : -1
  // 两根柱宽（ECharts 默认类目间隔 20%、两柱缝 10%，封顶 26）：右边的实收柱比应收高时，应收的标数从柱顶往右伸会压住实收柱，
  // 这时把它挪到实收柱右边、同一高度（S-21 字不压数据；2026-10 罗立剑 10月 实收 > 应收 实测压住）
  const barW = (pw: number) => Math.min(26, ((pw / lx.length) * 0.8) / 2.1)
  const lastV = lMark >= 0 ? byYm.get(lx[lx.length - 1])! : null
  const recvAside = !!lastV && lastV.coll > lastV.recv
  const lv = (key: 'recv' | 'coll', bw: number) => lx.map((ym, i) => {
    const v = byYm.has(ym) ? Math.round(byYm.get(ym)![key]) : null
    if (i !== lMark) return v
    const pos = key === 'recv' && recvAside ? { position: [Math.round(2.1 * bw + 4), 0], verticalAlign: 'middle' } : { position: 'top', distance: 4 }
    return { value: v, label: { show: true, ...pos, align: 'left', color: p.legend, fontSize: 11, formatter: (q: { value: number }) => S.yi(q.value) } }   // 柱端数据标签（槽位 7），不是气泡
  })
  // 柱端标数往右伸，窄卡里百万级的数会伸出图外被截：右留白放宽到放得下为止（末格柱心按格心 + 1/4 格算，ponytail: 估的柱位）
  let gr = 56
  if (lastV) {
    const lw = Math.max(...(['recv', 'coll'] as const).map((k) => textW(S.yi(Math.round(lastV[k])))))
    for (; gr < width; gr++) {
      const pw = width - 64 - gr, cell = pw / lx.length, bw = barW(pw)
      const aside = recvAside ? 64 + pw - cell / 2 + 1.05 * bw + 4 + textW(S.yi(Math.round(lastV.recv))) : 0   // 挪到实收柱右边那个标数的右沿
      if (64 + pw - cell / 4 + lw <= width - 2 && aside <= width - 2) break
    }
  }
  // S-34：每 56px 绘图宽至多一个月份字起试（ponytail: 估的字距），再按字宽量放不放得下
  const plotW = width - 64 - gr
  const { labels, interval } = lx.length ? axisLabels(lx, plotW, Math.max(1, Math.ceil(lx.length / (Math.floor(plotW / 56) + 1)))) : { labels: [], interval: 0 }
  const option = periods.length ? {
    legend: { top: 0, data: ['应收', '实收'] },
    grid: { left: 64, right: gr, top: 30, bottom: 24 },
    tooltip: { trigger: 'axis', valueFormatter: (v: unknown) => (typeof v === 'number' ? S.yi(v) : '–') },
    xAxis: { type: 'category', data: labels, axisLabel: { interval } },
    yAxis: { type: 'value', axisLabel: { formatter: (v: number) => S.yi(v) } },   // 和卡头「元」、电费图同一写法
    series: [
      { name: '应收', type: 'bar', barMaxWidth: 26, barGap: '10%', itemStyle: { color: p.cat[7] }, data: lv('recv', barW(plotW)) },
      { name: '实收', type: 'bar', barMaxWidth: 26, itemStyle: { color: p.cat[0] }, data: lv('coll', barW(plotW)) },
    ],
  } : null
  const gaps = lx.length ? S.gapsText(periods.map((x) => x.ym), lx[0], lx[lx.length - 1]) : ''
  const refs = [gaps ? S.thin({ ...splitGaps(lx, periods.map((x) => x.ym), a.tableYms, gaps, true), nGap: lx.length - periods.length, table: tbl }).text : null,
    allFees ? S.teLedgerAll : null].filter((x): x is string => !!x)   // 台账一期都没有也说：同屏 KPI 收缴率、期末欠费还是台账的数
  const hint = S.hint(periods.length ? S.coverN(periods.length, '期', tbl) : '', S.coLedger(cos.size), '元')
  return { periods, lx, read, refs, hint, option, cos: cos.size }
}
