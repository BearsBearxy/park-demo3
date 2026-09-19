<script setup lang="ts">
// 「更新记录」——顶栏 ✦ / 账号菜单 / 手机抽屉 / 「本次更新」底部都开这里(VERSION-UPDATE-SPEC §4)。
// 左边版本列表,右边那一版的全部条目;尺寸固定,切版本只换右边。
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { CHANGELOG } from '@/changelog'
import { useUpdateStore } from '@/stores/update'
import { useTabsStore } from '@/stores/tabs'
import { X, ChevronRight, ChevronLeft } from 'lucide-vue-next'
import type { ReleaseItem } from '@/types/changelog'
import ReleaseFeatureCard from '@/components/shell/release/ReleaseFeatureCard.vue'

const emit = defineEmits<{ close: [] }>()

const upd = useUpdateStore()
const router = useRouter()
const tabs = useTabsStore()

const sel = ref(0)
const note = computed(() => CHANGELOG[sel.value])
const isCurrent = computed(() => note.value.version === upd.version)
/** 「新增 N 项」含重点卡那条(与「本次更新」弹窗同一个数);重点卡自己在上面单独一张,不再排进行里。 */
const addedCount = computed(() => note.value.added.length + (note.value.feature ? 1 : 0))

function go(item: ReleaseItem) {
  // 旧版本的条目不给跳:那时的屏可能已经改名或合并
  if (!item.to || !isCurrent.value) return
  emit('close')
  tabs.open(item.to)
  router.push('/' + item.to)
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') { e.preventDefault(); emit('close') }
}
onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <Teleport to="body">
    <div class="cl-scrim" @mousedown="emit('close')">
      <div class="cl" role="dialog" aria-modal="true" aria-label="更新记录" @mousedown.stop>
        <header class="cl-h">
          <!-- 返回只在「从本次更新进来」时给:别处进来的没有可返回的上一层,一个返回箭头会指向空处 -->
          <button v-if="upd.historyFromWhatsNew" class="cl-back" aria-label="返回" @click="emit('close')"><ChevronLeft :size="18" /></button>
          <span class="cl-t">更新记录</span>
          <button class="cl-x" aria-label="关闭" @click="emit('close')"><X :size="16" /></button>
        </header>

        <div class="cl-b">
          <!-- 左:版本列表(S 档变成顶部一排横滑胶囊) -->
          <nav class="cl-list" aria-label="版本">
            <button
              v-for="(n, i) in CHANGELOG"
              :key="n.version"
              class="cl-item"
              :class="{ on: i === sel }"
              @click="sel = i"
            >
              <span class="v">v{{ n.version }}<span v-if="n.version === upd.version && upd.unread" class="cl-new">新</span></span>
              <span class="dt">{{ n.date }}</span>
              <span class="hl">{{ n.headline }}</span>
            </button>
            <div class="cl-foot">当前版本 v{{ upd.version }}<br />更早的版本没有整理记录</div>
          </nav>

          <!-- 右:那一版改了什么 -->
          <section class="cl-detail">
            <div class="cl-vv">v{{ note.version }}<span v-if="isCurrent" class="cl-cur">当前版本</span></div>
            <div class="cl-m">{{ note.date }} 发布</div>
            <div class="cl-hl">{{ note.headline }}</div>
            <!-- 本版重点卡与配图:和「本次更新」弹窗同一张,关掉弹窗以后在这里还看得到;旧版本不给「去看看」 -->
            <ReleaseFeatureCard :note="note" :linkable="isCurrent" class="cl-feat" @go="go(note.feature!)" />

            <template v-if="addedCount">
              <div class="cl-sec"><span class="wn-chip add">新增</span><span class="n">{{ addedCount }} 项</span></div>
              <div v-for="it in note.added" :key="it.title" class="cl-row" :class="{ go: !!it.to && isCurrent }" @click="go(it)">
                <div class="tx"><div class="t">{{ it.title }}</div><div class="d">{{ it.desc }}</div></div>
                <span v-if="it.to && isCurrent" class="cl-lnk">{{ it.toLabel ?? '去看看' }}<ChevronRight :size="12" /></span>
              </div>
            </template>

            <template v-if="note.improved.length">
              <div class="cl-sec"><span class="wn-chip imp">改进</span><span class="n">{{ note.improved.length }} 项</span></div>
              <div v-for="it in note.improved" :key="it.title" class="cl-row" :class="{ go: !!it.to && isCurrent }" @click="go(it)">
                <div class="tx"><div class="t">{{ it.title }}</div><div class="d">{{ it.desc }}</div></div>
                <span v-if="it.to && isCurrent" class="cl-lnk">{{ it.toLabel ?? '去看看' }}<ChevronRight :size="12" /></span>
              </div>
            </template>

            <template v-if="note.fixed.length">
              <div class="cl-sec"><span class="wn-chip fix">修复</span><span class="n">{{ note.fixed.length }} 项</span></div>
              <div v-for="f in note.fixed" :key="f" class="cl-row"><div class="tx"><div class="d">{{ f }}</div></div></div>
            </template>
          </section>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.cl-scrim {
  position: fixed; inset: 0; z-index: var(--z-modal);
  background: var(--scrim); display: grid; place-items: center;
  opacity: 0; animation: fp-fade-in var(--dur-base) var(--ease-out) forwards;
}
.cl {
  width: min(760px, 94vw); height: min(620px, 88vh);
  display: flex; flex-direction: column;
  background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 16px;
  box-shadow: var(--shadow-dialog); overflow: hidden; font-family: var(--font-sans);
  animation: fp-rise-in var(--dur-base) var(--ease-out) both;
}
.cl-h { flex: 0 0 auto; height: 56px; display: flex; align-items: center; gap: 10px; padding: 0 14px 0 20px; border-bottom: 1px solid var(--divider); }
.cl-t { flex: 1; font-size: var(--fs-h3); font-weight: var(--fw-semibold); }
.cl-back { display: none; }   /* 桌面不需要返回:关掉就回到原处 */
.cl-x, .cl-back {
  width: 28px; height: 28px; flex: 0 0 auto; border: none; border-radius: var(--radius-sm); background: transparent;
  color: var(--text-secondary); cursor: pointer; place-items: center;
  transition: background var(--dur-fast) var(--ease-standard);
}
.cl-x { display: grid; }
.cl-x:hover, .cl-back:hover { background: var(--bg-hover); color: var(--text-primary); }

.cl-b { flex: 1; min-height: 0; display: flex; }
.cl-list {
  flex: 0 0 216px; display: flex; flex-direction: column; gap: 2px; padding: 10px;
  background: var(--surface-card); border-right: 1px solid var(--divider); overflow-y: auto;
}
/* align-items 必须写:<button> 在 Chrome 里默认把内容居中排,不写的话标题按自身宽度居中、两边撑出框(2026-09-19 用户截图) */
.cl-item {
  display: flex; flex-direction: column; align-items: stretch; text-align: left; width: 100%;
  padding: 9px 10px; border: none; border-radius: 9px; background: transparent; cursor: pointer;
  font-family: var(--font-sans); color: var(--text-primary);
  transition: background var(--dur-fast) var(--ease-standard);
}
.cl-item:hover { background: var(--bg-hover); }
.cl-item.on, .cl-item.on:hover { background: var(--surface-raised); box-shadow: var(--shadow-pill); }
.cl-item .v { display: flex; align-items: center; gap: 6px; font-family: var(--font-mono); font-size: var(--fs-body); font-weight: var(--fw-semibold); }
.cl-new { height: 18px; padding: 0 6px; border-radius: var(--radius-full); background: var(--hue-blue); color: var(--control-solid-text); font-family: var(--font-sans); font-size: var(--fs-micro); font-weight: var(--fw-semibold); display: inline-flex; align-items: center; }
.cl-item .dt { font-size: var(--fs-micro); color: var(--text-muted); margin-top: 3px; }
/* 一句话标题最多 20 字(RELEASE-NOTES-SPEC §4),这一栏两行放得下:折行不截断,万一超两行才省略 */
.cl-item .hl {
  font-size: var(--fs-label); line-height: 16px; color: var(--text-secondary); margin-top: 2px;
  display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; overflow-wrap: anywhere;
}
.cl-foot { margin-top: auto; padding: 10px; border-top: 1px solid var(--divider); font-size: var(--fs-micro); line-height: 16px; color: var(--text-muted); }

.cl-detail { flex: 1; min-width: 0; overflow-y: auto; padding: 20px 24px 12px; }
.cl-vv { display: flex; align-items: center; gap: 8px; font-family: var(--font-mono); font-size: var(--fs-h2); font-weight: var(--fw-semibold); }
.cl-cur { font-family: var(--font-sans); font-size: var(--fs-micro); font-weight: var(--fw-medium); color: var(--text-secondary); background: var(--surface-sunken); border-radius: var(--radius-full); padding: 2px 8px; }
.cl-m { font-size: var(--fs-label); color: var(--text-muted); margin-top: 2px; }
.cl-hl { font-size: var(--fs-h4); font-weight: var(--fw-medium); margin-top: 8px; }
.cl-feat { margin-top: 14px; }
.cl-sec { display: flex; align-items: center; gap: 8px; padding: 16px 0 2px; }
.cl-sec .n { font-size: var(--fs-label); color: var(--text-muted); }
/* 分组标签与「本次更新」弹窗同一套 */
.wn-chip { display: inline-flex; align-items: center; height: 20px; padding: 0 8px; border-radius: var(--radius-full); font-size: var(--fs-micro); font-weight: var(--fw-semibold); }
.wn-chip.add { color: var(--hue-blue); background: var(--accent-blue); }
/* 改进:写字用的绿(原 oklch(0.47 0.1 150) 暗色下看不见),底 = --hue-green 12% */
.wn-chip.imp { color: oklch(0.47 0.1 150); background: color-mix(in srgb, var(--hue-green) 12%, transparent); }
:root[data-theme="dark"] .wn-chip.imp { color: var(--delta-up-text); }   /* 浅色照旧;原值暗色下看不见 */
.wn-chip.fix { color: var(--hue-orange); background: rgba(239, 159, 39, 0.12); }

.cl-row { display: flex; align-items: center; gap: 12px; padding: 9px 0; border-bottom: 1px solid var(--divider); }
.cl-row:last-child { border-bottom: none; }
.cl-row.go { cursor: pointer; }
.cl-row .tx { flex: 1; min-width: 0; }
.cl-row .t { font-size: var(--fs-body); font-weight: var(--fw-medium); }
.cl-row .d { font-size: var(--fs-label); line-height: 18px; color: var(--text-muted); margin-top: 1px; }
.cl-lnk { display: inline-flex; align-items: center; gap: 1px; flex: 0 0 auto; font-size: var(--fs-label); color: var(--text-link); }

/* S 档全屏 + 版本列表变顶部横滑胶囊 */
@media (max-width: 600px) {
  .cl { width: 100%; height: 100%; max-height: none; border: none; border-radius: 0; }
  .cl-h { padding: 0 8px; padding-top: env(safe-area-inset-top); height: calc(52px + env(safe-area-inset-top)); }
  .cl-back { display: grid; width: 44px; height: 44px; }
  .cl-x { width: 44px; height: 44px; }
  .cl-t { text-align: center; }
  .cl-b { flex-direction: column; }
  .cl-list {
    flex: 0 0 auto; flex-direction: row; gap: 8px; overflow-x: auto; overflow-y: hidden;
    padding: 10px 16px; border-right: none; border-bottom: 1px solid var(--divider);
  }
  .cl-item {
    flex: 0 0 auto; flex-direction: row; align-items: center; gap: 6px; width: auto;
    min-height: 36px; padding: 0 14px; border: 1px solid var(--border-control); border-radius: var(--radius-full);
    background: var(--surface-white);
  }
  .cl-item.on, .cl-item.on:hover { background: var(--control-solid); border-color: var(--control-solid); color: var(--control-solid-text); box-shadow: none; }
  .cl-item .dt, .cl-item .hl { display: none; }
  /* 列表底下那行说明在横排里会被压成一条窄柱、把整排胶囊撑高(0.13.0 起就有,2026-09-19 量到 133px):不折行,排在末尾 */
  .cl-foot { flex: 0 0 auto; align-self: center; margin: 0; padding: 0 4px; border-top: none; white-space: nowrap; }
  .cl-detail { padding: 16px 16px calc(12px + env(safe-area-inset-bottom)); }
  .cl-row { min-height: 44px; }
}
</style>
