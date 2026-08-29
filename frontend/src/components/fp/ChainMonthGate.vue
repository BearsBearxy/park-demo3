<script setup lang="ts">
/**
 * 出账月矩阵 —— 出账链五屏共用的那道门（2026-08-28 设计稿 §①，BOOK-WORKBENCH-SPEC §7-1）。
 *
 * 改造前这五屏顶栏各挂一对年月 `Select`，用户顺手就落进某个期，五屏还可以各落各的
 * —— 而它们抢的是同一把 `billing-chain:{年}-{月}` 月锁。现在期由 `stores/billingPeriod`
 * 一处持有，这道门是它唯一的入口。
 *
 * 多点的那一次点击换回来的是**格子里的四个点**：这个月抄表 / 公摊 / 损耗 / 催缴各自做了没有，
 * 底色橙 = 参数改动晚于快照、屏上数字是旧的。这个信号（`cfgDirty`）系统里本来就有，
 * 只是改造前出了公共电核算屏就看不见。
 *
 * ⚠ 只在**没有期**时渲染 —— 选过一次之后五屏都直落表格，这道门退成链路条上的一个按钮。
 *   见 stores/billingPeriod 的「只记会话内」。
 */
import { computed, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { S } from '@/utils/lockScopes'
import { iconFor } from '@/components/ds/icon'
import BookMonthMatrix from '@/components/fp/BookMonthMatrix.vue'
import FPLoadError from '@/components/fp/FPLoadError.vue'
import { useBillingPeriodStore } from '@/stores/billingPeriod'
import { pipsOf } from '@/nav/billingChain'
import { loadExtraYears, saveExtraYears, buildYearRows } from '@/utils/matrixYears'

const props = defineProps<{ title: string; icon: string }>()

const period = useBillingPeriodStore()
const { loaded, loadErr, dataYears } = storeToRefs(period)

// 手工年按「屏+册」记本机（utils/matrixYears）。出账链是**一张**矩阵，
// 所以五屏共用同一个键 —— 在抄表屏补的年，切到催缴单也在。
const EXTRA_KEY = ['chain', 'billing'] as const
const extraYears = ref<number[]>(loadExtraYears(...EXTRA_KEY))

onMounted(() => { void period.loadChain() })

// BookMonthMatrix 的 book 只是「有没有选中的东西」一个比特（它本是账册工作台的部件）。
// 出账链没有「册」的概念 —— 恒为已选，给个空对象。
const book = {}

interface Cell { month: number; hasData: boolean; pips: boolean[]; stale: boolean; cur?: boolean }
const rows = computed(() => {
  if (!loaded.value) return []
  const cur = new Date().getFullYear()
  const out = buildYearRows(dataYears.value, cur, extraYears.value).map(r => {
    const months: Cell[] = Array.from({ length: 12 }, (_, i) => {
      const c = period.cellOf(`${r.year}-${String(i + 1).padStart(2, '0')}`)
      const pips = pipsOf(c)
      return {
        month: i + 1,
        // 四道工序一道都没走过 = 空月：走虚线卡 +「空」，不画四颗全灭的点
        hasData: pips.some(Boolean),
        pips,
        stale: c.stale,
      }
    })
    return {
      year: r.year,
      months,
      sub: r.year === cur ? '当前年' : r.manual ? '手工年' : undefined,
      removable: r.manual && extraYears.value.includes(r.year) && months.every(m => !m.hasData),
    }
  })
  // 最近一个有数据的月描边（与台账矩阵同口径）
  for (let i = out.length - 1; i >= 0; i--) {
    const j = out[i].months.map(m => m.hasData).lastIndexOf(true)
    if (j >= 0) { out[i].months[j].cur = true; break }
  }
  return out
})

/** 格子上的在场标记走出账链那把月锁 —— 四屏共占的正是它。 */
const cellScope = (y: number, m: number) => S.poolLedger(y, m)

function setExtra(years: number[]) {
  saveExtraYears(...EXTRA_KEY, years)
  extraYears.value = loadExtraYears(...EXTRA_KEY)   // 回读取归一化（去重排序）
}
const edge = (first: boolean) => {
  const r = rows.value
  if (!r.length) return new Date().getFullYear()
  return first ? r[0].year - 1 : r[r.length - 1].year + 1
}
</script>

<template>
  <!-- fp-fluid:矩阵门也是 .fp-content 的首子形态(RESPONSIVE-LAYOUT-SPEC §8「谁渲染谁是首子,都要挂」)。
       挂在组件根上而不是五个消费屏:出账链五屏已全部迁移(P2),月卡墙 auto-fill 天然自适应,
       不摘的话手机上矩阵那一屏仍被 800px 地板撑出横滚。 -->
  <div class="cmg fp-fluid">
    <div class="cmg-head">
      <div>
        <h2 class="cmg-title">
          <span class="ic"><component :is="iconFor(icon)" :size="18" /></span>{{ title }}
        </h2>
        <p class="cmg-sub">选择出账月进入 · 格内四点＝本月抄表 / 公摊 / 损耗 / 催缴的进度</p>
      </div>
    </div>

    <FPLoadError v-if="loadErr" @retry="period.reloadChain()">
      <span>{{ loadErr }} —— 矩阵没显示出来，不是这些月都没做过。</span>
    </FPLoadError>

    <div v-else-if="!loaded" class="page-loading"><span class="page-spin" /></div>

    <template v-else>
      <div class="cmg-legend">
        <span class="li"><b>四点顺序</b></span>
        <span class="li"><i class="lp on" />抄表</span>
        <span class="li"><i class="lp on" />公摊</span>
        <span class="li"><i class="lp on" />损耗</span>
        <span class="li"><i class="lp on" />催缴</span>
        <span class="sp" />
        <span class="li"><i class="lp on" />已做</span>
        <span class="li"><i class="lp" />未做</span>
        <span class="li"><i class="lw" />需重算（参数改动晚于快照）</span>
      </div>

      <BookMonthMatrix
        :scope-of="cellScope"
        :book="book"
        :years="rows"
        @pick="(y, m) => period.pick(y, m)"
        @add-earlier="setExtra([...extraYears, edge(true)])"
        @add-later="setExtra([...extraYears, edge(false)])"
        @remove-year="(y) => setExtra(extraYears.filter(x => x !== y))"
      />
    </template>
  </div>
</template>

<style scoped>
.cmg {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow-y: auto;
  box-sizing: border-box;
  font-family: var(--font-sans);
  color: var(--text-primary);
}

.cmg-head { flex: 0 0 auto; }
.cmg-title {
  margin: 0;
  font: var(--type-h2);
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.cmg-title .ic {
  width: 26px;
  height: 26px;
  border-radius: var(--radius-sm);
  background: var(--accent-blue);
  color: var(--hue-blue);
  display: grid;
  place-items: center;
  flex: none;
}
.cmg-sub { margin: 4px 0 0; font-size: var(--fs-label); color: var(--text-muted); }

.cmg-legend {
  flex: 0 0 auto;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px var(--space-5);
  padding: 10px var(--space-4);
  background: var(--surface-sunken);
  border-radius: var(--radius-md);
  font-size: var(--fs-label);
  color: var(--text-muted);
}
.cmg-legend .li { display: inline-flex; align-items: center; gap: 6px; }
.cmg-legend b { color: var(--text-primary); font-weight: var(--fw-medium); }
.cmg-legend .sp { flex: 1; }
.cmg-legend .lp {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--border-strong);
}
.cmg-legend .lp.on { background: var(--hue-blue); }
.cmg-legend .lw {
  width: 14px; height: 10px; border-radius: 3px;
  background: rgb(255, 247, 235);
  box-shadow: inset 0 0 0 1px var(--hue-orange);
}
</style>
