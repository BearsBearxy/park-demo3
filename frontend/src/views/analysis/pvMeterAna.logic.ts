// 光伏分栋分析 · 公式层(PV-ANALYSIS-SPEC §05)。全部纯函数:无 Vue 依赖、无 IO、可单测。
// 口径:eff(s,d) = 发电量 ÷ 装机容量(kWh/kWp);模型 eff = α(s)·β(d)·ε,取对数变可加,
// 用 Tukey 中位数抛光分离「这栋楼一贯的水平」α 与「当天的天气」β。单测 pvMeterAna.logic.spec.ts。
//
// 13 站 × 365 日 ≈ 4700 个点。实测整条 buildSnapshot(抛光 + 逐站变点检验 B=999 + 形状 BIC)
// 约 **100ms**,确实是设计稿说的毫秒级 —— 但那是把变点扫描换成前缀和之后的数:
// 逐点重算合并方差时是 837ms,B 还只有 199。见 pooledTScanner 的注释。

// ── 类型 ───────────────────────────────────────────────────────────────
export interface DayRow { stationId: number; date: string; gen: number }
export interface StationCfg {
  id: number; name: string
  phase: number
  metered: boolean
  capKwp: number | null      // 台账装机 kWp
  panelCount: number | null  // 板数
  panelWatt: number | null   // 单块标称功率 W
}

// ── 基本量 ─────────────────────────────────────────────────────────────

/** 等效小时 eff = 发电量 ÷ 装机容量(kWh/kWp)。装机容量不同的楼栋只有除掉容量才可比。 */
export function specificYield(gen: number, capKwp: number): number { return gen / capKwp }

// ── 中位数抛光 ─────────────────────────────────────────────────────────
export interface PolishResult {
  mu: number
  alpha: Map<number, number>               // log 域,站固有水平
  beta: Map<string, number>                // log 域,当日天气
  resid: Map<number, Map<string, number>>  // 残差(只含真正进了矩阵的格子)
  iterations: number
  converged: boolean
  /** 逐轮 maxDelta。只留 converged 这个布尔的话,「20 轮撞上限但末轮只挪了 1e-10」
   *  与「20 轮还在 1e-4 上下摆」在屏上长得一模一样 —— 前者够用,后者要去找算法作者。 */
  trace: number[]
}

export const MAX_ITER = 20
export const TOL = 1e-12
/** 够用线。α 在 L1 印成一位小数的百分数 → 显示分辨率对应 log 域约 1e-3;
 *  但 maxDelta 是**单轮步长**,不是剩余误差的上界,所以再留三个数量级余量取 1e-6。
 *  **这是一条判据线,不是自由常数**:α 哪天改成印四位小数,这条线要跟着往下挪,
 *  否则它会替读者背书一个已经不成立的判断。屏上画成 markLine,不许在 vue 里再抄一遍字面量。 */
export const POLISH_PRACTICAL_TOL = 1e-6

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
 * 迭代只跑两三轮的话这两个约束只是**近似**成立,而逐月偏离矩阵直接吃 β ——
 * 锚定漂移会原样变成一条假的全园趋势。所以收敛后再显式减一次中位数。
 *
 * @param okDays 允许进矩阵的日期;传 null = 全收。**只用来剔「当日在网站数不足」的日子**,
 *              不允许拿它做任何跟发电量有关的过滤 —— 那等于优先删掉故障楼的故障日。
 * @param order 扫描顺序。默认行优先;工作台的收敛诊断会用 'col' 再跑一次 ——
 *              两种顺序下 α 排名若翻转,说明该结论**不稳,不上报**(§06.4 B 组)
 */
export function medianPolish(
  rows: DayRow[], stations: StationCfg[], okDays: Set<string> | null,
  order: 'row' | 'col' = 'row',
): PolishResult {
  // 1) 建 log(eff) 矩阵。跳过:未装表 / 未录容量 / 不在允许日 / gen<=0。
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
  const trace: number[] = []
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

    // ⚠ push 必须排在 iter++ 之前,`trace.length === iterations` 才成立。
    //   这一行是整段最容易在后续重构里被挪坏的一处,单测第一条钉的就是它。
    trace.push(maxDelta)
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

  return { mu, alpha, beta, resid, iterations: iter, converged: iter < MAX_ITER, trace }
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

// ── 绝对基准通道(PV-ANALYSIS-SPEC §03.5)────────────────────────────────
//
// 抛光只看**相对**:α 吸走「这栋一贯的水平」,β 吸走「今天的天气」,于是两件事结构性看不见 ——
// 全园一起变差(共模劣化被 β 整个吃掉),以及一直就差的楼(水平被 α 整个吃掉)。
// 这条通道就是补那两个盲区的:分母不从发电量来,而从**铭牌**来。

/** 理论装机 kWp = 板数 × 单块标称功率 ÷ 1000。两列任一为空返回 null —— 那栋不出绝对量。 */
export function theoreticalKwp(st: StationCfg): number | null {
  return st.panelCount != null && st.panelWatt != null && st.panelCount > 0 && st.panelWatt > 0
    ? (st.panelCount * st.panelWatt) / 1000
    : null
}

/** 年等效小时 = Σ发电 ÷ 分母。分母为 0/空时返回 null,不返回 Infinity。 */
export function annualYieldHours(genTotal: number, denomKwp: number | null): number | null {
  return denomKwp != null && denomKwp > 0 ? genTotal / denomKwp : null
}

// ── 逐月量(PV-ANALYSIS-SPEC §03.4)──────────────────────────────────────

/** Huber 稳健回归 y = a + b·x。IRLS,单点撬不动斜率。返回斜率、标准误、R²、样本数。 */
function huberFit(x: number[], y: number[]): { a: number; b: number; se: number; r2: number; n: number } {
  const n = x.length
  if (n < 3) return { a: 0, b: 0, se: Infinity, r2: 0, n }
  let w = new Array(n).fill(1)
  let a = 0, b = 0
  for (let iter = 0; iter < 12; iter++) {
    let sw = 0, sx = 0, sy = 0, sxx = 0, sxy = 0
    for (let i = 0; i < n; i++) {
      sw += w[i]; sx += w[i] * x[i]; sy += w[i] * y[i]
      sxx += w[i] * x[i] * x[i]; sxy += w[i] * x[i] * y[i]
    }
    const den = sw * sxx - sx * sx
    if (!(Math.abs(den) > 1e-12)) break
    b = (sw * sxy - sx * sy) / den
    a = (sy - b * sx) / sw
    const res = x.map((xi, i) => y[i] - (a + b * xi))
    const s = median(res.map(Math.abs)) * 1.4826 || 1e-9
    const k = 1.345 * s
    const nw = res.map(r => (Math.abs(r) <= k ? 1 : k / Math.abs(r)))
    const delta = nw.reduce((t, v, i) => t + Math.abs(v - w[i]), 0)
    w = nw
    if (delta < 1e-8) break
  }
  // 标准误与 R² 用**加权**残差,与拟合同一口径
  const res = x.map((xi, i) => y[i] - (a + b * xi))
  let sw = 0, sx = 0, sxx = 0, sse = 0
  for (let i = 0; i < n; i++) { sw += w[i]; sx += w[i] * x[i]; sxx += w[i] * x[i] * x[i]; sse += w[i] * res[i] * res[i] }
  const sxxC = sxx - (sx * sx) / sw
  const se = n > 2 && sxxC > 1e-12 ? Math.sqrt(sse / (n - 2) / sxxC) : Infinity
  const ybar = y.reduce((t, v, i) => t + w[i] * v, 0) / sw
  const sst = y.reduce((t, v, i) => t + w[i] * (v - ybar) ** 2, 0)
  return { a, b, se, r2: sst > 1e-12 ? Math.max(0, 1 - sse / sst) : 0, n }
}

export interface SlopeRow { key: string; beta: number; se: number; r2: number; n: number }

/**
 * 逐栋(逐月)响应斜率:log gen = α + β·f(d) + ε,f = 全园当日 log 因子(抛光的 β)。
 * β = 1 表示与全园同步涨落;β < 1 = 好天涨得少;β > 1 = 坏天跌得更狠。
 *
 * 后三个返回值(se / r2 / n)决定图上误差带画多宽 —— **样本少的月带子要宽到肉眼可见**,
 * 把「读不出东西」也画出来,而不是画一条看起来很确定的线。
 */
export function responseSlopes(
  rows: DayRow[], polish: PolishResult, stations: StationCfg[], by: 'year' | 'month' = 'month',
): Map<number, SlopeRow[]> {
  const out = new Map<number, SlopeRow[]>()
  const genOf = new Map<number, Map<string, number>>()
  for (const r of rows) {
    if (!(r.gen > 0)) continue
    let m = genOf.get(r.stationId)
    if (!m) { m = new Map(); genOf.set(r.stationId, m) }
    m.set(r.date, r.gen)
  }
  for (const s of stations) {
    const g = genOf.get(s.id)
    if (!g) { out.set(s.id, []); continue }
    const buckets = new Map<string, { x: number[]; y: number[] }>()
    for (const [date, gen] of g) {
      const f = polish.beta.get(date)
      if (f === undefined) continue
      const key = by === 'year' ? date.slice(0, 4) : YM(date)
      let bk = buckets.get(key)
      if (!bk) { bk = { x: [], y: [] }; buckets.set(key, bk) }
      bk.x.push(f)
      bk.y.push(Math.log(gen))
    }
    out.set(s.id, [...buckets.entries()].sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, bk]) => {
        const f = huberFit(bk.x, bk.y)
        return { key, beta: f.b, se: f.se, r2: f.r2, n: f.n }
      }))
  }
  return out
}

// ── 限制性立方样条(PV-ANALYSIS-SPEC §03.4)──────────────────────────────

/** 解 n×n 线性方程组(高斯消元 + 部分主元)。失败返回 null。 */
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length
  const M = A.map((row, i) => [...row, b[i]])
  for (let c = 0; c < n; c++) {
    let piv = c
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r
    if (Math.abs(M[piv][c]) < 1e-12) return null
    ;[M[c], M[piv]] = [M[piv], M[c]]
    for (let r = 0; r < n; r++) {
      if (r === c) continue
      const f = M[r][c] / M[c][c]
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]
    }
  }
  return M.map((row, i) => row[n] / M[i][i])
}

/**
 * 限制性立方样条趋势 + 95% 置信带。**这是 classifyShape 五标签的替代品**:
 * BIC 五选一逼着数据挑一个标签,形状不在那五种里就被硬塞;样条不预设形状,曲线自己长出来,
 * 由看的人自己判。节点数固定 —— 让用户拖节点等于让他调出想要的结论。
 *
 * 节点取时间分位数(默认 4 个:5% / 35% / 65% / 95%)。基函数 = [1, x, s1, s2](k−2 个样条项),
 * 两端强制线性(这就是「限制性」的含义:外推不翘上天)。
 * 置信带 = ±1.96 × sqrt(残差方差 × x'(X'X)⁻¹x),数据稀的时段自动张开。
 */
export function rcsTrend(
  resid: { date: string; v: number }[], knots = 4,
): { date: string; fit: number; lo: number; hi: number }[] {
  const n = resid.length
  if (n < knots + 2) return []
  const x = resid.map((_, i) => i / Math.max(1, n - 1))
  const y = resid.map(r => r.v)
  const qs = [0.05, 0.35, 0.65, 0.95].slice(0, knots)
  const sorted = [...x].sort((a, b) => a - b)
  const t = qs.map(q => sorted[Math.min(n - 1, Math.floor(q * (n - 1)))])
  const kEnd = t[t.length - 1], kPre = t[t.length - 2]
  if (!(kEnd - t[0] > 1e-9)) return []
  const cube = (u: number) => (u > 0 ? u ** 3 : 0)
  // Harrell 的 RCS 基:第 j 项 = (x−tj)³₊ − (x−t_{k−1})³₊·(t_k−tj)/(t_k−t_{k−1})
  //                              + (x−t_k)³₊·(t_{k−1}−tj)/(t_k−t_{k−1})
  const basis = (u: number) => {
    const b = [1, u]
    for (let j = 0; j < t.length - 2; j++) {
      const den = (kEnd - kPre) || 1e-9
      const scale = (kEnd - t[0]) ** 2 || 1e-9
      b.push((cube(u - t[j]) - cube(u - kPre) * (kEnd - t[j]) / den + cube(u - kEnd) * (kPre - t[j]) / den) / scale)
    }
    return b
  }
  const X = x.map(basis)
  const p = X[0].length
  const XtX: number[][] = Array.from({ length: p }, () => new Array(p).fill(0))
  const Xty = new Array(p).fill(0)
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < p; a++) {
      Xty[a] += X[i][a] * y[i]
      for (let b = 0; b < p; b++) XtX[a][b] += X[i][a] * X[i][b]
    }
  }
  const beta = solve(XtX.map(r => [...r]), [...Xty])
  if (!beta) return []
  const fit = X.map(row => row.reduce((t2, v, k) => t2 + v * beta[k], 0))
  const sse = y.reduce((t2, v, i) => t2 + (v - fit[i]) ** 2, 0)
  const s2 = n > p ? sse / (n - p) : 0
  // (X'X)⁻¹ 逐列解出来,只为拿 x'(X'X)⁻¹x
  const inv: number[][] = []
  for (let c = 0; c < p; c++) {
    const e = new Array(p).fill(0); e[c] = 1
    const col = solve(XtX.map(r => [...r]), e)
    if (!col) return []
    inv.push(col)
  }
  return resid.map((r, i) => {
    let q = 0
    for (let a = 0; a < p; a++) for (let b = 0; b < p; b++) q += X[i][a] * inv[b][a] * X[i][b]
    const half = 1.96 * Math.sqrt(Math.max(0, s2 * q))
    return { date: r.date, fit: fit[i], lo: fit[i] - half, hi: fit[i] + half }
  })
}

// ── 快照:一份数据、一次计算、一个 id ───────────────────────────────────

export interface ReadingRow {
  stationId: number; date: string
  gen: number; selfUse: number; gridFeed: number; revenue: number
  priceSnap: number | null
}

/** 期间粒度。**模型永远吃全年,只有「画哪一段」跟着它变** —— 模型要历史,屏要新鲜。 */
export type Gran = 'month' | 'year'

/** 判据线。全部来自计费参数(V122/V123),不在代码里写死 —— 见 §04.1。 */
export interface Criteria {
  anchorHours: number    // pv_yield_anchor_h      950
  coverMonth: number     // pv_crit_cover_month    0.90
  ledger: number         // pv_crit_ledger         0.03
  yieldRatio: number     // pv_crit_yield_ratio    0.85
  bandSigma: number      // pv_band_sigma          2    正常范围的半宽 = 几倍稳健波动
  bandRun: number        // pv_band_run            3    连续几个刻度出带才算「一段」
  minOnlineDays: number  // 常量 90:在网不足这么多天,该栋一律「读不出」
}

export const DEFAULT_CRITERIA: Criteria = {
  anchorHours: 950, coverMonth: 0.90, ledger: 0.03, yieldRatio: 0.85,
  bandSigma: 2, bandRun: 3, minOnlineDays: 90,
}

export interface SnapshotInput {
  year: number
  gran: Gran                 // 'month' = 逐日看当月;'year' = 逐月看全年
  month?: number             // gran='month' 时给;不给取该年最后一个有抄表的月
  stations: StationCfg[]
  rows: ReadingRow[]         // **整年**。看板只画选中那段,但正常范围要拿整年来估
  gridPrice: number
  crit?: Partial<Criteria>
  minStations?: number
  prevRows?: ReadingRow[]
  /** 今天(YYYY-MM-DD)。与期末取早 = 「已过去到哪个刻度」(§03.8)。不给取系统当天 */
  today?: string
}

/** 每栋的基础量。**全是事实,没有一个判词。** */
export interface StationRow {
  id: number; name: string; phase: number
  metered: boolean
  cadence: 'daily' | 'monthly'
  days: number
  capKwp: number | null
  theoKwp: number | null
  ledgerDiff: number | null
  genYear: number
  selfKwh: number; gridKwh: number; lossKwh: number
  revSelf: number; revGrid: number
  yieldHours: number | null
  yieldDenom: 'theoretical' | 'ledger' | null
  yieldRatio: number | null
}

// ── 刻度三态与游程(PV-ANALYSIS-SPEC §03.8)───────────────────────────────
//
// **未到的日子 ≠ 漏抄的日子。** 8/20 还没发生不是缺数据;8/07 空着而 8/15 有数才是漏抄。
// 两者必须是两种视觉、两种算法 —— 合并成同一种灰之后,月中打开这屏会把 13 栋
// 一股脑判成「读不出」,而这屏存在的理由恰恰是「录完几天内就能看出」。

/** 刻度三态。用两条日期切开:**数据截止日**(最后一条抄表)与**已过去到哪个刻度**(今天与期末取早)。 */
export type TickState = 'seen' | 'missing' | 'future'

/** 合并后的连续段。live = 段的末端正好是数据截止日(仍在持续),不该写成闭区间。 */
export interface Run { from: number; to: number; dir: -1 | 1; live: boolean }

/**
 * 单个刻度的三态。
 *
 * 两条边界比刻度长时**按刻度的长度截断** —— 年段刻度是 'YYYY-MM',而两条日期是 'YYYY-MM-DD',
 * 直接比字符串会把当月整个判成「未到」('2025-08' > '2025-08-14')。
 */
export function tickState(
  tick: string, hasValue: boolean, dataThrough: string | null, elapsed: string | null,
): TickState {
  const cut = (b: string | null) => (b == null ? null : b.slice(0, tick.length))
  const e = cut(elapsed)
  if (e == null || tick > e) return 'future'
  const d = cut(dataThrough)
  return hasValue && d != null && tick <= d ? 'seen' : 'missing'
}

/**
 * 连续同向的段。段 = 连续 ≥ minRun 个**已抄**同向刻度。
 *
 * **跨过漏抄的一天不算断** —— 8/07 漏抄不该把 8/06 与 8/08 的同向切成两段,
 * 那是把**记录**的缺口当成**现象**的缺口。
 * **跨过未到必须断** —— 未到的刻度什么都不是,连过去等于替未来做主。
 * 上越与下越不合并:方向不同就是两件事。
 *
 * from/to 是**已抄刻度**的下标(中间被跨过的漏抄含在 from..to 区间里,便于画底色),
 * 所以 `live = (to === lastSeen)` 才读得出「末端正好是数据截止日」。
 */
export function runsOf(
  out: (number | null)[], state: TickState[], minRun: number, lastSeen: number,
): Run[] {
  const res: Run[] = []
  let i = 0
  while (i < out.length) {
    const dir = out[i]
    if (state[i] !== 'seen' || (dir !== 1 && dir !== -1)) { i++; continue }
    let last = i, n = 1, k = i + 1
    while (k < out.length) {
      if (state[k] === 'missing') { k++; continue }        // 记录的缺口:跨过去
      if (state[k] !== 'seen' || out[k] !== dir) break     // 未到 / 反向 / 回到范围内:断
      last = k; n++; k++
    }
    if (n >= minRun) res.push({ from: i, to: last, dir, live: last === lastSeen })
    i = last + 1
  }
  return res
}

/**
 * 看板的一行(L1)。**这一行里没有任何模型** —— 分子分母都是实测度数:
 *   比值(t) = 这栋当刻度发电 ÷ 全园同刻度中位
 * 反事实的「应发/缺口」一个字都不出现,量的是两个都量得到的东西。
 *
 * 各栋规模不同(500kWp 与 340kWp),所以比值本身有高有低 —— **不要横着比**。
 * 带是这栋**自己**的历史范围,所以看的是「它离开自己没有」,规模差异被自动消掉。
 */
export interface BoardRow {
  id: number
  name: string
  phase: number
  cadence: 'daily' | 'monthly'
  ratio: (number | null)[]        // 与 snapshot.ticks 等长;null = 该刻度没有比值
  state: TickState[]              // 与 ticks 等长(§03.8)
  center: number | null           // 这栋自己的常态水平
  lo: number | null; hi: number | null
  /** 每刻度:0 在范围内,−1 在范围下方,+1 在范围上方;
   *  **漏抄与未到处一律 null,不是 0** —— 0 是「量过、在范围内」,那是两件事 */
  out: (number | null)[]
  runs: Run[]                     // 连续 ≥ bandRun 个已抄同向刻度
  outN: number                    // 出范围的**已抄**刻度数
  maxDev: number                  // 最大偏离 (v−center)/center,取绝对值最大的那个(带符号)
  seenN: number                   // 已抄刻度数
  elapsedN: number                // 已过去刻度数(= 已抄 + 漏抄)
  baseNote: string                // 范围是拿哪一段估的,整句版 —— 读屏与断言用(§03.7)
  base: BaseWindow | null         // 同一件事的结构化版 —— 屏上排版用,别再拼散文
  /** 这栋第一条抄表的日期;null = 整年都没有。**未投产与漏抄必须分得开**:
   *  首条抄表晚于本段结束 = 那时候它还没投产,不该催人;本段之内缺的才是漏抄。 */
  firstDate: string | null
  /** 本段结束时它投产了没有 */
  bornBySeg: boolean
}

/** F1 的一行:一句**事实**。日期与天数,没有判词、没有建议、没有金额。 */
export interface Fact {
  stationId: number
  station: string
  kind: 'run' | 'scatter' | 'thin' | 'ledger' | 'yield'
  text: string
}

export interface AnaSnapshot {
  id: string
  year: number
  gran: Gran
  ym: string | null               // gran='month' 时是当月
  /** 当段的刻度键:gran='month' 时是 'YYYY-MM-DD',gran='year' 时是 'YYYY-MM' */
  ticks: string[]
  tickLabels: string[]            // 画在轴上的短标签
  /** 数据截止日 = 最后一条抄表(YYYY-MM-DD);null = 整年一条都没有。B0 右侧要写它 —— */
  dataThrough: string | null
  /** 本段已过去的刻度数(今天与期末取早)。**覆盖率的分母是它,不是 ticks.length**(§03.8) */
  elapsedN: number
  stations: StationRow[]
  board: BoardRow[]
  facts: Fact[]
  slopes: Map<number, SlopeRow[]>
  /** 账面量也跟着期间走:月段逐日、年段逐月,与 ticks 等长 */
  ledger: { self: number[]; grid: number[]; loss: number[]; lossPct: number[]; yield: (number | null)[] }
  crit: Criteria
  parkYieldHours: number | null
  parkYieldRatio: number | null
  polish: PolishResult
  usedDays: Set<string> | null
  quality: {
    totalDays: number; okDays: number
    noMeter: string[]; noCapacity: string[]; noPanel: string[]
    minStationsOnDay: number; droppedThin: number; tooFewStations: boolean; degraded: boolean
  }
  yoy: {
    monthPct: number | null
    monthNote: string
    yearPct: number | null
    yearMonths: number
    yearNote: string
  }
}

/** FNV-1a:内容派生的短 id。同一份数据两次算必须同一个 id —— 页脚要拿它对账。 */
function fnv1a(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

const YM = (d: string) => d.slice(0, 7)

function daysInYm(ym: string): number {
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m, 0).getDate()
}

/** BH 的 q 值(不是布尔)。留给抽屉里的变点通道用。 */
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

/** 本地当天 YYYY-MM-DD。**不能用 toISOString** —— 那是 UTC,东八区每天 08:00 之前会退回昨天。 */
function localToday(): string {
  const t = new Date()
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
}

const dLabel = (d: string) => String(Number(d.slice(8, 10)))
const mLabel = (ym: string) => `${Number(ym.slice(5, 7))}月`

/**
 * 逐刻度的「这栋 ÷ 全园同刻度中位」。
 * 用中位数不用均值:某栋表坏报 0 时均值会被拉塌,于是所有栋看起来都偏高。
 * 分母只数**当刻度真有抄表**的栋 —— 未投产的栋不该把中位拉低。
 */
function ratioSeries(
  rows: ReadingRow[], keyOf: (d: string) => string,
): Map<number, Map<string, number>> {
  const byKey = new Map<string, Map<number, number>>()
  for (const r of rows) {
    if (!(r.gen > 0)) continue
    const k = keyOf(r.date)
    let m = byKey.get(k)
    if (!m) { m = new Map(); byKey.set(k, m) }
    m.set(r.stationId, (m.get(r.stationId) ?? 0) + r.gen)
  }
  const out = new Map<number, Map<string, number>>()
  for (const [k, perStation] of byKey) {
    const mid = median([...perStation.values()])
    if (!(mid > 0)) continue
    for (const [id, gen] of perStation) {
      let m = out.get(id)
      if (!m) { m = new Map(); out.set(id, m) }
      m.set(k, gen / mid)
    }
  }
  return out
}

// ── 基线窗口(PV-ANALYSIS-SPEC §03.7)────────────────────────────────────
//
// **这是全屏最要紧的一个决定。** 比值的分母是「全园同刻度中位」,口径**随并网站数变**:
// 6 月二期并网,一期 5 栋比值集体下移 9%;12 月三期两栋并网把中位拉低,二期 6 栋集体上移 14%。
// 这几栋什么都没干。拿「整年减当月」估带 → 实测 5/11 栋误报,而种入的断崖被自己的中心吸收。
//
// 窗口必须同时满足三条,缺一不可:
//   ① 同批在网 —— 与显示段相同的在网栋集合
//   ② 同运行状态 —— 排除刚并网的爬坡期(二期 6 月只发满产的 8%,只满足①会把一期比值抬到 5–10)
//   ③ 变点之前 —— 否则带重新定基到已经坏掉的水平上,故障被自己的中心吸收
//
// 样本不足时**逐条放宽,并在 baseNote 如实写明放宽到哪一步**,绝不静默回退 ——
// 静默回退等于屏上写着「同批在网」而实际拿了整年,那比不画带更坏。

/** 一次窗口挑选的结果:落在窗口里的刻度键,以及这一步实际生效/放宽了哪几条。 */
interface WinPick { keys: string[]; trimmed: boolean; cut: boolean }

/**
 * 基线窗口的**结构化**形态(§03.7)。
 *
 * `baseNote` 是同一件事的整句版本 —— 读屏与可机检的断言用它。
 * 但屏上不能把「窗口 + 三条件放宽情况」串成一句 120 字的话丢给用户看:
 * 那是四类不同的事实用「·」缝在一起,和 v3 推翻掉的文字横幅是同一个病。
 * 组件拿这份结构自己排版(标签 + 值 + 放宽档数),散文留给读屏。
 */
export interface BaseWindow {
  from: string
  to: string
  n: number
  unit: string
  /** 三条件里**实际生效**的那几条,人话 */
  ok: string[]
  /** 为了凑够样本而**放宽**掉的那几条,人话且不带「已放宽：」前缀 */
  relaxed: string[]
}

/** 该刻度的在网栋集合。**用「首条抄表 ≤ 该刻度」判在网,不用「当刻度有没有抄」** ——
 *  后者会让某栋漏抄一天就凭空多出一个批次,把整年切成几十个碎段。 */
function cohortMap(allKeys: string[], firstKey: Map<number, string>): Map<string, string> {
  const ids = [...firstKey.keys()].sort((a, b) => a - b)
  const out = new Map<string, string>()
  for (const k of allKeys) out.set(k, ids.filter(id => firstKey.get(id)! <= k).join(','))
  return out
}

/**
 * 某一栋的估带窗口。返回落在窗口里的比值与一句人话的窗口说明。
 *
 * @param vals     这栋的 刻度 → 比值(全期,不只当段)
 * @param allKeys  全园有抄表的刻度,升序
 * @param cohort   刻度 → 在网栋集合
 * @param segCohort 显示段的在网栋集合
 * @param inSeg    该刻度在不在显示段里
 * @param opts.excludeSeg 月段要排掉当段(否则整月都坏的栋会把带撑到把自己包进去);
 *                        年段的「段」就是全年,没有段外可用,只能拿这些点自己估
 * @param opts.useCp      条件③。年段只有 12 个点,扫不出可信的变点,不用
 * @param opts.minN       样本下限,低于它就往下放宽一档
 */
function baselineWindow(
  vals: Map<string, number>, allKeys: string[],
  cohort: Map<string, string>, segCohort: string, inSeg: (k: string) => boolean,
  opts: { excludeSeg: boolean; useCp: boolean; minN: number; unit: string },
): { vals: number[]; note: string; base?: BaseWindow } {
  const own = allKeys.filter(k => vals.has(k) && !(opts.excludeSeg && inSeg(k)))
  if (!own.length) return { vals: [], note: '这栋还没有可用的历史刻度，画不出正常范围' }

  // 条件③的切点:这栋自己**全期**比值上的变点。p 不显著就不切 ——
  // argmax 总能找到一个「最像变点」的位置,不加闸门等于每栋都被无故砍掉半条基线。
  const series = allKeys.filter(k => vals.has(k))
  let cutKey: string | null = null
  if (opts.useCp && series.length >= 20) {
    const cp = changePoint(series.map(k => vals.get(k)!), { block: 14, B: 999, seed: 20260831 })
    if (cp.index > 0 && cp.p <= 0.05) cutKey = series[cp.index]
  }

  const pick = (byCohort: boolean, byRamp: boolean, byCp: boolean): WinPick => {
    let ks = byCohort ? own.filter(k => cohort.get(k) === segCohort) : own
    let trimmed = false
    if (byRamp && ks.length) {
      // 爬坡期:并网初期的量显著低于其后的稳定水平。稳定水平用中位数 —— 几个爬坡点撬不动它。
      const lvl = median(ks.map(k => vals.get(k)!))
      let i = 0
      while (i < ks.length && vals.get(ks[i])! < 0.5 * lvl) i++
      trimmed = i > 0
      ks = ks.slice(i)
    }
    let cut = false
    if (byCp && cutKey != null) {
      const before = ks.filter(k => k < cutKey!)
      cut = before.length < ks.length
      ks = before
    }
    return { keys: ks, trimmed, cut }
  }

  // 逐条放宽:先松③(它是防自我吸收的refinement),再松②,最后才松①(①的偏差最大)
  const ladder: [boolean, boolean, boolean][] = [
    [true, true, true], [true, true, false], [true, false, false], [false, false, false],
  ]
  let byCohort = false, byRamp = false, byCp = false
  let got: WinPick = pick(false, false, false)
  for (const [c, r, p] of ladder) {
    const t = pick(c, r, p)
    if (t.keys.length >= opts.minN) { byCohort = c; byRamp = r; byCp = p; got = t; break }
  }

  // ok = 实际生效的条件;relaxed = 为了凑够样本放宽掉的。两者分开存,
  // 屏上才能排成「值 + 放宽 N 档」而不是三个并列的「已放宽：…」
  const ok: string[] = []
  const relaxed: string[] = []
  if (byCohort) ok.push('同批在网'); else relaxed.push('不限同批在网')
  if (byRamp) { if (got.trimmed) ok.push('已排除并网初期') } else relaxed.push('含并网初期')
  if (byCp) { if (got.cut) ok.push('变点之前') } else if (cutKey != null) relaxed.push('不限变点之前')
  const cond = [...ok, ...relaxed.map(r => `已放宽：${r}`)]

  const n = got.keys.length
  if (n < opts.minN) {
    return { vals: [], note: `可用历史刻度只有 ${n} ${opts.unit}，不足 ${opts.minN} ${opts.unit}，画不出正常范围` }
  }
  const short = (k: string) => k.slice(5)
  return {
    vals: got.keys.map(k => vals.get(k)!),
    // 窗口不一定连续(排掉当段之后会缺一块),所以除了首末还要报条数 —— 只写区间会撒谎
    note: `基线取 ${got.keys[0]} ~ ${short(got.keys[n - 1])} 共 ${n} ${opts.unit}（${cond.join(' · ')}）`,
    base: { from: got.keys[0], to: short(got.keys[n - 1]), n, unit: opts.unit, ok, relaxed },
  }
}

/**
 * 看板(L1)。**这屏的重心** —— 数据是逐日进来的,异常要在几天内看见,
 * 所以默认粒度是「当月 × 逐日」,不是「全年 × 逐月」。
 *
 * 断崖 = 线掉出带并留在带外;波动变大 = 点在带内外来回跳。两种感觉同一张图给。
 *
 * 正常范围的窗口按 §03.7 三条件挑,逐栋不同(变点位置逐栋不同),所以 `baseNote` 也逐栋一份。
 * 两档的差别:月段拿段外估(不含被看的那段,范围不会被它自己撑宽);
 * 年段只有 12 个月点,没有「段外」可用,就拿这些点自己稳健估 ——
 * 一个坏月不会把带撑开(MAD 抗离群),但**全年一起差看不见**,那是绝对通道(A1/R3)的事。
 *
 * @param span.dataThrough 数据截止日(最后一条抄表);不给就从 rows 推
 * @param span.elapsed     已过去到哪个刻度(今天与期末取早);不给就当整段都已过去
 */
export function buildBoard(
  rows: ReadingRow[], stations: StationCfg[], ticks: string[], gran: Gran, crit: Criteria,
  span: { dataThrough?: string | null; elapsed?: string | null } = {},
): BoardRow[] {
  const keyOf = gran === 'month' ? (d: string) => d : YM
  const series = ratioSeries(rows, keyOf)
  const tickSet = new Set(ticks)
  const unit = gran === 'month' ? '天' : '个月'

  const firstOf = new Map<number, string>()
  let maxDate = ''
  for (const r of rows) {
    const cur = firstOf.get(r.stationId)
    if (cur == null || r.date < cur) firstOf.set(r.stationId, r.date)
    if (r.date > maxDate) maxDate = r.date
  }
  const dataThrough = span.dataThrough !== undefined ? span.dataThrough : (maxDate || null)
  const segEnd = ticks[ticks.length - 1] ?? ''
  const elapsed = span.elapsed !== undefined ? span.elapsed : segEnd || null

  // 全园有抄表的刻度 + 每个刻度的在网栋集合
  const allKeys = [...new Set([...series.values()].flatMap(m => [...m.keys()]))].sort()
  const firstKey = new Map<number, string>()
  for (const [id, d] of firstOf) if (series.has(id)) firstKey.set(id, keyOf(d))
  const cohort = cohortMap(allKeys, firstKey)
  // 显示段的在网集合按段内**最后一个已过去的刻度**取 —— 比值现在就是拿那个集合的中位当分母的
  const segKey = [...ticks].reverse().find(t => tickState(t, true, dataThrough, elapsed) !== 'future')
    ?? ticks[0] ?? ''
  const segCohort = cohort.get(segKey)
    ?? [...firstKey.keys()].sort((a, b) => a - b).filter(id => firstKey.get(id)! <= segKey).join(',')

  return stations.filter(s => s.metered).map(s => {
    const all = series.get(s.id) ?? new Map<string, number>()
    const firstDate = firstOf.get(s.id) ?? null
    // 段末键是 'YYYY-MM-DD' 或 'YYYY-MM';首条抄表日取同样长度再比,避免拿日期比月份
    const bornBySeg = firstDate != null && firstDate.slice(0, segEnd.length) <= segEnd
    const ratio = ticks.map(t => all.get(t) ?? null)
    const state = ticks.map((t, i) => tickState(t, ratio[i] != null, dataThrough, elapsed))

    const win = baselineWindow(all, allKeys, cohort, segCohort, k => tickSet.has(k), {
      excludeSeg: gran === 'month', useCp: gran === 'month',
      minN: gran === 'month' ? 15 : 6, unit,
    })
    const base = win.vals
    const center = base.length ? median(base) : null
    // 稳健尺度:年段只有 12 个点,一阶差分会把本来就该看的月度落差差掉,所以用 MAD;
    // 月段点多,用一阶差分(对阶跃与慢漂移免疫)
    const sigma = center == null ? null
      : gran === 'month'
        ? robustSigma(base)
        : 1.4826 * median(base.map(v => Math.abs(v - center)))
    const half = sigma == null ? null : Math.max(sigma, 1e-6) * crit.bandSigma
    const lo = center != null && half != null ? center - half : null
    const hi = center != null && half != null ? center + half : null

    // 漏抄与未到处 out 一律 null:0 的含义是「量过、在范围内」,与「没量」是两件事
    const out = ratio.map((v, i) =>
      state[i] !== 'seen' || v == null || lo == null || hi == null ? null : v < lo ? -1 : v > hi ? 1 : 0)
    // 「仍在持续」的锚点 = **数据截止日**在本段里的下标,不是「本段最后一条抄表」——
    // 12 月回看 8 月时 8/31 也是本段最后一条,但它早就结束了,写「仍在持续」是撒谎。
    const lastSeen = dataThrough == null ? -1 : ticks.findIndex(t => t === dataThrough.slice(0, t.length))
    const seenN = state.filter(v => v === 'seen').length
    const maxDev = center != null && center !== 0
      ? ratio.reduce<number>((m, v, i) => {
        if (v == null || state[i] !== 'seen') return m
        const d = (v - center) / center
        return Math.abs(d) > Math.abs(m) ? d : m
      }, 0)
      : 0

    return {
      id: s.id, name: s.name, phase: s.phase,
      cadence: cadenceOf([...all.keys()].filter(k => k.length === 10)),
      ratio, state,
      center, lo, hi, out,
      runs: runsOf(out, state, crit.bandRun, lastSeen),
      outN: out.filter(v => v === 1 || v === -1).length,
      maxDev, seenN,
      elapsedN: state.filter(v => v !== 'future').length,
      baseNote: win.note,
      base: win.base ?? null,
      firstDate, bornBySeg,
    }
  })
}

/**
 * 「散着出带」要几个才算数。**不能直接用 bandRun** —— 那会让每栋健康楼都报:
 * ±kσ 的带按定义就漏出 ~4.6%(k=2)的点,一个月 31 天期望 1.4 天,随机撞到 3 天很常见。
 * 实测:零故障园区上按「≥3 天」判,B座 8 月就报「9、20、28 共 3 天」。
 * 门槛取**噪声期望的 3 倍** —— 超过这个数才不是运气。仍以 bandRun 兜底(段很短时)。
 */
function scatterMin(n: number, crit: Criteria): number {
  const leak = 2 * (1 - normCdf(crit.bandSigma))     // 双侧漏出率
  return Math.max(crit.bandRun, Math.ceil(n * leak * 3))
}

/**
 * F1(§04.3)。**每行一句事实:日期、天数、方向。**
 * 没有判词、没有建议动作、没有金额,也没有 p / q —— 第一层出现统计量是 v1 就定死不许的,
 * 上一版我自己把 q<0.05 写回了行上,这一版拿掉。
 *
 * 三条硬规矩照旧:只列有话可说的、按楼栋固定顺序、必须有「读不出」这一档。
 * 「断崖」与「波动变大」在这里**分开说**:前者是连续同侧,后者是散在两侧 ——
 * 这正是用户要的那两种感觉,措辞上就要能区分。
 */
export function buildFacts(
  board: BoardRow[], stationRows: StationRow[], ticks: string[], gran: Gran, crit: Criteria,
  dataThrough: string | null = null,
): Fact[] {
  const facts: Fact[] = []
  const label = gran === 'month' ? dLabel : mLabel
  // 数据截止日在本段里的下标 —— 「仍在持续」只认它(§03.8),见 buildBoard 里同名的锚点
  const cutIdx = dataThrough == null ? -1 : ticks.findIndex(t => t === dataThrough.slice(0, t.length))
  const unit = gran === 'month' ? '天' : '个月'
  const byId = new Map(stationRows.map(s => [s.id, s]))
  // 「板数未录」对全园都成立时**不逐栋重复** —— 一句话说 13 遍会把真信号淹掉。
  // 这时它是项目状态不是逐栋缺口,T1 的脚注与横幅已经各说了一次。
  const noPanelAtAll = stationRows.filter(s => s.metered).every(s => s.theoKwp == null)

  for (const b of board) {
    // 本段还没投产的栋:整段没话可说。报「一天都没抄」会把「那时候还没建」说成「该催人」
    if (!b.bornBySeg) continue
    const s = byId.get(b.id)
    const push = (kind: Fact['kind'], text: string) =>
      facts.push({ stationId: b.id, station: b.name, kind, text })

    // ── 读不出:范围估不出来,或这一段几乎没抄。
    // **覆盖率的分母是「已过去」不是「整段」**(§03.8):按整段算的话月中打开 13 栋全是 48%,
    // 一股脑掉进「读不出」,屏上什么都不剩 —— 而这屏存在的理由恰恰是「录完几天内就能看出」。
    const got = b.seenN
    const seg = gran === 'month' ? '本月' : '本年'
    // 整段都还没到 → 看板这条线没话可说,但台账差是纯算术,与期间无关,照常往下走
    if (b.elapsedN === 0) { /* 跳过看板类事实 */ } else if (b.lo == null) {
      push('thin', `历史数据不够，画不出正常范围`)
    } else if (got === 0) {
      push('thin', gran === 'month' ? '本月一天都没抄' : '本年没有抄表记录')
    } else if (got < b.elapsedN * crit.coverMonth) {
      push('thin', `${seg}只抄了 ${got} ${unit}，已过去 ${b.elapsedN} ${unit}`)
    }

    if (b.lo != null && got > 0) {
      const below = b.out.filter(v => v === -1).length
      const above = b.out.filter(v => v === 1).length
      const outCount = below + above
      // **形态判在前,连续段判在后。** 只看「有没有连续 N 个同侧」会把剧烈上下跳的栋
      // 说成断崖 —— 实测:一栋 31 天里 22 天出带、上下各 11 天,只因中间碰巧连着 4 天同侧,
      // 就被报成「13 起连续 4 天在范围下方」。两种感觉在措辞上必须分得开。
      const oneSided = outCount > 0 && Math.max(below, above) / outCount >= 0.8
      // 段末端正好是数据截止日 = 它还没结束,写成闭区间会暗示它已经过去了(§03.8)
      const live = (on: boolean) => (on ? '（仍在持续）' : '')
      if (b.runs.length && oneSided) {
        // 断崖:连续同侧。报最长的那段的起点与长度(长度按**已抄**刻度数,跨过的漏抄不计)
        const lenOf = (r: Run) => b.out.slice(r.from, r.to + 1).filter(v => v === r.dir).length
        const longest = b.runs.reduce((a, r) => (lenOf(r) > lenOf(a) ? r : a), b.runs[0])
        push('run', `${label(ticks[longest.from])} 起连续 ${lenOf(longest)} ${unit}在正常范围${longest.dir < 0 ? '下方' : '上方'}${live(longest.live)}`)
      } else if (outCount >= scatterMin(b.elapsedN, crit)) {
        // 波动变大:散在两侧
        // **多到一定程度就不逐个列日期了** —— 列 22 个数没人看
        const days = b.out.map((v, i) => (v === 1 || v === -1 ? label(ticks[i]) : null)).filter(Boolean)
        const where = days.length <= 6 ? `${days.join('、')} 共 ` : `${seg} `
        push('scatter', `${where}${outCount} ${unit}在正常范围之外${below && above ? '，上下都有' : ''}${live(cutIdx >= 0 && !!b.out[cutIdx])}`)
      }
    }

    // ── 台账差:纯算术,跟期间无关,板数一录进来就能算
    if (s?.theoKwp != null && s.capKwp != null && s.ledgerDiff != null) {
      if (Math.abs(s.ledgerDiff) > crit.ledger) {
        push('ledger', `台账 ${s.capKwp.toFixed(1)} kWp，板数×单块标称功率算出来是 ${s.theoKwp.toFixed(1)} kWp`)
      }
    } else if (s && s.days > 0 && !noPanelAtAll) {
      push('ledger', '板数或单块标称功率未录，台账对不了')
    }

    // ── 年等效小时:年粒度的绝对量,只在年段说
    if (gran === 'year' && s) {
      if (s.yieldRatio != null && s.days >= 300) {
        if (s.yieldRatio < crit.yieldRatio) {
          push('yield', `全年 ${s.yieldHours!.toFixed(0)} 小时，是锚点 ${crit.anchorHours} 的 ${(s.yieldRatio * 100).toFixed(0)}%`)
        }
      } else if (s.days > 0) {
        push('yield', s.yieldDenom == null ? '没有装机分母，算不出年等效小时' : '不满一年，年等效小时先不算')
      }
    }
  }
  return facts
}

export function buildSnapshot(input: SnapshotInput): AnaSnapshot {
  const { year, gran, stations, rows, gridPrice, prevRows, minStations = 3 } = input
  const crit: Criteria = { ...DEFAULT_CRITERIA, ...input.crit }

  // ① 零剔除(§01)。没有任何按发电量或天气的日过滤。
  const readDates = new Set(rows.map(r => r.date))
  const months = [...new Set(rows.map(r => YM(r.date)))].sort()
  const ym = gran === 'month'
    ? (input.month != null ? `${year}-${String(input.month).padStart(2, '0')}` : months[months.length - 1] ?? `${year}-01`)
    : null

  // ② 当段的刻度。**月段只画当月那 30 来个点** —— 逐日铺满全年没人看得过来
  const ticks = gran === 'month' && ym
    ? Array.from({ length: daysInYm(ym) }, (_, i) => `${ym}-${String(i + 1).padStart(2, '0')}`)
    : months
  const tickLabels = ticks.map(gran === 'month' ? dLabel : mLabel)
  const segEnd = ticks[ticks.length - 1] ?? ''

  const noMeter = stations.filter(s => !s.metered).map(s => s.name)
  const noCapacity = stations.filter(s => s.metered && (s.capKwp == null || s.capKwp <= 0)).map(s => s.name)
  const noPanel = stations.filter(s => s.metered && theoreticalKwp(s) == null).map(s => s.name)

  // ③ 抛光只服务抽屉里的变点/样条与 M3 的斜率 —— **看板本身不用它**
  const polish0 = medianPolish(rows, stations, null)
  const countDay = (pr: PolishResult) => {
    const m = new Map<string, number>()
    for (const [, byDate] of pr.resid) for (const d of byDate.keys()) m.set(d, (m.get(d) ?? 0) + 1)
    return m
  }
  const parkStations = stations.filter(s => s.metered && s.capKwp != null && s.capKwp > 0).length
  const tooFewStations = parkStations > 0 && parkStations < minStations
  const thinDays = tooFewStations ? [] : [...countDay(polish0)].filter(([, n]) => n < minStations).map(([d]) => d)
  const usedDays = thinDays.length ? new Set([...readDates].filter(d => !thinDays.includes(d))) : null
  const polish = thinDays.length ? medianPolish(rows, stations, usedDays) : polish0
  const perDay = countDay(polish)
  const minStationsOnDay = perDay.size ? Math.min(...perDay.values()) : 0

  // ④ 逐站基础量
  const byStation = new Map<number, ReadingRow[]>()
  for (const r of rows) {
    const a = byStation.get(r.stationId) ?? []
    a.push(r); byStation.set(r.stationId, a)
  }
  const stationRows: StationRow[] = stations.map(s => {
    const rs = byStation.get(s.id) ?? []
    const resid = polish.resid.get(s.id) ?? new Map<string, number>()
    const genYear = rs.reduce((t, r) => t + r.gen, 0)
    const selfKwh = rs.reduce((t, r) => t + r.selfUse, 0)
    const gridKwh = rs.reduce((t, r) => t + r.gridFeed, 0)
    const theoKwp = theoreticalKwp(s)
    const denomKwp = theoKwp ?? (s.capKwp != null && s.capKwp > 0 ? s.capKwp : null)
    const yieldHours = annualYieldHours(genYear, denomKwp)
    return {
      id: s.id, name: s.name, phase: s.phase, metered: s.metered,
      cadence: cadenceOf(rs.map(r => r.date)),
      days: resid.size,
      capKwp: s.capKwp, theoKwp,
      ledgerDiff: theoKwp != null && s.capKwp != null && theoKwp > 0 ? (s.capKwp - theoKwp) / theoKwp : null,
      genYear, selfKwh, gridKwh, lossKwh: genYear - selfKwh - gridKwh,
      revSelf: rs.reduce((t, r) => t + r.revenue, 0),
      revGrid: gridKwh * gridPrice,
      yieldHours,
      yieldDenom: theoKwp != null ? 'theoretical' : denomKwp != null ? 'ledger' : null,
      yieldRatio: yieldHours != null && crit.anchorHours > 0 ? yieldHours / crit.anchorHours : null,
    }
  })

  // ⑤ 看板与事实清单。**两条日期先切出来**(§03.8):未到 ≠ 漏抄,
  //    合并成同一种灰的话月中打开这屏,13 栋会一股脑掉进「读不出」。
  const dataThrough = rows.reduce<string | null>((m, r) => (m == null || r.date > m ? r.date : m), null)
  const todayKey = (input.today ?? localToday()).slice(0, segEnd.length)
  const elapsed = segEnd && todayKey < segEnd ? todayKey : segEnd || null
  const board = buildBoard(rows, stations, ticks, gran, crit, { dataThrough, elapsed })
  const facts = buildFacts(board, stationRows, ticks, gran, crit, dataThrough)
  const elapsedN = ticks.filter(t => tickState(t, false, dataThrough, elapsed) !== 'future').length

  // ⑥ 账面量,逐刻度。零容量依赖 —— 板数与铭牌都没录也照常出真数
  const tickOf = gran === 'month' ? (d: string) => d : YM
  const acc = new Map(ticks.map(t => [t, { self: 0, grid: 0, gen: 0, caps: new Set<number>() }]))
  const denomOf = new Map(stationRows.map(s => [s.id, s.theoKwp ?? (s.capKwp && s.capKwp > 0 ? s.capKwp : null)]))
  for (const r of rows) {
    const a = acc.get(tickOf(r.date))
    if (!a) continue
    a.self += r.selfUse; a.grid += r.gridFeed; a.gen += r.gen
    a.caps.add(r.stationId)
  }
  const ledger = {
    self: ticks.map(t => acc.get(t)!.self),
    grid: ticks.map(t => acc.get(t)!.grid),
    loss: ticks.map(t => acc.get(t)!.gen - acc.get(t)!.self - acc.get(t)!.grid),
    lossPct: ticks.map(t => {
      const a = acc.get(t)!
      return a.gen > 0 ? (a.gen - a.self - a.grid) / a.gen : 0
    }),
    // 等效小时:分母 = 该刻度真有抄表的栋的装机合计(优先理论装机)
    yield: ticks.map(t => {
      const a = acc.get(t)!
      let cap = 0
      for (const id of a.caps) cap += denomOf.get(id) ?? 0
      return cap > 0 ? a.gen / cap : null
    }),
  }
  const parkGen = stationRows.reduce((t, s) => t + s.genYear, 0)
  const parkCap = stationRows.reduce((t, s) => t + (denomOf.get(s.id) ?? 0), 0)
  const parkYieldHours = parkCap > 0 ? parkGen / parkCap : null
  const parkYieldRatio = parkYieldHours != null && crit.anchorHours > 0 ? parkYieldHours / crit.anchorHours : null

  return {
    id: fnv1a([
      year, gran, ym ?? '', stations.length, rows.length, gridPrice,
      parkGen.toFixed(3), crit.bandSigma, crit.ledger, crit.anchorHours,
    ].join('|')),
    year, gran, ym, ticks, tickLabels,
    dataThrough, elapsedN,
    stations: stationRows,
    board, facts,
    slopes: responseSlopes(rows.map(r => ({ stationId: r.stationId, date: r.date, gen: r.gen })), polish, stations),
    ledger,
    crit,
    parkYieldHours, parkYieldRatio,
    polish, usedDays,
    quality: {
      totalDays: readDates.size,
      okDays: usedDays ? usedDays.size : readDates.size,
      noMeter, noCapacity, noPanel,
      minStationsOnDay, droppedThin: thinDays.length, tooFewStations,
      degraded: thinDays.length > 0 || tooFewStations,
    },
    yoy: yoyOf(rows, prevRows, months[months.length - 1] ?? `${year}-01`, gridPrice),
  }
}

/**
 * 同比(PV-ANALYSIS-SPEC §07)。两条护栏都在这里,都是「不许静默」:
 * ① 上一年无抄表 → 显 `—`,**不显 `0%`**。0% 意味着「持平」,—— 意味着「没得比」。
 * ② 跨年月份不齐 → 按**两年都有抄表的月**对齐后再比,并**报出参与月数**。
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

  const prevYm = `${Number(ym.slice(0, 4)) - 1}-${ym.slice(5, 7)}`
  const a = cur.get(ym) ?? 0
  const b = prev.get(prevYm)
  const monthPct = b != null && b > 0 ? (a / b - 1) * 100 : null
  const monthNote = monthPct == null ? `${prevYm} 无抄表记录，没得比` : `对比 ${prevYm}`

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
 * 抄表节律(§07)。只有月抄的站**不能与日频站混排** ——
 * N=12 与 N=247 的置信区间差一个量级,并排放会让人以为两者一样可信。
 * 判定:覆盖 ≥3 个月,且平均每月 ≤1.5 条。
 */
export function cadenceOf(dates: string[]): 'daily' | 'monthly' {
  if (dates.length < 3) return 'daily'
  const months = new Set(dates.map(YM))
  if (months.size < 3) return 'daily'
  return dates.length / months.size <= 1.5 ? 'monthly' : 'daily'
}

// ── L5 单栋抽屉(PV-ANALYSIS-SPEC §06.5)─────────────────────────────────
//
// 挂在同一个快照上,不另起一次计算 —— 铁律:一份数据、一次计算、一个 id。

export interface StationDetail {
  dates: string[]
  resid: number[]                                            // log 域残差
  spline: { date: string; fit: number; lo: number; hi: number }[]   // S2
  cp: ChangePoint | null                                     // S3
  cpDate: string | null; cpLo: string | null; cpHi: string | null
  center: number                                             // M4 中心线
  sigma: number                                              // M4 控制限半宽(1σ)
  limitFrom: string | null; limitTo: string | null           // 控制限的估计窗口 —— 画在图上
}

/**
 * 单栋详情。M4 的控制限**用变点前段估** —— 整期都有故障时用全期估,限本身被撑宽,
 * 什么都不越限,检测器对最严重的资产最沉默。估计窗口要画出来,不能只给两条线。
 */
export function buildDetail(snap: AnaSnapshot, stationId: number): StationDetail | null {
  const byDate = snap.polish.resid.get(stationId)
  if (!byDate || byDate.size < 8) return null
  const arr = [...byDate].sort((a, b) => a[0].localeCompare(b[0]))
  const dates = arr.map(([d]) => d)
  const resid = arr.map(([, v]) => v)
  const cp = changePoint(resid, { block: 14, B: 999, seed: 20260831 })
  const idx = cp.index >= 0 && cp.index < dates.length ? cp.index : null
  // 变点前段:至少留 8 个点,否则退回全期并在 limitFrom/To 上如实标出来
  const to = idx != null && idx >= 8 ? idx : resid.length
  const base = resid.slice(0, to)
  return {
    dates, resid,
    spline: rcsTrend(arr.map(([date, v]) => ({ date, v }))),
    cp: idx == null ? null : cp,
    cpDate: idx == null ? null : dates[idx],
    cpLo: idx == null || cp.ciLo < 0 ? null : dates[Math.min(cp.ciLo, dates.length - 1)],
    cpHi: idx == null || cp.ciHi < 0 ? null : dates[Math.min(cp.ciHi, dates.length - 1)],
    center: median(base),
    sigma: robustSigma(base),
    limitFrom: dates[0] ?? null,
    limitTo: dates[Math.max(0, to - 1)] ?? null,
  }
}

// ── 分析工作台(二层屏「高级分析」档)─────────────────────────────────────
//
// 2026-08 砍过一次,理由是「算法自检不是业务屏内容,它的位置在单测断言里」。
// 那条对**运维用户**成立:ACF 图告诉物业「残差有 0.5 的自相关」,他既改不了算法也没法据此派人。
// 但当时承诺顶上来的「方法与口径页」随后也被删了,于是「所有数字不可审计」这条反对意见没人接。
// 所以它回来 —— **不回首屏**,只回二层屏的第三个分段:运维看不见,要审计的人点一下就有。
//
// p / q / σ / 置信区间**只在这一档出现**。§05 的禁词对 L0 / L1 / 绝对水平 / 账面量继续成立。
//
// 铁律没变:**工作台不是另一次计算**。α、残差、日集合全部取自传进来的快照;
// 自己算的两处(变点、块自助)钉死同一组 opts 与种子,与抽屉 buildDetail 逐位相同。
// 不塞进 buildSnapshot 的理由:ACF + 逐日质量矩阵 + 第二次抛光加起来不便宜,而九成的人只看第一层。

/** 主窗口长度(天)。z 与零分布都看最后这一段。v3 的 Criteria 里没有窗口口径,故在此定死。 */
const LAB_WIN = 30

/**
 * 工作台的**观测窗口**跟着显示段走。
 *
 * 原来写死 `r.slice(-LAB_WIN)`(最后 30 天)。数据截止在 12-31,于是
 * **你在看 8 月、它算的是 12 月**,而屏上一个字都没说 —— 工作台里同时有三个期间
 * (整年 / 最后 30 天 / 你选的那一段),互相不打招呼。
 *
 * 现在:月档取**当段**;年档没有「当段 vs 全年」可比(拿全年跟自己比),
 * 退回最后一个自然月。当段样本不足 8 个也退回 —— 退了要在 label 上说出来。
 */
function labWindow(
  snap: AnaSnapshot, dates: string[],
): { idx: number[]; label: string; fellBack: boolean } {
  const pick = (pre: string) =>
    dates.reduce<number[]>((a, d, i) => (d.startsWith(pre) ? (a.push(i), a) : a), [])
  if (snap.gran === 'month' && snap.ym) {
    const idx = pick(snap.ym)
    if (idx.length >= 8) return { idx, label: snap.ym, fellBack: false }
  }
  const last = dates.length ? dates[dates.length - 1].slice(0, 7) : ''
  return { idx: last ? pick(last) : [], label: last, fellBack: snap.gran === 'month' }
}

// ── L1 α 排序(先天水平)─────────────────────────────────────────────────

export interface CongenitalRow {
  id: number
  name: string
  alphaPct: number   // 相对全园中位数的百分比偏离(+ 高 / − 低)
  ciLo: number
  ciHi: number
  /** 整个区间都在门槛之下(**不是**只有点估计低)。
   *  ⚠ α 长期垫底最常见的原因不是设备坏,是**装机容量台账写错** ——
   *  cap 少写 10%,α 就永远偏 10%,派人上去查三次查不出东西,第四次就没人理这系统了。
   *  屏上的措辞要先说「核对台账」,别先说「设备可能坏了」。 */
  suspect: boolean
}

/**
 * α 排序 = 一张验收检查表。持续偏低的 α 是「先天水平低」,**不是**突发故障 ——
 * 两者派给不同的人:前者核图纸与台账,后者上屋顶。
 *
 * CI 用**块自助**算。naive SE 在 σ≈8%、365 天下约 0.4%,13 个点的区间互不重叠,
 * 图上会显示「每栋楼都显著不同」,用户第一反应是「你这系统天天报警」。
 *
 * v1 那版还带一个 advice 文案字段,这次没捡:判词与建议是屏的事,不是公式层的事(§01)。
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
    // (实测:某站 α=0% 而区间 −23%~−12%)。α 排序图上那就是一眼假。
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
    const ciHi = pct(q(0.975))

    return {
      id, name: byId.get(id)?.name ?? String(id),
      alphaPct: pct(a), ciLo: pct(q(0.025)), ciHi,
      suspect: ciHi < -suspectPct,
    }
  }).sort((x, y) => x.alphaPct - y.alphaPct)
}

// ── L2 自相关与有效样本量 ────────────────────────────────────────────────

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

// ── 工作台的返回形状 ─────────────────────────────────────────────────────

/**
 * L7 完整检验表的一行。
 *
 * v1 那版还有 shape / bic(BIC 形状分类)与 status 两列,**这次没捡回来**:
 * · classifyShape 随金额链一起从 v3 删了。「形状」这件事今天由 L1 看板的游程
 *   (BoardRow.runs:连续同向段的方向与长度)承担 —— 但那是**当段**口径,
 *   本表是**全年残差**口径,并排会让人以为是同一件事的两种说法,故不并进来。
 * · status(正常/需关注/异常)在 v3 里不存在:§01 明令这一层不出判词。
 */
export interface TestRow {
  id: number; name: string
  alphaPct: number          // 相对全园中位的百分比偏离
  z: number | null          // 主窗口残差均值 ÷ 收缩后的尺度,用 **N_eff**
  zNaive: number | null     // 同一条数据按 **n** 算的 z —— 并排放着,让人看见 √N 错多少
  p: number                 // 主统计量(变点检验)的 p,与抽屉里那次逐位相同
  q: number                 // BH 之后
  nEff: number              // 有效样本量
  sigmaHow: string          // σ 怎么估的
  cpRange: string           // 变点区间(不是一个点)
  days: number              // 真正进了矩阵的天数
}

/**
 * 质量矩阵的格子。
 *
 * **没有「补齐」这一档,因为本实现从不补齐** —— 补了残差恒为 0,离线 10 天的楼会算出「正常」。
 *
 * pre 是第四态、**不是第四种颜色**:它是「那时这栋还没投产」,画成空白或极淡即可。
 * 把它并进 missing 就是把**未投产**当成**漏抄**(3ceefe0 在真数据上栽过的那一次),
 * 与 §03.8「未到 ≠ 漏抄」是同一条道理。三色仍是 ok / missing / dropped。
 */
export type QualityState = 'ok' | 'missing' | 'dropped' | 'pre'

export interface QualityRow {
  id: number
  name: string
  /** 这栋进没进抛光矩阵。false = 未装表或未录容量 —— 那一整行的 missing 是「不在模型里」,
   *  **不是**「全年没抄表」。屏上要标出来,否则这一行是一句谎话。 */
  inMatrix: boolean
  states: QualityState[]
}

export interface LabResult {
  snapshotId: string
  /**
   * **这份工作台各块吃的期间**,屏上必须逐块写出来 ——
   * 工作台里同时存在两个期间(整年 / 观测窗口),不说清用户会以为都跟着期间选择器走。
   *
   * L1 / L2 / L3 / L5 / L6 与 L7 的 α·N_eff·变点 全部吃**整年**(模型本来就吃整年);
   * 只有 L4 的观测值与 L7 的 z / zNaive 吃 `window`。
   */
  window: {
    /** 'YYYY-MM'。月档 = 当段;年档或当段样本不足 = 最后一个自然月 */
    label: string
    /** true = 当段样本不足 8 个,退回了最后一个自然月 —— 屏上要说出来 */
    fellBack: boolean
    /** 窗口里实际有几个已抄刻度 */
    n: number
  }
  /** L1:α 点估计 + 块自助区间,已按 α 升序 */
  alphaRows: CongenitalRow[]
  /** 因**容量台账与铭牌不符**(|ledgerDiff| > crit.ledger)被踢出 α 排序的站名 ——
   *  它们的 α 是台账错算出来的,不是性能;混一个 +750% 进去横轴就拉到 1000%,这张图直接废。
   *  但**必须说明踢了谁**,不能静默少几行。
   *  未装表 / 未录容量的栋压根没进抛光矩阵,不在这份名单里 —— 那两份在 snap.quality
   *  的 noMeter / noCapacity 里,屏上一并写。 */
  alphaExcluded: string[]
  /** L7 */
  tests: TestRow[]
  /** L2 */
  acf: { id: number; name: string; rho: number[]; nEff: number }[]
  /** L3:残差 vs 年积日。amp = 季度均值极差,年周期振幅的粗测 */
  doy: { id: number; name: string; pts: { doy: number; v: number; inSeg: boolean }[]; amp: number }[]
  /** L4:单栋块自助零分布 + 观测值。跟着 focusId 走;不给则取 p 最小的那栋 */
  nullDist: { id: number; name: string; dist: number[]; obs: number } | null
  /** L5:抛光收敛读数 + 行优先/列优先的排名对照 */
  convergence: {
    names: string[]; rowRank: number[]; colRank: number[]; flipped: string[]
    iterations: number; converged: boolean
    /** 两种扫描顺序各自的逐轮位移。**两条都要画** —— 只画行优先的话,
     *  「列优先那次压根没收住」会伪装成「换个顺序名次就变」,把算法故障读成结论不稳。 */
    trace: number[]; traceCol: number[]
    /** 两次抛光同一栋 α 的最大差(%)。名次是序数、丢了量纲:两栋 α 差 0.001% 也能换名次,
     *  图上却是一次醒目的交叉。这一个标量就是给那次交叉配的量纲。 */
    alphaGapPct: number
  }
  /** L6 */
  quality: { dates: string[]; rows: QualityRow[] }
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

/** 闭区间的逐日日历。质量矩阵的横轴用它,理由见 buildLab 里 L6 那一段。 */
function dateSpan(from: string, to: string): string[] {
  const out: string[] = []
  const end = Date.parse(`${to}T00:00:00Z`)
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= end; t += 86400000) {
    out.push(new Date(t).toISOString().slice(0, 10))
  }
  return out
}

/**
 * 工作台的全部七块。
 *
 * @param focusId L4 零分布画哪一栋(跟着屏上选中走)。不给取 p 最小的那栋。
 */
export function buildLab(snap: AnaSnapshot, input: SnapshotInput, focusId?: number): LabResult {
  const { rows, stations } = input
  const polish = snap.polish
  // 显示顺序跟着快照的站列表走,不用 Map 的插入顺序 —— 后者取决于 rows 里谁先出现
  const inPlay = snap.stations.filter(s => polish.resid.has(s.id))
  // 残差 Map 是按 rows 的顺序插的,ACF 与观测窗口都要求时序,所以先排一次
  const seriesOf = new Map(inPlay.map(s => {
    const arr = [...polish.resid.get(s.id)!].sort((a, b) => a[0].localeCompare(b[0]))
    return [s.id, { dates: arr.map(([d]) => d), vals: arr.map(([, v]) => v) }]
  }))

  // ── L2 ACF / N_eff ────────────────────────────────────────────────────
  // 最大滞后**由样本量定**,不写死 30。acf() 内部只按 min(maxLag, n-1) 截 ——
  // n=31 时它照样吐到 lag 30,而 lag 30 只有 **1 对样本**,右半条全是噪声,
  // 偏偏图还渲染得出来。惯例是 n/4:31 点只能诚实画到 lag 7。
  // 这也正是 **L2 不能跟着月档走**的原因:块自助的块长是 14 天,
  // 看不到 lag 14 就验证不了「块够不够长」,而一个月最多看到 7。
  const acfMaxLag = (n: number) => Math.max(1, Math.min(30, Math.floor(n / 4)))
  const acfRows = inPlay.map(s => {
    const r = seriesOf.get(s.id)!.vals
    const rho = acf(r, acfMaxLag(r.length))
    return { id: s.id, name: s.name, rho, nEff: nEffOf(rho, r.length) }
  })
  const nEffById = new Map(acfRows.map(a => [a.id, a.nEff]))

  // ── L7 完整检验表 ─────────────────────────────────────────────────────
  const sigmaPool = robustSigma([...polish.resid.values()].flatMap(m => [...m.values()]))
  const alphaById = new Map(congenitalCheck(polish, stations).map(c => [c.id, c]))
  const raw = inPlay.map(s => {
    const r = seriesOf.get(s.id)!.vals
    const w = labWindow(snap, seriesOf.get(s.id)!.dates)
    const win = w.idx.map(i => r[i])
    const obs = win.length ? win.reduce((a, b) => a + b, 0) / win.length : 0
    const sigma = shrinkSigma(robustSigma(r), sigmaPool, 1e-4)
    const nEff = nEffById.get(s.id) ?? r.length
    // 变点走抽屉那一支:同一份快照、同一组 opts、同一个种子 → 与抽屉里的 p 逐位相同
    const detail = buildDetail(snap, s.id)
    return {
      id: s.id, name: s.name,
      alphaPct: alphaById.get(s.id)?.alphaPct ?? 0,
      // z 用 **N_eff** 不是 n —— 用 n 的话这一列就是那个「乐观 1~3 个数量级」的错数。
      // ⚠ 不能写成 min(win.length, nEff):nEff 是**整条序列**(365 天)的有效样本量,
      //   ρ=0.5 下约 122,min(30,122) 恒等于 30 —— 修正一次都不会生效,z 永远等于 zNaive。
      //   要用的是**同一个膨胀系数**折算到窗口上:effWin = win.length × (nEff / n)。
      z: win.length && sigma > 0 ? obs * Math.sqrt(win.length * (nEff / Math.max(1, r.length))) / sigma : null,
      zNaive: win.length && sigma > 0 ? obs * Math.sqrt(win.length) / sigma : null,
      p: detail?.cp ? detail.cp.p : 1,
      nEff,
      sigmaHow: '一阶差分 MAD ÷ √2，再与全园收缩各半',
      cpRange: detail?.cpLo && detail?.cpHi ? `${detail.cpLo} ~ ${detail.cpHi}` : '—',
      days: r.length,
      obs, winLen: win.length,
      // 徽标必须从**实际算 z 用的那个窗口**带出来。原来 windowInfo 另起一次
      // labWindow 调用,于是把这里改回写死「最后 30 天」时徽标照样显示当段 ——
      // 图上的话与图算的数分了家,断言也就咬不住(2026-09-02 破坏验证抓到)。
      winLabel: w.label, winFellBack: w.fellBack,
    }
  })
  // **从 raw 里带出来,不另起一次 labWindow** —— 见 raw 里 winLabel 的注释
  const windowInfo = {
    label: raw[0]?.winLabel ?? '',
    fellBack: raw[0]?.winFellBack ?? false,
    n: raw.length ? Math.max(...raw.map(x => x.winLen)) : 0,
  }

  const qs = bhFdrQ(raw.map(x => x.p))
  const tests: TestRow[] = raw.map((x, i) => ({
    id: x.id, name: x.name, alphaPct: x.alphaPct,
    z: x.z, zNaive: x.zNaive, p: x.p, q: qs[i],
    nEff: x.nEff, sigmaHow: x.sigmaHow, cpRange: x.cpRange, days: x.days,
  }))

  // ── L3 残差 vs 年积日 ─────────────────────────────────────────────────
  // **上线前必做**:有稳定年周期 = 模型缺项(季节性遮挡),**不是故障**。
  // 不做这个,春秋两季会各刷一批假变点。amp 大就该回去补模型。
  // 横轴就是**年积日**,一个月只是这条轴上的一小段 —— 跟着月档走会把它变成
  // 「30 个点的散点」,而它要回答的是「有没有年周期」,一个月里根本没有年周期可看。
  // 所以它必须画整年,但**当段的点带 inSeg 标记**,屏上高亮 —— 跟得上期间,又不撒谎。
  const inSegOf = (d: string) =>
    snap.gran === 'month' && snap.ym ? d.startsWith(snap.ym) : true
  const doy = inPlay.map(s => {
    const { dates, vals } = seriesOf.get(s.id)!
    const pts = dates.map((d, i) => ({ doy: dayOfYear(d), v: vals[i], inSeg: inSegOf(d) }))
    // 季度均值的极差 = 年周期振幅的粗测(够用来报警,不用拟合正弦)
    const q4 = [0, 0, 0, 0].map((_, k) => {
      const seg = pts.filter(p => Math.floor((p.doy - 1) / 91.5) === k)
      return seg.length ? seg.reduce((a, b) => a + b.v, 0) / seg.length : 0
    })
    return { id: s.id, name: s.name, pts, amp: Math.max(...q4) - Math.min(...q4) }
  })

  // ── L4 块自助零分布 + 观测值 ──────────────────────────────────────────
  // 让 p 值**看得见**,比一个 p=0.003 可信。一次只画一栋 —— 十三张零分布图没人看。
  const focus = (focusId != null ? raw.find(x => x.id === focusId) : undefined)
    ?? [...raw].sort((a, b) => a.p - b.p)[0]
  const nullDist = focus && focus.winLen > 0
    ? {
        id: focus.id, name: focus.name, obs: focus.obs,
        dist: blockBootstrapP(seriesOf.get(focus.id)!.vals, focus.obs, focus.winLen,
          { block: 14, B: 999, seed: 20260831 }).nullDist,
      }
    : null

  // ── L5 抛光收敛诊断 ───────────────────────────────────────────────────
  // 行优先/列优先各跑一次。**排名翻转 = 该结论不稳,不上报**。
  // **必须用快照那一份日集合**。自己再挑一遍日子的话,两次抛光之间就多了第二个变量,
  //   隔离不出扫描顺序 —— 实测过:把 'col' 写成 'row'(等于没诊断)照样「排名不同」。
  const colFirst = medianPolish(rows, stations, snap.usedDays, 'col')
  const rowRankMap = rankOf(inPlay.map(s => ({ id: s.id, v: polish.alpha.get(s.id) ?? 0 })))
  const colRankMap = rankOf(inPlay.map(s => ({ id: s.id, v: colFirst.alpha.get(s.id) ?? 0 })))
  const convergence = {
    names: inPlay.map(s => s.name),
    rowRank: inPlay.map(s => rowRankMap.get(s.id) ?? 0),
    colRank: inPlay.map(s => colRankMap.get(s.id) ?? 0),
    flipped: inPlay
      .filter(s => Math.abs((rowRankMap.get(s.id) ?? 0) - (colRankMap.get(s.id) ?? 0)) > 1)
      .map(s => s.name),
    iterations: polish.iterations,
    converged: polish.converged,
    trace: polish.trace,
    traceCol: colFirst.trace,
    // Math.max(0, ...) 顺带兜住 inPlay 为空时 Math.max() 返回 -Infinity
    alphaGapPct: Math.max(0, ...inPlay.map(s =>
      (Math.exp(Math.abs((polish.alpha.get(s.id) ?? 0) - (colFirst.alpha.get(s.id) ?? 0))) - 1) * 100)),
  }

  // ── L6 数据质量矩阵 ───────────────────────────────────────────────────
  // 横轴用**首末抄表日之间的整段日历**,不是「有抄表的那些日子」——
  // 后者会让「全园一天都没抄」的日子从图上整列消失,而那正是这张图要回答的问题。
  // 也不铺满自然年:投产前那几个月会铺出一大片假的「漏抄」。
  //
  // **横轴跟着显示段走**(2026-09-02):月档只画当月那三十来列,年档画首末抄表日之间的整段。
  // 365 列 @2px 几乎读不出哪一格是哪天;31 列给到 6px 才谈得上「回答剔了哪些天」。
  // 这一块跟期间走没有任何统计障碍 —— 它是**记账**不是估计,一格就是一天,不需要样本量。
  const readDates = new Set(rows.map(r => r.date))
  const firstRead = rows.reduce<string | null>((m, r) => (m == null || r.date < m ? r.date : m), null)
  const spanAll = firstRead && snap.dataThrough ? dateSpan(firstRead, snap.dataThrough) : []
  const dates = snap.gran === 'month' && snap.ym
    ? spanAll.filter(d => d.startsWith(snap.ym!))
    : spanAll
  const firstOf = new Map<number, string>()
  for (const r of rows) {
    const cur = firstOf.get(r.stationId)
    if (cur == null || r.date < cur) firstOf.set(r.stationId, r.date)
  }
  const quality = {
    dates,
    rows: snap.stations.map<QualityRow>(s => {
      const resid = polish.resid.get(s.id)
      const born = firstOf.get(s.id) ?? null
      return {
        id: s.id, name: s.name, inMatrix: resid != null,
        states: dates.map<QualityState>(d =>
          born == null || d < born ? 'pre'
            : resid?.has(d) ? 'ok'
              // 「整日剔除」只算真的被剔的那些日子:全园都没抄 ≠ 剔除,那是全园漏抄
              : readDates.has(d) && snap.usedDays != null && !snap.usedDays.has(d) ? 'dropped'
                : 'missing'),
      }
    }),
  }

  // 容量台账与铭牌对不上的栋不进 α 排序 —— 它们的 α 是台账错算出来的,不是性能水平。
  // ⚠ 只有两列都录了(capKwp 与板数 × 铭牌功率)才判得出来;板数没录的栋 ledgerDiff 为 null,
  //   这里放行,由 snap.quality.noPanel 在屏上说明「这栋的 α 没经过台账校验」。
  const badLedger = new Set(snap.stations
    .filter(s => s.ledgerDiff != null && Math.abs(s.ledgerDiff) > snap.crit.ledger)
    .map(s => s.id))
  const alphaAll = [...alphaById.values()].sort((a, b) => a.alphaPct - b.alphaPct)
  return {
    snapshotId: snap.id,
    window: windowInfo,
    alphaRows: alphaAll.filter(c => !badLedger.has(c.id)),
    alphaExcluded: alphaAll.filter(c => badLedger.has(c.id)).map(c => c.name),
    tests, acf: acfRows, doy, nullDist, convergence, quality,
  }
}
