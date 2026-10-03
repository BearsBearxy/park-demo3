// 展开 / 收起点击范围放宽的共用判断(rowToggle.ts)
import { describe, it, expect, vi, afterEach } from 'vitest'
import { rowToggle } from './rowToggle'

function rowWith(html: string) {
  const tr = document.createElement('tr')
  tr.innerHTML = `<td class="nm">${html}</td>`
  document.body.appendChild(tr)
  const fn = vi.fn()
  tr.addEventListener('click', (e) => rowToggle(e, fn))
  return { tr, fn }
}
afterEach(() => { document.body.innerHTML = ''; window.getSelection()?.removeAllRanges() })

describe('rowToggle', () => {
  it('点在名称文字、格子空白上:展开', () => {
    const { tr, fn } = rowWith('<span class="t">仁恒</span>')
    tr.querySelector<HTMLElement>('.t')!.click()
    tr.querySelector<HTMLElement>('td')!.click()
    expect(fn).toHaveBeenCalledTimes(2)
  })

  // 破坏验证:去掉 closest(CONTROLS) 判断 → 本条红(箭头一点切两次 = 没反应)
  it('点在箭头按钮、输入框、链接、勾选框上:不算(按钮自己处理)', () => {
    const { tr, fn } = rowWith('<button class="xp"><svg></svg></button><input /><a href="#">x</a><input type="checkbox" />')
    tr.querySelector<HTMLElement>('button svg')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    tr.querySelector<HTMLElement>('input')!.click()
    tr.querySelector<HTMLElement>('a')!.click()
    tr.querySelector<HTMLElement>('input[type="checkbox"]')!.click()
    expect(fn).not.toHaveBeenCalled()
  })

  // 破坏验证:去掉选区判断 → 本条红
  it('拖选了文字(选区非空):不算', () => {
    const { tr, fn } = rowWith('<span class="t">永龙</span>')
    const r = document.createRange()
    r.selectNodeContents(tr.querySelector('.t')!)
    window.getSelection()!.addRange(r)
    tr.querySelector<HTMLElement>('.t')!.click()
    expect(fn).not.toHaveBeenCalled()
  })
})
