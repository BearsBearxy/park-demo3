// 自绘图悬停气泡的两件纯几何:按字符估宽、右缘放不下翻到左边。
// 抽自 AnaForecastChart.vue(那份暂不改,两处数值保持一致)。单测 __tests__/chartTip.spec.ts。

// 中日韩字与全角符号按 12px 估宽,其余(数字、字母、半角标点、空格)按 6.6px。
// 11~12px 字号下够用,宁可略宽也不切字 —— 写死宽度时「身前不足 3 个月,算不出带」那行被切过。
const CJK = /[\u3000-\u9fff\uff00-\uffef]/

/** 气泡宽 = 最长那行的估宽取整 + 左右内边距合计 pad */
export function tipWidth(lines: string[], pad = 20): number {
  let w = 0
  for (const l of lines) {
    let px = 0
    for (const ch of l) px += CJK.test(ch) ? 12 : 6.6
    w = Math.max(w, px)
  }
  return Math.ceil(w) + pad
}

/**
 * 气泡左上角 x。默认放在竖线右侧 gap;右边会越过绘图区右缘(width − padR)就翻到竖线左侧;
 * 左边也放不下时夹在 padL,不让气泡掉出绘图区。
 */
export function tipX(x: number, w: number, box: { width: number; padL: number; padR: number }, gap = 12): number {
  const right = box.width - box.padR
  const wantRight = x + gap
  return wantRight + w <= right ? wantRight : Math.max(box.padL, x - gap - w)
}
