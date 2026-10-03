// 表格展开 / 收起的点击范围放宽(2026-10-03 用户:「不是非要点击箭头才打开，放宽交互范围」)。
// 纯分组行整行可点;带数据的父行点名称那一格。箭头按钮仍是键盘入口,这里只放宽鼠标。
// 点在行里别的控件上(按钮、链接、输入框、勾选框…)不算 —— 箭头按钮自己的 @click 也走这条,不会一次点两下;
// 拖选文字(选区非空)也不算,不然复制个名字就把组收起来了。

const CONTROLS = 'button, a, input, select, textarea, label, [role="button"], [contenteditable="true"]'

export function rowToggle(e: MouseEvent, toggle: () => void): void {
  const t = e.target as Element | null
  if (t?.closest?.(CONTROLS)) return
  if (window.getSelection?.()?.toString()) return
  toggle()
}
