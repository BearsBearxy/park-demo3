// 表格展开 / 收起行的位移动画(rowMotion.ts)。2026-10-03 用户:「全部表格的这个下拉打开的，增加动画平滑移开，现在是硬切」。
// jsdom 不排版、没有 Element.animate:每行的位置按 data-y 假造,animate 换成记录器。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { installRowMotion } from './rowMotion'

type Call = { el: HTMLElement; frames: Keyframe[] }
let calls: Call[] = []
let uninstall: () => void

function rect(y: number, h = 40): DOMRect {
  return { top: y, bottom: y + h, left: 0, right: 800, width: 800, height: h, x: 0, y, toJSON: () => ({}) } as DOMRect
}
/** 表格自己在 y=100;每行的视口位置 = 100 + data-y */
function table(ids: string[]): HTMLTableElement {
  const t = document.createElement('table')
  t.getBoundingClientRect = () => rect(100, 1000)
  const tb = document.createElement('tbody')
  t.appendChild(tb)
  ids.forEach((id, i) => tb.appendChild(row(id, i * 40)))
  document.body.appendChild(t)
  return t
}
function row(id: string, y: number): HTMLTableRowElement {
  const tr = document.createElement('tr')
  tr.dataset.id = id
  tr.dataset.y = String(y)
  tr.innerHTML = `<td><button>${id}</button></td>`
  tr.getBoundingClientRect = () => rect(100 + Number(tr.dataset.y) + Number(tr.dataset.anim ?? 0))
  return tr
}
const tick = () => new Promise((r) => setTimeout(r, 0))
const byId = (id: string) => calls.find((c) => c.el.dataset.id === id)

beforeEach(() => {
  calls = []
  Object.defineProperty(window, 'innerHeight', { value: 900, configurable: true })
  ;(HTMLElement.prototype as unknown as { animate: unknown }).animate = function (this: HTMLElement, frames: Keyframe[]) {
    calls.push({ el: this, frames })
    // 动画刚开始:视觉位置 = 布局位置 + 首帧位移(浏览器里 getBoundingClientRect 也把在跑的 transform 算进去)
    const m = /translateY\((-?\d+)px\)/.exec(String(frames[0].transform ?? ''))
    const el = this
    el.dataset.anim = m ? m[1] : '0'
    return { cancel() { delete el.dataset.anim } } as unknown as Animation
  }
  uninstall = installRowMotion()
})
afterEach(() => {
  uninstall()
  document.body.innerHTML = ''
  delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate
  vi.restoreAllMocks()
})

describe('rowMotion · 表格展开 / 收起', () => {
  // 破坏验证:FLIP 的位移写成 new - old(方向反了)→ 本条红
  it('❗点组头展开:下面的行从旧位置滑到新位置,新插进来的行淡入', async () => {
    const t = table(['g', 'a', 'b'])
    t.querySelector<HTMLButtonElement>('[data-id="g"] button')!.click()
    // 宿主在点击里插进两行子项,原来的 a、b 往下挪 80
    const tb = t.tBodies[0]
    const c1 = row('c1', 40), c2 = row('c2', 80)
    tb.insertBefore(c2, tb.rows[1]); tb.insertBefore(c1, c2)
    ;(tb.querySelector('[data-id="a"]') as HTMLElement).dataset.y = '120'
    ;(tb.querySelector('[data-id="b"]') as HTMLElement).dataset.y = '160'
    await tick()
    expect(byId('a')?.frames[0]).toMatchObject({ transform: 'translateY(-80px)' })
    expect(byId('b')?.frames[0]).toMatchObject({ transform: 'translateY(-80px)' })
    expect(byId('a')?.frames.at(-1)).toMatchObject({ transform: 'none' })
    expect(byId('c1')?.frames[0]).toMatchObject({ opacity: 0 })
    expect(byId('c2')?.frames.at(-1)).toMatchObject({ opacity: 1 })
    expect(byId('g'), '没挪的行不动').toBeUndefined()
  })

  // 2026-10-03 实测:连点时下面那行一帧跳 80px —— 量新位置时把上一段还在跑的位移算进去了,起点差了一整段。
  // 破坏验证:settle 里不先 cancel 在跑的动画 → 本条红(第二段动画首帧成了 translateY(80px))
  it('❗连点打断:新一段从此刻屏上的位置起跳,不跳回去', async () => {
    const t = table(['g', 'a'])
    const g = () => t.querySelector<HTMLButtonElement>('[data-id="g"] button')!
    const tb = t.tBodies[0]
    // 展开:a 从 40 挪到 120,动画首帧在 40(translateY(-80px))
    g().click()
    const c = row('c', 40); c.dataset.y = '40'
    const c2 = row('c2', 80)
    tb.insertBefore(c2, tb.rows[1]); tb.insertBefore(c, c2)
    ;(t.querySelector('[data-id="a"]') as HTMLElement).dataset.y = '120'
    await tick()
    expect(byId('a')?.frames[0]).toMatchObject({ transform: 'translateY(-80px)' })
    // 动画还在开头(屏上 a 仍在 40)就再点一下收起:a 布局回到 40 —— 屏上本来就在 40,不该再动
    calls = []
    g().click()
    c.remove(); c2.remove()
    ;(t.querySelector('[data-id="a"]') as HTMLElement).dataset.y = '40'
    await tick()
    const a2 = byId('a')
    expect(a2 === undefined || a2.frames[0].transform === 'translateY(0px)', `不该跳:${JSON.stringify(a2?.frames[0])}`).toBe(true)
  })

  it('收起:被收掉的行直接没了,下面的行从原位置往上滑回去', async () => {
    const t = table(['g', 'c1', 'c2', 'a'])
    t.querySelector<HTMLButtonElement>('[data-id="g"] button')!.click()
    t.querySelector('[data-id="c1"]')!.remove(); t.querySelector('[data-id="c2"]')!.remove()
    ;(t.querySelector('[data-id="a"]') as HTMLElement).dataset.y = '40'
    await tick()
    expect(byId('a')?.frames[0]).toMatchObject({ transform: 'translateY(80px)' })
  })

  // 破坏验证:去掉「行集合没变就不动」的判断 → 本条红(排序也会被当成展开去动)
  it('行没增减(排序、进编辑、改字)不动', async () => {
    const t = table(['a', 'b'])
    t.querySelector<HTMLButtonElement>('[data-id="a"] button')!.click()
    const tb = t.tBodies[0]
    tb.appendChild(tb.rows[0])   // 换个顺序
    tb.rows[0].dataset.y = '0'; tb.rows[1].dataset.y = '40'
    tb.rows[0].querySelector('button')!.textContent = '改了字'
    await tick()
    expect(calls).toHaveLength(0)
  })

  it('整片换了(一行都没留下):当成换数据,不动', async () => {
    const t = table(['a', 'b'])
    t.querySelector<HTMLButtonElement>('[data-id="a"] button')!.click()
    const tb = t.tBodies[0]
    tb.innerHTML = ''
    tb.appendChild(row('x', 0)); tb.appendChild(row('y', 40))
    await tick()
    expect(calls).toHaveLength(0)
  })

  it('没点击(数据自己变了):不动', async () => {
    const t = table(['a', 'b'])
    t.tBodies[0].insertBefore(row('n', 0), t.tBodies[0].rows[0])
    ;(t.querySelector('[data-id="a"]') as HTMLElement).dataset.y = '40'
    await tick()
    expect(calls).toHaveLength(0)
  })

  // 破坏验证:删掉 reduced-motion 判断 → 本条红
  it('系统开了「减少动态效果」:不动', async () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia
    const t = table(['g', 'a'])
    t.querySelector<HTMLButtonElement>('[data-id="g"] button')!.click()
    t.tBodies[0].insertBefore(row('c', 40), t.tBodies[0].rows[1])
    ;(t.querySelector('[data-id="a"]') as HTMLElement).dataset.y = '80'
    await tick()
    expect(calls).toHaveLength(0)
    delete (window as unknown as { matchMedia?: unknown }).matchMedia
  })

  it('离视口很远的行不动(只动看得见的)', async () => {
    const t = table(['g', 'a'])
    ;(t.querySelector('[data-id="a"]') as HTMLElement).dataset.y = '5000'
    t.querySelector<HTMLButtonElement>('[data-id="g"] button')!.click()
    t.tBodies[0].insertBefore(row('c', 40), t.tBodies[0].rows[1])
    ;(t.querySelector('[data-id="a"]') as HTMLElement).dataset.y = '5040'
    await tick()
    expect(byId('a')).toBeUndefined()
    expect(byId('c')).toBeDefined()
  })
})
