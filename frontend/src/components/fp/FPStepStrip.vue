<script setup lang="ts">
/**
 * 链路条 / 期间条（2026-08-28 设计稿 §3.1、§⑤）。
 *
 * 一组共享同一个账期的屏，横着走的那条路。出账链喂五道工序、报表层喂五张表（P3），
 * **同一个组件两组数据** —— 它们要解决的是同一件事：换屏不换期。
 *
 * 改造前那五屏各存各的 year/month，从抄表切到催缴单期会变；有了这条之后，
 * 期由 `stores/billingPeriod` 一处持有，条上永远写着是几月。
 *
 * ⚠ 「返回」发事件不自己动 store：出账链清的是 billingPeriod，报表层清的是另一份期。
 *   组件不该知道自己在给谁服务。
 *
 * ⚠ 布局稳定铁律：当前步用 box-shadow + 背景高亮，**不加边框、不改字重占位**
 *   （字重用 font-synthesis 会撑宽，这里靠 min-width 的等宽底稿位兜住）。
 *   状态点在没有 state 时整个不渲染（报表层那组），有 state 时 todo 也占位。
 */
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useTabsStore } from '@/stores/tabs'
import { iconFor } from '@/components/ds/icon'
import { useViewport } from '@/composables/useViewport'
import FPDrawer from '@/components/fp/FPDrawer.vue'

export interface Step {
  /** fpNav 路由值，点击 push('/' + value) */
  value: string
  label: string
  /** 省略 = 这组步骤没有「做没做」的概念（报表层）。 */
  state?: 'done' | 'stale' | 'todo'
  /** 悬停全名。条上写得下的就别用它 —— 报表层九个步骤挤不下全称，标签缩成「附表1」，全名放这里。 */
  title?: string
}

const props = defineProps<{
  /** readonly:步骤表都是模块级常量(CHAIN / REPORT_STEPS),组件从不改它 */
  steps: readonly Step[]
  /** 当前屏的路由值。命中的那一步高亮且不可点。 */
  current: string
  /** 期标，如 '2025-03' 或 '2025-09 · 物业公司'。 */
  period: string
  backLabel?: string
  /**
   * 不画返回钮。用在**上面本来就没有一层**的屏（收入核对的月份层就是它自己的门）——
   * 那里放一个点了不动的「换年」，比没有按钮更坏。
   */
  hideBack?: boolean
  /**
   * 带着走的期包（periodLink 形状，P0c 起）：`p=YYYY-MM`（附表侧只有年时是 `YYYY`）
   * + `co`（公司 id | all，附表 / 核对不认但原样带回）；
   * 目标屏认得几个用几个，不认的原样传回来。
   *
   * 出账链不传：它的期在 `stores/billingPeriod`（只记会话内，不进地址栏）。
   */
  query?: Record<string, string>
}>()

const emit = defineEmits<{ back: [] }>()

const router = useRouter()

function go(s: Step) {
  // 点当前屏什么都不做：再 push 一次自己只会把浏览状态（筛选、滚动位置）冲掉
  if (s.value === props.current) return
  // 同一条工序链上一步一步走,在当前页签里换(TAB-BAR-SPEC §2 例外)—— 显式登记,
  // 盖过「内容区里点出来的 = 开在右边」的默认,否则五步铺满五个页签
  useTabsStore().open(s.value)
  router.push(props.query ? { path: '/' + s.value, query: props.query } : '/' + s.value)
}

/**
 * 窄档收法(RESPONSIVE-LAYOUT-SPEC §5.9)。
 *
 * 为什么非收不可：九颗胶囊每颗 `padding:5px 11px` 合计 653px，左轨收完主区回到 358 时
 * 可用宽只有 334 —— `flex-wrap:wrap` 会折成 2 行（112px）。条自己得有收法。
 *
 * M：全条横滑 + 尾标（`n/N` 钉在滚动区外，滑到哪都知道自己是第几步）。
 * S：只画「前 · 当前 + n/N · 后」，点当前开面板看全部步骤。
 *
 * ⚠ 档位走 `useViewport()` 的 tier 而不是 `@media`：S 档换的是 DOM 结构不是样式。
 *   jsdom 无 matchMedia → tier 恒 'xl'，既有桌面断言自动走宽档分支，XL/L 渲染零差异
 *   （`fss--m` / `fss--s` 两个类都不挂，根节点还是 `class="fss"`）。
 */
const { tier } = useViewport()

// ponytail: 调用方都拿自己的路由值当 current，找不到只会是报表层那种 current='x' 的桩，
// 退到第一步，不为一个线上不发生的状态开分支。
const idx = computed(() => {
  const i = props.steps.findIndex(s => s.value === props.current)
  return i < 0 ? 0 : i
})
const cur = computed(() => props.steps[idx.value])
/** 「第几步 / 共几步」写成字 —— 不靠数胶囊，S 档条上压根没有胶囊可数。 */
const nn = computed(() => `${idx.value + 1}/${props.steps.length}`)

const sheet = ref(false)

// 首尾越界不动。箭头照样渲染（灰），不渲染会挪版 —— LAYOUT-STABILITY §1。
function nudge(d: -1 | 1) {
  const s = props.steps[idx.value + d]
  if (s) go(s)
}

function pick(s: Step) {
  sheet.value = false
  go(s)
}
</script>

<template>
  <div class="fss" :class="{ 'fss--m': tier === 'm', 'fss--s': tier === 's' }">
    <button v-if="!hideBack" class="fss-back" @click="emit('back')">
      <component :is="iconFor('arrow-left')" :size="13" />{{ backLabel ?? '换出账月' }}
    </button>
    <!-- S 档不写期：标题行里已经写着同一个期，条上再写一遍是拿走 334px 里的一块 -->
    <span v-if="tier !== 's'" class="fss-period">{{ period }}</span>

    <!-- S 档：当前 + n/N + 前后箭头 -->
    <div v-if="tier === 's'" class="fss-nav">
      <button
        class="fss-arrow fss-prev"
        :class="{ off: idx === 0 }"
        :disabled="idx === 0"
        aria-label="上一步"
        @click="nudge(-1)"
      >
        <component :is="iconFor('chevron-left')" :size="16" />
      </button>
      <button class="fss-cur" :title="cur.title" @click="sheet = true">
        <i v-if="cur.state" class="fss-pip" :class="cur.state" />
        <span class="fss-cur-label">{{ cur.label }}</span>
        <span class="fss-nn">{{ nn }}</span>
      </button>
      <button
        class="fss-arrow fss-next"
        :class="{ off: idx === steps.length - 1 }"
        :disabled="idx === steps.length - 1"
        aria-label="下一步"
        @click="nudge(1)"
      >
        <component :is="iconFor('chevron-right')" :size="16" />
      </button>
    </div>

    <div v-else class="fss-steps">
      <template v-for="(s, i) in steps" :key="s.value">
        <i v-if="i" class="fss-sep" aria-hidden="true" />
        <button
          class="fss-step"
          :class="[s.state, { on: s.value === current }]"
          :aria-current="s.value === current ? 'page' : undefined"
          :title="s.title"
          @click="go(s)"
        >
          <i v-if="s.state" class="fss-pip" :class="s.state" />{{ s.label }}
        </button>
      </template>
    </div>
    <!-- M 档尾标：钉在横滑区外面，滑到哪都写着第几步 -->
    <span v-if="tier === 'm'" class="fss-nn fss-tail">{{ nn }}</span>

    <!-- 点当前那颗 → 全部步骤与状态点。壳用 FPDrawer（S 档全屏分支在它内部，调用方零改动）。
         放在 .fss 里面是为了保住单根：它 Teleport 到 body，挂在树上哪一层都不影响版式，
         但多根组件会改变调用方的 attr 透传语义。 -->
    <FPDrawer v-if="tier === 's'" :open="sheet" :title="period" @close="sheet = false">
      <div class="fss-sheet">
        <button
          v-for="s in steps"
          :key="s.value"
          class="fss-sheet-item"
          :class="[s.state, { on: s.value === current }]"
          :aria-current="s.value === current ? 'page' : undefined"
          @click="pick(s)"
        >
          <i v-if="s.state" class="fss-pip" :class="s.state" />
          <span class="fss-sheet-label">{{ s.title ?? s.label }}</span>
        </button>
      </div>
    </FPDrawer>
  </div>
</template>

<style scoped>
.fss {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
  padding: 9px var(--space-3);
  background: var(--surface-sunken);
  border-radius: var(--radius-md);
}

.fss-back {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 9px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--surface-white);
  cursor: pointer;
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  color: var(--text-muted);
  transition: color var(--dur-fast), border-color var(--dur-fast);
}
.fss-back:hover { color: var(--hue-blue); border-color: var(--hue-blue); }

.fss-period {
  flex: none;
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: var(--fw-bold);
  color: var(--text-primary);
}

.fss-steps { display: flex; align-items: center; flex-wrap: wrap; min-width: 0; }

.fss-sep {
  flex: none;
  width: 12px;
  height: 1px;
  background: var(--border-strong);
}

.fss-step {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 11px;
  border: none;
  border-radius: var(--radius-full);
  background: transparent;
  cursor: pointer;
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  color: var(--text-muted);
  white-space: nowrap;
  transition: background var(--dur-fast) var(--ease-standard),
              color var(--dur-fast) var(--ease-standard),
              box-shadow var(--dur-fast) var(--ease-standard);
}
/* C2-03 ④ 按压:.on 是 cursor:default 的当前步,不压。 */
.fss-step:active:not(.on):not(:disabled) { background: var(--ink-100); transition-duration: 0ms; }
.fss-step.done { color: var(--text-secondary); }
.fss-step:hover:not(.on) { color: var(--text-primary); background: var(--ink-050); }

/* 当前步:白药丸 + 投影(与 Segmented 的 .on 同一手法)。只换背景与色,尺寸不动。 */
.fss-step.on {
  background: var(--surface-white);
  color: var(--text-primary);
  box-shadow: var(--shadow-pill);
  cursor: default;
}

.fss-pip {
  flex: none;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--border-strong);
}
.fss-pip.done  { background: var(--hue-blue); }
.fss-pip.stale { background: var(--hue-orange); }
/* .todo 用默认灰 —— 但点位照样占,有点没点药丸一样宽 */

/* ── 窄档(§5.9)。挂的是 tier 类不是 @media:S 档换的是 DOM 结构,
      媒体查询改不了「渲染哪一支」。宽档两个类都不挂,规则一条也命不中。 ── */

/* M:全条横滑。胶囊一颗不删(§3.5-pre「不许删内容」),折行换成横向滚动。 */
.fss--m { flex-wrap: nowrap; }
.fss--m .fss-steps {
  flex: 1 1 auto;
  flex-wrap: nowrap;
  overflow-x: auto;
  scrollbar-width: none;
}
.fss--m .fss-steps::-webkit-scrollbar { display: none; }
.fss-tail { flex: none; }

/* S:54px 定高,条上只剩「前 · 当前 + n/N · 后」。 */
.fss--s {
  height: 54px;
  box-sizing: border-box;
  flex-wrap: nowrap;
  padding: 0 var(--space-3);
}

.fss-nav {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 4px;
}

/* 首尾步的箭头变灰**不消失** —— 不渲染会把当前步整条挪过去(LAYOUT-STABILITY §1)。 */
.fss-arrow {
  flex: none;
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}
.fss-arrow.off { color: var(--border-strong); cursor: default; }
.fss-arrow:active:not(.off) { background: var(--ink-100); }

.fss-cur {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  height: 40px;
  padding: 0 12px;
  border: none;
  border-radius: var(--radius-full);
  background: var(--surface-white);
  box-shadow: var(--shadow-pill);
  cursor: pointer;
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  color: var(--text-primary);
}
.fss-cur-label {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left;
}

/* 「第几步 / 共几步」写成字 —— 数胶囊在 S 档没有胶囊可数,在 M 档滑出视野。 */
.fss-nn {
  flex: none;
  font-family: var(--font-mono);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: var(--text-muted);
}

.fss-sheet { display: flex; flex-direction: column; gap: 2px; }
.fss-sheet-item {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  padding: 0 12px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  cursor: pointer;
  font-family: var(--font-sans);
  font-size: var(--fs-body);
  color: var(--text-secondary);
  text-align: left;
}
.fss-sheet-item.on { background: var(--surface-sunken); color: var(--text-primary); }
.fss-sheet-item:active:not(.on) { background: var(--ink-050); }
.fss-sheet-label { flex: 1 1 auto; min-width: 0; }
</style>
