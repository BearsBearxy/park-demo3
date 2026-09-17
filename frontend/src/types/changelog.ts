// 更新记录的形状(内容在 src/changelog.ts,规范见 docs/design/VERSION-UPDATE-SPEC.md)。

/** 一条更新。`to` 是侧栏里那一屏的 value(nav/fpNav.ts),给了才在屏上出现「去看看」。 */
export interface ReleaseItem {
  /** ds/icon.ts 里的图标名;写了表里没有的名字会回落成问号图标并在控制台告警。 */
  icon: string
  title: string
  desc: string
  to?: string
  /** 「去看看」要换成别的字时写这里(如本版重点那张卡的「去本月出账」)。 */
  toLabel?: string
}

export interface ReleaseNote {
  /** 与 package.json 的 version 逐字相同。 */
  version: string
  /** YYYY-MM-DD,发布日期。 */
  date: string
  /** 一句话说这一版最重要的是什么,弹窗页头和版本列表都用它。 */
  headline: string
  /** 本版重点:弹窗顶上单独一张卡。没有重点就不写。 */
  feature?: ReleaseItem
  added: ReleaseItem[]
  improved: ReleaseItem[]
  /** 修复只有一句话,不带图标也不跳转 —— 写「原来哪里不对」。 */
  fixed: string[]
}
