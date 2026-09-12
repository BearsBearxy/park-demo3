// src/components/ana/anaTheme.ts — ECharts 统一浅色主题 fpAnaTheme(spec §一)。
// 色板:蓝族主色 + teal/coral/amber 辅助 + 语义红;白底、细网格(var(--divider) 观感)、
// tooltip 深底白字沿 .cz-tip 观感(背景 rgb(40,52,66)、圆角 9、字号 11)。
// 主题为纯 JSON,无法引用 CSS 变量 → 取 tokens.css 字面值(--divider=ink-100、--text-muted)。

// ⚠ 必须与 tokens.css 的 --font-sans 逐字一致(ECharts 主题是纯 JSON,引不了 CSS 变量)。
// 不同步的话图表轴标签/图例会和页面其余部分不是同一个字体,并排一看就出戏。
// 2026-08-20 同步:此处曾停在 "Roboto Mono"(旧值),而 tokens.css 早已改为 "Roboto Mono Digits"。
// tokens.css 里写明了为什么换:整族 Roboto Mono 会把拉丁**字母**也变等宽,实测同串 16px 文本
// 163.2px vs 系统 sans 149.9px = +9%。于是图表里的 kWh / Top20 / 2025-01 是等宽、页面上是比例,
// 并排一看就出戏 —— 正是本文件头注释警告的那种不同步。Digits 版只接管 0-9,其余回退系统栈。
const FONT_SANS = '"Roboto Mono Digits", -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Segoe UI", sans-serif'
const GRID_LINE = 'rgba(28,28,28,.1)'     // var(--divider) 观感
const AXIS_LINE = 'rgba(28,28,28,.15)'
const AXIS_LABEL = 'rgba(28,28,28,.62)'   // var(--text-muted) 观感

/** 分类色板 —— 色相互不相同,给「各充电桩 / 各运营商 / 各费项」这类**无序类目**用。
 *
 *  为什么不能用下面主题默认的 color:它前 4 位是蓝族渐变(#378ADD→#85B7EB→#B5D4F4→#185FA5),
 *  那是**顺序色板**,给「期区 1/2/3」这类有序量用的 —— 实测这 4 个蓝两两对比度最低只有 1.37
 *  (#85B7EB vs #B5D4F4),堆在一起勉强能看出分界,但用来区分互不相干的类目就读不出谁是谁。
 *  首位仍是 #378ADD,与主题同起点,单系列图换不换色板外观一致。
 *  取色全部来自主题既有 8 色,不引入新色相,只是**重排成色相优先**。 */
export const CAT_COLORS = ['#378ADD', '#EF9F27', '#5DCAA5', '#E24B4A', '#F0997B', '#185FA5', '#85B7EB', '#B5D4F4']

export const FP_ANA_THEME = {
  // ⚠ 前 4 位是蓝族**渐变**(顺序色板),只适合有序量(期区 1/2/3、档位高低)。
  //   互不相干的类目请显式传 CAT_COLORS,别吃这个默认值。
  color: ['#378ADD', '#85B7EB', '#B5D4F4', '#185FA5', '#5DCAA5', '#F0997B', '#EF9F27', '#E24B4A'],
  backgroundColor: 'transparent',
  textStyle: { fontFamily: FONT_SANS },
  categoryAxis: {
    axisLine: { lineStyle: { color: AXIS_LINE } },
    axisTick: { show: false },
    axisLabel: { color: AXIS_LABEL, fontSize: 11 },
    splitLine: { show: false },
  },
  valueAxis: {
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { color: AXIS_LABEL, fontSize: 11 },
    splitLine: { lineStyle: { color: GRID_LINE } },
  },
  legend: { textStyle: { color: 'rgba(28,28,28,.8)', fontSize: 11 }, itemWidth: 11, itemHeight: 11 },
  tooltip: {
    backgroundColor: 'rgb(40,52,66)',
    borderWidth: 0,
    borderRadius: 9,
    padding: [8, 11],
    textStyle: { color: '#fff', fontSize: 11 },
    extraCssText: 'box-shadow:0 8px 24px rgba(0,0,0,.18);',
  },
}

let registered = false
/** 注册 fpAnaTheme(幂等)。echarts 由 AnaEChart 动态 import 后传入,保持懒加载 chunk 分割。 */
export function registerFpAnaTheme(ec: { registerTheme(name: string, theme: object): void }): void {
  if (registered) return
  registered = true
  ec.registerTheme('fpAnaTheme', FP_ANA_THEME)
}

/**
 * 全站唯一一份「带子」—— 两条堆叠线:下沿透明哨兵 + 上沿只留填充,不描边(描了会被读成两条数据线)。
 *
 * 收编前全仓有五处逐字近似的手写:AnomalyView(园区 P25~P75)、TenantEnergyView(跨户均值±σ)、
 * PvMeterAnaView 三处(各栋四分位距 stack 'q'、样条带 stack 'band'、斜率标准误 stack 'se')。
 * 五处写了**四种** null 判法,收编后只许这一种:任一端 null → 该点整体 null。
 *
 * ⚠ 带色不在这里统一:AnomalyView/TenantEnergyView 用 rgba(28,28,28,.07),PV 三处用 C.INK100,
 *   差一档灰是有意的(PV-ANALYSIS-SPEC 要求渐变透明不描硬边)。统一配色是配色决定,不搭这趟车。
 *
 * ⚠ 两条系列默认都不进 tooltip(`tooltip:{show:false}`),不只是下沿哨兵:上沿那条数据是
 *   **宽度**(hi−lo),不是上沿本身。坐标轴 tooltip 一旦放它进去,标签写的是「P25~P75」
 *   「均值±σ带」,数字却是宽度值——读数句对不上量,正是这个计划要从屏上消灭的那种假话。
 *   真要在 tooltip 里印带的上下沿,用 formatter 自己算,不要指望这两条合成系列。
 */
export function bandSeries(
  lo: (number | null)[],
  hi: (number | null)[],
  opt: { name?: string; color?: string; stack?: string; dp?: number; series?: Record<string, unknown> } = {},
): object[] {
  const { name = '', color = 'rgba(28,28,28,.07)', stack = 'band', dp = 0, series = {} } = opt
  const base = { type: 'line', stack, symbol: 'none', silent: true, lineStyle: { opacity: 0 }, tooltip: { show: false }, ...series }
  const width = lo.map((l, i) => {
    const h = hi[i]
    return l == null || h == null ? null : +(h - l).toFixed(dp)
  })
  const floor = lo.map((l, i) => (l == null || hi[i] == null ? null : +l.toFixed(dp)))
  return [
    { ...base, name: '', data: floor },
    { ...base, name, data: width, areaStyle: { color } },
  ]
}

/*
 * ── 这里曾经有一个 `bandTooWide`(带宽门:半宽中位 / |中位中心| > 0.20 → 太宽,调用方只出点不画带)。
 * C2(对抗复查,2026-09-11)把它整个删掉了,原因不是它算错,而是**它没有可管的对象**。
 *
 * 它的全部论证来自**时序预测带**:月度实收 naiveLast 覆盖率 100% 但宽度 177%、ma3 224%、
 * 办公楼 ma3 620% —— 那是「覆盖率好看但带宽得没用」的外推带,宽度确实是它不可信的证据。
 * 可它上线后实际套住的两条带都是**横截面描述带**,而横截面带的宽本身就是结论:
 *
 *   实测 park_demo3(2026-09-11,逐月比值与 SQL 见 task-8-report.md):
 *     AnomalyView 同类电费 P25~P75  半宽中位/中心中位 = 0.781(逐月 0.75~0.82)
 *     TenantEnergyView 跨户均值±σ   = 1.000(lo=max(0,mean−σ),七个月全被夹到 0)
 *   两条都是阈值的四到五倍,**每一个真实月份都超** —— 门上线后这两条带一次都没画出来过,
 *   而屏上的读数句还在指着它们说「落在同类区间 ¥…~¥…」。
 *
 * 全局约束③早就写下了正确的判断:同类对标带「既不是 CI 也不是 PI……不含任何推断,
 * 没有抽样分布也没有模型」。一条不含推断的观测分位区间,宽只说明同类之间差距大 ——
 * 那正是读者来看这张图要知道的事,把它藏起来等于把这张卡存在的理由删掉。
 * expiry.logic.ts:rentRollOption 的注释已经按同一条理由给合约租金带写过豁免,C2 只是把
 * 这条理由补用到它真正管着的那两条上。
 *
 * 删掉而不是留着不调用:计划 §5 禁做清单把这道门本来要管的时序外推带**全部**禁掉了
 * (月度收缴 / 办公楼电量 / 财务报表趋势 / 台账应收 / 保本点 / 退租 / 预算 / 到期墙 / 光伏三表),
 * 加上合约租金带自带豁免,今天与可预见的将来都没有一条带该受它管。留着一个零调用方的门,
 * 只会让下一个人把它套到下一条横截面带上 —— C2 就是这么来的。
 * 真要给某条**外推**带重新配一道宽度门,把上面这段论证重读一遍再写,不要直接复活旧实现。
 *
 * 门禁见 __tests__/bandSeries.spec.ts 末条:分析层的 bandSeries 调用一律不许挂条件。
 */
