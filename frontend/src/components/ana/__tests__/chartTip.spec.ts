import { describe, expect, it } from 'vitest'
import { tipWidth, tipX } from '../chartTip'

// 断言钉 x 坐标。夹具的两行一中一数混排、长度不同 —— 全是数字或全是汉字时
// 「中文与数字分开算」这条写反了也照样绿。
const LINES = ['8 月 5 日', '比值 0.912']
// '8 月 5 日' = 2 汉字 × 12 + 5 其余 × 6.6 = 57
// '比值 0.912' = 2 汉字 × 12 + 6 其余 × 6.6 = 63.6 → 取整 64,+ 内边距 20 = 84

describe('tipWidth —— 按字符估宽', () => {
  it('取最长那行,汉字 12、其余 6.6,向上取整再加内边距', () => {
    expect(tipWidth(LINES)).toBe(84)
    expect(tipWidth(LINES, 22)).toBe(86)
    // 估宽小数 < .5 才分得出向上取整与四舍五入:'比值 0.9' = 24 + 4 × 6.6 = 50.4 → 51(四舍五入是 50)
    expect(tipWidth(['8 月', '比值 0.9'])).toBe(71)
  })
  it('同样 6 个字符,汉字行比数字行宽 32(6 × (12 − 6.6) 取整后)', () => {
    expect(tipWidth(['一二三四五六'])).toBe(72 + 20)
    expect(tipWidth(['123456'])).toBe(40 + 20)
  })
})

describe('tipX —— 右缘放不下翻到左边', () => {
  const box = { width: 400, padL: 44, padR: 14 }   // 右缘 386
  const w = tipWidth(LINES)                          // 84

  it('右侧放得下:竖线右 12', () => {
    expect(tipX(100, w, box)).toBe(112)
  })
  it('右侧正好贴到右缘(302 + 84 = 386)仍放右边', () => {
    expect(tipX(290, w, box)).toBe(302)
  })
  it('越过右缘 1px 就翻到竖线左边:x − 12 − 宽', () => {
    expect(tipX(291, w, box)).toBe(291 - 12 - 84)
    expect(tipX(300, w, box)).toBe(204)
  })
  it('左边也放不下时夹在 padL', () => {
    const narrow = { width: 150, padL: 44, padR: 14 }   // 右缘 136
    expect(tipX(90, w, narrow)).toBe(44)
    // 对照:同一个 x 在宽画布上放右边 —— 夹边只在两边都放不下时发生
    expect(tipX(90, w, box)).toBe(102)
  })
  it('gap 可调:行类气泡用 16', () => {
    expect(tipX(100, w, box, 16)).toBe(116)
    expect(tipX(300, w, box, 16)).toBe(200)
  })
})
