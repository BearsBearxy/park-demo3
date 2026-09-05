<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import { useUiStore } from '@/stores/ui'
import { usePresenceStore } from '@/stores/presence'
import { useTabsStore } from '@/stores/tabs'
import { fpBuildRoutes } from '@/nav/fpNav'
import { NAV_SCOPE_PREFIX } from '@/utils/lockScopes'
import { useViewport } from '@/composables/useViewport'
import IconRail from '@/components/shell/IconRail.vue'
import SidebarPanel from '@/components/shell/SidebarPanel.vue'
import TabStrip from '@/components/shell/TabStrip.vue'
import Toolbar from '@/components/shell/Toolbar.vue'
import { defineAsyncComponent } from 'vue'
// 手机三件套懒加载(size-check 门禁:index 预算 185KB,静态引入把它压破到 197.3——
// 桌面用户永远用不到的代码不该进首屏包,FPApprovalDrawer 同一条铁律)。
// 「容器尺寸挂载即终态」靠模板里的定高占位壳保证:壳首帧就把 52/56px(+safe-area)
// 钉死,异步块到达后在壳内填充,内容区不重新量高——零位移与包体两全。
// ⚠ 占位壳高度公式必须与组件自身的 height 逐字一致(MobileTopBar.vue:48 /
//   MobileBottomNav.vue:49),改一边必须同步另一边。
const MobileTopBar = defineAsyncComponent(() => import('@/components/shell/mobile/MobileTopBar.vue'))
const MobileBottomNav = defineAsyncComponent(() => import('@/components/shell/mobile/MobileBottomNav.vue'))
const MobileNavDrawer = defineAsyncComponent(() => import('@/components/shell/mobile/MobileNavDrawer.vue'))
// 命令面板同一条铁律:Ctrl-K 才用得上的覆盖层,不该让每个人首屏都下载它。
// 必须配下面的 v-if 才真省(defineAsyncComponent 是渲染时才拉块的);
// 组件里那个 reset+autofocus 的 watch 因此加了 immediate —— 它现在是带着 open=true 挂载的。
const CommandPalette = defineAsyncComponent(() => import('@/components/shell/CommandPalette.vue'))

const ui = useUiStore()
const reloadPage = () => window.location.reload()

// ── 档位(RESPONSIVE-LAYOUT-SPEC §3/§4)──
// 只用来切四周铬边;主内容(.fp-content 及 slot)永不因档位卸载——
// 外壳从不卸载是加载零位移的前提(LAYOUT-STABILITY §7.3)。
const { tier } = useViewport()

// ── L/M 浮层侧栏(spec §3.2)──
// 窄档内联展开会把主卡压得比不展开更糟,展开是「临时看一眼导航」:
// 面板改贴轨浮层,无遮罩,点外关/Esc 关走 closeTransient(不写 fp-app-sb,
// 不污染用户的宽屏偏好)。XL 档保持内联,一个像素不动。
const floatEl = ref<HTMLElement | null>(null)
const floatActive = computed(() => tier.value !== 'xl' && tier.value !== 's' && ui.sbOpen)

// 点外关:UI-OVERLAY-SPEC 的 capture mousedown 写法。
function onDocMousedown(e: MouseEvent) {
  if (!floatActive.value) return
  const t = e.target instanceof Element ? e.target : null
  if (!t || floatEl.value?.contains(t)) return
  // 折叠触发钮必须排除:capture mousedown 先关面板,click 再 toggleSidebar 会立即重开
  // (开关竞态,spec §3.2)。Toolbar 不在本组件手里,按 aria-label 认钮。
  if (t.closest('button[aria-label="折叠侧边栏"]')) return
  ui.closeTransient()
}
onMounted(() => document.addEventListener('mousedown', onDocMousedown, true))
onUnmounted(() => document.removeEventListener('mousedown', onDocMousedown, true))

// ── S 档手机壳(spec §4.1)──
const mnavOpen = ref(false)
// 首次打开才挂抽屉(懒 chunk 的 v-if 门,见模板注释);之后保持挂载走进出场动效
const mnavEverOpened = ref(false)
watch(mnavOpen, (v) => { if (v) mnavEverOpened.value = true })

const paletteOpen = ref(false)
const paletteEverOpened = ref(false)
watch(paletteOpen, (v) => { if (v) paletteEverOpened.value = true })
const paletteMode = ref<'jump' | 'new'>('jump')

function openPalette(mode: 'jump' | 'new' = 'jump') {
  paletteMode.value = mode
  paletteOpen.value = true
}

function onGlobalKey(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault()
    if (paletteOpen.value) {
      paletteOpen.value = false
    } else {
      openPalette('jump')
    }
  }
  // 浮层侧栏 Esc 关(spec §3.2,同样不落盘);命令面板开着时 Esc 归它,别一键双关
  if (e.key === 'Escape' && floatActive.value && !paletteOpen.value) ui.closeTransient()
}

onMounted(() => window.addEventListener('keydown', onGlobalKey))
onUnmounted(() => window.removeEventListener('keydown', onGlobalKey))

// ── 在场(PRESENCE §02) ──
// 全站唯一的轮询挂在外壳上:登录后一直跑,浏览态也发 —— 顶栏头像组靠它。
// 「在哪一屏」直接取面包屑那两段,不必让 20 个屏各自登记一次。
const route = useRoute()
const presence = usePresenceStore()
watch(() => route.path, () => {
  const m = route.meta as Record<string, string>
  const label = [m.layerLabel, m.page].filter(Boolean).join(' · ')
  presence.enter(null, label || null)
}, { immediate: true })
onUnmounted(() => presence.stop())

// 预览槽被顶掉的提示(§4.3)。**只在被顶的那屏本人正在编辑时出** —— 其余情况静默:
// 预览槽本来就是「随手看一眼」的槽,每换一次屏都吭一声等于把提示训练成噪音。
// 载体不用 FPToast(它没有动作按钮),复用本文件 .fp-net-toast 的位置与深色语言。
const tabs = useTabsStore()
const ROUTES = fpBuildRoutes()
const evictValue = ref('')
const evictMsg = computed(() => (evictValue.value ? `「${ROUTES[evictValue.value]?.page ?? evictValue.value}」预览页签已被替换` : ''))
let evictTimer: ReturnType<typeof setTimeout> | null = null
watch(() => tabs.evicted, (v) => {
  if (!v) return
  tabs.clearEvicted()
  if (!presence.holdsEditUnder(NAV_SCOPE_PREFIX[v])) return
  evictValue.value = v
  if (evictTimer) clearTimeout(evictTimer)
  evictTimer = setTimeout(() => { evictValue.value = '' }, 4000)
})
function pinEvicted() {
  if (evictTimer) clearTimeout(evictTimer)
  tabs.pin(evictValue.value)
  evictValue.value = ''
}
onUnmounted(() => { if (evictTimer) clearTimeout(evictTimer) })

// 浮层里点条目导航成功后收起(与 MobileNavDrawer「点条目后关抽屉」同义——
// 「看一眼」到点中目标即结束;SidebarPanel 不在本组件手里,以路由变化为信号)
watch(() => route.path, () => { if (floatActive.value) ui.closeTransient() })
</script>

<template>
  <!-- root stage: flex row, padding 12px, gap 12px -->
  <div class="fp-stage">
    <!-- nav card: IconRail + optional vertical divider + optional SidebarPanel。
         S 档整卡不渲染(铬边不是内容,可卸载);L/M 档面板改浮层,只有 XL 内联 -->
    <div v-if="tier !== 's'" class="fp-nav-card">
      <IconRail @open-command="openPalette('jump')" />
      <template v-if="ui.sbOpen && tier === 'xl'">
        <!-- vertical divider: only shown when sidebar is open -->
        <div class="fp-vdiv" />
        <!-- SidebarPanel: only shown when sidebar is open -->
        <SidebarPanel />
      </template>
    </div>

    <!-- L/M 浮层侧栏:挂 stage 不挂 .fp-nav-card——nav 卡 overflow:hidden 会裁掉它(spec §3.2 暗礁①) -->
    <div v-if="floatActive" ref="floatEl" class="fp-sb-float">
      <SidebarPanel />
    </div>

    <!-- main card: TabStrip → Toolbar → content -->
    <div class="fp-main-card">
      <!-- 导航进度条:chunk 下载完才 confirm 导航,这条是那段空窗里唯一的反馈(DESIGN-FIDELITY §6.5) -->
      <div v-if="ui.navigating" class="fp-nav-bar" aria-hidden="true" />
      <template v-if="tier !== 's'">
        <TabStrip @open-command="openPalette($event as 'jump' | 'new')" />
        <Toolbar @open-command="openPalette($event as 'jump' | 'new')" />
      </template>
      <!-- S 档换手机顶栏(§4.1);tabs store 照常运转,只是不渲染 TabStrip。
           定高占位壳:异步组件到达前高度已终态,内容区首帧即不再变(见 script 注释) -->
      <div v-else class="fp-mtb-slot"><MobileTopBar @open-drawer="mnavOpen = true" @open-command="openPalette('jump')" /></div>
      <!-- content area:永不进 v-if——档位切换只换四周铬边(LAYOUT-STABILITY §7.3) -->
      <main class="fp-content">
        <slot />
      </main>
      <div v-if="tier === 's'" class="fp-mbn-slot"><MobileBottomNav /></div>
    </div>
  </div>

  <!-- 抽屉是点按才出现的覆盖层,chunk 推迟到首次打开(FPApprovalDrawer 同款:
       defineAsyncComponent + 外层 v-if,首开多一拍加载换首屏不背它) -->
  <MobileNavDrawer v-if="tier === 's' && mnavEverOpened" :open="mnavOpen" @close="mnavOpen = false" />

  <CommandPalette
    v-if="paletteEverOpened"
    :open="paletteOpen"
    :mode="paletteMode"
    @close="paletteOpen = false"
  />

  <!-- 全局网络错误 toast(读路径加载失败的兜底提示,8s 自动消失) -->
  <Teleport to="body">
    <div v-if="ui.netError" class="fp-net-toast" role="alert">
      <span class="msg">{{ ui.netError }}</span>
      <button class="act" @click="reloadPage">刷新</button>
      <button class="act ghost" @click="ui.dismissNetError()">×</button>
    </div>
    <div v-if="evictMsg" class="fp-net-toast fp-evict-toast" :class="{ stacked: !!ui.netError }" role="alert">
      <span class="msg">{{ evictMsg }}</span>
      <button class="act" @click="pinEvicted">固定它</button>
      <button class="act ghost" @click="evictValue = ''">×</button>
    </div>
  </Teleport>
</template>

<style scoped>
.fp-stage {
  display: flex;
  height: 100%;
  overflow: hidden;
  padding: 12px;
  gap: 12px;
  box-sizing: border-box;
  /* L/M 浮层侧栏的定位参照(spec §3.2)。
     旧 T3 全局地板(min-width:960px,spec 2026-07-12)已由 RESPONSIVE-LAYOUT-SPEC §8
     的屏级地板取代:横滚下沉到 .fp-content 内部(base.css M↓ 块),外壳各档完整可用。 */
  position: relative;
}

/* ── 全局网络错误 toast ── */
.fp-net-toast { position:fixed; left:50%; bottom:28px; transform:translateX(-50%); z-index:400;
  display:flex; align-items:center; gap:10px; max-width:min(560px,90vw); padding:10px 14px;
  background:var(--ink-900); color:#fff; border-radius:var(--radius-md); box-shadow:0 12px 32px rgba(28,28,28,.32); font-size:13px; }
.fp-net-toast .msg { min-width:0; }
.fp-net-toast .act { flex:0 0 auto; height:26px; padding:0 10px; border:1px solid rgba(255,255,255,.35); border-radius:var(--radius-sm);
  background:transparent; color:#fff; font-size:12px; cursor:pointer; }
.fp-net-toast .act:hover { background:rgba(255,255,255,.14); }
.fp-net-toast .act.ghost { border-color:transparent; padding:0 6px; }

/* 被顶提示复用上面那套深色语言与位置;两条同时在场时它上移一格,不叠字。 */
.fp-evict-toast.stacked { bottom: 84px; }

/* ── nav card ── */
.fp-nav-card {
  flex: 0 0 auto;
  height: 100%;
  background: var(--surface-white);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-2xl);
  overflow: hidden;
  display: flex;
  flex-direction: row;
}

/* vertical divider: 1px border-subtle */
.fp-vdiv {
  flex: 0 0 1px;
  width: 1px;
  background: var(--border-subtle);
}

/* ── L/M 浮层侧栏(spec §3.2) ── */
/* 窄档内联展开在 1000px 视口会把主卡压到 663px,比不展开更糟——展开是临时看导航,
   贴轨盖在内容上,无遮罩(popover 档,不是模态)。 */
.fp-sb-float {
  position: absolute;
  top: 12px;
  bottom: 12px;
  left: calc(12px + 68px + 4px); /* stage padding + 轨卡(66 轨 + 2 边框) + 4 间隙 */
  z-index: var(--z-popover);
  display: flex;
  background: var(--surface-white);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-2xl);
  box-shadow: var(--shadow-pop);
  overflow: hidden;
}

/* ── main card ── */
.fp-main-card {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--surface-white);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-2xl);
  overflow: hidden;
  /* 给进度条做定位参照;已有 overflow:hidden,绝对定位子元素会被裁进圆角内 */
  position: relative;
}

/* ── 导航进度条 ── */
/* 绝对定位而非 flex 子项:作为兄弟节点插进这个 column flex 会把 TabStrip 整体下推 2px,
   出现/消失各抖一次 —— 正是 DESIGN-FIDELITY §6.4 禁止的布局位移。 */
.fp-nav-bar {
  position: absolute; top: 0; left: 0; right: 0; height: 2px;
  z-index: 20; /* P4 z-index 令牌化时改成 var(--z-sticky) */
  overflow: hidden;
  pointer-events: none;
}
/* 不定长进度:导航时长不可预估,用往返滑块表示「在动」而非表示进度百分比 */
.fp-nav-bar::after {
  content: ''; position: absolute; top: 0; bottom: 0; width: 36%;
  background: var(--hue-blue);
  animation: fp-nav-slide 1.1s ease-in-out infinite;
}
@keyframes fp-nav-slide {
  from { left: -36%; }
  to   { left: 100%; }
}

/* content area */
.fp-content {
  flex: 1;
  overflow-y: auto;
  scrollbar-gutter: stable both-edges;
  padding: 24px;
  box-sizing: border-box;
}

/* M 档铬边收窄(RESPONSIVE-LAYOUT-SPEC §3.3)。宽档规则在窄档之前,靠层叠覆盖 */
@media (max-width: 960px) { /* M↓ */
  .fp-stage { padding: 8px; gap: 8px; }
  .fp-sb-float { top: 8px; bottom: 8px; left: calc(8px + 68px + 4px); }
  /* overflow-x:auto 承接 §8 屏级地板:横滚发生在内容区内部,外壳完整可用 */
  .fp-content { padding: 16px; overflow-x: auto; }
}

/* S 档手机壳(RESPONSIVE-LAYOUT-SPEC §4.1):放弃「画布上浮卡片」隐喻,内容通栏 */
@media (max-width: 600px) { /* S */
  .fp-stage { padding: 0; gap: 0; }
  .fp-main-card { border: none; border-radius: 0; }
  /* toast 抬到底栏之上(§4.5):56px 底栏 + 20px 呼吸 + safe-area,不被底栏遮住 */
  .fp-net-toast { bottom: calc(56px + 20px + env(safe-area-inset-bottom)); }
  /* @media 不加特异度:桌面那条 .fp-evict-toast.stacked{84px} 在 S 档照样赢,
     而底下这条已经抬到 76px+safe —— 两块各高约 46px,只差 8px 就压字。这里跟着抬。 */
  .fp-evict-toast.stacked { bottom: calc(56px + 76px + env(safe-area-inset-bottom)); }
}
/* 手机栏的定高占位壳:异步 chunk 到达前高度即终态,内容区不因铬边迟到重新量高
   (LAYOUT-STABILITY 容器尺寸挂载即终态)。高度公式与组件自身 height 逐字同步:
   MobileTopBar.vue:48 / MobileBottomNav.vue:49——改一边必须同步另一边。 */
.fp-mtb-slot { flex: 0 0 auto; height: calc(52px + env(safe-area-inset-top)); }
.fp-mbn-slot { flex: 0 0 auto; height: calc(56px + env(safe-area-inset-bottom)); }
</style>
