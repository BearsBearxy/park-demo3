// src/components/ana/anaTheme.ts — ECharts 统一主题:浅色 fpAnaTheme / 暗色 fpAnaThemeDark(spec §一,DARK-MODE-SPEC §6)。
// 色板:蓝族主色 + teal/coral/amber 辅助 + 语义红;细网格(var(--divider) 观感)、
// tooltip 深底白字沿 .cz-tip 观感(背景 = --tip-bg、圆角 9、字号 11)。
// 主题为纯 JSON,无法引用 CSS 变量 → 取 tokens.css 字面值,浅色、暗色各一套(ANA_LIGHT / ANA_DARK,同结构)。
// 暗色值出处:运维文档/设计稿/未实现/暗色模式-2026-09-19 的 Analysis 板第 1 节(生成脚本逐格断言 ≥3 / ≥4.5)。
// 视图里要在 option 里写颜色的,一律从 anaPalette() 取(按当前外观;读它的 computed 会在切外观时重算)。
// 时长 / 曲线同理:DUR、EASE 是 tokens.css 的镜像常量,别在这里写字面量(anaMotion.ts)。
import { DUR, EASE } from './anaMotion'
import { resolvedTheme } from '@/stores/appearance'

// ⚠ 必须与 tokens.css 的 --font-sans 逐字一致(ECharts 主题是纯 JSON,引不了 CSS 变量)。
// 不同步的话图表轴标签/图例会和页面其余部分不是同一个字体,并排一看就出戏。
// 2026-08-20 同步:此处曾停在 "Roboto Mono"(旧值),而 tokens.css 早已改为 "Roboto Mono Digits"。
// tokens.css 里写明了为什么换:整族 Roboto Mono 会把拉丁**字母**也变等宽,实测同串 16px 文本
// 163.2px vs 系统 sans 149.9px = +9%。于是图表里的 kWh / Top20 / 2025-01 是等宽、页面上是比例,
// 并排一看就出戏 —— 正是本文件头注释警告的那种不同步。Digits 版只接管 0-9,其余回退系统栈。
const FONT_SANS = '"Roboto Mono Digits", -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Segoe UI", sans-serif'

/** 一套图表配色。浅色 / 暗色同结构,切外观 = 换一套。 */
export interface AnaPalette {
  /** 分类色板(无序类目,见下面 CAT_COLORS 的说明) */
  cat: string[]
  /** 主题默认 color:前 4 位是蓝族渐变(顺序色板) */
  seq: string[]
  grid: string; axis: string; label: string; legend: string
  /** 悬停提示框 / 图上气泡的底(= --tip-bg),字恒白 */
  tipBg: string; tipShadow: string
  /** 点标注的环色 */
  callout: { red: string; amber: string; blue: string }
  /** 空心环的芯 = 卡片色 */
  calloutCore: string
  /** bandSeries 默认带色 */
  band: string
  /** 坐标轴名字(「万/月」「收款率(%)」)。浅色照 ECharts 默认(类目轴 = 轴线色、数值轴 = #54555a),
   *  写出来只为暗色能换:不写的话暗色下数值轴名还是 #54555a(对卡片 1.93:1)、类目轴名是 16% 白 */
  axisName: { category: string; value: string }
  /** 对比参照线(预算 / 环比基线):线色,也当 markLine 标签的字色,要 ≥4.5 */
  cmp: { budget: string; baseline: string }
}

/** 分类色板 —— 色相互不相同,给「各充电桩 / 各运营商 / 各费项」这类**无序类目**用。
 *
 *  为什么不能用下面主题默认的 color:它前 4 位是蓝族渐变(#378ADD→#85B7EB→#B5D4F4→#185FA5),
 *  那是**顺序色板**,给「期区 1/2/3」这类有序量用的 —— 实测这 4 个蓝两两对比度最低只有 1.37
 *  (#85B7EB vs #B5D4F4),堆在一起勉强能看出分界,但用来区分互不相干的类目就读不出谁是谁。
 *  首位仍是 #378ADD,与主题同起点,单系列图换不换色板外观一致。
 *  取色全部来自主题既有 8 色,不引入新色相,只是**重排成色相优先**。 */
export const ANA_LIGHT: AnaPalette = {
  cat: ['#378ADD', '#EF9F27', '#5DCAA5', '#E24B4A', '#F0997B', '#185FA5', '#85B7EB', '#B5D4F4'],
  seq: ['#378ADD', '#85B7EB', '#B5D4F4', '#185FA5', '#5DCAA5', '#F0997B', '#EF9F27', '#E24B4A'],
  grid: 'rgba(28,28,28,.1)',      // var(--divider) 观感
  axis: 'rgba(28,28,28,.15)',
  label: 'rgba(28,28,28,.62)',    // var(--text-muted) 观感
  legend: 'rgba(28,28,28,.8)',    // var(--text-secondary)
  tipBg: 'rgb(40,52,66)',
  tipShadow: 'box-shadow:0 8px 24px rgba(0,0,0,.18);',
  // tokens.css --hue-red / --hue-orange 的字面值 + 主题深蓝(比数据色深一档,环在光晕上看得清)
  callout: { red: '#BC4A41', amber: '#9D5D17', blue: '#185FA5' },
  calloutCore: '#fff',
  band: 'rgba(28,28,28,.07)',
  axisName: { category: 'rgba(28,28,28,.15)', value: '#54555a' },
  // 2026-08-20 压暗:原 #A78BFA 对白底仅 2.72:1(用户原话「这个紫色的线看不清楚」)、#94A3B8 仅 2.56:1
  cmp: { budget: '#7C3AED', baseline: '#64748B' },   // 5.70 / 4.76
}

/**
 * 暗色(稿 Analysis 第 1 节):分类色只换第 6 个深蓝(暗底上只有 2.2:1)→ 灰蓝,主题 color[3] 同值一起换;
 * 其余 7 个在暗底上本来就 ≥3:1,两种外观颜色一致。网格 8% 白、轴线 16% 白、坐标字 / 图例 = 暗色
 * --text-muted / --text-secondary;提示框底 = 暗色 --tip-bg(rgb 写法,zrender 不认 oklch);
 * 标注环 = 暗色 --hue-red / --hue-orange / --hue-blue,芯 = 卡片色 --surface-white。
 */
export const ANA_DARK: AnaPalette = {
  cat: ['#378ADD', '#EF9F27', '#5DCAA5', '#E24B4A', '#F0997B', '#6E86AE', '#85B7EB', '#B5D4F4'],
  seq: ['#378ADD', '#85B7EB', '#B5D4F4', '#6E86AE', '#5DCAA5', '#F0997B', '#EF9F27', '#E24B4A'],
  grid: 'rgba(255,255,255,.08)',
  axis: 'rgba(255,255,255,.16)',
  label: 'rgba(236,236,238,.62)',
  legend: 'rgba(236,236,238,.8)',
  tipBg: 'rgb(62,77,95)',
  tipShadow: 'box-shadow:0 0 0 1px rgba(255,255,255,.1),0 8px 24px rgba(0,0,0,.4);',
  callout: { red: 'rgb(250,136,125)', amber: 'rgb(239,165,85)', blue: 'rgb(109,176,244)' },
  calloutCore: 'rgb(42,42,44)',
  band: 'rgba(255,255,255,.07)',
  axisName: { category: 'rgba(236,236,238,.62)', value: 'rgba(236,236,238,.62)' },   // = 坐标字
  // 浅色那两个压暗过的在卡片上只有 2.51 / 3.01;换回压暗前的同色相浅色,对卡片 5.26 / 5.59
  cmp: { budget: '#A78BFA', baseline: '#94A3B8' },
}

/**
 * 自绘 SVG 图(租金带 AnaRentBandChart / 续签 AnaRenewalChart / 预测 AnaForecastChart / 单价分布 AnaUnitRentHist)的颜色。
 * 以 CSS 变量挂在图的根上(:style="anaSvgVars()"),样式里引这些 --sv-… 变量;模板里调,切外观时重算、不用重挂载。
 * 浅色 = 各图原来写死的 Figma 取色(逐位不变);暗色:网格 / 轴线 / 坐标字 / 提示框同 ANA_DARK,
 * 数据线与字换同色相的浅色(线对卡片 ≥3、字 ≥4.5),带子换压暗的蓝。
 */
const SVG_LIGHT = {
  '--sv-shade': '#F5F6F9',
  '--sv-grid': '#E9EBEF',
  '--sv-grid-fc': '#E5EAF0',
  '--sv-grid-soft': '#EEF0F4',
  '--sv-axis': '#D7DBE2',
  '--sv-label': '#94A3B8',
  '--sv-label-strong': '#6B7280',
  '--sv-gap-text': '#8A9099',
  '--sv-note': '#B6BDC8',
  '--sv-locked': '#98A2B3',
  '--sv-split': '#C6CCD6',
  '--sv-today': '#CBD5E1',
  '--sv-mark': '#9AA4B2',
  '--sv-bar-muted': '#C8CDD6',
  '--sv-band': '#BFD8F5',
  '--sv-band-hist': '#DCEAFB',
  '--sv-line': '#2E7CD6',
  '--sv-bar-in': '#6AA9E9',
  '--sv-deep': '#185FA5',
  '--sv-gap': '#D97757',
  '--sv-cap': '#4F79A8',
  '--sv-tip-bg': '#1E293B',
  '--sv-tip-text': '#E2E8F0',
  '--sv-hair': '#C7D2FE',
  '--sv-fc-band': '#C7D2FE',
  '--sv-fc-mid': '#A5B4FC',
  '--sv-fc-line': '#4F46E5',
  '--sv-figure': '#1E293B',
}
const SVG_DARK: typeof SVG_LIGHT = {
  '--sv-shade': 'rgba(255,255,255,.04)',
  '--sv-grid': 'rgba(255,255,255,.08)',
  '--sv-grid-fc': 'rgba(255,255,255,.08)',
  '--sv-grid-soft': 'rgba(255,255,255,.08)',
  '--sv-axis': 'rgba(255,255,255,.16)',
  '--sv-label': 'rgba(236,236,238,.62)',
  '--sv-label-strong': 'rgba(236,236,238,.8)',
  '--sv-gap-text': 'rgba(236,236,238,.62)',
  '--sv-note': 'rgba(236,236,238,.45)',
  '--sv-locked': 'rgba(236,236,238,.45)',
  '--sv-split': 'rgba(236,236,238,.25)',
  '--sv-today': 'rgba(236,236,238,.3)',
  '--sv-mark': 'rgba(236,236,238,.4)',
  '--sv-bar-muted': 'rgba(236,236,238,.22)',
  '--sv-band': 'rgb(62,98,140)',
  '--sv-band-hist': 'rgb(62,98,140)',
  '--sv-line': 'rgb(109,176,244)',
  '--sv-bar-in': '#6AA9E9',
  '--sv-deep': 'rgb(143,178,221)',
  '--sv-gap': '#F0997B',
  '--sv-cap': 'rgb(143,178,221)',
  '--sv-tip-bg': 'rgb(62,77,95)',
  '--sv-tip-text': '#E2E8F0',
  '--sv-hair': 'rgba(165,180,252,.5)',
  '--sv-fc-band': '#4F46E5',
  '--sv-fc-mid': 'rgba(165,180,252,.7)',
  '--sv-fc-line': '#A5B4FC',
  '--sv-figure': 'rgb(236,236,238)',
}
export function anaSvgVars(): Record<string, string> {
  return resolvedTheme.value === 'dark' ? SVG_DARK : SVG_LIGHT
}

/** 当前外观那一套。在 computed / 渲染里调:读了 resolvedTheme,切外观时会重算。 */
export function anaPalette(): AnaPalette {
  return resolvedTheme.value === 'dark' ? ANA_DARK : ANA_LIGHT
}
/** 当前外观对应的 ECharts 主题名(AnaEChart init 用)。 */
export function anaThemeName(): 'fpAnaTheme' | 'fpAnaThemeDark' {
  return resolvedTheme.value === 'dark' ? 'fpAnaThemeDark' : 'fpAnaTheme'
}

/** 浅色分类色板(存量视图直接 import 它;要跟外观走的请用 anaPalette().cat)。 */
export const CAT_COLORS = ANA_LIGHT.cat

function makeTheme(p: AnaPalette) {
  return {
  // ⚠ 前 4 位是蓝族**渐变**(顺序色板),只适合有序量(期区 1/2/3、档位高低)。
  //   互不相干的类目请显式传 CAT_COLORS,别吃这个默认值。
  color: p.seq,
  backgroundColor: 'transparent',
  textStyle: { fontFamily: FONT_SANS },
  // hover 强调态(C6-04):引擎默认 300ms,读处 echarts.js:1935-1942。静态默认进主题,
  // 动态相位(enter / update / reduced / 离屏)进 anaMotion.motionize —— 两处不混。
  stateAnimation: { duration: DUR.state, easing: EASE.update },
  categoryAxis: {
    axisLine: { lineStyle: { color: p.axis } },
    axisTick: { show: false },
    axisLabel: { color: p.label, fontSize: 11 },
    nameTextStyle: { color: p.axisName.category },
    splitLine: { show: false },
  },
  valueAxis: {
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { color: p.label, fontSize: 11 },
    nameTextStyle: { color: p.axisName.value },
    splitLine: { lineStyle: { color: p.grid } },
  },
  legend: { textStyle: { color: p.legend, fontSize: 11 }, itemWidth: 11, itemHeight: 11 },
  tooltip: {
    // 默认 0.4s(TooltipModel.js:76);≤0 时 TooltipHTMLContent.js:154 不加 CSS transition。
    // 指针跟随类反馈必须零延迟:任何 >0 的跟随都让浮层落后指针(C6-04)。
    transitionDuration: 0,
    backgroundColor: p.tipBg,
    borderWidth: 0,
    borderRadius: 9,
    padding: [8, 11],
    textStyle: { color: '#fff', fontSize: 11 },   // 两套都是深底白字
    extraCssText: p.tipShadow,
  },
  }
}

export const FP_ANA_THEME = makeTheme(ANA_LIGHT)
export const FP_ANA_THEME_DARK = makeTheme(ANA_DARK)

let registered = false
/** 注册 fpAnaTheme / fpAnaThemeDark(幂等)。echarts 由 AnaEChart 动态 import 后传入,保持懒加载 chunk 分割。 */
export function registerFpAnaTheme(ec: { registerTheme(name: string, theme: object): void }): void {
  if (registered) return
  registered = true
  ec.registerTheme('fpAnaTheme', FP_ANA_THEME)
  ec.registerTheme('fpAnaThemeDark', FP_ANA_THEME_DARK)
}

/** 点标注的环色(浅色值;调用方照旧传 CALLOUT.red 这类,calloutMark 按当前外观换成暗色那一档)。
 *  光晕用的是数据本身的颜色(柱 / 线的色),环色只管「这是被标注的那个点」。 */
export const CALLOUT = ANA_LIGHT.callout

export type CalloutSide = 'top' | 'bottom'
/** 挂在 markPoint 数据项上的气泡说明;AnaEChart 读它,在图上叠一层 HTML 气泡。 */
export interface CalloutSpec { lines: string[]; prefer: CalloutSide }
export interface CalloutItem { coord: (number | string | null)[]; lines: string[]; [extra: string]: unknown }

/**
 * 图上「钉住一个点并写几个字」的唯一写法(2026-09-17 用户选定设计稿方案 A「深色气泡」,
 * 稿在 ../运维文档/设计稿/已实现/图上点标注-2026-09-17/OptionA):
 * 点上一个空心环 + 数据色光晕;字写在深色气泡里(与悬停提示框同一个样子),带尖角指着点。
 *
 * 为什么气泡不用 markPoint 的 label:ECharts 的标注不会夹在图边以内,也画不了「气泡挪进来、
 * 尖角仍对准点」—— 改前两版(pin 符号、实底小签)都栽在这:字溢出针头看不见 / 靠边被裁。
 * 这里只出环与光晕,气泡的字与方位放在数据项的 `callout` 上,由 AnaEChart 换算成像素后摆放(placeCallout)。
 *
 * prefer:气泡优先放点的哪一侧;放不下(碰到图例带或图底)时 placeCallout 翻到另一侧。
 */
export function calloutMark(hue: string, dataColor: string, items: CalloutItem[], prefer: CalloutSide = 'top'): object {
  const p = anaPalette()
  // 传进来的是 CALLOUT 里的浅色值 → 换成当前外观那一档(浅色 #BC4A41 在暗底上只有 2.86:1);别的颜色原样用
  const key = (Object.keys(CALLOUT) as (keyof typeof CALLOUT)[]).find((k) => CALLOUT[k] === hue)
  const ring = key ? p.callout[key] : hue
  return {
    silent: true,
    symbol: 'circle',
    label: { show: false },
    // 光晕在前、环在后:同一个 markPoint 里后画的压在上面
    data: items.flatMap(({ lines, ...rest }) => [
      { ...rest, symbolSize: 18, itemStyle: { color: dataColor, opacity: 0.16 } },
      { ...rest, symbolSize: 8, itemStyle: { color: p.calloutCore, borderColor: ring, borderWidth: 2.2 }, callout: { lines, prefer } satisfies CalloutSpec },
    ]),
  }
}

/** 从 option 里收出所有气泡(seriesIndex 与 option.series 的下标一致)。 */
export function calloutsOf(option: object): { seriesIndex: number; coord: (number | string | null)[]; spec: CalloutSpec }[] {
  const series = (option as { series?: unknown }).series
  const list = Array.isArray(series) ? series : series ? [series] : []
  return list.flatMap((s, seriesIndex) => {
    const data = (s as { markPoint?: { data?: unknown[] } } | null)?.markPoint?.data ?? []
    return data.flatMap((d) => {
      const it = d as { coord?: (number | string | null)[]; callout?: CalloutSpec }
      return it.callout && it.coord ? [{ seriesIndex, coord: it.coord, spec: it.callout }] : []
    })
  })
}

/** 点心到气泡边:环半径 4 + 空 3.5 + 尖角 6。 */
export const CALLOUT_GAP = 13.5
/** 气泡上沿不得高于此:主题图例 top 0 + 内距 5 + 图标 11,底在 20 附近。 */
export const CALLOUT_TOP_LIMIT = 22
const CALLOUT_EDGE = 4        // 气泡离图边
const CALLOUT_TIP_INSET = 8   // 尖角离气泡左右沿(圆角 6 + 余量)

/**
 * 气泡摆放(像素,相对图容器左上):优先侧放得下就放,放不下翻到另一侧;
 * 横向居中于点、夹在图边以内,尖角 tipX(相对气泡左沿)始终对准点。
 */
export function placeCallout(
  dot: { x: number; y: number }, box: { w: number; h: number }, canvas: { w: number; h: number }, prefer: CalloutSide,
): { side: CalloutSide; left: number; top: number; tipX: number } {
  const above = dot.y - CALLOUT_GAP - box.h
  const below = dot.y + CALLOUT_GAP
  const fitsTop = above >= CALLOUT_TOP_LIMIT
  const fitsBottom = below + box.h <= canvas.h - CALLOUT_EDGE
  const side: CalloutSide = prefer === 'top' ? (fitsTop || !fitsBottom ? 'top' : 'bottom') : (fitsBottom || !fitsTop ? 'bottom' : 'top')
  const left = Math.max(CALLOUT_EDGE, Math.min(canvas.w - CALLOUT_EDGE - box.w, dot.x - box.w / 2))
  const tipX = Math.max(CALLOUT_TIP_INSET, Math.min(box.w - CALLOUT_TIP_INSET, dot.x - left))
  return { side, left, top: side === 'top' ? above : below, tipX }
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
  const { name = '', color = anaPalette().band, stack = 'band', dp = 0, series = {} } = opt
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
 * 合约租金带(当时也走 bandSeries)的注释早按同一条理由写过豁免 —— 续签是非黑即白的个体事件,
 * 带宽本身就是内容;C2 只是把这条理由补用到它真正管着的那两条上。
 * (那张 ECharts 图 2026-09-12 起换成自绘 AnaRentBandChart,不再经过 bandSeries。)
 *
 * 删掉而不是留着不调用:计划 §5 禁做清单把这道门本来要管的时序外推带**全部**禁掉了
 * (月度收缴 / 办公楼电量 / 财务报表趋势 / 台账应收 / 保本点 / 退租 / 预算 / 到期墙 / 光伏三表),
 * 合约租金带又已改为自绘,今天与可预见的将来都没有一条带该受它管。留着一个零调用方的门,
 * 只会让下一个人把它套到下一条横截面带上 —— C2 就是这么来的。
 * 真要给某条**外推**带重新配一道宽度门,把上面这段论证重读一遍再写,不要直接复活旧实现。
 *
 * 门禁见 __tests__/bandSeries.spec.ts 末条:分析层的 bandSeries 调用一律不许挂条件。
 */
