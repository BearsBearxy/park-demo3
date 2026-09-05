<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { LogOut } from 'lucide-vue-next'
import { fpFindLayer, type NavLayer } from '@/nav/fpNav'
import { visibleLayers } from '@/nav/navAccess'
import { useTabsStore } from '@/stores/tabs'
import { useAuthStore } from '@/stores/auth'
import { iconFor } from '@/components/ds/icon'
import Avatar from '@/components/ds/Avatar.vue'
import Popover from '@/components/ds/Popover.vue'

const emit = defineEmits<{ 'open-command': [] }>()

const route = useRoute()
const router = useRouter()

// 当前账号菜单:头像接登录态(原为写死「周明」),点开显示账号+角色,可退出登录
const auth = useAuthStore()
const roleLabel = computed(() => (auth.isReadonly ? '只读账号' : '管理员(可写)'))
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
      <img src="@/assets/factory-park-mark.svg" width="22" height="22" alt="Factory Park" />
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
      <button class="fp-rail-cmd" aria-label="搜索 / 跳转" @click="emit('open-command')">
        <component :is="iconFor('command')" :size="16" />
      </button>
      <!-- 账号菜单:向上弹(头像在屏幕左下角,默认向下会出屏) -->
      <Popover :width="200" :style="{ top: 'auto', bottom: 'calc(100% + 8px)', left: '0' }">
        <template #trigger>
          <button class="fp-rail-user" :title="auth.displayName ?? '未登录'" aria-label="当前账号">
            <Avatar :name="auth.displayName ?? '—'" :size="32" />
          </button>
        </template>
        <div class="fp-user-menu">
          <div class="fp-user-name">{{ auth.displayName ?? '未登录' }}</div>
          <div class="fp-user-role" :class="{ ro: auth.isReadonly }">{{ roleLabel }}</div>
          <div class="fp-user-sep" />
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
  transition: color var(--dur-fast) var(--ease-standard);
}

.fp-rail-btn:hover {
  background: rgba(28, 28, 28, 0.05);
  color: var(--text-secondary);
}

.fp-rail-btn.on,
.fp-rail-btn.on:hover {
  background: var(--ink-900);
  color: #fff;
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
  border: 1px solid var(--border-subtle);
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
.fp-rail-user:hover { box-shadow: 0 0 0 3px rgba(28, 28, 28, 0.08); }
.fp-user-menu { padding: 4px 6px; }
.fp-user-name { font-size: 13px; font-weight: var(--fw-semibold); color: var(--text-primary); }
.fp-user-role { display: inline-block; margin-top: 5px; font-size: 11px; color: var(--fill-blue); background: rgba(55, 138, 221, 0.1); border-radius: var(--radius-full); padding: 2px 9px; }
.fp-user-role.ro { color: var(--hue-orange); background: rgba(239, 159, 39, 0.12); }
.fp-user-sep { height: 1px; background: var(--border-subtle); margin: 9px 0; }
.fp-user-logout { display: flex; align-items: center; gap: 7px; width: 100%; border: none; background: transparent; color: var(--text-secondary); font-family: var(--font-sans); font-size: 12.5px; padding: 7px 6px; border-radius: 8px; cursor: pointer; }
.fp-user-logout:hover { background: var(--bg-hover); color: var(--hue-red); }
</style>
