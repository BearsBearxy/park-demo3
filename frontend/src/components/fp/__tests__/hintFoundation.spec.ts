// 提示件地基(十件 ⑧⑨⑩):结果回执、确认弹窗 / 离开确认、悬停说明 v-tip。画布 02-A / 02-B / 02-C / 06-B。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import FPReceiptHost from '../FPReceiptHost.vue'
import FPConfirmHost from '../FPConfirmHost.vue'
import FPToast from '../FPToast.vue'
import Popover from '@/components/ds/Popover.vue'
import { receipt, receipts } from '@/utils/receipt'
import { ask, askLeave, askQueue } from '@/utils/ask'
import { tipState } from '@/components/shell/ShellTip.vue'

const texts = () => [...document.querySelectorAll('.frh .fpt-m')].map((e) => e.textContent)
const btn = (label: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === label) as HTMLButtonElement | undefined

beforeEach(() => {
  receipts.splice(0)
  askQueue.splice(0)
  tipState.lastHide = 0
})
afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
})

describe('结果回执(⑧)', () => {
  it('❗连推 4 条只剩后 3 条,旧的在上', async () => {
    const w = mount(FPReceiptHost, { attachTo: document.body })
    for (const t of ['已保存「A座」', '已保存「B座」', '已导出 公共电核算-2023-08.xlsx', '已保存「C座」']) receipt.ok(t)
    await nextTick()
    expect(texts()).toEqual(['已保存「B座」', '已导出 公共电核算-2023-08.xlsx', '已保存「C座」'])
    w.unmount()
  })

  it('❗成功:3999ms 还在,4000ms 自己收', async () => {
    vi.useFakeTimers()
    const w = mount(FPReceiptHost, { attachTo: document.body })
    receipt.ok('已保存「A座」')
    await nextTick()
    vi.advanceTimersByTime(3999)
    await nextTick()
    expect(texts()).toEqual(['已保存「A座」'])
    vi.advanceTimersByTime(1)
    await nextTick()
    expect(texts()).toEqual([])
    w.unmount()
  })

  it('❗失败:过 60 秒仍在;点「重试」调一次 run 并收起', async () => {
    vi.useFakeTimers()
    const run = vi.fn()
    const w = mount(FPReceiptHost, { attachTo: document.body })
    receipt.fail('保存失败：服务器没有响应', { label: '重试', run })
    await nextTick()
    vi.advanceTimersByTime(60_000)
    await nextTick()
    expect(texts()).toEqual(['保存失败：服务器没有响应'])
    btn('重试')!.click()
    await nextTick()
    expect(run).toHaveBeenCalledTimes(1)
    expect(texts()).toEqual([])
    w.unmount()
  })

  it('❗同一句再来不叠第二条,动作换成最新的', async () => {
    const a = vi.fn()
    const b = vi.fn()
    const w = mount(FPReceiptHost, { attachTo: document.body })
    receipt.fail('网络异常或服务不可用，请稍后重试', { label: '刷新', run: a })
    const id = receipts[0].id
    receipt.ok('已保存「A座」')
    receipt.fail('网络异常或服务不可用，请稍后重试', { label: '刷新', run: b })
    await nextTick()
    expect(texts()).toEqual(['已保存「A座」', '网络异常或服务不可用，请稍后重试'])
    // 复用同一条(id 不变):TransitionGroup 按 id 认,换了 id 就会重播进场
    expect(receipts[1].id).toBe(id)
    btn('刷新')!.click()
    expect([a.mock.calls.length, b.mock.calls.length]).toEqual([0, 1])
    w.unmount()
  })

  it('❗只按「同一语气同一句」去重:成功和失败同一句是两条', async () => {
    const w = mount(FPReceiptHost, { attachTo: document.body })
    receipt.ok('已保存「A座」')
    receipt.fail('已保存「A座」')
    await nextTick()
    expect(receipts.map((r) => r.tone)).toEqual(['ok', 'fail'])
    w.unmount()
  })

  it('❗同一句成功再推一次:4 秒从第二次算起(3.5 秒内再收藏一次,不能只亮半秒)', async () => {
    vi.useFakeTimers()
    const w = mount(FPReceiptHost, { attachTo: document.body })
    receipt.ok('已收藏，在「首页」上能找到')
    await nextTick()
    vi.advanceTimersByTime(3500)
    receipt.ok('已收藏，在「首页」上能找到')
    await nextTick()
    vi.advanceTimersByTime(3999)
    await nextTick()
    expect(texts()).toEqual(['已收藏，在「首页」上能找到'])
    vi.advanceTimersByTime(1)
    await nextTick()
    expect(texts()).toEqual([])
    w.unmount()
  })

  it('❗警告:过 60 秒仍在、带 ×;点 × 收起(收藏满 12 个走这一档)', async () => {
    vi.useFakeTimers()
    const w = mount(FPReceiptHost, { attachTo: document.body })
    receipt.warn('最多收藏 12 个，先在首页去掉几个')
    await nextTick()
    vi.advanceTimersByTime(60_000)
    await nextTick()
    expect(texts()).toEqual(['最多收藏 12 个，先在首页去掉几个'])
    document.querySelector<HTMLButtonElement>('.frh .fpt-x')!.click()
    await nextTick()
    expect(texts()).toEqual([])
    w.unmount()
  })

  it('❗宿主卸载(退出登录)清空队列:没收掉的失败 / 警告不留到下一次登录', async () => {
    const w = mount(FPReceiptHost, { attachTo: document.body })
    receipt.fail('网络异常或服务不可用，请稍后重试', { label: '刷新', run: () => {} })
    receipt.warn('最多收藏 12 个，先在首页去掉几个')
    await nextTick()
    expect(receipts, '前置:两条在队里').toHaveLength(2)
    w.unmount()
    expect(receipts).toHaveLength(0)
  })

  it('❗读屏:回执列是常驻 polite 区域;失败 / 警告 role=alert,成功 role=status', async () => {
    const w = mount(FPReceiptHost, { attachTo: document.body })
    expect(document.querySelector('.frh')!.getAttribute('aria-live'), '先有区域、后进内容').toBe('polite')
    receipt.ok('已保存「A座」')
    receipt.warn('最多收藏 12 个，先在首页去掉几个')
    receipt.fail('保存失败：服务器没有响应')
    await nextTick()
    expect([...document.querySelectorAll('.frh .fpt')].map((e) => e.getAttribute('role'))).toEqual(['status', 'alert', 'alert'])
    w.unmount()
  })

  it('❗回执比卡内提示大一号(画布 02-C 1:1):上下 12、左右 16 = 44 高;图标 16 号描边、线条取语气色', async () => {
    // 组件自己的 <style> 塞进 document 读 getComputedStyle(同 darkOverrides.spec);令牌 jsdom 不求值,判据是令牌名
    const st = document.createElement('style')
    st.textContent = [...readFileSync(join(__dirname, '../FPToast.vue'), 'utf8').matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n')
    document.head.appendChild(st)
    const w = mount(FPReceiptHost, { attachTo: document.body })
    receipt.fail('保存失败：服务器没有响应')
    await nextTick()
    const t = document.querySelector<HTMLElement>('.frh .fpt')!
    const ic = t.querySelector('.fpt-i')!
    expect(getComputedStyle(t).padding).toBe('12px 16px')
    expect(ic.getAttribute('width')).toBe('16')
    expect(getComputedStyle(ic).getPropertyValue('fill')).toBe('none')
    expect(getComputedStyle(ic).color).toBe('var(--fpt-error)')
    // 卡内那档(19 屏 23 处)不动:8 / 12、20 号实心
    const c = mount(FPToast, { props: { modelValue: '保存失败', tone: 'error' }, attachTo: document.body })
    const ci = c.find('.fpt-i').element
    expect(getComputedStyle(c.find('.fpt').element).padding).toBe('8px 12px')
    expect(ci.getAttribute('width')).toBe('20')
    expect(getComputedStyle(ci).getPropertyValue('fill')).toBe('var(--fpt-error)')
    c.unmount()
    w.unmount()
    st.remove()
  })
})

describe('确认弹窗(⑨)', () => {
  const mountHost = () => mount(FPConfirmHost, { attachTo: document.body })

  it('❗删除类:默认焦点在「取消」,正文里的数加粗', async () => {
    const w = mountHost()
    void ask({ title: '删除 2023-08 全部读数？', body: '共 76 条已录读数，删除后不能撤销。', action: '删除 76 条', danger: true })
    await flushPromises()
    expect(document.activeElement?.textContent?.trim()).toBe('取消')
    expect([...document.querySelectorAll('.fch-b b')].map((e) => e.textContent)).toEqual(['76'])
    // 读屏:焦点落在按钮上时也要念到给数的正文
    const card = document.querySelector('.fch-card')!
    expect(document.getElementById(card.getAttribute('aria-describedby')!)?.textContent).toBe('共 76 条已录读数，删除后不能撤销。')
    w.unmount()
  })

  it('❗普通确认:焦点在主按钮,主按钮写动作本身', async () => {
    const w = mountHost()
    void ask({ title: '导入会整期替换本期数据', body: '本期有 3 处改动还没保存，导入后会丢失。', action: '仍要导入' })
    await flushPromises()
    expect(document.activeElement?.textContent?.trim()).toBe('仍要导入')
    w.unmount()
  })

  it('❗Esc = false,卡片收起', async () => {
    const w = mountHost()
    const p = ask({ title: '删除 76 条读数？', action: '删除 76 条', danger: true })
    await flushPromises()
    expect(document.querySelector('.fch-card')!.hasAttribute('aria-describedby'), '没有正文就不挂').toBe(false)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(await p).toBe(false)
    await nextTick()
    expect(document.querySelector('.fch-card')).toBeNull()
    w.unmount()
  })

  it('❗Esc 只关自己:问着时传不到底下(window 冒泡的抽屉监听收不到);答完监听摘掉,Esc 又传得下去', async () => {
    const w = mountHost()
    const under = vi.fn()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') under() }
    window.addEventListener('keydown', onKey)
    const esc = () => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    const p = ask({ title: '删除 76 条读数？', action: '删除 76 条', danger: true })
    await flushPromises()
    esc()
    expect(await p).toBe(false)
    expect(under, '确认卡开着时 Esc 不许连带底下的抽屉').toHaveBeenCalledTimes(0)
    await nextTick()
    esc()
    expect(under, '答完要摘监听,否则全站 Esc 都被吞').toHaveBeenCalledTimes(1)
    window.removeEventListener('keydown', onKey)
    w.unmount()
  })

  it('❗底下开着 ds/Popover(账号菜单里点「退出登录」)时,Esc 只关确认卡,菜单还开着', async () => {
    const open = ref(false)
    const menu = mount(defineComponent({
      setup: () => () => h(Popover, { modelValue: open.value, 'onUpdate:modelValue': (v: boolean) => { open.value = v } },
        { trigger: () => h('button', '头像'), default: () => h('div', '退出登录') }),
    }), { attachTo: document.body })
    open.value = true   // 先开菜单:它在 document 捕获阶段挂 Esc,早于确认卡
    await nextTick()
    const w = mountHost()
    const p = ask({ title: '关闭「园区抄表 · 2023-08」？', action: '放弃改动并关闭', danger: true })
    await flushPromises()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(await p).toBe(false)
    expect(open.value, '菜单不许跟着关').toBe(true)
    w.unmount()
    menu.unmount()
  })

  it('❗在卡片里按下鼠标不算「点外面」:mousedown 冒泡到遮罩也不许先答 false;按主按钮 = true', async () => {
    const w = mountHost()
    const p = ask({ title: '删除 2023-08 全部读数？', body: '共 76 条已录读数，删除后不能撤销。', action: '删除 76 条', danger: true })
    let got: boolean | 'pending' = 'pending'
    void p.then((v) => { got = v })
    await flushPromises()
    document.querySelector('.fch-card')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await flushPromises()
    expect(got).toBe('pending')
    expect(document.querySelector('.fch-card')).not.toBeNull()
    const b = btn('删除 76 条')!
    b.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))   // 真浏览器的顺序:先 mousedown 再 click
    b.click()
    await flushPromises()
    expect(got).toBe(true)
    w.unmount()
  })

  it('❗答完焦点还给原来的元素', async () => {
    const w = mountHost()
    const opener = document.createElement('button')
    opener.textContent = '删除本期'
    document.body.appendChild(opener)
    opener.focus()
    const p = ask({ title: '删除 76 条读数？', action: '删除 76 条', danger: true })
    await flushPromises()
    expect(document.activeElement?.textContent?.trim(), '前置:焦点进了卡片').toBe('取消')
    btn('取消')!.click()
    await p
    await flushPromises()
    expect(document.activeElement).toBe(opener)
    w.unmount()
  })

  it('❗外壳卸载(退出登录)时还在等的一律答 false,不留永远不落地的 Promise', async () => {
    const w = mountHost()
    const p = ask({ title: '关闭「园区抄表 · 2023-08」？', action: '放弃改动并关闭', danger: true })
    let got: boolean | 'pending' = 'pending'
    void p.then((v) => { got = v })
    await flushPromises()
    w.unmount()
    await flushPromises()
    expect(got).toBe(false)
  })

  it('❗两条同时问:排队,一次只显示队头,答完出下一条', async () => {
    const w = mountHost()
    const got: (boolean | 'pending')[] = ['pending', 'pending']
    void ask({ title: '导入会整期替换本期数据', action: '仍要导入' }).then((v) => { got[0] = v })
    void ask({ title: '删除 2023-08 全部读数？', action: '删除 76 条', danger: true }).then((v) => { got[1] = v })
    await flushPromises()
    expect(document.querySelectorAll('.fch-card')).toHaveLength(1)
    expect(document.querySelector('.fch-t')!.textContent).toBe('导入会整期替换本期数据')
    btn('仍要导入')!.click()
    await flushPromises()
    expect(document.querySelector('.fch-t')!.textContent).toBe('删除 2023-08 全部读数？')
    btn('取消')!.click()
    await flushPromises()
    expect(got).toEqual([true, false])
    w.unmount()
  })

  it('❗点外面 = false;点主按钮 = true', async () => {
    const w = mountHost()
    const p1 = ask({ title: '删除 76 条读数？', action: '删除 76 条', danger: true })
    await flushPromises()
    document.querySelector('.fch-scrim')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(await p1).toBe(false)
    const p2 = ask({ title: '删除 76 条读数？', action: '删除 76 条', danger: true })
    await flushPromises()
    btn('删除 76 条')!.click()
    expect(await p2).toBe(true)
    w.unmount()
  })

  it('❗离开确认:0 处改动直接放行、不出卡;3 处照稿 02-A 问', async () => {
    const w = mountHost()
    expect(await askLeave({ page: '园区抄表 · 2023-08', count: 0 })).toBe(true)
    await nextTick()
    expect(document.querySelector('.fch-card')).toBeNull()

    const p = askLeave({ page: '园区抄表 · 2023-08', count: 3 })
    await flushPromises()
    expect(document.querySelector('.fch-t')!.textContent).toBe('关闭「园区抄表 · 2023-08」？')
    expect(document.querySelector('.fch-b')!.textContent).toBe('这页有 3 处改动还没保存。')
    expect([...document.querySelectorAll('.fch-f button')].map((b) => b.textContent?.trim())).toEqual(['继续编辑', '放弃改动并关闭'])
    btn('继续编辑')!.click()
    expect(await p).toBe(false)
    w.unmount()
  })
})

describe('悬停说明 v-tip(⑩)', () => {
  const pointer = (el: Element, pointerType: string) => {
    const e = new MouseEvent('pointerdown', { bubbles: true })
    Object.defineProperty(e, 'pointerType', { value: pointerType })
    el.dispatchEvent(e)
  }
  const tip = () => document.querySelector('.fp-tip')

  it('❗停 499ms 不出、500ms 出;元素上没有 title', async () => {
    vi.useFakeTimers()
    const w = mount({ template: `<button v-tip="'原册 D 列：这一行电表的用途'">用途</button>` }, { attachTo: document.body })
    await w.trigger('mouseenter')
    vi.advanceTimersByTime(499)
    expect(tip()).toBeNull()
    vi.advanceTimersByTime(1)
    expect(tip()?.textContent).toBe('原册 D 列：这一行电表的用途')
    expect(w.element.hasAttribute('title')).toBe(false)
    w.unmount()
  })

  it('❗鼠标按下即收;刚收起一个又停到旁边的立即出(连扫)', async () => {
    vi.useFakeTimers()
    const w = mount({ template: `<div><button class="a" v-tip="'甲'">a</button><button class="b" v-tip="{ text: '乙', sub: '补一句' }">b</button></div>` }, { attachTo: document.body })
    await w.find('.a').trigger('mouseenter')
    vi.advanceTimersByTime(500)
    expect(tip()?.textContent).toBe('甲')
    await w.find('.a').trigger('mouseleave')
    await w.find('.b').trigger('mouseenter')
    expect(tip()?.querySelector('b')?.textContent, '主句加粗').toBe('乙')
    expect(tip()?.querySelector('.sub')?.textContent, '副句单独一行').toBe('补一句')
    pointer(w.find('.b').element, 'mouse')
    expect(tip()).toBeNull()
    w.unmount()
  })

  it('❗触屏点一下立即出', () => {
    const w = mount({ template: `<button v-tip="'甲'">a</button>` }, { attachTo: document.body })
    pointer(w.element, 'touch')
    expect(tip()?.textContent).toBe('甲')
    w.unmount()
  })

  it('❗触屏出的气泡:点别处收;滚动收', () => {
    const w = mount({ template: `<div><button class="a" v-tip="'甲'">a</button><p class="else">别处</p></div>` }, { attachTo: document.body })
    pointer(w.find('.a').element, 'touch')
    expect(tip(), '前置:出了').not.toBeNull()
    pointer(w.find('.else').element, 'touch')
    expect(tip(), '点别处').toBeNull()
    pointer(w.find('.a').element, 'touch')
    expect(tip(), '前置:又出了').not.toBeNull()
    window.dispatchEvent(new Event('scroll'))
    expect(tip(), '滚动').toBeNull()
    w.unmount()
  })

  it('❗宿主卸载,气泡跟着收(气泡挂在 body 上,不随宿主的子树走)', () => {
    const w = mount({ template: `<button v-tip="'甲'">a</button>` }, { attachTo: document.body })
    pointer(w.element, 'touch')
    expect(tip(), '前置:出了').not.toBeNull()
    w.unmount()
    expect(document.querySelector('.fp-vtip')).toBeNull()
  })

  it('❗鼠标按下收起后,停到旁边的也要重新等 500ms(按下清掉连扫)', async () => {
    vi.useFakeTimers()
    const w = mount({ template: `<div><button class="a" v-tip="'甲'">a</button><button class="b" v-tip="'乙'">b</button></div>` }, { attachTo: document.body })
    await w.find('.a').trigger('mouseenter')
    vi.advanceTimersByTime(500)
    expect(tip()?.textContent, '前置:出了').toBe('甲')
    pointer(w.find('.a').element, 'mouse')
    expect(tip()).toBeNull()
    await w.find('.a').trigger('mouseleave')
    await w.find('.b').trigger('mouseenter')
    expect(tip(), '按下之后不算连扫').toBeNull()
    vi.advanceTimersByTime(499)
    expect(tip()).toBeNull()
    vi.advanceTimersByTime(1)
    expect(tip()?.textContent).toBe('乙')
    w.unmount()
  })

  describe('定位(jsdom 不排版:触发物的框、气泡的宽高都要桩,不桩就是全 0 的退化夹具)', () => {
    const box = (el: Element, left: number, top: number, width: number, height: number) => {
      el.getBoundingClientRect = () => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() {} }) as DOMRect
    }
    const ow = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')!
    const oh = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')!
    beforeEach(() => {
      // 气泡 200 × 30
      Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get() { return this.classList.contains('fp-vtip') ? 200 : 0 } })
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get() { return this.classList.contains('fp-vtip') ? 30 : 0 } })
    })
    afterEach(() => {
      Object.defineProperty(HTMLElement.prototype, 'offsetWidth', ow)
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', oh)
    })
    const bubble = () => document.querySelector<HTMLElement>('.fp-vtip')!

    it('❗贴右下角:下方放不下翻到上方,横向夹在屏内 8px,箭头对准触发物中线', () => {
      expect([window.innerWidth, window.innerHeight], '前置:jsdom 视口').toEqual([1024, 768])
      const w = mount({ template: `<button v-tip="'原册 D 列：这一行电表的用途'">用途</button>` }, { attachTo: document.body })
      box(w.element, 962, 740, 60, 20)   // 右边 1022 = 屏宽 - 2,底 760
      pointer(w.element, 'touch')
      const b = bubble()
      expect(b.classList.contains('up')).toBe(true)
      expect(b.style.top).toBe(`${740 - 8 - 30}px`)          // 702
      expect(b.style.left).toBe(`${1024 - 8 - 200}px`)       // 816:夹在屏内 8
      expect(b.style.getPropertyValue('--ax')).toBe(`${992 - 816}px`)   // 中线 992 - left
      w.unmount()
    })

    it('❗屏幕中间:默认在下方、以中线居中,不翻', () => {
      const w = mount({ template: `<button v-tip="'原册 D 列：这一行电表的用途'">用途</button>` }, { attachTo: document.body })
      box(w.element, 400, 300, 100, 20)
      pointer(w.element, 'touch')
      const b = bubble()
      expect(b.classList.contains('up')).toBe(false)
      expect(b.style.top).toBe(`${320 + 8}px`)
      expect(b.style.left).toBe(`${450 - 100}px`)
      expect(b.style.getPropertyValue('--ax')).toBe('100px')
      w.unmount()
    })
  })

  it('❗宿主没有可读文字才补 aria-label', () => {
    const w = mount({ template: `<div><button class="ic" v-tip="'删除'"><svg /></button><button class="tx" v-tip="'删除'">删</button></div>` })
    expect(w.find('.ic').attributes('aria-label')).toBe('删除')
    expect(w.find('.tx').attributes('aria-label')).toBeUndefined()
  })
})
