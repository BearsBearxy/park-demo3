<script setup lang="ts">
// 首页 / 新标签页(TAB-BAR-SPEC §5)。同一个组件,两条路由:/home(登录后第一屏,固定页签)与 /newtab(点 + 开的)。
// 两者只差「点了一页之后」:首页上开在新页签(首页永远是首页),新标签页上这一格变成那一页 ——
// 这条规则在 tabs.open() 里判(看当前页签是不是首页),这里只管调 open + push。
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { X, Search } from 'lucide-vue-next'
import { useTabsStore } from '@/stores/tabs'
import { useFavoritesStore } from '@/stores/favorites'
import { useUiStore } from '@/stores/ui'
import { fpBuildRoutes } from '@/nav/fpNav'
import { iconFor } from '@/components/ds/icon'
import { BRAND } from '@/brand'

const route = useRoute()
const router = useRouter()
const tabs = useTabsStore()
const favs = useFavoritesStore()
const ui = useUiStore()
const ROUTES = fpBuildRoutes()

const isHome = computed(() => (route.meta as Record<string, unknown>).value === 'home')

function go(v: string) {
  tabs.open(v)
  router.push('/' + v)
}

const hint = computed(() => {
  const n = favs.list.length
  if (!n) return ''
  if (favs.seeded && n === 1) return '先放好了你最常用的一屏 · 在页面上点 ☆ 加更多'
  return `${n} 个 · 在页面上点 ☆ 加进来`
})

const recent = computed(() => tabs.recent.filter(v => ROUTES[v]))

// ── 格子拖动换序(HTML5 拖放;首页上的收藏不跟页签条共用那套跟手动效)──
const dragFrom = ref(-1)
const dragOver = ref(-1)
function onDragStart(i: number, e: DragEvent) {
  dragFrom.value = i
  e.dataTransfer?.setData('text/plain', String(i))
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}
function onDrop(i: number) {
  if (dragFrom.value >= 0) favs.move(dragFrom.value, i)
  dragFrom.value = -1
  dragOver.value = -1
}
function onDragEnd() { dragFrom.value = -1; dragOver.value = -1 }
</script>

<template>
  <!-- fp-fluid:自己会收成单列,不吃 M↓ 的 800px 屏级地板(base.css) -->
  <div class="hm fp-fluid" :data-mode="isHome ? 'home' : 'newtab'">
    <div class="hm-brand">
      <img src="@/assets/brand/logo.svg" width="36" height="36" alt="" />
      <span class="nm">{{ BRAND.name }}</span><span class="en">{{ BRAND.nameEn }}</span>
    </div>

    <button type="button" class="hm-search" @click="ui.requestPalette()">
      <Search :size="18" />
      <span>搜索页面 / 分组…</span>
      <kbd class="hm-kbd">Ctrl K</kbd>
    </button>

    <section class="hm-sec">
      <div class="hm-sh"><b>收藏</b><span v-if="hint" class="hm-hint">{{ hint }}</span></div>
      <div class="hm-tiles">
        <div
          v-for="(v, i) in favs.list"
          :key="v"
          class="hm-tile"
          :class="{ over: dragOver === i && dragFrom !== i, dragging: dragFrom === i }"
          role="button"
          tabindex="0"
          draggable="true"
          :title="ROUTES[v]?.page"
          @click="go(v)"
          @keydown.enter.self="go(v)"
          @dragstart="onDragStart(i, $event)"
          @dragover.prevent="dragOver = i"
          @dragleave="dragOver = dragOver === i ? -1 : dragOver"
          @drop.prevent="onDrop(i)"
          @dragend="onDragEnd"
        >
          <span class="ti"><component :is="iconFor(ROUTES[v]?.icon ?? '')" :size="20" /></span>
          <span class="tl">{{ ROUTES[v]?.page }}</span>
          <button type="button" class="tx" aria-label="取消收藏" title="取消收藏" @click.stop="favs.remove(v)">
            <X :size="13" />
          </button>
        </div>
        <div v-if="!favs.list.length" class="hm-empty">
          还没有收藏。<br>在任意页面点顶栏页面名后面的 ☆，就会出现在这里
        </div>
      </div>
    </section>

    <section v-if="recent.length" class="hm-sec hm-sec-rec">
      <div class="hm-sh"><b>最近打开</b></div>
      <div class="hm-rec">
        <button v-for="v in recent" :key="v" type="button" class="hm-rec-r" @click="go(v)">
          <span class="ri"><component :is="iconFor(ROUTES[v]?.icon ?? '')" :size="16" /></span>
          <span class="nm">{{ ROUTES[v]?.page }}</span>
          <span class="ly">{{ ROUTES[v]?.layerLabel }}</span>
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.hm {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 64px 24px 48px;
}
.hm-brand { display: flex; align-items: center; gap: 10px; }
.hm-brand .nm { font-size: var(--fs-h2); font-weight: var(--fw-semibold); color: var(--text-primary); }
.hm-brand .en { font-size: 16px; color: var(--text-muted); }

.hm-search {
  width: 600px;
  max-width: 100%;
  height: 48px;
  margin-top: 22px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 12px 0 18px;
  border-radius: var(--radius-full);
  border: 1px solid var(--border-control);
  background: var(--surface-card);
  color: var(--text-muted);
  font-family: var(--font-sans);
  font-size: 15px;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-standard);
}
.hm-search:hover { background: var(--bg-hover); }
.hm-search span { flex: 1; text-align: left; }
.hm-kbd {
  font-family: var(--font-sans);
  font-size: 11px;
  font-weight: var(--fw-semibold);
  color: var(--text-secondary);
  background: var(--surface-white);
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  padding: 2px 7px;
}

.hm-sec { width: 760px; max-width: 100%; margin-top: 36px; }
.hm-sec-rec { margin-top: 28px; }
.hm-sh { display: flex; align-items: baseline; gap: 10px; margin-bottom: 12px; }
.hm-sh b { font-size: 16px; font-weight: var(--fw-semibold); color: var(--text-primary); }
.hm-hint { font-size: 12px; color: var(--text-muted); }

.hm-tiles { display: grid; grid-template-columns: repeat(6, 1fr); gap: 12px; }
.hm-tile {
  position: relative;
  height: 104px;
  border-radius: var(--radius-lg);
  background: var(--surface-card);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 0 8px;
  font-size: 12px;
  color: var(--text-secondary);
  text-align: center;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-standard);
}
.hm-tile:hover { background: color-mix(in srgb, var(--ink-900) 4.05%, var(--surface-card)); }
.hm-tile.over { box-shadow: inset 0 0 0 2px var(--hue-blue); }
.hm-tile.dragging { opacity: .5; }
.hm-tile .ti {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: var(--surface-white);
  border: 1px solid var(--border-subtle);
  display: grid;
  place-items: center;
  color: var(--text-primary);
}
.hm-tile .tl { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hm-tile .tx {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 6px;
  display: grid;
  place-items: center;
  color: var(--text-muted);
  background: var(--surface-white);
  cursor: pointer;
  opacity: 0;
  transition: opacity var(--dur-fast);
}
.hm-tile:hover .tx, .hm-tile:focus-within .tx { opacity: 1; }
.hm-tile .tx:hover { color: var(--text-primary); background: var(--ink-100); }
@media (hover: none) { .hm-tile .tx { opacity: .55; } }

.hm-empty {
  grid-column: span 3;
  height: 104px;
  border-radius: var(--radius-lg);
  border: 1.5px dashed var(--ink-300);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 16px;
  font-size: 12px;
  line-height: 18px;
  color: var(--text-muted);
  text-align: center;
}

.hm-rec { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 16px; }
.hm-rec-r {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 44px;
  padding: 0 10px;
  border: none;
  border-radius: 10px;
  background: transparent;
  font-family: var(--font-sans);
  font-size: 14px;
  color: var(--text-primary);
  text-align: left;
  cursor: pointer;
}
.hm-rec-r:hover { background: var(--bg-hover); }
.hm-rec-r .ri {
  width: 30px;
  height: 30px;
  flex: 0 0 auto;
  border-radius: 8px;
  background: var(--surface-card);
  display: grid;
  place-items: center;
  color: var(--text-secondary);
}
.hm-rec-r .nm { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hm-rec-r .ly { font-size: 12px; color: var(--text-muted); white-space: nowrap; }

/* S 档(稿没画,按 RESPONSIVE-LAYOUT S 档规则收成单列):搜索框占满,收藏 3 列,最近打开 1 列 */
@media (max-width: 600px) { /* S */
  .hm { padding: 32px 16px 32px; }
  .hm-search { width: 100%; }
  .hm-tiles { grid-template-columns: repeat(3, 1fr); }
  .hm-rec { grid-template-columns: 1fr; }
  .hm-rec-r { min-height: 44px; }
}
</style>
