<script setup lang="ts">
// 「本次更新」——功能更新第一次打开时自动弹一次;小调整不弹(VERSION-UPDATE-SPEC §2/§3,RELEASE-NOTES-SPEC §7)。
// 开关在 update store 的 popupOpen:本组件不自己决定什么时候弹,只负责弹出来长什么样。
import { computed, defineAsyncComponent, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useUpdateStore } from '@/stores/update'
import { useTabsStore } from '@/stores/tabs'
import { iconFor } from '@/components/ds/icon'
import { BRAND } from '@/brand'
import Button from '@/components/ds/Button.vue'
import { X, ChevronRight } from 'lucide-vue-next'
import ReleaseFeatureCard from '@/components/shell/release/ReleaseFeatureCard.vue'
import logoUrl from '@/assets/brand/logo.svg'
import type { ReleaseItem } from '@/types/changelog'

// 页头那片流动的暗色 = 登录页那一套(同色同速)。异步加载:WebGL 那 12KB 不该进首屏包;
// 组件自带 prefers-reduced-motion 处理(静止一帧),这里不重复判断。
const GradientWave = defineAsyncComponent(() => import('@/components/fp/GradientWave.vue'))
const WAVE_COLORS = ['#04070d', '#08192e', '#10133a', '#05101f']
const WAVE_SPEED = 0.000005

const upd = useUpdateStore()
const router = useRouter()
const tabs = useTabsStore()

// 弹的是「最新一版功能更新」,不一定是当前版本:当前是小调整(0.15.1)时弹的是 0.15.0(stores/update.ts popupNote)
const note = computed(() => upd.popupNote)
const addedCount = computed(() => (note.value ? note.value.added.length + (note.value.feature ? 1 : 0) : 0))

/** 关掉 = 看过了。四条路(知道了 / × / 点遮罩 / Esc)都走这里,随后在 ✦ 下提示一次入口在哪。 */
function close() {
  upd.markSeen()
  upd.showCoachOnce()
}
function openHistory() {
  upd.markSeen()
  upd.openHistory(true)   // 从这儿进去的,手机上左上角给个返回
}
function go(item: ReleaseItem) {
  if (!item.to) return
  upd.markSeen()
  tabs.open(item.to)
  router.push('/' + item.to)
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') { e.preventDefault(); close() }
}
onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <Teleport to="body">
    <!-- 遮罩点外关:和命令面板同口径(mousedown 在卡片内不冒泡到这里) -->
    <div v-if="note" class="wn-scrim" @mousedown="close">
      <div class="wn" role="dialog" aria-modal="true" aria-label="本次更新" @mousedown.stop>
        <!-- 页头:暗色 + 流动背景 + 品牌标志水印 -->
        <header class="wn-hero">
          <GradientWave class="wn-wave" :colors="WAVE_COLORS" :noise-speed="WAVE_SPEED" />
          <img class="wn-mark" :src="logoUrl" alt="" aria-hidden="true" />
          <div class="wn-brand">
            <img :src="logoUrl" width="18" height="18" alt="" aria-hidden="true" />{{ BRAND.name }}<span>{{ BRAND.nameEn }}</span>
          </div>
          <button class="wn-x" aria-label="关闭" @click="close"><X :size="16" /></button>
          <div class="wn-eb">版本更新 · {{ note.date }}</div>
          <div class="wn-ver">v{{ note.version }}</div>
          <div class="wn-sub">{{ note.headline }}</div>
        </header>

        <div class="wn-body">
          <!-- 本版重点 -->
          <ReleaseFeatureCard :note="note" linkable @go="go(note.feature!)" />

          <template v-if="addedCount">
            <div class="wn-sec"><span class="wn-chip add">新增</span><span class="n">{{ addedCount }} 项</span></div>
            <button v-for="it in note.added" :key="it.title" class="wn-row" :class="{ go: !!it.to }" @click="go(it)">
              <span class="wn-ic"><component :is="iconFor(it.icon)" :size="16" /></span>
              <span class="tx"><span class="t">{{ it.title }}</span><span class="d">{{ it.desc }}</span></span>
              <span v-if="it.to" class="wn-lnk as-text">{{ it.toLabel ?? '去看看' }}<ChevronRight :size="12" /></span>
            </button>
          </template>

          <template v-if="note.improved.length">
            <div class="wn-sec"><span class="wn-chip imp">改进</span><span class="n">{{ note.improved.length }} 项</span></div>
            <button v-for="it in note.improved" :key="it.title" class="wn-row" :class="{ go: !!it.to }" @click="go(it)">
              <span class="wn-ic"><component :is="iconFor(it.icon)" :size="16" /></span>
              <span class="tx"><span class="t">{{ it.title }}</span><span class="d">{{ it.desc }}</span></span>
              <span v-if="it.to" class="wn-lnk as-text">{{ it.toLabel ?? '去看看' }}<ChevronRight :size="12" /></span>
            </button>
          </template>

          <template v-if="note.fixed.length">
            <div class="wn-sec"><span class="wn-chip fix">修复</span><span class="n">{{ note.fixed.length }} 项</span></div>
            <ul class="wn-fix">
              <li v-for="f in note.fixed" :key="f">{{ f }}</li>
            </ul>
          </template>
        </div>

        <footer class="wn-foot">
          <button class="wn-lnk big" @click="openHistory">查看全部更新记录<ChevronRight :size="14" /></button>
          <Button variant="filled" @click="close">知道了</Button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* 模态档(PAGE-BEHAVIOR-SPEC §3):遮罩 + 居中,不用 popover 档 */
.wn-scrim {
  position: fixed; inset: 0; z-index: var(--z-modal);
  background: var(--scrim);
  display: grid; place-items: center;
  opacity: 0; animation: fp-fade-in var(--dur-base) var(--ease-out) forwards;
}
.wn {
  width: min(560px, 92vw); height: min(720px, 86vh);
  display: flex; flex-direction: column;
  background: var(--surface-raised);
  border: 1px solid var(--border-subtle); border-radius: 16px;
  box-shadow: var(--shadow-dialog);
  overflow: hidden; font-family: var(--font-sans);
  animation: fp-rise-in var(--dur-base) var(--ease-out) both;
}

/* ── 页头 ──
   页头是固定的暗色流动背景(同登录页),两种外观都一样:字用 --text-on-solid(恒白)。 */
.wn-hero {
  position: relative; flex: 0 0 auto; height: 164px;
  padding: 18px 22px; color: var(--text-on-solid); display: flex; flex-direction: column;
  overflow: hidden; background: #04070d;   /* WebGL 不可用时的底色 */
}
.wn-hero > * { position: relative; }
.wn-wave { position: absolute; inset: 0; }
.wn-mark { position: absolute; right: -30px; bottom: -46px; width: 190px; height: 190px; opacity: 0.14; }
.wn-brand { display: flex; align-items: center; gap: 8px; font-size: var(--fs-label); font-weight: var(--fw-semibold); }
.wn-brand span { font-weight: var(--fw-regular); color: color-mix(in srgb, var(--text-on-solid) 62%, transparent); }
.wn-x {
  position: absolute; top: 14px; right: 14px; z-index: 1;
  width: 28px; height: 28px; border: none; border-radius: var(--radius-sm);
  display: grid; place-items: center; cursor: pointer;
  color: color-mix(in srgb, var(--text-on-solid) 72%, transparent); background: color-mix(in srgb, var(--text-on-solid) 8%, transparent);
  transition: background var(--dur-fast) var(--ease-standard);
}
.wn-x:hover { background: color-mix(in srgb, var(--text-on-solid) 18%, transparent); color: var(--text-on-solid); }
.wn-eb { margin-top: auto; font-size: var(--fs-label); color: color-mix(in srgb, var(--text-on-solid) 62%, transparent); }
.wn-ver { font-family: var(--font-mono); font-size: var(--fs-display); font-weight: var(--fw-semibold); line-height: 1.2; letter-spacing: var(--ls-tight); margin-top: 2px; }
.wn-sub { font-size: var(--fs-h4); color: color-mix(in srgb, var(--text-on-solid) 86%, transparent); margin-top: 2px; }

/* ── 正文 ── */
.wn-body { flex: 1; min-height: 0; overflow-y: auto; padding: 16px 16px 10px; }
.wn-ic {
  width: 30px; height: 30px; flex: 0 0 auto; border-radius: var(--radius-sm);
  display: grid; place-items: center; background: var(--surface-card); color: var(--text-secondary);
}
/* 分组与条目 */
.wn-sec { display: flex; align-items: center; gap: 8px; padding: 16px 6px 4px; }
.wn-sec .n { font-size: var(--fs-label); color: var(--text-muted); }
.wn-chip { display: inline-flex; align-items: center; height: 20px; padding: 0 8px; border-radius: var(--radius-full); font-size: var(--fs-micro); font-weight: var(--fw-semibold); }
.wn-chip.add { color: var(--hue-blue); background: var(--accent-blue); }
/* 绿色令牌对白底 4.05:1,过不了正文的 4.5:1(tokens.css 那条注释) —— 字用写字用的绿 --delta-up-text(暗色下提亮) */
.wn-chip.imp { color: oklch(0.47 0.1 150); background: color-mix(in srgb, var(--hue-green) 12%, transparent); }
:root[data-theme="dark"] .wn-chip.imp { color: var(--delta-up-text); }   /* 浅色照旧;原值暗色下看不见 */
.wn-chip.fix { color: var(--hue-orange); background: rgba(239, 159, 39, 0.12); }

.wn-row {
  display: flex; align-items: center; gap: 11px; width: 100%; padding: 8px 10px;
  border: none; border-radius: 9px; background: transparent; text-align: left;
  font-family: var(--font-sans); color: var(--text-primary); cursor: default;
  transition: background var(--dur-fast) var(--ease-standard);
}
.wn-row.go { cursor: pointer; }
.wn-row.go:hover { background: var(--bg-hover); }
.wn-row.go:hover .wn-ic { background: var(--surface-raised); }
.wn-row .tx { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.wn-row .t { font-size: var(--fs-body); font-weight: var(--fw-medium); }
.wn-row .d { font-size: var(--fs-label); line-height: 18px; color: var(--text-muted); margin-top: 1px; }
.wn-fix { margin: 0; padding: 2px 10px 4px 30px; font-size: var(--fs-label); line-height: 18px; color: var(--text-secondary); }
.wn-fix li { margin: 5px 0; }

.wn-lnk {
  display: inline-flex; align-items: center; gap: 1px; flex: 0 0 auto;
  border: none; background: transparent; padding: 0; cursor: pointer;
  font-family: var(--font-sans); font-size: var(--fs-label); color: var(--text-link);
}
.wn-lnk.big { font-size: var(--fs-body); }
.wn-lnk.as-text { pointer-events: none; }   /* 整行可点,链接只是指路 */

.wn-foot {
  flex: 0 0 auto; display: flex; align-items: center; gap: 16px; justify-content: space-between;
  padding: 12px 16px 12px 20px; border-top: 1px solid var(--divider); background: var(--surface-card);
}

/* S 档全屏接管(RESPONSIVE-LAYOUT-SPEC §4.3,同命令面板) */
@media (max-width: 600px) {
  .wn { width: 100%; height: 100%; max-height: none; border: none; border-radius: 0; }
  .wn-hero { height: 196px; padding: calc(18px + env(safe-area-inset-top)) 20px 18px; }
  .wn-x { top: calc(14px + env(safe-area-inset-top)); right: 12px; width: 36px; height: 36px; }
  .wn-body { padding: 12px 12px 8px; }
  /* 触达 ≥44(§6.2);按钮整行宽,链接在它上面一行 */
  .wn-foot { flex-direction: column-reverse; align-items: stretch; gap: 8px; padding: 10px 16px calc(10px + env(safe-area-inset-bottom)); }
  .wn-foot :deep(.ds-btn) { width: 100%; height: 44px; }
  .wn-lnk.big { justify-content: center; min-height: 32px; }
  .wn-row { min-height: 44px; }
}
</style>
