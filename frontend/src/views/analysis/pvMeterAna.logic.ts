// 光伏分栋分析 · 公式层(PV-ANALYSIS-SPEC §05)。全部纯函数:无 Vue 依赖、无 IO、可单测。
// 口径:eff(s,d) = 发电量 ÷ 装机容量(kWh/kWp);模型 eff = α(s)·β(d)·ε,取对数变可加,
// 用 Tukey 中位数抛光分离「这栋楼一贯的水平」α 与「当天的天气」β。单测 pvMeterAna.logic.spec.ts。
//
// 13 站 × 365 日 ≈ 4700 个点。实测整条 buildSnapshot(抛光 + 逐站变点检验 B=999 + 形状 BIC)
// 约 **100ms**,确实是设计稿说的毫秒级 —— 但那是把变点扫描换成前缀和之后的数:
// 逐点重算合并方差时是 837ms,B 还只有 199。见 pooledTScanner 的注释。

// ── 类型 ───────────────────────────────────────────────────────────────
export interface DayRow { stationId: number; date: string; gen: number }
export interface StationCfg { id: number; name: string; capKwp: number | null; metered: boolean }
export interface WeatherDay {
  date: string; ghiKwh: number; rainMm: number; isRain: boolean
  hours: number
  /** 24 位:第 h 位 = 该整点有记录。缺省(旧数据/夹具)时退回只看 hours */
  hourMask?: number
}

// ── 基本量 ─────────────────────────────────────────────────────────────

/** 等效小时 eff = 发电量 ÷ 装机容量(kWh/kWp)。装机容量不同的楼栋只有除掉容量才可比。 */
export function specificYield(gen: number, capKwp: number): number { return gen / capKwp }

/** 位图里的整点是否**连续**(自身首尾之间不缺一小时)。0 位 → 视为不连续。 */
export function hoursContiguous(mask: number): boolean {
  if (!mask) return false
  // 把最低位那串 1 之后的部分右移掉:连续时 mask 恰好是 (2^k−1)<<first
  const first = mask & -mask                       // 最低置位
  const shifted = mask / first                     // 对齐到第 0 位(mask 只有 24 位,安全)
  return (shifted & (shifted + 1)) === 0           // 全 1 才满足
}

/**
 * 可用日集合。**阈值只准打在 GHI 上** —— 这是整套方法里最容易自欺的一条:
 * 把阈值打在 gen 或 eff 上等于**优先删除故障楼的故障日**,过滤器吃掉了证据,
 * 剩下的数据当然显示一切正常。所以本函数只收 WeatherDay,连 DayRow 都不认识。
 *
 * ⚠ 完整性判的是**连续性,不是小时数**(2026-08-31 改)。原来写的是 `hours === 24`,
 *   而真实天气源根本给不出全天 24 行:很多导出只给白天那几个小时,日照长度还按季节变。
 *   「有几个小时」分不清「当天日照短」和「漏了几行」——
 *   而这两件事对日累计 GHI 的影响完全不同:
 *     · 清晨黄昏的整点,太阳贴地平线,GHI 近乎 0,缺了几乎不动日累计;
 *     · **中间时段缺一小时**,丢的是当天最强的那部分,日累计明显偏低。
 *   物理上分得清的是**位置**,所以判据是位图连不连续:有内部空洞 = 真丢数据 → 整日剔除;
 *   两头短 = 那天就是短 → 照用。
 *
 * minHours 只兜「稀疏得离谱」的日子(如整天只有两行),默认 6。
 *
 * 没有天气数据时调用方应给 medianPolish 传 null(不做天气过滤),并在屏上明说 ——
 * 返回空集合不等于「全过」。
 */
export function okDaySet(weather: WeatherDay[], ghiMinKwh: number, minHours = 6): Set<string> {
  return new Set(
    weather
      .filter(w => {
        if (w.ghiKwh < ghiMinKwh) return false
        if (w.hours < minHours) return false
        // 位图缺省(旧数据/夹具):退回原来的「满 24 行」口径,不擅自放宽
        return w.hourMask === undefined ? w.hours === 24 : hoursContiguous(w.hourMask)
      })
      .map(w => w.date),
  )
}

// ── 中位数抛光 ─────────────────────────────────────────────────────────
export interface PolishResult {
  mu: number
  alpha: Map<number, number>               // log 域,站固有水平
  beta: Map<string, number>                // log 域,当日天气
  resid: Map<number, Map<string, number>>  // 残差(只含真正进了矩阵的格子)
  iterations: number
  converged: boolean
}

const MAX_ITER = 20
const TOL = 1e-12

export function median(xs: number[]): number {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const h = s.length >> 1
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2
}

/**
 * Tukey 中位数抛光。迭代到收敛,**显式重锚** —— 不要依赖迭代的隐式性质。
 *
 * 为什么用中位数不用最小二乘:某站表坏报低时,均值基准会被整体拉塌,
 * 于是所有站看起来都「高于基准」,真正的故障站反而不报警。
 *
 * 可辨识性:(mu, α+c, β−c) 是同一个解,靠 median(α)=0 / median(β)=0 锚定。
 * 迭代只跑两三轮的话这两个约束只是**近似**成立,而 §5.5 的 logH 直接吃 β ——
 * 锚定漂移会原样变成一条假的全园趋势。所以收敛后再显式减一次中位数。
 *
 * @param okDays 天气可用日;传 null = 不做天气过滤(没有辐照数据的部署)
 * @param order 扫描顺序。默认行优先;工作台的收敛诊断会用 'col' 再跑一次 ——
 *              两种顺序下 α 排名若翻转,说明该结论**不稳,不上报**(§06.4 B 组)
 */
export function medianPolish(
  rows: DayRow[], stations: StationCfg[], okDays: Set<string> | null,
  order: 'row' | 'col' = 'row',
): PolishResult {
  // 1) 建 log(eff) 矩阵。跳过:未装表 / 未录容量 / 不在可用日 / gen<=0。
  //    gen<=0 的格子**绝不补齐** —— 补了残差恒为 0,离线 10 天的楼会算出「正常」(§5.1)。
  const cap = new Map<number, number>()
  for (const s of stations) if (s.metered && s.capKwp != null && s.capKwp > 0) cap.set(s.id, s.capKwp)

  const cell = new Map<number, Map<string, number>>()   // 站 → 日 → log(eff)
  const dates = new Set<string>()
  for (const r of rows) {
    const c = cap.get(r.stationId)
    if (c === undefined) continue
    if (okDays && !okDays.has(r.date)) continue
    if (!(r.gen > 0)) continue
    let byDate = cell.get(r.stationId)
    if (!byDate) { byDate = new Map(); cell.set(r.stationId, byDate) }
    byDate.set(r.date, Math.log(specificYield(r.gen, c)))
    dates.add(r.date)
  }

  const sids = [...cell.keys()]
  const alpha = new Map<number, number>(sids.map(s => [s, 0]))
  const beta = new Map<string, number>([...dates].map(d => [d, 0]))
  let mu = 0

  // 2) 行中位数 / 列中位数交替扫,直到不再动
  let iter = 0
  for (; iter < MAX_ITER; iter++) {
    let maxDelta = 0

    // 行(站):把该站残差的中位数挪进 α;行扫完把 α 的中位数收进 mu
    // (保持 median(α)=0 的形态,列扫才不会来回摆)
    const sweepRow = () => {
      for (const s of sids) {
        const byDate = cell.get(s)!
        const rs: number[] = []
        for (const [d, v] of byDate) rs.push(v - mu - alpha.get(s)! - beta.get(d)!)
        const m = median(rs)
        alpha.set(s, alpha.get(s)! + m)
        maxDelta = Math.max(maxDelta, Math.abs(m))
      }
      const ma = median([...alpha.values()])
      if (ma !== 0) { mu += ma; for (const s of sids) alpha.set(s, alpha.get(s)! - ma) }
    }
    // 列(日):把该日残差的中位数挪进 β
    const sweepCol = () => {
      for (const d of dates) {
        const rs: number[] = []
        for (const s of sids) {
          const v = cell.get(s)!.get(d)
          if (v !== undefined) rs.push(v - mu - alpha.get(s)! - beta.get(d)!)
        }
        const m = median(rs)
        beta.set(d, beta.get(d)! + m)
        maxDelta = Math.max(maxDelta, Math.abs(m))
      }
      const mb = median([...beta.values()])
      if (mb !== 0) { mu += mb; for (const d of dates) beta.set(d, beta.get(d)! - mb) }
    }
    if (order === 'row') { sweepRow(); sweepCol() } else { sweepCol(); sweepRow() }

    if (maxDelta <= TOL) { iter++; break }
  }

  // 重锚不在这里补一遍:循环里**每一轮末尾**都收拢过一次(见上面的 ma/mb 两处),
  // 无论从 break 还是 MAX_ITER 出来,median(α)=median(β)=0 都已成立。
  // 早先在这里放过一块「收尾重锚」,破坏验证时发现注掉它一条断言都不红 —— 是死代码,删了。

  // 3) 残差
  const resid = new Map<number, Map<string, number>>()
  for (const s of sids) {
    const byDate = cell.get(s)!
    const out = new Map<string, number>()
    for (const [d, v] of byDate) out.set(d, v - mu - alpha.get(s)! - beta.get(d)!)
    resid.set(s, out)
  }

  return { mu, alpha, beta, resid, iterations: iter, converged: iter < MAX_ITER }
}

// ── 显著性(PV-ANALYSIS-SPEC §5.3)──────────────────────────────────────
// 单测 pvMeterAnaTest.logic.spec.ts。

/**
 * 稳健尺度:用**一阶差分**估噪声,对阶跃和慢漂移几乎免疫。
 *
 * 直接对 r 取 MAD 的话,基线若含故障期 → 分子 r̄ 被拉小、分母 σ 被撑大 → 双杀,
 * 结果是**越坏的楼越不报警**,检测器对最严重的资产最沉默。
 * ÷√2 是因为一阶差分的方差是原序列的 2 倍(相邻独立时)。
 */
export function robustSigma(r: number[]): number {
  if (r.length < 2) return 0
  const d = r.slice(1).map((v, i) => v - r[i])
  return 1.4826 * median(d.map(Math.abs)) / Math.SQRT2
}

/** 跨栋收缩 + 下限。13 栋是免费信息;下限防电表读数取整导致 MAD=0 → z=∞。 */
export function shrinkSigma(sigmaS: number, sigmaPool: number, floor: number): number {
  return Math.max(Math.sqrt(0.5 * sigmaS ** 2 + 0.5 * sigmaPool ** 2), floor)
}

/** 确定性 LCG。**不用 Math.random** —— 同一份数据两次打开屏必须给同一个 p,否则用户会以为系统在乱跳。 */
function lcg(seed: number): () => number {
  let s = (seed >>> 0) || 1
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
}

/**
 * 循环分块自助。块长 = 去相关时间的 2~3 倍(光伏取 14~21 天),一套机械同时吸收
 * 自相关、异方差、非正态。
 *
 * **单侧** —— 发电偏高几乎从不是故障;正侧偏离归类为「数据质量告警」
 * (表重复计量 / 容量台账错 / 镜像伪影),不是性能告警。
 *
 * p = (1 + #{null <= obsMean}) / (B + 1) —— 两处 +1 不是洁癖:省掉会得到 p=0,
 * 而 p=0 会让后面的 BH 排序失去意义。
 */
export function blockBootstrapP(
  baseline: number[], obsMean: number, winLen: number,
  opts: { block?: number; B?: number; seed?: number } = {},
): { p: number; nullDist: number[] } {
  const block = Math.max(1, opts.block ?? 14)
  const B = opts.B ?? 999
  const rnd = lcg(opts.seed ?? 20260831)
  const n = baseline.length
  const nullDist: number[] = []
  if (n === 0 || winLen <= 0) return { p: 1, nullDist }

  for (let b = 0; b < B; b++) {
    let sum = 0
    let filled = 0
    while (filled < winLen) {
      const start = Math.floor(rnd() * n)          // 循环分块:块可以跨过序列末尾绕回开头
      const take = Math.min(block, winLen - filled)
      for (let k = 0; k < take; k++) sum += baseline[(start + k) % n]
      filled += take
    }
    nullDist.push(sum / winLen)
  }
  const le = nullDist.reduce((c, v) => c + (v <= obsMean ? 1 : 0), 0)
  return { p: (1 + le) / (B + 1), nullDist }
}

/**
 * √N 正态 p —— **只用于工作台里跟块自助并排展示差多少**,绝不参与判定。
 * 光伏日残差 ρ≈0.5 时它报 p=0.05,实际是 0.25。
 */
export function naiveNormalP(baseline: number[], obsMean: number, winLen: number): number {
  const n = baseline.length
  if (n < 2 || winLen <= 0) return 1
  const m = baseline.reduce((a, b) => a + b, 0) / n
  const sd = Math.sqrt(baseline.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1))
  if (sd === 0) return 1
  const z = (obsMean - m) * Math.sqrt(winLen) / sd
  return normCdf(z)   // 单侧下尾,与块自助同口径
}

/** 标准正态 CDF(Abramowitz–Stegun 7.1.26 的误差函数近似,精度 1.5e-7,够用) */
function normCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z))
  const d = 0.3989422804014327 * Math.exp(-z * z / 2)
  const p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))))
  return z < 0 ? p : 1 - p
}

/**
 * Benjamini–Hochberg。**注意族的大小**:不是 13 个检验,是 13栋 × 窗口数 × 统计量数。
 * 调用方须**预注册**每栋一个主窗口 + 一个主统计量,其余标为描述性、不参与判定。
 * 返回值按**入参下标**对齐(内部排序不影响外部顺序)。
 */
export function bhFdr(pvals: number[], q = 0.05): boolean[] {
  const n = pvals.length
  const out = new Array<boolean>(n).fill(false)
  if (!n) return out
  const idx = pvals.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p)
  let kMax = -1
  for (let k = 0; k < n; k++) if (idx[k].p <= ((k + 1) / n) * q) kMax = k
  for (let k = 0; k <= kMax; k++) out[idx[k].i] = true
  return out
}

// ── 变点与形状(PV-ANALYSIS-SPEC §5.4)──────────────────────────────────

export interface ChangePoint {
  index: number
  ciLo: number
  ciHi: number
  p: number
  dropPct: number
}

/**
 * 合并方差下的两段 t 统计量,**前缀和版**。**不用 Welch** —— 短段方差估计不稳,边界直接爆。
 *
 * 为什么要前缀和:变点扫描要对每个切点各算一次 t,而零分布又要把整趟扫描重复 B 次。
 * 逐点重算是 O(切点 × n),365 天 × 250 个切点 = 9 万次运算/趟,B=999 时一个站就是 9 千万次
 * (实测整屏 837ms,全压在这里)。前缀和让每个切点 O(1),一趟降到 O(n),快两个数量级。
 * 平方和求方差在数值上不如两遍法稳,但这里的量级(残差 ~0.1)离精度悬崖很远,够用。
 */
function pooledTScanner(r: number[]): (cut: number) => number {
  const n = r.length
  const S = new Float64Array(n + 1)
  const Q = new Float64Array(n + 1)
  for (let i = 0; i < n; i++) { S[i + 1] = S[i] + r[i]; Q[i + 1] = Q[i] + r[i] * r[i] }
  return (cut: number): number => {
    const n1 = cut, n2 = n - cut
    if (n1 < 2 || n2 < 2) return 0
    const s1 = S[cut], s2 = S[n] - S[cut]
    const m1 = s1 / n1, m2 = s2 / n2
    const v1 = Q[cut] - (s1 * s1) / n1
    const v2 = (Q[n] - Q[cut]) - (s2 * s2) / n2
    const sp2 = (v1 + v2) / (n - 2)
    if (sp2 <= 0) return 0
    return (m2 - m1) / Math.sqrt(sp2 * (1 / n1 + 1 / n2))
  }
}

/** 循环分块置换一条序列。**逐日置换会摧毁自相关**,零分布被压得过窄,比不置换还激进。 */
function blockPermute(r: number[], block: number, rnd: () => number): number[] {
  const n = r.length
  const out: number[] = []
  while (out.length < n) {
    const start = Math.floor(rnd() * n)
    for (let k = 0; k < block && out.length < n; k++) out.push(r[(start + k) % n])
  }
  return out
}

/**
 * 单变点扫描。max|t| **不服从 t 分布**(是布朗桥型极值分布),直接查 t 表虚警率从 5% 飙到 40%+,
 * 所以零分布用循环分块置换现算。
 *
 * 两端修剪 15%:边界处一段只有几个点,t 统计量会无意义地爆掉。
 *
 * ciLo/ciHi **必须给** —— argmax 有赢家诅咒,中等效应下 95% CI 常有 ±3~4 周。
 * 区间取 |t| 在极大值 2 个单位以内的那一段(profile 法,便宜且够用)。
 *
 * ⚠ 区间宽度是**效应强度的函数**:6σ 的阶跃真就定位到一两天,此时 ciLo≈ciHi 是正确结果,
 *   不要在这里补一个「至少 ±N 天」的下限 —— 那是往数据里掺假。
 *   要负责的是**界面**:窄区间照实写日期,宽区间必须写成「7 月中旬 · 区间 7/11–7/26 — 不是精确到天」。
 *   第二层的变点标注按 ciHi−ciLo 选措辞,不要固定一种(§06.2)。
 *
 * dropPct 用**样本分割**去偏:奇数日找变点、偶数日估落差 —— 同一批数据既选点又估幅度会高估。
 */
export function changePoint(
  r: number[], opts: { block?: number; B?: number; seed?: number; trim?: number } = {},
): ChangePoint {
  const n = r.length
  const trim = opts.trim ?? 0.15
  const block = Math.max(1, opts.block ?? 14)
  const B = opts.B ?? 999
  const lo = Math.max(2, Math.floor(n * trim))
  const hi = Math.min(n - 2, Math.ceil(n * (1 - trim)))
  const empty: ChangePoint = { index: -1, ciLo: -1, ciHi: -1, p: 1, dropPct: 0 }
  if (hi <= lo) return empty

  const tOf = (series: number[]) => {
    const t1 = pooledTScanner(series)
    let best = 0, at = -1
    const ts: number[] = new Array(n).fill(0)
    for (let c = lo; c <= hi; c++) {
      const t = Math.abs(t1(c))
      ts[c] = t
      if (t > best) { best = t; at = c }
    }
    return { best, at, ts }
  }

  const obs = tOf(r)
  if (obs.at < 0) return empty

  // 置换次数决定 p 的**下限**:B 次置换下 p 最小是 1/(B+1)。
  // 这个下限会直接卡死红灯 —— BH 在 n 个站的族里要求 p ≤ q/n,n=11、q=0.05 时是 0.00455,
  // 而 B=199 的下限是 0.005,**结构上永远够不到**。实测:种入的 −28% 阶跃 p=0.005、
  // 落差 26.9%、年化 ¥21 万,各项都对,却因为 q=0.055 只能判黄灯(§08 验收① 过不了)。
  //
  // 所以 B 提到 999(下限 0.001)。为了不让代价跟着涨 5 倍,加**提前终止**:
  // 一旦已经有 earlyGe 次置换打平或超过观测值,p 必然远高于任何门槛,再算下去不改变结论。
  // 没信号的站几十次就停,只有真有信号的那栋才付满额 —— 总开销反而比原来低。
  const rnd = lcg(opts.seed ?? 20260831)
  const earlyGe = 30
  let ge = 0
  let done = 0
  for (let b = 0; b < B; b++) {
    done = b + 1
    if (tOf(blockPermute(r, block, rnd)).best >= obs.best) ge++
    if (ge >= earlyGe) break
  }
  // 提前停时用**实际跑过的次数**算 p:这时 p 已经大得没有悬念,精度无所谓,但不能拿 B 当分母充数
  const p = (1 + ge) / (done + 1)

  // profile 区间:|t| 掉不到极大值 2 个单位以内的那一段
  const thr = obs.best - 2
  let ciLo = obs.at, ciHi = obs.at
  for (let c = obs.at; c >= lo && obs.ts[c] >= thr; c--) ciLo = c
  for (let c = obs.at; c <= hi && obs.ts[c] >= thr; c++) ciHi = c

  // 样本分割去偏:偶数下标估落差
  const even = r.filter((_, i) => i % 2 === 0)
  const cutEven = Math.round(obs.at / 2)
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
  const before = mean(even.slice(0, cutEven))
  const after = mean(even.slice(cutEven))
  // 残差在 log 域,落差换成百分比
  const dropPct = (1 - Math.exp(after - before)) * 100

  return { index: obs.at, ciLo, ciHi, p, dropPct }
}

export type Shape = 'flat' | 'step' | 'ramp' | 'sawtooth' | 'spike'

/**
 * 形状判定。**别指望变点算法回答形状** —— 拟一个小形状库,同一条残差上比 BIC。
 * 五种形状对应五种完全不同的动作(§5.4 表),判错了派错人:
 *   step 现场检查 / ramp 测直流侧压降 / sawtooth 可安排清洗 / flat 先核对容量台账 / spike 对运维台账。
 *
 * sawtooth 与 ramp 只差「雨后回不回弹」这一条,所以 rainDays 是必需入参而不是可选。
 */
export function classifyShape(r: number[], rainDays: boolean[]): { shape: Shape; bic: number } {
  const n = r.length
  if (n < 8) return { shape: 'flat', bic: Infinity }

  const rss = (fit: number[]) => r.reduce((a, v, i) => a + (v - fit[i]) ** 2, 0)
  const bic = (fit: number[], k: number) => n * Math.log(Math.max(rss(fit), 1e-18) / n) + k * Math.log(n)
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

  // flat:一个常数
  const m = mean(r)
  const fFlat = new Array(n).fill(m)

  // step:在最优割点处两段常数
  const cp = changePoint(r, { B: 0, block: 14 })
  const cut = cp.index > 0 ? cp.index : n >> 1
  const m1 = mean(r.slice(0, cut)), m2 = mean(r.slice(cut))
  const fStep = r.map((_, i) => (i < cut ? m1 : m2))

  // ramp:最小二乘直线
  const xs = r.map((_, i) => i)
  const mx = mean(xs), my = m
  let sxy = 0, sxx = 0
  for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (r[i] - my); sxx += (xs[i] - mx) ** 2 }
  const slope = sxx ? sxy / sxx : 0
  const fRamp = xs.map(x => my + slope * (x - mx))

  // sawtooth:「距上一个雨日的天数」的线性函数 —— 灰尘累积、雨后清零
  const since: number[] = []
  let k = 0
  for (let i = 0; i < n; i++) { if (i > 0 && rainDays[i - 1]) k = 0; else k++; since.push(k) }
  const ms = mean(since)
  let sxy2 = 0, sxx2 = 0
  for (let i = 0; i < n; i++) { sxy2 += (since[i] - ms) * (r[i] - my); sxx2 += (since[i] - ms) ** 2 }
  const slope2 = sxx2 ? sxy2 / sxx2 : 0
  const fSaw = since.map(s => my + slope2 * (s - ms))

  // spike:单点离群,其余为常数
  let peak = 0
  for (let i = 1; i < n; i++) if (Math.abs(r[i] - m) > Math.abs(r[peak] - m)) peak = i
  const restMean = mean(r.filter((_, i) => i !== peak))
  const fSpike = r.map((_, i) => (i === peak ? r[peak] : restMean))

  const cands: { shape: Shape; bic: number }[] = [
    { shape: 'flat', bic: bic(fFlat, 1) },
    { shape: 'step', bic: bic(fStep, 3) },       // 两段均值 + 割点
    { shape: 'ramp', bic: bic(fRamp, 2) },
    { shape: 'sawtooth', bic: bic(fSaw, 2) },
    { shape: 'spike', bic: bic(fSpike, 3) },     // 常数 + 峰位 + 峰值
  ]
  return cands.reduce((a, b) => (b.bic < a.bic ? b : a))
}

// ── 外部锚(PV-ANALYSIS-SPEC §5.5)────────────────────────────────────────
// 单测 pvMeterAnaMoney.logic.spec.ts。

/**
 * 全园健康度。β(d) 是从 13 栋**自己**算出来的 —— 全园同步劣化(集体积灰、同批组件衰减)时
 * 基准跟着一起掉,残差纹丝不动。logH 的趋势是**唯一**能看见「大家一起在变差」的通道。
 *
 * **必须在 log 域做差,不是比值** —— 比值分母趋零时 Cauchy 化,没有有限矩,
 * 均值方差正态近似全部失效。GHI 为 0 的日子直接不进(夜间/无数据,不是电站的事)。
 */
export function parkHealth(
  polish: PolishResult, weather: WeatherDay[],
): { date: string; logH: number }[] {
  return weather
    .filter(w => polish.beta.has(w.date) && w.ghiKwh > 0)
    .map(w => ({ date: w.date, logH: polish.beta.get(w.date)! - Math.log(w.ghiKwh / 1000) }))
}

/**
 * 辐照源自检。晴空指数 kt = GHI / GHI_clearsky 的 **95 分位**在健康时应稳定贴近 1.0;
 * 逐月下滑 = **数据源脏了不是电站坏了**(传感器积灰、供应商换模型、单位改了)。
 *
 * 约 15 行,能挡掉全链路最丢人的一类误报:拿一个越来越低的辐照当基准,
 * 会把全园判成「一起在变差」,而实际上电站好好的。
 *
 * @param clearSky 给定日期的晴空 GHI(kWh/m2)。没有天文模型时传一个按月的经验上限即可。
 */
export function clearSkyCheck(
  weather: WeatherDay[], clearSky: (date: string) => number,
): { suspect: boolean; reason: string; byMonth: { ym: string; kt95: number }[] } {
  const byMonth = new Map<string, number[]>()
  for (const w of weather) {
    const cs = clearSky(w.date)
    // 与 okDaySet 同一口径:判连续性不判个数。写 hours!==24 的话真实数据一天都进不来,
    // kt 自检永远返回「月份不足,暂不判定」—— 一条静默失效的自检比没有还坏
    if (!(cs > 0)) continue
    if (w.hours < 6) continue
    if (w.hourMask === undefined ? w.hours !== 24 : !hoursContiguous(w.hourMask)) continue
    const ym = w.date.slice(0, 7)
    const arr = byMonth.get(ym) ?? []
    arr.push(w.ghiKwh / cs)
    byMonth.set(ym, arr)
  }
  const rows = [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    .map(([ym, kts]) => {
      const s = [...kts].sort((a, b) => a - b)
      return { ym, kt95: s[Math.min(s.length - 1, Math.floor(s.length * 0.95))] }
    })
  if (rows.length < 3) return { suspect: false, reason: '月份不足,暂不判定', byMonth: rows }

  // 首月与末月的 95 分位比:掉超过 10% 就该先怀疑数据源
  const drop = 1 - rows[rows.length - 1].kt95 / rows[0].kt95
  return drop > 0.10
    ? { suspect: true, reason: `晴空指数上包络逐月下滑 ${(drop * 100).toFixed(0)}% —— 先查数据源,不要当成电站衰减`, byMonth: rows }
    : { suspect: false, reason: '晴空指数上包络稳定', byMonth: rows }
}

// ── 先天缺陷通道(PV-ANALYSIS-SPEC §5.6)──────────────────────────────────

export interface CongenitalRow {
  id: number
  name: string
  alphaPct: number   // 相对全园中位数的百分比偏离(+ 高 / − 低)
  ciLo: number
  ciHi: number
  suspect: boolean
  advice: string
}

/**
 * α 排序 = 一张验收检查表。持续偏低的 α 是「疑似先天缺陷」,**不是**突发故障 ——
 * 两者派给不同的人:先天缺陷派工程师核图纸,突发异常派运维上屋顶。
 *
 * ⚠ 运维一号陷阱:**α 长期垫底最常见的原因不是设备坏,是装机容量台账写错。**
 *   cap 少写 10%,α 就永远偏 10%,派人上去查三次查不出东西,第四次就没人理这系统了。
 *   所以建议文案**必须是「先核对装机容量台账」**。
 *
 * CI 用**块自助**算。naive SE 在 σ≈8%、365 天下约 0.4%,13 个点的 CI 互不重叠,
 * 图上会显示「每栋楼都显著不同」,用户第一反应是「你这系统天天报警」。
 */
export function congenitalCheck(
  polish: PolishResult, stations: StationCfg[],
  opts: { block?: number; B?: number; seed?: number; suspectPct?: number } = {},
): CongenitalRow[] {
  const B = opts.B ?? 399
  const block = Math.max(1, opts.block ?? 10)
  const suspectPct = opts.suspectPct ?? 8
  const byId = new Map(stations.map(s => [s.id, s]))
  const rnd = lcg(opts.seed ?? 20260831)

  return [...polish.alpha.entries()].map(([id, a]) => {
    const all = [...(polish.resid.get(id)?.values() ?? [])]
    // **先中心化**:抛光锚的是残差**中位数**为 0,不是均值。不减掉均值的话
    // draws 会整体偏到 α + mean(resid) 上 —— 区间可能压根不包含自己的点估计
    // (实测:某站 α=0% 而区间 −23%~−12%)。工作台的 α 排序图上那就是一眼假。
    const m0 = all.length ? all.reduce((x, y) => x + y, 0) / all.length : 0
    const resid = all.map(v => v - m0)
    // 块自助 α 的抽样分布:重采样(中心化后的)残差块加回 α,取分位
    const draws: number[] = []
    const n = resid.length
    for (let b = 0; b < B && n > 0; b++) {
      let sum = 0
      let filled = 0
      while (filled < n) {
        const start = Math.floor(rnd() * n)
        const take = Math.min(block, n - filled)
        for (let k = 0; k < take; k++) sum += resid[(start + k) % n]
        filled += take
      }
      draws.push(a + sum / n)
    }
    draws.sort((x, y) => x - y)
    const q = (p: number) => (draws.length ? draws[Math.min(draws.length - 1, Math.floor(draws.length * p))] : a)
    const pct = (v: number) => (Math.exp(v) - 1) * 100

    const alphaPct = pct(a)
    const ciLo = pct(q(0.025))
    const ciHi = pct(q(0.975))
    // 疑似先天缺陷:整个区间都在门槛之下(不是只有点估计低)
    const suspect = ciHi < -suspectPct
    return {
      id, name: byId.get(id)?.name ?? String(id), alphaPct, ciLo, ciHi, suspect,
      advice: suspect ? '先核对装机容量台账（台账写错比设备坏常见得多）' : '',
    }
  }).sort((x, y) => x.alphaPct - y.alphaPct)
}

// ── 换算成钱(PV-ANALYSIS-SPEC §5.7)──────────────────────────────────────

/**
 * 缺口金额 = 应发 − 实发,按**自用电价**折算 —— 少发的那度要从电网买回来,
 * 损失的是自用电价(0.7~1.2 元分时),不是上网标杆价(0.39 元)。搞错了整屏的数就是错的。
 * 实发多于应发不算「负缺口」:那属于数据质量告警,不进钱这条线。
 */
export function gapMoney(expectedKwh: number, actualKwh: number, selfUsePrice: number): number {
  return Math.max(0, expectedKwh - actualKwh) * selfUsePrice
}

/** 金额门槛:红灯年化 ¥5,000;黄灯 ¥2,000(见下方说明)。 */
export const RISK_ANNUAL_GAP = 5000
export const WATCH_ANNUAL_GAP = 2000

/**
 * 亮灯的三重门槛。**显著性只是入场券,金额才是排序键,金额门槛才是过滤器。**
 *
 * 一个统计上 q=0.001 但年化只差 ¥800 的变点,**绝不该出现在屏上**。
 * 13 栋楼之间 2% 的 α 差异在一年数据下就「统计显著」,但那可能只是朝向差异。
 * 「运维平台是被误报杀死的,从来不是被漏报杀死的。」
 *
 * ⚠ 黄灯也要过金额门槛(WATCH_ANNUAL_GAP,2026-08-31 落地时补)。
 *   设计稿的判定里只有红灯带金额条件,黄灯是 `q<0.20 && days>=7` —— 于是上面那个
 *   「年化 ¥800」的例子会落到 watch,点亮「需关注」灯,**照样出现在屏上**,
 *   与它自己那句「绝不该出现在屏上」直接打架。黄灯没有金额下限,等于把
 *   「统计上看得见但没人会去管」的那一大批全放进屏里,正是这条规则要防的误报洪水。
 *   ¥2,000/年 ≈ ¥170/月:低于这个数没人会为它派工。这个数值可调,但**不能没有**。
 */
export function alertLevel(x: { q: number; days: number; annualGap: number }): 'risk' | 'watch' | 'ok' {
  if (x.q < 0.05 && x.days >= 14 && x.annualGap >= RISK_ANNUAL_GAP) return 'risk'
  if (x.q < 0.20 && x.days >= 7 && x.annualGap >= WATCH_ANNUAL_GAP) return 'watch'
  return 'ok'
}

// ── 快照:一份数据、一次计算、一个 id(PV-ANALYSIS-SPEC §06.4 铁律)────────────
//
// 整屏**只跑这一次**。第一层渲染它的摘要视图,工作台渲染它的完整视图,两边共用 id 并都显示在页脚。
// **工作台永远不是另一次计算** —— 对不上的时候要能在 30 秒内定位到是哪一层渲染错了,而不是怀疑模型。

/** 抄表行(结构上兼容 DayRow,可直接喂 medianPolish) */
export interface ReadingRow {
  stationId: number; date: string
  gen: number; selfUse: number; gridFeed: number; revenue: number
  priceSnap: number | null
}

export interface SnapshotInput {
  year: number
  stations: StationCfg[]
  rows: ReadingRow[]
  weather: WeatherDay[]
  gridPrice: number       // 上网标杆价 元/kWh
  ghiMinKwh?: number      // 低出力日阈值,**只打在 GHI 上**
  minStations?: number    // 当日参与站下限,低于它当天整屏降级
  minDays?: number        // 某站有效日下限,低于它不出结论
  winDays?: number        // 预注册主窗口长度
  prevRows?: ReadingRow[] // 上一年抄表(同比用)。不传 = 没取过,同比位显「—」不显「0%」
  qualityPct?: number     // 正侧偏离超过它 = 数据质量告警(容量台账错),不是性能好
}

export interface StationResult {
  id: number; name: string
  status: 'ok' | 'watch' | 'risk' | 'mute'
  statusLabel: string
  revenue: number
  gapMoney: number
  gapKwh: number
  relPct: number | null     // 相对园区中位水平 %
  days: number              // 有效日数
  annualGap: number
  q: number
  shape: Shape | null
  cp: ChangePoint | null
  situation: string         // 表格「情况」列 —— 人话,无统计术语
  advice: string            // 表格「建议」列
  detail: StationDetail | null   // 第二层逐日明细;不参与判定的站为 null
}

export interface AnaSnapshot {
  id: string
  year: number
  ym: string                // 主口径月(该年最后一个有抄表的月)
  stations: StationResult[]
  park: {
    revenue: number; selfKwh: number; gridKwh: number
    gap: number; gapKwh: number; gapPct: number | null
    counts: { ok: number; watch: number; risk: number; mute: number }
    topGaps: { name: string; gap: number }[]
  }
  monthly: { labels: string[]; kwh: number[]; actual: number[]; due: number[] }
  quality: {
    totalDays: number; okDays: number
    droppedHours: number; droppedLowGhi: number
    noCapacity: string[]; noMeter: string[]
    minStationsOnDay: number; droppedThin: number; tooFewStations: boolean; degraded: boolean
    hasWeather: boolean
    /** 有抄表但**没有天气行**的日子数 —— 这些天照常进模型,但没被辐照筛过,要如实报出 */
    unscreenedDays: number
    /** 天气覆盖率 = 被筛过的抄表日 ÷ 全部抄表日 */
    weatherCoverage: number
  }
  yoy: {
    monthPct: number | null   // 主口径月 vs 去年同月;null = 没得比
    monthNote: string
    yearPct: number | null    // 整年,**按两年都有抄表的月对齐**后再比
    yearMonths: number        // 对齐后参与的月数(必须报出来)
    yearNote: string
  }
  polish: PolishResult
  /** 抛光**真正用过**的日集合(已剔掉低辐照/缺小时/参与站不足的日子);null = 没做任何日过滤。
   *  工作台的收敛诊断必须拿这一份重跑,自己再算一遍会混进第二个变量,隔离不出扫描顺序。 */
  usedDays: Set<string> | null
  health: { date: string; logH: number }[]
  congenital: CongenitalRow[]
}

/** FNV-1a:内容派生的短 id。同一份数据两次算必须同一个 id —— 页脚要拿它对账。 */
function fnv1a(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

const YM = (d: string) => d.slice(0, 7)

const STATUS_ZH: Record<StationResult['status'], string> =
  { ok: '正常', watch: '需关注', risk: '异常', mute: '数据不全' }

function daysInYm(ym: string): number {
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m, 0).getDate()
}

/** BH 的 q 值(不是布尔),逐点用于排序与判档 */
export function bhFdrQ(pvals: number[]): number[] {
  const n = pvals.length
  const out: number[] = new Array(n).fill(1)
  if (!n) return out
  const idx = pvals.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p)
  let prev = 1
  for (let k = n - 1; k >= 0; k--) {
    prev = Math.min(prev, (idx[k].p * n) / (k + 1))
    out[idx[k].i] = Math.min(1, prev)
  }
  return out
}

/** 「7 月中旬」这类说法 —— 变点给不了天级精度,文案就不要假装有 */
function monthPhrase(date: string): string {
  const d = Number(date.slice(8, 10))
  const m = Number(date.slice(5, 7))
  return `${m} 月${d <= 10 ? '上旬' : d <= 20 ? '中旬' : '下旬'}`
}

/**
 * 「情况」列文案。**第一层不出现任何统计术语** —— p / q / 正负两倍标准差 / 显著 / 残差 / 归一化
 * 一个都不许露(§06「不确定性怎么说」的黑名单)。不确定性用语言标签 + 数值区间表达。
 */
function situationOf(
  status: StationResult['status'], shape: Shape, cp: ChangePoint, resid: { date: string; v: number }[],
): string {
  if (status === 'ok') return '正常'
  const at = cp.index >= 0 && cp.index < resid.length ? resid[cp.index].date : null
  const when = at ? monthPhrase(at) : null
  switch (shape) {
    case 'step': return when ? `${when}起明显下降,之前正常` : '某个时点起明显下降'
    case 'ramp': return '一路慢慢变低,下雨之后也没回来'
    case 'sawtooth': return '越来越低,每次下雨之后又好一些'
    case 'spike': return '只有个别几天异常,前后都正常'
    default: return '一直偏低,不是新问题'
  }
}

/** 「建议」列。派给不同的人 —— 先天缺陷派工程师核图纸,突发异常派运维上屋顶。
 *  导出只为单测:default 分支(显著但无形状)在整链夹具里难可靠造出来,直接测这张映射表。 */
export function adviceOf(status: StationResult['status'], shape: Shape): string {
  if (status === 'ok') return '保持'
  switch (shape) {
    case 'step': return '现场检查'
    case 'ramp': return '测直流侧压降;看现场遮挡'
    case 'sawtooth': return '可安排清洗'
    case 'spike': return '对运维台账,多半不是设备问题'
    // flat + 水平偏低:**先核对装机容量台账**,不是「现场检查」。
    // 台账写错比设备坏常见得多,派人查三次查不出东西,第四次就没人理这系统了(§5.6)。
    default: return '先核对装机容量台账'
  }
}

/** 近 13 个月:柱=发电量 实线=实际收益 虚线=应得收益 */
function monthly13(
  rows: ReadingRow[], yms: string[], gridPrice: number,
  polish: PolishResult, stations: StationCfg[],
): AnaSnapshot['monthly'] {
  const take = yms.slice(-13)
  const capOf = new Map(stations.map(s => [s.id, s.capKwp]))
  const acc = new Map(take.map(m => [m, { kwh: 0, actual: 0, due: 0 }]))
  for (const r of rows) {
    const a = acc.get(YM(r.date))
    if (!a) continue
    const money = r.revenue + r.gridFeed * gridPrice
    a.kwh += r.gen
    a.actual += money
    const cap = capOf.get(r.stationId)
    const al = polish.alpha.get(r.stationId)
    const be = polish.beta.get(r.date)
    if (cap != null && al !== undefined && be !== undefined && r.gen > 0) {
      const expected = Math.exp(polish.mu + al + be) * cap
      // 应得收益 = 实际收益 × 应发÷实发(按同一单价结构折算,不另引一套价)
      a.due += money * (expected / r.gen)
    } else {
      a.due += money
    }
  }
  return {
    labels: take,
    kwh: take.map(m => acc.get(m)!.kwh),
    actual: take.map(m => acc.get(m)!.actual),
    // 应得不可能低于实际:折算里个别日的 expected 略低会让和数掉下去,那是数值噪声不是「超额」
    due: take.map(m => Math.max(acc.get(m)!.due, acc.get(m)!.actual)),
  }
}

export function buildSnapshot(input: SnapshotInput): AnaSnapshot {
  const {
    year, stations, rows, weather, gridPrice,
    ghiMinKwh = 1.0, minStations = 8, minDays = 20, winDays = 30, prevRows, qualityPct = 50,
  } = input

  // ① 可用日。**阈值只打在 GHI 上**;没有天气数据时不做天气过滤(传 null),并在质量记录里说明
  const hasWeather = weather.length > 0
  const readDates = new Set(rows.map(r => r.date))
  const screened = hasWeather ? okDaySet(weather, ghiMinKwh) : null
  const weatherDates = new Set(weather.map(w => w.date))

  // **天气只是用来筛掉坏日子的,不是模型输入。**
  // 没有天气行的日子 ≠ 坏日子 —— 我们只是不知道它好不好。把它连发电数据一起丢掉,
  // 等于为了「不知道」而扔掉真数据。实测形态:用户按月分批导天气,先导了上半年,
  // 下半年的抄表就整整半年不进模型,而屏上还写着「模型用 2025 全年数据」。
  //
  // 所以进模型的是「筛过且合格」∪「压根没筛过」,被排除的只有**明确判定为坏**的那些。
  // 代价是未筛日会混入低辐照日,噪声大一点;但**不引入偏倚** ——
  // 筛选条件打在 GHI 上而不是 gen 上(§5.1),漏筛不会优先保留或删除故障楼的日子。
  // 未筛天数必须报出来:§07 的文化是不确定一律显式暴露。
  const unscreened = [...readDates].filter(d => !weatherDates.has(d))
  const okDays = screened
    ? new Set([...screened, ...unscreened])
    : null

  // 「当天气象数据有缺」= 有天气行但位图有空洞/稀疏得离谱,不是「不满 24 行」
  const droppedHours = hasWeather
    ? weather.filter(w => !screened!.has(w.date) && w.ghiKwh >= ghiMinKwh).length
    : 0
  const droppedLowGhi = hasWeather ? weather.filter(w => w.ghiKwh < ghiMinKwh).length : 0

  // ② 分档:未装表 / 未录容量 —— 两者都不进分析,但**必须分开列名**(§07 第一、二行)
  const noMeter = stations.filter(s => !s.metered).map(s => s.name)
  const noCapacity = stations.filter(s => s.metered && (s.capKwp == null || s.capKwp <= 0)).map(s => s.name)

  // ③ 抛光(④ 里若发现参与站不足的日子,剔掉后会重算一次)
  const polish0 = medianPolish(rows, stations, okDays)

  // ④ 当日参与站数:4 栋掉线就能污染中位数 β,导致全园当天集体误报。
  //    **这些日子要整日剔除**,不是"横幅告知一下然后照算" —— 早先只挂了横幅说「不做楼栋之间的比较」,
  //    而屏上「相对园区」那列照样在、比较照做,等于屏在撒谎。剔掉再重算一次抛光。
  const countDay = (pr: PolishResult) => {
    const m = new Map<string, number>()
    for (const [, byDate] of pr.resid) for (const d of byDate.keys()) m.set(d, (m.get(d) ?? 0) + 1)
    return m
  }
  // 两种情况必须分开:
  //   · **少数日子**掉线到不足 → 剔那几天(下面 thinDays)
  //   · **整个园区**已装表楼栋就不够 → 不是掉线,是这园区根本做不了同类比较。
  //     这时不能按"剔天"处理 —— 那会把每一天都剔光,屏上啥都不剩且没人知道为什么。
  //     照 §07 降级为「仅同比,不做同类比较」:逐站结论全部收起,收益与同比照给。
  const parkStations = stations.filter(s2 => s2.metered && s2.capKwp != null && s2.capKwp > 0).length
  const tooFewStations = parkStations > 0 && parkStations < minStations
  const thinDays = tooFewStations
    ? []
    : [...countDay(polish0)].filter(([, n]) => n < minStations).map(([d]) => d)
  const okDays2 = thinDays.length
    ? new Set([...(okDays ?? new Set(rows.map(r => r.date)))].filter(d => !thinDays.includes(d)))
    : okDays
  const polish = thinDays.length ? medianPolish(rows, stations, okDays2) : polish0
  const perDay = countDay(polish)
  const minStationsOnDay = perDay.size ? Math.min(...perDay.values()) : 0
  const droppedThin = thinDays.length

  const health = hasWeather ? parkHealth(polish, weather) : []

  // ⑤ 主口径月 = 该年最后一个有抄表的月
  const yms = [...new Set(rows.map(r => YM(r.date)))].sort()
  const ym = yms[yms.length - 1] ?? `${year}-01`

  const byStation = new Map<number, ReadingRow[]>()
  for (const r of rows) {
    const a = byStation.get(r.stationId) ?? []
    a.push(r); byStation.set(r.stationId, a)
  }
  const priceOf = (rs: ReadingRow[]) => {
    const ps = rs.map(r => r.priceSnap).filter((v): v is number => v != null && v > 0)
    return ps.length ? median(ps) : 0
  }

  // ⑥ 逐站。**预注册的主统计量 = 变点检验**(max|t|,零分布走循环分块置换),每栋只此一个。
  //
  // ⚠ 为什么不是「最后 N 天的残差均值 vs 整条序列自助」——那是第一版的写法,它有一个致命形态:
  //   故障一旦占掉大半观测期(7/19 起坏、只看到年底 = 45% 的日子),抛光会把那个水平吸进 α,
  //   而**基线里也全是故障期**,于是观测窗口一点都不"极端",p 反而不小。
  //   §5.3 就 σ 警告过同一个形态:「基线若含故障期 → 双杀 → 越坏的楼越不报警,
  //   检测器对最严重的资产最沉默」。基线的选择上同样成立,规格里没写,是落地时实测出来的。
  //   变点检验对它免疫:它一次扫遍所有切分点,不需要事先知道哪段是"正常"。
  //   窗口自助保留为**描述性**统计量(工作台的完整检验表要并排展示),不参与判定。
  const raw: {
    s: StationCfg; resid: { date: string; v: number }[]; pRaw: number
    cp: ChangePoint | null; winP: number
    gapKwh: number; gapMoneyVal: number; revenue: number; price: number
    detail: StationDetail
    balPct: number     // (发电 − 自消纳 − 上网) ÷ 发电;负得离谱 = 计量异常
    monthDays: number  // 主口径月这站有几天抄表 —— 本月那两列的可信度靠它
  }[] = []

  for (const s of stations) {
    if (!s.metered || s.capKwp == null || s.capKwp <= 0) continue
    const resid = [...(polish.resid.get(s.id) ?? new Map<string, number>())]
      .map(([date, v]) => ({ date, v }))
      .sort((a, b) => a.date.localeCompare(b.date))
    const rs = byStation.get(s.id) ?? []
    const price = priceOf(rs)

    // 应发 = exp(mu + α + β) × 容量;缺口只算**主口径月**(KPI 是本月口径)
    let gapKwh = 0
    let revenue = 0
    for (const r of rs) {
      if (YM(r.date) !== ym) continue
      revenue += r.revenue + r.gridFeed * gridPrice
      const b = polish.beta.get(r.date)
      const a = polish.alpha.get(s.id)
      if (b === undefined || a === undefined) continue
      const expected = Math.exp(polish.mu + a + b) * s.capKwp
      gapKwh += Math.max(0, expected - r.gen)
    }

    const base = resid.map(x => x.v)
    // 主统计量:变点检验。**单侧** —— 只有往下掉才算性能问题,往上是数据质量告警
    // B=999:BH 在十几个站的族里要求 p ≤ 0.05/n,B=199 的下限 0.005 够不到(见 changePoint 注释)。
    // 提前终止让没信号的站只跑几十次,所以这里提分辨率不等于提代价。
    const cp = base.length >= 8 ? changePoint(base, { block: 14, B: 999, seed: 20260831 }) : null
    const dropped = cp != null && cp.index >= 0 && cp.dropPct > 0
    const pRaw = dropped ? cp!.p : 1

    // 描述性:最后 winDays 天 vs 整条序列(工作台并排展示用,不参与判定)
    const win = resid.slice(-winDays)
    const obs = win.length ? win.reduce((x, y) => x + y.v, 0) / win.length : 0
    const winP = base.length >= 2 && win.length
      ? blockBootstrapP(base, obs, win.length, { block: 14, B: 999, seed: 20260831 }).p
      : 1

    raw.push({
      s, resid, pRaw, cp, winP, gapKwh, gapMoneyVal: gapMoney(gapKwh, 0, price), revenue, price,
      detail: buildDetail(rs, resid, s.capKwp, price, polish, s.id, cp),
      monthDays: rs.filter(r => YM(r.date) === ym).length,
      balPct: (() => {
        const g = rs.reduce((t, v) => t + v.gen, 0)
        return g > 0 ? rs.reduce((t, v) => t + (v.gen - v.selfUse - v.gridFeed), 0) / g : 0
      })(),
    })
  }

  // ⑦ BH-FDR 一次算完(族 = 参与判定的站),再逐站定档
  const qs = bhFdrQ(raw.map(x => x.pRaw))
  const medAlpha = median([...polish.alpha.values()])

  const results: StationResult[] = raw.map((x, i) => {
    const days = x.resid.length
    const annualGap = x.gapKwh * (365 / Math.max(1, daysInYm(ym))) * x.price
    const a = polish.alpha.get(x.s.id)
    const relPct = a === undefined ? null : (Math.exp(a - medAlpha) - 1) * 100

    // 只有月抄的站:**降级月频卡,不与日频站混排**(§07 第 7 行)。
    // N=12 与 N=247 的置信区间差一个量级,并排放会让人以为两者一样可信。
    // 必须排在「有效日不足」之前 —— 它不是数据缺,是节律不同,给「补录抄表」是错的建议。
    if (cadenceOf((byStation.get(x.s.id) ?? []).map(r => r.date)) === 'monthly') {
      return {
        id: x.s.id, name: x.s.name, status: 'mute' as const, statusLabel: '月频口径',
        revenue: x.revenue, gapMoney: 0, gapKwh: 0, relPct, days, annualGap: 0,
        q: 1, shape: null, cp: null,
        situation: '该栋按月抄表，不与日抄楼栋放在一起比', advice: '如需逐日判断，改为按日抄表', detail: null,
      }
    }

    // 计量异常:自消纳 + 上网 比发电总量还多,物理上不可能 —— 表接错、重复计量或录入错。
    // (这条是从 PvRoiView 卸掉的「消纳结构」区里接过来的:那边算 损耗 = 发电 − 自消纳 − 上网,
    //  负值标红点。整块删掉的话这个检查就没了,所以搬到这条数据质量通道上。)
    // 容差 1%:抄表四舍五入会带出零点几个百分点的负数,不是错。
    if (x.balPct < -0.01) {
      return {
        id: x.s.id, name: x.s.name, status: 'mute' as const, statusLabel: '数据存疑',
        revenue: x.revenue, gapMoney: 0, gapKwh: 0, relPct, days, annualGap: 0,
        q: 1, shape: null, cp: null, detail: null,
        situation: `自用加上网比发电总量还多 ${(-x.balPct * 100).toFixed(1)}%，抄表对不上`,
        advice: '核对电表接线与抄表录入（多半是重复计量）',
      }
    }

    // 正侧极端偏离 = **数据质量告警**,不是性能好(§5.3)。
    // 实测踩到:三期两栋的 α 是园区中位的 7 倍,屏上显「正常 · 高 664%」——
    // 一栋楼不可能比同园其余楼强 7 倍,那是**容量台账写错了**(或表重复计量、镜像伪影)。
    // 判成「正常」等于把一条明摆着的台账错误盖过去。
    if (relPct != null && relPct > qualityPct) {
      return {
        id: x.s.id, name: x.s.name, status: 'mute' as const, statusLabel: '数据存疑',
        revenue: x.revenue, gapMoney: 0, gapKwh: 0, relPct, days, annualGap: 0,
        q: 1, shape: null, cp: null,
        situation: `折算下来比同园其余楼高 ${Math.round(relPct)}%，这个幅度不合常理`,
        advice: '核对装机容量台账与电表接线（多半是容量填小了）', detail: null,
      }
    }

    // 样本不足 → **不出结论**。显「正常」就是假绿,这里最容易出(§07)
    if (days < minDays) {
      return {
        id: x.s.id, name: x.s.name, status: 'mute' as const, statusLabel: '数据不全',
        revenue: x.revenue, gapMoney: x.gapMoneyVal, gapKwh: x.gapKwh, relPct, days, annualGap,
        q: 1, shape: null, cp: null,
        situation: `本期有效抄表仅 ${days} 天,不做判断`, advice: '补录抄表', detail: null,
      }
    }

    // 本月覆盖度:整年有效日够、但**主口径月**缺了一大截的站,不能照常出「本月收益/本月缺口」——
    // 那两个数是拿二十天当整月算的。§08 验收⑥ 就是照着这个形态写的
    // (「人为删掉某站某月 11 天抄表 → 该站必须是灰灯,不是绿灯」)。
    // 判定看的是**主口径月的覆盖**,不是整年有效日 —— 后者删一个月的十一天还剩三百五十多天,拦不住。
    const dim = daysInYm(ym)
    if (x.monthDays < dim * (2 / 3)) {
      return {
        id: x.s.id, name: x.s.name, status: 'mute' as const, statusLabel: '数据不全',
        revenue: x.revenue, gapMoney: 0, gapKwh: 0, relPct, days, annualGap: 0,
        q: 1, shape: null, cp: null, detail: x.detail,
        situation: `本月 ${dim} 天里只抄了 ${x.monthDays} 天，本月的数不做判断`,
        advice: '补录本月抄表',
      }
    }


    const rainDays = x.resid.map(r => weather.find(w => w.date === r.date)?.isRain ?? false)
    const shape = classifyShape(x.resid.map(r => r.v), rainDays).shape
    const cp = x.cp ?? { index: -1, ciLo: -1, ciHi: -1, p: 1, dropPct: 0 }
    const q = qs[i]
    // days = 变点之后持续了多少天(alertLevel 的 days>=14 问的是「坏了多久」,
    // 不是「有多少天数据」)。没有变点时退回有效日数
    const lasted = cp.index >= 0 ? days - cp.index : days
    const status = alertLevel({ q, days: lasted, annualGap })
    return {
      id: x.s.id, name: x.s.name, status, statusLabel: STATUS_ZH[status],
      revenue: x.revenue, gapMoney: x.gapMoneyVal, gapKwh: x.gapKwh, relPct, days, annualGap, q, shape, cp,
      situation: situationOf(status, shape, cp, x.resid),
      advice: adviceOf(status, shape),
      detail: x.detail,
    }
  })

  // 园区楼栋数不足:逐站结论全部收起(§07 降级为「仅同比,不做同类比较」)。
  // 收益与同比照给 —— 那两样不依赖楼栋之间的比较
  if (tooFewStations) {
    for (const r of results) {
      if (r.status === 'mute') continue
      r.status = 'mute'
      r.statusLabel = '不做判断'
      r.gapMoney = 0
      r.gapKwh = 0
      r.relPct = null
      r.detail = null
      r.situation = `园区已装表楼栋只有 ${parkStations} 栋，不足以互相当基准`
      r.advice = '本期只看收益与同比'
    }
  }

  // ⑦b 先天缺陷通道(§5.2 盲区②/§5.6):抛光只看**变化**,看不见**水平** ——
  //     某栋一年前就衰减 12% 并稳定至今,全部被 α(s) 吸收,残差居中,变点/显著性通道**永远检不出来**。
  //     所以水平这条线必须独立走一遍:α 的区间整段低于门槛 = 疑似先天缺陷。
  //     它**不覆盖**已经被变点通道判成 risk/watch 的站(那是突发,派运维上屋顶);
  //     只把剩下那些「一直就差」的站抬成 watch,派工程师核图纸 —— 两拨人不同。
  //     钱要按**园区中位水平**算,不能按该站自己的 α:缺口 = 应发 − 实发,而「应发」用的就是
  //     该站自己一贯的水平 —— 一直偏低的站算出来缺口恒等于 0,这正是这条通道存在的理由。
  //     这里问的是另一个问题:「这栋楼要是达到园区一般水平,一年能多发多少钱」。
  //     算出来的钱同样要过黄灯门槛 —— 否则「统计上比中位低一点」的那一大批全会点灯,
  //     就是这条规则本来要防的误报洪水(§5.7)。
  const congenital = congenitalCheck(polish, stations)
  const suspect = tooFewStations
    ? new Map<number, CongenitalRow>()   // 楼栋数不足时这条线同样不可信
    : new Map(congenital.filter(c => c.suspect).map(c => [c.id, c]))
  for (const r of results) {
    if (r.status !== 'ok') continue
    const c = suspect.get(r.id)
    if (!c) continue
    const x = raw.find(v => v.s.id === r.id)
    const a = polish.alpha.get(r.id)
    if (!x || a === undefined) continue
    const yearGen = x.resid.length ? (byStation.get(r.id) ?? []).reduce((t, v) => t + v.gen, 0) : 0
    const shortfall = Math.max(0, Math.exp(medAlpha - a) - 1)      // 达到园区中位水平能多发的比例
    const congenitalAnnualGap = yearGen * shortfall * x.price
    if (congenitalAnnualGap < WATCH_ANNUAL_GAP) continue
    r.status = 'watch'
    r.statusLabel = STATUS_ZH.watch
    r.annualGap = congenitalAnnualGap
    r.gapMoney = congenitalAnnualGap * (daysInYm(ym) / 365)        // 折回本月口径,与表头一致
    r.gapKwh = x.price > 0 ? r.gapMoney / x.price : 0
    r.situation = '一直偏低,不是新问题'
    r.advice = c.advice
  }
  results.sort((a, b) => b.gapMoney - a.gapMoney)

  // 未装表 / 未录容量的站也进表,但只占一行灰,不参与任何统计。
  // 两者文案必须分开:前者永久不用管,后者要催人补容量(§07 第一、二行)
  for (const s of stations) {
    if (s.metered && s.capKwp != null && s.capKwp > 0) continue
    results.push({
      id: s.id, name: s.name, status: 'mute',
      statusLabel: s.metered ? '未录容量' : '未装表',
      revenue: 0, gapMoney: 0, gapKwh: 0, relPct: null, days: 0, annualGap: 0,
      q: 1, shape: null, cp: null,
      situation: s.metered ? '未填装机容量,算不出效率' : '该栋未安装光伏计量表',
      advice: s.metered ? '到抄表屏补填装机容量' : '无需处理', detail: null,
    })
  }
  results.sort((a, b) => b.gapMoney - a.gapMoney)

  // ⑧ 园区口径(主口径月)
  const monthRows = rows.filter(r => YM(r.date) === ym)
  const inPlay = new Set(raw.map(x => x.s.id))
  const selfKwh = monthRows.reduce((a, r) => a + r.selfUse, 0)
  const gridKwh = monthRows.reduce((a, r) => a + r.gridFeed, 0)
  const revenue = monthRows.reduce((a, r) => a + r.revenue + r.gridFeed * gridPrice, 0)
  // **必须从 results 求和**,不能从 raw:先天缺陷通道会改写行上的 gapMoney,
  // 从中间量求和会让 KPI 与表行对不上 —— 实测过一次 KPI ¥37,181 而表行合计 ¥137,180。
  // §08 验收⑤ 要的就是这两个数分毫不差。
  const gapKwh = results.reduce((a, r) => a + r.gapKwh, 0)
  const gap = results.reduce((a, r) => a + r.gapMoney, 0)
  const counts = { ok: 0, watch: 0, risk: 0, mute: 0 }
  for (const r of results) counts[r.status]++

  return {
    id: fnv1a([
      year, ym, stations.length, rows.length, weather.length, gridPrice,
      rows.reduce((a, r) => a + r.gen, 0).toFixed(3),
      [...inPlay].sort((a, b) => a - b).join(','),
    ].join('|')),
    year, ym,
    stations: results,
    park: {
      revenue, selfKwh, gridKwh, gap, gapKwh,
      gapPct: revenue + gap > 0 ? (gap / (revenue + gap)) * 100 : null,
      counts,
      topGaps: results.filter(r => r.gapMoney > 0).slice(0, 2).map(r => ({ name: r.name, gap: r.gapMoney })),
    },
    monthly: monthly13(rows, yms, gridPrice, polish, stations),
    quality: {
      totalDays: hasWeather ? weather.length : new Set(rows.map(r => r.date)).size,
      okDays: okDays ? okDays.size : new Set(rows.map(r => r.date)).size,
      droppedHours, droppedLowGhi, noCapacity, noMeter,
      minStationsOnDay, droppedThin, tooFewStations,
      degraded: droppedThin > 0 || tooFewStations, hasWeather,
      unscreenedDays: unscreened.length,
      weatherCoverage: readDates.size ? (readDates.size - unscreened.length) / readDates.size : 0,
    },
    yoy: yoyOf(rows, prevRows, ym, gridPrice),
    polish, usedDays: okDays2, health, congenital,
  }
}

/**
 * 同比(PV-ANALYSIS-SPEC §07 第 8、9 行)。两条护栏都在这里,都是「不许静默」:
 *
 * ① 上一年无抄表 → 显 `—`,**不显 `0%`**。0% 意味着「持平」,—— 意味着「没得比」,
 *    这两句话在财务会上是完全不同的结论。
 * ② 跨年月份不齐 → 按**两年都有抄表的月**对齐后再比,并**报出参与月数**。
 *    整年直接求和的话,2025 全年 vs 2024 的 5 个月会虚高 100%+ —— 屏上会写着「同比 +112%」,
 *    而实际上只是去年少记了七个月。
 */
function moneyOf(r: ReadingRow, gridPrice: number): number {
  return r.revenue + r.gridFeed * gridPrice
}

function sumByYm(rows: ReadingRow[], gridPrice: number): Map<string, number> {
  const m = new Map<string, number>()
  for (const r of rows) m.set(YM(r.date), (m.get(YM(r.date)) ?? 0) + moneyOf(r, gridPrice))
  return m
}

export function yoyOf(
  rows: ReadingRow[], prevRows: ReadingRow[] | undefined, ym: string, gridPrice: number,
): AnaSnapshot['yoy'] {
  const none = (note: string): AnaSnapshot['yoy'] =>
    ({ monthPct: null, monthNote: note, yearPct: null, yearMonths: 0, yearNote: note })
  if (!prevRows) return none('未取上一年数据')
  if (!prevRows.length) return none('上一年无抄表记录，没得比')

  const cur = sumByYm(rows, gridPrice)
  const prev = sumByYm(prevRows, gridPrice)

  // ① 主口径月 vs 去年同月
  const prevYm = `${Number(ym.slice(0, 4)) - 1}-${ym.slice(5, 7)}`
  const a = cur.get(ym) ?? 0
  const b = prev.get(prevYm)
  const monthPct = b != null && b > 0 ? (a / b - 1) * 100 : null
  const monthNote = monthPct == null ? `${prevYm} 无抄表记录，没得比` : `对比 ${prevYm}`

  // ② 整年:只取两年都有抄表的月
  const shared = [...cur.keys()]
    .filter(k => prev.has(`${Number(k.slice(0, 4)) - 1}-${k.slice(5, 7)}`))
    .sort()
  if (!shared.length) {
    return { monthPct, monthNote, yearPct: null, yearMonths: 0, yearNote: '两年没有共同的抄表月份，没得比' }
  }
  const curSum = shared.reduce((t, k) => t + (cur.get(k) ?? 0), 0)
  const prevSum = shared.reduce((t, k) => t + (prev.get(`${Number(k.slice(0, 4)) - 1}-${k.slice(5, 7)}`) ?? 0), 0)
  const yearPct = prevSum > 0 ? (curSum / prevSum - 1) * 100 : null
  return {
    monthPct, monthNote,
    yearPct, yearMonths: shared.length,
    yearNote: yearPct == null
      ? '上一年对应月份无收益，没得比'
      : `按两年都有抄表的 ${shared.length} 个月对齐后比较`,
  }
}

/**
 * 抄表节律(PV-ANALYSIS-SPEC §07 第 7 行)。只有月抄的站**不能与日频站混排** ——
 * N=12 与 N=247 的置信区间差一个量级,并排放会让人以为两者一样可信。
 *
 * 判定:覆盖 ≥3 个月,且平均每月 ≤1.5 条。够不上就是日频(或数据不全,那是另一条护栏)。
 */
export function cadenceOf(dates: string[]): 'daily' | 'monthly' {
  if (dates.length < 3) return 'daily'
  const months = new Set(dates.map(YM))
  if (months.size < 3) return 'daily'
  return dates.length / months.size <= 1.5 ? 'monthly' : 'daily'
}

// ── 第二层:单栋逐日明细(PV-ANALYSIS-SPEC §06.2)────────────────────────
//
// 挂在同一个快照对象上,不另起一次计算 —— 第二层与工作台读的都是这一份(§06.4 铁律)。

export interface StationDetail {
  dates: string[]
  gen: number[]        // 实发 kWh
  expected: number[]   // 应发 kWh = exp(mu + α + β) × 容量
  gapCum: number[]     // 累计缺口(元)——第二层主图的纵轴
  resid: number[]      // log 域残差(技术细节折叠区用)
  sigma: number        // 「正常波动范围」的半宽(log 域)
  cpDate: string | null
  cpLo: string | null
  cpHi: string | null
  slopeBefore: number  // 折点前 元/天
  slopeAfter: number   // 折点后 元/天
}

/**
 * 变点的人话措辞。**宽度决定怎么写** ——
 * 窄区间(≤3 天)照实写日期;宽区间必须写成「7 月中旬 · 区间 7/11–7/26 — 不是精确到天」。
 * 固定一种写法是错的:强效应下写「中旬」丢精度,弱效应下写「7月18日」是承诺算法给不了的东西。
 */
export function cpPhrase(d: StationDetail): string {
  if (!d.cpDate) return ''
  const md = (s: string) => `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}`
  const span = d.cpLo && d.cpHi
    ? (new Date(d.cpHi).getTime() - new Date(d.cpLo).getTime()) / 86400000
    : 0
  if (span <= 3) return `折点 · ${md(d.cpDate)}`
  const day = Number(d.cpDate.slice(8, 10))
  const mon = Number(d.cpDate.slice(5, 7))
  const phase = day <= 10 ? '上旬' : day <= 20 ? '中旬' : '下旬'
  return `折点 · ${mon} 月${phase} · 区间 ${md(d.cpLo!)}–${md(d.cpHi!)} — 不是精确到天`
}

function buildDetail(
  rs: ReadingRow[], resid: { date: string; v: number }[], cap: number, price: number,
  polish: PolishResult, stationId: number, cp: ChangePoint | null,
): StationDetail {
  const byDate = new Map(rs.map(r => [r.date, r]))
  const dates = resid.map(r => r.date)
  const gen: number[] = []
  const expected: number[] = []
  const gapCum: number[] = []
  const a = polish.alpha.get(stationId) ?? 0
  let cum = 0
  for (const d of dates) {
    const r = byDate.get(d)!
    const b = polish.beta.get(d) ?? 0
    const exp = Math.exp(polish.mu + a + b) * cap
    gen.push(r.gen)
    expected.push(exp)
    cum += Math.max(0, exp - r.gen) * price
    gapCum.push(cum)
  }
  const idx = cp && cp.index >= 0 && cp.index < dates.length ? cp.index : null
  const slope = (from: number, to: number) =>
    to - from > 1 ? (gapCum[to - 1] - gapCum[from]) / (to - 1 - from) : 0
  return {
    dates, gen, expected, gapCum,
    resid: resid.map(r => r.v),
    sigma: robustSigma(resid.map(r => r.v)) * 2,   // 「正常波动范围」= ±2σ,界面上不出现 σ 这个字
    cpDate: idx == null ? null : dates[idx],
    cpLo: idx == null || cp!.ciLo < 0 ? null : dates[Math.min(cp!.ciLo, dates.length - 1)],
    cpHi: idx == null || cp!.ciHi < 0 ? null : dates[Math.min(cp!.ciHi, dates.length - 1)],
    slopeBefore: idx == null ? slope(0, dates.length) : slope(0, idx),
    slopeAfter: idx == null ? 0 : slope(idx, dates.length),
  }
}

// ── 分析工作台(PV-ANALYSIS-SPEC §06.4)────────────────────────────────
//
// 受众是系统所有者、审计、承包商 —— **不为可读性做任何妥协**,这里可以出 p/q/σ/ACF。
//
// 铁律:**工作台永远不是另一次计算**。这些全部从第一层那次抛光的 PolishResult 派生,
// 不重新拟合模型;lab.snapshotId 与第一层页脚同一个,对不上时先看是不是同一次计算。
//
// ⚠ 唯一的例外是收敛诊断:它**必须**再跑一次抛光(列优先),否则没有可比对象 ——
//   但用的是同一份输入数据,拟出来的是同一个模型的另一种扫描顺序,不是另一批数。
//
// 为什么 buildLab 不塞进 buildSnapshot:ACF、逐日质量矩阵、第二次抛光加起来不便宜,
// 而九成的人只看第一层。开工作台才算,算出来的东西照样钉在同一个 snapshotId 上。

export interface TestRow {
  id: number; name: string
  alphaPct: number
  z: number | null          // 主窗口残差均值 ÷ 收缩后的尺度,用 **N_eff**
  zNaive: number | null     // 同一条数据按 **n** 算的 z —— 并排放着,让人看见 √N 错多少
  p: number                 // 主统计量(变点检验)的 p
  q: number                 // BH 之后
  nEff: number              // 有效样本量 —— 直接体检 √N 错多少
  sigmaHow: string          // σ 怎么估的
  cpRange: string           // 变点区间(不是一个点)
  shape: Shape | null
  bic: number | null
  days: number
  status: StationResult['status']
}

export interface LabResult {
  snapshotId: string
  alphaRows: CongenitalRow[]
  /** 因「数据存疑」被踢出 α 排序的站(容量台账错) —— 图上要说明,不能静默少几行 */
  alphaExcluded: string[]
  tests: TestRow[]
  acf: { id: number; name: string; rho: number[]; nEff: number }[]
  doy: { id: number; name: string; pts: { doy: number; v: number }[]; amp: number }[]
  nullDist: { id: number; name: string; dist: number[]; obs: number } | null
  convergence: { names: string[]; rowRank: number[]; colRank: number[]; flipped: string[] }
  quality: { dates: string[]; rows: { id: number; name: string; states: ('ok' | 'missing' | 'dropped')[] }[] }
  kt: ReturnType<typeof clearSkyCheck>
  health: { date: string; logH: number }[]
}

/** 自相关函数。ACF 是**直接体检 √N 错多少**的那张图 —— ρ₁ 非零就说明独立假设不成立。 */
export function acf(r: number[], maxLag = 30): number[] {
  const n = r.length
  if (n < 3) return []
  const m = r.reduce((a, b) => a + b, 0) / n
  let c0 = 0
  for (const v of r) c0 += (v - m) ** 2
  if (c0 === 0) return new Array(Math.min(maxLag, n - 1) + 1).fill(0)
  const out: number[] = []
  for (let k = 0; k <= Math.min(maxLag, n - 1); k++) {
    let ck = 0
    for (let i = k; i < n; i++) ck += (r[i] - m) * (r[i - k] - m)
    out.push(ck / c0)
  }
  return out
}

/**
 * 有效样本量 N_eff = n / (1 + 2Σρ_k)。求和**截到第一个非正 ρ** ——
 * 全加会把纯噪声的尾巴也算进去,N_eff 反而变得不稳。
 * 这个数是「√N 到底错了多少」的量化答案:ρ≈0.5 时 N_eff 只有 n 的三分之一。
 */
export function nEffOf(rho: number[], n: number): number {
  let s = 0
  for (let k = 1; k < rho.length; k++) {
    if (rho[k] <= 0) break
    s += rho[k]
  }
  return Math.max(1, n / (1 + 2 * s))
}

/** 一年中的第几天(1–366)。残差 vs 年积日看的是**有没有稳定年周期**。 */
function dayOfYear(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 86400000) + 1
}

/** 名次(1 = α 最低) */
function rankOf(pairs: { id: number; v: number }[]): Map<number, number> {
  const sorted = [...pairs].sort((a, b) => a.v - b.v)
  return new Map(sorted.map((p, i) => [p.id, i + 1]))
}

export function buildLab(snap: AnaSnapshot, input: SnapshotInput): LabResult {
  const { rows, stations, weather, minStations = 8, ghiMinKwh = 1.0, winDays = 30 } = input
  const polish = snap.polish
  const nameOf = new Map(stations.map(s => [s.id, s.name]))
  const inPlay = [...polish.resid.keys()]

  // A ── 完整检验表 + α 排序(点估计与区间都来自第一层那次计算)
  const sigmaPool = robustSigma([...polish.resid.values()].flatMap(m => [...m.values()]))
  const acfRows = inPlay.map(id => {
    const r = [...polish.resid.get(id)!.values()]
    const rho = acf(r, 30)
    return { id, name: nameOf.get(id) ?? String(id), rho, nEff: nEffOf(rho, r.length) }
  })
  const nEffById = new Map(acfRows.map(a => [a.id, a.nEff]))

  const tests: TestRow[] = snap.stations.filter(s => polish.resid.has(s.id)).map(s => {
    const r = [...polish.resid.get(s.id)!.values()]
    const win = r.slice(-winDays)
    const obs = win.length ? win.reduce((a, b) => a + b, 0) / win.length : 0
    const sigma = shrinkSigma(robustSigma(r), sigmaPool, 1e-4)
    const nEff = nEffById.get(s.id) ?? r.length
    return {
      id: s.id, name: s.name,
      alphaPct: s.relPct ?? 0,
      // z 用 **N_eff** 不是 n —— 用 n 的话这一列就是那个「乐观 1~3 个数量级」的错数
      // ⚠ 不能写成 min(win.length, nEff):nEff 是**整条序列**(365 天)的有效样本量,
      //   ρ=0.5 下约 122,min(30,122) 恒等于 30 —— 修正一次都不会生效,z 永远等于 zNaive。
      //   要用的是**同一个膨胀系数**折算到窗口上:effWin = win.length × (nEff / n)。
      z: win.length ? obs * Math.sqrt(win.length * (nEff / Math.max(1, r.length))) / sigma : null,
      zNaive: win.length ? obs * Math.sqrt(win.length) / sigma : null,
      p: s.detail && s.cp ? s.cp.p : 1,
      q: s.q,
      nEff,
      sigmaHow: '一阶差分 MAD ÷ √2，再与全园收缩各半',
      cpRange: s.detail?.cpLo && s.detail?.cpHi ? `${s.detail.cpLo} ~ ${s.detail.cpHi}` : '—',
      shape: s.shape,
      bic: null,
      days: s.days,
      status: s.status,
    }
  })

  // B ── 残差 vs 年积日。**上线前必做**:有稳定年周期 = 模型缺项(季节性遮挡),**不是故障**。
  //      不做这个,春秋两季会各刷一批假变点。amp 给出周期振幅,大就该回去补模型。
  const doy = inPlay.map(id => {
    const pts = [...polish.resid.get(id)!].map(([d, v]) => ({ doy: dayOfYear(d), v }))
    // 季度均值的极差 = 年周期振幅的粗测(够用来报警,不用拟合正弦)
    const q = [0, 0, 0, 0].map((_, k) => {
      const seg = pts.filter(p => Math.floor((p.doy - 1) / 91.5) === k)
      return seg.length ? seg.reduce((a, b) => a + b.v, 0) / seg.length : 0
    })
    return { id, name: nameOf.get(id) ?? String(id), pts, amp: Math.max(...q) - Math.min(...q) }
  })

  // B ── 块自助零分布 + 观测值。让 p 值**看得见**,比一个 p=0.003 可信。
  //      只给最该看的那一栋(缺口最大的),十三张零分布图没人看
  const worst = snap.stations.find(s => s.detail && s.status !== 'mute')
  const nullDist = worst && polish.resid.has(worst.id)
    ? (() => {
        const r = [...polish.resid.get(worst.id)!.values()]
        const win = r.slice(-winDays)
        const obs = win.length ? win.reduce((a, b) => a + b, 0) / win.length : 0
        return {
          id: worst.id, name: worst.name, obs,
          dist: blockBootstrapP(r, obs, win.length, { block: 14, B: 999, seed: 20260831 }).nullDist,
        }
      })()
    : null

  // B ── 抛光收敛诊断:行优先/列优先各跑一次。**排名翻转 = 该结论不稳,不上报**。
  // **必须用快照那一份日集合**。自己再算一遍的话,两次抛光之间就多了「日集合」这第二个变量,
  //   隔离不出扫描顺序 —— 实测过:把 'col' 改成 'row'(等于没诊断)照样"排名不同",诊断形同虚设。
  const colFirst = medianPolish(rows, stations, snap.usedDays, 'col')
  const rowRankMap = rankOf(inPlay.map(id => ({ id, v: polish.alpha.get(id) ?? 0 })))
  const colRankMap = rankOf(inPlay.map(id => ({ id, v: colFirst.alpha.get(id) ?? 0 })))
  const convergence = {
    names: inPlay.map(id => nameOf.get(id) ?? String(id)),
    rowRank: inPlay.map(id => rowRankMap.get(id) ?? 0),
    colRank: inPlay.map(id => colRankMap.get(id) ?? 0),
    flipped: inPlay
      .filter(id => Math.abs((rowRankMap.get(id) ?? 0) - (colRankMap.get(id) ?? 0)) > 1)
      .map(id => nameOf.get(id) ?? String(id)),
  }

  // B ── 数据质量矩阵。色 = 正常 / 缺失 / 剔除。
  //      **没有「补齐」这一档,因为本实现从不补齐** —— 补了残差恒为 0,离线 10 天的楼会算出「正常」。
  const allDates = [...new Set(rows.map(r => r.date))].sort()
  const dropped = new Set<string>(
    snap.usedDays ? allDates.filter(d => !snap.usedDays!.has(d)) : [])
  const had = new Map<number, Set<string>>()
  for (const r of rows) {
    if (!(r.gen > 0)) continue
    const set = had.get(r.stationId) ?? new Set<string>()
    set.add(r.date); had.set(r.stationId, set)
  }
  const quality = {
    dates: allDates,
    rows: stations.map(s => ({
      id: s.id, name: s.name,
      states: allDates.map(d =>
        dropped.has(d) ? 'dropped' as const
          : had.get(s.id)?.has(d) ? 'ok' as const
            : 'missing' as const),
    })),
  }

  // 判成「数据存疑」的站不进 α 排序:它们的 α 是容量台账错算出来的,不是性能。
  // 混进去一个 +750% 会把横轴拉到 1000%,其余十几栋全挤在 0 附近 —— 这张图就废了。
  // 但**必须说明踢了谁**,不能静默少几行(实测在真数据上撞到过)。
  const suspectIds = new Set(snap.stations.filter(x => x.statusLabel === '数据存疑').map(x => x.id))
  return {
    snapshotId: snap.id,
    alphaRows: snap.congenital.filter(c => !suspectIds.has(c.id)),
    alphaExcluded: snap.stations.filter(x => suspectIds.has(x.id)).map(x => x.name),
    tests, acf: acfRows, doy, nullDist, convergence, quality,
    // C ── 外部锚。没有天气数据时 kt 自检与 logH 都给不出来,那就诚实空着
    kt: clearSkyCheck(weather, () => Math.max(...weather.map(w => w.ghiKwh), 1)),
    health: snap.health,
  }
}
