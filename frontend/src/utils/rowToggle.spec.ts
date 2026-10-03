// 展开 / 收起点击范围放宽的共用判断(rowToggle.ts)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { rowToggle, installRowToggle } from './rowToggle'

let uninstall: () => void
function rowWith(html: string) {
  const tr = document.createElement('tr')
  tr.innerHTML = `<td class="nm fp-rowtg">${html}</td>`
  document.body.appendChild(tr)
  const fn = vi.fn()
  tr.addEventListener('click', (e) => rowToggle(e, fn))
  return { tr, fn }
}
/** 真鼠标的一下:按下(detail = 第几击)→ 抬起 → click,按下和 click 可以在不同位置(拖动) */
function press(el: Element, n = 1, from = { x: 10, y: 10 }, to = from) {
  const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true, detail: n, clientX: from.x, clientY: from.y })
  el.dispatchEvent(down)
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: n, clientX: to.x, clientY: to.y }))
  return down
}
beforeEach(() => { uninstall = installRowToggle() })
afterEach(() => { uninstall(); document.body.innerHTML = ''; window.getSelection()?.removeAllRanges() })

describe('rowToggle', () => {
  it('点在名称文字、格子空白上:展开', () => {
    const { tr, fn } = rowWith('<span class="t">仁恒</span>')
    press(tr.querySelector('.t')!)
    press(tr.querySelector('td')!)
    expect(fn).toHaveBeenCalledTimes(2)
  })

  // 破坏验证:去掉 closest(CONTROLS) 判断 → 本条红(箭头一点切两次 = 没反应)
  it('点在箭头按钮、输入框、链接、勾选框上:不算(按钮自己处理)', () => {
    const { tr, fn } = rowWith('<button class="xp"><svg></svg></button><input /><a href="#">x</a><input type="checkbox" />')
    press(tr.querySelector('button svg')!)
    press(tr.querySelector('input')!)
    press(tr.querySelector('a')!)
    press(tr.querySelector('input[type="checkbox"]')!)
    expect(fn).not.toHaveBeenCalled()
  })

  // 2026-10-03 实测:90ms 间隔真鼠标连点 10 下只切了 1 下 —— 第二击起浏览器按双击选中文字,原来「有选区就不算」把它们全吞了。
  // 破坏验证:恢复「选区非空就不算」→ 本条红;去掉多击 mousedown 的 preventDefault → 本条第二段红
  it('❗连点(第 2、3…击):每一下都切换,且不让浏览器选中名称文字', () => {
    const { tr, fn } = rowWith('<span class="t">永龙</span>')
    const t = tr.querySelector('.t')!
    const downs = [1, 2, 3, 4, 5, 6].map((n) => {
      if (n > 1) { const r = document.createRange(); r.selectNodeContents(t); window.getSelection()!.addRange(r) }  // 浏览器双击选词
      return press(t, n)
    })
    expect(fn).toHaveBeenCalledTimes(6)
    expect(downs.slice(1).every((d) => d.defaultPrevented), '第二击起拦住选词').toBe(true)
    expect(downs[0].defaultPrevented, '第一击不拦:还能从这里开始拖选').toBe(false)
  })

  // 破坏验证:去掉拖动距离判断 → 本条红
  it('按下后拖动超过 5px 再松开(拖选文字):不算', () => {
    const { tr, fn } = rowWith('<span class="t">永龙</span>')
    press(tr.querySelector('.t')!, 1, { x: 10, y: 10 }, { x: 40, y: 12 })
    expect(fn).not.toHaveBeenCalled()
    press(tr.querySelector('.t')!, 1, { x: 10, y: 10 }, { x: 13, y: 11 })   // 手抖 3px 照样算点
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('页面别处选着文字,不影响点这里开合', () => {
    const { tr, fn } = rowWith('<span class="t">永龙</span>')
    const p = document.createElement('p'); p.textContent = '别处的字'; document.body.appendChild(p)
    const r = document.createRange(); r.selectNodeContents(p); window.getSelection()!.addRange(r)
    press(tr.querySelector('.t')!)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('不在可开合区域里的多击不拦(别处照常双击选词)', () => {
    const p = document.createElement('p'); p.textContent = '别处的字'; document.body.appendChild(p)
    const d = new MouseEvent('mousedown', { bubbles: true, cancelable: true, detail: 2 })
    p.dispatchEvent(d)
    expect(d.defaultPrevented).toBe(false)
  })
})
