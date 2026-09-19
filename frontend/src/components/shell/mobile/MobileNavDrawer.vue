<script setup lang="ts">
// 手机导航抽屉(S 档,RESPONSIVE-LAYOUT-SPEC §4.2):IconRail(层切换+账号菜单)、
// SidebarPanel(目录)与页签模型(最近打开)在手机上的合体。
// 导航语义分开走,与桌面各自的同类入口保持一致:
//   层/目录条目 = openFresh(全新状态);最近打开 = open(页签还开着就恢复 KeepAlive 现场)。
//   ⚠ 手机上只留「首页 + 固定的 + 正在编辑的 + 当前这一页」(TAB-BAR-SPEC §2 手机),
//     换走的屏当场卸载 —— 在手机上点回去、后退回去,除了这几格都是重新打开。
import { computed, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { LogOut, Sparkles, SunMoon } from 'lucide-vue-next'
import { useUpdateStore } from '@/stores/update'
import { APPEARANCE_OPTIONS, useAppearanceStore } from '@/stores/appearance'
import { fpFindLayer, type NavLayer } from '@/nav/fpNav'
import { visibleLayers } from '@/nav/navAccess'
import { buildAllPages } from '@/components/shell/paletteFilter'
import { useTabsStore } from '@/stores/tabs'
import { useAuthStore } from '@/stores/auth'
import { iconFor } from '@/components/ds/icon'
import Avatar from '@/components/ds/Avatar.vue'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const route = useRoute()
const router = useRouter()
const tabs = useTabsStore()
const auth = useAuthStore()

// 与 IconRail 同口径:按角色 navLayers 过滤,'system' 层跟 system:view 走
const layers = computed(() => visibleLayers(auth.navLayers, auth.can('system:view')))

// 当前屏属不可见层时(读全开,深链能进)不展开那一层的目录,退回第一个可见层(SidebarPanel 同款兜底)
const activeLayer = computed(() => {
  const L = fpFindLayer((route.meta as Record<string, string>).value ?? '')
  return layers.value.includes(L) ? L : (layers.value[0] ?? L)
})
const activeValue = computed(() => (route.meta as Record<string, string>).value ?? '')

// 最近打开:与命令面板同口径 —— 不可见层的屏不进列表
const allPages = computed(() => buildAllPages(auth.navLayers, auth.can('system:view')))
const recentItems = computed(() =>
  tabs.recent
    .map(v => allPages.value.find(p => p.value === v))
    .filter((p): p is NonNullable<typeof p> => p != null)
    .slice(0, 8)
)

// 层切换段与 IconRail 同义(换层 = 全新),点当前层不动;抽屉不关(用户可能还要在层内挑屏)。
// ⚠ guard 比的是**不带兜底**的当前层(与 IconRail / 底栏同源)。用上面那个 activeLayer 的话,
// 当前屏属不可见层时它已经退回 layers[0] —— 股东从书签进 /ledger,抽屉里唯一那颗胶囊
// 既高亮又点不动(整期复查实测)。
function goLayer(layer: NavLayer) {
  if (layer.id === fpFindLayer(activeValue.value).id) return
  tabs.openFresh(layer.home)
  router.push('/' + layer.home)
}

// 目录条目与桌面侧栏同义:恢复现场(§4.1)。触屏没有修饰键,不做 Shift。
function goItem(value: string) {
  if (value !== activeValue.value) {
    tabs.open(value)
    router.push('/' + value)
  }
  emit('close')
}

// 最近打开是页签的化身,继承页签的恢复语义(CommandPalette recent 同义)——
// 走 openFresh 会 epoch++ 把用户填到一半的表单丢掉(规范 §4.2 明文)
function goRecent(value: string) {
  tabs.open(value)
  router.push('/' + value)
  emit('close')
}

// 账号段照抄 IconRail 头像菜单:S 档不渲染 IconRail,这是全站唯一退出入口

function onLogout() {
  auth.logout()
  router.push('/login')
}

// 版本更新:开「更新记录」并收起抽屉(与点条目后关抽屉同义——看一眼到点中目标即结束)
const upd = useUpdateStore()
// 外观(DARK-MODE-SPEC §3):同桌面账号菜单,点一下立刻生效,抽屉不关
const appearance = useAppearanceStore()
function openUpdates() {
  upd.openHistory()
  emit('close')
}

// Esc 关。不进 FPDrawer 的抽屉栈:本抽屉打开时遮罩盖住铃铛/搜索,
// 与其他模态层不会同时存在,栈机制在这里是空转。
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.open) emit('close')
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <Teleport to="body">
    <Transition name="mnav">
      <div v-if="open" class="mnav-backdrop" @mousedown="emit('close')">
        <aside class="mnav" role="dialog" aria-modal="true" aria-label="导航" @mousedown.stop>
          <div class="mnav-scroll">
            <!-- ① 层切换(IconRail 同口径) -->
            <div class="mnav-layers">
              <button
                v-for="layer in layers"
                :key="layer.id"
                class="mnav-pill"
                :class="{ on: layer.id === activeLayer.id }"
                @click="goLayer(layer)"
              >
                <component :is="iconFor(layer.icon)" :size="16" />{{ layer.short }}
              </button>
            </div>
            <div class="mnav-div" />
            <!-- ② 当前层目录(fpNav 同源,与桌面 SidebarPanel 1:1) -->
            <template v-for="(sec, si) in activeLayer.sections" :key="si">
              <div v-if="sec.title" class="mnav-sec">{{ sec.title }}</div>
              <button
                v-for="it in sec.items"
                :key="it.value"
                class="mnav-row"
                :class="{ on: it.value === activeValue }"
                @click="goItem(it.value)"
              >
                <span class="ic"><component :is="iconFor(it.icon)" :size="16" /></span>
                <span class="nm">{{ it.label }}</span>
              </button>
            </template>
            <!-- ③ 最近打开(页签模型在手机的化身) -->
            <template v-if="recentItems.length">
              <div class="mnav-div" />
              <div class="mnav-sec">最近打开</div>
              <button
                v-for="p in recentItems"
                :key="p.value"
                class="mnav-row mnav-recent"
                @click="goRecent(p.value)"
              >
                <span class="ic"><component :is="iconFor(p.icon)" :size="16" /></span>
                <span class="nm">{{ p.label }}</span>
                <span class="ly">{{ p.layerLabel }}</span>
              </button>
            </template>
          </div>
          <!-- ④ 版本更新(手机顶栏放不下第四个按钮,入口在这里;SPEC §1) -->
          <div class="mnav-ver">
            <!-- 外观在「版本更新」上面一行,段控高 44,三格都点得着(稿 Mobile / Main 第 1 节) -->
            <div class="mnav-appr">
              <span class="ic"><SunMoon :size="16" /></span>
              <span class="nm">外观</span>
              <div class="mnav-appr-seg" role="radiogroup" aria-label="外观">
                <button
                  v-for="o in APPEARANCE_OPTIONS" :key="o.value" type="button" role="radio"
                  :aria-checked="appearance.shown === o.value" :class="{ on: appearance.shown === o.value }"
                  @click="appearance.set(o.value)"
                >{{ o.label }}</button>
              </div>
            </div>
            <button class="mnav-row" :class="{ unread: upd.unread }" @click="openUpdates">
              <span class="ic"><Sparkles :size="16" /></span>
              <span class="nm">版本更新</span>
              <span class="ver">v{{ upd.version }}<span v-if="upd.unread" class="dot" /></span>
            </button>
          </div>
          <!-- ⑤ 账号段(IconRail 头像菜单内容) -->
          <div class="mnav-user">
            <Avatar :name="auth.displayName ?? '—'" :size="36" />
            <div class="mnav-user-txt">
              <div class="nm">{{ auth.displayName ?? '未登录' }}</div>
              <div class="role" :title="auth.roleLabel" :class="{ ro: auth.isReadonly }">{{ auth.roleLabel }}</div>
            </div>
            <button class="mnav-logout" @click="onLogout">
              <LogOut :size="16" />退出登录
            </button>
          </div>
        </aside>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* 带遮罩即模态档(--z-modal),不得用 popover 档 —— PAGE-BEHAVIOR-SPEC §3 */
.mnav-backdrop {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  background: var(--scrim);
}

.mnav {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: min(320px, 85vw);
  display: flex;
  flex-direction: column;
  background: var(--surface-raised);   /* 抽屉是浮起来的面(稿 Mobile) */
  box-shadow: var(--shadow-pop);
  box-sizing: border-box;
  /* safe-area 由面板自身 padding 承接(规范 §10) */
  padding-top: env(safe-area-inset-top);
  padding-bottom: env(safe-area-inset-bottom);
}

.mnav-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.mnav-layers {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 2px 2px 8px;
}

/* 触达 ≥44(规范 §6.2) */
.mnav-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 44px;
  padding: 0 14px;
  border-radius: var(--radius-full);
  border: 1px solid var(--border-control);
  background: var(--surface-white);
  color: var(--text-secondary);
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: var(--fw-medium);
  cursor: pointer;
}
/* 当前层 = 实底,同桌面图标栏:暗色下亮底深字 */
.mnav-pill.on {
  background: var(--control-solid);
  border-color: var(--control-solid);
  color: var(--control-solid-text);
}

/* full-bleed 分隔线:margin 抵消父级 padding(SidebarPanel 同款) */
.mnav-div {
  height: 1px;
  flex: 0 0 auto;
  background: var(--divider);
  margin: 8px -12px;
}

.mnav-sec {
  font: var(--type-label);
  color: var(--text-muted);
  padding: 8px 10px 2px;
}

.mnav-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  padding: 0 10px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  font-family: var(--font-sans);
  font-size: var(--fs-body);
  font-weight: var(--fw-medium);
  text-align: left;
  width: 100%;
  cursor: pointer;
}
.mnav-row:active { background: var(--bg-hover); }
.mnav-row.on { background: var(--bg-hover); color: var(--text-primary); }
.mnav-row .ic { display: inline-flex; flex: 0 0 auto; }
.mnav-row .nm {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mnav-row .ly {
  flex: 0 0 auto;
  font-size: var(--fs-micro);
  color: var(--text-muted);
}

/* 版本更新一行:夹在目录与账号之间,自带上分隔线;未读时浅蓝底 + 蓝点 */
.mnav-ver {
  flex: 0 0 auto;
  padding: 4px 12px;
  border-top: 1px solid var(--divider);
}
.mnav-row.unread { background: var(--accent-slate); color: var(--text-primary); }
.mnav-appr {
  display: flex; align-items: center; gap: 10px; min-height: 52px; padding: 0 10px;
  color: var(--text-secondary); font-size: var(--fs-body); font-weight: var(--fw-medium);
}
.mnav-appr .ic { display: inline-flex; flex: 0 0 auto; }
.mnav-appr-seg { display: flex; gap: 2px; height: 44px; margin-left: auto; padding: 3px; border-radius: var(--radius-full); background: var(--surface-sunken); }
.mnav-appr-seg button {
  padding: 0 12px; border: none; border-radius: var(--radius-full); background: transparent; color: var(--text-muted);
  font-family: var(--font-sans); font-size: var(--fs-body); font-weight: var(--fw-medium); white-space: nowrap; cursor: pointer;
}
.mnav-appr-seg button.on { background: var(--surface-raised); color: var(--text-primary); box-shadow: var(--shadow-pill); }
.mnav-row .ver {
  margin-left: auto; display: inline-flex; align-items: center; gap: 6px;
  font-family: var(--font-mono); font-size: var(--fs-label); font-weight: var(--fw-regular); color: var(--text-muted);
}
.mnav-row .ver .dot { width: 7px; height: 7px; border-radius: var(--radius-full); background: var(--hue-blue); }

.mnav-user {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px;
  border-top: 1px solid var(--divider);
}
.mnav-user-txt { flex: 1; min-width: 0; }
.mnav-user-txt .nm {
  font-size: 13px;
  font-weight: var(--fw-semibold);
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mnav-user-txt .role {
  display: inline-block;
  /* 同 IconRail:兼岗真名顿号拼,不封顶会顶开抽屉里的用户块 */
  max-width: 176px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-top: 3px;
  font-size: 11px;
  color: var(--info-text-on-tint);   /* 同 IconRail 角色胶囊(稿 Mobile .role) */
  background: var(--accent-blue);
  border-radius: var(--radius-full);
  padding: 2px 9px;
}
.mnav-user-txt .role.ro {
  color: var(--hue-orange);
  background: rgba(239, 159, 39, 0.12);
}
.mnav-logout {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 44px;
  padding: 0 12px;
  flex: 0 0 auto;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  font-family: var(--font-sans);
  font-size: 12.5px;
  cursor: pointer;
}
.mnav-logout:hover,
.mnav-logout:active { background: var(--bg-hover); color: var(--hue-red); }

/* 进出场:遮罩淡入,面板左滑入(tokens 的 --dur-base/--ease-out) */
.mnav-enter-active,
.mnav-leave-active { transition: opacity var(--dur-base) var(--ease-out); }
.mnav-enter-active .mnav,
.mnav-leave-active .mnav { transition: transform var(--dur-base) var(--ease-out); }
.mnav-enter-from,
.mnav-leave-to { opacity: 0; }
.mnav-enter-from .mnav,
.mnav-leave-to .mnav { transform: translateX(-100%); }

/* 减少动态效果:去位移只留淡入(时长压缩由 motion.css 全局兜底) */
@media (prefers-reduced-motion: reduce) {
  .mnav-enter-from .mnav,
  .mnav-leave-to .mnav { transform: none; }
}
</style>
