<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { LogOut, Sparkles, SunMoon } from 'lucide-vue-next'
import { useUpdateStore } from '@/stores/update'
import { APPEARANCE_OPTIONS, useAppearanceStore } from '@/stores/appearance'
import { fpFindLayer, type NavLayer } from '@/nav/fpNav'
import { visibleLayers } from '@/nav/navAccess'
import { useTabsStore } from '@/stores/tabs'
import { useAuthStore } from '@/stores/auth'
import { iconFor } from '@/components/ds/icon'
import Avatar from '@/components/ds/Avatar.vue'
import Popover from '@/components/ds/Popover.vue'
import { BRAND_TITLE } from '@/brand'
import { personNick } from '@/utils/personNick'
import ShellTip from '@/components/shell/ShellTip.vue'

const emit = defineEmits<{ 'open-command': [] }>()

const route = useRoute()
const router = useRouter()

// 当前账号菜单:头像接登录态(原为写死「周明」),点开显示账号+角色,可退出登录
const auth = useAuthStore()
// 版本更新:想知道「现在是哪个版本」的人会先点头像,所以版本号写在这张菜单里(SPEC §1)
const upd = useUpdateStore()
// 外观三选一(DARK-MODE-SPEC §3):点一下立刻生效,菜单不关(Popover 只在点外面时关)
const appearance = useAppearanceStore()
// 头像:账号菜单按它的位置贴上去(见下)
const userBtn = ref<HTMLElement | null>(null)

// 账号菜单贴在头像上方,用 fixed:导航卡 .fp-nav-card 为了裁圆角是 overflow:hidden,
// 侧栏收成浮层(L / M 档)时卡只剩 66 宽的图标栏,absolute 的 200 宽菜单会被裁掉只剩左边一截(2026-09-20 用户截图)。
const userMenuOpen = ref(false)
const userMenuStyle = ref<Record<string, string>>({})
watch(userMenuOpen, (open) => {
  if (!open || !userBtn.value) return
  const r = userBtn.value.getBoundingClientRect()
  userMenuStyle.value = { position: 'fixed', top: 'auto', left: `${r.left}px`, bottom: `${window.innerHeight - r.top + 8}px` }
})

function onLogout() {
  auth.logout()
  router.push('/login')
}

// ponytail: activeLayer derived from route — no store needed in this task
const activeLayer = computed(() =>
  fpFindLayer((route.meta as Record<string, string>).value ?? '')
)

// 导航层可见性按角色的 navLayers,不按权限点(读全开:看不到入口 ≠ 进不去)
const layers = computed(() => visibleLayers(auth.navLayers, auth.can('system:view')))

// 点当前层什么都不做(§4.1):它既不换屏也不该把当前层首页重置成全新实例。
const tabsStore = useTabsStore()
function goLayer(layer: NavLayer) {
  if (layer.id === activeLayer.value.id) return
  tabsStore.openFresh(layer.home)
  router.push('/' + layer.home)
}
</script>

<template>
  <div class="fp-rail">
    <!-- brand mark: 40×40 radius 13 white bg hairline -->
    <div class="fp-rail-mark">
      <img src="@/assets/brand/logo.svg" width="22" height="22" :alt="BRAND_TITLE" />
    </div>

    <!-- separator: 30×1px margin 9/7 -->
    <div class="fp-railsep" />

    <!-- layer buttons -->
    <button
      v-for="layer in layers"
      :key="layer.id"
      class="fp-rail-btn"
      :class="{ on: layer.id === activeLayer.id }"
      @click="goLayer(layer)"
    >
      <component :is="iconFor(layer.icon)" :size="20" />
      <span>{{ layer.short }}</span>
    </button>

    <!-- footer: margin-top auto -->
    <div class="fp-rail-foot">
      <!-- command button: emits open-command for Task 6 to wire -->
      <ShellTip title="搜索页面" kbd="Ctrl K" sub="和顶栏的搜索框是同一个" align="start" up>
        <button class="fp-rail-cmd" aria-label="搜索 / 跳转" @click="emit('open-command')">
          <component :is="iconFor('command')" :size="16" />
        </button>
      </ShellTip>
      <!-- 账号菜单:向上弹(头像在屏幕左下角,默认向下会出屏) -->
      <Popover v-model="userMenuOpen" :width="200" :style="userMenuStyle">
        <template #trigger>
          <button ref="userBtn" class="fp-rail-user" :title="auth.displayName ?? '未登录'" aria-label="当前账号">
            <Avatar :name="auth.displayName ?? '—'" :text="personNick(auth.displayName)" :size="32" />
          </button>
        </template>
        <div class="fp-user-menu">
          <div class="fp-user-name">{{ auth.displayName ?? '未登录' }}</div>
          <div class="fp-user-role" :title="auth.roleLabel" :class="{ ro: auth.isReadonly }">{{ auth.roleLabel }}</div>
          <div class="fp-user-sep" />
          <div class="fp-user-appr">
            <div class="h"><SunMoon :size="14" />外观</div>
            <div class="fp-appr-seg" role="radiogroup" aria-label="外观">
              <button
                v-for="o in APPEARANCE_OPTIONS" :key="o.value" type="button" role="radio"
                :aria-checked="appearance.shown === o.value" :class="{ on: appearance.shown === o.value }"
                @click="appearance.set(o.value)"
              >{{ o.label }}</button>
            </div>
          </div>
          <div class="fp-user-sep" />
          <button class="fp-user-row" @click="upd.openHistory()">
            <Sparkles :size="14" />版本更新
            <span class="ver">v{{ upd.version }}<span v-if="upd.unread" class="dot" /></span>
          </button>
          <button class="fp-user-logout" @click="onLogout">
            <LogOut :size="14" />退出登录
          </button>
        </div>
      </Popover>
    </div>
  </div>
</template>

<style scoped>
.fp-rail {
  width: 66px;
  flex: 0 0 66px;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 14px 9px;
  gap: 5px;
  box-sizing: border-box;
  background: var(--surface-sunken);
}

.fp-rail-mark {
  width: 40px;
  height: 40px;
  border-radius: 13px;
  background: var(--surface-white);
  border: 1px solid var(--border-subtle);
  display: grid;
  place-items: center;
  flex: 0 0 auto;
}

.fp-rail-mark img {
  display: block;
}

.fp-railsep {
  width: 30px;
  height: 1px;
  background: var(--border-subtle);
  margin: 9px 0 7px;
  flex: 0 0 auto;
}

.fp-rail-btn {
  width: 48px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  border-radius: 15px;
  cursor: pointer;
  padding: 9px 0 7px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  font-family: var(--font-sans);
  font-size: 10.5px;
  font-weight: var(--fw-medium);
  flex: 0 0 auto;
  transition:
    color var(--dur-fast) var(--ease-standard),
    background var(--dur-fast) var(--ease-standard),
    box-shadow var(--dur-fast) var(--ease-standard);
}

.fp-rail-btn:hover {
  background: var(--ink-050);
  color: var(--text-secondary);
}

/* C2-04 按压:常态透明、hover 5% 灰 —— filter 在这两种底上都不可见,所以压底色。
   0ms 按下(不让人等),松开随上面那条 120 回弹;.on 是黑底常亮,不压。 */
.fp-rail-btn:active:not(.on) {
  background: var(--ink-100);
  transition-duration: 0ms;
}

/* 当前层 = 实底:暗色下反过来成亮底深字(--control-solid-text,不是 --text-on-solid) */
.fp-rail-btn.on,
.fp-rail-btn.on:hover {
  background: var(--control-solid);
  color: var(--control-solid-text);
  box-shadow: 0 6px 16px rgba(28, 28, 28, 0.2);
}

.fp-rail-foot {
  margin-top: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 11px;
  padding-top: 10px;
}

.fp-rail-cmd {
  width: 40px;
  height: 40px;
  border-radius: 13px;
  border: 1px solid var(--border-control);
  background: var(--surface-white);
  color: var(--text-secondary);
  cursor: pointer;
  display: grid;
  place-items: center;
  transition: background var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard);
}

.fp-rail-cmd:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

/* 账号菜单(头像触发,向上弹) */
.fp-rail-user { border: none; background: transparent; padding: 0; cursor: pointer; border-radius: 50%; display: grid; place-items: center; }
.fp-rail-user:hover { box-shadow: 0 0 0 3px color-mix(in srgb, var(--ink-900) 8%, transparent); }
.fp-user-menu { padding: 4px 6px; }
.fp-user-name { font-size: 13px; font-weight: var(--fw-semibold); color: var(--text-primary); }
/* 定上限 + 省略号:兼岗账号的真名是顿号拼的(「财务主管、系统管理员」),不封顶会把整个账号浮层撑宽 */
.fp-user-role { display: inline-block; max-width: 176px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
                margin-top: 5px; font-size: 11px; color: var(--info-text-on-tint); background: var(--accent-blue); border-radius: var(--radius-full); padding: 2px 9px; }
/* 角色胶囊照稿 Main 第 1 节 .um-r:原 --fill-blue 字对自己的底只有 2.3:1(暗色 4.4:1),改写字用的蓝 + --accent-blue 底 */
.fp-user-role.ro { color: var(--hue-orange); background: rgba(239, 159, 39, 0.12); }
.fp-user-sep { height: 1px; background: var(--border-subtle); margin: 9px 0; }
/* 外观:标题一行 + 满宽三段段控(稿 Main 第 1 节 .um-appr / .segf);选中格 --surface-raised */
.fp-user-appr { padding: 4px 6px 2px; }
.fp-user-appr .h { display: flex; align-items: center; gap: 7px; font-size: 12.5px; color: var(--text-secondary); margin-bottom: 7px; }
.fp-appr-seg { display: flex; gap: 2px; padding: 3px; border-radius: var(--radius-full); background: var(--surface-sunken); }
.fp-appr-seg button { flex: 1; height: 24px; border: none; border-radius: var(--radius-full); background: transparent; color: var(--text-muted);
                      font-family: var(--font-sans); font-size: var(--fs-label); font-weight: var(--fw-medium); white-space: nowrap; cursor: pointer;
                      transition: background var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard); }
.fp-appr-seg button:hover:not(.on) { color: var(--text-secondary); }
.fp-appr-seg button.on { background: var(--surface-raised); color: var(--text-primary); box-shadow: var(--shadow-pill); }
/* 版本更新一行:和退出登录同一排版,右侧写当前版本号(等宽,未读时带蓝点) */
.fp-user-row { display: flex; align-items: center; gap: 7px; width: 100%; border: none; background: transparent; color: var(--text-secondary); font-family: var(--font-sans); font-size: 12.5px; padding: 7px 6px; border-radius: 8px; cursor: pointer; }
.fp-user-row:hover { background: var(--bg-hover); color: var(--text-primary); }
.fp-user-row .ver { margin-left: auto; display: inline-flex; align-items: center; gap: 6px; font-family: var(--font-mono); font-size: var(--fs-micro); color: var(--text-muted); }
.fp-user-row .dot { width: 7px; height: 7px; border-radius: var(--radius-full); background: var(--hue-blue); }
.fp-user-logout { display: flex; align-items: center; gap: 7px; width: 100%; border: none; background: transparent; color: var(--text-secondary); font-family: var(--font-sans); font-size: 12.5px; padding: 7px 6px; border-radius: 8px; cursor: pointer; }
.fp-user-logout:hover { background: var(--bg-hover); color: var(--hue-red); }
</style>
