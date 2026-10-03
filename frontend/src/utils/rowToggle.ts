// 表格展开 / 收起的点击范围放宽(2026-10-03 用户:「不是非要点击箭头才打开，放宽交互范围」)。
// 纯分组行整行可点;带数据的父行点名称那一格(这些区域带 .fp-rowtg)。箭头按钮仍是键盘入口,这里只放宽鼠标。
//
// 不算的两种:
// ① 点在行里别的控件上(按钮、链接、输入框、勾选框…)—— 箭头按钮自己的 @click 也走这条,不会一次切两下;
// ② 按下后拖动超过 5px 才松开 = 在拖选文字,不是点。
// 连点不设阈值,每一下都切换(动画可打断,见 rowMotion.ts)。2026-10-03 实测踩过的坑:原来用「选区非空就不算」挡拖选,
// 而连点第二击起浏览器按双击选词,90ms 间隔连点 10 下只切了 1 下;别处选着字时点这里也不切。
// 所以改看拖动距离,并在 .fp-rowtg 上拦掉第二击起的选词(第一击不拦,照样能从这里开始拖选)。

const CONTROLS = 'button, a, input, select, textarea, label, [role="button"], [contenteditable="true"]'
const DRAG_PX = 5

let down: { x: number; y: number } | null = null

export function rowToggle(e: MouseEvent, toggle: () => void): void {
  const t = e.target as Element | null
  if (t?.closest?.(CONTROLS)) return
  if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > DRAG_PX) return
  toggle()
}

/** main.ts 装一次:记下每次按下的位置;在可开合区域上拦掉多击选词。返回卸载函数(测试用) */
export function installRowToggle(): () => void {
  const onDown = (e: MouseEvent) => {
    down = { x: e.clientX, y: e.clientY }
    const t = e.target as Element | null
    if (e.detail > 1 && t?.closest?.('.fp-rowtg') && !t.closest(CONTROLS)) e.preventDefault()
  }
  // 一次点击结束(冒泡到 document,行上的处理已跑完)就清掉,不让上一次按下的位置误伤没有 mousedown 的点击
  const onClickEnd = () => { down = null }
  document.addEventListener('mousedown', onDown, true)
  document.addEventListener('click', onClickEnd)
  return () => {
    document.removeEventListener('mousedown', onDown, true)
    document.removeEventListener('click', onClickEnd)
    down = null
  }
}
