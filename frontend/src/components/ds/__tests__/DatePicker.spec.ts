import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { h, nextTick, type Component } from 'vue'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import DatePickerSfc from '../DatePicker.vue'
import { _resetViewportForTest } from '@/composables/useViewport'

// 泛型组件的 props 类型测试里用不上,按普通组件挂
const DatePicker = DatePickerSfc as unknown as Component

// DATE-PICKER-SPEC §3:回写格式与原生框一致、min/max 不可点、打错不改值、Esc 只关自己、点外面关、
// 上次选的读写与越界隐藏、固定 6 行。「今天」钉在 2026-09-19(稿上的今天)。
let w: VueWrapper | null = null
function mk(props: Record<string, unknown>) {
  w = mount(DatePicker, { props, attachTo: document.body })
  return w
}
const emitted = (x: VueWrapper) => (x.emitted('update:modelValue') ?? []).map((e) => e[0])
const cell = (x: VueWrapper, k: string) => x.find(`[data-k="${k}"]`)
async function openIt(x: VueWrapper) { await x.find('.dp-box').trigger('click'); await nextTick() }
async function type(x: VueWrapper, s: string) {
  const el = x.find('.dp-in-el')
  ;(el.element as HTMLInputElement).value = s
  await el.trigger('input')
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 8, 19, 10))
  localStorage.clear()
})
afterEach(() => {
  w?.unmount(); w = null
  vi.useRealTimers()
})

describe('DatePicker —— 回写格式', () => {
  it('单日:点格回写 YYYY-MM-DD 并关上', async () => {
    const x = mk({ modelValue: '' })
    await openIt(x)
    await cell(x, '2026-09-10').trigger('click')
    expect(emitted(x)).toEqual(['2026-09-10'])
    expect(x.find('.dp-pop').exists()).toBe(false)
  })

  it('区间:点起点不关、点止才回写 [from, to];倒着点也按先后排', async () => {
    const x = mk({ modelValue: ['', ''], mode: 'range' })
    await openIt(x)
    await cell(x, '2026-09-24').trigger('click')
    expect(emitted(x)).toEqual([])
    expect(x.find('.dp-pop').exists(), '只点了起点就关了').toBe(true)
    await cell(x, '2026-09-08').trigger('click')
    expect(emitted(x)).toEqual([['2026-09-08', '2026-09-24']])
    expect(x.find('.dp-pop').exists()).toBe(false)
  })

  it('区间:首尾实底、中段连条,行首行尾收圆角', async () => {
    const x = mk({ modelValue: ['2026-09-08', '2026-09-24'], mode: 'range' })
    await openIt(x)
    expect(cell(x, '2026-09-08').classes()).toContain('s')
    expect(cell(x, '2026-09-24').classes()).toContain('s')
    expect(cell(x, '2026-09-16').classes()).not.toContain('s')
    expect(cell(x, '2026-09-16').element.parentElement!.className).toContain('bf')
    // 09-14 是周一(行首)、09-20 是周日(行尾)
    expect(cell(x, '2026-09-14').element.parentElement!.className).toContain('cl')
    expect(cell(x, '2026-09-20').element.parentElement!.className).toContain('cr')
    expect(cell(x, '2026-09-25').element.parentElement!.className).not.toContain('bf')
  })

  it('月份:回写 YYYY-MM;年份:回写 YYYY', async () => {
    const m = mk({ modelValue: '2026-08', mode: 'month' })
    await openIt(m)
    expect(m.findAll('.mc')).toHaveLength(12)
    await cell(m, '2026-03').trigger('click')
    expect(emitted(m)).toEqual(['2026-03'])
    m.unmount(); w = null

    const y = mk({ modelValue: '2025', mode: 'year' })
    await openIt(y)
    expect(y.findAll('.mc').map((c) => c.text())[0], '12 年一页,2020 开头').toBe('2020')
    await cell(y, '2023').trigger('click')
    expect(emitted(y)).toEqual(['2023'])
  })

  it('固定 6 行:整月 4 行就能放下的 2026-02 也画 42 格,周一开头', async () => {
    const x = mk({ modelValue: '2026-02-10' })
    await openIt(x)
    const ks = x.findAll('.dcb').map((c) => c.attributes('data-k'))
    expect(ks).toHaveLength(42)
    expect(ks[0], '2026-02-01 是周日,第一格是它前面那个周一').toBe('2026-01-26')
    expect(x.findAll('.dp-wk span').map((s) => s.text()).join('')).toBe('一二三四五六日')
  })

  it('选中字用 --control-solid-text(暗色下是深字),今天有点', async () => {
    const x = mk({ modelValue: '2026-09-10' })
    await openIt(x)
    expect(cell(x, '2026-09-10').classes()).toContain('s')
    expect(cell(x, '2026-09-19').classes()).toContain('t')
  })
})

describe('DatePicker —— min / max', () => {
  it('超出的格不可点、不回写;快捷「今天」超出就灰', async () => {
    const x = mk({ modelValue: '', min: '2026-09-01', max: '2026-09-15' })
    await openIt(x)
    expect(cell(x, '2026-08-31').attributes('disabled')).toBeDefined()
    expect(cell(x, '2026-09-16').attributes('disabled')).toBeDefined()
    expect(cell(x, '2026-09-15').attributes('disabled')).toBeUndefined()
    await cell(x, '2026-09-16').trigger('click')
    expect(emitted(x)).toEqual([])
    const today = x.findAll('.dp-q').find((q) => q.text() === '今天')!
    expect(today.attributes('disabled'), '今天 09-19 超过 max').toBeDefined()
    expect(x.findAll('.dp-nb').every((b) => b.attributes('disabled') !== undefined), '只开当月:两个翻页钮都灰').toBe(true)
  })

  it('月份面板 hasData=false 的格灰且不可点,「本月」跟着灰', async () => {
    const has = (v: string) => v <= '2026-08'
    const x = mk({ modelValue: '2026-08', mode: 'month', hasData: has })
    await openIt(x)
    expect(cell(x, '2026-10').attributes('disabled')).toBeDefined()
    await cell(x, '2026-10').trigger('click')
    expect(emitted(x)).toEqual([])
    expect(x.findAll('.dp-q').find((q) => q.text() === '本月')!.attributes('disabled')).toBeDefined()
    expect(x.findAll('.dp-q').find((q) => q.text() === '上个月')!.attributes('disabled')).toBeUndefined()
  })
})

describe('DatePicker —— 打字', () => {
  it('打错整行变红,回车不改值;打对回车 = 选中并关', async () => {
    const x = mk({ modelValue: '2026-09-10' })
    await openIt(x)
    await type(x, '20261340')
    await x.find('.dp-in-el').trigger('keydown', { key: 'Enter' })
    expect(x.find('.dp-in').classes()).toContain('err')
    expect(emitted(x)).toEqual([])
    expect(x.find('.dp-pop').exists(), '打错不关').toBe(true)
    await type(x, '20261301')             // 13 月:日子本身合法,也要红
    await x.find('.dp-in-el').trigger('keydown', { key: 'Enter' })
    expect(x.find('.dp-in').classes()).toContain('err')
    expect(emitted(x)).toEqual([])

    await type(x, '2026/09/12')           // 粘贴带斜杠的也认,只留数字
    expect(x.find('.dp-in').classes()).not.toContain('err')
    await x.find('.dp-in-el').trigger('keydown', { key: 'Enter' })
    expect(emitted(x)).toEqual(['2026-09-12'])
    expect(x.find('.dp-pop').exists()).toBe(false)
  })

  it('超出 min/max 的日期打进去同样变红', async () => {
    const x = mk({ modelValue: '', max: '2026-09-15' })
    await openIt(x)
    await type(x, '20260920')
    await x.find('.dp-in-el').trigger('keydown', { key: 'Enter' })
    expect(x.find('.dp-in').classes()).toContain('err')
    expect(emitted(x)).toEqual([])
  })

  it('打出年月,日历就翻到那个月', async () => {
    const x = mk({ modelValue: '' })
    await openIt(x)
    await type(x, '202603')
    expect(x.find('.dp-nt').text()).toBe('2026年3月')
  })
})

describe('DatePicker —— 开关', () => {
  it('Esc 只关自己,宿主(window keydown)收不到', async () => {
    const host = vi.fn()
    window.addEventListener('keydown', host)
    const x = mk({ modelValue: '' })
    await openIt(x)
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await nextTick()
    expect(x.find('.dp-pop').exists()).toBe(false)
    expect(host).not.toHaveBeenCalled()
    window.removeEventListener('keydown', host)
  })

  it('点外面关(capture 阶段,宿主 mousedown.stop 挡不住)', async () => {
    const outer = document.createElement('div')
    outer.addEventListener('mousedown', (e) => e.stopPropagation())
    document.body.appendChild(outer)
    const x = mk({ modelValue: '' })
    await openIt(x)
    outer.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await nextTick()
    expect(x.find('.dp-pop').exists()).toBe(false)
    outer.remove()
  })

  it('触发器上回车不开面板、冒给宿主(合同弹窗回车提交)', async () => {
    const submit = vi.fn()
    w = mount({ render: () => h(DatePicker, { modelValue: '', onKeydown: (e: KeyboardEvent) => e.key === 'Enter' && submit() }) }, { attachTo: document.body })
    await w.find('.dp-trg').trigger('keydown', { key: 'Enter' })
    expect(submit).toHaveBeenCalledTimes(1)
    expect(w.find('.dp-pop').exists()).toBe(false)
    // 面板里的回车不冒出去
    await w.find('.dp-box').trigger('click')
    await nextTick()
    await w.find('.dp-in-el').trigger('keydown', { key: 'Enter' })
    expect(submit).toHaveBeenCalledTimes(1)
  })
})

describe('DatePicker —— 对抗复查补的几条(2026-09-20)', () => {
  it('区间只点了起点就点外面:不回写半截区间,原来那对值不动', async () => {
    const x = mk({ modelValue: ['2026-09-01', '2026-09-10'], mode: 'range' })
    await openIt(x)
    await cell(x, '2026-09-15').trigger('click')
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await nextTick()
    expect(x.find('.dp-pop').exists()).toBe(false)
    expect(emitted(x), '把 [起点, 空] 存回去了,原来的止日丢了').toEqual([])
  })

  it('选了和现在一样的值不发事件(同原生框;合同弹窗靠它置 dirty)', async () => {
    const x = mk({ modelValue: '2026-09-10' })
    await openIt(x)
    await cell(x, '2026-09-10').trigger('click')
    expect(emitted(x)).toEqual([])
    expect(x.emitted('change')).toBeUndefined()
    expect(x.find('.dp-pop').exists(), '照样选中即关').toBe(false)
    x.unmount(); w = null
    const r = mk({ modelValue: ['2026-09-01', '2026-09-10'], mode: 'range' })
    await openIt(r)
    await cell(r, '2026-09-01').trigger('click')
    await cell(r, '2026-09-10').trigger('click')
    expect(emitted(r)).toEqual([])
  })

  it('Tab 到「今天」/ 翻页钮上按回车:交给按钮自己,不拿键盘所在的格顶替,也不冒给宿主', async () => {
    const submit = vi.fn()
    w = mount({ render: () => h(DatePicker, { modelValue: '2026-09-10', onKeydown: (e: KeyboardEvent) => e.key === 'Enter' && submit() }) }, { attachTo: document.body })
    await w.find('.dp-box').trigger('click')
    await nextTick()
    for (const b of [w.findAll('.dp-q').find((q) => q.text() === '今天')!, w.find('[aria-label="下一页"]')]) {
      const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
      b.element.dispatchEvent(ev)
      await nextTick()
      expect(ev.defaultPrevented, '回车的默认动作(点按钮)被挡了').toBe(false)
      expect(w.find('.dp-pop').exists(), '面板被当成「选中键盘格」关掉了').toBe(true)
    }
    expect(w.findComponent(DatePicker).emitted('update:modelValue')).toBeUndefined()
    expect(submit).not.toHaveBeenCalled()
  })

  it('宿主的 title 只落在触发器上:面板里的格子不在它下面(悬停不冒那条长提示)', async () => {
    w = mount(DatePicker, { props: { modelValue: '2026-03', mode: 'month' }, attrs: { title: '自该账期起停用', class: 'host-cls' }, attachTo: document.body })
    expect(w.classes(), '宿主的 class 还要落在根上').toContain('host-cls')
    expect(w.attributes('title')).toBeUndefined()
    expect(w.find('.dp-box').attributes('title')).toBe('自该账期起停用')
    await openIt(w)
    expect(cell(w, '2026-03').element.closest('[title]')).toBeNull()
  })
})

describe('DatePicker —— 键盘', () => {
  const key = (x: VueWrapper, k: string) => x.find('.dp-in-el').trigger('keydown', { key: k })
  it('方向键移一格(↓ 一周),回车选中', async () => {
    const x = mk({ modelValue: '2026-09-10' })
    await openIt(x)
    await key(x, 'ArrowRight')
    await key(x, 'ArrowDown')
    expect(cell(x, '2026-09-18').classes(), '键盘所在的格没画出来').toContain('ac')
    await key(x, 'Enter')
    expect(emitted(x)).toEqual(['2026-09-18'])
  })
  it('PageDown 翻月;月份面板 PageUp 翻年', async () => {
    const x = mk({ modelValue: '2026-09-10' })
    await openIt(x)
    await key(x, 'PageDown')
    expect(x.find('.dp-nt').text()).toBe('2026年10月')
    x.unmount(); w = null
    const m = mk({ modelValue: '2026-08', mode: 'month' })
    await openIt(m)
    await key(m, 'PageUp')
    expect(m.find('.dp-nt').text()).toBe('2025年')
  })
})

describe('DatePicker —— 手机(≤600)', () => {
  afterEach(() => { _resetViewportForTest(); vi.unstubAllGlobals() })
  it('底部面板里点到格子外圈(一行 44、按钮 46×40 之外那一圈)也算点了这一格', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('max-width'), addEventListener() {}, removeEventListener() {} }))
    _resetViewportForTest()
    const x = mk({ modelValue: '' })
    await openIt(x)
    const span = document.body.querySelector('.dp-sheet [data-k="2026-09-03"]')!.parentElement!
    span.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextTick()
    expect(emitted(x)).toEqual(['2026-09-03'])
  })

  it('触屏(hover:none):表单字段的清除 × 常驻;有鼠标时照旧悬停才出', async () => {
    const src = readFileSync(join(__dirname, '..', 'DatePicker.vue'), 'utf8')
    const st = document.createElement('style')
    st.textContent = /<style[^>]*>([\s\S]*?)<\/style>/.exec(src)![1]
    document.head.appendChild(st)
    const vis = () => getComputedStyle(w!.find('.dp-clr').element).visibility
    mk({ modelValue: '2026-09-10', clearable: true })
    expect(vis(), '有鼠标时不悬停就出了').toBe('hidden')
    w!.unmount(); w = null
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(hover: none)', addEventListener() {}, removeEventListener() {} }))
    _resetViewportForTest()
    mk({ modelValue: '2026-09-10', clearable: true })
    expect(vis(), '触屏上看不见 ×,清不掉').toBe('visible')
    st.remove()
  })

  it('从底部升起的面板挂到 body、顶上写字段名,点一下就选中关上', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('max-width'), addEventListener() {}, removeEventListener() {} }))
    _resetViewportForTest()
    const x = mk({ modelValue: '', 'aria-label': '开始日期' })
    await openIt(x)
    const sheet = document.body.querySelector('.dp-pop.dp-sheet')
    expect(sheet, '手机上还是贴在触发器下的小面板').not.toBeNull()
    expect(x.element.contains(sheet), '底部面板没挂到 body').toBe(false)
    expect(sheet!.querySelector('.dp-sh')!.textContent).toContain('开始日期')
    ;(sheet!.querySelector('[data-k="2026-09-03"]') as HTMLElement).click()
    await nextTick()
    expect(emitted(x)).toEqual(['2026-09-03'])
    expect(document.body.querySelector('.dp-sheet')).toBeNull()
  })
})

describe('DatePicker —— 嵌在 <label> 里(导入弹窗「账期」)', () => {
  it('点图标只开一次(label 不再把点击转给触发器关掉它),点面板空白处不关', async () => {
    w = mount({ render: () => h('label', null, ['账期', h(DatePicker, { modelValue: '2026-08', mode: 'month' })]) }, { attachTo: document.body })
    await w.find('.dp-ico').trigger('click')
    expect(w.find('.dp-pop').exists(), '一次点击开了又关').toBe(true)
    await w.find('.dp-bar').trigger('click')
    expect(w.find('.dp-pop').exists(), '点面板空白处被 label 转成了点触发器').toBe(true)
  })
})

describe('DatePicker —— 上次选的', () => {
  it('选定时按账号 + fieldId 记下,再开出现「上次选的」,点它回写', async () => {
    localStorage.setItem('username', 'zhang')
    const x = mk({ modelValue: '', fieldId: 'sign' })
    await openIt(x)
    expect(x.findAll('.dp-q').map((q) => q.text()), '没记过就不出').toEqual(['今天'])
    await cell(x, '2026-09-03').trigger('click')
    expect(JSON.parse(localStorage.getItem('fp-dp-last:zhang:sign')!)).toBe('2026-09-03')

    await openIt(x)
    const lastQ = x.findAll('.dp-q').find((q) => q.text() === '上次选的')
    expect(lastQ, '记过了却没出').toBeTruthy()
    await lastQ!.trigger('click')
    expect(emitted(x)).toEqual(['2026-09-03', '2026-09-03'])
  })

  it('上次选的超出 min/max 就不出这颗', async () => {
    localStorage.setItem('fp-dp-last::cp', JSON.stringify('2026-08-20'))
    const x = mk({ modelValue: '', fieldId: 'cp', min: '2026-09-01', max: '2026-09-30' })
    await openIt(x)
    expect(x.findAll('.dp-q').map((q) => q.text())).toEqual(['今天'])
  })

  it('区间记整对,只有两头都在范围里才出', async () => {
    localStorage.setItem('fp-dp-last::logs', JSON.stringify(['2026-09-01', '2026-09-05']))
    const x = mk({ modelValue: ['', ''], mode: 'range', fieldId: 'logs' })
    await openIt(x)
    await x.findAll('.dp-q').find((q) => q.text() === '上次选的')!.trigger('click')
    expect(emitted(x)).toEqual([['2026-09-01', '2026-09-05']])
  })
})
