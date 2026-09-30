// 悬停说明(十件 ⑩;LAYOUT-STABILITY §4.3,画布 06-B ⑩):v-tip="'一句'" 或 v-tip="{ text, sub }",替代浏览器 title。
// 外观、停 500ms 出、刚收起一个又停到旁边立即出(连扫,和 ShellTip 共用 tipState)都照抄 components/shell/ShellTip.vue;
// 顶栏 / 图标轨 / 页签条继续用 ShellTip 组件,别处一律用本指令。
// 全站只有一个气泡,挂 body、显示时才在 DOM 里;按触发物的位置 fixed 摆放,下方放不下翻到上方,左右夹在屏内。
// 鼠标按下即收;触屏点一下出(点别处、滚动即收)。宿主没有可读文字(图标钮)时补 aria-label。
// 图表读数气泡(ECharts / cz-tip / SVG)要零延迟跟鼠标,不用本指令。
import type { Directive } from 'vue'
import { tipState } from '@/components/shell/ShellTip.vue'
import './tip.css'

export type TipValue = string | { text: string; sub?: string } | null | undefined
type Tip = { text: string; sub?: string }
type TipEl = HTMLElement & { _tip?: Tip; _tipAria?: boolean; _tipOff?: () => void }

const DELAY = 500
const GAP = 8
let bubble: HTMLElement | null = null
let owner: TipEl | null = null
let timer: ReturnType<typeof setTimeout> | undefined

const norm = (v: TipValue): Tip | undefined => {
  const t = typeof v === 'string' ? { text: v } : v ?? undefined
  return t?.text ? t : undefined
}

function show(el: TipEl) {
  const t = el._tip
  if (!t || !el.isConnected) return
  const b = (bubble ??= document.createElement('div'))
  b.className = 'fp-tip fp-vtip'
  b.setAttribute('role', 'tooltip')
  const head = document.createElement(t.sub ? 'b' : 'span')
  head.textContent = t.text
  b.replaceChildren(head)
  if (t.sub) {
    const s = document.createElement('span')
    s.className = 'sub'
    s.textContent = t.sub
    b.append(s)
  }
  document.body.appendChild(b)
  // 先挂上再量:下方放不下且上方放得下就翻上去;横向以触发物中线居中,夹在屏内 8px
  const r = el.getBoundingClientRect()
  const w = b.offsetWidth
  const h = b.offsetHeight
  const up = r.bottom + GAP + h > window.innerHeight && r.top - GAP - h >= 0
  const cx = r.left + r.width / 2
  const left = Math.max(GAP, Math.min(cx - w / 2, window.innerWidth - GAP - w))
  b.classList.toggle('up', up)
  b.style.left = `${left}px`
  b.style.top = `${up ? r.top - GAP - h : r.bottom + GAP}px`
  b.style.setProperty('--ax', `${Math.max(10, Math.min(cx - left, w - 10))}px`)
  owner = el
  document.addEventListener('pointerdown', outside, true)
  window.addEventListener('scroll', hide, true)
}

function hide() {
  clearTimeout(timer)
  if (!owner) return
  owner = null
  tipState.lastHide = Date.now()
  bubble?.remove()
  document.removeEventListener('pointerdown', outside, true)
  window.removeEventListener('scroll', hide, true)
}

function outside(e: Event) {
  if (!(e.target instanceof Node && owner?.contains(e.target))) hide()
}

function enter(el: TipEl) {
  clearTimeout(timer)
  if (!el._tip) return
  if (Date.now() - tipState.lastHide < 300) show(el)
  else timer = setTimeout(() => show(el), DELAY)
}

function leave(el: TipEl) {
  clearTimeout(timer)
  if (owner === el) hide()
}

function down(el: TipEl, e: PointerEvent) {
  clearTimeout(timer)
  if (e.pointerType === 'touch') { show(el); return }   // 触屏没有悬停:点一下就出
  if (owner === el) hide()
  tipState.lastHide = 0   // 按下即收,之后再停也要重新等 500ms(ShellTip 同款)
}

// 图标钮这类宿主没有可读文字,读屏只能靠它;自己补的才跟着改 / 撤
function aria(el: TipEl) {
  if (!el._tipAria && (el.hasAttribute('aria-label') || el.textContent?.trim())) return
  if (el._tip) el.setAttribute('aria-label', el._tip.text)
  else el.removeAttribute('aria-label')
  el._tipAria = !!el._tip
}

export const vTip: Directive<TipEl, TipValue> = {
  mounted(el, { value }) {
    el._tip = norm(value)
    const on = () => enter(el)
    const off = () => leave(el)
    const dn = (e: PointerEvent) => down(el, e)
    el.addEventListener('mouseenter', on)
    el.addEventListener('mouseleave', off)
    el.addEventListener('pointerdown', dn)
    el._tipOff = () => {
      el.removeEventListener('mouseenter', on)
      el.removeEventListener('mouseleave', off)
      el.removeEventListener('pointerdown', dn)
    }
    aria(el)
  },
  updated(el, { value }) {
    el._tip = norm(value)
    aria(el)
    if (owner !== el) return
    if (el._tip) show(el)
    else hide()
  },
  beforeUnmount(el) {
    el._tipOff?.()
    if (owner === el) hide()
  },
}

declare module 'vue' {
  interface GlobalDirectives { vTip: typeof vTip }
}
