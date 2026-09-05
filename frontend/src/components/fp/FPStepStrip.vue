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
import { useRouter } from 'vue-router'
import { iconFor } from '@/components/ds/icon'

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
  router.push(props.query ? { path: '/' + s.value, query: props.query } : '/' + s.value)
}
</script>

<template>
  <div class="fss">
    <button v-if="!hideBack" class="fss-back" @click="emit('back')">
      <component :is="iconFor('arrow-left')" :size="13" />{{ backLabel ?? '换出账月' }}
    </button>
    <span class="fss-period">{{ period }}</span>

    <div class="fss-steps">
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
  transition: background var(--dur-fast), color var(--dur-fast);
}
.fss-step.done { color: var(--text-secondary); }
.fss-step:hover:not(.on) { color: var(--text-primary); background: var(--ink-050); }

/* 当前步:白药丸 + 投影(与 Segmented 的 .on 同一手法)。只换背景与色,尺寸不动。 */
.fss-step.on {
  background: var(--surface-white);
  color: var(--text-primary);
  font-weight: var(--fw-semibold);
  box-shadow: var(--shadow-pill, 0 1px 4px rgba(28, 28, 28, .12));
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
</style>
