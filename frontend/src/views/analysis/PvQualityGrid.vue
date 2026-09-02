<script setup lang="ts">
/**
 * PvQualityGrid —— 高级分析档 L6「数据质量矩阵」。13 栋 × 全年天。
 *
 * **手写 CSS Grid,不用 ECharts。** 本仓的 echartsBundle 是裁剪打包的,heatmap 和
 * visualMap 都没注册 —— 用了得到的是空白图加一句控制台警告,而 jsdom 里测不出来。
 * 当年那版(a62c60c^ 的 PvMeterAnaView)也是手写的格子,这里沿用。
 *
 * **三态三色,不是两态。** 正常进矩阵 / 缺抄 / 整日剔除,三件事语义不同:
 * 「缺抄」是这一栋这一天没有记录,「整日剔除」是那一天所有栋都不参与比较。
 * 合并成一个「没数据」就是把两个不同的审计答案说成同一个。
 * 而且**没有「补齐」这一档 —— 本实现从不补齐**,矩阵里看见的空就是真的空。
 *
 * 颜色走墨阶 + 一支区分色。强调色 #9D5D17 按 §06.0 只在 L0-L1,这一档不用它。
 * 栋名列 96px —— 与队列 / slopegraph / 抽屉表同宽同左缘(§06.7 的隐形基线)。
 */
import { computed } from 'vue'
import { useWidth } from '@/components/ana/useWidth'

type Cell = 'ok' | 'miss' | 'dropped'

const props = defineProps<{
  rows: { id: number; name: string; cells: Cell[] }[]
  dates: string[] // 与 cells 等长
}>()
const emit = defineEmits<{ (e: 'pick', id: number): void }>()

// 测的是可滚动区的宽,栋名列在它外面,所以不用再减 96
const { el, width } = useWidth(720)

/** 格宽自适应:塞得下就多给几像素,塞不下钉在 2px 让容器自己横向滚。 */
const cw = computed(() => {
  const n = props.dates.length
  if (!n) return 2
  return Math.min(6, Math.max(2, Math.floor(width.value / n)))
})

/** 月标尺和矩阵共用同一条列轨,不然两行对不齐。 */
const cols = computed(() => `grid-template-columns: repeat(${props.dates.length}, ${cw.value}px)`)

/** 月分段:按 YYYY-MM 合并,跨年也不会把两个 1 月并成一段。 */
const months = computed(() => {
  const out: { key: string; label: string; span: number }[] = []
  for (const d of props.dates) {
    const key = d.slice(0, 7)
    const last = out[out.length - 1]
    if (last && last.key === key) last.span++
    else out.push({ key, label: `${Number(d.slice(5, 7))}月`, span: 1 })
  }
  return out
})

const counts = computed(() => {
  let miss = 0, dropped = 0
  for (const r of props.rows) {
    for (const c of r.cells) {
      if (c === 'miss') miss++
      else if (c === 'dropped') dropped++
    }
  }
  return { miss, dropped }
})

const label = computed(() =>
  `数据质量矩阵，${props.rows.length} 栋 × ${props.dates.length} 天，` +
  `${counts.value.miss} 格缺抄、${counts.value.dropped} 格整日剔除，其余正常进矩阵。`)

/** 4700 个格子不挂 4700 个监听:事件委托,格子上带 data-id。 */
function onCellClick(e: MouseEvent) {
  const id = (e.target as HTMLElement | null)?.dataset?.id
  if (id) emit('pick', Number(id))
}
</script>

<template>
  <div class="pqg">
    <!-- 图例常驻:不做 hover 才出的图例 -->
    <div class="pqg-legend">
      <span class="lg"><i class="sw ok" />正常 —— 进了模型</span>
      <span class="lg"><i class="sw miss" />缺抄 —— 当天这栋没有抄表记录</span>
      <span class="lg"><i class="sw dropped" />整日剔除 —— 当天在网楼栋不足，全天不参与比较</span>
      <span class="lg note">没有「补齐」这一档 —— 本实现从不补齐</span>
    </div>

    <div v-if="dates.length" class="pqg-body">
      <!-- 栋名在 role="img" 外面:矩阵本身对读屏是一张图,栋名要保持可读可点 -->
      <div class="pqg-names">
        <button v-for="r in rows" :key="r.id" type="button" class="nm"
          :title="r.name" @click="emit('pick', r.id)">{{ r.name }}</button>
      </div>

      <div ref="el" class="pqg-scroll">
        <div class="pqg-months" :style="cols">
          <span v-for="m in months" :key="m.key" :style="{ gridColumn: `span ${m.span}` }">{{ m.label }}</span>
        </div>
        <div class="pqg-cells" :style="cols" role="img" :aria-label="label" @click="onCellClick">
          <template v-for="r in rows" :key="r.id">
            <i v-for="(st, k) in r.cells" :key="k" :class="['c', st]"
              :data-id="r.id" :title="`${r.name} ${dates[k] ?? ''} ${st}`" />
          </template>
        </div>
      </div>
    </div>
    <div v-else class="pqg-none">这一档没有可显示的日期。</div>
  </div>
</template>

<style scoped>
.pqg {
  --rh: 12px;   /* 行高 */
  --rg: 2px;    /* 行距 */
  --mh: 14px;   /* 月标尺高 */
  width: 100%;
}

/* 三态:墨阶两档 + 一支区分色。正常最淡(它是背景),整日剔除最重(它是审计答案)。 */
.sw.ok, .c.ok { background: var(--ink-100); }
.sw.miss, .c.miss { background: var(--fill-blue); }
.sw.dropped, .c.dropped { background: var(--ink-700); }

.pqg-legend {
  display: flex; flex-wrap: wrap; gap: 4px 14px;
  font-size: var(--fs-micro); color: var(--text-muted); margin-bottom: 6px;
}
.lg { display: inline-flex; align-items: center; gap: 5px; }
.lg.note { color: var(--text-secondary); }
.sw { display: inline-block; width: 10px; height: 10px; border-radius: 1px; }

.pqg-body { display: flex; align-items: flex-start; gap: 6px; }

.pqg-names {
  flex: 0 0 96px; width: 96px;
  display: grid; grid-auto-rows: var(--rh); row-gap: var(--rg);
  padding-top: calc(var(--mh) + var(--rg));
}
.nm {
  all: unset; box-sizing: border-box; cursor: pointer;
  font-size: var(--fs-micro); line-height: var(--rh); color: var(--text-secondary);
  text-align: right; padding-right: 6px;
  overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
}
.nm:hover, .nm:focus-visible { color: var(--text-primary); background: var(--bg-hover); }

/* 放不下就自己滚,不让页面横向滚 */
.pqg-scroll { flex: 1 1 auto; min-width: 0; overflow-x: auto; overflow-y: hidden; }

.pqg-months {
  display: grid; height: var(--mh); margin-bottom: var(--rg);
  font-size: var(--fs-micro); color: var(--text-muted); line-height: var(--mh);
}
.pqg-months > span {
  overflow: hidden; white-space: nowrap;
  border-left: 1px solid var(--border-subtle); padding-left: 2px;
}

.pqg-cells { display: grid; grid-auto-rows: var(--rh); row-gap: var(--rg); cursor: pointer; }
.c { display: block; height: var(--rh); }

.pqg-none { font-size: var(--fs-micro); color: var(--text-muted); }
</style>
