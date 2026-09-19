<script setup lang="ts" generic="T extends string | string[]">
// ds/DatePicker —— 全站日期 / 区间 / 月份 / 年份选择器(DATE-PICKER-SPEC)。
// 值与原生框同格式:date 'YYYY-MM-DD' / range [from, to] / month 'YYYY-MM' / year 'YYYY';空 = ''。
// 面板照稿 Picker(304 宽、打字行、快捷 + 翻页、周一开头、固定 6 行);≤600 换成底部面板。
// 点外面 / Esc 的写法同 ds/Select:document capture 阶段(UI-OVERLAY-SPEC §1 §2)。
import { computed, nextTick, onUnmounted, ref, useAttrs, watch } from 'vue'
import { iconFor } from '@/components/ds/icon'
import { useViewport } from '@/composables/useViewport'

type Mode = 'date' | 'range' | 'month' | 'year'

const props = withDefaults(defineProps<{
  modelValue?: T | null
  mode?: Mode
  /** 与值同格式;超出的格不可点、快捷变灰 */
  min?: string
  max?: string
  /** field 表单字段 / cell 表格行内 / chip 工具条胶囊 / inline 抽屉档案行内 */
  variant?: 'field' | 'cell' | 'chip' | 'inline'
  /** field 的高度档:md 36 / sm 32(同 ds/Select) */
  size?: 'sm' | 'md'
  /** 面板对齐触发器哪一边;放不下时自动换另一边 */
  align?: 'start' | 'end'
  clearable?: boolean
  placeholder?: string
  /** 「上次选的」按它记(localStorage fp-dp-last:<账号>:<fieldId>);不传就不出这颗 */
  fieldId?: string
  /** 行内格只写 月/日 */
  short?: boolean
  /** 月份 / 年份面板:返回 false 的格变灰且不可点。要可点就别传 */
  hasData?: (v: string) => boolean
  disabled?: boolean
  invalid?: boolean
  /** chip 左侧图标 */
  icon?: string
  ariaLabel?: string
}>(), { mode: 'date', variant: 'field', size: 'md', align: 'start', icon: 'calendar' })

const emit = defineEmits<{ 'update:modelValue': [v: T]; change: [v: T] }>()

// 宿主的 title 只给触发器:落在根上的话,面板(非手机时在根里面)里每一格悬停都冒出宿主那条长提示
defineOptions({ inheritAttrs: false })
const attrs = useAttrs()
const rootAttrs = computed(() => { const { title: _t, ...rest } = attrs; return rest })

// ── 日期小算术(本地时区,只用年月日) ──
const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const addDays = (k: string, n: number) => { const [y, m, d] = k.split('-').map(Number); return ymd(new Date(y, m - 1, d + n)) }
const addMonths = (k: string, n: number) => { const [y, m] = k.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}` }
const pageOf = (y: number) => y - ((((y - 2020) % 12) + 12) % 12)   // 年份面板 12 年一页(2020–2031 一页)
const WEEK = ['一', '二', '三', '四', '五', '六', '日']

const isRange = computed(() => props.mode === 'range')
const kind = computed<'date' | 'month' | 'year'>(() => (props.mode === 'range' ? 'date' : props.mode))
const single = computed<string>(() => (typeof props.modelValue === 'string' ? props.modelValue : ''))
const pair = computed<[string, string]>(() =>
  Array.isArray(props.modelValue) ? [props.modelValue[0] ?? '', props.modelValue[1] ?? ''] : ['', ''])
const hasValue = computed(() => (isRange.value ? !!(pair.value[0] || pair.value[1]) : !!single.value))

const inRange = (k: string) => (!props.min || k >= props.min) && (!props.max || k <= props.max)
const pickable = (k: string) => inRange(k) && (kind.value === 'date' || !props.hasData || props.hasData(k))

// ── 打字:输入框里只存数字,斜杠 / 连接号由上面那层画 ──
const SEG = { date: [4, 2, 2], month: [4, 2], year: [4] } as const
const LEN = computed(() => (isRange.value ? 16 : { date: 8, month: 6, year: 4 }[kind.value]))
const digitsOf = (s: string) => s.replace(/\D/g, '')
/** 一段数字 → 合法的键;不完整或不存在的日期 → null */
function parse(ds: string): string | null {
  const k = kind.value
  if (ds.length !== { date: 8, month: 6, year: 4 }[k]) return null
  const y = +ds.slice(0, 4)
  if (y < 1000) return null
  if (k === 'year') return String(y)
  const m = +ds.slice(4, 6)
  if (m < 1 || m > 12) return null
  if (k === 'month') return `${y}-${pad(m)}`
  const d = +ds.slice(6, 8)
  return d >= 1 && d <= new Date(y, m, 0).getDate() ? `${y}-${pad(m)}-${pad(d)}` : null
}

// ── 状态 ──
const open = ref(false)
const root = ref<HTMLElement | null>(null)
const pop = ref<HTMLElement | null>(null)
const trig = ref<HTMLButtonElement | null>(null)
const inp = ref<HTMLInputElement | null>(null)
const vp = useViewport()
const sheet = ref(false)
const up = ref(false)
const end = ref(false)
const vy = ref(0)            // 面板上的年(年份面板 = 这一页的第一年)
const vm = ref(1)            // 面板上的月(日历用)
const digits = ref('')
const err = ref(false)
const typing = ref(false)    // 打字框有焦点(画光标)
const pending = ref('')      // 区间:点了起点、还没点止
const hover = ref('')
const active = ref('')       // 键盘所在的格
const kbd = ref(false)       // 用过方向键 / 翻页键之后才画出键盘所在的格(鼠标用户开面板时不多一块灰底)
const last = ref<string[] | null>(null)
const todayK = ref('')

const valueDigits = () => {
  if (!isRange.value) return digitsOf(single.value)
  const a = pending.value || pair.value[0]
  return a ? digitsOf(a) + (pending.value ? '' : digitsOf(pair.value[1])) : ''
}
const dirty = computed(() => digits.value !== valueDigits())

// ── 上次选的 ──
function lastKey(): string | null {
  if (!props.fieldId) return null
  let who = ''
  // ponytail: 同 api/index.ts 的 readUser();不 import 它是因为多数视图 spec 整个 mock 掉了 @/api
  try { who = localStorage.getItem('username') ?? sessionStorage.getItem('username') ?? '' } catch { /* 隐私模式 */ }
  return `fp-dp-last:${who}:${props.fieldId}`
}
function readLast(): string[] | null {
  const key = lastKey()
  if (!key) return null
  try {
    const v = JSON.parse(localStorage.getItem(key) || 'null')
    const arr = Array.isArray(v) ? v : [v]
    return arr.length && arr.every((s) => typeof s === 'string') && arr[0] ? arr : null
  } catch { return null }
}
function remember(v: string | string[]) {
  const key = lastKey()
  if (!key) return
  try { localStorage.setItem(key, JSON.stringify(v)) } catch { /* 隐私模式 */ }
}

// ── 开关 ──
function setView(k: string) {
  const y = +k.slice(0, 4)
  if (kind.value === 'year') vy.value = pageOf(y)
  else { vy.value = y; vm.value = kind.value === 'date' ? +k.slice(5, 7) : vm.value }
}
function openPanel() {
  if (props.disabled || open.value) return
  const t = new Date()
  todayK.value = ymd(t)
  const cur = kind.value === 'date' ? todayK.value : kind.value === 'month' ? todayK.value.slice(0, 7) : todayK.value.slice(0, 4)
  const start = (isRange.value ? pair.value[0] : single.value)
    || (props.min && cur < props.min ? props.min : props.max && cur > props.max ? props.max : cur)
  setView(start)
  pending.value = ''
  hover.value = ''
  active.value = (isRange.value ? pair.value[0] : single.value) || (pickable(cur) ? cur : '')
  kbd.value = false
  digits.value = valueDigits()
  err.value = false
  last.value = readLast()
  sheet.value = vp.tier.value === 's'
  up.value = false
  end.value = props.align === 'end'
  open.value = true
  nextTick(() => {
    if (!sheet.value) { place(); inp.value?.focus() }
  })
}
/** how:'pick' 选完 / 'esc' 放弃打了一半的 / 'outside' 点外面、再点触发器、Tab 出去:打完整的照收 */
function close(how: 'pick' | 'esc' | 'outside') {
  if (!open.value) return
  // 区间只点了起点就点外面 / Tab 出去:放弃这一半,原值不动(原生框没有「半截区间」这种状态)
  if (how === 'outside' && dirty.value) commitTyped(false)
  const hadFocus = !!pop.value?.contains(document.activeElement)
  open.value = false
  pending.value = ''
  typing.value = false
  if (hadFocus || how === 'pick') trig.value?.focus()
}
// preventDefault:嵌在 <label> 里时(导入弹窗「账期」),点到图标 / 边距 label 会再把点击转给触发器,一次点击开关两遍
function toggle(e: MouseEvent) { e.preventDefault(); if (open.value) close('outside'); else openPanel() }

// 面板贴触发器下 6px;右边放不下换右对齐,下面放不下翻到上面。边界 = 视口与最近的裁切祖先(抽屉 / 弹窗的滚动区)
function place() {
  const r = root.value, p = pop.value
  if (!r || !p) return
  const t = r.getBoundingClientRect()
  let L = 0, R = window.innerWidth, T = 0, B = window.innerHeight
  for (let el = r.parentElement; el && el !== document.body; el = el.parentElement) {
    const s = getComputedStyle(el)
    if (/(auto|scroll|hidden|clip)/.test(s.overflowX + s.overflowY)) {
      const b = el.getBoundingClientRect()
      L = Math.max(L, b.left); R = Math.min(R, b.right); T = Math.max(T, b.top); B = Math.min(B, b.bottom)
    }
  }
  const w = p.offsetWidth, h = p.offsetHeight
  if (!end.value && t.left + w > R && t.right - w >= L) end.value = true
  else if (end.value && t.right - w < L && t.left + w <= R) end.value = false
  up.value = t.bottom + 6 + h > B && t.top - 6 - h >= T
}

function emitVal(v: string | string[]) {
  if ((Array.isArray(v) ? v[0] : v)) remember(v)
  // 同原生框:选了和现在一样的值不发 change(合同弹窗靠它置 dirty,重选同一天不该算改过)
  if (Array.isArray(v) ? isRange.value && v[0] === pair.value[0] && v[1] === pair.value[1] : v === single.value) return
  emit('update:modelValue', v as T)
  emit('change', v as T)
}

// ── 选 ──
function pick(k: string) {
  if (!pickable(k)) return
  if (!isRange.value) { emitVal(k); close('pick'); return }
  if (!pending.value) {
    pending.value = k
    digits.value = digitsOf(k)
    active.value = k
    if (k.slice(0, 7) !== `${vy.value}-${pad(vm.value)}`) setView(k)
    return
  }
  const [a, b] = pending.value <= k ? [pending.value, k] : [k, pending.value]
  pending.value = ''
  emitVal([a, b])
  close('pick')
}
function quick(v: string | string[]) {
  if (typeof v === 'string') { pick(v); return }
  emitVal(v)
  close('pick')
}
function clear() {
  emitVal(isRange.value ? ['', ''] : '')
  if (open.value) close('pick')
}

/** 打字框回车 / 收起时解析。解析不了标红、不改值。closeAfter=false:收起途中调用,不再关一次 */
function commitTyped(closeAfter: boolean): void {
  const ds = digits.value
  if (!ds) { if (props.clearable && hasValue.value) { emitVal(isRange.value ? ['', ''] : ''); if (closeAfter) close('pick') } return }
  if (!isRange.value) {
    const k = parse(ds)
    if (!k || !pickable(k)) { err.value = true; return }
    emitVal(k)
    if (closeAfter) close('pick')
    return
  }
  const a = parse(ds.slice(0, 8)), b = ds.length > 8 ? parse(ds.slice(8)) : null
  if (!a || !pickable(a) || (ds.length > 8 && (!b || !pickable(b)))) { err.value = true; return }
  if (!b) { pending.value = a; setView(a); return }
  pending.value = ''
  emitVal(a <= b ? [a, b] : [b, a])
  if (closeAfter) close('pick')
}
function onInput(e: Event) {
  const el = e.target as HTMLInputElement
  const ds = digitsOf(el.value).slice(0, LEN.value)
  if (el.value !== ds) el.value = ds
  digits.value = ds
  err.value = false
  // 打出年月就翻到那个月(区间:正在打哪一头就翻到哪一头)
  const part = isRange.value && ds.length > 8 ? ds.slice(8) : ds.slice(0, 8)
  if (kind.value === 'date' && part.length >= 6) {
    const m = +part.slice(4, 6)
    if (m >= 1 && m <= 12 && +part.slice(0, 4) >= 1000) { vy.value = +part.slice(0, 4); vm.value = m }
  } else if (kind.value !== 'date' && part.length >= 4 && +part.slice(0, 4) >= 1000) {
    vy.value = kind.value === 'year' ? pageOf(+part.slice(0, 4)) : +part.slice(0, 4)
  }
}

// ── 键盘:方向键移一格,PageUp / PageDown 翻页,Enter 选中(Esc 走 document capture) ──
function step(n: number) {
  const k = kind.value
  const base = active.value || (k === 'date' ? `${vy.value}-${pad(vm.value)}-01` : k === 'month' ? `${vy.value}-01` : String(vy.value))
  const next = k === 'date' ? addDays(base, n) : k === 'month' ? addMonths(base, n) : String(+base + n)
  active.value = next
  if (k === 'year' ? pageOf(+next) !== vy.value : k === 'month' ? +next.slice(0, 4) !== vy.value : next.slice(0, 7) !== `${vy.value}-${pad(vm.value)}`) setView(next)
}
function page(dir: 1 | -1) {
  const k = kind.value
  if (k === 'date') {
    const d = new Date(vy.value, vm.value - 1 + dir, 1)
    vy.value = d.getFullYear(); vm.value = d.getMonth() + 1
    if (active.value) {
      const day = Math.min(+active.value.slice(8, 10), new Date(vy.value, vm.value, 0).getDate())
      active.value = `${vy.value}-${pad(vm.value)}-${pad(day)}`
    }
  } else {
    const n = k === 'year' ? 12 : 1
    vy.value += dir * n
    if (active.value) active.value = k === 'year' ? String(+active.value + dir * n) : `${+active.value.slice(0, 4) + dir}${active.value.slice(4)}`
  }
}
function onPanelKey(e: KeyboardEvent) {
  const cols = kind.value === 'date' ? 7 : 3
  const moves: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols }
  if (e.key in moves) { e.preventDefault(); kbd.value = true; step(moves[e.key]); return }
  if (e.key === 'PageUp' || e.key === 'PageDown') { e.preventDefault(); kbd.value = true; page(e.key === 'PageUp' ? -1 : 1); return }
  if (e.key === 'Enter') {
    // 不让回车冒到宿主(合同弹窗在字段上挂了 @keydown.enter="submit")
    e.stopPropagation()
    // Tab 到「今天」/ ‹ › / 关闭上按回车:让按钮自己的点击生效,不拿键盘所在的格顶替
    if (e.target instanceof HTMLButtonElement) return
    e.preventDefault()
    if (dirty.value || !active.value) commitTyped(true)
    else pick(active.value)
  }
}
function onTrigKey(e: KeyboardEvent) {
  // 同原生日期框:回车不开面板,留给宿主(表单回车提交);空格 / ↓ 开
  if (e.key === 'Enter') e.preventDefault()
  else if (e.key === 'ArrowDown' && !open.value) { e.preventDefault(); openPanel() }
}
// 面板里点空白处不抢打字框的焦点;嵌在 <label> 里时也不让 label 把点击转给触发器(那会把面板关掉)
function onPanelDown(e: MouseEvent) { if (e.target !== inp.value) e.preventDefault() }
function onPanelFocusOut(e: FocusEvent) {
  const to = e.relatedTarget as Node | null
  if (to && !pop.value?.contains(to) && !root.value?.contains(to)) close('outside')
}

// ── 点外面 / Esc ──
function onDoc(e: MouseEvent) {
  const t = e.target as Node
  if (root.value?.contains(t) || pop.value?.contains(t) || (t as HTMLElement).classList?.contains('dp-scrim')) return
  close('outside')
}
function onKey(e: KeyboardEvent) {
  // Esc 只关自己:阻断传播,否则宿主抽屉 / 弹窗(window keydown)连自己一起关
  if (e.key === 'Escape') { e.stopPropagation(); close('esc') }
}
watch(open, (v) => {
  if (v) {
    document.addEventListener('mousedown', onDoc, true)
    document.addEventListener('keydown', onKey, true)
  } else {
    document.removeEventListener('mousedown', onDoc, true)
    document.removeEventListener('keydown', onKey, true)
  }
})
watch(() => props.disabled, (d) => { if (d) close('esc') })
onUnmounted(() => {
  document.removeEventListener('mousedown', onDoc, true)
  document.removeEventListener('keydown', onKey, true)
})

// ── 面板内容 ──
const curYm = computed(() => `${vy.value}-${pad(vm.value)}`)
const title = computed(() => (kind.value === 'date' ? `${vy.value}年${vm.value}月` : kind.value === 'month' ? `${vy.value}年` : `${vy.value}–${vy.value + 11}`))
const navOff = computed<[boolean, boolean]>(() => {
  const { min, max } = props
  if (kind.value === 'date') {
    const prevLast = ymd(new Date(vy.value, vm.value - 1, 0)), nextFirst = `${addMonths(curYm.value, 1)}-01`
    return [!!min && prevLast < min, !!max && nextFirst > max]
  }
  if (kind.value === 'month') return [!!min && `${vy.value - 1}-12` < min, !!max && `${vy.value + 1}-01` > max]
  return [!!min && String(vy.value - 1) < min, !!max && String(vy.value + 12) > max]
})

// 区间显示:点了起点时用 起点 + 悬停(或键盘)处预览;否则用已选的值
const shown = computed<{ a: string; b: string; ring: string }>(() => {
  if (!isRange.value) return { a: '', b: '', ring: '' }
  if (pending.value) {
    const h = hover.value || active.value
    if (!h || h === pending.value) return { a: pending.value, b: '', ring: '' }
    return { a: pending.value < h ? pending.value : h, b: pending.value < h ? h : pending.value, ring: h }
  }
  return { a: pair.value[0], b: pair.value[1], ring: '' }
})

const days = computed(() => {
  const off = (new Date(vy.value, vm.value - 1, 1).getDay() + 6) % 7   // 周一开头
  const { a, b, ring } = shown.value
  return Array.from({ length: 42 }, (_, i) => {                        // 固定 6 行:翻月面板不变高
    const d = new Date(vy.value, vm.value - 1, 1 - off + i)
    const k = ymd(d), col = i % 7
    const band: string[] = []
    let sel = isRange.value ? (k === a || k === b) && k !== ring : k === single.value
    if (isRange.value && a && b && a < b) {
      if (k === a && col !== 6) band.push('bl')
      else if (k === b && col !== 0) band.push('br')
      else if (k > a && k < b) { band.push('bf'); if (col === 0) band.push('cl'); if (col === 6) band.push('cr') }
    }
    if (pending.value && k === pending.value) sel = true
    return { k, n: d.getDate(), out: d.getMonth() + 1 !== vm.value, dis: !inRange(k), today: k === todayK.value, sel, ring: k === ring && k !== pending.value, band }
  })
})
const months = computed(() => Array.from({ length: 12 }, (_, i) => {
  const k = `${vy.value}-${pad(i + 1)}`
  return { k, n: i + 1, dis: !pickable(k), today: k === todayK.value.slice(0, 7), sel: k === single.value }
}))
const years = computed(() => Array.from({ length: 12 }, (_, i) => {
  const k = String(vy.value + i)
  return { k, n: vy.value + i, dis: !pickable(k), today: k === todayK.value.slice(0, 4), sel: k === single.value }
}))

const quicks = computed(() => {
  const t = todayK.value
  if (kind.value === 'month') {
    const cur = t.slice(0, 7), prev = addMonths(cur, -1)
    return [{ t: '本月', v: cur as string | string[], off: !pickable(cur) }, { t: '上个月', v: prev, off: !pickable(prev) }]
  }
  if (kind.value === 'year') {
    const cur = t.slice(0, 4), prev = String(+cur - 1)
    return [{ t: '今年', v: cur, off: !pickable(cur) }, { t: '去年', v: prev, off: !pickable(prev) }]
  }
  const out: { t: string; v: string | string[]; off: boolean }[] = [{ t: '今天', v: isRange.value ? [t, t] : t, off: !pickable(t) }]
  // 上次选的:没有、或超出 min/max 就不出这颗
  const l = last.value
  if (l && (isRange.value ? l.length === 2 && l.every((s) => s && pickable(s)) : l.length === 1 && pickable(l[0]))) out.push({ t: '上次选的', v: isRange.value ? l : l[0], off: false })
  return out
})

// ── 字:数字等宽、斜杠淡色 ──
type Tok = { t: string; c: 'd' | 'sp' | 'ph' | 'rng' }
const PH = ['年', '月', '日']
const phToks = (n: number): Tok[] => PH.slice(0, n).flatMap((p, i) => (i ? [{ t: '/', c: 'sp' as const }, { t: p, c: 'ph' as const }] : [{ t: p, c: 'ph' as const }]))
/** 打了一半的数字 → 段 + 斜杠;打满一段就先画出下一条斜杠(光标跳进下一段) */
function typedToks(ds: string, n: number): Tok[] {
  const lens = SEG[n === 3 ? 'date' : n === 2 ? 'month' : 'year']
  const out: Tok[] = []
  let i = 0
  for (let s = 0; s < lens.length; s++) {
    const seg = ds.slice(i, i + lens[s])
    if (!seg) break
    if (s) out.push({ t: '/', c: 'sp' })
    out.push({ t: seg, c: 'd' })
    i += lens[s]
    if (seg.length === lens[s] && s < lens.length - 1 && ds.length === i) out.push({ t: '/', c: 'sp' })
  }
  return out
}
const segN = computed(() => ({ date: 3, month: 2, year: 1 }[kind.value]))
const inToks = computed<Tok[]>(() => {
  const ds = digits.value, n = segN.value
  if (!isRange.value) return ds ? typedToks(ds, n) : phToks(n)
  const a = ds.slice(0, 8), b = ds.slice(8)
  if (!a) return [...phToks(3), { t: '–', c: 'rng' }, ...phToks(3)]
  if (a.length < 8) return typedToks(a, 3)
  return [...typedToks(a, 3).filter((x, i, arr) => !(i === arr.length - 1 && x.c === 'sp')), { t: '–', c: 'rng' }, ...(b ? typedToks(b, 3) : phToks(3))]
})
const valToks = (k: string): Tok[] => k.split('-').flatMap((p, i) => (i ? [{ t: '/', c: 'sp' as const }, { t: p, c: 'd' as const }] : [{ t: p, c: 'd' as const }]))
const trigToks = computed<Tok[] | null>(() => {
  if (!hasValue.value) return null
  if (!isRange.value) return valToks(props.short && kind.value === 'date' ? single.value.slice(5) : single.value)
  const [a, b] = pair.value
  const sep: Tok = { t: props.variant === 'chip' ? '至' : '–', c: 'rng' }
  return [...(a ? valToks(a) : [{ t: '起', c: 'ph' as const }]), sep, ...(b ? valToks(b) : [{ t: '止', c: 'ph' as const }])]
})
const phText = computed(() => props.placeholder ?? (isRange.value ? '起 – 止' : null))
const sheetTitle = computed(() => props.ariaLabel || props.placeholder || '选择日期')
</script>

<template>
  <div
    v-bind="rootAttrs"
    ref="root"
    class="dp"
    :class="[`dp-v-${variant}`, { sm: size === 'sm', touch: vp.isTouch.value }]"
    :data-open="open ? '' : undefined"
    :data-invalid="invalid ? '' : undefined"
  >
    <div class="dp-box" :class="{ on: variant === 'chip' && hasValue, dis: disabled }" :title="(attrs.title as string | undefined)" @click="toggle">
      <component :is="iconFor(icon)" v-if="variant === 'chip'" class="dp-cico" :size="15" />
      <button
        ref="trig"
        type="button"
        class="dp-trg"
        :disabled="disabled"
        aria-haspopup="dialog"
        :aria-expanded="open"
        :aria-label="ariaLabel"
        @keydown="onTrigKey"
      >
        <span v-if="trigToks" class="dp-v"><i v-for="(x, i) in trigToks" :key="i" :class="x.c">{{ x.t }}</i></span>
        <span v-else-if="phText" class="dp-v dp-ph">{{ phText }}</span>
        <span v-else class="dp-v"><i v-for="(x, i) in phToks(segN)" :key="i" :class="x.c">{{ x.t }}</i></span>
      </button>
      <button v-if="clearable && hasValue && !disabled" type="button" class="dp-clr" title="清除" aria-label="清除" @click.stop="clear">
        <component :is="iconFor('x')" :size="variant === 'chip' ? 13 : 12" />
      </button>
      <component :is="iconFor('calendar')" v-if="variant === 'field' || variant === 'inline'" class="dp-ico" :size="16" />
    </div>

    <Teleport to="body" :disabled="!sheet">
      <div v-if="open && sheet" class="dp-scrim" @click="close('outside')" />
      <div
        v-if="open"
        ref="pop"
        class="dp-pop"
        :class="{ 'dp-sheet': sheet, up, end }"
        role="dialog"
        :aria-label="sheetTitle"
        @mousedown="onPanelDown"
        @click.prevent
        @keydown="onPanelKey"
        @focusout="onPanelFocusOut"
      >
        <template v-if="sheet">
          <div class="dp-hdl" />
          <div class="dp-sh">
            <span>{{ sheetTitle }}</span>
            <button type="button" class="dp-shx" aria-label="关闭" @click="close('outside')"><component :is="iconFor('x')" :size="20" /></button>
          </div>
        </template>

        <!-- 第一行:能直接打字的值。输入框只存数字、透明叠在上面;看见的是下面这层(斜杠淡色、光标画出来) -->
        <div class="dp-in" :class="{ err }">
          <span class="dp-in-v" aria-hidden="true">
            <i v-if="typing && !digits" class="dp-caret" />
            <i v-for="(x, i) in inToks" :key="i" :class="x.c">{{ x.t }}</i>
            <i v-if="typing && digits" class="dp-caret" />
          </span>
          <input
            ref="inp"
            class="dp-in-el"
            :value="digits"
            inputmode="numeric"
            autocomplete="off"
            :maxlength="LEN"
            :aria-label="ariaLabel"
            :aria-invalid="err"
            @input="onInput"
            @focus="typing = true"
            @blur="typing = false"
          />
        </div>

        <div class="dp-bar">
          <button
            v-for="q in quicks" :key="q.t" type="button" class="dp-q" :disabled="q.off"
            @click="quick(q.v)"
          >{{ q.t }}</button>
          <span class="dp-nav">
            <button type="button" class="dp-nb" :disabled="navOff[0]" aria-label="上一页" @click="page(-1)"><component :is="iconFor('chevron-left')" :size="16" /></button>
            <span class="dp-nt">{{ title }}</span>
            <button type="button" class="dp-nb" :disabled="navOff[1]" aria-label="下一页" @click="page(1)"><component :is="iconFor('chevron-right')" :size="16" /></button>
          </span>
        </div>

        <template v-if="kind === 'date'">
          <div class="dp-wk"><span v-for="w in WEEK" :key="w">{{ w }}</span></div>
          <div class="dp-g" @mouseleave="hover = ''">
            <!-- @click.self:格子外圈(手机上一行 44、按钮 46×40)点到的是 span,照样算点了这一格 -->
            <span v-for="c in days" :key="c.k" class="dc" :class="c.band" @click.self="pick(c.k)">
              <button
                type="button" tabindex="-1" class="dcb" :data-k="c.k" :disabled="c.dis"
                :class="{ o: c.out, t: c.today, s: c.sel, ring: c.ring, ac: kbd && c.k === active }"
                @mouseenter="hover = c.dis ? '' : c.k" @click="pick(c.k)"
              >{{ c.n }}</button>
            </span>
          </div>
        </template>
        <div v-else class="dp-mg">
          <button
            v-for="c in (kind === 'month' ? months : years)" :key="c.k"
            type="button" tabindex="-1" class="mc" :data-k="c.k" :disabled="c.dis"
            :class="{ t: c.today, s: c.sel, ac: kbd && c.k === active }"
            @click="pick(c.k)"
          ><template v-if="kind === 'month'">{{ c.n }}<span class="u">月</span></template><template v-else>{{ c.n }}</template></button>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
/* ── 触发器(画板 Picker 第 5 节) ── */
.dp { position: relative; min-width: 0; }
.dp-v-field, .dp-v-cell, .dp-v-inline { display: block; width: 100%; }
.dp-v-chip { display: inline-block; flex: 0 0 auto; }
.dp-box {
  position: relative; display: flex; align-items: center; gap: 8px; box-sizing: border-box; width: 100%;
  height: var(--dp-h, 36px); padding: 0 10px 0 12px;
  border: 1px solid var(--border-control); border-radius: var(--dp-r, var(--radius-sm));
  background: var(--surface-white); color: var(--text-primary); cursor: pointer;
  transition: border-color var(--dur-fast) var(--ease-standard);
}
.dp.sm .dp-box, .dp-v-inline .dp-box { height: var(--dp-h, 32px); }
.dp-v-cell .dp-box { height: var(--dp-h, 30px); padding: 0 8px; gap: 6px; }
.dp-box:hover { border-color: var(--border-control-strong); }
.dp[data-open] .dp-box { border-color: var(--hue-blue); }
.dp[data-invalid] .dp-box { border-color: var(--hue-red); }
.dp-box.dis { background: var(--surface-sunken); opacity: .6; cursor: not-allowed; }
.dp-box.dis:hover { border-color: var(--border-control); }
.dp-trg {
  flex: 1; min-width: 0; height: 100%; display: flex; align-items: center; padding: 0; border: none; background: none;
  font-family: var(--font-mono); font-size: var(--fs-body); color: inherit; text-align: left; cursor: inherit;
}
.dp-v-cell .dp-trg { font-size: var(--fs-label); }
.dp-v { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dp-v i, .dp-in-v i { font-style: normal; }
.dp-ph, .dp-v .ph { font-family: var(--font-sans); color: var(--text-muted); }
.dp-v .sp { color: var(--text-disabled); margin: 0 3px; }
.dp-v .rng { font-family: var(--font-sans); color: var(--text-muted); margin: 0 6px; }
.dp-ico { flex: 0 0 auto; color: var(--text-muted); }
.dp-clr { flex: 0 0 auto; width: 20px; height: 20px; display: grid; place-items: center; padding: 0; border: none; border-radius: var(--radius-sm); background: var(--bg-hover); color: var(--text-muted); cursor: pointer; }
/* 表单里的清除只在悬停时出(稿:选填字段有值时悬停出 ×);胶囊上常驻 */
.dp-v-field .dp-clr, .dp-v-inline .dp-clr { visibility: hidden; }
.dp-v-field .dp-box:hover .dp-clr, .dp-v-inline .dp-box:hover .dp-clr, .dp-clr:focus-visible { visibility: visible; }
/* 触屏没有悬停:× 常驻,否则手机上清不掉(停用账期改回「在用」只能靠它) */
.dp.touch .dp-clr { visibility: visible; }
.dp-clr:hover { color: var(--hue-red); }

/* 工具条胶囊(照 ContractsView .mx-asof / SystemLogsView .lg-range) */
.dp-v-chip .dp-box { height: var(--dp-h, 34px); padding: 0 10px; gap: 6px; border-radius: var(--dp-r, var(--radius-md)); color: var(--text-muted); white-space: nowrap; }
.dp-v-chip .dp-box.on { border-color: var(--hue-blue); color: var(--hue-blue); }
.dp-v-chip .dp-trg { font-family: var(--font-sans); font-size: var(--fs-label); }
.dp-v-chip .dp-v .d { font-family: var(--font-mono); color: var(--text-primary); }
.dp-v-chip .dp-v .rng { color: inherit; margin: 0 4px; }
.dp-v-chip .dp-ph { color: inherit; }
.dp-v-chip .dp-clr { background: none; margin-right: -4px; }
.dp-cico { flex: 0 0 auto; }

/* ── 面板(画板 Picker 第 1–3 节 · 生成脚本 .dp*) ── */
.dp-pop {
  position: absolute; top: calc(100% + 6px); left: 0; z-index: var(--z-popover);
  width: 304px; box-sizing: border-box; overflow: hidden;
  background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); box-shadow: var(--shadow-pop);
  color: var(--text-primary); cursor: default; animation: fp-pop-in var(--dur-fast) var(--ease-out);
}
.dp-pop.end { left: auto; right: 0; }
.dp-pop.up { top: auto; bottom: calc(100% + 6px); }

.dp-in { position: relative; height: 44px; display: flex; align-items: center; padding: 0 14px; border-bottom: 1px solid var(--divider); font-family: var(--font-mono); font-size: var(--fs-h4); white-space: nowrap; }
.dp-in.err { color: var(--delta-down-text); border-bottom-color: var(--hue-red); }
.dp-in-v { display: inline-flex; align-items: center; pointer-events: none; }
.dp-in-v .sp { color: var(--text-disabled); margin: 0 6px; }
.dp-in-v .ph { font-family: var(--font-sans); color: var(--text-muted); }
.dp-in-v .rng { color: var(--text-disabled); margin: 0 8px; }
.dp-caret { display: inline-block; width: 2px; height: 18px; margin-left: 1px; background: var(--hue-blue); animation: dp-blink 1s steps(1) infinite; }
@keyframes dp-blink { 50% { opacity: 0; } }
/* 真输入框叠在上面、看不见:只负责收键盘(手机弹数字键盘)。16px 防 iOS 聚焦缩放 */
.dp-in-el { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; border: none; padding: 0; font-size: var(--fs-input-m); cursor: text; }

.dp-bar { display: flex; align-items: center; gap: 6px; height: 44px; padding: 0 8px 0 12px; }
.dp-q { height: 24px; padding: 0 10px; border: none; border-radius: var(--radius-full); background: var(--surface-sunken); font-family: var(--font-sans); font-size: var(--fs-label); color: var(--text-secondary); white-space: nowrap; cursor: pointer; }
.dp-q:hover:not(:disabled) { background: var(--ink-100); color: var(--text-primary); }
.dp-q:disabled { color: var(--text-disabled); cursor: default; }
.dp-nav { margin-left: auto; display: flex; align-items: center; gap: 2px; }
.dp-nb { width: 28px; height: 28px; display: grid; place-items: center; padding: 0; border: none; border-radius: var(--radius-sm); background: none; color: var(--text-secondary); cursor: pointer; }
.dp-nb:hover:not(:disabled) { background: var(--bg-hover); color: var(--text-primary); }
.dp-nb:disabled { opacity: .4; cursor: default; }
.dp-nt { min-width: 76px; text-align: center; font-size: var(--fs-body); font-weight: var(--fw-medium); white-space: nowrap; }

.dp-wk { display: grid; grid-template-columns: repeat(7, 40px); height: 28px; align-items: center; padding: 0 12px; font-size: var(--fs-label); color: var(--text-muted); text-align: center; }
.dp-g { display: grid; grid-template-columns: repeat(7, 40px); grid-auto-rows: 34px; padding: 0 12px 12px; }
/* 区间:首尾实底、中段 --accent-blue 连成一条,行首行尾收圆角 */
.dc { position: relative; display: grid; place-items: center; }
.dc::before { position: absolute; top: 2px; bottom: 2px; left: 0; right: 0; background: var(--accent-blue); }
.dc.bf::before, .dc.bl::before, .dc.br::before { content: ""; }
.dc.bl::before { left: 50%; }
.dc.br::before { right: 50%; }
.dc.cl::before { left: 2px; border-radius: 8px 0 0 8px; }
.dc.cr::before { right: 2px; border-radius: 0 8px 8px 0; }

.dcb, .mc {
  position: relative; display: flex; align-items: center; justify-content: center; padding: 0; border: none; border-radius: var(--radius-sm); background: none;
  font-family: var(--font-mono); font-size: var(--fs-body); font-weight: var(--fw-regular); color: var(--text-primary); cursor: pointer;
}
.dcb { width: 36px; height: 30px; }
.mc { height: 40px; }
.mc .u { font-family: var(--font-sans); }
.dcb.o { color: var(--text-muted); }
.dcb:disabled, .mc:disabled { color: var(--text-disabled); cursor: default; }
.dcb:hover:not(:disabled), .mc:hover:not(:disabled), .dcb.ac:not(:disabled), .mc.ac:not(:disabled) { background: var(--bg-hover); color: var(--text-primary); }
.dcb.t::after, .mc.t::after { content: ""; position: absolute; bottom: 3px; left: 50%; margin-left: -2px; width: 4px; height: 4px; border-radius: 50%; background: var(--hue-blue); }
.dcb.s, .mc.s, .dcb.s:hover, .mc.s:hover, .dcb.s.ac, .mc.s.ac { background: var(--hue-blue); color: var(--control-solid-text); font-weight: var(--fw-semibold); }
.dcb.s.t::after, .mc.s.t::after { background: var(--control-solid-text); }
.dcb.ring { background: var(--surface-raised); box-shadow: inset 0 0 0 2px var(--hue-blue); }
.dp-mg { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; padding: 4px 12px 12px; }

/* ── 手机:从底部升起(画板 Picker 第 7 节 · .sheet) ── */
.dp-scrim { position: fixed; inset: 0; z-index: var(--z-confirm); background: var(--scrim); opacity: 0; animation: fp-fade-in var(--dur-base) forwards; }
.dp-pop.dp-sheet {
  position: fixed; top: auto; left: 0; right: 0; bottom: 0; z-index: var(--z-confirm); width: auto;
  border: none; border-radius: var(--radius-lg) var(--radius-lg) 0 0; padding-bottom: 34px;
  animation: dp-sheet-in var(--dur-base) var(--ease-out);
}
@keyframes dp-sheet-in { from { transform: translateY(100%); } }
.dp-hdl { width: 36px; height: 5px; margin: 8px auto 0; border-radius: 3px; background: var(--ink-300); }
.dp-sh { display: flex; align-items: center; justify-content: space-between; height: 52px; padding: 0 4px 0 16px; font-size: var(--fs-h3); font-weight: var(--fw-semibold); }
.dp-shx { width: 44px; height: 44px; display: grid; place-items: center; padding: 0; border: none; background: none; color: var(--text-secondary); cursor: pointer; }
.dp-sheet .dp-in { height: 52px; padding: 0 16px; font-size: var(--fs-h3); border-top: 1px solid var(--divider); }
.dp-sheet .dp-bar { height: 60px; padding: 0 4px 0 16px; gap: 8px; }
.dp-sheet .dp-q { height: 44px; padding: 0 16px; font-size: var(--fs-body); }
.dp-sheet .dp-nb { width: 44px; height: 44px; }
.dp-sheet .dp-nt { font-size: var(--fs-h4); }
.dp-sheet .dp-wk { grid-template-columns: repeat(7, 1fr); padding: 0 16px; }
.dp-sheet .dp-g { grid-template-columns: repeat(7, 1fr); grid-auto-rows: 44px; padding: 0 16px 8px; }
.dp-sheet .dcb { width: 46px; height: 40px; font-size: var(--fs-h3); }
.dp-sheet .dp-mg { padding: 4px 16px 8px; gap: 8px; }
.dp-sheet .mc { height: 52px; font-size: var(--fs-h3); }
</style>
