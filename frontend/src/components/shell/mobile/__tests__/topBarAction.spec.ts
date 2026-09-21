// 手机顶栏的屏级动作位(RESPONSIVE-LAYOUT-SPEC §5.10「动作 → 顶栏右:1 个主动作」)。
//
// 本轮只把位开出来,一个屏都没接。所以最重的一条断言是**反向**的:
// 不登记动作时,顶栏渲染出来的东西必须与开位之前逐字相同 —— 全站现有手机屏都还没登记,
// 它们的顶栏一旦多出半个节点,就是 49 屏一起退步。
//
// ⚠「不该有 X」这类断言最容易自己变成恒真:选择器写错 → 集合恒空 → 永远绿。
// 所以每条都先断「真的选到了那四件」(标签+类名+无障碍名三者对齐),再断顺序与增减。
import { mount, type VueWrapper } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { defineComponent, h, KeepAlive, nextTick, ref } from 'vue'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Pencil } from 'lucide-vue-next'

vi.mock('vue-router', () => ({
  useRoute: () => ({ meta: { page: '园区抄表' } }),
}))

import MobileTopBar from '../MobileTopBar.vue'
import { useUiStore } from '@/stores/ui'
import { useTopBarAction } from '@/composables/useTopBarAction'

const SRC = readFileSync(join(__dirname, '..', 'MobileTopBar.vue'), 'utf8')

/** 顶栏的直接子节点,写成「标签.类名」——元素个数、顺序、类名一条断言全钉住 */
const parts = (w: VueWrapper) =>
  Array.from(w.find('.mtb').element.children).map(
    (el) => [el.tagName.toLowerCase(), ...Array.from(el.classList)].join('.'),
  )

/** 顶栏里每个按钮的无障碍名,按 DOM 顺序 —— 认的是「哪一件」,不只是「有几件」 */
const labels = (w: VueWrapper) =>
  Array.from(w.find('.mtb').element.querySelectorAll('button')).map((b) => b.getAttribute('aria-label'))

const BASE_PARTS = ['button.mtb-btn', 'span.mtb-title', 'button.mtb-btn', 'span.mtb-bell']
const BASE_LABELS = ['打开导航', '搜索', '待批授权']

/** `<style scoped>` 里某条规则的整块(jsdom 不做布局,触达只能断 CSS 字面量) */
const cssBlock = (sel: string) => {
  const at = SRC.indexOf(`${sel} {`)
  expect(at, `${sel} 这条规则不在源码里 —— 选择器改名了,下面的断言全成恒真`).toBeGreaterThan(-1)
  return SRC.slice(at, SRC.indexOf('}', at) + 1)
}

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('MobileTopBar 屏级动作位', () => {
  it('❗不登记动作时逐字不变:仍是 ☰ / 屏名 / 🔍 / 🔔 四件,顺序与类名原样', () => {
    const w = mount(MobileTopBar)
    // 先证明真的选到了那四件(标签+类名 与 无障碍名 两路对齐),再谈「没多出东西」
    expect(parts(w)).toEqual(BASE_PARTS)
    expect(labels(w)).toEqual(BASE_LABELS)
    expect(w.find('.mtb-title').text()).toBe('园区抄表')
    expect(w.find('.mtb-act').exists()).toBe(false)
  })

  it('❗登记一个动作:插在屏名与 🔍 之间,🔍/🔔 仍是最后两件(外壳贴着右边缘不动)', async () => {
    const w = mount(MobileTopBar)
    const ui = useUiStore()
    const onClick = vi.fn()
    ui.topBarAction = { label: '编辑模式', onClick }
    await nextTick()

    expect(parts(w)).toEqual([
      'button.mtb-btn',            // ☰
      'span.mtb-title',            // 屏名
      'button.mtb-btn.mtb-act',    // 屏级动作 ← 钉死在这一格
      'button.mtb-btn',            // 🔍
      'span.mtb-bell',             // 🔔
    ])
    // 无障碍名一路:动作钮的名字是它自己的文字(没有 aria-label),位置同样钉在 🔍 之前
    expect(labels(w)).toEqual(['打开导航', null, '搜索', '待批授权'])
    expect(w.find('.mtb-act').text()).toBe('编辑模式')

    await w.find('.mtb-act').trigger('click')
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('动作带图标时:图标与文字同在一个钮里,顶栏结构不再多一格', async () => {
    const w = mount(MobileTopBar)
    const ui = useUiStore()
    ui.topBarAction = { label: '编辑模式', icon: Pencil, onClick: vi.fn() }
    await nextTick()
    expect(parts(w)).toHaveLength(5)
    expect(w.find('.mtb-act svg').exists()).toBe(true)
    expect(w.find('.mtb-act-t').text()).toBe('编辑模式')
  })

  it('❗撤掉动作后回到那四件 —— v-if 是真摘掉,不是留个空壳', async () => {
    const w = mount(MobileTopBar)
    const ui = useUiStore()
    ui.topBarAction = { label: '编辑模式', onClick: vi.fn() }
    await nextTick()
    expect(parts(w)).toHaveLength(5)
    ui.topBarAction = null
    await nextTick()
    expect(parts(w)).toEqual(BASE_PARTS)
    expect(labels(w)).toEqual(BASE_LABELS)
  })

  it('顶栏高度仍是 52(+safe-area),动作钮触达 ≥44×44(§6.2)', () => {
    // 高度公式与 AppShell.vue 的 .fp-mtb-slot 占位壳逐字同步,改这行必须同步那边
    expect(cssBlock('.mtb')).toContain('height: calc(52px + env(safe-area-inset-top));')
    // 原有三个圆钮:44×44 不动
    const btn = cssBlock('.mtb-btn')
    expect(btn).toContain('width: 44px;')
    expect(btn).toContain('height: 44px;')
    // 动作钮:横向自适应但不低于 44,高度**不覆盖**——继承 .mtb-btn 的 44
    const act = cssBlock('.mtb-act')
    expect(act, '选到的不是动作钮那块').toContain('grid-auto-flow: column;')
    expect(act).toContain('min-width: 44px;')
    expect(act).not.toMatch(/(^|[\s;])height:/)
  })
})

// ── useTopBarAction:屏侧的 API ──────────────────────────────────────────────
// 页签是 KeepAlive 的(App.vue:75),离屏只停用不卸载。不管清场的话,
// 上一屏的主动作会留在下一屏的顶栏上 —— 这是这段生命周期代码存在的唯一理由,所以必须断。
describe('useTopBarAction 登记与清场', () => {
  const screenOf = (label: () => string) =>
    defineComponent({
      setup() {
        useTopBarAction(() => ({ label: label(), onClick: () => {} }))
        return () => h('div', 'screen')
      },
    })

  it('挂载即登记;getter 变了跟着改', async () => {
    const t = ref('编辑模式')
    const w = mount(screenOf(() => t.value))
    const ui = useUiStore()
    expect(ui.topBarAction?.label).toBe('编辑模式')
    t.value = '退出编辑'
    await nextTick()
    expect(ui.topBarAction?.label).toBe('退出编辑')
    w.unmount()
    expect(ui.topBarAction).toBeNull()
  })

  it('❗KeepAlive 停用当场摘掉,切回再挂上', async () => {
    const on = ref(true)
    const Screen = screenOf(() => '编辑模式')
    const Host = defineComponent({
      setup: () => () => h(KeepAlive, null, { default: () => (on.value ? h(Screen) : h('i')) }),
    })
    mount(Host)
    const ui = useUiStore()
    expect(ui.topBarAction?.label).toBe('编辑模式')
    on.value = false
    await nextTick()
    expect(ui.topBarAction, '停用的屏把自己的动作留在了下一屏的顶栏上').toBeNull()
    on.value = true
    await nextTick()
    expect(ui.topBarAction?.label).toBe('编辑模式')
  })

  it('❗停用期间 getter 再变也不许写回去(KeepAlive 不停 watchEffect)', async () => {
    const t = ref('编辑模式')
    const on = ref(true)
    const Screen = screenOf(() => t.value)
    const Host = defineComponent({
      setup: () => () => h(KeepAlive, null, { default: () => (on.value ? h(Screen) : h('i')) }),
    })
    mount(Host)
    on.value = false
    await nextTick()
    t.value = '退出编辑'
    await nextTick()
    expect(useUiStore().topBarAction, '离屏的屏借 watchEffect 把自己写回了别人的顶栏').toBeNull()
  })

  // ── 换屏:A 的卸载落在 B 登记之后(2026-09-21 对抗复查抓到的挡工) ────────────
  // 真实次序是「新屏 setup 登记 → 路由 afterEach 里 tabs.commit() 让旧屏 dropState()
  // → 旧屏 KeepAlive 卸载」。旧屏的 drop() 若无条件清空,会把新屏刚挂上的那颗抹掉,
  // 而且没有人会再写回来 —— 现象是手机上换到抄表屏时顶栏的「编辑模式」根本不出现,
  // 这两屏在 S 档的唯一写入口就没了。
  it('❗A 先卸载在 B 登记之后:B 的动作必须还在(无条件清空 = 整个功能失效)', async () => {
    const A = screenOf(() => 'A 的动作')
    const B = screenOf(() => 'B 的动作')
    const showA = ref(true)
    const showB = ref(false)
    const Host = defineComponent({
      setup: () => () => h('div', [showA.value ? h(A) : null, showB.value ? h(B) : null]),
    })
    mount(Host)
    const ui = useUiStore()
    expect(ui.topBarAction?.label, '前提:A 真的登记上了').toBe('A 的动作')

    // B 先挂上(登记),A 后卸载 —— 顺序就是真实换屏的顺序
    showB.value = true
    await nextTick()
    expect(ui.topBarAction?.label, 'B 登记后应当是 B 的').toBe('B 的动作')
    showA.value = false
    await nextTick()
    expect(ui.topBarAction?.label, 'A 卸载时把 B 的动作一起清掉了 —— drop() 必须判所有权').toBe('B 的动作')
  })

  it('❗A 单独卸载(没有别人接手)时,顶栏要清干净', async () => {
    const A = screenOf(() => 'A 的动作')
    const showA = ref(true)
    const Host = defineComponent({ setup: () => () => (showA.value ? h(A) : h('i')) })
    mount(Host)
    const ui = useUiStore()
    expect(ui.topBarAction?.label).toBe('A 的动作')
    showA.value = false
    await nextTick()
    expect(ui.topBarAction, '没人接手时该清掉,不能把 A 的动作留在顶栏上').toBeNull()
  })
})
