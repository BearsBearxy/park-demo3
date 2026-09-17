<script setup lang="ts">
// 「本次更新」——新版本第一次打开时自动弹一次(VERSION-UPDATE-SPEC §2/§3)。
// 开关在 update store 的 popupOpen:本组件不自己决定什么时候弹,只负责弹出来长什么样。
import { computed, defineAsyncComponent, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useUpdateStore } from '@/stores/update'
import { useTabsStore } from '@/stores/tabs'
import { iconFor } from '@/components/ds/icon'
import { BRAND } from '@/brand'
import Button from '@/components/ds/Button.vue'
import { X, ChevronRight, Bell, Check } from 'lucide-vue-next'
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

const note = computed(() => upd.note)
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
          <section v-if="note.feature" class="wn-feat">
            <div class="wn-feat-tx">
              <div class="wn-feat-top">
                <span class="wn-ic lg"><component :is="iconFor(note.feature.icon)" :size="16" /></span>
                <span class="wn-chip add">新增</span>
              </div>
              <h3>{{ note.feature.title }}</h3>
              <p>{{ note.feature.desc }}</p>
              <button v-if="note.feature.to" class="wn-lnk" @click="go(note.feature)">
                {{ note.feature.toLabel ?? '去看看' }}<ChevronRight :size="12" />
              </button>
            </div>
            <!-- 配图:一张静态示意,说明这一版改的是什么样子(不接数据) -->
            <div class="wn-pic" aria-hidden="true">
              <div class="wn-pic-h"><span>本月出账 · 2026-08</span><span class="wn-pic-bell"><Bell :size="14" /><i>2</i></span></div>
              <div class="wn-pic-r"><span>利润表</span><span class="wn-pic-s"><i class="wn-dot warn"></i>待审核</span></div>
              <div class="wn-pic-r"><span>月度台账 · 一期</span><span class="wn-pic-s ok"><Check :size="12" />已审核</span></div>
              <div class="wn-pic-r"><span>附表10 销售收入</span><span class="wn-pic-btn">交审</span></div>
            </div>
          </section>

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
  background: rgba(28, 28, 28, 0.34);
  display: grid; place-items: center;
  opacity: 0; animation: fp-fade-in var(--dur-base) var(--ease-out) forwards;
}
.wn {
  width: min(560px, 92vw); height: min(720px, 86vh);
  display: flex; flex-direction: column;
  background: var(--surface-white);
  border: 1px solid var(--border-subtle); border-radius: 16px;
  box-shadow: 0 24px 64px rgba(28, 28, 28, 0.28);
  overflow: hidden; font-family: var(--font-sans);
  animation: fp-rise-in var(--dur-base) var(--ease-out) both;
}

/* ── 页头 ── */
.wn-hero {
  position: relative; flex: 0 0 auto; height: 164px;
  padding: 18px 22px; color: #fff; display: flex; flex-direction: column;
  overflow: hidden; background: #04070d;   /* WebGL 不可用时的底色 */
}
.wn-hero > * { position: relative; }
.wn-wave { position: absolute; inset: 0; }
.wn-mark { position: absolute; right: -30px; bottom: -46px; width: 190px; height: 190px; opacity: 0.14; }
.wn-brand { display: flex; align-items: center; gap: 8px; font-size: var(--fs-label); font-weight: var(--fw-semibold); }
.wn-brand span { font-weight: var(--fw-regular); color: rgba(255, 255, 255, 0.62); }
.wn-x {
  position: absolute; top: 14px; right: 14px; z-index: 1;
  width: 28px; height: 28px; border: none; border-radius: var(--radius-sm);
  display: grid; place-items: center; cursor: pointer;
  color: rgba(255, 255, 255, 0.72); background: rgba(255, 255, 255, 0.08);
  transition: background var(--dur-fast) var(--ease-standard);
}
.wn-x:hover { background: rgba(255, 255, 255, 0.18); color: #fff; }
.wn-eb { margin-top: auto; font-size: var(--fs-label); color: rgba(255, 255, 255, 0.62); }
.wn-ver { font-family: var(--font-mono); font-size: var(--fs-display); font-weight: var(--fw-semibold); line-height: 1.2; letter-spacing: var(--ls-tight); margin-top: 2px; }
.wn-sub { font-size: var(--fs-h4); color: rgba(255, 255, 255, 0.86); margin-top: 2px; }

/* ── 正文 ── */
.wn-body { flex: 1; min-height: 0; overflow-y: auto; padding: 16px 16px 10px; }
.wn-feat {
  display: flex; gap: 16px; padding: 16px;
  border: 1px solid var(--border-subtle); border-radius: var(--radius-md); background: var(--surface-card);
}
.wn-feat-tx { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; }
.wn-feat-top { display: flex; align-items: center; gap: 8px; }
.wn-feat h3 { margin: 10px 0 0; font-size: var(--fs-h3); font-weight: var(--fw-semibold); }
.wn-feat p { margin: 4px 0 0; font-size: var(--fs-label); line-height: 18px; color: var(--text-muted); }
.wn-feat .wn-lnk { margin-top: auto; padding-top: 10px; }

.wn-ic {
  width: 30px; height: 30px; flex: 0 0 auto; border-radius: var(--radius-sm);
  display: grid; place-items: center; background: var(--surface-card); color: var(--text-secondary);
}
.wn-ic.lg { background: var(--surface-white); border: 1px solid var(--border-subtle); }

/* 配图:静态示意,尺寸与稿一致 */
.wn-pic {
  flex: 0 0 200px; align-self: stretch; padding: 10px; display: flex; flex-direction: column; gap: 6px;
  background: var(--surface-white); border: 1px solid var(--border-subtle); border-radius: 10px;
}
.wn-pic-h { display: flex; align-items: center; justify-content: space-between; font-size: var(--fs-micro); color: var(--text-muted); padding-bottom: 4px; border-bottom: 1px solid var(--divider); }
.wn-pic-bell { position: relative; display: inline-flex; color: var(--text-secondary); }
.wn-pic-bell i {
  position: absolute; top: -6px; right: -8px; min-width: 14px; height: 14px; padding: 0 3px;
  border-radius: var(--radius-full); background: var(--hue-red); color: #fff;
  font-family: var(--font-mono); font-size: 9.5px; font-style: normal; font-weight: var(--fw-semibold);
  display: grid; place-items: center; box-shadow: 0 0 0 1.5px var(--surface-white);
}
.wn-pic-r { display: flex; align-items: center; justify-content: space-between; gap: 6px; height: 24px; font-size: var(--fs-label); }
.wn-pic-s { display: inline-flex; align-items: center; gap: 4px; font-size: var(--fs-micro); color: var(--text-muted); }
.wn-pic-s.ok { color: var(--status-success); }
.wn-dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; }
.wn-dot.warn { background: var(--hue-orange); }
.wn-pic-btn { height: 24px; padding: 0 10px; border-radius: var(--radius-full); background: var(--ink-900); color: #fff; font-size: var(--fs-micro); display: inline-flex; align-items: center; }

/* 分组与条目 */
.wn-sec { display: flex; align-items: center; gap: 8px; padding: 16px 6px 4px; }
.wn-sec .n { font-size: var(--fs-label); color: var(--text-muted); }
.wn-chip { display: inline-flex; align-items: center; height: 20px; padding: 0 8px; border-radius: var(--radius-full); font-size: var(--fs-micro); font-weight: var(--fw-semibold); }
.wn-chip.add { color: var(--hue-blue); background: var(--accent-blue); }
/* 绿色令牌对白底 4.05:1,过不了正文的 4.5:1(tokens.css 那条注释) —— 标签文字压暗一档再用 */
.wn-chip.imp { color: oklch(0.47 0.1 150); background: oklch(0.58 0.13 150 / 0.12); }
.wn-chip.fix { color: var(--hue-orange); background: rgba(239, 159, 39, 0.12); }

.wn-row {
  display: flex; align-items: center; gap: 11px; width: 100%; padding: 8px 10px;
  border: none; border-radius: 9px; background: transparent; text-align: left;
  font-family: var(--font-sans); color: var(--text-primary); cursor: default;
  transition: background var(--dur-fast) var(--ease-standard);
}
.wn-row.go { cursor: pointer; }
.wn-row.go:hover { background: var(--bg-hover); }
.wn-row.go:hover .wn-ic { background: var(--surface-white); }
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
  .wn-feat { flex-direction: column; }
  .wn-pic { flex: 0 0 auto; align-self: stretch; }
  /* 触达 ≥44(§6.2);按钮整行宽,链接在它上面一行 */
  .wn-foot { flex-direction: column-reverse; align-items: stretch; gap: 8px; padding: 10px 16px calc(10px + env(safe-area-inset-bottom)); }
  .wn-foot :deep(.ds-btn) { width: 100%; height: 44px; }
  .wn-lnk.big { justify-content: center; min-height: 32px; }
  .wn-row { min-height: 44px; }
}
</style>
