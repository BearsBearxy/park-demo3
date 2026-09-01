// src/views/analysis/pvAnaColors.ts —— 光伏分栋分析屏 v3 的颜色字面值镜像(spec §06.7)。
//
// 为什么要镜像:
//   ECharts 的 option 是**纯 JSON**,序列化后交给 canvas 渲染,拿不到 DOM 也就拿不到
//   CSS 自定义属性 —— 写 `color: 'var(--hue-orange)'` 得到的不是橙色,是**图元静默不画**。
//   同理 `--hue-blue/--hue-orange` 在 tokens.css 里是 oklch(),而 canvas 2D 的 fillStyle
//   在部分目标浏览器上不认 oklch,给个不认识的颜色串 = 该图元不画且不报错。
//   所以这一份、且只有这一份文件,允许出现颜色字面值;屏上凡是走 CSS 的地方一律继续用
//   CSS 令牌变量,不许从这里取值往 style 里塞。先例:components/ana/anaTheme.ts。
//
// 改 tokens.css 必须同步改这里:
//   镜像是手抄的,没有构建期校验。动了下列任一令牌(改值 / 改名 / 删除),就要回到本文件
//   把对应行连同注释里的行号一起更新 —— 否则图表颜色会停在旧值,而页面其余部分已经变了,
//   并排一看就出戏(anaTheme.ts 的字体栈曾经就这样漂了一个版本)。
//   行号取自 frontend/src/styles/tokens.css(截至 2026-09-01),仅供人工核对,允许有偏移。
//
// 屏上只有 3 个色相,首屏只有 2 个;13 栋没有任何一栋拥有自己的颜色;全屏不用红。

export const PV_COLORS = {
  /** 墨阶。结构灰:轴、网格、文字、markArea 底色。带透明度是故意的 —— 叠在白卡上自然变浅。 */
  INK900: 'rgb(28,28,28)',            // --ink-900  tokens.css:110  rgb(28, 28, 28)
  INK700: 'rgba(28,28,28,0.8)',       // --ink-700  tokens.css:111
  INK500: 'rgba(28,28,28,0.4)',       // --ink-500  tokens.css:112
  INK300: 'rgba(28,28,28,0.2)',       // --ink-300  tokens.css:113
  INK100: 'rgba(28,28,28,0.1)',       // --ink-100  tokens.css:114
  INK050: 'rgba(28,28,28,0.05)',      // --ink-050  tokens.css:115

  /** 出范围。**全屏唯一强调色**,上越下越共用,方向靠位置 + ▲▼,不靠色。对白底 5.23:1。 */
  OUT: '#9D5D17',                     // --hue-orange  tokens.css:144  oklch(0.54 0.115 62)

  /** 链接色。**永不进数据** —— 只给可点文字/图标,任何 series/axis/markLine 都不许用它,
   *  否则「这根线是可点的」这条约定就废了。对白底 4.83:1。 */
  LINK: '#3675B2',                    // --hue-blue  tokens.css:135  oklch(0.55 0.115 250)

  /** 账面量三档:同一蓝家族的三档明度,是**有序**量(深→浅),不是三个类目。 */
  FILL_SLATE: '#788CB0',              // --fill-slate  tokens.css:154  rgb(120, 140, 176)
  FILL_CYAN: '#A0CDE8',               // --fill-cyan   tokens.css:156  rgb(160, 205, 232)
  FILL_SKY: '#C4E2F4',                // --fill-sky    tokens.css:157  rgb(196, 226, 244)
} as const
