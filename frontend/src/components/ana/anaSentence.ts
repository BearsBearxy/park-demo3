// 句型库：分析屏上每一句常显的字都从这里出（2026-10 改稿五屏：驾驶舱、异常提醒中心、出租与楼栋、园区能耗、用能与缴费）。
// 纯函数，不 import 别的模块（画布出稿脚本用 node 直接跑这个文件，逐字对过画板）。
// 一个句型 = 固定计算 + 中文模板（方向词按正负选两版）+ 挑哪项的明文规则 + 不出句条件。
// 句型函数返回 { text, type } 或 null（闭嘴）。园区级金额「¥X.X万」一位小数（户级整元见 yi），负号用「−」。
// 读数句、参照、标签里的钱都带 ¥；只有「A→B」成对比较（movers，卡头单位是万元）写裸数。（用户 2026-10-05 按推荐定，规范 S-31）
// 字数一律按 vlen = 去掉空白后的码点数（读数句 30、参照 28、卡头说明 24、KPI 副行 16）。（用户 2026-10-05 按推荐定，规范 S-12/S-24/S-25）
// 超长：开发和测试里直接抛错（写句子的人当场知道）；线上照出原句，不让一张卡因为一个长户名整张挂掉。

export const LIMIT = { read: 30, ref: 28, hint: 24, kpiNote: 16 }
export const vlen = (s: unknown): number => [...String(s).replace(/\s+/g, '')].length
export const rawLen = (s: unknown): number => [...String(s)].length

export type TypeKey =
  | 'movers' | 'goal' | 'share' | 'growth' | 'ptd' | 'extremes' | 'forecast' | 'backtest' | 'count' | 'thin'
  | 'arrears' | 'jump' | 'band' | 'concentration' | 'overlap' | 'baseline' | 'collect' | 'floorRun' | 'gap'
export interface Said { text: string; type: TypeKey }

const PROD = !!(import.meta as { env?: { PROD?: boolean } }).env?.PROD
function tooLong(msg: string): void {
  if (!PROD) throw new Error(msg)
}

// ── 数的写法 ──
const MINUS = '−'
const abs1 = (v: number) => Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
export const num = (v: number) => (v < 0 && abs1(v) !== '0.0' ? MINUS : '') + abs1(v)            // 638.8 / −341.3
export const wan = (v: number) => num(v) + '万'                                                  // 金额（万）
export const yuan = (v: number) => (v < 0 && abs1(v) !== '0.0' ? MINUS : '') + '¥' + abs1(v) + '万' // ¥ 金额
export const signed = (v: number) => (v >= 0 ? '+' : MINUS) + abs1(v)                             // +17.4 / −1,004.4
export const yuanSpan = (lo: number, hi: number) => (lo < 0 && abs1(lo) !== '0.0' ? MINUS : '') + '¥' + abs1(lo) + '~' + num(hi) + '万'   // ¥918.6~997.4万：只第一个数带 ¥
export const axisWan = (v: number) => (v < 0 ? MINUS : '') + Math.abs(v).toLocaleString('en-US') + '万'   // 轴字：−150万（ECharts 默认出短横）
const pct1 = (v: number) => (v < 0 ? MINUS : '') + Math.abs(v).toFixed(1)

export const TYPES: Record<TypeKey, { name: string; template: string; pick: string; silent: string; max: number }> = {
  movers: { name: '变动最大', template: '{名} {上期}→{本期}；其余 {n} 项 {Σ上}→{Σ本}｜放不下 30 字时只写前半句｜给了量词时「其余 n 户」', pick: '|本期−上期| 最大的一项；数单位见卡头（万元）',
    silent: '最大变动 < 上期合计绝对值的 5%；上期整体没数 → 改出「数据不足」', max: LIMIT.read },
  goal: { name: '达标', template: '{N}{量词}里 {M}{量词}到了目标，最低是 {名} {值}', pick: '值最低的一项',
    silent: '全部到目标', max: LIMIT.read },
  share: { name: '占比变化', template: '{名}占{总} {本期} b%，比{前期}{高/低} Δ 个点', pick: '本期占比最大的一项',
    silent: '|Δ| < 1 个点', max: LIMIT.read },
  growth: { name: '增长', template: '{首期}→{末期} {指标}{增长/下降} N%', pick: '首尾两期，中间不挑',
    silent: '首期 ≤ 0（比例没有意义）', max: LIMIT.read },
  ptd: { name: '累计对目标', template: '{末期}累计 ¥{值}，到{目标名}的 p%｜最后一期让累计变小时：{末期}累计到{目标名}的 p%；比{上期}底少 ¥{x}｜p% 已在 KPI 瓦上（noPct）时去掉「到…的 p%」',
    pick: '最后一个有数的期', silent: '不闭嘴（目标 ≤ 0 时闭嘴）', max: LIMIT.read },
  extremes: { name: '最高最低', template: '{指标}最高 {期} ¥{值}，最低 {期} ¥{值}（fmt 可换，如单价 0.949元）｜并列超过 2 项且给了量词：最低 n 户 0.0%', pick: '全部期，不排除任何一期',
    silent: '少于 2 期', max: LIMIT.read },
  forecast: { name: '预测', template: '{目标月}实际 ¥{值}，{高于/低于/落在}预计 ¥{下}~{上}万｜只出点时：{目标月}实际 ¥{值}，{高于/低于}预计 ¥{中值}｜还没实际时：{目标月}预计 ¥{下}~{上}万｜实际值已在 KPI 瓦上（actualShown）时去掉「¥{值}」',
    pick: '选中 M 月时目标月 = M+1（M=12 时改为 M，用 1..M−1 月算）', silent: '目标月之前不到 3 个月有数 → 改出「数据不足」', max: LIMIT.read },
  backtest: { name: '预测·回测参照', template: '最近 N 次（a–b月）中 k 次落在区间里', pick: '不晚于 M 的最近 6 站（站 v = 用 1..v 月算 v+1 月，训练 ≥3 个月）',
    silent: 'N < 5 → 改出「数据不足」（不画区间只出点）', max: LIMIT.ref },
  count: { name: '计数', template: '{M}月共触发 {n} 条规则', pick: '该月全部规则命中', silent: 'n = 0（正常不出句）', max: LIMIT.ref },
  thin: { name: '数据不足', template: '{名}只有 {n} 期，{做不了什么}｜{表}没有{上期}，做不了和{上期}比｜只验过 N 次，不画区间｜{M}没有台账，收缴率、应收为负两类规则没跑'
    + '｜{表}里没有{缺的月}[，前后两期隔着比]（放不下 28 字先去掉尾巴，再放不下改「{表}里有 n 个月没有这户」）｜{量} n 个月都是 0｜{表}没有这户'
    + '｜有 n 栋没建单元，算不了这几栋的出租率｜只有 n 栋录了{字段}，算不了{指标}'
    + '｜{名}有 n 个单元租出，没有这栋的在租合同（k > 1 栋时：k 栋有单元租出，却没有这栋的在租合同）｜n 份没写到期日，都按在租算'
    + '｜{选中户}等 n 户在租户表里查不到在租月租，不在图上（选中户在图上或放不下时不写名）', pick: '缺的月按这一户自己有数的月算，不按全园',
    silent: '永不省略', max: LIMIT.read },
  // ── 异常提醒中心 ──
  arrears: { name: '未收集中', template: '{月}未收的 p% 在{名}｜k > 1 时：{月}未收的 p% 在未收最多的 k 户｜只有 1 户：{名} {月}未收 {x}',
    pick: '未收 = 该月台账应收 − 实收（不是期末结余）；k = 从多到少累加、刚过一半的户数', silent: 'N = 0（没人未收不出句）', max: LIMIT.read },
  jump: { name: '突变', template: '{量} {本月} {值}，比{上月} ±x%｜超阈值不止一次时句尾加：；共 n 次',
    pick: '|变动| 最大的一次（同幅取最近）；只比相邻自然月，前一个月没数就不比（2026-10-05 用户按推荐定），缺的月写在参照', silent: '没有超过突变阈值的变动 → 改出「区间位置」', max: LIMIT.read },
  band: { name: '区间位置', template: '{月}{电费/水费} {值}，{高于/低于}全园中间一半的户｜给了中位数且高于中间一半时：{月}电费 {值}，是全园中位数的 x 倍', pick: '这户最后一个有电费的月',
    silent: '落在中间一半里（正常不出句）；该月全园有电费的不足 20 户', max: LIMIT.read },
  // ── 出租与楼栋 ──
  concentration: { name: '集中度', template: '{量}的 p% 在{名1}[、{名2}]｜k > 2 或放不下时：{量}的 p% 在{按}最多的 k {量词}',
    pick: '从大到小累加、刚过一半的 k 项（同未收集中）；值为 0 的项不进累加', silent: '值大于 0 的不足 2 项', max: LIMIT.read },
  overlap: { name: '重叠计数', template: '{n} {量词}{什么}，叠在{哪}', pick: '图上落在同一点的项', silent: 'n < 2（一个点不叫叠）', max: LIMIT.ref },
  baseline: { name: '对约定值', template: '{N} {量词}里 {M} {量词}不是 {约定}，{名} {值}', pick: '离约定值最远的一项',
    silent: '每项按显示位数都等于约定值（正常不出句）', max: LIMIT.read },
  collect: { name: '实收', template: '{末期}应收 {a}，实收 {b}｜每期实收都是 0：{n} 期台账实收都是 ¥0，应收合计 {a}｜最后一期实收不少于应收但期末仍欠：{末期}实收不少于应收，期末仍欠 {x}',
    pick: '这户最后一期台账（几家公司相加）', silent: '最后一期收齐（实收 ≥ 应收）且期末不欠', max: LIMIT.read },
  floorRun: { name: '楼层集中', template: '{类}的 {N} 个里 {M} 个在 {楼层}｜楼层一层写「4F」，两层写「3F、4F」，三层及以上写「1F–3F」',
    pick: '装得下过半（M > N/2）的最短连续楼层段（没建单元的层按 0 个算，不跳过）；同长取 M 大的，再同取低的', silent: 'N < 2；最短段就是整栋全部楼层（单层楼一定闭嘴）', max: LIMIT.read },
  // ── 园区能耗 ──
  gap: { name: '差额', template: '{A}比{B}{多/少} {差}｜上期两项都有数时句尾加：；{上期}{多/少} {上期差}', pick: '本期 A − B；上期同算',
    silent: 'A 或 B 本期没数 → 改出「数据不足」', max: LIMIT.read },
}

const out = (type: TypeKey, text: string): Said => {
  const { max } = TYPES[type], n = vlen(text)
  if (n > max) tooLong(`句子超长(${type} ${n}>${max})：${text}`)
  return { text, type }
}

// 数据不足 —— 永不省略
export interface ThinArgs {
  noLedger?: string; prevLabel?: string; table?: string; tested?: number
  gaps?: string; ownGaps?: string; crossed?: boolean; own?: boolean; nGap?: number
  allZero?: string; n?: number; noRows?: string
  noUnit?: number; bldNoUnit?: boolean; few?: number; field?: string; cant?: string
  cross?: { name: string; n: number }[]; noEnd?: number
  shown?: string; noMonth?: string; noPast?: string; what?: string; onlySome?: string; span?: string
  noRent?: number; sel?: string; name?: string
}
export function thin(v: ThinArgs): Said {
  if (v.noLedger) return out('thin', `${v.noLedger}没有台账，收缴率、应收为负两类规则没跑`)
  if (v.prevLabel) return out('thin', `${v.table}没有${v.prevLabel}，做不了和${v.prevLabel}比`)
  if (v.tested != null) return out('thin', `只验过 ${v.tested} 次，不画区间`)
  // 缺月句放在参照位，按 28 字：先去掉「隔着比」，再放不下就只写缺几个月
  // gaps = 整张表都没有的月；ownGaps = 表里别的户有数、只有这户缺的月（te2-ask 14：只有这户独缺才写「这户」，两种都有时分开说）
  if (v.gaps && v.ownGaps) {
    const t = [`${v.table}里没有${v.gaps}，这户另缺${v.ownGaps}`, `${v.table}里有 ${v.nGap} 个月没有这户`].find((x) => vlen(x) <= LIMIT.ref)
    return out('thin', t ?? `${v.table}里有 ${v.nGap} 个月没有这户`)
  }
  if (v.gaps || v.ownGaps) {
    const tail = v.crossed ? '，前后两期隔着比' : ''
    const g = v.ownGaps ?? v.gaps
    const who = v.ownGaps || v.own ? '这户' : ''   // own：旧调用方不分两种缺月时，整句按这户说
    const t = [`${v.table}里${who}没有${g}${tail}`, `${v.table}里${who}没有${g}`, `${v.table}里有 ${v.nGap} 个月没有这户${tail}`].find((x) => vlen(x) <= LIMIT.ref)
    return out('thin', t ?? `${v.table}里有 ${v.nGap} 个月没有这户`)
  }
  if (v.allZero) return out('thin', `${v.allZero} ${v.n} 个月都是 0`)
  if (v.noRows) return out('thin', `${v.noRows}没有这户`)
  if (v.noUnit) return out('thin', `有 ${v.noUnit} 栋没建单元，算不了这几栋的出租率`)
  if (v.bldNoUnit) return out('thin', '这栋没建单元')   // 点进的那一栋一个单元都没建：楼层读数句出不了
  if (v.few != null) return out('thin', `只有 ${v.few} 栋录了${v.field}，算不了${v.cant}`)
  // cross：单元租出了、这栋却没有以它为主楼的在租合同（单元挂在别栋合同的附加单元上）
  // 只写量到的：这栋有单元租出、却没有以它为主楼的在租合同（为什么——挂在别栋合同上、预定、临期——库里没记）
  if (v.cross) return out('thin', v.cross.length === 1 ? `${v.cross[0].name}有 ${v.cross[0].n} 个单元租出，没有这栋的在租合同` : `${v.cross.length} 栋有单元租出，却没有这栋的在租合同`)
  if (v.noEnd) return out('thin', `${v.noEnd} 份没写到期日，都按在租算`)
  // 园区能耗：这个月某张表没数 → 算不了哪个数；往年没数 / 只有几个月有数 → 比不了往年
  if (v.shown) return out('thin', `${v.table}里没有${v.noMonth}，图上是${v.shown}的数`)
  if (v.noMonth) return out('thin', `${v.table}里没有${v.noMonth}，算不了${v.noMonth}的${v.cant}`)
  if (v.noPast) return out('thin', `${v.noPast}没有${v.what}，比不了往年`)
  if (v.onlySome) return out('thin', `${v.onlySome}只有${v.what}${v.span}有数`)
  // 用能与缴费：散点只画有月租的户，没画上的照说；选中户不在图上时点名（读者在别的卡上看到它是深蓝）
  if (v.noRent) {
    const tail = '在租户表里查不到在租月租，不在图上'   // 查不到 = 租户表里没有在租且月租 > 0 的同名户（退租、名字对不上也算），不说原因
    const t = [v.sel && (v.noRent === 1 ? `${v.sel}${tail}` : `${v.sel}等 ${v.noRent} 户${tail}`), `${v.noRent} 户${tail}`].filter((x): x is string => !!x).find((x) => vlen(x) <= LIMIT.ref)
    return out('thin', t ?? `${v.noRent} 户${tail}`)
  }
  return out('thin', `${v.name}只有 ${v.n} 期，${v.cant}`)
}

// 1 变动最大：items = [{ name, prev, cur }]（prev/cur 为 null 表示没数）
export interface MoverItem { name: string; prev: number | null; cur: number | null }
export function movers({ items, prevLabel, table, q = '项' }: { items: MoverItem[]; prevLabel: string; table: string; q?: string }): (Said & { top?: string }) | null {
  if (items.every((i) => i.prev == null)) return thin({ prevLabel, table })
  const both = items.filter((i): i is { name: string; prev: number; cur: number } => i.prev != null && i.cur != null)
  if (!both.length) return null
  const top = both.reduce((a, b) => (Math.abs(b.cur - b.prev) > Math.abs(a.cur - a.prev) ? b : a))
  const sumPrev = items.reduce((a, i) => a + (i.prev ?? 0), 0)   // 图上画了上期的项都算进基数（10-04 改：原来只算两期都有的）
  if (Math.abs(top.cur - top.prev) < 0.05 * Math.abs(sumPrev)) return null
  const rest = both.filter((i) => i !== top)
  const sp = rest.reduce((a, i) => a + i.prev, 0), sc = rest.reduce((a, i) => a + i.cur, 0)
  const restName = both.length < items.length && rest.length === 1 ? rest[0].name : `其余 ${rest.length} ${q}`   // 有项缺一期：「其余」不再成立，只剩一项就点名
  const head = `${top.name} ${num(top.prev)}→${num(top.cur)}`, tail = rest.length ? `；${restName} ${num(sp)}→${num(sc)}` : ''   // 放不下 30 字只写前半句；没有其余项（只一项两期都有数）不写「其余 0 项」
  return { ...out('movers', vlen(head + tail) <= LIMIT.read ? head + tail : head), top: top.name }
}

// 2 达标：items = [{ name, value }]，值越大越好
export interface NamedValue { name: string; value: number }
export function goal({ items, target, unit = '%', q }: { items: NamedValue[]; target: number; unit?: string; q: string }): (Said & { low: NamedValue }) | null {
  const hit = items.filter((i) => i.value >= target).length
  if (hit === items.length) return null
  const low = items.reduce((a, b) => (b.value < a.value ? b : a))
  return { ...out('goal', `${items.length} ${q}里 ${hit} ${q}到了目标，最低是 ${low.name} ${pct1(low.value)}${unit}`), low }
}

// 3 占比变化：a/b 为百分数
export function share({ name, total, prevLabel, curLabel, a, b }: { name: string; total: string; prevLabel: string; curLabel: string; a: number; b: number }): (Said & { mark: string }) | null {
  const d = b - a
  if (Math.abs(d) < 1) return null
  return { ...out('share', `${name}占${total} ${curLabel} ${b.toFixed(1)}%，比${prevLabel}${d > 0 ? '高' : '低'} ${Math.abs(d).toFixed(1)} 个点`), mark: `${b.toFixed(1)}%` }
}

// 4 增长
export function growth({ firstLabel, lastLabel, metric, first, last }: { firstLabel: string; lastLabel: string; metric: string; first: number; last: number }): (Said & { mark: string }) | null {
  if (!(first > 0)) return null
  const g = (last / first - 1) * 100
  const w = `${g >= 0 ? '增长' : '下降'} ${Math.abs(g).toFixed(1)}%`
  return { ...out('growth', `${firstLabel}→${lastLabel} ${metric}${w}`), mark: `比${firstLabel}${w}` }   // 气泡钉在末期柱上，带上基年
}

// 5 累计对目标：cum = 逐期累计；labels 同长
// noPct：达成率已在 KPI 瓦上（规范 S-14 同一个数不说两遍），句子只说累计怎么走
export function ptd({ cum, labels, target, targetName, noPct }: { cum: number[]; labels: string[]; target: number; targetName: string; noPct?: boolean }): (Said & { mark: string }) | null {
  if (!(target > 0)) return null
  const n = cum.length - 1, p = (cum[n] / target * 100).toFixed(1)
  if (n > 0 && cum[n] < cum[n - 1]) {
    const less = `少 ${yuan(cum[n - 1] - cum[n])}`
    return { ...out('ptd', noPct ? `${labels[n]}累计比${labels[n - 1]}底${less}` : `${labels[n]}累计到${targetName}的 ${p}%；比${labels[n - 1]}底${less}`), mark: `${labels[n]} ${less}` }   // 气泡带月份：隔月轴上末点可能没有月份字
  }
  return { ...out('ptd', noPct ? `${labels[n]}累计 ${yuan(cum[n])}` : `${labels[n]}累计 ${yuan(cum[n])}，到${targetName}的 ${p}%`), mark: `${labels[n]} ${yuan(cum[n])}` }
}

// 6 最高最低：不挑、不排除任何一期；fmt 默认「万」；回带 hi/lo 给图上标名
// q：并列超过 2 项时写「n {q}」不逐个点名（不给 q 的调用方照旧逐个点名）；
// 并列 2 项逐个点名放不下 30 字时，给了 q 的也改写「2 {q}」（驾驶舱按年各月营业收入，2026-10；原来这种情况开发里直接抛错）
export interface LabeledValue { label: string; value: number }
export function extremes<T extends LabeledValue>({ metric, items, fmt = yuan, q }: { metric: string; items: T[]; fmt?: (v: number) => string; q?: string }): (Said & { hi: T; lo: T; his: T[]; los: T[] }) | null {
  if (items.length < 2) return null
  const hi = items.reduce((a, b) => (b.value > a.value ? b : a)), lo = items.reduce((a, b) => (b.value < a.value ? b : a))
  const his = items.filter((i) => fmt(i.value) === fmt(hi.value)), los = items.filter((i) => fmt(i.value) === fmt(lo.value))   // 显示位数相同的并列
  const names = (a: T[], tight = false) => (q && (a.length > 2 || (tight && a.length > 1)) ? `${a.length} ${q}` : a.map((i) => i.label).join('、'))
  const say = (tight: boolean) => `${metric}最高 ${names(his, tight)} ${fmt(hi.value)}，最低 ${names(los, tight)} ${fmt(lo.value)}`
  const t = say(false)
  return { ...out('extremes', q && vlen(t) > LIMIT.read ? say(true) : t), hi, lo, his, los }
}

// 7 预测：band = { lo, mid, hi }；drawBand = 回测 ≥5 次
// actualShown：目标月就是 KPI 瓦那个月（12 月看 12 月本身），实际值瓦上已有，句子只说落在哪（规范 S-14）
// mark = 图上目标月那个点的气泡字（规范 S-45）
export interface Band3 { lo: number; mid: number; hi: number }
export function forecast({ targetLabel, band, actual, drawBand, trainN, actualShown }: { targetLabel: string; band: Band3 | null; actual: number | null; drawBand: boolean; trainN: number; actualShown?: boolean }): Said & { mark?: string | null } {
  if (!band) return thin({ name: CK.rev, n: trainN, cant: `算不出${targetLabel}` })
  const range = drawBand ? yuanSpan(band.lo, band.hi) : yuan(band.mid)
  if (actual == null) return { ...out('forecast', `${targetLabel}预计 ${range}`), mark: null }
  const where = drawBand ? (actual > band.hi ? '高于' : actual < band.lo ? '低于' : '落在') : actual >= band.mid ? '高于' : '低于'
  if (actualShown) return { ...out('forecast', `${targetLabel}实际${where}预计 ${range}`), mark: `${targetLabel}实际` }
  return { ...out('forecast', `${targetLabel}实际 ${yuan(actual)}，${where}预计 ${range}`), mark: yuan(actual) }
}
// 7 的参照：stations = [{ target: 月号, hit: bool }]（已按时间排好、≤6 站）
export function backtest({ stations }: { stations: { target: number; hit: boolean }[] }): Said & { legend: string | null } {
  const n = stations.length, k = stations.filter((s) => s.hit).length
  if (n < 5) return { ...thin({ tested: n }), legend: null }
  const r = out('backtest', `最近 ${n} 次（${stations[0].target}–${stations[n - 1].target}月）中 ${k} 次落在区间里`)
  return { ...r, legend: `区间（${n}次中${k}次）` }
}

// ── 卡头、标签、KPI 副行、来源（不是句型，模板也只在这里） ──
const hintOut = (s: string) => { if (vlen(s) > LIMIT.hint) tooLong(`卡头超长 ${vlen(s)}：${s}`); return s }
function refOut(s: string): string { if (vlen(s) > LIMIT.ref) tooLong(`参照超长 ${vlen(s)}：${s}`); return s }
const kpiOut = (s: string) => { if (vlen(s) > LIMIT.kpiNote) tooLong(`KPI 副行超长 ${vlen(s)}：${s}`); return s }
// 卡标题不带期间（用户 2026-10-05 按推荐定，规范 S-17）
export const cardTitle = (metric: string) => metric
export const hint = (...parts: (string | null | undefined | false)[]) => hintOut(parts.filter(Boolean).join(' · '))
export const monthLabel = (m: number) => `${m}月`
export const cmpWith = (m: number) => `和${monthLabel(m)}比`
export const fallbackTag = (m: number) => `显示 ${monthLabel(m)}`
// 12 月是年末：预测看 12 月本身、用 1–11 月算 —— 这是口径，放参照位，不进回退标签（规范 S-29）
export const yearEndBasis = (m: number) => refOut(`按1–${m - 1}月算${monthLabel(m)}`)
export const tileLabel = (name: string, period?: string | null) => (period ? `${name}(${period})` : name)
export const monthSpan = (a: number, b: number) => (a === b ? `${a}月` : `${a}–${b}月`)
export const yearLabel = (y: number | string) => `${y}年`
export const yearSpan = (y: number, a: number, b: number) => yearLabel(y) + monthSpan(a, b)
export const yearCover = (y: number, a: number, b: number) => (a === 1 && b === 12 ? '' : yearSpan(y, a, b))   // 卡头覆盖范围：整年 = 工具条的期，不再写（S-17）
export const ymLabel = (ym: string) => `${+ym.slice(0, 4)}年${+ym.slice(5, 7)}月`
export const asofOne = (ym: string) => `截至 ${ymLabel(ym)}`   // 工具条数据截至，只一份数据时（S-34）
export const asofTables = (rows: [string, string][]) => (new Set(rows.map((r) => r[1])).size === 1 ? asofOne(rows[0][1]) : rows.map(([t, ym]) => `${t}到 ${ymLabel(ym)}`).join(' · '))   // rows = [[表名, YYYY-MM]]（S-34 槽位 17）
export const vsLabel = (what: string) => `比${what}`
export const vsTarget = (rate: number, target: number) => {
  const d = rate - target
  return `比目标 ${target}% ${d >= 0 ? '高' : '低'} ${Math.abs(d).toFixed(1)} 个点`
}
export const vsBudget = (value: number, budget: number) => `比全年预算${value >= budget ? '多' : '少'} ¥${abs1(budget - value)}万`
export const ruleCount = (m: number, n: number) => (n ? out('count', `${monthLabel(m)}共触发 ${n} 条规则`) : null)
export const ruleTop = (k: number) => `前 ${k} 条`
export const goalLine = (target: number) => `目标 ${target}%`
// 规则行：产品规则引擎的 title 里月份写成「12月」、末尾和右边值重复的数去掉、金额换成万；
// 台账负值行补上是哪家公司的台账（同一租户可能在两家各一行）
export interface EngineAnomaly { title: string; ym: string; value: string; type: string; detail: string; company?: string | null; metric?: string }
export function ruleRow(a: EngineAnomaly): { title: string; value: string } {
  let t = a.title.replace(` ${a.ym} `, ` ${monthLabel(+a.ym.slice(5))}`)
  if (t.endsWith(' ' + a.value)) t = t.slice(0, -(a.value.length + 1))
  // 能耗规则引擎标题「… 6月环比骤降」：写成比哪个月（S-13），不写「激增 / 骤降」这类解读词
  if (a.type === '能耗环比') { const m = +a.ym.slice(5); t = t.replace(/环比(激增|骤降)$/, `比${monthLabel(m === 1 ? 12 : m - 1)}`) }
  const title = t + (a.company ? ` · ${a.company}台账` : '')
  const money = (s: string) => (s.startsWith(MINUS) ? -1 : 1) * Number(s.replace(/[^\d.]/g, '')) / 1e4
  if (a.type === '收入中断') return { title, value: `${+a.detail.slice(5, 7)}月计费 ${yuan(money(a.value))}` }
  return { title, value: a.value.includes('¥') ? yuan(money(a.value)) : a.value }
}
export const coverN = (n: number, q: string, what: string) => `${n} ${q}${what}`
// 参照位的口径句：「{什么}按{A}和{B}算」—— 不写 = ÷ × 和「折算」（用户 2026-10-05 按推荐定，规范 S-25）
export const basis = (what: string, ...from: string[]) => refOut(`${what}按${from.join('和')}算`)
// ── 经营驾驶舱：同一笔钱全屏一个名字（S-38），KPI、图例、读数句、参照都从这里取 ──
export const CK = {
  screen: '经营驾驶舱',
  rev: '营业收入', cost: '成本费用', profit: '园区利润', budget: '全年预算', budgetHit: '预算达成', rate: '收缴率',
  est: '预计',
  card: { compo: '营业收入构成', phase: '分期收入', coll: '各公司收缴率', rules: '触发的规则', fc: '营业收入趋势 · 下月预测', fcEnd: '营业收入趋势 · 预测', bt: '这条带过去准不准', btNoBand: '过去几次预测准不准',
    hist: '历年营业收入、成本费用、园区利润', cum: '累计营业收入和全年预算', monthly: '各月营业收入和园区利润', histCompo: '历年营业收入构成', collM: '各月收缴率' },
  // 回测表（CockpitView.vue「这条带过去准不准」原样五列，落空不写百分比 —— S-37）
  btHead: ['站在哪个月末', '下月预测', '区间', '实际', '落在哪'],
  btWhere: { in: '在区间里', hi: '高于区间', lo: '低于区间' },
  tbl: { pnl: '损益表', s10: '销售收入表', ledger: '台账' },   // 工具条「各到哪个月」用的表名
}
export const budgetLine = (v: number) => `${CK.budget} ${yuan(v)}`
export const btRow = (v: number, b: Band3, a: number) => [`${monthLabel(v)}末`, yuan(b.mid), yuanSpan(b.lo, b.hi), yuan(a), a > b.hi ? CK.btWhere.hi : a < b.lo ? CK.btWhere.lo : CK.btWhere.in]
export const btBasis = refOut('每次按当时已有的月算下一个月')
export const SOURCE = {
  phase: refOut(`按销售收入表算，和${CK.rev}分开记`),
  phaseTable: '销售收入表',
  coll: (period: string) => basis('', `台账${period}的实收`, '应收'),
  history: (a: number, b: number, y: number) => `${a}–${String(b).slice(2)} 取预算表全年实际，${y} 取损益表`,
  costBasis: (a: number, b: number) => refOut(`${a}–${String(b).slice(2)} 的${CK.cost}按${CK.rev}和${CK.profit}算`),   // 只有往年是算出来的,当年取损益表
}
// 整页期间回退（驾驶舱 cv2-notdone / cv2-ask 7，用户 2026-10-05 照推荐）：所选期损益表没数，整页显示最近有数的那一期。
// used / sel 是 'YYYY-MM' 或 'YYYY'；屏上不出 YYYY-MM 写法，同年只写月
export function pageFallback(used: string, sel: string): string {
  const lab = (p: string) => (p.length === 4 ? yearLabel(p) : used.slice(0, 4) === sel.slice(0, 4) ? monthLabel(+p.slice(5, 7)) : ymLabel(p))
  return `显示 ${lab(used)} · ${lab(sel)}无数据`
}
export const noPnlYear = (y: number) => `${CK.tbl.pnl}里没有${yearLabel(y)}`   // 按年选了损益表 0 个月的年：整页空状态那一句
export const noPnlBefore = (ym: string) => `${CK.tbl.pnl}里没有${ymLabel(ym)}及以前的月`   // 按月选到损益表最早一个月之前：只往前退，退不到就空状态（不拿以后的月顶替）
export const seeYear = (y: number) => `看 ${yearLabel(y)}`                       // 空状态的按钮：去最近一个录满的年

// ═════════ 异常提醒中心 ═════════
// 租户级金额写整元（¥76,250）：户与户之间差在千元级，「万」一位小数会把 ¥500 写成 0.1万。
export const yi = (v: number) => (v < 0 && Math.round(Math.abs(v)) !== 0 ? MINUS : '') + '¥' + Math.round(Math.abs(v)).toLocaleString('en-US')
export const pctS = (v: number) => (v >= 0 ? '+' : MINUS) + Math.abs(v).toFixed(1) + '%'
export const ymMonth = (ym: string) => monthLabel(+ym.slice(5, 7))
const ymIn = (ym: string, ref: string | null | undefined) => (ref && ym.slice(0, 4) === ref.slice(0, 4) ? ymMonth(ym) : ymLabel(ym))   // 和 ref 同年只写月
const sumOf = (a: number[]) => a.reduce((x, y) => x + y, 0)
export const nextYm = (ym: string) => { const y = +ym.slice(0, 4), m = +ym.slice(5, 7); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}` }

// 未收集中：items = [{ name, value(元) }]，value = 该月台账应收 − 实收（不是期末结余）
export function arrears({ items, ym }: { items: NamedValue[]; ym: string }): (Said & { n?: number }) | null {
  const pos = items.filter((i) => i.value > 0.005).sort((a, b) => b.value - a.value)
  if (!pos.length) return null
  const tot = sumOf(pos.map((i) => i.value)), m = ymMonth(ym)
  if (pos.length === 1) return out('arrears', `${pos[0].name} ${m}未收 ${yi(tot)}`)
  let k = 0, acc = 0
  while (acc < tot / 2) acc += pos[k++].value
  const p = (acc / tot * 100).toFixed(1)
  if (k === 1 && vlen(`${m}未收的 ${p}% 在${pos[0].name}`) <= LIMIT.read) return { ...out('arrears', `${m}未收的 ${p}% 在${pos[0].name}`), n: pos.length }
  return { ...out('arrears', `${m}未收的 ${p}% 在未收最多的 ${k} 户`), n: pos.length }
}

// 突变：spikes = [{ what: '电费'|'水费', ym, prevYm, cur(元), chg(%) }]，已按产品阈值筛过
export interface Spike { what: string; ym: string; prevYm: string; cur: number; chg: number }
export function jump({ spikes }: { spikes: Spike[] }): (Said & { pick: Spike; mark: string }) | null {
  if (!spikes.length) return null
  const s = spikes.reduce((a, b) => (Math.abs(b.chg) > Math.abs(a.chg) || (Math.abs(b.chg) === Math.abs(a.chg) && b.ym > a.ym) ? b : a))
  const t = `${s.what} ${ymIn(s.ym, s.ym)} ${yi(s.cur)}，比 ${ymIn(s.prevYm, s.ym)} ${pctS(s.chg)}`
  const tail = spikes.length > 1 ? `；共 ${spikes.length} 次` : ''
  return { ...out('jump', vlen(t + tail) <= LIMIT.read ? t + tail : t), pick: s, mark: pctS(s.chg) }
}

// 区间位置：band = { p25, p75 } 或 undefined
// median：给了、且高于中间一半时改写成中位数的几倍（读得出差多少）；不给的调用方照旧
export function band({ ym, value, band: b, median, what = '电费' }: { ym: string; value: number | null; band?: { p25: number; p75: number } | null; median?: number | null; what?: string }): Said | null {
  if (value == null || !b || (value >= b.p25 && value <= b.p75)) return null
  const head = `${ymMonth(ym)}${what} ${yi(value)}，`
  const times = median != null && median > 0 && value > b.p75 ? `${head}是全园中位数的 ${(value / median).toFixed(1)} 倍` : null
  if (times && vlen(times) <= LIMIT.read) return out('band', times)
  return out('band', `${head}${value > b.p75 ? '高于' : '低于'}全园中间一半的户`)
}

// 实收：periods = [{ ym, recv, coll }]（升序，只含有台账的期）
// balEnd：这户最后一期台账期末结余（几家公司相加）。最后一期实收不少于应收、期末还欠着时照说（用户 2026-10-05 按推荐定；
// 文案复查改成量出来的事：几家公司相加后实收 ≥ 应收，不说「收齐」—— 罗立剑 10月就是一家公司当月应收为负、另一家并没收齐，
// 期末仍欠 ¥170,756，原来卡上一句不提）
export interface PayPeriod { ym: string; recv: number; coll: number }
export function collect({ periods, balEnd }: { periods: PayPeriod[]; balEnd?: number | null }): Said | null {
  if (!periods.length) return null
  const l = periods[periods.length - 1]
  if (l.coll >= l.recv - 0.005) return balEnd != null && balEnd > 0.005 ? out('collect', `${ymMonth(l.ym)}实收不少于应收，期末仍欠 ${yi(balEnd)}`) : null
  if (periods.length > 1 && periods.every((p) => p.coll === 0)) return out('collect', `${periods.length} 期台账实收都是 ¥0，应收合计 ${yi(sumOf(periods.map((p) => p.recv)))}`)
  return out('collect', `${ymMonth(l.ym)}应收 ${yi(l.recv)}，实收 ${yi(l.coll)}`)
}

// ── 异常提醒中心：标签、卡头、行文（不是句型） ──
export const MON = {
  screen: '异常提醒中心',
  status: ['待处理', '处理中', '已解决'],
  bandLegend: '全园电费中间一半',
  localOnly: '状态只记在这台电脑',
  search: '搜索租户 / 公司…',
  links: ['查台账', '查销售收入表'],
  view: '查看分析 →',
  tier: { risk: '高风险', watch: '观察' },   // 清单行上的档位小标签（屏顶两张瓦的户数在清单里找得到）
  collapse: '收起',   // 「看全部 n 条 →」展开后的收回按钮
  card: { list: '租户风险清单', rules: '命中规则与处置', co: '收缴率没到目标的公司', energy: '电费和水费', ledger: '应收和实收' },
  listHint: '未收多的在前',
  waterAxis: '水费（右轴）',
  tbl: { s10: '销售收入表', ledger: '台账' },
  // 空状态（画板没画，产品要有）：整屏没数据 / 搜索没搜到
  noData: '台账和销售收入表里都没有租户',
  noMatch: '没有搜到这户',
}
// 电量：多数序列的最后一个月；有序列比它晚的另写一句「n 项到 …」（只有一项晚、值还是 0 也照实写）
export const asof = (led: string, s10: string, nrg: string, later?: { n: number; ym: string } | null) => `台账到 ${ymLabel(led)} · 销售收入表到 ${ymLabel(s10)} · 电量到 ${ymLabel(nrg)}`
  + (later ? `（${later.n} 项到 ${ymLabel(later.ym)}）` : '')
// ── 异常提醒中心 · 光伏两条规则（2026-10 改稿 pv-v2-anomaly；检测在 views/analysis/pvRules.logic.ts）──
// 规则行 = 槽位 24：名称「{楼} {月}{什么事}」+ 值「{月}{量} {数}」；电量写 kWh（10-06 拍板）。工具条末尾接 pvAsof
export const PVR = {
  card: '光伏触发规则的楼栋',
  dayLimit: 24,   // 每千瓦一天最多发 24 kWh（一天只有 24 小时）
  noRows: '光伏分栋抄表里还没有读数',
  failed: '光伏抄表没读到',
}
export const pvAsof = (ym: string) => `光伏抄表到 ${ymLabel(ym)}`
export const pvHint = (n: number, span: string, k: number) => hint(`${n} 栋楼`, span, nRules(k))   // n = 触发过规则的楼栋数
export const pvRuleOver = (b: { name: string; m: number; perDay: number; over: number; days: number; cap: number }) => ({
  // 判的是这个月的每千瓦日均(合计 ÷ 装机 ÷ 天数),名称写「日均」—— 写「日发电」读起来像有哪天超了
  title: `${b.name} ${b.m}月每千瓦日均超 ${PVR.dayLimit} kWh`, value: `${b.m}月每千瓦日均 ${b.perDay.toFixed(1)} kWh`,
  detail: `${b.days} 天里 ${b.over} 天超过 ${PVR.dayLimit} kWh · 台账装机 ${b.cap.toFixed(1)} kWp`,
})
export const pvRuleRun = (r: { name: string; m: number; run: number; outN: number; runs: { from: number; to: number; dir: number }[] }) => ({
  title: `${r.name} ${r.m}月连着 ${r.run} 天以上偏离平时`, value: `${r.m}月偏离平时 ${r.outN} 天`,
  detail: `${r.m}月${r.runs.map((x) => `${x.from}–${x.to}日`).join('、')}连着${r.runs.every((x) => x.dir > 0) ? '高于' : r.runs.every((x) => x.dir < 0) ? '低于' : '偏离'}平时范围`,
})
// 计数（count）：最近一个月几栋楼触发；只有一种规则时说是哪种（和规则行同一个说法）。0 条不出句（S-28）
export function pvCount(m: number, hits: { name: string; kind: 'over' | 'run' }[]): Said | null {
  if (!hits.length) return null
  const nb = new Set(hits.map((x) => x.name)).size, kinds = new Set(hits.map((x) => x.kind))
  const tail = kinds.size > 1 ? `共 ${hits.length} 条` : kinds.has('over') ? `都是每千瓦日均超 ${PVR.dayLimit} kWh` : '都是连着偏离平时'
  return out('count', `${monthLabel(m)} ${nb} 栋楼触发规则，${tail}`)
}
export const scoreGe =(th: number) => `风险分 ≥ ${th}`
export const scoreIn = (a: number, b: number) => `风险分 ${a}–${b}`
export const ofAll = (total: number, rule: string) => `${total} 户中${rule}`
// KPI 副行 ≤ 16 字（去空白数，用户 2026-10-05 按推荐定），只写「期数 · 分母」，不写定义
export const arrearsBase = (ym: string, n: number) => basis('', `${ymMonth(ym)}没收齐的 ${n} 户`)   // 未收集中句的样本量（参照位）
export const arrearsNote = (n: number) => kpiOut(`${n} 户应收没收齐`)
export const spikeNote = (y: number, k: number, n: number) => kpiOut(`${yearLabel(y)}${k}个月 · ${n}户`)
// 风险分怎么算（清单卡参照小字两行）：权重从调用方的常量出（0.4 → 4成）；没数的项记 0，销售收入表停了的户收入、电费两项也记 0
// （2026-10-05 用户按推荐定 av2-ask 2 选 C：缺项不再按其余项归一放大，原句「缺项按其余项算」随算法改）
export const scoreNote = (w: { pay: number; rev: number; energy: number }, lastS10Ym: string) => [
  refOut(`风险分：未收比例${Math.round(w.pay * 10)}成、收入降幅${Math.round(w.rev * 10)}成、电费涨跌${Math.round(w.energy * 10)}成`),
  refOut(`没数的项记 0；销售收入表停在${ymMonth(lastS10Ym)}前的，收入、电费也记 0`),   // 销售收入表一行都没有的户后两项记 0（同屏行里写「销售收入表没有这户」），不在这句里
]
export const tenantTitle = (name: string, what: string) => `${name} · ${what}`
export const nRules = (n: number) => `${n} 条`
export const nCo = (n: number) => `${n} 家`
export const nSeries = (n: number) => `${n} 项电量`
export const ymSpan = (a: string, b: string) => `${ymLabel(a)}–${ymLabel(b)}`
export const coLedger = (k: number) => (k > 1 ? `${k} 家公司台账相加` : '')
export const energyTitle = (th: number) => `园区电量变动超 ±${th}% 的项`   // 清单卡写成名词短语（S-16）；一行一项电量，同卡头「n 项电量」
export const linkAll = (n: number) => `看全部 ${n} 条 →`
export const coRow = (k: number, n: number, target: number) => `${n} 期里 ${k} 期没到 ${target}%`
export const seriesRow = (k: number) => `${k} 次`
// 行内标记「最近一次」：和卡的最新月（ref）同年只写月（年份工具条和卡头已经说了）
export const latest = (ym: string, v: string, ref?: string | null) => `最近一次 ${ymIn(ym, ref)} ${v}`
// 公司收缴率行：最近一次没到目标就是台账最新那期 → 写成和租户行一样的「10月收了 67.1%」（读者不用再对哪一期）
export const coLatest = (ym: string, v: string, ledYm: string | null) => (ym === ledYm ? `${ymMonth(ym)}收了 ${v}` : latest(ym, v, ledYm))
export const cmpPrev = '和上月比'
// 单户电费和水费图的灰带被大户的左轴压扁时（判据在 tenantEnergyChart），参照位写出范围：lo = 图上各月 p25 最低，hi = 图上各月 p75 最高
// 主语写「户」，免得把「全园电费」读成合计；「各月…都在」= 每个月居中那一半户都落在这段里（外包络，比单月的带宽）
export const bandSpan = (lo: number, hi: number) => refOut(`各月全园中间一半的户，电费都在 ${yi(lo)}–${yi(hi)}`)
// 坐标轴月份：第一格和每年 1 月写年
export const axisYm = (ym: string, i: number) => (i === 0 || ym.endsWith('-01') ? `${ym.slice(2, 4)}年${+ym.slice(5, 7)}月` : ymMonth(ym))
// 缺月：present 为有数的月（YYYY-MM），在 [from, to] 里连成段 → 「3–5月、8–9月」；跨年的段写年
export function gapsText(present: Iterable<string>, from: string, to: string): string {
  const has = new Set(present), runs: { a: string; b: string }[] = []
  for (let ym = from; ym <= to; ym = nextYm(ym)) {
    if (has.has(ym)) continue
    const r = runs[runs.length - 1]
    if (r && nextYm(r.b) === ym) r.b = ym; else runs.push({ a: ym, b: ym })
  }
  return runs.map((r, i) => {
    const yr = (i === 0 && r.a.slice(0, 4) !== to.slice(0, 4)) || (i > 0 && r.a.slice(0, 4) !== runs[i - 1].b.slice(0, 4)) ? `${+r.a.slice(0, 4)}年` : ''
    if (r.a.slice(0, 4) !== r.b.slice(0, 4)) return `${yr}${ymMonth(r.a)}–${ymLabel(r.b)}`   // 一段跨年：「2024年12月–2025年1月」，不写成「12–1月」
    return yr + (r.a === r.b ? ymMonth(r.a) : `${+r.a.slice(5, 7)}–${ymMonth(r.b)}`)
  }).join('、')
}
// 清单行副文：只写有问题的项，正常项不出字；数据缺了照说
export interface RowSubTenant { payRate: number | null; arrears: number; recv: number; months: string[]; gone?: boolean; spikes: unknown[] }
export function rowSub(t: RowSubTenant, { ledYm, spikeTh, ledYms }: { ledYm: string; spikeTh: number; ledYms: Set<string> }): string {
  const parts: string[] = []
  // payRate 为 null 有三种：一期台账都没有 / 有台账但最新月没有 / 最新月应收 ≤ 0
  if (t.payRate != null) { if (Math.round(t.arrears) >= 1) parts.push(`${ymMonth(ledYm)}收了 ${t.payRate.toFixed(1)}%`) }   // 不足 ¥1 的未收不写（同清单排序、行上金额）
  else if (!ledYms.size) parts.push('没有台账')
  else if (!ledYms.has(ledYm)) parts.push(`${ymMonth(ledYm)}没有台账`)
  else parts.push(`${ymMonth(ledYm)}应收 ${yi(t.recv)}`)
  if (!t.months.length) parts.push('销售收入表没有这户')
  else if (t.gone) parts.push(`销售收入表只到${ymMonth(t.months[t.months.length - 1])}`)
  if (t.spikes.length) parts.push(`${t.spikes.length} 次变动超 ±${spikeTh}%`)
  return parts.join(' · ')
}
// 命中规则行：本屏租户级规则 → { title, value, detail }；只写测量，不写判断
export interface MonRuleTenant { recv: number; coll: number; payRate: number | null; elec: number[]; water: number[]; months: string[] }
export function monRule(r: { type: string; ym: string; id: string }, t: MonRuleTenant, { target, spikeTh }: { target: number; spikeTh: number }): { title: string; value: string; detail: string } {
  if (r.type === '欠费') return { title: `未收 · ${ymMonth(r.ym)}`, value: yi(t.recv - t.coll),
    detail: `应收 ${yi(t.recv)} · 实收 ${yi(t.coll)} · 收缴率 ${(t.payRate ?? 0).toFixed(1)}%，目标 ${target}%` }
  const [, , series, ym] = r.id.split(':'), a = series === 'elec' ? t.elec : t.water
  const i = t.months.indexOf(ym), what = series === 'elec' ? '电费' : '水费'
  const chg = (a[i] / a[i - 1] - 1) * 100
  return { title: `${what}变动 · ${ymMonth(ym)}`, value: pctS(chg),
    detail: `${ymIn(t.months[i - 1], ym)} ${yi(a[i - 1])} → ${ymMonth(ym)} ${yi(a[i])}，超过 ±${spikeTh}%` }
}
// 规则引擎里挂在这户名下的条（③ 收入中断 ④ 负值行）：去掉户名、去掉「请核对…」
export function engineRule(a: EngineAnomaly): { title: string; value: string; detail: string } {
  const v = (a.value.startsWith(MINUS) ? -1 : 1) * Number(a.value.replace(/[^\d.]/g, ''))
  if (a.type === '收入中断') {
    const p = a.detail.slice(0, 7)
    return { title: `销售收入表${ymMonth(a.ym)}没有这户`, value: `${ymMonth(p)} ${yi(v)}`, detail: `销售收入表 ${ymLabel(p)} ${yi(v)} → ${ymLabel(a.ym)} 没有这户` }
  }
  const what = (a.metric ?? '').replace(/^附表10 |^台账|为负$/g, '')
  const src = a.company ? `${a.company}台账` : '销售收入表'
  return { title: `${what}为负 · ${ymMonth(a.ym)}`, value: yi(v), detail: `${src} ${ymLabel(a.ym)} ${what} ${yi(v)}` }
}

// ═════════ 出租与楼栋 ═════════
// 集中度：items = [{ name, value }]；从大到小累加、刚过一半的 k 项。回带 top（这 k 项）给图上用。
export function concentration<T extends NamedValue>({ what, by, items, q }: { what: string; by: string; items: T[]; q: string }): (Said & { top: T[] }) | null {
  const pos = items.filter((i) => i.value > 0).sort((a, b) => b.value - a.value)
  if (pos.length < 2) return null
  const tot = sumOf(pos.map((i) => i.value))
  let k = 0, acc = 0
  while (acc < tot / 2) acc += pos[k++].value
  const p = (acc / tot * 100).toFixed(1), top = pos.slice(0, k)
  const named = `${what}的 ${p}% 在${top.map((i) => i.name).join('、')}`
  if (k <= 2 && vlen(named) <= LIMIT.read) return { ...out('concentration', named), top }
  return { ...out('concentration', `${what}的 ${p}% 在${by}最多的 ${k} ${q}`), top }
}
// 重叠计数：图上叠在同一点的 n 项（参照位）
export const overlap = ({ n, q, what, where }: { n: number; q: string; what: string; where: string }) => (n < 2 ? null : out('overlap', `${n} ${q}${what}，叠在${where}`))
// 对约定值：items = [{ name, value }]，按 digits 位比；全部等于约定值时不出句
export function baseline({ items, base, q, digits = 2 }: { items: NamedValue[]; base: number; q: string; digits?: number }): Said | null {
  const off = items.filter((i) => Math.abs(i.value - base) >= 0.5 * 10 ** -digits)
  if (!off.length) return null
  const w = off.reduce((a, b) => (Math.abs(b.value - base) > Math.abs(a.value - base) ? b : a))
  return out('baseline', `${items.length} ${q}里 ${off.length} ${q}不是 ${base}，${w.name} ${w.value.toFixed(digits)}`)
}
export const dayLabel = (d: string) => `${+d.slice(0, 4)}年${+d.slice(5, 7)}月${+d.slice(8, 10)}日`
export const sqm = (v: number) => Math.round(v).toLocaleString('en-US') + '㎡'
// ── 出租与楼栋：标签、卡头、KPI 副行（不是句型） ──
export const PARK = {
  screen: '出租与楼栋',
  card: { main: '各栋合同月租和单元', detail: '合同明细', phase: '各期区合同月租', scatter: '各栋户数和合同月租', area: '面积转换' },
  all: '全园区', allBld: '全部楼栋',
  tile: { rent: '合同月租合计', tenants: '有在租合同的租户', bld: '楼栋' },
  occTile: tileLabel('出租率', '按单元'),
  areaOccLabel: tileLabel('出租率', '按面积'),
  rentHead: '合同月租', unitLegend: ['租出单元', '空单元'], noUnitTag: '没建单元',
  byRent: '按合同月租排', byRentShort: '',   // 「合同月租的 p% 在最多的 k 栋」：按什么排就是句首那笔钱，不再换个叫法（S-38）
  byVacant: '空单元',
  th: ['租户', '合同月租(元)', '到期'], noEnd: '没写',
  clear: '× 取消筛选', pickCue: '点左边的楼栋，只看那一栋', viewAll: '看全部合同 →',
  scatterX: '户数', scatterY: '合同月租(万元)', perHead: '户均', origin: '原点', noLive: '没有在租合同',
  areaLegend: ['建筑面积', '租赁面积'], factorLabel: '建筑面积与租赁面积之比', shareLabel: '平均分摊率',
  goFill: '去补录楼栋建筑面积、可租面积 →', field: { rentable: '可租面积', total: '楼栋建筑面积' }, cant: { occ: '按面积的出租率', share: '平均分摊率' },
  zero: '–',   // 0 的写法：柱端值为 0 时（S-23 / S-45）
  unit: {
    st: { vacant: '空单元' },
    // 分析屏点进一栋：不画格子，只给去楼栋管理的入口（10-04 用户定方案 B）
    see: '在楼栋管理看这栋的单元 →', go: '去楼栋管理建单元 →',
  },
}
export const asofLive = (day: string) => `按 ${day} 在租的合同`
export const unitNote = (occ: number, total: number) => kpiOut(`${total} 个单元租出 ${occ} 个`)
export const liveNote = (n: number) => kpiOut(`${n} 份在租合同`)
export const tenantNote = (n: number) => kpiOut(`租户表登记在租 ${n} 户`)
export const tenantNowOnly = kpiOut('租户表登记只记了现在')   // 租户表的在租状态是一个字段，没有起止日
export const bldNote = (n: number) => kpiOut(`${n} 栋有在租合同`)
export const unitLabel = (occ: number, total: number) => `${occ}/${total}`
export const shareLabel = (w: number, p: number) => `${yuan(w)} · ${p.toFixed(1)}%`
export const pctBase = (n: number) => refOut(`合同月租按 ${n} 份在租合同算`)   // 带 % 的读数句同卡要有参照：样本量
// 主卡两句集中度（合同月租、空单元）各自的样本量，一句说完（S-25）
export const mainBase = (nContracts: number, nBld: number, nVac: number) => refOut(`按 ${nContracts} 份在租合同、${nBld} 栋的 ${nVac} 个空单元算`)
export const areaCover = (n: number, m: number) => `${n}/${m} 份合同录了面积`
export const areaSums = (b: number, r: number) => `建筑 ${sqm(b)}，租赁 ${sqm(r)}`
export const factorBase = (base: number) => `约定按 ${base} 换算`

// ═════════ 出租与楼栋 · 点进一栋：楼层读数句 ═════════
// 楼层集中：floors = [{ floor, n }]，必须是 1..顶层 全部楼层（没建单元的层 n = 0）
export const floorTag = (f: number) => `${f}F`                     // 同 FPUnitMap 楼层格
export function floorRun({ what, floors }: { what: string; floors: { floor: number; n: number }[] }): Said | null {
  const fs = [...floors].sort((a, b) => a.floor - b.floor), N = sumOf(fs.map((f) => f.n)), L = fs.length
  if (N < 2) return null
  for (let len = 1; len < L; len++) {
    let best: { i: number; m: number } | null = null
    for (let i = 0; i + len <= L; i++) {
      const m = sumOf(fs.slice(i, i + len).map((f) => f.n))
      if (m * 2 > N && (!best || m > best.m)) best = { i, m }   // 严格大于才换 → 同数取低层
    }
    if (!best) continue
    const a = fs[best.i].floor, b = fs[best.i + len - 1].floor
    return out('floorRun', `${what}的 ${N} 个里 ${best.m} 个在 ${len === 1 ? floorTag(a) : len === 2 ? `${floorTag(a)}、${floorTag(b)}` : `${floorTag(a)}–${floorTag(b)}`}`)
  }
  return null
}

// ═════════ 园区能耗 ═════════
// 同一笔钱全屏只用一个名字：KPI、能量流节点、柱图图例、收益横条都从这里取。
// 售电收入 = 销售收入表逐户电费合计（用户 2026-10-05 定「用逐户那份」，不用损益表「用电」），和用能与缴费屏顶同一个数。
export const ENERGY = {
  screen: '园区能耗',
  tile: { sell: '售电收入', buy: '购电成本', unit: '单位购电成本', kwh: '购电量', pv: '光伏自用和上网', pvShare: '光伏占园区用电' },
  node: { buy: '购电成本', pvSelf: '光伏自用', hub: '园区用电', sell: '售电收入', office: '办公和三期用电', chg: '充电桩用电' },
  seg: { resale: '售电收益', pv: '光伏收益', chg: '充电桩收益' },   // 三项同一个词尾，定义写在收益卡参照里
  card: { flow: '电从哪来、到哪去', earn: '各项收益', bars: '各月售电收入和购电成本', unit: '各月单位购电成本' },
  byAmt: '按金额',
  table: '销售收入表',
  what: { buy: '购电数据' },
  unitU: '元/kWh',
}
// 差额：本期 A − B；上期两项都有才在句尾带上期
export function gap({ aName, bName, a, b, prev }: { aName: string; bName: string; a: number | null; b: number | null; prev?: { label: string; a: number | null; b: number | null } | null }): Said | null {
  if (a == null || b == null) return null
  const w = (d: number) => `${d >= 0 ? '多' : '少'} ${yuan(Math.abs(d))}`
  const t = `${aName}比${bName}${w(a - b)}`
  const tail = prev && prev.a != null && prev.b != null ? `；${prev.label}${w(prev.a - prev.b)}` : ''
  return out('gap', vlen(t + tail) <= LIMIT.read ? t + tail : t)
}
// 工具条数据截至：几份数据各写到哪个月（S-34 槽位 17）；三份同月或放不下（room = 可用字数）退回 asofOne
export function energyAsof({ buy, s10, pv }: { buy: string; s10: string; pv: string }, room = Infinity): string {
  const t = `购电到 ${ymLabel(buy)} · ${ENERGY.table}到 ${ymLabel(s10)} · 光伏到 ${ymLabel(pv)}`
  return (buy === s10 && s10 === pv) || vlen(t) > room ? asofOne([buy, s10, pv].sort()[2]) : t
}
// 差额句配的深色气泡：两行「{名} ¥X.X万」
export const compareMark = (aLabel: string, a: number, bLabel: string, b: number) => [`${aLabel} ${yuan(a)}`, `${bLabel} ${yuan(b)}`]
// 能量流节点标签：名字、本期金额、上期金额（上期没数照说）
export const flowLabel = (name: string, v: number, prev?: { label: string; v: number | null } | null) => ({ name, val: yuan(v), prev: prev ? (prev.v == null ? `${prev.label}没有` : `${prev.label} ${yuan(prev.v)}`) : '' })
// 参照：各项金额是什么（只写源码里的算法，不写推断）
export const flowDef = refOut('售电收入按向租户收的算，其余按电费算，两边不等')
export const earnDef = basis(ENERGY.seg.resale, ENERGY.node.sell, ENERGY.node.buy)
export const pvEarnDef = basis(ENERGY.seg.pv, ENERGY.node.pvSelf, '上网')
export const chgEarnDef = basis(ENERGY.seg.chg, '手续费及服务费', ENERGY.node.chg)   // 同充电桩录入表的列名
export const unitBasis = refOut('购电成本按价税合计、含基本电费算')
export const coverTable = (n: number) => `${ENERGY.table}有数的 ${n} 个月`
export const yearTitle = (metric: string) => metric   // 同 cardTitle：不带期间（S-17）
// KPI 副行（≤16 字）
export const noTableNote = (m: number) => kpiOut(`${ENERGY.table}里没有${monthLabel(m)}`)
export const noPrevNote = (m: number) => kpiOut(`${ENERGY.table}里没有${monthLabel(m)}，比不了`)
export const sumNote = (n: number) => kpiOut(`${n} 个月合计`)
export const pvShareNote = kpiOut('园区用电是购电量加光伏自用')
export const onlyNote = (n: number) => kpiOut(`${ENERGY.table}只有 ${n} 个月`)
export const noPastNote = (y: number, what: string) => kpiOut(`${yearLabel(y)}没有${what}`)
export const somePastNote = (y: number, span: string) => kpiOut(`${yearLabel(y)}只有${span}有数`)
export const unitBasisNote = (n: number) => kpiOut(`按 ${n} 个月合计算`)
// KPI 涨跌值
export const dWan = (v: number) => signed(v) + '万'
export const dKwh = (v: number) => signed(v) + '万kWh'
export const dPt = (v: number) => signed(v) + ' 个点'
export const dYuan3 = (v: number) => (v >= 0 ? '+' : MINUS) + Math.abs(v).toFixed(3) + '元'
export const yuanN = (v: number, n: number) => `${yuan(v)} · ${n} 个月`
export const perKwh = (v: number) => v.toFixed(3) + '元'   // 单价全屏同 KPI 三位（用户 2026-10-05 按推荐定，S-32）

// ═════════ 用能与缴费 ═════════
// 同一笔钱全屏一个名字：电费 / 水费是每户交的（销售收入表），期末欠费 = 台账期末结余大于 0 的部分（累计），
// 和异常提醒中心的「未收」（当月应收 − 实收）分开。KPI、卡标题、读数句、参照都从这里取。
export const TE = {
  screen: '用能与缴费',
  metric: { elec: '电费', water: '水费' },
  tile: { rate: '收缴率', arrears: '期末欠费', arrearsN: '欠费户数' },
  seg: { by: ['按户', '按家族'], axis: ['对数', '线性'] },
  table: { s10: '销售收入表', ledger: '台账' },
  go: '去异常提醒中心看这户 →',
  goArrears: '去现金流量分析看欠费租户清单 →',   // 逐户期末欠费排行在那屏（点柱弹出，受按户 / 按家族开关管），本屏不重画
  goS10: '查销售收入表',
  hu: '户',
  axis: { rent: '月租' },
  waterSell: '水费收入',   // 同一笔钱（销售收入表水费合计）站内已叫「水费收入」：盈亏平衡屏、预算板、附表3 —— 照用
}
export const teTotal = (m: string) => (m === TE.metric.elec ? ENERGY.tile.sell : m === TE.metric.water ? TE.waterSell : `${m}合计`)   // KPI：全园这个月的电费合计 = 园区能耗屏「售电收入」同一个数，名字只从 ENERGY 出（S-38）
export const teRank = (m: string) => `各户${m}`                  // 主卡：各户电费，前 20 户，和上个月比
export const teArrearsCard = `各户${TE.tile.arrears}`
export const teScatter = (m: string) => `${m}和月租`
export const teRatio = (m: string) => `${m}占月租`
// 读数句「；共 n 次」数的是什么（三处同一句式：异常提醒中心电费水费图、用能与缴费按年大图数电费 + 水费，用能按月选中户卡只数所选那一项）
export const spikeCount = (th: number, what = '电费、水费') => `只数${what}比上个月变动超 ±${th}% 的次数`   // 只比相邻自然月：写「上个月」，不写「上一期」（会读成上一个有数的月）
export const teTenant = (m: string, ledger = true) => (ledger ? `${m}、${MON.card.ledger}` : m)   // 卡里两句：电费、应收和实收；台账句闭嘴时标题不提应收实收
export const topN = (n: number, q = '户') => `前 ${n} ${q}`
export const dHu = (v: number) => (v >= 0 ? '+' : MINUS) + Math.abs(v) + ' 户'
// 参照：集中度的样本量（S-25）；散点的口径（两份数各从哪来）
export const teBase = (n: number, what: string) => refOut(`按 ${n} 户的${what}算`)
export const teRentBasis = (m: string) => refOut(`${m}按${TE.table.s10}，月租按租户表算`)
export const teLedgerAll = refOut(`${TE.table.ledger}的应收、实收、欠费含租金等全部费用`)   // 收缴率、期末欠费、应收实收都不是只算电费
export const noLedgerNote = (m: number) => kpiOut(`${TE.table.ledger}里没有${monthLabel(m)}`)
export const nMonths = (n: number) => `${n} 个月`                // KPI 名称括号里：售电收入(7 个月)
export const cmpWithYm = (ym: string) => `和${ymLabel(ym)}比`     // 卡头：和2024年10月比
export const teMovers = (n: number) => `变动最大的 ${n} ${TE.hu}`   // 按年欠费卡卡头：按户变动从大到小取前 n 户
export const teArrearsMove = `各户${TE.tile.arrears}变动`
// 样本量带上 0 元户和为负的户（照实写，不排除）；都没有时同 teBase
// 集中度只累加大于 0 的户：有 0 元户、为负的户时样本量写成「大于 0 的 n 户」，读者拿 KPI 净合计当分母也知道差在哪
// q：按家族时传「个家族」，样本量和读数句「最多的 n 个家族」同一个数法（文案复查 10-05）
export const teBaseZ = (pos: number, what: string, zero: number, neg: number, q = '户') => refOut(zero || neg ? [`按${what}大于 0 的 ${pos} ${q}算`, zero ? `${zero} ${q}是 ¥0` : '', neg ? `${neg} ${q}为负` : ''].filter(Boolean).join('，') : `按 ${pos} ${q}的${what}算`)
export const teBoth = (y0: number, y1: number, m: number, n: number) => refOut(`按${yearLabel(y0)}、${yearLabel(y1)}${monthLabel(m)}台账都有的 ${n} 户算`)
// KPI 副行：欠费户数和上一年同月比，台账录的户数不一样多时不画箭头，照说那个月台账有几户
export const ledNNote = (ym: string, n: number) => kpiOut(`${ymLabel(ym)}${TE.table.ledger}只有 ${n} 户`)
// 按年屏顶期末欠费、欠费户数和上一年同月比：「比去年10月」（te2-ask 7，用户 10-05 按推荐定；「比2024年10月」连值超 16 字）
export const vsLastYear = (m: number) => vsLabel(`去年${monthLabel(m)}`)
// 按年：台账没有上一年同月（如按年 2024 比 2023年10月）—— 照说，不画箭头
export const noLedgerYmNote = (ym: string) => kpiOut(`${TE.table.ledger}里没有${ymLabel(ym)}`)
// 按家族：主卡的条一根是一个家族（量词同现金流量分析「按家族」）
export const teFamQ = '个家族'
// 按年各户期末欠费变动：把横轴撑开的那一户单独一行写数、不画条（te2-ask 6，用户 10-05 按推荐定）
export const teMoveRow = (a: number, b: number) => `${yuan(a)}→${yuan(b)}`

// ═════════ 光伏分栋分析（2026-10-06 改稿，画板 pv-v2）═════════
// 屏上每一句常显的字都从这里出：卡名、卡头说明、KPI 名和副行、图例、读数句、参照。逐字对过画板清单（manifest）。
// 楼栋个数一律写「N 栋楼」，和楼名「8栋」…「13栋」分开（这屏有一栋楼就叫 13栋）；卡头里选中的那栋写「选中 X栋」。
// 电量单位一律 kWh / 万kWh，不写「度」（用户 10-06 拍板）。比较按数据齐全时的样子写，没数的格子写「—」，缺哪份数一张卡只说一次。
// 参照位除了句型，还有「口径」：说这张图怎么算的（不是读数，没有句型）。
export type PvSayType = TypeKey | '口径'
export interface PvSaid { text: string; type: PvSayType }
const pvRef = (type: PvSayType, text: string): PvSaid => ({ type, text: refOut(text) })
const pvRead = (type: TypeKey, text: string): PvSaid => {
  if (vlen(text) > LIMIT.read) tooLong(`读数句超长 ${vlen(text)}：${text}`)
  return { type, text }
}
const pvJoin = (names: string[]) => names.join('、')
const pvF1 = (v: number) => v.toFixed(1)
const pvDay = (d: string) => `${+d.slice(5, 7)}月${+d.slice(8, 10)}日`   // '2025-06-01' → 6月1日
export const nB = (n: number) => `${n} 栋楼`
export const allB = (n: number) => `全部 ${n} 栋楼`
export const selB = (name: string) => `选中 ${name}`

// ── 名字：全屏一个名字只从这里出（S-38） ──
export const PV = {
  tab: { abs: '按装机比', ledger: '去向和收益', lab: '核对明细' },
  segHint: '按装机比看每千瓦发多少；核对明细看抄表齐不齐、名次稳不稳',
  tile: { gen: '发电量', perKw: '每千瓦日均', dev: (n: number, unit: string) => `连着 ${n} ${unit}偏离的楼栋`, self: '自用占比', rev: '自用和上网收益' },
  card: {
    dev: (unit: string) => `各栋发电偏离平时的${unit === '天' ? '天数' : '月数'}`, perKw: '各栋每千瓦日均发电',
    trail: '每千瓦发电走势', anchor: '每千瓦日均和合格线的差', ledger: '台账装机和板数算出的装机',
    cons: '自用、上网和损耗', rev: '各栋自用和上网收益',
    alpha: '各栋常年水平', heat: '各栋每月和常年水平的差', cal: '每天抄表齐不齐', table: '逐栋核对表',
    drift: '每天的偏离和水平变化', ctrl: '每天的偏离和两道范围', beta: '跟全园一起涨落的程度', rows: '每天的读数',
    anom: '光伏触发规则的楼栋',
  },
  short: '历史不够',
  miss: '缺抄',   // 大图图例的缺抄刻度;读不出但不是历史不够的楼(覆盖不够、一天没抄)芯片徽标也写它
  monthOnly: '只有月抄',   // 只有月抄记录的楼:一月一条,谈不上缺抄,芯片徽标写这个
  noBase: '历史不够，画不出平时范围',   // 选中历史不够的楼时大图图头的事实句(和图例同排,要短)
  noChart: '这一段还没有楼有读数。',
  drawerThin: '这栋能比的天不足 8 天，这几块画不出来。',
  driftThin: '这栋能比的天太少，画不出这段时间的水平。',
  // 手机抽屉四块的页签:照四张卡的卡名取短
  drawerTab: { drift: '水平变化', ctrl: '两道范围', beta: '跟全园涨落', rows: '读数' },
  ledgerRecord: '去录入板数和单块标称功率 →',
  alphaLog: '，+100% 和 −50% 离 0 一样远',   // 横轴按倍数画(跨度超过 3 倍时):×2 和 ×½ 一样宽。接在 alphaAxis 后面
  // 点只在连着偏离时上色，零散的天画灰点（和屏顶只数连着的同一个口径）
  devLegend: ['发电量是全园中间那栋的几倍', '平时范围', '连着低于', '连着高于', '零散'],
  tail: '全园一起少发时，这张图看不出来',   // 线是和全园中间那栋比的倍数：大家一起掉，倍数不动
  med: '全园中间',
  revLegend: ['自己用的', '卖上网的', '条尾是合计'],
  ledgerEmpty: (n: number) => `${allB(n)}都没录板数，录了才画得出和台账对不对得上`,
  ledgerLink: '去录入 →',
  anchorLegend: '条长：比合格线每天多发几 kWh',
  alphaAxis: '横轴：比全园中间那栋多或少（%）',
  alphaBand: '浅色：常年水平大概落在这一段',
  calRank: '缺抄的楼', calDrop: '这天不算', calFull: '这天都抄了',
  table: { ratio: '几倍', inBand: '在不在平时范围', in: '在平时范围', above: '高于平时', below: '低于平时', ci: '大概落在', acf: '隔天像不像', nul: '碰巧更偏' },
  consLoss: '损耗',
  join: (p: number) => `${'一二三'[p - 1]}期并网`,
  drift: { level: '这段时间的水平', ci: '水平大概落在这里' },
  ctrlBand: '在网这段的起伏', ctrlWin: (a: string, b: string) => `这两道线拿 ${a}–${b} 全部的天估`,
  perKwOver: '斜线：超过 24 kWh',
  trailCap: '虚线段：超过 24 kWh',
  beta1: '1 是和全园同步', betaPre: '并网前',
  limitDay: PVR.dayLimit,   // 和异常提醒中心光伏规则同一个上限
  anomStatus: ['待处理', '处理中', '已解决'],
  anomLink: '查看分析 →',
  dash: '—',        // 库里没数的格子
  cpNone: '没找到',  // 「哪天起变了」算过、没找到那天 —— 不写「—」（「—」在这屏是库里没数）
  online: '在网',
  notYet: '还没并网',
}

// ── 卡头说明（覆盖 · 和谁比 · 单位，≤ 24 字；和工具条同一个期不写，S-17） ──
export const PVH = {
  dev: (n: number, unit: string) => hintOut(`判了 ${nB(n)} · 和全园中间那栋比 · ${unit}`),
  perKwM: (n: number, pm: string) => hintOut(`${allB(n)} · 和${pm}、去年同月比 · kWh`),   // pm = 「11月」或「去年12月」
  perKwY: (n: number, y: number) => hintOut(`${nB(n)} · 按在网天数平均 · 和${y}年比 · kWh`),
  trail: (sel: string, per: string) => hintOut(`${selB(sel)} · ${per} · 和全园中间一半比 · kWh`),
  anchor: (n: number, cover: string) => hintOut(`${cover} · ${nB(n)} · 和合格线比 · kWh`),
  ledger: (n: number) => hintOut(`${allB(n)} · 和台账比 · kWp`),
  cons: (n: number, all = n) => hintOut(`${n === all ? allB(n) : nB(n)}合计 · 万kWh`),   // 同 rev:这段有楼没读数时不写「全部」,和参照「按 N 栋楼…」同一个数
  rev: (n: number, all = n) => hintOut(`${n === all ? allB(n) : nB(n)} · 按合计排 · 万元`),   // all = 装表的栋数；这段有几栋没发电（还没并网）就不写「全部」
  alpha: (cover: string) => hintOut(`${cover} · 和全园中间那栋比 · %`),
  heat: (cover: string) => hintOut(`${cover} · 扣掉全园涨落，和自己常年比 · %`),
  cal: (n: number) => hintOut(`${allB(n)} · 每天缺抄的栋数 · 栋`),
  table: (cover: string, n: number) => hintOut([cover, allB(n)].filter(Boolean).join(' · ')),
  drift: (cover: string) => hintOut(`${cover} · 扣掉全园涨落，和常年比 · 倍`),   // cover = pvYearCover
  // whole = 两道线拿在网的全部天估;否则只拿水平变之前那段(卡里另写是哪几天)
  ctrl: (cover: string, d: number, whole = true) => hintOut(`${cover} · 和${whole ? '在网的' : '水平变之前的'} ${d} 天比 · 倍`),
  beta: () => hintOut('12 个月 · 和全园比 · 倍'),
  rows: (sel: string, m: number, n: number) => hintOut(`${sel} · ${m}月 ${n} 天 · kWh`),
  rowsY: (sel: string, n: number) => hintOut(`${sel} · ${n} 个月 · kWh`),   // 按年:一行一个月
  anom: (n: number, span: string, k: number) => hintOut(`${nB(n)} · ${span} · ${k} 条`),
}
// 整年卡放在按月板上：卡头写覆盖范围（S-17）。a–b = 这一年读数的首末月；不满一年只写月份范围（年在工具条上，写上会顶破卡头 24 字）
export const pvYearCover = (y: number, a = 1, b = 12) => (a === 1 && b === 12 ? `${y}年全年` : monthSpan(a, b))

// ── KPI 副行（每行 ≤ 16 字）：涨跌「↘ −12.4% 比11月」；没数「— 比去年12月」（不带箭头） ──
export interface PvDelta { val: string | null; dir?: 'up' | 'dn'; key: string }
export const PVK = {
  vs: (m: number) => vsLabel(monthLabel(m)),
  vsLY: (m: number) => vsLastYear(m),          // 比去年12月
  vsY: (y: number) => vsLabel(yearLabel(y)),   // 比2024年
  // 每千瓦日均是比率：上月没读数的楼（新并网）掺进来会改变平均，所以只拿两期都有读数的那批比
  vsSame: (n: number, what: string) => `同 ${nB(n)}${vsLabel(what)}`,
  pct: (cur: number, prev: number) => ({ val: pctS((cur / prev - 1) * 100), dir: cur >= prev ? 'up' as const : 'dn' as const }),
  pt: (cur: number, prev: number) => ({ val: dPt(cur - prev), dir: cur >= prev ? 'up' as const : 'dn' as const }),
  wan: (cur: number, prev: number) => ({ val: dWan(cur - prev), dir: cur >= prev ? 'up' as const : 'dn' as const }),
  dev: (judged: number, short: number) => kpiOut(`判了 ${nB(judged)}` + (short ? `，${short} 栋${PV.short}` : '')),   // 0 栋不写后半句（S-28）
  // 另有楼每千瓦日均超 24 kWh（日抄的楼和异常提醒中心同月的规则行数得上；月抄的楼规则不判，这里按整月天数摊）
  over: (n: number) => kpiOut(`另 ${nB(n)}每千瓦日均超 ${PV.limitDay} kWh`),
  row: (d: PvDelta) => kpiOut(`${d.val ?? PV.dash} ${d.key}`),   // 只用来量字数：副行一行 = 值 + key
}

// ── 主卡（偏离平时）──
// 计数句（count，光伏写法）：本段有几栋连续偏离平时。0 栋不出句（S-28 正常不出句）；读不出的栋不数（同 KPI）。
export const pvRunCount = (label: string, n: number, run: number, unit: string): PvSaid | null =>
  (n ? pvRead('count', `${label}有 ${nB(n)}连着 ${run} ${unit}偏离平时`) : null)
// 数据不足（thin，光伏写法）：历史不够的栋 —— 哪天才有第一条读数、还差多少。没有这种栋不出句。
// 楼名连起来放不下 28 字时改写「N 栋楼」（1 月整园都还没有段外的历史时会一次点十几栋）
export function pvShortRef(v: { names: string[]; first?: string; days?: number; minDays?: number; months?: number; needMonths?: number }): PvSaid | null {
  if (!v.names.length) return null
  const say = (who: string) => (v.months != null ? `${who}只有 ${v.months} 个月读数，满 ${v.needMonths} 个月才判`
    : `${who}读数从${pvDay(v.first!)}起，还差 ${v.minDays! - v.days!} 天满 ${v.minDays} 天`)
  const t = say(pvJoin(v.names))
  return pvRef('thin', vlen(t) <= LIMIT.ref ? t : say(nB(v.names.length)))
}
// 选中栋的事实句：零散偏离和连着偏离分开说（屏顶 KPI 只数连着的）。和图例同排，放不下长句
export function pvDevFact(n: number, unit: string, below: number, above: number, seen: number, runs: number): string {
  if (!n) return `${seen} ${unit}都在平时范围`
  const how = !below ? `${n} ${unit}高于平时` : !above ? `${n} ${unit}低于平时` : `${n} ${unit}偏离平时（低 ${below}、高 ${above}）`
  return runs ? `${how}，${runs} 段连着` : `零散 ${how}`
}
export const pvFoot = {
  band: (k: number) => `平时范围：常见水平上下各放 ${k} 份正常起伏`,
  run: (n: number, unit: string) => `连着 ${n} ${unit}偏离算一次`,
  cover: (p: number) => `抄够 ${p}% 才判`,
}
// 平时范围拿哪一段估的。base.from 月档 'YYYY-MM-DD'、年档 'YYYY-MM'；base.to 月档 'MM-DD'、年档 'MM'（pvMeterAna.logic BaseWindow）
export function pvBaseNote(base: { from: string; to: string; n: number; unit: string; relaxed: string[] }, selFirst: string | null, yearStart: string): string {
  const span = base.unit === '天'
    ? `${pvDay(base.from)}–${pvDay(base.from.slice(0, 5) + base.to)}`
    : monthSpan(+base.from.slice(5, 7), +base.to)
  const own = base.relaxed.includes('含并网初期') && selFirst != null && selFirst > yearStart && selFirst.slice(0, 7) >= base.from.slice(0, 7)
  const tail = own ? '，含这栋刚并网那段' : base.relaxed.includes('不限同批在网') ? '，含别的楼刚并网的月份' : ''
  return `平时范围按 ${span} 的 ${base.n} ${base.unit}算${tail}`
}

// ── 各栋每千瓦日均（新卡）──
// 有楼超过一天 24 kWh 时说超限（对约定值 baseline：一天 24 小时的上限）；都没超才说最高最低（extremes）
export function pvPerKwRead(rows: { name: string; perDay: number }[]): PvSaid | Said | null {
  const over = rows.filter((r) => r.perDay > PV.limitDay)
  if (over.length) {
    const top = over.reduce((a, b) => (b.perDay > a.perDay ? b : a))
    const same = over.every((r) => pvF1(r.perDay) === pvF1(top.perDay))
    const u = '\u00a0kWh'   // 数和 kWh 之间不换行：窄卡里折行时「24」和「kWh」不拆开
    // 楼名长、数是三位数时放不下 30 字：先改说栋数，再去掉最高那栋的楼名
    const say = [
      ...(over.length <= 2 && same ? [`${pvJoin(over.map((r) => r.name))}每千瓦日均 ${pvF1(top.perDay)}${u}，超过 ${PV.limitDay}${u}`] : []),
      `${nB(over.length)}每千瓦日均超过 ${PV.limitDay}${u}，最高 ${top.name} ${pvF1(top.perDay)}${u}`,
      `${nB(over.length)}每千瓦日均超过 ${PV.limitDay}${u}，最高 ${pvF1(top.perDay)}${u}`,
    ]
    return pvRead('baseline', say.find((t) => vlen(t) <= LIMIT.read) ?? say[say.length - 1])
  }
  // 最高最低（extremes 的写法，并列超过 2 栋写「N 栋楼」）。放不下 30 字时并列 2 栋也改说栋数，再放不下去掉楼名
  if (rows.length < 2) return null
  const u = '\u00a0kWh'
  const fmt = (v: number) => pvF1(v) + u
  const hi = rows.reduce((a, b) => (b.perDay > a.perDay ? b : a)), lo = rows.reduce((a, b) => (b.perDay < a.perDay ? b : a))
  const his = rows.filter((r) => fmt(r.perDay) === fmt(hi.perDay)), los = rows.filter((r) => fmt(r.perDay) === fmt(lo.perDay))
  // 各栋按一位小数都一样（模拟数据同一期各栋相同）时不出句：「最高 5 栋楼 2.1，最低 5 栋楼 2.1」没有信息
  if (his.length === rows.length) return null
  const nm = (a: typeof rows, tight: boolean) => (a.length > 2 || (tight && a.length > 1) ? nB(a.length) : pvJoin(a.map((r) => r.name)))
  const say = [false, true].map((tight) => `${PV.tile.perKw}最高 ${nm(his, tight)} ${fmt(hi.perDay)}，最低 ${nm(los, tight)} ${fmt(lo.perDay)}`)
  say.push(`${PV.tile.perKw}最高 ${fmt(hi.perDay)}，最低 ${fmt(lo.perDay)}`)
  return pvRead('extremes', say.find((t) => vlen(t) <= LIMIT.read) ?? say[2])
}
// 「—」是什么：缺哪几份数都写进这一句（一张卡只说一次）
// 几份缺的数连起来放不下 28 字时只说「比的那一期没有读数」
export const pvDashRef = (parts: string[]): PvSaid => {
  const t = `${PV.dash}：${parts.join('；')}`
  return pvRef('thin', vlen(t) <= LIMIT.ref ? t : `${PV.dash}：比的那一期没有这几栋的读数`)
}
// 「才并网」只说第一条读数落在这一段里的楼；早有读数、只是上一期整段没抄的楼另说（pvDashGap）
export const pvDashNew = (m: number, pm: string) => `${m}月才并网的楼没有${pm}`
export const pvDashGap = (who: string, pm: string) => `${who}${pm}没有读数`
// 上一年有分栋读数、只是比的那一段（去年同月 / 去年同期）没有
export const pvDashLy = (what: string) => `${what}没有分栋读数`
export const pvDashPast = (y: number) => `${y}年还没有分栋读数`
// 一天只有 24 小时：每千瓦一天发不过 24 kWh（口径）。本段没有超过的栋不出。
export const pvLimitRef = (n: number): PvSaid | null => (n ? pvRef('口径', `每千瓦一天最多发 ${PV.limitDay} kWh（一天只有 ${PV.limitDay} 小时）`) : null)

// ── 按装机比 ──
// 走势的分母：没录板数的楼按台账装机算。都录了不出句；只录了一部分时说几栋按台账（板上画的是一栋都没录）
export const pvDenomRef = (n: number, all = n): PvSaid | null =>
  (!n ? null : pvRef('thin', n === all ? `按台账装机算，${allB(n)}都没录板数` : `${nB(n)}没录板数，这几栋按台账装机算`))
// 按年一个点是一个月：上限 = 24 × 当月天数
export const pvTrailCapRef = (perMonth = false) => pvRef('口径', perMonth
  ? `虚线段：这个月每千瓦日均超 ${PV.limitDay} kWh，画到 ${PV.limitDay} × 天数`
  : `虚线段：这天每千瓦超过 ${PV.limitDay} kWh，画到 ${PV.limitDay} 为止`)
// 合格线一块板只写一次（按月：合格线卡下这句；按年：新卡上那条线的线名），别处写「合格线」
// phaseDays = [期别, 这期各栋有读数天数的最少, 最多]；一期内天数不一样写成「300–365 天」，三期都写不下 28 字时改说「每栋按自己有读数的天数平均」
// short = 在网不足 minDays、不画的楼；天数一样写「在网 31 天」，不一样写「在网不到 90 天」，楼名放不下改写「N 栋楼」
export function pvAnchorRefs({ anchor, anchorDay, phaseDays, short, minDays }: {
  anchor: number; anchorDay: number; phaseDays: [number, number, number][]; short: { name: string; days: number }[]; minDays: number
}): PvSaid[] {
  const pd = phaseDays.map(([p, a, b]) => `${'一二三'[p - 1]}期按 ${a === b ? a : `${a}–${b}`} 天`).join('、') + '平均'
  const ds = new Set(short.map((s) => s.days))
  const on = ds.size === 1 ? `在网 ${short[0].days} 天` : `在网不到 ${minDays} 天`
  const who = pvJoin(short.map((s) => s.name))
  return [
    pvRef('口径', `合格线一年 ${anchor} kWh，摊到每天 ${anchorDay.toFixed(2)} kWh`),
    ...(phaseDays.length ? [pvRef('口径', vlen(pd) <= LIMIT.ref ? pd : '每栋按自己有读数的天数平均')] : []),
    ...(short.length ? [pvRef('thin', vlen(`${who}${on}，不画`) <= LIMIT.ref ? `${who}${on}，不画` : `${nB(short.length)}${on}，不画`)] : []),
  ]
}
export const pvAnchorBadge = (y: number) => `${y}年没有分栋读数`
export const pvAnchorZero = () => '0 是合格线'
export const pvAnchorLeg = () => '合格线'
// 按年合格线画进新卡：线名带上每天的值和一年的数（807.5 按年只写在这里）
export const pvAnchorLine = (anchor: number, anchorDay: number) => `合格线 ${anchorDay.toFixed(2)}（一年 ${anchor}）`

// ── 去向和收益 ──
// 按月：上网电量比上月（growth）。上网占比的变化 = 屏顶「自用占比」换个说法（S-14），不再说
export const pvConsGrowth = ({ m, pm, a, b }: { m: string; pm: string; a: number; b: number }) => growth({ firstLabel: pm, lastLabel: m, metric: '上网电量', first: a, last: b })
// n = 这段有读数的栋数，all = 装表的栋数（这段有楼还没并网时不写「全部」）
export const pvSampleRef = (n: number, k: number, all = n) => pvRef('口径', n === all ? `按${allB(n)} ${k} 条抄表算` : `按 ${nB(n)} ${k} 条抄表算`)
export const pvLossRef = () => pvRef('口径', '损耗是发电减去自用和上网剩下的，没记原因')
export const wanKwh = (v: number) => num(v / 1e4) + '万kWh'
export const pvConsYear = (months: LabeledValue[]) => extremes({ metric: '发电', items: months, fmt: wanKwh, q: '个月' })
// 按年读数句点到的月，柱顶深色气泡（S-45）：「8月 70.1万kWh」
export const pvConsMark = (label: string, v: number) => `${label} ${wanKwh(v)}`
export const pvRevRead = (rows: { name: string; total: number }[]) => extremes({ metric: '收益', items: rows.map((r) => ({ label: r.name, value: r.total / 1e4 })), fmt: yuan, q: '栋楼' })
// prices = 这一段用到的上网单价（按读数所在的月取，当月没配用默认）；missing = 有月份的单价没读到，那几个月的上网收益没算
export const pvRevRefs = (prices: number | number[], missing = false) => {
  const ps = [...new Set([prices].flat())].sort((a, b) => a - b)
  const grid = missing ? '上网单价没读到，这几个月的上网收益没算'
    : ps.length > 1 ? `上网按每月的系统上网单价 ¥${ps[0]}–${ps[ps.length - 1]}/kWh 算`
      : `上网按系统里的上网单价 ¥${ps[0]}/kWh 算`
  return [pvRef('口径', grid), pvRef('口径', '自用按录入时的单价算')]
}
// 按年：不是整年都有读数的楼。groups = 按第一条读数的月分组（晚并网的在前）；who = 两栋以内写楼名，整期写「二期」，其余「N 栋楼」。
// 只有一个月写「只有12月」，几个月写「只有 6–12月」（月份范围前空一格，同 pvBaseNote）；放不下 28 字改说栋数
export function pvRevShortRef(groups: { who: string; from: number; to: number; n: number }[]): PvSaid | null {
  if (!groups.length) return null
  const t = groups.map((g) => (g.from === g.to ? `${g.who}只有${monthLabel(g.from)}` : `${g.who}只有 ${monthSpan(g.from, g.to)}`)).join('，')
  return pvRef('thin', vlen(t) <= LIMIT.ref ? t : `${nB(groups.reduce((a, g) => a + g.n, 0))}不是全年都有读数`)
}

// ── 核对明细 ──
// q:并列的楼多到放不下时写「N 栋楼」(一位小数的百分比常有并列)
export const pvAlphaRead = (rows: { name: string; alpha: number }[]) => extremes({ metric: '常年水平', items: rows.map((r) => ({ label: r.name, value: r.alpha })), fmt: (v) => pctS(v), q: '栋楼' })
// 换种算法一栋名次都没变时不出第二句(计数为 0 不出句,S-28)
export const pvAlphaRefs = (n: number, moved: number) => [pvRef('口径', `按 ${nB(n)}全年每天的抄表算`), ...(moved ? [pvRef('count', `同一批数换种算法，${nB(n)}里 ${moved} 栋名次会变`)] : [])]
// 台账装机和板数 × 标称对不上的楼不进排序(录了板数才判得出),要写出是谁;楼名连起来放不下改写「N 栋楼」
export function pvAlphaExcl(names: string[]): PvSaid {
  const say = (who: string) => `${who}台账装机和板数对不上，不排`
  const t = say(pvJoin(names))
  return pvRef('thin', vlen(t) <= LIMIT.ref ? t : say(nB(names.length)))
}
export const pvHeatNote = (k: number) => `${nB(k)}在网太短，没算`
// 某期年内并网那个月,全园中间那栋被新楼拉低,老楼那一格冲到几百 %(颜色早就封顶):写出那几格的范围。
// p = 并网的那一期,p0 = 老的那一期;四位数放不下 28 字时只写最高那格
export function pvHeatRef(m: number, p: number, p0: number, n: number, lo: number, hi: number): PvSaid {
  const ph = (k: number) => `${'一二三四五'[k - 1] ?? k}期`
  const t = `${m}月${ph(p)}并网，${ph(p0)} ${nB(n)}在 ${pctS(lo)} 到 ${pctS(hi)}`
  return pvRef('口径', vlen(t) <= LIMIT.ref ? t : `${m}月${ph(p)}并网，${ph(p0)}最高 ${pctS(hi)}`)
}
export const pvHeatCapRef = (top: number) => pvRef('口径', `颜色到 ±${top.toFixed(1)}% 就是最深一档，再大也一样深`)
export const pvCalAll = () => '在网的都抄了'
// 在网的楼太少,「这天不算」(在网不足 N 栋的日子整天不进判定)这条规则本段没起作用 —— 日历上一格划痕都没有不等于没有该剔的天
export const pvCalFew = (n: number) => refOut(`全园在网不足 ${n} 栋，「${PV.calDrop}」这条规则本段没生效`)
export const pvTableRefs = (b: number, m: number) => [
  pvRef('口径', '名次 1 是常年水平最高；左边色条是连着偏离的楼'),
  pvRef('口径', `「${PV.table.ci}」按每栋全年每天的抄表估`),
  pvRef('口径', '「哪天起变了」跳过并网那个月再算'),
  // 隔 1 天的相关：负的是隔天一涨一落（也是相关，不是不相干）
  pvRef('口径', `「${PV.table.acf}」：近 1 同涨同落，近 0 不相干，负是一涨一落`),
  pvRef('口径', `「${PV.table.nul}」：${m}月日子打乱重算 ${b} 次里更偏的次数`),
  pvRef('口径', `次数越少，${m}月越不像碰巧；几百次就是常有的事`),
]

// ── 抽屉 ──
export const pvDriftRefs = () => [pvRef('口径', '纵轴是常年水平的几倍（扣掉全园当天涨落）；缺抄的天断开'), pvRef('thin', '跳过并网那个月再找，没找到水平变了的那天')]
export const pvBetaRef = () => pvRef('口径', '大于 1 是全园多发时它更多')
// 明细表一屏 8 行:k = 屏外还有几行(0 = 一屏放得下,不说滚);unit 按月档「天」、按年档「个月」
export const pvRowsRef = (k: number, unit: '天' | '个月') =>
  pvRef('口径', `${k > 0 ? `表内上下滚看其余 ${k} ${unit}；` : ''}空行是那${unit === '天' ? '天' : '个月'}没抄表`)
// 对数纵轴的字：e 的 v 次方，≥ 1 一位小数（整数不带小数），< 1 两位
export const pvTimesLabel = (v: number) => { const x = Math.exp(v); return '×' + (x >= 1 ? (Math.abs(x - Math.round(x)) < 0.05 ? String(Math.round(x)) : x.toFixed(1)) : x.toFixed(2)) }

// 异常提醒中心的光伏两条规则行、计数句、工具条在上面「异常提醒中心」段（PVR / pvRuleOver / pvRuleRun / pvCount / pvAsof），这里不另写
// 工具条：分栋抄表写成年内范围（S-34「2025年1–12月」），光伏月账到哪个月。月账取不到时只写前半句
export const pvMeterAsof = (y: number, m0: number, m1: number, rec?: string | null) =>
  `分栋抄表 ${yearLabel(y)}${monthSpan(m0, m1)}` + (rec ? ` · 光伏月账到 ${ymLabel(rec)}` : '')
