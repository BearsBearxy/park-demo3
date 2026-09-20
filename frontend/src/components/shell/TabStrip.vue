<script setup lang="ts">
// TabStrip — 页签条(TAB-BAR-SPEC §3 §4)。形状照 Chrome:当前页签白底、和下面的顶栏连成一块;
// 颜色、字、图标全沿用产品的。页签规则(在哪一格开、关了跳哪)全在 stores/tabs.ts,这里只管画和手势。
import { computed, ref, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useTabsStore, tabMeta, HOME, NEWTAB, type Tab } from '@/stores/tabs'
import { useFavoritesStore, MAX_FAVS } from '@/stores/favorites'
import { fpAllPages } from '@/nav/fpNav'
import { iconFor } from '@/components/ds/icon'
import ShellTip from '@/components/shell/ShellTip.vue'
import { useViewport } from '@/composables/useViewport'
import { X, ChevronDown, Plus, Pin, Search } from 'lucide-vue-next'

const router = useRouter()
const route = useRoute()
const tabs = useTabsStore()
const favs = useFavoritesStore()
// 触屏(RESPONSIVE-LAYOUT-SPEC §6.1 §6.3):按**输入能力**判,不按视口宽 ——
// iPad 接了触控板 hover:hover 会自己回来,useViewport 跟着 matchMedia change 走,禁 UA 嗅探。
const { isTouch } = useViewport()

/** value → 层 / 分组(悬停卡片第三行)。 */
const PAGE = Object.fromEntries(fpAllPages().map(p => [p.value, p]))

/** 页签上的一整句:`屏名 · 期 · 公司`,有几段写几段。期与公司来自 tabs.ctx —— 未激活的页签早已卸载。 */
const titleOf = (v: string): string => {
  const c = tabs.ctx[v]
  return [tabMeta(v)?.page ?? v, c?.p, c?.coName].filter(Boolean).join(' · ')
}
const ctxOf = (v: string) => [tabs.ctx[v]?.p, tabs.ctx[v]?.coName].filter(Boolean).join(' · ')

const activeValue = computed(() => (route.meta as Record<string, string>).value ?? '')

// ── 宽度(§3.2):只跟页签个数有关 ──
/** 最窄 96、最宽 220;固定页签 44;+ 与 ⌄ 各占的宽;窄于 120 时只有当前 / 悬停的页签显示 ×。 */
const TAB = { MIN: 96, MAX: 220, PIN: 44, PLUS: 32, LIST: 48, PAD: 16, XMIN: 120 }
const rootRef = ref<HTMLElement | null>(null)
const inRef = ref<HTMLElement | null>(null)
const stripW = ref(0)
const pins = computed(() => tabs.tabs.filter(t => t.pinned))
const normals = computed(() => tabs.tabs.filter(t => !t.pinned))
const avail = computed(() => stripW.value - TAB.PAD - pins.value.length * TAB.PIN - TAB.PLUS - TAB.LIST)
const calcW = computed(() => {
  const n = Math.max(1, normals.value.length)
  return Math.min(TAB.MAX, Math.max(TAB.MIN, Math.floor(avail.value / n)))
})
/** 连着关:鼠标关掉一个后先保持原宽,鼠标离开页签条再重算(§3.2)。 */
const frozenW = ref<number | null>(null)
const tabW = computed(() => frozenW.value ?? calcW.value)
const overflow = computed(() => normals.value.length * tabW.value > avail.value + 1)

const hoverV = ref('')
// 触屏上 hoverV 永远是空:窄页签只剩当前签有 ×,别的一个都点不到 —— §6.1「无 hover 唯一入口」,常显兜底
const showX = (t: Tab) =>
  !t.pinned && (isTouch.value || tabW.value >= TAB.XMIN || t.value === activeValue.value || t.value === hoverV.value)
/** 固定钮只给固定得了的签:首页恒固定(tabs.unpin 拒绝它)、新标签页不进固定区 —— 与右键菜单同口径。 */
const canPin = (v: string) => v !== HOME && v !== NEWTAB
/**
 * 触屏固定钮**只挂当前签与已固定签**。
 *
 * 稿(ShellTablet)只写了一句「Pin 钮常显即唯一入口」,图上一个固定钮都没画,尺寸与落位没给。
 * 给每个非固定签都挂一颗的代价可以算出来:TAB.MIN=96,扣图标 16 + 固定钮 20 + 关闭钮 20 +
 * padding 16 + 三处 gap,标题只剩个位数像素 —— 页签上认不出是哪一屏,等于把标题换成了两颗钮。
 * 「唯一入口」这条要求的是「想固定当前这一屏时有地方点」,当前签上有就够了;
 * 已固定的签也要留着,否则取消固定就没入口了(固定签不渲标题,不抢宽)。
 */
const showPin = (t: Tab) => isTouch.value && canPin(t.value) && (!!t.pinned || t.value === activeValue.value)

let ro: ResizeObserver | null = null
onMounted(() => {
  const el = rootRef.value
  if (el) {
    stripW.value = el.clientWidth
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => { stripW.value = el.clientWidth; frozenW.value = null })
      ro.observe(el)
    }
  }
  document.addEventListener('mousedown', onDocDown, true)
  document.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  ro?.disconnect()
  document.removeEventListener('mousedown', onDocDown, true)
  document.removeEventListener('keydown', onKey)
  clearTimeout(cardTimer)
  endDrag()
})

// 连着关只冻结「关」这一个动作:页签变多了(键盘开页、重新打开)就解冻,免得宽度一直停在旧值
watch(() => tabs.tabs.length, (n, o) => { if (n > o) frozenW.value = null })

// 切换时把当前页签滚进视野
watch(activeValue, async () => {
  await nextTick()
  const box = inRef.value
  const node = box?.querySelector<HTMLElement>(`[data-tabv="${activeValue.value}"]`)
  if (!box || !node) return
  const l = node.offsetLeft, r = l + node.offsetWidth
  if (l < box.scrollLeft) box.scrollLeft = l - 8
  else if (r > box.scrollLeft + box.clientWidth) box.scrollLeft = r - box.clientWidth + 8
})

// 分隔线:挨着当前页签 / 悬停页签 / 被拖的那个的两侧不画(§3.1)
const quiet = (v: string | undefined) => !!v && (v === activeValue.value || v === hoverV.value || v === drag.value?.v)
const noSep = (i: number) => i === 0 || quiet(tabs.tabs[i]?.value) || quiet(tabs.tabs[i - 1]?.value)

// ── 点、关、新建 ──
function selectTab(v: string) {
  if (suppressClick) { suppressClick = false; return }
  closeFloats()
  if (v !== activeValue.value) router.push('/' + v)
}

/** 关掉 / 重新加载会卸掉这一屏的实例(App.vue 的 KeepAlive 按纪元卸载):我正在编辑的先问一句。 */
function okToDrop(vs: string[], verb: string): boolean {
  const editing = vs.filter(v => tabs.isEditing(v))
  if (!editing.length) return true
  const names = editing.map(v => `「${tabMeta(v)?.page ?? v}」`).join('')
  return window.confirm(`${names}正在编辑。${verb}会丢失未保存的改动，继续？`)
}

async function closeTab(v: string, viaMouse = false) {
  if (v === HOME) return
  hideCard()
  if (!okToDrop([v], '关掉')) return
  if (viaMouse) frozenW.value = tabW.value
  const current = activeValue.value
  const next = tabs.close(v)
  if (next == null) return
  // 先导航离开、再弃状态:epoch++ 若先于导航,被关视图会以新 key 瞬时重挂载(复审实测)
  if (v === current) await router.push('/' + next)
  tabs.dropState(v)
}

async function closeMany(gone: string[], keep: string) {
  if (gone.includes(activeValue.value)) await router.push('/' + keep)
  for (const v of gone) tabs.dropState(v)
}

function newTab(after?: string) {
  closeFloats()
  tabs.newTab(after)
  router.push('/' + NEWTAB)
}

function onAux(e: MouseEvent, v: string) {
  if (e.button === 1) closeTab(v, true)
}

// ── 悬停卡片(§3.3):停 600ms ──
const card = ref<{ v: string; left: number } | null>(null)
let cardTimer: ReturnType<typeof setTimeout> | undefined
function onEnter(e: MouseEvent, v: string) {
  hoverV.value = v
  clearTimeout(cardTimer)
  if (drag.value || menu.value) return
  const el = e.currentTarget as HTMLElement
  cardTimer = setTimeout(() => {
    const root = rootRef.value?.getBoundingClientRect()
    const r = el.getBoundingClientRect()
    card.value = { v, left: Math.max(0, r.left - (root?.left ?? 0)) }
  }, 600)
}
function onLeaveTab() {
  hoverV.value = ''
  clearTimeout(cardTimer)
  card.value = null
}
function hideCard() { clearTimeout(cardTimer); card.value = null }

// ── 右键菜单(§3.4) ──
const menu = ref<{ v: string; x: number; y: number } | null>(null)
const menuRef = ref<HTMLElement | null>(null)
function onContext(e: MouseEvent, v: string) {
  e.preventDefault()
  hideCard()
  listOpen.value = false
  menu.value = { v, x: Math.min(e.clientX, window.innerWidth - 256), y: e.clientY + 2 }
}
const menuTab = computed(() => tabs.tabs.find(t => t.value === menu.value?.v))
const menuItems = computed(() => {
  const v = menu.value?.v ?? ''
  const t = menuTab.value
  const isHome = v === HOME
  const isNew = v === NEWTAB
  const i = tabs.tabs.findIndex(x => x.value === v)
  const hasOthers = tabs.tabs.some(x => !x.pinned && x.value !== v)
  const hasRight = tabs.tabs.slice(i + 1).some(x => !x.pinned)
  const favFull = favs.list.length >= MAX_FAVS
  return [
    { k: 'new', label: '在右侧新建页签' },
    { k: 'reload', label: '重新加载', note: '回到刚打开的样子' },
    { k: 'pin', label: t?.pinned && !isHome ? '取消固定' : '固定', off: isHome || isNew },
    { k: 'fav', label: favs.has(v) ? '取消收藏' : '收藏此页', off: isHome || isNew || (!favs.has(v) && favFull), note: !favs.has(v) && favFull ? `已满 ${MAX_FAVS} 个` : undefined },
    { k: '-' },
    { k: 'close', label: '关闭', note: '中键', off: isHome },
    { k: 'others', label: '关闭其他页签', off: isHome || !hasOthers },
    { k: 'right', label: '关闭右侧页签', off: isHome || !hasRight },
    { k: '-' },
    { k: 'reopen', label: '重新打开关闭的页签', off: !tabs.closed.length },
  ] as { k: string; label?: string; note?: string; off?: boolean }[]
})
async function runMenu(k: string) {
  const v = menu.value?.v
  menu.value = null
  if (!v) return
  switch (k) {
    case 'new': newTab(v); break
    // 当前页签:epoch++ 让 KeepAlive 换新实例,原地重挂载;别的页签:下次切过去时是全新的
    case 'reload': if (okToDrop([v], '重新加载')) tabs.dropState(v); break
    case 'pin': if (menuTabPinned(v)) tabs.unpin(v); else tabs.pin(v); break
    case 'fav': favs.toggle(v); break
    case 'close': await closeTab(v); break
    case 'others': {
      if (!okToDrop(tabs.tabs.filter(t => !t.pinned && t.value !== v).map(t => t.value), '关掉')) break
      await closeMany(tabs.closeOthers(v), v)
      break
    }
    case 'right': {
      const i = tabs.tabs.findIndex(t => t.value === v)
      if (!okToDrop(tabs.tabs.slice(i + 1).filter(t => !t.pinned).map(t => t.value), '关掉')) break
      await closeMany(tabs.closeRight(v), v)
      break
    }
    case 'reopen': reopen(); break
  }
}
const menuTabPinned = (v: string) => !!tabs.tabs.find(t => t.value === v)?.pinned

function reopen(v?: string) {
  const got = tabs.reopenClosed(v)
  listOpen.value = false
  if (got) router.push('/' + got)
}

// ── 全部页签(§3.5) ──
const listOpen = ref(false)
const listRef = ref<HTMLElement | null>(null)
const listBtnRef = ref<HTMLElement | null>(null)
const listQuery = ref('')
const listRows = computed(() => {
  const q = listQuery.value.trim()
  return tabs.tabs.filter(t => !q || titleOf(t.value).includes(q))
})
const recentClosed = computed(() => tabs.closed.slice(0, 5))
function toggleList() {
  hideCard()
  menu.value = null
  listOpen.value = !listOpen.value
  listQuery.value = ''
}

function closeFloats() { menu.value = null; listOpen.value = false }
function onDocDown(e: MouseEvent) {
  const t = e.target as Node | null
  if (menu.value && !(t && menuRef.value?.contains(t))) menu.value = null
  if (listOpen.value && !(t && (listRef.value?.contains(t) || listBtnRef.value?.contains(t)))) listOpen.value = false
}
function onKey(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  if (menu.value) menu.value = null
  else if (listOpen.value) listOpen.value = false
}

// ── 拖动(§4):按住横移 >4px 开始;被拖的跟手,越过邻居一半邻居滑进空位 ──
const drag = ref<{ v: string; from: number; startX: number; grabX: number; offset: number; moved: boolean } | null>(null)
let suppressClick = false

function tabEl(v: string) {
  return inRef.value?.querySelector<HTMLElement>(`[data-tabv="${v}"]`) ?? null
}
/** 手写 FLIP:记下别的页签的位置 → 改顺序 → 从旧位置 120ms 滑到新位置。被拖的那个不参与。 */
function flip(mutate: () => void, skip: string) {
  const box = inRef.value
  const before = new Map<string, number>()
  box?.querySelectorAll<HTMLElement>('[data-tabv]').forEach(el => before.set(el.dataset.tabv!, el.offsetLeft))
  mutate()
  void nextTick(() => {
    box?.querySelectorAll<HTMLElement>('[data-tabv]').forEach(el => {
      const v = el.dataset.tabv!
      const b = before.get(v)
      if (v === skip || b == null) return
      const d = b - el.offsetLeft
      if (!d) return
      el.style.transition = 'none'
      el.style.transform = `translateX(${d}px)`
      void el.offsetWidth
      el.style.transition = 'transform var(--dur-fast) var(--ease-out)'
      el.style.transform = ''
    })
  })
}

function onPointerDown(e: PointerEvent, v: string) {
  hideCard()
  if (e.button !== 0 || v === HOME) return
  if ((e.target as HTMLElement).closest('.fp-tab-x, .fp-tab-pin')) return
  const el = e.currentTarget as HTMLElement
  drag.value = {
    v, from: tabs.tabs.findIndex(t => t.value === v),
    startX: e.clientX, grabX: e.clientX - el.getBoundingClientRect().left, offset: 0, moved: false,
  }
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  // 触屏横滑被浏览器接管成滚动时只发 pointercancel、不发 pointerup:当作没拖过,原样收尾
  window.addEventListener('pointercancel', endDrag)
}
function onPointerMove(e: PointerEvent) {
  const d = drag.value
  const box = inRef.value
  if (!d || !box) return
  if (!d.moved) {
    if (Math.abs(e.clientX - d.startX) < 4) return
    d.moved = true
    hideCard()
  }
  const el = tabEl(d.v)
  if (!el) return
  const left = e.clientX - box.getBoundingClientRect().left + box.scrollLeft - d.grabX
  d.offset = left - el.offsetLeft
  // 越过邻居一半就换位(只在同一区里换,规则在 tabs.move)
  const i = tabs.tabs.findIndex(t => t.value === d.v)
  const center = left + el.offsetWidth / 2
  const prev = tabs.tabs[i - 1] && tabEl(tabs.tabs[i - 1].value)
  const next = tabs.tabs[i + 1] && tabEl(tabs.tabs[i + 1].value)
  let to = i
  if (prev && center < prev.offsetLeft + prev.offsetWidth / 2) to = i - 1
  else if (next && center > next.offsetLeft + next.offsetWidth / 2) to = i + 1
  if (to !== i) {
    flip(() => tabs.move(i, to), d.v)
    void nextTick(() => { const n = tabEl(d.v); if (n && drag.value) drag.value.offset = left - n.offsetLeft })
  }
}
async function onPointerUp(e: PointerEvent) {
  const d = drag.value
  endDrag()
  if (!d || !d.moved) return
  suppressClick = true
  setTimeout(() => { suppressClick = false }, 0)
  // 拖到页签条上下 40px 以外松手:放回原位(§4)
  const r = rootRef.value?.getBoundingClientRect()
  if (r && (e.clientY < r.top - 40 || e.clientY > r.bottom + 40)) {
    const now = tabs.tabs.findIndex(t => t.value === d.v)
    if (now !== d.from) flip(() => tabs.move(now, d.from), '')
  }
  // 松手:从手上的位置 120ms 落进空位。等 Vue 先把拖动时的 transform 摘掉,再从手上的位置起跳 ——
  // 反过来的话 Vue 摘样式那一下会把刚起的过渡掐断。
  await nextTick()
  const el = tabEl(d.v)
  if (el && d.offset) {
    el.style.transition = 'none'
    el.style.transform = `translateX(${d.offset}px)`
    void el.offsetWidth
    el.style.transition = 'transform var(--dur-fast) var(--ease-out)'
    el.style.transform = ''
  }
}
function endDrag() {
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointercancel', endDrag)
  drag.value = null
}
const dragStyle = (v: string) =>
  drag.value?.moved && drag.value.v === v ? { transform: `translateX(${drag.value.offset}px)`, transition: 'none' } : undefined
</script>

<template>
  <div ref="rootRef" class="fp-tabstrip" @mouseleave="frozenW = null">
    <div ref="inRef" class="fp-tabs-in">
      <TransitionGroup name="fp-tabgrow">
        <div
          v-for="(t, i) in tabs.tabs"
          :key="t.value"
          :data-tabv="t.value"
          role="tab"
          :aria-selected="t.value === activeValue"
          class="fp-tab"
          :class="{
            on: t.value === activeValue,
            pn: t.pinned,
            lift: drag?.moved && drag.v === t.value,
            nosep: noSep(i),
          }"
          :style="[{ '--w': (t.pinned ? TAB.PIN : tabW) + 'px' }, dragStyle(t.value)]"
          :aria-label="titleOf(t.value)"
          @click="selectTab(t.value)"
          @mousedown.middle.prevent
          @auxclick="onAux($event, t.value)"
          @contextmenu="onContext($event, t.value)"
          @mouseenter="onEnter($event, t.value)"
          @mouseleave="onLeaveTab"
          @pointerdown="onPointerDown($event, t.value)"
        >
          <span class="bg" />
          <template v-if="t.value === activeValue"><i class="fl l" /><i class="fl r" /></template>
          <span class="fp-tab-ic">
            <component :is="iconFor(tabMeta(t.value)?.icon ?? '')" :size="t.pinned ? 16 : 14" />
          </span>
          <span v-if="!t.pinned" class="fp-tab-label">{{ titleOf(t.value) }}</span>
          <!-- 固定钮:只在触屏渲染(桌面 DOM 不变)。触屏没有双击语义、右键菜单也不是触屏手势,
               它是触屏上唯一的固定入口(§6.3)。桌面的双击/右键入口原样保留。 -->
          <button
            v-if="showPin(t)"
            type="button"
            class="fp-tab-pin"
            :class="{ on: t.pinned }"
            :aria-label="t.pinned ? '取消固定页签' : '固定页签'"
            :aria-pressed="!!t.pinned"
            @click.stop="t.pinned ? tabs.unpin(t.value) : tabs.pin(t.value)"
          >
            <Pin :size="13" />
          </button>
          <button
            v-if="showX(t)"
            type="button"
            class="fp-tab-x"
            aria-label="关闭页签"
            @click.stop="closeTab(t.value, true)"
          >
            <X :size="14" />
          </button>
        </div>
      </TransitionGroup>
      <ShellTip title="新建页签">
        <button type="button" class="fp-tab-new" aria-label="新建页签" @click="newTab()">
          <Plus :size="16" />
        </button>
      </ShellTip>
    </div>
    <div v-if="overflow" class="fp-tabs-fade" />

    <span ref="listBtnRef" class="fp-tab-listw">
      <ShellTip title="全部页签" align="end" :disabled="listOpen">
        <button type="button" class="fp-tab-list" :class="{ open: listOpen }" aria-label="全部页签" @click="toggleList">
          <span v-if="overflow" class="n">{{ tabs.tabs.length }}</span>
          <ChevronDown :size="16" />
        </button>
      </ShellTip>
    </span>

    <!-- 悬停卡片 -->
    <div v-if="card" class="fp-tab-card" :style="{ left: card.left + 'px' }" role="tooltip">
      <div class="t">{{ tabMeta(card.v)?.page }}</div>
      <div v-if="ctxOf(card.v)" class="m">{{ ctxOf(card.v) }}</div>
      <div v-if="PAGE[card.v]" class="m2">
        <component :is="iconFor(PAGE[card.v].layerIcon)" :size="14" />
        {{ PAGE[card.v].layerLabel }}<template v-if="PAGE[card.v].group"> · {{ PAGE[card.v].group }}</template>
      </div>
    </div>

    <!-- 全部页签 -->
    <div v-if="listOpen" ref="listRef" class="fp-tablist-pop">
      <label class="fp-tablist-in">
        <Search :size="15" />
        <input v-model="listQuery" placeholder="搜索已打开的页签" />
      </label>
      <div class="fp-tablist-hd">已打开 · {{ tabs.tabs.length }}</div>
      <div
        v-for="t in listRows"
        :key="t.value"
        class="fp-tablist-row"
        :class="{ on: t.value === activeValue }"
        @click="selectTab(t.value)"
      >
        <component :is="iconFor(tabMeta(t.value)?.icon ?? '')" :size="15" />
        <span class="nm">{{ tabMeta(t.value)?.page }}</span>
        <span class="r">{{ ctxOf(t.value) }}</span>
        <button v-if="t.value !== HOME" type="button" class="x" aria-label="关闭" @click.stop="closeTab(t.value)">
          <X :size="13" />
        </button>
      </div>
      <template v-if="recentClosed.length">
        <div class="fp-tablist-hd">最近关闭</div>
        <div v-for="v in recentClosed" :key="'c-' + v" class="fp-tablist-row closed" @click="reopen(v)">
          <component :is="iconFor(tabMeta(v)?.icon ?? '')" :size="15" />
          <span class="nm">{{ tabMeta(v)?.page }}</span>
        </div>
      </template>
    </div>

    <!-- 右键菜单:挂 body,按鼠标位置摆 -->
    <Teleport to="body">
      <div
        v-if="menu"
        ref="menuRef"
        class="fp-tab-menu"
        role="menu"
        :style="{ left: menu.x + 'px', top: menu.y + 'px' }"
      >
        <template v-for="(it, j) in menuItems" :key="j">
          <div v-if="it.k === '-'" class="sep" />
          <button
            v-else
            type="button"
            role="menuitem"
            class="row"
            :disabled="it.off"
            @click="runMenu(it.k)"
          >
            {{ it.label }}<span v-if="it.note" class="k">{{ it.note }}</span>
          </button>
        </template>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.fp-tabstrip {
  position: relative;
  flex: 0 0 auto;
  display: flex;
  align-items: flex-end;
  height: 44px;
  padding: 0 8px;
  background: var(--surface-sunken);
  box-sizing: border-box;
}

/* 页签区:放不下就横向滚(隐藏滚动条);+ 跟在最后一个页签后面 */
.fp-tabs-in {
  flex: 0 1 auto;
  min-width: 0;
  height: 100%;
  display: flex;
  align-items: flex-end;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
}
.fp-tabs-in::-webkit-scrollbar { display: none; }
.fp-tabs-fade {
  position: absolute;
  top: 0;
  bottom: 0;
  right: 56px;
  width: 40px;
  pointer-events: none;
  background: linear-gradient(90deg, transparent, var(--surface-sunken));
}

.fp-tab {
  position: relative;
  flex: 0 0 var(--w);
  width: var(--w);
  max-width: var(--w);
  height: 36px;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 7px 0 12px;
  font-size: var(--fs-label);
  color: var(--text-secondary);
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
  touch-action: pan-x;
}
.fp-tab.pn { padding: 0; justify-content: center; }
/* 悬停:内缩 3px 的浅灰圆角底(§3.1) */
.fp-tab .bg {
  position: absolute;
  inset: 3px 3px 5px;
  border-radius: 8px;
  background: transparent;
  transition: background var(--dur-fast) var(--ease-standard);
}
.fp-tab:hover .bg { background: color-mix(in srgb, var(--ink-900) 6%, transparent); }
.fp-tab > :not(.bg):not(.fl) { position: relative; }
/* 相邻页签之间的细竖线;挨着当前 / 悬停 / 被拖的那个两侧不画 */
.fp-tab::before {
  content: "";
  position: absolute;
  left: 0;
  top: 10px;
  width: 1px;
  height: 16px;
  background: var(--ink-100);
}
.fp-tab.nosep::before { display: none; }

/* 当前页签:白底,上圆角 10,底边两侧外翻,和下面白色顶栏连成一块 */
.fp-tab.on {
  background: var(--surface-white);
  border-radius: 10px 10px 0 0;
  color: var(--text-primary);
  font-weight: var(--fw-medium);
  z-index: 2;
}
.fp-tab.on .bg { display: none; }
.fl { position: absolute; bottom: 0; width: 10px; height: 10px; pointer-events: none; }
.fl.l { left: -10px; background: radial-gradient(circle at 0 0, transparent 9.5px, var(--surface-white) 10px); }
.fl.r { right: -10px; background: radial-gradient(circle at 100% 0, transparent 9.5px, var(--surface-white) 10px); }

/* 拖着的:白底浮起(§4) */
.fp-tab.lift {
  background: var(--surface-white);
  border-radius: 10px;
  box-shadow: 0 6px 18px rgba(28, 28, 28, 0.18);
  color: var(--text-primary);
  z-index: 5;
  cursor: grabbing;
}
.fp-tab.lift .bg, .fp-tab.lift .fl { display: none; }

.fp-tab-ic { flex: 0 0 auto; display: inline-flex; color: var(--text-muted); }
.fp-tab.on .fp-tab-ic, .fp-tab.lift .fp-tab-ic, .fp-tab:hover .fp-tab-ic { color: var(--text-primary); }
.fp-tab-label {
  flex: 1 1 auto;
  min-width: 0;
  line-height: 20px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.fp-tab-x {
  flex: 0 0 auto;
  width: 20px;
  height: 20px;
  margin-left: auto;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  display: grid;
  place-items: center;
}
.fp-tab-x:hover { background: var(--ink-100); color: var(--text-primary); }
/* 触屏专属的固定钮(§6.3):只在 isTouch 时渲染,所以这里不需要媒体查询再藏一次。
   固定中的签实心一档,和 × 一样弱化但可达(§6.1「可半透明弱化,不可不可达」)。 */
.fp-tab-pin {
  flex: 0 0 auto;
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  display: grid;
  place-items: center;
  opacity: 0.55;
}
.fp-tab-pin.on { opacity: 1; color: var(--text-primary); }
/* 触屏无 hover:× 常显(RESPONSIVE-LAYOUT-SPEC §6.1),非激活签才关得掉 */
@media (hover: none) {
  .fp-tab-x { opacity: 0.55; }
  .fp-tab.on .fp-tab-x { opacity: 1; }
  /* 固定签只有 44px:图标 16 + 固定钮 20 + 间距 8 = 44 正好顶满,收到 2 才留得出左右各 3 */
  .fp-tab.pn { gap: 2px; }
}

/* 新建 / 关闭:宽度 0 ↔ 到位,120ms(§8) */
.fp-tabgrow-enter-active, .fp-tabgrow-leave-active {
  transition: max-width var(--dur-fast) var(--ease-out), flex-basis var(--dur-fast) var(--ease-out), padding var(--dur-fast) var(--ease-out);
  overflow: hidden;
}
.fp-tabgrow-enter-from, .fp-tabgrow-leave-to { max-width: 0; flex-basis: 0; padding-left: 0; padding-right: 0; }

.fp-tab-new, .fp-tab-list {
  flex: 0 0 auto;
  height: 28px;
  min-width: 28px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  transition: background var(--dur-fast), color var(--dur-fast);
}
.fp-tab-new { margin: 0 0 4px 4px; }
.fp-tab-new:hover, .fp-tab-list:hover, .fp-tab-list.open { background: color-mix(in srgb, var(--ink-900) 6%, transparent); color: var(--text-primary); }
.fp-tab-listw { margin: 0 0 4px auto; flex: 0 0 auto; display: inline-flex; }
.fp-tab-list { padding: 0 6px; font-family: var(--font-mono); font-size: var(--fs-label); font-weight: var(--fw-semibold); }

/* 悬停卡片(§3.3) */
.fp-tab-card {
  position: absolute;
  top: 44px;
  z-index: var(--z-popover);
  width: 280px;
  padding: 12px 14px;
  background: var(--surface-raised);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-pop);
  pointer-events: none;
  animation: fp-pop-in var(--dur-fast) var(--ease-out);
}
.fp-tab-card .t { font-size: var(--fs-body); font-weight: var(--fw-semibold); color: var(--text-primary); }
.fp-tab-card .m { font-size: var(--fs-label); color: var(--text-muted); margin-top: 3px; }
.fp-tab-card .m2 {
  display: flex; align-items: center; gap: 6px;
  margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--divider);
  font-size: var(--fs-label); color: var(--text-secondary);
}

/* 全部页签(§3.5) */
.fp-tablist-pop {
  position: absolute;
  top: 43px;
  right: 6px;
  z-index: var(--z-popover);
  width: min(340px, 92vw);
  max-height: 60vh;
  overflow-y: auto;
  padding: 8px;
  background: var(--surface-raised);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-pop);
  animation: fp-pop-in var(--dur-fast) var(--ease-out);
}
.fp-tablist-in {
  display: flex; align-items: center; gap: 8px;
  height: 36px; padding: 0 10px;
  border: 1px solid var(--border-control); border-radius: 8px;
  background: var(--surface-card); color: var(--text-muted);
}
.fp-tablist-in input {
  flex: 1; min-width: 0; border: none; outline: none; background: transparent;
  font-family: var(--font-sans); font-size: var(--fs-body); color: var(--text-primary);
}
.fp-tablist-hd { padding: 10px 8px 4px; font-size: var(--fs-label); color: var(--text-muted); }
.fp-tablist-row {
  display: flex; align-items: center; gap: 10px;
  height: 36px; padding: 0 8px; border-radius: 8px;
  font-size: var(--fs-body); color: var(--text-primary); cursor: pointer;
}
.fp-tablist-row:hover { background: var(--bg-hover); }
.fp-tablist-row.on { background: var(--row-selected-raised); }   /* 同命令面板选中行 */
.fp-tablist-row.closed .nm { color: var(--text-secondary); }
.fp-tablist-row .nm { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fp-tablist-row .r { font-size: var(--fs-label); color: var(--text-muted); white-space: nowrap; }
.fp-tablist-row .x {
  width: 22px; height: 22px; flex: 0 0 auto;
  border: none; border-radius: 6px; background: transparent; color: var(--text-muted);
  cursor: pointer; display: none; place-items: center;
}
.fp-tablist-row:hover .x { display: grid; }
.fp-tablist-row .x:hover { background: var(--ink-100); color: var(--text-primary); }
</style>

<style>
/* 右键菜单挂在 body 上,不带 scoped(§3.4) */
.fp-tab-menu {
  position: fixed;
  z-index: var(--z-popover);
  width: 248px;
  padding: 6px;
  background: var(--surface-raised);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-pop);
  animation: fp-pop-in var(--dur-fast) var(--ease-out);
}
.fp-tab-menu .row {
  width: 100%; height: 34px; padding: 0 10px;
  display: flex; align-items: center;
  border: none; border-radius: 8px; background: transparent;
  font-family: var(--font-sans); font-size: var(--fs-body); color: var(--text-primary);
  text-align: left; cursor: pointer; white-space: nowrap;
}
.fp-tab-menu .row:hover:not(:disabled) { background: var(--bg-hover); }
.fp-tab-menu .row:disabled { color: var(--text-disabled); cursor: default; }
.fp-tab-menu .row .k { margin-left: auto; font-size: var(--fs-label); color: var(--text-muted); }
.fp-tab-menu .sep { height: 1px; margin: 6px 4px; background: var(--divider); }
</style>
