<script setup lang="ts">
// 顶栏在场头像组（PRESENCE 设计稿 §03）。
//
// ⚠ **宽度按满员算死**（5 头像 + 溢出位 = 130px）：一个人在线和六个人在线时工具条
//   不挪一个像素。LAYOUT-STABILITY-SPEC 的硬要求 —— 顶栏是全站最不该动的一条。
//
// 自己不进头像组（你知道自己在哪），只在浮层里置顶。
import { ref, computed } from 'vue'
import { usePresenceStore, type Seat } from '@/stores/presence'
import Avatar from '@/components/ds/Avatar.vue'
import Popover from '@/components/ds/Popover.vue'

const presence = usePresenceStore()
const open = ref(false)

const MAX = 5
const shown = computed(() => presence.others.slice(0, MAX))
const overflow = computed(() => Math.max(0, presence.others.length - MAX))
const editingCount = computed(() => presence.users.filter((u) => u.mode === 'edit').length)
/** 浮层里自己置顶 —— 「你」是定位锚点，先告诉他自己在哪，再看别人。 */
const rows = computed(() => [...presence.users].sort((a, b) => Number(b.self) - Number(a.self)))

/** 空闲：距上次心跳超过一拍半 —— 快掉线了，淡显但先别抹掉。 */
const fading = (u: Seat) => u.idleMs > 30_000
const stateText = (u: Seat) =>
  u.mode === 'edit' ? `编辑 ${mmss(u.sinceMs)}` : fading(u) ? '刚离开' : '浏览中'
function mmss(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}
</script>

<template>
  <Popover v-model="open" :width="296" align="end">
    <template #trigger>
      <button class="pb" type="button" :title="`在线 ${presence.users.length} 人`"
              @click="open = !open">
        <span class="pb-stack">
          <Avatar v-for="u in shown" :key="u.sid" :uid="u.user" :name="u.displayName" :size="24"
                  :class="['pb-av', u.mode === 'edit' ? 'edit' : 'view', { fade: fading(u) }]" />
          <span v-if="overflow" class="pb-more">+{{ overflow }}</span>
        </span>
      </button>
    </template>

    <div class="pp">
      <div class="pp-h">
        <b>在线 {{ presence.users.length }} 人</b>
        <span v-if="editingCount">· 其中 {{ editingCount }} 人在编辑</span>
      </div>
      <div v-for="u in rows" :key="u.sid" class="pp-row" :class="{ fade: fading(u) }">
        <Avatar :uid="u.user" :name="u.displayName" :size="26" />
        <div class="pp-nm">
          <div class="pp-n1">
            {{ u.displayName }}
            <span v-if="u.self" class="pp-you">你</span>
            <span v-else-if="u.role" class="pp-role">{{ u.role }}</span>
          </div>
          <div class="pp-n2">{{ u.label || '—' }}</div>
        </div>
        <span class="pp-st" :class="u.mode === 'edit' ? 'e' : 'v'">{{ stateText(u) }}</span>
      </div>
    </div>
  </Popover>
</template>

<style scoped>
/* 宽度写死 = 满员宽度。头像 24px、重叠 -7px：5 个 92px + 溢出位 17px + 内边距 20px = 129 → 130 */
.pb {
  width: 130px; height: 34px; box-sizing: border-box;
  display: flex; align-items: center; justify-content: flex-end;
  padding: 0 9px 0 11px;
  border: 1px solid var(--border-subtle); border-radius: var(--radius-full);
  background: var(--surface-white); cursor: pointer;
  transition: background var(--dur-fast) var(--ease-standard);
}
.pb:hover { background: var(--bg-hover); }
.pb-stack { display: flex; align-items: center; }
.pb-stack > :deep(*) { margin-left: -7px; }
.pb-stack > :deep(*:first-child) { margin-left: 0; }

/* 环即状态,不另加图标:橙环=正在某一期的编辑态,白环=浏览中,淡=快掉线了 */
.pb-av.view :deep(*), .pb-av.view { box-shadow: 0 0 0 2px var(--surface-white); }
.pb-av.edit { box-shadow: 0 0 0 2px var(--surface-white), 0 0 0 3.5px var(--hue-orange); }
.pb-av.fade { opacity: .5; }
.pb-more {
  display: inline-flex; align-items: center; justify-content: center;
  width: 24px; height: 24px; flex: 0 0 auto; border-radius: 50%;
  background: var(--surface-sunken); color: var(--text-muted);
  font-family: var(--font-mono); font-size: 10px; font-weight: var(--fw-semibold);
  box-shadow: 0 0 0 2px var(--surface-white);
}

.pp-h {
  display: flex; align-items: center; gap: 8px; padding: 11px 14px 9px;
  border-bottom: 1px solid var(--divider); font-size: var(--fs-label); color: var(--text-muted);
}
.pp-h b { color: var(--text-primary); font-weight: var(--fw-semibold); font-size: 12.5px; }
.pp-row { display: flex; align-items: center; gap: 10px; padding: 9px 14px; }
.pp-row + .pp-row { border-top: 1px solid rgba(28, 28, 28, .05); }
.pp-row:hover { background: var(--surface-card); }
.pp-row.fade { opacity: .6; }
.pp-nm { flex: 1; min-width: 0; }
.pp-n1 { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: var(--fw-medium); white-space: nowrap; }
.pp-n2 {
  font-size: 11.5px; color: var(--text-muted); margin-top: 1px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.pp-role {
  font-size: 10px; color: var(--text-muted); border: 1px solid var(--border-subtle);
  border-radius: var(--radius-full); padding: 0 6px; line-height: 15px; font-weight: var(--fw-regular);
}
.pp-you {
  font-size: 10px; background: var(--ink-900); color: #fff;
  border-radius: var(--radius-full); padding: 0 6px; line-height: 15px; font-weight: var(--fw-semibold);
}
.pp-st { flex: 0 0 auto; font-size: 11px; font-family: var(--font-mono); white-space: nowrap; }
.pp-st.e { color: var(--hue-orange); font-weight: var(--fw-semibold); }
.pp-st.v { color: var(--text-disabled); }
</style>
