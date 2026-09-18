<script setup lang="ts">
// Toolbar — ported from shell.jsx .fp-toolbar / AppToolbar.
import { computed, ref, defineAsyncComponent, onBeforeUnmount, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { usePresenceStore } from '@/stores/presence'
import { useAuthStore } from '@/stores/auth'
// ponytail: 铃铛抽屉懒加载。Toolbar 在外壳里是**急切**的,静态 import 会把这个抽屉
// 连同它的 CSS 一起压进首屏 index 块 —— 而它只在点铃铛时才出现。
// ⚠ 必须配下面的 v-if 才真省:defineAsyncComponent 是**渲染时**才拉块的,
//   常挂在树上(只靠 :open=false)等于没懒。
// FPDrawer 内部本来就是 `v-if="open"` 且没有过渡,外层再包一层 v-if 视觉上一模一样;
// 它那个 Esc 栈用的是 `{ immediate: true }` 的 watch + onBeforeUnmount,挂卸载都接得住。
const FPApprovalDrawer = defineAsyncComponent(() => import('@/components/fp/FPApprovalDrawer.vue'))
import { useUiStore } from '@/stores/ui'
import { useTabsStore } from '@/stores/tabs'
import IconButton from '@/components/ds/IconButton.vue'
import FPPresenceBar from '@/components/fp/FPPresenceBar.vue'
import { PanelLeft, Star, Search, History, Bell, Sparkles } from 'lucide-vue-next'
import { useUpdateStore } from '@/stores/update'
import { useFavoritesStore, MAX_FAVS } from '@/stores/favorites'
import { fpBuildRoutes, fpFindLayer } from '@/nav/fpNav'
import ShellTip from '@/components/shell/ShellTip.vue'

const emit = defineEmits<{ 'open-command': [] }>()

// C1-07 ③:命令面板是懒加载块(AppShell 的 defineAsyncComponent),首开要等 chunk 到。
// 不加指示器 —— 把「等」挪到用户按下之前:鼠标划到搜索钮 / Tab 聚到它时就开始拉。
// import() 有模块缓存,重复调用无成本;chunk 本身不进 index。
function prefetchPalette() {
  void import('@/components/shell/CommandPalette.vue')
}

const route = useRoute()
const ui = useUiStore()

// ── 待批授权(设计稿 §07 F-3) ──
// Bell 从此有事做了 —— 它此前是顶栏四个死按钮之一(收藏 / 主题 / 操作记录 / 通知);2026-09-03 主题钮删除,死按钮清零
// (收藏 2026-09-18 起是真收藏,见下面 ☆ 一段)。
const presence = usePresenceStore()
const auth = useAuthStore()
const router = useRouter()
const inbox = ref(false)
/**
 * 铃铛红点 = 三件要我处理的事的总和(§7.4 通知行):
 *   等我批的授权 + 等我审的键 + 我交的表被退回。
 * 三个数都顺同一条 ping 回来;抽屉里分三段列出来,红点只给一个总数 ——
 * 分三个红点会让顶栏出现三个几乎一样的点,没人分得清哪个是哪个。
 */
const pendingCount = computed(() =>
  presence.approvals.length + presence.pendingReviews + presence.myReturned)

// ── 版本更新(VERSION-UPDATE-SPEC §1) ──
// 蓝点 = 有没看过的更新,不写数字;红色数字留给「要我处理的事」(上面那颗)。
// 贴法与铃铛红点同款:absolute 贴在定尺寸按钮上,出现与消失都不挪顶栏。
const upd = useUpdateStore()

const meta = computed(() => route.meta as Record<string, string>)
const crumbGroup = computed(() => meta.value.layerLabel ?? '')
const crumbPage  = computed(() => meta.value.page ?? '')

const tabs = useTabsStore()
const activeValue = computed(() => meta.value.value ?? '')
/** 首页 / 新标签页:面包屑只写页名,不出期间与 ☆(TAB-BAR-SPEC §5.6)。 */
const homeLike = computed(() => activeValue.value === 'home' || activeValue.value === 'newtab')

// ── 面包屑第一段(TAB-BAR-SPEC §6.2):不在这一层第一屏时能点,点了当前页签回第一屏 ──
const ROUTES = fpBuildRoutes()
const layerHome = computed(() => fpFindLayer(activeValue.value).home)
const crumbLink = computed(() => !homeLike.value && !!activeValue.value && activeValue.value !== layerHome.value)
const crumbTip = computed(() => `回到 ${crumbGroup.value} · ${ROUTES[layerHome.value]?.page ?? ''}`)
function goLayerHome() {
  if (!crumbLink.value) return
  tabs.open(layerHome.value)
  router.push('/' + layerHome.value)
}

// ── ☆ 收藏(TAB-BAR-SPEC §6.3)。2026-09-18 前它是「把预览页签钉成常驻」,预览槽取消后改成收藏 ──
const favs = useFavoritesStore()
const starred = computed(() => favs.has(activeValue.value))
/** ☆ 下方的深色提示条:'added' = 已收藏(带撤销);'full' = 满了。4 秒后、或换了屏就收起。 */
const starNote = ref<'added' | 'full' | null>(null)
/** 刚收藏的是哪一屏 —— 撤销撤它,不撤「现在停在哪」。 */
let starredV = ''
let starTimer: ReturnType<typeof setTimeout> | undefined
function toggleStar() {
  const r = favs.toggle(activeValue.value)
  clearTimeout(starTimer)
  starredV = activeValue.value
  starNote.value = r === 'added' || r === 'full' ? r : null
  if (starNote.value) starTimer = setTimeout(() => { starNote.value = null }, 4000)
}
function undoStar() {
  clearTimeout(starTimer)
  favs.remove(starredV)
  starNote.value = null
}
watch(activeValue, () => { clearTimeout(starTimer); starNote.value = null })
onBeforeUnmount(() => clearTimeout(starTimer))

// 上下文 chip:面包屑后面的常驻预留位(§6)。无期显「—」而不是 v-if ——
// 一进一出会把它右边的东西推着走,LAYOUT-STABILITY §1 铁律禁止。
const ctxText = computed(() => {
  const c = tabs.ctx[activeValue.value]
  return [c?.p, c?.coName].filter(Boolean).join(' · ') || '—'
})
</script>

<template>
  <header class="fp-toolbar">
    <ShellTip title="收起导航" sub="左边的导航收起来，表格能多看几列" align="start">
      <IconButton aria-label="折叠侧边栏" @click="ui.toggleSidebar()">
        <PanelLeft :size="16" />
      </IconButton>
    </ShellTip>

    <!-- breadcrumb:第一段 = 层名。不在这一层第一屏时是按钮,点了回第一屏(§6.2) -->
    <span class="fp-crumb">
      <template v-if="homeLike">
        <span class="fp-crumb-page">{{ crumbPage }}</span>
      </template>
      <template v-else>
        <ShellTip v-if="crumbLink" :title="crumbTip" align="start">
          <button type="button" class="fp-crumb-grp lk" @click="goLayerHome">{{ crumbGroup }}</button>
        </ShellTip>
        <span v-else class="fp-crumb-grp">{{ crumbGroup }}</span>
        <span class="fp-crumb-sep">/</span>
        <span class="fp-crumb-page">{{ crumbPage }}</span>
      </template>
    </span>
    <template v-if="!homeLike">
      <ShellTip title="这一页现在看的是哪一期、哪家公司" align="start">
        <span class="fp-ctx-chip">{{ ctxText }}</span>
      </ShellTip>
      <!-- ☆ 收藏:和浏览器地址栏右边的星一个位置(§6.1) -->
      <span class="fp-star">
        <ShellTip :title="starred ? '取消收藏' : '收藏此页'" :sub="starred ? '' : '收藏后在「首页」上一点就到'">
          <IconButton :aria-label="starred ? '取消收藏' : '收藏此页'" :aria-pressed="String(starred)" @click="toggleStar">
            <Star :size="16" :class="{ 'fp-star-on': starred }" />
          </IconButton>
        </ShellTip>
        <span v-if="starNote" class="fp-star-note" role="status">
          <template v-if="starNote === 'added'">已收藏，在「首页」上能找到<button type="button" class="act" @click="undoStar">撤销</button></template>
          <template v-else>最多收藏 {{ MAX_FAVS }} 个，先在首页去掉几个</template>
        </span>
      </span>
    </template>

    <!-- right: search + utility icons -->
    <div class="fp-toolbar-right">
      <!-- 在场头像组(PRESENCE §03):右区最左,紧挨搜索框。宽度按满员算死,人数变化不挪版。 -->
      <FPPresenceBar />
      <!-- M 档收纳后文字与 kbd 藏进 CSS,说明气泡照样有(§3.3) -->
      <ShellTip title="搜索页面" kbd="Ctrl K" sub="输入页面名直接跳过去">
        <button class="fp-search-btn" aria-label="搜索页面 / 分组"
                @pointerenter="prefetchPalette"
                @focus="prefetchPalette"
                @click="emit('open-command')">
          <Search :size="15" />
          <span>搜索页面 / 分组…</span>
          <kbd class="fp-kbd">Ctrl K</kbd>
        </button>
      </ShellTip>
      <!-- 操作记录:SystemLogsView 早就写好了,此前只差这根线(需 system:view) -->
      <ShellTip v-if="auth.can('system:view')" title="操作记录" sub="谁在什么时候改了什么">
        <IconButton aria-label="操作记录" @click="router.push('/sys-logs')">
          <History :size="16" />
        </IconButton>
      </ShellTip>
      <!-- 版本更新:蓝点只表示「有没看过的更新」,看过就没有(同上一条的贴法) -->
      <span class="fp-upd">
        <ShellTip title="版本更新" :kbd="`v${upd.version}`" sub="这一版改了什么" align="end" :disabled="upd.coachOn">
          <IconButton aria-label="版本更新" @click="upd.openHistory()">
            <Sparkles :size="16" />
          </IconButton>
        </ShellTip>
        <span v-if="upd.unread" class="fp-upd-dot" />
        <!-- 看完「本次更新」后在这儿提示一次入口在哪,4 秒后自己收起 -->
        <span v-if="upd.coachOn" class="fp-upd-coach" role="status">更新记录随时在这里看</span>
      </span>
      <!-- 通知 = 待批授权。红点**只在有待批时出现**,position:absolute 贴在图标上 ——
           不改图标尺寸、不挪工具条。这是全站唯一允许「凭空出现」的标记:
           它贴在一个尺寸恒定的按钮上,出现与消失都不影响布局。 -->
      <span class="fp-bell">
        <ShellTip :title="pendingCount ? `待我处理 · ${pendingCount} 件` : '待我处理'" sub="等我批的授权、等我审的表、被退回的表" align="end">
          <IconButton aria-label="待批授权" @click="inbox = true">
            <Bell :size="16" />
          </IconButton>
        </ShellTip>
        <span v-if="pendingCount" class="fp-bell-dot">{{ pendingCount }}</span>
      </span>
    </div>
  </header>
  <FPApprovalDrawer v-if="inbox" :open="inbox" @close="inbox = false" />
</template>

<style scoped>
.fp-toolbar {
  height: 48px;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 16px;
  border-bottom: 1px solid var(--divider);
  background: var(--surface-overlay);
  backdrop-filter: blur(8px);
  box-sizing: border-box;
}

.fp-crumb {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-left: 6px;
  min-width: 0;
}
.fp-crumb-grp {
  font-size: var(--fs-body);
  color: var(--text-muted);
  white-space: nowrap;
}
/* 能点的第一段:深一档的字,悬停浅灰底 + 下划线(§6.2) */
button.fp-crumb-grp.lk {
  height: 26px;
  margin: 0 -6px;
  padding: 0 6px;
  border: none;
  border-radius: 6px;
  background: transparent;
  font-family: var(--font-sans);
  color: var(--text-secondary);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-standard);
}
button.fp-crumb-grp.lk:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
  text-decoration: underline;
  text-underline-offset: 3px;
  text-decoration-color: var(--ink-300);
}
.fp-crumb-sep {
  color: var(--text-disabled);
}
.fp-crumb-page {
  font-size: var(--fs-body);
  font-weight: var(--fw-medium);
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.fp-ctx-chip {
  flex: 0 0 132px;
  width: 132px;
  height: 22px;
  line-height: 22px;
  margin-left: 8px;
  padding: 0 8px;
  box-sizing: border-box;
  border-radius: var(--radius-sm);
  background: var(--surface-subtle);
  color: var(--text-muted);
  font-size: var(--fs-label);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.fp-star { position: relative; display: inline-flex; margin-left: -4px; }
.fp-star-on { fill: var(--hue-blue); color: var(--hue-blue); }
/* 收藏提示条:☆ 正下方,深底;和底部网络提示同一套颜色(§6.3)。贴附浮层,120ms 长出 */
.fp-star-note {
  position: absolute; top: calc(100% + 8px); left: -12px; z-index: var(--z-popover);
  display: inline-flex; align-items: center; gap: 10px;
  padding: 8px 12px; border-radius: var(--radius-md);
  background: var(--ink-900); color: #fff;
  font-size: var(--fs-label); line-height: 18px; white-space: nowrap;
  box-shadow: 0 12px 32px rgba(28, 28, 28, 0.32);
  animation: fp-pop-in var(--dur-fast) var(--ease-out);
}
.fp-star-note .act {
  height: 24px; padding: 0 9px;
  border: 1px solid rgba(255, 255, 255, 0.35); border-radius: var(--radius-sm);
  background: transparent; color: #fff; font-size: var(--fs-label); cursor: pointer;
}
.fp-star-note .act:hover { background: rgba(255, 255, 255, 0.14); }

.fp-toolbar-right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
}

.fp-search-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  padding: 0 8px 0 12px;
  border-radius: var(--radius-full);
  border: 1px solid var(--border-subtle);
  background: var(--surface-card);
  cursor: pointer;
  font-family: var(--font-sans);
  color: var(--text-muted);
  min-width: 200px;
  transition: background var(--dur-fast) var(--ease-standard);
}
.fp-search-btn:hover { background: var(--bg-hover); }
.fp-search-btn span {
  font-size: 13px;
  flex: 1;
  text-align: left;
}

.fp-upd { position: relative; display: inline-flex; }
.fp-upd-dot {
  position: absolute; top: 3px; right: 3px;
  width: 8px; height: 8px; border-radius: var(--radius-full);
  background: var(--hue-blue);
  box-shadow: 0 0 0 1.5px var(--surface-white);
  pointer-events: none;
}
/* 入口提示:贴附浮层,从按钮下方长出(motion.css 的 fp-pop-in,与下拉、账号菜单同规格)。
   绝对定位 + pointer-events:none —— 它只说一句话,不接管点击,也不挪顶栏。 */
.fp-upd-coach {
  position: absolute; top: calc(100% + 10px); right: -8px; z-index: var(--z-popover);
  padding: 7px 10px; border-radius: var(--radius-xs);
  background: rgb(40, 52, 66); color: #fff;
  font-size: var(--fs-label); line-height: 18px; white-space: nowrap;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.18);
  pointer-events: none;
  animation: fp-pop-in var(--dur-fast) var(--ease-out);
}
.fp-upd-coach::after {
  content: ""; position: absolute; top: -6px; right: 20px;
  border-left: 6px solid transparent; border-right: 6px solid transparent;
  border-bottom: 6px solid rgb(40, 52, 66);
}

.fp-bell { position: relative; display: inline-flex; }
.fp-bell-dot {
  position: absolute; top: 1px; right: 1px;
  min-width: 14px; height: 14px; padding: 0 3px;
  border-radius: var(--radius-full);
  background: var(--hue-red); color: #fff;
  font-family: var(--font-mono); font-size: 9.5px; font-weight: var(--fw-semibold);
  display: grid; place-items: center;
  box-shadow: 0 0 0 1.5px var(--surface-white);
  pointer-events: none;
}

.fp-kbd {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-family: var(--font-sans);
  font-size: 11px;
  font-weight: var(--fw-semibold);
  color: var(--text-secondary);
  background: var(--surface-white);
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  padding: 2px 7px;
}

/* M 档收纳（RESPONSIVE-LAYOUT-SPEC §3.3）：960 以下容不下 200px 搜索框。
   收成 40px 图标钮——占位文字与 Ctrl K 藏掉,提示转入按钮 title;
   面包屑只留屏名段,层名由图标轨高亮承担。
   各按钮在本档内尺寸恒定,铃铛红点仍 absolute 贴在定宽按钮上,机制不动。 */
@media (max-width: 960px) { /* M↓ */
  .fp-search-btn {
    min-width: 40px;
    width: 40px;
    padding: 0;
    justify-content: center;
  }
  .fp-search-btn span,
  .fp-search-btn .fp-kbd { display: none; }
  .fp-crumb-grp,
  .fp-crumb-sep { display: none; }
}
</style>
